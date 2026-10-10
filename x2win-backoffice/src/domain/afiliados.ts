// Regras do programa de afiliados (Crescimento + Programa de afiliados).
// Funções puras de cálculo e validação, mais as decisões de saque de comissão.
// Modo demonstração: a decisão roda aqui e grava no navegador.
// Modo API: pagar e recusar são do servidor (POST /api/kv/afiliados.saques/:id/pay|reject),
// que confere o status, grava a lista (e o saldo, na recusa) e audita numa transação.
import type { Affiliate, AffiliateType } from '@/data/players'
import { seedAffiliates } from '@/data/players'
import { DATA_KEYS } from '@/data/hooks'
import { seedAffiliateWithdrawals, type AffiliateWithdrawal, type PayoutMethod, type PeriodStats } from '@/data/afiliados'
import { DAY, NOW, startOfDay } from '@/data/now'
import { slugify } from '@/data/names'
import { ApiError, api, isApiMode } from '@/lib/api'
import { brl, maskCpf, maskEmail, maskPhone } from '@/lib/format'
import { LOAD_FAILED_MESSAGE, dbSetAndWait, isLoadFailed, patchCache, refreshKey, useCollection, useDb } from '@/lib/store'
import { uid } from '@/lib/random'
import { KEYS as SESSION_KEYS, audit } from './session'
import type { Role } from './roles'

export const AFILIADOS_KEYS = {
  /** regra de comissão por tipo de afiliado (Crescimento › Comissões) */
  commissions: 'crescimento.comissoes',
  /** links pausados (Crescimento › Links) */
  links: 'crescimento.links.status',
  /** pedidos de saque de comissão (Programa › Saques de afiliados) */
  withdrawals: 'afiliados.saques',
  /** regras do programa (Programa › Configuração) */
  config: 'afiliados.configuracao',
} as const

export const SITE_URL = 'https://x2win.bet.br'

/** Link de indicação de um afiliado: https://x2win.bet.br/?ref=CODIGO */
export function referralLink(code: string) {
  return `${SITE_URL}/?ref=${encodeURIComponent(code)}`
}

export const AFFILIATE_TYPES: AffiliateType[] = ['Manager', 'Influencer', 'Organic']

// ---------- Comissões por tipo ----------

export type CommissionModel = 'cpa' | 'revshare'

export interface CommissionRule {
  model: CommissionModel
  /** R$ por depositante (CPA) ou % do GGR dos indicados (Rev Share, 0–100) */
  value: number
  /** teto por afiliado em cada fechamento mensal; null = sem teto */
  cap: number | null
  updatedAt: string | null
  updatedBy: string | null
}

export type CommissionRules = Record<AffiliateType, CommissionRule>

export const DEFAULT_COMMISSION_RULES: CommissionRules = {
  Manager: { model: 'revshare', value: 10, cap: null, updatedAt: null, updatedBy: null },
  Influencer: { model: 'cpa', value: 50, cap: null, updatedAt: null, updatedBy: null },
  Organic: { model: 'revshare', value: 20, cap: null, updatedAt: null, updatedBy: null },
}

export const COMMISSION_MODEL_LABEL: Record<CommissionModel, string> = {
  cpa: 'Fixo (CPA)',
  revshare: 'Percentual (Rev Share)',
}

/** Rev Share acima disso costuma deixar a casa no prejuízo depois de bônus e taxas. */
export const REVSHARE_WARN_PCT = 50

export interface RuleErrors {
  value?: string
  cap?: string
}

export function validateCommissionRule(r: Pick<CommissionRule, 'model' | 'value' | 'cap'>): RuleErrors {
  const e: RuleErrors = {}
  if (!Number.isFinite(r.value) || r.value <= 0) e.value = 'Informe um valor maior que zero.'
  else if (r.model === 'revshare' && r.value > 100) e.value = 'O percentual vai até 100%.'
  if (r.cap !== null) {
    if (!Number.isFinite(r.cap) || r.cap <= 0) e.cap = 'O teto precisa ser maior que zero. Deixe vazio para sem teto.'
    else if (r.model === 'cpa' && r.value > 0 && r.cap < r.value) e.cap = 'O teto é menor que a comissão de um único depositante.'
  }
  return e
}

