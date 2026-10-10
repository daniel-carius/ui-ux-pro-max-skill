// Cupons: código digitado pelo jogador que libera uma recompensa.
import { brl, num } from '@/lib/format'
import type { CampaignPlayer } from './campanhas-jogador'
import { AUDIENCE_LABEL, inAudience, rewardCost, rewardText, type Audience, type CoinInfo } from './campanhas2-common'

export type CouponReward = 'bonus_pct' | 'bonus_brl' | 'free_spins' | 'moedas'
export type CouponStatus = 'ativo' | 'pausado' | 'agendado' | 'expirado' | 'esgotado'

export const COUPON_REWARD_LABEL: Record<CouponReward, string> = {
  bonus_pct: 'Bônus %',
  bonus_brl: 'Bônus em R$',
  free_spins: 'Free spins',
  moedas: 'Moedas',
}

export const COUPON_STATUS_LABEL: Record<CouponStatus, string> = {
  ativo: 'Ativo',
  pausado: 'Pausado',
  agendado: 'Agendado',
  expirado: 'Expirado',
  esgotado: 'Esgotado',
}

export interface Coupon {
  id: string
  code: string
  reward: CouponReward
  value: number
  /** teto do bônus % em R$ (0 = sem teto) */
  maxBonus: number
  /** rollover do bônus (x) */
  rollover: number
  /** usos máximos no total (0 = ilimitado) */
  maxUses: number
  perPlayer: number
  startsAt: string
  endsAt: string
  audience: Audience
  /** depósito mínimo para resgatar (0 = sem depósito) */
  minDeposit: number
  paused: boolean
  uses: number
  createdAt: string
  createdBy: string
}

export interface CouponRedemption {
  id: string
  couponId: string
  code: string
  playerId: string
  playerName: string
  /** vem da plataforma (mascarado para quem não vê dados pessoais); o painel nunca grava resgates no modo API */
  playerEmail?: string
  deposit: number
  reward: string
  /** custo para a casa (R$) */
  cost: number
  at: string
}

export const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,18}[A-Z0-9]$/

export function normalizeCode(s: string) {
  return s.trim().toUpperCase().replace(/\s+/g, '')
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Código fácil de digitar (sem 0/O e 1/I): "X2W-7K4Q9P". */
export function generateCode(rand: () => number = Math.random, prefix = 'X2W', len = 6) {
  let s = ''
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)]
  return `${prefix}-${s}`
}

/** Gera um código que ainda não existe. */
export function uniqueCode(existing: string[], rand: () => number = Math.random) {
  const taken = new Set(existing.map(normalizeCode))
  for (let i = 0; i < 50; i++) {
    const c = generateCode(rand)
    if (!taken.has(c)) return c
  }
  return generateCode(rand, 'X2W', 8)
}

export function couponStatus(c: Coupon, now: Date = new Date()): CouponStatus {
  if (c.maxUses > 0 && c.uses >= c.maxUses) return 'esgotado'
  if (new Date(c.endsAt).getTime() < now.getTime()) return 'expirado'
  if (c.paused) return 'pausado'
  if (new Date(c.startsAt).getTime() > now.getTime()) return 'agendado'
  return 'ativo'
}

export type CouponErrors = Partial<Record<'code' | 'value' | 'maxBonus' | 'rollover' | 'maxUses' | 'perPlayer' | 'period' | 'minDeposit', string>>

