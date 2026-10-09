// Indicação: baús liberados por número de indicados válidos.
// Regra da especificação: o programa pode ser ligado ou desligado. Desligado,
// some do site e nenhum baú é aberto.
import { rewardCost, type CoinInfo, type RewardKind } from './campanhas2-common'

export type ChestRewardKind = Extract<RewardKind, 'bonus_brl' | 'free_spins' | 'moedas' | 'dinheiro'>

export const CHEST_REWARD_LABEL: Record<ChestRewardKind, string> = {
  bonus_brl: 'Bônus em R$',
  dinheiro: 'Saldo real',
  free_spins: 'Free spins',
  moedas: 'Moedas',
}

export interface Chest {
  id: string
  /** indicados válidos necessários */
  referrals: number
  kind: ChestRewardKind
  value: number
}

export interface ValidReferralRules {
  /** soma dos depósitos do indicado */
  minDeposit: number
  /** total apostado pelo indicado */
  minWager: number
  requireKyc: boolean
  /** dias após o cadastro para cumprir as condições */
  windowDays: number
  /** indicado com o mesmo IP de quem indicou não conta */
  blockSameIp: boolean
}

export interface ReferralConfig {
  chests: Chest[]
  rules: ValidReferralRules
  /** rollover das recompensas em bônus (x); 0 = sem rollover */
  rollover: number
  /** máximo de indicados que contam por jogador (0 = sem limite) */
  maxReferrals: number
}

export interface ReferralStatus {
  enabled: boolean
  changedAt: string | null
  changedBy: string | null
}

export const DEFAULT_REFERRAL_STATUS: ReferralStatus = { enabled: true, changedAt: null, changedBy: null }

export const DEFAULT_REFERRAL_CONFIG: ReferralConfig = {
  chests: [
    { id: 'ch1', referrals: 1, kind: 'bonus_brl', value: 10 },
    { id: 'ch2', referrals: 3, kind: 'free_spins', value: 50 },
    { id: 'ch3', referrals: 5, kind: 'bonus_brl', value: 50 },
    { id: 'ch4', referrals: 10, kind: 'moedas', value: 5000 },
    { id: 'ch5', referrals: 25, kind: 'dinheiro', value: 250 },
  ],
  rules: { minDeposit: 30, minWager: 100, requireKyc: true, windowDays: 30, blockSameIp: true },
  rollover: 10,
  maxReferrals: 50,
}

export const MAX_CHESTS = 10

/** Erros por baú: ordem crescente, valores positivos. */
export function chestErrors(chests: Chest[]): { list?: string; byId: Record<string, string> } {
  const byId: Record<string, string> = {}
  let list: string | undefined
  if (!chests.length) list = 'Cadastre pelo menos um baú.'
  if (chests.length > MAX_CHESTS) list = `No máximo ${MAX_CHESTS} baús.`
  chests.forEach((c, i) => {
    if (!Number.isInteger(c.referrals) || c.referrals < 1) byId[c.id] = 'Pelo menos 1 indicado.'
    else if (i > 0 && c.referrals <= chests[i - 1].referrals) byId[c.id] = `Precisa ser maior que o baú anterior (${chests[i - 1].referrals}).`
    else if (!(c.value > 0)) byId[c.id] = 'A recompensa precisa ser maior que zero.'
    else if ((c.kind === 'free_spins' || c.kind === 'moedas') && !Number.isInteger(c.value)) byId[c.id] = 'Use um número inteiro.'
  })
  return { list, byId }
}

