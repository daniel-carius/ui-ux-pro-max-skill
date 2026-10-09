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
//  - jogador autoexcluído não recebe moedas;
//  - qualquer outro campo alterado → 403 campo_nao_permitido (details.fields);
//  - primeira gravação (nada gravado) aceita a lista inteira como base.
// Dados pessoais que voltam mascarados são restaurados do gravado.
import { z } from 'zod'
import { canWriteKey } from '@shared/kv-registry'
import { brl } from '@shared/money'
import { AppError, Errors } from '../../errors'
import type { KvContext, KvHandlers, KvValue } from '../../kv/types'
import { writeAudit } from '../../services/audit'
import { auditEntity, genericHandler } from './generic'
import { deepEqual, hasOwn, isPlainObject, MISSING, setOwn, type JsonObject } from './json'
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

        if (stored === MISSING) {
          // primeira gravação: a lista inteira vira a base (máscaras sem valor gravado são recusadas)
          const next = restoreMasked(list, MISSING, writePolicy(rule))
          const saved = await saveRow(t, app.cipher, key, next, true, row, auth.user.id)
          summary = `Base inicial com ${list.length} ${list.length === 1 ? 'jogador' : 'jogadores'}`
          await writeAudit(t, auth, { action: 'editar', entity: auditEntity(rule.page), summary: `${key} — ${summary}` })
          return { value: next, version: saved.version, updatedAt: saved.updatedAt }
        }

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
        await writeAudit(t, auth, { action: 'editar', entity: auditEntity(rule.page), summary: `${key} — ${summary}` })
        return { value: next, version: saved.version, updatedAt: saved.updatedAt }
      })
    },
  },
}
