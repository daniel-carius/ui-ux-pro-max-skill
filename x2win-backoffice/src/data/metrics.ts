// Série diária de indicadores da operação (base do Dashboard e do GGR).
import { createRng } from '@/lib/random'
import { seedGames, seedProviders } from './catalog'
import { DAY, NOW, dayKey, startOfDay } from './now'

export interface DailyMetrics {
  date: string // AAAA-MM-DD
  casinoBets: number
  casinoWins: number
  sportsBets: number
  sportsWins: number
  deposits: number
  depositsCount: number
  withdrawals: number
  withdrawalsCount: number
  activeUsers: number
  signups: number
  ftd: number
  ftdAmount: number
  bonusGranted: number
  bonusConverted: number
  freeSpinsValue: number
  credits: number
  debits: number
  referrals: number
  /** funil de depósito */
  depositFlowOpened: number
  depositAmountChosen: number
  pixGenerated: number
  pixPaid: number
}

let _series: DailyMetrics[] | null = null

/** 400 dias de histórico até hoje */
export function getDailySeries(): DailyMetrics[] {
  if (_series) return _series
  const rng = createRng(909)
  const out: DailyMetrics[] = []
  const today = startOfDay(NOW)
  const days = 400
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY)
    const growth = 0.55 + 0.45 * ((days - i) / days)
    const dow = d.getDay()
    const weekend = dow === 0 || dow === 6 ? 1.22 : dow === 5 ? 1.12 : 1
    const noise = () => 0.85 + rng.next() * 0.3
    const base = growth * weekend
    const active = Math.round(2100 * base * noise())
    const casinoBets = 410_000 * base * noise()
    const casinoHold = rng.float(0.035, 0.085, 4)
    const sportsBets = 96_000 * base * noise()
    const sportsHold = rng.float(-0.04, 0.16, 4)
    const deposits = 138_000 * base * noise()
    const depositsCount = Math.round(deposits / rng.float(78, 104))
    const withdrawals = deposits * rng.float(0.55, 0.82)
    const signups = Math.round(310 * base * noise())
    const ftd = Math.round(signups * rng.float(0.24, 0.36))
    const opened = Math.round(depositsCount * rng.float(1.9, 2.4))
    const chosen = Math.round(opened * rng.float(0.72, 0.82))
    const generated = Math.round(chosen * rng.float(0.84, 0.92))
    const r2 = (v: number) => Math.round(v * 100) / 100
    out.push({
      date: dayKey(d),
      casinoBets: r2(casinoBets),
      casinoWins: r2(casinoBets * (1 - casinoHold)),
      sportsBets: r2(sportsBets),
      sportsWins: r2(sportsBets * (1 - sportsHold)),
      deposits: r2(deposits),
      depositsCount,
      withdrawals: r2(withdrawals),
      withdrawalsCount: Math.round(withdrawals / rng.float(180, 260)),
      activeUsers: active,
      signups,
      ftd,
      ftdAmount: r2(ftd * rng.float(48, 72)),
      bonusGranted: r2(deposits * rng.float(0.04, 0.08)),
      bonusConverted: r2(deposits * rng.float(0.01, 0.025)),
      freeSpinsValue: r2(rng.float(800, 2600) * growth),
      credits: r2(rng.float(200, 1600)),
      debits: r2(rng.float(0, 600)),
      referrals: Math.round(signups * rng.float(0.08, 0.16)),
      depositFlowOpened: opened,
      depositAmountChosen: chosen,
      pixGenerated: generated,
      pixPaid: depositsCount,
    })
  }
  _series = out
  return out
}

export interface PeriodTotals {
  casinoBets: number
  casinoWins: number
  sportsBets: number
  sportsWins: number
  ggrCasino: number
  ggrSports: number
  ggr: number
  bonusCost: number
  ngr: number
  deposits: number
  depositsCount: number
  withdrawals: number
  withdrawalsCount: number
  net: number
  activeUsers: number
  signups: number
  ftd: number
  ftdAmount: number
  bonusGranted: number
  bonusConverted: number
  freeSpinsValue: number
  credits: number
  debits: number
  referrals: number
  depositFlowOpened: number
  depositAmountChosen: number
  pixGenerated: number
  pixPaid: number
  days: number
}

