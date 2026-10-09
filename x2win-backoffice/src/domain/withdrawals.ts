// Regras de saque e decisão (aprovar/recusar) com teto por cargo.
// Na recriação com servidor, estas mesmas validações devem rodar no back-end.
import { seedWithdrawals, type Withdrawal } from '@/data/finance'
import { brl } from '@/lib/format'
import { dbGet, dbSet } from '@/lib/store'
import { audit } from './session'
import type { Role } from './roles'
import { emitWebhook } from './webhooks'

export const WITHDRAWAL_KEYS = {
  list: 'operacao.saques',
  rules: 'operacao.saques.regras',
} as const

export type RolloverMode = 'acumulado' | 'por_deposito'
export type RolloverBets = 'todas' | 'saldo_real' | 'bonus'

export interface WithdrawalRules {
  min: number
  maxPerRequest: number
  /** % do valor depositado que precisa ser apostado (0 = desligado) */
  rolloverPct: number
  fee: number
  dailyLimit: number
  /** saques até este valor são aprovados sem análise (0 = desligado) */
  autoApproveMax: number
  rolloverMode: RolloverMode
  rolloverBets: RolloverBets
}

export const DEFAULT_WITHDRAWAL_RULES: WithdrawalRules = {
  min: 20,
  maxPerRequest: 5000,
  rolloverPct: 0,
  fee: 0,
  dailyLimit: 2,
  autoApproveMax: 0,
  rolloverMode: 'acumulado',
  rolloverBets: 'todas',
}

export interface DecisionResult {
  ok: boolean
  message: string
}

/** O cargo pode aprovar este valor? */
export function checkApprovalCeiling(role: Role, amount: number): DecisionResult {
  if (!role.permissions.includes('saques.aprovar') || role.approvalCeiling === 0) {
    return { ok: false, message: `O cargo ${role.name} não aprova saques.` }
  }
  if (role.approvalCeiling !== null && amount > role.approvalCeiling) {
    return {
      ok: false,
      message: `Valor acima do teto do cargo ${role.name} (${brl(role.approvalCeiling)}). Peça a um Administrador ou Superadmin.`,
    }
  }
  return { ok: true, message: '' }
}

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

export interface SimulationInput {
  amount: number
  withdrawalsToday: number
  deposited: number
  wagered: number
}

export interface SimulationCheck {
  label: string
  ok: boolean
  detail: string
}

/** Simula um pedido de saque contra as regras atuais. */
export function simulateWithdrawal(rules: WithdrawalRules, input: SimulationInput) {
  const required = (input.deposited * rules.rolloverPct) / 100
  const checks: SimulationCheck[] = [
    { label: 'Valor mínimo', ok: input.amount >= rules.min, detail: `mínimo ${brl(rules.min)}` },
    { label: 'Valor máximo por solicitação', ok: input.amount <= rules.maxPerRequest, detail: `máximo ${brl(rules.maxPerRequest)}` },
    {
      label: 'Limite diário',
      ok: input.withdrawalsToday < rules.dailyLimit,
      detail: `${input.withdrawalsToday} de ${rules.dailyLimit} saques hoje`,
    },
    {
      label: 'Rollover',
      ok: rules.rolloverPct === 0 || input.wagered >= required,
      detail: rules.rolloverPct === 0 ? 'desligado' : `apostou ${brl(input.wagered)} de ${brl(required)}`,
    },
  ]
  const allowed = checks.every((c) => c.ok)
  const net = Math.max(0, input.amount - rules.fee)
  const auto = allowed && rules.autoApproveMax > 0 && input.amount <= rules.autoApproveMax
  return { checks, allowed, net, auto }
}

export function getWithdrawals() {
  return dbGet<Withdrawal[]>(WITHDRAWAL_KEYS.list, seedWithdrawals)
}
