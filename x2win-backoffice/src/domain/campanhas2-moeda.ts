// Moeda do site (Evox Coins, EVC): identidade, validade e regras de ganho.
import type { GameCategory } from '@/data/catalog'
import type { CoinInfo } from './campanhas2-common'

export type EarnCategory = GameCategory | 'esportes'

export const EARN_CATEGORIES: EarnCategory[] = ['slots', 'ao_vivo', 'crash', 'mesa', 'instantaneo', 'bingo', 'esportes']

export const EARN_CATEGORY_LABEL: Record<EarnCategory, string> = {
  slots: 'Slots',
  ao_vivo: 'Cassino ao vivo',
  crash: 'Crash',
  mesa: 'Jogos de mesa',
  instantaneo: 'Instantâneos',
  bingo: 'Bingo',
  esportes: 'Apostas esportivas',
}

/** Base das regras de aposta e depósito: moedas a cada R$ 10. */
export const EARN_BASE = 10

export interface EarnToggle {
  enabled: boolean
  amount: number
}

export interface CoinConfig {
  name: string
  symbol: string
  /** imagem do ícone (data URL); null usa o ícone padrão */
  icon: string | null
  /** quanto vale 1 moeda em R$ (referência para custos e para a loja) */
  refValue: number
  expires: boolean
  /** moedas ganhas há mais de N dias somem do saldo */
  expiryDays: number
  /** saldo de moedas aparece no topo do site */
  showInHeader: boolean
  /** teto de moedas ganhas por jogador por dia (0 = sem teto) */
  dailyCap: number
  bets: { enabled: boolean; rates: Record<EarnCategory, EarnToggle> }
  deposit: EarnToggle
  dailyLogin: EarnToggle & { streakBonus: number }
  mission: EarnToggle
  levelUp: EarnToggle
}

export const DEFAULT_COIN_CONFIG: CoinConfig = {
  name: 'Evox Coins',
  symbol: 'EVC',
  icon: null,
  refValue: 0.01,
  expires: true,
  expiryDays: 90,
  showInHeader: true,
  dailyCap: 2000,
  bets: {
    enabled: true,
    rates: {
      slots: { enabled: true, amount: 10 },
      ao_vivo: { enabled: true, amount: 5 },
      crash: { enabled: true, amount: 5 },
      mesa: { enabled: true, amount: 3 },
      instantaneo: { enabled: true, amount: 5 },
      bingo: { enabled: false, amount: 8 },
      esportes: { enabled: true, amount: 8 },
    },
  },
  deposit: { enabled: true, amount: 5 },
  dailyLogin: { enabled: true, amount: 10, streakBonus: 50 },
  mission: { enabled: false, amount: 25 },
  levelUp: { enabled: true, amount: 100 },
}

export function coinInfo(c: Pick<CoinConfig, 'symbol' | 'name' | 'refValue'>): CoinInfo {
  return { symbol: c.symbol || 'EVC', name: c.name || 'Moedas', refValue: c.refValue > 0 ? c.refValue : 0.01 }
}

export function coinsToBrl(coins: number, refValue: number) {
  return coins * refValue
}

/** Retorno equivalente de uma regra de aposta: fração do valor apostado devolvida em moedas. */
export function coinReturnRate(amountPerBase: number, refValue: number) {
  return (amountPerBase * refValue) / EARN_BASE
}

export interface CoinConfigErrors {
  name?: string
  symbol?: string
  refValue?: string
  expiryDays?: string
  dailyCap?: string
  amounts?: string
}

export function coinConfigErrors(c: CoinConfig): CoinConfigErrors {
  const e: CoinConfigErrors = {}
  if (!c.name.trim()) e.name = 'Informe o nome da moeda.'
  else if (c.name.trim().length > 24) e.name = 'Use até 24 caracteres.'
  if (!/^[A-Z0-9]{2,5}$/.test(c.symbol)) e.symbol = 'Use de 2 a 5 letras maiúsculas ou números.'
  if (!(c.refValue > 0)) e.refValue = 'O valor precisa ser maior que zero.'
  else if (c.refValue > 10) e.refValue = 'Valor muito alto: 1 moeda deve valer no máximo R$ 10,00.'
  if (c.expires && (!Number.isInteger(c.expiryDays) || c.expiryDays < 1)) e.expiryDays = 'Informe pelo menos 1 dia.'
  if (c.dailyCap < 0 || !Number.isInteger(c.dailyCap)) e.dailyCap = 'Use um número inteiro, 0 para sem teto.'
  const amounts = [
    ...Object.values(c.bets.rates).map((r) => r.amount),
    c.deposit.amount,
    c.dailyLogin.amount,
    c.dailyLogin.streakBonus,
    c.mission.amount,
    c.levelUp.amount,
  ]
  if (amounts.some((a) => a < 0 || !Number.isInteger(a))) e.amounts = 'As quantidades de moedas precisam ser números inteiros, a partir de 0.'
  return e
}

