// Domínio 'players' (geral.jogadores): lista de jogadores cifrada em repouso,
// lida com dados pessoais mascarados (a rota aplica a máscara) e gravada por
// diferença, comparando por id com o gravado:
//  - incluir ou remover jogador → 403 campo_nao_permitido (vêm da plataforma);
//  - usuarios.editar muda tags, status, balanceReal, balanceBonus e coins;
//  - antifraude.banir muda status;
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
import { deepEqual, hasOwn, isPlainObject, MISSING, type JsonObject } from './json'
import { restoreMasked, writePolicy } from './redact'
import { assertVersion, loadRow, saveRow, storedValue } from './store'

export const MAX_PLAYERS = 100_000
export const PLAYER_STATUSES = ['ativo', 'bloqueado', 'autoexcluido', 'pausa'] as const

/** Campos que cada permissão pode mudar num jogador já gravado. */
export const PLAYER_FIELD_POLICY: Record<string, readonly string[]> = {
  'usuarios.editar': ['tags', 'status', 'balanceReal', 'balanceBonus', 'coins'],
  'antifraude.banir': ['status'],
}

const FIELD_LABEL: Record<string, string> = {
  status: 'status',
  tags: 'etiquetas',
  balanceReal: 'saldo real',
  balanceBonus: 'saldo bônus',
  coins: 'moedas',
}

const twoDecimals = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6

const money = z
  .number('Saldo inválido.')
  .min(0, 'O saldo não pode ser negativo.')
  .max(1_000_000_000, 'Saldo acima do permitido.')
  .refine(twoDecimals, 'Use no máximo duas casas decimais no saldo.')

/** Validação dos campos editáveis (só quando mudam). */
const FIELD_SCHEMA: Record<string, z.ZodType> = {
  status: z.enum(PLAYER_STATUSES, { error: 'Status de jogador inválido.' }),
  tags: z
    .array(z.string('Etiqueta inválida.').min(1, 'Etiqueta vazia.').max(40, 'Etiqueta com mais de 40 caracteres.'), 'Etiquetas inválidas.')
    .max(50, 'No máximo 50 etiquetas por jogador.'),
  balanceReal: money,
  balanceBonus: money,
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
        await writeAudit(t, auth, { action: 'editar', entity: auditEntity(rule.page), summary: `${key} — ${summary}` })
        return { value: next, version: saved.version, updatedAt: saved.updatedAt }
      })
    },
  },
}
