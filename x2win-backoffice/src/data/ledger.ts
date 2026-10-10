// Livro-razão dos jogadores de demonstração: a história de cada conta, lançamento por lançamento, do
// 1º depósito ao último acesso. As bases que as telas mostram saem daqui, e por isso concordam entre si:
//  - ficha: depositado, sacado, apostado, ganho, maior prêmio, nº de depósitos e de apostas, nível e XP
//    são as somas do livro-razão desde o cadastro ("Desde");
//  - saldo real = depositado − sacado − saques ainda em aberto (o pedido reserva o valor) + ganho −
//    apostado + ajustes (cashback, creditação, subtração e estorno de aposta). Aposta só com saldo, então
//    nunca fica negativo. Saldo bônus = bônus creditados no período do extrato (os de antes já foram
//    usados ou venceram);
//  - extrato (geral.transacoes): os lançamentos dos últimos 90 dias (o maior período das telas), em
//    sequência por carteira (o saldo depois de uma linha é o saldo antes da seguinte, e a última fecha com
//    o saldo da ficha). Ajustes só acontecem nesse período: ficha + extrato conferem o saldo. Bônus só nos
//    últimos 30 dias (a validade do bônus em Saldo bônus): todo bônus do extrato ainda vale;
//  - aposta estornada (rodada não concluída, bilhete cancelado ou reembolsado) não conta: sai do apostado e
//    do nº de apostas da ficha, e a linha "Estorno" devolve o valor;
//  - Depósitos (operacao.depositos) e Saques (operacao.saques): os pedidos dos últimos 90 dias, com a
//    mesma referência E2E da linha do extrato. "1º depósito" é o primeiro PIX pago da conta (só ele).
//    O pedido de saque reserva o valor (linha "Saque"); recusado, cancelado ou expirado volta como
//    estorno; aprovado conta no "Sacado". Sem KYC verificado o saque fica retido (Cadastro e KYC): nunca
//    é aprovado; o pedido é recusado ("KYC pendente") ou cancelado, e a conta não pede de novo;
//  - apostas esportivas: os bilhetes dos últimos 90 dias (aposta e prêmio também no extrato);
//  - Rankings: as mesmas apostas e prêmios, somados do extrato por período (data/geral);
//  - giros grátis (Campanhas › Free Spins): as concessões nascem aqui (2º depósito, cadastro, cupom e
//    aniversário VIP) e o ganho dos giros é a linha "Free spin" do extrato;
//  - moedas (Campanhas › Moeda): o saldo é o que a conta ganhou pelas regras padrão (apostas, depósitos,
//    login e nível) nos últimos 90 dias (validade), com o teto diário;
//  - nada antes do cadastro, nada depois de agora, e o jogador só age até o último acesso.
// Determinístico: cada conta tem o próprio gerador (semente pelo id), então mudar uma regra mexe só nas
// contas afetadas. Sem dependência do React: o servidor usa estes dados na semeadura (DEMO_DATA).
import { createRng, type Rng } from '@/lib/random'
import type { FreeSpinCampaign } from '@/domain/campanhas-freespins'
import { DEFAULT_COIN_CONFIG, EARN_BASE, type EarnCategory } from '@/domain/campanhas2-moeda'
import { seedGames, seedProviders, type Game } from './catalog'
import { DEMO_STAFF_LABEL } from './demo'
import { FS_DEMO_PAUSED_AT, seedFsCampaigns } from './freespins-campaigns'
import type { Deposit, DepositStatus, RiskLevel, Transaction, TransactionType, Withdrawal, WithdrawalStatus } from './finance'
import { DAY, HOUR, MIN, NOW, iso, startOfDay } from './now'
import type { Player } from './players'
import type { SportsBet, SportsBetStatus } from './sports'
import { buildTicket, ticketLabel } from './sports-markets'

/** Perfil de jogo da conta: quanto deposita, quanto aposta e com que frequência. */
export type Tier = 'casual' | 'regular' | 'high' | 'whale'

export interface PlayerProfile {
  tier: Tier
  /** chega a fazer o 1º depósito */
  depositor: boolean
  /** também aposta em esportes */
  sports: boolean
}

interface TierSpec {
  /** valores de PIX que a conta costuma fazer */
  deposits: readonly number[]
  /** aposta típica como fração do depósito típico */
  stake: readonly [number, number]
  /** sessões de jogo por dia */
  rate: readonly [number, number]
  /** apostas por sessão */
  bets: readonly [number, number]
  /** chance de pedir saque quando o saldo passa do depósito típico */
  withdraw: number
}

const TIERS: Record<Tier, TierSpec> = {
  casual: { deposits: [20, 20, 30, 50, 50, 100], stake: [0.06, 0.2], rate: [0.03, 0.09], bets: [2, 5], withdraw: 0.35 },
  regular: { deposits: [50, 100, 100, 150, 200, 300], stake: [0.05, 0.15], rate: [0.045, 0.12], bets: [2, 6], withdraw: 0.45 },
  high: { deposits: [200, 300, 500, 500, 1000], stake: [0.04, 0.12], rate: [0.08, 0.2], bets: [3, 7], withdraw: 0.55 },
  whale: { deposits: [1000, 2000, 2500, 3000, 5000], stake: [0.03, 0.1], rate: [0.12, 0.25], bets: [4, 9], withdraw: 0.65 },
}

