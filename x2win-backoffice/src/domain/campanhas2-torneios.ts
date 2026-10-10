// Torneios: competição por pontuação, com ranking e prêmios por posição.
import { brl, mult, num } from '@/lib/format'
import { createRng } from '@/lib/random'
import type { CampaignPlayer } from './campanhas-jogador'
import { hashSeed, maskNick, rewardCost, rewardShort, type Audience, type CoinInfo, type RewardKind } from './campanhas2-common'

export type Scoring = 'maior_multiplicador' | 'maior_ganho' | 'volume_apostado'
export type TournamentStatus = 'agendado' | 'ao_vivo' | 'encerrado'
export type TournamentPrizeKind = Extract<RewardKind, 'dinheiro' | 'bonus_brl' | 'free_spins' | 'moedas'>

export const SCORING_LABEL: Record<Scoring, string> = {
  maior_multiplicador: 'Maior multiplicador',
  maior_ganho: 'Maior ganho',
  volume_apostado: 'Volume apostado',
}

export const SCORING_HINT: Record<Scoring, string> = {
  maior_multiplicador: 'Vale o maior ganho dividido pela aposta, numa única rodada.',
  maior_ganho: 'Vale o maior prêmio em R$ numa única rodada.',
  volume_apostado: 'Soma de todas as apostas nos jogos do torneio.',
}

export const TOURNAMENT_STATUS_LABEL: Record<TournamentStatus, string> = { agendado: 'Agendado', ao_vivo: 'Ao vivo', encerrado: 'Encerrado' }

export const TOURNAMENT_PRIZE_LABEL: Record<TournamentPrizeKind, string> = {
  dinheiro: 'Saldo real',
  bonus_brl: 'Bônus em R$',
  free_spins: 'Free spins',
  moedas: 'Moedas',
}

export interface TournamentPrize {
  id: string
  kind: TournamentPrizeKind
  value: number
}

export interface Tournament {
  id: string
  name: string
  description: string
  gameIds: string[]
  startsAt: string
  endsAt: string
  scoring: Scoring
  /** aposta mínima para pontuar */
  minBet: number
  /** índice = posição - 1 */
  prizes: TournamentPrize[]
  audience: Audience
  /** inscritos (ao vivo ou final) */
  participants: number
  /** encerrado manualmente antes do fim */
  closedAt: string | null
  closedBy: string | null
  createdAt: string
  updatedAt: string
}

export function tournamentStatus(t: Pick<Tournament, 'startsAt' | 'endsAt' | 'closedAt'>, now: Date = new Date()): TournamentStatus {
  if (t.closedAt) return 'encerrado'
  const n = now.getTime()
  if (n < new Date(t.startsAt).getTime()) return 'agendado'
  if (n >= new Date(t.endsAt).getTime()) return 'encerrado'
  return 'ao_vivo'
}

/** Fim efetivo (encerramento manual tem prioridade). */
export function effectiveEnd(t: Pick<Tournament, 'endsAt' | 'closedAt'>) {
  return t.closedAt ?? t.endsAt
}

export function prizeValueBrl(p: Pick<TournamentPrize, 'kind' | 'value'>, coin: Pick<CoinInfo, 'refValue'>) {
  return rewardCost(p, coin)
}

/** Total em prêmios (R$ equivalentes). */
export function prizePool(t: Pick<Tournament, 'prizes'>, coin: Pick<CoinInfo, 'refValue'>) {
  return t.prizes.reduce((s, p) => s + prizeValueBrl(p, coin), 0)
}

export function prizeLabel(p: Pick<TournamentPrize, 'kind' | 'value'>, coin: Pick<CoinInfo, 'symbol'>) {
  return rewardShort(p, coin)
}

export type TournamentErrors = Partial<Record<'name' | 'games' | 'period' | 'minBet' | 'prizes', string>> & { prize: Record<string, string> }

export function tournamentErrors(t: Tournament, coin: Pick<CoinInfo, 'refValue'>): TournamentErrors {
  const e: TournamentErrors = { prize: {} }
  if (!t.name.trim()) e.name = 'Dê um nome para o torneio.'
  if (!t.gameIds.length) e.games = 'Escolha pelo menos um jogo.'
  if (!t.startsAt || !t.endsAt) e.period = 'Informe início e fim.'
  else if (new Date(t.endsAt) <= new Date(t.startsAt)) e.period = 'O fim precisa ser depois do início.'
  else if (new Date(t.endsAt).getTime() - new Date(t.startsAt).getTime() < 3600_000) e.period = 'O torneio precisa durar pelo menos 1 hora.'
  if (t.minBet < 0) e.minBet = 'Valor inválido.'
  if (!t.prizes.length) e.prizes = 'Defina o prêmio de pelo menos uma posição.'
  t.prizes.forEach((p, i) => {
    if (!(p.value > 0)) e.prize[p.id] = 'Valor maior que zero.'
    else if ((p.kind === 'free_spins' || p.kind === 'moedas') && !Number.isInteger(p.value)) e.prize[p.id] = 'Use um número inteiro.'
    else if (i > 0 && prizeValueBrl(p, coin) > prizeValueBrl(t.prizes[i - 1], coin)) e.prize[p.id] = `Vale mais que o prêmio do ${i}º lugar.`
  })
  return e
}

export function hasTournamentErrors(e: TournamentErrors) {
  return !!(e.name || e.games || e.period || e.minBet || e.prizes || Object.keys(e.prize).length)
}

export function scoreText(scoring: Scoring, v: number) {
  return scoring === 'maior_multiplicador' ? mult(v) : brl(v)
}

export interface LeaderboardRow {
  position: number
  playerId: string
  nick: string
  score: number
  prize: TournamentPrize | null
}

/**
 * Ranking do torneio. Gerado de forma determinística a partir dos jogadores ativos
 * que já depositaram (no servidor viria das rodadas). Só apelido e ID, mascarado como
 * no site: serve para a base inteira (demonstração) e para o público do servidor (modo API).
 */
export function buildLeaderboard(t: Tournament, players: Pick<CampaignPlayer, 'id' | 'nickname' | 'status' | 'depositsCount'>[], now: Date = new Date(), limit = 50): LeaderboardRow[] {
  const status = tournamentStatus(t, now)
  if (status === 'agendado' || t.participants <= 0) return []
  const rng = createRng(hashSeed(t.id))
  const pool = players.filter((p) => p.depositsCount > 0 && p.status === 'ativo')
  const n = Math.min(limit, t.participants, pool.length)
  const picked = rng.sample(pool, n)
  const rows = picked.map((p) => {
    let score: number
    if (t.scoring === 'maior_multiplicador') score = Math.round((1.5 + Math.pow(rng.next(), 4) * 2500) * 100) / 100
    else if (t.scoring === 'maior_ganho') score = rng.money(40, 48000)
    else score = rng.money(300, 180000)
    return { playerId: p.id, nick: maskNick(p.nickname), score }
  })
  rows.sort((a, b) => b.score - a.score)
  return rows.map((r, i) => ({ ...r, position: i + 1, prize: t.prizes[i] ?? null }))
}

export function participantsLabel(n: number) {
  return `${num(n)} ${n === 1 ? 'participante' : 'participantes'}`
}
