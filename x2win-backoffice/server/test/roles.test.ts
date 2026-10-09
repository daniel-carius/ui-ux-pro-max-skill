import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { findKvRule } from '@shared/kv-registry'
import { effectivePermissions, type Role } from '@shared/permissions'
import type { KvContext, KvValue } from '../src/kv/types'
import { kvHandlers } from '../src/modules/roles/kv'
import { getRole } from '../src/services/roles-repo'
import type { AuthContext } from '../src/types'
import { createTestApp, createUser } from './helpers'

const roles = kvHandlers.roles!

async function authFor(app: FastifyInstance, userId: string): Promise<AuthContext> {
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
    ip: '127.0.0.1',
  }
}

async function asRole(app: FastifyInstance, roleId: string) {
  const u = await createUser(app, { roleId })
  return authFor(app, u.id)
}

function ctx(app: FastifyInstance, auth: AuthContext): KvContext {
  const key = 'cargos.lista'
  return { app, req: { clientIp: '127.0.0.1' } as unknown as FastifyRequest, auth, key, rule: findKvRule(key)! }
}

const list = (v: KvValue | null) => structuredClone(v!.value as Role[])
const patch = (rs: Role[], id: string, p: Partial<Role>) => rs.map((r) => (r.id === id ? { ...r, ...p } : r))

async function lastAudits(app: FastifyInstance, n = 1) {
  return app.db.query<{ action: string; entity: string; summary: string; actor_id: string }>(
    'select action, entity, summary, actor_id from audit_log order by id desc limit $1',
    [n],
  )
}