export function sameRule(a: Pick<CommissionRule, 'model' | 'value' | 'cap'>, b: Pick<CommissionRule, 'model' | 'value' | 'cap'>) {
  return a.model === b.model && a.value === b.value && a.cap === b.cap
}

export function describeRule(r: Pick<CommissionRule, 'model' | 'value' | 'cap'>) {
  const base = r.model === 'cpa' ? `${brl(r.value)} por depositante` : `${pctLabel(r.value)} do GGR`
  return `${base} · ${r.cap === null ? 'sem teto' : `teto de ${brl(r.cap)} por mês`}`
}

export function pctLabel(p: number) {
  return `${p.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
}

export interface CommissionResult {
  /** comissão antes do teto */
  gross: number
  /** comissão devida (depois do teto) */
  final: number
  capped: boolean
  /** explicação curta do cálculo */
  formula: string
}

/**
 * Comissão de um afiliado num fechamento.
 * CPA: depositantes × valor. Rev Share: GGR × %. GGR negativo não gera comissão
 * nem dívida para o afiliado (sem saldo negativo acumulado).
 */
export function commissionFor(rule: Pick<CommissionRule, 'model' | 'value' | 'cap'>, input: { depositors: number; ggr: number }): CommissionResult {
  const depositors = Math.max(0, Math.floor(input.depositors || 0))
  const gross = rule.model === 'cpa' ? depositors * Math.max(0, rule.value) : (Math.max(0, input.ggr || 0) * Math.max(0, rule.value)) / 100
  const capped = rule.cap !== null && gross > rule.cap
  const final = round2(capped ? rule.cap! : gross)
  const formula =
    rule.model === 'cpa'
      ? `${depositors} × ${brl(rule.value)}`
      : input.ggr <= 0
        ? 'GGR negativo ou zero não gera comissão'
        : `${brl(input.ggr)} × ${pctLabel(rule.value)}`
  return { gross: round2(gross), final, capped, formula }
}

// ---------- Contrato individual (gerentes) ----------

export interface Contract {
  /** R$ por FTD */
  cpa: number
  /** fração do GGR (0.1 = 10%) */
  revShare: number
}

export function contractLabel(c: Contract) {
  const parts: string[] = []
  if (c.cpa > 0) parts.push(`CPA ${brl(c.cpa)}`)
  if (c.revShare > 0) parts.push(`Rev Share ${pctLabel(round2(c.revShare * 100))}`)
  return parts.length ? parts.join(' + ') : 'Sem comissão'
}

/**
 * Comissão da rede de um gerente no período: FTD × CPA + GGR positivo × Rev Share,
 * limitada ao teto do tipo Manager proporcional ao período (teto mensal × meses).
 */
export function networkCommission(stats: Pick<PeriodStats, 'ftd' | 'ggr'>, c: Contract, monthlyCap: number | null, days: number) {
  const gross = round2(stats.ftd * c.cpa + Math.max(0, stats.ggr) * c.revShare)
  const cap = scaleCap(monthlyCap, days)
  const capped = cap !== null && gross > cap
  const commission = capped ? cap! : gross
  return { gross, commission, capped, cap, result: round2(stats.ggr - commission) }
}

// ---------- Gerentes ----------

export interface ManagerDraft {
  name: string
  email: string
  cpa: number
  /** em % (10 = 10%) */
  revSharePct: number
  status: 'ativo' | 'pausado'
}

export interface ManagerErrors {
  name?: string
  email?: string
  cpa?: string
  revSharePct?: string
}

export const MAX_REVSHARE_PCT = 60
export const MAX_CPA = 2000

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateManagerDraft(d: ManagerDraft, affiliates: Affiliate[], editingId?: string): ManagerErrors {
  const e: ManagerErrors = {}
  if (d.name.trim().split(/\s+/).filter(Boolean).length < 2 || d.name.trim().length < 5) e.name = 'Informe nome e sobrenome.'
  const email = d.email.trim().toLowerCase()
  if (!EMAIL_RE.test(email)) e.email = 'Informe um e-mail válido.'
  else if (affiliates.some((a) => a.id !== editingId && a.email.toLowerCase() === email)) e.email = 'Já existe um afiliado com este e-mail.'
  Object.assign(e, validateContract({ cpa: d.cpa, revSharePct: d.revSharePct }))
  return e
}

export function validateContract(c: { cpa: number; revSharePct: number }): Pick<ManagerErrors, 'cpa' | 'revSharePct'> {
  const e: Pick<ManagerErrors, 'cpa' | 'revSharePct'> = {}
  if (!Number.isFinite(c.cpa) || c.cpa < 0) e.cpa = 'O CPA não pode ser negativo.'
  else if (c.cpa > MAX_CPA) e.cpa = `CPA acima de ${brl(MAX_CPA)} precisa de aprovação da diretoria.`
  if (!Number.isFinite(c.revSharePct) || c.revSharePct < 0 || c.revSharePct > MAX_REVSHARE_PCT)
    e.revSharePct = `Use um percentual entre 0% e ${MAX_REVSHARE_PCT}%.`
  if (!e.cpa && !e.revSharePct && c.cpa === 0 && c.revSharePct === 0) e.cpa = 'Defina CPA, Rev Share ou os dois.'
  return e
}

/** Código de indicação a partir do nome (5 letras + 2 dígitos), sem repetir. */
export function makeAffiliateCode(name: string, taken: Iterable<string>) {
  const used = new Set([...taken].map((c) => c.toUpperCase()))
  const base = (slugify(name.split(/\s+/)[0] ?? '') || 'AFIL').slice(0, 5).toUpperCase()
  let n = 10 + (hashText(name) % 90)
  for (let i = 0; i < 90; i++) {
    const code = `${base}${n}`
    if (!used.has(code)) return code
    n = n >= 99 ? 10 : n + 1
  }
  return `${base}${uid('').slice(0, 4).toUpperCase()}`
}

function hashText(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export function buildManager(d: ManagerDraft, affiliates: Affiliate[]): Affiliate {
  const now = new Date().toISOString()
  return {
    id: uid('afm'),
    playerId: '',
    name: d.name.trim().replace(/\s+/g, ' '),
    email: d.email.trim().toLowerCase(),
    type: 'Manager',
    level: 1,
    managerId: null,
    code: makeAffiliateCode(
      d.name,
      affiliates.map((a) => a.code),
    ),
    cpa: round2(d.cpa),
    revShare: round2(d.revSharePct) / 100,
    status: d.status,
    balance: 0,
    pixKey: d.email.trim().toLowerCase(),
    createdAt: now,
  }
}

/** Códigos usados por mais de um afiliado (o cadastro pode ir para a pessoa errada). */
export function duplicateCodes(affiliates: Affiliate[]) {
  const by = new Map<string, Affiliate[]>()
  for (const a of affiliates) {
    const k = a.code.toUpperCase()
    by.set(k, [...(by.get(k) ?? []), a])
  }
  return new Map([...by].filter(([, list]) => list.length > 1))
}

// ---------- Configuração do programa ----------

export type CommissionWallet = 'afiliado' | 'jogo'

export interface ProgramConfig {
  minWithdrawal: number
  maxWithdrawal: number
  /** vezes que o bônus precisa ser apostado (x) */
  bonusRollover: number
  /** onde a comissão é creditada */
  wallet: CommissionWallet
  /** comissão creditada no jogo entra como bônus com rollover */
  bonusWithRollover: boolean
  methods: PayoutMethod[]
  /** prazo para pagar um pedido, em dias úteis */
  payoutDays: number
  /** dia do mês em que a comissão do mês anterior é apurada */
  closingDay: number
}

export const DEFAULT_PROGRAM_CONFIG: ProgramConfig = {
  minWithdrawal: 100,
  maxWithdrawal: 10000,
  bonusRollover: 3,
  wallet: 'afiliado',
  bonusWithRollover: false,
  methods: ['pix', 'ted', 'saldo'],
  payoutDays: 2,
  closingDay: 5,
}

export type ConfigErrors = Partial<Record<keyof ProgramConfig, string>>

export function validateProgramConfig(v: ProgramConfig): ConfigErrors {
  const e: ConfigErrors = {}
  if (!(v.minWithdrawal > 0)) e.minWithdrawal = 'O saque mínimo precisa ser maior que zero.'
  if (!(v.maxWithdrawal >= v.minWithdrawal)) e.maxWithdrawal = 'O saque máximo precisa ser maior ou igual ao mínimo.'
  if (v.bonusWithRollover && (!(v.bonusRollover >= 1) || v.bonusRollover > 100)) e.bonusRollover = 'Use um rollover entre 1x e 100x.'
  else if (v.bonusRollover < 0 || v.bonusRollover > 100) e.bonusRollover = 'Use um rollover entre 0x e 100x.'
  if (!v.methods.length) e.methods = 'Escolha pelo menos uma forma de pagamento.'
  if (!Number.isInteger(v.payoutDays) || v.payoutDays < 1 || v.payoutDays > 30) e.payoutDays = 'Use um prazo entre 1 e 30 dias úteis.'
  if (!Number.isInteger(v.closingDay) || v.closingDay < 1 || v.closingDay > 28) e.closingDay = 'Escolha um dia entre 1 e 28 (todo mês tem esses dias).'
  return e
}

export function firstError(e: Record<string, string | undefined>) {
  return Object.values(e).find(Boolean) ?? null
}

/** Soma dias úteis (seg–sex). Não considera feriados. */
export function addBusinessDays(from: Date, n: number) {
  const d = new Date(from)
  let left = n
  while (left > 0) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) left--
  }
  return d
}

/** Dias úteis completos entre duas datas. */
export function businessDaysBetween(from: Date, to: Date) {
  let n = 0
  const d = startOfDay(from)
  const end = startOfDay(to)
  while (d < end) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) n++
  }
  return n
}

/** Próximo fechamento a partir de hoje (no próprio dia conta como hoje). */
export function nextClosing(closingDay: number, base: Date = NOW) {
  const today = startOfDay(base)
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), closingDay)
  return thisMonth >= today ? thisMonth : new Date(today.getFullYear(), today.getMonth() + 1, closingDay)
}

export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

// ---------- Saques de comissão ----------

export function isLate(w: AffiliateWithdrawal, cfg: ProgramConfig, now: Date = new Date()) {
  return w.status === 'pendente' && businessDaysBetween(new Date(w.createdAt), now) > cfg.payoutDays
}

/** Pontos de atenção do pedido em relação às regras atuais do programa. */
export function withdrawalIssues(w: AffiliateWithdrawal, cfg: ProgramConfig, affiliate?: Affiliate): string[] {
  const out: string[] = []
  if (w.amount < cfg.minWithdrawal) out.push(`Abaixo do saque mínimo (${brl(cfg.minWithdrawal)})`)
  if (w.amount > cfg.maxWithdrawal) out.push(`Acima do saque máximo (${brl(cfg.maxWithdrawal)})`)
  if (!cfg.methods.includes(w.method)) out.push('Forma de pagamento desligada na configuração')
  if (affiliate?.status === 'pausado') out.push('Afiliado pausado no programa')
  return out
}

/** Chave PIX mascarada para listas (LGPD). */
export function maskPixKey(type: AffiliateWithdrawal['pixKeyType'], key: string | null) {
  if (!key) return '—'
  if (type === 'CPF') return maskCpf(key)
  if (type === 'E-mail') {
    const [user, domain] = key.split('@')
    return domain ? `${user.slice(0, 2)}•••@${domain}` : maskEmail(key)
  }
  if (type === 'Celular') return maskPhone(key)
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

export function maskAccount(account: string) {
  const [num, dv] = account.split('-')
  return `•••${num.slice(-2)}${dv ? `-${dv}` : ''}`
}

export interface DecisionResult {
  ok: boolean
  message: string
}

export function canDecideAffiliateWithdrawals(role: Role) {
  return role.permissions.includes('afiliados-saques.aprovar')
}

/** Resposta de POST /api/kv/afiliados.saques/:id/pay|reject. */
interface AffiliateWithdrawalDecisionResponse {
  ok: true
  message: string
  /** pedido já decidido, no formato da lista (mascarado como na leitura) */
  withdrawal: AffiliateWithdrawal
  version: number
}

const NOT_SAVED = 'A decisão não foi salva. Nada foi pago nem devolvido; confira a lista e tente de novo.'

/** Modo API: o servidor decide; a tela só muda depois da resposta dele. */
async function decideOnServer(w: AffiliateWithdrawal, action: 'pay' | 'reject', body?: { reason: string }): Promise<DecisionResult> {
  try {
    const res = await api<AffiliateWithdrawalDecisionResponse>(
      'POST',
      `/api/kv/${encodeURIComponent(AFILIADOS_KEYS.withdrawals)}/${encodeURIComponent(w.id)}/${action}`,
      body,
    )
    const updated = res.withdrawal
    patchCache<AffiliateWithdrawal[]>(
      AFILIADOS_KEYS.withdrawals,
      (prev) => prev.map((x) => (x.id === updated.id ? updated : x)),
      seedAffiliateWithdrawals,
    )
    // a recusa devolveu o valor ao saldo de comissão no servidor; a auditoria ganhou a linha do servidor
    if (action === 'reject') refreshKey(DATA_KEYS.affiliates).catch(() => {})
    refreshKey(SESSION_KEYS.audit).catch(() => {})
    return { ok: true, message: res.message }
  } catch (e) {
    // já decidido por outra pessoa ou pedido que não existe no servidor: mostra a lista real
    if (e instanceof ApiError && (e.code === 'ja_decidido' || e.status === 404)) refreshKey(AFILIADOS_KEYS.withdrawals).catch(() => {})
    const why = e instanceof ApiError ? e.message : 'Erro inesperado ao falar com o servidor.'
    return { ok: false, message: `${why} ${NOT_SAVED}` }
  }
}

/**
 * Modo demonstração: aplica a decisão só se o pedido ainda está pendente no valor gravado
 * (não no que a tela tinha) e devolve se gravou.
 */
async function decideLocally(id: string, p: Partial<AffiliateWithdrawal>): Promise<boolean> {
  let stillPending = false
  const saved = await dbSetAndWait<AffiliateWithdrawal[]>(
    AFILIADOS_KEYS.withdrawals,
    (prev) => {
      stillPending = prev.some((x) => x.id === id && x.status === 'pendente')
      return stillPending ? prev.map((x) => (x.id === id ? { ...x, ...p } : x)) : prev
    },
    seedAffiliateWithdrawals,
  )
  return saved && stillPending
}

function preconditions(w: AffiliateWithdrawal): DecisionResult | null {
  if (w.status !== 'pendente') return { ok: false, message: 'Este pedido já foi decidido.' }
  // a lista na tela é o padrão (a leitura falhou): nada é decidido sobre ela
  if (isLoadFailed(AFILIADOS_KEYS.withdrawals)) return { ok: false, message: LOAD_FAILED_MESSAGE }
  return null
}

/**
 * Paga um pedido. Resolve depois que a decisão foi gravada (modo API: pelo servidor, que também
 * audita); ok:false quando nada foi gravado. A tela só confirma o pagamento com ok:true.
 */
export async function payAffiliateWithdrawal(w: AffiliateWithdrawal, role: Role, actorName: string): Promise<DecisionResult> {
  const blocked = preconditions(w)
  if (blocked) return blocked
  if (!canDecideAffiliateWithdrawals(role)) return { ok: false, message: `O cargo ${role.name} não paga saques de afiliados.` }
  if (isApiMode()) return decideOnServer(w, 'pay')
  const now = new Date()
  const reference =
    w.method === 'pix'
      ? `E${Date.now().toString().slice(-8)}${now.toISOString().slice(0, 10).replace(/-/g, '')}${uid('').toUpperCase().slice(0, 11)}`
      : w.method === 'ted'
        ? `TED-${Date.now().toString().slice(-9)}`
        : `CRED-${Date.now().toString().slice(-7)}`
  const saved = await decideLocally(w.id, { status: 'pago', decidedAt: now.toISOString(), decidedBy: actorName, reason: null, reference })
  if (!saved) return { ok: false, message: `Este pedido já foi decidido ou não está mais na lista. ${NOT_SAVED}` }
  audit('aprovar', `Saque de afiliado #${w.id}`, `Pagamento de ${brl(w.amount)} para ${w.affiliateName} (${w.method.toUpperCase()})`)
  const how = w.method === 'pix' ? 'O PIX foi enviado.' : w.method === 'ted' ? 'A TED foi agendada.' : 'O valor entrou no saldo do jogo.'
  return { ok: true, message: `${brl(w.amount)} pagos a ${w.affiliateName}. ${how}` }
}

