// Níveis e XP: trilha de níveis, benefícios e regras de ganho de XP.
// Lido também por Cashback (cashback por nível), Disparos e Jornadas (nível mínimo).
import { GAME_CATEGORY_LABEL, type GameCategory } from '@/data/catalog'
import { useDb } from '@/lib/store'

export type ColorSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export const COLOR_SLOTS: ColorSlot[] = [1, 2, 3, 4, 5, 6, 7, 8]
export const slotColor = (s: ColorSlot) => `var(--chart-${s})`

export type BetCategory = GameCategory | 'esportes'
export const BET_CATEGORIES: BetCategory[] = ['slots', 'ao_vivo', 'crash', 'mesa', 'instantaneo', 'bingo', 'esportes']
export const BET_CATEGORY_LABEL: Record<BetCategory, string> = { ...GAME_CATEGORY_LABEL, esportes: 'Esportes' }

export interface Level {
  id: string
  name: string
  /** XP acumulado para chegar ao nível */
  xp: number
  slot: ColorSlot
  /** cashback da perda líquida, em % (usado quando o cashback é "por nível") */
  cashbackPct: number
  priorityWithdrawal: boolean
  /** presente em saldo ao subir para este nível */
  levelUpGift: number
  /** giros grátis ao subir */
  freeSpins: number
}

export interface XpRules {
  /** XP a cada R$ 10 apostados, por categoria */
  perTen: Record<BetCategory, number>
  /** XP por depósito pago */
  depositXp: number
  /** depósito mínimo para ganhar XP */
  depositMin: number
  /** apostas feitas com saldo bônus também geram XP */
  bonusBetsCount: boolean
  event: { enabled: boolean; name: string; multiplier: number; weekdays: number[] }
}

export interface LevelsConfig {
  enabled: boolean
  /** o nível conquistado não cai */
  keepLevel: boolean
  levels: Level[]
  xp: XpRules
}

export const NIVEIS_KEY = 'campanhas.niveis'

const L = (id: string, name: string, xp: number, slot: ColorSlot, cashbackPct: number, priorityWithdrawal: boolean, levelUpGift: number, freeSpins: number): Level => ({
  id,
  name,
  xp,
  slot,
  cashbackPct,
  priorityWithdrawal,
  levelUpGift,
  freeSpins,
})

export const DEFAULT_LEVELS_CONFIG: LevelsConfig = {
  enabled: true,
  keepLevel: true,
  levels: [
    L('lv1', 'Novato', 0, 7, 0, false, 0, 0),
    L('lv2', 'Bronze', 50, 2, 1, false, 5, 10),
    L('lv3', 'Prata', 150, 1, 2, false, 10, 20),
    L('lv4', 'Ouro', 400, 4, 3, false, 20, 30),
    L('lv5', 'Platina', 1000, 3, 4, true, 50, 50),
    L('lv6', 'Esmeralda', 2000, 6, 5, true, 100, 75),
    L('lv7', 'Rubi', 4000, 8, 6, true, 200, 100),
    L('lv8', 'Diamante', 7000, 1, 8, true, 400, 150),
    L('lv9', 'Mestre', 12000, 5, 10, true, 800, 200),
    L('lv10', 'Lenda', 25000, 4, 12, true, 1500, 300),
  ],
  xp: {
    perTen: { slots: 1, ao_vivo: 0.5, crash: 0.5, mesa: 0.5, instantaneo: 0.5, bingo: 0.5, esportes: 1 },
    depositXp: 5,
    depositMin: 20,
    bonusBetsCount: false,
    event: { enabled: true, name: 'Fim de semana em dobro', multiplier: 2, weekdays: [6, 0] },
  },
}

export const WEEKDAYS = [
  { value: 1, short: 'Seg', label: 'Segunda' },
  { value: 2, short: 'Ter', label: 'Terça' },
  { value: 3, short: 'Qua', label: 'Quarta' },
  { value: 4, short: 'Qui', label: 'Quinta' },
  { value: 5, short: 'Sex', label: 'Sexta' },
  { value: 6, short: 'Sáb', label: 'Sábado' },
  { value: 0, short: 'Dom', label: 'Domingo' },
]

export function useLevelsConfig() {
  return useDb<LevelsConfig>(NIVEIS_KEY, DEFAULT_LEVELS_CONFIG)
}

export type LevelFieldErrors = { name?: string; xp?: string; cashbackPct?: string; levelUpGift?: string; freeSpins?: string }

/** Erros por nível (para mostrar na linha). */
export function levelErrors(levels: Level[]): Record<string, LevelFieldErrors> {
  const out: Record<string, LevelFieldErrors> = {}
  const names = new Map<string, number>()
  levels.forEach((l) => {
    const k = l.name.trim().toLowerCase()
    if (k) names.set(k, (names.get(k) ?? 0) + 1)
  })
  levels.forEach((l, i) => {
    const e: LevelFieldErrors = {}
    if (!l.name.trim()) e.name = 'Dê um nome ao nível.'
    else if (l.name.trim().length > 24) e.name = 'Use até 24 caracteres.'
    else if ((names.get(l.name.trim().toLowerCase()) ?? 0) > 1) e.name = 'Nome repetido.'
    if (!Number.isFinite(l.xp) || l.xp < 0) e.xp = 'XP inválido.'
    else if (i === 0 && l.xp !== 0) e.xp = 'O primeiro nível começa em 0 XP.'
    else if (i > 0 && l.xp <= levels[i - 1].xp) e.xp = `Precisa ser maior que ${levels[i - 1].xp.toLocaleString('pt-BR')} XP.`
    if (l.cashbackPct < 0 || l.cashbackPct > 30) e.cashbackPct = 'De 0% a 30%.'
    if (l.levelUpGift < 0) e.levelUpGift = 'Valor inválido.'
    if (l.freeSpins < 0 || !Number.isInteger(l.freeSpins)) e.freeSpins = 'Número inteiro.'
    if (Object.keys(e).length) out[l.id] = e
  })
  return out
}

