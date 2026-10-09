// Jogadores e afiliados.
import { createRng } from '@/lib/random'
import { CITIES, EMAIL_DOMAINS, FIRST_NAMES, LAST_NAMES, NICK_PARTS_A, NICK_PARTS_B, slugify } from './names'
import { DAY, HOUR, NOW, iso } from './now'

export type PlayerOrigin = 'Orgânico' | 'Afiliado' | 'Indicação' | 'Google Ads' | 'Meta Ads' | 'TikTok Ads' | 'Influenciador'
export type PlayerRole = 'Jogador' | 'Afiliado' | 'Influenciador' | 'Gerente'
export type PlayerStatus = 'ativo' | 'bloqueado' | 'autoexcluido' | 'pausa'
export type KycStatus = 'verificado' | 'pendente' | 'nao_enviado' | 'reprovado'

export interface Player {
  id: string
  name: string
  nickname: string
  email: string
  phone: string
  cpf: string
  birthDate: string
  origin: PlayerOrigin
  role: PlayerRole
  status: PlayerStatus
  kyc: KycStatus
  balanceReal: number
  balanceBonus: number
  coins: number
  level: number
  xp: number
  totalDeposited: number
  depositsCount: number
  totalWithdrawn: number
  totalBet: number
  betsCount: number
  totalWon: number
  biggestWin: number
  /** id do afiliado que indicou, se houver */
  referrerId: string | null
  /** código de indicação próprio */
  refCode: string
  city: string
  uf: string
  ip: string
  tags: string[]
  createdAt: string
  lastAccess: string
  firstDepositAt: string | null
}

export type AffiliateType = 'Manager' | 'Influencer' | 'Organic'

export interface Affiliate {
  id: string
  playerId: string
  name: string
  email: string
  type: AffiliateType
  /** nível na hierarquia: 1 = direto, 2 = subafiliado */
  level: 1 | 2
  managerId: string | null
  code: string
  cpa: number
  revShare: number
  status: 'ativo' | 'pausado'
  balance: number
  pixKey: string
  createdAt: string
}

export const PLAYER_STATUS_LABEL: Record<PlayerStatus, string> = {
  ativo: 'Ativo',
  bloqueado: 'Bloqueado',
  autoexcluido: 'Autoexcluído',
  pausa: 'Em pausa',
}

export const KYC_LABEL: Record<KycStatus, string> = {
  verificado: 'Verificado',
  pendente: 'Em análise',
  nao_enviado: 'Não enviado',
  reprovado: 'Reprovado',
}

const TAGS = ['VIP', 'Alto valor', 'Bônus abuser', 'Novo', 'Reativado', 'Suporte prioritário', 'Revisar KYC', 'Crash lover']

function genCpf(rng: ReturnType<typeof createRng>) {
  return rng.digits(11)
}

function genIp(rng: ReturnType<typeof createRng>) {
  return `${rng.pick([177, 179, 186, 187, 189, 191, 200, 201])}.${rng.int(1, 254)}.${rng.int(1, 254)}.${rng.int(1, 254)}`
}

let _players: Player[] | null = null
let _affiliates: Affiliate[] | null = null

