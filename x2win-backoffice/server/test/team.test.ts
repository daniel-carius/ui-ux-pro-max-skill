import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { findKvRule } from '@shared/kv-registry'
import { effectivePermissions, seedRoles } from '@shared/permissions'
import { seedTeam } from '@/data/team'
import { ensureAdmin, warnLookAlikeNames } from '../src/bootstrap'
import { newId, passwordProblem, sha256 } from '../src/lib/crypto'
import type { KvContext } from '../src/kv/types'
import { PASSWORD_BUSY_RETRY_AFTER_SECONDS, PASSWORD_GATE_LIMITS, passwordGate } from '../src/modules/auth/password-gate'
import { kvHandlers } from '../src/modules/team/kv'
import { checkMemberName } from '../src/modules/team/service'
import { seedDemo } from '../src/modules/team/seed'
import { getRole, toCents } from '../src/services/roles-repo'
import type { AuthContext } from '../src/types'
import { api, cookieFrom, createTestApp, createUser, loginAs, sessionCookie } from './helpers'

// ---------- utilitários locais ----------

let ipSeq = 1
/** IP novo a cada chamada de login (o login tem limite de 10/min por IP). */
const freshIp = () => `10.20.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`

async function login(app: FastifyInstance, email: string, password: string) {
  return api(app, 'POST', '/api/auth/login', { body: { email, password }, ip: freshIp() })
}

/** Aceite de convite a partir de um IP novo (a rota tem limite de 10/min por IP). */
async function accept(app: FastifyInstance, body: unknown) {
  return api(app, 'POST', '/api/team/invites/accept', { body, ip: freshIp() })
}

async function authFor(app: FastifyInstance, userId: string, ip = '127.0.0.1'): Promise<AuthContext> {
  const u = await app.db.one<{
    id: string
    name: string
    email: string
    role_id: string
    status: 'ativo' | 'desligado' | 'convidado'
    totp_enabled: boolean
    must_change_password: boolean
  }>('select id, name, email, role_id, status, totp_enabled, must_change_password from users where id = $1', [userId])
  if (!u) throw new Error('usuário não existe')
  const role = (await getRole(app.db, u.role_id))!
  return {
    user: { id: u.id, name: u.name, email: u.email, roleId: u.role_id, status: u.status, totpEnabled: u.totp_enabled, mustChangePassword: u.must_change_password },
    role,
    perms: new Set(effectivePermissions(role)),
    sessionId: 'sessao-de-teste',
    stage: 'active',
    ip,
  }
}

function ctxFor(app: FastifyInstance, auth: AuthContext, clientIp = '127.0.0.1'): KvContext {
  const key = 'equipe.membros'
  return { app, req: { clientIp } as unknown as FastifyRequest, auth, key, rule: findKvRule(key)! }
}

const team = kvHandlers.team!

async function createRole(app: FastifyInstance, id: string, permissions: string[], opts: { require2fa?: boolean } = {}) {
  await app.db.query(
    `insert into roles (id, name, description, system, permissions, require_2fa, approval_ceiling_cents, color)
     values ($1, $2, '', false, $3, $4, $5, 'violet')`,
    [id, `Cargo ${id}`, permissions, opts.require2fa ?? false, toCents(0)],
  )
}

async function userRow(app: FastifyInstance, id: string) {
  return app.db.one<{
    status: string
    role_id: string
    name: string
    email: string
    password_hash: string | null
    must_change_password: boolean
    totp_enabled: boolean
    totp_secret_enc: string | null
    recovery_codes: string[]
  }>('select * from users where id = $1', [id])
}

async function lastAudit(app: FastifyInstance) {
  return app.db.one<{ action: string; entity: string; summary: string; actor_id: string; ip: string }>(
    'select action, entity, summary, actor_id, ip from audit_log order by id desc limit 1',
  )
}

async function openSessions(app: FastifyInstance, userId: string) {
  const r = await app.db.one<{ n: number }>('select count(*)::int as n from sessions where user_id = $1 and revoked_at is null', [userId])
  return r?.n ?? 0
}

function tokenOf(url: string) {
  const m = /#\/convite\?token=([^&]+)$/.exec(url)
  if (!m) throw new Error(`link sem token: ${url}`)
  return decodeURIComponent(m[1])
}

// ---------- rotas ----------

describe('equipe: criar acesso direto', () => {
  let app: FastifyInstance
  let admin: Awaited<ReturnType<typeof loginAs>>
  beforeAll(async () => {
    app = await createTestApp()
    admin = await loginAs(app, 'superadmin')
  })
  afterAll(async () => app.close())

  it('cria pessoa ativa com senha temporária forte e troca obrigatória', async () => {
    const r = await api(app, 'POST', '/api/team/direct', { cookie: admin.cookie, body: { name: ' Ana Paula ', email: 'Ana.Paula@X2Win.bet', roleId: 'suporte' } })
    expect(r.statusCode).toBe(200)
    expect(r.headers['cache-control']).toBe('no-store')
    const body = r.json()
    expect(body.member).toMatchObject({ name: 'Ana Paula', email: 'ana.paula@x2win.bet', roleId: 'suporte', status: 'ativo', twoFactor: false, activeSessions: 0 })
    expect(Object.keys(body.member).sort()).toEqual(
      ['activeSessions', 'createdAt', 'email', 'id', 'lastAccess', 'lastIp', 'name', 'roleId', 'status', 'twoFactor'].sort(),
    )
    expect(typeof body.temporaryPassword).toBe('string')
    expect(passwordProblem(body.temporaryPassword, 10)).toBeNull()
    const row = await userRow(app, body.member.id)
    expect(row?.must_change_password).toBe(true)
    expect(row?.password_hash).toMatch(/^scrypt\$/)
    expect(row?.password_hash).not.toContain(body.temporaryPassword)
    const audit = await lastAudit(app)
    expect(audit).toMatchObject({ action: 'criar', actor_id: admin.user.id, ip: '127.0.0.1' })
    expect(audit?.summary).not.toContain(body.temporaryPassword)

    // a senha temporária entra e pede a troca
    const l = await login(app, 'ana.paula@x2win.bet', body.temporaryPassword)
    expect(l.statusCode).toBe(200)
    expect(l.json()).toEqual({ stage: 'password' })
  })

  it('e-mail repetido (sem diferenciar maiúsculas) → 409 email_em_uso', async () => {
    const r1 = await api(app, 'POST', '/api/team/direct', { cookie: admin.cookie, body: { name: 'Bruno', email: 'bruno@x2win.bet', roleId: 'suporte' } })
    expect(r1.statusCode).toBe(200)
    const r2 = await api(app, 'POST', '/api/team/direct', { cookie: admin.cookie, body: { name: 'Bruno 2', email: 'BRUNO@x2win.bet', roleId: 'suporte' } })
    expect(r2.statusCode).toBe(409)
    expect(r2.json().error.code).toBe('email_em_uso')
    const r3 = await api(app, 'POST', '/api/team/invite', { cookie: admin.cookie, body: { email: ' Bruno@X2WIN.bet ', roleId: 'suporte' } })
    expect(r3.statusCode).toBe(409)
    expect(r3.json().error.code).toBe('email_em_uso')
  })

  it('valida o corpo', async () => {
    for (const body of [
      {},
      { name: 'Ana', email: 'sem-arroba', roleId: 'suporte' },
      { name: 'A', email: 'a@x2win.bet', roleId: 'suporte' },
      { name: 'Ana', email: 'a@x2win.bet' },
      { name: 'Ana', email: 'a@x2win.bet', roleId: '' },
      { name: 'x'.repeat(101), email: 'a@x2win.bet', roleId: 'suporte' },
    ]) {
      const r = await api(app, 'POST', '/api/team/direct', { cookie: admin.cookie, body })
      expect(r.statusCode, JSON.stringify(body)).toBe(400)
      expect(r.json().error.code).toBe('dados_invalidos')
    }
  })

  it('cargo inexistente → 400', async () => {
    const r = await api(app, 'POST', '/api/team/direct', { cookie: admin.cookie, body: { name: 'Ana', email: 'nada@x2win.bet', roleId: 'nao-existe' } })
    expect(r.statusCode).toBe(400)
    expect(r.json().error.code).toBe('dados_invalidos')
  })

  it('exige sessão ativa e equipe.editar', async () => {
    const body = { name: 'Carla', email: 'carla@x2win.bet', roleId: 'suporte' }
    const anon = await api(app, 'POST', '/api/team/direct', { body })
    expect(anon.statusCode).toBe(401)
    const pendingUser = await createUser(app, { roleId: 'superadmin' })
    const pending = await api(app, 'POST', '/api/team/direct', { cookie: await sessionCookie(app, pendingUser.id, '2fa'), body })
    expect(pending.statusCode).toBe(403)
    expect(pending.json().error.code).toBe('etapa_pendente')
    const sup = await loginAs(app, 'suporte')
    const denied = await api(app, 'POST', '/api/team/direct', { cookie: sup.cookie, body })
    expect(denied.statusCode).toBe(403)
    expect(denied.json().error.code).toBe('sem_permissao')
    const noCsrf = await api(app, 'POST', '/api/team/direct', { cookie: admin.cookie, body, csrf: false })
    expect(noCsrf.statusCode).toBe(403)
    expect(noCsrf.json().error.code).toBe('requisicao_invalida')
    expect(await app.db.one(`select id from users where email = 'carla@x2win.bet'`)).toBeNull()
  })

  it('Administrador (sem cargos.conceder) não cria acesso com cargo administrativo', async () => {
    const adm = await loginAs(app, 'administrador')
    for (const roleId of ['superadmin', 'administrador']) {
      const r = await api(app, 'POST', '/api/team/direct', { cookie: adm.cookie, body: { name: 'Novo Admin', email: `${roleId}-novo@x2win.bet`, roleId } })
      expect(r.statusCode).toBe(403)
      expect(r.json().error.code).toBe('sem_permissao')
      const i = await api(app, 'POST', '/api/team/invite', { cookie: adm.cookie, body: { email: `${roleId}-conv@x2win.bet`, roleId } })
      expect(i.statusCode).toBe(403)
    }
    // cargo personalizado com permissão administrativa também conta
    await createRole(app, 'gestor-acessos', ['equipe.ver', 'equipe.editar'])
    const g = await api(app, 'POST', '/api/team/direct', { cookie: adm.cookie, body: { name: 'Gestor', email: 'gestor@x2win.bet', roleId: 'gestor-acessos' } })
    expect(g.statusCode).toBe(403)
    const ok = await api(app, 'POST', '/api/team/direct', { cookie: adm.cookie, body: { name: 'Suporte Novo', email: 'suporte-novo@x2win.bet', roleId: 'suporte' } })
    expect(ok.statusCode).toBe(200)
  })

  it('lastIp na resposta só para quem tem equipe.ver', async () => {
    await createRole(app, 'so-editar-equipe', ['equipe.editar'])
    const ed = await loginAs(app, 'so-editar-equipe')
    const r = await api(app, 'POST', '/api/team/direct', { cookie: ed.cookie, body: { name: 'Sem IP', email: 'sem-ip@x2win.bet', roleId: 'suporte' } })
    // o cargo-alvo (suporte) não é administrativo, então basta equipe.editar
    expect(r.statusCode).toBe(200)
    expect(r.json().member.lastIp).toBeNull()
  })
})

