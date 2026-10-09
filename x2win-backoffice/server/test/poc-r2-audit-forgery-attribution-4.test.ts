// PoC (verificador independente): saques de afiliados (afiliados.saques) e saldo de comissão (crescimento.afiliados)
// não têm domínio no servidor. Um cargo com só afiliados-saques.ver + .aprovar grava pela rota genérica /api/kv:
// muda o valor do pedido, marca "pago", escolhe quem decidiu ("Daniel Carius") e a referência. A única linha
// da auditoria é "editar … Itens: 1 alterado (aw-1)" — sem valor, sem favorecido, sem "aprovar".
// Este teste afirma o comportamento SEGURO e por isso FALHA enquanto o problema existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { api, createTestApp, loginAs } from './helpers'

type Row = Record<string, any>
type Audit = { id: number; actor_id: string; actor_name: string; action: string; entity: string; summary: string; source: string }

let app: FastifyInstance
let daniel: Awaited<ReturnType<typeof loginAs>>
let paulo: Awaited<ReturnType<typeof loginAs>>
let gerente: Awaited<ReturnType<typeof loginAs>>

const WITHDRAWAL = {
  id: 'aw-1',
  affiliateId: 'af-1',
  affiliateName: 'Ana Afiliada',
  affiliateEmail: 'ana.afiliada@gmail.com',
  affiliateType: 'Influencer',
  amount: 12000,
  method: 'pix',
  pixKeyType: 'CPF',
  pixKey: '12345678909',
  bank: null,
  status: 'pendente',
  createdAt: new Date().toISOString(),
  decidedAt: null,
  decidedBy: null,
  reason: null,
  reference: null,
}
const AFFILIATE = {
  id: 'af-1',
  playerId: 'p-1',
  name: 'Ana Afiliada',
  email: 'ana.afiliada@gmail.com',
  type: 'Influencer',
  level: 1,
  managerId: null,
  code: 'ANA10',
  cpa: 50,
  revShare: 25,
  status: 'ativo',
  balance: 300,
  pixKey: '12345678909',
  createdAt: new Date().toISOString(),
}

async function customRole(a: FastifyInstance, id: string, name: string, permissions: string[]) {
  await a.db.query('insert into roles (id, name, permissions) values ($1, $2, $3)', [id, `Cargo ${id}`, permissions])
  return loginAs(a, id, { name })
}
async function getKv(a: FastifyInstance, cookie: string, key: string) {
  const r = await api(a, 'GET', `/api/kv/${key}`, { cookie })
  expect(r.statusCode, r.body).toBe(200)
  return r.json() as { value: Row[]; version: number }
}
const putKv = (a: FastifyInstance, cookie: string, key: string, value: unknown, version: number) =>
  api(a, 'PUT', `/api/kv/${key}`, { cookie, body: { value, version } })
async function storedPlain(a: FastifyInstance, key: string): Promise<Row[]> {
  const [r] = await a.db.query<{ value: unknown; value_enc: string | null }>('select value, value_enc from kv_store where key = $1', [key])
  return (r.value_enc ? JSON.parse(a.cipher.decrypt(r.value_enc)) : r.value) as Row[]
}
const auditSince = (a: FastifyInstance, id: number) =>
  a.db.query<Audit>('select id, actor_id, actor_name, action, entity, summary, source from audit_log where id > $1 order by id', [id])
const lastAuditId = async (a: FastifyInstance) =>
  Number((await a.db.query<{ m: string | null }>('select max(id) as m from audit_log'))[0].m ?? 0)

beforeAll(async () => {
  app = await createTestApp()
  daniel = await loginAs(app, 'superadmin', { name: 'Daniel Carius' })
  paulo = await customRole(app, 'pagador', 'Paulo Pagador', ['afiliados-saques.ver', 'afiliados-saques.aprovar'])
  gerente = await customRole(app, 'comissoes', 'Carla Comissões', ['comissoes.ver', 'comissoes.editar'])
  // base gravada pelo Superadmin (como o painel faz na primeira gravação)
  expect((await putKv(app, daniel.cookie, 'afiliados.saques', [WITHDRAWAL], 0)).statusCode).toBe(200)
  expect((await putKv(app, daniel.cookie, 'crescimento.afiliados', [AFFILIATE], 0)).statusCode).toBe(200)
})
afterAll(async () => app.close())

describe('PoC r2 — pagamento de afiliado gravado direto na chave', () => {
  it('aprovador não deve conseguir mudar o valor, escolher quem decidiu e pagar sem auditoria "aprovar" com valor', async () => {
    const before = await lastAuditId(app)
    const cur = await getKv(app, paulo.cookie, 'afiliados.saques')
    const forged = cur.value.map((w) =>
      w.id === 'aw-1'
        ? { ...w, status: 'pago', amount: 48000, decidedBy: 'Daniel Carius', decidedAt: '2026-01-01T12:00:00.000Z', reference: 'E0000' }
        : w,
    )
    const res = await putKv(app, paulo.cookie, 'afiliados.saques', forged, cur.version)
    console.log('[poc] PUT afiliados.saques (Paulo Pagador) ->', res.statusCode)

    const stored = (await storedPlain(app, 'afiliados.saques')).find((w) => w.id === 'aw-1')!
    console.log('[poc] gravado:', JSON.stringify({ amount: stored.amount, status: stored.status, decidedBy: stored.decidedBy, decidedAt: stored.decidedAt, reference: stored.reference }))
    const rows = await auditSince(app, before)
    for (const r of rows) console.log(`[poc] auditoria: ${r.actor_name} · ${r.action} · ${r.entity} — ${r.summary} (source=${r.source})`)

    // comportamento SEGURO esperado: ou o servidor recusa a gravação direta, ou ele mesmo fixa valor/decisor e audita
    if (res.statusCode === 200) {
      expect(stored.amount, 'valor do pedido alterado pelo cliente').toBe(12000)
      expect(stored.decidedBy, 'decisor escolhido pelo cliente').not.toBe('Daniel Carius')
      const approve = rows.find((r) => r.action === 'aprovar' && r.source === 'servidor')
      expect(approve, 'sem linha "aprovar" do servidor para o pagamento').toBeTruthy()
      expect(approve!.summary).toMatch(/120\.00|12\.000/)
    } else {
      expect(res.statusCode).toBeGreaterThanOrEqual(400)
    }
  })

  it('saldo de comissão do afiliado não deve mudar com só "Itens: 1 alterado (af-1)" na auditoria', async () => {
    const before = await lastAuditId(app)
    const cur = await getKv(app, gerente.cookie, 'crescimento.afiliados')
    const next = cur.value.map((a) => (a.id === 'af-1' ? { ...a, balance: 90000 } : a))
    const res = await putKv(app, gerente.cookie, 'crescimento.afiliados', next, cur.version)
    console.log('[poc] PUT crescimento.afiliados (Carla Comissões) ->', res.statusCode)
    const stored = (await storedPlain(app, 'crescimento.afiliados')).find((a) => a.id === 'af-1')!
    console.log('[poc] saldo gravado:', stored.balance)
    const rows = await auditSince(app, before)
    for (const r of rows) console.log(`[poc] auditoria: ${r.actor_name} · ${r.action} · ${r.entity} — ${r.summary} (source=${r.source})`)

    if (res.statusCode === 200) {
      // aceitar a mudança de saldo só faz sentido se a auditoria do servidor disser de quanto para quanto
      expect(rows.some((r) => /balance|saldo/i.test(r.summary)), 'auditoria não diz que o saldo mudou').toBe(true)
    } else {
      expect(res.statusCode).toBeGreaterThanOrEqual(400)
    }
  })
})
