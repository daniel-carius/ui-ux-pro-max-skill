// Promoções de demonstração (determinísticas).
import { createRng } from '@/lib/random'
import { defaultRules, type Promo, type PromoAccent, type PromoAudience, type PromoChannel, type PromoRules, type PromoType } from '@/domain/campanhas-promocoes'
import { seedGames } from './catalog'
import { DAY, NOW, iso } from './now'

export const PROMO_KEY = 'campanhas.promocoes'

const gameId = (name: string) => seedGames().find((g) => g.name === name)?.id ?? null
const at = (days: number) => iso(new Date(NOW.getTime() + days * DAY))

interface Def {
  id: string
  name: string
  type: PromoType
  description: string
  start: number
  end: number | null
  draft?: boolean
  paused?: boolean
  budget: number
  rules: Partial<PromoRules>
  audience?: Partial<PromoAudience>
  headline: string
  subtitle: string
  cta: string
  accent: PromoAccent
  channels: PromoChannel[]
  participants: number
  costPerParticipant: number
  by: string
}

const DEFS: Def[] = [
  {
    id: 'pr01',
    name: 'Deposite 50 e ganhe o dobro',
    type: 'bonus_deposito',
    description: 'Campanha principal de bônus. Espelha a campanha ativa em Bônus de depósito.',
    start: -42,
    end: 19,
    budget: 150000,
    rules: { pct: 100, minDeposit: 10, maxReward: 500, rollover: 10, maxPerPlayer: 1 },
    headline: 'Deposite e ganhe o dobro',
    subtitle: 'Bônus de 100% no seu depósito, até R$ 500.',
    cta: 'Depositar agora',
    accent: 'roxo',
    channels: ['banner', 'popup', 'notificacao'],
    participants: 1284,
    costPerParticipant: 61.4,
    by: 'Marina Duarte',
  },
  {
    id: 'pr02',
    name: '100 giros no 2º depósito',
    type: 'free_spins',
    description: 'Giros em Fortune Tiger para quem faz o segundo depósito.',
    start: -30,
    end: null,
    budget: 60000,
    rules: { spins: 100, spinValue: 0.4, minDeposit: 20, rollover: 10, gameId: gameId('Fortune Tiger'), maxPerPlayer: 1 },
    headline: '100 giros grátis',
    subtitle: 'No seu 2º depósito, giros no Fortune Tiger.',
    cta: 'Quero meus giros',
    accent: 'ouro',
    channels: ['banner', 'notificacao', 'email'],
    participants: 836,
    costPerParticipant: 37.9,
    by: 'Marina Duarte',
  },
  {
    id: 'pr03',
    name: 'Cashback semanal 10%',
    type: 'cashback',
    description: 'Devolução semanal da perda líquida em saldo bônus.',
    start: -90,
    end: null,
    budget: 0,
    rules: { pct: 10, maxReward: 1000, rollover: 1, cashbackPeriod: 'semanal', maxPerPlayer: 52 },
    audience: { kind: 'depositantes' },
    headline: '10% de cashback toda semana',
    subtitle: 'Perdeu? Devolvemos parte toda segunda-feira.',
    cta: 'Ver como funciona',
    accent: 'verde',
    channels: ['banner', 'notificacao'],
    participants: 2412,
    costPerParticipant: 18.2,
    by: 'Rafael Monteiro',
  },
  {
    id: 'pr04',
    name: 'Cupom SEXTOU30',
    type: 'cupom',
    description: 'Cupom de sexta-feira divulgado nas redes. Pausado após pico de resgates repetidos.',
    start: -21,
    end: 9,
    paused: true,
    budget: 15000,
    rules: { couponCode: 'SEXTOU30', couponValue: 30, maxRedemptions: 500, rollover: 15, maxPerPlayer: 1 },
    headline: 'Sextou com R$ 30',
    subtitle: 'Use o cupom SEXTOU30 e ganhe bônus.',
    cta: 'Resgatar cupom',
    accent: 'azul',
    channels: ['banner', 'sms'],
    participants: 312,
    costPerParticipant: 30,
    by: 'Marina Duarte',
  },
  {
    id: 'pr05',
    name: 'Torneio Fortune Week',
    type: 'torneio',
    description: 'Ranking por maior multiplicador nos jogos Fortune da PG Soft.',
    start: 5,
    end: 12,
    budget: 25000,
    rules: { prizePool: 25000, scoring: 'multiplicador', minBet: 1, gameId: gameId('Fortune Ox'), maxPerPlayer: 1 },
    headline: 'Fortune Week: R$ 25 mil',
    subtitle: 'Maior multiplicador leva o topo do ranking.',
    cta: 'Entrar no torneio',
    accent: 'ouro',
    channels: ['banner', 'popup', 'email'],
    participants: 0,
    costPerParticipant: 0,
    by: 'Rafael Monteiro',
  },
  {
    id: 'pr06',
    name: 'Missão: aposte R$ 200 em slots',
    type: 'missao',
    description: 'Missão de engajamento semanal para depositantes.',
    start: -12,
    end: 16,
    budget: 20000,
    rules: { goal: 'apostar', goalTarget: 200, rewardValue: 15, rollover: 5, maxPerPlayer: 4 },
    audience: { kind: 'depositantes' },
    headline: 'Missão da semana',
    subtitle: 'Aposte R$ 200 em slots e ganhe R$ 15.',
    cta: 'Aceitar missão',
    accent: 'roxo',
    channels: ['notificacao'],
    participants: 541,
    costPerParticipant: 9.8,
    by: 'Marina Duarte',
  },
  {
    id: 'pr07',
    name: 'Boas-vindas 200%',
    type: 'bonus_deposito',
    description: 'Campanha de lançamento. Encerrada por custo acima do previsto.',
    start: -120,
    end: -60,
    budget: 80000,
    rules: { pct: 200, minDeposit: 30, maxReward: 1000, rollover: 20, maxPerPlayer: 1 },
    audience: { kind: 'novos' },
    headline: 'Boas-vindas de 200%',
    subtitle: 'Triplique o seu primeiro depósito.',
    cta: 'Criar conta',
    accent: 'verde',
    channels: ['banner', 'popup', 'email', 'sms'],
    participants: 1960,
    costPerParticipant: 44.7,
    by: 'Daniel Carius',
  },
  {
    id: 'pr08',
    name: 'Copa dos Crashers',
    type: 'torneio',
    description: 'Torneio de crash por total apostado.',
    start: -45,
    end: -38,
    budget: 12000,
    rules: { prizePool: 12000, scoring: 'total_apostado', minBet: 2, gameId: gameId('Aviator'), maxPerPlayer: 1 },
    headline: 'Copa dos Crashers',
    subtitle: 'Quem mais apostar no Aviator leva.',
    cta: 'Ver ranking',
    accent: 'azul',
    channels: ['banner', 'notificacao'],
    participants: 688,
    costPerParticipant: 17.44,
    by: 'Rafael Monteiro',
  },
  {
    id: 'pr09',
    name: 'Volta por cima (inativos 30 dias)',
    type: 'bonus_deposito',
    description: 'Reativação de jogadores parados. Falta revisar o texto do e-mail.',
    start: 3,
    end: 33,
    draft: true,
    budget: 30000,
    rules: { pct: 50, minDeposit: 20, maxReward: 200, rollover: 8, maxPerPlayer: 1 },
    audience: { kind: 'inativos', inactiveDays: 30 },
    headline: 'Sentimos sua falta',
    subtitle: '50% de bônus no seu próximo depósito.',
    cta: 'Voltar a jogar',
    accent: 'roxo',
    channels: ['email', 'sms'],
    participants: 0,
    costPerParticipant: 0,
    by: 'Marina Duarte',
  },
  {
    id: 'pr10',
    name: 'Cashback VIP 15%',
    type: 'cashback',
    description: 'Cashback diferenciado para a base VIP.',
    start: -60,
    end: null,
    budget: 0,
    rules: { pct: 15, maxReward: 5000, rollover: 1, cashbackPeriod: 'semanal', maxPerPlayer: 52 },
    audience: { kind: 'vip' },
    headline: '15% de cashback VIP',
    subtitle: 'Exclusivo para jogadores VIP.',
    cta: 'Ver meu cashback',
    accent: 'ouro',
    channels: ['notificacao', 'email'],
    participants: 94,
    costPerParticipant: 212.5,
    by: 'Daniel Carius',
  },
  {
    id: 'pr11',
    name: 'Giros de Black Friday',
    type: 'free_spins',
    description: 'Giros em Gates of Olympus na semana da Black Friday.',
    start: 44,
    end: 51,
    budget: 40000,
    rules: { spins: 50, spinValue: 0.5, minDeposit: 50, rollover: 10, gameId: gameId('Gates of Olympus'), maxPerPlayer: 1 },
    headline: 'Black Friday: 50 giros',
    subtitle: 'Deposite R$ 50 e gire no Gates of Olympus.',
    cta: 'Garantir giros',
    accent: 'roxo',
    channels: ['banner', 'popup', 'email', 'sms'],
    participants: 0,
    costPerParticipant: 0,
    by: 'Marina Duarte',
  },
]