describe('equipe: convites', () => {
  let app: FastifyInstance
  let admin: Awaited<ReturnType<typeof loginAs>>
  beforeAll(async () => {
    app = await createTestApp({ CORS_ORIGIN: 'https://painel.x2win.bet/, https://outro.x2win.bet' })
    admin = await loginAs(app, 'superadmin')
  })
  afterAll(async () => app.close())

  it('convida com token de 72 h guardado só como hash e link na origem do painel', async () => {
    const r = await api(app, 'POST', '/api/team/invite', { cookie: admin.cookie, body: { email: 'Ana.Clara@x2win.bet', roleId: 'suporte' } })
    expect(r.statusCode).toBe(200)
    const { member, inviteUrl } = r.json()
    expect(member).toMatchObject({ name: 'Ana Clara', email: 'ana.clara@x2win.bet', status: 'convidado', roleId: 'suporte' })
    expect(inviteUrl.startsWith('https://painel.x2win.bet/#/convite?token=')).toBe(true)
    const token = tokenOf(inviteUrl)
    expect(token.length).toBeGreaterThanOrEqual(40)
    const inv = await app.db.one<{ token_hash: string; hours: number; created_by: string; used_at: string | null }>(
      `select token_hash, extract(epoch from (expires_at - now())) / 3600 as hours, created_by, used_at from invites where user_id = $1`,
      [member.id],
    )
    expect(inv?.token_hash).toBe(sha256(token))
    expect(Number(inv?.hours)).toBeGreaterThan(71.9)
    expect(Number(inv?.hours)).toBeLessThanOrEqual(72)
    expect(inv?.created_by).toBe(admin.user.id)
    expect(await app.db.one(`select 1 from invites where token_hash = $1`, [token])).toBeNull()
    const row = await userRow(app, member.id)
    expect(row?.password_hash).toBeNull()
    expect((await lastAudit(app))?.action).toBe('convidar')

    // convidado não entra com senha nenhuma
    const l = await login(app, 'ana.clara@x2win.bet', 'qualquer123senha')
    expect(l.statusCode).toBe(401)
  })

  it('aceite define a senha, ativa o acesso e permite login; o nome continua o que quem convidou registrou', async () => {
    const r = await api(app, 'POST', '/api/team/invite', { cookie: admin.cookie, body: { email: 'diego@x2win.bet', roleId: 'suporte', name: 'Diego' } })
    const token = tokenOf(r.json().inviteUrl)
    const id = r.json().member.id

    // sem sessão; senha fraca é recusada e o convite continua valendo
    const weak = await accept(app, { token, name: 'Diego Alves', password: 'curta1' })
    expect(weak.statusCode).toBe(400)
    const noDigits = await accept(app, { token, name: 'Diego Alves', password: 'somenteletras' })
    expect(noDigits.statusCode).toBe(400)

    // a rota é pública: o nome enviado é ignorado (trocar o nome é pela tela Equipe, com auditoria)
    const ok = await accept(app, { token, name: 'Diego Alves', password: 'SenhaForte123' })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toEqual({ ok: true })
    const row = await userRow(app, id)
    expect(row).toMatchObject({ status: 'ativo', name: 'Diego', must_change_password: false })
    expect(row?.password_hash).toMatch(/^scrypt\$/)
    const audit = await lastAudit(app)
    expect(audit).toMatchObject({ action: 'editar', actor_id: id, entity: 'Equipe · Diego' })

    const l = await login(app, 'diego@x2win.bet', 'SenhaForte123')
    expect(l.statusCode).toBe(200)
    expect(l.json()).toEqual({ stage: 'active' })

    // convite usado não vale de novo
    const again = await accept(app, { token, name: 'Outro', password: 'OutraSenha123' })
    expect(again.statusCode).toBe(400)
    expect(again.json().error.message).toMatch(/já foi usado/)
    expect((await userRow(app, id))?.name).toBe('Diego')
  })

  it('aceite sem nome também vale (o painel antigo ainda envia o campo; ele é ignorado)', async () => {
    const r = await api(app, 'POST', '/api/team/invite', { cookie: admin.cookie, body: { email: 'sem.nome@x2win.bet', roleId: 'suporte' } })
    const ok = await accept(app, { token: tokenOf(r.json().inviteUrl), password: 'SenhaForte123' })
    expect(ok.statusCode, ok.body).toBe(200)
    expect((await userRow(app, r.json().member.id))?.name).toBe('Sem Nome')
  })

  it('convite vencido, desconhecido ou de pessoa desligada é recusado', async () => {
    const r = await api(app, 'POST', '/api/team/invite', { cookie: admin.cookie, body: { email: 'vencido@x2win.bet', roleId: 'suporte' } })
    const token = tokenOf(r.json().inviteUrl)
    await app.db.query(`update invites set expires_at = now() - interval '1 minute' where user_id = $1`, [r.json().member.id])
    const exp = await accept(app, { token, name: 'Vencido', password: 'SenhaForte123' })
    expect(exp.statusCode).toBe(400)
    expect(exp.json().error.message).toMatch(/expirou/)
    expect((await userRow(app, r.json().member.id))?.status).toBe('convidado')

    const bad = await accept(app, { token: 'x'.repeat(43), name: 'Ninguém', password: 'SenhaForte123' })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.message).toMatch(/inválido/)

    const r2 = await api(app, 'POST', '/api/team/invite', { cookie: admin.cookie, body: { email: 'cancelado@x2win.bet', roleId: 'suporte' } })
    const t2 = tokenOf(r2.json().inviteUrl)
    const d = await api(app, 'POST', `/api/team/${r2.json().member.id}/deactivate`, { cookie: admin.cookie })
    expect(d.statusCode).toBe(200)
    const acc = await accept(app, { token: t2, name: 'Cancelado', password: 'SenhaForte123' })
    expect(acc.statusCode).toBe(400)
    expect((await userRow(app, r2.json().member.id))?.status).toBe('desligado')
  })

  it('reenviar gera link novo e invalida o anterior', async () => {
    const r = await api(app, 'POST', '/api/team/invite', { cookie: admin.cookie, body: { email: 'reenvio@x2win.bet', roleId: 'suporte' } })
    const id = r.json().member.id
    const oldToken = tokenOf(r.json().inviteUrl)
    const re = await api(app, 'POST', `/api/team/${id}/resend-invite`, { cookie: admin.cookie })
    expect(re.statusCode).toBe(200)
    expect(Object.keys(re.json())).toEqual(['inviteUrl'])
    const newToken = tokenOf(re.json().inviteUrl)
    expect(newToken).not.toBe(oldToken)
    expect((await lastAudit(app))?.action).toBe('convidar')
    const old = await accept(app, { token: oldToken, name: 'Reenvio', password: 'SenhaForte123' })
    expect(old.statusCode).toBe(400)
    const ok = await accept(app, { token: newToken, name: 'Reenvio', password: 'SenhaForte123' })
    expect(ok.statusCode).toBe(200)
    // já aceitou: não dá para reenviar
    const after = await api(app, 'POST', `/api/team/${id}/resend-invite`, { cookie: admin.cookie })
    expect(after.statusCode).toBe(400)
    const missing = await api(app, 'POST', '/api/team/u_nao_existe/resend-invite', { cookie: admin.cookie })
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('nao_encontrado')
  })

  it('reenviar exige equipe.editar e cargos.conceder para cargo administrativo', async () => {
    const r = await api(app, 'POST', '/api/team/invite', { cookie: admin.cookie, body: { email: 'novo-admin@x2win.bet', roleId: 'administrador' } })
    expect(r.statusCode).toBe(200)
    const id = r.json().member.id
    const adm = await loginAs(app, 'administrador')
    const denied = await api(app, 'POST', `/api/team/${id}/resend-invite`, { cookie: adm.cookie })
    expect(denied.statusCode).toBe(403)
    const sup = await loginAs(app, 'suporte')
    const denied2 = await api(app, 'POST', `/api/team/${id}/resend-invite`, { cookie: sup.cookie })
    expect(denied2.statusCode).toBe(403)
  })

  it('aceite tem limite de 10 por minuto por IP', async () => {
    const ip = '10.99.0.1'
    const codes: number[] = []
    for (let i = 0; i < 11; i++) {
      const r = await api(app, 'POST', '/api/team/invites/accept', { ip, body: { token: 'y'.repeat(43), name: 'Teste', password: 'SenhaForte123' } })
      codes.push(r.statusCode)
    }
    expect(codes.slice(0, 10).every((c) => c === 400)).toBe(true)
    expect(codes[10]).toBe(429)
  })
})

