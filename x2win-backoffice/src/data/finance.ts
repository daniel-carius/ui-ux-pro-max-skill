// Movimentação financeira: transações, depósitos e saques.
import { createRng } from '@/lib/random'
import { seedGames, seedProviders } from './catalog'
import { DAY, HOUR, MIN, NOW, iso } from './now'
import { seedPlayers } from './players'

export type TransactionType =
  | 'deposito'
  | 'saque'
  | 'aposta'
  | 'ganho'
  | 'bonus'
  | 'free_spin'
  | 'cashback'
  | 'credito_manual'
  | 'debito_manual'
  | 'estorno'

export const TRANSACTION_TYPE_LABEL: Record<TransactionType, string> = {
  deposito: 'Depósito',
  saque: 'Saque',
  aposta: 'Aposta',
  ganho: 'Ganho',
  bonus: 'Bônus',
  free_spin: 'Free spin',
  cashback: 'Cashback',
  credito_manual: 'Creditação',
  debito_manual: 'Subtração',
  estorno: 'Estorno',
}

export interface Transaction {
  id: string
  at: string
  playerId: string
  playerName: string
  playerEmail: string
  type: TransactionType
  /** positivo entra na carteira, negativo sai */
  amount: number
  wallet: 'real' | 'bonus'
  balanceBefore: number
  balanceAfter: number
  gameId: string | null
  gameName: string | null
  providerName: string | null
  reference: string
}

export type DepositStatus = 'pago' | 'pendente' | 'expirado' | 'falhou' | 'estornado'

export const DEPOSIT_STATUS_LABEL: Record<DepositStatus, string> = {
  pago: 'Pago',
  pendente: 'Aguardando PIX',
  expirado: 'Expirado',
  falhou: 'Falhou',
  estornado: 'Estornado',
}

export interface Deposit {
  id: string
  playerId: string
  playerName: string
  playerEmail: string
  amount: number
  status: DepositStatus
  gateway: string
  reference: string
  isFirst: boolean
  bonusCampaign: string | null
  createdAt: string
  updatedAt: string
}

export type WithdrawalStatus = 'criado' | 'pendente' | 'em_analise' | 'aprovado' | 'recusado' | 'expirado' | 'cancelado'

export const WITHDRAWAL_STATUS_LABEL: Record<WithdrawalStatus, string> = {
  criado: 'Criado',
  pendente: 'Pendente',
  em_analise: 'Em análise',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
  expirado: 'Expirado',
  cancelado: 'Cancelado',
}

export type RiskLevel = 'baixo' | 'medio' | 'alto'

export interface Withdrawal {
  id: string
  playerId: string
  playerName: string
  playerEmail: string
  amount: number
  fee: number
  status: WithdrawalStatus
  risk: { level: RiskLevel; score: number; reasons: string[] }
  pixKeyType: 'CPF' | 'E-mail' | 'Celular' | 'Aleatória'
  pixKey: string
  reference: string
  createdAt: string
  updatedAt: string
  decidedBy: string | null
  decisionNote: string | null
}

const GATEWAYS = ['PagFlex', 'PixNow', 'BRPay']

function e2e(rng: ReturnType<typeof createRng>) {
  return `E${rng.digits(8)}${rng.id('', 6).toUpperCase()}${rng.digits(10)}`
}

let _tx: Transaction[] | null = null
export function seedTransactions(): Transaction[] {
  if (_tx) return _tx
  const rng = createRng(4401)
  const players = seedPlayers().filter((p) => p.depositsCount > 0)
  const games = seedGames()
  const providers = new Map(seedProviders().map((p) => [p.id, p.name]))
  const list: Transaction[] = []
  const balances = new Map<string, number>()
  let t = NOW.getTime() - 30 * DAY
  let n = 0
  while (t < NOW.getTime() && n < 1400) {
    t += rng.int(1, 40) * MIN
    const p = rng.pick(players)
    const type = rng.weighted([
      ['aposta', 46],
      ['ganho', 26],
      ['deposito', 10],
      ['saque', 4],
      ['bonus', 4],
      ['free_spin', 3],
      ['cashback', 2],
      ['credito_manual', 1],
      ['debito_manual', 1],
      ['estorno', 1],
    ] as const)
    const before = balances.get(p.id) ?? rng.money(0, 600)
    let amount = 0
    switch (type) {
      case 'deposito':
        amount = rng.pick([20, 30, 50, 50, 100, 100, 150, 200, 300, 500, 1000])
        break
      case 'saque':
        amount = -Math.min(Math.max(20, before), rng.money(20, 2000))
        break
      case 'aposta':
        amount = -rng.pick([0.4, 0.8, 1, 2, 2.5, 4, 5, 10, 20, 50])
        break
      case 'ganho':
        amount = rng.money(0.5, 900)
        break
      case 'bonus':
        amount = rng.pick([10, 20, 50, 100])
        break
      case 'free_spin':
        amount = rng.money(0.4, 60)
        break
      case 'cashback':
        amount = rng.money(2, 120)
        break
      case 'credito_manual':
        amount = rng.pick([10, 25, 50])
        break
      case 'debito_manual':
        amount = -rng.pick([10, 25, 50])
        break
      case 'estorno':
        amount = rng.money(1, 50)
        break
    }
    amount = Math.round(amount * 100) / 100
    const after = Math.max(0, Math.round((before + amount) * 100) / 100)
    balances.set(p.id, after)
    const isGame = type === 'aposta' || type === 'ganho' || type === 'free_spin'
    const g = isGame ? rng.pick(games) : null
    list.push({
      id: `TX${String(880000 + n * 13)}`,
      at: iso(new Date(t)),
      playerId: p.id,
      playerName: p.name,
      playerEmail: p.email,
      type,
      amount,
      wallet: type === 'bonus' || type === 'free_spin' ? 'bonus' : 'real',
      balanceBefore: before,
      balanceAfter: after,
      gameId: g?.id ?? null,
      gameName: g?.name ?? null,
      providerName: g ? providers.get(g.providerId) ?? null : null,
      reference: type === 'deposito' || type === 'saque' ? e2e(rng) : rng.id('rnd_', 10),
    })
    n++
  }
  _tx = list.reverse()
  return _tx
}

