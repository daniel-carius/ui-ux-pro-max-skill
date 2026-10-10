// Públicos de comunicação (sino, inbox, popups, disparos e jornadas).
// Regras puras: quem entra em cada público, quem nunca recebe marketing
// (autoexcluídos, em pausa e bloqueados) e quem não deu consentimento.
// Valem para a base inteira (demonstração) e para o público de marketing que o
// servidor manda no modo API (geral.jogadores.audiencia, só jogadores ativos).
import type { Deposit } from '@/data/finance'
import type { Player } from '@/data/players'
import { DAY } from '@/data/now'
import type { CampaignPlayer } from './campanhas-jogador'

export type AudienceKind = 'todos' | 'depositou' | 'inativos' | 'vip' | 'novos' | 'sem_deposito' | 'nivel' | 'ids'

export interface Audience {
  kind: AudienceKind
  /** janela em dias (depositou / inativos) */
  days: number
  /** nível mínimo (1 = primeiro nível da trilha) */
  level: number
  /** lista de IDs de jogadores */
  ids: string[]
}

export const DEFAULT_AUDIENCE: Audience = { kind: 'todos', days: 7, level: 5, ids: [] }

export const AUDIENCE_LABEL: Record<AudienceKind, string> = {
  todos: 'Todos os jogadores',
  depositou: 'Depositaram recentemente',
  inativos: 'Inativos',
  vip: 'VIP',
  novos: 'Novos',
  sem_deposito: 'Sem depósito',
  nivel: 'Nível mínimo',
  ids: 'Lista de IDs',
}

/** Canais: os de marketing externo (e-mail, SMS, RCS) exigem consentimento. */
export type Channel = 'email' | 'sms' | 'rcs' | 'sino' | 'inbox' | 'popup'

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: 'E-mail',
  sms: 'SMS',
  rcs: 'RCS',
  sino: 'Sino',
  inbox: 'Inbox',
  popup: 'Popup',
}

/** Janela fixa de "novos" (dias desde o cadastro). */
export const NEW_PLAYER_DAYS = 7

export function describeAudience(a: Audience, levelName?: (level: number) => string): string {
  switch (a.kind) {
    case 'todos':
      return 'Todos os jogadores'
    case 'depositou':
      return `Depositaram nos últimos ${a.days} dias`
    case 'inativos':
      return `Inativos há ${a.days} dias ou mais`
    case 'vip':
      return 'Jogadores VIP'
    case 'novos':
      return `Novos (cadastro há até ${NEW_PLAYER_DAYS} dias)`
    case 'sem_deposito':
      return 'Cadastrados sem depósito'
    case 'nivel':
      return `Nível ${levelName ? levelName(a.level) : a.level} ou maior`
    case 'ids':
      return `Lista com ${a.ids.length} ${a.ids.length === 1 ? 'ID' : 'IDs'}`
  }
}

/** Marketing não chega a quem está autoexcluído, em pausa ou bloqueado (Lei 14.790/2023). */
export function isReachable(p: Pick<Player, 'status'>) {
  return p.status === 'ativo'
}

function hash(s: string) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h
}

/**
 * Consentimento de marketing por canal (LGPD). Sino, inbox e popup são avisos
 * dentro do site e não pedem consentimento. Nos dados de demonstração, ~6%
 * recusam e-mail e ~14% recusam SMS/RCS (fixo pelo ID).
 */
export function hasConsent(p: Pick<Player, 'id'>, channel: Channel): boolean {
  if (channel === 'sino' || channel === 'inbox' || channel === 'popup') return true
  const h = hash(p.id) % 100
  if (channel === 'email') return h >= 6
  return (hash(`${p.id}-sms`) % 100) >= 14
}

/** Aparelho compatível com RCS (o resto recebe SMS, se o fallback estiver ligado). */
export function supportsRcs(p: Pick<Player, 'id'>) {
  return hash(`${p.id}-rcs`) % 100 < 62
}

export interface AudienceContext {
  now: number
  /** último depósito pago de cada jogador (ms) */
  lastDeposit: Map<string, number>
  /** nível do jogador na trilha atual (1 = primeiro) */
  levelOf: (p: Pick<CampaignPlayer, 'xp'>) => number
}

export function lastDepositMap(deposits: Deposit[]) {
  const m = new Map<string, number>()
  for (const d of deposits) {
    if (d.status !== 'pago') continue
    const t = new Date(d.createdAt).getTime()
    if ((m.get(d.playerId) ?? 0) < t) m.set(d.playerId, t)
  }
  return m
}

