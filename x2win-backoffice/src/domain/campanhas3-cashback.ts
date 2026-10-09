// Cashback (devolução de parte da perda líquida) e Rakeback (devolução de parte
// do valor apostado). Regras puras usadas pela tela e pelo simulador.
import { DAY } from '@/data/now'
import { BET_CATEGORIES, BET_CATEGORY_LABEL, type BetCategory, type Level } from './campanhas3-niveis'

export type CashbackPeriod = 'diario' | 'semanal' | 'mensal'

export const PERIOD_LABEL: Record<CashbackPeriod, string> = { diario: 'Diário', semanal: 'Semanal', mensal: 'Mensal' }
export const PERIOD_NOUN: Record<CashbackPeriod, string> = { diario: 'dia', semanal: 'semana', mensal: 'mês' }
/** "no dia", "na semana", "no mês" */
export const PERIOD_IN: Record<CashbackPeriod, string> = { diario: 'no dia', semanal: 'na semana', mensal: 'no mês' }

export interface CashbackRules {
  enabled: boolean
  /** % fixo para todos ou % do nível do jogador (Níveis e XP) */
  mode: 'fixo' | 'por_nivel'
  pct: number
  period: CashbackPeriod
  /** perda líquida mínima no período para ter direito */
  minLoss: number
  /** teto por jogador por período (0 = sem teto) */
  cap: number
  /** categorias cujas apostas contam para a perda */
  categories: BetCategory[]
  /** rollover do cashback, em vezes (0 = vai como saldo real, sacável) */
  rollover: number
  /** 0 = domingo … 6 = sábado (período semanal) */
  creditWeekday: number
  /** 1 a 28 (período mensal) */
  creditMonthDay: number
  /** HH:MM */
  creditHour: string
  claim: 'automatico' | 'resgate'
  /** dias para resgatar, quando o resgate é manual */
  claimDays: number
}

export interface RakebackRules {
  enabled: boolean
  /** % do valor apostado devolvido, por categoria */
  pct: Record<BetCategory, number>
  frequency: 'diario' | 'semanal'
  /** abaixo disso o valor acumula para o próximo ciclo */
  minPayout: number
}

export interface CashbackConfig {
  cashback: CashbackRules
  rakeback: RakebackRules
}

export const CASHBACK_KEY = 'campanhas.cashback'

export const DEFAULT_CASHBACK: CashbackConfig = {
  cashback: {
    enabled: true,
    mode: 'por_nivel',
    pct: 5,
    period: 'semanal',
    minLoss: 50,
    cap: 2000,
    categories: ['slots', 'ao_vivo', 'crash', 'mesa', 'instantaneo', 'bingo'],
    rollover: 1,
    creditWeekday: 1,
    creditMonthDay: 1,
    creditHour: '10:00',
    claim: 'automatico',
    claimDays: 7,
  },
  rakeback: {
    enabled: true,
    pct: { slots: 0.5, ao_vivo: 0.2, crash: 0.3, mesa: 0.2, instantaneo: 0.3, bingo: 0.3, esportes: 0.4 },
    frequency: 'diario',
    minPayout: 1,
  },
}

