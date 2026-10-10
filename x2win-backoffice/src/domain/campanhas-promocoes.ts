// Promoções: tipos, status derivado de datas, validação por etapa e custo por jogador.
// Regras puras: a recriação com servidor deve aplicar as mesmas validações no back-end.
import { brl, date, mult, num } from '@/lib/format'
import type { Player } from '@/data/players'
import type { CampaignPlayer } from './campanhas-jogadores'

export type PromoType = 'bonus_deposito' | 'free_spins' | 'cashback' | 'cupom' | 'torneio' | 'missao'
export type PromoStatus = 'rascunho' | 'agendada' | 'ativa' | 'pausada' | 'encerrada'
export type PromoAudienceKind = 'todos' | 'novos' | 'depositantes' | 'vip' | 'inativos' | 'nivel'
export type PromoChannel = 'banner' | 'popup' | 'notificacao' | 'email' | 'sms'
export type PromoAccent = 'roxo' | 'verde' | 'ouro' | 'azul'
export type CashbackPeriod = 'diario' | 'semanal' | 'mensal'
export type TournamentScoring = 'multiplicador' | 'total_apostado' | 'lucro'
export type MissionGoal = 'apostar' | 'depositar' | 'rodadas'

export interface PromoRules {
  /** % de bônus (depósito) ou de devolução (cashback) */
  pct: number
  minDeposit: number
  /** teto do prêmio por jogador, em R$ (0 = sem teto) */
  maxReward: number
  /** rollover em vezes (x) */
  rollover: number
  spins: number
  spinValue: number
  gameId: string | null
  couponCode: string
  couponValue: number
  /** resgates totais do cupom (0 = sem limite) */
  maxRedemptions: number
  prizePool: number
  scoring: TournamentScoring
  minBet: number
  goal: MissionGoal
  goalTarget: number
  rewardValue: number
  cashbackPeriod: CashbackPeriod
  /** quantas vezes o mesmo jogador pode participar */
  maxPerPlayer: number
}

export interface PromoAudience {
  kind: PromoAudienceKind
  minLevel: number
  inactiveDays: number
  excludeAbusers: boolean
}

export interface PromoComms {
  headline: string
  subtitle: string
  cta: string
  accent: PromoAccent
  channels: PromoChannel[]
  terms: string
}

export interface Promo {
  id: string
  name: string
  type: PromoType
  description: string
  startAt: string
  endAt: string | null
  draft: boolean
  paused: boolean
  /** orçamento total em R$ (0 = sem limite) */
  budget: number
  rules: PromoRules
  audience: PromoAudience
  comms: PromoComms
  participants: number
  cost: number
  createdAt: string
  createdBy: string
  updatedAt: string
}

export const PROMO_TYPE_LABEL: Record<PromoType, string> = {
  bonus_deposito: 'Bônus de depósito',
  free_spins: 'Free spins',
  cashback: 'Cashback',
  cupom: 'Cupom',
  torneio: 'Torneio',
  missao: 'Missão',
}

export const PROMO_TYPE_DESCRIPTION: Record<PromoType, string> = {
  bonus_deposito: 'Bônus em % sobre o depósito, com teto e rollover.',
  free_spins: 'Giros grátis num jogo, liberados por depósito.',
  cashback: 'Devolve parte da perda do período em bônus.',
  cupom: 'Código que o jogador digita para ganhar um bônus.',
  torneio: 'Ranking por pontuação com premiação.',
  missao: 'Objetivo a cumprir em troca de recompensa.',
}

export const PROMO_STATUS_LABEL: Record<PromoStatus, string> = {
  rascunho: 'Rascunho',
  agendada: 'Agendada',
  ativa: 'Ativa',
  pausada: 'Pausada',
  encerrada: 'Encerrada',
}

export const AUDIENCE_LABEL: Record<PromoAudienceKind, string> = {
  todos: 'Todos os jogadores',
  novos: 'Novos (até 30 dias)',
  depositantes: 'Quem já depositou',
  vip: 'Jogadores VIP',
  inativos: 'Inativos',
  nivel: 'A partir de um nível',
}

