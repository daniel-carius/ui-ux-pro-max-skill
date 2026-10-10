// Chaves campanhas.webhooks.destinos (endereços e segredos cifrados) e campanhas.webhooks.execucoes (leitura).
import { z } from 'zod'
import { canReadKey, canWriteKey } from '@shared/kv-registry'
import { PAGE_INFO_BY_ID } from '@shared/pages'
import type { Db } from '../../db'
import { AppError, Errors } from '../../errors'
import { randomToken, type Cipher } from '../../lib/crypto'
import { isMasked, maskSecret, maskUrlTokens, SECRET_MASK_RE } from '../../lib/mask'
import type { KvContext, KvHandlers, KvValue } from '../../kv/types'
import { writeAudit } from '../../services/audit'
import { readSnapshot } from '../team/service'
import {
  DEMO_SECRET_PATTERN,
  hostOf,
  isDemoWebhookHost,
  WEBHOOK_EVENT_LABEL,
  WEBHOOK_EVENTS,
  webhookStrictMode,
  webhookUrlProblem,
  type WebhookEvent,
} from './url'

/** Linha de settings com a versão da lista de destinos ({ version }). */
export const DESTINATIONS_VERSION_KEY = 'campanhas.webhooks.destinos'
export const MAX_DESTINATIONS = 100
export const EXECUTIONS_KV_LIMIT = 1000
const MIN_SECRET_LENGTH = 8

/** Motivos gravados nas entregas pendentes que deixam de sair quando o destino muda ou é excluído. */
export const OUTBOX_CANCEL_REASON = { changed: 'Destino alterado', removed: 'Destino removido' } as const

