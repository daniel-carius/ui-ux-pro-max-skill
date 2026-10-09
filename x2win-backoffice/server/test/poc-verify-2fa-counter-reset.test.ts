// Verificação independente: senha correta zera failed_logins e destrava a força bruta do TOTP.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { totpCode } from '../src/lib/totp'
import { api, cookieFrom, createTestApp, createUser } from './helpers'

let ipSeq = 0
const nextIp = () => {
  ipSeq++
  return `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`
}
// código que não está na janela ±1
const wrongCode = (secret: string) => {
  const now = Date.now()
  const valid = new Set([-30_000, 0, 30_000].map((d) => totpCode(secret, now + d)))
  let n = Number(totpCode(secret, now))
  let c: string
  do {
    n = (n + 123_457) % 1_000_000
    c = String(n).padStart(6, '0')
  } while (valid.has(c))
  return c
}

describe('verify: reset de failed_logins pelo login com senha', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => {
    await app.close()
  })

  it('200 códigos errados sem bloqueio nem auditoria; depois o código certo entra', async () => {
    const u = await createUser(app, { roleId: 'superadmin', totp: true })
    let wrong = 0
    let locks = 0
    for (let round = 0; round < 50; round++) {
      const ip = nextIp()
      const login = await api(app, 'POST', '/api/auth/login', { body: { email: u.email, password: u.password }, ip })
      expect(login.statusCode, login.body).toBe(200)
      expect(login.json().stage).toBe('2fa')
      const cookie = cookieFrom(login)!
      for (let i = 0; i < 4; i++) {
        const v = await api(app, 'POST', '/api/auth/2fa/verify', { cookie, body: { code: wrongCode(u.totpSecret!) }, ip })
        if (v.statusCode === 423) locks++
        expect(v.statusCode).toBe(401)
        wrong++
      }
    }
    const row = await app.db.one<{ failed_logins: number; locked_until: string | null }>('select failed_logins, locked_until from users where id = $1', [u.id])
    const audit = await app.db.query<{ action: string }>('select action from audit_log where actor_id = $1', [u.id])
    const sessions = await app.db.one<{ n: number }>('select count(*)::int as n from sessions where user_id = $1', [u.id])
    // "acerto" final
    const login = await api(app, 'POST', '/api/auth/login', { body: { email: u.email, password: u.password }, ip: nextIp() })
    const cookie = cookieFrom(login)!
    const ok = await api(app, 'POST', '/api/auth/2fa/verify', { cookie, body: { code: totpCode(u.totpSecret!, Date.now()) }, ip: nextIp() })
    console.log(`MULTI-IP: wrong=${wrong} locks=${locks} failed_logins=${row!.failed_logins} locked_until=${row!.locked_until} auditRowsBeforeSuccess=${audit.length} sessionsCreated=${sessions!.n} finalVerify=${ok.statusCode} ${ok.body}`)
    expect(locks).toBe(0)
    expect(row!.locked_until).toBeNull()
    expect(audit.length).toBe(0)
    expect(ok.statusCode).toBe(200)
  })

  it('um único IP: quantos códigos errados por minuto', async () => {
    const u = await createUser(app, { roleId: 'superadmin', totp: true })
    const ip = '10.99.0.1'
    let wrong = 0
    const statuses: number[] = []
    outer: for (let round = 0; round < 10; round++) {
      const login = await api(app, 'POST', '/api/auth/login', { body: { email: u.email, password: u.password }, ip })
      statuses.push(login.statusCode)
      if (login.statusCode !== 200) break
      const cookie = cookieFrom(login)!
      for (let i = 0; i < 4; i++) {
        const v = await api(app, 'POST', '/api/auth/2fa/verify', { cookie, body: { code: wrongCode(u.totpSecret!) }, ip })
        statuses.push(v.statusCode)
        if (v.statusCode === 429) break outer
        if (v.statusCode === 401) wrong++
      }
    }
    const row = await app.db.one<{ failed_logins: number; locked_until: string | null }>('select failed_logins, locked_until from users where id = $1', [u.id])
    console.log(`SINGLE-IP: wrong codes accepted for checking in one window=${wrong}; statuses=${statuses.join(',')}; failed_logins=${row!.failed_logins} locked_until=${row!.locked_until}`)
  })

  it('controle: sem novo login, o 5º código errado bloqueia', async () => {
    const u = await createUser(app, { roleId: 'superadmin', totp: true })
    const login = await api(app, 'POST', '/api/auth/login', { body: { email: u.email, password: u.password }, ip: nextIp() })
    const cookie = cookieFrom(login)!
    const st: number[] = []
    for (let i = 0; i < 5; i++) st.push((await api(app, 'POST', '/api/auth/2fa/verify', { cookie, body: { code: wrongCode(u.totpSecret!) }, ip: nextIp() })).statusCode)
    console.log(`CONTROL: statuses=${st.join(',')}`)
    expect(st[4]).toBe(423)
  })
})
