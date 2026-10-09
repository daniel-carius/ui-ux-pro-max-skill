// PoC (round 2): operacao.depositos é JSON genérico (sem `domain`). A permissão de gravação
// cai no padrão depositos.editar, que o cargo de sistema Financeiro já tem. O painel só usa
// essa permissão para a reconsulta ao gateway (pendente -> expirado, Depositos.tsx:180), mas
// o servidor aceita qualquer lista: valor, status, FTD, inclusão e remoção de depósitos.
// Asserções do comportamento SEGURO: estes testes FALHAM enquanto o servidor aceitar qualquer conteúdo.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, createTestApp, loginAs } from './helpers'

const KEY = 'operacao.depositos'

function deposit(p: Record<string, unknown>) {
  return {
    playerId: 'p1',
    playerName: 'Jogador Um',
    playerEmail: 'jogador1@x.com',
    gateway: 'PixPay',
    reference: 'E000000001',
    isFirst: false,
    bonusCampaign: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...p,
  }
}

async function storedPlain(app: FastifyInstance, key: string) {
  const row = await app.db.one<{ value: unknown; value_enc: string | null; version: number }>('select value, value_enc, version from kv_store where key = $1', [key])
  if (!row) return null
  return row.value_enc ? JSON.parse(app.cipher.decrypt(row.value_enc)) : row.value
}

describe('operacao.depositos: Financeiro (depositos.editar) reescreve o registro de depósitos', () => {
  let app: FastifyInstance
  let root: { cookie: string }
  let fin: { cookie: string; user: { id: string } }

  beforeAll(async () => {
    app = await createTestApp()
    root = await loginAs(app, 'superadmin')
    const seed = await api(app, 'PUT', `/api/kv/${KEY}`, {
      cookie: root.cookie,
      body: {
        value: [
          deposit({ id: 'd1', amount: 100, status: 'pago', isFirst: true }),
          deposit({ id: 'd2', amount: 5000, status: 'pendente', reference: 'E000000002' }),
          deposit({ id: 'd3', amount: 2000, status: 'pago', reference: 'E000000003' }),
        ],
        version: 0,
      },
    })
    expect(seed.statusCode, seed.body).toBe(200)
    fin = await loginAs(app, 'financeiro', { name: 'Pessoa Financeiro' })
  })
  afterAll(async () => app.close())

  it('Financeiro não pode mudar valor/status, marcar FTD nem apagar depósito pago', async () => {
    const cur = await api(app, 'GET', `/api/kv/${KEY}`, { cookie: fin.cookie })
    expect(cur.statusCode, cur.body).toBe(200)
    const { value, version } = cur.json() as { value: any[]; version: number }
    console.log('[poc] Financeiro GET → 200, versão', version, 'itens', value.map((d) => [d.id, d.amount, d.status]))

    const forged = value
      .filter((d) => d.id !== 'd3')
      .map((d) => {
        if (d.id === 'd1') return { ...d, amount: 100_000, status: 'pendente' }
        if (d.id === 'd2') return { ...d, status: 'pago', isFirst: true }
        return d
      })
    const put = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: fin.cookie, body: { value: forged, version } })
    const stored = (await storedPlain(app, KEY)) as any[]
    const audit = await app.db.query<{ actor_name: string; action: string; entity: string; summary: string }>(
      `select actor_name, action, entity, summary from audit_log where summary like 'operacao.depositos%' order by id`,
    )
    console.log('[poc] Financeiro PUT →', put.statusCode)
    console.log('[poc] gravado:', JSON.stringify(stored.map((d) => [d.id, d.amount, d.status, d.isFirst])))
    console.log('[poc] auditoria:', JSON.stringify(audit))

    expect(put.statusCode).not.toBe(200)
    expect(stored.map((d) => [d.id, d.amount, d.status])).toEqual([
      ['d1', 100, 'pago'],
      ['d2', 5000, 'pendente'],
      ['d3', 2000, 'pago'],
    ])
  })
})
