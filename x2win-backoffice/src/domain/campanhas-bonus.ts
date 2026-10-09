// Bônus de depósito (cálculo com teto e rollover) e saldo bônus (onde vale, ordem de uso
// e quanto de cada aposta conta para o rollover). Funções puras.
import { brl, mult, num } from '@/lib/format'

// ---------- Bônus de depósito ----------

export type RolloverBase = 'bonus' | 'deposito_bonus'
export type BonusUsage = 'uma_vez' | 'cada_deposito' | 'diario'
export type DepositTrigger = 'qualquer' | 'primeiro' | 'segundo' | 'terceiro'

export interface DepositBonusCampaign {
  id: string
  name: string
  active: boolean
  /** % do depósito pago em bônus */
  bonusPct: number
  minDeposit: number
  /** teto do bônus em R$ */
  maxBonus: number
  /** vezes (x) */
  rollover: number
  rolloverBase: RolloverBase
  usage: BonusUsage
  depositTrigger: DepositTrigger
  /** dias para cumprir o rollover antes do bônus expirar */
  validityDays: number
  redemptions: number
  bonusGranted: number
  bonusConverted: number
  createdAt: string
  updatedAt: string
  updatedBy: string
}

export const ROLLOVER_BASE_LABEL: Record<RolloverBase, string> = {
  bonus: 'Só o bônus',
  deposito_bonus: 'Depósito + bônus',
}

export const USAGE_LABEL: Record<BonusUsage, string> = {
  uma_vez: 'Uma vez por jogador',
  cada_deposito: 'Em todo depósito',
  diario: 'Uma vez por dia',
}

export const TRIGGER_LABEL: Record<DepositTrigger, string> = {
  qualquer: 'Qualquer depósito',
  primeiro: '1º depósito',
  segundo: '2º depósito',
  terceiro: '3º depósito',
}

export interface DepositBonusResult {
  eligible: boolean
  reason: string | null
  bonus: number
  capped: boolean
  /** valor sobre o qual o rollover é calculado */
  rolloverBaseValue: number
  rolloverRequired: number
  /** depósito + bônus */
  playable: number
  /** % efetivo depois do teto */
  effectivePct: number
}

/** Quanto de bônus um depósito gera e quanto precisa ser apostado. */
export function calcDepositBonus(c: Pick<DepositBonusCampaign, 'bonusPct' | 'minDeposit' | 'maxBonus' | 'rollover' | 'rolloverBase'>, deposit: number): DepositBonusResult {
  const d = Math.max(0, deposit || 0)
  if (d < c.minDeposit) {
    return { eligible: false, reason: `Abaixo do depósito mínimo de ${brl(c.minDeposit)}.`, bonus: 0, capped: false, rolloverBaseValue: 0, rolloverRequired: 0, playable: d, effectivePct: 0 }
  }
  const raw = (d * c.bonusPct) / 100
  const capped = c.maxBonus > 0 && raw > c.maxBonus
  const bonus = round2(capped ? c.maxBonus : raw)
  const base = c.rolloverBase === 'bonus' ? bonus : d + bonus
  return {
    eligible: true,
    reason: capped ? `Bateu no teto de ${brl(c.maxBonus)}.` : null,
    bonus,
    capped,
    rolloverBaseValue: round2(base),
    rolloverRequired: round2(base * c.rollover),
    playable: round2(d + bonus),
    effectivePct: d ? bonus / d : 0,
  }
}

/** Depósito a partir do qual o bônus bate no teto. */
export function capDeposit(c: Pick<DepositBonusCampaign, 'bonusPct' | 'maxBonus'>) {
  return c.bonusPct > 0 ? round2((c.maxBonus * 100) / c.bonusPct) : 0
}

export function bonusSummary(c: Pick<DepositBonusCampaign, 'bonusPct' | 'maxBonus'>) {
  return `${num(c.bonusPct)}% até ${brl(c.maxBonus)}`
}

export function rolloverSummary(c: Pick<DepositBonusCampaign, 'rollover' | 'rolloverBase'>) {
  if (c.rollover === 0) return 'Sem rollover'
  return `${mult(c.rollover)} sobre ${c.rolloverBase === 'bonus' ? 'o bônus' : 'depósito + bônus'}`
}

export function validateDepositBonus(c: DepositBonusCampaign): Record<string, string> {
  const e: Record<string, string> = {}
  if (c.name.trim().length < 4) e.name = 'Dê um nome com pelo menos 4 letras.'
  if (c.bonusPct <= 0 || c.bonusPct > 500) e.bonusPct = 'Entre 1% e 500%.'
  if (c.minDeposit <= 0) e.minDeposit = 'Precisa ser maior que zero.'
  if (c.maxBonus <= 0) e.maxBonus = 'Defina um teto para o bônus.'
  else if (c.minDeposit > 0 && c.maxBonus < (c.minDeposit * c.bonusPct) / 100) e.maxBonus = `O teto é menor que o bônus do depósito mínimo (${brl((c.minDeposit * c.bonusPct) / 100)}).`
  if (c.rollover < 0 || c.rollover > 100) e.rollover = 'Entre 0x e 100x.'
  if (c.validityDays < 1 || c.validityDays > 90) e.validityDays = 'Entre 1 e 90 dias.'
  return e
}

