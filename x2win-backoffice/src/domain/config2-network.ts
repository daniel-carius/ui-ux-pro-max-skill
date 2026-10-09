// Regras de rede do painel (Configurações › Segurança do painel).
// Validação pura de IPv4 e faixas CIDR, checagem de bloqueio e de sobreposição.
// No back-end, a mesma lógica decide se um login é aceito.

export type AllowEntryKind = 'ip' | 'cidr'

export interface ParsedAllowEntry {
  ok: true
  kind: AllowEntryKind
  /** valor normalizado (sem espaços, /32 vira IP simples) */
  normalized: string
  /** endereço base como inteiro sem sinal */
  base: number
  prefix: number
  /** quantidade de endereços cobertos */
  size: number
  first: string
  last: string
  /** avisos que não impedem salvar */
  warnings: string[]
}

export interface AllowEntryError {
  ok: false
  error: string
  /** sugestão de correção, quando houver (ex.: endereço da rede) */
  suggestion?: string
}

export const MIN_CIDR_PREFIX = 16

/** Converte "189.45.12.207" em inteiro. Retorna null se não for IPv4 válido. */
export function parseIpv4(s: string): number | null {
  const parts = s.trim().split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    if (p.length > 1 && p.startsWith('0')) return null
    const v = Number(p)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n >>> 0
}

export function ipToString(n: number): string {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.')
}

function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
}

const PRIVATE_RANGES: [string, number, string][] = [
  ['10.0.0.0', 8, 'rede interna'],
  ['172.16.0.0', 12, 'rede interna'],
  ['192.168.0.0', 16, 'rede interna'],
  ['127.0.0.0', 8, 'endereço local (loopback)'],
  ['100.64.0.0', 10, 'NAT da operadora (CGNAT)'],
]

function privateKind(ip: number): string | null {
  for (const [base, prefix, label] of PRIVATE_RANGES) {
    const b = parseIpv4(base)!
    const m = maskOf(prefix)
    if ((ip & m) >>> 0 === (b & m) >>> 0) return label
  }
  return null
}

/**
 * Valida um item da lista de IPs permitidos: IP único ("189.45.12.207")
 * ou faixa CIDR ("189.45.12.0/24").
 */
export function parseAllowEntry(raw: string): ParsedAllowEntry | AllowEntryError {
  const s = raw.trim().replace(/\s+/g, '')
  if (!s) return { ok: false, error: 'Informe um IP ou uma faixa.' }
  if (s.includes(':')) return { ok: false, error: 'Só IPv4 por enquanto. IPv6 não é aceito nesta lista.' }
  const [ipPart, prefixPart, ...rest] = s.split('/')
  if (rest.length) return { ok: false, error: 'Formato inválido. Use 189.45.12.207 ou 189.45.12.0/24.' }
  const ip = parseIpv4(ipPart)
  if (ip === null) return { ok: false, error: 'IP inválido. Use quatro números de 0 a 255 separados por ponto.' }

  let prefix = 32
  if (prefixPart !== undefined) {
    if (!/^\d{1,2}$/.test(prefixPart)) return { ok: false, error: 'O tamanho da faixa vai de /16 a /32.' }
    prefix = Number(prefixPart)
    if (prefix > 32) return { ok: false, error: 'O tamanho da faixa vai de /16 a /32.' }
    if (prefix < MIN_CIDR_PREFIX)
      return {
        ok: false,
        error: `Faixa grande demais (/${prefix} cobre ${(2 ** (32 - prefix)).toLocaleString('pt-BR')} endereços). Use no mínimo /${MIN_CIDR_PREFIX}.`,
      }
  }
  const mask = maskOf(prefix)
  const network = (ip & mask) >>> 0
  if (network !== ip) {
    const fixed = `${ipToString(network)}/${prefix}`
    return { ok: false, error: `O endereço não é o início da faixa. Use ${fixed}.`, suggestion: fixed }
  }
  const size = 2 ** (32 - prefix)
  const warnings: string[] = []
  const priv = privateKind(ip)
  if (priv) warnings.push(`É um endereço de ${priv}. O painel enxerga o IP público da sua rede, então este item pode não liberar ninguém.`)
  if (prefix < 24) warnings.push(`A faixa libera ${size.toLocaleString('pt-BR')} endereços. Prefira faixas menores, como /24 ou /28.`)
  return {
    ok: true,
    kind: prefix === 32 ? 'ip' : 'cidr',
    normalized: prefix === 32 ? ipToString(ip) : `${ipToString(network)}/${prefix}`,
    base: network,
    prefix,
    size,
    first: ipToString(network),
    last: ipToString((network + size - 1) >>> 0),
    warnings,
  }
}

/** O IP está dentro do item (IP igual ou dentro da faixa)? */
export function ipMatchesEntry(ip: string, entry: string): boolean {
  const n = parseIpv4(ip)
  const e = parseAllowEntry(entry)
  if (n === null || !e.ok) return false
  return ((n & maskOf(e.prefix)) >>> 0) === e.base
}

/** Lista vazia libera qualquer IP; senão, o IP precisa estar em algum item. */
export function allowlistAllows(list: { value: string }[], ip: string): boolean {
  if (!list.length) return true
  return list.some((e) => ipMatchesEntry(ip, e.value))
}

/** A lista (depois da mudança) deixaria este IP de fora? */
export function wouldLockOut(listAfter: { value: string }[], ip: string): boolean {
  return listAfter.length > 0 && !allowlistAllows(listAfter, ip)
}

/** Item já coberto por outro da lista (igual ou dentro de uma faixa maior). */
export function coveredBy(value: string, list: { id?: string; value: string }[]): string | null {
  const e = parseAllowEntry(value)
  if (!e.ok) return null
  for (const other of list) {
    const o = parseAllowEntry(other.value)
    if (!o.ok) continue
    if (o.prefix <= e.prefix && ((e.base & maskOf(o.prefix)) >>> 0) === o.base) return other.value
  }
  return null
}

/** Sugere a faixa /24 de um IP (atalho "liberar a rede do escritório"). */
export function rangeOf24(ip: string): string | null {
  const n = parseIpv4(ip)
  if (n === null) return null
  return `${ipToString((n & maskOf(24)) >>> 0)}/24`
}
