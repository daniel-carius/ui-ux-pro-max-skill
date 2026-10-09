// PoC (verificação de impacto): saldo em geral.jogadores alterado direto por
// usuarios.editar (Suporte), sem lançamento em geral.transacoes.
// Mede: (1) se a escrita passa; (2) o que fica na auditoria; (3) se o teto de
// R$ 5.000 do extrato é um limite agregado ou só por lançamento; (4) se algo no
// servidor consome o saldo (saques).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { api, createTestApp, loginAs } from './helpers'

const put = (app: FastifyInstance, cookie: string, key: string, value: unknown, version?: number) =>
  api(app, 'PUT', `/api/kv/${key}`, { cookie, body: version === undefined ? { value } : { value, version } })
const get = (app: FastifyInstance, cookie: string, key: string) => api(app, 'GET', `/api/kv/${key}`, { cookie })

describe('poc-verify-balance-no-ledger-impact', () => {
  let app: FastifyInstance
  let admin: string
  let suporte: string
  let suporteId: string
  const players = [{ id: 'p1', name: 'Joana', email: 'joana@exemplo.com', status: 'ativo', balanceReal: 10, balanceBonus: 0, coins: 0, tags: [] }]
  const baseTx = [
    { id: 'TX1', at: new Date().toISOString(), playerId: 'p1', playerName: 'Joana', playerEmail: 'j@x.com', type: 'deposito', amount: 10, wallet: 'real', balanceBefore: 0, balanceAfter: 10, gameId: null, gameName: null, providerName: null, reference: 'DEP-1' },
  ]

  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app)).cookie
    const s = await loginAs(app, 'suporte')
    suporte = s.cookie
    suporteId = s.user.id
    expect((await put(app, admin, 'geral.jogadores', players)).statusCode).toBe(200)
    expect((await put(app, admin, 'geral.transacoes', baseTx)).statusCode).toBe(200)
  })
  afterAll(async () => app.close())

  it('(1)+(2) escrita direta passa; auditoria guarda autor, IP e saldo antes/depois', async () => {
    const cur = (await get(app, suporte, 'geral.jogadores')).json() as { value: Record<string, unknown>[]; version: number }
    const next = cur.value.map((p) => (p.id === 'p1' ? { ...p, balanceReal: 999_999_999 } : p))
    const r = await put(app, suporte, 'geral.jogadores', next, cur.version)
    console.log('[direct write]', r.statusCode)
    const a = await app.db.one<{ actor_id: string; ip: string; action: string; entity: string; summary: string }>(
      'select actor_id, ip, action, entity, summary from audit_log order by id desc limit 1',
    )
    console.log('[audit row]', JSON.stringify(a))
    expect(r.statusCode).toBe(200)
    expect(a.actor_id).toBe(suporteId)
    expect(a.summary).toContain('saldo real: R$ 10,00 → R$ 999.999.999,00')
  })

  it('(3) caminho "legítimo": 50 créditos de R$ 5.000 por gravação, repetível; balanceAfter não é conferido', async () => {
    let total = 0
    for (let round = 0; round < 4; round++) {
      const cur = (await get(app, suporte, 'geral.transacoes')).json() as { value: Record<string, unknown>[]; version: number }
      const fresh = Array.from({ length: 50 }, (_, i) => ({
        id: `TXR${round}-${i}`, at: new Date().toISOString(), playerId: 'p1', playerName: 'Joana', playerEmail: 'j@x.com',
        type: 'credito_manual', amount: 5000, wallet: 'real',
        // valores arbitrários: o servidor não confere contra o saldo do jogador
        balanceBefore: 1, balanceAfter: 123_456_789,
        gameId: null, gameName: null, providerName: null, reference: `MAN-${round}-${i}`, note: 'Ajuste', by: 'Suporte',
      }))
      const r = await put(app, suporte, 'geral.transacoes', [...cur.value, ...fresh], cur.version)
      expect(r.statusCode).toBe(200)
      total += 50 * 5000
    }
    console.log('[ledger credits accepted for Suporte in 4 PUTs, BRL]', total)
    expect(total).toBe(1_000_000)
  })
})
