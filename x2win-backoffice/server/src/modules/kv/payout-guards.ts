// Consultas aos dados de jogadores para quem decide pagamentos (módulo de saques):
//  - payoutHold: o jogador está bloqueado (status 'bloqueado' em geral.jogadores, com o motivo do
//    histórico de status) ou é conta de uma rede banida em seguranca.bloqueios? Jogador
//    autoexcluído ou em pausa continua podendo sacar o saldo (jogo responsável);
//  - bannedNetworks: contas de redes banidas (o desbloqueio de uma delas pela ficha é recusado
//    enquanto o banimento da rede valer: kv/players.ts);
//  - manualCreditors: quem lançou creditação manual ou estorno para o jogador desde
//    um instante (segregação de funções: quem credita não aprova o saque sozinho).
// Leem dentro da transação de quem chama (for share: a decisão vê o estado gravado). Quem usa as duas chama
// manualCreditors antes de payoutHold: é a ordem em que o lançamento no extrato trava as linhas (geral.transacoes,
// depois geral.jogadores); na ordem inversa as duas transações podem se travar (impasse no PostgreSQL).
import { payoutHoldMessage } from '@shared/withdrawals'
import type { Cipher } from '../../lib/crypto'
import type { Db } from '../../db'
import { isPlainObject, type JsonObject } from './json'
import { PLAYERS_KEY, STATUS_HISTORY_KEY } from './player-status'
import { storedValue, type KvRow } from './store'
import { TRANSACTIONS_KEY } from './transactions'

export const FRAUD_BLOCKS_KEY = 'seguranca.bloqueios'

async function readList(t: Db, cipher: Cipher, key: string): Promise<JsonObject[]> {
  const row = await t.one<KvRow>('select key, value, value_enc, version, updated_at from kv_store where key = $1 for share', [key])
  if (!row) return []
  const v = storedValue(row, cipher)
  return Array.isArray(v) ? v.filter(isPlainObject) : []
}

/**
 * Redes banidas (seguranca.bloqueios, kind 'rede') de cada conta: id do jogador → id da rede.
 * Lê com for share: quem chama já travou geral.jogadores (mesma ordem de payoutHold).
 */
export async function bannedNetworks(t: Db, cipher: Cipher): Promise<Map<string, string>> {
  const blocks = await readList(t, cipher, FRAUD_BLOCKS_KEY)
  const out = new Map<string, string>()
  for (const b of blocks) {
    if (b.kind !== 'rede' || !Array.isArray(b.accounts)) continue
    for (const id of b.accounts) if (typeof id === 'string' && !out.has(id)) out.set(id, String(b.value))
  }
  return out
}

/**
 * Motivo do bloqueio mais recente do jogador no histórico de status (geral.usuarios.status), ou null.
 * Só compõe a mensagem (a decisão é o status gravado): lê sem trava, depois de geral.jogadores.
 */
async function lastBlockReason(t: Db, cipher: Cipher, playerId: string): Promise<string | null> {
  const row = await t.one<KvRow>('select key, value, value_enc, version, updated_at from kv_store where key = $1', [STATUS_HISTORY_KEY])
  if (!row) return null
  const v = storedValue(row, cipher)
  if (!Array.isArray(v)) return null
  let best: { at: number; reason: string } | null = null
  for (const e of v) {
    if (!isPlainObject(e) || e.playerId !== playerId || e.action !== 'bloquear' || typeof e.reason !== 'string' || !e.reason.trim()) continue
    const at = typeof e.at === 'string' ? Date.parse(e.at) : Number.NaN
    const when = Number.isNaN(at) ? -Infinity : at
    if (!best || when > best.at) best = { at: when, reason: e.reason.trim().slice(0, 300) }
  }
  return best?.reason ?? null
}

/** Motivo para segurar o pagamento do jogador, ou null. */
export async function payoutHold(t: Db, cipher: Cipher, playerId: string): Promise<string | null> {
  const players = await readList(t, cipher, PLAYERS_KEY)
  const player = players.find((p) => p.id === playerId)
  // rede banida primeiro: a conta bloqueada pelo banimento da rede só sai dele em Anti-fraude › Bloqueios
  const net = (await bannedNetworks(t, cipher)).get(playerId)
  if (net) return payoutHoldMessage({ network: net, blocked: true })
  // bloqueio individual: feito na ficha (Usuários) por qualquer motivo, inclusive pedido do jogador; não diz "anti-fraude"
  if (player?.status === 'bloqueado') return payoutHoldMessage({ blocked: true, blockReason: await lastBlockReason(t, cipher, playerId) })
  return null
}

/** Ids de quem lançou creditação manual ou estorno para o jogador desde `sinceMs`. */
export async function manualCreditors(t: Db, cipher: Cipher, playerId: string, sinceMs: number): Promise<Set<string>> {
  const txs = await readList(t, cipher, TRANSACTIONS_KEY)
  const out = new Set<string>()
  for (const tx of txs) {
    if (tx.playerId !== playerId || (tx.type !== 'credito_manual' && tx.type !== 'estorno')) continue
    const at = typeof tx.at === 'string' ? Date.parse(tx.at) : Number.NaN
    if (Number.isNaN(at) || at < sinceMs) continue
    if (typeof tx.byId === 'string' && tx.byId) out.add(tx.byId)
  }
  return out
}
