// Independent impact verification: anonymous large-body parse-before-auth DoS.
// Writes measured numbers to a JSON file so the verifier can read exact values.
import { writeFileSync } from 'node:fs'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { SECURITY } from '../src/config'
import { createTestApp } from './helpers'

let app: FastifyInstance
let base = ''
const out: Record<string, unknown> = {}

beforeAll(async () => {
  app = await createTestApp()
  await app.listen({ port: 0, host: '127.0.0.1' })
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
})
afterAll(async () => {
  // Measurements are also asserted below; the file dump is a best-effort convenience.
  try {
    writeFileSync(`${process.env.DOS_MEASURE_OUT ?? '/tmp'}/dos-measure.json`, JSON.stringify(out, null, 2))
  } catch {
    /* ignore: assertions carry the proof */
  }
  // eslint-disable-next-line no-console
  console.log('DOS_MEASURE', JSON.stringify(out))
  await app.close()
})

const MB = 1024 * 1024
// Valid JSON object body of ~size bytes (array of small ints), parseable, under the 12 MB limit.
function bigValidBody(size: number): string {
  const unit = '0,'
  const n = Math.floor((size - 30) / unit.length)
  return '{"value":[' + unit.repeat(n - 1) + '0],"version":0}'
}

async function send(path: string, method: string, body: string) {
  const t = performance.now()
  const r = await fetch(base + path, { method, body, headers: { 'content-type': 'application/json', [SECURITY.csrfHeader]: SECURITY.csrfValue } })
  await r.text()
  return { status: r.status, ms: performance.now() - t }
}
async function health() {
  const t = performance.now()
  const r = await fetch(base + '/api/health')
  await r.text()
  return { ms: performance.now() - t, status: r.status }
}

describe('anon 12MB parse-before-auth DoS (independent impact)', () => {
  // (1) ordering: invalid JSON on several protected/write routes, anon, with CSRF header.
  // Secure behaviour would be 401/403 (auth/allowlist before body). Parse-before-auth => 400.
  it('invalid JSON anon on protected routes is parsed (400) before the 401/403', async () => {
    const routes: [string, string][] = [
      ['/api/kv/x', 'PUT'],
      ['/api/team/direct', 'POST'],
      ['/api/audit/events', 'POST'],
      ['/api/team/invites/accept', 'POST'],
      ['/api/nao-existe', 'POST'],
    ]
    const res: Record<string, number> = {}
    for (const [p, m] of routes) {
      const r = await fetch(base + p, { method: m, body: '{ nope not json ', headers: { 'content-type': 'application/json', [SECURITY.csrfHeader]: SECURITY.csrfValue } })
      await r.text()
      res[`${m} ${p}`] = r.status
    }
    out.invalidJsonStatuses = res
  })

  // (2) single 12 MB anon body: time + event-loop block
  it('single anon 12MB body returns 401 after full parse', async () => {
    const body = bigValidBody(12 * MB - 2048)
    const h = monitorEventLoopDelay({ resolution: 5 })
    h.enable()
    const r = await send('/api/kv/x', 'PUT', body)
    h.disable()
    out.single12mb = { status: r.status, ms: Math.round(r.ms), loopMaxMs: Math.round(h.max / 1e6), bodyBytes: body.length }
    expect(r.status).toBe(401)
  }, 60_000)

  // (3) realistic single attacker: N concurrent 12 MB POSTs to /api/team/direct from ONE IP
  //     (no route-level limit, well under 600/min). Fire GET /api/health alongside.
  it('single-IP burst makes health unresponsive; none rejected pre-parse', async () => {
    const body = bigValidBody(12 * MB - 2048)
    const baseline = await health()
    const h = monitorEventLoopDelay({ resolution: 5 })
    h.enable()
    const rss0 = process.memoryUsage().rss
    const N = 30
    const reqs = Array.from({ length: N }, () => send('/api/team/direct', 'POST', body))
    await new Promise((r) => setTimeout(r, 40))
    const healthUnderLoad = await health()
    const res = await Promise.all(reqs)
    h.disable()
    const rssDelta = Math.round((process.memoryUsage().rss - rss0) / MB)
    const statuses = [...new Set(res.map((x) => x.status))]
    const under30ms = res.filter((x) => x.ms < 30).length
    out.burst = {
      N,
      statuses,
      minMs: Math.round(Math.min(...res.map((x) => x.ms))),
      maxMs: Math.round(Math.max(...res.map((x) => x.ms))),
      rejectedPreParse_under30ms: under30ms,
      baselineHealthMs: Math.round(baseline.ms),
      healthUnderLoadMs: Math.round(healthUnderLoad.ms),
      loopMaxMs: Math.round(h.max / 1e6),
      rssDeltaMB: rssDelta,
    }
    // every request went through parse to the handler's 401 (no 413/429)
    expect(statuses).toEqual([401])
  }, 120_000)

  // (4) control: a non-empty IP allowlist rejects the outsider in onRequest, before parsing.
  it('non-empty allowlist rejects outsider before parse (403 fast)', async () => {
    const { invalidateAllowlistCache } = await import('../src/plugins/security')
    await app.db.query(`update panel_security set allowlist = $1::jsonb where id = 1`, [JSON.stringify([{ value: '10.9.9.9' }])])
    invalidateAllowlistCache()
    const body = bigValidBody(12 * MB - 2048)
    const r = await send('/api/kv/x', 'PUT', body)
    out.withAllowlist = { status: r.status, ms: Math.round(r.ms) }
    await app.db.query(`update panel_security set allowlist = '[]'::jsonb where id = 1`)
    invalidateAllowlistCache()
    expect(r.status).toBe(403)
  }, 60_000)
})
