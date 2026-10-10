// Jogos e mercados do sportsbook de demonstração, e a montagem de um bilhete. Usado pelo livro-razão
// (./ledger), que decide quem aposta, quanto e quando; sem dependência dos jogadores (evita ciclo de import).
import type { Rng } from '@/lib/random'
import type { SportsBet, SportsSelection } from './sports'
import { HOUR, MIN, iso } from './now'

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

/** Duração de um evento até o resultado sair (depois do início). */
const EVENT_LENGTH = 2 * HOUR

export interface Ticket {
  type: SportsBet['type']
  selections: SportsSelection[]
  odd: number
  live: boolean
  /** quando o último evento do bilhete termina (resultado conhecido) */
  settlesAt: number
}

/** Bilhete feito em `at`: eventos ao vivo já começaram; os demais começam até 2 dias depois. */
export function buildTicket(rng: Rng, at: number): Ticket {
  const type = rng.weighted([
    ['simples', 62],
    ['multipla', 34],
    ['sistema', 4],
  ] as const)
  const live = rng.bool(0.3)
  const legs = type === 'simples' ? 1 : rng.int(2, type === 'sistema' ? 4 : 6)
  const selections: SportsSelection[] = []
  let settlesAt = at + 30 * MIN
  for (let l = 0; l < legs; l++) {
    const [event, league, sport] = rng.pick(MATCHES)
    const [home, away] = event.split(' x ')
    const [market, picks] = rng.pick(MARKETS[sport])
    // ao vivo: o 1º evento já está rolando; os outros (e os da pré-partida) começam depois de feito o bilhete
    const startsAt = live && l === 0 ? at - rng.float(0.1, 1.5) * HOUR : at + rng.float(0.2, 48) * HOUR
    settlesAt = Math.max(settlesAt, startsAt + EVENT_LENGTH)
    selections.push({ event, league, sport, market, pick: rng.pick(picks(home, away)), odd: rng.float(1.25, 3.8, 2), startsAt: iso(new Date(startsAt)) })
  }
  const odd = Math.round(selections.reduce((acc, s) => acc * s.odd, 1) * 100) / 100
  return { type, selections, odd, live, settlesAt }
}

/** Nome do bilhete no extrato: o evento (simples) ou "Múltipla (3 seleções)". */
export function ticketLabel(t: Pick<Ticket, 'type' | 'selections'>): string {
  if (t.selections.length === 1) return t.selections[0].event
  return `${t.type === 'sistema' ? 'Sistema' : 'Múltipla'} (${t.selections.length} seleções)`
}
