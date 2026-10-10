// Movimentação financeira: transações, depósitos e saques. Os três saem do livro-razão dos jogadores
// (./ledger): a ficha, o extrato, Depósitos e Saques contam a mesma história.
import { demoRecords } from './demo'
import { demoLedger } from './players'

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
  /** id de quem decidiu (modo API; ausente nos dados antigos da demonstração) */
  decidedById?: string | null
  /** e-mail atual de quem decidiu: separa pessoas com o mesmo nome */
  decidedByEmail?: string | null
  decisionNote: string | null
}

/** Extrato dos últimos 90 dias (do mais novo para o mais antigo), do livro-razão dos jogadores (./ledger). */
export function seedTransactions(): Transaction[] {
  return demoLedger().transactions
}

/** Depósitos dos últimos 90 dias: o PIX pago tem a mesma referência da linha do extrato. */
export function seedDeposits(): Deposit[] {
  return demoLedger().deposits
}

/** Saques dos últimos 90 dias: a fila primeiro; o pedido reserva o valor (linha "Saque" no extrato). */
export function seedWithdrawals(): Withdrawal[] {
  return demoLedger().withdrawals
}

// modo API: registros vêm só do servidor (sem nada gravado, a tela fica vazia)
demoRecords(seedTransactions)
demoRecords(seedDeposits)
demoRecords(seedWithdrawals)
