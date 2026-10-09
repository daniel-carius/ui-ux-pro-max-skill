// Verification PoC for reviewer claim: a percent-encoded "/api" prefix skips the
// onRequest hook in security.ts, bypassing BOTH the panel IP allowlist and the
// CSRF (X-Requested-With) header check. find-my-way decodes "%61"->"a" and routes
// the request to the real /api/* handler, but the hook's gate is `req.url.startsWith('/api/')`,
// and req.url is still the raw encoded "/%61pi/...", so the gate returns early.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { invalidateAllowlistCache } from '../src/plugins/security'
import { api, createTestApp, loginAs } from './helpers'

const OUTSIDE = '203.0.113.50' // not in the office range below

describe('PoC: encoded /api prefix bypasses security onRequest hook', () => {
  let app: FastifyInstance
  let cookie: string
  beforeAll(async () => {
    app = await createTestApp()
    cookie = (await loginAs(app, 'superadmin')).cookie
    // operator restricts the panel to an office range (documented guarantee)
    await app.db.query(`update panel_security set allowlist = $1::jsonb where id = 1`, [
      JSON.stringify([{ id: 'ip1', value: '10.0.0.0/8', label: 'escritorio' }]),
    ])
    invalidateAllowlistCache()
  })
  afterAll(async () => app.close())

  it('IP allowlist: normal path 403, encoded path 200 from a non-listed IP', async () => {
    const normal = await api(app, 'GET', '/api/auth/me', { cookie, ip: OUTSIDE })
    expect(normal.statusCode).toBe(403)
    expect(normal.json().error.code).toBe('ip_nao_autorizado')

    const encoded = await api(app, 'GET', '/%61pi/auth/me', { cookie, ip: OUTSIDE })
    expect(encoded.statusCode).toBe(200) // allowlist bypassed
    expect(encoded.json().user).toBeTruthy()
  })

  it('CSRF: body-less POST without X-Requested-With is rejected normally, accepted on encoded path', async () => {
    // normal path, no CSRF header -> 403
    const normal = await api(app, 'POST', '/api/auth/logout', { cookie, ip: OUTSIDE, csrf: false })
    expect(normal.statusCode).toBe(403)

    // encoded path, no CSRF header -> reaches the route (204), CSRF + IP both skipped
    const encoded = await api(app, 'POST', '/%61pi/auth/logout', { cookie, ip: OUTSIDE, csrf: false })
    expect(encoded.statusCode).toBe(204)
  })
})
