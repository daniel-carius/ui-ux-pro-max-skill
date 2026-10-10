// Domínio 'player-projections': visões calculadas pelo servidor a partir da base de
// jogadores (geral.jogadores), para as telas que não leem a lista inteira (dado
// pessoal e financeiro, LGPD art. 6º III). Só leitura (write 'servidor'); a versão é
// a da base de jogadores. Nada gravado na base = visões vazias.
//
// geral.jogadores.audiencia — público de marketing: só jogadores que podem receber
// campanhas (status 'ativo': nunca autoexcluído, em pausa nem bloqueado, Lei
// 14.790/2023), com campos mínimos e sem dado pessoal nem saldo:
//   { id, nickname, level, xp, tags, createdAt, lastAccess, depositsCount, lastDepositAt }
//   tags: só as etiquetas usadas pelas campanhas (AUDIENCE_TAGS); lastDepositAt: último
//   depósito pago (operacao.depositos).
//
// geral.jogadores.metricas — contagens e agregados, sem jogador identificado:
//   total, por status, KYC, cadastros novos (hoje, 7 e 30 dias), depositantes,
//   moedas em circulação, indicações por afiliado (código do link, sem nome) e a
//   projeção do próximo crédito do cashback por período, calculada aqui com as
//   regras gravadas (campanhas.cashback e campanhas.niveis): só totais. Nada por
//   jogador: as mesmas telas leem o público (id, XP, último acesso), e uma lista de
//   perdas por jogador, mesmo sem id, se ligava a ele pelo XP ou pela posição.
import type { Db } from '../../db'
import type { Cipher } from '../../lib/crypto'
import type { KvContext, KvHandlers, KvValue } from '../../kv/types'
import { AFFILIATES_KEY } from './affiliates'
import { DEPOSITS_KEY } from './deposits'
import { isPlainObject, type JsonObject } from './json'
import { PLAYER_STATUSES, PLAYERS_KEY } from './player-status'
import { loadRow, storedValue, type KvRow } from './store'
import { round2, storedList } from './validate-util'

export const AUDIENCE_KEY = 'geral.jogadores.audiencia'
export const METRICS_KEY = 'geral.jogadores.metricas'

/** Etiquetas que as campanhas usam (público VIP e "excluir abusadores de bônus"); as demais não saem. */
export const AUDIENCE_TAGS = ['VIP', 'Bônus abuser'] as const
export const KYC_STATUSES = ['verificado', 'pendente', 'nao_enviado', 'reprovado'] as const
/** Indicações por afiliado: os que mais trouxeram depósitos. */
export const MAX_REFERRALS = 50
/** Períodos do cashback (dias), como no painel (diário, semanal, mensal). */
export const CASHBACK_PERIODS = { diario: 1, semanal: 7, mensal: 30 } as const
export const CASHBACK_RULES_KEY = 'campanhas.cashback'
export const LEVELS_KEY = 'campanhas.niveis'

/** Regras do cashback que a projeção usa (campanhas.cashback › cashback). */
export interface CashbackProjectionRules {
  enabled: boolean
  mode: 'fixo' | 'por_nivel'
  pct: number
  minLoss: number
  cap: number
}
/** XP mínimo e % de cashback de um nível (campanhas.niveis › levels). */
export interface LevelCashback {
  xp: number
  cashbackPct: number
}
/** Padrão do painel (DEFAULT_CASHBACK.cashback) enquanto as regras não foram gravadas. */
export const DEFAULT_CASHBACK_RULES: CashbackProjectionRules = { enabled: true, mode: 'por_nivel', pct: 5, minLoss: 50, cap: 2000 }
/** Níveis padrão do painel (DEFAULT_LEVELS_CONFIG) enquanto os níveis não foram gravados. */
export const DEFAULT_LEVEL_CASHBACK: readonly LevelCashback[] = [
  { xp: 0, cashbackPct: 0 },
  { xp: 50, cashbackPct: 1 },
  { xp: 150, cashbackPct: 2 },
  { xp: 400, cashbackPct: 3 },
  { xp: 1000, cashbackPct: 4 },
  { xp: 2000, cashbackPct: 5 },
  { xp: 4000, cashbackPct: 6 },
  { xp: 7000, cashbackPct: 8 },
  { xp: 12000, cashbackPct: 10 },
  { xp: 25000, cashbackPct: 12 },
]

const DAY = 86_400_000

const text = (v: unknown) => (typeof v === 'string' && v ? v : null)
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const time = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : Number.NaN)

export interface AudiencePlayer {
  id: string
  nickname: string | null
  level: number | null
  xp: number
  tags: string[]
  createdAt: string | null
  lastAccess: string | null
  depositsCount: number
  lastDepositAt: string | null
}

/** Pode receber marketing? Só 'ativo' (status fora da lista também fica de fora). */
export const isReachable = (p: JsonObject) => p.status === 'ativo'

const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Início do dia de hoje no horário de Brasília (sem horário de verão desde 2019: UTC−3). */
export function startOfTodayBrasilia(now: number): number {
  return Date.parse(`${ymd.format(now)}T00:00:00-03:00`)
}

