// Jogadores e afiliados. Dados pessoais obviamente fictícios (ver ./demo): e-mail .invalid,
// CPF com dígito verificador errado, celular (DD) 9 0XXX-XXXX e IP na faixa privada 10.x.
// Aqui fica o cadastro (apelido único, "Desde", último acesso, KYC e perfil de jogo); totais, saldos, moedas e
// 1º depósito vêm do livro-razão de cada conta (./ledger), o mesmo do extrato, Depósitos e Saques.
import { createRng } from '@/lib/random'
import { demoCpf, demoEmail, demoIp, demoPhone, demoRecords } from './demo'
import { CITIES, EMAIL_DOMAINS, FIRST_NAMES, LAST_NAMES, NICK_PARTS_A, NICK_PARTS_B, slugify } from './names'
import { buildLedger, type DemoLedger, type PlayerProfile, type Tier } from './ledger'
import { DAY, HOUR, MIN, NOW, iso } from './now'

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
  return demoCpf(rng.digits(11))
}

function genIp(rng: ReturnType<typeof createRng>) {
  return demoIp(`${rng.pick([177, 179, 186, 187, 189, 191, 200, 201])}.${rng.int(1, 254)}.${rng.int(1, 254)}.${rng.int(1, 254)}`)
}

/** Sorteio que não é mais usado: consumido para os campos gerados depois dele continuarem os mesmos. */
function unusedDraw(rng: ReturnType<typeof createRng>) {
  rng.next()
  return 0
}

let _players: Player[] | null = null
let _affiliates: Affiliate[] | null = null
let _ledger: DemoLedger | null = null

/** Perfil de jogo pela idade da conta: quem aposta alto é conta antiga, com histórico. */
function pickProfile(rng: ReturnType<typeof createRng>, ageDays: number): PlayerProfile {
  const depositor = rng.bool(0.8)
  const tier: Tier =
    ageDays >= 120
      ? rng.weighted([['whale', 8], ['high', 15], ['regular', 40], ['casual', 37]] as const)
      : ageDays >= 30
        ? rng.weighted([['high', 12], ['regular', 40], ['casual', 48]] as const)
        : rng.weighted([['regular', 35], ['casual', 65]] as const)
  return { tier, depositor, sports: depositor && rng.bool(0.4) }
}

/** KYC pelo perfil: quem deposita alto já mandou documento (sem KYC verificado, só saque pequeno). */
function pickKyc(rng: ReturnType<typeof createRng>, prof: PlayerProfile): KycStatus {
  if (!prof.depositor) return rng.weighted([['verificado', 15], ['pendente', 8], ['nao_enviado', 75], ['reprovado', 2]] as const)
  if (prof.tier === 'whale') return 'verificado'
  if (prof.tier === 'high') return rng.weighted([['verificado', 92], ['pendente', 8]] as const)
  if (prof.tier === 'regular') return rng.weighted([['verificado', 70], ['pendente', 12], ['nao_enviado', 15], ['reprovado', 3]] as const)
  return rng.weighted([['verificado', 52], ['pendente', 13], ['nao_enviado', 32], ['reprovado', 3]] as const)
}

