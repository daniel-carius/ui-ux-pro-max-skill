// PoC: uma sessão 'active' roubada (só o cookie, sem a senha) consegue cadastrar o
// autenticador do atacante (2FA setup/enable) sem reautenticação. O teste afirma o
// comportamento seguro, então FALHA enquanto o problema existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { totpCode } from '../src/lib/totp'
import { api, cookieFrom, createTestApp, createUser, sessionCookie } from './helpers'

describe('poc-r1-authz-10: 2FA enrolment from a stolen active session', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => {
    await app.close()
  })

  it('requires re-authentication (current password) before binding a new authenticator', async () => {
    // vítima: Administrador sem 2FA (o cargo seed não exige 2FA)
    const victim = await createUser(app, { roleId: 'administrador', password: 'SenhaDaVitima2026' })
    const stolenCookie = await sessionCookie(app, victim.id, 'active', '10.0.0.5')

    // atacante só tem o cookie; não manda senha nenhuma
    const setup = await api(app, 'POST', '/api/auth/2fa/setup', { cookie: stolenCookie, body: {}, ip: '203.0.113.66' })
    console.log('[poc] setup status', setup.statusCode, 'has secret:', !!setup.json().secret)

    let enableStatus = -1
    let recoveryCodes: string[] = []
    let victimStageAfter = 'n/a'
    let victimSetupAgain = -1
    let attackerFullLogin = 'n/a'
    if (setup.statusCode === 200) {
      const attackerSecret: string = setup.json().secret
      const enable = await api(app, 'POST', '/api/auth/2fa/enable', {
        cookie: stolenCookie,
        body: { code: totpCode(attackerSecret, Date.now()) },
        ip: '203.0.113.66',
      })
      enableStatus = enable.statusCode
      recoveryCodes = enable.json().recoveryCodes ?? []
      console.log('[poc] enable status', enable.statusCode, 'stage', enable.json().stage, 'recoveryCodes', recoveryCodes.length)

      const row = await app.db.one<{ totp_enabled: boolean }>('select totp_enabled from users where id = $1', [victim.id])
      console.log('[poc] victim totp_enabled after attacker enable:', row?.totp_enabled)

      // vítima entra de novo com a própria senha: fica presa na etapa '2fa'
      const vLogin = await api(app, 'POST', '/api/auth/login', { body: { email: victim.email, password: victim.password }, ip: '10.0.0.5' })
      victimStageAfter = vLogin.json().stage
      console.log('[poc] victim login status', vLogin.statusCode, 'stage', victimStageAfter)

      // vítima (sessão ativa original) não consegue recadastrar sozinha
      const vSetup = await api(app, 'POST', '/api/auth/2fa/setup', { cookie: stolenCookie, body: {}, ip: '10.0.0.5' })
      victimSetupAgain = vSetup.statusCode
      console.log('[poc] victim re-setup status', vSetup.statusCode, vSetup.json().error ?? vSetup.json().code ?? '')

      // atacante, mais tarde, com senha phished + o próprio TOTP: login completo
      const aLogin = await api(app, 'POST', '/api/auth/login', { body: { email: victim.email, password: victim.password }, ip: '203.0.113.66' })
      const aCookie = cookieFrom(aLogin)!
      const aVerify = await api(app, 'POST', '/api/auth/2fa/verify', {
        cookie: aCookie,
        body: { code: recoveryCodes[0] },
        ip: '203.0.113.66',
      })
      attackerFullLogin = `${aVerify.statusCode} ${aVerify.json().stage}`
      console.log('[poc] attacker 2fa/verify with kept recovery code:', attackerFullLogin)
    }

    // comportamento seguro esperado: sem a senha atual, o cadastro do 2FA numa sessão 'active' é recusado
    expect(setup.statusCode).not.toBe(200)
    expect(enableStatus).not.toBe(200)
    expect(recoveryCodes).toHaveLength(0)
  })
})
