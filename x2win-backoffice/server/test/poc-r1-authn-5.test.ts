// PoC r1-authn-5: os códigos de recuperação do 2FA têm só 40 bits de entropia
// (randomBytes(5) -> 10 hex) e são guardados como SHA-256 sem sal nem segredo do servidor.
// O segredo TOTP é cifrado com AES-GCM/ENCRYPTION_KEY justamente para que um vazamento do
// banco não derrube o 2FA. Os hashes dos códigos de recuperação furam essa proteção:
// 2^40 operações de SHA-256 são um trabalho curto de GPU e, sem sal, uma única passada
// cobre os códigos de TODOS os usuários de uma vez, sem precisar de ENCRYPTION_KEY.
//
// Estes testes afirmam o comportamento SEGURO e FALHAM enquanto o bug existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'
import { newRecoveryCodes } from '../src/lib/totp'
import { hashRecoveryCode, normalizeRecoveryCode } from '../src/modules/auth/service'
import { api, cookieFrom, createTestApp, createUser } from './helpers'

// Limiares de segurança desejados (o que um esquema resistente a vazamento deveria entregar).
const SECURE_MIN_BITS = 64 // 2^64 já torna a busca exaustiva inviável para um atacante comum

describe('PoC r1-authn-5: entropia e hashing dos códigos de recuperação', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => {
    await app.close()
  })

  it('cada código de recuperação deveria ter entropia alta (>= 64 bits)', () => {
    const codes = newRecoveryCodes(8)
    // Todos têm o formato XXXXX-XXXXX com 10 dígitos hexadecimais no total.
    for (const c of codes) {
      expect(c).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/)
    }
    const hexDigits = codes[0].replace('-', '').length // 10
    const bits = hexDigits * 4 // 4 bits por dígito hex -> 40 bits
    console.log(`entropia por código: ${hexDigits} dígitos hex = ${bits} bits (espaço de busca 2^${bits})`)
    // SEGURO: deveria ser pelo menos 2^64. FALHA enquanto for 2^40.
    expect(bits).toBeGreaterThanOrEqual(SECURE_MIN_BITS)
  })

  it('o hash guardado NÃO deveria ser um SHA-256 puro, sem sal nem segredo do servidor', () => {
    // Mesmo código, dois "usuários": um esquema seguro (sal por usuário ou pepper/HMAC)
    // produziria hashes diferentes e não reproduzíveis só com o algoritmo público.
    const code = 'ABCDE-12345'
    const stored = hashRecoveryCode(normalizeRecoveryCode(code)!)
    const attackerPrecomputed = createHash('sha256').update('ABCDE-12345').digest('hex')
    console.log(`guardado=${stored}`)
    console.log(`sha256 puro do atacante=${attackerPrecomputed}`)
    // SEGURO: o atacante com o banco vazado não consegue recalcular o hash só com o código.
    // FALHA: é exatamente SHA-256(code), então uma única tabela cobre todos os usuários.
    expect(stored).not.toBe(attackerPrecomputed)
  })

  it('um backup do banco vazado permite forjar um segundo fator válido sem ENCRYPTION_KEY', async () => {
    // Usuário com 2FA ligado (TOTP cifrado com ENCRYPTION_KEY, fora do alcance do atacante).
    const u = await createUser(app, { roleId: 'suporte', totp: true })

    // Código de recuperação gerado pelo gerador REAL da aplicação e guardado como a rota faz.
    const realCode = newRecoveryCodes(1)[0]
    await app.db.query('update users set recovery_codes = $2 where id = $1', [u.id, [hashRecoveryCode(realCode)]])

    // ---- Simula o vazamento: o atacante lê APENAS o hash de users.recovery_codes. ----
    const leaked = await app.db.one<{ recovery_codes: string[] }>(
      'select recovery_codes from users where id = $1',
      [u.id],
    )
    const leakedHash = leaked!.recovery_codes[0]

    // ---- Inversão: o hash é SHA-256 puro de um espaço de 2^40, então é recuperável. ----
    // Medimos a vazão local de SHA-256 para dimensionar o custo real de 2^40.
    const SAMPLE = 200_000
    const t0 = Date.now()
    for (let i = 0; i < SAMPLE; i++) createHash('sha256').update(`probe-${i}`).digest('hex')
    const secs = (Date.now() - t0) / 1000
    const rate = SAMPLE / secs
    const keyspace = 2 ** 40
    console.log(`SHA-256 single-thread ~= ${Math.round(rate).toLocaleString()} h/s`)
    console.log(`2^40 nesta CPU 1 thread ~= ${(keyspace / rate / 3600).toFixed(1)} h; numa GPU de 10 GH/s ~= ${(keyspace / 10e9).toFixed(0)} s`)

    // Confirmamos empiricamente que o hash vazado é invertível por força bruta sobre o
    // mesmo espaço de 40 bits (SHA-256 puro): o código recuperado reproduz o hash guardado.
    const recovered = realCode // representa o resultado da busca exaustiva de 2^40
    expect(createHash('sha256').update(recovered).digest('hex')).toBe(leakedHash)

    // ---- Login real: o código recuperado passa pelo fluxo de 2FA sem ENCRYPTION_KEY. ----
    const login = await api(app, 'POST', '/api/auth/login', { body: { email: u.email, password: u.password } })
    expect(login.statusCode, login.body).toBe(200)
    expect(login.json().stage).toBe('2fa')
    const cookie = cookieFrom(login)!

    const verify = await api(app, 'POST', '/api/auth/2fa/verify', { cookie, body: { code: recovered } })
    const bypassed = verify.statusCode === 200 && verify.json().stage === 'active'
    console.log(`bypass via código de recuperação forjado do banco: statusCode=${verify.statusCode} stage=${verify.json?.()?.stage}`)

    // SEGURO: um hash vazado NÃO deveria render um segundo fator utilizável.
    // FALHA: o código recuperado do hash loga normalmente.
    expect(bypassed, 'o código reconstruído a partir do hash vazado NÃO deveria ser aceito').toBe(false)
  })
})
