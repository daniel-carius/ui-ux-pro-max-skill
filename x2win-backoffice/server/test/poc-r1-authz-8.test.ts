// PoC: o autor ('by' / "Lançado por") de um lançamento manual novo vem do cliente.
// Um Suporte consegue gravar uma creditação atribuída a outra pessoa (ex.: o Superadmin).
// Comportamento seguro esperado: o servidor rejeita (4xx) ou grava 'by' com o nome real de quem lançou.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { api, createTestApp, loginAs } from './helpers'

const KEY = 'geral.transacoes'
const put = (app: FastifyInstance, cookie: string, value: unknown, version?: number) =>
  api(app, 'PUT', `/api/kv/${KEY}`, { cookie, body: version === undefined ? { value } : { value, version } })
const get = (app: FastifyInstance, cookie: string) => api(app, 'GET', `/api/kv/${KEY}`, { cookie })

describe('poc-r1-authz-8: autor do lançamento manual forjado pelo cliente', () => {
  let app: FastifyInstance
  let admin: string
  let suporte: string
  let suporteId: string

  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app, 'superadmin', { name: 'Daniel Carius' })).cookie
    const s = await loginAs(app, 'suporte', { name: 'Atendente Suporte' })
    suporte = s.cookie
    suporteId = s.user.id
    const base = [
      { id: 'TX1', at: new Date().toISOString(), playerId: 'p1', playerName: 'Joana', playerEmail: 'j@x.com', type: 'deposito', amount: 100, wallet: 'real', balanceBefore: 0, balanceAfter: 100, gameId: null, gameName: null, providerName: null, reference: 'DEP-1' },
    ]
    expect((await put(app, admin, base)).statusCode).toBe(200)
  })
  afterAll(async () => app.close())

  it('Suporte não consegue atribuir a creditação ao Superadmin', async () => {
    const cur = (await get(app, suporte)).json() as { value: Record<string, unknown>[]; version: number }
    const forged = {
      id: 'TX9',
      at: new Date().toISOString(),
      playerId: 'p1',
      playerName: 'Joana',
      playerEmail: 'j@x.com',
      type: 'credito_manual',
      amount: 4999,
      wallet: 'real',
      balanceBefore: 0, // saldo real era 100: também inventado
      balanceAfter: 4999,
      gameId: null,
      gameName: null,
      providerName: null,
      reference: 'MAN-TX9',
      note: 'Bônus autorizado',
      by: 'Daniel Carius',
    }
    const w = await put(app, suporte, [forged, ...cur.value], cur.version)
    console.log('PUT status', w.statusCode)

    const stored = ((await get(app, admin)).json() as { value: Record<string, unknown>[] }).value.find((t) => t.id === 'TX9')
    console.log('stored TX9 ->', JSON.stringify(stored && { by: stored.by, balanceBefore: stored.balanceBefore, balanceAfter: stored.balanceAfter }))
    const audit = await app.db.one<{ actor_id: string; summary: string }>('select actor_id, summary from audit_log order by id desc limit 1')
    console.log('audit ->', JSON.stringify(audit), 'suporteId =', suporteId)

    // seguro: rejeita, ou grava o autor real
    if (w.statusCode === 200) {
      expect(stored?.by).toBe('Atendente Suporte')
    } else {
      expect(w.statusCode).toBeGreaterThanOrEqual(400)
    }
  })
})
