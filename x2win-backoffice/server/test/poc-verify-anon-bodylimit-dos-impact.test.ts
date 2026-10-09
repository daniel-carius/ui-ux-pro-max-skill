// PoC (verificação de impacto): corpo JSON grande e anônimo é lido e parseado antes do 401.
// Mede o bloqueio do event loop por formato de corpo e o efeito em /api/health.
import { monitorEventLoopDelay } from 'node:perf_hooks'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestApp } from './helpers'

let app: FastifyInstance
let base = ''

beforeAll(async () => {
  app = await createTestApp()
  await app.listen({ port: 0, host: '127.0.0.1' })
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
})
afterAll(async () => {
  await app.close()
})

const MB = 1024 * 1024
function bodyOf(shape: 'dataurl' | 'numbers' | 'objects', size: number): string {
  if (shape === 'dataurl') return JSON.stringify({ value: 'data:image/png;base64,' + 'A'.repeat(size - 60), version: 0 })
  const unit = shape === 'numbers' ? '0,' : '{},'
  const n = Math.floor((size - 30) / unit.length)
  return '{"value":[' + unit.repeat(n - 1) + unit.slice(0, -1) + '],"version":0}'
}

async function send(path: string, method: string, body: string) {
  const t = performance.now()
  const r = await fetch(base + path, { method, body, headers: { 'content-type': 'application/json', 'x-requested-with': 'x2w' } })
  await r.text()
  return { status: r.status, ms: performance.now() - t }
}

async function health() {
  const t = performance.now()
  const r = await fetch(base + '/api/health')
  await r.text()
  return performance.now() - t
}

async function measure(label: string, fn: () => Promise<unknown>) {
  const h = monitorEventLoopDelay({ resolution: 5 })
  h.enable()
  const rss0 = process.memoryUsage().rss
  const t = performance.now()
  const out = await fn()
  const total = performance.now() - t
  h.disable()
  const line = `${label}: total=${total.toFixed(0)}ms loopMax=${(h.max / 1e6).toFixed(0)}ms rss+=${((process.memoryUsage().rss - rss0) / MB).toFixed(0)}MB`
  console.log(line, JSON.stringify(out))
  return { total, loopMax: h.max / 1e6, out }
}

describe('anonymous large-body parse before auth (impact)', () => {
  it('single anonymous 12 MB body per shape: 401 only after full parse', async () => {
    for (const shape of ['dataurl', 'numbers', 'objects'] as const) {
      const body = bodyOf(shape, 12 * MB - 1024)
      const r = await measure(`single 12MB ${shape} PUT /api/kv/x`, () => send('/api/kv/x', 'PUT', body))
      expect((r.out as { status: number }).status).toBe(401)
    }
    // pequeno, mesmo endpoint: referência
    await measure('single tiny PUT /api/kv/x', () => send('/api/kv/x', 'PUT', '{"value":1}'))
  }, 120_000)

  it('cpu per byte is the same at 1 MB (body limit only changes per-request granularity)', async () => {
    for (const shape of ['dataurl', 'numbers', 'objects'] as const) {
      const body = bodyOf(shape, 1 * MB - 1024)
      await measure(`12x sequential 1MB ${shape}`, async () => {
        const st: number[] = []
        for (let i = 0; i < 12; i++) st.push((await send('/api/kv/x', 'PUT', body)).status)
        return st
      })
    }
  }, 120_000)

  it('concurrent anonymous 12 MB bodies from one IP vs /api/health latency', async () => {
    for (const shape of ['dataurl', 'objects'] as const) {
      const body = bodyOf(shape, 12 * MB - 1024)
      for (const n of [8, 30]) {
        await measure(`${n} concurrent 12MB ${shape} POST /api/team/direct`, async () => {
          const reqs = Array.from({ length: n }, () => send('/api/team/direct', 'POST', body))
          await new Promise((r) => setTimeout(r, 50))
          const hs: number[] = []
          const hp = (async () => {
            for (let i = 0; i < 10; i++) {
              hs.push(Math.round(await health()))
              await new Promise((r) => setTimeout(r, 100))
            }
          })()
          const res = await Promise.all(reqs)
          await hp
          const statuses = [...new Set(res.map((x) => x.status))]
          return { statuses, minMs: Math.round(Math.min(...res.map((x) => x.ms))), maxMs: Math.round(Math.max(...res.map((x) => x.ms))), healthMs: hs }
        })
      }
    }
  }, 300_000)

  it('with a non-empty IP allowlist the anonymous outsider is rejected in onRequest, before parsing', async () => {
    const { invalidateAllowlistCache } = await import('../src/plugins/security')
    await app.db.query(`update panel_security set allowlist = $1::jsonb where id = 1`, [JSON.stringify([{ value: '10.9.9.9' }])])
    invalidateAllowlistCache()
    const body = bodyOf('objects', 12 * MB - 1024)
    const r = await measure('allowlist set, single 12MB objects PUT /api/kv/x', () => send('/api/kv/x', 'PUT', body))
    expect((r.out as { status: number }).status).toBe(403)
    await app.db.query(`update panel_security set allowlist = '[]'::jsonb where id = 1`)
    invalidateAllowlistCache()
  }, 60_000)
})