describe('equipe: origem do link de convite sem CORS_ORIGIN', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp({ CORS_ORIGIN: '' })
  })
  afterAll(async () => app.close())

  it('usa a origem da requisição e, sem ela, o host', async () => {
    const { cookie } = await loginAs(app)
    const a = await api(app, 'POST', '/api/team/invite', {
      cookie,
      body: { email: 'origem@x2win.bet', roleId: 'suporte' },
      headers: { origin: 'http://localhost:5173' },
    })
    expect(a.json().inviteUrl.startsWith('http://localhost:5173/#/convite?token=')).toBe(true)
    const b = await api(app, 'POST', '/api/team/invite', {
      cookie,
      body: { email: 'host@x2win.bet', roleId: 'suporte' },
      headers: { host: 'painel.local:8080', origin: 'javascript:alert(1)' },
    })
    expect(b.json().inviteUrl.startsWith('http://painel.local:8080/#/convite?token=')).toBe(true)
  })
})

describe('equipe: desativar, reativar, cargo e 2FA', () => {
  let app: FastifyInstance
  let admin: Awaited<ReturnType<typeof loginAs>>
  beforeAll(async () => {
    app = await createTestApp()
    admin = await loginAs(app, 'superadmin')
  })
  afterAll(async () => app.close())

  it('desativar encerra as sessões na hora (o cookie deixa de valer)', async () => {
    const target = await createUser(app, { roleId: 'suporte' })
    const c1 = await sessionCookie(app, target.id)
    const c2 = await sessionCookie(app, target.id)
    expect((await api(app, 'GET', '/api/auth/me', { cookie: c1 })).statusCode).toBe(200)
    const r = await api(app, 'POST', `/api/team/${target.id}/deactivate`, { cookie: admin.cookie })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ ok: true, member: { id: target.id, status: 'desligado', activeSessions: 0 } })
    expect(await openSessions(app, target.id)).toBe(0)
    expect((await api(app, 'GET', '/api/auth/me', { cookie: c1 })).statusCode).toBe(401)
    expect((await api(app, 'GET', '/api/auth/me', { cookie: c2 })).statusCode).toBe(401)
    const audit = await lastAudit(app)
    expect(audit).toMatchObject({ action: 'desativar', actor_id: admin.user.id })
    expect(audit?.summary).toMatch(/2 sessões encerradas/)
    // desligado não entra
    expect((await login(app, target.email, target.password)).statusCode).toBe(401)
    // já desligado
    const again = await api(app, 'POST', `/api/team/${target.id}/deactivate`, { cookie: admin.cookie })
    expect(again.statusCode).toBe(400)
  })

  it('reativar devolve o acesso; quem nunca aceitou o convite volta como convidado', async () => {
    const target = await createUser(app, { roleId: 'suporte', status: 'desligado' })
    const r = await api(app, 'POST', `/api/team/${target.id}/reactivate`, { cookie: admin.cookie })
    expect(r.statusCode).toBe(200)
    expect(r.json().member.status).toBe('ativo')
    expect((await login(app, target.email, target.password)).statusCode).toBe(200)
    const again = await api(app, 'POST', `/api/team/${target.id}/reactivate`, { cookie: admin.cookie })
    expect(again.statusCode).toBe(400)

    const inv = await api(app, 'POST', '/api/team/invite', { cookie: admin.cookie, body: { email: 'volta@x2win.bet', roleId: 'suporte' } })
    const id = inv.json().member.id
    await api(app, 'POST', `/api/team/${id}/deactivate`, { cookie: admin.cookie })
    const back = await api(app, 'POST', `/api/team/${id}/reactivate`, { cookie: admin.cookie })
    expect(back.json().member.status).toBe('convidado')
    expect((await api(app, 'POST', `/api/team/${id}/resend-invite`, { cookie: admin.cookie })).statusCode).toBe(200)
  })

  it('não desativa a si mesmo nem muda o próprio cargo', async () => {
    const d = await api(app, 'POST', `/api/team/${admin.user.id}/deactivate`, { cookie: admin.cookie })
    expect(d.statusCode).toBe(400)
    expect(d.json().error.code).toBe('dados_invalidos')
    const r = await api(app, 'POST', `/api/team/${admin.user.id}/role`, { cookie: admin.cookie, body: { roleId: 'suporte' } })
    expect(r.statusCode).toBe(400)
    const z = await api(app, 'POST', `/api/team/${admin.user.id}/reset-2fa`, { cookie: admin.cookie })
    expect(z.statusCode).toBe(400)
    expect((await userRow(app, admin.user.id))).toMatchObject({ status: 'ativo', role_id: 'superadmin' })
  })

  it('troca de cargo: valida, audita e respeita cargos.conceder', async () => {
    const target = await createUser(app, { roleId: 'suporte', name: 'Fulano' })
    const bad = await api(app, 'POST', `/api/team/${target.id}/role`, { cookie: admin.cookie, body: { roleId: 'nao-existe' } })
    expect(bad.statusCode).toBe(400)
    const same = await api(app, 'POST', `/api/team/${target.id}/role`, { cookie: admin.cookie, body: { roleId: 'suporte' } })
    expect(same.statusCode).toBe(400)
    const empty = await api(app, 'POST', `/api/team/${target.id}/role`, { cookie: admin.cookie, body: {} })
    expect(empty.statusCode).toBe(400)
    const missing = await api(app, 'POST', `/api/team/u_inexistente/role`, { cookie: admin.cookie, body: { roleId: 'suporte' } })
    expect(missing.statusCode).toBe(404)

    const ok = await api(app, 'POST', `/api/team/${target.id}/role`, { cookie: admin.cookie, body: { roleId: 'financeiro' } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().member.roleId).toBe('financeiro')
    expect(await lastAudit(app)).toMatchObject({ action: 'editar', entity: 'Equipe · Fulano', summary: 'Cargo alterado: Suporte → Financeiro.' })

    // Administrador não tem cargos.conceder
    const adm = await loginAs(app, 'administrador')
    const promote = await api(app, 'POST', `/api/team/${target.id}/role`, { cookie: adm.cookie, body: { roleId: 'superadmin' } })
    expect(promote.statusCode).toBe(403)
    expect(promote.json().error.code).toBe('sem_permissao')
    const promote2 = await api(app, 'POST', `/api/team/${target.id}/role`, { cookie: adm.cookie, body: { roleId: 'administrador' } })
    expect(promote2.statusCode).toBe(403)
    expect((await userRow(app, target.id))?.role_id).toBe('financeiro')
    const lateral = await api(app, 'POST', `/api/team/${target.id}/role`, { cookie: adm.cookie, body: { roleId: 'suporte' } })
    expect(lateral.statusCode).toBe(200)

    // nem rebaixar / desativar / redefinir 2FA de quem tem cargo administrativo
    const boss = await createUser(app, { roleId: 'superadmin' })
    const otherAdm = await createUser(app, { roleId: 'administrador' })
    for (const [url, body] of [
      [`/api/team/${boss.id}/role`, { roleId: 'suporte' }],
      [`/api/team/${otherAdm.id}/role`, { roleId: 'suporte' }],
      [`/api/team/${boss.id}/deactivate`, undefined],
      [`/api/team/${otherAdm.id}/deactivate`, undefined],
      [`/api/team/${otherAdm.id}/reset-2fa`, undefined],
    ] as const) {
      const r = await api(app, 'POST', url, { cookie: adm.cookie, body })
      expect(r.statusCode, url).toBe(403)
    }
    expect((await userRow(app, boss.id))).toMatchObject({ status: 'ativo', role_id: 'superadmin' })

    // Suporte não tem equipe.editar
    const sup = await loginAs(app, 'suporte')
    const s = await api(app, 'POST', `/api/team/${target.id}/role`, { cookie: sup.cookie, body: { roleId: 'financeiro' } })
    expect(s.statusCode).toBe(403)
    const s2 = await api(app, 'POST', `/api/team/${target.id}/deactivate`, { cookie: sup.cookie })
    expect(s2.statusCode).toBe(403)
    const s3 = await api(app, 'POST', `/api/team/${target.id}/reactivate`, { cookie: sup.cookie })
    expect(s3.statusCode).toBe(403)
    const s4 = await api(app, 'POST', `/api/team/${target.id}/reset-2fa`, { cookie: sup.cookie })
    expect(s4.statusCode).toBe(403)
  })

  it('Superadmin promove e rebaixa cargo administrativo', async () => {
    const target = await createUser(app, { roleId: 'suporte' })
    const up = await api(app, 'POST', `/api/team/${target.id}/role`, { cookie: admin.cookie, body: { roleId: 'superadmin' } })
    expect(up.statusCode).toBe(200)
    const down = await api(app, 'POST', `/api/team/${target.id}/role`, { cookie: admin.cookie, body: { roleId: 'administrador' } })
    expect(down.statusCode).toBe(200)
  })

  it('redefinir 2FA desliga o fator e encerra as sessões', async () => {
    const target = await createUser(app, { roleId: 'financeiro', totp: true })
    await app.db.query(`update users set recovery_codes = $2 where id = $1`, [target.id, ['abc', 'def']])
    const c = await sessionCookie(app, target.id)
    const r = await api(app, 'POST', `/api/team/${target.id}/reset-2fa`, { cookie: admin.cookie })
    expect(r.statusCode).toBe(200)
    expect(r.json().member.twoFactor).toBe(false)
    const row = await userRow(app, target.id)
    expect(row).toMatchObject({ totp_enabled: false, totp_secret_enc: null, recovery_codes: [] })
    expect((await api(app, 'GET', '/api/auth/me', { cookie: c })).statusCode).toBe(401)
    expect((await lastAudit(app))?.action).toBe('desligar')
    // no próximo login: cargo sem exigência entra direto; com "2FA para todos" vai para o cadastro
    await app.db.query('update panel_security set enforce_2fa_all = true where id = 1')
    const l = await login(app, target.email, target.password)
    expect(l.json()).toEqual({ stage: 'enroll' })
    await app.db.query('update panel_security set enforce_2fa_all = false where id = 1')
  })
})

