import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { migrate, openDb, pingDb, type Db } from '../src/db'
import { MIGRATIONS, RUNTIME_ROLE } from '../src/db/migrations'
import { api, createTestApp, loginAs, sessionCookie, createUser } from './helpers'

/** Todas as migrações, na ordem (a lista cresce com o projeto). */
const ALL = MIGRATIONS.map((m) => m.id)
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('banco', () => {
  it('aplica migrações, converte tipos e bloqueia alteração da auditoria', async () => {
    const db = openDb('memory://')
    expect(ALL.slice(0, 2)).toEqual(['001_init', '002_audit_append_only'])
    expect(await migrate(db)).toEqual(ALL)
    expect(await migrate(db)).toEqual([])
    await db.query(`insert into roles (id, name, approval_ceiling_cents) values ('r', 'R', 500000)`)
    const r = await db.one<{ approval_ceiling_cents: number; created_at: string }>('select approval_ceiling_cents, created_at from roles')
    expect(r?.approval_ceiling_cents).toBe(500000)
    expect(typeof r?.created_at).toBe('string')
    await db.query(`insert into audit_log (actor_name, action, entity, summary) values ('a','b','c','d')`)
    await expect(db.query('update audit_log set summary = $1', ['x'])).rejects.toThrow(/inclusão/)
    await expect(db.query('delete from audit_log')).rejects.toThrow(/inclusão/)
    await expect(db.query('truncate audit_log')).rejects.toThrow(/inclusão/)
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

// r3-real-postgres-concurrency-and-grants-4: com o dono das tabelas sem CREATEROLE (Postgres gerenciado, ou
// instalação sem deploy/db-init), a 002 só avisava e pulava os GRANTs, ficava marcada como aplicada, e "crie o papel
// e rode as migrações de novo" não concedia nada: a API com x2win_app não subia (42501 em schema_migrations), e o
// caminho que sobrava era subir a API com o dono (auditoria apagável). Agora os privilégios são reaplicados em toda
// execução de migrate() e, sem o papel, migrate() falha com uma mensagem clara (npm run migrate sai com erro).
// O mesmo cenário no PostgreSQL 16 de verdade, pelo CLI, está em core-pg.test.ts.
describe('privilégios do papel de execução', () => {
  const privs = async (db: Db, table: string) =>
    (
      await db.one<{ p: string | null }>(
        `select string_agg(privilege_type, ',' order by privilege_type) as p from information_schema.role_table_grants
          where grantee = $1 and table_name = $2`,
        [RUNTIME_ROLE, table],
      )
    )?.p ?? ''

  it('dono sem CREATEROLE: migrate() falha sem o papel; criado o papel, rodar de novo concede tudo e a API funciona com ele', async () => {
    const db = openDb('memory://')
    // dono do banco como num Postgres gerenciado: não é superusuário nem cria papéis
    await db.exec(`create role x2win nologin nosuperuser nocreaterole; alter database postgres owner to x2win`)
    await db.exec('set role x2win')
    await expect(migrate(db)).rejects.toThrow(
      new RegExp(`Migrações aplicadas: ${escapeRe(ALL.join(', '))}\\. Mas o papel x2win_app, com que a API conecta, não existe`),
    )
    await db.exec('reset role')
    expect((await db.query<{ id: string }>('select id from schema_migrations order by id')).map((r) => r.id)).toEqual(ALL)
    expect(await db.one('select 1 from pg_roles where rolname = $1', [RUNTIME_ROLE])).toBeNull()

    // o administrador cria o papel (deploy/db-init) e as migrações rodam de novo, com o dono
    await db.exec(`create role ${RUNTIME_ROLE} nologin nosuperuser nocreaterole`)
    await db.exec('set role x2win')
    expect(await migrate(db)).toEqual([])
    expect(await privs(db, 'users')).toBe('DELETE,INSERT,SELECT,UPDATE')
    expect(await privs(db, 'audit_log')).toBe('INSERT,SELECT')
    expect(await privs(db, 'schema_migrations')).toBe('SELECT')

    // e a API com o papel de execução: lê o controle de migrações, trabalha, e a auditoria segue só de inclusão
    await db.exec(`set role ${RUNTIME_ROLE}`)
    expect(await migrate(db)).toEqual([])
    await db.query(`insert into roles (id, name) values ('r1', 'R1')`)
    await db.query(`update roles set name = 'R2' where id = 'r1'`)
    await db.query(`insert into audit_log (actor_name, action, entity, summary) values ('a', 'b', 'c', 'd')`)
    for (const sql of ['delete from audit_log', 'truncate audit_log', 'drop trigger audit_log_no_truncate on audit_log', `insert into schema_migrations (id) values ('999')`]) {
      await expect(db.query(sql), sql).rejects.toThrow(/permissão|permission|owner|dono/i)
    }
    await db.close()
  })

  it('rodar de novo não alarga tabela já restrita e refaz a restrição da auditoria', async () => {
    const db = openDb('memory://')
    await migrate(db)
    // uma tabela só de inclusão de uma migração futura (REVOKE na própria migração) ...
    await db.exec(`revoke update, delete on table webhook_executions from ${RUNTIME_ROLE}`)
    // ... e um GRANT a mais na auditoria, feito à mão
    await db.exec(`grant update, delete, truncate on table audit_log to ${RUNTIME_ROLE}`)
    expect(await migrate(db)).toEqual([])
    expect(await privs(db, 'webhook_executions')).toBe('INSERT,SELECT')
    expect(await privs(db, 'audit_log')).toBe('INSERT,SELECT')
    expect(await privs(db, 'withdrawals')).toBe('DELETE,INSERT,SELECT,UPDATE')
    await db.close()
  })

  it('a API (requireRuntimeRole: false) sobe mesmo sem o papel; quem falha é o npm run migrate', async () => {
    const db = openDb('memory://')
    await db.exec(`create role x2win nologin nosuperuser nocreaterole; alter database postgres owner to x2win; set role x2win`)
    expect(await migrate(db, { requireRuntimeRole: false })).toEqual(ALL)
    await expect(migrate(db)).rejects.toThrow(/Migrações em dia\. Mas o papel x2win_app/)
    await db.close()
  })
})

// r3-process-resilience-and-restart-2: /api/health (sonda do HEALTHCHECK do Dockerfile.api) respondia 200 sem tocar
// no banco: com o Postgres fora do ar a sonda seguia verde enquanto as rotas reais davam 500.
describe('/api/health reflete o banco', () => {
  it('banco fechado: as rotas quebram e /api/health responde 503', async () => {
    const app = await createTestApp()
    try {
      expect((await api(app, 'GET', '/api/health')).statusCode).toBe(200)
      await app.db.close()
      const login = await api(app, 'POST', '/api/auth/login', { body: { email: 'alguem@x2win.bet.br', password: 'SenhaForte123' } })
      expect(login.statusCode).toBe(500)
      const health = await api(app, 'GET', '/api/health', { csrf: false })
      expect(health.statusCode).toBe(503)
      expect(health.json()).toMatchObject({ ok: false, db: 'pglite', error: { code: 'banco_indisponivel' } })
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  it('banco que não responde (pool esgotado, rede presa) também conta como fora do ar, sem esperar para sempre', async () => {
    const hung = { one: () => new Promise(() => undefined) } as unknown as Db
    const t0 = Date.now()
    expect(await pingDb(hung, 100)).toBe(false)
    expect(Date.now() - t0).toBeLessThan(1000)
    const failing = { one: () => Promise.reject(new Error('ECONNREFUSED')) } as unknown as Db
    expect(await pingDb(failing, 100)).toBe(false)
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