const HOUR_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function validateCashback(c: CashbackConfig): string | null {
  const cb = c.cashback
  if (cb.enabled) {
    if (cb.mode === 'fixo' && (cb.pct <= 0 || cb.pct > 50)) return 'O cashback fixo precisa estar entre 0,1% e 50%.'
    if (cb.minLoss < 0) return 'A perda mínima não pode ser negativa.'
    if (cb.cap < 0) return 'O teto não pode ser negativo.'
    if (cb.cap > 0 && cb.cap < 1) return 'Teto muito baixo: use pelo menos R$ 1,00 ou 0 para sem teto.'
    if (!cb.categories.length) return 'Escolha ao menos uma categoria que conta para o cashback.'
    if (cb.rollover < 0 || cb.rollover > 50) return 'O rollover do cashback vai de 0x a 50x.'
    if (!HOUR_RE.test(cb.creditHour)) return 'Hora do crédito inválida (use HH:MM).'
    if (cb.period === 'mensal' && (cb.creditMonthDay < 1 || cb.creditMonthDay > 28)) return 'O dia do crédito mensal vai de 1 a 28.'
    if (cb.claim === 'resgate' && (cb.claimDays < 1 || cb.claimDays > 30)) return 'O prazo de resgate vai de 1 a 30 dias.'
  }
  const rb = c.rakeback
  if (rb.enabled) {
    for (const cat of BET_CATEGORIES) {
      const v = rb.pct[cat]
      if (!Number.isFinite(v) || v < 0 || v > 5) return `Rakeback de ${BET_CATEGORY_LABEL[cat]} precisa estar entre 0% e 5%.`
    }
    if (!BET_CATEGORIES.some((cat) => rb.pct[cat] > 0)) return 'Rakeback ligado sem nenhuma categoria acima de 0%.'
    if (rb.minPayout < 0) return 'O pagamento mínimo do rakeback não pode ser negativo.'
  }
  return null
}

/** % de cashback que vale para um jogador (fixo ou do nível). */
export function cashbackPctFor(rules: CashbackRules, level: Level | undefined) {
  return rules.mode === 'fixo' ? rules.pct : (level?.cashbackPct ?? 0)
}

export interface SimCheck {
  label: string
  ok: boolean
  detail: string
}

export interface CashbackSimInput {
  bets: number
  wins: number
  category: BetCategory
  level: Level | undefined
}

export interface CashbackSimResult {
  status: 'creditado' | 'sem_direito' | 'desligado'
  netLoss: number
  pct: number
  gross: number
  credited: number
  capped: boolean
  /** quanto o jogador precisa apostar antes de sacar o cashback */
  wagerRequired: number
  checks: SimCheck[]
}

const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const round2 = (v: number) => Math.round(v * 100) / 100

/** Simula o cashback de um jogador num período, respeitando mínimo e teto. */
export function simulateCashback(rules: CashbackRules, input: CashbackSimInput): CashbackSimResult {
  const netLoss = round2(Math.max(0, input.bets - input.wins))
  const empty = { netLoss, pct: 0, gross: 0, credited: 0, capped: false, wagerRequired: 0 }
  if (!rules.enabled) return { ...empty, status: 'desligado', checks: [{ label: 'Cashback ligado', ok: false, detail: 'desligado' }] }
  const checks: SimCheck[] = []
  const counts = rules.categories.includes(input.category)
  checks.push({ label: `${BET_CATEGORY_LABEL[input.category]} conta para o cashback`, ok: counts, detail: counts ? 'sim' : 'categoria fora da regra' })
  checks.push({ label: 'Perda líquida no período', ok: netLoss > 0, detail: netLoss > 0 ? money(netLoss) : 'sem perda' })
  const aboveMin = netLoss >= rules.minLoss
  checks.push({ label: 'Perda mínima', ok: aboveMin, detail: `${money(rules.minLoss)}` })
  const pct = cashbackPctFor(rules, input.level)
  checks.push({
    label: rules.mode === 'fixo' ? 'Percentual fixo' : `Percentual do nível ${input.level?.name ?? '—'}`,
    ok: pct > 0,
    detail: `${pct.toLocaleString('pt-BR')}%`,
  })
  if (!counts || netLoss <= 0 || !aboveMin || pct <= 0) return { ...empty, pct, status: 'sem_direito', checks }
  const gross = round2((netLoss * pct) / 100)
  const capped = rules.cap > 0 && gross > rules.cap
  const credited = capped ? rules.cap : gross
  checks.push({ label: 'Teto por jogador', ok: true, detail: rules.cap > 0 ? (capped ? `limitado a ${money(rules.cap)}` : `abaixo de ${money(rules.cap)}`) : 'sem teto' })
  return { status: 'creditado', netLoss, pct, gross, credited, capped, wagerRequired: round2(credited * rules.rollover), checks }
}