export const CHANNEL_LABEL: Record<PromoChannel, string> = {
  banner: 'Banner no site',
  popup: 'Popup',
  notificacao: 'Notificação no sino',
  email: 'E-mail',
  sms: 'SMS',
}

export const SCORING_LABEL: Record<TournamentScoring, string> = {
  multiplicador: 'Maior multiplicador',
  total_apostado: 'Total apostado',
  lucro: 'Maior lucro',
}

export const GOAL_LABEL: Record<MissionGoal, string> = {
  apostar: 'Apostar um valor',
  depositar: 'Fazer depósitos',
  rodadas: 'Jogar rodadas',
}

export const CASHBACK_PERIOD_LABEL: Record<CashbackPeriod, string> = {
  diario: 'Diário',
  semanal: 'Semanal',
  mensal: 'Mensal',
}

export const PROMO_STEPS = [
  { id: 'dados', label: 'Dados' },
  { id: 'regras', label: 'Regras' },
  { id: 'publico', label: 'Público' },
  { id: 'comunicacao', label: 'Comunicação' },
  { id: 'revisao', label: 'Revisão' },
] as const

/** Status derivado: rascunho e pausa valem antes das datas. */
export function promoStatus(p: Pick<Promo, 'draft' | 'paused' | 'startAt' | 'endAt'>, now: Date = new Date()): PromoStatus {
  if (p.draft) return 'rascunho'
  const t = now.getTime()
  if (p.endAt && new Date(p.endAt).getTime() < t) return 'encerrada'
  if (p.paused) return 'pausada'
  if (new Date(p.startAt).getTime() > t) return 'agendada'
  return 'ativa'
}

export function defaultRules(): PromoRules {
  return {
    pct: 100,
    minDeposit: 20,
    maxReward: 500,
    rollover: 10,
    spins: 50,
    spinValue: 0.4,
    gameId: null,
    couponCode: '',
    couponValue: 20,
    maxRedemptions: 1000,
    prizePool: 10000,
    scoring: 'multiplicador',
    minBet: 1,
    goal: 'apostar',
    goalTarget: 200,
    rewardValue: 20,
    cashbackPeriod: 'semanal',
    maxPerPlayer: 1,
  }
}

export function emptyPromo(startAt: string): Omit<Promo, 'id' | 'createdAt' | 'createdBy' | 'updatedAt'> {
  return {
    name: '',
    type: 'bonus_deposito',
    description: '',
    startAt,
    endAt: null,
    draft: true,
    paused: false,
    budget: 0,
    rules: defaultRules(),
    audience: { kind: 'todos', minLevel: 5, inactiveDays: 30, excludeAbusers: true },
    comms: { headline: '', subtitle: '', cta: 'Quero participar', accent: 'roxo', channels: ['banner'], terms: '' },
    participants: 0,
    cost: 0,
  }
}

/** Custo máximo que um jogador pode gerar numa participação (sem contar repetições). */
export function maxCostPerPlayer(p: Pick<Promo, 'type' | 'rules'>): number | null {
  const r = p.rules
  switch (p.type) {
    case 'bonus_deposito':
      return r.maxReward > 0 ? r.maxReward : null
    case 'free_spins':
      return r.spins * r.spinValue
    case 'cashback':
      return r.maxReward > 0 ? r.maxReward : null
    case 'cupom':
      return r.couponValue
    case 'torneio':
      return null
    case 'missao':
      return r.rewardValue
  }
}

