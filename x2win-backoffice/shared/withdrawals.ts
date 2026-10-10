// Regras de saque: validação, simulação e teto de aprovação por cargo.
// Funções puras usadas pelo painel (exibição) e pelo servidor (decisão).
import { brl } from './money'
import type { Role } from './permissions'

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

/** Estados em que o saque ainda espera decisão. */
export const OPEN_WITHDRAWAL_STATUSES = ['criado', 'pendente', 'em_analise'] as const

export interface DecisionResult {
  ok: boolean
  message: string
}

type RoleLike = Pick<Role, 'name' | 'permissions' | 'approvalCeiling'>

export function canDecideWithdrawals(role: RoleLike) {
  return role.permissions.includes('saques.aprovar') && role.approvalCeiling !== 0
}

/** O cargo pode aprovar este valor? */
export function checkApprovalCeiling(role: RoleLike, amount: number): DecisionResult {
  if (!canDecideWithdrawals(role)) {
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

/**
 * O cargo pode deixar a aprovação automática em `next` (antes `previous`)? Ligar ou mudar o teto da aprovação
 * automática equivale a aprovar saques até esse valor: só quem decide saques, e nunca acima do próprio teto.
 * Desligar (0) ou manter o valor gravado é sempre aceito.
 */
export function checkAutoApproveCeiling(role: RoleLike, next: number, previous: number): DecisionResult {
  if (next === 0 || next === previous) return { ok: true, message: '' }
  if (!canDecideWithdrawals(role)) {
    return { ok: false, message: `O cargo ${role.name} não aprova saques e por isso não pode ligar nem mudar a aprovação automática.` }
  }
  if (role.approvalCeiling !== null && next > role.approvalCeiling) {
    return {
      ok: false,
      message: `A aprovação automática não pode passar do teto do cargo ${role.name} (${brl(role.approvalCeiling)}).`,
    }
  }
  return { ok: true, message: '' }
}

/** Valores em reais com no máximo 2 casas decimais (centavos). */
function hasCents(n: number) {
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6
}

/** Valida as regras antes de salvar. Retorna a mensagem do primeiro erro ou null. */
export function validateWithdrawalRules(v: WithdrawalRules): string | null {
  const nums: (keyof WithdrawalRules)[] = ['min', 'maxPerRequest', 'rolloverPct', 'fee', 'dailyLimit', 'autoApproveMax']
  for (const k of nums) {
    const n = v[k] as unknown
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 'Use apenas números positivos nos limites.'
    if (!hasCents(n)) return 'Use no máximo 2 casas decimais nos valores.'
  }
  if (v.min <= 0) return 'O valor mínimo precisa ser maior que zero.'
  if (v.maxPerRequest < v.min) return 'O valor máximo precisa ser maior que o mínimo.'
  if (!Number.isInteger(v.dailyLimit) || v.dailyLimit < 1) return 'O limite diário precisa ser de pelo menos 1 saque.'
  if (v.autoApproveMax > v.maxPerRequest) return 'O teto da aprovação automática não pode passar do valor máximo por saque.'
  if (v.rolloverPct > 5000) return 'Rollover precisa estar entre 0% e 5.000%.'
  if (v.fee >= v.min) return 'A taxa fixa precisa ser menor que o valor mínimo do saque.'
  if (!['acumulado', 'por_deposito'].includes(v.rolloverMode)) return 'Modo de contagem do rollover inválido.'
  if (!['todas', 'saldo_real', 'bonus'].includes(v.rolloverBets)) return 'Opção de apostas que contam inválida.'
  return null
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

/** Simula um pedido de saque contra as regras. */
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
