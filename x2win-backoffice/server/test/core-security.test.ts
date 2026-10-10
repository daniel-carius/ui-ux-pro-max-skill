// Regressões de segurança do núcleo (achados r1-web-1, r1-authn-8 e r1-logic-7, e as pendências da revisão: NODE_ENV
// ausente vale produção, Cache-Control em toda resposta, saída fora da lista de IPs, limite de corpo de 1 MiB e
// conflitos de concorrência do Postgres). Cada bloco afirma o comportamento seguro.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { BODY_LIMIT } from '../src/app'
import { loadConfig, SECURITY } from '../src/config'
import { migrate, openDb } from '../src/db'
import { RUNTIME_ROLE } from '../src/db/migrations'
import { webhookStrictMode } from '../src/modules/webhooks/url'
import { invalidateAllowlistCache } from '../src/plugins/security'
import { TEST_ENV, api, cookieFrom, createTestApp, createUser, sessionCookie } from './helpers'

function expectError(r: LightMyRequestResponse, status: number, code: string) {
  expect(r.statusCode, r.body).toBe(status)
  expect(r.json().error.code).toBe(code)
}

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

  // Quem ficou fora da lista (IP trocado, lista alterada por outra pessoa) não conseguia sair: o 403 deixava a
  // sessão valendo no servidor. A saída só encerra a sessão do próprio cookie, então fica fora da lista de IPs.
  it('saída fora da lista: 204, encerra só a sessão do próprio cookie e apaga o cookie', async () => {
    const u = await createUser(app, { roleId: 'suporte' })
    const own = await sessionCookie(app, u.id)
    const r = await api(app, 'POST', '/api/auth/logout', { cookie: own, ip: OUTSIDE })
    expect(r.statusCode, r.body).toBe(204)
    const cleared = r.cookies.find((k) => k.name === SECURITY.sessionCookie)
    expect(cleared?.value).toBe('')
    // a sessão caiu de verdade (conferido de dentro da lista); a de outra pessoa continua
    expectError(await api(app, 'GET', '/api/auth/me', { cookie: own, ip: INSIDE }), 401, 'nao_autenticado')
    expect((await api(app, 'GET', '/api/auth/me', { cookie, ip: INSIDE })).statusCode).toBe(200)
    // pelo caminho codificado é a mesma rota, com as mesmas regras
    const other = await sessionCookie(app, u.id)
    expect((await api(app, 'POST', '/%61pi/auth/logout', { cookie: other, ip: OUTSIDE })).statusCode).toBe(204)
    expectError(await api(app, 'GET', '/api/auth/me', { cookie: other, ip: INSIDE }), 401, 'nao_autenticado')
  })

  it('a exceção é só a saída: CSRF continua valendo nela, e o resto de /api/auth continua barrado fora da lista', async () => {
    expectError(await api(app, 'POST', '/api/auth/logout', { cookie, ip: OUTSIDE, csrf: false }), 403, 'requisicao_invalida')
    expectError(await api(app, 'GET', '/api/auth/logout', { cookie, ip: OUTSIDE }), 403, 'ip_nao_autorizado')
    expectError(await api(app, 'GET', '/api/auth/me', { cookie, ip: OUTSIDE }), 403, 'ip_nao_autorizado')
    expectError(await api(app, 'POST', '/api/auth/2fa/verify', { cookie, ip: OUTSIDE, body: { code: '123456' } }), 403, 'ip_nao_autorizado')
    expectError(await api(app, 'POST', '/api/auth/password', { cookie, ip: OUTSIDE, body: { newPassword: 'OutraSenha123' } }), 403, 'ip_nao_autorizado')
    // a sessão do cookie compartilhado segue valendo (nenhuma das recusas acima a encerrou)
    expect((await api(app, 'GET', '/api/auth/me', { cookie, ip: INSIDE })).statusCode).toBe(200)
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

    it('a saída (fora da lista de IPs) continua exigindo HTTPS', async () => {
      const u = await createUser(app, { roleId: 'suporte' })
      const cookie = await sessionCookie(app, u.id)
      expectError(await api(app, 'POST', '/api/auth/logout', { cookie, headers: proto('http') }), 403, 'https_obrigatorio')
      expect((await api(app, 'GET', '/api/auth/me', { cookie, headers: proto('https') })).statusCode).toBe(200)
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

// NODE_ENV ausente valia "development": cookie sem Secure e, sem a variável, nada lembrava a produção. Agora o padrão
// é produção (falha segura), e WEBHOOK_ALLOW_LOCAL_TARGETS (antes descartada pela validação) chega à configuração.
describe('configuração: sem NODE_ENV vale produção', () => {
  const minimal = { APP_SECRET: TEST_ENV.APP_SECRET, ENCRYPTION_KEY: TEST_ENV.ENCRYPTION_KEY }

  it('só com os segredos: NODE_ENV production, cookie Secure e webhooks estritos', () => {
    const c = loadConfig(minimal)
    expect(c.NODE_ENV).toBe('production')
    expect(c.COOKIE_SECURE).toBe(true)
    expect(c.WEBHOOK_ALLOW_LOCAL_TARGETS).toBe(false)
    expect(webhookStrictMode(c)).toBe(true)
    // a produção implícita recusa o cookie sem Secure, como a explícita
    expect(() => loadConfig({ ...minimal, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/)
  })

  it('a API montada sem NODE_ENV emite o cookie de sessão Secure', async () => {
    const app = await createTestApp({ NODE_ENV: undefined })
    try {
      expect(app.config.NODE_ENV).toBe('production')
      const u = await createUser(app, { roleId: 'suporte' })
      const r = await api(app, 'POST', '/api/auth/login', { body: { email: u.email, password: u.password } })
      expect(r.statusCode, r.body).toBe(200)
      expect(r.cookies.find((k) => k.name === SECURITY.sessionCookie)?.secure).toBe(true)
    } finally {
      await app.close()
    }
  })

  it('WEBHOOK_ALLOW_LOCAL_TARGETS vira booleano e só vale fora de produção', () => {
    const dev = (v?: string) => loadConfig({ ...minimal, NODE_ENV: 'development', WEBHOOK_ALLOW_LOCAL_TARGETS: v })
    expect(dev('true').WEBHOOK_ALLOW_LOCAL_TARGETS).toBe(true)
    expect(webhookStrictMode(dev('true'))).toBe(false)
    expect(dev('false').WEBHOOK_ALLOW_LOCAL_TARGETS).toBe(false)
    expect(webhookStrictMode(dev('false'))).toBe(true)
    expect(webhookStrictMode(dev())).toBe(true)
    expect(() => dev('sim')).toThrow(/WEBHOOK_ALLOW_LOCAL_TARGETS/)
    // em produção (explícita ou pelo padrão) a liberação impede a API de subir
    expect(() => loadConfig({ ...minimal, WEBHOOK_ALLOW_LOCAL_TARGETS: 'true' })).toThrow(/WEBHOOK_ALLOW_LOCAL_TARGETS/)
    expect(() => loadConfig({ ...minimal, NODE_ENV: 'production', WEBHOOK_ALLOW_LOCAL_TARGETS: 'true' })).toThrow(/WEBHOOK_ALLOW_LOCAL_TARGETS/)
  })

  it('os testes rodam com NODE_ENV=test (definido pelo vitest e pelo kit de testes)', async () => {
    expect(process.env.NODE_ENV).toBe('test')
    expect(TEST_ENV.NODE_ENV).toBe('test')
  })
})

// Só algumas rotas marcavam no-store: /api/health, 404, erros (inclusive os 403 da lista de IPs e do CSRF) e rotas
// novas podiam ficar no cache do navegador ou de um proxy.
describe('Cache-Control: no-store em toda resposta da API', () => {
  let app: FastifyInstance
  let cookie: string
  const noStore = (r: LightMyRequestResponse) => expect(r.headers['cache-control'], `${r.statusCode} ${r.body.slice(0, 120)}`).toBe('no-store')

  beforeAll(async () => {
    app = await createTestApp()
    // rotas novas, sem gancho próprio de Cache-Control
    app.get('/api/_teste/dados', async () => ({ ok: true }))
    app.get('/api/_teste/falha', async () => {
      throw new Error('falha de teste')
    })
    // rota que define o próprio Cache-Control fica com ele
    app.get('/api/_teste/cache-proprio', async (_req, reply) => reply.header('cache-control', 'private, max-age=60').send({ ok: true }))
    cookie = await sessionCookie(app, (await createUser(app, { roleId: 'superadmin' })).id)
  })
  afterAll(async () => app.close())

  it('saúde, rota nova, 404 e 500', async () => {
    noStore(await api(app, 'GET', '/api/health'))
    noStore(await api(app, 'GET', '/api/_teste/dados'))
    const notFound = await api(app, 'GET', '/api/nao-existe', { cookie })
    expect(notFound.statusCode).toBe(404)
    noStore(notFound)
    const boom = await api(app, 'GET', '/api/_teste/falha')
    expectError(boom, 500, 'erro_interno')
    noStore(boom)
  })

  it('recusas: sem sessão, CSRF, corpo grande, lista de IPs', async () => {
    noStore(await api(app, 'GET', '/api/withdrawals'))
    noStore(await api(app, 'POST', '/api/team/direct', { cookie, csrf: false, body: {} }))
    noStore(await api(app, 'POST', '/api/team/direct', { cookie, body: { pad: 'x'.repeat(BODY_LIMIT) } }))
    await app.db.query('update panel_security set allowlist = $1::jsonb where id = 1', [JSON.stringify([{ id: 'ip', value: '10.0.0.0/8', label: 'x' }])])
    invalidateAllowlistCache()
    try {
      const blocked = await api(app, 'GET', '/api/_teste/dados', { ip: '198.51.100.9' })
      expectError(blocked, 403, 'ip_nao_autorizado')
      noStore(blocked)
    } finally {
      await app.db.query(`update panel_security set allowlist = '[]'::jsonb where id = 1`)
      invalidateAllowlistCache()
    }
  })

  it('rota que já definiu o próprio Cache-Control fica com ele', async () => {
    const r = await api(app, 'GET', '/api/_teste/cache-proprio')
    expect(r.statusCode).toBe(200)
    expect(r.headers['cache-control']).toBe('private, max-age=60')
  })
})

// O bodyLimit da API era de 12 MB para todas as rotas (por causa das imagens em /api/kv): qualquer rota com sessão
// lia e parseava 12 MB. Agora 1 MiB, com limite próprio só nas rotas de dados por chave.
describe('limite de corpo: 1 MiB, com limite próprio só nas rotas de /api/kv', () => {
  let app: FastifyInstance
  let cookie: string
  beforeAll(async () => {
    app = await createTestApp()
    app.post('/api/_teste/eco', async (req) => ({ bytes: JSON.stringify(req.body).length }))
    cookie = await sessionCookie(app, (await createUser(app, { roleId: 'superadmin' })).id)
  })
  afterAll(async () => app.close())

  it('a API sobe com bodyLimit de 1 MiB', () => {
    expect(BODY_LIMIT).toBe(1024 * 1024)
    expect(app.initialConfig.bodyLimit).toBe(BODY_LIMIT)
  })

  it('sessão ativa, rota sem limite próprio: até 1 MiB passa; acima, 413 corpo_grande_demais (pt-BR) sem chegar na rota', async () => {
    const ok = await api(app, 'POST', '/api/_teste/eco', { cookie, body: { pad: 'x'.repeat(BODY_LIMIT - 64) } })
    expect(ok.statusCode, ok.body.slice(0, 200)).toBe(200)
    const big = await api(app, 'POST', '/api/_teste/eco', { cookie, body: { pad: 'x'.repeat(BODY_LIMIT) } })
    expectError(big, 413, 'corpo_grande_demais')
    expect(big.json().error.message).toBe('Os dados enviados passam do tamanho permitido.')
    // numa rota real: nada gravado
    const email = 'grande-demais@teste.x2win'
    const direct = await api(app, 'POST', '/api/team/direct', {
      cookie,
      body: { name: 'Pessoa', email, roleId: 'suporte', password: 'SenhaForte2027', pad: 'x'.repeat(BODY_LIMIT) },
    })
    expectError(direct, 413, 'corpo_grande_demais')
    expect(await app.db.one('select id from users where email = $1', [email])).toBeNull()
  })

  it('PUT /api/kv/:key continua lendo mais de 1 MiB (limite da rota): quem decide é a rota', async () => {
    const r = await api(app, 'PUT', '/api/kv/x', { cookie, body: { value: 'y'.repeat(2 * BODY_LIMIT) } })
    expectError(r, 404, 'chave_desconhecida')
  })
})

// Impasse (40P01) e falha de serialização (40001) do Postgres viravam 500 erro_interno ("a equipe técnica foi
// avisada"), apesar de a transação ter sido desfeita inteira e repetir resolver. Em qualquer rota.
describe('conflito de concorrência no Postgres → 409 versao_desatualizada', () => {
  let app: FastifyInstance
  let cookie: string
  const raise = (errcode: string) => `do $$ begin raise exception 'conflito simulado' using errcode = '${errcode}'; end $$`

  beforeAll(async () => {
    app = await createTestApp()
    // erros de verdade do banco: dentro de db.tx (rola tudo para trás) e fora dela
    app.post('/api/_teste/impasse', async () =>
      app.db.tx(async (t) => {
        await t.query(`insert into audit_log (actor_name, action, entity, summary) values ('t', 'teste', 'impasse', 'desfeito')`)
        await t.query(raise('deadlock_detected'))
      }),
    )
    app.post('/api/_teste/serializacao', async () => app.db.query(raise('serialization_failure')))
    app.post('/api/_teste/outro-erro', async () => app.db.query(raise('unique_violation')))
    app.get('/api/_teste/lancado', async () => {
      throw Object.assign(new Error('could not serialize access due to concurrent update'), { code: '40001' })
    })
    cookie = await sessionCookie(app, (await createUser(app, { roleId: 'superadmin' })).id)
  })
  afterAll(async () => app.close())

  for (const [path, method] of [
    ['/api/_teste/impasse', 'POST'],
    ['/api/_teste/serializacao', 'POST'],
    ['/api/_teste/lancado', 'GET'],
  ] as const) {
    it(`${method} ${path} → 409 com mensagem para recarregar`, async () => {
      const r = await api(app, method, path, { cookie })
      expectError(r, 409, 'versao_desatualizada')
      expect(r.json().error.message).toBe('Outra pessoa alterou estes dados ao mesmo tempo. Recarregue e tente de novo.')
      expect(r.body).not.toMatch(/conflito simulado|serialize|deadlock/)
    })
  }

  it('a transação do impasse foi desfeita; outros erros do banco continuam 500 sem detalhe', async () => {
    expect(await app.db.one(`select id from audit_log where entity = 'impasse'`)).toBeNull()
    const r = await api(app, 'POST', '/api/_teste/outro-erro', { cookie })
    expectError(r, 500, 'erro_interno')
    expect(r.body).not.toContain('conflito simulado')
  })
})
