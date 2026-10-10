// Domínio 'players' (geral.jogadores): lista de jogadores cifrada em repouso,
// lida com dados pessoais mascarados (a rota aplica a máscara) e gravada por
// diferença, comparando por id com o gravado:
//  - incluir ou remover jogador → 403 campo_nao_permitido (vêm da plataforma);
//  - usuarios.editar muda tags, status e coins;
//  - antifraude.banir muda status;
//  - saldos (balanceReal, balanceBonus) são do servidor: só mudam por lançamento
//    no extrato (transactions.ts, na mesma transação); o valor enviado é ignorado;
//  - status segue as regras de jogo responsável (player-status.ts): autoexclusão
//    não muda pelo painel, pausa pedida pelo jogador só termina no prazo, e cada
//    permissão só faz as transições dela → 403 transicao_nao_permitida;
//  - conta de uma rede banida (seguranca.bloqueios) não sai do bloqueio enquanto o
//    banimento da rede valer → 409 rede_banida (desfazer em Anti-fraude › Bloqueios);
//  - jogador autoexcluído não recebe moedas;
//  - qualquer outro campo alterado → 403 campo_nao_permitido (details.fields);
//  - nada gravado = lista vazia: a gravação pela tela nunca cria a base (o painel
//    não manda mais dados de demonstração como base de produção).
// Dados pessoais que voltam mascarados são restaurados do gravado.
//
// Jogadores entram pela plataforma, ou pela importação explícita
// POST /api/kv/geral.jogadores/import { players } — só Superadmin com 2FA ativo;
// valida os campos, recusa ids já gravados e dados mascarados, e audita quem importou.
// Correção de base (dados de demonstração gravados por engano, pedido do titular
// pela LGPD art. 18): POST /api/kv/geral.jogadores/remove { ids, reason } — mesma
// exigência; o extrato (geral.transacoes) não muda e a remoção fica na auditoria.
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { canWriteKey, findKvRule, KV_BODY_LIMIT } from '@shared/kv-registry'
import { brl } from '@shared/money'
import { SUPERADMIN_ROLE_ID } from '@shared/permissions'
import { AppError, Errors } from '../../errors'
import { requireActive } from '../../http'
import type { KvContext, KvHandlers, KvValue } from '../../kv/types'
import { writeAudit } from '../../services/audit'
import { auditEntity, auditSummary, genericHandler } from './generic'
import { deepEqual, hasOwn, isPlainObject, MISSING, setOwn, type JsonObject } from './json'
import { bannedNetworks } from './payout-guards'
import { applyPauseRules, checkTransition, PAUSES_KEY, PLAYER_STATUSES, PLAYERS_KEY, STATUS_HISTORY_KEY, toPauseStore } from './player-status'
import { restoreMasked, writePolicy } from './redact'
import { assertVersion, loadRow, saveRow, storedValue } from './store'

export { PLAYER_STATUSES }
export const MAX_PLAYERS = 100_000

/** Campos que cada permissão pode mudar num jogador já gravado. */
export const PLAYER_FIELD_POLICY: Record<string, readonly string[]> = {
  'usuarios.editar': ['tags', 'status', 'coins'],
  'antifraude.banir': ['status'],
}

/** Campos do servidor: o valor gravado prevalece (o saldo muda só pelo extrato). */
export const PLAYER_SERVER_FIELDS = ['balanceReal', 'balanceBonus'] as const

const FIELD_LABEL: Record<string, string> = {
  status: 'status',
  tags: 'etiquetas',
  balanceReal: 'saldo real',
  balanceBonus: 'saldo bônus',
  coins: 'moedas',
}

/** Validação dos campos editáveis (só quando mudam). */
const FIELD_SCHEMA: Record<string, z.ZodType> = {
  status: z.enum(PLAYER_STATUSES, { error: 'Status de jogador inválido.' }),
  tags: z
    .array(z.string('Etiqueta inválida.').min(1, 'Etiqueta vazia.').max(40, 'Etiqueta com mais de 40 caracteres.'), 'Etiquetas inválidas.')
    .max(50, 'No máximo 50 etiquetas por jogador.'),
  coins: z.number('Moedas inválidas.').int('Moedas precisam ser um número inteiro.').min(0, 'Moedas não podem ser negativas.').max(1e12, 'Moedas acima do permitido.'),
}