/** Recusa um pedido e devolve o valor ao saldo de comissão. Mesmas garantias de payAffiliateWithdrawal. */
export async function rejectAffiliateWithdrawal(w: AffiliateWithdrawal, role: Role, actorName: string, reason: string): Promise<DecisionResult> {
  const blocked = preconditions(w)
  if (blocked) return blocked
  if (!canDecideAffiliateWithdrawals(role)) return { ok: false, message: `O cargo ${role.name} não decide saques de afiliados.` }
  const why = reason.trim()
  if (!why) return { ok: false, message: 'Informe o motivo da recusa.' }
  if (isApiMode()) return decideOnServer(w, 'reject', { reason: why })
  const saved = await decideLocally(w.id, { status: 'recusado', decidedAt: new Date().toISOString(), decidedBy: actorName, reason: why })
  if (!saved) return { ok: false, message: `Este pedido já foi decidido ou não está mais na lista. ${NOT_SAVED}` }
  // o valor reservado volta para o saldo de comissão do afiliado
  await dbSetAndWait<Affiliate[]>(
    DATA_KEYS.affiliates,
    (prev) => prev.map((a) => (a.id === w.affiliateId ? { ...a, balance: round2(a.balance + w.amount) } : a)),
    seedAffiliates,
  )
  audit('recusar', `Saque de afiliado #${w.id}`, `Pedido de ${brl(w.amount)} de ${w.affiliateName} recusado: ${why}`)
  return { ok: true, message: `${brl(w.amount)} voltaram para o saldo de comissão de ${w.affiliateName}.` }
}

