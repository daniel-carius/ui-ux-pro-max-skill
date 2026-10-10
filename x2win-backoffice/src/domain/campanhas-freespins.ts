// Free spins: campanhas de giros, custo estimado e concessões (automáticas e manuais).
import { brl, num } from '@/lib/format'
import type { Game } from '@/data/catalog'
import type { CampaignPlayer } from './campanhas-jogadores'

export type FsTrigger = 'deposito' | 'cadastro' | 'manual' | 'cupom'
export type FsCampaignStatus = 'agendada' | 'ativa' | 'pausada' | 'encerrada'
export type GrantStatus = 'ativa' | 'concluida' | 'expirada' | 'cancelada'

export interface FreeSpinCampaign {
  id: string
  name: string
  trigger: FsTrigger
  /** qual depósito libera (1 = primeiro) */
  depositNumber: number
  minDeposit: number
  couponCode: string
  gameId: string
  spins: number
  spinValue: number
  /** dias para usar os giros depois de concedidos */
  validityDays: number
  /** rollover sobre o que for ganho nos giros */
  winRollover: number
  maxPerPlayer: number
  paused: boolean
  startAt: string
  endAt: string | null
  /** jogadores esperados (para a estimativa de custo) */
  estimatedPlayers: number
  createdAt: string
  createdBy: string
}

export interface FreeSpinGrant {
  id: string
  campaignId: string
  campaignName: string
  playerId: string
  playerName: string
  /** preenchido pelo servidor a partir da base (mascarado para quem não vê dados pessoais); o painel não envia */
  playerEmail?: string
  gameId: string
  spins: number
  spinValue: number
  used: number
  winnings: number
  grantedAt: string
  expiresAt: string
  status: GrantStatus
  origin: 'automatica' | 'manual'
  grantedBy: string | null
  note: string
}

export const FS_TRIGGER_LABEL: Record<FsTrigger, string> = {
  deposito: 'Nº do depósito',
  cadastro: 'Cadastro',
  manual: 'Manual',
  cupom: 'Cupom',
}

export const FS_TRIGGER_DESCRIPTION: Record<FsTrigger, string> = {
  deposito: 'Libera no depósito escolhido (ex.: 2º depósito).',
  cadastro: 'Libera quando o jogador conclui o cadastro.',
  manual: 'Só a equipe concede, jogador a jogador.',
  cupom: 'Libera quando o jogador digita o código.',
}

export const FS_STATUS_LABEL: Record<FsCampaignStatus, string> = {
  agendada: 'Agendada',
  ativa: 'Ativa',
  pausada: 'Pausada',
  encerrada: 'Encerrada',
}

export const GRANT_STATUS_LABEL: Record<GrantStatus, string> = {
  ativa: 'Em uso',
  concluida: 'Concluída',
  expirada: 'Expirada',
  cancelada: 'Cancelada',
}

export function fsCampaignStatus(c: Pick<FreeSpinCampaign, 'paused' | 'startAt' | 'endAt'>, now: Date = new Date()): FsCampaignStatus {
  if (c.endAt && new Date(c.endAt).getTime() < now.getTime()) return 'encerrada'
  if (c.paused) return 'pausada'
  if (new Date(c.startAt).getTime() > now.getTime()) return 'agendada'
  return 'ativa'
}

export function triggerText(c: Pick<FreeSpinCampaign, 'trigger' | 'depositNumber' | 'minDeposit' | 'couponCode'>) {
  switch (c.trigger) {
    case 'deposito':
      return `No ${c.depositNumber}º depósito${c.minDeposit > 0 ? ` · mín. ${brl(c.minDeposit)}` : ''}`
    case 'cadastro':
      return 'No cadastro'
    case 'manual':
      return 'Concessão manual'
    case 'cupom':
      return `Cupom ${c.couponCode || '—'}`
  }
}

/** Valor em giros que um jogador recebe numa concessão. */
export function fsValuePerPlayer(c: Pick<FreeSpinCampaign, 'spins' | 'spinValue'>) {
  return round2(c.spins * c.spinValue)
}

/** Custo esperado por jogador: valor dos giros × RTP do jogo (o que volta em ganhos). */
export function fsExpectedCost(c: Pick<FreeSpinCampaign, 'spins' | 'spinValue'>, rtp: number) {
  return round2(c.spins * c.spinValue * (rtp / 100))
}

export interface FsEstimate {
  valuePerPlayer: number
  expectedPerPlayer: number
  /** quanto o jogador precisa apostar para sacar o ganho esperado */
  wagerToWithdraw: number
  expectedTotal: number
  /** pior caso: todos usam tudo e recebem o máximo de vezes */
  ceilingTotal: number
}

export function fsEstimate(c: Pick<FreeSpinCampaign, 'spins' | 'spinValue' | 'winRollover' | 'maxPerPlayer' | 'estimatedPlayers'>, rtp: number): FsEstimate {
  const valuePerPlayer = fsValuePerPlayer(c)
  const expectedPerPlayer = fsExpectedCost(c, rtp)
  return {
    valuePerPlayer,
    expectedPerPlayer,
    wagerToWithdraw: round2(expectedPerPlayer * c.winRollover),
    expectedTotal: round2(expectedPerPlayer * c.estimatedPlayers),
    ceilingTotal: round2(valuePerPlayer * c.maxPerPlayer * c.estimatedPlayers),
  }
}

