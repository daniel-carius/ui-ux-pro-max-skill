// Regras de negócio do módulo Cassino (catálogo, vitrines e agregadores).
// Funções puras: a tela chama, e a recriação com back-end reaproveita.
// Exceção: saveCredentialsDirect (modo API), que grava credenciais direto na API para a
// tela mostrar o erro do servidor junto do campo do segredo.
import { isDestinationChanged, type ApiError } from '@/lib/api'
import { hasMaskChars } from '@/lib/format'
import { createRng } from '@/lib/random'
import type { Aggregator, Game, GameCategory, Provider } from '@/data/catalog'
import { gameStatsForPeriod, getDailySeries, sumSeries } from '@/data/metrics'

// ---------- Catálogo ----------

export type GameSort = 'destaque' | 'nome' | 'rtp' | 'novos'

export const GAME_SORT_LABEL: Record<GameSort, string> = {
  destaque: 'Maior destaque',
  nome: 'Nome (A–Z)',
  rtp: 'Maior RTP',
  novos: 'Mais novos',
}

export function sortGames(games: Game[], sort: GameSort): Game[] {
  const list = [...games]
  switch (sort) {
    case 'nome':
      return list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    case 'rtp':
      return list.sort((a, b) => b.rtp - a.rtp || b.highlight - a.highlight)
    case 'novos':
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    default:
      return list.sort((a, b) => b.highlight - a.highlight || a.name.localeCompare(b.name, 'pt-BR'))
  }
}

/** Selos extras de um jogo (o selo "Novo" fica no próprio jogo, em isNew). */
export type GameBadge = 'em_alta' | 'exclusivo' | 'jackpot'

export const GAME_BADGE_LABEL: Record<GameBadge, string> = {
  em_alta: 'Em alta',
  exclusivo: 'Exclusivo',
  jackpot: 'Jackpot',
}

/**
 * Motivo de o jogo não aparecer no site, ou null se aparece.
 * Regra: o jogo só aparece se estiver ativo E a provedora estiver ativa.
 */
export function gameHiddenReason(game: Game, provider: Provider | undefined): string | null {
  if (!game.active) return 'Jogo desativado'
  if (!provider) return 'Provedora não encontrada'
  if (provider.status === 'pausada') return `Provedora ${provider.name} pausada`
  return null
}

export function isGameOnSite(game: Game, provider: Provider | undefined) {
  return gameHiddenReason(game, provider) === null
}

/** Destaque é uma nota de 0 a 100 usada na ordenação padrão. */
export function validateHighlight(n: number): string | null {
  if (!Number.isFinite(n)) return 'Informe um número.'
  if (!Number.isInteger(n)) return 'Use um número inteiro.'
  if (n < 0 || n > 100) return 'O destaque vai de 0 a 100.'
  return null
}

export function highlightLabel(n: number) {
  if (n >= 85) return 'Vitrine principal'
  if (n >= 60) return 'Alto'
  if (n >= 30) return 'Médio'
  return 'Baixo'
}

export const CATEGORY_ORDER: GameCategory[] = ['slots', 'ao_vivo', 'crash', 'instantaneo', 'mesa', 'bingo']

// ---------- Vitrines ----------

export type ShowcaseType = 'manual' | 'mais_jogados' | 'ao_vivo' | 'novos' | 'por_provedora'

export interface Showcase {
  id: string
  name: string
  type: ShowcaseType
  /** jogos escolhidos à mão, na ordem de exibição (só no tipo manual) */
  gameIds: string[]
  /** provedora, no tipo "por provedora" */
  providerId: string | null
  limit: number
  visible: boolean
  updatedAt: string
  updatedBy: string
}

export const SHOWCASE_TYPE_LABEL: Record<ShowcaseType, string> = {
  manual: 'Manual',
  mais_jogados: 'Mais jogados',
  ao_vivo: 'Ao vivo',
  novos: 'Novos',
  por_provedora: 'Por provedora',
}

export const SHOWCASE_TYPE_HINT: Record<ShowcaseType, string> = {
  manual: 'Você escolhe os jogos e a ordem.',
  mais_jogados: 'Maior GGR dos últimos 7 dias. Atualiza sozinha todo dia.',
  ao_vivo: 'Jogos da categoria Ao vivo, por destaque.',
  novos: 'Jogos com o selo Novo, depois os mais recentes.',
  por_provedora: 'Jogos de uma provedora, por destaque.',
}

export const SHOWCASE_LIMITS = { min: 4, max: 30 } as const

/** GGR de cada jogo nos últimos 7 dias (base da vitrine "Mais jogados"). */
export function weeklyGgrByGame(): Map<string, number> {
  const series = getDailySeries()
  const t = sumSeries(series.slice(-7))
  return new Map(gameStatsForPeriod(t.casinoBets, t.casinoWins, 7).map((s) => [s.gameId, s.ggr]))
}

