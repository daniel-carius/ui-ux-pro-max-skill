// Dados derivados do módulo Geral: estatísticas de jogo por período (Rankings).
// Determinístico: o mesmo jogador e o mesmo período geram sempre os mesmos números.
import type { PlayerPeriodStats } from '@/domain/geral'
import type { Transaction } from './finance'
import { periodStartMs } from './ledger'
import { NOW } from './now'
import type { Player } from './players'

export type RankPeriod = '7d' | '30d' | '90d' | 'total'

export const RANK_PERIODS: { value: RankPeriod; label: string; days: number | null }[] = [
  { value: '7d', label: '7 dias', days: 7 },
  { value: '30d', label: '30 dias', days: 30 },
  { value: '90d', label: '90 dias', days: 90 },
  { value: 'total', label: 'Desde o início', days: null },
]

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Somas do extrato desde `start`: apostas (sem as estornadas, que voltaram ao jogador), prêmios (ganhos e free
 * spins) e o maior prêmio, por jogador.
 */
function statementStats(txs: readonly Transaction[], start: number): Map<string, PlayerPeriodStats> {
  const reversed = new Set<string>()
  for (const t of txs) if (t.type === 'estorno' && t.reference.startsWith('EST-')) reversed.add(t.reference.slice(4))
  const out = new Map<string, PlayerPeriodStats>()
  for (const t of txs) {
    if (Date.parse(t.at) < start) continue
    const bet = t.type === 'aposta' && !reversed.has(t.id)
    const win = t.type === 'ganho' || t.type === 'free_spin'
    if (!bet && !win) continue
    let s = out.get(t.playerId)
    if (!s) out.set(t.playerId, (s = { playerId: t.playerId, wagered: 0, bets: 0, won: 0, biggestWin: 0 }))
    if (bet) {
      s.wagered = round2(s.wagered - t.amount)
      s.bets++
    } else {
      s.won = round2(s.won + t.amount)
      s.biggestWin = Math.max(s.biggestWin, t.amount)
    }
  }
  return out
}

/**
 * Quanto cada jogador apostou e ganhou no período (rodadas e bilhetes), com o mesmo início de período das telas.
 *  - com o extrato (`txs`, modo demonstração): as somas das linhas do período, como em Transações (aposta estornada
 *    não conta); "Desde o início" são os totais da ficha;
 *  - sem o extrato (modo API: o ranking não lê as transações), distribui os totais da ficha igualmente entre o
 *    1º depósito e o último acesso.
 */
export function playerStatsForPeriod(players: Player[], period: RankPeriod, txs: readonly Transaction[] | null = null): PlayerPeriodStats[] {
  const days = RANK_PERIODS.find((p) => p.value === period)?.days ?? null
  const fromStatement = txs && days !== null ? statementStats(txs, periodStartMs(days)) : null
  const out: PlayerPeriodStats[] = []
  for (const p of players) {
    if (fromStatement) {
      const s = fromStatement.get(p.id)
      if (s && s.bets > 0) out.push(s)
      continue
    }
    if (p.totalBet <= 0 || p.betsCount <= 0) continue
    if (days === null) {
      out.push({ playerId: p.id, wagered: p.totalBet, bets: p.betsCount, won: p.totalWon, biggestWin: Math.min(p.biggestWin, p.totalWon) })
      continue
    }
    // período ativo da conta: do 1º depósito (ou cadastro) ao último acesso
    const from = new Date(p.firstDepositAt ?? p.createdAt).getTime()
    const to = Math.max(from, Math.min(NOW.getTime(), new Date(p.lastAccess).getTime()))
    const start = periodStartMs(days)
    if (to < start) continue
    const share = to > from ? Math.min(1, (to - Math.max(from, start)) / (to - from)) : 1
    if (share >= 1) {
      out.push({ playerId: p.id, wagered: p.totalBet, bets: p.betsCount, won: p.totalWon, biggestWin: Math.min(p.biggestWin, p.totalWon) })
      continue
    }
    const bets = Math.round(p.betsCount * share)
    if (bets <= 0) continue
    const wagered = round2(p.totalBet * share)
    const won = round2(p.totalWon * share)
    out.push({ playerId: p.id, wagered, bets, won, biggestWin: round2(Math.min(won, p.biggestWin)) })
  }
  return out
}
