// PoC (verificação independente): afiliados.saques é JSON opaco gravado pelo genericHandler.
// Asserções do comportamento SEGURO: estes testes FALHAM enquanto o servidor aceitar
// qualquer lista (valor, status, decisor, itens novos, apagar tudo) de quem tem
// afiliados-saques.aprovar — inclusive com teto de aprovação 0.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, createTestApp, loginAs } from './helpers'

const KEY = 'afiliados.saques'

type W = Record<string, unknown> & { id: string }

function item(p: Partial<W> & { id: string }): W {
  return {
    affiliateId: 'a1',
    affiliateName: 'Afiliado Um',
    affiliateEmail: 'a1@exemplo.com',
    affiliateType: 'cpa',
    method: 'pix',
    pixKeyType: 'CPF',
    pixKey: '12345678909',
    bank: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    decidedAt: null,
    decidedBy: null,
    reason: null,
    reference: null,
    ...p,
  }
}

async function stored(app: FastifyInstance): Promise<{ list: W[]; version: number; rows: number }> {
  const rows = await app.db.query<{ value: unknown; value_enc: string | null; version: number }>(
    'select value, value_enc, version from kv_store where key = $1',
    [KEY],
  )
  const r = rows[0]
  const list = (r.value_enc ? JSON.parse(app.cipher.decrypt(r.value_enc)) : r.value) as W[]
  return { list, version: r.version, rows: rows.length }
}

async function serverAudit(app: FastifyInstance) {
  return (await app.db.query<{ summary: string }>(`select summary from audit_log where summary like $1 order by id`, [`${KEY}%`])).map((a) => a.summary)
}

describe('afiliados.saques: decisões de pagamento sem regra no servidor', () => {
  let app: FastifyInstance
  let root: { cookie: string }
  let approver: { cookie: string }

  beforeAll(async () => {
    app = await createTestApp()
    root = await loginAs(app, 'superadmin', { name: 'Daniel Carius' })

    const seed = [
      item({ id: 'w1', amount: 300, status: 'pendente' }),
      item({ id: 'w2', amount: 800, status: 'recusado', decidedAt: '2026-09-02T10:00:00.000Z', decidedBy: 'Daniel Carius', reason: 'Fraude' }),
    ]
    const s = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: root.cookie, body: { value: seed, version: 0 } })
    expect(s.statusCode, s.body).toBe(200)

    const rolesRes = await api(app, 'GET', '/api/kv/cargos.lista', { cookie: root.cookie })
    const roles = rolesRes.json() as { value: { id: string; name: string }[]; version: number }
    const add = await api(app, 'PUT', '/api/kv/cargos.lista', {
      cookie: root.cookie,
      body: {
        version: roles.version,
        value: [
          ...roles.value,
          {
            id: 'novo-aprovador',
            name: 'AprovadorAfil',
            description: '',
            permissions: ['afiliados-saques.ver', 'afiliados-saques.aprovar'],
            require2fa: false,
            approvalCeiling: 0, // "Não aprova saques"
          },
        ],
      },
    })
    expect(add.statusCode, add.body).toBe(200)
    const role = (add.json().value as { id: string; name: string; approvalCeiling: number | null }[]).find((r) => r.name === 'AprovadorAfil')!
    console.log('[poc] cargo criado:', JSON.stringify(role))
    approver = await loginAs(app, role.id, { name: 'Aprovador Afil' })
  })
  afterAll(async () => app.close())

  it('recusa valor alterado, decisor forjado, recusado→pago e pagamento inventado', async () => {
    const cur = (await api(app, 'GET', `/api/kv/${KEY}`, { cookie: approver.cookie })).json() as { value: W[]; version: number }
    const forged = cur.value.map((w) =>
      w.id === 'w1'
        ? { ...w, amount: 250000, status: 'pago', decidedBy: 'Daniel Carius', decidedAt: '2026-01-01', reference: 'E-FORJADO' }
        : w.id === 'w2'
          ? { ...w, amount: 9999, status: 'pago', reason: null }
          : w,
    )
    forged.push(item({ id: 'w3', affiliateId: 'a9', affiliateName: 'Afiliado Nove', amount: 1000000, status: 'pago', decidedBy: 'Daniel Carius', decidedAt: '2026-01-01', reference: 'E-INVENTADO' }))

    const put = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: approver.cookie, body: { value: forged, version: cur.version } })
    const after = await stored(app)
    console.log('[poc] PUT forjado ->', put.statusCode)
    console.log('[poc] gravado:', JSON.stringify(after.list.map((w) => ({ id: w.id, amount: w.amount, status: w.status, decidedBy: w.decidedBy, decidedAt: w.decidedAt, reason: w.reason, reference: w.reference }))))
    console.log('[poc] auditoria do servidor:', JSON.stringify(await serverAudit(app)))

    expect(put.statusCode).toBeGreaterThanOrEqual(400)
    const w1 = after.list.find((w) => w.id === 'w1')!
    const w2 = after.list.find((w) => w.id === 'w2')!
    expect(w1.amount).toBe(300)
    expect(w1.decidedBy).not.toBe('Daniel Carius')
    expect(w2.status).toBe('recusado')
    expect(after.list.some((w) => w.id === 'w3')).toBe(false)
  })

  it('recusa apagar o histórico de pagamentos', async () => {
    const cur = (await api(app, 'GET', `/api/kv/${KEY}`, { cookie: approver.cookie })).json() as { value: W[]; version: number }
    const put = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: approver.cookie, body: { value: [], version: cur.version } })
    const after = await stored(app)
    console.log('[poc] PUT [] ->', put.statusCode, '| lista:', JSON.stringify(after.list), '| linhas kv_store:', after.rows, '| versão:', after.version)
    console.log('[poc] auditoria do servidor:', JSON.stringify(await serverAudit(app)))

    expect(put.statusCode).toBeGreaterThanOrEqual(400)
    expect(after.list.length).toBeGreaterThan(0)
  })

  it('controle: saque de jogador acima do teto do Financeiro é recusado pelo servidor', async () => {
    const fin = await loginAs(app, 'financeiro', { totp: true })
    await app.db.query(
      `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                                risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
       values ('s1', 'p1', 'Jogador', 'j@exemplo.com', 1000000, 0, 'pendente', 'baixo', 1, '[]'::jsonb, 'CPF', $1, 'E1', now(), now())`,
      [app.cipher.encrypt('12345678909')],
    )
    const r = await api(app, 'POST', '/api/withdrawals/s1/approve', { cookie: fin.cookie })
    console.log('[poc] controle saque jogador R$ 10.000 (Financeiro) ->', r.statusCode, r.body)
    expect(r.statusCode).toBe(403)
    expect(r.json().error.code).toBe('teto_excedido')
  })
})
