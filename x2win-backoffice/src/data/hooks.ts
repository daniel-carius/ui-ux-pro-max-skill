// Acesso às coleções compartilhadas. Use estes hooks nas telas para que as
// mudanças feitas numa tela apareçam nas outras (mesma "base de dados").
// Modo API: sem dados de demonstração. O que não está gravado no servidor
// aparece como lista vazia (a tela mostra o estado vazio).
import { isApiMode } from '@/lib/api'
import { useCollection } from '@/lib/store'
import { WITHDRAWAL_KEYS } from '@/domain/withdrawals'
import { WEBHOOK_KEYS, seedWebhookDestinations, seedWebhookExecutions } from '@/domain/webhooks'
import { seedAggregators, seedGames, seedProviders } from './catalog'
import { seedDeposits, seedTransactions, seedWithdrawals } from './finance'
import { seedAffiliates, seedPlayers } from './players'
import { seedSportsBets } from './sports'

export const DATA_KEYS = {
  players: 'geral.jogadores',
  transactions: 'geral.transacoes',
  deposits: 'operacao.depositos',
  sportsBets: 'esportes.apostas',
  games: 'cassino.jogos',
  providers: 'cassino.provedoras',
  aggregators: 'cassino.agregadores',
  affiliates: 'crescimento.afiliados',
} as const

const API = isApiMode()
/** sem nada gravado no servidor: lista vazia (o mesmo valor sempre, para o store não ver mudança) */
const NONE = (): never[] => []

/** Gerador de demonstração no modo demonstração; lista vazia no modo API. */
function demo<T>(seed: () => T[]): () => T[] {
  return API ? NONE : seed
}

export const usePlayers = () => useCollection(DATA_KEYS.players, demo(seedPlayers))
export const useTransactions = () => useCollection(DATA_KEYS.transactions, demo(seedTransactions))
export const useDeposits = () => useCollection(DATA_KEYS.deposits, demo(seedDeposits))
export const useWithdrawals = () => useCollection(WITHDRAWAL_KEYS.list, demo(seedWithdrawals))
export const useSportsBets = () => useCollection(DATA_KEYS.sportsBets, demo(seedSportsBets))
export const useGames = () => useCollection(DATA_KEYS.games, demo(seedGames))
export const useProviders = () => useCollection(DATA_KEYS.providers, demo(seedProviders))
export const useAggregators = () => useCollection(DATA_KEYS.aggregators, demo(seedAggregators))
export const useAffiliates = () => useCollection(DATA_KEYS.affiliates, demo(seedAffiliates))
export const useWebhookDestinations = () => useCollection(WEBHOOK_KEYS.destinations, demo(seedWebhookDestinations))
export const useWebhookExecutions = () => useCollection(WEBHOOK_KEYS.executions, demo(seedWebhookExecutions))
