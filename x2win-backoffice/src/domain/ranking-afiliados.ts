// Ranking de afiliados: indicados, depositantes, depósitos e comissão estimada
// (CPA + Rev Share) no período. Funções puras, reaproveitáveis no back-end.
import type { Affiliate, Player } from '@/data/players'
import { DAY } from '@/data/now'

export interface Period {
  from: Date
  to: Date
}

/**
 * Fração da vida do jogador que cai dentro do período (0 a 1). Usada para
 * estimar quanto do total depositado/apostado aconteceu no período.
 */
export function activityShare(p: Player, period: Period): number {
  const start = new Date(p.createdAt).getTime()
  const end = Math.max(new Date(p.lastAccess).getTime(), start + DAY)
  const from = Math.max(start, period.from.getTime())
  const to = Math.min(end, period.to.getTime())
  if (to <= from) return 0
  return (to - from) / (end - start)
}

export interface AffiliateRankRow {
  id: string
  affiliate: Affiliate
  /** cadastros indicados no período */
  referred: number
  /** indicados que fizeram o 1º depósito no período (base do CPA) */
  depositors: number
  /** depósitos dos indicados no período (estimativa pela atividade) */
  deposited: number
  /** GGR estimado dos indicados no período (apostado − ganho) */
  ggr: number
  /** indicados de toda a vida, para contexto */
  totalReferred: number
  cpaUnit: number
  cpaTotal: number
  revSharePct: number
  revShareValue: number
  commission: number
  /** indicados ativos no período */
  players: Player[]
}

const r2 = (v: number) => Math.round(v * 100) / 100

/**
 * Regras da comissão:
 * - CPA: valor fixo por indicado que fez o primeiro depósito no período (depositantes × CPA).
 * - Rev Share: percentual sobre o GGR estimado dos indicados no período. GGR negativo não gera
 *   Rev Share neste painel (sem compensação de saldo negativo entre meses).
 * - Afiliado pausado continua no ranking, mas a comissão aparece zerada.
 */
export function rankAffiliates(affiliates: Affiliate[], players: Player[], period: Period): AffiliateRankRow[] {
  const byRef = new Map<string, Player[]>()
  for (const p of players) {
    if (!p.referrerId) continue
    byRef.set(p.referrerId, [...(byRef.get(p.referrerId) ?? []), p])
  }
  const inPeriod = (iso: string | null) => {
    if (!iso) return false
    const t = new Date(iso).getTime()
    return t >= period.from.getTime() && t <= period.to.getTime()
  }
  return affiliates.map((a) => {
    const list = byRef.get(a.id) ?? []
    let deposited = 0
    let ggr = 0
    const active: Player[] = []
    for (const p of list) {
      const share = activityShare(p, period)
      if (share <= 0) continue
      active.push(p)
      deposited += p.totalDeposited * share
      ggr += (p.totalBet - p.totalWon) * share
    }
    const referred = list.filter((p) => inPeriod(p.createdAt)).length
    const depositors = list.filter((p) => inPeriod(p.firstDepositAt)).length
    const paused = a.status === 'pausado'
    const cpaTotal = paused ? 0 : depositors * a.cpa
    const revShareValue = paused ? 0 : r2(Math.max(0, ggr) * a.revShare)
    return {
      id: a.id,
      affiliate: a,
      referred,
      depositors,
      deposited: r2(deposited),
      ggr: r2(ggr),
      totalReferred: list.length,
      cpaUnit: a.cpa,
      cpaTotal,
      revSharePct: a.revShare,
      revShareValue,
      commission: r2(cpaTotal + revShareValue),
      players: active,
    }
  })
}

export type RankMetric = 'deposited' | 'commission' | 'referred'

export const RANK_METRIC_LABEL: Record<RankMetric, string> = {
  deposited: 'Valor depositado',
  commission: 'Comissão',
  referred: 'Indicados',
}

export function sortRank(rows: AffiliateRankRow[], metric: RankMetric) {
  return [...rows].sort((a, b) => b[metric] - a[metric] || b.deposited - a.deposited)
}