async function list(db: Db, cipher: Cipher, key: string): Promise<{ row: KvRow | null; items: JsonObject[] }> {
  const row = await loadRow(db, key)
  return { row, items: row ? storedList(storedValue(row, cipher)) : [] }
}

/** Último depósito pago de cada jogador (ms). */
function lastPaidDeposit(deposits: readonly JsonObject[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const d of deposits) {
    if (d.status !== 'pago' || typeof d.playerId !== 'string') continue
    const t = time(d.createdAt)
    if (!Number.isNaN(t) && (out.get(d.playerId) ?? 0) < t) out.set(d.playerId, t)
  }
  return out
}

export function buildAudience(players: readonly JsonObject[], deposits: readonly JsonObject[]): AudiencePlayer[] {
  const lastDeposit = lastPaidDeposit(deposits)
  const out: AudiencePlayer[] = []
  for (const p of players) {
    if (typeof p.id !== 'string' || !isReachable(p)) continue
    const tags = Array.isArray(p.tags) ? p.tags.filter((t): t is string => (AUDIENCE_TAGS as readonly string[]).includes(t as string)) : []
    const last = lastDeposit.get(p.id)
    out.push({
      id: p.id,
      nickname: text(p.nickname),
      level: typeof p.level === 'number' && Number.isFinite(p.level) ? p.level : null,
      xp: count(p.xp),
      tags: [...new Set(tags)],
      createdAt: text(p.createdAt),
      lastAccess: text(p.lastAccess),
      depositsCount: count(p.depositsCount),
      lastDepositAt: last === undefined ? null : new Date(last).toISOString(),
    })
  }
  return out
}

export interface ReferralStats {
  affiliateId: string
  /** código do link (x2win.bet.br/?ref=CÓDIGO); null se o afiliado não está na base */
  code: string | null
  signups: number
  depositors: number
  /** soma do total depositado pelos indicados (R$) */
  deposited: number
}

export interface PlayerMetrics {
  total: number
  byStatus: Record<(typeof PLAYER_STATUSES)[number] | 'outros', number>
  kyc: Record<(typeof KYC_STATUSES)[number], number>
  newPlayers: { today: number; last7Days: number; last30Days: number }
  /** jogadores com pelo menos um depósito */
  depositors: number
  coins: { circulation: number; holders: number }
  referrals: ReferralStats[]
  /** soma de `deposited` de todos os afiliados (para a participação de cada link) */
  referralsDeposited: number
  /** projeção do próximo crédito do cashback em cada período, com as regras gravadas (só totais) */
  cashback: Record<keyof typeof CASHBACK_PERIODS, CashbackProjection>
  generatedAt: string
}

export interface CashbackProjection {
  /** jogadores ativos que entraram no período */
  active: number
  /** dos ativos, os que têm direito: perda estimada > 0 e ≥ perda mínima, percentual > 0 (0 com o cashback desligado) */
  eligible: number
  /** soma do cashback estimado dos elegíveis, já limitado pelo teto (R$) */
  total: number
  /** elegíveis limitados pelo teto */
  capped: number
}

/** Regras gravadas em campanhas.cashback; sem gravação (ou campo fora do formato), o padrão do painel. */
export function cashbackRulesOf(stored: unknown): CashbackProjectionRules {
  const cb = isPlainObject(stored) && isPlainObject(stored.cashback) ? stored.cashback : {}
  const d = DEFAULT_CASHBACK_RULES
  return {
    enabled: typeof cb.enabled === 'boolean' ? cb.enabled : d.enabled,
    mode: cb.mode === 'fixo' || cb.mode === 'por_nivel' ? cb.mode : d.mode,
    pct: finite(cb.pct) ? cb.pct : d.pct,
    minLoss: finite(cb.minLoss) ? cb.minLoss : d.minLoss,
    cap: finite(cb.cap) ? cb.cap : d.cap,
  }
}

/** Níveis gravados em campanhas.niveis (XP mínimo e % de cashback); sem nenhum nível válido, os padrão do painel. */
export function levelCashbackOf(stored: unknown): LevelCashback[] {
  const list = isPlainObject(stored) && Array.isArray(stored.levels) ? stored.levels.filter(isPlainObject) : []
  const out: LevelCashback[] = []
  for (const l of list) if (finite(l.xp) && finite(l.cashbackPct)) out.push({ xp: l.xp, cashbackPct: l.cashbackPct })
  return out.length ? out : [...DEFAULT_LEVEL_CASHBACK]
}

/** % de cashback do nível do jogador (último nível cujo XP mínimo ele alcançou, como levelIndexForXp do painel). */
function levelPct(levels: readonly LevelCashback[], xp: number): number {
  let idx = 0
  for (let i = 0; i < levels.length; i++) if (xp >= levels[i].xp) idx = i
  return levels[idx]?.cashbackPct ?? 0
}

