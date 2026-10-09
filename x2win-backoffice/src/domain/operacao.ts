// Regras do módulo Operação › Depósitos: limites da tela de depósito, campanhas
// exibidas, cálculo de bônus, indicadores e linha do tempo de cada PIX.
import type { Deposit, DepositStatus } from '@/data/finance'
import { brl, time } from '@/lib/format'

export const OPERACAO_KEYS = {
  depositLimits: 'operacao.depositos.limites',
  depositCampaigns: 'operacao.depositos.campanhas',
} as const

// ---------- Limites e tela de depósito ----------

export interface DepositLimits {
  min: number
  max: number
  /** soma máxima depositada por jogador por dia */
  dailyLimit: number
  /** botões de valor rápido na tela de depósito */
  quickAmounts: number[]
  /** valor que já vem marcado (0 = nenhum) */
  defaultAmount: number
  pixExpirationMin: number
  showBonusSelector: boolean
  mainGateway: string
  /** usado se o principal falhar ('' = sem reserva) */
  fallbackGateway: string
  /** só aceita PIX vindo de conta no CPF do jogador */
  holderOnly: boolean
}

export const DEFAULT_DEPOSIT_LIMITS: DepositLimits = {
  min: 10,
  max: 10000,
  dailyLimit: 20000,
  quickAmounts: [20, 50, 100, 200, 500, 1000],
  defaultAmount: 50,
  pixExpirationMin: 30,
  showBonusSelector: true,
  mainGateway: 'PagFlex',
  fallbackGateway: 'PixNow',
  holderOnly: true,
}

export const MAX_QUICK_AMOUNTS = 6

export type LimitErrors = Partial<Record<keyof DepositLimits, string>>

export function depositLimitErrors(v: DepositLimits): LimitErrors {
  const e: LimitErrors = {}
  if (!(v.min >= 1)) e.min = 'O mínimo precisa ser de pelo menos R$ 1,00.'
  if (!(v.max > v.min)) e.max = 'O máximo precisa ser maior que o mínimo.'
  if (!(v.dailyLimit >= v.max)) e.dailyLimit = 'O limite diário não pode ser menor que o depósito máximo.'
  if (v.quickAmounts.length === 0) e.quickAmounts = 'Cadastre pelo menos um valor rápido.'
  else if (v.quickAmounts.length > MAX_QUICK_AMOUNTS) e.quickAmounts = `Use até ${MAX_QUICK_AMOUNTS} valores rápidos.`
  else {
    const out = v.quickAmounts.filter((a) => a < v.min || a > v.max)
    if (out.length) e.quickAmounts = `${out.map((a) => brl(a)).join(', ')} fora da faixa entre mínimo e máximo.`
  }
  if (v.defaultAmount !== 0 && !v.quickAmounts.includes(v.defaultAmount)) e.defaultAmount = 'Escolha um dos valores rápidos.'
  if (!(v.pixExpirationMin >= 5 && v.pixExpirationMin <= 1440)) e.pixExpirationMin = 'Use entre 5 e 1.440 minutos.'
  if (v.fallbackGateway && v.fallbackGateway === v.mainGateway) e.fallbackGateway = 'O reserva precisa ser diferente do principal.'
  return e
}

export function validateDepositLimits(v: DepositLimits): string | null {
  const e = depositLimitErrors(v)
  const first = Object.values(e)[0]
  return first ?? null
}

/** Valida um novo valor rápido antes de incluir. */
export function quickAmountError(value: number, v: DepositLimits): string | null {
  if (!(value > 0)) return 'Informe um valor.'
  if (value < v.min || value > v.max) return `Use um valor entre ${brl(v.min)} e ${brl(v.max)}.`
  if (v.quickAmounts.includes(value)) return 'Esse valor já está na lista.'
  if (v.quickAmounts.length >= MAX_QUICK_AMOUNTS) return `Limite de ${MAX_QUICK_AMOUNTS} valores rápidos.`
  return null
}

// ---------- Campanhas na tela de depósito ----------

export type DepositCampaignStatus = 'ativa' | 'pausada' | 'encerrada'

export interface DepositCampaign {
  id: string
  name: string
  /** percentual do depósito dado como bônus */
  bonusPct: number
  minDeposit: number
  maxBonus: number
  /** vezes o valor do bônus que o jogador precisa apostar */
  rollover: number
  status: DepositCampaignStatus
  /** aparece na tela de depósito */
  visible: boolean
  endsAt: string | null
  audience: string
}

export interface DepositCampaignsConfig {
  items: DepositCampaign[]
  /** quantas ofertas aparecem no máximo */
  maxVisible: number
  /** já marcar a primeira oferta */
  preselectFirst: boolean
}

export const DEPOSIT_CAMPAIGN_STATUS_LABEL: Record<DepositCampaignStatus, string> = {
  ativa: 'Ativa',
  pausada: 'Pausada',
  encerrada: 'Encerrada',
}

/** Ofertas que o jogador vê, na ordem: ativas, marcadas como visíveis, até o limite. */
export function shownCampaigns(cfg: DepositCampaignsConfig) {
  return cfg.items.filter((c) => c.status === 'ativa' && c.visible).slice(0, Math.max(0, cfg.maxVisible))
}

export function campaignSummary(c: DepositCampaign) {
  return `${c.bonusPct}% até ${brl(c.maxBonus)} · mín. ${brl(c.minDeposit)} · rollover ${c.rollover}x`
}

