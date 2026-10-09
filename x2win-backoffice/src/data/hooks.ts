// Acesso às coleções compartilhadas. Use estes hooks nas telas para que as
// mudanças feitas numa tela apareçam nas outras (mesma "base de dados").
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

export const usePlayers = () => useCollection(DATA_KEYS.players, seedPlayers)
export const useTransactions = () => useCollection(DATA_KEYS.transactions, seedTransactions)
export const useDeposits = () => useCollection(DATA_KEYS.deposits, seedDeposits)
export const useWithdrawals = () => useCollection(WITHDRAWAL_KEYS.list, seedWithdrawals)
export const useSportsBets = () => useCollection(DATA_KEYS.sportsBets, seedSportsBets)
export const useGames = () => useCollection(DATA_KEYS.games, seedGames)
export const useProviders = () => useCollection(DATA_KEYS.providers, seedProviders)
export const useAggregators = () => useCollection(DATA_KEYS.aggregators, seedAggregators)
export const useAffiliates = () => useCollection(DATA_KEYS.affiliates, seedAffiliates)
export const useWebhookDestinations = () => useCollection(WEBHOOK_KEYS.destinations, seedWebhookDestinations)
export const useWebhookExecutions = () => useCollection(WEBHOOK_KEYS.executions, seedWebhookExecutions)