describe('equipe: nunca sem Superadmin ativo', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
    await createRole(app, 'gestor', ['equipe.ver', 'equipe.editar', 'cargos.conceder'])
  })
  afterAll(async () => app.close())

  it('recusa desativar ou rebaixar o último Superadmin (rotas e chave)', async () => {
    const boss = await createUser(app, { roleId: 'superadmin', name: 'Chefe' })
    const g = await loginAs(app, 'gestor')
    const d = await api(app, 'POST', `/api/team/${boss.id}/deactivate`, { cookie: g.cookie })
    expect(d.statusCode).toBe(400)
    expect(d.json().error.message).toMatch(/último Superadmin/)
    const r = await api(app, 'POST', `/api/team/${boss.id}/role`, { cookie: g.cookie, body: { roleId: 'administrador' } })
    expect(r.statusCode).toBe(400)

    const auth = await authFor(app, g.user.id)
    const cur = await team.read(ctxFor(app, auth))
    const list = (cur!.value as { id: string; status: string; roleId: string }[]).map((m) => (m.id === boss.id ? { ...m, status: 'desligado' } : m))
    await expect(team.write!(ctxFor(app, auth), list, cur!.version)).rejects.toMatchObject({ status: 400 })

    // com um segundo Superadmin ativo, o primeiro pode sair, e aí o segundo vira o último
    const second = await createUser(app, { roleId: 'superadmin' })
    expect((await api(app, 'POST', `/api/team/${boss.id}/deactivate`, { cookie: g.cookie })).statusCode).toBe(200)
    expect((await api(app, 'POST', `/api/team/${second.id}/deactivate`, { cookie: g.cookie })).statusCode).toBe(400)
    expect((await api(app, 'POST', `/api/team/${second.id}/role`, { cookie: g.cookie, body: { roleId: 'suporte' } })).statusCode).toBe(400)
    // promover alguém e rebaixar o antigo na mesma gravação funciona (promoção vem antes)
    const cur2 = await team.read(ctxFor(app, auth))
    const third = await createUser(app, { roleId: 'suporte' })
    const cur3 = await team.read(ctxFor(app, auth))
    expect(cur3!.version).toBe(cur2!.version) // criar direto no banco não mexe na versão
    const swap = (cur3!.value as { id: string; roleId: string }[]).map((m) =>
      m.id === second.id ? { ...m, roleId: 'suporte' } : m.id === third.id ? { ...m, roleId: 'superadmin' } : m,
    )
    const saved = await team.write!(ctxFor(app, auth), swap, cur3!.version)
    const after = saved.value as { id: string; roleId: string }[]
    expect(after.find((m) => m.id === second.id)?.roleId).toBe('suporte')
    expect(after.find((m) => m.id === third.id)?.roleId).toBe('superadmin')
  })
})

// ---------- chave equipe.membros ----------

