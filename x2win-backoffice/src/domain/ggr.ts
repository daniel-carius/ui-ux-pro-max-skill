// Regras do GGR por provedora e das apurações mensais (taxa devida a cada provedora).
import type { Provider } from '@/data/catalog'
import type { GameStat } from '@/data/metrics'
import { endOfDay } from '@/data/now'

const r2 = (v: number) => Math.round(v * 100) / 100

/**
 * Taxa da provedora sobre o GGR. Regra: GGR negativo (a casa perdeu) não gera
 * taxa no mês, e o prejuízo não é compensado no mês seguinte.
 */
export function providerFee(ggr: number, feePct: number) {
  return ggr > 0 ? r2((ggr * feePct) / 100) : 0
}

export interface ProviderGgr {
  providerId: string
  providerName: string
  aggregatorId: Provider['aggregatorId'] | null
  status: Provider['status'] | null
  logoHue: number
  bets: number
  wins: number
  /** receita bruta = apostado − pago */
  ggr: number
  /** retorno real ao jogador = pago ÷ apostado */
  rtp: number
  feePct: number
  fee: number
  /** GGR líquido = GGR − taxa da provedora */
  net: number
  rounds: number
  players: number
  games: number
}

/** Soma as estatísticas por jogo em linhas por provedora, já com a taxa. */
export function aggregateByProvider(stats: GameStat[], providers: Provider[]): ProviderGgr[] {
  const pmap = new Map(providers.map((p) => [p.id, p]))
  const acc = new Map<string, ProviderGgr>()
  for (const s of stats) {
    const p = pmap.get(s.providerId)
    let row = acc.get(s.providerId)
    if (!row) {
      row = {
        providerId: s.providerId,
        providerName: p?.name ?? s.providerName,
        aggregatorId: p?.aggregatorId ?? null,
        status: p?.status ?? null,
        logoHue: p?.logoHue ?? 0,
        bets: 0,
        wins: 0,
        ggr: 0,
        rtp: 0,
        feePct: p?.feePct ?? 0,
        fee: 0,
        net: 0,
        rounds: 0,
        players: 0,
        games: 0,
      }
      acc.set(s.providerId, row)
    }
    row.bets += s.bets
    row.wins += s.wins
    row.ggr += s.ggr
    row.rounds += s.rounds
    row.players += s.players
    row.games += 1
  }
  return [...acc.values()]
    .map((r) => {
      const fee = providerFee(r.ggr, r.feePct)
      return { ...r, rtp: r.bets ? r.wins / r.bets : 0, fee, net: r.ggr - fee }
    })
    .sort((a, b) => b.ggr - a.ggr)
}

// ---------- Meses ----------

/** "AAAA-MM" de uma data (fuso local) */
export function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number)
  return { from: new Date(y, m - 1, 1), to: endOfDay(new Date(y, m, 0)) }
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "setembro de 2026" ou "set/2026" */
export function monthLabel(month: string, style: 'long' | 'short' = 'long') {
  const [y, m] = month.split('-').map(Number)
  const name = MONTHS[m - 1]
  return style === 'long' ? `${name} de ${y}` : `${name.slice(0, 3)}/${y}`
}

/** Os últimos n meses, do mais recente ao mais antigo (inclui o atual). */
export function lastMonths(n: number, now: Date): string[] {
  return Array.from({ length: n }, (_, i) => monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)))
}

export function monthEnded(month: string, now: Date) {
  return now.getTime() > monthBounds(month).to.getTime()
}

// ---------- Apurações ----------

export type SettlementStatus = 'aberta' | 'fechada' | 'paga'

export const SETTLEMENT_STATUS_LABEL: Record<SettlementStatus, string> = {
  aberta: 'Aberta',
  fechada: 'Fechada',
  paga: 'Paga',
}