// ---------- Hooks ----------

export const useAffiliateWithdrawals = () => useCollection(AFILIADOS_KEYS.withdrawals, seedAffiliateWithdrawals)

/** Regras de comissão salvas (sempre com os três tipos). */
export function useCommissionRules(): CommissionRules {
  const [stored] = useDb<CommissionRules>(AFILIADOS_KEYS.commissions, DEFAULT_COMMISSION_RULES)
  return { ...DEFAULT_COMMISSION_RULES, ...stored }
}

/** Configuração salva do programa (com valores padrão para campos novos). */
export function useProgramConfig(): ProgramConfig {
  const [stored] = useDb<ProgramConfig>(AFILIADOS_KEYS.config, DEFAULT_PROGRAM_CONFIG)
  return { ...DEFAULT_PROGRAM_CONFIG, ...stored }
}

// ---------- Utilidades ----------

/** Meses de fechamento cobertos por um período (mínimo 1), para proporcionalizar tetos mensais. */
export function monthsInPeriod(days: number) {
  return Math.max(1, Math.round(days / 30))
}

/** Teto mensal ajustado ao tamanho do período. */
export function scaleCap(cap: number | null, days: number) {
  return cap === null ? null : round2(cap * monthsInPeriod(days))
}

export function round2(v: number) {
  return Math.round(v * 100) / 100
}

/** Quantidade de dias de um período (inclusivo). */
export function periodDays(from: Date, to: Date) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY) + 1
}
