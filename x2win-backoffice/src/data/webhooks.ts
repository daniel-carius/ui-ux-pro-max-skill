// Execuções de webhook de demonstração: uma por evento dos últimos 30 dias (saque pedido, pago, recusado ou
// expirado; 1º depósito) e por destino ativo do evento. Os dados do evento são os dos saques e depósitos de
// demonstração (./finance), então o integrador segue o evento até o saque e o jogador.
// Sem dependência do React: o servidor usa estas execuções na semeadura (DEMO_DATA).
import { createRng } from '@/lib/random'
import { seedDeposits, seedWithdrawals } from './finance'
import { NOW } from './now'

export type DemoWebhookEvent = 'saque.solicitado' | 'saque.pago' | 'saque.rejeitado' | 'saque.expirado' | 'deposito.primeiro'

export interface DemoWebhookOccurrence {
  at: string
  event: DemoWebhookEvent
  /** o mesmo "data" que o servidor envia no envelope { id, event, createdAt, data } */
  data: Record<string, unknown>
}

const WINDOW_MS = 30 * 86_400_000

/** Eventos dos saques e depósitos de demonstração nos últimos 30 dias, do mais antigo para o mais novo. */
export function seedWebhookEvents(): DemoWebhookOccurrence[] {
  const out: DemoWebhookOccurrence[] = []
  for (const w of seedWithdrawals()) {
    out.push({ at: w.createdAt, event: 'saque.solicitado', data: { id: w.id, playerId: w.playerId, amount: w.amount } })
    // mesmos campos que o servidor manda ao aprovar e ao recusar (withdrawals/routes.ts)
    if (w.status === 'aprovado') out.push({ at: w.updatedAt, event: 'saque.pago', data: { id: w.id, amount: w.amount, playerId: w.playerId } })
    if (w.status === 'recusado') out.push({ at: w.updatedAt, event: 'saque.rejeitado', data: { id: w.id, amount: w.amount, playerId: w.playerId, reason: w.decisionNote ?? '' } })
    if (w.status === 'expirado') out.push({ at: w.updatedAt, event: 'saque.expirado', data: { id: w.id, playerId: w.playerId, amount: w.amount } })
  }
  for (const d of seedDeposits()) {
    if (d.isFirst && d.status === 'pago') out.push({ at: d.updatedAt, event: 'deposito.primeiro', data: { id: d.id, playerId: d.playerId, amount: d.amount } })
  }
  const since = NOW.getTime() - WINDOW_MS
  return out.filter((e) => Date.parse(e.at) >= since && Date.parse(e.at) <= NOW.getTime()).sort((a, b) => a.at.localeCompare(b.at))
}

/** Execução no formato da tela (WebhookExecution em domain/webhooks), sem importar o domínio (que usa o React). */
export interface DemoWebhookExecution {
  id: string
  at: string
  event: DemoWebhookEvent
  destinationId: string
  url: string
  status: 'sucesso'
  httpStatus: number
  durationMs: number
  payload: string
}

/**
 * Execuções de demonstração para os destinos: cada evento vai para cada destino ativo do evento, com o
 * envelope que o servidor envia (docs/API.md). Do mais novo para o mais antigo.
 */
export function demoWebhookExecutions(destinations: readonly { id: string; event: string; url: string; active: boolean }[]): DemoWebhookExecution[] {
  const rng = createRng(134)
  const out: DemoWebhookExecution[] = []
  for (const e of seedWebhookEvents()) {
    for (const d of destinations) {
      if (!d.active || d.event !== e.event) continue
      out.push({
        id: `ex${out.length}`,
        at: e.at,
        event: e.event,
        destinationId: d.id,
        url: d.url,
        status: 'sucesso',
        httpStatus: 200,
        durationMs: rng.int(80, 640),
        payload: JSON.stringify({ id: rng.id('evt_', 10), event: e.event, createdAt: e.at, data: e.data }),
      })
    }
  }
  return out.reverse()
}
