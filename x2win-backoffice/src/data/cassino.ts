// Dados de demonstração do módulo Cassino que não estão no catálogo base:
// vitrines da home, selos de jogos, regras de sincronização dos agregadores.
import type { AggregatorId, GameBadge, Showcase, SyncRules } from '@/domain/cassino'
import { seedGames, seedProviders } from './catalog'
import { DAY, NOW, iso } from './now'

export const CASSINO_KEYS = {
  showcases: 'cassino.vitrines',
  gamesView: 'cassino.jogos.visao',
  gameBadges: 'cassino.jogos.selos',
  providersRefresh: 'cassino.provedoras.atualizacao',
  aggregatorTests: 'cassino.agregadores.testes',
  aggregatorSyncs: 'cassino.agregadores.sincronizacoes',
  secretsMeta: 'cassino.agregadores.segredos',
  aggregatorRules: 'cassino.agregadores.regras',
  sportsbook: 'cassino.sportsbook-credenciais',
  sportsbookTest: 'cassino.sportsbook-credenciais.teste',
} as const

const gameId = (() => {
  let map: Map<string, string> | null = null
  return (name: string) => {
    if (!map) map = new Map(seedGames().map((g) => [g.name, g.id]))
    return map.get(name) ?? ''
  }
})()

export function seedGameBadges(): Record<string, GameBadge[]> {
  const out: Record<string, GameBadge[]> = {}
  const add = (name: string, b: GameBadge) => {
    const id = gameId(name)
    if (id) out[id] = [...(out[id] ?? []), b]
  }
  ;['Fortune Tiger', 'Aviator', 'Gates of Olympus', 'Crazy Time', 'Mines', 'Sweet Bonanza'].forEach((n) => add(n, 'em_alta'))
  ;['Roleta Brasileira', 'Bingo Brasil'].forEach((n) => add(n, 'exclusivo'))
  ;['Age of the Gods', 'Divine Fortune', 'Mega Wheel'].forEach((n) => add(n, 'jackpot'))
  return out
}

export function seedShowcases(): Showcase[] {
  const at = (d: number) => iso(new Date(NOW.getTime() - d * DAY))
  return [
    {
      id: 'vt-top10',
      name: 'Top 10 da semana',
      type: 'mais_jogados',
      gameIds: [],
      providerId: null,
      limit: 10,
      visible: true,
      updatedAt: at(12),
      updatedBy: 'Daniel Carius',
    },
    {
      id: 'vt-aovivo',
      name: 'Melhores ao vivo',
      type: 'ao_vivo',
      gameIds: [],
      providerId: null,
      limit: 12,
      visible: true,
      updatedAt: at(20),
      updatedBy: 'Daniel Carius',
    },
    {
      id: 'vt-casa',
      name: 'Escolhas da casa',
      type: 'manual',
      gameIds: ['Fortune Tiger', 'Aviator', 'Gates of Olympus', 'Sweet Bonanza', 'Mines', 'Crazy Time', 'Big Bass Bonanza', 'Wanted Dead or a Wild', 'Koi Gate'].map(gameId),
      providerId: null,
      limit: 12,
      visible: true,
      updatedAt: at(5),
      updatedBy: 'Daniel Carius',
    },
    {
      id: 'vt-lancamentos',
      name: 'Lançamentos',
      type: 'novos',
      gameIds: [],
      providerId: null,
      limit: 12,
      visible: false,
      updatedAt: at(41),
      updatedBy: 'Daniel Carius',
    },
  ]
}

/** Provedoras que chegam pelos dois agregadores (o catálogo pode ter duplicados). */
const BOTH = new Set(['pgsoft', 'pragmatic', 'spribe', 'evolution', 'hacksaw', 'nolimit', 'playngo', 'bgaming'])

/** Quais agregadores entregam cada provedora. */
export function providerOffers(): Record<string, AggregatorId[]> {
  const out: Record<string, AggregatorId[]> = {}
  for (const p of seedProviders()) {
    const other: AggregatorId = p.aggregatorId === 'metagrator' ? 'skravion' : 'metagrator'
    out[p.id] = BOTH.has(p.id) ? [p.aggregatorId, other] : [p.aggregatorId]
  }
  return out
}

export function defaultSyncRules(): SyncRules {
  return {
    precedence: Object.fromEntries(seedProviders().map((p) => [p.id, p.aggregatorId])),
    duplicates: 'prioridade',
    newGames: 'pausado',
    removedGames: 'pausar',
    autoSync: true,
    autoSyncHour: 4,
  }
}
