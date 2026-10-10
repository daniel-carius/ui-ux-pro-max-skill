// Endereços de destino dos webhooks: validação ao gravar e proteção contra SSRF
// no envio (modo estrito: só https e só hosts públicos, conferidos na própria conexão).
import dns from 'node:dns'
import { lookup } from 'node:dns/promises'
import { isIP, type LookupFunction } from 'node:net'

export const WEBHOOK_EVENTS = ['saque.solicitado', 'saque.pago', 'saque.rejeitado', 'saque.expirado', 'deposito.primeiro'] as const
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

export const WEBHOOK_EVENT_LABEL: Record<WebhookEvent, string> = {
  'saque.solicitado': 'Saque solicitado',
  'saque.pago': 'Saque pago',
  'saque.rejeitado': 'Saque rejeitado',
  'saque.expirado': 'Saque expirado',
  'deposito.primeiro': 'Primeiro depósito',
}

export function isWebhookEvent(v: unknown): v is WebhookEvent {
  return typeof v === 'string' && (WEBHOOK_EVENTS as readonly string[]).includes(v)
}

/**
 * Destinos de demonstração (src/domain/webhooks.ts › seedWebhookDestinations e seed.ts): hosts de terceiros e
 * segredos publicados no bundle do painel. Nunca viram destino real por uma gravação da tela (ex.: o painel
 * mostrou o seed depois de uma leitura que falhou e mandou a lista de volta).
 */
export const DEMO_WEBHOOK_HOSTS = ['hooks.x2win-crm.com', 'api.leadflow.app'] as const
export const DEMO_SECRET_PATTERN = /^DEMO-hmac-/i

/** URL aponta para um host de demonstração (ou subdomínio dele). */
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
 * Proteção estrita contra SSRF (só https, só host público, DNS conferido na conexão).
 * Fica LIGADA por padrão: não depende de NODE_ENV=production (que pode faltar num
 * `npm start` fora do Docker). Só desliga nos testes automatizados (NODE_ENV=test) ou
 * com a liberação explícita WEBHOOK_ALLOW_LOCAL_TARGETS=true (desenvolvimento local).
 */
export function webhookStrictMode(config: { NODE_ENV: string; WEBHOOK_ALLOW_LOCAL_TARGETS?: boolean | string }): boolean {
  const allowLocal = config.WEBHOOK_ALLOW_LOCAL_TARGETS === true || config.WEBHOOK_ALLOW_LOCAL_TARGETS === 'true'
  return !(config.NODE_ENV === 'test' || allowLocal)
}

const stripBrackets = (h: string) => h.replace(/^\[|\]$/g, '')

/** localhost e 127.0.0.1 (aceitos via http fora do modo estrito, para testes). */
export function isLoopbackTestHost(hostname: string): boolean {
  const h = stripBrackets(hostname).toLowerCase()
  return h === 'localhost' || h === '127.0.0.1'
}

function ipv4ToInt(ip: string) {
  return ip.split('.').reduce((acc, o) => ((acc << 8) + Number(o)) >>> 0, 0)
}

const PRIVATE_V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

/** Endereço IP de rede interna, loopback, link-local, reservado ou multicast. */
export function isPrivateIp(raw: string): boolean {
  const ip = stripBrackets(raw).toLowerCase()
  const v = isIP(ip)
  if (v === 4) {
    const n = ipv4ToInt(ip)
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0
      return (n & mask) === (ipv4ToInt(base) & mask)
    })
  }
  if (v === 6) {
    if (ip === '::' || ip === '::1') return true
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateIp(mapped[1])
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(ip)) return true // IPv4 mapeado em hexa: trata como interno
    if (/^(fc|fd)/.test(ip)) return true // ULA fc00::/7
    if (/^fe[89ab]/.test(ip)) return true // link-local fe80::/10
    if (/^ff/.test(ip)) return true // multicast
    if (/^64:ff9b:/.test(ip)) return true // NAT64
    if (/^2001:db8:/.test(ip)) return true // documentação
    return false
  }
  return false
}

