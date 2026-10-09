// Regras de saque e decisão (aprovar/recusar) com teto por cargo.
// Modo demonstração: a decisão roda aqui e grava no navegador.
// Modo API: a decisão é do servidor (POST /api/withdrawals/:id/approve|reject);
// o painel só confere o teto antes, para avisar cedo.
import type { RevealPixResponse, WithdrawalDecisionResponse } from '@shared/api'
import { seedWithdrawals, type Withdrawal } from '@/data/finance'
import { ApiError, api, isApiMode } from '@/lib/api'
import { brl } from '@/lib/format'
import { dbGet, dbSet, patchCache, refreshKey } from '@/lib/store'
import { audit } from './session'
import type { Role } from './roles'
import { checkApprovalCeiling, type DecisionResult } from '@shared/withdrawals'
import { WEBHOOK_KEYS, emitWebhook } from './webhooks'

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

function errorMessage(e: unknown) {
  if (e instanceof ApiError) return e.message
  return 'Erro inesperado ao falar com o servidor. Tente de novo.'
}

/** Modo API: envia a decisão ao servidor e troca o saque na lista pelo que ele devolveu. */
async function decideOnServer(w: Withdrawal, action: 'approve' | 'reject', body?: { reason: string }): Promise<DecisionResult> {
  try {
    const res = await api<WithdrawalDecisionResponse>('POST', `/api/withdrawals/${encodeURIComponent(w.id)}/${action}`, body)
    const updated = res.withdrawal as unknown as Withdrawal
    patchCache<Withdrawal[]>(WITHDRAWAL_KEYS.list, (prev) => prev.map((x) => (x.id === updated.id ? updated : x)), seedWithdrawals)
    // o servidor já enfileirou o webhook; a lista de execuções é recarregada para aparecer nas telas
    refreshKey(WEBHOOK_KEYS.executions).catch(() => {})
    return { ok: true, message: res.message }
  } catch (e) {
    // já decidido por outra pessoa: recarrega a fila para mostrar o estado atual
    if (e instanceof ApiError && e.code === 'ja_decidido') refreshKey(WITHDRAWAL_KEYS.list).catch(() => {})
    return { ok: false, message: errorMessage(e) }
  }
}

export async function approveWithdrawal(w: Withdrawal, role: Role, actorName: string): Promise<DecisionResult> {
  if (!['pendente', 'em_analise', 'criado'].includes(w.status)) {
    return { ok: false, message: 'Este saque já foi decidido.' }
  }
  const check = checkApprovalCeiling(role, w.amount)
  if (!check.ok) return check
  if (isApiMode()) return decideOnServer(w, 'approve')
  patch(w.id, { status: 'aprovado', decidedBy: actorName, decisionNote: null })
  audit('aprovar', `Saque #${w.id}`, `Saque de ${brl(w.amount)} de ${w.playerName} aprovado`)
  emitWebhook('saque.pago', { id: w.id, amount: w.amount, playerId: w.playerId })
  return { ok: true, message: `Saque de ${brl(w.amount)} aprovado. O PIX foi enviado.` }
}

export async function rejectWithdrawal(w: Withdrawal, role: Role, actorName: string, reason: string): Promise<DecisionResult> {
  if (!['pendente', 'em_analise', 'criado'].includes(w.status)) {
    return { ok: false, message: 'Este saque já foi decidido.' }
  }
  if (!role.permissions.includes('saques.aprovar') || role.approvalCeiling === 0) {
    return { ok: false, message: `O cargo ${role.name} não decide saques.` }
  }
  if (isApiMode()) return decideOnServer(w, 'reject', { reason })
  patch(w.id, { status: 'recusado', decidedBy: actorName, decisionNote: reason })
  audit('recusar', `Saque #${w.id}`, `Saque de ${brl(w.amount)} recusado: ${reason}`)
  emitWebhook('saque.rejeitado', { id: w.id, amount: w.amount, reason })
  return { ok: true, message: `Saque recusado. ${brl(w.amount)} voltou para o saldo do jogador.` }
}

/**
 * Chave PIX completa para conferência (registra "revelar" na auditoria).
 * Modo API: o servidor confere a permissão, audita e devolve a chave (a lista só tem a chave mascarada).
 * Lança ApiError quando o servidor recusa.
 */
export async function revealPixKey(w: Withdrawal): Promise<string> {
  if (isApiMode()) {
    const res = await api<RevealPixResponse>('POST', `/api/withdrawals/${encodeURIComponent(w.id)}/reveal-pix`)
    return res.pixKey
  }
  audit('revelar', `Saque #${w.id}`, `Chave PIX completa exibida para conferência`)
  return w.pixKey
}

export function getWithdrawals() {
  return dbGet<Withdrawal[]>(WITHDRAWAL_KEYS.list, seedWithdrawals)
}
