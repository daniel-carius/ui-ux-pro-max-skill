// Webhooks: teste de destino. Prefixo /api/webhooks.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { WebhookTestResponse } from '@shared/api'
import { Errors } from '../../errors'
import { requirePerm } from '../../http'
import { newId } from '../../lib/crypto'
import { writeAudit } from '../../services/audit'
import { buildBody, recordExecution, sendWebhook, type DeliveryResult } from './dispatcher'
import { toPanelExecution, type DestinationRow, type ExecutionRow } from './kv'
import { hostOf, WEBHOOK_EVENT_LABEL } from './url'

const idParams = z.object({ id: z.string().trim().min(1).max(64) })

export default async function routes(app: FastifyInstance) {
  app.post('/destinations/:id/test', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req): Promise<WebhookTestResponse> => {
    const auth = requirePerm(req, 'webhooks.editar')
    const { id } = idParams.parse(req.params)
    const dest = await app.db.one<DestinationRow>('select * from webhook_destinations where id = $1', [id])
    if (!dest) throw Errors.notFound('Destino de webhook')

    const executionId = newId('ex')
    const body = buildBody({
      id: newId('evt'),
      event: dest.event,
      createdAt: new Date().toISOString(),
      test: true,
      data: { id: 'TESTE-0001', amount: 100 },
    })
    let result: DeliveryResult
    try {
      const secret = app.cipher.decrypt(dest.secret_enc)
      result = await sendWebhook(app, { url: dest.url, secret, event: dest.event, deliveryId: executionId, body })
    } catch {
      result = { ok: false, httpStatus: null, durationMs: 0, error: 'Não foi possível ler o segredo do destino.' }
    }

    const label = WEBHOOK_EVENT_LABEL[dest.event] ?? dest.event
    await app.db.tx(async (t) => {
      await recordExecution(t, { id: executionId, event: dest.event, destinationId: dest.id, url: dest.url, result, payload: body, test: true })
      await writeAudit(t, auth, {
        action: 'testar',
        entity: `Webhook ${label}`,
        summary:
          result.httpStatus !== null
            ? `POST de teste para ${hostOf(dest.url)}: HTTP ${result.httpStatus} em ${result.durationMs} ms`
            : `POST de teste para ${hostOf(dest.url)} falhou: ${result.error}`,
      })
    })
    const row = await app.db.one<ExecutionRow>('select * from webhook_executions where id = $1', [executionId])
    return { execution: { ...toPanelExecution(row!), ...(result.error ? { error: result.error } : {}) } }
  })
}
