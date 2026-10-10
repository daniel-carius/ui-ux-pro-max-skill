import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { findKvRule } from '@shared/kv-registry'
import {
  ADMIN_LEVEL_PERMISSIONS,
  effectivePermissions,
  GOVERNED_PERMISSIONS,
  isAdminLevelRole,
  isGovernedChange,
  isGovernedRole,
  PERMISSION_BY_KEY,
  seedRoles,
  type Role,
} from '@shared/permissions'
import { bootstrap, ensureRoles } from '../src/bootstrap'
import type { KvContext, KvValue } from '../src/kv/types'
import { totpCode } from '../src/lib/totp'
import { kvHandlers } from '../src/modules/roles/kv'
import { getRole } from '../src/services/roles-repo'
import type { AuthContext } from '../src/types'
import { api, cookieFrom, createTestApp, createUser, loginAs } from './helpers'

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

  it('Superadmin não muda e o 2FA dele não pode ser desligado', async () => {
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
    // 2FA do Superadmin travado: ninguém desliga, nem quem concede cargos
    await expect(save(sa, (rs) => patch(rs, 'superadmin', { require2fa: false }))).rejects.toMatchObject({
      status: 400,
      code: 'dados_invalidos',
      details: { id: 'superadmin', field: 'require2fa' },
    })
    await expect(save(adm, (rs) => patch(rs, 'superadmin', { require2fa: false }))).rejects.toMatchObject({ status: 400 })
    // reenviar o que já está gravado não é mudança
    await save(sa, (rs) => patch(rs, 'superadmin', { require2fa: true }))
    const db = await getRole(app.db, 'superadmin')
    expect(db).toMatchObject({ name: 'Superadmin', approvalCeiling: null, require2fa: true })
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

  // Regressão r2-payout-flow-cross-module-2 (parte de cargos): webhooks.editar troca para onde vão as ordens de
  // saque.pago assinadas com o segredo de produção; quem tem só cargos.editar não pode dar essa permissão a ninguém.
  it('webhooks.editar é de nível administrativo: só quem tem cargos.conceder concede', async () => {
    expect(ADMIN_LEVEL_PERMISSIONS).toContain('webhooks.editar')
    expect(isAdminLevelRole({ permissions: ['webhooks.ver', 'webhooks.editar'] })).toBe(true)
    expect(isAdminLevelRole({ permissions: ['webhooks.ver'] })).toBe(false)
    // cargos da semente que não são administrativos continuam sem webhooks.editar
    for (const r of seedRoles().filter((x) => !['superadmin', 'administrador'].includes(x.id))) {
      expect(r.permissions, r.id).not.toContain('webhooks.editar')
      expect(isAdminLevelRole(r), r.id).toBe(false)
    }

    const mk = (rs: Role[]) => rs.find((r) => r.id === 'marketing')!.permissions
    await expect(save(adm, (rs) => patch(rs, 'marketing', { permissions: [...mk(rs), 'webhooks.ver', 'webhooks.editar'] }))).rejects.toMatchObject({
      status: 403,
      code: 'sem_permissao',
    })
    await expect(
      save(adm, (rs) => [
        ...rs,
        { id: 'w', name: 'Integrações', description: '', system: false, permissions: ['webhooks.ver', 'webhooks.editar'], require2fa: false, approvalCeiling: 0, color: 'blue' },
      ]),
    ).rejects.toMatchObject({ status: 403 })
    expect(await getRole(app.db, 'marketing')).toMatchObject({ permissions: expect.not.arrayContaining(['webhooks.editar']) })
    expect((await roles.read(ctx(app, sa)))!.value as Role[]).not.toContainEqual(expect.objectContaining({ name: 'Integrações' }))

    // Superadmin concede; depois disso o Administrador não mexe mais no cargo
    const s = await save(sa, (rs) => [
      ...rs,
      { id: 'w', name: 'Integrações', description: '', system: false, permissions: ['webhooks.ver', 'webhooks.editar'], require2fa: true, approvalCeiling: 0, color: 'blue' },
    ])
    const integ = (s.value as Role[]).find((r) => r.name === 'Integrações')!
    await expect(save(adm, (rs) => patch(rs, integ.id, { require2fa: false }))).rejects.toMatchObject({ status: 403 })
    await expect(save(adm, (rs) => rs.filter((r) => r.id !== integ.id))).rejects.toMatchObject({ status: 403 })

    // e pela equipe: o Administrador não coloca ninguém nesse cargo
    const target = await createUser(app, { roleId: 'suporte', name: 'Alvo Webhooks' })
    const admCookie = (await loginAs(app, 'administrador', { name: 'Adm Webhooks' })).cookie
    const moved = await api(app, 'POST', `/api/team/${target.id}/role`, { cookie: admCookie, body: { roleId: integ.id } })
    expect(moved.statusCode).toBe(403)
    const created = await api(app, 'POST', '/api/team/direct', {
      cookie: admCookie,
      body: { name: 'Nova Integradora', email: 'integra@x2win.bet', roleId: integ.id },
    })
    expect(created.statusCode).toBe(403)
    expect((await app.db.one<{ role_id: string }>('select role_id from users where id = $1', [target.id]))?.role_id).toBe('suporte')
  })

  // Governança: aprovar saques (com o teto), jogo responsável e países bloqueados. O Administrador (cargos.editar sem
  // cargos.conceder) montava um cargo com usuarios.editar + transacoes.editar + saques.aprovar sem teto e punha
  // alguém nele: a mesma pessoa mexia no saldo do jogador e aprovava o saque sem limite, sem ninguém que concede
  // cargos aprovar.
  it('permissões de governança e teto de aprovação: só quem tem cargos.conceder dá, tira ou muda', async () => {
    expect(GOVERNED_PERMISSIONS).toEqual(
      expect.arrayContaining([...ADMIN_LEVEL_PERMISSIONS, 'saques.aprovar', 'afiliados-saques.aprovar', 'jogo-responsavel.editar', 'paises.editar']),
    )
    for (const k of GOVERNED_PERMISSIONS) expect(PERMISSION_BY_KEY.has(k), k).toBe(true)
    expect(isGovernedRole({ permissions: ['saques.ver', 'saques.aprovar'] })).toBe(true)
    expect(isGovernedRole({ permissions: ['saques.ver', 'usuarios.editar'] })).toBe(false)
    expect(isGovernedChange(null, { permissions: ['usuarios.ver'], approvalCeiling: 0 })).toBe(false)
    expect(isGovernedChange(null, { permissions: ['usuarios.ver'], approvalCeiling: null })).toBe(true)
    expect(isGovernedChange({ permissions: ['saques.aprovar'], approvalCeiling: 1234.56 }, { permissions: ['saques.aprovar', 'ggr.ver'], approvalCeiling: 1234.56 })).toBe(false)
    expect(isGovernedChange({ permissions: ['paises.editar'], approvalCeiling: 0 }, null)).toBe(true)

    const toxic = {
      id: 'tx',
      name: 'Caixa Total',
      description: '',
      system: false,
      permissions: ['usuarios.ver', 'usuarios.editar', 'transacoes.ver', 'transacoes.editar', 'saques.ver', 'saques.aprovar'],
      require2fa: true,
      approvalCeiling: null,
      color: 'rose',
    }
    await expect(save(adm, (rs) => [...rs, toxic])).rejects.toMatchObject({ status: 403, code: 'sem_permissao' })
    // cada peça sozinha também
    for (const extra of [
      { permissions: ['saques.ver', 'saques.aprovar'], approvalCeiling: 0 },
      // pagar saque de afiliado: teto 0 ali não limita o valor
      { permissions: ['afiliados-saques.ver', 'afiliados-saques.aprovar'], approvalCeiling: 0 },
      { permissions: ['jogo-responsavel.ver', 'jogo-responsavel.editar'], approvalCeiling: 0 },
      { permissions: ['paises.ver', 'paises.editar'], approvalCeiling: 0 },
      { permissions: ['usuarios.ver'], approvalCeiling: null },
      { permissions: ['usuarios.ver'], approvalCeiling: 100 },
    ]) {
      await expect(save(adm, (rs) => [...rs, { ...toxic, ...extra }]), JSON.stringify(extra)).rejects.toMatchObject({ status: 403, code: 'sem_permissao' })
    }
    expect((await roles.read(ctx(app, sa)))!.value as Role[]).not.toContainEqual(expect.objectContaining({ name: 'Caixa Total' }))

    // cargo existente: dar ou tirar permissão de governança, ou mudar o teto (para cima ou para baixo)
    const fin = (rs: Role[]) => rs.find((r) => r.id === 'financeiro')!
    const mk = (rs: Role[]) => rs.find((r) => r.id === 'marketing')!.permissions
    const finBefore = await getRole(app.db, 'financeiro')
    const mkBefore = await getRole(app.db, 'marketing')
    await expect(save(adm, (rs) => patch(rs, 'financeiro', { approvalCeiling: null }))).rejects.toMatchObject({ status: 403 })
    await expect(save(adm, (rs) => patch(rs, 'financeiro', { approvalCeiling: (fin(rs).approvalCeiling ?? 0) + 1000 }))).rejects.toMatchObject({ status: 403 })
    await expect(save(adm, (rs) => patch(rs, 'financeiro', { approvalCeiling: 1 }))).rejects.toMatchObject({ status: 403 })
    await expect(save(adm, (rs) => patch(rs, 'financeiro', { permissions: fin(rs).permissions.filter((p) => p !== 'saques.aprovar') }))).rejects.toMatchObject({
      status: 403,
    })
    for (const k of ['saques.aprovar', 'afiliados-saques.aprovar', 'jogo-responsavel.editar', 'paises.editar']) {
      await expect(save(adm, (rs) => patch(rs, 'marketing', { permissions: [...mk(rs), k] })), k).rejects.toMatchObject({ status: 403 })
    }
    expect(await getRole(app.db, 'financeiro')).toEqual(finBefore)
    expect(await getRole(app.db, 'marketing')).toEqual(mkBefore)
    // o resto do cargo segue com cargos.editar
    const desc = await save(adm, (rs) => patch(rs, 'financeiro', { description: 'Depósitos, saques e conciliação' }))
    expect((desc.value as Role[]).find((r) => r.id === 'financeiro')).toMatchObject({ description: 'Depósitos, saques e conciliação', approvalCeiling: finBefore!.approvalCeiling })

    // Superadmin cria e muda o teto; o Administrador depois não sobe o teto nem exclui
    const s = await save(sa, (rs) => [...rs, toxic])
    const caixa = (s.value as Role[]).find((r) => r.name === 'Caixa Total')!
    expect(caixa).toMatchObject({ approvalCeiling: null, permissions: expect.arrayContaining(['saques.aprovar', 'transacoes.editar']) })
    await save(sa, (rs) => patch(rs, caixa.id, { approvalCeiling: 2000 }))
    await expect(save(adm, (rs) => patch(rs, caixa.id, { approvalCeiling: null }))).rejects.toMatchObject({ status: 403 })
    await expect(save(adm, (rs) => rs.filter((r) => r.id !== caixa.id))).rejects.toMatchObject({ status: 403 })
    expect((await getRole(app.db, caixa.id))?.approvalCeiling).toBe(2000)

    // e pela equipe: o Administrador não põe ninguém no cargo; o Superadmin põe
    const target = await createUser(app, { roleId: 'suporte', name: 'Alvo Caixa' })
    const admCookie = (await loginAs(app, 'administrador', { name: 'Adm Caixa' })).cookie
    // com 2FA: o cargo Superadmin já exige o fator neste ponto da suíte
    const saCookie = (await loginAs(app, 'superadmin', { name: 'Sa Caixa', totp: true })).cookie
    const moved = await api(app, 'POST', `/api/team/${target.id}/role`, { cookie: admCookie, body: { roleId: caixa.id } })
    expect(moved.statusCode).toBe(403)
    expect(moved.json().error.code).toBe('sem_permissao')
    const direct = await api(app, 'POST', '/api/team/direct', { cookie: admCookie, body: { name: 'Caixa Novo', email: 'caixa.novo@x2win.bet', roleId: caixa.id } })
    expect(direct.statusCode).toBe(403)
    expect((await app.db.one<{ role_id: string }>('select role_id from users where id = $1', [target.id]))?.role_id).toBe('suporte')
    const bySa = await api(app, 'POST', `/api/team/${target.id}/role`, { cookie: saCookie, body: { roleId: caixa.id } })
    expect(bySa.statusCode, bySa.body).toBe(200)
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

/** Captura as mensagens de app.log.info/warn enquanto fn roda. */
async function captureLogs(app: FastifyInstance, fn: () => Promise<unknown>) {
  const logs: { level: 'info' | 'warn'; text: string }[] = []
  const fmt = (args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  const info = vi.spyOn(app.log, 'info').mockImplementation(((...args: unknown[]) => logs.push({ level: 'info', text: fmt(args) })) as never)
  const warn = vi.spyOn(app.log, 'warn').mockImplementation(((...args: unknown[]) => logs.push({ level: 'warn', text: fmt(args) })) as never)
  try {
    await fn()
  } finally {
    info.mockRestore()
    warn.mockRestore()
  }
  return logs
}

// Regressão r1-authz-6 / r1-logic-4: ensureRoles roda em toda subida (index.ts -> bootstrap).
describe('ensureRoles (toda subida da API)', () => {
  let app: FastifyInstance
  afterEach(async () => app?.close())

  async function getList(cookie: string) {
    const r = await api(app, 'GET', '/api/kv/cargos.lista', { cookie })
    expect(r.statusCode, r.body).toBe(200)
    return r.json() as { value: Role[]; version: number }
  }

  it('instalação nova: cria os cargos do sistema e os personalizados da semente', async () => {
    app = await createTestApp()
    const rows = await app.db.query<{ id: string }>('select id from roles order by id')
    expect(rows.map((r) => r.id)).toEqual(['adm', 'administrador', 'financeiro', 'marketing', 'marketing-oficial', 'superadmin', 'suporte'])
    // subir de novo não muda nada
    await ensureRoles(app)
    expect((await app.db.query('select id from roles')).length).toBe(7)
  })

  it('cargo personalizado da semente excluído não volta na próxima subida', async () => {
    app = await createTestApp()
    const { cookie } = await loginAs(app, 'administrador')
    const cur = await getList(cookie)
    const put = await api(app, 'PUT', '/api/kv/cargos.lista', { cookie, body: { value: cur.value.filter((r) => r.id !== 'adm'), version: cur.version } })
    expect(put.statusCode, put.body).toBe(200)
    expect(await getRole(app.db, 'adm')).toBeNull()

    await ensureRoles(app)
    await bootstrap(app, {})
    expect(await getRole(app.db, 'adm')).toBeNull()
  })

  it('excluir "marketing" e criar outro "Marketing" não impede a próxima subida', async () => {
    app = await createTestApp()
    const { cookie } = await loginAs(app, 'administrador')
    let cur = await getList(cookie)
    let put = await api(app, 'PUT', '/api/kv/cargos.lista', { cookie, body: { value: cur.value.filter((r) => r.id !== 'marketing'), version: cur.version } })
    expect(put.statusCode, put.body).toBe(200)
    cur = await getList(cookie)
    put = await api(app, 'PUT', '/api/kv/cargos.lista', {
      cookie,
      body: {
        value: [
          ...cur.value,
          { id: 'novo', name: 'Marketing', description: 'novo', permissions: ['dashboard.ver'], require2fa: false, approvalCeiling: 0, color: 'rose' },
        ],
        version: cur.version,
      },
    })
    expect(put.statusCode, put.body).toBe(200)

    // reinícios seguidos: nenhuma exceção (index.ts faria o processo sair antes do listen)
    await expect(ensureRoles(app)).resolves.toBeUndefined()
    await expect(ensureRoles(app)).resolves.toBeUndefined()
    await expect(bootstrap(app, {})).resolves.toBeUndefined()
    expect(await getRole(app.db, 'marketing')).toBeNull()
    const mk = await app.db.query<{ id: string; name: string; system: boolean }>(`select id, name, system from roles where lower(name) = 'marketing'`)
    expect(mk).toEqual([{ id: expect.stringMatching(/^cargo_/), name: 'Marketing', system: false }])
  })

  it('cargo do sistema que falta volta; conflito de nome é pulado com aviso, sem derrubar a subida', async () => {
    app = await createTestApp()
    // cargo do sistema ausente (ex.: novo numa versão nova) é criado na subida
    await app.db.query(`delete from roles where id = 'marketing-oficial'`)
    await ensureRoles(app)
    expect(await getRole(app.db, 'marketing-oficial')).toMatchObject({ system: true, require2fa: true })

    // um cargo personalizado já usa o nome do cargo do sistema que falta
    await app.db.query(`delete from roles where id = 'suporte'`)
    await app.db.query(`insert into roles (id, name, permissions) values ('cargo_x', 'SUPORTE', '{dashboard.ver}')`)
    let failure: unknown = null
    const logs = await captureLogs(app, () => ensureRoles(app).catch((e) => (failure = e)))
    expect(failure).toBeNull()
    expect(await getRole(app.db, 'suporte')).toBeNull()
    expect(await getRole(app.db, 'cargo_x')).toMatchObject({ name: 'SUPORTE', system: false })
    expect(logs.some((l) => l.level === 'warn' && l.text.includes('"Suporte"') && l.text.includes('cargo_x'))).toBe(true)
  })

  it('Superadmin volta a ter o catálogo todo e a exigir 2FA a cada subida (backup restaurado ou migração)', async () => {
    app = await createTestApp()
    await createUser(app, { roleId: 'superadmin' })
    await app.db.query(`update roles set require_2fa = false, permissions = '{dashboard.ver}', approval_ceiling_cents = 100 where id = 'superadmin'`)
    await app.db.query(`update roles set require_2fa = false where id in ('administrador', 'financeiro')`)
    const logs = await captureLogs(app, () => bootstrap(app, {}))
    const sa = await getRole(app.db, 'superadmin')
    expect(sa).toMatchObject({ require2fa: true, approvalCeiling: null })
    expect(sa!.permissions).toEqual(seedRoles().find((r) => r.id === 'superadmin')!.permissions)
    expect(logs.some((l) => l.level === 'warn' && l.text.includes('Superadmin'))).toBe(true)
    const a = await app.db.one<{ action: string; entity: string; summary: string; actor_id: string | null }>(
      'select action, entity, summary, actor_id from audit_log order by id desc limit 1',
    )
    expect(a).toMatchObject({ action: 'editar', entity: 'Cargo Superadmin', actor_id: null })
    expect(a?.summary).toContain('2FA passou a ser exigido')
    // instalação existente: a decisão da operação sobre os outros cargos fica como está
    expect((await getRole(app.db, 'administrador'))?.require2fa).toBe(false)
    expect((await getRole(app.db, 'financeiro'))?.require2fa).toBe(false)
    // já ligado: nada a fazer, nada a auditar
    const n = (await app.db.query('select id from audit_log')).length
    await bootstrap(app, {})
    expect((await app.db.query('select id from audit_log')).length).toBe(n)
  })
})

// Regressão r1-authn-7: o Superadmin criado por ADMIN_EMAIL/ADMIN_PASSWORD não entra só com senha.
describe('primeiro Superadmin (bootstrap)', () => {
  const ADMIN_EMAIL = 'primeiro.admin@teste.x2win'
  const ADMIN_PASSWORD = 'SenhaForteDoTeste2026'

  it('o primeiro login cai no cadastro do 2FA e a API protegida espera o cadastro', async () => {
    const app = await createTestApp({ ADMIN_EMAIL, ADMIN_PASSWORD })
    try {
      const logs = await captureLogs(app, () => bootstrap(app, {}))
      // o log diz o que a etapa calculada vai pedir (e não há aviso de Superadmin sem 2FA)
      expect(logs).toContainEqual({ level: 'info', text: 'Superadmin criado a partir de ADMIN_EMAIL. No primeiro login será pedido o 2FA.' })
      expect(logs.some((l) => l.text.includes('SEM exigência de 2FA'))).toBe(false)
      const u = await app.db.one<{ role_id: string; totp_enabled: boolean }>('select role_id, totp_enabled from users where email = $1', [ADMIN_EMAIL])
      expect(u).toEqual({ role_id: 'superadmin', totp_enabled: false })
      // instalação nova: acesso total e aprovação de saques já exigem 2FA
      for (const id of ['superadmin', 'administrador', 'financeiro']) expect((await getRole(app.db, id))?.require2fa, id).toBe(true)
      expect((await getRole(app.db, 'suporte'))?.require2fa).toBe(false)

      const r = await api(app, 'POST', '/api/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, ip: '10.70.0.1' })
      expect(r.statusCode, r.body).toBe(200)
      expect(r.json()).toEqual({ stage: 'enroll' })
      const cookie = cookieFrom(r)!
      const blocked = await api(app, 'GET', '/api/kv/cargos.lista', { cookie })
      expect(blocked.statusCode).toBe(403)
      expect(blocked.json().error.code).toBe('etapa_pendente')

      // depois do cadastro do 2FA a sessão fica completa
      const setup = await api(app, 'POST', '/api/auth/2fa/setup', { cookie })
      expect(setup.statusCode, setup.body).toBe(200)
      const { secret } = setup.json() as { secret: string }
      const en = await api(app, 'POST', '/api/auth/2fa/enable', { cookie, body: { code: totpCode(secret, Date.now()) } })
      expect(en.statusCode, en.body).toBe(200)
      expect(en.json().stage).toBe('active')
      expect((await api(app, 'GET', '/api/kv/cargos.lista', { cookie })).statusCode).toBe(200)

      // Administrador criado depois também passa pelo cadastro do 2FA
      const adm = await createUser(app, { roleId: 'administrador' })
      const ra = await api(app, 'POST', '/api/auth/login', { body: { email: adm.email, password: adm.password }, ip: '10.70.0.2' })
      expect(ra.statusCode, ra.body).toBe(200)
      expect(ra.json()).toEqual({ stage: 'enroll' })

      // reinício: nada muda, nenhum Superadmin novo
      await bootstrap(app, {})
      expect((await app.db.query(`select id from users where role_id = 'superadmin'`)).length).toBe(1)
    } finally {
      await app.close()
    }
  })
})
