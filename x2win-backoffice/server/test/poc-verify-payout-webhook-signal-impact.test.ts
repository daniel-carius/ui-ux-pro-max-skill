// Verificação de impacto: "saque aprovado nunca pago, sem sinal" (webhook saque.pago).
// Mostra o que o reviewer não considerou: toda tentativa que falha fica visível em
// campanhas.webhooks.execucoes; desligar/excluir o destino é ação auditada de cargo administrativo;
// cargos baixos não mexem nos destinos.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../src/lib/crypto'
import { MAX_ATTEMPTS, processOutboxOnce } from '../src/modules/webhooks/dispatcher'
import { api, createTestApp, loginAs } from './helpers'

let srv: Server
let URL_ = ''
const plan: number[] = []

beforeAll(async () => {
  srv = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.writeHead(plan.shift() ?? 200)
      res.end('{}')
    })
  })
  URL_ = await new Promise<string>((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`)))
})
afterAll(async () => {
  srv.closeAllConnections()
  await new Promise<void>((r) => srv.close(() => r()))
})

async function insertWithdrawal(app: FastifyInstance, amount: number) {
  const id = newId('SQ')
  await app.db.query(
    `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                              risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
     values ($1, 'p1', 'Jogador', 'j@x.com', $2, 0, 'pendente', 'baixo', 5, '[]'::jsonb, 'CPF', $3, 'E1', now(), now())`,
    [id, Math.round(amount * 100), app.cipher.encrypt('12345678909')],
  )
  return id
}

describe('impacto: sinais existentes quando a entrega saque.pago não acontece', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('cada tentativa que falha vira execução "falha" legível em campanhas.webhooks.execucoes', async () => {
    const adm = await loginAs(app, 'administrador')
    const destId = newId('wh')
    await app.db.query(`insert into webhook_destinations (id, event, url, active, secret_enc) values ($1, 'saque.pago', $2, true, $3)`, [
      destId,
      `${URL_}/crm`,
      app.cipher.encrypt('segredo-crm-000001'),
    ])
    const w = await insertWithdrawal(app, 500)
    expect((await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      plan.push(503)
      await app.db.query(`update webhook_outbox set next_attempt_at = now() - interval '1 second' where status = 'pendente'`)
      await processOutboxOnce(app)
    }
    const r = await api(app, 'GET', '/api/kv/campanhas.webhooks.execucoes', { cookie: adm.cookie })
    expect(r.statusCode).toBe(200)
    const execs = (r.json().value as { destinationId?: string; status: string; httpStatus: number; event: string; payload?: string }[]).filter(
      (e) => e.event === 'saque.pago',
    )
    console.log('[verify] execuções saque.pago visíveis no painel:', execs.length, execs.map((e) => `${e.status}/${e.httpStatus}`).join(','))
    expect(execs).toHaveLength(MAX_ATTEMPTS)
    expect(execs.every((e) => e.status === 'falha' && e.httpStatus === 503)).toBe(true)
    // o corpo de cada execução traz o id do saque: dá para ligar a falha ao saque aprovado
    expect(execs.every((e) => JSON.stringify(e).includes(w))).toBe(true)
  })

  it('desligar e excluir o destino são gravados na auditoria imutável com autor e destino', async () => {
    const adm = await loginAs(app, 'administrador')
    const cur = await api(app, 'GET', '/api/kv/campanhas.webhooks.destinos', { cookie: adm.cookie })
    const list = cur.json().value as { id: string; active: boolean }[]
    const off = list.map((d) => ({ ...d, active: false }))
    const p1 = await api(app, 'PUT', '/api/kv/campanhas.webhooks.destinos', { cookie: adm.cookie, body: { value: off, version: cur.json().version } })
    expect(p1.statusCode).toBe(200)
    const p2 = await api(app, 'PUT', '/api/kv/campanhas.webhooks.destinos', { cookie: adm.cookie, body: { value: [], version: p1.json().version } })
    expect(p2.statusCode).toBe(200)
    const rows = await app.db.query<{ actor_id: string; summary: string }>(
      `select actor_id, summary from audit_log where summary like 'Destinos de webhook%' order by id`,
    )
    console.log('[verify] auditoria:', rows.map((r) => `${r.actor_id === adm.user.id ? 'autor=adm' : r.actor_id} | ${r.summary}`))
    expect(rows.some((r) => r.actor_id === adm.user.id && /Alterados: .*ativo/.test(r.summary))).toBe(true)
    expect(rows.some((r) => r.actor_id === adm.user.id && /Removidos: .*Saque pago/.test(r.summary))).toBe(true)
  })

  it('cargos baixos (Financeiro, Marketing oficial, Suporte) não alteram destinos de webhook', async () => {
    for (const role of ['financeiro', 'marketing-oficial', 'suporte']) {
      const u = await loginAs(app, role, { totp: true })
      const r = await api(app, 'PUT', '/api/kv/campanhas.webhooks.destinos', { cookie: u.cookie, body: { value: [], version: 2 } })
      console.log(`[verify] ${role} PUT destinos →`, r.statusCode)
      expect(r.statusCode).toBe(403)
    }
  })
})