describe('equipe.membros (chave)', () => {
  let app: FastifyInstance
  let adminId: string
  beforeAll(async () => {
    app = await createTestApp()
    adminId = (await loginAs(app, 'superadmin')).user.id
  })
  afterAll(async () => app.close())

  it('leitura: qualquer pessoa logada; lastIp só com equipe.ver; sessões ativas contadas', async () => {
    const target = await createUser(app, { roleId: 'financeiro', name: 'Contado', totp: true })
    await app.db.query(`update users set last_ip = '189.45.12.207', last_access_at = now() where id = $1`, [target.id])
    await sessionCookie(app, target.id)
    await sessionCookie(app, target.id)
    await sessionCookie(app, target.id, '2fa')
    const revoked = await sessionCookie(app, target.id)
    await app.db.query(`update sessions set revoked_at = now() where id = $1`, [sha256(revoked.split('=')[1])])
    const expired = await sessionCookie(app, target.id)
    await app.db.query(`update sessions set expires_at = now() - interval '1 second' where id = $1`, [sha256(expired.split('=')[1])])
    const idle = await sessionCookie(app, target.id)
    await app.db.query(`update sessions set last_seen_at = now() - interval '5 hours' where id = $1`, [sha256(idle.split('=')[1])])

    const sup = await createUser(app, { roleId: 'suporte' })
    const supView = await team.read(ctxFor(app, await authFor(app, sup.id)))
    const m1 = (supView!.value as Record<string, unknown>[]).find((m) => m.id === target.id)!
    expect(m1).toMatchObject({ name: 'Contado', roleId: 'financeiro', status: 'ativo', twoFactor: true, lastIp: null, activeSessions: 3 })
    expect(typeof m1.lastAccess).toBe('string')
    expect(Object.keys(m1).sort()).toEqual(['activeSessions', 'createdAt', 'email', 'id', 'lastAccess', 'lastIp', 'name', 'roleId', 'status', 'twoFactor'].sort())

    const adminView = await team.read(ctxFor(app, await authFor(app, adminId)))
    const m2 = (adminView!.value as Record<string, unknown>[]).find((m) => m.id === target.id)!
    expect(m2.lastIp).toBe('189.45.12.207')
    const json = JSON.stringify(adminView)
    expect(json).not.toMatch(/scrypt|password|totp_secret|recovery/)
  })

  it('gravação exige equipe.editar e versão atual', async () => {
    const sup = await createUser(app, { roleId: 'suporte' })
    const supAuth = await authFor(app, sup.id)
    const cur = await team.read(ctxFor(app, supAuth))
    await expect(team.write!(ctxFor(app, supAuth), cur!.value, cur!.version)).rejects.toMatchObject({ status: 403, code: 'sem_permissao' })

    const auth = await authFor(app, adminId)
    const first = await team.write!(ctxFor(app, auth), cur!.value, cur!.version)
    expect(first.version).toBe(cur!.version + 1)
    expect((await lastAudit(app))?.summary).toMatch(/sem alterações/)
    await expect(team.write!(ctxFor(app, auth), cur!.value, cur!.version)).rejects.toMatchObject({
      status: 409,
      code: 'versao_desatualizada',
      details: { version: first.version },
    })
    await expect(team.write!(ctxFor(app, auth), cur!.value, undefined)).rejects.toMatchObject({ status: 409 })

    // ações pelas rotas também mudam a versão
    const { cookie } = await loginAs(app)
    const before = await team.read(ctxFor(app, auth))
    const inv = await api(app, 'POST', '/api/team/invite', { cookie, body: { email: 'versao@x2win.bet', roleId: 'suporte' } })
    expect(inv.statusCode).toBe(200)
    await expect(team.write!(ctxFor(app, auth), before!.value, before!.version)).rejects.toMatchObject({ status: 409 })
  })

  it('incluir ou remover pessoa pela chave → 403 campo_nao_permitido', async () => {
    const auth = await authFor(app, adminId)
    const cur = await team.read(ctxFor(app, auth))
    const list = cur!.value as Record<string, unknown>[]
    const added = [...list, { id: 'u_novo', name: 'Intrusa', email: 'intrusa@x2win.bet', roleId: 'superadmin', status: 'ativo' }]
    await expect(team.write!(ctxFor(app, auth), added, cur!.version)).rejects.toMatchObject({ status: 403, code: 'campo_nao_permitido' })
    const removed = list.filter((m) => m.id !== adminId)
    await expect(team.write!(ctxFor(app, auth), removed, cur!.version)).rejects.toMatchObject({ status: 403, code: 'campo_nao_permitido' })
    expect(await app.db.one(`select id from users where email = 'intrusa@x2win.bet'`)).toBeNull()
    await expect(team.write!(ctxFor(app, auth), [...list, list[0]], cur!.version)).rejects.toMatchObject({ status: 400 })
    await expect(team.write!(ctxFor(app, auth), { not: 'a list' }, cur!.version)).rejects.toThrow()
  })

  it('aplica nome, cargo e status; ignora os demais campos', async () => {
    const target = await createUser(app, { roleId: 'suporte', name: 'Antes' })
    const back = await createUser(app, { roleId: 'suporte', status: 'desligado' })
    const c = await sessionCookie(app, target.id)
    const auth = await authFor(app, adminId)
    const cur = await team.read(ctxFor(app, auth))
    const list = (cur!.value as Record<string, unknown>[]).map((m) =>
      m.id === target.id
        ? { ...m, name: 'Depois', roleId: 'financeiro', status: 'desligado', email: 'trocado@x2win.bet', twoFactor: true, lastIp: '1.2.3.4', activeSessions: 99 }
        : m.id === back.id
          ? { ...m, status: 'ativo' }
          : m,
    )
    const saved = await team.write!(ctxFor(app, auth), list, cur!.version)
    expect(saved.version).toBe(cur!.version + 1)
    const row = await userRow(app, target.id)
    expect(row).toMatchObject({ name: 'Depois', role_id: 'financeiro', status: 'desligado', email: target.email, totp_enabled: false })
    expect((await userRow(app, back.id))?.status).toBe('ativo')
    expect((await api(app, 'GET', '/api/auth/me', { cookie: c })).statusCode).toBe(401)
    const audits = await app.db.query<{ action: string; summary: string }>(
      `select action, summary from audit_log where entity in ('Equipe · Depois', 'Equipe · Antes') order by id`,
    )
    expect(audits.map((a) => a.action)).toEqual(['editar', 'editar', 'desativar'])
  })

  it('regras na chave: próprio acesso, status inválido e cargos administrativos', async () => {
    const auth = await authFor(app, adminId)
    let cur = await team.read(ctxFor(app, auth))
    const mine = (patch: Record<string, unknown>) => (cur!.value as Record<string, unknown>[]).map((m) => (m.id === adminId ? { ...m, ...patch } : m))
    await expect(team.write!(ctxFor(app, auth), mine({ status: 'desligado' }), cur!.version)).rejects.toMatchObject({ status: 400 })
    await expect(team.write!(ctxFor(app, auth), mine({ roleId: 'suporte' }), cur!.version)).rejects.toMatchObject({ status: 400 })
    // trocar o próprio nome pode
    const renamed = await team.write!(ctxFor(app, auth), mine({ name: 'Eu Mesmo' }), cur!.version)
    expect((await userRow(app, adminId))?.name).toBe('Eu Mesmo')
    cur = renamed

    const target = await createUser(app, { roleId: 'suporte' })
    cur = await team.read(ctxFor(app, auth))
    const asInvited = (cur!.value as Record<string, unknown>[]).map((m) => (m.id === target.id ? { ...m, status: 'convidado' } : m))
    await expect(team.write!(ctxFor(app, auth), asInvited, cur!.version)).rejects.toMatchObject({ status: 400 })
    const badName = (cur!.value as Record<string, unknown>[]).map((m) => (m.id === target.id ? { ...m, name: ' ' } : m))
    await expect(team.write!(ctxFor(app, auth), badName, cur!.version)).rejects.toThrow()

    // Administrador: não promove a Superadmin nem mexe em cargo administrativo; tudo ou nada
    const adm = await createUser(app, { roleId: 'administrador' })
    const boss = await createUser(app, { roleId: 'superadmin', name: 'Boss' })
    const admAuth = await authFor(app, adm.id)
    cur = await team.read(ctxFor(app, admAuth))
    const promote = (cur!.value as Record<string, unknown>[]).map((m) =>
      m.id === target.id ? { ...m, roleId: 'superadmin', name: 'Promovido' } : m,
    )
    await expect(team.write!(ctxFor(app, admAuth), promote, cur!.version)).rejects.toMatchObject({ status: 403, code: 'sem_permissao' })
    expect((await userRow(app, target.id))).toMatchObject({ role_id: 'suporte', name: 'Pessoa Teste' })
    const renameBoss = (cur!.value as Record<string, unknown>[]).map((m) => (m.id === boss.id ? { ...m, name: 'Boss Renomeado' } : m))
    await expect(team.write!(ctxFor(app, admAuth), renameBoss, cur!.version)).rejects.toMatchObject({ status: 403 })
    const offBoss = (cur!.value as Record<string, unknown>[]).map((m) => (m.id === boss.id ? { ...m, status: 'desligado' } : m))
    await expect(team.write!(ctxFor(app, admAuth), offBoss, cur!.version)).rejects.toMatchObject({ status: 403 })
    // nem põe ninguém em cargo com governança (Financeiro aprova saques)
    const toFin = (cur!.value as Record<string, unknown>[]).map((m) => (m.id === target.id ? { ...m, roleId: 'financeiro' } : m))
    await expect(team.write!(ctxFor(app, admAuth), toFin, cur!.version)).rejects.toMatchObject({ status: 403, code: 'sem_permissao' })
    expect((await userRow(app, target.id))?.role_id).toBe('suporte')
    // mexer em cargo comum pode
    const lateral = (cur!.value as Record<string, unknown>[]).map((m) => (m.id === target.id ? { ...m, roleId: 'marketing' } : m))
    const ok = await team.write!(ctxFor(app, admAuth), lateral, cur!.version)
    expect((ok.value as { id: string; roleId: string }[]).find((m) => m.id === target.id)?.roleId).toBe('marketing')
  })

  // A tela Auditoria agrupa as linhas por quem fez ("nome (e-mail)", pelo id): quem lê a auditoria precisa do id e do
  // e-mail de cada pessoa da equipe, inclusive de quem foi desligado.
  it('leitura para a auditoria: quem só vê a auditoria recebe id e e-mail de cada pessoa', async () => {
    await createRole(app, 'so-auditoria', ['auditoria.ver'])
    const viewer = await loginAs(app, 'so-auditoria', { name: 'Leitora Auditoria' })
    await createUser(app, { roleId: 'suporte', name: 'Pessoa Desligada', status: 'desligado' })
    const r = await api(app, 'GET', '/api/kv/equipe.membros', { cookie: viewer.cookie })
    expect(r.statusCode, r.body).toBe(200)
    const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    const got = (r.json().value as { id: string; email: string; lastIp: string | null }[]).sort(byId)
    const rows = (await app.db.query<{ id: string; email: string }>('select id, email from users')).sort(byId)
    expect(got.map((m) => ({ id: m.id, email: m.email }))).toEqual(rows)
    expect(got.every((m) => m.lastIp === null)).toBe(true)
  })
})

