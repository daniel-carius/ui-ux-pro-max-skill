// Dados de demonstração deste módulo (usados por src/seed.ts quando DEMO_DATA=true).
// Cópia dos destinos de src/domain/webhooks.ts (aquele arquivo importa o React).
import type { FastifyInstance } from 'fastify'
import { seedWebhookEvents } from '@/data/webhooks'
import { newId, randomToken } from '../../lib/crypto'
import { maskUrlTokens } from '../../lib/mask'
import { DESTINATIONS_VERSION_KEY } from './kv'
import { hostOf, type WebhookEvent } from './url'

const DAY = 86_400_000

export const DEMO_DESTINATIONS: { id: string; event: WebhookEvent; url: string; active: boolean; secret: string }[] = [
  { id: 'wh1', event: 'saque.solicitado', url: 'https://hooks.x2win-crm.com/in/saques', active: true, secret: 'DEMO-hmac-1f9a2c' },
  { id: 'wh2', event: 'saque.pago', url: 'https://hooks.x2win-crm.com/in/saques', active: true, secret: 'DEMO-hmac-8b2d4f' },
  { id: 'wh3', event: 'saque.rejeitado', url: 'https://hooks.x2win-crm.com/in/saques', active: true, secret: 'DEMO-hmac-3c5e7a' },
  { id: 'wh4', event: 'saque.expirado', url: 'https://hooks.x2win-crm.com/in/saques', active: true, secret: 'DEMO-hmac-6d8f1b' },
  { id: 'wh5', event: 'deposito.primeiro', url: 'https://api.leadflow.app/v1/ftd/a8c3f1d92e7b', active: true, secret: 'DEMO-hmac-9e1a3c' },
]

/**
 * Destinos de demonstração (endereços e segredos cifrados) e as execuções dos últimos 30 dias: uma por evento dos
 * saques e depósitos de demonstração (os mesmos que DEMO_DATA grava em operacao.saques e operacao.depositos), com
 * o id do saque ou do depósito e o jogador no corpo. Não faz nada se já houver destinos.
 */
export async function seedDemo(app: FastifyInstance): Promise<string> {
  const count = await app.db.one<{ n: number }>('select count(*)::int as n from webhook_destinations')
  if ((count?.n ?? 0) > 0) return `já existem ${count?.n} destinos; nada a semear`
  const createdAt = new Date(Date.now() - 90 * DAY).toISOString()
  const events = seedWebhookEvents()
  let executions = 0
  await app.db.tx(async (t) => {
    for (const d of DEMO_DESTINATIONS) {
      await t.query(
        `insert into webhook_destinations (id, event, url, url_enc, host, active, secret_enc, created_at, updated_at)
         values ($1, $2, null, $3, $4, $5, $6, $7, $7) on conflict (id) do nothing`,
        [d.id, d.event, app.cipher.encrypt(d.url), hostOf(d.url), d.active, app.cipher.encrypt(d.secret), createdAt],
      )
    }
    await t.query(
      `insert into settings (key, value) values ($1, $2::jsonb)
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [DESTINATIONS_VERSION_KEY, JSON.stringify({ version: 1 })],
    )
    for (const e of events) {
      for (const d of DEMO_DESTINATIONS) {
        if (!d.active || d.event !== e.event) continue
        const payload = JSON.stringify({ id: `evt_${randomToken(8)}`, event: e.event, createdAt: e.at, data: e.data })
        await t.query(
          `insert into webhook_executions (id, at, event, destination_id, url, status, http_status, duration_ms, payload, test)
           values ($1, $2, $3, $4, $5, 'sucesso', 200, $6, $7, false)`,
          [newId('ex'), e.at, e.event, d.id, maskUrlTokens(d.url), 80 + Math.floor(Math.random() * 561), payload],
        )
        executions++
      }
    }
  })
  return `${DEMO_DESTINATIONS.length} destinos e ${executions} execuções de demonstração`
}
