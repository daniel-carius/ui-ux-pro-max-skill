// Dados de demonstração do programa de afiliados:
// - desempenho diário por afiliado (cliques, cadastros, FTD, depósitos e GGR), base da Visão geral;
// - pedidos de saque de comissão dos afiliados.
import { createRng } from '@/lib/random'
import { DAY, HOUR, MIN, NOW, dayKey, iso, startOfDay } from './now'
import { seedAffiliates, type Affiliate, type AffiliateType } from './players'

/** Semente numérica a partir de um texto (FNV-1a), para séries estáveis por afiliado. */
export function hashSeed(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// ---------- Desempenho diário ----------

export interface AffiliateDay {
  date: string // AAAA-MM-DD
  clicks: number
  signups: number
  ftd: number
  deposits: number
  ggr: number
}

export interface PeriodStats {
  clicks: number
  signups: number
  ftd: number
  deposits: number
  ggr: number
}

export const EMPTY_STATS: PeriodStats = { clicks: 0, signups: 0, ftd: 0, deposits: 0, ggr: 0 }

/** A base guarda os últimos 400 dias, como o serviço de métricas. */
export const AFFILIATE_HISTORY_DAYS = 400

const PROFILE: Record<AffiliateType, { clicks: number; signupRate: [number, number]; ftdRate: [number, number]; ticket: [number, number] }> = {
  Manager: { clicks: 38, signupRate: [0.05, 0.09], ftdRate: [0.3, 0.44], ticket: [90, 240] },
  Influencer: { clicks: 120, signupRate: [0.04, 0.08], ftdRate: [0.22, 0.36], ticket: [60, 170] },
  Organic: { clicks: 24, signupRate: [0.06, 0.11], ftdRate: [0.25, 0.4], ticket: [70, 200] },
}

const seriesCache = new Map<string, AffiliateDay[]>()
let seedIds: Set<string> | null = null

/** Afiliado veio dos dados de demonstração (e não foi criado no painel). */
export function isSeedAffiliate(id: string) {
  if (!seedIds) seedIds = new Set(seedAffiliates().map((a) => a.id))
  return seedIds.has(id)
}

/**
 * Série diária de um afiliado. Afiliados criados no painel só têm números a
 * partir da data de criação; os de demonstração têm o histórico completo.
 */
export function affiliateDailySeries(a: Pick<Affiliate, 'id' | 'type' | 'createdAt'>): AffiliateDay[] {
  const gated = !isSeedAffiliate(a.id)
  const cacheKey = `${a.id}|${a.type}|${gated ? a.createdAt : ''}`
  const hit = seriesCache.get(cacheKey)
  if (hit) return hit
  const rng = createRng(hashSeed(a.id))
  const prof = PROFILE[a.type]
  const audience = rng.float(0.45, 1.6)
  const today = startOfDay(NOW)
  const since = gated ? startOfDay(new Date(a.createdAt)).getTime() : -Infinity
  const out: AffiliateDay[] = []
  const r2 = (v: number) => Math.round(v * 100) / 100
  for (let i = AFFILIATE_HISTORY_DAYS - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY)
    const dow = d.getDay()
    const weekend = dow === 0 || dow === 6 ? 1.25 : dow === 5 ? 1.1 : 1
    const growth = 0.65 + 0.35 * ((AFFILIATE_HISTORY_DAYS - i) / AFFILIATE_HISTORY_DAYS)
    // sorteios sempre na mesma ordem, para a série não depender do filtro
    const noise = 0.7 + rng.next() * 0.6
    const signupRate = rng.float(prof.signupRate[0], prof.signupRate[1], 3)
    const ftdRate = rng.float(prof.ftdRate[0], prof.ftdRate[1], 3)
    const jitterA = rng.next()
    const jitterB = rng.next()
    const ticket = rng.float(prof.ticket[0], prof.ticket[1])
    const redeposit = rng.float(1.6, 3.2)
    const tail = rng.float(0, 15)
    const goodDay = rng.bool(0.88)
    const holdGood = rng.float(0.24, 0.44, 3)
    const holdBad = rng.float(-0.22, 0.04, 3)
    if (d.getTime() < since) {
      out.push({ date: dayKey(d), clicks: 0, signups: 0, ftd: 0, deposits: 0, ggr: 0 })
      continue
    }
    const clicks = Math.max(0, Math.round(prof.clicks * audience * weekend * growth * noise))
    const signups = Math.max(0, Math.round(clicks * signupRate + jitterA - 0.5))
    const ftd = Math.min(signups, Math.max(0, Math.round(signups * ftdRate + jitterB - 0.5)))
    const deposits = r2(ftd * ticket * redeposit + signups * tail)
    const ggr = r2(deposits * (goodDay ? holdGood : holdBad))
    out.push({ date: dayKey(d), clicks, signups, ftd, deposits, ggr })
  }
  seriesCache.set(cacheKey, out)
  return out
}