// ---------- cargos com permissão de governança ----------
// Aprovar saques (com o teto), jogo responsável e países bloqueados são decisões de governança: quem tem só
// equipe.editar (Administrador, sem cargos.conceder) não põe ninguém num cargo com alguma delas. Tirar pode.

describe('equipe: cargo com permissão de governança', () => {
  let app: FastifyInstance
  let sa: Awaited<ReturnType<typeof loginAs>>
  let adm: Awaited<ReturnType<typeof loginAs>>
  beforeAll(async () => {
    app = await createTestApp()
    sa = await loginAs(app, 'superadmin', { name: 'Dona Superadmin' })
    adm = await loginAs(app, 'administrador', { name: 'Admin Sem Conceder' })
    await createRole(app, 'jr', ['jogo-responsavel.ver', 'jogo-responsavel.editar'])
    await createRole(app, 'geo', ['paises.ver', 'paises.editar'])
    await createRole(app, 'atendimento', ['usuarios.ver'])
  })
  afterAll(async () => app.close())

  it('Administrador não troca ninguém para cargo com governança (rota e chave); Superadmin troca; tirar de lá pode', async () => {
    const target = await createUser(app, { roleId: 'suporte', name: 'Alvo Governanca' })
    for (const roleId of ['financeiro', 'jr', 'geo']) {
      const r = await api(app, 'POST', `/api/team/${target.id}/role`, { cookie: adm.cookie, body: { roleId } })
      expect(r.statusCode, roleId).toBe(403)
      expect(r.json().error.code).toBe('sem_permissao')
    }
    const auth = await authFor(app, adm.user.id)
    const cur = await team.read(ctxFor(app, auth))
    const into = (cur!.value as Record<string, unknown>[]).map((m) => (m.id === target.id ? { ...m, roleId: 'financeiro' } : m))
    await expect(team.write!(ctxFor(app, auth), into, cur!.version)).rejects.toMatchObject({ status: 403, code: 'sem_permissao' })
    expect((await userRow(app, target.id))?.role_id).toBe('suporte')
    // cargo sem governança: pode
    expect((await api(app, 'POST', `/api/team/${target.id}/role`, { cookie: adm.cookie, body: { roleId: 'atendimento' } })).statusCode).toBe(200)
    // o Superadmin põe; o Administrador tira (para cargo comum)
    expect((await api(app, 'POST', `/api/team/${target.id}/role`, { cookie: sa.cookie, body: { roleId: 'financeiro' } })).statusCode).toBe(200)
    const out = await api(app, 'POST', `/api/team/${target.id}/role`, { cookie: adm.cookie, body: { roleId: 'suporte' } })
    expect(out.statusCode, out.body).toBe(200)
  })

  it('Administrador não cria acesso, não convida nem reenvia convite para cargo com governança', async () => {
    const d = await api(app, 'POST', '/api/team/direct', { cookie: adm.cookie, body: { name: 'Nova Financeira', email: 'nova.fin@x2win.bet', roleId: 'financeiro' } })
    expect(d.statusCode).toBe(403)
    expect(d.json().error.code).toBe('sem_permissao')
    const i = await api(app, 'POST', '/api/team/invite', {
      cookie: adm.cookie,
      body: { email: 'conv.fin@x2win.bet', roleId: 'financeiro', name: 'Convidada Financeira' },
    })
    expect(i.statusCode).toBe(403)
    expect(await app.db.one(`select id from users where email in ('nova.fin@x2win.bet', 'conv.fin@x2win.bet')`)).toBeNull()
    // convite feito pelo Superadmin: o link reenviado volta para quem reenvia, então reenviar é pôr alguém no cargo
    const inv = await api(app, 'POST', '/api/team/invite', {
      cookie: sa.cookie,
      body: { email: 'conv.fin@x2win.bet', roleId: 'financeiro', name: 'Convidada Financeira' },
    })
    expect(inv.statusCode, inv.body).toBe(200)
    const re = await api(app, 'POST', `/api/team/${inv.json().member.id}/resend-invite`, { cookie: adm.cookie })
    expect(re.statusCode).toBe(403)
    expect(re.json()).not.toHaveProperty('inviteUrl')
    expect((await api(app, 'POST', `/api/team/${inv.json().member.id}/resend-invite`, { cookie: sa.cookie })).statusCode).toBe(200)
    // cargo comum: o Administrador cria
    const ok = await api(app, 'POST', '/api/team/direct', { cookie: adm.cookie, body: { name: 'Atendente Nova', email: 'atend@x2win.bet', roleId: 'atendimento' } })
    expect(ok.statusCode, ok.body).toBe(200)
  })

  it('Administrador desativa quem está em cargo com governança, mas só quem concede cargos reativa', async () => {
    const fin = await createUser(app, { roleId: 'financeiro', name: 'Financeira Ativa' })
    const off = await api(app, 'POST', `/api/team/${fin.id}/deactivate`, { cookie: adm.cookie })
    expect(off.statusCode, off.body).toBe(200)
    const back = await api(app, 'POST', `/api/team/${fin.id}/reactivate`, { cookie: adm.cookie })
    expect(back.statusCode).toBe(403)
    expect(back.json().error.code).toBe('sem_permissao')
    // pela chave também
    const auth = await authFor(app, adm.user.id)
    const cur = await team.read(ctxFor(app, auth))
    const on = (cur!.value as Record<string, unknown>[]).map((m) => (m.id === fin.id ? { ...m, status: 'ativo' } : m))
    await expect(team.write!(ctxFor(app, auth), on, cur!.version)).rejects.toMatchObject({ status: 403 })
    expect((await userRow(app, fin.id))?.status).toBe('desligado')
    expect((await api(app, 'POST', `/api/team/${fin.id}/reactivate`, { cookie: sa.cookie })).statusCode).toBe(200)
  })
})

// ---------- senha pela fila do processo ----------
// O scrypt de criar acesso e de aceitar convite passa pela mesma fila do login (auth/password-gate): sem ela, uma
// enxurrada de aceites (rota pública) ocupava o pool de threads do libuv, como o login fazia.

describe('equipe: cálculo de senha pela fila do processo', () => {
  let app: FastifyInstance
  let admin: Awaited<ReturnType<typeof loginAs>>
  beforeAll(async () => {
    app = await createTestApp()
    admin = await loginAs(app, 'superadmin')
  })
  afterAll(async () => app.close())

  /** Ocupa todas as vagas e a espera da fila; devolve quem as libera. */
  async function saturate() {
    let release!: () => void
    const hold = new Promise<void>((r) => (release = r))
    const held = Array.from({ length: PASSWORD_GATE_LIMITS.maxActive + PASSWORD_GATE_LIMITS.maxQueued }, () => passwordGate.run(() => hold))
    await new Promise((r) => setImmediate(r))
    expect(passwordGate.queued).toBe(PASSWORD_GATE_LIMITS.maxQueued)
    return async () => {
      release()
      await Promise.all(held)
    }
  }

  it('com a fila cheia, criar acesso e aceitar convite recusam na hora com 503 e Retry-After, sem gravar nada', async () => {
    const inv = await api(app, 'POST', '/api/team/invite', { cookie: admin.cookie, body: { email: 'fila@x2win.bet', roleId: 'suporte', name: 'Pessoa Da Fila' } })
    expect(inv.statusCode, inv.body).toBe(200)
    const token = tokenOf(inv.json().inviteUrl)
    const release = await saturate()
    try {
      const d = await api(app, 'POST', '/api/team/direct', { cookie: admin.cookie, body: { name: 'Direto Na Fila', email: 'direto.fila@x2win.bet', roleId: 'suporte' } })
      expect(d.statusCode, d.body).toBe(503)
      expect(d.json().error.code).toBe('servidor_ocupado')
      expect(d.headers['retry-after']).toBe(String(PASSWORD_BUSY_RETRY_AFTER_SECONDS))
      const a = await accept(app, { token, password: 'SenhaForte123' })
      expect(a.statusCode, a.body).toBe(503)
      expect(a.json().error.code).toBe('servidor_ocupado')
      expect(a.headers['retry-after']).toBe(String(PASSWORD_BUSY_RETRY_AFTER_SECONDS))
    } finally {
      await release()
    }
    expect(await app.db.one(`select id from users where email = 'direto.fila@x2win.bet'`)).toBeNull()
    expect((await userRow(app, inv.json().member.id))?.status).toBe('convidado')

    // fila livre: os dois passam (o convite continuou valendo)
    const d2 = await api(app, 'POST', '/api/team/direct', { cookie: admin.cookie, body: { name: 'Direto Na Fila', email: 'direto.fila@x2win.bet', roleId: 'suporte' } })
    expect(d2.statusCode, d2.body).toBe(200)
    const a2 = await accept(app, { token, password: 'SenhaForte123' })
    expect(a2.statusCode, a2.body).toBe(200)
    expect((await userRow(app, inv.json().member.id))?.status).toBe('ativo')
  })
})

