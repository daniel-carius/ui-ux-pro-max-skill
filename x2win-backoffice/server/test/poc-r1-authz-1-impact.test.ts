// Verificação de impacto do PoC r1-authz-1: a reversão de autoexclusão por Suporte
// é aceita (200), mas fica na auditoria com autor e transição. Nenhum código do servidor
// lê o status do jogador para liberar aposta/depósito (dados de jogador ainda são de demonstração).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { api, createTestApp, loginAs } from './helpers'

const KEY = 'geral.jogadores'
describe('PoC r1-authz-1 (impacto)', () => {
  let app: FastifyInstance
  let admin: string
  let suporte: string
  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app)).cookie
    suporte = (await loginAs(app, 'suporte')).cookie
    const w = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: admin, body: { value: [
      { id: 'p1', name: 'Joana', email: 'joana@exemplo.com', status: 'autoexcluido', balanceReal: 10, balanceBonus: 0, coins: 0, tags: [] },
    ] } })
    expect(w.statusCode).toBe(200)
  })
  afterAll(async () => app.close())

  it('aceita a reversão e grava auditoria com autor e transição', async () => {
    const cur = (await api(app, 'GET', `/api/kv/${KEY}`, { cookie: suporte })).json() as { value: { id: string; status: string }[]; version: number }
    const next = structuredClone(cur.value)
    next[0]!.status = 'ativo'
    const w = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: suporte, body: { value: next, version: cur.version } })
    console.log('[put]', w.statusCode)
    const rows = await app.db.query<{ actor_name: string; action: string; summary: string }>(
      "select actor_name, action, summary from audit_log where summary like 'geral.jogadores%' order by id",
    )
    console.log('[audit]', JSON.stringify(rows))
    expect(w.statusCode).toBe(200)
    expect(rows.some((r) => r.summary.includes('status: autoexcluido → ativo'))).toBe(true)
  })
})
