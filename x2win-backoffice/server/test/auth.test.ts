import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { SECURITY } from '../src/config'
import { requireActive } from '../src/http'
import { sha256 } from '../src/lib/crypto'
import { totpCode } from '../src/lib/totp'
import { api, cookieFrom, createTestApp, createUser, sessionCookie } from './helpers'

// cada chamada de login usa um IP próprio para não esbarrar no limite de 10/min por IP
let ipSeq = 0
const nextIp = () => {
  ipSeq++
  return `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`
}

const PROBE = '/api/_teste/ativo'

function login(app: FastifyInstance, email: string, password: string, opts: { ip?: string; cookie?: string } = {}) {
  return api(app, 'POST', '/api/auth/login', { body: { email, password }, ip: opts.ip ?? nextIp(), cookie: opts.cookie })
}

const verify = (app: FastifyInstance, cookie: string, code: string, ip?: string) =>
  api(app, 'POST', '/api/auth/2fa/verify', { cookie, body: { code }, ip: ip ?? nextIp() })

const me = (app: FastifyInstance, cookie?: string) => api(app, 'GET', '/api/auth/me', { cookie })

const probe = (app: FastifyInstance, cookie?: string) => api(app, 'GET', PROBE, { cookie })

/** Código de 6 dígitos garantidamente diferente do atual. */
const wrongCode = (secret: string) => String((Number(totpCode(secret, Date.now())) + 500_000) % 1_000_000).padStart(6, '0')

function expectError(r: LightMyRequestResponse, status: number, code: string) {
  expect(r.statusCode, r.body).toBe(status)
  expect(r.json().error.code).toBe(code)
}

async function audits(app: FastifyInstance, userId: string, action?: string) {
  return app.db.query<{ action: string; entity: string; summary: string; ip: string; actor_name: string; source: string }>(
    `select action, entity, summary, ip, actor_name, source from audit_log
      where actor_id = $1 and ($2::text is null or action = $2) order by id`,
    [userId, action ?? null],
  )
}

async function userRow(app: FastifyInstance, id: string) {
  const r = await app.db.one<{
    failed_logins: number
    locked_until: string | null
    last_access_at: string | null
    last_ip: string | null
    must_change_password: boolean
    totp_enabled: boolean
    totp_secret_enc: string | null
    totp_pending_enc: string | null
    totp_last_counter: number | null
    recovery_codes: string[]
    password_hash: string
  }>('select * from users where id = $1', [id])
  return r!
}

