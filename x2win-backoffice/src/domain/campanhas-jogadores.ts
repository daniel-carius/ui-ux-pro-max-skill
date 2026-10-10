// Jogadores nas telas de Campanhas.
// Demonstração: a lista completa de jogadores do navegador (usePlayers), como sempre.
// Modo API: as telas de campanha não leem a base de jogadores (dado pessoal e
// financeiro, LGPD art. 6º III). Leem as visões que o servidor calcula a partir dela:
//  - geral.jogadores.audiencia: o público de marketing, só jogadores ativos (nunca
//    autoexcluídos, em pausa nem bloqueados), com campos mínimos e sem nome, e-mail
//    ou saldo;
//  - geral.jogadores.metricas: contagens (tamanho da base, moedas em circulação e a
//    projeção do próximo crédito do cashback, calculada com as regras salvas).
// As duas são só leitura e têm a versão da base de jogadores: salvar o cashback ou os
// níveis muda a projeção sem mudar a versão (refreshPlayerMetrics busca de novo).
import { useMemo } from 'react'
import { usePlayers } from '@/data/hooks'
import type { Player } from '@/data/players'
import { isApiMode } from '@/lib/api'
import { prefetchKeys, refreshKey, useDb, type Collection } from '@/lib/store'
import type { CashbackPeriod } from './campanhas3-cashback'
import type { CampaignPlayer } from './campanhas-jogador'

export type { CampaignPlayer }

export const AUDIENCE_KEY = 'geral.jogadores.audiencia'
export const PLAYER_METRICS_KEY = 'geral.jogadores.metricas'

const API = isApiMode()

/** Projeção do próximo crédito do cashback num período (só totais). */
export interface CashbackProjection {
  /** jogadores ativos que entraram no período */
  active: number
  /** dos ativos, os que têm direito (0 com o cashback desligado) */
  eligible: number
  /** soma do cashback estimado dos elegíveis, já limitado pelo teto (R$) */
  total: number
  /** elegíveis limitados pelo teto */
  capped: number
}

/** Parte de geral.jogadores.metricas que as campanhas usam. */
export interface CampaignMetrics {
  /** jogadores na base (todos os status) */
  total: number
  /** jogadores ativos: os únicos que recebem campanhas */
  active: number
  coins: { circulation: number; holders: number }
  cashback: Record<CashbackPeriod, CashbackProjection>
}

const ZERO_PROJECTION: CashbackProjection = { active: 0, eligible: 0, total: 0, capped: 0 }
export const EMPTY_CAMPAIGN_METRICS: CampaignMetrics = {
  total: 0,
  active: 0,
  coins: { circulation: 0, holders: 0 },
  cashback: { diario: ZERO_PROJECTION, semanal: ZERO_PROJECTION, mensal: ZERO_PROJECTION },
}
/** valores padrão estáveis (o store compara a referência) */
const NO_AUDIENCE: unknown[] = []
const NO_METRICS: unknown = {}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const text = (v: unknown) => (typeof v === 'string' ? v : '')
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** Público do servidor no formato das campanhas (campo ausente ou estranho vira vazio/zero). */
export function audienceToPlayers(value: unknown): CampaignPlayer[] {
  if (!Array.isArray(value)) return []
  const out: CampaignPlayer[] = []
  for (const raw of value) {
    const p = obj(raw)
    if (typeof p.id !== 'string' || !p.id) continue
    out.push({
      id: p.id,
      nickname: text(p.nickname) || `jogador${p.id}`,
      // o servidor só manda quem pode receber marketing
      status: 'ativo',
      level: num(p.level),
      xp: num(p.xp),
      tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string') : [],
      createdAt: text(p.createdAt),
      lastAccess: text(p.lastAccess),
      depositsCount: num(p.depositsCount),
      lastDepositAt: typeof p.lastDepositAt === 'string' ? p.lastDepositAt : null,
    })
  }
  return out
}

/** Contagens do servidor com o formato conferido. */
export function normalizeMetrics(value: unknown): CampaignMetrics {
  const m = obj(value)
  const coins = obj(m.coins)
  const cb = obj(m.cashback)
  const projection = (v: unknown): CashbackProjection => {
    const p = obj(v)
    return { active: num(p.active), eligible: num(p.eligible), total: num(p.total), capped: num(p.capped) }
  }
  return {
    total: num(m.total),
    active: num(obj(m.byStatus).ativo),
    coins: { circulation: num(coins.circulation), holders: num(coins.holders) },
    cashback: { diario: projection(cb.diario), semanal: projection(cb.semanal), mensal: projection(cb.mensal) },
  }
}

export interface CampaignBase {
  /** jogadores que a tela enxerga: a base inteira (demonstração) ou só o público de marketing (modo API) */
  players: CampaignPlayer[]
  /** tamanho da base inteira */
  total: number
  /** true quando `players` já vem só com quem pode receber marketing (modo API) */
  reachableOnly: boolean
}

function useDemoBase(): CampaignBase {
  const { items } = usePlayers()
  return useMemo(() => ({ players: items, total: items.length, reachableOnly: false }), [items])
}

function useServerBase(): CampaignBase {
  // as duas chegam juntas (sem esperar uma para pedir a outra)
  prefetchKeys([AUDIENCE_KEY, PLAYER_METRICS_KEY])
  const [audience] = useDb<unknown>(AUDIENCE_KEY, NO_AUDIENCE)
  const [metrics] = useDb<unknown>(PLAYER_METRICS_KEY, NO_METRICS)
  return useMemo(() => {
    const players = audienceToPlayers(audience)
    return { players, total: Math.max(normalizeMetrics(metrics).total, players.length), reachableOnly: true }
  }, [audience, metrics])
}

/**
 * Jogadores das telas de público (Promoções, Free spins, Torneios, Níveis, Disparos,
 * Notificações, Popups e inbox). Escolhido uma vez: o modo não muda com a página aberta.
 */
export const useCampaignPlayers: () => CampaignBase = API ? useServerBase : useDemoBase

function useServerMetrics(): CampaignMetrics {
  const [metrics] = useDb<unknown>(PLAYER_METRICS_KEY, NO_METRICS)
  return useMemo(() => normalizeMetrics(metrics), [metrics])
}

function useNoMetrics(): CampaignMetrics | null {
  return null
}

/** Contagens do servidor (modo API); null na demonstração, que calcula a partir da lista. */
export const usePlayerMetrics: () => CampaignMetrics | null = API ? useServerMetrics : useNoMetrics

function useDemoCoinStats() {
  const { items } = usePlayers()
  return useMemo(() => ({ circulation: items.reduce((s, p) => s + p.coins, 0), holders: items.filter((p) => p.coins > 0).length }), [items])
}

function useServerCoinStats() {
  return useServerMetrics().coins
}

/** Moedas em circulação e jogadores com saldo de moedas. */
export const useCoinStats: () => { circulation: number; holders: number } = API ? useServerCoinStats : useDemoCoinStats

function useNoPlayers(): Collection<Player> | null {
  return null
}

/**
 * Lista completa de jogadores, só na demonstração (simulações que mexem no jogador,
 * como o resgate simulado de cupom). Modo API: null; quem mexe no jogador é o servidor.
 */
export const useDemoPlayers: () => Collection<Player> | null = API ? useNoPlayers : usePlayers

/** Busca de novo as contagens (modo API), depois de salvar regras que mudam a projeção do cashback. */
export function refreshPlayerMetrics() {
  if (API) void refreshKey(PLAYER_METRICS_KEY).catch(() => {})
}