export function sumSeries(rows: DailyMetrics[]): PeriodTotals {
  const t = rows.reduce(
    (acc, r) => {
      acc.casinoBets += r.casinoBets
      acc.casinoWins += r.casinoWins
      acc.sportsBets += r.sportsBets
      acc.sportsWins += r.sportsWins
      acc.deposits += r.deposits
      acc.depositsCount += r.depositsCount
      acc.withdrawals += r.withdrawals
      acc.withdrawalsCount += r.withdrawalsCount
      acc.activeUsersMax = Math.max(acc.activeUsersMax, r.activeUsers)
      acc.activeUsersSum += r.activeUsers
      acc.signups += r.signups
      acc.ftd += r.ftd
      acc.ftdAmount += r.ftdAmount
      acc.bonusGranted += r.bonusGranted
      acc.bonusConverted += r.bonusConverted
      acc.freeSpinsValue += r.freeSpinsValue
      acc.credits += r.credits
      acc.debits += r.debits
      acc.referrals += r.referrals
      acc.depositFlowOpened += r.depositFlowOpened
      acc.depositAmountChosen += r.depositAmountChosen
      acc.pixGenerated += r.pixGenerated
      acc.pixPaid += r.pixPaid
      return acc
    },
    {
      casinoBets: 0, casinoWins: 0, sportsBets: 0, sportsWins: 0, deposits: 0, depositsCount: 0,
      withdrawals: 0, withdrawalsCount: 0, activeUsersMax: 0, activeUsersSum: 0, signups: 0, ftd: 0,
      ftdAmount: 0, bonusGranted: 0, bonusConverted: 0, freeSpinsValue: 0, credits: 0, debits: 0,
      referrals: 0, depositFlowOpened: 0, depositAmountChosen: 0, pixGenerated: 0, pixPaid: 0,
    },
  )
  const ggrCasino = t.casinoBets - t.casinoWins
  const ggrSports = t.sportsBets - t.sportsWins
  const ggr = ggrCasino + ggrSports
  const bonusCost = t.bonusConverted + t.freeSpinsValue
  // usuários únicos no período: aproximação (não somamos dias, há sobreposição)
  const activeUsers = Math.round(t.activeUsersMax * (1 + Math.log(Math.max(1, rows.length)) * 0.9))
  return {
    casinoBets: t.casinoBets,
    casinoWins: t.casinoWins,
    sportsBets: t.sportsBets,
    sportsWins: t.sportsWins,
    ggrCasino,
    ggrSports,
    ggr,
    bonusCost,
    ngr: ggr - bonusCost - t.credits + t.debits,
    deposits: t.deposits,
    depositsCount: t.depositsCount,
    withdrawals: t.withdrawals,
    withdrawalsCount: t.withdrawalsCount,
    net: t.deposits - t.withdrawals,
    activeUsers,
    signups: t.signups,
    ftd: t.ftd,
    ftdAmount: t.ftdAmount,
    bonusGranted: t.bonusGranted,
    bonusConverted: t.bonusConverted,
    freeSpinsValue: t.freeSpinsValue,
    credits: t.credits,
    debits: t.debits,
    referrals: t.referrals,
    depositFlowOpened: t.depositFlowOpened,
    depositAmountChosen: t.depositAmountChosen,
    pixGenerated: t.pixGenerated,
    pixPaid: t.pixPaid,
    days: rows.length,
  }
}

/** Saldo total das carteiras dos jogadores no fim de cada dia (aprox.) */
export function walletBalanceAt(dateKey: string): number {
  const series = getDailySeries()
  let bal = 1_240_000
  for (const r of series) {
    bal += (r.deposits - r.withdrawals) - (r.casinoBets - r.casinoWins) - (r.sportsBets - r.sportsWins) + r.bonusConverted
    if (r.date === dateKey) break
  }
  return Math.max(0, bal)
}

export interface GameStat {
  gameId: string
  gameName: string
  providerId: string
  providerName: string
  bets: number
  wins: number
  ggr: number
  rounds: number
  players: number
}

/** Distribui o GGR de cassino do período entre jogos (peso por destaque). */
export function gameStatsForPeriod(totalCasinoBets: number, totalCasinoWins: number, seed = 1): GameStat[] {
  const rng = createRng(1234 + seed)
  const games = seedGames()
  const providers = new Map(seedProviders().map((p) => [p.id, p.name]))
  const weights = games.map((g) => Math.pow(g.highlight, 1.8) * (g.active ? 1 : 0.1) * (0.6 + rng.next() * 0.8))
  const wsum = weights.reduce((a, b) => a + b, 0)
  const holdBase = totalCasinoBets > 0 ? (totalCasinoBets - totalCasinoWins) / totalCasinoBets : 0.05
  const raw = games
    .map((g, i) => {
      const bets = (totalCasinoBets * weights[i]) / wsum
      const hold = holdBase * (0.4 + rng.next() * 1.3)
      const wins = bets * (1 - hold)
      return {
        gameId: g.id,
        gameName: g.name,
        providerId: g.providerId,
        providerName: providers.get(g.providerId) ?? g.providerId,
        bets,
        wins,
        ggr: bets - wins,
        rounds: Math.round(bets / (2 + rng.next() * 8)),
        players: Math.max(1, Math.round(bets / (180 + rng.next() * 400))),
      }
    })
  // ajusta para que a soma por jogo bata com o GGR de cassino do período
  const target = totalCasinoBets - totalCasinoWins
  const current = raw.reduce((s, x) => s + x.ggr, 0)
  const k = current ? target / current : 1
  return raw
    .map((s) => ({ ...s, ggr: s.ggr * k, wins: s.bets - s.ggr * k }))
    .sort((a, b) => b.ggr - a.ggr)
}