describe('autenticação — /api/auth', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
    // rota de teste que só aceita login completo (como as rotas protegidas da API)
    app.get(PROBE, async (req) => ({ ok: true, user: requireActive(req).user.id }))
  })
  afterAll(async () => app.close())

  // ---------------------------------------------------------------- login
  describe('POST /login', () => {
    it('só com senha: etapa active, cookie seguro, /me completo, último acesso e auditoria', async () => {
      const u = await createUser(app, { roleId: 'financeiro', name: 'Fernanda Financeiro' })
      const r = await login(app, u.email.toUpperCase(), u.password, { ip: '10.9.9.9' })
      expect(r.statusCode, r.body).toBe(200)
      expect(r.json()).toEqual({ stage: 'active' })
      expect(r.headers['cache-control']).toBe('no-store')
      const c = r.cookies.find((k) => k.name === SECURITY.sessionCookie)!
      expect(c.httpOnly).toBe(true)
      expect(c.sameSite).toBe('Strict')
      expect(c.path).toBe('/')
      const cookie = cookieFrom(r)!

      // o banco guarda só o hash do token
      const token = cookie.split('=')[1]
      const s = await app.db.one<{ stage: string; user_id: string; ip: string }>('select stage, user_id, ip from sessions where id = $1', [sha256(token)])
      expect(s).toEqual({ stage: 'active', user_id: u.id, ip: '10.9.9.9' })
      expect(await app.db.one('select id from sessions where id = $1', [token])).toBeNull()

      const m = await me(app, cookie)
      expect(m.statusCode).toBe(200)
      const body = m.json()
      expect(body.stage).toBe('active')
      expect(body.user).toEqual({
        id: u.id,
        name: 'Fernanda Financeiro',
        email: u.email,
        roleId: 'financeiro',
        twoFactor: false,
        mustChangePassword: false,
        lastAccess: expect.any(String),
      })
      expect(body.role).toMatchObject({ id: 'financeiro', approvalCeiling: 5000, require2fa: false })
      expect(body.permissions).toContain('saques.aprovar')
      expect(body.permissions).not.toContain('cargos.conceder')
      expect(body.sessionTimeoutMinutes).toBe(240)
      expect(m.body).not.toMatch(/scrypt|password_hash|totp|recovery/i)

      const row = await userRow(app, u.id)
      expect(row.last_ip).toBe('10.9.9.9')
      expect(row.last_access_at).not.toBeNull()
      const logs = await audits(app, u.id, 'login')
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatchObject({ summary: 'Login com senha', ip: '10.9.9.9', actor_name: 'Fernanda Financeiro', source: 'servidor' })

      expect((await probe(app, cookie)).statusCode).toBe(200)
    })

    it('mesma resposta para e-mail desconhecido, senha errada e pessoa desligada ou convidada', async () => {
      const ativo = await createUser(app)
      const desligado = await createUser(app, { status: 'desligado' })
      const convidado = await createUser(app, { status: 'convidado' })
      const respostas = [
        await login(app, 'ninguem@teste.x2win', 'SenhaForte123'),
        await login(app, ativo.email, 'SenhaErrada999'),
        await login(app, desligado.email, desligado.password),
        await login(app, convidado.email, convidado.password),
      ]
      const bodies = respostas.map((r) => {
        expectError(r, 401, 'credenciais_invalidas')
        expect(cookieFrom(r)).toBeNull()
        return r.json()
      })
      for (const b of bodies) expect(b).toEqual(bodies[0])
      expect(bodies[0].error.message).toBe('E-mail ou senha incorretos.')
      // tentativas em pessoa inativa não contam bloqueio (nada muda para ela)
      expect((await userRow(app, desligado.id)).failed_logins).toBe(0)
      expect((await userRow(app, ativo.id)).failed_logins).toBe(1)
    })

    it('valida o corpo e exige o cabeçalho de segurança', async () => {
      expectError(await api(app, 'POST', '/api/auth/login', { body: { email: 'a@b.c' }, ip: nextIp() }), 400, 'dados_invalidos')
      expectError(await api(app, 'POST', '/api/auth/login', { body: { email: 123, password: 'x' }, ip: nextIp() }), 400, 'dados_invalidos')
      expectError(await api(app, 'POST', '/api/auth/login', { body: { email: '   ', password: 'x' }, ip: nextIp() }), 400, 'dados_invalidos')
      expectError(await api(app, 'POST', '/api/auth/login', { ip: nextIp() }), 400, 'dados_invalidos')
      expectError(
        await api(app, 'POST', '/api/auth/login', { body: { email: 'a@b.c', password: 'x'.repeat(300) }, ip: nextIp() }),
        400,
        'dados_invalidos',
      )
      const u = await createUser(app)
      expectError(
        await api(app, 'POST', '/api/auth/login', { body: { email: u.email, password: u.password }, csrf: false, ip: nextIp() }),
        403,
        'requisicao_invalida',
      )
    })

    it('5 erros seguidos bloqueiam por 15 min (423) e o acesso volta depois do prazo', async () => {
      const u = await createUser(app)
      for (let i = 0; i < SECURITY.maxFailedLogins - 1; i++) expectError(await login(app, u.email, 'SenhaErrada999'), 401, 'credenciais_invalidas')
      const t0 = Date.now()
      const fifth = await login(app, u.email, 'SenhaErrada999')
      expectError(fifth, 423, 'conta_bloqueada')
      const until = new Date(fifth.json().error.details.until).getTime()
      expect(until - t0).toBeGreaterThan((SECURITY.lockMinutes - 1) * 60_000)
      expect(until - t0).toBeLessThanOrEqual(SECURITY.lockMinutes * 60_000 + 5_000)
      expect(fifth.json().error.message).toMatch(/bloqueado/)

      // senha certa também é recusada enquanto durar o bloqueio
      const blocked = await login(app, u.email, u.password)
      expectError(blocked, 423, 'conta_bloqueada')
      expect(blocked.json().error.details.until).toBe(fifth.json().error.details.until)
      expect(cookieFrom(blocked)).toBeNull()
      expect((await audits(app, u.id, 'bloquear')).length).toBe(1)

      // passa o prazo
      await app.db.query(`update users set locked_until = now() - interval '1 minute' where id = $1`, [u.id])
      const ok = await login(app, u.email, u.password)
      expect(ok.statusCode, ok.body).toBe(200)
      expect(ok.json()).toEqual({ stage: 'active' })
      const row = await userRow(app, u.id)
      expect(row.failed_logins).toBe(0)
      expect(row.locked_until).toBeNull()
    })

    it('acerto zera a contagem: só erros seguidos bloqueiam', async () => {
      const u = await createUser(app)
      for (let i = 0; i < 4; i++) expectError(await login(app, u.email, 'SenhaErrada999'), 401, 'credenciais_invalidas')
      expect((await login(app, u.email, u.password)).statusCode).toBe(200)
      for (let i = 0; i < 4; i++) expectError(await login(app, u.email, 'SenhaErrada999'), 401, 'credenciais_invalidas')
      expect((await userRow(app, u.id)).failed_logins).toBe(4)
    })

    it('novo login no mesmo navegador encerra a sessão anterior', async () => {
      const u = await createUser(app)
      const c1 = cookieFrom(await login(app, u.email, u.password))!
      expect((await me(app, c1)).statusCode).toBe(200)
      const r2 = await login(app, u.email, u.password, { cookie: c1 })
      expect(r2.statusCode).toBe(200)
      const c2 = cookieFrom(r2)!
      expect(c2).not.toBe(c1)
      expectError(await me(app, c1), 401, 'nao_autenticado')
      expect((await me(app, c2)).statusCode).toBe(200)
      const revoked = await app.db.one<{ revoked_at: string | null }>('select revoked_at from sessions where id = $1', [sha256(c1.split('=')[1])])
      expect(revoked?.revoked_at).not.toBeNull()
    })

    it('limite de 10 tentativas por minuto por IP', async () => {
      const ip = '10.200.0.1'
      for (let i = 0; i < 10; i++) expectError(await login(app, `x${i}@teste.x2win`, 'SenhaErrada999', { ip }), 401, 'credenciais_invalidas')
      expectError(await login(app, 'x@teste.x2win', 'SenhaErrada999', { ip }), 429, 'muitas_tentativas')
      // outro IP segue normal
      expectError(await login(app, 'x@teste.x2win', 'SenhaErrada999', { ip: '10.200.0.2' }), 401, 'credenciais_invalidas')
    })
  })

  // ---------------------------------------------------------------- 2FA
  describe('POST /2fa/verify', () => {
    it('senha → 2fa → active; a etapa pendente não acessa a API', async () => {
      const u = await createUser(app, { totp: true })
      const r = await login(app, u.email, u.password)
      expect(r.json()).toEqual({ stage: '2fa' })
      const cookie = cookieFrom(r)!

      const m = await me(app, cookie)
      expect(m.statusCode).toBe(200)
      expect(m.json().stage).toBe('2fa')
      expect(m.json().user.twoFactor).toBe(true)
      expect(m.json().role).toBeUndefined()
      expect(m.json().permissions).toBeUndefined()
      expect(m.json().sessionTimeoutMinutes).toBeUndefined()

      const p = await probe(app, cookie)
      expectError(p, 403, 'etapa_pendente')
      expect(p.json().error.details).toEqual({ stage: '2fa' })
      expectError(await api(app, 'POST', '/api/auth/2fa/setup', { cookie }), 403, 'etapa_pendente')
      expectError(await api(app, 'POST', '/api/auth/password', { cookie, body: { newPassword: 'OutraSenha123' } }), 403, 'etapa_pendente')
      // ainda não houve acesso completo
      expect((await userRow(app, u.id)).last_access_at).toBeNull()
      expect(await audits(app, u.id, 'login')).toHaveLength(0)

      expectError(await verify(app, cookie, wrongCode(u.totpSecret!)), 401, 'credenciais_invalidas')
      expectError(await verify(app, cookie, 'abc'), 401, 'credenciais_invalidas')
      expectError(await api(app, 'POST', '/api/auth/2fa/verify', { cookie, body: {}, ip: nextIp() }), 400, 'dados_invalidos')
      expect((await userRow(app, u.id)).failed_logins).toBe(2)

      const ok = await verify(app, cookie, totpCode(u.totpSecret!, Date.now()), '10.8.8.8')
      expect(ok.statusCode, ok.body).toBe(200)
      expect(ok.json()).toEqual({ stage: 'active' })
      expect((await probe(app, cookie)).statusCode).toBe(200)
      expect((await me(app, cookie)).json().stage).toBe('active')

      const row = await userRow(app, u.id)
      expect(row.failed_logins).toBe(0)
      expect(row.last_ip).toBe('10.8.8.8')
      const logs = await audits(app, u.id, 'login')
      expect(logs.map((l) => l.summary)).toEqual(['Login com 2FA'])

      // sessão já ativa não volta à etapa 2fa
      const again = await verify(app, cookie, totpCode(u.totpSecret!, Date.now() + 30_000))
      expectError(again, 403, 'etapa_pendente')
      expect(again.json().error.details).toEqual({ stage: 'active' })
    })

    it('recusa reutilizar o mesmo código (mesmo passo de tempo)', async () => {
      const u = await createUser(app, { totp: true })
      const code = totpCode(u.totpSecret!, Date.now())
      const c1 = cookieFrom(await login(app, u.email, u.password))!
      expect((await verify(app, c1, code)).statusCode).toBe(200)
      const last = (await userRow(app, u.id)).totp_last_counter
      expect(typeof last).toBe('number')

      const c2 = cookieFrom(await login(app, u.email, u.password))!
      expectError(await verify(app, c2, code), 401, 'credenciais_invalidas')
      expectError(await probe(app, c2), 403, 'etapa_pendente')
      // passo seguinte é aceito
      const next = await verify(app, c2, totpCode(u.totpSecret!, Date.now() + 30_000))
      expect(next.statusCode, next.body).toBe(200)
      expect((await userRow(app, u.id)).totp_last_counter).toBeGreaterThan(last!)
    })

    it('código errado conta como tentativa: 5 erros bloqueiam a conta', async () => {
      const u = await createUser(app, { totp: true })
      const cookie = cookieFrom(await login(app, u.email, u.password))!
      for (let i = 0; i < SECURITY.maxFailedLogins - 1; i++) expectError(await verify(app, cookie, wrongCode(u.totpSecret!)), 401, 'credenciais_invalidas')
      const fifth = await verify(app, cookie, wrongCode(u.totpSecret!))
      expectError(fifth, 423, 'conta_bloqueada')
      expect(typeof fifth.json().error.details.until).toBe('string')
      expectError(await verify(app, cookie, totpCode(u.totpSecret!, Date.now())), 423, 'conta_bloqueada')
      expectError(await login(app, u.email, u.password), 423, 'conta_bloqueada')
      expectError(await probe(app, cookie), 403, 'etapa_pendente')
    })

    it('limite de 10 tentativas por minuto por IP', async () => {
      const u = await createUser(app, { totp: true })
      const cookie = cookieFrom(await login(app, u.email, u.password))!
      const ip = '10.201.0.1'
      const statuses: number[] = []
      for (let i = 0; i < 11; i++) statuses.push((await verify(app, cookie, wrongCode(u.totpSecret!), ip)).statusCode)
      expect(statuses.slice(0, 4)).toEqual([401, 401, 401, 401])
      expect(statuses.slice(4, 10).every((s) => s === 423)).toBe(true)
      expect(statuses[10]).toBe(429)
    })

    it('sem sessão: 401', async () => {
      expectError(await api(app, 'POST', '/api/auth/2fa/verify', { body: { code: '123456' }, ip: nextIp() }), 401, 'nao_autenticado')
    })
  })

  describe('cadastro do 2FA (setup + enable)', () => {
    it('cargo que exige 2FA força o cadastro; depois entra com código de recuperação (uso único)', async () => {
      const u = await createUser(app, { roleId: 'marketing-oficial' })
      const r = await login(app, u.email, u.password)
      expect(r.json()).toEqual({ stage: 'enroll' })
      const cookie = cookieFrom(r)!
      const p = await probe(app, cookie)
      expectError(p, 403, 'etapa_pendente')
      expect(p.json().error.details).toEqual({ stage: 'enroll' })
      expectError(await verify(app, cookie, '123456'), 403, 'etapa_pendente')
      expectError(await api(app, 'POST', '/api/auth/password', { cookie, body: { newPassword: 'OutraSenha123' } }), 403, 'etapa_pendente')
      const m = await me(app, cookie)
      expect(m.json().stage).toBe('enroll')
      expect(m.json().permissions).toBeUndefined()

      // confirmar sem gerar o QR code
      expectError(await api(app, 'POST', '/api/auth/2fa/enable', { cookie, body: { code: '123456' } }), 400, 'dados_invalidos')

      const s1 = await api(app, 'POST', '/api/auth/2fa/setup', { cookie })
      expect(s1.statusCode, s1.body).toBe(200)
      expect(s1.headers['cache-control']).toBe('no-store')
      const first = s1.json().secret as string
      expect(first).toMatch(/^[A-Z2-7]{32}$/)
      // gerar de novo troca o segredo pendente
      const s2 = await api(app, 'POST', '/api/auth/2fa/setup', { cookie })
      const { secret, otpauthUrl } = s2.json() as { secret: string; otpauthUrl: string }
      expect(secret).not.toBe(first)
      expect(otpauthUrl.startsWith('otpauth://totp/')).toBe(true)
      expect(otpauthUrl).toContain(`secret=${secret}`)
      expect(otpauthUrl).toContain(encodeURIComponent(u.email))

      let row = await userRow(app, u.id)
      expect(row.totp_enabled).toBe(false)
      expect(row.totp_secret_enc).toBeNull()
      expect(row.totp_pending_enc).not.toContain(secret)
      expect(app.cipher.decrypt(row.totp_pending_enc!)).toBe(secret)

      // código do segredo antigo, código errado e corpo vazio
      expectError(await api(app, 'POST', '/api/auth/2fa/enable', { cookie, body: { code: wrongCode(secret) } }), 401, 'credenciais_invalidas')
      expectError(await api(app, 'POST', '/api/auth/2fa/enable', { cookie, body: { code: '' } }), 400, 'dados_invalidos')
      expectError(await probe(app, cookie), 403, 'etapa_pendente')

      const code = totpCode(secret, Date.now())
      const en = await api(app, 'POST', '/api/auth/2fa/enable', { cookie, body: { code }, ip: '10.7.7.7' })
      expect(en.statusCode, en.body).toBe(200)
      expect(en.headers['cache-control']).toBe('no-store')
      const { stage, recoveryCodes } = en.json() as { stage: string; recoveryCodes: string[] }
      expect(stage).toBe('active')
      expect(recoveryCodes).toHaveLength(8)
      expect(new Set(recoveryCodes).size).toBe(8)
      for (const rc of recoveryCodes) expect(rc).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/)
      expect((await probe(app, cookie)).statusCode).toBe(200)

      row = await userRow(app, u.id)
      expect(row.totp_enabled).toBe(true)
      expect(row.totp_pending_enc).toBeNull()
      expect(app.cipher.decrypt(row.totp_secret_enc!)).toBe(secret)
      // só os hashes ficam no banco
      expect([...row.recovery_codes].sort()).toEqual(recoveryCodes.map((c) => sha256(c)).sort())
      expect(JSON.stringify(row.recovery_codes)).not.toContain(recoveryCodes[0])
      expect(row.last_ip).toBe('10.7.7.7')

      const ligar = await audits(app, u.id, 'ligar')
      expect(ligar).toHaveLength(1)
      expect(ligar[0].entity).toBe('2FA')
      expect((await audits(app, u.id, 'login')).map((l) => l.summary)).toEqual(['Login com 2FA'])

      // já ligado
      expectError(await api(app, 'POST', '/api/auth/2fa/setup', { cookie }), 409, 'ja_configurado')
      expectError(await api(app, 'POST', '/api/auth/2fa/enable', { cookie, body: { code } }), 409, 'ja_configurado')

      // próximo login pede o código; o código usado no cadastro não vale de novo
      expect((await api(app, 'POST', '/api/auth/logout', { cookie })).statusCode).toBe(204)
      const r2 = await login(app, u.email, u.password)
      expect(r2.json()).toEqual({ stage: '2fa' })
      const c2 = cookieFrom(r2)!
      expectError(await verify(app, c2, code), 401, 'credenciais_invalidas')

      // código de recuperação (aceita minúsculas)
      const rv = await verify(app, c2, recoveryCodes[0].toLowerCase())
      expect(rv.statusCode, rv.body).toBe(200)
      expect(rv.json()).toEqual({ stage: 'active' })
      expect((await probe(app, c2)).statusCode).toBe(200)
      expect((await userRow(app, u.id)).recovery_codes).toHaveLength(7)
      expect((await audits(app, u.id, 'login')).at(-1)?.summary).toBe('Login com 2FA (código de recuperação)')

      // uso único
      await api(app, 'POST', '/api/auth/logout', { cookie: c2 })
      const c3 = cookieFrom(await login(app, u.email, u.password))!
      expectError(await verify(app, c3, recoveryCodes[0]), 401, 'credenciais_invalidas')
      expect((await verify(app, c3, recoveryCodes[1].replace('-', ''))).statusCode).toBe(200)
      expect((await userRow(app, u.id)).recovery_codes).toHaveLength(6)
    })

    it('"2FA para todos" na segurança do painel obriga o cadastro', async () => {
      await app.db.query('update panel_security set enforce_2fa_all = true where id = 1')
      try {
        const u = await createUser(app, { roleId: 'superadmin' })
        const r = await login(app, u.email, u.password)
        expect(r.json()).toEqual({ stage: 'enroll' })
        expectError(await probe(app, cookieFrom(r)!), 403, 'etapa_pendente')
        // quem já tem 2FA segue para o código
        const t = await createUser(app, { totp: true })
        expect((await login(app, t.email, t.password)).json()).toEqual({ stage: '2fa' })
      } finally {
        await app.db.query('update panel_security set enforce_2fa_all = false where id = 1')
      }
      const livre = await createUser(app, { roleId: 'superadmin' })
      expect((await login(app, livre.email, livre.password)).json()).toEqual({ stage: 'active' })
    })

    it('ligar o 2FA por vontade própria mantém a sessão ativa', async () => {
      const u = await createUser(app, { roleId: 'suporte' })
      const cookie = cookieFrom(await login(app, u.email, u.password))!
      const { secret } = (await api(app, 'POST', '/api/auth/2fa/setup', { cookie })).json() as { secret: string }
      const en = await api(app, 'POST', '/api/auth/2fa/enable', { cookie, body: { code: totpCode(secret, Date.now()) } })
      expect(en.statusCode, en.body).toBe(200)
      expect(en.json().stage).toBe('active')
      expect(en.json().recoveryCodes).toHaveLength(8)
      expect((await probe(app, cookie)).statusCode).toBe(200)
      expect((await me(app, cookie)).json().user.twoFactor).toBe(true)
      // só o login com senha foi registrado como acesso
      expect((await audits(app, u.id, 'login')).map((l) => l.summary)).toEqual(['Login com senha'])
      expect(await audits(app, u.id, 'ligar')).toHaveLength(1)
    })

    it('etapas erradas e sem sessão', async () => {
      expectError(await api(app, 'POST', '/api/auth/2fa/setup', {}), 401, 'nao_autenticado')
      expectError(await api(app, 'POST', '/api/auth/2fa/enable', { body: { code: '123456' } }), 401, 'nao_autenticado')
      const u = await createUser(app)
      const pw = await sessionCookie(app, u.id, 'password')
      expectError(await api(app, 'POST', '/api/auth/2fa/setup', { cookie: pw }), 403, 'etapa_pendente')
      expectError(await api(app, 'POST', '/api/auth/2fa/enable', { cookie: pw, body: { code: '123456' } }), 403, 'etapa_pendente')
      const tf = await sessionCookie(app, u.id, '2fa')
      expectError(await api(app, 'POST', '/api/auth/2fa/setup', { cookie: tf }), 403, 'etapa_pendente')
    })
  })

  // ---------------------------------------------------------------- senha
  describe('POST /password', () => {
    it('troca obrigatória: etapa password, regras da senha, depois active', async () => {
      const u = await createUser(app, { mustChangePassword: true })
      const outra = await sessionCookie(app, u.id, 'active')
      const r = await login(app, u.email, u.password)
      expect(r.json()).toEqual({ stage: 'password' })
      const cookie = cookieFrom(r)!
      const m = await me(app, cookie)
      expect(m.json().stage).toBe('password')
      expect(m.json().user.mustChangePassword).toBe(true)
      const p = await probe(app, cookie)
      expectError(p, 403, 'etapa_pendente')
      expect(p.json().error.details).toEqual({ stage: 'password' })
      expectError(await api(app, 'POST', '/api/auth/2fa/setup', { cookie }), 403, 'etapa_pendente')
      expectError(await verify(app, cookie, '123456'), 403, 'etapa_pendente')

      const pw = (body: unknown) => api(app, 'POST', '/api/auth/password', { cookie, body, ip: '10.6.6.6' })
      const curta = await pw({ newPassword: 'curta1' })
      expectError(curta, 400, 'dados_invalidos')
      expect(curta.json().error.message).toMatch(/10 caracteres/)
      const fraca = await pw({ newPassword: 'somenteletrasaqui' })
      expectError(fraca, 400, 'dados_invalidos')
      expect(fraca.json().error.message).toMatch(/letras e números/)
      expectError(await pw({ newPassword: '12345678901234' }), 400, 'dados_invalidos')
      const igual = await pw({ newPassword: u.password })
      expectError(igual, 400, 'dados_invalidos')
      expect(igual.json().error.message).toMatch(/diferente/)
      expectError(await pw({}), 400, 'dados_invalidos')
      expect((await userRow(app, u.id)).must_change_password).toBe(true)

      // na etapa password a senha atual é dispensada
      const ok = await pw({ newPassword: 'NovaSenhaForte456' })
      expect(ok.statusCode, ok.body).toBe(200)
      expect(ok.json()).toEqual({ stage: 'active' })
      expect((await probe(app, cookie)).statusCode).toBe(200)
      expect((await me(app, cookie)).json().user.mustChangePassword).toBe(false)
      expect((await userRow(app, u.id)).must_change_password).toBe(false)
      // as outras sessões caem
      expectError(await me(app, outra), 401, 'nao_autenticado')

      const editar = await audits(app, u.id, 'editar')
      expect(editar).toHaveLength(1)
      expect(editar[0]).toMatchObject({ entity: 'Senha', ip: '10.6.6.6' })
      expect((await audits(app, u.id, 'login')).map((l) => l.summary)).toEqual(['Login com senha'])

      await api(app, 'POST', '/api/auth/logout', { cookie })
      expectError(await login(app, u.email, u.password), 401, 'credenciais_invalidas')
      expect((await login(app, u.email, 'NovaSenhaForte456')).json()).toEqual({ stage: 'active' })
    })

    it('troca obrigatória com 2FA ligado segue para a etapa 2fa', async () => {
      const u = await createUser(app, { totp: true, mustChangePassword: true })
      const cookie = cookieFrom(await login(app, u.email, u.password))!
      const r = await api(app, 'POST', '/api/auth/password', { cookie, body: { newPassword: 'NovaSenhaForte456' } })
      expect(r.statusCode, r.body).toBe(200)
      expect(r.json()).toEqual({ stage: '2fa' })
      expectError(await probe(app, cookie), 403, 'etapa_pendente')
      expect(await audits(app, u.id, 'login')).toHaveLength(0)
      expect((await verify(app, cookie, totpCode(u.totpSecret!, Date.now()))).statusCode).toBe(200)
      expect((await probe(app, cookie)).statusCode).toBe(200)
    })

    it('troca obrigatória com cargo que exige 2FA segue para o cadastro', async () => {
      const u = await createUser(app, { roleId: 'marketing-oficial', mustChangePassword: true })
      const cookie = cookieFrom(await login(app, u.email, u.password))!
      const r = await api(app, 'POST', '/api/auth/password', { cookie, body: { newPassword: 'NovaSenhaForte456' } })
      expect(r.json()).toEqual({ stage: 'enroll' })
    })

    it('com sessão ativa exige a senha atual e encerra as outras sessões', async () => {
      const u = await createUser(app)
      const cookie = cookieFrom(await login(app, u.email, u.password))!
      const outra = await sessionCookie(app, u.id, 'active')
      const pendente = await sessionCookie(app, u.id, '2fa')
      const pw = (body: unknown) => api(app, 'POST', '/api/auth/password', { cookie, body })

      const sem = await pw({ newPassword: 'NovaSenhaForte456' })
      expectError(sem, 400, 'dados_invalidos')
      expect(sem.json().error.message).toMatch(/senha atual/)
      expectError(await pw({ currentPassword: 'SenhaErrada999', newPassword: 'NovaSenhaForte456' }), 401, 'credenciais_invalidas')
      expectError(await pw({ currentPassword: u.password, newPassword: 'fraca' }), 400, 'dados_invalidos')
      expectError(await pw({ currentPassword: u.password, newPassword: u.password }), 400, 'dados_invalidos')
      // senha atual errada não derruba a sessão nem bloqueia o login
      expect((await probe(app, cookie)).statusCode).toBe(200)
      expect((await me(app, outra)).statusCode).toBe(200)

      const ok = await pw({ currentPassword: u.password, newPassword: 'NovaSenhaForte456' })
      expect(ok.statusCode, ok.body).toBe(200)
      expect(ok.json()).toEqual({ stage: 'active' })
      expect((await probe(app, cookie)).statusCode).toBe(200)
      expectError(await me(app, outra), 401, 'nao_autenticado')
      expectError(await me(app, pendente), 401, 'nao_autenticado')

      const editar = await audits(app, u.id, 'editar')
      expect(editar).toHaveLength(1)
      expect(editar[0].entity).toBe('Senha')
      expect(editar[0].summary).toMatch(/2 outras sessões encerradas/)
      // não é um novo login
      expect(await audits(app, u.id, 'login')).toHaveLength(1)

      expectError(await login(app, u.email, u.password), 401, 'credenciais_invalidas')
      expect((await login(app, u.email, 'NovaSenhaForte456')).statusCode).toBe(200)
    })

    it('sem sessão: 401', async () => {
      expectError(await api(app, 'POST', '/api/auth/password', { body: { newPassword: 'NovaSenhaForte456' } }), 401, 'nao_autenticado')
    })
  })

  // ---------------------------------------------------------------- sessão
  describe('POST /logout e GET /me', () => {
    it('saída encerra a sessão e apaga o cookie', async () => {
      const u = await createUser(app)
      const cookie = cookieFrom(await login(app, u.email, u.password))!
      const r = await api(app, 'POST', '/api/auth/logout', { cookie })
      expect(r.statusCode).toBe(204)
      const cleared = r.cookies.find((k) => k.name === SECURITY.sessionCookie)
      expect(cleared?.value).toBe('')
      expect(cleared?.expires && cleared.expires.getTime()).toBeLessThanOrEqual(Date.now())
      expectError(await me(app, cookie), 401, 'nao_autenticado')
      expectError(await probe(app, cookie), 401, 'nao_autenticado')
      const s = await app.db.one<{ revoked_at: string | null }>('select revoked_at from sessions where id = $1', [sha256(cookie.split('=')[1])])
      expect(s?.revoked_at).not.toBeNull()
    })

    it('saída também encerra sessão em etapa pendente e responde 204 sem sessão', async () => {
      const u = await createUser(app, { totp: true })
      const cookie = cookieFrom(await login(app, u.email, u.password))!
      expect((await api(app, 'POST', '/api/auth/logout', { cookie })).statusCode).toBe(204)
      expectError(await verify(app, cookie, totpCode(u.totpSecret!, Date.now())), 401, 'nao_autenticado')
      expect((await api(app, 'POST', '/api/auth/logout', {})).statusCode).toBe(204)
      expectError(await api(app, 'POST', '/api/auth/logout', { csrf: false }), 403, 'requisicao_invalida')
    })

    it('/me sem sessão, com sessão expirada ou de pessoa desligada: 401', async () => {
      expectError(await me(app), 401, 'nao_autenticado')
      expectError(await me(app, `${SECURITY.sessionCookie}=token-inventado`), 401, 'nao_autenticado')
      const u = await createUser(app, { totp: true })
      const cookie = cookieFrom(await login(app, u.email, u.password))!
      expect((await me(app, cookie)).statusCode).toBe(200)
      await app.db.query(`update sessions set expires_at = now() - interval '1 second' where user_id = $1`, [u.id])
      expectError(await me(app, cookie), 401, 'nao_autenticado')

      const d = await createUser(app)
      const dc = cookieFrom(await login(app, d.email, d.password))!
      await app.db.query(`update users set status = 'desligado' where id = $1`, [d.id])
      expectError(await me(app, dc), 401, 'nao_autenticado')
    })

    it('/me reflete o tempo de inatividade configurado', async () => {
      await app.db.query('update panel_security set session_timeout_minutes = 30 where id = 1')
      try {
        const u = await createUser(app, { roleId: 'suporte' })
        const cookie = cookieFrom(await login(app, u.email, u.password))!
        const body = (await me(app, cookie)).json()
        expect(body.sessionTimeoutMinutes).toBe(30)
        expect(body.role.id).toBe('suporte')
        expect(body.permissions).toContain('usuarios.ver')
        expect(body.permissions).not.toContain('saques.aprovar')
      } finally {
        await app.db.query('update panel_security set session_timeout_minutes = 240 where id = 1')
      }
    })
  })
})
