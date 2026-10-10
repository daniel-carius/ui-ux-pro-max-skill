// Catálogo de cassino: provedoras, jogos e agregadores.
import { createRng } from '@/lib/random'
import { apiValue, demoRecords } from './demo'
import { daysAgo, iso } from './now'

export type GameCategory = 'slots' | 'ao_vivo' | 'crash' | 'mesa' | 'instantaneo' | 'bingo'

export const GAME_CATEGORY_LABEL: Record<GameCategory, string> = {
  slots: 'Slots',
  ao_vivo: 'Ao vivo',
  crash: 'Crash',
  mesa: 'Mesa',
  instantaneo: 'Instantâneo',
  bingo: 'Bingo',
}

export interface Provider {
  id: string
  name: string
  status: 'ativa' | 'pausada'
  aggregatorId: 'metagrator' | 'skravion'
  games: number
  /** taxa cobrada pela provedora sobre o GGR */
  feePct: number
  logoHue: number
  updatedAt: string
}

export interface Game {
  id: string
  name: string
  providerId: string
  category: GameCategory
  rtp: number
  /** pontuação usada na ordenação "maior destaque" */
  highlight: number
  active: boolean
  isNew: boolean
  cover: string | null
  hue: number
  minBet: number
  maxBet: number
  createdAt: string
}

export interface Aggregator {
  id: 'metagrator' | 'skravion'
  name: string
  contracted: boolean
  environments: { id: 'producao' | 'staging'; label: string; baseUrl: string }[]
  currentEnv: 'producao' | 'staging'
  platformId: string
  apiSecret: string
  webhookSecret: string
  lastSyncAt: string | null
  lastSyncGames: number
  status: 'conectado' | 'erro' | 'nao_configurado'
}

const PROVIDER_DEFS: [string, string, Provider['aggregatorId'], number][] = [
  ['pgsoft', 'PG Soft', 'metagrator', 14],
  ['pragmatic', 'Pragmatic Play', 'metagrator', 12],
  ['spribe', 'Spribe', 'skravion', 13],
  ['evolution', 'Evolution', 'metagrator', 15],
  ['playtech', 'Playtech', 'metagrator', 12],
  ['hacksaw', 'Hacksaw Gaming', 'skravion', 11],
  ['netent', 'NetEnt', 'metagrator', 12],
  ['redtiger', 'Red Tiger', 'metagrator', 12],
  ['nolimit', 'Nolimit City', 'skravion', 13],
  ['ezugi', 'Ezugi', 'metagrator', 14],
  ['galaxsys', 'Galaxsys', 'skravion', 10],
  ['turbo', 'Turbo Games', 'skravion', 10],
  ['bgaming', 'BGaming', 'skravion', 11],
  ['pushgaming', 'Push Gaming', 'metagrator', 12],
  ['playngo', "Play'n GO", 'metagrator', 13],
  ['relax', 'Relax Gaming', 'skravion', 12],
  ['habanero', 'Habanero', 'skravion', 10],
  ['wazdan', 'Wazdan', 'skravion', 10],
]

