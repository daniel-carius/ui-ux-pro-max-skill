// Regressões de segurança do núcleo (achados r1-web-1, r1-authn-8 e r1-logic-7). Cada bloco afirma o
// comportamento seguro.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { loadConfig, SECURITY } from '../src/config'
import { migrate, openDb } from '../src/db'
import { RUNTIME_ROLE } from '../src/db/migrations'
import { invalidateAllowlistCache } from '../src/plugins/security'
import { TEST_ENV, api, cookieFrom, createTestApp, createUser, sessionCookie } from './helpers'

// r1-web-1: o gancho de segurança decidia pelo texto cru de req.url ("/api/..."), mas o roteador decodifica o
// caminho: "/%61pi/auth/me" chegava na rota /api/auth/me sem lista de IPs nem checagem de CSRF.
describe('lista de IPs e CSRF valem para a rota escolhida, não para o texto da URL', () => {
  const OFFICE = '203.0.113.0/24'
  const OUTSIDE = '198.51.100.7'
  const INSIDE = '203.0.113.10'
  let app: FastifyInstance
  let cookie: string

  beforeAll(async () => {
    app = await createTestApp()
    const u = await createUser(app, { roleId: 'superadmin' })
    cookie = await sessionCookie(app, u.id)
    await app.db.query('update panel_security set allowlist = $1::jsonb where id = 1', [
      JSON.stringify([{ id: 'ip-office', value: OFFICE, label: 'Escritório' }]),
    ])
    invalidateAllowlistCache()
  })
  afterAll(async () => {
    invalidateAllowlistCache()
    await app.close()
  })

  it('controle: caminho normal fora da lista → 403 ip_nao_autorizado', async () => {
    const r = await api(app, 'GET', '/api/auth/me', { cookie, ip: OUTSIDE })
    expect(r.statusCode).toBe(403)
    expect(r.json().error.code).toBe('ip_nao_autorizado')
  })

  for (const url of ['/%61pi/auth/me', '/%61%70%69/auth/me', '/api/%61uth/me', '/api/auth/%6De', '/%2561pi/auth/me', '/API/auth/me', '/api/auth/me/']) {
    it(`GET ${url} fora da lista não chega na rota (403)`, async () => {
      const r = await api(app, 'GET', url, { cookie, ip: OUTSIDE })
      expect(r.statusCode, r.body).toBe(403)
      expect(r.json().error.code).toBe('ip_nao_autorizado')
    })
  }

  it('login pelo prefixo codificado fora da lista também é barrado', async () => {
    const u = await createUser(app, { roleId: 'suporte' })
    const r = await api(app, 'POST', '/%61pi/auth/login', { ip: OUTSIDE, body: { email: u.email, password: u.password } })
    expect(r.statusCode).toBe(403)
    expect(r.json().error.code).toBe('ip_nao_autorizado')
    expect(cookieFrom(r)).toBeNull()
  })

  it('POST sem X-Requested-With pelo prefixo codificado → 403, e a sessão continua valendo', async () => {
    const blocked = await api(app, 'POST', '/%61pi/auth/logout', { cookie, ip: OUTSIDE, csrf: false })
    expect(blocked.statusCode).toBe(403)
    // de dentro da lista, sem o cabeçalho: CSRF recusa mesmo com o caminho codificado
    const noHeader = await api(app, 'POST', '/%61pi/auth/logout', { cookie, ip: INSIDE, csrf: false })
    expect(noHeader.statusCode).toBe(403)
    expect(noHeader.json().error.code).toBe('requisicao_invalida')
    const me = await api(app, 'GET', '/api/auth/me', { cookie, ip: INSIDE })
    expect(me.statusCode).toBe(200)
  })

  it('de dentro da lista o caminho codificado funciona como o normal (mesma rota, mesmas checagens)', async () => {
    const r = await api(app, 'GET', '/%61pi/auth/me', { cookie, ip: INSIDE })
    expect(r.statusCode).toBe(200)
  })

  it('caminho sem rota fora da lista → 403 (nada responde antes da checagem)', async () => {
    const r = await api(app, 'GET', '/qualquer/coisa', { ip: OUTSIDE })
    expect(r.statusCode).toBe(403)
  })

  it('/api/health continua público (HEALTHCHECK do contêiner)', async () => {
    const r = await api(app, 'GET', '/api/health', { ip: OUTSIDE, csrf: false })
    expect(r.statusCode).toBe(200)
  })
})