const playerItem = z.looseObject({
  id: z.string('Jogador sem identificador.').min(1, 'Jogador sem identificador.').max(64, 'Identificador de jogador inválido.'),
})
const playerList = z.array(playerItem, 'Envie a lista de jogadores.').max(MAX_PLAYERS, `No máximo ${MAX_PLAYERS} jogadores.`)

function fieldNotAllowed(message: string, details: unknown) {
  return new AppError(403, 'campo_nao_permitido', message, details)
}

/** Campos que a pessoa pode alterar, pelas permissões do cargo. */
export function editablePlayerFields(perms: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  for (const [perm, fields] of Object.entries(PLAYER_FIELD_POLICY)) if (perms.has(perm)) fields.forEach((f) => out.add(f))
  return out
}

function show(field: string, v: unknown): string {
  if (v === undefined) return '—'
  if ((field === 'balanceReal' || field === 'balanceBonus') && typeof v === 'number') return brl(v)
  return typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v)
}

function describeField(field: string, before: unknown, after: unknown): string {
  const label = FIELD_LABEL[field] ?? field
  if (field === 'tags' && Array.isArray(before) && Array.isArray(after)) {
    const b = new Set(before.map(String))
    const a = new Set(after.map(String))
    const plus = [...a].filter((t) => !b.has(t)).map((t) => `+${t}`)
    const minus = [...b].filter((t) => !a.has(t)).map((t) => `−${t}`)
    const parts = [...plus, ...minus]
    return `${label}: ${parts.length ? parts.join(' ') : 'ordem'}`
  }
  return `${label}: ${show(field, before)} → ${show(field, after)}`
}

const clipIds = (ids: string[]) => ids.slice(0, 20)

