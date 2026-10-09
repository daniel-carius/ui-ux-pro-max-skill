// Roletas de prêmios por grupo de jogadores.
import { rewardCost, type CoinInfo, type RewardKind } from './campanhas2-common'

export type WheelGroup = 'todos' | 'novos' | 'vip'
export type PrizeKind = Extract<RewardKind, 'bonus_brl' | 'free_spins' | 'moedas' | 'nada'>
export type ColorSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export const WHEEL_GROUP_LABEL: Record<WheelGroup, string> = { todos: 'Todos', novos: 'Novos', vip: 'VIP' }
export const WHEEL_GROUP_HINT: Record<WheelGroup, string> = {
  todos: 'Qualquer jogador logado',
  novos: 'Cadastro há até 7 dias',
  vip: 'Jogadores com a etiqueta VIP',
}

export const PRIZE_KIND_LABEL: Record<PrizeKind, string> = {
  bonus_brl: 'Bônus em R$',
  free_spins: 'Free spins',
  moedas: 'Moedas',
  nada: 'Nada',
}

export interface WheelPrize {
  id: string
  label: string
  kind: PrizeKind
  value: number
  /** chance em % (soma de todos = 100) */
  probability: number
  slot: ColorSlot
}

export interface Wheel {
  id: string
  name: string
  group: WheelGroup
  prizes: WheelPrize[]
  spinsPerDay: number
  /** moedas para girar (0 = grátis) */
  costCoins: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface WheelSpin {
  id: string
  wheelId: string
  wheelName: string
  playerId: string
  playerName: string
  prizeLabel: string
  kind: PrizeKind
  value: number
  costCoins: number
  at: string
}

export const MAX_PRIZES = 12
export const MIN_PRIZES = 2

const round2 = (n: number) => Math.round(n * 100) / 100

export function probabilitySum(prizes: Pick<WheelPrize, 'probability'>[]) {
  return round2(prizes.reduce((s, p) => s + (Number.isFinite(p.probability) ? p.probability : 0), 0))
}

export interface WheelErrors {
  name?: string
  spinsPerDay?: string
  costCoins?: string
  prizes?: string
  sum?: string
  prize: Record<string, string>
}

export function wheelErrors(w: Wheel): WheelErrors {
  const e: WheelErrors = { prize: {} }
  if (!w.name.trim()) e.name = 'Dê um nome para a roleta.'
  if (!Number.isInteger(w.spinsPerDay) || w.spinsPerDay < 1 || w.spinsPerDay > 50) e.spinsPerDay = 'Entre 1 e 50 giros por dia.'
  if (!Number.isInteger(w.costCoins) || w.costCoins < 0) e.costCoins = 'Use um número inteiro (0 = grátis).'
  if (w.prizes.length < MIN_PRIZES) e.prizes = `A roleta precisa de pelo menos ${MIN_PRIZES} prêmios.`
  if (w.prizes.length > MAX_PRIZES) e.prizes = `No máximo ${MAX_PRIZES} prêmios.`
  for (const p of w.prizes) {
    if (!p.label.trim()) e.prize[p.id] = 'Informe o rótulo.'
    else if (p.kind !== 'nada' && !(p.value > 0)) e.prize[p.id] = 'O valor precisa ser maior que zero.'
    else if (!(p.probability >= 0) || p.probability > 100) e.prize[p.id] = 'Chance entre 0% e 100%.'
  }
  const sum = probabilitySum(w.prizes)
  if (Math.abs(sum - 100) > 0.001) e.sum = `As chances somam ${sum.toLocaleString('pt-BR')}%. Ajuste para 100%.`
  return e
}

export function hasWheelErrors(e: WheelErrors) {
  return !!(e.name || e.spinsPerDay || e.costCoins || e.prizes || e.sum || Object.keys(e.prize).length)
}

/** Sorteia um prêmio pela chance. `r` em [0, 1). */
export function pickPrize(prizes: WheelPrize[], r: number): WheelPrize {
  const live = prizes.filter((p) => p.probability > 0)
  const total = probabilitySum(live) || 1
  let acc = r * total
  for (const p of live) {
    acc -= p.probability
    if (acc < 0) return p
  }
  return live[live.length - 1] ?? prizes[0]
}

export interface WheelSegment {
  prize: WheelPrize
  /** graus, sentido horário a partir do topo */
  start: number
  end: number
  mid: number
}

/** Fatias da roleta: tamanho proporcional à chance. Prêmios com 0% não aparecem. */
export function wheelSegments(prizes: WheelPrize[]): WheelSegment[] {
  const live = prizes.filter((p) => p.probability > 0)
  const total = probabilitySum(live) || 1
  let a = 0
  return live.map((p) => {
    const size = (p.probability / total) * 360
    const seg = { prize: p, start: a, end: a + size, mid: a + size / 2 }
    a += size
    return seg
  })
}

/**
 * Rotação final (graus, horário) para o ponteiro do topo parar dentro da fatia,
 * longe das bordas. `jitter` em [0, 1) escolhe o ponto dentro da fatia.
 */
export function rotationFor(current: number, seg: WheelSegment, jitter: number, turns = 6): number {
  const size = seg.end - seg.start
  const target = seg.start + size * (0.18 + 0.64 * jitter)
  const want = (360 - target) % 360
  const now = ((current % 360) + 360) % 360
  const delta = (want - now + 360) % 360
  return current + turns * 360 + delta
}

export function prizeCost(p: Pick<WheelPrize, 'kind' | 'value'>, coin: Pick<CoinInfo, 'refValue'>) {
  return rewardCost({ kind: p.kind, value: p.value }, coin)
}

/** Custo esperado de um giro para a casa (R$). */
export function expectedCostPerSpin(prizes: WheelPrize[], coin: Pick<CoinInfo, 'refValue'>) {
  const total = probabilitySum(prizes) || 1
  return prizes.reduce((s, p) => s + (p.probability / total) * prizeCost(p, coin), 0)
}

/** Chance de não ganhar nada (%). */
export function blankChance(prizes: WheelPrize[]) {
  return probabilitySum(prizes.filter((p) => p.kind === 'nada'))
}

/** Outra roleta ativa no mesmo grupo (o jogador só vê uma por grupo). */
export function conflictingWheel(all: Wheel[], w: Pick<Wheel, 'id' | 'group'>): Wheel | undefined {
  return all.find((x) => x.id !== w.id && x.active && x.group === w.group)
}

/** Divide 100% igualmente; a sobra do arredondamento vai para o último. */
export function distributeEvenly(prizes: WheelPrize[]): WheelPrize[] {
  if (!prizes.length) return prizes
  const each = Math.floor((100 / prizes.length) * 100) / 100
  return prizes.map((p, i) => ({ ...p, probability: i === prizes.length - 1 ? round2(100 - each * (prizes.length - 1)) : each }))
}

/** Ajusta o último prêmio para a soma fechar em 100%. */
export function completeWithLast(prizes: WheelPrize[]): WheelPrize[] {
  if (!prizes.length) return prizes
  const others = probabilitySum(prizes.slice(0, -1))
  const last = round2(Math.max(0, 100 - others))
  return prizes.map((p, i) => (i === prizes.length - 1 ? { ...p, probability: last } : p))
}

/** Rótulo sugerido para o prêmio a partir do tipo e valor. */
export function suggestPrizeLabel(kind: PrizeKind, value: number, symbol: string) {
  if (kind === 'nada') return 'Tente de novo'
  if (kind === 'bonus_brl') return `R$ ${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} bônus`
  if (kind === 'free_spins') return `${value} giros`
  return `${value} ${symbol}`
}