export function seedPromos(): Promo[] {
  const rng = createRng(4401)
  return DEFS.map((d) => {
    const created = Math.min(d.start, 0) - rng.int(2, 10)
    return {
      id: d.id,
      name: d.name,
      type: d.type,
      description: d.description,
      startAt: at(d.start),
      endAt: d.end === null ? null : at(d.end),
      draft: !!d.draft,
      paused: !!d.paused,
      budget: d.budget,
      rules: { ...defaultRules(), ...d.rules },
      audience: { kind: 'todos', minLevel: 5, inactiveDays: 30, excludeAbusers: true, ...d.audience },
      comms: { headline: d.headline, subtitle: d.subtitle, cta: d.cta, accent: d.accent, channels: d.channels, terms: 'Válido para maiores de 18 anos. Sujeito às regras de rollover e aos termos do site.' },
      participants: d.participants,
      cost: Math.round(d.participants * d.costPerParticipant * 100) / 100,
      createdAt: at(created),
      createdBy: d.by,
      updatedAt: at(Math.min(0, created + rng.int(1, 8))),
    }
  })
}

/** Participações diárias (últimos 14 dias) para o gráfico do detalhe. */
export function promoDailySeries(p: Promo): { day: string; value: number }[] {
  const seed = [...p.id].reduce((s, c) => s + c.charCodeAt(0), 0)
  const rng = createRng(seed * 31 + p.participants)
  const start = new Date(p.startAt).getTime()
  const end = p.endAt ? new Date(p.endAt).getTime() : Infinity
  const out: { day: string; value: number }[] = []
  const avg = p.participants / 30
  for (let i = 13; i >= 0; i--) {
    const d = new Date(NOW.getTime() - i * DAY)
    const live = !p.draft && d.getTime() >= start && d.getTime() <= end
    out.push({ day: iso(d), value: live && p.participants ? Math.max(0, Math.round(avg * rng.float(0.5, 1.6))) : 0 })
  }
  return out
}
