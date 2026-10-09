import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { findKvRule } from '@shared/kv-registry'
import { effectivePermissions } from '@shared/permissions'
import { sha256 } from '../src/lib/crypto'
import type { KvContext } from '../src/kv/types'
import { kvHandlers, type PanelSecurity } from '../src/modules/panel-security/kv'
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

async function asRole(app: FastifyInstance, roleId: string, ip = '10.1.1.1', name?: string) {
  const u = await createUser(app, { roleId, name })
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
    sa = await asRole(app, 'superadmin', '10.1.1.1', 'Dona do Painel')
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
    const adm = await asRole(app, 'administrador', '10.1.1.1', 'Outra Pessoa')
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