/** Soma o desempenho de um afiliado entre duas datas (chaves AAAA-MM-DD, inclusivas). */
export function affiliateStats(a: Pick<Affiliate, 'id' | 'type' | 'createdAt'>, fromKey: string, toKey: string): PeriodStats {
  const acc = { ...EMPTY_STATS }
  for (const d of affiliateDailySeries(a)) {
    if (d.date < fromKey || d.date > toKey) continue
    acc.clicks += d.clicks
    acc.signups += d.signups
    acc.ftd += d.ftd
    acc.deposits += d.deposits
    acc.ggr += d.ggr
  }
  acc.deposits = Math.round(acc.deposits * 100) / 100
  acc.ggr = Math.round(acc.ggr * 100) / 100
  return acc
}

export function addStats(a: PeriodStats, b: PeriodStats): PeriodStats {
  return {
    clicks: a.clicks + b.clicks,
    signups: a.signups + b.signups,
    ftd: a.ftd + b.ftd,
    deposits: Math.round((a.deposits + b.deposits) * 100) / 100,
    ggr: Math.round((a.ggr + b.ggr) * 100) / 100,
  }
}

/** Data mais antiga com dados (AAAA-MM-DD). */
export function oldestAffiliateDay() {
  return dayKey(new Date(startOfDay(NOW).getTime() - (AFFILIATE_HISTORY_DAYS - 1) * DAY))
}

// ---------- Saques de comissão ----------

export type PayoutMethod = 'pix' | 'ted' | 'saldo'
export type AffiliateWithdrawalStatus = 'pendente' | 'pago' | 'recusado'
export type PixKeyType = 'CPF' | 'E-mail' | 'Celular' | 'Aleatória'

export const PAYOUT_METHOD_LABEL: Record<PayoutMethod, string> = {
  pix: 'PIX',
  ted: 'TED',
  saldo: 'Crédito no saldo do jogo',
}

export const AFFILIATE_WITHDRAWAL_STATUS_LABEL: Record<AffiliateWithdrawalStatus, string> = {
  pendente: 'Pendente',
  pago: 'Pago',
  recusado: 'Recusado',
}

export interface BankAccount {
  bank: string
  agency: string
  account: string
  holder: string
}

export interface AffiliateWithdrawal {
  id: string
  affiliateId: string
  affiliateName: string
  affiliateEmail: string
  affiliateType: AffiliateType
  amount: number
  method: PayoutMethod
  pixKeyType: PixKeyType | null
  pixKey: string | null
  bank: BankAccount | null
  status: AffiliateWithdrawalStatus
  createdAt: string
  decidedAt: string | null
  decidedBy: string | null
  /** motivo da recusa */
  reason: string | null
  /** identificador do pagamento (E2E do PIX, número da TED ou do lançamento) */
  reference: string | null
}

const BANKS = ['001 · Banco do Brasil', '104 · Caixa', '237 · Bradesco', '341 · Itaú', '033 · Santander', '260 · Nu Pagamentos', '077 · Banco Inter'] as const
const DECIDERS = ['Daniel Carius', 'Pedro Santos'] as const
export const AFFILIATE_REJECT_REASONS = [
  'Dados do PIX divergentes do titular',
  'Comissão em revisão (suspeita de fraude)',
  'Indicados com chargeback no período',
  'Valor fora dos limites do programa',
  'Afiliado pausado',
  'Outro motivo',
] as const

let _withdrawals: AffiliateWithdrawal[] | null = null

