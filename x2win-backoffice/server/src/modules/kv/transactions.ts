// Domínio 'transactions' (geral.transacoes): extrato só de inclusão, cifrado em
// repouso (tem e-mail do jogador) e lido com dados pessoais mascarados.
//  - todo item já gravado precisa voltar igual (comparando por id, com os dados
//    pessoais mascarados restaurados do gravado); alterar ou remover → 403
//    campo_nao_permitido;
//  - itens novos só dos tipos credito_manual/debito_manual (usuarios.editar) e
//    estorno (transacoes.editar); outro tipo → 403 campo_nao_permitido, sem a
//    permissão do tipo → 403 sem_permissao;
//  - itens novos passam pelas regras do painel (valor, sinal, teto por
//    lançamento, estorno só de aposta/subtração ainda não estornada, no prazo) e
//    pelas do servidor: o jogador precisa existir em geral.jogadores, autoexcluído
//    não recebe creditação, débito não passa do saldo e as creditações manuais de
//    um jogador somam no máximo MANUAL_CREDIT_DAILY_LIMIT em 24 horas;
//  - o servidor define data (at), autor (by/byId), saldo antes/depois, nome e
//    e-mail do jogador (e o jogo, no estorno) de cada item novo: o que o painel
//    manda nesses campos é ignorado;
//  - o saldo do jogador (balanceReal/balanceBonus em geral.jogadores) muda na
//    mesma transação, sem mudar a versão da lista de jogadores (é campo do servidor);
//  - a lista gravada é: itens novos (na ordem enviada) + gravados (na ordem gravada);
//  - primeira gravação (nada gravado) aceita o extrato inteiro como base.
// Cada lançamento novo vira um registro na auditoria (creditar/estornar).
import { z } from 'zod'
import { canWriteKey, findKvRule } from '@shared/kv-registry'
import { brl } from '@shared/money'
import type { AuditAction } from '@shared/audit'
import { AppError, Errors } from '../../errors'
import type { KvContext, KvHandlers, KvValue } from '../../kv/types'
import { writeAudit } from '../../services/audit'
import { auditEntity, genericHandler } from './generic'
import { deepEqual, isPlainObject, MISSING, setOwn, type JsonObject } from './json'
import { PLAYERS_KEY } from './player-status'
import { restoreMasked, writePolicy } from './redact'
import { assertVersion, encryptAtRest, loadRow, rewriteRowValue, saveRow, storedValue } from './store'

export const TRANSACTIONS_KEY = 'geral.transacoes'
export const MAX_TRANSACTIONS = 200_000
/** Lançamentos novos aceitos numa única gravação. */
export const MAX_NEW_PER_WRITE = 50
/** Teto por lançamento manual (mesmo do painel). */
export const MANUAL_ADJUST_LIMIT = 5000
/**
 * Soma das creditações manuais de um jogador em 24 horas. Acima disso o ajuste vai
 * pelo financeiro com documento (mesma regra do teto por lançamento, que sozinho
 * não limitava nada: bastava lançar várias vezes).
 */
export const MANUAL_CREDIT_DAILY_LIMIT = MANUAL_ADJUST_LIMIT
/** Prazo para estorno, em dias (mesmo do painel). */
export const REVERSAL_WINDOW_DAYS = 15
/** Tolerância de relógio para datas gravadas no futuro. */
const FUTURE_SKEW_MS = 5 * 60_000
const DAY_MS = 86_400_000

export const TRANSACTION_TYPES = [
  'deposito',
  'saque',
  'aposta',
  'ganho',
  'bonus',
  'free_spin',
  'cashback',
  'credito_manual',
  'debito_manual',
  'estorno',
] as const

/** Tipo de lançamento novo → permissão exigida. */
export const NEW_TX_PERMISSION: Record<string, string> = {
  credito_manual: 'usuarios.editar',
  debito_manual: 'usuarios.editar',
  estorno: 'transacoes.editar',
}

const REVERSIBLE_TYPES = ['aposta', 'debito_manual']

const twoDecimals = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6
const round2 = (v: number) => Math.round(v * 100) / 100

const txId = z.string('Transação sem identificador.').min(1, 'Transação sem identificador.').max(64, 'Identificador de transação inválido.')

const txList = z.array(z.looseObject({ id: txId }), 'Envie a lista de transações.').max(MAX_TRANSACTIONS, `No máximo ${MAX_TRANSACTIONS} transações.`)

/** Formato mínimo de qualquer transação (base inicial). */
const baseTx = z.looseObject({
  id: txId,
  type: z.enum(TRANSACTION_TYPES, { error: 'Tipo de transação inválido.' }),
  amount: z.number('Valor inválido.'),
  playerId: z.string('Jogador inválido.').max(64, 'Jogador inválido.'),
})

