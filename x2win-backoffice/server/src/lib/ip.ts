// Endereços IPv4 e faixas CIDR (lista de IPs permitidos do painel).

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

export function isIpv4(value: string): boolean {
  return IPV4.test(value)
}

/** Aceita "189.45.12.207" ou "189.45.12.0/24". */
export function isIpOrCidr(value: string): boolean {
  const [ip, bits, extra] = value.trim().split('/')
  if (extra !== undefined || !isIpv4(ip)) return false
  if (bits === undefined) return true
  if (!/^\d{1,2}$/.test(bits)) return false
  const n = Number(bits)
  return n >= 0 && n <= 32
}

function toInt(ip: string): number {
  return ip.split('.').reduce((acc, oct) => ((acc << 8) + Number(oct)) >>> 0, 0)
}

/** Remove o prefixo IPv6 de endereços IPv4 mapeados (::ffff:1.2.3.4). */
export function normalizeIp(ip: string | undefined | null): string {
  if (!ip) return ''
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip
}

export function ipMatches(ip: string, rule: string): boolean {
  const addr = normalizeIp(ip)
  if (!isIpv4(addr) || !isIpOrCidr(rule)) return false
  const [base, bitsStr] = rule.trim().split('/')
  const bits = bitsStr === undefined ? 32 : Number(bitsStr)
  if (bits === 0) return true
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0
  return (toInt(addr) & mask) === (toInt(base) & mask)
}

/** Lista vazia = sem restrição. */
export function ipAllowed(ip: string, allowlist: { value: string }[]): boolean {
  if (!allowlist.length) return true
  // sem exceção para 127.0.0.1: atrás de um proxy mal configurado todo acesso
  // pareceria local e furaria a lista
  const addr = normalizeIp(ip)
  return allowlist.some((r) => ipMatches(addr, r.value))
}
