// PoC (verificação de impacto): crescimento.afiliados / crescimento.comissoes são JSON genérico.
// Mede: (1) quais cargos padrão têm as permissões que gravam essas chaves; (2) se a gravação de
// saldo/CPA/Rev Share por cargo personalizado passa; (3) se o "creditar → pagar" precisa do saldo
// (o pagador já grava um saque "pago" de qualquer valor sem tocar no saldo); (4) autor real na auditoria.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canWriteKey, findKvRule } from '@shared/kv-registry'
import { seedRoles } from '@shared/permissions'
import { newId } from '../src/lib/crypto'
import { api, createTestApp, loginAs } from './helpers'

const AFF = 'crescimento.afiliados'
const COM = 'crescimento.comissoes'

async function getKv(app: FastifyInstance, cookie: string, key: string) {
  const r = await api(app, 'GET', `/api/kv/${key}`, { cookie })
  expect(r.statusCode, r.body).toBe(200)
  return r.json() as { value: any; version: number }
}

async function makeRole(app: FastifyInstance, rootCookie: string, name: string, permissions: string[]) {
  const roles = await getKv(app, rootCookie, 'cargos.lista')
  const role = { id: newId('r'), name, description: name, system: false, permissions, require2fa: false, approvalCeiling: 0, color: 'violet' }
  const r = await api(app, 'PUT', '/api/kv/cargos.lista', { cookie: rootCookie, body: { value: [...roles.value, role], version: roles.version } })
  expect(r.statusCode, r.body).toBe(200)
  return (r.json().value as { id: string; name: string }[]).find((x) => x.name === name)!.id
}

describe('poc-verify-affiliate-balance-rewrite-impact', () => {
  let app: FastifyInstance
  let root: { cookie: string }
  beforeAll(async () => {
    app = await createTestApp()
    root = await loginAs(app, 'superadmin', { name: 'Daniel Carius' })
    const seed = [{ id: 'a1', name: 'Afiliado Um', type: 'Manager', code: 'AFUM', cpa: 50, revShare: 20, status: 'ativo', balance: 100 }]
    expect((await api(app, 'PUT', `/api/kv/${AFF}`, { cookie: root.cookie, body: { value: seed, version: 0 } })).statusCode).toBe(200)
  })
  afterAll(async () => app.close())

  it('(1) cargos padrão que gravam crescimento.afiliados / crescimento.comissoes', () => {
    const aff = findKvRule(AFF)!
    const com = findKvRule(COM)!
    const affHolders = seedRoles().filter((r) => canWriteKey(aff, new Set(r.permissions))).map((r) => r.id)
    const comHolders = seedRoles().filter((r) => canWriteKey(com, new Set(r.permissions))).map((r) => r.id)
    console.log('[impact] seed roles that write crescimento.afiliados:', JSON.stringify(affHolders))
    console.log('[impact] seed roles that write crescimento.comissoes:', JSON.stringify(comHolders))
    expect(affHolders).toEqual(['superadmin', 'administrador'])
    expect(comHolders).toEqual(['superadmin', 'administrador'])
  })

  it('(2)+(3)+(4) gravações passam; pagar não depende do saldo; autor real na auditoria', async () => {
    const soCom = await loginAs(app, await makeRole(app, root.cookie, 'SoComissoes', ['comissoes.ver', 'comissoes.editar']), { name: 'Pessoa Comissoes' })
    const soPag = await loginAs(app, await makeRole(app, root.cookie, 'SoPagarAfil', ['afiliados-saques.ver', 'afiliados-saques.aprovar']), { name: 'Pessoa Pagadora' })

    let cur = await getKv(app, soCom.cookie, AFF)
    let r = await api(app, 'PUT', `/api/kv/${AFF}`, { cookie: soCom.cookie, body: { value: cur.value.map((a: any) => ({ ...a, balance: 500000, cpa: 100000, revShare: 900 })), version: cur.version } })
    console.log('[impact] SoComissoes PUT crescimento.afiliados balance/cpa/revShare ->', r.statusCode)
    expect(r.statusCode).toBe(200)

    r = await api(app, 'PUT', `/api/kv/${COM}`, { cookie: soCom.cookie, body: { value: { Manager: { model: 'revshare', value: 900, cap: null, updatedAt: null, updatedBy: 'Daniel Carius' } }, version: 0 } })
    console.log('[impact] SoComissoes PUT crescimento.comissoes revshare 900 ->', r.statusCode)
    expect(r.statusCode).toBe(200)

    // restaura saldo a 100 para isolar o passo "pagar"
    cur = await getKv(app, root.cookie, AFF)
    await api(app, 'PUT', `/api/kv/${AFF}`, { cookie: root.cookie, body: { value: cur.value.map((a: any) => ({ ...a, balance: 100 })), version: cur.version } })

    // o pagador grava um saque "pago" de R$ 999.999 sem tocar no saldo (saldo segue 100)
    const wd = await api(app, 'PUT', '/api/kv/afiliados.saques', {
      cookie: soPag.cookie,
      body: { value: [{ id: 'w9', affiliateId: 'a1', affiliateName: 'Afiliado Um', amount: 999999, status: 'pago', method: 'pix', decidedBy: 'Daniel Carius' }], version: 0 },
    })
    const balAfter = (await getKv(app, root.cookie, AFF)).value.find((a: any) => a.id === 'a1').balance
    console.log('[impact] SoPagarAfil PUT afiliados.saques pago 999999 without touching balance ->', wd.statusCode, '| a1.balance still', balAfter)
    expect(wd.statusCode).toBe(200)
    expect(balAfter).toBe(100)

    const rows = await app.db.query<{ actor_id: string; actor_name: string; summary: string }>(
      `select actor_id, actor_name, summary from audit_log where summary like 'crescimento.%' or summary like 'afiliados.saques%' order by id`,
    )
    console.log('[impact] audit rows:', JSON.stringify(rows))
    console.log('[impact] soCom id', soCom.user.id, 'soPag id', soPag.user.id)
  })
})
