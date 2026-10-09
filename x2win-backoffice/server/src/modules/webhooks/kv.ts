// Chaves campanhas.webhooks.destinos (segredos cifrados) e campanhas.webhooks.execucoes (leitura).
import { z } from 'zod'
import { canReadKey, canWriteKey } from '@shared/kv-registry'
import { PAGE_INFO_BY_ID } from '@shared/pages'
import type { Db } from '../../db'
import { AppError, Errors } from '../../errors'
import { randomToken } from '../../lib/crypto'
import { isMasked, maskSecret } from '../../lib/mask'
import type { KvContext, KvHandlers, KvValue } from '../../kv/types'
import { writeAudit } from '../../services/audit'
import { hostOf, WEBHOOK_EVENT_LABEL, WEBHOOK_EVENTS, webhookUrlProblem, type WebhookEvent } from './url'

/** Linha de settings com a versão da lista de destinos ({ version }). */
export const DESTINATIONS_VERSION_KEY = 'campanhas.webhooks.destinos'
export const MAX_DESTINATIONS = 100
export const EXECUTIONS_KV_LIMIT = 1000
const MIN_SECRET_LENGTH = 8

export interface DestinationRow {
  id: string
  event: WebhookEvent
  url: string
  active: boolean
  secret_enc: string
  created_at: string
  updated_at: string
}

export interface ExecutionRow {
  id: string
  at: string
  event: string
  destination_id: string | null
  url: string
  status: 'sucesso' | 'falha'
  http_status: number | null
  duration_ms: number | null
  payload: string
  test: boolean
}

export function toPanelExecution(r: ExecutionRow) {
  return {
    id: r.id,
    at: r.at,
    event: r.event,
    destinationId: r.destination_id ?? '',
    url: r.url,
    status: r.status,
    httpStatus: r.http_status ?? 0,
    durationMs: r.duration_ms ?? 0,
    payload: r.payload,
    test: r.test,
  }
}

function safeMaskedSecret(cipher: KvContext['app']['cipher'], enc: string) {
  try {
    return maskSecret(cipher.decrypt(enc))
  } catch {
    return maskSecret('????')
  }
}

export function toPanelDestination(r: DestinationRow, cipher: KvContext['app']['cipher']) {
  return { id: r.id, event: r.event, url: r.url, active: r.active, secret: safeMaskedSecret(cipher, r.secret_enc), createdAt: r.created_at }
}

const destinationSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Identificador de destino inválido.'),
  event: z.enum(WEBHOOK_EVENTS, { error: 'Evento de webhook inválido.' }),
  url: z.string().max(2000),
  active: z.boolean(),
  secret: z.string().max(500).nullish(),
  createdAt: z.string().nullish(),
})

const listSchema = z.array(destinationSchema).max(MAX_DESTINATIONS, `No máximo ${MAX_DESTINATIONS} destinos.`)

function versionConflict(current: number) {
  return new AppError(409, 'versao_desatualizada', 'Outra pessoa salvou estes dados antes de você. Recarregue a tela e tente de novo.', {
    version: current,
  })
}

async function readDestinations(ctx: KvContext, db: Db): Promise<KvValue> {
  const rows = await db.query<DestinationRow>('select * from webhook_destinations order by created_at asc, id asc')
  const settings = await db.one<{ value: { version?: number }; updated_at: string }>('select value, updated_at from settings where key = $1', [
    DESTINATIONS_VERSION_KEY,
  ])
  const updatedAt = rows.reduce<string | null>((max, r) => (!max || r.updated_at > max ? r.updated_at : max), settings?.updated_at ?? null)
  return {
    value: rows.map((r) => toPanelDestination(r, ctx.app.cipher)),
    version: Number(settings?.value?.version ?? 0),
    updatedAt,
  }
}

const FIELD_LABEL = { event: 'evento', url: 'endereço', active: 'ativo', secret: 'segredo' } as const

