import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { findKvRule } from '@shared/kv-registry'
import { effectivePermissions } from '@shared/permissions'
import { sha256 } from '../src/lib/crypto'
import type { KvContext } from '../src/kv/types'
import { bootstrap } from '../src/bootstrap'
import { ALLOWLIST_RESET_KEY, kvHandlers, resetAllowlistFromEnv, type PanelSecurity } from '../src/modules/panel-security/kv'
import { getRole } from '../src/services/roles-repo'
import type { AuthContext } from '../src/types'
import { api, createTestApp, createUser, sessionCookie } from './helpers'

/** 400: ZodError (vira dados_invalidos na rota) ou AppError com status 400. */
async function expect400(p: Promise<unknown>, label?: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err, label).not.toBeNull()
  expect(err instanceof ZodError || (err as { status?: number }).status === 400, label).toBe(true)
}

const handler = kvHandlers['panel-security']!
const KEY = 'config.seguranca-painel'

async function authFor(app: FastifyInstance, userId: string, ip: string): Promise<AuthContext> {
  const u = await app.db.one<{ id: string; name: string; email: string; role_id: string; status: 'ativo'; totp_enabled: boolean; must_change_password: boolean }>(
    'select id, name, email, role_id, status, totp_enabled, must_change_password from users where id = $1',
    [userId],
  )
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

async function asRole(app: FastifyInstance, roleId: string, ip = '10.1.1.1', name?: string, opts: { totp?: boolean } = {}) {
  const u = await createUser(app, { roleId, name, totp: opts.totp })
  return authFor(app, u.id, ip)
}

function ctx(app: FastifyInstance, auth: AuthContext, clientIp = auth.ip): KvContext {
  return { app, req: { clientIp } as unknown as FastifyRequest, auth, key: KEY, rule: findKvRule(KEY)! }
}

async function createRole(app: FastifyInstance, id: string, permissions: string[]) {
  await app.db.query(`insert into roles (id, name, permissions, approval_ceiling_cents) values ($1, $2, $3, 0)`, [id, `Cargo ${id}`, permissions])
}

const base = (p: Partial<PanelSecurity> = {}) => ({ allowlist: [], enforce2faForAll: false, sessionTimeoutMinutes: 240, ...p })
const entry = (value: string, label = '', extra: Record<string, unknown> = {}) => ({ id: `ip-${value.replace(/[./]/g, '-')}`, value, label, ...extra })

describe('config.seguranca-painel', () => {
  let app: FastifyInstance
  let sa: AuthContext
  beforeAll(async () => {
    app = await createTestApp()
    // com 2FA: ligar o 2FA para todos exige que quem grava já tenha o fator
    sa = await asRole(app, 'superadmin', '10.1.1.1', 'Dona do Painel', { totp: true })
  })
  afterAll(async () => app.close())

  /** Lê e grava com a versão atual, a partir do IP indicado. */
  async function save(value: unknown, auth = sa, clientIp = auth.ip) {
    const cur = await handler.read(ctx(app, auth, clientIp))
    return handler.write!(ctx(app, auth, clientIp), value, cur!.version)
  }

  it('leitura: padrão, para quem vê a tela (ou Equipe); sem permissão → 403', async () => {
    const r = await handler.read(ctx(app, sa))
    expect(r).toMatchObject({ value: base(), version: 0 })
    expect(typeof r!.updatedAt).toBe('string')
    await createRole(app, 'so-equipe', ['equipe.ver'])
    const viaTeam = await asRole(app, 'so-equipe')
    expect((await handler.read(ctx(app, viaTeam)))!.value).toEqual(base())
    const sup = await asRole(app, 'suporte')
    await expect(handler.read(ctx(app, sup))).rejects.toMatchObject({ status: 403, code: 'sem_permissao' })
  })

  it('gravação exige seguranca-painel.editar', async () => {
    const fin = await asRole(app, 'financeiro')
    await expect(handler.write!(ctx(app, fin), base(), 0)).rejects.toMatchObject({ status: 403 })
    await createRole(app, 'so-ver-seguranca', ['seguranca-painel.ver', 'equipe.editar'])
    const ver = await asRole(app, 'so-ver-seguranca')
    await expect(handler.write!(ctx(app, ver), base(), 0)).rejects.toMatchObject({ status: 403 })
    // Administrador tem seguranca-painel.editar
    const adm = await asRole(app, 'administrador')
    const saved = await save(base({ sessionTimeoutMinutes: 120 }), adm)
    expect(saved).toMatchObject({ value: base({ sessionTimeoutMinutes: 120 }), version: 1 })
    expect((await app.db.one<{ updated_by: string }>('select updated_by from panel_security where id = 1'))?.updated_by).toBe(adm.user.id)
  })

  it('controle de versão', async () => {
    const cur = await handler.read(ctx(app, sa))
    expect(cur!.version).toBeGreaterThan(0)
    await expect(handler.write!(ctx(app, sa), base(), cur!.version - 1)).rejects.toMatchObject({
      status: 409,
      code: 'versao_desatualizada',
      details: { version: cur!.version },
    })
    await expect(handler.write!(ctx(app, sa), base(), undefined)).rejects.toMatchObject({ status: 409 })
    const ok = await handler.write!(ctx(app, sa), base(), cur!.version)
    expect(ok.version).toBe(cur!.version + 1)
  })

  it('valida IPs/CIDR, tamanho da lista, descrição e tempo de inatividade', async () => {
    for (const bad of ['999.1.1.1', '10.0.0.0/33', '10.0.0/8', 'abc', '::1', '10.0.0.1/8/1', '10.0.0.1/ 8', '']) {
      await expect400(save(base({ allowlist: [entry('10.1.1.1'), { id: 'x', value: bad, label: '' }] as never })), bad)
    }
    const many = Array.from({ length: 101 }, (_, i) => entry(`10.1.1.${i + 1}`))
    await expect400(save(base({ allowlist: many as never })))
    const hundred = many.slice(0, 100)
    await expect(save(base({ allowlist: hundred as never }))).resolves.toBeTruthy()
    await expect400(save(base({ allowlist: [entry('10.1.1.1', 'x'.repeat(61))] as never })))
    await expect(save(base({ allowlist: [entry('10.1.1.1', 'x'.repeat(60))] as never }))).resolves.toBeTruthy()
    await expect400(save(base({ allowlist: [entry('10.1.1.1'), { ...entry('10.1.1.1'), id: 'outro' }] as never })))
    await expect400(save(base({ allowlist: [entry('10.1.1.1'), { ...entry('10.1.1.2'), id: entry('10.1.1.1').id }] as never })))
    for (const t of [4, 1441, 30.5, 0, -10]) {
      await expect400(save(base({ sessionTimeoutMinutes: t })), String(t))
    }
    await expect(save(base({ sessionTimeoutMinutes: 5 }))).resolves.toBeTruthy()
    await expect(save(base({ sessionTimeoutMinutes: 1440 }))).resolves.toBeTruthy()
    await expect400(save({ allowlist: 'tudo', enforce2faForAll: false, sessionTimeoutMinutes: 60 }))
    await expect400(save({ allowlist: [], sessionTimeoutMinutes: 60 }))
    await save(base())
  })

  it('recusa a lista que deixaria o IP de quem grava de fora (409 bloquearia_voce)', async () => {
    const outside = save(base({ allowlist: [entry('189.45.12.0/24', 'Escritório')] as never }), sa, '200.1.1.1')
    await expect(outside).rejects.toMatchObject({ status: 409, code: 'bloquearia_voce', details: { ip: '200.1.1.1' } })
    expect(((await handler.read(ctx(app, sa)))!.value as PanelSecurity).allowlist).toEqual([])
    // com a faixa do próprio IP, passa; lista vazia sempre passa
    const ok = await save(base({ allowlist: [entry('189.45.12.0/24', 'Escritório'), entry('200.1.1.0/24', 'Casa')] as never }), sa, '200.1.1.1')
    expect((ok.value as PanelSecurity).allowlist.map((e) => e.value)).toEqual(['189.45.12.0/24', '200.1.1.0/24'])
    // IP exato também vale
    await expect(save(base({ allowlist: [entry('200.1.1.1')] as never }), sa, '200.1.1.1')).resolves.toBeTruthy()
    await expect(save(base(), sa, '200.1.1.1')).resolves.toBeTruthy()
  })

  it('o servidor carimba quem e quando incluiu; itens já gravados mantêm o carimbo', async () => {
    const first = await save(
      base({
        allowlist: [
          entry('10.0.0.0/8', 'Rede interna', { createdBy: 'Hacker', createdAt: '2000-01-01T00:00:00.000Z' }),
          { id: 'id inválido!', value: '10.1.1.1', label: 'Meu IP' },
          { value: '172.16.0.0/12', label: 'Sem id' },
        ] as never,
      }),
    )
    const list1 = (first.value as PanelSecurity).allowlist
    expect(list1).toHaveLength(3)
    expect(list1[0]).toMatchObject({ id: 'ip-10-0-0-0-8', value: '10.0.0.0/8', label: 'Rede interna', createdBy: 'Dona do Painel' })
    expect(list1[0].createdAt).not.toBe('2000-01-01T00:00:00.000Z')
    expect(list1[1].id).toMatch(/^ip_/)
    expect(list1[2].id).toMatch(/^ip_/)

    // outra pessoa grava depois: os itens antigos mantêm o carimbo; o novo leva o dela
    const adm = await asRole(app, 'superadmin', '10.1.1.1', 'Outra Pessoa')
    const second = await save(
      base({ allowlist: [...list1.map((e) => ({ ...e, createdBy: 'Trocado' })), entry('192.168.0.0/16', 'VPN')] as never }),
      adm,
    )
    const list2 = (second.value as PanelSecurity).allowlist
    expect(list2.slice(0, 3)).toEqual(list1)
    expect(list2[3]).toMatchObject({ value: '192.168.0.0/16', createdBy: 'Outra Pessoa' })
    // mudar o valor de um item conta como item novo
    const third = await save(base({ allowlist: [{ ...list2[0], value: '10.0.0.0/16' }, list2[1]] as never }), adm)
    expect((third.value as PanelSecurity).allowlist[0]).toMatchObject({ id: list2[0].id, value: '10.0.0.0/16', createdBy: 'Outra Pessoa' })
    await save(base())
  })

  it('audita o que mudou', async () => {
    await save(base({ allowlist: [entry('10.0.0.0/8', 'Escritório')] as never, enforce2faForAll: true, sessionTimeoutMinutes: 60 }))
    const a = await app.db.one<{ action: string; entity: string; summary: string; actor_id: string; ip: string }>(
      'select action, entity, summary, actor_id, ip from audit_log order by id desc limit 1',
    )
    expect(a).toMatchObject({ action: 'editar', entity: 'Segurança do painel', actor_id: sa.user.id, ip: '10.1.1.1' })
    expect(a?.summary).toContain('IPs incluídos: 10.0.0.0/8 (Escritório)')
    expect(a?.summary).toContain('2FA passou a ser exigido de todos')
    expect(a?.summary).toMatch(/tempo de inatividade: \d+ → 60 min/)
    await save(base())
    const b = await app.db.one<{ summary: string }>('select summary from audit_log order by id desc limit 1')
    expect(b?.summary).toContain('IPs retirados: 10.0.0.0/8 (Escritório)')
    expect(b?.summary).toContain('lista de IPs esvaziada')
  })

  it('a lista nova vale na hora (cache limpo) e a antiga sem id é lida', async () => {
    // aquece o cache com a lista vazia
    expect((await api(app, 'GET', '/api/auth/me', { ip: '200.9.9.9' })).statusCode).toBe(401)
    await save(base({ allowlist: [entry('10.0.0.0/8', 'Rede interna')] as never }))
    const blocked = await api(app, 'GET', '/api/auth/me', { ip: '200.9.9.9' })
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().error.code).toBe('ip_nao_autorizado')
    expect((await api(app, 'GET', '/api/auth/me', { ip: '10.7.7.7' })).statusCode).toBe(401)
    await save(base())
    expect((await api(app, 'GET', '/api/auth/me', { ip: '200.9.9.9' })).statusCode).toBe(401)

    // formato antigo/manual no banco (sem id, sem descrição)
    await app.db.query(`update panel_security set allowlist = $1::jsonb where id = 1`, [JSON.stringify([{ value: '10.0.0.0/8' }])])
    const r = await handler.read(ctx(app, sa))
    const list = (r!.value as PanelSecurity).allowlist
    expect(list).toEqual([{ id: 'ip_1', value: '10.0.0.0/8', label: '', createdAt: expect.any(String), createdBy: '' }])
    await save(base({ allowlist: [{ ...list[0], label: 'Agora com nome' }] as never }))
    expect(((await handler.read(ctx(app, sa)))!.value as PanelSecurity).allowlist[0]).toMatchObject({ id: 'ip_1', label: 'Agora com nome', createdBy: '' })
    await save(base())
    const { invalidateAllowlistCache } = await import('../src/plugins/security')
    invalidateAllowlistCache()
  })

  it('incluir ou retirar IPs exige cargos.conceder; o resto segue com seguranca-painel.editar', async () => {
    const adm = await asRole(app, 'administrador', '10.1.1.1', 'Admin Sem Conceder', { totp: true })
    expect(adm.perms.has('seguranca-painel.editar')).toBe(true)
    expect(adm.perms.has('cargos.conceder')).toBe(false)
    // lista vazia → não vazia: recusado
    await expect(save(base({ allowlist: [entry('10.1.1.1', 'só eu')] as never }), adm)).rejects.toMatchObject({ status: 403, code: 'sem_permissao' })
    expect(((await handler.read(ctx(app, sa)))!.value as PanelSecurity).allowlist).toEqual([])

    const listed = await save(base({ allowlist: [entry('10.0.0.0/8', 'Rede interna'), entry('189.45.12.0/24', 'Escritório')] as never }))
    const list = (listed.value as PanelSecurity).allowlist
    // incluir, retirar, trocar o valor ou esvaziar: recusado
    await expect(save(base({ allowlist: [...list, entry('200.1.1.1')] as never }), adm)).rejects.toMatchObject({ status: 403 })
    await expect(save(base({ allowlist: [list[0]] as never }), adm)).rejects.toMatchObject({ status: 403 })
    await expect(save(base({ allowlist: [list[0], { ...list[1], value: '189.45.0.0/16' }] as never }), adm)).rejects.toMatchObject({ status: 403 })
    await expect(save(base(), adm)).rejects.toMatchObject({ status: 403 })
    expect(((await handler.read(ctx(app, sa)))!.value as PanelSecurity).allowlist).toEqual(list)

    // mesma lista (outra ordem, descrição nova), 2FA para todos e tempo de inatividade: pode
    const ok = await save(
      base({ allowlist: [{ ...list[1], label: 'Escritório SP' }, list[0]] as never, enforce2faForAll: true, sessionTimeoutMinutes: 90 }),
      adm,
    )
    expect(ok.value).toMatchObject({ enforce2faForAll: true, sessionTimeoutMinutes: 90 })
    expect((ok.value as PanelSecurity).allowlist.map((e) => [e.value, e.label])).toEqual([
      ['189.45.12.0/24', 'Escritório SP'],
      ['10.0.0.0/8', 'Rede interna'],
    ])
    await save(base())
    const { invalidateAllowlistCache } = await import('../src/plugins/security')
    invalidateAllowlistCache()
  })

  // Ligar o 2FA para todos sem ter 2FA derrubava a sessão de quem salvou logo na requisição seguinte.
  it('ligar o 2FA para todos exige que quem grava já tenha 2FA (400); desligar ou manter não exige', async () => {
    const semFator = await asRole(app, 'administrador', '10.1.1.1', 'Admin Sem Fator')
    expect(semFator.user.totpEnabled).toBe(false)
    const before = await handler.read(ctx(app, sa))
    const err = await save(base({ enforce2faForAll: true }), semFator).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toMatchObject({ status: 400, code: 'dados_invalidos', details: { field: 'enforce2faForAll' } })
    expect((err as Error).message).toMatch(/Cadastre o 2FA na sua conta/)
    const after = await handler.read(ctx(app, sa))
    expect(after!.version).toBe(before!.version)
    expect((after!.value as PanelSecurity).enforce2faForAll).toBe(false)
    // o resto da tela segue gravando sem 2FA
    await expect(save(base({ sessionTimeoutMinutes: 120 }), semFator)).resolves.toMatchObject({ value: { enforce2faForAll: false, sessionTimeoutMinutes: 120 } })

    // com 2FA liga; desligar não depende do fator de quem grava, mas é governança (r1: o Administrador desligava)
    const comFator = await asRole(app, 'administrador', '10.1.1.1', 'Admin Com Fator', { totp: true })
    await expect(save(base({ enforce2faForAll: true }), comFator)).resolves.toMatchObject({ value: { enforce2faForAll: true } })
    await expect(save(base(), semFator)).rejects.toMatchObject({ status: 403, code: 'sem_permissao' })
    await expect(save(base(), comFator)).rejects.toMatchObject({ status: 403, code: 'sem_permissao' })
    expect(((await handler.read(ctx(app, sa)))!.value as PanelSecurity).enforce2faForAll).toBe(true)
    // manter ligado e mudar outro campo segue liberado para o Administrador
    await expect(save(base({ enforce2faForAll: true, sessionTimeoutMinutes: 60 }), comFator)).resolves.toMatchObject({ value: { enforce2faForAll: true } })
    // quem concede cargos (Superadmin) desliga
    await expect(save(base(), sa)).resolves.toMatchObject({ value: { enforce2faForAll: false } })

    // pela rota: 400 e a sessão de quem tentou continua de pé
    const u = await createUser(app, { roleId: 'administrador', name: 'Admin Pela Rota' })
    const cookie = await sessionCookie(app, u.id, 'active', '10.1.1.1')
    const cur = await api(app, 'GET', `/api/kv/${KEY}`, { cookie, ip: '10.1.1.1' })
    expect(cur.statusCode, cur.body).toBe(200)
    const put = await api(app, 'PUT', `/api/kv/${KEY}`, {
      cookie,
      ip: '10.1.1.1',
      body: { value: { ...cur.json().value, enforce2faForAll: true }, version: cur.json().version },
    })
    expect(put.statusCode, put.body).toBe(400)
    expect(put.json().error).toMatchObject({ code: 'dados_invalidos', details: { field: 'enforce2faForAll' } })
    expect((await api(app, 'GET', '/api/auth/me', { cookie, ip: '10.1.1.1' })).statusCode).toBe(200)
    expect((await app.db.one<{ enforce_2fa_all: boolean }>('select enforce_2fa_all from panel_security where id = 1'))?.enforce_2fa_all).toBe(false)
  })

  // Regressão r1-authz-9: Administrador (sem cargos.conceder) trancava todos os Superadmins fora do painel.
  it('Administrador não tranca os Superadmins fora do painel pela lista de IPs (HTTP)', async () => {
    const ADMIN_IP = '10.0.0.5'
    const SA_IP = '10.0.0.9'
    const owner = await createUser(app, { roleId: 'superadmin', name: 'Superadmin' })
    const saCookie = await sessionCookie(app, owner.id, 'active', SA_IP)
    const adm = await createUser(app, { roleId: 'administrador', name: 'Administrador' })
    const admCookie = await sessionCookie(app, adm.id, 'active', ADMIN_IP)
    const URL = `/api/kv/${KEY}`

    const cur = await api(app, 'GET', URL, { cookie: admCookie, ip: ADMIN_IP })
    expect(cur.statusCode).toBe(200)
    const put = await api(app, 'PUT', URL, {
      cookie: admCookie,
      ip: ADMIN_IP,
      body: { value: { ...cur.json().value, allowlist: [{ value: ADMIN_IP, label: 'só eu' }] }, version: cur.json().version },
    })
    expect(put.statusCode, put.body).toBe(403)
    expect(put.json().error.code).toBe('sem_permissao')

    // o Superadmin continua entrando (sessão aberta e login)
    expect((await api(app, 'GET', '/api/auth/me', { cookie: saCookie, ip: SA_IP })).statusCode).toBe(200)
    const login = await api(app, 'POST', '/api/auth/login', { ip: SA_IP, body: { email: owner.email, password: owner.password } })
    expect(login.statusCode, login.body).toBe(200)
    expect(((await handler.read(ctx(app, sa)))!.value as PanelSecurity).allowlist).toEqual([])
  })

  it('recuperação pelo servidor (PANEL_ALLOWLIST_RESET): esvazia a lista uma vez por valor, com auditoria', async () => {
    const restrict = () => save(base({ allowlist: [entry('10.1.1.1', 'Só a dona')] as never }))
    const allowlist = async () => ((await handler.read(ctx(app, sa)))!.value as PanelSecurity).allowlist.map((e) => e.value)
    await restrict()
    expect((await api(app, 'GET', '/api/auth/me', { ip: '200.9.9.9' })).statusCode).toBe(403)

    // sem a variável nada muda
    expect(await resetAllowlistFromEnv(app, undefined)).toBe('sem-pedido')
    expect(await resetAllowlistFromEnv(app, '   ')).toBe('sem-pedido')
    expect(await allowlist()).toEqual(['10.1.1.1'])

    const v0 = (await handler.read(ctx(app, sa)))!.version
    expect(await resetAllowlistFromEnv(app, 'incidente-2026-10-09')).toBe('esvaziada')
    const after = await handler.read(ctx(app, sa))
    expect((after!.value as PanelSecurity).allowlist).toEqual([])
    expect(after!.version).toBe(v0 + 1)
    // vale na hora (cache limpo)
    expect((await api(app, 'GET', '/api/auth/me', { ip: '200.9.9.9' })).statusCode).toBe(401)
    const a = await app.db.one<{ action: string; entity: string; summary: string; actor_id: string | null; actor_name: string }>(
      'select action, entity, summary, actor_id, actor_name from audit_log order by id desc limit 1',
    )
    expect(a).toMatchObject({ action: 'desbloquear', entity: 'Segurança do painel', actor_id: null, actor_name: 'Recuperação de acesso (servidor)' })
    expect(a?.summary).toContain('PANEL_ALLOWLIST_RESET')
    expect(a?.summary).toContain('IPs retirados: 10.1.1.1 (Só a dona)')
    // o valor em si não fica guardado, só o hash
    const mark = await app.db.one<{ value: Record<string, unknown> }>('select value from settings where key = $1', [ALLOWLIST_RESET_KEY])
    expect(JSON.stringify(mark?.value)).not.toContain('incidente-2026-10-09')

    // mesmo valor de novo (variável esquecida no ambiente): a lista refeita fica como está
    await restrict()
    expect(await resetAllowlistFromEnv(app, 'incidente-2026-10-09')).toBe('ja-aplicado')
    expect(await allowlist()).toEqual(['10.1.1.1'])
    expect(await resetAllowlistFromEnv(app, 'incidente-2')).toBe('esvaziada')
    expect(await allowlist()).toEqual([])
    await save(base())
  })

  it('a subida da API (bootstrap) aplica PANEL_ALLOWLIST_RESET', async () => {
    const other = await createTestApp()
    try {
      await other.db.query(`update panel_security set allowlist = $1::jsonb where id = 1`, [JSON.stringify([{ value: '10.1.1.1' }])])
      await bootstrap(other, {})
      expect((await other.db.one<{ allowlist: unknown[] }>('select allowlist from panel_security where id = 1'))?.allowlist).toHaveLength(1)
      await bootstrap(other, { PANEL_ALLOWLIST_RESET: 'incidente-3' })
      expect((await other.db.one<{ allowlist: unknown[] }>('select allowlist from panel_security where id = 1'))?.allowlist).toEqual([])
    } finally {
      await other.close()
      const { invalidateAllowlistCache } = await import('../src/plugins/security')
      invalidateAllowlistCache()
    }
  })

  it('o tempo de inatividade gravado derruba sessões paradas', async () => {
    const u = await createUser(app, { roleId: 'suporte' })
    const cookie = await sessionCookie(app, u.id)
    await app.db.query(`update sessions set last_seen_at = now() - interval '10 minutes' where id = $1`, [sha256(cookie.split('=')[1])])
    expect((await api(app, 'GET', '/api/auth/me', { cookie })).statusCode).toBe(200)
    await app.db.query(`update sessions set last_seen_at = now() - interval '10 minutes' where id = $1`, [sha256(cookie.split('=')[1])])
    await save(base({ sessionTimeoutMinutes: 5 }))
    expect((await api(app, 'GET', '/api/auth/me', { cookie })).statusCode).toBe(401)
    await save(base())
  })
})
