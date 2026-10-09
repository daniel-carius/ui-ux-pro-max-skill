// PoC (round 2): crescimento.afiliados e crescimento.comissoes são JSON genérico (sem `domain`).
// Quem só tem comissoes.editar (tela Links: trocar o código do link) ou afiliados-saques.aprovar
// (devolver o valor ao recusar um saque) regrava saldo, CPA e Rev Share de qualquer afiliado.
// Asserções do comportamento SEGURO: estes testes FALHAM enquanto o servidor aceitar qualquer conteúdo.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../src/lib/crypto'
import { api, createTestApp, loginAs } from './helpers'

const AFF = 'crescimento.afiliados'
const COM = 'crescimento.comissoes'

function affiliate(p: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    playerId: 'p1',
    name: 'Afiliado Um',
    email: 'afiliado1@x.com',
    type: 'Manager',
    level: 1,
    managerId: null,
    code: 'AFUM',
    cpa: 50,
    revShare: 20,
    status: 'ativo',
    balance: 100,
    pixKey: '12345678909',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...p,
  }
}

async function getKv(app: FastifyInstance, cookie: string, key: string) {
  const r = await api(app, 'GET', `/api/kv/${key}`, { cookie })
  expect(r.statusCode, r.body).toBe(200)
  return r.json() as { value: any; version: number }
}

async function storedPlain(app: FastifyInstance, key: string) {
  const row = await app.db.one<{ value: unknown; value_enc: string | null; version: number }>('select value, value_enc, version from kv_store where key = $1', [key])
  if (!row) return null
  return row.value_enc ? JSON.parse(app.cipher.decrypt(row.value_enc)) : row.value
}

async function makeRole(app: FastifyInstance, rootCookie: string, name: string, permissions: string[]) {
  const roles = await getKv(app, rootCookie, 'cargos.lista')
  const role = { id: newId('r'), name, description: name, system: false, permissions, require2fa: false, approvalCeiling: 0, color: 'violet' }
  const r = await api(app, 'PUT', '/api/kv/cargos.lista', { cookie: rootCookie, body: { value: [...roles.value, role], version: roles.version } })
  expect(r.statusCode, r.body).toBe(200)
  const created = (r.json().value as { id: string; name: string; permissions: string[] }[]).find((x) => x.name === name)!
  console.log(`[poc] cargo ${name} criado com permissões:`, JSON.stringify(created.permissions))
  return created.id
}

describe('crescimento.afiliados / crescimento.comissoes: saldo e taxas sem regra no servidor', () => {
  let app: FastifyInstance
  let root: { cookie: string }
  let soComissoes: { cookie: string }
  let soPagarAfil: { cookie: string }

  beforeAll(async () => {
    app = await createTestApp()
    root = await loginAs(app, 'superadmin')
    const seed = await api(app, 'PUT', `/api/kv/${AFF}`, { cookie: root.cookie, body: { value: [affiliate()], version: 0 } })
    expect(seed.statusCode, seed.body).toBe(200)

    soComissoes = await loginAs(app, await makeRole(app, root.cookie, 'SoComissoes', ['comissoes.ver', 'comissoes.editar']), { name: 'Pessoa Comissoes' })
    soPagarAfil = await loginAs(app, await makeRole(app, root.cookie, 'SoPagarAfil', ['afiliados-saques.ver', 'afiliados-saques.aprovar']), { name: 'Pessoa Pagadora' })
  })
  afterAll(async () => app.close())

  it('comissoes.editar (só troca código de link no painel) não pode reescrever saldo/CPA/Rev Share', async () => {
    const cur = await getKv(app, soComissoes.cookie, AFF)
    const forged = (cur.value as any[]).map((a) => (a.id === 'a1' ? { ...a, balance: 500_000, cpa: 100_000, revShare: 900 } : a))
    const put = await api(app, 'PUT', `/api/kv/${AFF}`, { cookie: soComissoes.cookie, body: { value: forged, version: cur.version } })
    const a1 = ((await storedPlain(app, AFF)) as any[]).find((a) => a.id === 'a1')
    console.log('[poc] SoComissoes PUT crescimento.afiliados →', put.statusCode, '| gravado a1:', JSON.stringify({ balance: a1.balance, cpa: a1.cpa, revShare: a1.revShare }))
    expect(put.statusCode).not.toBe(200)
    expect(a1.balance).toBe(100)
  })

  it('afiliados-saques.aprovar não pode creditar saldo arbitrário a um afiliado', async () => {
    const cur = await getKv(app, soPagarAfil.cookie, AFF)
    const forged = (cur.value as any[]).map((a) => (a.id === 'a1' ? { ...a, balance: 999_999 } : a))
    const put = await api(app, 'PUT', `/api/kv/${AFF}`, { cookie: soPagarAfil.cookie, body: { value: forged, version: cur.version } })
    const a1 = ((await storedPlain(app, AFF)) as any[]).find((a) => a.id === 'a1')
    console.log('[poc] SoPagarAfil PUT crescimento.afiliados →', put.statusCode, '| gravado a1.balance:', a1.balance)
    // o mesmo cargo grava a lista de saques (afiliados.saques) — mostra a cadeia creditar → pagar por uma só pessoa
    const wd = await api(app, 'PUT', '/api/kv/afiliados.saques', {
      cookie: soPagarAfil.cookie,
      body: { value: [{ id: 'w9', affiliateId: 'a1', affiliateName: 'Afiliado Um', amount: 999_999, status: 'pago', method: 'pix', decidedBy: 'Pessoa Pagadora' }], version: 0 },
    })
    console.log('[poc] SoPagarAfil PUT afiliados.saques (pago 999999) →', wd.statusCode)
    const audits = await app.db.query<{ summary: string }>(`select summary from audit_log where summary like 'crescimento.afiliados%' order by id`)
    console.log('[poc] auditoria crescimento.afiliados:', JSON.stringify(audits.map((a) => a.summary)))
    expect(put.statusCode).not.toBe(200)
    expect(a1.balance).not.toBe(999_999)
  })

  it('comissoes.editar não grava regra de comissão inválida (Rev Share 900%)', async () => {
    const put = await api(app, 'PUT', `/api/kv/${COM}`, {
      cookie: soComissoes.cookie,
      body: { value: { Manager: { model: 'revshare', value: 900, cap: null, updatedAt: null, updatedBy: 'Daniel Carius' } }, version: 0 },
    })
    const stored = await storedPlain(app, COM)
    const audits = await app.db.query<{ summary: string }>(`select summary from audit_log where summary like 'crescimento.comissoes%' order by id`)
    console.log('[poc] SoComissoes PUT crescimento.comissoes (revshare 900, updatedBy Daniel) →', put.statusCode, '| gravado:', JSON.stringify(stored))
    console.log('[poc] auditoria crescimento.comissoes:', JSON.stringify(audits.map((a) => a.summary)))
    expect(put.statusCode).not.toBe(200)
  })
})
