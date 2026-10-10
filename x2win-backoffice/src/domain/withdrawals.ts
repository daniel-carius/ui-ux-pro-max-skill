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
import { approvalMessage, checkApprovalCeiling, type DecisionResult } from '@shared/withdrawals'
import { WEBHOOK_KEYS, emitWebhook } from './webhooks'

export const WITHDRAWAL_KEYS = {
  list: 'operacao.saques',
  rules: 'operacao.saques.regras',
} as const

export {
  DEFAULT_WITHDRAWAL_RULES,
  canDecideWithdrawals,
  checkApprovalCeiling,
  checkAutoApproveCeiling,
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

/** Quem decide (vai para decidedBy/decidedById/decidedByEmail no modo demonstração). */
export interface DecisionActor {
  id: string
  name: string
  email: string
}

/**
 * Resultado da decisão com o código do servidor, para a tela explicar o próximo passo:
 *  - 409 ja_decidido: outra pessoa decidiu antes (a fila é recarregada);
 *  - 409 jogador_bloqueado: jogador banido pelo anti-fraude (details.reason) — recusar devolve o valor;
 *  - 409 fora_das_regras: acima do máximo por saque ou limite diário atingido (details.rule maxPerRequest | dailyLimit);
 *  - 403 segregacao_funcoes: quem lançou crédito manual ou estorno para o jogador não aprova; outra pessoa aprova;
 *  - 403 teto_excedido: valor acima do teto do cargo.
 * Só versao_desatualizada é conflito de versão (a fila é recarregada).
 */
export interface DecisionOutcome extends DecisionResult {
  code?: string
  details?: unknown
}

/** Regra de saque que barrou a aprovação (409 fora_das_regras). */
export function outOfRulesKind(details: unknown): 'maxPerRequest' | 'dailyLimit' | null {
  const rule = (details as { rule?: unknown } | undefined)?.rule
  return rule === 'maxPerRequest' || rule === 'dailyLimit' ? rule : null
}

/** Modo API: envia a decisão ao servidor e troca o saque na lista pelo que ele devolveu. */
async function decideOnServer(w: Withdrawal, action: 'approve' | 'reject', body?: { reason: string }): Promise<DecisionOutcome> {
  try {
    const res = await api<WithdrawalDecisionResponse>('POST', `/api/withdrawals/${encodeURIComponent(w.id)}/${action}`, body)
    const updated = res.withdrawal as unknown as Withdrawal
    patchCache<Withdrawal[]>(WITHDRAWAL_KEYS.list, (prev) => prev.map((x) => (x.id === updated.id ? updated : x)), seedWithdrawals)
    // o servidor já enfileirou o webhook; a lista de execuções é recarregada para aparecer nas telas
    refreshKey(WEBHOOK_KEYS.executions).catch(() => {})
    return { ok: true, message: res.message }
  } catch (e) {
    const err = e instanceof ApiError ? e : null
    // já decidido por outra pessoa, ou gravações cruzadas: recarrega a fila para mostrar o estado atual.
    // jogador_bloqueado e fora_das_regras também são 409, mas não são conflito: o saque continua aberto.
    if (err && (err.code === 'ja_decidido' || err.code === 'versao_desatualizada')) refreshKey(WITHDRAWAL_KEYS.list).catch(() => {})
    return { ok: false, message: errorMessage(e), code: err?.code, details: err?.details }
  }
}

export async function approveWithdrawal(w: Withdrawal, role: Role, actor: DecisionActor): Promise<DecisionOutcome> {
  if (!['pendente', 'em_analise', 'criado'].includes(w.status)) {
    return { ok: false, message: 'Este saque já foi decidido.' }
  }
  const check = checkApprovalCeiling(role, w.amount)
  if (!check.ok) return check
  if (isApiMode()) return decideOnServer(w, 'approve')
  patch(w.id, { status: 'aprovado', decidedBy: actor.name, decidedById: actor.id, decidedByEmail: actor.email, decisionNote: null })
  audit('aprovar', `Saque #${w.id}`, `Saque de ${brl(w.amount)} de ${w.playerName} aprovado`)
  // saque.pago é um aviso aos sistemas que pagam: a mensagem diz quantos avisos saíram (mesmo texto do servidor)
  const queued = emitWebhook('saque.pago', { id: w.id, amount: w.amount, playerId: w.playerId })
  return { ok: true, message: approvalMessage(w.amount, queued) }
}

export async function rejectWithdrawal(w: Withdrawal, role: Role, actor: DecisionActor, reason: string): Promise<DecisionOutcome> {
  if (!['pendente', 'em_analise', 'criado'].includes(w.status)) {
    return { ok: false, message: 'Este saque já foi decidido.' }
  }
  if (!role.permissions.includes('saques.aprovar') || role.approvalCeiling === 0) {
    return { ok: false, message: `O cargo ${role.name} não decide saques.` }
  }
  if (isApiMode()) return decideOnServer(w, 'reject', { reason })
  patch(w.id, { status: 'recusado', decidedBy: actor.name, decidedById: actor.id, decidedByEmail: actor.email, decisionNote: reason })
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