/** Nome de host que não é público (sem precisar resolver DNS). */
export function isPrivateHostname(hostname: string): boolean {
  const h = stripBrackets(hostname).toLowerCase().replace(/\.$/, '')
  if (isIP(h)) return isPrivateIp(h)
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true
  return !h.includes('.')
}

/**
 * Valida o endereço do destino. Retorna a mensagem do problema ou null.
 * Modo estrito (padrão, ver `webhookStrictMode`): só https e host público. Fora dele:
 * https em qualquer host, ou http apenas para localhost/127.0.0.1 (testes).
 */
export function webhookUrlProblem(raw: string, strict: boolean): string | null {
  const v = (raw ?? '').trim()
  if (!v) return 'Informe o endereço do destino.'
  if (v.length > 500) return 'Endereço longo demais (máximo de 500 caracteres).'
  if (/\s/.test(v)) return 'O endereço não pode ter espaços.'
  let u: URL
  try {
    u = new URL(v)
  } catch {
    return 'Endereço inválido. Confira o domínio e o caminho.'
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Comece o endereço com https://'
  if (u.username || u.password) return 'Não coloque usuário e senha no endereço. Use a assinatura HMAC.'
  if (u.hash) return 'O endereço não pode ter âncora (#).'
  if (strict) {
    if (u.protocol !== 'https:') return 'Use https://. Envio por http deixa os dados do jogador expostos na rede.'
    if (isPrivateHostname(u.hostname)) return 'Use um endereço público. Localhost e rede interna não recebem envios.'
  } else if (u.protocol === 'http:' && !isLoopbackTestHost(u.hostname)) {
    return 'Use https://. http só é aceito para localhost/127.0.0.1 em ambiente de teste.'
  }
  return null
}

export const INTERNAL_TARGET_MESSAGE = 'O endereço do destino aponta para rede interna; envio bloqueado.'

/**
 * Checagem antes do envio. No modo estrito também resolve o DNS e recusa se o
 * nome apontar para rede interna. Só dá a mensagem clara cedo: quem garante que a
 * conexão não vai para rede interna é o `safeLookup` usado pela própria conexão
 * (o DNS pode mudar entre esta checagem e o envio).
 */
export async function webhookTargetProblem(raw: string, strict: boolean): Promise<string | null> {
  const problem = webhookUrlProblem(raw, strict)
  if (problem || !strict) return problem
  const host = stripBrackets(new URL(raw.trim()).hostname)
  if (isIP(host)) return null // já conferido acima
  try {
    const addrs = await lookup(host, { all: true, verbatim: true })
    if (!addrs.length) return 'Não foi possível resolver o endereço do destino.'
    if (addrs.some((a) => isPrivateIp(a.address))) return INTERNAL_TARGET_MESSAGE
  } catch {
    return 'Não foi possível resolver o endereço do destino.'
  }
  return null
}

/** Código do erro de `safeLookup` quando o nome resolve para rede interna. */
export const BLOCKED_PRIVATE_CODE = 'EBLOCKED_PRIVATE'

/**
 * `lookup` da conexão do envio (net/tls): resolve o nome UMA vez, recusa se qualquer
 * endereço da resposta for interno e entrega à conexão exatamente os endereços
 * conferidos. Assim a checagem e a conexão usam o mesmo resultado de DNS (sem
 * janela para DNS rebinding).
 */
export const safeLookup: LookupFunction = (hostname, options, callback) => {
  // `dns.lookup` lido na hora da chamada (não fixado no import)
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0)
    const list = Array.isArray(addresses) ? addresses : []
    if (!list.length) {
      const e: NodeJS.ErrnoException = Object.assign(new Error(`Sem endereço para ${hostname}`), { code: 'ENOTFOUND' })
      return callback(e, '', 0)
    }
    if (list.some((a) => isPrivateIp(a.address))) {
      const e: NodeJS.ErrnoException = Object.assign(new Error(`${hostname} resolve para rede interna`), { code: BLOCKED_PRIVATE_CODE })
      return callback(e, '', 0)
    }
    if (options.all) return callback(null, list)
    return callback(null, list[0].address, list[0].family)
  })
}

/** Só o host (para resumos de auditoria sem expor tokens do caminho). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return '(endereço inválido)'
  }
}
