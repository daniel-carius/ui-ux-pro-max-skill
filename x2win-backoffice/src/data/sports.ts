// Apostas esportivas (sportsbook Betby). Jogos e mercados em ./sports-markets.
import { demoRecords } from './demo'
import { demoLedger } from './players'

export type SportsBetStatus = 'aberta' | 'ganha' | 'perdida' | 'cancelada' | 'cashout' | 'reembolsada'

export const SPORTS_BET_STATUS_LABEL: Record<SportsBetStatus, string> = {
  aberta: 'Aberta',
  ganha: 'Ganha',
  perdida: 'Perdida',
  cancelada: 'Cancelada',
  cashout: 'Cash out',
  reembolsada: 'Reembolsada',
}

export interface SportsSelection {
  event: string
  league: string
  sport: 'Futebol' | 'Basquete' | 'Tênis' | 'eSports' | 'MMA' | 'Vôlei'
  market: string
  pick: string
  odd: number
  startsAt: string
}

export interface SportsBet {
  id: string
  at: string
  playerId: string
  playerName: string
  type: 'simples' | 'multipla' | 'sistema'
  selections: SportsSelection[]
  stake: number
  odd: number
  potential: number
  paid: number
  status: SportsBetStatus
  provider: 'Betby'
  live: boolean
}

/**
 * Bilhetes dos últimos 90 dias, do mais novo para o mais antigo. Saem do livro-razão dos jogadores (./ledger):
 * a aposta e o prêmio também estão no extrato, e só aposta quem tem saldo.
 */
export function seedSportsBets(): SportsBet[] {
  return demoLedger().sportsBets
}

// modo API: as apostas vêm do sportsbook (DEMO_DATA grava estas mesmas); sem nada gravado, lista vazia
demoRecords(seedSportsBets)
