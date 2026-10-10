// Dados de demonstração (com semente) de Moeda, Roleta, Loja, Cupons,
// Indicação, Missões e Torneios. Sempre iguais em relação a "agora".
import { createRng } from '@/lib/random'
import type { Wheel, WheelPrize, WheelSpin } from '@/domain/campanhas2-roleta'
import type { ShopItem, ShopPurchase } from '@/domain/campanhas2-loja'
import type { Coupon, CouponRedemption } from '@/domain/campanhas2-cupons'
import type { ReferralRecord } from '@/domain/campanhas2-indicacao'
import type { Mission } from '@/domain/campanhas2-missoes'
import type { Tournament, TournamentPrize } from '@/domain/campanhas2-torneios'
import { DAY, HOUR, NOW, dayKey, daysAgo, iso } from './now'
import { playersOnlineAt, seedPlayers, type Player } from './players'
import { demoRecords } from './demo'

const inDays = (n: number) => new Date(NOW.getTime() + n * DAY)

// ---------- Moeda: fluxo diário de emissão e resgate ----------

export interface CoinFlowDay {
  date: string
  emitted: number
  redeemed: number
  expired: number
  /** emissão por origem */
  bets: number
  deposit: number
  login: number
  missions: number
  levels: number
  /** resgate por destino */
  shop: number
  wheel: number
}

let _flow: CoinFlowDay[] | null = null

/** 75 dias de emissão e resgate de moedas (o último é hoje). */
export function seedCoinFlow(): CoinFlowDay[] {
  if (_flow) return _flow
  const rng = createRng(4401)
  const out: CoinFlowDay[] = []
  for (let i = 74; i >= 0; i--) {
    const d = daysAgo(i)
    const weekend = d.getDay() === 0 || d.getDay() === 6 ? 1.22 : 1
    const trend = 1 + (74 - i) * 0.0035
    const base = 36000 * weekend * trend * rng.float(0.85, 1.15)
    const bets = Math.round(base * 0.7)
    const deposit = Math.round(base * 0.08)
    const login = Math.round(base * 0.1)
    const missions = Math.round(base * 0.05)
    const levels = Math.round(base * 0.07)
    const emitted = bets + deposit + login + missions + levels
    const redeemed = Math.round(emitted * rng.float(0.62, 0.86))
    const shop = Math.round(redeemed * rng.float(0.55, 0.66))
    out.push({
      date: dayKey(d),
      emitted,
      redeemed,
      expired: Math.round(emitted * rng.float(0.02, 0.06)),
      bets,
      deposit,
      login,
      missions,
      levels,
      shop,
      wheel: redeemed - shop,
    })
  }
  _flow = out
  return out
}

// ---------- Roleta ----------

const prize = (id: string, label: string, kind: WheelPrize['kind'], value: number, probability: number, slot: WheelPrize['slot']): WheelPrize => ({
  id,
  label,
  kind,
  value,
  probability,
  slot,
})