/** Regras de saque padrão (shared/withdrawals: mínimo, máximo por pedido e aprovações por dia). */
const WITHDRAWAL_MIN = 20
const WITHDRAWAL_MAX = 5000
const WITHDRAWAL_DAILY = 2
/** Sem KYC verificado, o pedido é pequeno (e fica retido: nunca é aprovado). */
const UNVERIFIED_WITHDRAWAL_MAX = 200
/** Motivo da recusa de saque sem KYC (o mesmo da lista de motivos de Saques). */
const KYC_REFUSAL = 'KYC pendente'
/** Etiqueta VIP: quem já depositou mais que isto. */
export const VIP_DEPOSITED = 15000
/** Campanha da tela de depósito (./operacao): 100% do PIX até R$ 500. */
const DEPOSIT_CAMPAIGN = 'Deposite 50 e ganhe o dobro'
const DEPOSIT_CAMPAIGN_MAX = 500
/** Prazo do PIX (padrão de operacao.depositos.limites). */
const PIX_EXPIRATION = 30 * MIN

const GATEWAYS = ['PagFlex', 'PixNow', 'BRPay']
const REFUSAL_NOTES = ['Rollover não cumprido', 'Conta duplicada', 'Dados do PIX divergentes']
const STAKES = [0.4, 0.5, 0.8, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 75, 80, 100, 120, 150, 200, 250, 300, 400, 500]

const cents = (v: number) => Math.round(v * 100) / 100
/** Ordem de datas ISO (comparação simples: localeCompare é lento para milhares de itens). */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** XP de cada nível do programa de níveis (DEFAULT_LEVELS_CONFIG em domain/campanhas3-niveis: 10 níveis). */
const LEVEL_XP = [0, 50, 150, 400, 1000, 2000, 4000, 7000, 12000, 25000]
/** XP como no programa de níveis: 1 ponto a cada R$ 10 apostados e 5 por depósito. */
const xpFor = (totalBet: number, deposits: number) => Math.floor(totalBet / 10) + 5 * deposits
const levelFor = (xp: number) => LEVEL_XP.filter((min) => xp >= min).length

/** Maior valor de aposta "redondo" que não passa de v. */
function niceStake(v: number) {
  let s = STAKES[0]
  for (const x of STAKES) if (x <= v) s = x
  return s
}

/** Valor redondo de saque (de 10 em 10, 50 em 50 ou 100 em 100). */
function niceAmount(v: number) {
  const step = v < 500 ? 10 : v < 2000 ? 50 : 100
  return Math.floor(v / step) * step
}