/**
 * Lançamento novo feito pelo painel. at, by, balanceBefore/After, playerName,
 * playerEmail e os campos de jogo podem vir (o painel manda), mas são ignorados.
 */
const newTx = z.looseObject({
  id: txId,
  playerId: z.string('Jogador inválido.').min(1, 'Jogador inválido.').max(64, 'Jogador inválido.'),
  type: z.enum(['credito_manual', 'debito_manual', 'estorno'], { error: 'Tipo de lançamento inválido.' }),
  amount: z.number('Valor inválido.').refine(twoDecimals, 'Use no máximo duas casas decimais.'),
  wallet: z.enum(['real', 'bonus'], { error: 'Carteira inválida.' }),
  reference: z.string('Referência inválida.').min(1, 'Informe a referência.').max(100, 'Referência longa demais.'),
  note: z.string('Motivo inválido.').max(500, 'Motivo com mais de 500 caracteres.').optional(),
})

type NewTx = z.infer<typeof newTx>

function notAllowed(message: string, details: unknown) {
  return new AppError(403, 'campo_nao_permitido', message, details)
}

const clipIds = (ids: string[]) => ids.slice(0, 20)
const walletLabel = (w: string) => (w === 'bonus' ? 'bônus' : 'real')
const dateOf = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : Number.NaN)

/** Regras de negócio de um lançamento novo (400 quando violadas). */
function checkNewTx(tx: NewTx, storedById: Map<string, JsonObject>, reversedNow: Set<string>, now: number) {
  const fail = (msg: string) => Errors.invalid(`Transação ${tx.id}: ${msg}`, { id: tx.id })
  if (tx.type === 'credito_manual' || tx.type === 'debito_manual') {
    if (tx.type === 'credito_manual' && !(tx.amount > 0)) throw fail('a creditação precisa ter valor positivo.')
    if (tx.type === 'debito_manual' && !(tx.amount < 0)) throw fail('a subtração precisa ter valor negativo.')
    if (Math.abs(tx.amount) > MANUAL_ADJUST_LIMIT) throw fail(`o teto por lançamento é ${brl(MANUAL_ADJUST_LIMIT)}.`)
    return
  }
  // estorno
  const m = /^EST-(.+)$/.exec(tx.reference)
  if (!m) throw fail('o estorno precisa referenciar a transação original (EST-<id>).')
  const origId = m[1]
  const orig = storedById.get(origId)
  if (!orig) throw fail('a transação estornada não existe no extrato.')
  if (!REVERSIBLE_TYPES.includes(String(orig.type))) throw fail('só apostas e subtrações manuais podem ser estornadas.')
  if (typeof orig.amount !== 'number' || !(orig.amount < 0)) throw fail('a transação original não tirou saldo do jogador.')
  if (reversedNow.has(origId)) throw fail('esta transação já foi estornada.')
  if (!(tx.amount > 0) || round2(tx.amount) !== round2(Math.abs(orig.amount))) throw fail('o estorno precisa ter o mesmo valor da transação original.')
  if (tx.playerId !== orig.playerId || tx.wallet !== orig.wallet) throw fail('o estorno precisa ser do mesmo jogador e da mesma carteira.')
  const at = dateOf(orig.at)
  // data no futuro deixaria a transação estornável para sempre
  if (Number.isNaN(at) || at > now + FUTURE_SKEW_MS) throw fail('a data da transação original é inválida. Use um ajuste manual na ficha do jogador.')
  if (now - at > REVERSAL_WINDOW_DAYS * DAY_MS) {
    throw fail(`passou o prazo de ${REVERSAL_WINDOW_DAYS} dias. Use um ajuste manual na ficha do jogador.`)
  }
  reversedNow.add(origId)
}

function auditFor(tx: JsonObject): { action: AuditAction; summary: string } {
  const note = typeof tx.note === 'string' && tx.note.trim() ? ` — ${tx.note.trim().slice(0, 200)}` : ''
  const wallet = walletLabel(String(tx.wallet))
  const amount = Number(tx.amount)
  const balance = ` (saldo ${wallet}: ${brl(Number(tx.balanceBefore))} → ${brl(Number(tx.balanceAfter))})`
  if (tx.type === 'estorno') {
    return {
      action: 'estornar',
      summary: `Estorno de ${brl(amount)} (carteira ${wallet}) da transação ${String(tx.reference).slice(4)} do jogador ${String(tx.playerId)} · ${String(tx.id)}${balance}${note}`,
    }
  }
  const what = tx.type === 'credito_manual' ? 'Creditação' : 'Subtração'
  return {
    action: 'creditar',
    summary: `${what} de ${brl(Math.abs(amount))} na carteira ${wallet} do jogador ${String(tx.playerId)} · ${String(tx.id)}${balance}${note}`,
  }
}

