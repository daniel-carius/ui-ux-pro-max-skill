// Domínio 'transactions' (geral.transacoes): extrato só de inclusão.
//  - todo item já gravado precisa voltar igual (comparando por id); alterar ou
//    remover → 403 campo_nao_permitido;
//  - itens novos só dos tipos credito_manual/debito_manual (usuarios.editar) e
//    estorno (transacoes.editar); outro tipo → 403 campo_nao_permitido, sem a
//    permissão do tipo → 403 sem_permissao;
//  - itens novos passam pelas mesmas regras do painel (valor, sinal, teto por
//    lançamento, estorno só de aposta/subtração ainda não estornada, no prazo);
//  - primeira gravação (nada gravado) aceita o extrato inteiro como base.
// Cada lançamento novo vira um registro na auditoria (creditar/estornar).
import { z } from 'zod'
import { canWriteKey } from '@shared/kv-registry'
import { brl } from '@shared/money'
import type { AuditAction } from '@shared/audit'
import { AppError, Errors } from '../../errors'
import type { KvContext, KvHandlers, KvValue } from '../../kv/types'
import { writeAudit } from '../../services/audit'
import { auditEntity, genericHandler } from './generic'
import { deepEqual, isPlainObject, MISSING, type JsonObject } from './json'
import { assertVersion, loadRow, saveRow, storedValue } from './store'

export const MAX_TRANSACTIONS = 200_000
/** Lançamentos novos aceitos numa única gravação. */
export const MAX_NEW_PER_WRITE = 50
/** Teto por lançamento manual (mesmo do painel). */
export const MANUAL_ADJUST_LIMIT = 5000
/** Prazo para estorno, em dias (mesmo do painel). */
export const REVERSAL_WINDOW_DAYS = 15

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

const optText = (max: number) => z.string().max(max).nullish()

/** Lançamento novo feito pelo painel. */
const newTx = z.looseObject({
  id: txId,
  at: z
    .string('Data inválida.')
    .max(40, 'Data inválida.')
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Data inválida.'),
  playerId: z.string('Jogador inválido.').min(1, 'Jogador inválido.').max(64, 'Jogador inválido.'),
  playerName: z.string('Nome do jogador inválido.').max(200, 'Nome do jogador longo demais.'),
  playerEmail: z.string('E-mail do jogador inválido.').max(200, 'E-mail do jogador longo demais.'),
  type: z.enum(['credito_manual', 'debito_manual', 'estorno'], { error: 'Tipo de lançamento inválido.' }),
  amount: z.number('Valor inválido.').refine(twoDecimals, 'Use no máximo duas casas decimais.'),
  wallet: z.enum(['real', 'bonus'], { error: 'Carteira inválida.' }),
  balanceBefore: z.number('Saldo anterior inválido.'),
  balanceAfter: z.number('Saldo posterior inválido.'),
  gameId: optText(100),
  gameName: optText(200),
  providerName: optText(200),
  reference: z.string('Referência inválida.').min(1, 'Informe a referência.').max(100, 'Referência longa demais.'),
  note: z.string('Motivo inválido.').max(500, 'Motivo com mais de 500 caracteres.').optional(),
  by: z.string('Autor inválido.').max(200, 'Autor inválido.').optional(),
})

type NewTx = z.infer<typeof newTx>

function notAllowed(message: string, details: unknown) {
  return new AppError(403, 'campo_nao_permitido', message, details)
}

const clipIds = (ids: string[]) => ids.slice(0, 20)
const walletLabel = (w: string) => (w === 'bonus' ? 'bônus' : 'real')

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
  const at = typeof orig.at === 'string' ? Date.parse(orig.at) : Number.NaN
  if (!Number.isNaN(at) && now - at > REVERSAL_WINDOW_DAYS * 86_400_000) {
    throw fail(`passou o prazo de ${REVERSAL_WINDOW_DAYS} dias. Use um ajuste manual na ficha do jogador.`)
  }
  reversedNow.add(origId)
}

function auditFor(tx: NewTx): { action: AuditAction; summary: string } {
  const note = tx.note?.trim() ? ` — ${tx.note.trim().slice(0, 200)}` : ''
  if (tx.type === 'estorno') {
    return {
      action: 'estornar',
      summary: `Estorno de ${brl(tx.amount)} (carteira ${walletLabel(tx.wallet)}) da transação ${tx.reference.slice(4)} do jogador ${tx.playerId} · ${tx.id}${note}`,
    }
  }
  const what = tx.type === 'credito_manual' ? 'Creditação' : 'Subtração'
  return {
    action: 'creditar',
    summary: `${what} de ${brl(Math.abs(tx.amount))} na carteira ${walletLabel(tx.wallet)} do jogador ${tx.playerId} · ${tx.id}${note}`,
  }
}

export const kvHandlers: KvHandlers = {
  transactions: {
    read: (ctx) => genericHandler.read(ctx),

    async write(ctx: KvContext, value: unknown, expectedVersion: number | undefined): Promise<KvValue> {
      const { app, auth, key, rule } = ctx
      if (!canWriteKey(rule, auth.perms)) throw Errors.forbidden()
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

        if (stored === MISSING) {
          // primeira gravação: o extrato inteiro vira a base
          list.forEach((tx) => baseTx.parse(tx))
          const saved = await saveRow(t, app.cipher, key, list, false, row, auth.user.id)
          await writeAudit(t, auth, {
            action: 'editar',
            entity,
            summary: `${key} — Base inicial do extrato com ${list.length} ${list.length === 1 ? 'transação' : 'transações'}`,
          })
          return { value: list, version: saved.version, updatedAt: saved.updatedAt }
        }

        const storedList = (Array.isArray(stored) ? stored : []).filter(isPlainObject)
        const storedById = new Map<string, JsonObject>()
        for (const tx of storedList) if (typeof tx.id === 'string') storedById.set(tx.id, tx)
        const incomingById = new Map(list.map((tx) => [tx.id as string, tx]))

        // só inclusão: o que já está gravado volta igual
        const removed: string[] = []
        const changed: string[] = []
        for (const [id, old] of storedById) {
          const now = incomingById.get(id)
          if (!now) removed.push(id)
          else if (!deepEqual(old, now)) changed.push(id)
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

        const saved = await saveRow(t, app.cipher, key, list, false, row, auth.user.id)
        if (parsed.length) {
          for (const tx of parsed) await writeAudit(t, auth, { entity, ...auditFor(tx) })
        } else {
          await writeAudit(t, auth, { action: 'editar', entity, summary: `${key} — Extrato salvo sem lançamentos novos` })
        }
        return { value: list, version: saved.version, updatedAt: saved.updatedAt }
      })
    },
  },
}

function isPanelTxType(type: string) {
  return Object.prototype.hasOwnProperty.call(NEW_TX_PERMISSION, type)
}
