// Ranking de afiliados: indicados, depositantes, depósitos e comissão estimada
// (CPA + Rev Share) no período. Funções puras, reaproveitáveis no back-end.
import type { Deposit, Transaction } from '@/data/finance'
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

/** Depósitos e GGR de um indicado no período. */
export interface PeriodActivity {
  deposited: number
  ggr: number
}

/**
 * Depósitos e GGR de cada jogador no período, pelos registros: PIX pagos de Depósitos (pela data do pedido, como
 * a tela) e apostas menos prêmios do extrato (aposta estornada não conta). Só entra quem depositou ou apostou.
 */
export function activityFromRecords(deposits: readonly Deposit[], txs: readonly Transaction[], period: Period): Map<string, PeriodActivity> {
  const from = period.from.getTime()
  const to = period.to.getTime()
  const within = (iso: string) => {
    const t = Date.parse(iso)
    return t >= from && t <= to
  }
  const out = new Map<string, PeriodActivity>()
  const of = (id: string) => {
    let a = out.get(id)
    if (!a) out.set(id, (a = { deposited: 0, ggr: 0 }))
    return a
  }
  for (const d of deposits) if (d.status === 'pago' && within(d.createdAt)) of(d.playerId).deposited += d.amount
  const reversed = new Set<string>()
  for (const t of txs) if (t.type === 'estorno' && t.reference.startsWith('EST-')) reversed.add(t.reference.slice(4))
  for (const t of txs) {
    if (!within(t.at)) continue
    if (t.type === 'aposta' && !reversed.has(t.id)) of(t.playerId).ggr -= t.amount
    else if (t.type === 'ganho' || t.type === 'free_spin') of(t.playerId).ggr -= t.amount
  }
  for (const a of out.values()) {
    a.deposited = r2(a.deposited)
    a.ggr = r2(a.ggr)
  }
  return out
}

export interface AffiliateRankRow {
  id: string
  affiliate: Affiliate
  /** cadastros indicados no período */
  referred: number
  /** indicados que fizeram o 1º depósito no período (base do CPA) */
  depositors: number
  /** depósitos dos indicados no período (pelos registros, ou estimativa pela atividade) */
  deposited: number
  /** GGR dos indicados no período (apostado − ganho) */
  ggr: number
  /** indicados de toda a vida, para contexto */
  totalReferred: number
  cpaUnit: number
  cpaTotal: number
  revSharePct: number
  revShareValue: number
  commission: number
  /** indicados ativos no período, com o que cada um depositou e o GGR dele */
  players: { player: Player; deposited: number; ggr: number }[]
}

const r2 = (v: number) => Math.round(v * 100) / 100

/**
 * `activity`: depósitos e GGR por jogador no período (activityFromRecords). Sem ela (modo API, sem acesso aos
 * registros), estima pela fração da vida do jogador que cai no período (activityShare).
 *
 * Regras da comissão:
 * - CPA: valor fixo por indicado que fez o primeiro depósito no período (depositantes × CPA).
 * - Rev Share: percentual sobre o GGR estimado dos indicados no período. GGR negativo não gera
 *   Rev Share neste painel (sem compensação de saldo negativo entre meses).
 * - Afiliado pausado continua no ranking, mas a comissão aparece zerada.
 */
export function rankAffiliates(affiliates: Affiliate[], players: Player[], period: Period, activity: ReadonlyMap<string, PeriodActivity> | null = null): AffiliateRankRow[] {
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
    const active: AffiliateRankRow['players'] = []
    for (const p of list) {
      let a: PeriodActivity | undefined
      if (activity) a = activity.get(p.id)
      else {
        const share = activityShare(p, period)
        if (share > 0) a = { deposited: r2(p.totalDeposited * share), ggr: r2((p.totalBet - p.totalWon) * share) }
      }
      if (!a) continue
      active.push({ player: p, deposited: a.deposited, ggr: a.ggr })
      deposited += a.deposited
      ggr += a.ggr
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