export function seedAffiliateWithdrawals(): AffiliateWithdrawal[] {
  if (_withdrawals) return _withdrawals
  const rng = createRng(7171)
  const affs = seedAffiliates()
  const out: AffiliateWithdrawal[] = []
  const total = 42
  for (let i = 0; i < total; i++) {
    // influenciadores e gerentes pedem mais
    const a = rng.weighted(affs.map((x) => [x, x.type === 'Organic' ? 1 : x.type === 'Influencer' ? 2.2 : 1.6] as const))
    const status: AffiliateWithdrawalStatus =
      i < 12
        ? 'pendente'
        : rng.weighted([
            ['pago', 78],
            ['recusado', 22],
          ] as const)
    // poucos pendentes antigos (fora do prazo); pagos e recusados concentrados nas últimas semanas
    const ageH = status === 'pendente' ? (i < 3 ? rng.int(24 * 4, 24 * 9) : rng.int(1, 40)) : rng.int(24 * 2, 24 * 50)
    const createdAt = new Date(NOW.getTime() - ageH * HOUR - rng.int(0, 59) * MIN)
    const method = rng.weighted([
      ['pix', 32],
      ['ted', 5],
      ['saldo', 5],
    ] as const)
    let amount = rng.money(100, 6500)
    if (i === 3) amount = 14250 // acima do máximo do programa
    if (i === 17) amount = 62.5 // abaixo do mínimo
    amount = Math.round(amount * 100) / 100

    let pixKeyType: PixKeyType | null = null
    let pixKey: string | null = null
    let bank: BankAccount | null = null
    if (method === 'pix') {
      const kind = rng.weighted([
        ['conta', 70],
        ['Celular', 18],
        ['Aleatória', 12],
      ] as const)
      if (kind === 'Celular') {
        pixKeyType = 'Celular'
        pixKey = `${rng.pick([11, 21, 31, 41, 51, 71, 81, 85])}9${rng.digits(8)}`
      } else if (kind === 'Aleatória') {
        pixKeyType = 'Aleatória'
        pixKey = `${rng.id('', 8)}-${rng.id('', 4)}-${rng.id('', 4)}-${rng.id('', 4)}-${rng.id('', 12)}`
      } else {
        pixKeyType = a.pixKey.includes('@') ? 'E-mail' : 'CPF'
        pixKey = a.pixKey.includes('@') ? a.pixKey : a.pixKey.replace(/\D/g, '')
      }
    } else if (method === 'ted') {
      bank = {
        bank: rng.pick(BANKS),
        agency: rng.digits(4),
        account: `${rng.digits(rng.int(5, 8))}-${rng.int(0, 9)}`,
        holder: a.name,
      }
    }

    const decided = status !== 'pendente'
    const decidedAt = decided ? new Date(createdAt.getTime() + rng.int(2, 52) * HOUR + rng.int(0, 59) * MIN) : null
    out.push({
      id: `SA${48210 + i * 3}`,
      affiliateId: a.id,
      affiliateName: a.name,
      affiliateEmail: a.email,
      affiliateType: a.type,
      amount,
      method,
      pixKeyType,
      pixKey,
      bank,
      status,
      createdAt: iso(createdAt),
      decidedAt: decidedAt ? iso(decidedAt) : null,
      decidedBy: decided ? rng.pick(DECIDERS) : null,
      reason: status === 'recusado' ? rng.pick(AFFILIATE_REJECT_REASONS.slice(0, 4)) : null,
      reference:
        status === 'pago'
          ? method === 'pix'
            ? `E${rng.digits(8)}${dayKey(decidedAt!).replace(/-/g, '')}${rng.id('', 11).toUpperCase()}`
            : method === 'ted'
              ? `TED-${rng.digits(9)}`
              : `CRED-${rng.digits(7)}`
          : null,
    })
  }
  out.sort((x, y) => y.createdAt.localeCompare(x.createdAt))
  _withdrawals = out
  return out
}

// ---------- Links ----------

export interface LinkState {
  paused: boolean
  at: string
  by: string
  reason?: string
}

/** Estado inicial dos links: um link pausado pela equipe para revisão. */
export const SEED_LINK_STATE: Record<string, LinkState> = {
  af026: {
    paused: true,
    at: iso(new Date(NOW.getTime() - 12 * DAY - 3 * HOUR)),
    by: 'Daniel Carius',
    reason: 'Tráfego com cara de robô (cliques sem cadastro)',
  },
}