// r1-authn-8: atrás do proxy, a API só atende o que chegou ao proxy por HTTPS; produção exige cookie Secure.
describe('HTTPS atrás do proxy e cookie Secure em produção', () => {
  it('produção sem COOKIE_SECURE=true não sobe; sem valor, vale true', () => {
    expect(() => loadConfig({ ...TEST_ENV, NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/)
    expect(loadConfig({ ...TEST_ENV, NODE_ENV: 'production' }).COOKIE_SECURE).toBe(true)
    expect(loadConfig({ ...TEST_ENV, NODE_ENV: 'production', COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true)
    expect(loadConfig({ ...TEST_ENV, NODE_ENV: 'development' }).COOKIE_SECURE).toBe(false)
    expect(loadConfig({ ...TEST_ENV, NODE_ENV: 'development', COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true)
  })

  describe('TRUST_PROXY=1 e COOKIE_SECURE=true (docker-compose)', () => {
    let app: FastifyInstance
    beforeAll(async () => {
      app = await createTestApp({ TRUST_PROXY: '1', COOKIE_SECURE: 'true' })
    })
    afterAll(async () => app.close())

    const proto = (p?: string) => (p ? { 'x-forwarded-proto': p } : undefined)

    for (const p of [undefined, 'http']) {
      it(`login com X-Forwarded-Proto ${p ?? 'ausente'} → 403 https_obrigatorio, sem cookie`, async () => {
        const u = await createUser(app, { roleId: 'suporte' })
        const r = await api(app, 'POST', '/api/auth/login', { body: { email: u.email, password: u.password }, headers: proto(p) })
        expect(r.statusCode).toBe(403)
        expect(r.json().error.code).toBe('https_obrigatorio')
        expect(r.headers['set-cookie']).toBeUndefined()
      })
    }

    it('rotas com sessão também exigem HTTPS (cookie mandado em texto claro não é aceito)', async () => {
      const u = await createUser(app)
      const cookie = await sessionCookie(app, u.id)
      const r = await api(app, 'GET', '/api/auth/me', { cookie, headers: proto('http') })
      expect(r.statusCode).toBe(403)
      expect(r.json().error.code).toBe('https_obrigatorio')
      const ok = await api(app, 'GET', '/api/auth/me', { cookie, headers: proto('https') })
      expect(ok.statusCode).toBe(200)
    })

    it('login por HTTPS funciona e o cookie sai Secure', async () => {
      const u = await createUser(app, { roleId: 'suporte' })
      const r = await api(app, 'POST', '/api/auth/login', { body: { email: u.email, password: u.password }, headers: proto('https') })
      expect(r.statusCode, r.body).toBe(200)
      const c = r.cookies.find((k) => k.name === SECURITY.sessionCookie)
      expect(c?.secure).toBe(true)
    })

    it('/api/health responde sem cabeçalho de proxy (HEALTHCHECK direto no contêiner)', async () => {
      const r = await api(app, 'GET', '/api/health', { csrf: false })
      expect(r.statusCode).toBe(200)
    })
  })

  it('sem proxy confiável (TRUST_PROXY=0) ou sem cookie Secure (desenvolvimento) nada muda', async () => {
    for (const env of [{ TRUST_PROXY: '0', COOKIE_SECURE: 'true' }, { TRUST_PROXY: '1', COOKIE_SECURE: 'false' }]) {
      const app = await createTestApp(env)
      const u = await createUser(app, { roleId: 'suporte' })
      const r = await api(app, 'POST', '/api/auth/login', { body: { email: u.email, password: u.password } })
      expect(r.statusCode, JSON.stringify(env)).toBe(200)
      await app.close()
    }
  })
})

// r1-logic-7: gatilho por linha não dispara em TRUNCATE, e a API era dona da tabela (podia TRUNCATE, desligar
// ou apagar o gatilho).
describe('auditoria só aceita inclusão', () => {
  const insert = `insert into audit_log (actor_name, action, entity, summary, ip) values ('Fulano', 'aprovar', 'Saque', 'Saque aprovado', '1.2.3.4')`
  const count = async (q: (sql: string) => Promise<{ n: number }[]>) => (await q('select count(*)::int as n from audit_log'))[0].n

  it('com o dono das tabelas: DELETE, UPDATE e TRUNCATE são recusados pelo gatilho', async () => {
    const db = openDb('memory://')
    await migrate(db)
    for (let i = 0; i < 3; i++) await db.query(insert)
    await expect(db.query('delete from audit_log')).rejects.toThrow(/apenas inclusão/)
    await expect(db.query(`update audit_log set summary = 'x'`)).rejects.toThrow(/apenas inclusão/)
    await expect(db.query('truncate audit_log')).rejects.toThrow(/apenas inclusão/)
    await expect(db.query('truncate audit_log cascade')).rejects.toThrow(/apenas inclusão/)
    expect(await count((s) => db.query(s))).toBe(3)
    await db.close()
  })

  describe('com a credencial da API (papel de execução)', () => {
    let app: FastifyInstance
    beforeAll(async () => {
      app = await createTestApp()
    })
    afterAll(async () => app.close())

    it(`a API roda como ${RUNTIME_ROLE}, sem ser superusuário nem dona da auditoria`, async () => {
      const who = await app.db.one<{ cu: string; su: boolean; owner: string }>(
        `select current_user as cu, (select rolsuper from pg_roles where rolname = current_user) as su,
                (select tableowner from pg_tables where tablename = 'audit_log') as owner`,
      )
      expect(who).toMatchObject({ cu: RUNTIME_ROLE, su: false })
      expect(who!.owner).not.toBe(RUNTIME_ROLE)
    })

    it('inclui e lê; não apaga, não altera, não esvazia', async () => {
      for (let i = 0; i < 5; i++) await app.db.query(insert)
      const before = await count((s) => app.db.query(s))
      expect(before).toBeGreaterThanOrEqual(5)
      for (const sql of ['truncate audit_log', 'delete from audit_log', `update audit_log set summary = 'x'`]) {
        await expect(app.db.query(sql), sql).rejects.toThrow()
      }
      expect(await count((s) => app.db.query(s))).toBe(before)
    })

    it('não desliga nem apaga o gatilho, nem apaga a tabela', async () => {
      for (const sql of [
        'alter table audit_log disable trigger audit_log_no_change',
        'alter table audit_log disable trigger all',
        'drop trigger audit_log_no_truncate on audit_log',
        'drop table audit_log',
        'create or replace function audit_log_immutable() returns trigger language plpgsql as $$ begin return null; end $$',
      ]) {
        await expect(
          app.db.tx(async (t) => {
            await t.query(sql)
          }),
          sql,
        ).rejects.toThrow()
      }
      const triggers = await app.db.query<{ tgname: string; tgenabled: string }>(
        `select tgname, tgenabled from pg_trigger where tgrelid = 'audit_log'::regclass and not tgisinternal order by tgname`,
      )
      expect(triggers).toEqual([
        { tgname: 'audit_log_no_change', tgenabled: 'O' },
        { tgname: 'audit_log_no_truncate', tgenabled: 'O' },
      ])
    })

    it('não aplica DDL nem marca migração', async () => {
      await expect(app.db.query('create table evil (id int)')).rejects.toThrow()
      await expect(app.db.query(`insert into schema_migrations (id) values ('999_falsa')`)).rejects.toThrow()
      // com o banco em dia, migrate() não precisa de DDL (a API sobe com o papel de execução)
      expect(await migrate(app.db)).toEqual([])
    })

    it('a escrita normal da API continua auditada', async () => {
      const admin = await createUser(app, { roleId: 'superadmin' })
      const cookie = await sessionCookie(app, admin.id)
      const r = await api(app, 'POST', '/api/team/direct', {
        cookie,
        body: { name: 'Pessoa Auditada', email: 'auditada@teste.x2win', roleId: 'suporte', password: 'SenhaForte2027' },
      })
      expect(r.statusCode, r.body).toBe(200)
      const rows = await app.db.query<{ n: number }>('select count(*)::int as n from audit_log where actor_id = $1', [admin.id])
      expect(rows[0].n).toBeGreaterThanOrEqual(1)
    })
  })
})