/** Campanhas ativas que disputam o mesmo depósito. */
export function depositConflicts(c: DepositBonusCampaign, others: DepositBonusCampaign[]) {
  return others.filter((o) => o.id !== c.id && o.active && (o.depositTrigger === c.depositTrigger || o.depositTrigger === 'qualquer' || c.depositTrigger === 'qualquer'))
}

// ---------- Saldo bônus ----------

export type BonusScope = 'todos' | 'selecionados' | 'exceto'
export type SpendOrder = 'bonus_primeiro' | 'real_primeiro'
export type RolloverCount = 'aposta_inteira' | 'parte_bonus'

export interface BonusWalletConfig {
  scope: BonusScope
  gameIds: string[]
  order: SpendOrder
  rolloverCount: RolloverCount
  /** aposta máxima enquanto houver saldo bônus em uso (0 = sem limite) */
  maxBetWithBonus: number
  validityDays: number
}

export const BONUS_WALLET_KEY = 'campanhas.saldo-bonus'

export const DEFAULT_BONUS_WALLET: BonusWalletConfig = {
  scope: 'todos',
  gameIds: [],
  order: 'bonus_primeiro',
  rolloverCount: 'aposta_inteira',
  maxBetWithBonus: 25,
  validityDays: 30,
}

export function validateBonusWallet(v: BonusWalletConfig): string | null {
  if (v.scope !== 'todos' && v.gameIds.length === 0) return v.scope === 'selecionados' ? 'Escolha pelo menos um jogo onde o bônus vale.' : 'Escolha pelo menos um jogo para excluir.'
  if (v.maxBetWithBonus < 0) return 'A aposta máxima não pode ser negativa.'
  if (v.validityDays < 1 || v.validityDays > 365) return 'A validade precisa ficar entre 1 e 365 dias.'
  return null
}

/** O saldo bônus pode ser usado neste jogo? */
export function bonusAppliesToGame(cfg: Pick<BonusWalletConfig, 'scope' | 'gameIds'>, gameId: string | null): boolean {
  if (!gameId || cfg.scope === 'todos') return true
  const listed = cfg.gameIds.includes(gameId)
  return cfg.scope === 'selecionados' ? listed : !listed
}

export interface BetInput {
  bet: number
  bonusBalance: number
  realBalance: number
  gameId: string | null
}

export interface BetSplit {
  ok: boolean
  reason: string | null
  bonusAllowed: boolean
  fromBonus: number
  fromReal: number
  bonusAfter: number
  realAfter: number
  /** valor que entra no rollover do bônus (antes do peso do tipo de jogo) */
  countsForRollover: number
}

/** Divide uma aposta entre saldo bônus e saldo real conforme a configuração. */
export function splitBet(cfg: BonusWalletConfig, input: BetInput): BetSplit {
  const bet = round2(Math.max(0, input.bet))
  const bonusAllowed = bonusAppliesToGame(cfg, input.gameId)
  const bonusAvail = bonusAllowed ? Math.max(0, input.bonusBalance) : 0
  const real = Math.max(0, input.realBalance)
  const fail = (reason: string): BetSplit => ({ ok: false, reason, bonusAllowed, fromBonus: 0, fromReal: 0, bonusAfter: input.bonusBalance, realAfter: real, countsForRollover: 0 })
  if (bet <= 0) return fail('Informe o valor da aposta.')
  if (bet > round2(bonusAvail + real)) {
    return fail(bonusAllowed ? `Saldo insuficiente: o jogador tem ${brl(bonusAvail + real)} para apostar.` : `Saldo bônus não vale neste jogo e o saldo real (${brl(real)}) não cobre a aposta.`)
  }
  let fromBonus: number
  let fromReal: number
  if (cfg.order === 'bonus_primeiro') {
    fromBonus = Math.min(bet, bonusAvail)
    fromReal = bet - fromBonus
  } else {
    fromReal = Math.min(bet, real)
    fromBonus = bet - fromReal
  }
  fromBonus = round2(fromBonus)
  fromReal = round2(fromReal)
  if (fromBonus > 0 && cfg.maxBetWithBonus > 0 && bet > cfg.maxBetWithBonus) {
    return fail(`Aposta acima do máximo com bônus (${brl(cfg.maxBetWithBonus)}). Enquanto o saldo bônus estiver em uso, cada aposta vai até esse valor.`)
  }
  const counts = !bonusAllowed || input.bonusBalance <= 0 ? 0 : cfg.rolloverCount === 'aposta_inteira' ? bet : fromBonus
  return {
    ok: true,
    reason: null,
    bonusAllowed,
    fromBonus,
    fromReal,
    bonusAfter: round2(input.bonusBalance - fromBonus),
    realAfter: round2(real - fromReal),
    countsForRollover: round2(counts),
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}