export const kvHandlers: KvHandlers = {
  players: {
    read: (ctx) => genericHandler.read(ctx),

    async write(ctx: KvContext, value: unknown, expectedVersion: number | undefined): Promise<KvValue> {
      const { app, auth, key, rule } = ctx
      if (!canWriteKey(rule, auth.perms)) throw Errors.forbidden()
      // as regras de status/saldo valem para a lista de jogadores; chave filha não é gravável
      if (key !== PLAYERS_KEY) throw Errors.forbidden('Estes dados não podem ser alterados pela tela.')
      const list = playerList.parse(value) as JsonObject[]
      const ids = list.map((p) => p.id as string)
      const idSet = new Set<string>()
      for (const id of ids) {
        if (idSet.has(id)) throw Errors.invalid(`Jogador repetido na lista (${id}).`, { id })
        idSet.add(id)
      }

      return app.db.tx(async (t) => {
        const row = await loadRow(t, key, true)
        assertVersion(row, expectedVersion)
        const stored = storedValue(row, app.cipher)
        let summary: string

        // nada gravado = lista vazia (incluir jogador pela tela → 403 abaixo)
        const storedList = (Array.isArray(stored) ? stored : []).filter(isPlainObject)
        const oldById = new Map<string, JsonObject>()
        for (const p of storedList) if (typeof p.id === 'string') oldById.set(p.id, p)
        const added = ids.filter((id) => !oldById.has(id))
        const removed = [...oldById.keys()].filter((id) => !idSet.has(id))
        if (added.length || removed.length) {
          throw fieldNotAllowed('Jogadores vêm da plataforma: não é possível incluir nem remover jogadores pelo painel.', {
            fields: [],
            added: clipIds(added),
            removed: clipIds(removed),
          })
        }

        const next = restoreMasked(list, stored, writePolicy(rule)) as JsonObject[]
        // saldos: vale o gravado (o painel manda o saldo junto, às vezes antes do extrato chegar)
        const ignoredBalance: string[] = []
        for (const p of next) {
          const old = oldById.get(p.id as string)!
          let differs = false
          for (const f of PLAYER_SERVER_FIELDS) {
            const before = hasOwn(old, f) ? old[f] : undefined
            const after = hasOwn(p, f) ? p[f] : undefined
            if (deepEqual(before, after)) continue
            differs = true
            if (hasOwn(old, f)) setOwn(p, f, old[f])
            else delete p[f]
          }
          if (differs) ignoredBalance.push(p.id as string)
        }
        const allowed = editablePlayerFields(auth.perms)
        const denied = new Set<string>()
        const deniedPlayers: string[] = []
        const changes: { id: string; fields: string[]; before: JsonObject; after: JsonObject }[] = []
        for (const p of next) {
          const id = p.id as string
          const old = oldById.get(id)!
          const fields = [...new Set([...Object.keys(old), ...Object.keys(p)])].filter(
            (f) => !deepEqual(hasOwn(old, f) ? old[f] : undefined, hasOwn(p, f) ? p[f] : undefined),
          )
          if (!fields.length) continue
          const bad = fields.filter((f) => !allowed.has(f))
          if (bad.length) {
            bad.forEach((f) => denied.add(f))
            deniedPlayers.push(id)
          }
          changes.push({ id, fields, before: old, after: p })
        }
        if (denied.size) {
          const fields = [...denied].sort()
          throw fieldNotAllowed(`Seu cargo não pode alterar: ${fields.join(', ')}.`, { fields, players: clipIds(deniedPlayers) })
        }

        // valida os valores novos dos campos alterados
        for (const c of changes) {
          for (const f of c.fields) {
            const r = FIELD_SCHEMA[f]?.safeParse(c.after[f])
            if (r && !r.success) {
              throw Errors.invalid(`Jogador ${c.id}: ${r.error.issues[0]?.message ?? 'valor inválido'}`, { id: c.id, field: f })
            }
          }
        }

        // jogo responsável: autoexcluído não recebe moedas; status segue as transições e pausas
        for (const c of changes) {
          if (c.before.status === 'autoexcluido' && c.fields.includes('coins')) {
            const b = typeof c.before.coins === 'number' ? c.before.coins : 0
            const a = typeof c.after.coins === 'number' ? c.after.coins : 0
            if (a > b) {
              throw new AppError(403, 'transicao_nao_permitida', `Jogador ${c.id}: jogador autoexcluído não recebe moedas.`, { id: c.id, field: 'coins' })
            }
          }
        }
        const statusChanges = changes.filter((c) => c.fields.includes('status'))
        if (statusChanges.length) {
          const pausesRow = await loadRow(t, PAUSES_KEY, true)
          const pausesStored = storedValue(pausesRow, app.cipher)
          const pauses = toPauseStore(pausesStored === MISSING ? {} : pausesStored)
          const historyRow = await loadRow(t, STATUS_HISTORY_KEY)
          const historyStored = storedValue(historyRow, app.cipher)
          const history = (Array.isArray(historyStored) ? historyStored : []).filter(isPlainObject)
          const now = Date.now()
          const actor = { id: auth.user.id, name: auth.user.name }
          let pausesChanged = false
          for (const c of statusChanges) {
            const to = c.after.status as (typeof PLAYER_STATUSES)[number]
            checkTransition(c.id, c.before.status, to, auth.perms)
            if (applyPauseRules(c.id, c.before.status, to, pauses, history, actor, now)) pausesChanged = true
          }
          // anti-fraude: conta de uma rede banida não sai do bloqueio sozinha. Antes a ficha dizia "volta a sacar
          // normalmente" e a aprovação do saque continuava recusada (payoutHold confere a rede). Desfazer o
          // banimento da rede (Anti-fraude › Bloqueios) remove o bloqueio antes de devolver os status.
          const unblocked = statusChanges.filter((c) => c.before.status === 'bloqueado' && c.after.status !== 'bloqueado')
          if (unblocked.length) {
            const nets = await bannedNetworks(t, app.cipher)
            for (const c of unblocked) {
              const net = nets.get(c.id)
              if (!net) continue
              throw new AppError(
                409,
                'rede_banida',
                `Jogador ${c.id}: a conta faz parte da rede ${net}, banida pelo anti-fraude, e os saques dela continuam recusados. Para liberar, desfaça o banimento da rede em Anti-fraude › Bloqueios.`,
                { id: c.id, network: net },
              )
            }
          }
          if (pausesChanged) await saveRow(t, app.cipher, PAUSES_KEY, pauses, false, pausesRow, auth.user.id)
        }

        const saved = await saveRow(t, app.cipher, key, next, true, row, auth.user.id)
        if (changes.length) {
          const shown = changes
            .slice(0, 20)
            .map((c) => `${c.id} (${c.fields.map((f) => describeField(f, c.before[f], c.after[f])).join(', ')})`)
          const more = changes.length > 20 ? ` e mais ${changes.length - 20}` : ''
          summary = `Jogadores alterados (${changes.length}): ${shown.join('; ')}${more}`
        } else {
          summary = 'Salvo sem alterações'
        }
        if (ignoredBalance.length) {
          summary += `; saldo enviado ignorado (o saldo só muda por lançamento no extrato): ${clipIds(ignoredBalance).join(', ')}`
        }
        await writeAudit(t, auth, { action: 'editar', entity: auditEntity(rule.page), summary: auditSummary(key, summary, row?.version ?? 0, saved.version) })
        return { value: next, version: saved.version, updatedAt: saved.updatedAt }
      })
    },
  },
}

