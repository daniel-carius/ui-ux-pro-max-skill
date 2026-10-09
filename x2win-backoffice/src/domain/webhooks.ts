// Webhooks: destinos HTTP por evento e histórico de execuções.
// Ações do painel (ex.: aprovar saque) chamam emitWebhook para alimentar
// as telas de Webhooks e Estatísticas.
import { createRng, uid } from '@/lib/random'
import { dbGet, dbSet } from '@/lib/store'
import { DAY, NOW, iso } from '@/data/now'

export type WebhookEvent = 'saque.solicitado' | 'saque.pago' | 'saque.rejeitado' | 'saque.expirado' | 'deposito.primeiro'

export const WEBHOOK_EVENT_LABEL: Record<WebhookEvent, string> = {
  'saque.solicitado': 'Saque solicitado',
  'saque.pago': 'Saque pago',
  'saque.rejeitado': 'Saque rejeitado',
  'saque.expirado': 'Saque expirado',
  'deposito.primeiro': 'Primeiro depósito',
}

export interface WebhookDestination {
  id: string
  event: WebhookEvent
  url: string
  active: boolean
  /** segredo usado para assinar o corpo (HMAC) */
  secret: string
  createdAt: string
}

export interface WebhookExecution {
  id: string
  at: string
  event: WebhookEvent
  destinationId: string
  url: string
  status: 'sucesso' | 'falha'
  httpStatus: number
  durationMs: number
  payload: string
  /** envio de teste (botão "Testar") */
  test?: boolean
  /** motivo da falha, quando houver */
  error?: string
}

export const WEBHOOK_KEYS = {
  destinations: 'campanhas.webhooks.destinos',
  executions: 'campanhas.webhooks.execucoes',
} as const

export function seedWebhookDestinations(): WebhookDestination[] {
  const created = iso(new Date(NOW.getTime() - 90 * DAY))
  return [
    { id: 'wh1', event: 'saque.solicitado', url: 'https://hooks.x2win-crm.com/in/saques', active: true, secret: 'DEMO-hmac-1f9a2c', createdAt: created },
    { id: 'wh2', event: 'saque.pago', url: 'https://hooks.x2win-crm.com/in/saques', active: true, secret: 'DEMO-hmac-8b2d4f', createdAt: created },
    { id: 'wh3', event: 'saque.rejeitado', url: 'https://hooks.x2win-crm.com/in/saques', active: true, secret: 'DEMO-hmac-3c5e7a', createdAt: created },
    { id: 'wh4', event: 'saque.expirado', url: 'https://hooks.x2win-crm.com/in/saques', active: true, secret: 'DEMO-hmac-6d8f1b', createdAt: created },
    { id: 'wh5', event: 'deposito.primeiro', url: 'https://api.leadflow.app/v1/ftd/a8c3f1d92e7b', active: true, secret: 'DEMO-hmac-9e1a3c', createdAt: created },
  ]
}

export function seedWebhookExecutions(): WebhookExecution[] {
  const rng = createRng(134)
  const dests = seedWebhookDestinations()
  const out: WebhookExecution[] = []
  for (let i = 0; i < 134; i++) {
    const d = rng.weighted([
      [dests[0], 30],
      [dests[1], 40],
      [dests[2], 6],
      [dests[3], 4],
      [dests[4], 20],
    ] as const)
    const at = new Date(NOW.getTime() - rng.next() * 30 * DAY)
    out.push({
      id: `ex${i}`,
      at: iso(at),
      event: d.event,
      destinationId: d.id,
      url: d.url,
      status: 'sucesso',
      httpStatus: 200,
      durationMs: rng.int(80, 640),
      payload: JSON.stringify({ event: d.event, id: rng.id('evt_', 10), at: iso(at) }),
    })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

/** Dispara (simulado) o webhook do evento para os destinos ativos. */
export function emitWebhook(event: WebhookEvent, data: Record<string, unknown>) {
  const dests = dbGet<WebhookDestination[]>(WEBHOOK_KEYS.destinations, seedWebhookDestinations).filter(
    (d) => d.active && d.event === event,
  )
  if (!dests.length) return
  const now = new Date()
  const execs: WebhookExecution[] = dests.map((d) => ({
    id: uid('ex'),
    at: iso(now),
    event,
    destinationId: d.id,
    url: d.url,
    status: 'sucesso',
    httpStatus: 200,
    durationMs: 120 + Math.round(Math.random() * 300),
    payload: JSON.stringify({ event, at: iso(now), data }),
  }))
  dbSet<WebhookExecution[]>(WEBHOOK_KEYS.executions, (prev) => [...execs, ...prev], seedWebhookExecutions)
}