const GAME_DEFS: [string, string, GameCategory][] = [
  ['Fortune Tiger', 'pgsoft', 'slots'],
  ['Fortune Ox', 'pgsoft', 'slots'],
  ['Fortune Rabbit', 'pgsoft', 'slots'],
  ['Fortune Mouse', 'pgsoft', 'slots'],
  ['Fortune Dragon', 'pgsoft', 'slots'],
  ['Mahjong Ways 2', 'pgsoft', 'slots'],
  ['Wild Bandito', 'pgsoft', 'slots'],
  ['Lucky Neko', 'pgsoft', 'slots'],
  ['Ganesha Gold', 'pgsoft', 'slots'],
  ['Gates of Olympus', 'pragmatic', 'slots'],
  ['Sweet Bonanza', 'pragmatic', 'slots'],
  ['Sugar Rush', 'pragmatic', 'slots'],
  ['Big Bass Bonanza', 'pragmatic', 'slots'],
  ['The Dog House', 'pragmatic', 'slots'],
  ['Starlight Princess', 'pragmatic', 'slots'],
  ['Wolf Gold', 'pragmatic', 'slots'],
  ['Spaceman', 'pragmatic', 'crash'],
  ['Roleta Brasileira', 'pragmatic', 'ao_vivo'],
  ['Mega Wheel', 'pragmatic', 'ao_vivo'],
  ['Aviator', 'spribe', 'crash'],
  ['Mines', 'spribe', 'instantaneo'],
  ['Plinko', 'spribe', 'instantaneo'],
  ['Dice', 'spribe', 'instantaneo'],
  ['Goal', 'spribe', 'instantaneo'],
  ['Hi Lo', 'spribe', 'instantaneo'],
  ['Crazy Time', 'evolution', 'ao_vivo'],
  ['Lightning Roulette', 'evolution', 'ao_vivo'],
  ['Monopoly Live', 'evolution', 'ao_vivo'],
  ['Football Studio', 'evolution', 'ao_vivo'],
  ['Bac Bo', 'evolution', 'ao_vivo'],
  ['Blackjack VIP', 'evolution', 'ao_vivo'],
  ['Funky Time', 'evolution', 'ao_vivo'],
  ['XXXtreme Lightning Roulette', 'evolution', 'ao_vivo'],
  ['Age of the Gods', 'playtech', 'slots'],
  ['Buffalo Blitz', 'playtech', 'slots'],
  ['Roleta Quantum', 'playtech', 'ao_vivo'],
  ['Spin a Win', 'playtech', 'ao_vivo'],
  ['Wanted Dead or a Wild', 'hacksaw', 'slots'],
  ['Chaos Crew', 'hacksaw', 'slots'],
  ['Hand of Anubis', 'hacksaw', 'slots'],
  ['Le Bandit', 'hacksaw', 'slots'],
  ['Starburst', 'netent', 'slots'],
  ["Gonzo's Quest", 'netent', 'slots'],
  ['Dead or Alive 2', 'netent', 'slots'],
  ['Divine Fortune', 'netent', 'slots'],
  ['Gonzo Treasure Map', 'redtiger', 'slots'],
  ['Dragon Fortune', 'redtiger', 'slots'],
  ['Piggy Riches', 'redtiger', 'slots'],
  ['Mental', 'nolimit', 'slots'],
  ['San Quentin', 'nolimit', 'slots'],
  ['Tombstone RIP', 'nolimit', 'slots'],
  ['Fire in the Hole', 'nolimit', 'slots'],
  ['Andar Bahar', 'ezugi', 'ao_vivo'],
  ['Teen Patti', 'ezugi', 'ao_vivo'],
  ['Ultimate Roulette', 'ezugi', 'ao_vivo'],
  ['Rocketon', 'galaxsys', 'crash'],
  ['Crash X', 'galaxsys', 'crash'],
  ['Jet X', 'galaxsys', 'crash'],
  ['Double', 'turbo', 'instantaneo'],
  ['Crash Turbo', 'turbo', 'crash'],
  ['Bingo Brasil', 'turbo', 'bingo'],
  ['Elvis Frog in Vegas', 'bgaming', 'slots'],
  ['Aztec Magic', 'bgaming', 'slots'],
  ['Plinko XY', 'bgaming', 'instantaneo'],
  ['Razor Shark', 'pushgaming', 'slots'],
  ['Jammin Jars', 'pushgaming', 'slots'],
  ['Book of Dead', 'playngo', 'slots'],
  ['Reactoonz', 'playngo', 'slots'],
  ['Rise of Olympus', 'playngo', 'slots'],
  ['Money Train 3', 'relax', 'slots'],
  ['Temple Tumble', 'relax', 'slots'],
  ['Hot Hot Fruit', 'habanero', 'slots'],
  ['Koi Gate', 'habanero', 'slots'],
  ['Burning Wins', 'wazdan', 'slots'],
  ['9 Coins', 'wazdan', 'slots'],
  ['Blackjack Clássico', 'playtech', 'mesa'],
  ['Baccarat Pro', 'evolution', 'mesa'],
  ['Video Poker', 'wazdan', 'mesa'],
]