// Importação explícita de jogadores -------------------------------------------------

export const MAX_IMPORT_PLAYERS = 5000

/** Jogador vindo da plataforma (importação e dados de demonstração). */
export const importedPlayer = z.looseObject({
  id: z.string('Jogador sem identificador.').trim().min(1, 'Jogador sem identificador.').max(64, 'Identificador de jogador inválido.'),
  name: z.string('Nome inválido.').trim().min(1, 'Informe o nome do jogador.').max(120, 'Nome com mais de 120 caracteres.'),
  status: z.enum(PLAYER_STATUSES, { error: 'Status de jogador inválido.' }),
  email: z.string('E-mail inválido.').max(254, 'E-mail inválido.').optional(),
  cpf: z.string('CPF inválido.').max(20, 'CPF inválido.').optional(),
  phone: z.string('Telefone inválido.').max(30, 'Telefone inválido.').optional(),
  balanceReal: z.number('Saldo real inválido.').min(0, 'Saldo real não pode ser negativo.').max(1e9, 'Saldo real acima do permitido.').optional(),
  balanceBonus: z.number('Saldo bônus inválido.').min(0, 'Saldo bônus não pode ser negativo.').max(1e9, 'Saldo bônus acima do permitido.').optional(),
  coins: FIELD_SCHEMA.coins.optional(),
  tags: FIELD_SCHEMA.tags.optional(),
})
const importBody = z.object(
  { players: z.array(importedPlayer, 'Envie a lista de jogadores.').min(1, 'Envie pelo menos um jogador.').max(MAX_IMPORT_PLAYERS, `No máximo ${MAX_IMPORT_PLAYERS} jogadores por importação.`) },
  'Envie { players }.',
)

/** Importação de base (jogadores ou extrato): só Superadmin com 2FA ativo. */
export function requireImporter(req: FastifyRequest) {
  const auth = requireActive(req)
  if (auth.role.id !== SUPERADMIN_ROLE_ID || !auth.user.totpEnabled) {
    throw Errors.forbidden('Só o Superadmin com 2FA ativo importa dados da plataforma.')
  }
  return auth
}

const removeBody = z.object(
  {
    ids: z.array(z.string().trim().min(1).max(64), 'Envie os jogadores a remover.').min(1, 'Envie pelo menos um jogador.').max(MAX_IMPORT_PLAYERS, `No máximo ${MAX_IMPORT_PLAYERS} por vez.`),
    reason: z.string('Informe o motivo.').trim().min(3, 'O motivo precisa ter pelo menos 3 caracteres.').max(300, 'O motivo pode ter no máximo 300 caracteres.'),
  },
  'Envie { ids, reason }.',
)

