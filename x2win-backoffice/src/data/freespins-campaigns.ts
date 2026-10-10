// Campanhas de free spins de demonstração (determinísticas). Ficam fora de ./campanhas-freespins para o
// livro-razão (./ledger) poder ler as regras sem ciclo de importação: as concessões e o ganho dos giros
// saem da história de cada conta (Free spin no extrato).
// Sem dependência do React: o servidor usa estes dados na semeadura (DEMO_DATA).
import type { FreeSpinCampaign } from '@/domain/campanhas-freespins'
import { seedGames } from './catalog'
import { DEMO_STAFF_LABEL } from './demo'
import { DAY, NOW, iso } from './now'

export const FS_KEYS = {
  campaigns: 'campanhas.free-spins',
  grants: 'campanhas.free-spins.concessoes',
} as const

const gid = (name: string) => seedGames().find((g) => g.name === name)?.id ?? 'g001'
const at = (days: number) => iso(new Date(NOW.getTime() + days * DAY))

/** Campanha pausada: até quando concedeu (na demonstração, a pausa foi há 3 semanas). */
export const FS_DEMO_PAUSED_AT: Record<string, string> = { fs02: at(-21) }

export function seedFsCampaigns(): FreeSpinCampaign[] {
  return [
    {
      id: 'fs01',
      name: '100 giros no 2º depósito',
      trigger: 'deposito',
      depositNumber: 2,
      minDeposit: 20,
      couponCode: '',
      gameId: gid('Fortune Tiger'),
      spins: 100,
      spinValue: 0.4,
      validityDays: 7,
      winRollover: 10,
      maxPerPlayer: 1,
      paused: false,
      startAt: at(-30),
      endAt: null,
      estimatedPlayers: 900,
      createdAt: at(-33),
      createdBy: DEMO_STAFF_LABEL,
    },
    {
      id: 'fs02',
      name: 'Sexta dos giros',
      trigger: 'cupom',
      depositNumber: 1,
      minDeposit: 0,
      couponCode: 'GIROSEXTA',
      gameId: gid('Sweet Bonanza'),
      spins: 30,
      spinValue: 0.5,
      validityDays: 3,
      winRollover: 15,
      maxPerPlayer: 4,
      paused: true,
      startAt: at(-40),
      endAt: at(20),
      estimatedPlayers: 400,
      createdAt: at(-42),
      createdBy: DEMO_STAFF_LABEL,
    },
    {
      id: 'fs03',
      name: '50 giros de boas-vindas',
      trigger: 'cadastro',
      depositNumber: 1,
      minDeposit: 0,
      couponCode: '',
      gameId: gid('Gates of Olympus'),
      spins: 50,
      spinValue: 0.4,
      validityDays: 5,
      winRollover: 20,
      maxPerPlayer: 1,
      paused: false,
      startAt: at(-120),
      endAt: at(-45),
      estimatedPlayers: 1500,
      createdAt: at(-125),
      createdBy: DEMO_STAFF_LABEL,
    },
    {
      id: 'fs04',
      name: 'Giros de aniversário VIP',
      trigger: 'manual',
      depositNumber: 1,
      minDeposit: 0,
      couponCode: '',
      gameId: gid('Fortune Ox'),
      spins: 200,
      spinValue: 1,
      validityDays: 10,
      winRollover: 5,
      maxPerPlayer: 1,
      paused: false,
      startAt: at(-200),
      endAt: at(-10),
      estimatedPlayers: 60,
      createdAt: at(-201),
      createdBy: DEMO_STAFF_LABEL,
    },
  ]
}