export interface ResolvedShowcase {
  /** jogos que aparecem no site, já na ordem e cortados no limite */
  games: Game[]
  /** jogos escolhidos à mão que estão ocultos (inativo ou provedora pausada) */
  hiddenPicked: Game[]
  /** quantos jogos atendem ao critério (antes do limite) */
  available: number
}

/**
 * Monta a vitrine como o site mostra. Jogos inativos ou de provedoras pausadas
 * nunca aparecem, mesmo se escolhidos à mão.
 */
export function resolveShowcase(sc: Pick<Showcase, 'type' | 'gameIds' | 'providerId' | 'limit'>, games: Game[], providers: Provider[], weeklyGgr: Map<string, number>): ResolvedShowcase {
  const pmap = new Map(providers.map((p) => [p.id, p]))
  const onSite = (g: Game) => isGameOnSite(g, pmap.get(g.providerId))
  const byHighlight = (a: Game, b: Game) => b.highlight - a.highlight
  let pool: Game[] = []
  let hiddenPicked: Game[] = []
  switch (sc.type) {
    case 'manual': {
      const gmap = new Map(games.map((g) => [g.id, g]))
      const picked = sc.gameIds.map((id) => gmap.get(id)).filter((g): g is Game => !!g)
      pool = picked.filter(onSite)
      hiddenPicked = picked.filter((g) => !onSite(g))
      break
    }
    case 'mais_jogados':
      pool = games.filter(onSite).sort((a, b) => (weeklyGgr.get(b.id) ?? 0) - (weeklyGgr.get(a.id) ?? 0))
      break
    case 'ao_vivo':
      pool = games.filter((g) => onSite(g) && g.category === 'ao_vivo').sort(byHighlight)
      break
    case 'novos':
      pool = games.filter(onSite).sort((a, b) => Number(b.isNew) - Number(a.isNew) || b.createdAt.localeCompare(a.createdAt))
      break
    case 'por_provedora':
      pool = games.filter((g) => onSite(g) && g.providerId === sc.providerId).sort(byHighlight)
      break
  }
  return { games: pool.slice(0, sc.limit), hiddenPicked, available: pool.length }
}

export type ShowcaseDraft = Pick<Showcase, 'name' | 'type' | 'gameIds' | 'providerId' | 'limit' | 'visible'>

/** Validação do formulário de vitrine. Retorna um erro por campo. */
export function validateShowcase(d: ShowcaseDraft, others: Showcase[]): Partial<Record<'name' | 'limit' | 'providerId' | 'gameIds', string>> {
  const e: Partial<Record<'name' | 'limit' | 'providerId' | 'gameIds', string>> = {}
  const name = d.name.trim()
  if (!name) e.name = 'Dê um nome para a vitrine.'
  else if (name.length > 40) e.name = 'Use até 40 caracteres.'
  else if (others.some((o) => o.name.trim().toLowerCase() === name.toLowerCase())) e.name = 'Já existe uma vitrine com esse nome.'
  if (!Number.isInteger(d.limit) || d.limit < SHOWCASE_LIMITS.min || d.limit > SHOWCASE_LIMITS.max)
    e.limit = `O limite vai de ${SHOWCASE_LIMITS.min} a ${SHOWCASE_LIMITS.max} jogos.`
  if (d.type === 'por_provedora' && !d.providerId) e.providerId = 'Escolha a provedora.'
  if (d.type === 'manual') {
    if (d.gameIds.length < SHOWCASE_LIMITS.min) e.gameIds = `Escolha pelo menos ${SHOWCASE_LIMITS.min} jogos.`
    else if (d.gameIds.length > d.limit) e.gameIds = `Você escolheu ${d.gameIds.length} jogos, acima do limite de ${d.limit}.`
  }
  return e
}

// ---------- Agregadores ----------

export type AggregatorId = Aggregator['id']

export interface SyncRules {
  /** agregador com prioridade para cada provedora (quando os dois entregam a mesma) */
  precedence: Record<string, AggregatorId>
  /** jogo que chega pelos dois agregadores */
  duplicates: 'prioridade' | 'manter_ambos'
  /** jogo novo no catálogo do agregador */
  newGames: 'pausado' | 'ativo'
  /** jogo que saiu do catálogo do agregador */
  removedGames: 'pausar' | 'manter'
  autoSync: boolean
  /** hora da sincronização automática (0–23) */
  autoSyncHour: number
}

/** Platform ID: letras, números e hífen, de 3 a 40 caracteres. */
export function validatePlatformId(v: string): string | null {
  const s = v.trim()
  if (!s) return 'Informe o Platform ID.'
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/i.test(s)) return 'Use de 3 a 40 letras, números ou hífen.'
  return null
}

// ---------- Credenciais (segredo guardado e destino) ----------

/**
 * O segredo salvo (a máscara do modo API) só vale para o mesmo destino. Mudou o ambiente, o
 * Platform ID, a URL base ou a lista de ambientes, o servidor recusa manter o segredo pela
 * máscara (400 "O destino desta credencial mudou"): o segredo precisa ser digitado de novo.
 * `apiMode`: só no modo API o valor salvo é a máscara; na demonstração o segredo está no navegador.
 */