export function registerPlayerImportRoute(app: FastifyInstance) {
  app.post(`/${PLAYERS_KEY}/remove`, async (req, reply) => {
    const auth = requireImporter(req)
    const { ids, reason } = removeBody.parse(req.body ?? {})
    const rule = findKvRule(PLAYERS_KEY)!
    const out = await app.db.tx(async (t) => {
      const row = await loadRow(t, PLAYERS_KEY, true)
      if (!row) throw Errors.notFound('Jogador')
      const stored = storedValue(row, app.cipher)
      const current = (Array.isArray(stored) ? stored : []).filter(isPlainObject)
      const wanted = new Set(ids)
      const found = current.filter((p) => wanted.has(String(p.id))).map((p) => String(p.id))
      const missing = ids.filter((id) => !found.includes(id))
      if (missing.length) throw Errors.invalid('Estes jogadores não estão na base.', { ids: clipIds(missing) })
      const next = current.filter((p) => !wanted.has(String(p.id)))
      const saved = await saveRow(t, app.cipher, PLAYERS_KEY, next, true, row, auth.user.id)
      await writeAudit(t, auth, {
        action: 'excluir',
        entity: auditEntity(rule.page),
        summary: auditSummary(
          PLAYERS_KEY,
          `${found.length} ${found.length === 1 ? 'jogador removido' : 'jogadores removidos'} da base (${reason}): ${clipIds(found).join(', ')}${found.length > 20 ? ` e mais ${found.length - 20}` : ''}`,
          row.version,
          saved.version,
        ),
      })
      return { removed: found.length, version: saved.version }
    })
    reply.header('cache-control', 'no-store')
    return { ok: true as const, ...out }
  })

  app.post(`/${PLAYERS_KEY}/import`, { bodyLimit: KV_BODY_LIMIT }, async (req, reply) => {
    const auth = requireImporter(req)
    const { players } = importBody.parse(req.body ?? {})
    const rule = findKvRule(PLAYERS_KEY)!
    const out = await app.db.tx(async (t) => {
      const row = await loadRow(t, PLAYERS_KEY, true)
      const stored = storedValue(row, app.cipher)
      const current = (Array.isArray(stored) ? stored : []).filter(isPlainObject)
      const existing = new Set(current.map((p) => String(p.id)))
      const seen = new Set<string>()
      for (const p of players) {
        if (seen.has(p.id)) throw Errors.invalid(`Jogador repetido na importação (${p.id}).`, { id: p.id })
        seen.add(p.id)
      }
      const dup = players.filter((p) => existing.has(p.id)).map((p) => p.id)
      if (dup.length) throw Errors.invalid('Estes jogadores já estão na base.', { ids: clipIds(dup) })
      if (current.length + players.length > MAX_PLAYERS) throw Errors.invalid(`No máximo ${MAX_PLAYERS} jogadores.`)
      // valor mascarado nunca vira dado real
      const imported = restoreMasked(players, MISSING, writePolicy(rule)) as JsonObject[]
      const next = [...current, ...imported]
      const saved = await saveRow(t, app.cipher, PLAYERS_KEY, next, true, row, auth.user.id)
      const real = imported.reduce((s, p) => s + (typeof p.balanceReal === 'number' ? p.balanceReal : 0), 0)
      const bonus = imported.reduce((s, p) => s + (typeof p.balanceBonus === 'number' ? p.balanceBonus : 0), 0)
      const ids = imported.map((p) => String(p.id))
      await writeAudit(t, auth, {
        action: 'criar',
        entity: auditEntity(rule.page),
        summary: auditSummary(
          PLAYERS_KEY,
          `Importação de ${ids.length} ${ids.length === 1 ? 'jogador' : 'jogadores'} da plataforma (saldo real ${brl(real)}, bônus ${brl(bonus)}): ${clipIds(ids).join(', ')}${ids.length > 20 ? ` e mais ${ids.length - 20}` : ''}`,
          row?.version ?? 0,
          saved.version,
        ),
      })
      return { imported: ids.length, version: saved.version }
    })
    reply.header('cache-control', 'no-store')
    return { ok: true as const, ...out }
  })
}
