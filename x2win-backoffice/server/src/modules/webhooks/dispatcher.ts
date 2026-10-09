// Disparador de webhooks: lê a fila (webhook_outbox), envia com assinatura HMAC,
// registra a execução e reagenda falhas com espera crescente.
import http from 'node:http'
import https from 'node:https'
import type { FastifyInstance } from 'fastify'
import type { Db } from '../../db'
import { hmacSha256, newId } from '../../lib/crypto'
import { BLOCKED_PRIVATE_CODE, hostOf, INTERNAL_TARGET_MESSAGE, isWebhookEvent, safeLookup, webhookStrictMode, webhookTargetProblem } from './url'

export const USER_AGENT = 'X2Win-Webhooks/1.0'
export const DELIVERY_TIMEOUT_MS = 5000
export const MAX_ATTEMPTS = 6
export const BATCH_SIZE = 20
export const LOOP_INTERVAL_MS = 2000
/** Reserva do item enquanto o envio acontece (outra instância não pega o mesmo). */
const LEASE_SECONDS = 60

/** Espera até a próxima tentativa: 30 s × 2^tentativas já feitas, no máximo 1 h. */
export function retryDelaySeconds(attemptsBefore: number): number {
  return Math.min(30 * 2 ** Math.max(0, attemptsBefore), 3600)
}

/** Assinatura do corpo: sha256=<HMAC-SHA256(segredo, "<timestamp>.<corpo>")>. */
export function signBody(secret: string, timestamp: number, body: string): string {
  return `sha256=${hmacSha256(secret, `${timestamp}.${body}`)}`
}

export interface DeliveryResult {
  ok: boolean
  httpStatus: number | null
  durationMs: number
  error: string | null
}

/** Mensagens devolvidas ao painel, à auditoria e à fila (sem detalhes de rede de baixo nível). */
export const DELIVERY_ERRORS = {
  timeout: `Sem resposta do destino em ${DELIVERY_TIMEOUT_MS / 1000} s.`,
  connection: 'Falha de conexão com o destino.',
  internal: INTERNAL_TARGET_MESSAGE,
} as const

class DeadlineError extends Error {
  override name = 'TimeoutError'
}

/** Espera `p`, mas desiste quando o prazo (`signal`) acabar. */
function withDeadline<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DeadlineError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DeadlineError())
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      },
    )
  })
}

/**
 * Um POST com http(s).request. No modo estrito a conexão resolve o nome com `safeLookup`:
 * o endereço conferido é o mesmo usado na conexão. Redirecionamento nunca é seguido.
 * Devolve o status HTTP (o corpo da resposta é descartado).
 */
