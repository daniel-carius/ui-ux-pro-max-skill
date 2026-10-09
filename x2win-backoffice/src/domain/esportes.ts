// Regras do módulo Esportes (consulta de apostas do sportsbook).
// O painel só lê: quem liquida, cancela ou ajusta bilhetes é o provedor (Betby).
import type { SportsBet, SportsBetStatus } from '@/data/sports'

/** Status que entram no GGR: a aposta foi decidida e o prêmio (se houve) foi pago. */
export const GGR_STATUSES: SportsBetStatus[] = ['ganha', 'perdida', 'cashout']
/** Status em que o valor apostado volta ao jogador. */
export const REFUND_STATUSES: SportsBetStatus[] = ['cancelada', 'reembolsada']

export const BET_TYPE_LABEL: Record<SportsBet['type'], string> = {
  simples: 'Simples',
  multipla: 'Múltipla',
  sistema: 'Sistema',
}

export function betSearchText(b: SportsBet) {
  return `${b.id} ${b.playerName} ${b.selections.map((s) => `${s.event} ${s.league} ${s.market} ${s.pick}`).join(' ')}`
}

export function sportsTotals(bets: SportsBet[]) {
  let staked = 0
  let paid = 0
  let refunded = 0
  let settledStake = 0
  let won = 0
  let cashouts = 0
  for (const b of bets) {
    staked += b.stake
    if (GGR_STATUSES.includes(b.status)) {
      settledStake += b.stake
      paid += b.paid
      if (b.status === 'ganha') won++
      if (b.status === 'cashout') cashouts++
    } else if (REFUND_STATUSES.includes(b.status)) {
      refunded += b.paid
    }
  }
  const ggr = settledStake - paid
  return { staked, paid, refunded, settledStake, ggr, margin: settledStake ? ggr / settledStake : 0, won, cashouts, count: bets.length }
}

/** Exposição: quanto a casa pagaria se todas as apostas abertas ganhassem. */
export function exposure(open: SportsBet[]) {
  const stake = open.reduce((s, b) => s + b.stake, 0)
  const potential = open.reduce((s, b) => s + b.potential, 0)
  return { stake, potential, liability: potential - stake }
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export type LegResult = 'ganhou' | 'perdeu' | 'aberta' | 'anulada' | 'encerrada'

export const LEG_RESULT_LABEL: Record<LegResult, string> = {
  ganhou: 'Acertou',
  perdeu: 'Errou',
  aberta: 'Em aberto',
  anulada: 'Anulada',
  encerrada: 'Cash out',
}

/** Resultado de cada seleção do bilhete (derivado do status do bilhete). */
export function legResults(b: SportsBet, now = Date.now()): LegResult[] {
  const n = b.selections.length
  switch (b.status) {
    case 'ganha':
      return b.selections.map(() => 'ganhou')
    case 'perdida': {
      const loser = hash(b.id) % n
      return b.selections.map((_, i) => (i === loser ? 'perdeu' : 'ganhou'))
    }
    case 'aberta':
      // seleção já encerrada num bilhete aberto só pode ter sido acerto
      return b.selections.map((s) => (new Date(s.startsAt).getTime() + 2 * 3_600_000 < now ? 'ganhou' : 'aberta'))
    case 'cashout':
      return b.selections.map(() => 'encerrada')
    default:
      return b.selections.map(() => 'anulada')
  }
}

/** Fim estimado do último evento do bilhete (início + 2 h). */
export function betSettlesAt(b: SportsBet) {
  return Math.max(...b.selections.map((s) => new Date(s.startsAt).getTime())) + 2 * 3_600_000
}

/**
 * Simula a sincronização com o provedor: bilhetes abertos cujos eventos já
 * terminaram são liquidados pela Betby (até `max` por consulta).
 */
export function settleFromFeed(bets: SportsBet[], now = Date.now(), max = 5): { next: SportsBet[]; settled: SportsBet[] } {
  const due = bets
    .filter((b) => b.status === 'aberta' && betSettlesAt(b) <= now)
    .sort((a, b) => betSettlesAt(a) - betSettlesAt(b))
    .slice(0, max)
  if (!due.length) return { next: bets, settled: [] }
  const ids = new Set(due.map((b) => b.id))
  const settled: SportsBet[] = []
  const next = bets.map((b) => {
    if (!ids.has(b.id)) return b
    // chance de acerto coerente com a odd (com a margem da casa)
    const win = (hash(b.id) % 10_000) / 10_000 < 0.92 / b.odd
    const s: SportsBet = { ...b, status: win ? 'ganha' : 'perdida', paid: win ? b.potential : 0 }
    settled.push(s)
    return s
  })
  return { next, settled }
}