function build() {
  const rng = createRng(2026)
  const players: Player[] = []
  const profiles = new Map<string, PlayerProfile>()
  const total = 340
  // IPs compartilhados para alimentar o anti-fraude
  const sharedIps = Array.from({ length: 6 }, () => genIp(rng))
  // apelido é único na plataforma (o ranking e a busca mostram o apelido)
  const nicknames = new Set<string>()
  const uniqueNickname = () => {
    const base = `${rng.pick(NICK_PARTS_A)}${rng.pick(NICK_PARTS_B)}`
    let nick = rng.bool(0.4) ? `${base}${rng.int(1, 99)}` : base
    while (nicknames.has(nick)) nick = `${base}${rng.int(1, 999)}`
    nicknames.add(nick)
    return nick
  }

  for (let i = 0; i < total; i++) {
    const first = rng.pick(FIRST_NAMES)
    const last = rng.pick(LAST_NAMES)
    const name = `${first} ${last}`
    const nickname = uniqueNickname()
    const email = demoEmail(`${slugify(first)}.${slugify(last)}${rng.int(1, 999)}@${rng.pick(EMAIL_DOMAINS)}`)
    const createdDaysAgo = Math.pow(rng.next(), 1.6) * 360
    const createdAt = new Date(NOW.getTime() - createdDaysAgo * DAY - rng.int(0, 23) * HOUR)
    const ageDays = (NOW.getTime() - createdAt.getTime()) / DAY
    // último acesso entre o cadastro (a visita do cadastro dura alguns minutos) e agora
    const lastAccess = Math.min(NOW.getTime(), Math.max(createdAt.getTime() + rng.int(5, 90) * MIN, NOW.getTime() - Math.pow(rng.next(), 2.5) * 60 * DAY))
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
    const profile = pickProfile(rng, ageDays)
    const tags: string[] = []
    if (ageDays < 7) tags.push('Novo')
    if (rng.bool(0.08)) tags.push(rng.pick(TAGS.filter((t) => t !== 'VIP' && t !== 'Novo')))
    const id = String(100231 + i * 7)
    profiles.set(id, profile)

    players.push({
      id,
      name,
      nickname,
      email,
      phone: demoPhone(`${rng.pick([11, 21, 31, 41, 51, 61, 71, 81, 85, 92])}9${rng.digits(8)}`),
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
      kyc: pickKyc(rng, profile),
      // saldos, totais, nível e 1º depósito: preenchidos pelo livro-razão (./ledger)
      balanceReal: 0,
      balanceBonus: 0,
      // moedas: do livro-razão (ganhas pelas regras da Moeda); o sorteio antigo fica para os campos seguintes não mudarem
      coins: unusedDraw(rng),
      level: 1,
      xp: 0,
      totalDeposited: 0,
      depositsCount: 0,
      totalWithdrawn: 0,
      totalBet: 0,
      betsCount: 0,
      totalWon: 0,
      biggestWin: 0,
      referrerId: null,
      refCode: `${slugify(first).slice(0, 5)}${rng.int(10, 99)}`,
      city: city[0],
      uf: city[1],
      ip: rng.bool(0.06) ? rng.pick(sharedIps) : genIp(rng),
      tags,
      createdAt: iso(createdAt),
      lastAccess: iso(new Date(lastAccess)),
      firstDepositAt: null,
    })
  }

  // a história de cada conta: totais, saldos, extrato, depósitos, saques e bilhetes
  const ledger = buildLedger(players, profiles)

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
      pixKey: rng.bool(0.5) ? p.email : demoCpf(`${rng.digits(3)}.${rng.digits(3)}.${rng.digits(3)}-${rng.digits(2)}`),
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

  return { players, affiliates, ledger }
}

export function seedPlayers(): Player[] {
  if (!_players) {
    const b = build()
    _players = b.players
    _affiliates = b.affiliates
    _ledger = b.ledger
  }
  return _players
}

/** Extrato, depósitos, saques, bilhetes e estatísticas por período que saem do mesmo livro-razão dos jogadores. */
export function demoLedger(): DemoLedger {
  if (!_ledger) seedPlayers()
  return _ledger!
}

/**
 * Contas que estavam no site em `t` (cadastradas antes e com último acesso depois): para registros de campanha
 * (giro, compra na loja, giros grátis) nunca caírem antes do "Desde" ou depois do último acesso.
 */
export function playersOnlineAt(list: readonly Player[], t: number): Player[] {
  const on = list.filter((p) => Date.parse(p.createdAt) <= t && Date.parse(p.lastAccess) >= t)
  return on.length ? on : list.filter((p) => Date.parse(p.createdAt) <= t)
}

export function seedAffiliates(): Affiliate[] {
  if (!_affiliates) seedPlayers()
  return _affiliates!
}

// modo API: a base vem do servidor (DEMO_DATA grava estes mesmos dados); sem nada gravado, lista vazia
demoRecords(seedPlayers)
demoRecords(seedAffiliates)