function postOnce(url: URL, headers: Record<string, string>, body: string, strict: boolean, signal: AbortSignal): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const req = client.request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) },
        // conexão própria a cada envio (nada de socket reaproveitado de outro destino)
        agent: false,
        signal,
        ...(strict ? { lookup: safeLookup } : {}),
      },
      (res) => {
        const status = res.statusCode ?? 0
        res.on('error', () => undefined)
        res.destroy()
        resolve(status)
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

/** Envia de verdade um POST assinado. Nunca lança: falhas voltam em `error`. */
export async function sendWebhook(
  app: FastifyInstance,
  opts: { url: string; secret: string; event: string; deliveryId: string; body: string },
): Promise<DeliveryResult> {
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  // um prazo só para tudo: DNS da checagem, conexão, TLS e resposta
  const signal = AbortSignal.timeout(DELIVERY_TIMEOUT_MS)
  const strict = webhookStrictMode(app.config)
  const fail = (error: string): DeliveryResult => ({ ok: false, httpStatus: null, durationMs: elapsed(), error })
  try {
    const blocked = await withDeadline(webhookTargetProblem(opts.url, strict), signal)
    if (blocked) return fail(blocked)
  } catch {
    return fail(DELIVERY_ERRORS.timeout)
  }
  const timestamp = Math.floor(Date.now() / 1000)
  try {
    const status = await postOnce(
      new URL(opts.url.trim()),
      {
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        'x-x2w-event': opts.event,
        'x-x2w-delivery': opts.deliveryId,
        'x-x2w-timestamp': String(timestamp),
        'x-x2w-signature': signBody(opts.secret, timestamp, opts.body),
      },
      opts.body,
      strict,
      signal,
    )
    const ok = status >= 200 && status < 300
    return { ok, httpStatus: status, durationMs: elapsed(), error: ok ? null : `O destino respondeu HTTP ${status}.` }
  } catch (e) {
    const err = e as { name?: string; code?: string; cause?: { code?: string } }
    const code = err.code ?? err.cause?.code
    if (code === BLOCKED_PRIVATE_CODE) {
      app.log.warn({ host: hostOf(opts.url) }, 'webhooks: destino resolveu para rede interna na conexão; envio bloqueado')
      return fail(DELIVERY_ERRORS.internal)
    }
    if (signal.aborted || err.name === 'TimeoutError' || err.name === 'AbortError') return fail(DELIVERY_ERRORS.timeout)
    // o código de baixo nível (recusada, TLS, etc.) fica só no log do servidor: no painel viraria um mapa da rede
    app.log.warn({ host: hostOf(opts.url), code }, 'webhooks: falha de conexão com o destino')
    return fail(DELIVERY_ERRORS.connection)
  }
}

/** Corpo enviado: { id, event, createdAt, data } (+ test: true nos envios de teste). */
export function buildBody(p: { id: string; event: string; createdAt: string; data: unknown; test?: boolean }): string {
  return JSON.stringify(p.test ? { id: p.id, event: p.event, createdAt: p.createdAt, test: true, data: p.data } : { id: p.id, event: p.event, createdAt: p.createdAt, data: p.data })
}

/** Grava uma tentativa em webhook_executions. */
export async function recordExecution(
  db: Db,
  e: { id?: string; event: string; destinationId: string | null; url: string; result: DeliveryResult; payload: string; test: boolean },
): Promise<string> {
  const id = e.id ?? newId('ex')
  await db.query(
    `insert into webhook_executions (id, event, destination_id, url, status, http_status, duration_ms, payload, test)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, e.event, e.destinationId, e.url, e.result.ok ? 'sucesso' : 'falha', e.result.httpStatus, e.result.durationMs, e.payload, e.test],
  )
  return id
}

/** Enfileira o evento para todos os destinos ativos dele (chamar dentro da transação da ação). */
export async function enqueueWebhook(db: Db, event: string, payload: Record<string, unknown>): Promise<number> {
  if (!isWebhookEvent(event)) throw new Error(`Evento de webhook desconhecido: ${event}`)
  // o mesmo id de evento vai para todos os destinos (o destino deduplica por ele)
  const envelope = { id: newId('evt'), data: payload }
  const rows = await db.query<{ id: number }>(
    `insert into webhook_outbox (event, payload, destination_id)
     select $1, $2::jsonb, d.id from webhook_destinations d where d.event = $1 and d.active
     returning id`,
    [event, JSON.stringify(envelope)],
  )
  return rows.length
}

interface OutboxItem {
  id: number
  event: string
  payload: { id?: string; data?: unknown } | null
  destination_id: string
  attempts: number
  created_at: string
}

interface DestinationRow {
  id: string
  url: string
  active: boolean
  secret_enc: string
}

async function deliverItem(app: FastifyInstance, item: OutboxItem, dest: DestinationRow | undefined) {
  const db = app.db
  if (!dest || !dest.active) {
    await db.query(`update webhook_outbox set status = 'falhou', last_error = $2 where id = $1`, [item.id, 'Destino desativado antes do envio.'])
    return
  }
  const body = buildBody({
    id: item.payload?.id ?? `evt_${item.id}`,
    event: item.event,
    createdAt: item.created_at,
    data: item.payload && 'data' in item.payload ? item.payload.data : item.payload,
  })
  let result: DeliveryResult
  try {
    const secret = app.cipher.decrypt(dest.secret_enc)
    result = await sendWebhook(app, { url: dest.url, secret, event: item.event, deliveryId: String(item.id), body })
  } catch {
    result = { ok: false, httpStatus: null, durationMs: 0, error: 'Não foi possível ler o segredo do destino.' }
  }
  const attempts = item.attempts + 1
  await db.tx(async (t) => {
    await recordExecution(t, { event: item.event, destinationId: dest.id, url: dest.url, result, payload: body, test: false })
    if (result.ok) {
      await t.query(`update webhook_outbox set status = 'entregue', attempts = $2, last_error = null where id = $1`, [item.id, attempts])
    } else if (attempts >= MAX_ATTEMPTS) {
      await t.query(`update webhook_outbox set status = 'falhou', attempts = $2, last_error = $3 where id = $1`, [item.id, attempts, result.error])
    } else {
      await t.query(
        `update webhook_outbox set attempts = $2, last_error = $3, next_attempt_at = now() + ($4::int * interval '1 second') where id = $1`,
        [item.id, attempts, result.error, retryDelaySeconds(item.attempts)],
      )
    }
  })
}

/** Processa a fila uma vez (usado pelo laço e pelos testes). Retorna quantas entregas tentou. */
export async function processOutboxOnce(app: FastifyInstance): Promise<number> {
  // reserva até 20 itens vencidos de uma vez (skip locked: várias instâncias não disputam o mesmo item)
  const due = await app.db.query<OutboxItem>(
    `with due as (
       select id from webhook_outbox
        where status = 'pendente' and next_attempt_at <= now()
        order by next_attempt_at, id
        limit $1
        for update skip locked
     )
     update webhook_outbox o set next_attempt_at = now() + ($2::int * interval '1 second')
       from due where o.id = due.id
     returning o.id, o.event, o.payload, o.destination_id, o.attempts, o.created_at`,
    [BATCH_SIZE, LEASE_SECONDS],
  )
  if (!due.length) return 0
  const ids = [...new Set(due.map((d) => d.destination_id))]
  const dests = await app.db.query<DestinationRow>('select id, url, active, secret_enc from webhook_destinations where id = any($1::text[])', [ids])
  const byId = new Map(dests.map((d) => [d.id, d]))
  const results = await Promise.allSettled(due.map((item) => deliverItem(app, item, byId.get(item.destination_id))))
  for (const r of results) if (r.status === 'rejected') app.log.error({ err: r.reason }, 'webhooks: falha ao registrar entrega')
  return due.length
}

/** Inicia o laço em segundo plano (a cada 2 s, sem sobreposição). Retorna a função que para. */
export function startWebhookDispatcher(app: FastifyInstance): () => void {
  let running = false
  let stopped = false
  const tick = async () => {
    if (running || stopped) return
    running = true
    try {
      await processOutboxOnce(app)
    } catch (err) {
      if (!stopped) app.log.error({ err }, 'webhooks: falha ao processar a fila')
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), LOOP_INTERVAL_MS)
  timer.unref?.()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