describe('cargos.lista', () => {
  let app: FastifyInstance
  let sa: AuthContext
  let adm: AuthContext
  beforeAll(async () => {
    app = await createTestApp()
    sa = await asRole(app, 'superadmin')
    adm = await asRole(app, 'administrador')
  })
  afterAll(async () => app.close())

  /** Lê, aplica a função e grava com a versão lida. */
  async function save(auth: AuthContext, fn: (rs: Role[]) => Role[]) {
    const cur = await roles.read(ctx(app, auth))
    return roles.write!(ctx(app, auth), fn(list(cur)), cur!.version)
  }

  it('leitura para qualquer pessoa logada, teto em reais', async () => {
    const sup = await asRole(app, 'suporte')
    const r = await roles.read(ctx(app, sup))
    expect(r!.version).toBe(0)
    const rs = r!.value as Role[]
    expect(rs.map((x) => x.id)).toEqual(expect.arrayContaining(['superadmin', 'administrador', 'financeiro', 'suporte', 'adm', 'marketing']))
    expect(rs.find((x) => x.id === 'financeiro')).toMatchObject({ approvalCeiling: 5000, system: true })
    expect(rs.find((x) => x.id === 'superadmin')?.approvalCeiling).toBeNull()
    expect(rs.find((x) => x.id === 'suporte')?.approvalCeiling).toBe(0)
  })

  it('gravação exige cargos.editar e versão atual', async () => {
    const sup = await asRole(app, 'suporte')
    const cur = await roles.read(ctx(app, sup))
    await expect(roles.write!(ctx(app, sup), cur!.value, cur!.version)).rejects.toMatchObject({ status: 403, code: 'sem_permissao' })

    const saved = await roles.write!(ctx(app, sa), cur!.value, cur!.version)
    expect(saved.version).toBe(cur!.version + 1)
    expect((await lastAudits(app))[0]).toMatchObject({ action: 'editar', summary: 'Cargos salvos sem alterações.' })
    await expect(roles.write!(ctx(app, sa), cur!.value, cur!.version)).rejects.toMatchObject({
      status: 409,
      code: 'versao_desatualizada',
      details: { version: saved.version },
    })
    await expect(roles.write!(ctx(app, sa), cur!.value, undefined)).rejects.toMatchObject({ status: 409 })
  })

  it('altera cargo do sistema (permissões, 2FA, teto) com resumo na auditoria', async () => {
    const saved = await save(sa, (rs) =>
      patch(rs, 'financeiro', {
        permissions: [...rs.find((r) => r.id === 'financeiro')!.permissions.filter((p) => p !== 'ggr.apurar'), 'depositos.editar', 'dashboard.ver', 'auditoria.ver'],
        require2fa: true,
        approvalCeiling: 1234.56,
        color: 'green',
      }),
    )
    const fin = (saved.value as Role[]).find((r) => r.id === 'financeiro')!
    expect(fin).toMatchObject({ require2fa: true, approvalCeiling: 1234.56, color: 'green', system: true })
    expect(fin.permissions).toContain('auditoria.ver')
    expect(fin.permissions).not.toContain('ggr.apurar')
    expect(new Set(fin.permissions).size).toBe(fin.permissions.length)
    const row = await app.db.one<{ approval_ceiling_cents: number }>(`select approval_ceiling_cents from roles where id = 'financeiro'`)
    expect(row?.approval_ceiling_cents).toBe(123456)
    const [a] = await lastAudits(app)
    expect(a).toMatchObject({ action: 'editar', entity: 'Cargo Financeiro', actor_id: sa.user.id })
    expect(a.summary).toContain('permissões incluídas: auditoria.ver')
    expect(a.summary).toContain('permissões retiradas: ggr.apurar')
    expect(a.summary).toContain('2FA passou a ser exigido')
    expect(a.summary).toMatch(/teto: R\$ 5\.000,00 → R\$ 1\.234,56/)
  })

  it('teto: null, 0 ou maior que zero', async () => {
    let saved = await save(sa, (rs) => patch(rs, 'suporte', { approvalCeiling: null }))
    expect((saved.value as Role[]).find((r) => r.id === 'suporte')?.approvalCeiling).toBeNull()
    saved = await save(sa, (rs) => patch(rs, 'suporte', { approvalCeiling: 0 }))
    expect((saved.value as Role[]).find((r) => r.id === 'suporte')?.approvalCeiling).toBe(0)
    await expect(save(sa, (rs) => patch(rs, 'suporte', { approvalCeiling: -1 }))).rejects.toMatchObject({ status: 400 })
    await expect(save(sa, (rs) => patch(rs, 'suporte', { approvalCeiling: 'muito' as unknown as number }))).rejects.toThrow()
    await expect(save(sa, (rs) => patch(rs, 'suporte', { approvalCeiling: 1e12 }))).rejects.toMatchObject({ status: 400 })
  })

  it('permissão fora do catálogo → 400', async () => {
    await expect(save(sa, (rs) => patch(rs, 'suporte', { permissions: [...rs.find((r) => r.id === 'suporte')!.permissions, 'tudo.liberado'] }))).rejects.toMatchObject({
      status: 400,
      code: 'dados_invalidos',
    })
    await expect(
      save(sa, (rs) => [...rs, { id: 'novo', name: 'Cargo Novo', description: '', system: false, permissions: ['xyz.ver'], require2fa: true, approvalCeiling: 0, color: 'rose' }]),
    ).rejects.toMatchObject({ status: 400 })
    expect((await getRole(app.db, 'suporte'))!.permissions).not.toContain('tudo.liberado')
  })

  it('Superadmin não muda (só a exigência de 2FA, por quem concede cargos)', async () => {
    const sp = (rs: Role[]) => rs.find((r) => r.id === 'superadmin')!
    await expect(save(sa, (rs) => patch(rs, 'superadmin', { permissions: sp(rs).permissions.slice(1) }))).rejects.toMatchObject({ status: 400 })
    await expect(save(sa, (rs) => patch(rs, 'superadmin', { name: 'Dono' }))).rejects.toMatchObject({ status: 400 })
    await expect(save(sa, (rs) => patch(rs, 'superadmin', { approvalCeiling: 100 }))).rejects.toMatchObject({ status: 400 })
    await expect(save(sa, (rs) => patch(rs, 'superadmin', { description: 'outra' }))).rejects.toMatchObject({ status: 400 })
    await expect(save(sa, (rs) => patch(rs, 'superadmin', { color: 'rose' }))).rejects.toMatchObject({ status: 400 })
    await expect(save(sa, (rs) => rs.filter((r) => r.id !== 'superadmin'))).rejects.toMatchObject({ status: 400 })
    // mesma lista em outra ordem não é mudança
    await save(sa, (rs) => patch(rs, 'superadmin', { permissions: [...sp(rs).permissions].reverse() }))
    // exigir 2FA do Superadmin: só com cargos.conceder
    await expect(save(adm, (rs) => patch(rs, 'superadmin', { require2fa: true }))).rejects.toMatchObject({ status: 403 })
    const saved = await save(sa, (rs) => patch(rs, 'superadmin', { require2fa: true }))
    expect((saved.value as Role[]).find((r) => r.id === 'superadmin')?.require2fa).toBe(true)
    const db = await getRole(app.db, 'superadmin')
    expect(db).toMatchObject({ name: 'Superadmin', approvalCeiling: null })
  })

  it('cargos do sistema não são renomeados nem excluídos', async () => {
    await expect(save(sa, (rs) => patch(rs, 'financeiro', { name: 'Tesouraria' }))).rejects.toMatchObject({ status: 400 })
    await expect(save(sa, (rs) => rs.filter((r) => r.id !== 'suporte'))).rejects.toMatchObject({ status: 400 })
    expect((await getRole(app.db, 'financeiro'))?.name).toBe('Financeiro')
    expect(await getRole(app.db, 'suporte')).not.toBeNull()
    // marcar como "não sistema" pelo painel não adianta
    await expect(save(sa, (rs) => patch(rs, 'suporte', { system: false }).filter((r) => r.id !== 'suporte'))).rejects.toMatchObject({ status: 400 })
  })

  it('cria cargo personalizado com id do servidor e exclui sem pessoas ativas/convidadas', async () => {
    const saved = await save(sa, (rs) => [
      ...rs,
      { id: 'cargo-do-painel', name: 'Operação noturna', description: 'Plantão', system: true, permissions: ['dashboard.ver', 'saques.ver', 'saques.ver'], require2fa: true, approvalCeiling: 250, color: 'orange' },
    ])
    const created = (saved.value as Role[]).find((r) => r.name === 'Operação noturna')!
    expect(created.id).not.toBe('cargo-do-painel')
    expect(created.id).toMatch(/^cargo_/)
    expect(created).toMatchObject({ system: false, permissions: ['dashboard.ver', 'saques.ver'], approvalCeiling: 250, require2fa: true, color: 'orange' })
    expect((await lastAudits(app))[0]).toMatchObject({ action: 'criar', entity: 'Cargo Operação noturna' })

    // nome repetido (sem diferenciar maiúsculas/acentos) e curto demais
    await expect(
      save(sa, (rs) => [...rs, { ...created, id: 'outro', name: 'operacao  NOTURNA' }]),
    ).rejects.toMatchObject({ status: 400 })
    await expect(save(sa, (rs) => [...rs, { ...created, id: 'outro', name: 'Op' }])).rejects.toMatchObject({ status: 400 })
    await expect(save(sa, (rs) => [...rs, rs[0]])).rejects.toMatchObject({ status: 400 })

    // renomear personalizado pode
    await save(sa, (rs) => patch(rs, created.id, { name: 'Plantão noturno' }))
    expect((await getRole(app.db, created.id))?.name).toBe('Plantão noturno')

    // pessoa ativa ou convidada impede a exclusão
    const ativo = await createUser(app, { roleId: created.id, name: 'Ativa' })
    await expect(save(sa, (rs) => rs.filter((r) => r.id !== created.id))).rejects.toMatchObject({ status: 400 })
    await app.db.query(`update users set status = 'convidado' where id = $1`, [ativo.id])
    await expect(save(sa, (rs) => rs.filter((r) => r.id !== created.id))).rejects.toMatchObject({ status: 400 })
    // só desligada: exclui e a pessoa vai para o cargo do sistema mais restrito
    await app.db.query(`update users set status = 'desligado' where id = $1`, [ativo.id])
    const after = await save(sa, (rs) => rs.filter((r) => r.id !== created.id))
    expect((after.value as Role[]).some((r) => r.id === created.id)).toBe(false)
    const moved = await app.db.one<{ role_id: string }>('select role_id from users where id = $1', [ativo.id])
    expect(moved?.role_id).toBe('suporte')
    const [a] = await lastAudits(app)
    expect(a).toMatchObject({ action: 'excluir', entity: 'Cargo Plantão noturno' })
    expect(a.summary).toMatch(/1 pessoa desligada passou para Suporte/)

    // sem ninguém: exclui direto
    const s2 = await save(sa, (rs) => [...rs, { ...created, id: 'tmp', name: 'Temporário' }])
    const tmp = (s2.value as Role[]).find((r) => r.name === 'Temporário')!
    await save(sa, (rs) => rs.filter((r) => r.id !== tmp.id))
    expect(await getRole(app.db, tmp.id)).toBeNull()
  })

  it('cargo de nível administrativo (antes ou depois) exige cargos.conceder', async () => {
    // Administrador tem cargos.editar mas não cargos.conceder
    await expect(save(adm, (rs) => patch(rs, 'administrador', { require2fa: true }))).rejects.toMatchObject({ status: 403, code: 'sem_permissao' })
    await expect(
      save(adm, (rs) => patch(rs, 'marketing', { permissions: [...rs.find((r) => r.id === 'marketing')!.permissions, 'equipe.editar'] })),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      save(adm, (rs) => [...rs, { id: 'x', name: 'Controle de acesso', description: '', system: false, permissions: ['equipe.ver', 'cargos.editar'], require2fa: true, approvalCeiling: 0, color: 'blue' }]),
    ).rejects.toMatchObject({ status: 403 })
    // cargo personalizado já administrativo: nem editar nem excluir
    const s = await save(sa, (rs) => [
      ...rs,
      { id: 'y', name: 'Gestão de acessos', description: '', system: false, permissions: ['equipe.ver', 'equipe.editar'], require2fa: true, approvalCeiling: 0, color: 'blue' },
    ])
    const gestao = (s.value as Role[]).find((r) => r.name === 'Gestão de acessos')!
    await expect(save(adm, (rs) => patch(rs, gestao.id, { permissions: ['equipe.ver'] }))).rejects.toMatchObject({ status: 403 })
    await expect(save(adm, (rs) => rs.filter((r) => r.id !== gestao.id))).rejects.toMatchObject({ status: 403 })
    expect(await getRole(app.db, gestao.id)).toMatchObject({ permissions: ['equipe.ver', 'equipe.editar'] })

    // cargo comum: Administrador altera e cria
    const ok = await save(adm, (rs) => patch(rs, 'marketing', { permissions: [...rs.find((r) => r.id === 'marketing')!.permissions, 'disparos.editar'] }))
    expect((ok.value as Role[]).find((r) => r.id === 'marketing')?.permissions).toContain('disparos.editar')
    const created = await save(adm, (rs) => [
      ...rs,
      { id: 'z', name: 'Atendimento VIP', description: '', system: false, permissions: ['usuarios.ver'], require2fa: false, approvalCeiling: 0, color: 'sky' },
    ])
    expect((created.value as Role[]).some((r) => r.name === 'Atendimento VIP')).toBe(true)
  })

  it('tudo ou nada: um erro na lista desfaz as outras mudanças', async () => {
    const before = await getRole(app.db, 'marketing')
    await expect(
      save(sa, (rs) => patch(patch(rs, 'marketing', { description: 'Mudou' }), 'financeiro', { name: 'Renomeado' })),
    ).rejects.toMatchObject({ status: 400 })
    expect((await getRole(app.db, 'marketing'))?.description).toBe(before?.description)
  })

  it('valida o formato da lista', async () => {
    const cur = await roles.read(ctx(app, sa))
    await expect(roles.write!(ctx(app, sa), { nope: true }, cur!.version)).rejects.toThrow()
    await expect(roles.write!(ctx(app, sa), list(cur).map((r) => ({ ...r, require2fa: 'sim' })), cur!.version)).rejects.toThrow()
    await expect(roles.write!(ctx(app, sa), list(cur).map((r) => ({ ...r, color: 'Azul!' })), cur!.version)).rejects.toThrow()
  })
})
