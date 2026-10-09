// Missões: objetivos que dão recompensa.
import { brl, mult, num } from '@/lib/format'
import { GAME_CATEGORY_LABEL, type GameCategory } from '@/data/catalog'
import { rewardCost, type Audience, type CoinInfo, type RewardKind } from './campanhas2-common'

export type ObjectiveKind = 'apostar' | 'depositar' | 'rodadas' | 'multiplicador' | 'login'
export type ObjectiveScope = 'qualquer' | 'categoria' | 'jogo'
export type Recurrence = 'diaria' | 'semanal' | 'unica'
export type MissionStatus = 'ativa' | 'pausada' | 'rascunho' | 'encerrada'
export type MissionRewardKind = Extract<RewardKind, 'bonus_brl' | 'free_spins' | 'moedas' | 'cashback'>

export const OBJECTIVE_LABEL: Record<ObjectiveKind, string> = {
  apostar: 'Apostar valor',
  depositar: 'Depositar valor',
  rodadas: 'Jogar rodadas',
  multiplicador: 'Ganhar multiplicador',
  login: 'Entrar dias seguidos',
}

export const OBJECTIVE_HINT: Record<ObjectiveKind, string> = {
  apostar: 'Soma das apostas no período',
  depositar: 'Soma dos depósitos pagos',
  rodadas: 'Quantidade de giros ou mãos',
  multiplicador: 'Um único ganho de X vezes a aposta',
  login: 'Dias seguidos com login',
}

export const RECURRENCE_LABEL: Record<Recurrence, string> = { diaria: 'Diária', semanal: 'Semanal', unica: 'Única' }
export const RECURRENCE_HINT: Record<Recurrence, string> = {
  diaria: 'Reinicia todo dia à 00:00',
  semanal: 'Reinicia toda segunda-feira',
  unica: 'Cada jogador conclui uma vez',
}

export const MISSION_STATUS_LABEL: Record<MissionStatus, string> = { ativa: 'Ativa', pausada: 'Pausada', rascunho: 'Rascunho', encerrada: 'Encerrada' }

export const MISSION_REWARD_LABEL: Record<MissionRewardKind, string> = {
  bonus_brl: 'Bônus em R$',
  free_spins: 'Free spins',
  moedas: 'Moedas',
  cashback: 'Cashback %',
}

export interface Objective {
  kind: ObjectiveKind
  target: number
  scope: ObjectiveScope
  category: GameCategory
  gameId: string | null
}

export interface Mission {
  id: string
  name: string
  objective: Objective
  reward: { kind: MissionRewardKind; value: number }
  recurrence: Recurrence
  audience: Audience
  status: MissionStatus
  startsAt: string
  /** null = sem data de fim */
  endsAt: string | null
  /** jogadores que começaram (últimos 30 dias) */
  started: number
  /** conclusões (últimos 30 dias) */
  completions: number
  createdAt: string
  updatedAt: string
}

/** Escopo só faz sentido para objetivos ligados a jogo. */
export function objectiveHasScope(kind: ObjectiveKind) {
  return kind === 'apostar' || kind === 'rodadas' || kind === 'multiplicador'
}

export function objectiveUnit(kind: ObjectiveKind): 'brl' | 'count' | 'mult' | 'days' {
  if (kind === 'apostar' || kind === 'depositar') return 'brl'
  if (kind === 'multiplicador') return 'mult'
  if (kind === 'login') return 'days'
  return 'count'
}

export function formatTarget(kind: ObjectiveKind, v: number) {
  const u = objectiveUnit(kind)
  if (u === 'brl') return brl(v)
  if (u === 'mult') return mult(v)
  if (u === 'days') return `${num(v)} ${v === 1 ? 'dia' : 'dias'}`
  return `${num(v)} ${v === 1 ? 'rodada' : 'rodadas'}`
}

function scopeText(o: Objective, gameName?: string) {
  if (!objectiveHasScope(o.kind) || o.scope === 'qualquer') return 'em qualquer jogo'
  if (o.scope === 'categoria') return `em ${GAME_CATEGORY_LABEL[o.category]}`
  return `em ${gameName ?? 'jogo escolhido'}`
}

/** "Apostar R$ 100,00 em Slots", "Ganhar 50x ou mais em Aviator". */
export function describeObjective(o: Objective, gameName?: string): string {
  switch (o.kind) {
    case 'apostar':
      return `Apostar ${brl(o.target)} ${scopeText(o, gameName)}`
    case 'depositar':
      return `Depositar ${brl(o.target)}`
    case 'rodadas':
      return `Jogar ${num(o.target)} ${o.target === 1 ? 'rodada' : 'rodadas'} ${scopeText(o, gameName)}`
    case 'multiplicador':
      return `Ganhar ${mult(o.target)} ou mais ${scopeText(o, gameName)}`
    case 'login':
      return `Entrar ${num(o.target)} ${o.target === 1 ? 'dia' : 'dias seguidos'}`
  }
}

/** Progresso legível: "R$ 60,00 de R$ 100,00". */
export function formatProgress(o: Objective, done: number) {
  if (o.kind === 'multiplicador') return done >= o.target ? `${mult(o.target)} alcançado` : `Melhor até agora: ${mult(done)}`
  return `${formatTarget(o.kind, done).replace(/ (rodadas?|dias?)$/, '')} de ${formatTarget(o.kind, o.target)}`
}

export function completionRate(m: Pick<Mission, 'started' | 'completions'>) {
  return m.started > 0 ? Math.min(1, m.completions / m.started) : 0
}

export function missionRewardCost(m: Pick<Mission, 'reward' | 'objective'>, coin: Pick<CoinInfo, 'refValue'>) {
  // cashback incide sobre o valor do objetivo quando ele é em R$; senão, base de R$ 100
  const base = objectiveUnit(m.objective.kind) === 'brl' ? m.objective.target : 100
  return rewardCost(m.reward, coin, base)
}

export type MissionErrors = Partial<Record<'name' | 'target' | 'gameId' | 'reward' | 'period', string>>

export function missionErrors(m: Mission): MissionErrors {
  const e: MissionErrors = {}
  if (!m.name.trim()) e.name = 'Dê um nome para a missão.'
  else if (m.name.trim().length > 60) e.name = 'Use até 60 caracteres.'
  const o = m.objective
  if (!(o.target > 0)) e.target = 'A meta precisa ser maior que zero.'
  else if (o.kind === 'multiplicador' && o.target < 1.01) e.target = 'Multiplicador a partir de 1,01x.'
  else if ((o.kind === 'rodadas' || o.kind === 'login') && !Number.isInteger(o.target)) e.target = 'Use um número inteiro.'
  else if (o.kind === 'login' && m.recurrence === 'diaria') e.target = 'Login em dias seguidos não combina com missão diária.'
  else if (o.kind === 'login' && m.recurrence === 'semanal' && o.target > 7) e.target = 'Em missão semanal, no máximo 7 dias.'
  if (objectiveHasScope(o.kind) && o.scope === 'jogo' && !o.gameId) e.gameId = 'Escolha o jogo.'
  if (!(m.reward.value > 0)) e.reward = 'A recompensa precisa ser maior que zero.'
  else if (m.reward.kind === 'cashback' && m.reward.value > 100) e.reward = 'Cashback de no máximo 100%.'
  if (!m.startsAt) e.period = 'Informe o início.'
  else if (m.endsAt && new Date(m.endsAt) <= new Date(m.startsAt)) e.period = 'O fim precisa ser depois do início.'
  return e
}
