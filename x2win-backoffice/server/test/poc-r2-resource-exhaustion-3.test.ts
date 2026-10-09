// PoC R2 — resource exhaustion via unbounded kv child keys.
//
// Mechanics (from the code):
//   - routes.ts:21-22 KEY_FORMAT/MAX_KEY_LENGTH accept any dotted key up to 120 chars.
//   - kv-registry.ts:233-244 findKvRule() inherits the rule of the longest matching prefix, so
//     campanhas.promocoes.<anything> resolves to { prefix: 'campanhas.promocoes', read: 'equipe' }
//     with write defaulting to ['promocoes.editar'] (kv-registry.ts:148, 251-254).
//   - generic.ts:23-37 inserts a NEW kv_store row for every never-seen key, plus one audit_log row
//     (append-only: migrations/index.ts trigger audit_log_no_change).
//   - The only bound is the per-IP route limit 240/min (routes.ts:92) and the 12 MB body limit
//     (app.ts:38; nginx client_max_body_size 12m). No per-user/per-prefix key quota, no value cap.
//   - The panel itself only ever uses 'campanhas.promocoes' (+ the local-only '.visao'), so none of
//     these child keys is a legitimate panel key.
//
// The tests assert the SECURE behaviour and therefore FAIL while the issue exists.
import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, createTestApp, loginAs } from './helpers'

describe('R2 — low role can mint unbounded kv rows under a writable prefix', () => {
  let app: FastifyInstance
  let mkt: { user: { id: string }; cookie: string }
  let sup: { user: { id: string }; cookie: string }

  beforeAll(async () => {
    app = await createTestApp()
    mkt = await loginAs(app, 'marketing') // seeded non-system role with promocoes.editar
    sup = await loginAs(app, 'suporte') // no promocoes permission at all
  })
  afterAll(async () => {
    await app.close()
  })

  it('distinct arbitrary child keys are not bounded (count)', async () => {
    const auditBefore = await app.db.one<{ n: number }>('select count(*)::int as n from audit_log where actor_id = $1', [mkt.user.id])
    const statuses: number[] = []
    const t0 = performance.now()
    for (let i = 0; i < 245; i++) {
      const r = await api(app, 'PUT', `/api/kv/campanhas.promocoes.flood-${i}`, {
        cookie: mkt.cookie,
        ip: '198.51.100.10',
        body: { value: { i, junk: 'x'.repeat(64) } },
      })
      statuses.push(r.statusCode)
    }
    const ms = Math.round(performance.now() - t0)
    const ok = statuses.filter((s) => s === 200).length
    const limited = statuses.filter((s) => s === 429).length
    const rows = await app.db.one<{ n: number }>(`select count(*)::int as n from kv_store where key like 'campanhas.promocoes.flood-%'`)
    const auditAfter = await app.db.one<{ n: number }>('select count(*)::int as n from audit_log where actor_id = $1', [mkt.user.id])
    const sample = await app.db.one<{ summary: string; entity: string }>(
      `select summary, entity from audit_log where actor_id = $1 order by id desc limit 1`,
      [mkt.user.id],
    )

    // a Suporte session (no promocoes.* permission) can read the minted keys
    const read = await api(app, 'GET', '/api/kv/campanhas.promocoes.flood-1', { cookie: sup.cookie })
    // deleting is impossible for the runtime: audit rows stay forever
    let auditDeleteErr = ''
    try {
      await app.db.query('delete from audit_log where actor_id = $1', [mkt.user.id])
    } catch (e) {
      auditDeleteErr = (e as Error).message
    }

    console.log(
      JSON.stringify({
        ms,
        put200: ok,
        put429: limited,
        kvRowsCreated: rows?.n,
        auditRowsAdded: (auditAfter?.n ?? 0) - (auditBefore?.n ?? 0),
        lastAudit: sample,
        suporteReadStatus: read.statusCode,
        suporteReadBody: read.json(),
        auditDeleteErr,
      }),
    )

    // SECURE: an unregistered, never-used child key must not become a new row, or at least the
    // number of distinct keys one low-role user can mint must be small and bounded.
    expect.soft(rows?.n ?? 0, 'distinct kv rows minted by one marketing user in one burst').toBeLessThanOrEqual(10)
    expect.soft((auditAfter?.n ?? 0) - (auditBefore?.n ?? 0), 'audit rows produced by key-minting').toBeLessThanOrEqual(10)
    expect(read.statusCode === 200 && (read.json() as { stored?: boolean }).stored === true, 'Suporte reads a minted key').toBe(false)
  })

  it('each minted key can hold ~11 MB, so storage grows linearly with requests', async () => {
    const N = 4
    const sizes: number[] = []
    for (let i = 0; i < N; i++) {
      const blob = randomBytes(8 * 1024 * 1024).toString('base64') // ~11.2 MB, incompressible
      const r = await api(app, 'PUT', `/api/kv/campanhas.promocoes.big-${i}`, {
        cookie: mkt.cookie,
        ip: '198.51.100.20',
        body: { value: { blob } },
      })
      sizes.push(r.statusCode)
    }
    const stored = await app.db.one<{ n: number; bytes: string; text_bytes: string }>(
      `select count(*)::int as n, coalesce(sum(pg_column_size(value)),0)::text as bytes,
              coalesce(sum(octet_length(value::text)),0)::text as text_bytes
         from kv_store where key like 'campanhas.promocoes.big-%'`,
    )
    console.log(JSON.stringify({ statuses: sizes, rows: stored?.n, storedBytes: Number(stored?.bytes), textBytes: Number(stored?.text_bytes) }))
    // SECURE: a low role must not be able to park tens of MB in new rows with a handful of requests.
    expect(Number(stored?.bytes ?? 0), 'bytes stored in minted rows').toBeLessThan(5 * 1024 * 1024)
  }, 120_000)
})
