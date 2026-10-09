// PoC (verificação): saldo do jogador (geral.jogadores) pode ser posto em qualquer
// valor por usuarios.editar (Suporte), sem lançamento no extrato e sem teto.
// O primeiro teste afirma o comportamento SEGURO e falha enquanto o problema existir.
// Os demais só medem o contexto (teto do extrato por lançamento, auditoria).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { api, createTestApp, loginAs } from './helpers'

const put = (app: FastifyInstance, cookie: string, key: string, value: unknown, version?: number) =>
  api(app, 'PUT', `/api/kv/${key}`, { cookie, body: version === undefined ? { value } : { value, version } })
const get = (app: FastifyInstance, cookie: string, key: string) => api(app, 'GET', `/api/kv/${key}`, { cookie })

describe('poc-r1-logic-2: saldo do jogador sem teto e sem extrato', () => {
  let app: FastifyInstance
  let admin: string
  let suporte: string
  const players = [
    { id: 'p1', name: 'Joana', email: 'joana@exemplo.com', status: 'ativo', balanceReal: 10, balanceBonus: 0, coins: 0, tags: [] },
  ]
  const baseTx = [
    { id: 'TX1', at: new Date().toISOString(), playerId: 'p1', playerName: 'Joana', playerEmail: 'j@x.com', type: 'deposito', amount: 10, wallet: 'real', balanceBefore: 0, balanceAfter: 10, gameId: null, gameName: null, providerName: null, reference: 'DEP-1' },
  ]

  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app)).cookie
    suporte = (await loginAs(app, 'suporte')).cookie
    expect((await put(app, admin, 'geral.jogadores', players)).statusCode).toBe(200)
    expect((await put(app, admin, 'geral.transacoes', baseTx)).statusCode).toBe(200)
  })
  afterAll(async () => app.close())

  it('Suporte NÃO deveria pôr o saldo real em R$ 999.999.999 sem lançamento no extrato', async () => {
    const cur = (await get(app, suporte, 'geral.jogadores')).json() as { value: Record<string, unknown>[]; version: number }
    const next = cur.value.map((p) => (p.id === 'p1' ? { ...p, balanceReal: 999_999_999 } : p))
    const r = await put(app, suporte, 'geral.jogadores', next, cur.version)
    console.log('[balance 10 -> 999999999]', r.statusCode, r.body.slice(0, 200))
    const ledger = (await get(app, admin, 'geral.transacoes')).json() as { value: unknown[] }
    console.log('[ledger entries after balance write]', ledger.value.length)
    const audit = await app.db.one<{ action: string; summary: string }>('select action, summary from audit_log order by id desc limit 1')
    console.log('[audit]', JSON.stringify(audit))
    expect(r.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('contexto: o teto do extrato é por lançamento — 50 créditos de R$ 5.000 numa só gravação', async () => {
    const cur = (await get(app, suporte, 'geral.transacoes')).json() as { value: Record<string, unknown>[]; version: number }
    const fresh = Array.from({ length: 50 }, (_, i) => ({
      id: `TXP${i}`, at: new Date().toISOString(), playerId: 'p1', playerName: 'Joana', playerEmail: 'j@x.com',
      type: 'credito_manual', amount: 5000, wallet: 'real', balanceBefore: 10, balanceAfter: 5010,
      gameId: null, gameName: null, providerName: null, reference: `MAN-TXP${i}`, note: 'Ajuste', by: 'Suporte',
    }))
    const r = await put(app, suporte, 'geral.transacoes', [...cur.value, ...fresh], cur.version)
    console.log('[ledger 50x5000 by Suporte]', r.statusCode, r.body.slice(0, 120))
    expect(r.statusCode).toBe(200)
  })
})