const RTP_BY_CATEGORY: Record<GameCategory, [number, number]> = {
  slots: [94.5, 96.8],
  ao_vivo: [95.5, 98.7],
  crash: [96, 97],
  mesa: [97, 99.5],
  instantaneo: [96, 99],
  bingo: [92, 95],
}

export function seedProviders(): Provider[] {
  const rng = createRng(31)
  return PROVIDER_DEFS.map(([id, name, aggregatorId, fee], i) => ({
    id,
    name,
    aggregatorId,
    status: id === 'wazdan' || id === 'habanero' ? 'pausada' : 'ativa',
    games: GAME_DEFS.filter((g) => g[1] === id).length,
    feePct: fee,
    logoHue: (i * 47) % 360,
    updatedAt: iso(daysAgo(rng.int(1, 40))),
  }))
}

export function seedGames(): Game[] {
  const rng = createRng(77)
  return GAME_DEFS.map(([name, providerId, category], i) => {
    const [lo, hi] = RTP_BY_CATEGORY[category]
    const popular = i < 12 || ['Aviator', 'Mines', 'Spaceman', 'Crazy Time', 'Roleta Brasileira', 'Bac Bo'].includes(name)
    return {
      id: `g${String(i + 1).padStart(3, '0')}`,
      name,
      providerId,
      category,
      rtp: rng.float(lo, hi, 2),
      highlight: popular ? rng.int(70, 100) : rng.int(5, 69),
      active: !['Video Poker', 'Koi Gate'].includes(name),
      isNew: rng.bool(0.12),
      cover: null,
      hue: (i * 37 + 200) % 360,
      minBet: category === 'ao_vivo' ? 1 : 0.4,
      maxBet: category === 'ao_vivo' ? 5000 : 1000,
      createdAt: iso(daysAgo(rng.int(10, 400))),
    }
  })
}

export function seedAggregators(): Aggregator[] {
  return [
    {
      id: 'metagrator',
      name: 'Metagrator',
      contracted: true,
      environments: [
        { id: 'producao', label: 'Produção', baseUrl: 'https://api.metagrator.io/v2' },
        { id: 'staging', label: 'Staging', baseUrl: 'https://staging.metagrator.io/v2' },
      ],
      currentEnv: 'producao',
      platformId: 'x2win-br-prod',
      apiSecret: 'DEMO-metagrator-api-secret-0001-a9F2',
      webhookSecret: 'DEMO-metagrator-webhook-secret-K7q',
      lastSyncAt: iso(daysAgo(0.2)),
      lastSyncGames: 1840,
      status: 'conectado',
    },
    {
      id: 'skravion',
      name: 'Skravion',
      contracted: true,
      environments: [{ id: 'producao', label: 'Produção', baseUrl: 'https://gw.skravion.com/api' }],
      currentEnv: 'producao',
      platformId: 'x2w-7781',
      apiSecret: 'DEMO-skravion-api-secret-0002-Lp8',
      webhookSecret: 'DEMO-skravion-webhook-secret-Xz1',
      lastSyncAt: iso(daysAgo(1.4)),
      lastSyncGames: 960,
      status: 'conectado',
    },
  ]
}

/** Credenciais do sportsbook (Betby) — campos próprios */
export interface SportsbookCredentials {
  platformId: string
  publicKey: string
  privateKey: string
  webhookSecret: string
  status: 'conectado' | 'erro'
}

export function seedSportsbookCredentials(): SportsbookCredentials {
  return {
    platformId: 'x2win-sb-br',
    publicKey: 'DEMO-sportsbook-public-key-T4m2',
    privateKey: 'DEMO-sportsbook-private-key-R8s1',
    webhookSecret: 'DEMO-sportsbook-webhook-secret-Q9w4',
    status: 'conectado',
  }
}

// modo API: catálogo e agregadores vêm do servidor (DEMO_DATA grava estes mesmos); sem nada gravado,
// listas vazias. Credenciais do sportsbook sem nada gravado: em branco (nunca as chaves DEMO).
demoRecords(seedProviders)
demoRecords(seedGames)
demoRecords(seedAggregators)
apiValue(seedSportsbookCredentials, (): SportsbookCredentials => ({ platformId: '', publicKey: '', privateKey: '', webhookSecret: '', status: 'erro' }))