/** Sugestão de público: quantos jogadores podem disparar o gatilho agora. */
export function fsEligibleSuggestion(c: Pick<FreeSpinCampaign, 'trigger' | 'depositNumber'>, players: Pick<CampaignPlayer, 'status' | 'depositsCount' | 'createdAt'>[], now: Date = new Date()): { count: number; text: string } | null {
  const ok = players.filter((p) => p.status === 'ativo')
  if (c.trigger === 'deposito') {
    const n = ok.filter((p) => p.depositsCount === c.depositNumber - 1).length
    return { count: n, text: `${num(n)} jogadores ativos têm ${c.depositNumber - 1} ${c.depositNumber - 1 === 1 ? 'depósito' : 'depósitos'} e podem fazer o ${c.depositNumber}º.` }
  }
  if (c.trigger === 'cadastro') {
    const n = ok.filter((p) => now.getTime() - new Date(p.createdAt).getTime() <= 30 * 86_400_000).length
    return { count: n, text: `${num(n)} cadastros nos últimos 30 dias.` }
  }
  return null
}

export type FsErrors = Record<string, string>

const CODE_RE = /^[A-Z0-9]{4,16}$/

export function validateFsCampaign(c: FreeSpinCampaign, game: Game | undefined, others: FreeSpinCampaign[]): FsErrors {
  const e: FsErrors = {}
  if (c.name.trim().length < 4) e.name = 'Dê um nome com pelo menos 4 letras.'
  if (!c.gameId || !game) e.gameId = 'Escolha o jogo dos giros.'
  else if (game.category !== 'slots') e.gameId = 'Giros grátis só funcionam em slots.'
  else if (!game.active) e.gameId = 'Este jogo está inativo no catálogo.'
  if (!Number.isInteger(c.spins) || c.spins < 1 || c.spins > 1000) e.spins = 'Entre 1 e 1.000 giros.'
  if (c.spinValue <= 0) e.spinValue = 'O valor por giro precisa ser maior que zero.'
  else if (game && c.spinValue < game.minBet) e.spinValue = `Abaixo da aposta mínima do jogo (${brl(game.minBet)}).`
  else if (game && c.spinValue > game.maxBet) e.spinValue = `Acima da aposta máxima do jogo (${brl(game.maxBet)}).`
  if (c.validityDays < 1 || c.validityDays > 60) e.validityDays = 'Entre 1 e 60 dias.'
  if (c.winRollover < 0 || c.winRollover > 100) e.winRollover = 'Entre 0x e 100x.'
  if (c.maxPerPlayer < 1) e.maxPerPlayer = 'Pelo menos 1 vez por jogador.'
  if (c.trigger === 'deposito' && (c.depositNumber < 1 || c.depositNumber > 20)) e.depositNumber = 'Do 1º ao 20º depósito.'
  if (c.trigger === 'deposito' && c.minDeposit < 0) e.minDeposit = 'Não pode ser negativo.'
  if (c.trigger === 'cupom') {
    const code = c.couponCode.trim().toUpperCase()
    if (!CODE_RE.test(code)) e.couponCode = 'De 4 a 16 letras ou números, sem espaço.'
    else if (others.some((o) => o.id !== c.id && o.trigger === 'cupom' && o.couponCode.toUpperCase() === code && fsCampaignStatus(o) !== 'encerrada')) e.couponCode = 'Outra campanha ativa já usa este código.'
  }
  if (c.endAt && new Date(c.endAt).getTime() <= new Date(c.startAt).getTime()) e.endAt = 'O término precisa ser depois do início.'
  if (c.estimatedPlayers < 0) e.estimatedPlayers = 'Não pode ser negativo.'
  return e
}

/** Conflito: duas campanhas ativas no mesmo gatilho de depósito. */
export function fsConflicts(c: FreeSpinCampaign, others: FreeSpinCampaign[]) {
  if (c.trigger !== 'deposito') return []
  return others.filter((o) => o.id !== c.id && o.trigger === 'deposito' && o.depositNumber === c.depositNumber && ['ativa', 'agendada'].includes(fsCampaignStatus(o)))
}

/** Status atual da concessão (usados e validade contam na hora). */
export function grantStatus(g: Pick<FreeSpinGrant, 'status' | 'used' | 'spins' | 'expiresAt'>, now: Date = new Date()): GrantStatus {
  if (g.status !== 'ativa') return g.status
  if (g.used >= g.spins) return 'concluida'
  if (new Date(g.expiresAt).getTime() < now.getTime()) return 'expirada'
  return 'ativa'
}

/** Pode conceder giros desta campanha a este jogador? */
export function canGrant(player: Pick<CampaignPlayer, 'id' | 'status'> | null, campaign: FreeSpinCampaign | undefined, grants: FreeSpinGrant[], spins: number): { ok: boolean; reason: string | null } {
  if (!player) return { ok: false, reason: 'Escolha o jogador.' }
  if (!campaign) return { ok: false, reason: 'Escolha a campanha.' }
  if (player.status === 'autoexcluido') return { ok: false, reason: 'Jogador autoexcluído não pode receber giros (Lei 14.790/2023).' }
  if (player.status === 'pausa') return { ok: false, reason: 'Jogador em pausa de jogo responsável não pode receber giros.' }
  if (player.status === 'bloqueado') return { ok: false, reason: 'Jogador bloqueado não pode receber giros.' }
  if (fsCampaignStatus(campaign) === 'encerrada') return { ok: false, reason: 'Esta campanha está encerrada.' }
  if (!Number.isInteger(spins) || spins < 1 || spins > 1000) return { ok: false, reason: 'Informe de 1 a 1.000 giros.' }
  const already = grants.filter((g) => g.campaignId === campaign.id && g.playerId === player.id && g.status !== 'cancelada').length
  if (already >= campaign.maxPerPlayer) return { ok: false, reason: `O jogador já recebeu esta campanha ${already} ${already === 1 ? 'vez' : 'vezes'} (limite: ${campaign.maxPerPlayer}).` }
  return { ok: true, reason: null }
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}
