// Regras de saque e decisão (aprovar/recusar) com teto por cargo.
// Modo demonstração: a decisão roda aqui e grava no navegador.
// Modo API: a decisão é do servidor (POST /api/withdrawals/:id/approve|reject);
// o painel só confere o teto antes, para avisar cedo.
import type { RevealPixResponse, WithdrawalDecisionResponse } from '@shared/api'
import { seedTransactions, seedWithdrawals, type Transaction, type Withdrawal } from '@/data/finance'
import { seedPlayers, type Player } from '@/data/players'
import { SEGURANCA_KEYS, seedBlocks, type Block } from '@/data/seguranca'
import { ApiError, api, isApiMode } from '@/lib/api'
import { brl } from '@/lib/format'
import { dbGet, dbSet, patchCache, refreshKey } from '@/lib/store'
import { audit } from './session'
import type { Role } from './roles'
import { GERAL_KEYS, type StatusEvent } from './geral'
import {
  DEFAULT_WITHDRAWAL_RULES,
  approvalMessage,
  checkApprovalCeiling,
  outOfRulesProblem,
  payoutHoldMessage,
  rejectionMessage,
  SEGREGATION_MESSAGE,
  SEGREGATION_WINDOW_MS,
  type DecisionResult,
  type WithdrawalRules,
} from '@shared/withdrawals'
import { WEBHOOK_KEYS, emitWebhook, isWebhookTemplateOff } from './webhooks'

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

/**
 * Demonstração: conta bloqueada ou de rede banida (mesma regra e texto do servidor, payoutHold), com os dados do
 * navegador. Modo API: null (a lista de jogadores não é lida pela tela de saques; o servidor decide e explica).
 */
export function knownPayoutHold(playerId: string): string | null {
  if (isApiMode()) return null
  const player = dbGet<Player[]>('geral.jogadores', seedPlayers).find((p) => p.id === playerId)
  const net = dbGet<Block[]>(SEGURANCA_KEYS.blocks, seedBlocks).find((b) => b.kind === 'rede' && b.accounts.includes(playerId))
  if (net) return payoutHoldMessage({ network: net.value, blocked: true })
  if (player?.status !== 'bloqueado') return null
  const lastBlock = dbGet<StatusEvent[]>(GERAL_KEYS.statusHistory, [])
    .filter((h) => h.playerId === playerId && h.action === 'bloquear')
    .sort((a, b) => b.at.localeCompare(a.at))[0]
  return payoutHoldMessage({ blocked: true, blockReason: lastBlock?.reason ?? null })
}

/**
 * Demonstração: as conferências que o servidor faz na aprovação (withdrawals/routes.ts, assertPayable), na mesma
 * ordem e com o mesmo texto. Antes a demonstração só conferia o teto do cargo e aprovava saque de conta bloqueada.
 */
function demoApprovalProblem(w: Withdrawal, actor: DecisionActor, now = Date.now()): DecisionOutcome | null {
  const hold = knownPayoutHold(w.playerId)
  if (hold) return { ok: false, code: 'jogador_bloqueado', message: `Aprovação bloqueada: ${hold}`, details: { reason: hold } }
  const rules = { ...DEFAULT_WITHDRAWAL_RULES, ...dbGet<Partial<WithdrawalRules>>(WITHDRAWAL_KEYS.rules, DEFAULT_WITHDRAWAL_RULES) }
  const approved24h = dbGet<Withdrawal[]>(WITHDRAWAL_KEYS.list, seedWithdrawals).filter(
    (x) => x.playerId === w.playerId && x.status === 'aprovado' && now - new Date(x.updatedAt).getTime() < 86_400_000,
  ).length
  const rule = outOfRulesProblem(w.amount, rules, 0) ?? outOfRulesProblem(w.amount, rules, approved24h)
  if (rule) return { ok: false, code: 'fora_das_regras', message: rule.message, details: rule.details }
  type ManualTx = Transaction & { by?: string; byId?: string }
  const credited = dbGet<ManualTx[]>('geral.transacoes', seedTransactions).some(
    (tx) =>
      tx.playerId === w.playerId &&
      (tx.type === 'credito_manual' || tx.type === 'estorno') &&
      now - new Date(tx.at).getTime() < SEGREGATION_WINDOW_MS &&
      (tx.byId ? tx.byId === actor.id : tx.by === actor.name),
  )
  if (credited) return { ok: false, code: 'segregacao_funcoes', message: SEGREGATION_MESSAGE }
  return null
}

export async function approveWithdrawal(w: Withdrawal, role: Role, actor: DecisionActor): Promise<DecisionOutcome> {
  if (!['pendente', 'em_analise', 'criado'].includes(w.status)) {
    return { ok: false, message: 'Este saque já foi decidido.' }
  }
  const check = checkApprovalCeiling(role, w.amount)
  if (!check.ok) return check
  if (isApiMode()) return decideOnServer(w, 'approve')
  const problem = demoApprovalProblem(w, actor)
  if (problem) return problem
  patch(w.id, { status: 'aprovado', decidedBy: actor.name, decidedById: actor.id, decidedByEmail: actor.email, decisionNote: null })
  audit('aprovar', `Saque #${w.id}`, `Saque de ${brl(w.amount)} de ${w.playerName} aprovado`)
  // saque.pago é um aviso aos sistemas que pagam: a mensagem diz quantos avisos saíram (mesmo texto do servidor)
  const queued = emitWebhook('saque.pago', { id: w.id, amount: w.amount, playerId: w.playerId })
  return { ok: true, message: approvalMessage(w.amount, queued, isWebhookTemplateOff('saque.pago')) }
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
  const queued = emitWebhook('saque.rejeitado', { id: w.id, amount: w.amount, reason })
  return { ok: true, message: rejectionMessage(w.amount, queued, isWebhookTemplateOff('saque.rejeitado')) }
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
