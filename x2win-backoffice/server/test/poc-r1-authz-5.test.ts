// PoC (r1-authz-5): the session stage is decided only at login / password change.
// When the 2FA requirement starts to apply to a person who has no 2FA (promotion to a
// require_2fa role, require2fa switched on for their role, enforce_2fa_all switched on),
// their already-open 'active' session keeps working with no enrolment.
// The first three tests assert the SECURE behaviour (stage drops to 'enroll' / API 403),
// so they FAIL while the behaviour exists. The last test is informational: it shows that a
// session in 'enroll' can self-enrol without re-entering the password.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Role } from '@shared/permissions'
import { totpCode } from '../src/lib/totp'
import { api, createTestApp, loginAs, sessionCookie, createUser } from './helpers'

async function setRequire2fa(app: FastifyInstance, admin: string, roleId: string, on: boolean) {
  const cur = await api(app, 'GET', '/api/kv/cargos.lista', { cookie: admin })
  expect(cur.statusCode).toBe(200)
  const body = cur.json() as { value: Role[]; version: number }
  const value = body.value.map((r) => (r.id === roleId ? { ...r, require2fa: on } : r))
  const w = await api(app, 'PUT', '/api/kv/cargos.lista', { cookie: admin, body: { value, version: body.version } })
  expect(w.statusCode).toBe(200)
}

describe('poc r1-authz-5: 2FA requirement not re-checked for open sessions', () => {
  let app: FastifyInstance
  let admin: string

  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app, 'superadmin')).cookie
  })
  afterAll(async () => app.close())

  it('promotion to a require_2fa role: old suporte session should not stay active', async () => {
    const { user, cookie } = await loginAs(app, 'suporte')
    const before = await api(app, 'GET', '/api/kv/config.gateways', { cookie })
    console.log('[promo] suporte GET config.gateways before promotion ->', before.statusCode)
    const directBefore = await api(app, 'POST', '/api/team/direct', {
      cookie,
      body: { name: 'Antes da Promocao', email: `poc5-before-${Date.now()}@teste.x2win`, roleId: 'suporte' },
    })
    console.log('[promo] suporte POST /api/team/direct before promotion ->', directBefore.statusCode)
    expect(directBefore.statusCode).toBe(403)

    await setRequire2fa(app, admin, 'administrador', true)
    const promo = await api(app, 'POST', `/api/team/${user.id}/role`, { cookie: admin, body: { roleId: 'administrador' } })
    console.log('[promo] POST /api/team/:id/role ->', promo.statusCode)
    expect(promo.statusCode).toBe(200)

    const me = await api(app, 'GET', '/api/auth/me', { cookie })
    const m = me.json() as { stage: string; user?: { roleId?: string; twoFactor?: boolean }; role?: { id: string; require2fa: boolean } }
    console.log('[promo] /me after promotion ->', me.statusCode, JSON.stringify({ stage: m.stage, user: m.user, role: m.role && { id: m.role.id, require2fa: m.role.require2fa } }))
    const gw = await api(app, 'GET', '/api/kv/config.gateways', { cookie })
    console.log('[promo] GET config.gateways with old cookie ->', gw.statusCode)
    const direct = await api(app, 'POST', '/api/team/direct', {
      cookie,
      body: { name: 'Conta Criada Pelo Cookie', email: `poc5-${Date.now()}@teste.x2win`, roleId: 'suporte' },
    })
    console.log('[promo] POST /api/team/direct with old cookie ->', direct.statusCode, direct.statusCode === 200 ? 'temporaryPassword present: ' + !!direct.json().temporaryPassword : direct.body)
    await setRequire2fa(app, admin, 'administrador', false)

    // secure behaviour: the session must enrol 2FA before using the new role
    expect(m.stage).toBe('enroll')
    expect(gw.statusCode).toBe(403)
    expect(direct.statusCode).toBe(403)
  })

  it('require2fa switched on for the current role: open session should be forced to enrol', async () => {
    const { cookie } = await loginAs(app, 'financeiro')
    await setRequire2fa(app, admin, 'financeiro', true)
    const me = await api(app, 'GET', '/api/auth/me', { cookie })
    const r = await api(app, 'GET', '/api/kv/config.gateways', { cookie })
    console.log('[toggle] /me stage ->', me.json().stage, '| GET config.gateways ->', r.statusCode)
    await setRequire2fa(app, admin, 'financeiro', false)
    expect(me.json().stage).toBe('enroll')
  })

  it('enforce_2fa_all switched on: open session should be forced to enrol', async () => {
    const { cookie } = await loginAs(app, 'suporte')
    await app.db.query('update panel_security set enforce_2fa_all = true where id = 1')
    const me = await api(app, 'GET', '/api/auth/me', { cookie })
    console.log('[enforceAll] /me stage ->', me.json().stage)
    await app.db.query('update panel_security set enforce_2fa_all = false where id = 1')
    expect(me.json().stage).toBe('enroll')
  })

  it('(informational) a cookie in enroll stage self-enrols its own TOTP without the password', async () => {
    const u = await createUser(app, { roleId: 'marketing-oficial' }) // require2fa: true in seed
    const cookie = await sessionCookie(app, u.id, 'enroll')
    const setup = await api(app, 'POST', '/api/auth/2fa/setup', { cookie })
    expect(setup.statusCode).toBe(200)
    const { secret } = setup.json() as { secret: string }
    const en = await api(app, 'POST', '/api/auth/2fa/enable', { cookie, body: { code: totpCode(secret, Date.now()) } })
    console.log('[info] enroll-stage cookie: setup ->', setup.statusCode, '| enable ->', en.statusCode, JSON.stringify({ stage: en.json().stage }))
    expect(en.json().stage).toBe('active')
  })
})