export function validateReferralConfig(c: ReferralConfig): string | null {
  const ch = chestErrors(c.chests)
  if (ch.list) return ch.list
  const first = Object.values(ch.byId)[0]
  if (first) return `Baús: ${first}`
  if (c.rules.minDeposit < 0 || c.rules.minWager < 0) return 'Depósito e aposta mínimos não podem ser negativos.'
  if (!Number.isInteger(c.rules.windowDays) || c.rules.windowDays < 1 || c.rules.windowDays > 365) return 'O prazo do indicado precisa ficar entre 1 e 365 dias.'
  if (c.rollover < 0 || c.rollover > 100) return 'Rollover entre 0x e 100x.'
  if (!Number.isInteger(c.maxReferrals) || c.maxReferrals < 0) return 'Limite de indicados: use um número inteiro (0 = sem limite).'
  if (c.maxReferrals > 0 && c.chests.length && c.maxReferrals < c.chests[c.chests.length - 1].referrals) {
    return `O limite de indicados (${c.maxReferrals}) impede abrir o último baú (${c.chests[c.chests.length - 1].referrals}).`
  }
  return null
}

/** Indicado registrado (dados de demonstração). */
export interface ReferralRecord {
  id: string
  referrerId: string
  referrerName: string
  referrerEmail: string
  referredId: string
  referredName: string
  createdAt: string
  deposited: number
  wagered: number
  kyc: boolean
  sameIp: boolean
  /** dias que o indicado levou para cumprir depósito e aposta */
  daysToQualify: number
}

export function isValidReferral(r: ReferralRecord, rules: ValidReferralRules): boolean {
  if (r.deposited < rules.minDeposit || r.deposited <= 0) return false
  if (r.wagered < rules.minWager) return false
  if (rules.requireKyc && !r.kyc) return false
  if (rules.blockSameIp && r.sameIp) return false
  if (r.daysToQualify > rules.windowDays) return false
  return true
}

export function chestsUnlocked(validCount: number, chests: Chest[]) {
  return chests.filter((c) => validCount >= c.referrals)
}

export function nextChest(validCount: number, chests: Chest[]): Chest | null {
  return chests.find((c) => validCount < c.referrals) ?? null
}

export function chestCost(c: Pick<Chest, 'kind' | 'value'>, coin: Pick<CoinInfo, 'refValue'>) {
  return rewardCost({ kind: c.kind, value: c.value }, coin)
}

export interface ReferrerSummary {
  referrerId: string
  name: string
  email: string
  referred: number
  valid: number
  opened: number
  next: Chest | null
  cost: number
}

export interface ReferralStats {
  referred: number
  valid: number
  referrers: ReferrerSummary[]
  activeReferrers: number
  chestsOpened: number
  cost: number
  /** quantos jogadores abriram cada baú (mesma ordem de chests) */
  byChest: number[]
}

/**
 * Indicadores do programa com as regras dadas. Com o programa desligado,
 * nenhum baú é aberto (contagem e custo zerados).
 */
export function referralStats(records: ReferralRecord[], cfg: ReferralConfig, enabled: boolean, coin: Pick<CoinInfo, 'refValue'>): ReferralStats {
  const map = new Map<string, ReferrerSummary>()
  for (const r of records) {
    let s = map.get(r.referrerId)
    if (!s) {
      s = { referrerId: r.referrerId, name: r.referrerName, email: r.referrerEmail, referred: 0, valid: 0, opened: 0, next: null, cost: 0 }
      map.set(r.referrerId, s)
    }
    s.referred++
    if (isValidReferral(r, cfg.rules)) s.valid++
  }
  const byChest = cfg.chests.map(() => 0)
  let opened = 0
  let cost = 0
  let valid = 0
  for (const s of map.values()) {
    const counted = cfg.maxReferrals > 0 ? Math.min(s.valid, cfg.maxReferrals) : s.valid
    valid += s.valid
    s.next = nextChest(counted, cfg.chests)
    if (!enabled) continue
    cfg.chests.forEach((c, i) => {
      if (counted >= c.referrals) {
        byChest[i]++
        s.opened++
        s.cost += chestCost(c, coin)
      }
    })
    opened += s.opened
    cost += s.cost
  }
  const referrers = [...map.values()].sort((a, b) => b.valid - a.valid || b.referred - a.referred)
  return { referred: records.length, valid, referrers, activeReferrers: referrers.filter((r) => r.valid > 0).length, chestsOpened: opened, cost, byChest }
}