export function secretNeedsRetype(apiMode: boolean, savedSecret: string, destinationChanged: boolean): boolean {
  return apiMode && destinationChanged && !!savedSecret && hasMaskChars(savedSecret)
}

/** Destino do agregador mudou (ambiente atual, Platform ID, URLs dos ambientes)? */
export function aggregatorDestinationChanged(
  next: Pick<Aggregator, 'currentEnv' | 'platformId'> & Partial<Pick<Aggregator, 'environments'>>,
  saved: Pick<Aggregator, 'currentEnv' | 'platformId' | 'environments'>,
): boolean {
  if (next.currentEnv !== saved.currentEnv || next.platformId.trim() !== saved.platformId.trim()) return true
  return !!next.environments && JSON.stringify(next.environments) !== JSON.stringify(saved.environments)
}

// gravação direta na API (fora da fila do adaptador), com o erro do servidor para a tela mostrar no campo
export { dbSaveDirect as saveCredentialsDirect, type DirectSaveResult } from '@/lib/store'

/** O 400 de destino de credencial mudado (segredo mantido pela máscara depois de trocar ambiente, Platform ID…). */
export function isDestinationChangedError(e: ApiError | null): boolean {
  return isDestinationChanged(e)
}

export interface ConnectionResult {
  ok: boolean
  latencyMs: number
  code: number
  message: string
  at: string
  env: string
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * Simula o teste de conexão com o agregador. No servidor real, faz uma chamada
 * autenticada de "ping" no ambiente escolhido e mede a latência.
 */
export function simulateConnection(input: {
  id: string
  env: 'producao' | 'staging'
  platformId: string
  secrets: string[]
  attempt: number
}): ConnectionResult {
  const rng = createRng(hash(`${input.id}|${input.env}|${input.platformId}`) + input.attempt * 97)
  const base = input.env === 'staging' ? rng.int(280, 520) : rng.int(95, 240)
  const at = new Date().toISOString()
  const env = input.env === 'staging' ? 'Staging' : 'Produção'
  if (validatePlatformId(input.platformId)) {
    return { ok: false, latencyMs: base, code: 404, message: 'Platform ID não encontrado no agregador.', at, env }
  }
  if (input.secrets.some((s) => !s)) {
    return { ok: false, latencyMs: base, code: 401, message: 'Falta um segredo. Defina o API secret e o Webhook secret.', at, env }
  }
  return { ok: true, latencyMs: base, code: 200, message: `Autenticado em ${env}.`, at, env }
}

export interface SyncPlan {
  received: number
  newGames: number
  duplicates: number
  /** duplicados em que o jogo do outro agregador foi mantido (por precedência) */
  keptFromOther: number
  removed: number
  newGamesStatus: SyncRules['newGames']
}

/**
 * Prevê o resultado da sincronização: quantos jogos chegam, quantos são novos,
 * duplicados resolvidos pela precedência e quantos saíram do catálogo.
 */
export function planSync(agg: Aggregator, rules: SyncRules, offered: Record<string, AggregatorId[]>, attempt: number): SyncPlan {
  const rng = createRng(hash(agg.id) + attempt * 131)
  const received = Math.max(0, agg.lastSyncGames + rng.int(-6, 18))
  const shared = Object.entries(offered).filter(([, ids]) => ids.includes(agg.id) && ids.length > 1)
  const duplicates = rules.duplicates === 'prioridade' ? shared.reduce((s) => s + rng.int(8, 26), 0) : 0
  const lost = shared.filter(([pid]) => rules.precedence[pid] && rules.precedence[pid] !== agg.id).length
  const keptFromOther = rules.duplicates === 'prioridade' ? Math.round(duplicates * (shared.length ? lost / shared.length : 0)) : 0
  return {
    received,
    newGames: rng.int(2, 14),
    duplicates,
    keptFromOther,
    removed: rules.removedGames === 'pausar' ? rng.int(0, 5) : 0,
    newGamesStatus: rules.newGames,
  }
}

/** Precedência efetiva: a escolhida, se o agregador entrega a provedora; senão o primeiro que entrega. */
export function effectivePrecedence(providerId: string, rules: SyncRules, offered: Record<string, AggregatorId[]>): AggregatorId | null {
  const list = offered[providerId] ?? []
  const chosen = rules.precedence[providerId]
  if (chosen && list.includes(chosen)) return chosen
  return list[0] ?? null
}

// ---------- Provedoras ----------

/** Taxa da provedora sobre o GGR: de 0% a 50%, com até 2 casas. */
export function validateProviderFee(pct: number): string | null {
  if (!Number.isFinite(pct)) return 'Informe a taxa.'
  if (pct < 0 || pct > 50) return 'A taxa vai de 0% a 50%.'
  if (Math.round(pct * 100) !== pct * 100) return 'Use no máximo 2 casas decimais.'
  return null
}
