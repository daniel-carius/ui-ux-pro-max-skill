// Contagens da base de jogadores para telas de Configurações que só mostram números
// (Cadastro, Jogo responsável, Textos legais).
// Modo demonstração: calculadas da lista de jogadores do navegador.
// Modo API: estas telas não leem a base (geral.jogadores); leem as contagens prontas
// do servidor em geral.jogadores.metricas (GET sempre responde stored:true; sem base,
// tudo zero).
import { useMemo } from 'react'
import type { Player } from '@/data/players'
import { usePlayers } from '@/data/hooks'
import { isApiMode } from '@/lib/api'
import { useDb } from '@/lib/store'

export const PLAYER_METRICS_KEY = 'geral.jogadores.metricas'

type StatusCount = 'ativo' | 'bloqueado' | 'autoexcluido' | 'pausa' | 'outros'
type KycCount = 'verificado' | 'pendente' | 'nao_enviado' | 'reprovado'

/** Parte de geral.jogadores.metricas que estas telas usam. */
export interface PlayerMetrics {
  total: number
  byStatus: Record<StatusCount, number>
  kyc: Record<KycCount, number>
  depositors: number
  generatedAt: string | null
}

export interface PlayerCounts extends PlayerMetrics {
  /** lista completa: só na demonstração (no modo API a tela não lê a base) */
  players: Player[] | null
}

export const EMPTY_PLAYER_METRICS: PlayerMetrics = {
  total: 0,
  byStatus: { ativo: 0, bloqueado: 0, autoexcluido: 0, pausa: 0, outros: 0 },
  kyc: { verificado: 0, pendente: 0, nao_enviado: 0, reprovado: 0 },
  depositors: 0,
  generatedAt: null,
}

/** Mesmas contagens do servidor, a partir da lista (demonstração). */
export function countPlayers(players: Player[]): PlayerMetrics {
  const byStatus = { ...EMPTY_PLAYER_METRICS.byStatus }
  const kyc = { ...EMPTY_PLAYER_METRICS.kyc }
  let depositors = 0
  for (const p of players) {
    const s: StatusCount = p.status in byStatus ? p.status : 'outros'
    byStatus[s]++
    if (p.kyc in kyc) kyc[p.kyc as KycCount]++
    if (p.depositsCount > 0) depositors++
  }
  return { total: players.length, byStatus, kyc, depositors, generatedAt: null }
}

/** Valor do servidor com o formato conferido (campo ausente ou estranho conta zero). */
function normalize(v: unknown): PlayerMetrics {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<PlayerMetrics>
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  const pick = <K extends string>(src: unknown, base: Record<K, number>) => {
    const s = (src && typeof src === 'object' ? src : {}) as Record<string, unknown>
    const out = { ...base }
    for (const k of Object.keys(base) as K[]) out[k] = n(s[k])
    return out
  }
  return {
    total: n(o.total),
    byStatus: pick(o.byStatus, EMPTY_PLAYER_METRICS.byStatus),
    kyc: pick(o.kyc, EMPTY_PLAYER_METRICS.kyc),
    depositors: n(o.depositors),
    generatedAt: typeof o.generatedAt === 'string' ? o.generatedAt : null,
  }
}

function useDemoPlayerCounts(): PlayerCounts {
  const { items } = usePlayers()
  return useMemo(() => ({ ...countPlayers(items), players: items }), [items])
}

function useServerPlayerCounts(): PlayerCounts {
  const [value] = useDb<PlayerMetrics>(PLAYER_METRICS_KEY, EMPTY_PLAYER_METRICS)
  return useMemo(() => ({ ...normalize(value), players: null }), [value])
}

/** Contagens da base de jogadores (escolhidas uma vez: o modo não muda com a página aberta). */
export const usePlayerCounts: () => PlayerCounts = isApiMode() ? useServerPlayerCounts : useDemoPlayerCounts
