// PoC (round 2): crescimento.ggr.apuracoes é JSON genérico (sem `domain`), gravável com ggr.apurar,
// que o cargo de sistema Financeiro tem. No painel o ciclo é aberta -> fechada (taxa congelada) ->
// paga (referência do pagamento) e linhas fechadas/pagas nunca são editadas (Ggr.tsx:602, :655).
// O servidor não aplica nada disso: valores de GGR, taxa congelada, quem pagou e a referência de
// uma apuração paga podem ser reescritos, o status pode voltar para "aberta" e a linha pode sumir.
// Asserções do comportamento SEGURO: o teste FALHA enquanto o servidor aceitar qualquer conteúdo.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, createTestApp, loginAs } from './helpers'

const KEY = 'crescimento.ggr.apuracoes'

function settlement(p: Record<string, unknown>) {
  return {
    month: '2026-08',
    providerId: 'prov1',
    providerName: 'Pragmatic Play',
    bets: 1_000_000,
    wins: 900_000,
    ggr: 100_000,
    feePct: 10,
    feeDue: 10_000,
    dueDate: '2026-09-10T15:00:00.000Z',
    closedAt: '2026-09-01T12:00:00.000Z',
    closedBy: 'Daniel Carius',
    paidAt: null,
    paidBy: null,
    paymentRef: null,
    ...p,
  }
}

async function storedPlain(app: FastifyInstance, key: string) {
  const row = await app.db.one<{ value: unknown; value_enc: string | null }>('select value, value_enc from kv_store where key = $1', [key])
  if (!row) return null
  return row.value_enc ? JSON.parse(app.cipher.decrypt(row.value_enc)) : row.value
}

describe('crescimento.ggr.apuracoes: Financeiro (ggr.apurar) reescreve apurações fechadas/pagas', () => {
  let app: FastifyInstance
  let root: { cookie: string }
  let fin: { cookie: string }

  beforeAll(async () => {
    app = await createTestApp()
    root = await loginAs(app, 'superadmin', { name: 'Daniel Carius' })
    const seed = await api(app, 'PUT', `/api/kv/${KEY}`, {
      cookie: root.cookie,
      body: {
        value: [
          settlement({ id: 'ap1', status: 'paga', paidAt: '2026-09-09T12:00:00.000Z', paidBy: 'Daniel Carius', paymentRef: 'TED-1' }),
          settlement({ id: 'ap2', providerId: 'prov2', providerName: 'Evolution', status: 'fechada', ggr: 50_000, bets: 500_000, wins: 450_000, feeDue: 5_000 }),
        ],
        version: 0,
      },
    })
    expect(seed.statusCode, seed.body).toBe(200)
    fin = await loginAs(app, 'financeiro', { name: 'Pessoa Financeiro' })
  })
  afterAll(async () => app.close())

  it('Financeiro não pode reabrir/alterar apuração paga nem apagar apuração fechada', async () => {
    const cur = await api(app, 'GET', `/api/kv/${KEY}`, { cookie: fin.cookie })
    expect(cur.statusCode, cur.body).toBe(200)
    const { value, version } = cur.json() as { value: any[]; version: number }
    console.log('[poc] Financeiro GET → 200, versão', version, JSON.stringify(value.map((s) => [s.id, s.status, s.ggr, s.feeDue, s.paymentRef])))

    const forged = value
      .filter((s) => s.id !== 'ap2')
      .map((s) => (s.id === 'ap1' ? { ...s, ggr: 1, bets: 1, wins: 0, feeDue: 0.1, paymentRef: 'OUTRO', status: 'aberta' } : s))
    const put = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: fin.cookie, body: { value: forged, version } })
    const stored = (await storedPlain(app, KEY)) as any[]
    const audit = await app.db.query<{ actor_name: string; action: string; entity: string; summary: string }>(
      `select actor_name, action, entity, summary from audit_log where summary like 'crescimento.ggr.apuracoes%' order by id`,
    )
    const leftovers = await app.db.query<{ n: number }>(
      `select count(*)::int as n from audit_log where summary like '%100000%' or summary like '%100.000%' or summary like '%TED-1%'`,
    )
    console.log('[poc] Financeiro PUT →', put.statusCode)
    console.log('[poc] gravado:', JSON.stringify(stored.map((s) => [s.id, s.status, s.bets, s.wins, s.ggr, s.feeDue, s.paidBy, s.paymentRef])))
    console.log('[poc] auditoria:', JSON.stringify(audit))
    console.log('[poc] linhas da auditoria com o GGR/referência originais:', leftovers[0]?.n)

    expect(put.statusCode).not.toBe(200)
    expect(stored.map((s) => [s.id, s.status, s.ggr, s.feeDue, s.paymentRef])).toEqual([
      ['ap1', 'paga', 100_000, 10_000, 'TED-1'],
      ['ap2', 'fechada', 50_000, 5_000, null],
    ])
  })
})
