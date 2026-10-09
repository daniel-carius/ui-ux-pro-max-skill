// Disparador de webhooks: lê a fila (webhook_outbox), envia com assinatura HMAC,
// registra a execução e reagenda falhas com espera crescente.
import type { FastifyInstance } from 'fastify'
import type { Db } from '../../db'

/** Enfileira o evento para todos os destinos ativos dele (chamar dentro da transação da ação). */
export async function enqueueWebhook(_db: Db, _event: string, _payload: Record<string, unknown>): Promise<number> {
  // TODO: implementar
  return 0
}

/** Processa a fila uma vez (usado pelo laço e pelos testes). Retorna quantas entregas tentou. */
export async function processOutboxOnce(_app: FastifyInstance): Promise<number> {
  // TODO: implementar
  return 0
}

/** Inicia o laço em segundo plano. Retorna a função que para. */
export function startWebhookDispatcher(_app: FastifyInstance): () => void {
  // TODO: implementar
  return () => undefined
}