/** Frase curta com a recompensa. */
export function promoRewardSummary(p: Pick<Promo, 'type' | 'rules'>, gameName?: string): string {
  const r = p.rules
  switch (p.type) {
    case 'bonus_deposito':
      return `${num(r.pct)}% até ${brl(r.maxReward)} · rollover ${mult(r.rollover)}`
    case 'free_spins':
      return `${num(r.spins)} giros de ${brl(r.spinValue)}${gameName ? ` em ${gameName}` : ''}`
    case 'cashback':
      return `${num(r.pct)}% da perda ${CASHBACK_PERIOD_LABEL[r.cashbackPeriod].toLowerCase()}${r.maxReward ? ` até ${brl(r.maxReward)}` : ''}`
    case 'cupom':
      return `${r.couponCode || 'CÓDIGO'} vale ${brl(r.couponValue)} de bônus`
    case 'torneio':
      return `${brl(r.prizePool)} em prêmios · ${SCORING_LABEL[r.scoring].toLowerCase()}`
    case 'missao':
      return `${missionGoalText(r)} → ${brl(r.rewardValue)}`
  }
}

export function missionGoalText(r: PromoRules) {
  if (r.goal === 'apostar') return `Apostar ${brl(r.goalTarget)}`
  if (r.goal === 'depositar') return `Fazer ${num(r.goalTarget)} depósitos`
  return `Jogar ${num(r.goalTarget)} rodadas`
}

/** Texto de destaque padrão para a prévia, quando o título ainda está vazio. */
export function suggestedHeadline(p: Pick<Promo, 'type' | 'rules'>): string {
  const r = p.rules
  switch (p.type) {
    case 'bonus_deposito':
      return r.pct >= 100 ? `Deposite e ganhe ${r.pct === 100 ? 'o dobro' : `${num(r.pct)}%`}` : `${num(r.pct)}% de bônus no depósito`
    case 'free_spins':
      return `${num(r.spins)} giros grátis`
    case 'cashback':
      return `${num(r.pct)}% de cashback`
    case 'cupom':
      return `Cupom de ${brl(r.couponValue)}`
    case 'torneio':
      return `Torneio de ${brl(r.prizePool)}`
    case 'missao':
      return `Missão: ganhe ${brl(r.rewardValue)}`
  }
}

export function periodLabel(p: Pick<Promo, 'startAt' | 'endAt'>) {
  return p.endAt ? `${date(p.startAt)} – ${date(p.endAt)}` : `Desde ${date(p.startAt)} · sem término`
}

export type StepErrors = Record<string, string>

const COUPON_RE = /^[A-Z0-9]{4,16}$/

