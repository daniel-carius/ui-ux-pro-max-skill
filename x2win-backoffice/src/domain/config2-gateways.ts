// Gateways de pagamento (Configurações › Gateways).
// Regra: a conta principal usa a credencial do cadastro do gateway; contas
// extras têm credencial e URL de callback próprias. Segredos são cifrados e
// nunca exibidos. O roteamento divide os depósitos entre contas ativas (100%).
import { createRng } from '@/lib/random'

export type GatewayId = 'pagflex' | 'pixnow' | 'brpay'

export interface Gateway {
  id: GatewayId
  name: string
  /** gateway principal da operação */
  primary: boolean
  active: boolean
  environment: 'producao' | 'sandbox'
  /** credencial do cadastro (usada pela conta principal) */
  clientId: string
  secret: string
  webhookSecret: string
  updatedAt: string
  updatedBy: string
}

export interface GatewayAccount {
  id: string
  gatewayId: GatewayId
  name: string
  /** conta principal: usa a credencial do cadastro */
  main: boolean
  active: boolean
  /** só contas extras */
  clientId: string
  secret: string
  callbackUrl: string
  createdAt: string
  /** CNPJ/titular do recebedor (informativo) */
  holder: string
}

export interface RoutingConfig {
  /** % dos depósitos por conta (id → %) */
  deposits: Record<string, number>
  /** ordem de tentativa quando a conta sorteada falha */
  fallback: string[]
  /** conta que paga os saques */
  withdrawalAccountId: string
  /** se o saque falhar, tenta a próxima conta do fallback */
  withdrawalFallback: boolean
}

export const CALLBACK_BASE = 'https://api.x2win.bet.br/callbacks'

export function callbackUrlFor(gatewayId: GatewayId, accountId: string, main: boolean) {
  return main ? `${CALLBACK_BASE}/${gatewayId}` : `${CALLBACK_BASE}/${gatewayId}/${accountId}`
}

export function accountLabel(a: GatewayAccount, gateways: Gateway[]) {
  const g = gateways.find((x) => x.id === a.gatewayId)
  return `${g?.name ?? a.gatewayId} · ${a.name}`
}

/** Conta pode receber tráfego: ela e o gateway estão ativos. */
export function isRoutable(a: GatewayAccount, gateways: Gateway[]) {
  const g = gateways.find((x) => x.id === a.gatewayId)
  return a.active && !!g?.active
}

export function routableAccounts(accounts: GatewayAccount[], gateways: Gateway[]) {
  return accounts.filter((a) => isRoutable(a, gateways))
}

export function routingTotal(r: RoutingConfig, active: GatewayAccount[]) {
  return active.reduce((s, a) => s + (r.deposits[a.id] ?? 0), 0)
}

/** Validação do roteamento (vale no servidor ao salvar). */
export function validateRouting(r: RoutingConfig, accounts: GatewayAccount[], gateways: Gateway[]): string | null {
  const active = routableAccounts(accounts, gateways)
  if (!active.length) return 'Nenhuma conta ativa. Ative ao menos uma conta em Credenciais.'
  for (const a of active) {
    const v = r.deposits[a.id] ?? 0
    if (v < 0 || v > 100) return 'Cada conta recebe entre 0% e 100% dos depósitos.'
    if (!Number.isInteger(v)) return 'Use percentuais inteiros.'
  }
  const total = routingTotal(r, active)
  if (total !== 100) return `A distribuição dos depósitos precisa somar 100% (está em ${total}%).`
  if (!r.withdrawalAccountId || !active.some((a) => a.id === r.withdrawalAccountId)) return 'Escolha uma conta ativa para pagar os saques.'
  return null
}

/** Divide 100% igualmente entre as contas (sobra vai para as primeiras). */
export function distributeEvenly(ids: string[]): Record<string, number> {
  if (!ids.length) return {}
  const base = Math.floor(100 / ids.length)
  let rest = 100 - base * ids.length
  const out: Record<string, number> = {}
  for (const id of ids) {
    out[id] = base + (rest > 0 ? 1 : 0)
    if (rest > 0) rest--
  }
  return out
}

/** Ordem de fallback limpa: só contas ativas, sem repetição, novas no fim. */
export function normalizeFallback(order: string[], active: GatewayAccount[]) {
  const ids = active.map((a) => a.id)
  const kept = order.filter((id, i) => ids.includes(id) && order.indexOf(id) === i)
  return [...kept, ...ids.filter((id) => !kept.includes(id))]
}

/** Por que a conta não pode ser desativada/removida agora. */
export function routingBlockers(r: RoutingConfig, accountIds: string[]): string[] {
  const out: string[] = []
  const pct = accountIds.reduce((s, id) => s + (r.deposits[id] ?? 0), 0)
  if (pct > 0) out.push(`recebe ${pct}% dos depósitos`)
  if (accountIds.includes(r.withdrawalAccountId)) out.push('paga os saques')
  return out
}

