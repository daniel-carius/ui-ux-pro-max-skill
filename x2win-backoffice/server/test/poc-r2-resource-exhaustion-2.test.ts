// PoC: anonymous POST /api/auth/login runs a full scrypt (N=2^15) for every attempt, and the only
// limits are per client IP. Requests from many distinct IPs all reach scrypt and queue on the
// 4-thread libuv pool, delaying a legitimate login and unrelated threadpool work (dns.lookup).
import { lookup } from 'node:dns'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, createTestApp, createUser, type TestUser } from './helpers'

function dnsLookupMs(): Promise<number> {
  const t0 = performance.now()
  return new Promise((resolve) => lookup('localhost', () => resolve(performance.now() - t0)))
}

function pct(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b)
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))])
}

describe('PoC: unauthenticated login scrypt is not bounded across source IPs', () => {
  let app: FastifyInstance
  let staff: TestUser

  beforeAll(async () => {
    app = await createTestApp()
    staff = await createUser(app, { roleId: 'suporte', password: 'SenhaForte123' })
  })
  afterAll(async () => {
    await app.close()
  })

  it('a flood of anonymous logins from distinct IPs starves the threadpool', async () => {
    // warm-up
    await api(app, 'POST', '/api/auth/login', { ip: '198.51.100.1', body: { email: 'ninguem@x.y', password: 'x' } })

    // baseline: one unknown-email login, one legit login, one dns.lookup
    let t0 = performance.now()
    const r0 = await api(app, 'POST', '/api/auth/login', { ip: '198.51.100.2', body: { email: 'ninguem@x.y', password: 'x' } })
    const baselineUnknown = performance.now() - t0
    expect(r0.statusCode).toBe(401)
    t0 = performance.now()
    const rl = await api(app, 'POST', '/api/auth/login', { ip: '198.51.100.3', body: { email: staff.email, password: staff.password } })
    const baselineLegit = performance.now() - t0
    expect(rl.statusCode).toBe(200)
    const baselineDns = await dnsLookupMs()

    // flood: N anonymous logins, each from its own IP (each well under the 10/min/IP login limit)
    const N = 40
    const lat: number[] = []
    const statuses: number[] = []
    const flood = Array.from({ length: N }, (_, i) => {
      const s = performance.now()
      return api(app, 'POST', '/api/auth/login', {
        ip: `203.0.${Math.floor(i / 200)}.${(i % 200) + 1}`,
        body: { email: `atacante${i}@x.y`, password: 'qualquer' },
      }).then((r) => {
        lat.push(performance.now() - s)
        statuses.push(r.statusCode)
      })
    })
    // let the flood reach scrypt, then a legit staff login and a dns.lookup arrive
    await new Promise((r) => setTimeout(r, 30))
    t0 = performance.now()
    const legitP = api(app, 'POST', '/api/auth/login', { ip: '192.0.2.77', body: { email: staff.email, password: staff.password } }).then((r) => ({
      status: r.statusCode,
      ms: performance.now() - t0,
    }))
    const dnsP = dnsLookupMs()
    const [legit, dnsMs] = await Promise.all([legitP, dnsP, ...flood])

    const count = (c: number) => statuses.filter((s) => s === c).length
    console.log(
      JSON.stringify({
        baselineUnknownMs: Math.round(baselineUnknown),
        baselineLegitMs: Math.round(baselineLegit),
        baselineDnsMs: Math.round(baselineDns * 10) / 10,
        N,
        flood401: count(401),
        flood429: count(429),
        floodP50: pct(lat, 50),
        floodMax: pct(lat, 100),
        legitStatus: legit.status,
        legitUnderFloodMs: Math.round(legit.ms),
        dnsUnderFloodMs: Math.round(dnsMs),
      }),
    )

    // observed while the bug exists: every anonymous attempt from a distinct IP reached scrypt (401, no 429)
    // and the legit staff login queued behind them (logged above, not asserted: a fix may shed load).

    // SECURE BEHAVIOUR (fails while the bug exists): anonymous login hashing from arbitrary IPs must not
    // occupy the whole libuv pool, so unrelated threadpool work (dns.lookup used by the webhook
    // safeLookup and by pg when it opens a connection to host "db") is not queued behind it.
    expect(dnsMs).toBeLessThan(Math.max(50, baselineDns * 10))
  })
})