export interface DestinationRow {
  id: string
  event: WebhookEvent
  /** endereço em claro: só linha gravada antes da migração 003, até a subida da API cifrá-la */
  url: string | null
  /** endereço cifrado (AES-256-GCM): pode ter token no caminho ou na query */
  url_enc: string | null
  /** só o host fica em claro */
  host: string | null
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

/** Endereço completo do destino (lança se a cifra não abrir). */
export function destinationUrl(r: Pick<DestinationRow, 'url' | 'url_enc'>, cipher: Cipher): string {
  if (r.url_enc) return cipher.decrypt(r.url_enc)
  return r.url ?? ''
}

/** Endereço completo, ou null se a cifra não abrir (chave trocada). */
export function safeDestinationUrl(r: Pick<DestinationRow, 'url' | 'url_enc'>, cipher: Cipher): string | null {
  try {
    return destinationUrl(r, cipher)
  } catch {
    return null
  }
}

/** Host do destino (coluna em claro; linha antiga: tirado do endereço). */
export function destinationHost(r: Pick<DestinationRow, 'url' | 'host'>): string {
  return r.host ?? (r.url ? hostOf(r.url) : '(endereço inválido)')
}

export function toPanelExecution(r: ExecutionRow) {
  return {
    id: r.id,
    at: r.at,
    event: r.event,
    destinationId: r.destination_id ?? '',
    // gravada já mascarada; a máscara de novo cobre linhas antigas (idempotente)
    url: maskUrlTokens(r.url),
    status: r.status,
    httpStatus: r.http_status ?? 0,
    durationMs: r.duration_ms ?? 0,
    payload: r.payload,
    test: r.test,
  }
}

function safeMaskedSecret(cipher: Cipher, enc: string) {
  try {
    return maskSecret(cipher.decrypt(enc))
  } catch {
    return maskSecret('????')
  }
}

export function toPanelDestination(r: DestinationRow, cipher: Cipher) {
  return { id: r.id, event: r.event, url: safeDestinationUrl(r, cipher) ?? '', active: r.active, secret: safeMaskedSecret(cipher, r.secret_enc), createdAt: r.created_at }
}

/**
 * Cifra os endereços gravados em claro antes da migração 003 (SQL não cifra). Roda na subida da API; não muda
 * versão nem data. Devolve quantos.
 */
export async function encryptPlainDestinationUrls(db: Db, cipher: Cipher): Promise<number> {
  const rows = await db.query<{ id: string; url: string }>('select id, url from webhook_destinations where url is not null and url_enc is null')
  let n = 0
  for (const r of rows) {
    const done = await db.query(
      `update webhook_destinations set url = null, url_enc = $3, host = $4 where id = $1 and url = $2 and url_enc is null returning id`,
      [r.id, r.url, cipher.encrypt(r.url), hostOf(r.url)],
    )
    n += done.length
  }
  return n
}

/** Mascara os tokens das URLs de execuções gravadas antes de a gravação já mascarar. Devolve quantas. */
export async function maskPlainExecutionUrls(db: Db): Promise<number> {
  // só as que podem ter token (query, âncora, usuário ou trecho longo no caminho) e ainda sem máscara
  const rows = await db.query<{ id: string; url: string }>(
    `select id, url from webhook_executions where url ~ '[?#@]|/[^/?#]{10,}' and url not like '%****%'`,
  )
  let n = 0
  for (const r of rows) {
    const masked = maskUrlTokens(r.url)
    if (masked === r.url) continue
    const done = await db.query('update webhook_executions set url = $3 where id = $1 and url = $2 returning id', [r.id, r.url, masked])
    n += done.length
  }
  return n
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

/**
 * Lista e versão. Chamar numa foto só (readSnapshot) ou dentro da transação que grava com a versão travada: versão
 * e lista precisam ser do mesmo instante (veja readSnapshot).
 */
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

/** Origem (esquema + host + porta) do endereço: o segredo mantido fica preso a ela. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

const FIELD_LABEL = { event: 'evento', url: 'endereço', active: 'ativo', secret: 'segredo' } as const

const pendingLabel = (n: number) => (n === 1 ? '1 entrega pendente cancelada' : `${n} entregas pendentes canceladas`)

/** Marca como 'falhou' as entregas pendentes dos destinos (elas não seguem o endereço/evento novo). */
async function cancelPending(t: Db, ids: string[], reason: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!ids.length) return out
  const rows = await t.query<{ destination_id: string }>(
    `update webhook_outbox set status = 'falhou', last_error = $2 where destination_id = any($1::text[]) and status = 'pendente' returning destination_id`,
    [ids, reason],
  )
  for (const r of rows) out.set(r.destination_id, (out.get(r.destination_id) ?? 0) + 1)
  return out
}

interface Plan {
  d: z.infer<typeof destinationSchema>
  url: string
  old: DestinationRow | undefined
  oldUrl: string | null
  /** segredo novo digitado (null = mantém o gravado ou gera um, se o destino é novo) */
  secret: string | null
  /** endereço ou evento mudou: o que estava na fila não sai mais */
  rerouted: boolean
}

export const kvHandlers: KvHandlers = {
  'webhook-destinations': {
    async read(ctx) {
      if (!canReadKey(ctx.rule, ctx.auth.perms)) throw Errors.forbidden()
      // versão e lista do mesmo instante: salvar a partir desta leitura nunca desfaz em silêncio a gravação de outra pessoa
      return readSnapshot(ctx.app.db, (t) => readDestinations(ctx, t))
    },

    async write(ctx, value, expectedVersion) {
      if (!canWriteKey(ctx.rule, ctx.auth.perms)) throw Errors.forbidden()
      // versão sempre obrigatória, inclusive na primeira gravação (a leitura de uma instalação nova devolve 0).
      // Gravação sem versão é a de quem não conseguiu ler a lista (o painel mostrou o padrão de demonstração
      // depois de uma leitura que falhou): 409 faz o painel recarregar a lista real antes de qualquer validação.
      if (expectedVersion === undefined) {
        const v = await ctx.app.db.one<{ value: { version?: number } }>('select value from settings where key = $1', [DESTINATIONS_VERSION_KEY])
        throw versionConflict(Number(v?.value?.version ?? 0))
      }
      const list = listSchema.parse(value)
      // modo estrito salvo liberação explícita (não depende de NODE_ENV=production)
      const strict = webhookStrictMode(ctx.app.config)
      const seen = new Set<string>()
      for (const d of list) {
        if (seen.has(d.id)) throw Errors.invalid(`Destino repetido na lista (${d.id}).`)
        seen.add(d.id)
        const problem = webhookUrlProblem(d.url, strict)
        if (problem) throw Errors.invalid(`${WEBHOOK_EVENT_LABEL[d.event]}: ${problem}`, { id: d.id, field: 'url' })
        const s = d.secret?.trim()
        if (!s) continue
        // só a máscara no formato emitido pelo servidor pode valer como "mantém"; outro texto com *** ou • não é segredo
        if (isMasked(s)) {
          if (!SECRET_MASK_RE.test(s)) throw maskedSecretInvalid(d.id)
          continue
        }
        if (s.length < MIN_SECRET_LENGTH) {
          throw Errors.invalid(`O segredo precisa de pelo menos ${MIN_SECRET_LENGTH} caracteres.`, { id: d.id, field: 'secret' })
        }
        // segredo de demonstração: público no bundle do painel (qualquer um forjaria a assinatura)
        if (DEMO_SECRET_PATTERN.test(s)) {
          throw Errors.invalid('Este é um segredo de demonstração. Gere um segredo novo para o destino.', { id: d.id, field: 'secret' })
        }
      }

      return ctx.app.db.tx(async (t) => {
        // garante a linha de versão e a trava até o fim (gravações concorrentes esperam)
        await t.query(`insert into settings (key, value) values ($1, '{"version":0}'::jsonb) on conflict (key) do nothing`, [DESTINATIONS_VERSION_KEY])
        const vrow = await t.one<{ value: { version?: number } }>('select value from settings where key = $1 for update', [DESTINATIONS_VERSION_KEY])
        const current = Number(vrow?.value?.version ?? 0)
        const rows = await t.query<DestinationRow>('select * from webhook_destinations order by created_at asc, id asc')
        // a versão precisa ser exatamente a atual (0 numa instalação nova)
        if (expectedVersion !== current) throw versionConflict(current)

        // 1) decide tudo antes de gravar (erros saem sem nada pela metade)
        const byId = new Map(rows.map((r) => [r.id, r]))
        const plans: Plan[] = []
        for (const d of list) {
          const url = d.url.trim()
          const old = byId.get(d.id)
          const oldUrl = old ? safeDestinationUrl(old, ctx.app.cipher) : null
          // destino novo ou endereço trocado para um host de demonstração (terceiro): recusa
          if ((!old || oldUrl !== url) && isDemoWebhookHost(url)) {
            throw Errors.invalid(
              `${WEBHOOK_EVENT_LABEL[d.event]}: ${hostOf(url)} é um endereço de demonstração, não um destino da operação.`,
              { id: d.id, field: 'url' },
            )
          }
          const incoming = d.secret?.trim() ?? ''
          // mantém o segredo gravado só com o campo vazio ou com EXATAMENTE a máscara que a leitura emite para ele
          const keep = !incoming || (!!old && incoming === safeMaskedSecret(ctx.app.cipher, old.secret_enc))
          if (!keep && isMasked(incoming)) throw maskedSecretInvalid(d.id)
          const rerouted = !!old && (old.event !== d.event || oldUrl !== url)
          // segredo mantido fica preso ao destino: outra origem (esquema, host, porta) ou outro evento pede segredo novo
          if (old && keep && (old.event !== d.event || oldUrl === null || originOf(oldUrl) !== originOf(url))) {
            throw Errors.invalid('O destino mudou: digite um novo segredo.', { id: d.id, field: 'secret' })
          }
          plans.push({ d, url, old, oldUrl, secret: keep ? null : incoming, rerouted })
        }
        const removed = rows.filter((r) => !seen.has(r.id))

        // 2) trava os destinos que mudam de endereço/evento ou saem, na ordem do id (a mesma de enqueueWebhook, que
        // os lê com FOR KEY SHARE): uma ação que enfileira ao mesmo tempo espera ou é esperada, sem impasse, e nenhuma
        // entrega enfileirada antes da troca fica pendente para seguir o endereço novo
        const reroutedIds = plans.filter((p) => p.rerouted).map((p) => p.d.id)
        const removedIds = removed.map((r) => r.id)
        if (reroutedIds.length || removedIds.length) {
          await t.query('select id from webhook_destinations where id = any($1::text[]) order by id for update', [[...reroutedIds, ...removedIds]])
        }
        const cancelledChanged = await cancelPending(t, reroutedIds, OUTBOX_CANCEL_REASON.changed)
        const cancelledRemoved = await cancelPending(t, removedIds, OUTBOX_CANCEL_REASON.removed)

        // 3) grava
        const created: string[] = []
        const changed: string[] = []
        for (const { d, url, old, oldUrl, secret, rerouted } of plans) {
          if (!old) {
            await t.query(
              `insert into webhook_destinations (id, event, url, url_enc, host, active, secret_enc) values ($1, $2, null, $3, $4, $5, $6)`,
              [d.id, d.event, ctx.app.cipher.encrypt(url), hostOf(url), d.active, ctx.app.cipher.encrypt(secret ?? randomToken(24))],
            )
            created.push(`${d.id} (${WEBHOOK_EVENT_LABEL[d.event]} → ${hostOf(url)})`)
            continue
          }
          const fields: string[] = []
          if (old.event !== d.event) fields.push(`${FIELD_LABEL.event} ${WEBHOOK_EVENT_LABEL[old.event] ?? old.event} → ${WEBHOOK_EVENT_LABEL[d.event]}`)
          if (oldUrl !== url) {
            const before = destinationHost(old)
            fields.push(before === hostOf(url) ? FIELD_LABEL.url : `${FIELD_LABEL.url} ${before} → ${hostOf(url)}`)
          }
          if (old.active !== d.active) fields.push(FIELD_LABEL.active)
          let secretEnc = old.secret_enc
          if (secret !== null) {
            let same = false
            try {
              same = ctx.app.cipher.decrypt(old.secret_enc) === secret
            } catch {
              same = false
            }
            if (!same) {
              secretEnc = ctx.app.cipher.encrypt(secret)
              fields.push(FIELD_LABEL.secret)
            }
          }
          // linha antiga ainda com o endereço em claro: cifra junto
          if (!fields.length && old.url_enc) continue
          const urlEnc = oldUrl === url && old.url_enc ? old.url_enc : ctx.app.cipher.encrypt(url)
          await t.query(
            `update webhook_destinations set event = $2, url = null, url_enc = $3, host = $4, active = $5, secret_enc = $6, updated_at = now() where id = $1`,
            [d.id, d.event, urlEnc, hostOf(url), d.active, secretEnc],
          )
          if (!fields.length) continue
          const n = rerouted ? cancelledChanged.get(d.id) ?? 0 : 0
          changed.push(`${d.id} (${fields.join(', ')}${n ? `; ${pendingLabel(n)}` : ''})`)
        }
        if (removedIds.length) await t.query('delete from webhook_destinations where id = any($1::text[])', [removedIds])

        const next = current + 1
        await t.query(`update settings set value = $2::jsonb, updated_at = now(), updated_by = $3 where key = $1`, [
          DESTINATIONS_VERSION_KEY,
          JSON.stringify({ version: next }),
          ctx.auth.user.id,
        ])
        const removedLabel = (r: DestinationRow) => {
          const n = cancelledRemoved.get(r.id) ?? 0
          return `${r.id} (${WEBHOOK_EVENT_LABEL[r.event] ?? r.event} → ${destinationHost(r)}${n ? `; ${pendingLabel(n)}` : ''})`
        }
        const parts = [
          created.length ? `Incluídos: ${created.join('; ')}` : '',
          changed.length ? `Alterados: ${changed.join('; ')}` : '',
          removed.length ? `Removidos: ${removed.map(removedLabel).join('; ')}` : '',
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

function maskedSecretInvalid(id: string) {
  return Errors.invalid('O segredo contém caracteres de máscara (*** ou •) e não é a máscara atual. Digite o segredo completo, sem esses caracteres.', {
    id,
    field: 'secret',
  })
}