export function validateAccount(
  draft: { name: string; clientId: string; secret: string },
  opts: { isNew: boolean; main: boolean; siblings: GatewayAccount[]; ignoreId?: string },
): Record<string, string> {
  const err: Record<string, string> = {}
  const n = draft.name.trim()
  if (!n) err.name = 'Dê um nome para a conta.'
  else if (opts.siblings.some((s) => s.id !== opts.ignoreId && s.name.trim().toLowerCase() === n.toLowerCase())) err.name = 'Já existe uma conta com este nome neste gateway.'
  if (!opts.main) {
    if (!draft.clientId.trim()) err.clientId = 'Informe o Client ID da conta.'
    else if (!/^[A-Za-z0-9_-]{6,64}$/.test(draft.clientId.trim())) err.clientId = 'Use de 6 a 64 letras, números, hífen ou sublinhado.'
    if (opts.isNew && draft.secret.trim().length < 12) err.secret = 'O segredo tem pelo menos 12 caracteres.'
    if (!opts.isNew && draft.secret && draft.secret.trim().length < 12) err.secret = 'O segredo tem pelo menos 12 caracteres.'
  }
  return err
}

// ---------- Saúde (simulada) ----------

export type HealthStatus = 'operacional' | 'degradado' | 'fora'

export interface AccountHealth {
  accountId: string
  uptime: number
  latencyP95: number
  approvalRate: number
  status: HealthStatus
  /** últimas 24 h, por hora */
  series: { hour: string; approval: number; latency: number; volume: number }[]
  errors: { at: string; code: string; message: string }[]
}

function hashSeed(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const ERRORS: [string, string][] = [
  ['TIMEOUT', 'Gateway não respondeu em 10 s ao gerar o PIX'],
  ['PIX_EXPIRED', 'QR Code expirou antes do pagamento'],
  ['HTTP_502', 'Bad gateway na criação da cobrança'],
  ['SIGNATURE', 'Callback com assinatura inválida descartado'],
  ['DUPLICATE', 'Cobrança duplicada recusada pelo gateway'],
  ['RATE_LIMIT', 'Limite de requisições por minuto atingido'],
]

/** Saúde simulada e determinística por conta (muda a cada "Atualizar"). */
export function simulateHealth(account: GatewayAccount, gatewayActive: boolean, now: Date, refresh = 0): AccountHealth {
  const rng = createRng(hashSeed(account.id) + refresh * 97)
  const profile = hashSeed(account.gatewayId) % 3 // 0 estável, 1 médio, 2 instável
  const off = !account.active || !gatewayActive
  const baseApproval = [0.93, 0.89, 0.82][profile] + rng.float(-0.02, 0.02, 3)
  const baseLatency = [420, 680, 1150][profile] + rng.int(-60, 60)
  const series: AccountHealth['series'] = []
  for (let h = 23; h >= 0; h--) {
    const d = new Date(now.getTime() - h * 3_600_000)
    const spike = rng.bool(profile === 2 ? 0.18 : 0.06)
    const approval = off ? 0 : Math.max(0.4, Math.min(0.99, baseApproval + rng.float(-0.04, 0.03, 3) - (spike ? rng.float(0.08, 0.22, 3) : 0)))
    const latency = off ? 0 : Math.round(baseLatency * (spike ? rng.float(1.6, 3.2) : rng.float(0.85, 1.15)))
    const volume = off ? 0 : rng.int(40, 260) * (account.main ? 2 : 1)
    series.push({ hour: `${String(d.getHours()).padStart(2, '0')}h`, approval, latency, volume })
  }
  const live = series.filter((s) => s.volume > 0)
  const approvalRate = live.length ? live.reduce((s, x) => s + x.approval * x.volume, 0) / live.reduce((s, x) => s + x.volume, 0) : 0
  const sortedLat = live.map((s) => s.latency).sort((a, b) => a - b)
  const latencyP95 = sortedLat.length ? sortedLat[Math.min(sortedLat.length - 1, Math.floor(sortedLat.length * 0.95))] : 0
  const uptime = off ? 0 : [0.9995, 0.998, 0.991][profile] + rng.float(-0.0008, 0.0004, 4)
  const errCount = off ? 0 : [1, 3, 6][profile] + rng.int(0, 2)
  const errors: AccountHealth['errors'] = []
  let t = now.getTime() - rng.int(3, 50) * 60_000
  for (let i = 0; i < errCount; i++) {
    const [code, message] = rng.pick(ERRORS)
    errors.push({ at: new Date(t).toISOString(), code, message })
    t -= rng.int(20, 300) * 60_000
  }
  const status: HealthStatus = off ? 'fora' : approvalRate < 0.85 || latencyP95 > 2000 ? 'degradado' : 'operacional'
  return { accountId: account.id, uptime, latencyP95, approvalRate, status, series, errors }
}