export interface RakebackSimResult {
  pct: number
  amount: number
  credited: number
  belowMin: boolean
}

export function simulateRakeback(rules: RakebackRules, bets: number, category: BetCategory): RakebackSimResult {
  if (!rules.enabled) return { pct: 0, amount: 0, credited: 0, belowMin: false }
  const pct = rules.pct[category] ?? 0
  const amount = round2((bets * pct) / 100)
  const belowMin = amount > 0 && amount < rules.minPayout
  return { pct, amount, credited: belowMin ? 0 : amount, belowMin }
}

/** Próxima data de crédito do cashback, a partir de agora. */
export function nextCreditDate(rules: CashbackRules, now: Date = new Date()): Date {
  const [h, m] = rules.creditHour.split(':').map(Number)
  const at = (d: Date) => {
    const x = new Date(d)
    x.setHours(Number.isFinite(h) ? h : 10, Number.isFinite(m) ? m : 0, 0, 0)
    return x
  }
  if (rules.period === 'diario') {
    const today = at(now)
    return today > now ? today : at(new Date(now.getTime() + DAY))
  }
  if (rules.period === 'semanal') {
    for (let i = 0; i < 8; i++) {
      const d = at(new Date(now.getTime() + i * DAY))
      if (d.getDay() === rules.creditWeekday && d > now) return d
    }
    return at(new Date(now.getTime() + 7 * DAY))
  }
  const day = Math.min(28, Math.max(1, rules.creditMonthDay))
  const thisMonth = at(new Date(now.getFullYear(), now.getMonth(), day))
  return thisMonth > now ? thisMonth : at(new Date(now.getFullYear(), now.getMonth() + 1, day))
}

/** Período apurado (texto) para o próximo crédito. */
export function periodWindowLabel(period: CashbackPeriod) {
  if (period === 'diario') return 'perdas do dia anterior (00:00 às 23:59)'
  if (period === 'semanal') return 'perdas da semana anterior (segunda a domingo)'
  return 'perdas do mês anterior'
}

const PERIOD_DAYS: Record<CashbackPeriod, number> = { diario: 1, semanal: 7, mensal: 30 }

export interface CyclePlayer {
  id: string
  status: string
  xp: number
  totalBet: number
  totalWon: number
  createdAt: string
  lastAccess: string
}

/**
 * Projeção do próximo crédito com a base de jogadores: estima a perda do
 * período pela perda média diária de cada jogador ativo no período.
 */
export function projectCycle(
  players: CyclePlayer[],
  rules: CashbackRules,
  levels: Level[],
  levelIndexForXp: (levels: Level[], xp: number) => number,
  now: number = Date.now(),
) {
  if (!rules.enabled) return { eligible: 0, active: 0, total: 0, capped: 0 }
  const days = PERIOD_DAYS[rules.period]
  let eligible = 0
  let active = 0
  let total = 0
  let capped = 0
  for (const p of players) {
    if (p.status !== 'ativo') continue
    if (now - new Date(p.lastAccess).getTime() > days * DAY) continue
    active++
    const ageDays = Math.max(days, (now - new Date(p.createdAt).getTime()) / DAY)
    const loss = (Math.max(0, p.totalBet - p.totalWon) / ageDays) * days
    if (loss <= 0 || loss < rules.minLoss) continue
    const pct = cashbackPctFor(rules, levels[levelIndexForXp(levels, p.xp)])
    if (pct <= 0) continue
    let v = (loss * pct) / 100
    if (rules.cap > 0 && v > rules.cap) {
      v = rules.cap
      capped++
    }
    eligible++
    total += v
  }
  return { eligible, active, total: Math.round(total * 100) / 100, capped }
}