/** Último depósito pago a partir do público do servidor (lastDepositAt de cada jogador). */
export function lastDepositFromPlayers(players: Pick<CampaignPlayer, 'id' | 'lastDepositAt'>[]) {
  const m = new Map<string, number>()
  for (const p of players) {
    const t = p.lastDepositAt ? new Date(p.lastDepositAt).getTime() : Number.NaN
    if (!Number.isNaN(t)) m.set(p.id, t)
  }
  return m
}

export function matchesAudience(p: CampaignPlayer, a: Audience, ctx: AudienceContext): boolean {
  switch (a.kind) {
    case 'todos':
      return true
    case 'depositou': {
      const t = ctx.lastDeposit.get(p.id)
      return t !== undefined && ctx.now - t <= a.days * DAY
    }
    case 'inativos':
      return ctx.now - new Date(p.lastAccess).getTime() >= a.days * DAY
    case 'vip':
      return p.tags.includes('VIP')
    case 'novos':
      return ctx.now - new Date(p.createdAt).getTime() <= NEW_PLAYER_DAYS * DAY
    case 'sem_deposito':
      return p.depositsCount === 0 && !ctx.lastDeposit.has(p.id)
    case 'nivel':
      return ctx.levelOf(p) >= a.level
    case 'ids':
      return a.ids.includes(p.id)
  }
}

export interface AudienceEstimate {
  /** jogadores na base */
  total: number
  /** entram no público */
  matched: number
  /** fora por autoexclusão, pausa ou bloqueio */
  blocked: number
  /** fora por falta de consentimento no canal */
  noConsent: number
  /** recebem de fato */
  reachable: number
  /** IDs da lista que não existem na base (modo API: que não estão no público de marketing) */
  invalidIds: string[]
  /**
   * Modo API: a lista já vem só com quem pode receber marketing; quantos da base ficam
   * fora por autoexclusão, pausa ou bloqueio (contagem da base, não do público). null na demonstração.
   */
  outsideBase: number | null
}

/** Base inteira no modo API (a lista de jogadores é só o público de marketing). */
export interface AudienceBase {
  total: number
}

export function estimateAudience(players: CampaignPlayer[], a: Audience, ctx: AudienceContext, channel: Channel, base?: AudienceBase): AudienceEstimate {
  let matched = 0
  let blocked = 0
  let noConsent = 0
  let reachable = 0
  const found = new Set<string>()
  for (const p of players) {
    if (!matchesAudience(p, a, ctx)) continue
    matched++
    if (a.kind === 'ids') found.add(p.id)
    if (!isReachable(p)) {
      blocked++
      continue
    }
    if (!hasConsent(p, channel)) {
      noConsent++
      continue
    }
    reachable++
  }
  const total = base ? Math.max(base.total, players.length) : players.length
  return {
    total,
    matched,
    blocked,
    noConsent,
    reachable,
    invalidIds: a.kind === 'ids' ? a.ids.filter((id) => !found.has(id)) : [],
    outsideBase: base ? total - players.length : null,
  }
}

/** Primeiro jogador que receberia a mensagem (para a prévia com dados reais). */
export function sampleRecipient<P extends CampaignPlayer>(players: P[], a: Audience, ctx: AudienceContext, channel: Channel): P | undefined {
  return players.find((p) => matchesAudience(p, a, ctx) && isReachable(p) && hasConsent(p, channel))
}

/** Lê uma lista colada (vírgula, espaço, ponto e vírgula ou quebra de linha). */
export function parseIds(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/[\s,;]+/)) {
    const id = raw.replace(/\D/g, '')
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

/** Perfil de um jogador fictício (simulador de popups). */
export interface PlayerTraits {
  segments: AudienceKind[]
  level: number
}

export function audienceMatchesTraits(a: Audience, t: PlayerTraits): boolean {
  if (a.kind === 'todos') return true
  if (a.kind === 'nivel') return t.level >= a.level
  if (a.kind === 'ids') return false
  return t.segments.includes(a.kind)
}

export function audienceError(a: Audience): string | null {
  if ((a.kind === 'depositou' || a.kind === 'inativos') && (!Number.isFinite(a.days) || a.days < 1 || a.days > 365))
    return 'Informe de 1 a 365 dias.'
  if (a.kind === 'nivel' && a.level < 1) return 'Escolha um nível.'
  if (a.kind === 'ids' && a.ids.length === 0) return 'Cole ao menos um ID de jogador.'
  return null
}
