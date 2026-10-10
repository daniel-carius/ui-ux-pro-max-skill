// Regras dos destinos de webhook: validação do endereço, detecção de token na URL
// (achado #7 da auditoria), segredo de assinatura e entrega simulada.
import { WEBHOOK_MAX_ATTEMPTS } from '@shared/api'
import { isTestExecution, type WebhookExecution } from './webhooks'

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

/** Hosts dos destinos de demonstração (terceiros): o servidor recusa destino novo ou endereço trocado para eles. */
export const DEMO_WEBHOOK_HOSTS = ['hooks.x2win-crm.com', 'api.leadflow.app'] as const
/** Segredos de demonstração (públicos no código do painel): o servidor recusa. */
export const DEMO_SECRET_PATTERN = /^DEMO-hmac-/i
/** Tamanho mínimo de um segredo digitado (o mesmo do servidor). */
export const MIN_SECRET_LENGTH = 8

/** Endereço aponta para um host de demonstração (ou subdomínio dele)? */
export function isDemoWebhookHost(url: string): boolean {
  let host: string
  try {
    host = new URL(url.trim()).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return false
  }
  return DEMO_WEBHOOK_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))
}

/**
 * Modo API: destino de demonstração (host de terceiro). O servidor nunca envia evento real nem teste para ele, então
 * ele não conta como ativo em nenhuma tela (Webhooks, Templates, ficha do destino). `api`: isApiMode().
 */
export function isDemoDestination(d: { url: string }, api: boolean): boolean {
  return api && isDemoWebhookHost(d.url)
}

/** O destino recebe eventos? Ativo e (modo API) fora dos hosts de demonstração. */
export function destinationReceives(d: { active: boolean; url: string }, api: boolean): boolean {
  return d.active && !isDemoDestination(d, api)
}

/**
 * Modo API: execução para um host de demonstração = registro fictício semeado com DEMO_DATA (o servidor nunca envia
 * para esses hosts). Fica fora das contagens e das listas de entregas.
 */
export function isDemoExecution(e: Pick<WebhookExecution, 'url'>, api: boolean): boolean {
  return api && isDemoWebhookHost(e.url)
}

/**
 * Entrega de verdade: a mesma definição em Webhooks e Estatísticas (contagens, taxa de sucesso, tempo médio).
 * Não contam os envios de teste nem os registros de demonstração.
 */
export function isRealDelivery(e: Pick<WebhookExecution, 'url' | 'test' | 'payload'>, api: boolean): boolean {
  return !isTestExecution(e) && !isDemoExecution(e, api)
}

/** Origem do endereço (esquema, host e porta), ou null se não for URL. */
export function urlOrigin(url: string): string | null {
  try {
    return new URL(url.trim()).origin
  } catch {
    return null
  }
}

/**
 * O segredo de assinatura fica preso ao destino: trocar a origem do endereço (esquema,
 * host ou porta) ou o evento pede um segredo novo (o servidor recusa manter o antigo).
 */
export function needsNewSecret(before: { event: string; url: string }, after: { event: string; url: string }): boolean {
  const from = urlOrigin(before.url)
  return before.event !== after.event || from === null || from !== urlOrigin(after.url)
}

/** Segredo digitado: retorna o problema ou null (mesmas regras do servidor). */
export function webhookSecretError(raw: string, opts: { rejectDemo: boolean }): string | null {
  const s = raw.trim()
  if (!s) return 'Digite o segredo novo ou gere um.'
  if (s.includes('•') || s.includes('***')) return 'O segredo não pode ter caracteres de máscara (*** ou •). Digite o segredo completo.'
  if (s.length < MIN_SECRET_LENGTH) return `O segredo precisa de pelo menos ${MIN_SECRET_LENGTH} caracteres.`
  if (s.length > 500) return 'Segredo longo demais (máximo de 500 caracteres).'
  if (opts.rejectDemo && DEMO_SECRET_PATTERN.test(s)) return 'Este é um segredo de demonstração. Gere um segredo novo para o destino.'
  return null
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

/**
 * Entrega a que a tentativa pertence: as tentativas da mesma entrega levam o mesmo X-X2W-Delivery (deliveryId,
 * por destino). Registro sem o dado (demonstração, registro antigo) é uma entrega sozinho.
 */
export function deliveryKey(e: WebhookExecution): string {
  return e.deliveryId ? `${e.destinationId}|${e.deliveryId}` : `#${e.id}`
}

/**
 * "tentativa N de 6" quando a entrega precisou de nova tentativa (ou falhou); null sem o dado (registro antigo)
 * e nos envios de teste, que saem uma vez só e nunca são tentados de novo.
 */
export function attemptLabel(e: WebhookExecution): string | null {
  if (isTestExecution(e) || !e.attempt || (e.attempt === 1 && e.status === 'sucesso')) return null
  return `tentativa ${e.attempt} de ${WEBHOOK_MAX_ATTEMPTS}`
}

/** Só a tentativa mais recente de cada entrega (listas de "entregas"), na ordem recebida. */
export function latestAttempts(execs: WebhookExecution[]): WebhookExecution[] {
  const best = new Map<string, WebhookExecution>()
  for (const e of execs) {
    const k = deliveryKey(e)
    const cur = best.get(k)
    if (!cur || e.at > cur.at || (e.at === cur.at && (e.attempt ?? 0) > (cur.attempt ?? 0))) best.set(k, e)
  }
  const keep = new Set(best.values())
  return execs.filter((e) => keep.has(e))
}

/**
 * Números das entregas: uma entrega conta uma vez, com todas as tentativas (antes cada tentativa contava como
 * entrega, e um saque recusado com 6 tentativas virava "6 entregas · 6 falhas"). Entrega com sucesso = alguma
 * tentativa 2xx. avgMs: média de todas as tentativas; null sem nenhuma (nada medido, a tela mostra "—").
 */
export function deliveryStats(execs: WebhookExecution[], sinceMs: number) {
  const list = execs.filter((e) => new Date(e.at).getTime() >= sinceMs)
  const delivered = new Map<string, boolean>()
  for (const e of list) {
    const k = deliveryKey(e)
    delivered.set(k, delivered.get(k) === true || e.status === 'sucesso')
  }
  const total = delivered.size
  const ok = [...delivered.values()].filter(Boolean).length
  const avgMs = list.length ? Math.round(list.reduce((s, e) => s + e.durationMs, 0) / list.length) : null
  return { total, ok, failed: total - ok, attempts: list.length, rate: total ? ok / total : null, avgMs }
}