// ---------- nome exibido: único e sem caracteres enganosos ----------
// Regressão r2-audit-forgery-attribution-2: um convidado de cargo baixo assumia no aceite o nome exato do
// Superadmin e as aprovações de saque, logins e linhas da auditoria dele ficavam indistinguíveis das do Superadmin.

async function pendingWithdrawal(app: FastifyInstance, cents: number) {
  const id = newId('SQ')
  await app.db.query(
    `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                              risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
     values ($1, 'p1', 'Jogador Teste', 'jogador@exemplo.com', $2, 0, 'pendente', 'baixo', 10, '["motivo"]'::jsonb, 'CPF', $3, 'E123', now(), now())`,
    [id, cents, app.cipher.encrypt('12345678909')],
  )
  return id
}

describe('equipe: nome exibido único e sem caracteres enganosos', () => {
  let app: FastifyInstance
  let daniel: Awaited<ReturnType<typeof loginAs>>
  beforeAll(async () => {
    app = await createTestApp()
    daniel = await loginAs(app, 'superadmin', { name: 'Daniel Carius', email: 'daniel@x2win.bet.br' })
  })
  afterAll(async () => app.close())

  const direct = (name: string, email: string, roleId = 'suporte') =>
    api(app, 'POST', '/api/team/direct', { cookie: daniel.cookie, body: { name, email, roleId } })

  it('convidado não troca o nome no aceite: aprovação, login e auditoria apontam para quem agiu, não para o Superadmin', async () => {
    const realId = await pendingWithdrawal(app, 300_000)
    const fakeId = await pendingWithdrawal(app, 490_000)
    expect((await api(app, 'POST', `/api/withdrawals/${realId}/approve`, { cookie: daniel.cookie })).statusCode).toBe(200)

    const inv = await api(app, 'POST', '/api/team/invite', {
      cookie: daniel.cookie,
      body: { email: 'fin.nova@x2win.bet', roleId: 'financeiro', name: 'Fernanda' },
    })
    expect(inv.statusCode).toBe(200)
    const invitedId = inv.json().member.id as string
    const token = tokenOf(inv.json().inviteUrl)

    // rota pública: o nome enviado não substitui o que o admin registrou
    const acc = await api(app, 'POST', '/api/team/invites/accept', { ip: '198.51.100.9', body: { token, name: 'Daniel Carius', password: 'SenhaForte2027x' } })
    expect(acc.statusCode, acc.body).toBe(200)
    expect((await userRow(app, invitedId))?.name).toBe('Fernanda')
    expect((await app.db.query(`select id from users where name = 'Daniel Carius'`)).map((r) => r.id)).toEqual([daniel.user.id])

    const login = await api(app, 'POST', '/api/auth/login', { ip: '198.51.100.9', body: { email: 'fin.nova@x2win.bet', password: 'SenhaForte2027x' } })
    expect(login.statusCode, login.body).toBe(200)
    const fakeAp = await api(app, 'POST', `/api/withdrawals/${fakeId}/approve`, { cookie: cookieFrom(login)!, ip: '198.51.100.9' })
    expect(fakeAp.statusCode, fakeAp.body).toBe(200)
    expect(fakeAp.json().withdrawal.decidedBy).toBe('Fernanda')

    // Saques (operacao.saques): as duas decisões são distinguíveis
    const kv = await api(app, 'GET', '/api/kv/operacao.saques', { cookie: daniel.cookie })
    const list = (kv.json().value ?? []) as { id: string; decidedBy?: string }[]
    expect(list.find((w) => w.id === realId)?.decidedBy).toBe('Daniel Carius')
    expect(list.find((w) => w.id === fakeId)?.decidedBy).toBe('Fernanda')

    // auditoria: aceite, login e aprovação do convidado ficam no nome dele
    const rows = await app.db.query<{ actor_name: string; entity: string; summary: string }>(
      'select actor_name, entity, summary from audit_log where actor_id = $1 order by id',
      [invitedId],
    )
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows.every((r) => r.actor_name === 'Fernanda')).toBe(true)
    expect(rows[0]).toMatchObject({ entity: 'Equipe · Fernanda' })
    expect(rows[0].summary).toMatch(/Convite aceito/)

    // CSV oficial: cada aprovação com o nome de quem aprovou
    const csv = await api(app, 'GET', '/api/audit/export.csv', { cookie: daniel.cookie })
    expect(csv.statusCode).toBe(200)
    const approvals = csv.body.split(/\r?\n/).filter((l) => l.includes(';Aprovou;Saque #'))
    expect(approvals).toHaveLength(2)
    expect(approvals.filter((l) => l.includes('Daniel Carius'))).toHaveLength(1)
    expect(approvals.filter((l) => l.includes('Fernanda'))).toHaveLength(1)
  })

  it('cadastro direto recusa nome igual ou que se confunde (409 nome_em_uso) e caracteres invisíveis ou de outro alfabeto (400)', async () => {
    const conflicts = [
      'Daniel Carius',
      'daniel  CARIUS',
      'Dâniel Cárius',
      'DanieI Carius', // I maiúsculo no lugar do l
      'Danie1 Carius',
      'Daniel Carius.',
      'Daniel-Carius',
      'Daniel Carius', // espaço sem quebra (NFKC vira espaço)
      'Ｄaniel Carius', // D de largura total (NFKC vira D)
      'Dan̸iel Carius', // traço sobreposto (marca combinante)
      'Sistema', // nome que a auditoria usa para ações sem pessoa
    ]
    for (const [i, name] of conflicts.entries()) {
      const r = await direct(name, `conflito${i}@x2win.bet`)
      expect(r.statusCode, JSON.stringify(name)).toBe(409)
      expect(r.json().error).toMatchObject({ code: 'nome_em_uso', details: { field: 'name' } })
    }
    const invalid = [
      'Daniel​ Carius', // zero-width space
      'Daniel Carius‮', // RLO (bidi)
      '⁦Daniel Carius⁩', // isolates (bidi)
      '﻿Daniel Carius', // BOM
      'Daniel­Carius', // soft hyphen
      'Daniel\tCarius',
      'Daniel\u0000Carius',
      'Dаniel Carius', // "а" cirílico
      'Dɑniel Carius', // "ɑ" latino IPA
      'Ꭰaniel Carius', // "Ꭰ" cherokee
      '-Daniel Carius',
      'Dá́́niel',
    ]
    for (const [i, name] of invalid.entries()) {
      const r = await direct(name, `invalido${i}@x2win.bet`)
      expect(r.statusCode, JSON.stringify(name)).toBe(400)
      expect(r.json().error.code).toBe('dados_invalidos')
      expect(r.json().error.details).toEqual([expect.objectContaining({ path: 'name' })])
    }
    expect(await app.db.one(`select id from users where email like 'conflito%' or email like 'invalido%'`)).toBeNull()

    // nome válido é gravado normalizado
    const ok = await direct('  𝐁eatriz   Lima  Júnior ', 'beatriz.lima@x2win.bet')
    expect(ok.statusCode, ok.body).toBe(200)
    expect(ok.json().member.name).toBe('Beatriz Lima Júnior')
    expect(ok.json().member.name).toBe('Beatriz Lima Júnior'.normalize('NFKC'))
    const ascii = await direct("Ana-Lúcia d'Ávila O’Neil", 'ana.lucia@x2win.bet')
    expect(ascii.statusCode, ascii.body).toBe(200)
  })

  it('convite: nome digitado ou montado do e-mail segue a mesma regra', async () => {
    await createUser(app, { roleId: 'suporte', name: 'João Silva' })
    const typed = await api(app, 'POST', '/api/team/invite', { cookie: daniel.cookie, body: { email: 'js2@x2win.bet', roleId: 'suporte', name: ' joao  SILVA ' } })
    expect(typed.statusCode).toBe(409)
    expect(typed.json().error.code).toBe('nome_em_uso')
    const derived = await api(app, 'POST', '/api/team/invite', { cookie: daniel.cookie, body: { email: 'joao.silva@outro.bet', roleId: 'suporte' } })
    expect(derived.statusCode).toBe(409)
    expect(derived.json().error.code).toBe('nome_em_uso')
    const zw = await api(app, 'POST', '/api/team/invite', { cookie: daniel.cookie, body: { email: 'zw@x2win.bet', roleId: 'suporte', name: 'Jo​ão' } })
    expect(zw.statusCode).toBe(400)
    const junk = await api(app, 'POST', '/api/team/invite', { cookie: daniel.cookie, body: { email: '!x@x2win.bet', roleId: 'suporte' } })
    expect(junk.statusCode).toBe(400)
    expect(junk.json().error.details).toMatchObject({ field: 'name' })
    expect(await app.db.one(`select id from users where email in ('js2@x2win.bet', 'joao.silva@outro.bet', 'zw@x2win.bet', '!x@x2win.bet')`)).toBeNull()
    // com outro nome, convida
    const ok = await api(app, 'POST', '/api/team/invite', { cookie: daniel.cookie, body: { email: 'joao.silva@outro.bet', roleId: 'suporte', name: 'João Silva Prado' } })
    expect(ok.statusCode, ok.body).toBe(200)
  })

  it('nome de quem foi desligado ou ainda é convidado continua reservado', async () => {
    await createUser(app, { roleId: 'suporte', name: 'Rita Gomes', status: 'desligado' })
    await createUser(app, { roleId: 'suporte', name: 'Caio Prates', status: 'convidado' })
    expect((await direct('Rita Gomes', 'rita2@x2win.bet')).statusCode).toBe(409)
    expect((await direct('caio prates', 'caio2@x2win.bet')).statusCode).toBe(409)
  })

  it('renomear pela chave equipe.membros também confere; ajustar o próprio nome (maiúsculas, espaços) pode', async () => {
    const carla = await createUser(app, { roleId: 'suporte', name: 'Carla Dias' })
    const outra = await createUser(app, { roleId: 'suporte', name: 'Outra Pessoa' })
    const auth = await authFor(app, daniel.user.id)
    const rename = async (id: string, name: string) => {
      const cur = await team.read(ctxFor(app, auth))
      const list = (cur!.value as Record<string, unknown>[]).map((m) => (m.id === id ? { ...m, name } : m))
      return team.write!(ctxFor(app, auth), list, cur!.version)
    }
    await expect(rename(outra.id, 'CARLA DIAS')).rejects.toMatchObject({ status: 409, code: 'nome_em_uso' })
    await expect(rename(outra.id, 'Daniel Carius')).rejects.toMatchObject({ status: 409, code: 'nome_em_uso' })
    await expect(rename(outra.id, 'Carla​ Dias')).rejects.toMatchObject({ name: 'ZodError' })
    expect((await userRow(app, outra.id))?.name).toBe('Outra Pessoa')
    await rename(carla.id, 'Carla  DIAS')
    expect((await userRow(app, carla.id))?.name).toBe('Carla DIAS')
  })

  it('duas criações simultâneas com o mesmo nome: só uma passa', async () => {
    const [a, b] = await Promise.all([direct('Paula Neves', 'paula1@x2win.bet'), direct('Paula Neves', 'paula2@x2win.bet')])
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])
    expect((await app.db.query(`select id from users where name = 'Paula Neves'`)).length).toBe(1)
  })
})