let _deposits: Deposit[] | null = null
export function seedDeposits(): Deposit[] {
  if (_deposits) return _deposits
  const rng = createRng(5150)
  const players = seedPlayers()
  const list: Deposit[] = []
  for (let i = 0; i < 260; i++) {
    const p = rng.pick(players)
    const created = new Date(NOW.getTime() - Math.pow(rng.next(), 1.4) * 30 * DAY)
    const status = i < 4 ? 'pendente' : rng.weighted([
      ['pago', 78],
      ['pendente', 3],
      ['expirado', 14],
      ['falhou', 4],
      ['estornado', 1],
    ] as const)
    list.push({
      id: `DP${String(512000 + i * 11)}`,
      playerId: p.id,
      playerName: p.name,
      playerEmail: p.email,
      amount: rng.pick([10, 20, 30, 50, 50, 50, 100, 100, 150, 200, 250, 300, 500, 1000, 2000]),
      status,
      gateway: rng.weighted([
        [GATEWAYS[0], 6],
        [GATEWAYS[1], 3],
        [GATEWAYS[2], 1],
      ] as const),
      reference: e2e(rng),
      isFirst: rng.bool(0.18),
      bonusCampaign: rng.bool(0.15) ? 'Deposite 50 e ganhe o dobro' : null,
      createdAt: iso(created),
      updatedAt: iso(new Date(created.getTime() + rng.int(1, 30) * MIN)),
    })
  }
  _deposits = list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return _deposits
}

let _withdrawals: Withdrawal[] | null = null
export function seedWithdrawals(): Withdrawal[] {
  if (_withdrawals) return _withdrawals
  const rng = createRng(6262)
  const players = seedPlayers().filter((p) => p.depositsCount > 0)
  const list: Withdrawal[] = []
  for (let i = 0; i < 96; i++) {
    const p = rng.pick(players)
    // os primeiros ficam na fila; alguns há mais de 24 h
    const status: WithdrawalStatus =
      i < 7
        ? 'pendente'
        : i < 10
          ? 'em_analise'
          : i < 12
            ? 'criado'
            : rng.weighted([
                ['aprovado', 70],
                ['recusado', 9],
                ['expirado', 6],
                ['cancelado', 8],
                ['pendente', 2],
              ] as const)
    const hoursAgo = i < 7 ? rng.float(0.2, 20) : i < 10 ? rng.float(25, 60) : i < 12 ? rng.float(0.05, 0.5) : rng.float(2, 30 * 24)
    const created = new Date(NOW.getTime() - hoursAgo * HOUR)
    const amount = rng.weighted([
      [rng.pick([20, 50, 80, 100, 150, 200]), 50],
      [rng.pick([300, 450, 500, 800, 1000, 1200]), 30],
      [rng.pick([1500, 2000, 2500, 3500, 4800]), 15],
      [rng.pick([5000, 4990, 4200]), 5],
    ] as const)
    const reasons: string[] = []
    let score = rng.int(2, 35)
    if (amount >= 2000) {
      score += 25
      reasons.push('Valor alto para o histórico do jogador')
    }
    if (p.kyc !== 'verificado') {
      score += 18
      reasons.push('KYC não verificado')
    }
    if (rng.bool(0.15)) {
      score += 22
      reasons.push('IP compartilhado com outras contas')
    }
    if (rng.bool(0.12)) {
      score += 15
      reasons.push('Saque logo após depósito com pouca aposta')
    }
    score = Math.min(99, score)
    const level: RiskLevel = score >= 60 ? 'alto' : score >= 35 ? 'medio' : 'baixo'
    const pixKeyType = rng.pick(['CPF', 'E-mail', 'Celular', 'Aleatória'] as const)
    const pixKey =
      pixKeyType === 'CPF' ? p.cpf : pixKeyType === 'E-mail' ? p.email : pixKeyType === 'Celular' ? p.phone : rng.id('', 32)
    const decided = ['aprovado', 'recusado'].includes(status)
    list.push({
      id: `SQ${String(73000 + i * 17)}`,
      playerId: p.id,
      playerName: p.name,
      playerEmail: p.email,
      amount,
      fee: 0,
      status,
      risk: { level, score, reasons },
      pixKeyType,
      pixKey,
      reference: e2e(rng),
      createdAt: iso(created),
      updatedAt: iso(new Date(created.getTime() + (decided ? rng.int(5, 600) : 0) * MIN)),
      decidedBy: decided ? rng.pick(['Daniel Carius', 'Rafael Lima', 'Beatriz Souza']) : null,
      decisionNote: status === 'recusado' ? rng.pick(['Rollover não cumprido', 'Conta duplicada', 'Dados do PIX divergentes']) : null,
    })
  }
  _withdrawals = list
  return _withdrawals
}