export function computeBonus(amount: number, c: DepositCampaign): { eligible: boolean; bonus: number; wagerTarget: number; reason?: string } {
  if (amount < c.minDeposit) return { eligible: false, bonus: 0, wagerTarget: 0, reason: `Depósito mínimo de ${brl(c.minDeposit)}` }
  const bonus = Math.round(Math.min((amount * c.bonusPct) / 100, c.maxBonus) * 100) / 100
  return { eligible: true, bonus, wagerTarget: Math.round(bonus * c.rollover * 100) / 100 }
}

export function validateCampaignsConfig(cfg: DepositCampaignsConfig): string | null {
  if (!(cfg.maxVisible >= 1 && cfg.maxVisible <= 5)) return 'Mostre entre 1 e 5 ofertas.'
  if (cfg.items.some((c) => c.visible && c.status !== 'ativa')) return 'Só campanhas ativas podem aparecer na tela de depósito.'
  return null
}

// ---------- Depósitos ----------

export const DEPOSIT_STATUS_TONE: Record<DepositStatus, 'success' | 'warning' | 'neutral' | 'danger' | 'info'> = {
  pago: 'success',
  pendente: 'warning',
  expirado: 'neutral',
  falhou: 'danger',
  estornado: 'info',
}

export function depositStats(list: Deposit[]) {
  let paid = 0
  let paidCount = 0
  let pending = 0
  let pendingCount = 0
  let ftdCount = 0
  let ftdAmount = 0
  for (const d of list) {
    if (d.status === 'pago') {
      paid += d.amount
      paidCount++
      if (d.isFirst) {
        ftdCount++
        ftdAmount += d.amount
      }
    } else if (d.status === 'pendente') {
      pending += d.amount
      pendingCount++
    }
  }
  // PIX ainda aguardando não entra na conversão: pode ser pago
  const decided = list.length - pendingCount
  return {
    paid,
    paidCount,
    pending,
    pendingCount,
    generated: list.length,
    conversion: decided > 0 ? paidCount / decided : 0,
    avgTicket: paidCount ? paid / paidCount : 0,
    ftdCount,
    ftdAmount,
  }
}

export function pixDeadline(d: Deposit, expirationMin: number) {
  return new Date(new Date(d.createdAt).getTime() + expirationMin * 60_000)
}

export function isPixOverdue(d: Deposit, expirationMin: number, now = Date.now()) {
  return d.status === 'pendente' && pixDeadline(d, expirationMin).getTime() < now
}

/** Reconsulta no gateway: PIX vencido sem pagamento vira "expirado"; dentro do prazo segue aguardando. */
export function recheckStatus(d: Deposit, expirationMin: number, now = Date.now()): DepositStatus {
  if (d.status !== 'pendente') return d.status
  return isPixOverdue(d, expirationMin, now) ? 'expirado' : 'pendente'
}

export interface TimelineStep {
  label: string
  at: string | null
  tone: 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'primary'
  description?: string
}

export function depositTimeline(d: Deposit, expirationMin: number, now = Date.now()): TimelineStep[] {
  const steps: TimelineStep[] = [{ label: 'PIX gerado', at: d.createdAt, tone: 'info', description: `QR code de ${brl(d.amount)} criado no ${d.gateway}.` }]
  if (d.bonusCampaign) steps.push({ label: 'Bônus escolhido', at: d.createdAt, tone: 'primary', description: d.bonusCampaign })
  const deadline = pixDeadline(d, expirationMin)
  switch (d.status) {
    case 'pago':
      steps.push({ label: 'Pagamento confirmado', at: d.updatedAt, tone: 'success', description: `O ${d.gateway} confirmou o PIX pela referência E2E.` })
      steps.push({ label: 'Saldo creditado', at: d.updatedAt, tone: 'success', description: `${brl(d.amount)} no saldo real do jogador.` })
      if (d.bonusCampaign) steps.push({ label: 'Bônus creditado', at: d.updatedAt, tone: 'primary', description: 'Valor do bônus no saldo bônus, com rollover.' })
      if (d.isFirst) steps.push({ label: 'Webhook de 1º depósito', at: d.updatedAt, tone: 'neutral', description: 'Evento enviado aos destinos de webhook e pixels.' })
      break
    case 'pendente':
      if (deadline.getTime() < now) {
        steps.push({ label: 'Prazo do PIX venceu', at: deadline.toISOString(), tone: 'danger', description: 'Segue como aguardando. Reconsulte o gateway para dar baixa.' })
      } else {
        steps.push({ label: 'Aguardando pagamento', at: null, tone: 'warning', description: `O código vale até ${time(deadline)}.` })
      }
      break
    case 'expirado':
      steps.push({ label: 'PIX expirou sem pagamento', at: d.updatedAt, tone: 'neutral', description: 'Nenhum valor entrou na carteira.' })
      break
    case 'falhou':
      steps.push({ label: 'Gateway recusou a cobrança', at: d.updatedAt, tone: 'danger', description: 'O jogador viu um erro e pode tentar de novo.' })
      break
    case 'estornado':
      steps.push({ label: 'Pagamento confirmado', at: d.createdAt, tone: 'success' })
      steps.push({ label: 'PIX devolvido ao pagador', at: d.updatedAt, tone: 'warning', description: 'Estorno feito pelo gateway; o valor saiu da carteira.' })
      break
  }
  return steps
}
