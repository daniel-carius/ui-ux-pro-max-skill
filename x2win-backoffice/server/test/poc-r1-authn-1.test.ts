// PoC r1-authn-1: o login com senha correta zera a contagem compartilhada com os erros do 2FA,
// então quem sabe a senha pode errar o código indefinidamente (4 erros + novo login, repetir).
// Contrato (docs/API.md): "Erro conta como tentativa errada (mesmo bloqueio do login)" e
// "5 erros seguidos bloqueiam por 15 min". Este teste afirma o comportamento seguro e FALHA enquanto o bug existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { totpCode } from '../src/lib/totp'
import { api, cookieFrom, createTestApp, createUser } from './helpers'

let ipSeq = 0
const nextIp = () => {
  ipSeq++
  return `10.88.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`
}

const wrongCode = (secret: string) => String((Number(totpCode(secret, Date.now())) + 500_000) % 1_000_000).padStart(6, '0')

describe('PoC r1-authn-1: senha correta zera os erros do 2FA', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => {
    await app.close()
  })

  it('erros de código do 2FA intercalados com logins de senha correta acabam bloqueando a conta', async () => {
    const u = await createUser(app, { roleId: 'suporte', totp: true })
    const statuses: number[] = []
    let sawLock = false

    for (let round = 0; round < 5 && !sawLock; round++) {
      const login = await api(app, 'POST', '/api/auth/login', { body: { email: u.email, password: u.password }, ip: nextIp() })
      statuses.push(login.statusCode)
      if (login.statusCode === 423) {
        sawLock = true
        break
      }
      expect(login.statusCode, login.body).toBe(200)
      expect(login.json().stage).toBe('2fa')
      const cookie = cookieFrom(login)!
      for (let i = 0; i < 4; i++) {
        const v = await api(app, 'POST', '/api/auth/2fa/verify', { cookie, body: { code: wrongCode(u.totpSecret!) }, ip: nextIp() })
        statuses.push(v.statusCode)
        if (v.statusCode === 423) {
          sawLock = true
          break
        }
      }
      const row = await app.db.one<{ failed_logins: number; locked_until: string | null }>(
        'select failed_logins, locked_until from users where id = $1',
        [u.id],
      )
      console.log(`round ${round + 1}: failed_logins=${row!.failed_logins} locked_until=${row!.locked_until}`)
    }

    const row = await app.db.one<{ failed_logins: number; locked_until: string | null }>(
      'select failed_logins, locked_until from users where id = $1',
      [u.id],
    )
    const audit = await app.db.query<{ action: string }>('select action from audit_log where actor_id = $1', [u.id])
    const wrongCodes = statuses.filter((s) => s === 401).length
    console.log(
      `wrong codes accepted as plain 401: ${wrongCodes}; end state failed_logins=${row!.failed_logins} locked_until=${row!.locked_until}; audit rows=${audit.length}; statuses=${statuses.join(',')}`,
    )

    // seguro: no máximo 5 códigos errados seguidos antes do 423 conta_bloqueada
    expect(sawLock, `${wrongCodes} códigos errados sem bloqueio`).toBe(true)
    expect(row!.locked_until).not.toBeNull()
    expect(audit.some((a) => a.action === 'bloquear')).toBe(true)
  })
})