export function seedWheels(): Wheel[] {
  return [
    {
      id: 'rl-diaria',
      name: 'Roleta diária',
      group: 'todos',
      spinsPerDay: 1,
      costCoins: 0,
      active: true,
      createdAt: iso(daysAgo(120)),
      updatedAt: iso(daysAgo(6)),
      prizes: [
        prize('p1', 'Tente de novo', 'nada', 0, 35, 7),
        prize('p2', '10 EVC', 'moedas', 10, 25, 4),
        prize('p3', '50 EVC', 'moedas', 50, 15, 1),
        prize('p4', '5 giros', 'free_spins', 5, 12, 3),
        prize('p5', 'R$ 2 bônus', 'bonus_brl', 2, 8, 2),
        prize('p6', '20 giros', 'free_spins', 20, 4, 5),
        prize('p7', 'R$ 50 bônus', 'bonus_brl', 50, 1, 6),
      ],
    },
    {
      id: 'rl-boas-vindas',
      name: 'Roleta de boas-vindas',
      group: 'novos',
      spinsPerDay: 1,
      costCoins: 0,
      active: true,
      createdAt: iso(daysAgo(90)),
      updatedAt: iso(daysAgo(14)),
      prizes: [
        prize('p1', 'R$ 5 bônus', 'bonus_brl', 5, 30, 1),
        prize('p2', '10 giros', 'free_spins', 10, 30, 3),
        prize('p3', 'R$ 10 bônus', 'bonus_brl', 10, 20, 2),
        prize('p4', '30 giros', 'free_spins', 30, 12, 5),
        prize('p5', 'R$ 25 bônus', 'bonus_brl', 25, 6, 4),
        prize('p6', 'R$ 100 bônus', 'bonus_brl', 100, 2, 6),
      ],
    },
    {
      id: 'rl-vip',
      name: 'Roleta VIP Diamante',
      group: 'vip',
      spinsPerDay: 2,
      costCoins: 500,
      active: true,
      createdAt: iso(daysAgo(60)),
      updatedAt: iso(daysAgo(3)),
      prizes: [
        prize('p1', 'R$ 10 bônus', 'bonus_brl', 10, 20, 1),
        prize('p2', 'R$ 25 bônus', 'bonus_brl', 25, 25, 2),
        prize('p3', '50 giros', 'free_spins', 50, 20, 3),
        prize('p4', 'R$ 50 bônus', 'bonus_brl', 50, 15, 4),
        prize('p5', '2.000 EVC', 'moedas', 2000, 12, 5),
        prize('p6', 'R$ 200 bônus', 'bonus_brl', 200, 6, 6),
        prize('p7', 'R$ 1.000 bônus', 'bonus_brl', 1000, 2, 7),
      ],
    },
    {
      id: 'rl-halloween',
      name: 'Roleta de Halloween',
      group: 'todos',
      spinsPerDay: 3,
      costCoins: 100,
      active: false,
      createdAt: iso(daysAgo(2)),
      updatedAt: iso(daysAgo(2)),
      prizes: [
        prize('p1', 'Nada', 'nada', 0, 40, 8),
        prize('p2', '100 EVC', 'moedas', 100, 25, 4),
        prize('p3', '20 giros', 'free_spins', 20, 20, 2),
        prize('p4', 'R$ 10 bônus', 'bonus_brl', 10, 10, 1),
        prize('p5', 'R$ 66 bônus', 'bonus_brl', 66, 5, 7),
      ],
    },
  ]
}

/** Quem pode girar a roleta em `t`, pelo grupo dela (o mesmo texto de Campanhas › Roleta). */
function inWheelGroup(w: Wheel, p: Player, t: number) {
  if (w.group === 'novos') return t - Date.parse(p.createdAt) <= 7 * DAY
  if (w.group === 'vip') return p.tags.includes('VIP')
  return true
}

