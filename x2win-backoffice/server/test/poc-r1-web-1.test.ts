// PoC R1-WEB-1: a percent-encoded "/api" prefix must NOT bypass the global
// onRequest hook (panel IP allowlist + CSRF header check) in security.ts.
// This test asserts the SECURE behaviour: encoded-prefix paths get the same
// 403 ip_nao_autorizado / CSRF treatment as the normal path. It FAILS while
// the bug exists (the encoded path reaches the real route).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestApp, createUser, sessionCookie } from './helpers'
import { invalidateAllowlistCache } from '../src/plugins/security'
import { SECURITY } from '../src/config'

const OFFICE = '203.0.113.0/24' // allowlisted office range
const ATTACKER = '198.51.100.7' // NOT in the allowlist

describe('R1-WEB-1: encoded /api prefix must not bypass allowlist + CSRF', () => {
  let app: FastifyInstance
  let cookie: string

  beforeAll(async () => {
    app = await createTestApp()
    // superadmin with a valid active session (stolen/off-site credentials)
    const u = await createUser(app, { roleId: 'superadmin' })
    cookie = await sessionCookie(app, u.id)
    // operator restricts the panel to office IPs (audit item #3)
    await app.db.query(
      `update panel_security set allowlist = $1::jsonb where id = 1`,
      [JSON.stringify([{ id: 'ip-office', value: OFFICE, label: 'Office' }])],
    )
    invalidateAllowlistCache()
  })
  afterAll(async () => app.close())

  // helper that injects a raw URL (no automatic /api normalisation), with the
  // CSRF header present, from the attacker's off-site IP.
  function inj(method: 'GET' | 'POST', url: string, withCsrf = true) {
    return app.inject({
      method,
      url,
      remoteAddress: ATTACKER,
      headers: {
        cookie,
        ...(withCsrf ? { [SECURITY.csrfHeader]: SECURITY.csrfValue } : {}),
      },
    })
  }

  it('baseline: normal /api path from a non-allowlisted IP is 403', async () => {
    const r = await inj('GET', '/api/auth/me')
    expect(r.statusCode).toBe(403)
    expect(r.json().error.code).toBe('ip_nao_autorizado')
  })

  it('allowlist: encoded-prefix read (/%61pi/auth/me) must also be blocked', async () => {
    const r = await inj('GET', '/%61pi/auth/me')
    // secure: either blocked by the allowlist (403) or simply not routed (404).
    // insecure (bug): the route runs and returns 200 with the user payload.
    expect(r.statusCode).not.toBe(200)
  })

  it('CSRF: body-less POST on encoded prefix without X-Requested-With must be rejected', async () => {
    // /%61pi/auth/logout -> would revoke the session on 204 if it reaches the route
    const r = await inj('POST', '/%61pi/auth/logout', /* withCsrf */ false)
    // secure: 403 (ip or csrf). insecure: 204 No Content (logout succeeded).
    expect(r.statusCode).not.toBe(204)
  })
})