export function buildMetrics(
  players: readonly JsonObject[],
  affiliates: readonly JsonObject[],
  now: number,
  cashbackRules: CashbackProjectionRules = DEFAULT_CASHBACK_RULES,
  levels: readonly LevelCashback[] = DEFAULT_LEVEL_CASHBACK,
): PlayerMetrics {
  const byStatus = { ativo: 0, bloqueado: 0, autoexcluido: 0, pausa: 0, outros: 0 }
  const kyc = { verificado: 0, pendente: 0, nao_enviado: 0, reprovado: 0 }
  const today = startOfTodayBrasilia(now)
  const newPlayers = { today: 0, last7Days: 0, last30Days: 0 }
  let depositors = 0
  const coins = { circulation: 0, holders: 0 }
  const refs = new Map<string, { signups: number; depositors: number; deposited: number }>()
  const cashback = Object.fromEntries(
    Object.keys(CASHBACK_PERIODS).map((k) => [k, { active: 0, eligible: 0, total: 0, capped: 0 }]),
  ) as PlayerMetrics['cashback']

  for (const p of players) {
    const status = (PLAYER_STATUSES as readonly unknown[]).includes(p.status) ? (p.status as keyof typeof byStatus) : 'outros'
    byStatus[status]++
    if (typeof p.kyc === 'string' && Object.hasOwn(kyc, p.kyc)) kyc[p.kyc as keyof typeof kyc]++
    const created = time(p.createdAt)
    if (!Number.isNaN(created)) {
      if (created >= today) newPlayers.today++
      if (now - created <= 7 * DAY) newPlayers.last7Days++
      if (now - created <= 30 * DAY) newPlayers.last30Days++
    }
    const deposits = count(p.depositsCount)
    if (deposits > 0) depositors++
    const c = count(p.coins)
    if (c > 0) {
      coins.circulation += c
      coins.holders++
    }
    if (typeof p.referrerId === 'string' && p.referrerId) {
      const r = refs.get(p.referrerId) ?? { signups: 0, depositors: 0, deposited: 0 }
      r.signups++
      if (deposits > 0) r.depositors++
      r.deposited += count(p.totalDeposited)
      refs.set(p.referrerId, r)
    }
    // cashback: mesma projeção do painel (projectCycle), com as regras gravadas: perda média diária desde o
    // cadastro × dias do período, % fixo ou do nível, perda mínima e teto por jogador; só os totais saem
    if (p.status === 'ativo') {
      const access = time(p.lastAccess)
      const pct = cashbackRules.mode === 'fixo' ? cashbackRules.pct : levelPct(levels, count(p.xp))
      for (const [period, days] of Object.entries(CASHBACK_PERIODS) as [keyof typeof CASHBACK_PERIODS, number][]) {
        if (Number.isNaN(access) || now - access > days * DAY) continue
        const c = cashback[period]
        c.active++
        if (!cashbackRules.enabled || pct <= 0) continue
        const ageDays = Math.max(days, Number.isNaN(created) ? days : (now - created) / DAY)
        const loss = (Math.max(0, count(p.totalBet) - count(p.totalWon)) / ageDays) * days
        if (loss <= 0 || loss < cashbackRules.minLoss) continue
        let v = (loss * pct) / 100
        if (cashbackRules.cap > 0 && v > cashbackRules.cap) {
          v = cashbackRules.cap
          c.capped++
        }
        c.eligible++
        c.total += v
      }
    }
  }

  for (const c of Object.values(cashback)) c.total = round2(c.total)

  const codes = new Map(affiliates.filter((a) => typeof a.id === 'string').map((a) => [a.id as string, text(a.code)]))
  const referrals = [...refs.entries()]
    .map(([affiliateId, r]) => ({ affiliateId, code: codes.get(affiliateId) ?? null, ...r, deposited: round2(r.deposited) }))
    .sort((a, b) => b.deposited - a.deposited || b.signups - a.signups)
  return {
    total: players.length,
    byStatus,
    kyc,
    newPlayers,
    depositors,
    coins,
    referrals: referrals.slice(0, MAX_REFERRALS),
    referralsDeposited: round2(referrals.reduce((s, r) => s + r.deposited, 0)),
    cashback,
    generatedAt: new Date(now).toISOString(),
  }
}

async function read(ctx: KvContext): Promise<KvValue | null> {
  const { app, key } = ctx
  const players = await list(app.db, app.cipher, PLAYERS_KEY)
  const version = players.row?.version ?? 0
  const updatedAt = players.row?.updated_at ?? null
  if (key === AUDIENCE_KEY) {
    const deposits = await list(app.db, app.cipher, DEPOSITS_KEY)
    return { value: buildAudience(players.items, deposits.items), version, updatedAt }
  }
  if (key === METRICS_KEY) {
    const affiliates = await list(app.db, app.cipher, AFFILIATES_KEY)
    const rules = cashbackRulesOf(storedValue(await loadRow(app.db, CASHBACK_RULES_KEY), app.cipher))
    const levels = levelCashbackOf(storedValue(await loadRow(app.db, LEVELS_KEY), app.cipher))
    return { value: buildMetrics(players.items, affiliates.items, Date.now(), rules, levels), version, updatedAt }
  }
  return null
}

export const kvHandlers: KvHandlers = {
  'player-projections': { read },
}
