// Criptografia com a biblioteca nativa do Node (sem dependências).
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>

// N=2^15, r=8, p=1: ~32 MB de memória por cálculo, custo adequado para login
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const KEY_LEN = 64

/** Hash de senha no formato scrypt$N$r$p$salt$hash (base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(password.normalize('NFKC'), salt, KEY_LEN, SCRYPT)
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // gasta o mesmo tempo para não revelar se o usuário existe
    await scrypt(password, randomBytes(16), KEY_LEN, SCRYPT)
    return false
  }
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$')
  if (alg !== 'scrypt') return false
  const expected = Buffer.from(hashB64, 'base64')
  const got = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  })
  return got.length === expected.length && timingSafeEqual(got, expected)
}

/** Token aleatório seguro, em base64url. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** Identificador curto e aleatório com prefixo (ex.: "u_3kf9..."). */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function hmacSha256(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex')
}

/** Comparação em tempo constante de textos. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/**
 * Cifra AES-256-GCM. Formato: v1.<iv>.<tag>.<dados> (base64url).
 * A chave vem de ENCRYPTION_KEY (32 bytes em base64).
 */
export function createCipher(keyB64: string) {
  const key = Buffer.from(keyB64, 'base64')
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY precisa ter 32 bytes')
  return {
    encrypt(plain: string): string {
      const iv = randomBytes(12)
      const c = createCipheriv('aes-256-gcm', key, iv)
      const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
      return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
    },
    decrypt(payload: string): string {
      const [v, iv, tag, data] = payload.split('.')
      if (v !== 'v1') throw new Error('Formato de dado cifrado desconhecido')
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
      d.setAuthTag(Buffer.from(tag, 'base64url'))
      return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8')
    },
  }
}

export type Cipher = ReturnType<typeof createCipher>

/** Senha temporária legível (sem caracteres ambíguos), para "Criar acesso direto". */
export function temporaryPassword(length = 14): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

/** Regra mínima de senha forte. Retorna a mensagem do problema ou null. */
export function passwordProblem(password: string, minLength: number): string | null {
  if (password.length < minLength) return `A senha precisa de pelo menos ${minLength} caracteres.`
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return 'Use letras e números na senha.'
  return null
}