export function validateCoinConfig(c: CoinConfig): string | null {
  const e = coinConfigErrors(c)
  return e.name ?? e.symbol ?? e.refValue ?? e.expiryDays ?? e.dailyCap ?? e.amounts ?? null
}

/** Quantas regras de ganho estão ligadas. */
export function activeEarnRules(c: CoinConfig) {
  const bets = c.bets.enabled ? EARN_CATEGORIES.filter((k) => c.bets.rates[k].enabled).length : 0
  return bets + [c.deposit, c.dailyLogin, c.mission, c.levelUp].filter((r) => r.enabled).length
}

// ---------- Simulador ----------

export interface EarnSimInput {
  bets: Partial<Record<EarnCategory, number>>
  deposit: number
  /** fez login hoje */
  login: boolean
  /** hoje é o 7º dia seguido de login */
  streakDay: boolean
  missions: number
  levels: number
}

export interface EarnSimLine {
  label: string
  coins: number
  detail: string
}

export interface EarnSimResult {
  lines: EarnSimLine[]
  gross: number
  total: number
  capped: boolean
  brl: number
  /** custo em R$ sobre o total apostado (fração) */
  costOnWagered: number | null
}

/** Quanto um jogador ganha em um dia com estas regras (moedas inteiras, arredondadas para baixo). */
export function simulateEarnings(c: CoinConfig, input: EarnSimInput): EarnSimResult {
  const lines: EarnSimLine[] = []
  let wagered = 0
  if (c.bets.enabled) {
    for (const k of EARN_CATEGORIES) {
      const amount = input.bets[k] ?? 0
      if (!amount) continue
      wagered += amount
      const rule = c.bets.rates[k]
      const coins = rule.enabled ? Math.floor(amount / EARN_BASE) * rule.amount : 0
      lines.push({
        label: `Apostas em ${EARN_CATEGORY_LABEL[k].toLowerCase()}`,
        coins,
        detail: rule.enabled ? `${rule.amount} a cada R$ ${EARN_BASE}` : 'regra desligada',
      })
    }
  } else {
    wagered = Object.values(input.bets).reduce((s, v) => s + (v ?? 0), 0)
    if (wagered) lines.push({ label: 'Apostas', coins: 0, detail: 'ganho por aposta desligado' })
  }
  if (input.deposit > 0) {
    lines.push({
      label: 'Depósito',
      coins: c.deposit.enabled ? Math.floor(input.deposit / EARN_BASE) * c.deposit.amount : 0,
      detail: c.deposit.enabled ? `${c.deposit.amount} a cada R$ ${EARN_BASE}` : 'regra desligada',
    })
  }
  if (input.login) {
    const coins = c.dailyLogin.enabled ? c.dailyLogin.amount + (input.streakDay ? c.dailyLogin.streakBonus : 0) : 0
    lines.push({
      label: input.streakDay ? 'Login diário (7º dia seguido)' : 'Login diário',
      coins,
      detail: c.dailyLogin.enabled ? (input.streakDay ? `${c.dailyLogin.amount} + ${c.dailyLogin.streakBonus} de sequência` : `${c.dailyLogin.amount} por dia`) : 'regra desligada',
    })
  }
  if (input.missions > 0) {
    lines.push({
      label: `${input.missions} ${input.missions === 1 ? 'missão concluída' : 'missões concluídas'}`,
      coins: c.mission.enabled ? input.missions * c.mission.amount : 0,
      detail: c.mission.enabled ? `${c.mission.amount} extras por missão` : 'regra desligada',
    })
  }
  if (input.levels > 0) {
    lines.push({
      label: `Subiu ${input.levels} ${input.levels === 1 ? 'nível' : 'níveis'}`,
      coins: c.levelUp.enabled ? input.levels * c.levelUp.amount : 0,
      detail: c.levelUp.enabled ? `${c.levelUp.amount} por nível` : 'regra desligada',
    })
  }
  const gross = lines.reduce((s, l) => s + l.coins, 0)
  const capped = c.dailyCap > 0 && gross > c.dailyCap
  const total = capped ? c.dailyCap : gross
  const brl = coinsToBrl(total, c.refValue)
  return { lines, gross, total, capped, brl, costOnWagered: wagered > 0 ? brl / wagered : null }
}
