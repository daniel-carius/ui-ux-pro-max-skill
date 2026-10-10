// Dados derivados do módulo Geral: estatísticas de jogo por período (Rankings).
// Determinístico: o mesmo jogador e o mesmo período geram sempre os mesmos números.
import { createRng } from '@/lib/random'
import type { PlayerPeriodStats } from '@/domain/geral'
import { DAY, NOW } from './now'
import type { Player } from './players'

export type RankPeriod = '7d' | '30d' | '90d' | 'total'

export const RANK_PERIODS: { value: RankPeriod; label: string; days: number | null }[] = [
  { value: '7d', label: '7 dias', days: 7 },
  { value: '30d', label: '30 dias', days: 30 },
  { value: '90d', label: '90 dias', days: 90 },
  { value: 'total', label: 'Desde o início', days: null },
]

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Quanto cada jogador apostou e ganhou no período. Parte do histórico do jogador
 * (totais desde o cadastro) e distribui pela janela em que ele esteve ativo.
 */
export function playerStatsForPeriod(players: Player[], period: RankPeriod): PlayerPeriodStats[] {
  const days = RANK_PERIODS.find((p) => p.value === period)?.days ?? null
  const out: PlayerPeriodStats[] = []
  for (const p of players) {
    if (p.totalBet <= 0 || p.betsCount <= 0) continue
    if (days === null) {
      out.push({ playerId: p.id, wagered: p.totalBet, bets: p.betsCount, won: p.totalWon, biggestWin: Math.min(p.biggestWin, p.totalWon) })
      continue
    }
    const lifeDays = Math.max(1, (NOW.getTime() - new Date(p.createdAt).getTime()) / DAY)
    const idleDays = (NOW.getTime() - new Date(p.lastAccess).getTime()) / DAY
    if (idleDays > days) continue
    const rng = createRng(hash(p.id) + days * 7919)
    const base = Math.min(1, days / lifeDays)
    const share = Math.min(1, Math.max(0.02, base * rng.float(0.55, 1.5, 3)))
    // período que cobre a conta inteira (cadastro dentro da janela): os números são os da ficha, sem sorteio
    // (antes "Apostado" batia com a ficha e "Ganho" saía sorteado: R$ 356.407,65 no ranking × R$ 299.502,23 na ficha)
    if (base >= 1 || share >= 1) {
      out.push({ playerId: p.id, wagered: p.totalBet, bets: p.betsCount, won: p.totalWon, biggestWin: Math.min(p.biggestWin, p.totalWon) })
      continue
    }
    const wagered = round2(p.totalBet * share)
    const bets = Math.max(1, Math.round(p.betsCount * share))
    const rtp = p.totalBet ? p.totalWon / p.totalBet : 0
    const won = round2(wagered * Math.max(0, rtp * rng.float(0.8, 1.2, 3)))
    const biggestWin = round2(Math.min(won, p.biggestWin * (share >= 1 ? 1 : rng.float(0.25, 1, 3))))
    out.push({ playerId: p.id, wagered, bets, won, biggestWin })
  }
  return out
}
