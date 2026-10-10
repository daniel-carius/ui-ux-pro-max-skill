// Webhooks: teste de destino e endereço completo do destino. Prefixo /api/webhooks.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { WebhookTestResponse } from '@shared/api'
import { AppError, Errors } from '../../errors'
import { requirePerm } from '../../http'
import { newId } from '../../lib/crypto'
import { writeAudit } from '../../services/audit'
import { buildBody, recordExecution, sendWebhook, type DeliveryResult } from './dispatcher'
import {
  destinationHost,
  encryptPlainDestinationUrls,
  maskPlainExecutionUrls,
  safeDestinationUrl,
  toPanelExecution,
  type DestinationRow,
  type ExecutionRow,
} from './kv'
import { WEBHOOK_EVENT_LABEL } from './url'

const idParams = z.object({ id: z.string().trim().min(1).max(64) })

/**
 * Evento dos envios de teste (cabeçalho x-x2w-event e campo event do corpo). Nunca o evento real do destino: um
 * envelope "saque.pago" assinado com o segredo de produção, mesmo marcado como teste, poderia ser tratado como
 * ordem de pagamento por quem recebe.
 */
export const TEST_EVENT = 'webhook.teste'

export default async function routes(app: FastifyInstance) {
  // respostas com dados sensíveis (e-mails, IPs, chave PIX, resultado de envio): nunca no cache do navegador/proxy
  app.addHook('onSend', async (_req, reply, payload) => {
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store')
    return payload
  })

  // linhas gravadas antes da migração 003: endereço do destino em claro e execuções com o token na URL
  app.addHook('onReady', async () => {
    try {
      const urls = await encryptPlainDestinationUrls(app.db, app.cipher)
      const execs = await maskPlainExecutionUrls(app.db)
      if (urls || execs) app.log.info({ destinations: urls, executions: execs }, 'webhooks: endereços em claro cifrados/mascarados')
    } catch (err) {
      app.log.error({ err }, 'webhooks: falha ao cifrar os endereços em claro')
    }
  })

  app.post('/destinations/:id/test', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req): Promise<WebhookTestResponse> => {
    const auth = requirePerm(req, 'webhooks.editar')
    const { id } = idParams.parse(req.params)
    const dest = await app.db.one<DestinationRow>('select * from webhook_destinations where id = $1', [id])
    if (!dest) throw Errors.notFound('Destino de webhook')

    const executionId = newId('ex')
    const body = buildBody({
      id: newId('evt'),
      event: TEST_EVENT,
      createdAt: new Date().toISOString(),
      test: true,
      data: { destinationId: dest.id, destinationEvent: dest.event },
    })
    const url = safeDestinationUrl(dest, app.cipher)
    let result: DeliveryResult
    try {
      if (url === null) throw new Error('endereço ilegível')
      const secret = app.cipher.decrypt(dest.secret_enc)
      result = await sendWebhook(app, { url, secret, event: TEST_EVENT, deliveryId: executionId, body })
    } catch {
      result = { ok: false, httpStatus: null, durationMs: 0, error: 'Não foi possível ler o endereço ou o segredo do destino.' }
    }

    const label = WEBHOOK_EVENT_LABEL[dest.event] ?? dest.event
    const host = destinationHost(dest)
    await app.db.tx(async (t) => {
      // a execução fica no evento do destino (Estatísticas agrupam por ele), marcada test = true
      await recordExecution(t, { id: executionId, event: dest.event, destinationId: dest.id, url: url ?? `https://${host}/`, result, payload: body, test: true })
      await writeAudit(t, auth, {
        action: 'testar',
        entity: `Webhook ${label}`,
        summary:
          result.httpStatus !== null
            ? `POST de teste para ${host}: HTTP ${result.httpStatus} em ${result.durationMs} ms`
            : `POST de teste para ${host} falhou: ${result.error}`,
      })
    })
    const row = await app.db.one<ExecutionRow>('select * from webhook_executions where id = $1', [executionId])
    return { execution: { ...toPanelExecution(row!), ...(result.error ? { error: result.error } : {}) } }
  })

  // endereço completo (com token) para quem edita os destinos: cifrado no banco, cada leitura fica na auditoria
  app.post('/destinations/:id/reveal', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req): Promise<{ url: string }> => {
    const auth = requirePerm(req, 'webhooks.editar')
    const { id } = idParams.parse(req.params)
    const dest = await app.db.one<DestinationRow>('select * from webhook_destinations where id = $1', [id])
    if (!dest) throw Errors.notFound('Destino de webhook')
    const url = safeDestinationUrl(dest, app.cipher)
    if (url === null) throw new AppError(500, 'erro_interno', 'Não foi possível ler o endereço deste destino.')
    await writeAudit(app.db, auth, {
      action: 'revelar',
      entity: `Webhook ${WEBHOOK_EVENT_LABEL[dest.event] ?? dest.event}`,
      summary: `Endereço completo do destino ${dest.id} (${destinationHost(dest)}) exibido`,
    })
    return { url }
  })
}