describe('equipe: nomes na subida e na semente de demonstração', () => {
  it('ADMIN_NAME segue a regra de nome; a subida avisa sobre nomes antigos que se confundem', async () => {
    const bad = await createTestApp({ ADMIN_EMAIL: 'adm@teste.x2win', ADMIN_PASSWORD: 'SenhaForteDoTeste2026', ADMIN_NAME: 'Admin​' })
    try {
      await expect(ensureAdmin(bad)).rejects.toThrow(/ADMIN_NAME/)
      expect(await bad.db.one('select id from users')).toBeNull()
    } finally {
      await bad.close()
    }
    const app = await createTestApp({ ADMIN_EMAIL: 'adm@teste.x2win', ADMIN_PASSWORD: 'SenhaForteDoTeste2026', ADMIN_NAME: '  Ana   Admin ' })
    try {
      expect(await ensureAdmin(app)).toBe('criado')
      expect((await app.db.one<{ name: string }>('select name from users'))?.name).toBe('Ana Admin')
      expect(await warnLookAlikeNames(app)).toEqual([])
      // instalação antiga com xarás gravados antes da regra
      await createUser(app, { name: 'ANA ADMIN', email: 'xara@teste.x2win', roleId: 'suporte' })
      expect(await warnLookAlikeNames(app)).toEqual([['Ana Admin <adm@teste.x2win>', 'ANA ADMIN <xara@teste.x2win>']])
    } finally {
      await app.close()
    }
  })

  it('semente de demonstração não cria xará de quem já existe', async () => {
    const app = await createTestApp()
    try {
      await createUser(app, { email: 'outro.adm@x2win.bet', name: 'Demonstração ADM 1', roleId: 'suporte' })
      const summary = await seedDemo(app)
      expect(summary).toContain('rafael@x2win.bet (nome Demonstração ADM 1 já usado)')
      expect(await app.db.one(`select id from users where email = 'rafael@x2win.bet'`)).toBeNull()
    } finally {
      await app.close()
    }
  })
})

// ---------- dados de demonstração ----------

describe('equipe: seed de demonstração', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('cria a equipe do painel (exceto e-mails existentes) com senha temporária e troca obrigatória', async () => {
    await createUser(app, { email: 'daniel@x2win.bet', roleId: 'superadmin' })
    const summary = await seedDemo(app)
    expect(summary).toMatch(/5 pessoas criadas/)
    expect(summary).not.toContain('daniel@x2win.bet:')
    expect(summary).toContain('daniel@x2win.bet (já cadastrado)')
    const rows = await app.db.query<{ email: string; name: string; last_ip: string | null; must_change_password: boolean; status: string; totp_enabled: boolean }>(
      `select email, name, last_ip, must_change_password, status, totp_enabled from users where email like '%@x2win.bet' and email <> 'daniel@x2win.bet' order by email`,
    )
    expect(rows).toHaveLength(5)
    // nome genérico pelo cargo (nunca o de alguém da equipe real, ex.: Rafael Lima) e IP fictício
    expect(rows.map((r) => [r.email, r.name])).toEqual([
      ['beatriz@x2win.bet', 'Demonstração ADM 2'],
      ['camila.mkt@x2win.bet', 'Demonstração Marketing oficial'],
      ['lucas.mkt@x2win.bet', 'Demonstração marketing'],
      ['pedro@x2win.bet', 'Demonstração Suporte'],
      ['rafael@x2win.bet', 'Demonstração ADM 1'],
    ])
    for (const r of rows) {
      expect(checkMemberName(r.name)).toEqual({ name: r.name })
      expect(r.last_ip).toMatch(/^10\./)
    }
    for (const real of seedTeam().map((m) => m.name)) expect(summary).not.toContain(real)
    expect(rows.every((r) => r.must_change_password && !r.totp_enabled)).toBe(true)
    expect(rows.find((r) => r.email === 'pedro@x2win.bet')?.status).toBe('desligado')
    // a senha mostrada no resumo entra (e pede troca)
    const m = /rafael@x2win\.bet: (\S+)/.exec(summary)
    expect(m).not.toBeNull()
    const l = await login(app, 'rafael@x2win.bet', m![1])
    expect(l.json()).toEqual({ stage: 'password' })
    expect(await seedDemo(app)).toMatch(/nada a semear/)
  })
})

// sanity: os cargos do sistema usados nos testes existem com as permissões esperadas
describe('equipe: premissas dos testes', () => {
  it('Administrador não tem cargos.conceder e Superadmin tem', () => {
    const roles = seedRoles()
    expect(roles.find((r) => r.id === 'administrador')!.permissions).not.toContain('cargos.conceder')
    expect(roles.find((r) => r.id === 'superadmin')!.permissions).toContain('cargos.conceder')
    expect(roles.find((r) => r.id === 'suporte')!.permissions).not.toContain('equipe.editar')
  })
})
