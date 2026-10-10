// TOTP (RFC 6238) para o 2FA: compatível com Google Authenticator, Authy, 1Password.
import { createHmac, randomBytes } from 'node:crypto'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = B32.indexOf(ch)
    if (idx < 0) throw new Error('Segredo base32 inválido')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** Novo segredo de 160 bits (padrão dos aplicativos autenticadores). */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

export function totpCode(secretB32: string, timeMs: number, step = 30, digits = 6): string {
  const counter = Math.floor(timeMs / 1000 / step)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const h = createHmac('sha1', base32Decode(secretB32)).update(buf).digest()
  const offset = h[h.length - 1] & 0xf
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3]
  return String(bin % 10 ** digits).padStart(digits, '0')
}

/**
 * Confere o código aceitando 1 passo de relógio para trás/frente.
 * Retorna o contador usado (para impedir reuso do mesmo código) ou null.
 */
export function verifyTotp(secretB32: string, code: string, timeMs: number = Date.now(), window = 1): number | null {
  const clean = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(clean)) return null
  const step = 30
  const base = Math.floor(timeMs / 1000 / step)
  for (let w = -window; w <= window; w++) {
    if (totpCode(secretB32, (base + w) * step * 1000) === clean) return base + w
  }
  return null
}

/** URL para o QR code do aplicativo autenticador. */
export function otpauthUrl(secretB32: string, account: string, issuer = 'X2Win Backoffice'): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}