function build() {
  const rng = createRng(2026)
  const players: Player[] = []
  const total = 340
  // IPs compartilhados para alimentar o anti-fraude
  const sharedIps = Array.from({ length: 6 }, () => genIp(rng))

  for (let i = 0; i < total; i++) {
    const first = rng.pick(FIRST_NAMES)
    const last = rng.pick(LAST_NAMES)
    const name = `${first} ${last}`
    const nickname = `${rng.pick(NICK_PARTS_A)}${rng.pick(NICK_PARTS_B)}${rng.bool(0.4) ? rng.int(1, 99) : ''}`
    const email = `${slugify(first)}.${slugify(last)}${rng.int(1, 999)}@${rng.pick(EMAIL_DOMAINS)}`
    const createdDaysAgo = Math.pow(rng.next(), 1.6) * 360
    const createdAt = new Date(NOW.getTime() - createdDaysAgo * DAY - rng.int(0, 23) * HOUR)
    const lastAccessAgo = Math.min(createdDaysAgo, Math.pow(rng.next(), 2.5) * 60)
    const depositsCount = rng.weighted([
      [0, 22],
      [1, 18],
      [rng.int(2, 5), 30],
      [rng.int(6, 20), 20],
      [rng.int(21, 80), 10],
    ] as const)
    const avgDeposit = rng.money(20, 900)
    const totalDeposited = Math.round(depositsCount * avgDeposit * 100) / 100
    const totalBet = Math.round(totalDeposited * rng.float(1.6, 9) * 100) / 100
    const holdPct = rng.float(-0.04, 0.12, 3)
    const totalWon = Math.max(0, Math.round(totalBet * (1 - holdPct - 0.03) * 100) / 100)
    const totalWithdrawn = Math.max(0, Math.round((totalDeposited * rng.float(0, 0.9)) * 100) / 100)
    const city = rng.pick(CITIES)
    const isAffiliate = i < 34
    const role: PlayerRole = i < 4 ? 'Gerente' : i < 14 ? 'Influenciador' : isAffiliate ? 'Afiliado' : 'Jogador'
    const origin: PlayerOrigin = isAffiliate
      ? 'Orgânico'
      : rng.weighted([
          ['Orgânico', 30],
          ['Afiliado', 26],
          ['Indicação', 10],
          ['Google Ads', 12],
          ['Meta Ads', 12],
          ['TikTok Ads', 5],
          ['Influenciador', 8],
        ] as const)
    const age = rng.int(18, 64)
    const birth = new Date(NOW.getFullYear() - age, rng.int(0, 11), rng.int(1, 28))
    const tags: string[] = []
    if (totalDeposited > 15000) tags.push('VIP')
    if (createdDaysAgo < 7) tags.push('Novo')
    if (rng.bool(0.08)) tags.push(rng.pick(TAGS))
    const firstDepositAt =
      depositsCount > 0 ? iso(new Date(createdAt.getTime() + rng.int(0, Math.max(1, Math.floor(createdDaysAgo / 4))) * HOUR)) : null

    players.push({
      id: String(100231 + i * 7),
      name,
      nickname,
      email,
      phone: `${rng.pick([11, 21, 31, 41, 51, 61, 71, 81, 85, 92])}9${rng.digits(8)}`,
      cpf: genCpf(rng),
      birthDate: iso(birth),
      origin,
      role,
      status: rng.weighted([
        ['ativo', 92],
        ['bloqueado', 3],
        ['autoexcluido', 2],
        ['pausa', 3],
      ] as const),
      kyc: rng.weighted([
        ['verificado', 55],
        ['pendente', 12],
        ['nao_enviado', 30],
        ['reprovado', 3],
      ] as const),
      balanceReal: depositsCount ? rng.money(0, 2500) : 0,
      balanceBonus: rng.bool(0.3) ? rng.money(5, 400) : 0,
      coins: rng.int(0, 4800),
      level: Math.min(30, 1 + Math.floor(Math.sqrt(totalBet / 400))),
      xp: Math.floor(totalBet / 10),
      totalDeposited,
      depositsCount,
      totalWithdrawn,
      totalBet: depositsCount ? totalBet : 0,
      betsCount: depositsCount ? Math.floor(totalBet / rng.float(2, 25)) : 0,
      totalWon: depositsCount ? totalWon : 0,
      biggestWin: depositsCount ? rng.money(10, Math.max(50, totalWon / 6)) : 0,
      referrerId: null,
      refCode: `${slugify(first).slice(0, 5)}${rng.int(10, 99)}`,
      city: city[0],
      uf: city[1],
      ip: rng.bool(0.06) ? rng.pick(sharedIps) : genIp(rng),
      tags,
      createdAt: iso(createdAt),
      lastAccess: iso(new Date(NOW.getTime() - lastAccessAgo * DAY)),
      firstDepositAt,
    })
  }

  // códigos de indicação únicos
  const seen = new Set<string>()
  for (const p of players) {
    let code = p.refCode
    let k = 2
    while (seen.has(code.toUpperCase())) code = `${p.refCode}${k++}`
    seen.add(code.toUpperCase())
    p.refCode = code
  }

  // Afiliados: os primeiros 34 jogadores
  const affiliates: Affiliate[] = players.slice(0, 34).map((p, i) => {
    const type: AffiliateType = i < 4 ? 'Manager' : i < 14 ? 'Influencer' : 'Organic'
    return {
      id: `af${String(i + 1).padStart(3, '0')}`,
      playerId: p.id,
      name: p.name,
      email: p.email,
      type,
      level: i < 14 ? 1 : 2,
      managerId: i < 4 ? null : `af00${(i % 4) + 1}`,
      code: p.refCode.toUpperCase(),
      cpa: type === 'Manager' ? 0 : type === 'Influencer' ? 50 : 30,
      revShare: type === 'Manager' ? 0.1 : type === 'Influencer' ? 0.3 : 0.2,
      status: i === 21 || i === 29 ? 'pausado' : 'ativo',
      balance: rng.money(0, 9000),
      pixKey: rng.bool(0.5) ? p.email : `${rng.digits(3)}.${rng.digits(3)}.${rng.digits(3)}-${rng.digits(2)}`,
      createdAt: p.createdAt,
    }
  })

  // Liga jogadores indicados a afiliados
  const affiliateIds = affiliates.map((a) => a.id)
  for (const p of players.slice(34)) {
    if (p.origin === 'Afiliado' || p.origin === 'Influenciador' || p.origin === 'Indicação') {
      p.referrerId = rng.pick(affiliateIds)
    }
  }

  return { players, affiliates }
}

export function seedPlayers(): Player[] {
  if (!_players) {
    const b = build()
    _players = b.players
    _affiliates = b.affiliates
  }
  return _players
}

export function seedAffiliates(): Affiliate[] {
  if (!_affiliates) seedPlayers()
  return _affiliates!
}
