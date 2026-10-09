// Regras de saque e decisão (aprovar/recusar) com teto por cargo.
// Na recriação com servidor, estas mesmas validações devem rodar no back-end.
import { seedWithdrawals, type Withdrawal } from '@/data/finance'
import { brl } from '@/lib/format'
import { dbGet, dbSet } from '@/lib/store'
import { audit } from './session'
import type { Role } from './roles'
import { checkApprovalCeiling, type DecisionResult } from '@shared/withdrawals'
import { emitWebhook } from './webhooks'

export const WITHDRAWAL_KEYS = {
  list: 'operacao.saques',
  rules: 'operacao.saques.regras',
} as const

export {
  DEFAULT_WITHDRAWAL_RULES,
  checkApprovalCeiling,
  simulateWithdrawal,
  validateWithdrawalRules,
  type DecisionResult,
  type RolloverBets,
  type RolloverMode,
  type SimulationCheck,
  type SimulationInput,
  type WithdrawalRules,
} from '@shared/withdrawals'

function patch(id: string, p: Partial<Withdrawal>) {
  dbSet<Withdrawal[]>(
    WITHDRAWAL_KEYS.list,
    (prev) => prev.map((w) => (w.id === id ? { ...w, ...p, updatedAt: new Date().toISOString() } : w)),
    seedWithdrawals,
  )
}

export function approveWithdrawal(w: Withdrawal, role: Role, actorName: string): DecisionResult {
  if (!['pendente', 'em_analise', 'criado'].includes(w.status)) {
    return { ok: false, message: 'Este saque já foi decidido.' }
  }
  const check = checkApprovalCeiling(role, w.amount)
  if (!check.ok) return check
  patch(w.id, { status: 'aprovado', decidedBy: actorName, decisionNote: null })
  audit('aprovar', `Saque #${w.id}`, `Saque de ${brl(w.amount)} de ${w.playerName} aprovado`)
  emitWebhook('saque.pago', { id: w.id, amount: w.amount, playerId: w.playerId })
  return { ok: true, message: `Saque de ${brl(w.amount)} aprovado. O PIX foi enviado.` }
}

export function rejectWithdrawal(w: Withdrawal, role: Role, actorName: string, reason: string): DecisionResult {
  if (!['pendente', 'em_analise', 'criado'].includes(w.status)) {
    return { ok: false, message: 'Este saque já foi decidido.' }
  }
  if (!role.permissions.includes('saques.aprovar') || role.approvalCeiling === 0) {
    return { ok: false, message: `O cargo ${role.name} não decide saques.` }
  }
  patch(w.id, { status: 'recusado', decidedBy: actorName, decisionNote: reason })
  audit('recusar', `Saque #${w.id}`, `Saque de ${brl(w.amount)} recusado: ${reason}`)
  emitWebhook('saque.rejeitado', { id: w.id, amount: w.amount, reason })
  return { ok: true, message: `Saque recusado. ${brl(w.amount)} voltou para o saldo do jogador.` }
}

export function getWithdrawals() {
  return dbGet<Withdrawal[]>(WITHDRAWAL_KEYS.list, seedWithdrawals)
}
