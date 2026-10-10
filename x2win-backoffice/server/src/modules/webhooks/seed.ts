// Dados de demonstração deste módulo (usados por src/seed.ts quando DEMO_DATA=true).
// Cópia dos destinos de src/domain/webhooks.ts (aquele arquivo importa o React).
import type { FastifyInstance } from 'fastify'
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

/** Peso de cada destino nas execuções de demonstração (mesma proporção do painel). */
const WEIGHTS = [30, 40, 6, 4, 20]
export const DEMO_EXECUTIONS = 134

function pickWeighted<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((s, w) => s + w, 0)
  let r = Math.random() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r < 0) return items[i]
  }
  return items[items.length - 1]
}

/** Destinos de demonstração (endereços e segredos cifrados) e 134 execuções dos últimos 30 dias. Não faz nada se já houver destinos. */
export async function seedDemo(app: FastifyInstance): Promise<string> {
  const count = await app.db.one<{ n: number }>('select count(*)::int as n from webhook_destinations')
  if ((count?.n ?? 0) > 0) return `já existem ${count?.n} destinos; nada a semear`
  const createdAt = new Date(Date.now() - 90 * DAY).toISOString()
  const now = Date.now()
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
    for (let i = 0; i < DEMO_EXECUTIONS; i++) {
      const d = pickWeighted(DEMO_DESTINATIONS, WEIGHTS)
      const at = new Date(now - Math.random() * 30 * DAY).toISOString()
      const payload = JSON.stringify({ id: `evt_${randomToken(8)}`, event: d.event, createdAt: at, data: {} })
      await t.query(
        `insert into webhook_executions (id, at, event, destination_id, url, status, http_status, duration_ms, payload, test)
         values ($1, $2, $3, $4, $5, 'sucesso', 200, $6, $7, false)`,
        [newId('ex'), at, d.event, d.id, maskUrlTokens(d.url), 80 + Math.floor(Math.random() * 561), payload],
      )
    }
  })
  return `${DEMO_DESTINATIONS.length} destinos e ${DEMO_EXECUTIONS} execuções de demonstração`
}
