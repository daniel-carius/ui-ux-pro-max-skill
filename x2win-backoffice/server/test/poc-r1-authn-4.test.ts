// PoC r1-authn-4: com sessão ativa, POST /api/auth/password confere currentPassword, mas o erro
// só devolve 401 — não chama registerFailure, então a conta nunca bloqueia. Com um cookie roubado,
// o endpoint vira um oráculo de senha limitado só pelo limite por IP (10/min, contornável trocando de IP).
// Comportamento seguro esperado: erros da senha atual contam para o mesmo bloqueio do login
// (5 erros → 423 conta_bloqueada). Este teste FALHA enquanto o bug existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { api, createTestApp, createUser, sessionCookie } from './helpers'

let ipSeq = 0
const nextIp = () => {
  ipSeq++
  return `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`
}

describe('PoC r1-authn-4: senha atual errada em /password não conta para o bloqueio', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => {
    await app.close()
  })

  it('erros seguidos de currentPassword bloqueiam a conta e impedem a troca', async () => {
    const victim = await createUser(app, { roleId: 'suporte' })
    const stolenCookie = await sessionCookie(app, victim.id, 'active')
    // outra sessão da vítima (o navegador legítimo)
    const ownerCookie = await sessionCookie(app, victim.id, 'active')

    const statuses: number[] = []
    for (let i = 0; i < 12; i++) {
      const r = await api(app, 'POST', '/api/auth/password', {
        cookie: stolenCookie,
        body: { currentPassword: `Chute${i}Errado99`, newPassword: 'Atacante2026XYZ' },
        ip: nextIp(),
      })
      statuses.push(r.statusCode)
    }
    const row = await app.db.one<{ failed_logins: number; locked_until: string | null }>(
      'select failed_logins, locked_until from users where id = $1',
      [victim.id],
    )
    console.log(`statuses=${JSON.stringify(statuses)} failed_logins=${row!.failed_logins} locked_until=${row!.locked_until}`)

    // palpite correto depois de 12 erros
    const hit = await api(app, 'POST', '/api/auth/password', {
      cookie: stolenCookie,
      body: { currentPassword: victim.password, newPassword: 'Atacante2026XYZ' },
      ip: nextIp(),
    })
    console.log(`correct guess after 12 wrong: status=${hit.statusCode} body=${hit.body}`)

    const ownerMe = await api(app, 'GET', '/api/auth/me', { cookie: ownerCookie })
    console.log(`owner's other session after attacker change: /me status=${ownerMe.statusCode}`)
    const oldLogin = await api(app, 'POST', '/api/auth/login', { body: { email: victim.email, password: victim.password }, ip: nextIp() })
    console.log(`owner login with old password: status=${oldLogin.statusCode}`)

    // comportamento seguro: algum dos erros deveria ter bloqueado a conta (423) e a troca não pode passar
    expect(statuses).toContain(423)
    expect(row!.locked_until).not.toBeNull()
    expect(hit.statusCode).not.toBe(200)
  })
})
