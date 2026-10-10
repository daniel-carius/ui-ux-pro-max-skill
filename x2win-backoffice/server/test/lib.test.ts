import { describe, expect, it } from 'vitest'
import { createCipher, hashPassword, passwordProblem, verifyPassword } from '../src/lib/crypto'
import { ipAllowed, ipMatches, isIpOrCidr } from '../src/lib/ip'
import * as totp from '../src/lib/totp'
import { base32Decode, base32Encode, newTotpSecret, totpCode, verifyTotp } from '../src/lib/totp'

describe('senha', () => {
  it('confere a senha certa e recusa a errada', async () => {
    const h = await hashPassword('senhaForte123')
    expect(h.startsWith('scrypt$')).toBe(true)
    expect(await verifyPassword('senhaForte123', h)).toBe(true)
    expect(await verifyPassword('senhaforte123', h)).toBe(false)
    expect(await verifyPassword('x', null)).toBe(false)
  })
  it('exige tamanho e letras + números', () => {
    expect(passwordProblem('curta1', 10)).toMatch(/10/)
    expect(passwordProblem('somenteletras', 10)).toMatch(/letras e números/)
    expect(passwordProblem('letras12345', 10)).toBeNull()
  })
})

describe('cifra', () => {
  it('cifra e decifra; recusa dado adulterado', () => {
    const c = createCipher(Buffer.alloc(32, 7).toString('base64'))
    const enc = c.encrypt('segredo')
    expect(enc).not.toContain('segredo')
    expect(c.decrypt(enc)).toBe('segredo')
    const parts = enc.split('.')
    parts[3] = Buffer.from('outro').toString('base64url')
    expect(() => c.decrypt(parts.join('.'))).toThrow()
  })
})

describe('TOTP', () => {
  it('bate com o vetor de teste da RFC 6238 (SHA1)', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'))
    expect(totpCode(secret, 59_000, 30, 8)).toBe('94287082')
    expect(totpCode(secret, 1111111109_000, 30, 8)).toBe('07081804')
  })
  it('aceita 1 passo de diferença e recusa códigos antigos', () => {
    const s = newTotpSecret()
    const t = 1_700_000_000_000
    expect(verifyTotp(s, totpCode(s, t), t)).not.toBeNull()
    expect(verifyTotp(s, totpCode(s, t - 30_000), t)).not.toBeNull()
    expect(verifyTotp(s, totpCode(s, t - 120_000), t)).toBeNull()
    expect(verifyTotp(s, 'abc', t)).toBeNull()
  })
  it('base32 vai e volta', () => {
    const b = Buffer.from('backoffice!')
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true)
  })
  // o gerador antigo (newRecoveryCodes, 40 bits por código) não era usado e podia voltar por engano: os códigos de
  // recuperação saem só de generateRecoveryCodes (modules/auth/service.ts, ≥ 80 bits, testado em auth-security)
  it('o módulo do TOTP não gera códigos de recuperação', () => {
    expect(Object.keys(totp).sort()).toEqual(['base32Decode', 'base32Encode', 'newTotpSecret', 'otpauthUrl', 'totpCode', 'verifyTotp'])
  })
})

describe('IP', () => {
  it('valida IP e CIDR', () => {
    expect(isIpOrCidr('189.45.12.207')).toBe(true)
    expect(isIpOrCidr('189.45.12.0/24')).toBe(true)
    expect(isIpOrCidr('189.45.12.0/33')).toBe(false)
    expect(isIpOrCidr('300.1.1.1')).toBe(false)
    expect(isIpOrCidr('abc')).toBe(false)
  })
  it('confere faixas', () => {
    expect(ipMatches('189.45.12.207', '189.45.12.0/24')).toBe(true)
    expect(ipMatches('189.45.13.1', '189.45.12.0/24')).toBe(false)
    expect(ipMatches('::ffff:10.0.0.5', '10.0.0.0/8')).toBe(true)
    expect(ipAllowed('1.2.3.4', [])).toBe(true)
    expect(ipAllowed('127.0.0.1', [{ value: '10.0.0.0/8' }])).toBe(false)
  })
})
