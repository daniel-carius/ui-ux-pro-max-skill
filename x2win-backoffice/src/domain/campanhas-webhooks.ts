// Regras dos destinos de webhook: validação do endereço, detecção de token na URL
// (achado #7 da auditoria), segredo de assinatura e entrega simulada.
import type { WebhookExecution } from './webhooks'

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i
const SENSITIVE_PARAM = /(token|secret|senha|password|passwd|api[-_]?key|apikey|^key$|auth|signature|^sig$|access)/i

/** Endereço válido para receber webhooks? Retorna a mensagem de erro ou null. */
export function validateWebhookUrl(raw: string): string | null {
  const v = raw.trim()
  if (!v) return 'Informe o endereço do destino.'
  if (v.length > 500) return 'Endereço longo demais (máximo de 500 caracteres).'
  if (/\s/.test(v)) return 'O endereço não pode ter espaços.'
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return 'Comece o endereço com https://'
  let u: URL
  try {
    u = new URL(v)
  } catch {
    return 'Endereço inválido. Confira o domínio e o caminho.'
  }
  if (u.protocol !== 'https:') return 'Use https://. Envio por http deixa os dados do jogador expostos na rede.'
  if (u.username || u.password) return 'Não coloque usuário e senha no endereço. Use a assinatura HMAC ou um cabeçalho de autenticação.'
  if (PRIVATE_HOST.test(u.hostname) || !u.hostname.includes('.')) return 'Use um endereço público. Localhost e rede interna não recebem envios.'
  if (u.hash) return 'O endereço não pode ter âncora (#).'
  return null
}

function looksLikeToken(seg: string) {
  if (seg.length < 10) return false
  if (!/^[A-Za-z0-9_\-+=.~]+$/.test(seg)) return false
  const digits = (seg.match(/\d/g) ?? []).length
  const letters = (seg.match(/[A-Za-z]/g) ?? []).length
  if (/^[0-9a-f]+$/i.test(seg) && digits >= 2 && letters >= 1) return true // hexadecimal
  if (seg.length >= 20 && digits >= 2 && letters >= 2) return true // base64 / base64url longo
  return digits >= 3 && letters >= 3 && digits / seg.length >= 0.25
}

export interface TokenHit {
  where: 'caminho' | 'parametro'
  /** nome do parâmetro, quando vem da query string */
  name?: string
  value: string
}

/** Segmentos do caminho (ou parâmetros) com cara de token/segredo. */
export function findTokenSegments(url: string): TokenHit[] {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return []
  }
  const hits: TokenHit[] = []
  for (const seg of u.pathname.split('/')) {
    const s = safeDecode(seg)
    if (looksLikeToken(s)) hits.push({ where: 'caminho', value: s })
  }
  u.searchParams.forEach((value, name) => {
    if ((SENSITIVE_PARAM.test(name) && value.length >= 6) || looksLikeToken(value)) hits.push({ where: 'parametro', name, value })
  })
  return hits
}

export function hasTokenInUrl(url: string) {
  return findTokenSegments(url).length > 0
}

export function maskToken(t: string) {
  if (t.length <= 6) return '••••'
  return `${t.slice(0, 4)}••••${t.slice(-2)}`
}

/** Mesma URL com os trechos sensíveis mascarados. */
export function maskUrlTokens(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  const path = u.pathname
    .split('/')
    .map((seg) => (looksLikeToken(safeDecode(seg)) ? maskToken(safeDecode(seg)) : seg))
    .join('/')
  const params: string[] = []
  u.searchParams.forEach((value, name) => {
    const sensitive = (SENSITIVE_PARAM.test(name) && value.length >= 6) || looksLikeToken(value)
    params.push(`${name}=${sensitive ? maskToken(value) : value}`)
  })
  return `${u.protocol}//${u.host}${path}${params.length ? `?${params.join('&')}` : ''}`
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function hostOf(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Segredo de demonstração (nunca no formato de chave real). */
export function generateDemoSecret(): string {
  const chars = 'abcdef0123456789'
  let s = ''
  for (let i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return `DEMO-hmac-${s}`
}

/** Assinatura de exemplo (ilustrativa) no formato do cabeçalho X-X2W-Signature: "sha256=<hex>". */
export function exampleSignature(secret: string, ts: number) {
  let h = 2166136261
  const src = `${secret}.${ts}`
  let out = ''
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 16777619) >>> 0
    h = Math.imul(h ^ round, 2246822507) >>> 0
    out += h.toString(16).padStart(8, '0')
  }
  return `sha256=${out}`
}

export interface DeliveryResult {
  status: WebhookExecution['status']
  httpStatus: number
  durationMs: number
  message: string
}

/** Entrega simulada: domínios .invalid/.test não resolvem; o resto responde quase sempre 200. */
export function simulateDelivery(url: string): DeliveryResult {
  const host = hostOf(url)
  if (/\.(invalid|test|local)$/i.test(host)) return { status: 'falha', httpStatus: 502, durationMs: 30 + Math.round(Math.random() * 40), message: 'Domínio não encontrado (DNS).' }
  const r = Math.random()
  if (r < 0.05) return { status: 'falha', httpStatus: 500, durationMs: 200 + Math.round(Math.random() * 600), message: 'O destino respondeu com erro interno (500).' }
  if (r < 0.08) return { status: 'falha', httpStatus: 504, durationMs: 10000, message: 'Sem resposta em 10 segundos (tempo esgotado).' }
  return { status: 'sucesso', httpStatus: 200, durationMs: 90 + Math.round(Math.random() * 380), message: 'Recebido com sucesso (200 OK).' }
}

export function lastExecutionFor(execs: WebhookExecution[], destinationId: string): WebhookExecution | undefined {
  let best: WebhookExecution | undefined
  for (const e of execs) if (e.destinationId === destinationId && (!best || e.at > best.at)) best = e
  return best
}

export function deliveryStats(execs: WebhookExecution[], sinceMs: number) {
  const list = execs.filter((e) => new Date(e.at).getTime() >= sinceMs)
  const ok = list.filter((e) => e.status === 'sucesso').length
  const avg = list.length ? list.reduce((s, e) => s + e.durationMs, 0) / list.length : 0
  return { total: list.length, ok, failed: list.length - ok, rate: list.length ? ok / list.length : null, avgMs: Math.round(avg) }
}