export function couponErrors(c: Coupon, others: Coupon[]): CouponErrors {
  const e: CouponErrors = {}
  const code = normalizeCode(c.code)
  if (!code) e.code = 'Informe o código.'
  else if (!CODE_RE.test(code)) e.code = 'De 4 a 20 caracteres: letras, números e hífen (sem começar ou terminar com hífen).'
  else if (others.some((o) => o.id !== c.id && normalizeCode(o.code) === code)) e.code = `O código ${code} já existe. Códigos não diferenciam maiúsculas de minúsculas.`
  if (!(c.value > 0)) e.value = 'O valor precisa ser maior que zero.'
  else if (c.reward === 'bonus_pct' && c.value > 500) e.value = 'Bônus de no máximo 500%.'
  else if ((c.reward === 'free_spins' || c.reward === 'moedas') && !Number.isInteger(c.value)) e.value = 'Use um número inteiro.'
  if (c.reward === 'bonus_pct' && c.maxBonus < 0) e.maxBonus = 'Teto inválido.'
  if (c.rollover < 0 || c.rollover > 100) e.rollover = 'Rollover entre 0x e 100x.'
  if (!Number.isInteger(c.maxUses) || c.maxUses < 0) e.maxUses = 'Use um número inteiro (0 = ilimitado).'
  else if (c.maxUses > 0 && c.maxUses < c.uses) e.maxUses = `O cupom já foi usado ${num(c.uses)} vezes.`
  if (!Number.isInteger(c.perPlayer) || c.perPlayer < 1) e.perPlayer = 'Pelo menos 1 uso por jogador.'
  else if (c.maxUses > 0 && c.perPlayer > c.maxUses) e.perPlayer = 'Não pode passar dos usos totais.'
  if (!c.startsAt || !c.endsAt) e.period = 'Informe início e fim.'
  else if (new Date(c.endsAt) <= new Date(c.startsAt)) e.period = 'O fim precisa ser depois do início.'
  if (c.minDeposit < 0) e.minDeposit = 'Valor inválido.'
  else if (c.reward === 'bonus_pct' && c.minDeposit <= 0) e.minDeposit = 'Bônus % precisa de depósito: defina o mínimo.'
  return e
}

export function couponRewardText(c: Pick<Coupon, 'reward' | 'value' | 'maxBonus' | 'rollover'>, coin: Pick<CoinInfo, 'symbol'>) {
  const base = rewardText({ kind: c.reward, value: c.value }, coin)
  const cap = c.reward === 'bonus_pct' && c.maxBonus > 0 ? ` até ${brl(c.maxBonus)}` : ''
  const roll = (c.reward === 'bonus_pct' || c.reward === 'bonus_brl') && c.rollover > 0 ? ` · rollover ${num(c.rollover)}x` : ''
  return base + cap + roll
}

/** Custo de um resgate (R$) dado o depósito. */
export function redemptionCost(c: Coupon, deposit: number, coin: Pick<CoinInfo, 'refValue'>) {
  return rewardCost({ kind: c.reward, value: c.value }, coin, deposit, c.reward === 'bonus_pct' && c.maxBonus > 0 ? c.maxBonus : undefined)
}

/** Custo máximo do cupom se todos os usos forem resgatados (null = ilimitado). */
export function maxCouponCost(c: Coupon, coin: Pick<CoinInfo, 'refValue'>) {
  if (!c.maxUses) return null
  const base = c.reward === 'bonus_pct' ? (c.maxBonus > 0 ? (c.maxBonus * 100) / c.value : Math.max(c.minDeposit, 100)) : 0
  return c.maxUses * redemptionCost(c, base, coin)
}

/** Regras do resgate. Retorna o motivo da recusa ou o custo. */
export function checkRedemption(
  c: Coupon,
  player: Pick<CampaignPlayer, 'id' | 'status' | 'createdAt' | 'lastAccess' | 'tags' | 'depositsCount'>,
  redemptions: Pick<CouponRedemption, 'couponId' | 'playerId'>[],
  deposit: number,
  coin: Pick<CoinInfo, 'refValue'>,
  now: Date = new Date(),
): { ok: true; cost: number } | { ok: false; reason: string } {
  const st = couponStatus(c, now)
  if (st !== 'ativo') return { ok: false, reason: `Cupom ${COUPON_STATUS_LABEL[st].toLowerCase()}.` }
  if (player.status !== 'ativo') return { ok: false, reason: 'Conta do jogador não está ativa.' }
  if (!inAudience(player, c.audience, now)) return { ok: false, reason: `Jogador fora do público (${AUDIENCE_LABEL[c.audience]}).` }
  const mine = redemptions.filter((r) => r.couponId === c.id && r.playerId === player.id).length
  if (mine >= c.perPlayer) return { ok: false, reason: `Limite de ${c.perPlayer} ${c.perPlayer === 1 ? 'uso' : 'usos'} por jogador atingido.` }
  if (c.minDeposit > 0 && deposit < c.minDeposit) return { ok: false, reason: `Depósito abaixo do mínimo de ${brl(c.minDeposit)}.` }
  return { ok: true, cost: redemptionCost(c, deposit, coin) }
}