export interface Settlement {
  id: string
  /** "AAAA-MM" */
  month: string
  providerId: string
  providerName: string
  bets: number
  wins: number
  ggr: number
  /** taxa congelada no fechamento (na aberta, vale a taxa atual da provedora) */
  feePct: number
  feeDue: number
  status: SettlementStatus
  /** vencimento do pagamento: dia 10 do mês seguinte */
  dueDate: string
  closedAt: string | null
  closedBy: string | null
  paidAt: string | null
  paidBy: string | null
  paymentRef: string | null
}

/**
 * Permissão usada para fechar e pagar apurações (especial da tela de GGR,
 * concedida a Financeiro, Administrador e Superadmin).
 */
export const SETTLEMENT_PERMISSION = 'ggr.apurar'

export function dueDateFor(month: string) {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 10, 12).toISOString()
}

/** Valores da apuração como aparecem: aberta usa a taxa atual da provedora; fechada e paga usam a congelada. */
export function settlementView(s: Settlement, currentFeePct: number | undefined) {
  if (s.status !== 'aberta' || currentFeePct === undefined) return { feePct: s.feePct, feeDue: s.feeDue }
  return { feePct: currentFeePct, feeDue: providerFee(s.ggr, currentFeePct) }
}

/** Motivo de não poder fechar, ou null. Só fecha mês encerrado e apuração aberta. */
export function closeBlocker(s: Settlement, now: Date): string | null {
  if (s.status !== 'aberta') return 'Esta apuração já foi fechada.'
  if (!monthEnded(s.month, now)) return `O mês de ${monthLabel(s.month)} ainda não terminou. A apuração fecha a partir do dia 1º do mês seguinte.`
  return null
}

/** Motivo de não poder marcar como paga, ou null. Só paga apuração fechada. */
export function payBlocker(s: Settlement): string | null {
  if (s.status === 'aberta') return 'Feche a apuração antes de registrar o pagamento.'
  if (s.status === 'paga') return 'Esta apuração já foi paga.'
  return null
}

/** Brasília: UTC−3 o ano todo (sem horário de verão desde 2019). */
const BRT_OFFSET_MS = 3 * 3600_000

/**
 * Fim do dia do vencimento em Brasília (00:00 do dia seguinte). "Vence no dia 10" vale o dia 10 inteiro: antes a
 * apuração virava "Vencida" às 09:00 do próprio dia 10 (o vencimento é gravado ao meio-dia UTC).
 */
export function dueDayEnd(dueDate: string): number {
  const t = new Date(dueDate).getTime()
  if (Number.isNaN(t)) return Number.NaN
  const brt = new Date(t - BRT_OFFSET_MS)
  return Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate() + 1) + BRT_OFFSET_MS
}

export function isOverdue(s: Settlement, now: Date) {
  return s.status === 'fechada' && s.feeDue > 0 && now.getTime() >= dueDayEnd(s.dueDate)
}

/** Fechada, a pagar, e hoje (Brasília) é o dia do vencimento. */
export function isDueToday(s: Settlement, now: Date) {
  const end = dueDayEnd(s.dueDate)
  return s.status === 'fechada' && s.feeDue > 0 && now.getTime() < end && now.getTime() >= end - 86_400_000
}

/** Referência de pagamento: 6 a 40 caracteres (TED, PIX E2E ou número do comprovante). */
export function validatePaymentRef(v: string): string | null {
  const s = v.trim()
  if (s.length < 6) return 'Informe a referência do pagamento (mínimo 6 caracteres).'
  if (s.length > 40) return 'Use até 40 caracteres.'
  return null
}

/**
 * Ajusta as estatísticas por jogo para que a soma do GGR bata com o GGR real do
 * período (a distribuição por jogo é uma estimativa; o total vem da série diária).
 * Mantém o apostado de cada jogo e recalcula o pago.
 */
export function reconcileStats(stats: GameStat[], totalBets: number, totalWins: number): GameStat[] {
  const target = totalBets - totalWins
  const current = stats.reduce((s, x) => s + x.ggr, 0)
  if (!current || !Number.isFinite(target)) return stats
  const k = target / current
  return stats.map((s) => {
    const ggr = s.ggr * k
    return { ...s, ggr, wins: s.bets - ggr }
  })
}