function e2e(rng: Rng) {
  return `E${rng.digits(8)}${rng.id('', 6).toUpperCase()}${rng.digits(10)}`
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Multiplicador do prêmio de uma rodada premiada (com 30% de rodadas premiadas, RTP perto de 93%). */
const MULTIPLIERS: readonly (readonly [readonly [number, number], number])[] = [
  [[0.3, 1.5], 55],
  [[1.5, 4], 33],
  [[4, 15], 10],
  [[15, 60], 2],
]
function multiplier(rng: Rng) {
  const band = rng.weighted(MULTIPLIERS)
  return rng.float(band[0], band[1], 2)
}

/** Quanto volta, em prêmio, do valor dos giros grátis usados (em média perto de 1). */
const FS_LUCK: readonly (readonly [readonly [number, number], number])[] = [
  [[0.1, 0.7], 45],
  [[0.7, 1.3], 40],
  [[1.3, 4], 12],
  [[4, 18], 3],
]
function fsLuck(rng: Rng) {
  const band = rng.weighted(FS_LUCK)
  return rng.float(band[0], band[1], 3)
}

// ---------- períodos ----------

const TODAY = startOfDay(NOW).getTime()
const NOW_MS = NOW.getTime()

/** Início do período de `days` dias das telas (o mesmo de presetRange: hoje e os dias anteriores inteiros). */
export function periodStartMs(days: number) {
  return TODAY - (days - 1) * DAY
}

/** O extrato, Depósitos, Saques e as apostas esportivas guardam os últimos 90 dias (o maior período das telas). */
export const LEDGER_DAYS = 90
const WINDOW = periodStartMs(LEDGER_DAYS)
/** Bônus vence em 30 dias (Saldo bônus): os bônus da história são desse período, então todos ainda valem. */
const BONUS_START = periodStartMs(30)
/** Moedas ganhas há mais que a validade da moeda já venceram. */
const COIN = DEFAULT_COIN_CONFIG
const COIN_START = NOW_MS - (COIN.expires ? COIN.expiryDays : 3650) * DAY

// ---------- livro de uma conta ----------

interface Line {
  id: string
  t: number
  playerId: string
  type: TransactionType
  amount: number
  wallet: 'real' | 'bonus'
  before: number
  after: number
  game: Game | null
  /** nome no extrato quando não é um jogo do catálogo (bilhete de esporte) */
  label: string | null
  provider: string | null
  ref: string | (() => string)
}

/** Campanha de giros grátis com o intervalo em que concede (do início ao fim, à pausa ou a agora). */
interface FsSpec {
  c: FreeSpinCampaign
  game: Game | null
  from: number
  to: number
}

/** Concessão de giros grátis de uma conta; o ganho dos giros entra no extrato ("Free spin", referência = id). */
export interface LedgerFsGrant {
  id: string
  campaignId: string
  playerId: string
  grantedAt: number
  expiresAt: number
  gameId: string
  spins: number
  spinValue: number
  used: number
  winnings: number
  cancelled: boolean
  manual: boolean
  note: string
}

interface Ctx {
  /** jogos que recebem aposta */
  games: GamePool
  providerName: Map<string, string>
  sharedIps: Set<string>
  freeSpins: FsSpec[]
  lines: Line[]
  deposits: Deposit[]
  withdrawals: Withdrawal[]
  tickets: SportsBet[]
  fsGrants: LedgerFsGrant[]
}

class Book {
  real = 0
  bonus = 0
  deposited = 0
  depositsCount = 0
  withdrawn = 0
  bet = 0
  betsCount = 0
  won = 0
  biggestWin = 0
  bonusReceived = 0
  /** saldo de moedas (calculado no fim, ver coinsOf) */
  coins = 0
  firstDepositAt: number | null = null
  /** hora do último lançamento feito */
  lastT = -Infinity
  /** lançamentos da conta, na ordem do tempo */
  readonly lines: Line[] = []
  /** apostas devolvidas (estorno): não contam no apostado */
  readonly refunded = new Set<Line>()
  private queue: { t: number; run: () => void }[] = []

  constructor(
    private readonly ctx: Ctx,
    readonly playerId: string,
  ) {}

  push(t: number, type: TransactionType, amount: number, wallet: 'real' | 'bonus', extra: { ref: Line['ref']; game?: Game | null; label?: string | null; provider?: string | null }): Line {
    // créditos agendados para antes deste lançamento entram primeiro (a sequência do saldo segue o tempo)
    this.flush(t)
    amount = cents(amount)
    // bônus só nos últimos 30 dias (validade): a carteira bônus é a soma dos bônus ainda válidos
    const before = wallet === 'real' ? this.real : this.bonus
    const after = cents(before + amount)
    if (wallet === 'real') this.real = after
    else this.bonus = after
    if (type === 'deposito') {
      this.deposited += amount
      this.depositsCount++
    } else if (type === 'aposta') {
      this.bet += -amount
      this.betsCount++
    } else if (type === 'ganho' || type === 'free_spin') {
      this.won += amount
      this.biggestWin = Math.max(this.biggestWin, amount)
    }
    if (type === 'bonus' || type === 'free_spin' || type === 'cashback') this.bonusReceived += amount
    const game = extra.game ?? null
    const line: Line = {
      id: '',
      t,
      playerId: this.playerId,
      type,
      amount,
      wallet,
      before,
      after,
      game,
      label: extra.label ?? null,
      provider: extra.provider ?? (game ? (this.ctx.providerName.get(game.providerId) ?? null) : null),
      ref: extra.ref,
    }
    this.ctx.lines.push(line)
    this.lines.push(line)
    this.lastT = Math.max(this.lastT, t)
    return line
  }

  /** Aposta devolvida (linha "Estorno" lançada à parte): sai do apostado e do nº de apostas. */
  refund(bet: Line) {
    if (bet.type !== 'aposta' || this.refunded.has(bet)) return
    this.refunded.add(bet)
    this.bet -= -bet.amount
    this.betsCount--
  }

  /** Crédito que acontece depois (prêmio de bilhete, devolução de saque): entra na ordem do tempo. */
  later(t: number, run: () => void) {
    this.queue.push({ t, run })
    this.queue.sort((a, b) => a.t - b.t)
  }

  /** Lança os créditos agendados até `t` (antes de qualquer lançamento em `t`). */
  flush(t: number) {
    while (this.queue.length && this.queue[0].t <= t) this.queue.shift()!.run()
  }
}

// ---------- simulação de uma conta ----------

/** Jogos em ordem de entrada no catálogo, com o destaque acumulado (sorteio sem montar listas a cada sessão). */
interface GamePool {
  games: Game[]
  since: number[]
  /** soma do destaque até cada jogo (inclusive) */
  weight: number[]
}

function gamePool(games: Game[]): GamePool {
  const sorted = games.map((game) => ({ game, since: Date.parse(game.createdAt) })).sort((a, b) => a.since - b.since)
  let acc = 0
  return { games: sorted.map((x) => x.game), since: sorted.map((x) => x.since), weight: sorted.map((x) => (acc += x.game.highlight)) }
}

/** Jogo da sessão: só o que já estava no catálogo nessa data; os de mais destaque saem mais. */
function pickGame(pool: GamePool, rng: Rng, t: number): Game {
  let n = 0
  while (n < pool.since.length && pool.since[n] <= t) n++
  if (!n) n = pool.games.length
  const r = rng.next() * pool.weight[n - 1]
  let i = 0
  while (i < n - 1 && pool.weight[i] < r) i++
  return pool.games[i]
}

function riskOf(rng: Rng, p: Player, amount: number, avgDeposit: number, sharedIp: boolean, quickOut: boolean): Withdrawal['risk'] {
  const reasons: string[] = []
  let score = rng.int(4, 38)
  if (amount >= 2000 || amount > avgDeposit * 4) {
    score += 25
    reasons.push('Valor alto para o histórico do jogador')
  }
  if (p.kyc !== 'verificado') {
    score += 18
    reasons.push('KYC não verificado')
  }
  if (sharedIp) {
    score += 22
    reasons.push('IP compartilhado com outras contas')
  }
  if (quickOut) {
    score += 15
    reasons.push('Saque logo após depósito com pouca aposta')
  }
  score = Math.min(99, score)
  const level: RiskLevel = score >= 60 ? 'alto' : score >= 35 ? 'medio' : 'baixo'
  return { level, score, reasons }
}

function simulate(ctx: Ctx, p: Player, prof: PlayerProfile): Book {
  const rng = createRng(hash(`ledger:${p.id}`))
  const book = new Book(ctx, p.id)
  const spec = TIERS[prof.tier]
  const created = Date.parse(p.createdAt)
  const last = Date.parse(p.lastAccess)
  const who = { playerId: p.id, playerName: p.name, playerEmail: p.email }
  const verified = p.kyc === 'verificado'
  const withdrawalCap = verified ? WITHDRAWAL_MAX : UNVERIFIED_WITHDRAWAL_MAX
  const sharedIp = ctx.sharedIps.has(p.ip)
  const approvedAt: number[] = []
  /** sem KYC: o primeiro pedido fica retido (recusado ou cancelado) e a conta não pede de novo */
  let kycAsked = false

  // ---- giros grátis: concessões da conta e o uso delas ----
  const grants: LedgerFsGrant[] = []
  const granted = (s: FsSpec) => grants.filter((g) => g.campaignId === s.c.id).length
  const grantFs = (s: FsSpec, at: number, extra: Partial<Pick<LedgerFsGrant, 'cancelled' | 'note'>> = {}) => {
    const g: LedgerFsGrant = {
      id: '',
      campaignId: s.c.id,
      playerId: p.id,
      grantedAt: at,
      expiresAt: at + s.c.validityDays * DAY,
      gameId: s.c.gameId,
      spins: s.c.spins,
      spinValue: s.c.spinValue,
      used: 0,
      winnings: 0,
      cancelled: extra.cancelled ?? false,
      manual: s.c.trigger === 'manual',
      note: extra.note ?? '',
    }
    grants.push(g)
    ctx.fsGrants.push(g)
  }
  /** O jogador usa os giros válidos quando entra; o ganho vira saldo real (linha "Free spin" do extrato). */
  const useFs = (t: number): number => {
    for (const g of grants) {
      if (g.cancelled || g.used >= g.spins || t < g.grantedAt || t > g.expiresAt || t > last || t > NOW_MS) continue
      const left = g.spins - g.used
      const n = rng.bool(0.75) ? left : rng.int(1, left)
      const luck = fsLuck(rng)
      const end = Math.min(last, NOW_MS, t + Math.max(1, Math.round(n / 20)) * MIN)
      if (end < t) continue
      t = end
      g.used += n
      const prize = cents(n * g.spinValue * luck)
      if (prize <= 0) continue
      g.winnings = cents(g.winnings + prize)
      const spec = ctx.freeSpins.find((x) => x.c.id === g.campaignId)
      book.push(t, 'free_spin', prize, 'real', { game: spec?.game ?? null, ref: () => g.id })
    }
    return t
  }
  // giros de aniversário VIP: concedidos pela equipe no aniversário de quem já era VIP (depositou acima do teto)
  const birth = new Date(p.birthDate)
  const birthdays = ctx.freeSpins
    .filter((s) => s.c.trigger === 'manual')
    .flatMap((s) =>
      [NOW.getFullYear() - 1, NOW.getFullYear()].map((y) => ({ s, at: new Date(y, birth.getMonth(), birth.getDate(), 10 + (hash(p.id) % 8), hash(p.email) % 60).getTime() })),
    )
    .filter(({ s, at }) => at >= Math.max(s.from, created + DAY) && at <= s.to)
    .sort((a, b) => a.at - b.at)
  /** Aniversários já passados até `t`: concede se a conta já era VIP nessa data. */
  const birthdayGrants = (t: number) => {
    while (birthdays.length && birthdays[0].at <= t) {
      const { s, at } = birthdays.shift()!
      if (book.deposited > VIP_DEPOSITED && granted(s) < s.c.maxPerPlayer) grantFs(s, at, { note: 'Aniversário do jogador (VIP)' })
    }
  }

  /** PIX gerado que não virou saldo (expirou, falhou ou foi devolvido pelo gateway): não mexe no livro. */
  const attempt = (at: number, amount: number, status: DepositStatus) => {
    let updated = at + (status === 'expirado' ? PIX_EXPIRATION : status === 'estornado' ? rng.int(20, 60) * HOUR : rng.int(1, 3) * MIN)
    if (status === 'pendente') updated = at
    else if (updated > NOW_MS - MIN) {
      status = 'falhou'
      updated = Math.min(at + MIN, NOW_MS)
    }
    ctx.deposits.push({ id: '', ...who, amount, status, gateway: rng.weighted([[GATEWAYS[0], 6], [GATEWAYS[1], 3], [GATEWAYS[2], 1]] as const), reference: e2e(rng), isFirst: false, bonusCampaign: null, createdAt: iso(new Date(at)), updatedAt: iso(new Date(updated)) })
  }

  const deposit = (t: number, amount: number, first: boolean, uCampaign: number, uAttempt: number) => {
    // o PIX é gerado alguns minutos antes de pago, nunca antes do cadastro; pago no período, gerado no período
    let createdAt = t - Math.min(rng.int(1, 15) * MIN + rng.int(0, 59) * 1000, t - created)
    if (t >= WINDOW && createdAt < WINDOW) createdAt = WINDOW
    const reference = e2e(rng)
    const gateway = rng.weighted([[GATEWAYS[0], 6], [GATEWAYS[1], 3], [GATEWAYS[2], 1]] as const)
    book.push(t, 'deposito', amount, 'real', { ref: reference })
    if (first) book.firstDepositAt = t
    // giros do nº do depósito (ex.: 2º depósito): concedidos com o próprio depósito
    for (const s of ctx.freeSpins) {
      if (s.c.trigger !== 'deposito' || book.depositsCount !== s.c.depositNumber || amount < s.c.minDeposit) continue
      if (t >= s.from && t <= s.to && granted(s) < s.c.maxPerPlayer) grantFs(s, t + 5000)
    }
    // a campanha do depósito (bônus) é dos últimos 30 dias, como todo bônus
    const campaign = t >= BONUS_START && (first ? uCampaign < 0.35 : uCampaign < 0.07)
    const dep: Deposit = { id: '', ...who, amount, status: 'pago', gateway, reference, isFirst: first, bonusCampaign: campaign ? DEPOSIT_CAMPAIGN : null, createdAt: iso(new Date(createdAt)), updatedAt: iso(new Date(t)) }
    ctx.deposits.push(dep)
    if (campaign) book.push(t, 'bonus', Math.min(amount, DEPOSIT_CAMPAIGN_MAX), 'bonus', { ref: () => dep.id })
    // PIX anterior que não foi pago (nunca antes do 1º: o 1º depósito é o primeiro pedido da conta)
    if (!first && uAttempt < 0.25) {
      const at = Math.max(created, createdAt - rng.int(3, 25) * MIN)
      attempt(at, rng.bool(0.6) ? amount : rng.pick(spec.deposits), rng.weighted([['expirado', 62], ['falhou', 33], ['estornado', 5]] as const))
    }
  }

  const withdraw = (req: number, amount: number, uStatus: number, uDelay: number, quickOut: boolean) => {
    // sem KYC verificado o saque fica retido: a conta pede uma vez (no período), é recusado ou cancela, e não insiste
    if (!verified && (req < WINDOW || kycAsked)) return
    // antes do período do extrato tudo já foi pago; no período, alguns são recusados, cancelados ou expiram
    let status: WithdrawalStatus = !verified
      ? uStatus < 0.8
        ? 'recusado'
        : 'cancelado'
      : req < WINDOW
        ? 'aprovado'
        : uStatus < 0.68
          ? 'aprovado'
          : uStatus < 0.8
            ? 'recusado'
            : uStatus < 0.9
              ? 'cancelado'
              : 'expirado'
    const delay = status === 'expirado' ? 72 * HOUR : status === 'cancelado' ? (2 + uDelay * 178) * MIN : (5 + uDelay * 595) * MIN
    let decided = req + Math.round(delay)
    const latest = NOW_MS - MIN
    if (decided > latest) {
      // ainda não daria tempo de decidir assim: foi aprovado antes de agora (ou nem foi pedido)
      if (latest - req < 5 * MIN || !verified) return
      status = 'aprovado'
      decided = req + Math.round(5 * MIN + uDelay * (latest - req - 5 * MIN))
    }
    if (!verified) kycAsked = true
    const reference = e2e(rng)
    const line = book.push(req, 'saque', -amount, 'real', { ref: reference })
    if (status === 'aprovado') {
      book.withdrawn += amount
      approvedAt.push(decided)
    } else {
      // o valor reservado volta para o saldo
      book.later(decided, () => book.push(decided, 'estorno', amount, 'real', { ref: () => `EST-${line.id}` }))
    }
    ctx.withdrawals.push(withdrawalRecord(req, decided, amount, status, reference, quickOut, verified ? undefined : KYC_REFUSAL))
  }

  const withdrawalRecord = (req: number, decided: number, amount: number, status: WithdrawalStatus, reference: string, quickOut: boolean, refusal?: string): Withdrawal => {
    const risk = riskOf(rng, p, amount, book.depositsCount ? book.deposited / book.depositsCount : 0, sharedIp, quickOut)
    const pixKeyType = rng.pick(['CPF', 'E-mail', 'Celular', 'Aleatória'] as const)
    const pixKey = pixKeyType === 'CPF' ? p.cpf : pixKeyType === 'E-mail' ? p.email : pixKeyType === 'Celular' ? p.phone : rng.id('', 32)
    const decidedByStaff = status === 'aprovado' || status === 'recusado'
    return {
      id: '',
      ...who,
      amount,
      fee: 0,
      status,
      risk,
      pixKeyType,
      pixKey,
      reference,
      createdAt: iso(new Date(req)),
      updatedAt: iso(new Date(decided)),
      decidedBy: decidedByStaff ? DEMO_STAFF_LABEL : null,
      decisionNote: status === 'recusado' ? (refusal ?? rng.pick(REFUSAL_NOTES)) : null,
    }
  }

  const ticket = (t: number, stake: number) => {
    const tk = buildTicket(rng, t)
    const roll = rng.next()
    const uWin = rng.next()
    const cashRatio = rng.float(0.6, 0.95, 3)
    const cashAt = rng.next()
    const potential = cents(stake * tk.odd)
    const label = ticketLabel(tk)
    const bet: SportsBet = { id: '', at: iso(new Date(t)), playerId: p.id, playerName: p.name, type: tk.type, selections: tk.selections, stake, odd: tk.odd, potential, paid: 0, status: 'aberta', provider: 'Betby', live: tk.live }
    const line = book.push(t, 'aposta', -stake, 'real', { label, provider: 'Betby', ref: () => bet.id })
    ctx.tickets.push(bet)
    if (tk.settlesAt > NOW_MS - MIN) return // resultado ainda não saiu
    // chance de ganhar coerente com a odd (margem da casa de ~8%)
    let status: SportsBetStatus = roll < 0.03 ? 'cancelada' : roll < 0.06 ? 'reembolsada' : roll < 0.11 ? 'cashout' : uWin < 0.92 / tk.odd ? 'ganha' : 'perdida'
    // devolução vira estorno no extrato, e ajustes só acontecem no período do extrato
    if ((status === 'cancelada' || status === 'reembolsada') && t < WINDOW) status = 'perdida'
    bet.status = status
    bet.paid = status === 'ganha' ? potential : status === 'cashout' ? cents(stake * cashRatio) : status === 'cancelada' || status === 'reembolsada' ? stake : 0
    if (!bet.paid) return
    const paidAt = status === 'cashout' ? Math.round(t + (tk.settlesAt - t) * (0.2 + 0.7 * cashAt)) : tk.settlesAt
    const refund = status === 'cancelada' || status === 'reembolsada'
    book.later(paidAt, () => {
      if (!refund) {
        book.push(paidAt, 'ganho', bet.paid, 'real', { label, provider: 'Betby', ref: () => bet.id })
        return
      }
      // bilhete cancelado ou reembolsado: a aposta volta e deixa de contar no apostado
      book.push(paidAt, 'estorno', stake, 'real', { label, provider: 'Betby', ref: () => `EST-${line.id}` })
      book.refund(line)
    })
  }

  /** Uma sessão de jogo a partir de t0; devolve quando terminou. */
  const session = (t0: number, first: boolean, depBase: number, stakeBase: number): number => {
    book.flush(t0)
    // sorteios fixos por sessão: o resto da história da conta não muda conforme a sessão cai ou não no período
    const u = { top: rng.next(), campaign: rng.next(), attempt: rng.next(), manual: rng.next(), sports: rng.next(), coupon: rng.next(), bonus: rng.next(), cash: rng.next(), debit: rng.next(), estorno: rng.next(), wd: rng.next(), status: rng.next(), delay: rng.next() }
    const inWindow = t0 >= WINDOW
    let t = t0
    birthdayGrants(t)
    // cupom de giros (ex.: GIROSEXTA às sextas): digitado ao entrar; conta que divide IP com outras tem a concessão cancelada
    for (const s of ctx.freeSpins) {
      if (s.c.trigger !== 'cupom' || t < s.from || t > s.to || new Date(t).getDay() !== 5 || granted(s) >= s.c.maxPerPlayer) continue
      if (grants.some((g) => g.campaignId === s.c.id && t - g.grantedAt < DAY) || !(u.coupon < 0.3)) continue
      grantFs(s, t, sharedIp ? { cancelled: true, note: 'Cancelado: cupom usado em contas ligadas' } : {})
    }
    let deposited = 0
    if (first || book.real < stakeBase * 3 || u.top < 0.25) {
      deposited = first ? depBase : rng.pick(spec.deposits)
      deposit(t, deposited, first, u.campaign, u.attempt)
      t += rng.int(20, 90) * 1000
    }
    t = useFs(t)
    if (inWindow && u.manual < 0.01) {
      book.push(t, 'credito_manual', rng.pick([10, 25, 50]), 'real', { ref: `MAN-${rng.digits(8)}` })
      t += rng.int(30, 120) * 1000
    }
    const bets: Line[] = []
    let wagered = 0
    let prizes = 0
    if (prof.sports && u.sports < 0.45) {
      const n = rng.int(1, 3)
      for (let k = 0; k < n; k++) {
        t += rng.int(30, 300) * 1000
        const want = niceStake(depBase * rng.float(0.05, 0.3, 3))
        if (t > last) break
        const stake = want <= book.real ? want : niceStake(book.real)
        if (stake < 2 || stake > book.real) break
        ticket(t, stake)
        wagered += stake
      }
    } else {
      const game = pickGame(ctx.games, rng, t)
      const n = rng.int(spec.bets[0], spec.bets[1])
      for (let k = 0; k < n; k++) {
        t += rng.int(15, 90) * 1000
        const want = niceStake(stakeBase * rng.pick([0.5, 1, 1, 1, 2]))
        const win = rng.next() < 0.3
        const mult = multiplier(rng)
        const round = rng.id('rnd_', 10)
        if (t > last) break
        const stake = want <= book.real ? want : niceStake(book.real)
        if (stake > book.real) break
        bets.push(book.push(t, 'aposta', -stake, 'real', { game, ref: round }))
        wagered += stake
        if (!win) continue
        t += rng.int(2, 8) * 1000
        const prize = cents(stake * mult)
        book.push(t, 'ganho', prize, 'real', { game, ref: round })
        prizes += prize
      }
    }
    if (inWindow && bets.length && u.estorno < 0.012) {
      // rodada não concluída pelo provedor: a aposta volta e deixa de contar no apostado
      const target = rng.pick(bets)
      t += rng.int(2, 20) * MIN
      if (t <= NOW_MS) {
        book.push(t, 'estorno', -target.amount, 'real', { game: target.game, ref: () => `EST-${target.id}` })
        book.refund(target)
        wagered += target.amount
      }
    }
    const net = prizes - wagered
    if (inWindow && net < -30 && u.cash < 0.15) {
      t += rng.int(1, 10) * MIN
      if (t <= NOW_MS) book.push(t, 'cashback', Math.max(1, cents(-net * rng.float(0.05, 0.15, 3))), 'real', { ref: rng.id('cb_', 10) })
    }
    if (inWindow && u.debit < 0.008 && book.real >= 10) {
      t += rng.int(1, 5) * MIN
      if (t <= NOW_MS) book.push(t, 'debito_manual', -Math.min(book.real, rng.pick([10, 25, 50])), 'real', { ref: `MAN-${rng.digits(8)}` })
    }
    if (u.bonus < 0.04 && t >= BONUS_START) {
      t += MIN
      if (t <= NOW_MS) book.push(t, 'bonus', rng.pick([10, 20, 50, 100]), 'bonus', { ref: rng.id('bns_', 10) })
    }
    // sobrou bem mais que o depósito típico: pede saque (o pedido é do jogador, até o último acesso)
    if (book.real >= Math.max(50, depBase * 1.5) && u.wd < spec.withdraw) {
      const req = t + rng.int(1, 5) * MIN
      const amount = Math.min(withdrawalCap, WITHDRAWAL_MAX, niceAmount(book.real * rng.float(0.5, 0.95, 3)))
      const daily = approvedAt.filter((x) => req - x < DAY).length
      if (req <= last && amount >= WITHDRAWAL_MIN && daily < WITHDRAWAL_DAILY) {
        withdraw(req, amount, u.status, u.delay, deposited > 0 && wagered < deposited / 2)
        t = req
      }
    }
    return t
  }

  // giros de boas-vindas (cadastro): concedidos ao concluir o cadastro; a maioria joga logo em seguida
  for (const s of ctx.freeSpins) {
    if (s.c.trigger !== 'cadastro' || created < s.from || created > s.to) continue
    const at = created + rng.int(1, 3) * MIN
    if (at > NOW_MS) continue
    grantFs(s, at)
    if (rng.bool(0.7)) useFs(at + MIN)
  }

  if (prof.depositor) {
    const depBase = rng.pick(spec.deposits)
    const stakeBase = niceStake(depBase * rng.float(spec.stake[0], spec.stake[1], 3))
    const rate = rng.float(spec.rate[0], spec.rate[1], 3)
    // 1º depósito: em geral logo depois do cadastro
    const span = Math.max(0, last - created)
    let t = created + Math.min(span, Math.max(10 * MIN, span * Math.pow(rng.next(), 3)))
    let first = true
    let end = t
    while (t <= last) {
      end = session(t, first, depBase, stakeBase)
      first = false
      t = end + Math.max(2 * HOUR, (-Math.log(1 - rng.next()) / rate) * DAY)
    }
    // o último acesso foi para jogar: uma sessão que termina nele
    const lastSession = last - rng.int(5, 40) * MIN
    if (!first && lastSession > end + HOUR) session(lastSession, false, depBase, stakeBase)
  } else {
    const uBonus = rng.next()
    const uAttempt = rng.next()
    // bônus de cadastro (sem depósito), como todo bônus, dos últimos 30 dias
    const at = created + rng.int(5, 60) * MIN
    if (uBonus < 0.2 && at <= NOW_MS && at >= BONUS_START) book.push(at, 'bonus', 20, 'bonus', { ref: rng.id('bns_', 10) })
    // gerou um PIX e desistiu
    if (uAttempt < 0.45) attempt(created + Math.round((last - created) * rng.next()), rng.pick(spec.deposits), rng.bool(0.7) ? 'expirado' : 'falhou')
  }

  // aniversários VIP depois da última sessão (a equipe concede mesmo sem o jogador entrar)
  birthdayGrants(NOW_MS)

  // no último acesso: um saque pedido e ainda sem decisão, ou um PIX gerado e ainda não pago
  book.flush(last)
  const age = NOW_MS - last
  const uOpen = rng.next()
  const uPix = rng.next()
  const openStatus: WithdrawalStatus | null = !prof.depositor
    ? null
    : age < 0.5 * HOUR && uOpen < 0.3
      ? 'criado'
      : age < 22 * HOUR && uOpen < 0.25
        ? 'pendente'
        : age >= 25 * HOUR && age < 60 * HOUR && uOpen < 0.12
          ? 'em_analise'
          : null
  const openAmount = Math.min(withdrawalCap, niceAmount(book.real * rng.float(0.6, 1, 3)))
  // (o pedido é o último lançamento até ali: nada da plataforma depois do último acesso ainda)
  // sem KYC: o pedido aberto fica retido na fila (só se a conta ainda não teve um saque retido antes)
  if (openStatus && openAmount >= WITHDRAWAL_MIN && openAmount <= book.real && book.lastT <= last && (verified || !kycAsked)) {
    const reference = e2e(rng)
    book.push(last, 'saque', -openAmount, 'real', { ref: reference })
    ctx.withdrawals.push(withdrawalRecord(last, last, openAmount, openStatus, reference, false))
  } else if ((age < 0.5 * HOUR ? uPix < 0.35 : age < 3 * DAY && uPix < 0.06) && last > (book.firstDepositAt ?? -Infinity) + MIN) {
    // PIX gerado no último acesso: os de agora ainda valem; os de antes venceram sem baixa
    attempt(last, rng.pick(spec.deposits), 'pendente')
  }
  book.flush(NOW_MS)
  book.coins = coinsOf(book, created, last)
  return book
}

/**
 * Moedas da conta pelas regras padrão (Campanhas › Moeda): apostas (por categoria, a cada R$ 10), depósitos,
 * login no dia e subida de nível, com o teto diário; o que foi ganho antes da validade já venceu. Aposta estornada
 * não dá moedas.
 */
function coinsOf(book: Book, created: number, last: number): number {
  const day = (t: number) => startOfDay(new Date(t)).getTime()
  const earned = new Map<number, number>()
  const add = (t: number, n: number) => {
    if (t < COIN_START || t > NOW_MS || !(n > 0)) return
    const d = day(t)
    earned.set(d, (earned.get(d) ?? 0) + n)
  }
  // login: o dia do cadastro, o do último acesso e cada dia em que apostou ou depositou (dentro da validade)
  const logins = new Set<number>()
  const login = (t: number) => {
    if (t >= COIN_START && t <= NOW_MS) logins.add(day(t))
  }
  login(created)
  login(last)
  let bet = 0
  let deposits = 0
  let level = levelFor(0)
  for (const l of book.lines) {
    if (l.type === 'aposta') {
      if (book.refunded.has(l)) continue
      const rule = COIN.bets.rates[(l.game?.category ?? 'esportes') satisfies EarnCategory]
      if (COIN.bets.enabled && rule.enabled) add(l.t, (-l.amount / EARN_BASE) * rule.amount)
      bet += -l.amount
    } else if (l.type === 'deposito') {
      if (COIN.deposit.enabled) add(l.t, (l.amount / EARN_BASE) * COIN.deposit.amount)
      deposits++
    } else continue
    login(l.t)
    const next = levelFor(xpFor(bet, deposits))
    if (next > level && COIN.levelUp.enabled) add(l.t, (next - level) * COIN.levelUp.amount)
    level = next
  }
  if (COIN.dailyLogin.enabled) for (const d of logins) earned.set(d, (earned.get(d) ?? 0) + COIN.dailyLogin.amount)
  let total = 0
  for (const n of earned.values()) total += COIN.dailyCap > 0 ? Math.min(COIN.dailyCap, Math.floor(n)) : Math.floor(n)
  return total
}

// ---------- montagem ----------

export interface DemoLedger {
  /** extrato dos últimos 90 dias, do mais novo para o mais antigo */
  transactions: Transaction[]
  /** depósitos dos últimos 90 dias, do mais novo para o mais antigo */
  deposits: Deposit[]
  /** saques dos últimos 90 dias: a fila (sem decisão) primeiro, depois os decididos */
  withdrawals: Withdrawal[]
  /** bilhetes de esporte dos últimos 90 dias, do mais novo para o mais antigo */
  sportsBets: SportsBet[]
  /** bônus recebido desde o cadastro (boas-vindas e outros bônus, giros grátis e cashback), por jogador */
  bonusReceived: Record<string, number>
  /** concessões de giros grátis (todas as campanhas), da mais antiga para a mais nova */
  freeSpinGrants: LedgerFsGrant[]
}

const OPEN: WithdrawalStatus[] = ['pendente', 'em_analise', 'criado']

/**
 * Simula a história de cada conta e preenche os totais e saldos da ficha (os jogadores chegam só com o
 * cadastro). Devolve as bases que saem do mesmo livro-razão.
 */
export function buildLedger(players: Player[], profiles: Map<string, PlayerProfile>): DemoLedger {
  const providers = seedProviders()
  const paused = new Set(providers.filter((p) => p.status === 'pausada').map((p) => p.id))
  const ipCount = new Map<string, number>()
  for (const p of players) ipCount.set(p.ip, (ipCount.get(p.ip) ?? 0) + 1)
  // jogo fora do ar ou de provedora pausada não recebe aposta
  const games = seedGames()
  const playable = games.filter((g) => g.active && !paused.has(g.providerId))
  const gameById = new Map(games.map((g) => [g.id, g]))
  // campanhas de giros grátis: concedem do início ao fim (ou à pausa), nunca depois de agora
  const freeSpins: FsSpec[] = seedFsCampaigns().map((c) => {
    const ends = [NOW_MS, c.endAt ? Date.parse(c.endAt) : Infinity, FS_DEMO_PAUSED_AT[c.id] ? Date.parse(FS_DEMO_PAUSED_AT[c.id]) : Infinity]
    return { c, game: gameById.get(c.gameId) ?? null, from: Date.parse(c.startAt), to: Math.min(...ends) }
  })
  const ctx: Ctx = {
    games: gamePool(playable),
    providerName: new Map(providers.map((p) => [p.id, p.name])),
    sharedIps: new Set([...ipCount].filter(([, n]) => n > 1).map(([ip]) => ip)),
    freeSpins,
    lines: [],
    deposits: [],
    withdrawals: [],
    tickets: [],
    fsGrants: [],
  }
  const bonusReceived: Record<string, number> = {}

  for (const p of players) {
    const prof = profiles.get(p.id)!
    const b = simulate(ctx, p, prof)
    p.totalDeposited = cents(b.deposited)
    p.depositsCount = b.depositsCount
    p.totalWithdrawn = cents(b.withdrawn)
    p.totalBet = cents(b.bet)
    p.betsCount = b.betsCount
    p.totalWon = cents(b.won)
    p.biggestWin = cents(b.biggestWin)
    p.balanceReal = b.real
    p.balanceBonus = b.bonus
    p.firstDepositAt = b.firstDepositAt === null ? null : iso(new Date(b.firstDepositAt))
    p.xp = xpFor(p.totalBet, p.depositsCount)
    p.level = levelFor(p.xp)
    p.coins = b.coins
    if (p.totalDeposited > VIP_DEPOSITED && !p.tags.includes('VIP')) p.tags.unshift('VIP')
    bonusReceived[p.id] = cents(b.bonusReceived)
  }

  // ids na ordem do tempo (como a plataforma numera)
  const deposits = ctx.deposits.filter((d) => Date.parse(d.createdAt) >= WINDOW).sort((a, b) => byText(a.createdAt, b.createdAt))
  deposits.forEach((d, i) => (d.id = `DP${String(512000 + i * 11)}`))
  const withdrawals = ctx.withdrawals.filter((w) => Date.parse(w.createdAt) >= WINDOW)
  const queue = withdrawals.filter((w) => OPEN.includes(w.status)).sort((a, b) => byText(b.createdAt, a.createdAt))
  const decided = withdrawals.filter((w) => !OPEN.includes(w.status)).sort((a, b) => byText(b.createdAt, a.createdAt))
  const orderedWithdrawals = [...queue, ...decided]
  orderedWithdrawals.forEach((w, i) => (w.id = `SQ${String(73000 + i * 17)}`))
  const tickets = [...ctx.tickets].sort((a, b) => byText(a.at, b.at))
  tickets.forEach((b, i) => (b.id = `SB${String(330100 + i * 9)}`))
  const freeSpinGrants = [...ctx.fsGrants].sort((a, b) => a.grantedAt - b.grantedAt)
  freeSpinGrants.forEach((g, i) => (g.id = `FS${String(10421 + i).padStart(5, '0')}`))

  const lines = ctx.lines.filter((l) => l.t >= WINDOW).sort((a, b) => a.t - b.t)
  lines.forEach((l, n) => (l.id = `TX${String(880000 + n * 13)}`))
  const byId = new Map(players.map((p) => [p.id, p]))
  const transactions: Transaction[] = lines.map((l) => {
    const p = byId.get(l.playerId)!
    return {
      id: l.id,
      at: iso(new Date(l.t)),
      playerId: p.id,
      playerName: p.name,
      playerEmail: p.email,
      type: l.type,
      amount: l.amount,
      wallet: l.wallet,
      balanceBefore: l.before,
      balanceAfter: l.after,
      gameId: l.game?.id ?? null,
      gameName: l.game?.name ?? l.label,
      providerName: l.provider,
      reference: typeof l.ref === 'function' ? l.ref() : l.ref,
    }
  })

  return {
    transactions: transactions.reverse(),
    deposits: deposits.reverse(),
    withdrawals: orderedWithdrawals,
    sportsBets: tickets.filter((b) => Date.parse(b.at) >= WINDOW).reverse(),
    bonusReceived,
    freeSpinGrants,
  }
}