/** Valida uma etapa do assistente. Retorna { campo: mensagem }. */
export function validatePromoStep(step: number, p: Omit<Promo, 'id' | 'createdAt' | 'createdBy' | 'updatedAt'>, others: Pick<Promo, 'id' | 'rules' | 'type'>[] = [], selfId?: string): StepErrors {
  const e: StepErrors = {}
  const r = p.rules
  if (step === 0) {
    if (p.name.trim().length < 4) e.name = 'Dê um nome com pelo menos 4 letras.'
    if (!p.startAt || Number.isNaN(new Date(p.startAt).getTime())) e.startAt = 'Informe a data de início.'
    if (p.endAt && new Date(p.endAt).getTime() <= new Date(p.startAt).getTime()) e.endAt = 'O término precisa ser depois do início.'
    if (p.budget < 0) e.budget = 'O orçamento não pode ser negativo.'
  }
  if (step === 1) {
    if (r.maxPerPlayer < 1) e.maxPerPlayer = 'Pelo menos 1 participação por jogador.'
    if (['bonus_deposito', 'cashback', 'cupom', 'missao'].includes(p.type) && (r.rollover < 0 || r.rollover > 100)) e.rollover = 'Rollover entre 0x e 100x.'
    switch (p.type) {
      case 'bonus_deposito':
        if (r.pct <= 0 || r.pct > 500) e.pct = 'Use um percentual entre 1% e 500%.'
        if (r.minDeposit <= 0) e.minDeposit = 'O depósito mínimo precisa ser maior que zero.'
        if (r.maxReward <= 0) e.maxReward = 'Defina um teto para o bônus.'
        break
      case 'free_spins':
        if (!r.gameId) e.gameId = 'Escolha o jogo dos giros.'
        if (r.spins < 1 || r.spins > 1000) e.spins = 'Entre 1 e 1.000 giros.'
        if (r.spinValue <= 0) e.spinValue = 'O valor por giro precisa ser maior que zero.'
        break
      case 'cashback':
        if (r.pct <= 0 || r.pct > 50) e.pct = 'Cashback entre 1% e 50%.'
        break
      case 'cupom': {
        const code = r.couponCode.trim().toUpperCase()
        if (!COUPON_RE.test(code)) e.couponCode = 'De 4 a 16 letras ou números, sem espaço.'
        else if (others.some((o) => o.id !== selfId && o.type === 'cupom' && o.rules.couponCode.toUpperCase() === code)) e.couponCode = 'Já existe uma promoção com este código.'
        if (r.couponValue <= 0) e.couponValue = 'O valor do cupom precisa ser maior que zero.'
        break
      }
      case 'torneio':
        if (r.prizePool <= 0) e.prizePool = 'Defina a premiação total.'
        if (r.minBet <= 0) e.minBet = 'A aposta mínima precisa ser maior que zero.'
        break
      case 'missao':
        if (r.goalTarget <= 0) e.goalTarget = 'Defina a meta da missão.'
        if (r.rewardValue <= 0) e.rewardValue = 'Defina a recompensa.'
        break
    }
  }
  if (step === 2) {
    if (p.audience.kind === 'nivel' && (p.audience.minLevel < 1 || p.audience.minLevel > 30)) e.minLevel = 'Nível entre 1 e 30.'
    if (p.audience.kind === 'inativos' && (p.audience.inactiveDays < 7 || p.audience.inactiveDays > 365)) e.inactiveDays = 'Entre 7 e 365 dias.'
  }
  if (step === 3) {
    if (!p.comms.headline.trim()) e.headline = 'Escreva o título que aparece no site.'
    else if (p.comms.headline.length > 40) e.headline = 'Até 40 caracteres.'
    if (p.comms.subtitle.length > 90) e.subtitle = 'Até 90 caracteres.'
    if (!p.comms.cta.trim()) e.cta = 'Escreva o texto do botão.'
    else if (p.comms.cta.length > 22) e.cta = 'Até 22 caracteres.'
    if (!p.comms.channels.length) e.channels = 'Escolha pelo menos um canal.'
  }
  return e
}

/** Valida todas as etapas e devolve a primeira com erro (ou -1). */
export function firstInvalidStep(p: Omit<Promo, 'id' | 'createdAt' | 'createdBy' | 'updatedAt'>, others: Pick<Promo, 'id' | 'rules' | 'type'>[] = [], selfId?: string) {
  for (let s = 0; s < 4; s++) {
    if (Object.keys(validatePromoStep(s, p, others, selfId)).length) return s
  }
  return -1
}

const BLOCKED_STATUSES: Player['status'][] = ['autoexcluido', 'bloqueado', 'pausa']

/**
 * O jogador entra no público da promoção? Autoexcluídos, em pausa e bloqueados
 * nunca entram (jogo responsável — Lei 14.790/2023).
 */
/** Vale para a base inteira (demonstração) e para o público do servidor (modo API, só ativos). */
export function audienceMatches(player: CampaignPlayer, a: PromoAudience, now: Date = new Date()): boolean {
  if (BLOCKED_STATUSES.includes(player.status)) return false
  if (a.excludeAbusers && player.tags.includes('Bônus abuser')) return false
  const days = (iso: string) => (now.getTime() - new Date(iso).getTime()) / 86_400_000
  switch (a.kind) {
    case 'todos':
      return true
    case 'novos':
      return days(player.createdAt) <= 30
    case 'depositantes':
      return player.depositsCount > 0
    case 'vip':
      return player.tags.includes('VIP')
    case 'inativos':
      return days(player.lastAccess) >= a.inactiveDays
    case 'nivel':
      return player.level >= a.minLevel
  }
}

export function audienceDescription(a: PromoAudience) {
  if (a.kind === 'nivel') return `Nível ${a.minLevel} ou mais`
  if (a.kind === 'inativos') return `Sem acesso há ${a.inactiveDays}+ dias`
  return AUDIENCE_LABEL[a.kind]
}
