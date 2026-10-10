// Consultas aos dados de jogadores para quem decide pagamentos (módulo de saques):
//  - payoutHold: o jogador está banido pelo anti-fraude (status 'bloqueado' em
//    geral.jogadores ou conta de uma rede banida em seguranca.bloqueios)? Jogador
//    autoexcluído ou em pausa continua podendo sacar o saldo (jogo responsável);
//  - manualCreditors: quem lançou creditação manual ou estorno para o jogador desde
//    um instante (segregação de funções: quem credita não aprova o saque sozinho).
// Leem dentro da transação de quem chama (for share: a decisão vê o estado gravado). Quem usa as duas chama
// manualCreditors antes de payoutHold: é a ordem em que o lançamento no extrato trava as linhas (geral.transacoes,
// depois geral.jogadores); na ordem inversa as duas transações podem se travar (impasse no PostgreSQL).
import type { Cipher } from '../../lib/crypto'
import type { Db } from '../../db'
import { isPlainObject, type JsonObject } from './json'
import { PLAYERS_KEY } from './player-status'
import { storedValue, type KvRow } from './store'
import { TRANSACTIONS_KEY } from './transactions'

export const FRAUD_BLOCKS_KEY = 'seguranca.bloqueios'

async function readList(t: Db, cipher: Cipher, key: string): Promise<JsonObject[]> {
  const row = await t.one<KvRow>('select key, value, value_enc, version, updated_at from kv_store where key = $1 for share', [key])
  if (!row) return []
  const v = storedValue(row, cipher)
  return Array.isArray(v) ? v.filter(isPlainObject) : []
}

/** Motivo para segurar o pagamento do jogador, ou null. */
export async function payoutHold(t: Db, cipher: Cipher, playerId: string): Promise<string | null> {
  const players = await readList(t, cipher, PLAYERS_KEY)
  const player = players.find((p) => p.id === playerId)
  if (player?.status === 'bloqueado') return 'Conta bloqueada pelo anti-fraude.'
  const blocks = await readList(t, cipher, FRAUD_BLOCKS_KEY)
  const net = blocks.find((b) => b.kind === 'rede' && Array.isArray(b.accounts) && b.accounts.includes(playerId))
  if (net) return `Conta de uma rede banida pelo anti-fraude (${String(net.value)}).`
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
