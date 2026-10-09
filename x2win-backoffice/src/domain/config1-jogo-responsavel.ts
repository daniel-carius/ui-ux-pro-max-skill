// Regras de Configurações › Jogo responsável (Lei 14.790/2023 e portarias da SPA/MF).
// As ferramentas exigidas ficam sempre disponíveis ao jogador; o painel só ajusta
// os parâmetros. Diminuir um limite vale na hora; aumentar respeita o prazo de espera.
import type { Player } from '@/data/players'

export const RG_KEY = 'config.jogo-responsavel'

export type Period = 'daily' | 'weekly' | 'monthly'
export const PERIODS: Period[] = ['daily', 'weekly', 'monthly']
export const PERIOD_LABEL: Record<Period, string> = { daily: 'Diário', weekly: 'Semanal', monthly: 'Mensal' }

export type PauseOption = '24h' | '7d' | '30d'
export const PAUSE_OPTIONS: { id: PauseOption; label: string; hours: number }[] = [
  { id: '24h', label: '24 horas', hours: 24 },
  { id: '7d', label: '7 dias', hours: 24 * 7 },
  { id: '30d', label: '30 dias', hours: 24 * 30 },
]

export type ExclusionOption = '6m' | '1a' | '2a' | '5a' | 'permanente'
export const EXCLUSION_OPTIONS: { id: ExclusionOption; label: string }[] = [
  { id: '6m', label: '6 meses' },
  { id: '1a', label: '1 ano' },
  { id: '2a', label: '2 anos' },
  { id: '5a', label: '5 anos' },
  { id: 'permanente', label: 'Permanente' },
]

export interface LimitPair {
  /** limite que já vem ativo em contas novas (0 = sem limite padrão) */
  default: number
  /** maior limite que o jogador pode escolher */
  max: number
}

export interface RgConfig {
  deposit: Record<Period, LimitPair>
  loss: Record<Period, LimitPair>
  session: { everyMinutes: number; showSummary: boolean; requireAck: boolean }
  pause: Record<PauseOption, boolean>
  exclusion: Record<ExclusionOption, boolean>
  /** espera para um aumento de limite valer */
  coolingOffHours: 24 | 72
  messages: { items: string[]; footer: boolean; deposit: boolean; session: boolean }
}

export const DEFAULT_RG: RgConfig = {
  deposit: {
    daily: { default: 0, max: 10_000 },
    weekly: { default: 0, max: 30_000 },
    monthly: { default: 0, max: 100_000 },
  },
  loss: {
    daily: { default: 0, max: 5_000 },
    weekly: { default: 0, max: 15_000 },
    monthly: { default: 0, max: 50_000 },
  },
  session: { everyMinutes: 60, showSummary: true, requireAck: true },
  pause: { '24h': true, '7d': true, '30d': true },
  exclusion: { '6m': true, '1a': true, '2a': true, '5a': false, permanente: true },
  coolingOffHours: 72,
  messages: {
    items: [
      'Aposte com responsabilidade. Jogo é diversão, não fonte de renda.',
      'Defina um limite antes de começar e respeite esse limite.',
      'Nunca tente recuperar perdas aumentando as apostas.',
      'Precisa de uma pausa? Acesse Minha conta › Jogo responsável.',
    ],
    footer: true,
    deposit: true,
    session: true,
  },
}

export const SESSION_MIN = 15
export const SESSION_MAX = 120
export const MESSAGE_MAX = 140

export function limitErrors(pairs: Record<Period, LimitPair>, what: string): string | null {
  for (const p of PERIODS) {
    const v = pairs[p]
    if (!(v.max > 0)) return `${what} ${PERIOD_LABEL[p].toLowerCase()}: o máximo precisa ser maior que zero.`
    if (v.default < 0) return `${what} ${PERIOD_LABEL[p].toLowerCase()}: o padrão não pode ser negativo.`
    if (v.default > v.max) return `${what} ${PERIOD_LABEL[p].toLowerCase()}: o padrão não pode passar do máximo.`
  }
  if (pairs.daily.max > pairs.weekly.max || pairs.weekly.max > pairs.monthly.max) return `${what}: o máximo diário não pode passar do semanal, nem o semanal do mensal.`
  return null
}

export function validateRg(c: RgConfig): string | null {
  return (
    limitErrors(c.deposit, 'Limite de depósito') ??
    limitErrors(c.loss, 'Limite de perda') ??
    (c.session.everyMinutes < SESSION_MIN || c.session.everyMinutes > SESSION_MAX
      ? `O alerta de sessão precisa ser entre ${SESSION_MIN} e ${SESSION_MAX} minutos.`
      : null) ??
    (!Object.values(c.pause).some(Boolean) ? 'Ofereça ao menos uma duração de pausa.' : null) ??
    (!Object.values(c.exclusion).some(Boolean) ? 'Ofereça ao menos um prazo de autoexclusão.' : null) ??
    (c.messages.items.some((m) => !m.trim()) ? 'Há uma mensagem de jogo responsável em branco.' : null) ??
    (c.messages.items.some((m) => m.length > MESSAGE_MAX) ? `As mensagens têm no máximo ${MESSAGE_MAX} caracteres.` : null) ??
    (c.messages.items.length === 0 ? 'Cadastre ao menos uma mensagem de jogo responsável.' : null)
  )
}

/**
 * Quando a troca de limite pedida pelo jogador passa a valer.
 * 0 = sem limite. Diminuir (ou criar) um limite vale na hora; aumentar ou
 * remover espera o prazo de reflexão (cooling-off).
 */
export function limitChangeEffect(current: number, next: number, coolingOffHours: number, now: Date = new Date()) {
  const cur = current > 0 ? current : Infinity
  const nxt = next > 0 ? next : Infinity
  if (nxt <= cur) return { immediate: true, effectiveAt: now, kind: nxt === cur ? ('igual' as const) : ('reducao' as const) }
  return { immediate: false, effectiveAt: new Date(now.getTime() + coolingOffHours * 3_600_000), kind: 'aumento' as const }
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Indicadores (o limite ativo por jogador é simulado de forma determinística). */
export function rgPlayerStats(players: Player[]) {
  const paused = players.filter((p) => p.status === 'pausa').length
  const excluded = players.filter((p) => p.status === 'autoexcluido').length
  const withLimit = players.filter((p) => p.status === 'ativo' && p.depositsCount > 0 && hash(p.id) % 100 < 14).length
  const waitingIncrease = players.filter((p) => p.status === 'ativo' && hash(`${p.id}:inc`) % 100 < 2).length
  const depositors = players.filter((p) => p.depositsCount > 0).length
  return { paused, excluded, withLimit, waitingIncrease, depositors, total: players.length }
}
