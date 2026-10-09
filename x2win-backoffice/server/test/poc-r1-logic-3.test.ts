// PoC (r1-logic-3): quem tem saques.editar consegue ligar a aprovação automática
// de saques acima do próprio teto de aprovação (ou sem poder aprovar nada).
// Este teste afirma o comportamento SEGURO: deve FALHAR enquanto o problema existir.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, createTestApp, loginAs } from './helpers'

const KEY = '/api/kv/operacao.saques.regras'

let app: FastifyInstance

beforeAll(async () => {
  app = await createTestApp()
})

afterAll(async () => {
  await app.close()
})

async function tryRaiseAutoApprove(cookie: string, amount: number) {
  const g = await api(app, 'GET', KEY, { cookie })
  expect(g.statusCode).toBe(200)
  const { value, version } = g.json() as { value: Record<string, unknown>; version: number }
  const put = await api(app, 'PUT', KEY, {
    cookie,
    body: { value: { ...value, maxPerRequest: amount, autoApproveMax: amount }, version },
  })
  const after = (await api(app, 'GET', KEY, { cookie })).json() as { value: { autoApproveMax: number; maxPerRequest: number } }
  return { status: put.statusCode, body: put.body, after: after.value }
}

describe('poc r1-logic-3: aprovação automática acima do teto do cargo', () => {
  it('Financeiro (teto R$ 5.000) não pode ligar aprovação automática até R$ 1 bilhão', async () => {
    const fin = await loginAs(app, 'financeiro')
    const r = await tryRaiseAutoApprove(fin.cookie, 1_000_000_000)
    console.log('[financeiro] PUT status', r.status, 'stored', JSON.stringify(r.after))
    // comportamento seguro: recusa e regras continuam dentro do teto do cargo
    expect(r.after.autoApproveMax).toBeLessThanOrEqual(5000)
    expect(r.status).toBeGreaterThanOrEqual(400)
  })

  it('cargo com saques.editar e teto 0 (não aprova) não pode ligar aprovação automática', async () => {
    await app.db.query(`insert into roles (id, name, permissions, approval_ceiling_cents) values ($1, $2, $3, $4)`, [
      'so-regras',
      'Só regras',
      ['saques.ver', 'saques.editar'],
      0,
    ])
    const ed = await loginAs(app, 'so-regras')
    const r = await tryRaiseAutoApprove(ed.cookie, 50_000)
    console.log('[teto 0] PUT status', r.status, 'stored', JSON.stringify(r.after))
    expect(r.after.autoApproveMax).toBe(0)
    expect(r.status).toBeGreaterThanOrEqual(400)
  })
})
