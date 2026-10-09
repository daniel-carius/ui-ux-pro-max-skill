// Campanhas de free spins e concessões de demonstração (determinísticas).
import { createRng } from '@/lib/random'
import type { FreeSpinCampaign, FreeSpinGrant } from '@/domain/campanhas-freespins'
import { seedGames } from './catalog'
import { DAY, HOUR, NOW, iso } from './now'
import { seedPlayers } from './players'

export const FS_KEYS = {
  campaigns: 'campanhas.free-spins',
  grants: 'campanhas.free-spins.concessoes',
} as const

const gid = (name: string) => seedGames().find((g) => g.name === name)?.id ?? 'g001'
const at = (days: number) => iso(new Date(NOW.getTime() + days * DAY))

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
      createdBy: 'Marina Duarte',
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
      createdBy: 'Rafael Monteiro',
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
      createdBy: 'Daniel Carius',
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
      createdBy: 'Daniel Carius',
    },
  ]
}

export function seedFsGrants(): FreeSpinGrant[] {
  const rng = createRng(1717)
  const campaigns = seedFsCampaigns()
  const players = seedPlayers().filter((p) => p.status === 'ativo' && p.depositsCount > 0)
  const plan: [string, number, number, number][] = [
    // campanha, quantidade, dias atrás (mín), dias atrás (máx)
    ['fs01', 42, 0, 29],
    ['fs02', 16, 21, 40],
    ['fs03', 14, 46, 118],
    ['fs04', 6, 12, 190],
  ]
  const out: FreeSpinGrant[] = []
  let n = 0
  for (const [cid, qty, minAgo, maxAgo] of plan) {
    const c = campaigns.find((x) => x.id === cid)!
    const chosen = rng.sample(players, qty)
    for (const p of chosen) {
      const grantedAt = new Date(NOW.getTime() - rng.float(minAgo, maxAgo, 3) * DAY - rng.int(0, 20) * HOUR)
      const expiresAt = new Date(grantedAt.getTime() + c.validityDays * DAY)
      const expired = expiresAt.getTime() < NOW.getTime()
      const used = expired ? (rng.bool(0.78) ? c.spins : rng.int(Math.floor(c.spins * 0.2), c.spins - 1)) : rng.int(0, c.spins)
      const luck = rng.weighted([
        [rng.float(0.1, 0.7), 45],
        [rng.float(0.7, 1.3), 40],
        [rng.float(1.3, 4), 12],
        [rng.float(4, 18), 3],
      ] as const)
      const winnings = Math.round(used * c.spinValue * luck * 100) / 100
      const cancelled = cid === 'fs02' && n % 9 === 4
      out.push({
        id: `FS${String(10421 + n).padStart(5, '0')}`,
        campaignId: c.id,
        campaignName: c.name,
        playerId: p.id,
        playerName: p.name,
        playerEmail: p.email,
        gameId: c.gameId,
        spins: c.spins,
        spinValue: c.spinValue,
        used: cancelled ? Math.min(used, 5) : used,
        winnings: cancelled ? 0 : winnings,
        grantedAt: iso(grantedAt),
        expiresAt: iso(expiresAt),
        status: cancelled ? 'cancelada' : used >= c.spins ? 'concluida' : expired ? 'expirada' : 'ativa',
        origin: c.trigger === 'manual' ? 'manual' : 'automatica',
        grantedBy: c.trigger === 'manual' ? rng.pick(['Daniel Carius', 'Marina Duarte']) : null,
        note: c.trigger === 'manual' ? 'Aniversário de cadastro (VIP)' : cancelled ? 'Cancelado: cupom usado em contas ligadas' : '',
      })
      n++
    }
  }
  return out.sort((a, b) => b.grantedAt.localeCompare(a.grantedAt))
}