/** Benefícios que diminuem ao subir de nível (aviso, não bloqueia). */
export function levelWarnings(levels: Level[]): Record<string, string> {
  const out: Record<string, string> = {}
  levels.forEach((l, i) => {
    if (i === 0) return
    const prev = levels[i - 1]
    if (l.cashbackPct < prev.cashbackPct) out[l.id] = `Cashback menor que o de ${prev.name}.`
    else if (prev.priorityWithdrawal && !l.priorityWithdrawal) out[l.id] = `Perde o saque prioritário que ${prev.name} tem.`
  })
  return out
}

export function validateLevelsConfig(c: LevelsConfig): string | null {
  if (c.levels.length < 2) return 'A trilha precisa de pelo menos 2 níveis.'
  if (c.levels.length > 20) return 'Use no máximo 20 níveis.'
  const errs = levelErrors(c.levels)
  const first = Object.entries(errs)[0]
  if (first) {
    const lv = c.levels.find((l) => l.id === first[0])
    const msg = Object.values(first[1])[0]
    return `${lv?.name.trim() || 'Nível sem nome'}: ${msg}`
  }
  for (const cat of BET_CATEGORIES) {
    const v = c.xp.perTen[cat]
    if (!Number.isFinite(v) || v < 0 || v > 20) return `XP de ${BET_CATEGORY_LABEL[cat]} precisa estar entre 0 e 20.`
  }
  if (c.xp.depositXp < 0) return 'XP por depósito não pode ser negativo.'
  if (c.xp.event.enabled) {
    if (c.xp.event.multiplier < 1 || c.xp.event.multiplier > 5) return 'O multiplicador do evento vai de 1x a 5x.'
    if (!c.xp.event.weekdays.length) return 'Escolha ao menos um dia para o evento de XP.'
    if (!c.xp.event.name.trim()) return 'Dê um nome ao evento de XP.'
  }
  return null
}

/** Índice (0 = primeiro) do nível para um total de XP. */
export function levelIndexForXp(levels: Level[], xp: number): number {
  let idx = 0
  for (let i = 0; i < levels.length; i++) if (xp >= levels[i].xp) idx = i
  return idx
}

export function levelProgress(levels: Level[], xp: number) {
  const index = levelIndexForXp(levels, xp)
  const level = levels[index]
  const next = levels[index + 1] ?? null
  const span = next ? next.xp - level.xp : 1
  const pct = next ? Math.max(0, Math.min(1, (xp - level.xp) / span)) : 1
  return { index, level, next, pct, remaining: next ? Math.max(0, next.xp - xp) : 0 }
}

export interface XpActivity {
  bets: Partial<Record<BetCategory, number>>
  deposits: number
  depositAmount: number
  eventDay: boolean
}

/** Quanto XP uma atividade gera com as regras atuais. */
export function computeXp(rules: XpRules, a: XpActivity) {
  const lines: { label: string; xp: number; detail: string }[] = []
  for (const cat of BET_CATEGORIES) {
    const amount = a.bets[cat] ?? 0
    if (!amount) continue
    const xp = (amount / 10) * rules.perTen[cat]
    lines.push({ label: `Apostas em ${BET_CATEGORY_LABEL[cat]}`, xp, detail: `${(amount / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} × ${rules.perTen[cat].toLocaleString('pt-BR')} XP` })
  }
  if (a.deposits > 0) {
    const counts = a.depositAmount >= rules.depositMin
    lines.push({
      label: 'Depósitos',
      xp: counts ? a.deposits * rules.depositXp : 0,
      detail: counts ? `${a.deposits} × ${rules.depositXp} XP` : `abaixo do mínimo de R$ ${rules.depositMin.toLocaleString('pt-BR')}`,
    })
  }
  const base = lines.reduce((s, l) => s + l.xp, 0)
  const mult = a.eventDay && rules.event.enabled ? rules.event.multiplier : 1
  return { lines, base: Math.floor(base), multiplier: mult, total: Math.floor(base * mult) }
}

/** Benefícios em texto curto, para listas e prévias. */
export function levelPerks(l: Level, opts?: { brl?: (v: number) => string }) {
  const money = opts?.brl ?? ((v: number) => `R$ ${v.toLocaleString('pt-BR')}`)
  const perks: { key: string; label: string }[] = []
  if (l.cashbackPct > 0) perks.push({ key: 'cashback', label: `${l.cashbackPct.toLocaleString('pt-BR')}% de cashback` })
  if (l.priorityWithdrawal) perks.push({ key: 'saque', label: 'Saque prioritário' })
  if (l.levelUpGift > 0) perks.push({ key: 'presente', label: `${money(l.levelUpGift)} ao subir` })
  if (l.freeSpins > 0) perks.push({ key: 'giros', label: `${l.freeSpins} giros grátis` })
  return perks
}
