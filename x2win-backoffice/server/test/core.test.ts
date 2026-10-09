import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { migrate, openDb } from '../src/db'
import { api, createTestApp, loginAs, sessionCookie, createUser } from './helpers'

describe('banco', () => {
  it('aplica migrações, converte tipos e bloqueia alteração da auditoria', async () => {
    const db = openDb('memory://')
    expect(await migrate(db)).toEqual(['001_init'])
    expect(await migrate(db)).toEqual([])
    await db.query(`insert into roles (id, name, approval_ceiling_cents) values ('r', 'R', 500000)`)
    const r = await db.one<{ approval_ceiling_cents: number; created_at: string }>('select approval_ceiling_cents, created_at from roles')
    expect(r?.approval_ceiling_cents).toBe(500000)
    expect(typeof r?.created_at).toBe('string')
    await db.query(`insert into audit_log (actor_name, action, entity, summary) values ('a','b','c','d')`)
    await expect(db.query('update audit_log set summary = $1', ['x'])).rejects.toThrow(/inclusão/)
    await expect(db.query('delete from audit_log')).rejects.toThrow(/inclusão/)
    await expect(
      db.tx(async (t) => {
        await t.query(`insert into roles (id, name) values ('x', 'X')`)
        throw new Error('desfaz')
      }),
    ).rejects.toThrow('desfaz')
    expect(await db.one(`select id from roles where id = 'x'`)).toBeNull()
    await db.close()
  })
})

describe('núcleo da API', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('health responde sem login', async () => {
    const r = await api(app, 'GET', '/api/health')
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ ok: true, db: 'pglite' })
  })

  it('cargos do sistema são criados', async () => {
    const rows = await app.db.query<{ id: string }>('select id from roles order by id')
    expect(rows.map((r) => r.id)).toContain('superadmin')
    expect(rows.length).toBe(7)
  })

  it('escrita sem cabeçalho de segurança é recusada (CSRF)', async () => {
    const { cookie } = await loginAs(app)
    const r = await api(app, 'PUT', '/api/kv/config.empresa', { cookie, body: { value: {} }, csrf: false })
    expect(r.statusCode).toBe(403)
    expect(r.json().error.code).toBe('requisicao_invalida')
  })

  it('sessão vale para quem está ativo e não vale para pessoa desligada', async () => {
    const probe = await createTestApp()
    probe.get('/api/_teste/quem', async (req) => ({ auth: req.auth?.user.id ?? null, stage: req.auth?.stage ?? null }))
    const ativo = await createUser(probe)
    const ok = await api(probe, 'GET', '/api/_teste/quem', { cookie: await sessionCookie(probe, ativo.id) })
    expect(ok.json()).toEqual({ auth: ativo.id, stage: 'active' })
    const u = await createUser(probe, { status: 'desligado' })
    const r = await api(probe, 'GET', '/api/_teste/quem', { cookie: await sessionCookie(probe, u.id) })
    expect(r.json().auth).toBeNull()
    await probe.close()
  })

  it('lista de IPs bloqueia quem está fora', async () => {
    await app.db.query(`update panel_security set allowlist = $1 where id = 1`, [JSON.stringify([{ value: '10.0.0.0/8' }])])
    const { invalidateAllowlistCache } = await import('../src/plugins/security')
    invalidateAllowlistCache()
    const fora = await api(app, 'GET', '/api/auth/me', { ip: '200.1.1.1' })
    expect(fora.statusCode).toBe(403)
    expect(fora.json().error.code).toBe('ip_nao_autorizado')
    await app.db.query(`update panel_security set allowlist = '[]'::jsonb where id = 1`)
    invalidateAllowlistCache()
  })
})