/** Soma das creditações manuais por jogador nas últimas 24 horas (datas no futuro também contam). */
function manualCreditsLastDay(list: readonly JsonObject[], now: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const tx of list) {
    if (tx.type !== 'credito_manual' || typeof tx.amount !== 'number' || typeof tx.playerId !== 'string') continue
    const at = dateOf(tx.at)
    if (Number.isNaN(at) || at < now - DAY_MS) continue
    out.set(tx.playerId, round2((out.get(tx.playerId) ?? 0) + Math.max(0, tx.amount)))
  }
  return out
}

const PLAYERS_RULE = findKvRule(PLAYERS_KEY)!

export const kvHandlers: KvHandlers = {
  transactions: {
    read: (ctx) => genericHandler.read(ctx),

    async write(ctx: KvContext, value: unknown, expectedVersion: number | undefined): Promise<KvValue> {
      const { app, auth, key, rule } = ctx
      if (!canWriteKey(rule, auth.perms)) throw Errors.forbidden()
      // as regras do extrato valem para geral.transacoes; chave filha não é gravável
      if (key !== TRANSACTIONS_KEY) throw Errors.forbidden('Estes dados não podem ser alterados pela tela.')
      const list = txList.parse(value) as JsonObject[]
      const ids = new Set<string>()
      for (const tx of list) {
        const id = tx.id as string
        if (ids.has(id)) throw Errors.invalid(`Transação repetida na lista (${id}).`, { id })
        ids.add(id)
      }

      return app.db.tx(async (t) => {
        const row = await loadRow(t, key, true)
        assertVersion(row, expectedVersion)
        const stored = storedValue(row, app.cipher)
        const entity = auditEntity(rule.page)
        const policy = writePolicy(rule)
        const encrypt = encryptAtRest(rule)

        if (stored === MISSING) {
          // primeira gravação: o extrato inteiro vira a base (máscaras sem valor gravado são recusadas)
          const base = restoreMasked(list, MISSING, policy) as JsonObject[]
          base.forEach((tx) => baseTx.parse(tx))
          const saved = await saveRow(t, app.cipher, key, base, encrypt, row, auth.user.id)
          await writeAudit(t, auth, {
            action: 'editar',
            entity,
            summary: `${key} — Base inicial do extrato com ${base.length} ${base.length === 1 ? 'transação' : 'transações'}`,
          })
          return { value: base, version: saved.version, updatedAt: saved.updatedAt }
        }

        const storedList = (Array.isArray(stored) ? stored : []).filter(isPlainObject)
        const storedById = new Map<string, JsonObject>()
        for (const tx of storedList) if (typeof tx.id === 'string') storedById.set(tx.id, tx)

        // só inclusão: o que já está gravado volta igual (dados pessoais mascarados são restaurados)
        const echoed = restoreMasked(
          list.filter((tx) => storedById.has(tx.id as string)),
          storedList,
          policy,
        ) as JsonObject[]
        const echoedById = new Map(echoed.map((tx) => [tx.id as string, tx]))
        const removed: string[] = []
        const changed: string[] = []
        for (const [id, old] of storedById) {
          const back = echoedById.get(id)
          if (!back) removed.push(id)
          else if (!deepEqual(old, back)) changed.push(id)
        }
        if (removed.length || changed.length) {
          throw notAllowed('O extrato só aceita inclusão: transações gravadas não podem ser alteradas nem removidas.', {
            fields: [],
            changed: clipIds(changed),
            removed: clipIds(removed),
          })
        }

        const fresh = list.filter((tx) => !storedById.has(tx.id as string))
        if (fresh.length > MAX_NEW_PER_WRITE) throw Errors.invalid(`No máximo ${MAX_NEW_PER_WRITE} lançamentos novos por vez.`)
        const badType = fresh.filter((tx) => typeof tx.type !== 'string' || !isPanelTxType(tx.type))
        if (badType.length) {
          throw notAllowed('Pelo painel só é possível lançar creditações, subtrações manuais e estornos.', {
            fields: ['type'],
            ids: clipIds(badType.map((tx) => tx.id as string)),
          })
        }
        for (const tx of fresh) {
          const perm = NEW_TX_PERMISSION[tx.type as string]
          if (!auth.perms.has(perm)) {
            throw Errors.forbidden(tx.type === 'estorno' ? 'Seu cargo não pode lançar estornos.' : 'Seu cargo não pode lançar creditações nem subtrações manuais.')
          }
        }

        const reversed = new Set<string>()
        for (const tx of storedList) {
          if (tx.type === 'estorno' && typeof tx.reference === 'string' && tx.reference.startsWith('EST-')) reversed.add(tx.reference.slice(4))
        }
        const now = Date.now()
        const parsed = fresh.map((tx) => {
          const p = newTx.parse(tx)
          checkNewTx(p, storedById, reversed, now)
          return p
        })

        // cada lançamento novo é montado pelo servidor e aplicado ao saldo do jogador
        const entries: JsonObject[] = []
        if (parsed.length) {
          const playersRow = await loadRow(t, PLAYERS_KEY, true)
          const playersStored = storedValue(playersRow, app.cipher)
          const players = (Array.isArray(playersStored) ? playersStored : []).filter(isPlainObject)
          const playerById = new Map<string, JsonObject>()
          for (const p of players) if (typeof p.id === 'string' && !playerById.has(p.id)) playerById.set(p.id, p)
          const updated = new Map<string, JsonObject>()
          const credited = manualCreditsLastDay(storedList, now)
          const at = new Date(now).toISOString()

          for (const p of parsed) {
            const fail = (msg: string, field = 'playerId') => Errors.invalid(`Transação ${p.id}: ${msg}`, { id: p.id, field })
            const base = updated.get(p.playerId) ?? playerById.get(p.playerId)
            if (!base) throw fail(`o jogador ${p.playerId} não existe na base de jogadores.`)
            if (p.type === 'credito_manual') {
              if (base.status === 'autoexcluido') throw fail('jogador autoexcluído não recebe creditações.')
              const before = credited.get(p.playerId) ?? 0
              const total = round2(before + p.amount)
              if (total > MANUAL_CREDIT_DAILY_LIMIT) {
                throw fail(
                  `as creditações manuais de um jogador somam no máximo ${brl(MANUAL_CREDIT_DAILY_LIMIT)} em 24 horas (já lançado: ${brl(before)}). Acima disso, o ajuste vai pelo financeiro com documento.`,
                  'amount',
                )
              }
              credited.set(p.playerId, total)
            }
            const field = p.wallet === 'bonus' ? 'balanceBonus' : 'balanceReal'
            const balanceBefore = typeof base[field] === 'number' ? round2(base[field] as number) : 0
            const balanceAfter = round2(balanceBefore + p.amount)
            if (balanceAfter < 0) throw fail(`o saldo ${walletLabel(p.wallet)} do jogador é ${brl(balanceBefore)}.`, 'amount')
            const player: JsonObject = { ...base }
            setOwn(player, field, balanceAfter)
            updated.set(p.playerId, player)

            const orig = p.type === 'estorno' ? storedById.get(p.reference.slice(4)) : undefined
            const note = p.note?.trim()
            entries.push({
              id: p.id,
              at,
              playerId: p.playerId,
              playerName: typeof base.name === 'string' ? base.name : '',
              playerEmail: typeof base.email === 'string' ? base.email : '',
              type: p.type,
              amount: round2(p.amount),
              wallet: p.wallet,
              balanceBefore,
              balanceAfter,
              gameId: (orig?.gameId as string | null | undefined) ?? null,
              gameName: (orig?.gameName as string | null | undefined) ?? null,
              providerName: (orig?.providerName as string | null | undefined) ?? null,
              reference: p.reference,
              ...(note ? { note } : {}),
              by: auth.user.name,
              byId: auth.user.id,
            })
          }
          // saldo é do servidor: grava sem mudar a versão da lista de jogadores
          const nextPlayers = players.map((p) => (typeof p.id === 'string' && updated.get(p.id)) || p)
          await rewriteRowValue(t, app.cipher, PLAYERS_KEY, nextPlayers, encryptAtRest(PLAYERS_RULE), playersRow!)
        }

        const next = [...entries, ...storedList]
        const saved = await saveRow(t, app.cipher, key, next, encrypt, row, auth.user.id)
        if (entries.length) {
          for (const tx of entries) await writeAudit(t, auth, { entity, ...auditFor(tx) })
        } else {
          await writeAudit(t, auth, { action: 'editar', entity, summary: `${key} — Extrato salvo sem lançamentos novos` })
        }
        return { value: next, version: saved.version, updatedAt: saved.updatedAt }
      })
    },
  },
}

function isPanelTxType(type: string) {
  return Object.prototype.hasOwnProperty.call(NEW_TX_PERMISSION, type)
}
