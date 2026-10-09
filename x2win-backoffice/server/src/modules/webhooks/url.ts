// Endereços de destino dos webhooks: validação ao gravar e proteção contra SSRF
// no envio (em produção: só https e só hosts públicos).
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

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

const stripBrackets = (h: string) => h.replace(/^\[|\]$/g, '')

/** localhost e 127.0.0.1 (aceitos via http fora de produção, para testes). */
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
 * Produção: só https e host público. Fora de produção: https em qualquer host,
 * ou http apenas para localhost/127.0.0.1 (testes).
 */
export function webhookUrlProblem(raw: string, production: boolean): string | null {
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
  if (production) {
    if (u.protocol !== 'https:') return 'Use https://. Envio por http deixa os dados do jogador expostos na rede.'
    if (isPrivateHostname(u.hostname)) return 'Use um endereço público. Localhost e rede interna não recebem envios.'
  } else if (u.protocol === 'http:' && !isLoopbackTestHost(u.hostname)) {
    return 'Use https://. http só é aceito para localhost/127.0.0.1 fora de produção.'
  }
  return null
}

/**
 * Checagem no momento do envio. Em produção também resolve o DNS e recusa se o
 * nome apontar para rede interna (evita SSRF por DNS).
 */
export async function webhookTargetProblem(raw: string, production: boolean): Promise<string | null> {
  const problem = webhookUrlProblem(raw, production)
  if (problem || !production) return problem
  const host = stripBrackets(new URL(raw.trim()).hostname)
  if (isIP(host)) return null // já conferido acima
  try {
    const addrs = await lookup(host, { all: true, verbatim: true })
    if (!addrs.length) return 'Não foi possível resolver o endereço do destino.'
    if (addrs.some((a) => isPrivateIp(a.address))) return 'O endereço do destino aponta para rede interna; envio bloqueado.'
  } catch {
    return 'Não foi possível resolver o endereço do destino.'
  }
  return null
}

/** Só o host (para resumos de auditoria sem expor tokens do caminho). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return '(endereço inválido)'
  }
}