export function seedWheelSpins(): WheelSpin[] {
  const rng = createRng(5150)
  const players = seedPlayers().filter((p) => p.status === 'ativo')
  const wheels = seedWheels().filter((w) => w.active)
  const out: WheelSpin[] = []
  /** giros por roleta, jogador e dia: no máximo os giros por dia da roleta */
  const spinsOfDay = new Map<string, number>()
  for (let i = 0, n = 0; i < 420; i++) {
    const w = rng.weighted([
      [wheels[0], 70],
      [wheels[1], 18],
      [wheels[2], 12],
    ] as const)
    const pz = rng.weighted(w.prizes.map((p) => [p, p.probability] as const))
    const at = new Date(NOW.getTime() - Math.pow(rng.next(), 1.15) * 30 * DAY)
    // quem girou estava no site (conta criada antes do giro e último acesso depois), é do grupo da roleta
    // e ainda tinha giro no dia
    const key = (p: Player) => `${w.id}|${p.id}|${dayKey(at)}`
    const t = at.getTime()
    const pool = players.filter((p) => Date.parse(p.createdAt) <= t && Date.parse(p.lastAccess) >= t && inWheelGroup(w, p, t) && (spinsOfDay.get(key(p)) ?? 0) < w.spinsPerDay)
    if (!pool.length || t < Date.parse(w.createdAt)) continue
    const pl = rng.pick(pool)
    spinsOfDay.set(key(pl), (spinsOfDay.get(key(pl)) ?? 0) + 1)
    out.push({
      id: `gr${String(90000 + n++)}`,
      wheelId: w.id,
      wheelName: w.name,
      playerId: pl.id,
      playerName: pl.name,
      prizeLabel: pz.label,
      kind: pz.kind,
      value: pz.value,
      costCoins: w.costCoins,
      at: iso(at),
    })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

// ---------- Loja ----------

export function seedShopItems(): ShopItem[] {
  const base = { description: '', gameId: null, rollover: 0, extra: 0, image: null, featured: false, active: true }
  return [
    { ...base, id: 'lj01', name: 'Bônus de R$ 10', description: 'Crédito de bônus na hora, para qualquer jogo.', kind: 'bonus', value: 10, rollover: 10, icon: 'gift', price: 1500, stock: null, sold: 812, limitPerPlayer: 1, limitPeriod: 'dia', featured: true, createdAt: iso(daysAgo(150)), updatedAt: iso(daysAgo(12)) },
    { ...base, id: 'lj02', name: '20 giros no Fortune Tiger', description: 'Giros de R$ 0,40 no jogo mais pedido da casa.', kind: 'free_spins', value: 20, extra: 0.4, gameId: 'g001', icon: 'sparkles', price: 1200, stock: null, sold: 1290, limitPerPlayer: 2, limitPeriod: 'dia', featured: true, createdAt: iso(daysAgo(140)), updatedAt: iso(daysAgo(20)) },
    { ...base, id: 'lj03', name: 'Bônus de R$ 50', description: 'Para quem joga mais pesado. Rollover de 15x.', kind: 'bonus', value: 50, rollover: 15, icon: 'crown', price: 7000, stock: 200, sold: 143, limitPerPlayer: 1, limitPeriod: 'semana', createdAt: iso(daysAgo(120)), updatedAt: iso(daysAgo(9)) },
    { ...base, id: 'lj04', name: '50 giros no Gates of Olympus', description: 'Edição limitada de giros de R$ 0,40.', kind: 'free_spins', value: 50, extra: 0.4, gameId: 'g010', icon: 'star', price: 2800, stock: 500, sold: 500, limitPerPlayer: 1, limitPeriod: 'semana', createdAt: iso(daysAgo(45)), updatedAt: iso(daysAgo(2)) },
    { ...base, id: 'lj05', name: 'Cashback de 10%', description: 'Devolve 10% das perdas das próximas 24 horas.', kind: 'cashback', value: 10, extra: 50, icon: 'percent', price: 3500, stock: null, sold: 221, limitPerPlayer: 1, limitPeriod: 'semana', createdAt: iso(daysAgo(100)), updatedAt: iso(daysAgo(30)) },
    { ...base, id: 'lj06', name: 'Aposta grátis de R$ 5', description: 'Vale para apostas esportivas simples ou múltiplas.', kind: 'aposta_gratis', value: 5, icon: 'ticket', price: 800, stock: null, sold: 640, limitPerPlayer: 3, limitPeriod: 'semana', createdAt: iso(daysAgo(95)), updatedAt: iso(daysAgo(40)) },
    { ...base, id: 'lj07', name: 'Aposta grátis de R$ 25', description: 'Odd mínima de 1,50.', kind: 'aposta_gratis', value: 25, icon: 'zap', price: 3800, stock: 150, sold: 61, limitPerPlayer: 1, limitPeriod: 'mes', createdAt: iso(daysAgo(60)), updatedAt: iso(daysAgo(8)) },
    { ...base, id: 'lj08', name: 'Pacote VIP: R$ 200 de bônus', description: 'Item exclusivo de alto valor. Rollover de 20x.', kind: 'bonus', value: 200, rollover: 20, icon: 'gem', price: 25000, stock: 20, sold: 7, limitPerPlayer: 1, limitPeriod: 'mes', createdAt: iso(daysAgo(30)), updatedAt: iso(daysAgo(30)) },
    { ...base, id: 'lj09', name: '100 giros no Sweet Bonanza', description: 'Giros de R$ 0,20. Volta no fim do mês.', kind: 'free_spins', value: 100, extra: 0.2, gameId: 'g011', icon: 'sparkles', price: 2400, stock: 300, sold: 34, limitPerPlayer: 1, limitPeriod: 'semana', active: false, createdAt: iso(daysAgo(25)), updatedAt: iso(daysAgo(5)) },
  ]
}

export function seedShopPurchases(): ShopPurchase[] {
  const rng = createRng(6620)
  const players = seedPlayers().filter((p) => p.status === 'ativo' && p.depositsCount > 0)
  const items = seedShopItems()
  const weights: [ShopItem, number][] = items.map((it) => [it, Math.max(2, it.sold / 10)])
  const out: ShopPurchase[] = []
  for (let i = 0; i < 360; i++) {
    const it = rng.weighted(weights)
    const status = rng.weighted([
      ['entregue', 93],
      ['pendente', 3],
      ['estornada', 4],
    ] as const)
    // pendentes só nas últimas horas (entrega em processamento)
    const at = status === 'pendente' ? NOW.getTime() - rng.int(5, 240) * 60_000 : NOW.getTime() - Math.pow(rng.next(), 1.1) * 45 * DAY - rng.int(0, 59) * 60_000
    // quem comprou estava no site: conta criada antes da compra e último acesso depois
    const pl = rng.pick(playersOnlineAt(players, at))
    const value = it.kind === 'free_spins' ? it.value * it.extra : it.kind === 'cashback' ? Math.round(rng.float(5, it.extra) * 100) / 100 : it.value
    out.push({
      id: `cp${String(30000 + i)}`,
      itemId: it.id,
      itemName: it.name,
      kind: it.kind,
      playerId: pl.id,
      playerName: pl.name,
      playerEmail: pl.email,
      price: it.price,
      valueBrl: value,
      at: iso(new Date(at)),
      status,
    })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

// ---------- Cupons (a especificação registra a tela vazia) ----------

export const seedCoupons = (): Coupon[] => []
export const seedCouponRedemptions = (): CouponRedemption[] => []

// ---------- Indicação ----------

export function seedReferrals(): ReferralRecord[] {
  const rng = createRng(7731)
  const players = seedPlayers()
  const referrers = rng.sample(players.slice(34).filter((p) => p.depositsCount > 0), 72)
  const out: ReferralRecord[] = []
  let n = 0
  for (const ref of referrers) {
    const count = rng.weighted([
      [rng.int(1, 2), 38],
      [rng.int(3, 5), 30],
      [rng.int(6, 12), 20],
      [rng.int(13, 22), 8],
      [rng.int(24, 34), 4],
    ] as const)
    for (let i = 0; i < count; i++) {
      const friend = rng.pick(players)
      const deposited = rng.bool(0.28) ? 0 : rng.money(10, 1600)
      const created = new Date(NOW.getTime() - Math.pow(rng.next(), 1.3) * 120 * DAY)
      out.push({
        id: `ind${String(++n).padStart(4, '0')}`,
        referrerId: ref.id,
        referrerName: ref.name,
        referrerEmail: ref.email,
        referredId: friend.id,
        referredName: friend.name,
        createdAt: iso(created),
        deposited,
        wagered: deposited ? Math.round(deposited * rng.float(0.2, 9) * 100) / 100 : 0,
        kyc: rng.bool(0.66),
        sameIp: rng.bool(0.06),
        daysToQualify: Math.round(Math.pow(rng.next(), 2.2) * 50),
      })
    }
  }
  return out
}

// ---------- Missões ----------

export function seedMissions(): Mission[] {
  const m = (x: Omit<Mission, 'createdAt' | 'updatedAt'> & { created: number; updated: number }): Mission => {
    const { created, updated, ...rest } = x
    return { ...rest, createdAt: iso(daysAgo(created)), updatedAt: iso(daysAgo(updated)) }
  }
  return [
    m({ id: 'ms01', name: 'Aquecimento diário', objective: { kind: 'apostar', target: 50, scope: 'qualquer', category: 'slots', gameId: null }, reward: { kind: 'moedas', value: 100 }, recurrence: 'diaria', audience: 'todos', status: 'ativa', startsAt: iso(daysAgo(120)), endsAt: null, started: 4820, completions: 2911, created: 120, updated: 10 }),
    m({ id: 'ms02', name: 'Tigre da sorte', objective: { kind: 'rodadas', target: 100, scope: 'jogo', category: 'slots', gameId: 'g001' }, reward: { kind: 'free_spins', value: 30 }, recurrence: 'semanal', audience: 'todos', status: 'ativa', startsAt: iso(daysAgo(80)), endsAt: null, started: 2140, completions: 1188, created: 80, updated: 15 }),
    m({ id: 'ms03', name: 'Primeiro depósito turbinado', objective: { kind: 'depositar', target: 50, scope: 'qualquer', category: 'slots', gameId: null }, reward: { kind: 'bonus_brl', value: 20 }, recurrence: 'unica', audience: 'novos', status: 'ativa', startsAt: iso(daysAgo(200)), endsAt: null, started: 690, completions: 402, created: 200, updated: 40 }),
    m({ id: 'ms04', name: 'Caçador de multiplicador', objective: { kind: 'multiplicador', target: 100, scope: 'categoria', category: 'crash', gameId: null }, reward: { kind: 'bonus_brl', value: 25 }, recurrence: 'semanal', audience: 'todos', status: 'ativa', startsAt: iso(daysAgo(50)), endsAt: null, started: 1310, completions: 188, created: 50, updated: 7 }),
    m({ id: 'ms05', name: 'Fiel da semana', objective: { kind: 'login', target: 5, scope: 'qualquer', category: 'slots', gameId: null }, reward: { kind: 'moedas', value: 250 }, recurrence: 'semanal', audience: 'todos', status: 'ativa', startsAt: iso(daysAgo(90)), endsAt: null, started: 3380, completions: 1475, created: 90, updated: 20 }),
    m({ id: 'ms06', name: 'Maratona ao vivo', objective: { kind: 'apostar', target: 500, scope: 'categoria', category: 'ao_vivo', gameId: null }, reward: { kind: 'cashback', value: 10 }, recurrence: 'semanal', audience: 'vip', status: 'ativa', startsAt: iso(daysAgo(35)), endsAt: null, started: 214, completions: 131, created: 35, updated: 4 }),
    m({ id: 'ms07', name: 'Rei do Aviator', objective: { kind: 'multiplicador', target: 50, scope: 'jogo', category: 'crash', gameId: 'g020' }, reward: { kind: 'moedas', value: 300 }, recurrence: 'diaria', audience: 'todos', status: 'ativa', startsAt: iso(daysAgo(28)), endsAt: inDays(30).toISOString(), started: 1960, completions: 236, created: 28, updated: 2 }),
    m({ id: 'ms08', name: 'Volta por cima', objective: { kind: 'depositar', target: 100, scope: 'qualquer', category: 'slots', gameId: null }, reward: { kind: 'bonus_brl', value: 30 }, recurrence: 'unica', audience: 'inativos', status: 'pausada', startsAt: iso(daysAgo(70)), endsAt: null, started: 312, completions: 54, created: 70, updated: 11 }),
    m({ id: 'ms09', name: 'Especial Black Friday', objective: { kind: 'apostar', target: 1000, scope: 'categoria', category: 'slots', gameId: null }, reward: { kind: 'free_spins', value: 100 }, recurrence: 'unica', audience: 'todos', status: 'rascunho', startsAt: inDays(44).toISOString(), endsAt: inDays(47).toISOString(), started: 0, completions: 0, created: 3, updated: 1 }),
    m({ id: 'ms10', name: 'Desafio de setembro', objective: { kind: 'rodadas', target: 500, scope: 'categoria', category: 'slots', gameId: null }, reward: { kind: 'bonus_brl', value: 50 }, recurrence: 'unica', audience: 'depositantes', status: 'encerrada', startsAt: iso(daysAgo(39)), endsAt: iso(daysAgo(9)), started: 1205, completions: 377, created: 45, updated: 9 }),
  ]
}

/** Conclusões de missões por dia (14 dias). */
export function seedMissionDaily(): { date: string; completions: number; started: number }[] {
  const rng = createRng(8812)
  return Array.from({ length: 14 }, (_, k) => {
    const d = daysAgo(13 - k)
    const weekend = d.getDay() === 0 || d.getDay() === 6 ? 1.25 : 1
    const started = Math.round(520 * weekend * rng.float(0.85, 1.15))
    return { date: dayKey(d), started, completions: Math.round(started * rng.float(0.42, 0.58)) }
  })
}

// ---------- Torneios ----------

const tp = (id: string, kind: TournamentPrize['kind'], value: number): TournamentPrize => ({ id, kind, value })

export function seedTournaments(): Tournament[] {
  const at = (d: number, h = 0) => new Date(NOW.getTime() + d * DAY + h * HOUR).toISOString()
  return [
    {
      id: 'tn01',
      name: 'Corrida do Tigre',
      description: 'Quem fizer o maior multiplicador nos jogos Fortune leva o prêmio.',
      gameIds: ['g001', 'g002', 'g003', 'g004', 'g005'],
      startsAt: at(-2, -3),
      endsAt: at(5, 2),
      scoring: 'maior_multiplicador',
      minBet: 0.4,
      prizes: [tp('a', 'dinheiro', 2000), tp('b', 'dinheiro', 1000), tp('c', 'dinheiro', 500), tp('d', 'dinheiro', 300), tp('e', 'dinheiro', 200), tp('f', 'bonus_brl', 100), tp('g', 'bonus_brl', 100), tp('h', 'bonus_brl', 100), tp('i', 'bonus_brl', 100), tp('j', 'bonus_brl', 100)],
      audience: 'todos',
      participants: 1284,
      closedAt: null,
      closedBy: null,
      createdAt: iso(daysAgo(9)),
      updatedAt: iso(daysAgo(3)),
    },
    {
      id: 'tn02',
      name: 'Crash Masters 24h',
      description: 'Maior ganho único em jogos de crash em 24 horas.',
      gameIds: ['g020', 'g017', 'g056', 'g057', 'g058'],
      startsAt: at(0, -6),
      endsAt: at(0, 18),
      scoring: 'maior_ganho',
      minBet: 1,
      prizes: [tp('a', 'dinheiro', 500), tp('b', 'dinheiro', 250), tp('c', 'dinheiro', 100), tp('d', 'free_spins', 50), tp('e', 'free_spins', 50)],
      audience: 'depositantes',
      participants: 412,
      closedAt: null,
      closedBy: null,
      createdAt: iso(daysAgo(4)),
      updatedAt: iso(daysAgo(1)),
    },
    {
      id: 'tn03',
      name: 'Semana Ao Vivo',
      description: 'Ranking por volume apostado nas mesas ao vivo.',
      gameIds: ['g018', 'g026', 'g027', 'g028', 'g030'],
      startsAt: at(3),
      endsAt: at(10),
      scoring: 'volume_apostado',
      minBet: 5,
      prizes: [tp('a', 'dinheiro', 5000), tp('b', 'dinheiro', 2500), tp('c', 'dinheiro', 1000), tp('d', 'dinheiro', 500), tp('e', 'dinheiro', 500), tp('f', 'moedas', 10000), tp('g', 'moedas', 10000), tp('h', 'moedas', 10000)],
      audience: 'vip',
      participants: 0,
      closedAt: null,
      closedBy: null,
      createdAt: iso(daysAgo(2)),
      updatedAt: iso(daysAgo(2)),
    },
    {
      id: 'tn04',
      name: 'Black Friday Slots',
      description: 'O maior torneio do ano nos slots mais jogados.',
      gameIds: ['g001', 'g010', 'g011', 'g012', 'g013', 'g038', 'g049'],
      startsAt: at(44),
      endsAt: at(47),
      scoring: 'maior_multiplicador',
      minBet: 0.5,
      prizes: [tp('a', 'dinheiro', 10000), tp('b', 'dinheiro', 5000), tp('c', 'dinheiro', 2500), tp('d', 'dinheiro', 1000), tp('e', 'dinheiro', 1000), tp('f', 'bonus_brl', 500), tp('g', 'bonus_brl', 500), tp('h', 'bonus_brl', 500), tp('i', 'bonus_brl', 500), tp('j', 'bonus_brl', 500)],
      audience: 'todos',
      participants: 0,
      closedAt: null,
      closedBy: null,
      createdAt: iso(daysAgo(1)),
      updatedAt: iso(daysAgo(1)),
    },
    {
      id: 'tn05',
      name: 'Copa dos Slots PG',
      description: 'Volume apostado nos slots da PG Soft.',
      gameIds: ['g001', 'g002', 'g003', 'g006', 'g007', 'g008'],
      startsAt: at(-11),
      endsAt: at(-4),
      scoring: 'volume_apostado',
      minBet: 0.4,
      prizes: [tp('a', 'dinheiro', 3000), tp('b', 'dinheiro', 1500), tp('c', 'dinheiro', 750), tp('d', 'bonus_brl', 250), tp('e', 'bonus_brl', 250)],
      audience: 'todos',
      participants: 2210,
      closedAt: null,
      closedBy: null,
      createdAt: iso(daysAgo(20)),
      updatedAt: iso(daysAgo(4)),
    },
    {
      id: 'tn06',
      name: 'Aviator Night',
      description: 'Uma noite, um multiplicador: quem voar mais alto ganha.',
      gameIds: ['g020'],
      startsAt: at(-18, -8),
      endsAt: at(-18),
      scoring: 'maior_multiplicador',
      minBet: 1,
      prizes: [tp('a', 'dinheiro', 1000), tp('b', 'dinheiro', 500), tp('c', 'free_spins', 100)],
      audience: 'todos',
      participants: 534,
      closedAt: null,
      closedBy: null,
      createdAt: iso(daysAgo(25)),
      updatedAt: iso(daysAgo(18)),
    },
    {
      id: 'tn07',
      name: 'Desafio Pragmatic',
      description: 'Encerrado antes do fim por instabilidade da provedora.',
      gameIds: ['g010', 'g011', 'g012', 'g014'],
      startsAt: at(-30),
      endsAt: at(-23),
      scoring: 'maior_ganho',
      minBet: 0.5,
      prizes: [tp('a', 'dinheiro', 1500), tp('b', 'dinheiro', 750), tp('c', 'bonus_brl', 300)],
      audience: 'todos',
      participants: 968,
      closedAt: at(-26, 4),
      closedBy: 'Camila Rocha',
      createdAt: iso(daysAgo(34)),
      updatedAt: iso(daysAgo(26)),
    },
  ]
}

// modo API: registros só do servidor (sem nada gravado, lista vazia; o gerador não roda)
demoRecords(seedWheelSpins)
