// PoC r1-exposure-3: URLs de destino de webhook (com token no caminho/query) saem completas
// para quem só pode LER (Marketing oficial via estatisticas.ver; ADM via webhooks.ver sem editar).
// O teste afirma o comportamento seguro: deve FALHAR enquanto o problema existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { api, createTestApp, loginAs } from './helpers'

const PATH_TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWx'
const QUERY_TOKEN = 's3cr3tT0k3nValue'
const URL = `https://hooks.example.com/services/T000/B000/${PATH_TOKEN}?token=${QUERY_TOKEN}`

describe('poc r1-exposure-3: URL de webhook com token para não-editores', () => {
  let app: FastifyInstance
  let admin: string
  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app, 'superadmin')).cookie
    const w = await api(app, 'PUT', '/api/kv/campanhas.webhooks.destinos', {
      cookie: admin,
      body: { value: [{ id: 'w1', event: 'saque.pago', url: URL, active: true, secret: 'segredo-forte-123' }], version: 0 },
    })
    expect(w.statusCode).toBe(200)
    // uma execução gravada pelo servidor com a mesma URL
    await app.db.query(
      `insert into webhook_executions (id, event, destination_id, url, status, http_status, duration_ms, payload)
       values ('ex1', 'saque.pago', 'w1', $1, 'sucesso', 200, 100, '{}')`,
      [URL],
    )
  })
  afterAll(async () => {
    await app.close()
  })

  for (const roleId of ['marketing-oficial', 'adm']) {
    it(`${roleId}: GET destinos não revela o token da URL`, async () => {
      const { cookie } = await loginAs(app, roleId, { totp: true })
      const r = await api(app, 'GET', '/api/kv/campanhas.webhooks.destinos', { cookie })
      console.log(`[${roleId}] destinos status=${r.statusCode} body=${r.body}`)
      if (r.statusCode === 200) {
        expect(r.body).not.toContain('segredo-forte-123') // o segredo HMAC já é mascarado
        expect(r.body).not.toContain(PATH_TOKEN)
        expect(r.body).not.toContain(QUERY_TOKEN)
      }
    })

    it(`${roleId}: GET execuções não revela o token da URL`, async () => {
      const { cookie } = await loginAs(app, roleId, { totp: true })
      const r = await api(app, 'GET', '/api/kv/campanhas.webhooks.execucoes', { cookie })
      console.log(`[${roleId}] execucoes status=${r.statusCode} body=${r.body.slice(0, 400)}`)
      if (r.statusCode === 200) {
        expect(r.body).not.toContain(PATH_TOKEN)
        expect(r.body).not.toContain(QUERY_TOKEN)
      }
    })
  }

  it('URL guardada no banco não está em claro', async () => {
    const rows = await app.db.query<{ url: string }>('select url from webhook_destinations')
    console.log(`[db] webhook_destinations.url=${rows.map((r) => r.url).join(',')}`)
    expect(rows.map((r) => r.url).join(',')).not.toContain(PATH_TOKEN)
  })
})
