// PoC (verificação de impacto): afiliados.saques é chave genérica.
// Mede: (1) quais cargos padrão têm afiliados-saques.aprovar; (2) se a auditoria do servidor
// identifica o autor real mesmo com decidedBy forjado; (3) se a mesma permissão já grava o saldo
// dos afiliados (crescimento.afiliados) por desenho; (4) se o teto de aprovação vale para saques de afiliado.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canWriteKey, findKvRule } from '@shared/kv-registry'
import { seedRoles } from '@shared/permissions'
import { canDecideWithdrawals } from '@shared/withdrawals'
import { api, createTestApp, loginAs } from './helpers'

describe('poc-verify-affiliate-payouts-impact', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('(1) cargos padrão com afiliados-saques.aprovar', () => {
    const holders = seedRoles().filter((r) => r.permissions.includes('afiliados-saques.aprovar')).map((r) => r.id)
    console.log('[impact] cargos padrão com afiliados-saques.aprovar:', JSON.stringify(holders))
    expect(holders).toEqual(['superadmin', 'administrador'])
  })

  it('(2)+(3) autor real na auditoria; mesma permissão grava saldo de afiliado', async () => {
    const root = await loginAs(app, 'superadmin', { name: 'Daniel Carius' })
    const seed = [{ id: 'w1', affiliateId: 'a1', affiliateName: 'A1', amount: 300, status: 'pendente', method: 'pix', decidedBy: null }]
    expect((await api(app, 'PUT', '/api/kv/afiliados.saques', { cookie: root.cookie, body: { value: seed, version: 0 } })).statusCode).toBe(200)
    const admin = await loginAs(app, 'administrador', { name: 'Admin Malicioso' })
    const cur = (await api(app, 'GET', '/api/kv/afiliados.saques', { cookie: admin.cookie })).json() as { value: any[]; version: number }
    const forged = cur.value.map((w) => ({ ...w, amount: 250000, status: 'pago', decidedBy: 'Daniel Carius' }))
    const r = await api(app, 'PUT', '/api/kv/afiliados.saques', { cookie: admin.cookie, body: { value: forged, version: cur.version }, ip: '203.0.113.9' })
    expect(r.statusCode).toBe(200)
    const a = await app.db.one<{ actor_id: string; actor_name: string; ip: string; summary: string; source: string }>(
      `select actor_id, actor_name, ip, source, summary from audit_log where summary like 'afiliados.saques — Itens%' order by id desc limit 1`,
    )
    console.log('[impact] auditoria do servidor:', JSON.stringify(a), '| autor real:', admin.user.id)
    expect(a!.actor_id).toBe(admin.user.id)

    const roles = (await api(app, 'GET', '/api/kv/cargos.lista', { cookie: root.cookie })).json().value as any[]
    const custom = { ...roles[0], id: 'x', name: 'X', system: false, permissions: ['afiliados-saques.ver', 'afiliados-saques.aprovar'], approvalCeiling: 0 }
    const affRule = findKvRule('crescimento.afiliados')!
    console.log('[impact] afiliados-saques.aprovar grava crescimento.afiliados (saldos)?', canWriteKey(affRule, new Set(custom.permissions as string[])))
    console.log('[impact] teto 0 vale para saque de afiliado? canDecideWithdrawals(custom)=', canDecideWithdrawals(custom), '(função só olha saques.aprovar)')
  })
})
