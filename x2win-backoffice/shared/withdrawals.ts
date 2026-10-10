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

/**
 * Resultado da aprovação, sem prometer o que não aconteceu: saque.pago é um aviso aos sistemas da operação (não há
 * integração com gateway). Com destino ativo, o aviso fica na fila de envio; sem nenhum, o pagamento é manual.
 * `queued`: avisos saque.pago enfileirados (um por destino ativo). Mesmo texto no servidor e na demonstração.
 */
export function approvalMessage(amount: number, queued: number, templateOff = false): string {
  const head = `Saque de ${brl(amount)} aprovado.`
  if (queued > 0) return `${head} Aviso de pagamento na fila para ${queued} ${queued === 1 ? 'sistema' : 'sistemas'}.`
  if (templateOff) return `${head} O template "Saque pago" está desativado em Campanhas › Templates: nenhum aviso saiu, e o pagamento precisa ser feito pelo financeiro no gateway.`
  return `${head} Nenhum destino "saque.pago" ativo: o pagamento precisa ser feito pelo financeiro no gateway.`
}

/**
 * Resultado da recusa, sem prometer o que não aconteceu: o painel registra a decisão e põe na fila o aviso
 * saque.rejeitado; devolver o valor ao saldo é com a plataforma de jogo (que recebe o aviso), e não há e-mail.
 * `queued`: avisos saque.rejeitado enfileirados (um por destino ativo). Mesmo texto no servidor e na demonstração.
 */
export function rejectionMessage(amount: number, queued: number, templateOff = false): string {
  const head = `Saque de ${brl(amount)} recusado.`
  if (queued > 0) {
    return `${head} Aviso "saque.rejeitado" na fila para ${queued} ${queued === 1 ? 'sistema' : 'sistemas'}: a devolução ao saldo do jogador é feita pela plataforma de jogo.`
  }
  if (templateOff) {
    return `${head} O template "Saque rejeitado" está desativado em Campanhas › Templates: nenhum aviso saiu; confira na plataforma de jogo a devolução do valor ao saldo do jogador.`
  }
  return `${head} Nenhum destino "saque.rejeitado" ativo: confira na plataforma de jogo a devolução do valor ao saldo do jogador.`
}

export function canDecideWithdrawals(role: RoleLike) {
  return role.permissions.includes('saques.aprovar') && role.approvalCeiling !== 0
}

// ---------- Conferências da aprovação (servidor e demonstração, mesmo texto) ----------

/** Janela da segregação de funções: quem lançou crédito manual ou estorno para o jogador não aprova o saque dele. */
export const SEGREGATION_WINDOW_MS = 30 * 86_400_000
export const SEGREGATION_MESSAGE = 'Você lançou crédito manual para este jogador nos últimos 30 dias; outra pessoa precisa aprovar.'

/**
 * Motivo para segurar a aprovação do saque, ou null: conta de rede banida pelo anti-fraude (primeiro: só sai do
 * bloqueio desfazendo o banimento) ou conta bloqueada na ficha, por qualquer motivo (com o motivo do bloqueio, quando
 * conhecido; não é atribuída ao anti-fraude). Jogador autoexcluído ou em pausa continua recebendo o saldo.
 */
export function payoutHoldMessage(h: { network?: string | null; blocked: boolean; blockReason?: string | null }): string | null {
  if (h.network) return `Conta de uma rede banida pelo anti-fraude (${h.network}). Para liberar, desfaça o banimento da rede em Anti-fraude › Bloqueios.`
  if (h.blocked) {
    const reason = h.blockReason?.trim().slice(0, 300)
    return `Conta bloqueada${reason ? ` (motivo: ${reason})` : ''}. Para liberar, desbloqueie a conta na ficha do jogador, em Usuários › Status e saldo.`
  }
  return null
}

export type OutOfRules =
  | { message: string; details: { rule: 'maxPerRequest'; limit: number; amount: number } }
  | { message: string; details: { rule: 'dailyLimit'; limit: number; count: number } }

/** Regras de saque em vigor na aprovação (409 fora_das_regras): valor acima do máximo ou limite diário atingido. */
export function outOfRulesProblem(amount: number, rules: Pick<WithdrawalRules, 'maxPerRequest' | 'dailyLimit'>, approvedLast24h: number): OutOfRules | null {
  if (amount > rules.maxPerRequest) {
    return {
      message: `Valor acima do máximo por saque das regras em vigor (${brl(rules.maxPerRequest)}).`,
      details: { rule: 'maxPerRequest', limit: rules.maxPerRequest, amount },
    }
  }
  if (approvedLast24h >= rules.dailyLimit) {
    return {
      message: `O jogador já tem ${approvedLast24h} ${approvedLast24h === 1 ? 'saque aprovado' : 'saques aprovados'} nas últimas 24 horas (limite diário: ${rules.dailyLimit}).`,
      details: { rule: 'dailyLimit', limit: rules.dailyLimit, count: approvedLast24h },
    }
  }
  return null
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