export const kvHandlers: KvHandlers = {
  'webhook-destinations': {
    async read(ctx) {
      if (!canReadKey(ctx.rule, ctx.auth.perms)) throw Errors.forbidden()
      return readDestinations(ctx, ctx.app.db)
    },

    async write(ctx, value, expectedVersion) {
      if (!canWriteKey(ctx.rule, ctx.auth.perms)) throw Errors.forbidden()
      const list = listSchema.parse(value)
      const production = ctx.app.config.NODE_ENV === 'production'
      const seen = new Set<string>()
      for (const d of list) {
        if (seen.has(d.id)) throw Errors.invalid(`Destino repetido na lista (${d.id}).`)
        seen.add(d.id)
        const problem = webhookUrlProblem(d.url, production)
        if (problem) throw Errors.invalid(`${WEBHOOK_EVENT_LABEL[d.event]}: ${problem}`, { id: d.id, field: 'url' })
        const s = d.secret?.trim()
        if (s && !isMasked(s) && s.length < MIN_SECRET_LENGTH) {
          throw Errors.invalid(`O segredo precisa de pelo menos ${MIN_SECRET_LENGTH} caracteres.`, { id: d.id, field: 'secret' })
        }
      }

      return ctx.app.db.tx(async (t) => {
        // garante a linha de versão e a trava até o fim (gravações concorrentes esperam)
        await t.query(`insert into settings (key, value) values ($1, '{"version":0}'::jsonb) on conflict (key) do nothing`, [DESTINATIONS_VERSION_KEY])
        const vrow = await t.one<{ value: { version?: number } }>('select value from settings where key = $1 for update', [DESTINATIONS_VERSION_KEY])
        const current = Number(vrow?.value?.version ?? 0)
        const rows = await t.query<DestinationRow>('select * from webhook_destinations order by created_at asc, id asc')
        const exists = current > 0 || rows.length > 0
        if (exists && expectedVersion !== current) throw versionConflict(current)

        const byId = new Map(rows.map((r) => [r.id, r]))
        const created: string[] = []
        const changed: string[] = []
        for (const d of list) {
          const url = d.url.trim()
          const incoming = d.secret?.trim() ?? ''
          const keepSecret = !incoming || isMasked(incoming)
          const old = byId.get(d.id)
          if (!old) {
            const secret = keepSecret ? randomToken(24) : incoming
            await t.query(
              `insert into webhook_destinations (id, event, url, active, secret_enc) values ($1, $2, $3, $4, $5)`,
              [d.id, d.event, url, d.active, ctx.app.cipher.encrypt(secret)],
            )
            created.push(`${d.id} (${WEBHOOK_EVENT_LABEL[d.event]} → ${hostOf(url)})`)
            continue
          }
          const fields: string[] = []
          if (old.event !== d.event) fields.push(FIELD_LABEL.event)
          if (old.url !== url) fields.push(FIELD_LABEL.url)
          if (old.active !== d.active) fields.push(FIELD_LABEL.active)
          let secretEnc = old.secret_enc
          if (!keepSecret) {
            let same = false
            try {
              same = ctx.app.cipher.decrypt(old.secret_enc) === incoming
            } catch {
              same = false
            }
            if (!same) {
              secretEnc = ctx.app.cipher.encrypt(incoming)
              fields.push(FIELD_LABEL.secret)
            }
          }
          if (!fields.length) continue
          await t.query(
            `update webhook_destinations set event = $2, url = $3, active = $4, secret_enc = $5, updated_at = now() where id = $1`,
            [d.id, d.event, url, d.active, secretEnc],
          )
          changed.push(`${d.id} (${fields.join(', ')})`)
        }
        const removed = rows.filter((r) => !seen.has(r.id))
        if (removed.length) {
          await t.query('delete from webhook_destinations where id = any($1::text[])', [removed.map((r) => r.id)])
        }

        const next = current + 1
        await t.query(`update settings set value = $2::jsonb, updated_at = now(), updated_by = $3 where key = $1`, [
          DESTINATIONS_VERSION_KEY,
          JSON.stringify({ version: next }),
          ctx.auth.user.id,
        ])
        const parts = [
          created.length ? `Incluídos: ${created.join('; ')}` : '',
          changed.length ? `Alterados: ${changed.join('; ')}` : '',
          removed.length ? `Removidos: ${removed.map((r) => `${r.id} (${WEBHOOK_EVENT_LABEL[r.event] ?? r.event})`).join('; ')}` : '',
        ].filter(Boolean)
        await writeAudit(t, ctx.auth, {
          action: 'editar',
          entity: `Dados · ${PAGE_INFO_BY_ID.get(ctx.rule.page)?.title ?? 'Webhooks'}`,
          summary: parts.length ? `Destinos de webhook. ${parts.join('. ')}` : 'Destinos de webhook salvos sem alterações',
        })
        return readDestinations(ctx, t)
      })
    },
  },

  'webhook-executions': {
    async read(ctx) {
      if (!canReadKey(ctx.rule, ctx.auth.perms)) throw Errors.forbidden()
      const rows = await ctx.app.db.query<ExecutionRow>('select * from webhook_executions order by at desc, id desc limit $1', [EXECUTIONS_KV_LIMIT])
      return { value: rows.map(toPanelExecution), version: 1, updatedAt: rows[0]?.at ?? null }
    },
  },
}
