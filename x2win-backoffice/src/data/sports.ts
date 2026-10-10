// Apostas esportivas (sportsbook Betby).
import { createRng } from '@/lib/random'
import { demoRecords } from './demo'
import { HOUR, NOW, iso } from './now'
import { seedPlayers } from './players'

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

const MATCHES: [string, string, SportsSelection['sport']][] = [
  ['Flamengo x Palmeiras', 'Brasileirão Série A', 'Futebol'],
  ['Corinthians x São Paulo', 'Brasileirão Série A', 'Futebol'],
  ['Grêmio x Internacional', 'Brasileirão Série A', 'Futebol'],
  ['Atlético-MG x Cruzeiro', 'Brasileirão Série A', 'Futebol'],
  ['Fluminense x Botafogo', 'Brasileirão Série A', 'Futebol'],
  ['Bahia x Vitória', 'Brasileirão Série A', 'Futebol'],
  ['Santos x Sport', 'Brasileirão Série B', 'Futebol'],
  ['Real Madrid x Barcelona', 'La Liga', 'Futebol'],
  ['Manchester City x Arsenal', 'Premier League', 'Futebol'],
  ['Liverpool x Chelsea', 'Premier League', 'Futebol'],
  ['PSG x Olympique de Marseille', 'Ligue 1', 'Futebol'],
  ['Inter de Milão x Juventus', 'Serie A', 'Futebol'],
  ['Boca Juniors x River Plate', 'Liga Profesional', 'Futebol'],
  ['Lakers x Celtics', 'NBA', 'Basquete'],
  ['Warriors x Nuggets', 'NBA', 'Basquete'],
  ['Flamengo x Franca', 'NBB', 'Basquete'],
  ['Sinner x Alcaraz', 'ATP Finals', 'Tênis'],
  ['João Fonseca x Medvedev', 'ATP 500', 'Tênis'],
  ['FURIA x NAVI', 'CS2 Major', 'eSports'],
  ['LOUD x paiN', 'CBLOL', 'eSports'],
  ['Poatan x Ankalaev', 'UFC', 'MMA'],
  ['Brasil x Itália', 'Liga das Nações', 'Vôlei'],
]

const MARKETS: Record<SportsSelection['sport'], [string, (home: string, away: string) => string[]][]> = {
  Futebol: [
    ['Resultado final', (h, a) => [h, 'Empate', a]],
    ['Ambas marcam', () => ['Sim', 'Não']],
    ['Total de gols', () => ['Mais de 2.5', 'Menos de 2.5', 'Mais de 1.5']],
    ['Dupla chance', (h, a) => [`${h} ou empate`, `${a} ou empate`]],
    ['Escanteios', () => ['Mais de 9.5', 'Menos de 9.5']],
  ],
  Basquete: [
    ['Vencedor', (h, a) => [h, a]],
    ['Total de pontos', () => ['Mais de 221.5', 'Menos de 221.5']],
    ['Handicap', (h) => [`${h} -4.5`, `${h} +4.5`]],
  ],
  Tênis: [
    ['Vencedor', (h, a) => [h, a]],
    ['Total de games', () => ['Mais de 22.5', 'Menos de 22.5']],
  ],
  eSports: [
    ['Vencedor do mapa 1', (h, a) => [h, a]],
    ['Vencedor da série', (h, a) => [h, a]],
  ],
  MMA: [
    ['Vencedor', (h, a) => [h, a]],
    ['Método de vitória', () => ['Nocaute', 'Finalização', 'Decisão']],
  ],
  Vôlei: [
    ['Vencedor', (h, a) => [h, a]],
    ['Total de sets', () => ['Mais de 3.5', 'Menos de 3.5']],
  ],
}

let _bets: SportsBet[] | null = null

export function seedSportsBets(): SportsBet[] {
  if (_bets) return _bets
  const rng = createRng(8080)
  const players = seedPlayers().filter((p) => p.depositsCount > 0)
  const out: SportsBet[] = []
  for (let i = 0; i < 220; i++) {
    const p = rng.pick(players)
    const hoursAgo = Math.pow(rng.next(), 1.3) * 24 * 21
    const at = new Date(NOW.getTime() - hoursAgo * HOUR)
    const type = rng.weighted([
      ['simples', 62],
      ['multipla', 34],
      ['sistema', 4],
    ] as const)
    const legs = type === 'simples' ? 1 : rng.int(2, type === 'sistema' ? 4 : 6)
    const selections: SportsSelection[] = []
    for (let l = 0; l < legs; l++) {
      const [event, league, sport] = rng.pick(MATCHES)
      const [home, away] = event.split(' x ')
      const [market, picks] = rng.pick(MARKETS[sport])
      selections.push({
        event,
        league,
        sport,
        market,
        pick: rng.pick(picks(home, away)),
        odd: rng.float(1.25, 3.8, 2),
        startsAt: iso(new Date(at.getTime() + rng.float(0.2, 72) * HOUR)),
      })
    }
    const odd = Math.round(selections.reduce((acc, s) => acc * s.odd, 1) * 100) / 100
    const stake = rng.pick([2, 5, 5, 10, 10, 20, 25, 50, 100, 200, 500])
    const potential = Math.round(stake * odd * 100) / 100
    const settled = hoursAgo > 30 || rng.bool(0.45)
    // chance de ganhar coerente com a odd (margem da casa de ~8%)
    const roll = rng.next()
    const status: SportsBetStatus = !settled
      ? 'aberta'
      : roll < 0.03
        ? 'cancelada'
        : roll < 0.06
          ? 'reembolsada'
          : roll < 0.11
            ? 'cashout'
            : rng.bool(0.92 / odd)
              ? 'ganha'
              : 'perdida'
    const paid =
      status === 'ganha'
        ? potential
        : status === 'cashout'
          ? Math.round(stake * rng.float(0.6, 0.95) * 100) / 100
          : status === 'cancelada' || status === 'reembolsada'
            ? stake
            : 0
    out.push({
      id: `SB${String(330100 + i * 9)}`,
      at: iso(at),
      playerId: p.id,
      playerName: p.name,
      type,
      selections,
      stake,
      odd,
      potential,
      paid,
      status,
      provider: 'Betby',
      live: rng.bool(0.3),
    })
  }
  _bets = out.sort((a, b) => b.at.localeCompare(a.at))
  return _bets
}

// modo API: as apostas vêm do sportsbook (DEMO_DATA grava estas mesmas); sem nada gravado, lista vazia
demoRecords(seedSportsBets)
