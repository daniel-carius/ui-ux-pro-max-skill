// Webhooks: destinos HTTP por evento e histórico de execuções.
// Ações do painel (ex.: aprovar saque) chamam emitWebhook para alimentar
// as telas de Webhooks e Estatísticas.
import { createRng, uid } from '@/lib/random'
import { dbGet, dbSet } from '@/lib/store'
import { DAY, NOW, iso } from '@/data/now'
import { demoRecords } from '@/data/demo'
import { TEMPLATE_KEY, seedTemplates } from '@/data/campanhas-templates'
import type { WebhookTemplate } from './campanhas-templates'

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
  /** evento do destino (também nos testes, que saem como webhook.teste) */
  event: WebhookEvent
  destinationId: string
  /** modo API: sempre com os trechos sensíveis mascarados (para todos); só para exibir, nunca para achar o destino */
  url: string
  status: 'sucesso' | 'falha'
  httpStatus: number
  durationMs: number
  payload: string
  /** envio de teste (botão "Testar") */
  test?: boolean
  /** motivo da falha, quando houver */
  error?: string
  /** modo API: X-X2W-Delivery enviado (o mesmo em todas as tentativas da entrega); ausente em registros antigos */
  deliveryId?: string
  /** modo API: número da tentativa (1 a WEBHOOK_MAX_ATTEMPTS); ausente em registros antigos */
  attempt?: number
  /** modo API: X-X2W-Timestamp assinado (segundos Unix); ausente se o envio parou antes de assinar */
  timestamp?: number
}

export const WEBHOOK_KEYS = {
  destinations: 'campanhas.webhooks.destinos',
  executions: 'campanhas.webhooks.execucoes',
} as const

/**
 * Evento dos envios de teste (cabeçalho X-X2W-Event e campo "event" do corpo): nunca o
 * evento real do destino, para quem recebe não tratar um teste como ordem de verdade. A
 * execução gravada continua no evento do destino, marcada como teste.
 */
export const WEBHOOK_TEST_EVENT = 'webhook.teste'

/** Corpo do envio de teste (o mesmo que o servidor assina e envia). */
export function webhookTestBody(d: Pick<WebhookDestination, 'id' | 'event'>, createdAt: string, id = 'evt_teste') {
  return { id, event: WEBHOOK_TEST_EVENT, createdAt, test: true, data: { destinationId: d.id, destinationEvent: d.event } }
}

/** Execução de um envio de teste (botão "Testar"). */
export function isTestExecution(e: Pick<WebhookExecution, 'test' | 'payload'>) {
  return e.test === true || e.payload.includes('"test":true')
}

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

/** Dados de exemplo do evento nas execuções de demonstração (o servidor manda o saque ou o depósito em data). */
function demoEventData(event: WebhookEvent, rng: ReturnType<typeof createRng>): Record<string, unknown> {
  const amount = rng.int(20, 1500)
  if (event === 'deposito.primeiro') return { id: `DP${rng.digits(6)}`, playerId: String(rng.int(100000, 102999)), amount }
  return { id: `SQ${rng.digits(5)}`, playerId: String(rng.int(100000, 102999)), amount }
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
      // mesmo envelope que o servidor envia (docs/API.md): { id, event, createdAt, data }
      payload: JSON.stringify({ id: rng.id('evt_', 10), event: d.event, createdAt: iso(at), data: demoEventData(d.event, createRng(1000 + i)) }),
    })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

/**
 * Demonstração: o template do evento está desligado em Campanhas › Templates? Mesma regra do servidor
 * (webhooks/dispatcher.ts › isEventTemplateOff): o evento acontece, mas nenhum aviso sai.
 */
export function isWebhookTemplateOff(event: WebhookEvent): boolean {
  return dbGet<WebhookTemplate[]>(TEMPLATE_KEY, seedTemplates).some((t) => t.event === event && t.active === false)
}

/** Dispara (simulado) o webhook do evento para os destinos ativos. Devolve quantos avisos saíram. */
export function emitWebhook(event: WebhookEvent, data: Record<string, unknown>): number {
  if (isWebhookTemplateOff(event)) return 0
  const dests = dbGet<WebhookDestination[]>(WEBHOOK_KEYS.destinations, seedWebhookDestinations).filter(
    (d) => d.active && d.event === event,
  )
  if (!dests.length) return 0
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
    // mesmo envelope que o servidor envia (docs/API.md): { id, event, createdAt, data }
    payload: JSON.stringify({ id: uid('evt'), event, createdAt: iso(now), data }),
  }))
  dbSet<WebhookExecution[]>(WEBHOOK_KEYS.executions, (prev) => [...execs, ...prev], seedWebhookExecutions)
  return dests.length
}

// modo API: registros só do servidor (sem nada gravado, lista vazia; o gerador não roda)
demoRecords(seedWebhookDestinations)
demoRecords(seedWebhookExecutions)
