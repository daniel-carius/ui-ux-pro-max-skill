// Verificação de impacto: "saque aprovado nunca pago" via webhook saque.pago.
// O que conta para o impacto: saque.pago carrega só { id, amount, playerId } (sem chave PIX,
// sem titular, sem CPF). Um processador de PIX não teria com o que pagar: o evento é aviso
// (CRM/marketing, módulo Campanhas), não ordem de pagamento. As falhas ficam visíveis em
// campanhas.webhooks.execucoes e o servidor não guarda nem envia chave PIX em nenhum webhook.
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../src/lib/crypto'
import { processOutboxOnce } from '../src/modules/webhooks/dispatcher'
import { api, createTestApp, loginAs } from './helpers'

let srv: Server
let URL_ = ''
const got: { headers: IncomingHttpHeaders; body: string }[] = []

beforeAll(async () => {
  srv = createServer((req, res) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => {
      got.push({ headers: req.headers, body: b })
      res.writeHead(200)
      res.end('{}')
    })
  })
  URL_ = await new Promise<string>((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`)))
})
afterAll(async () => {
  srv.closeAllConnections()
  await new Promise<void>((r) => srv.close(() => r()))
})

describe('impacto: saque.pago não é a ordem de pagamento PIX', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('o corpo entregue a saque.pago não traz chave PIX nem dados do titular', async () => {
    const adm = await loginAs(app, 'administrador')
    await app.db.query(`insert into webhook_destinations (id, event, url, active, secret_enc) values ($1, 'saque.pago', $2, true, $3)`, [
      newId('wh'),
      `${URL_}/crm`,
      app.cipher.encrypt('segredo-crm-000001'),
    ])
    const id = newId('SQ')
    const pix = '12345678909'
    await app.db.query(
      `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                                risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
       values ($1, 'p1', 'Jogador Teste', 'j@x.com', 70000, 0, 'pendente', 'baixo', 5, '[]'::jsonb, 'CPF', $2, 'E1', now(), now())`,
      [id, app.cipher.encrypt(pix)],
    )
    const r = await api(app, 'POST', `/api/withdrawals/${id}/approve`, { cookie: adm.cookie })
    expect(r.statusCode).toBe(200)
    await processOutboxOnce(app)
    expect(got).toHaveLength(1)
    const body = JSON.parse(got[0].body)
    console.log('[verify] corpo saque.pago entregue:', got[0].body)
    console.log('[verify] chaves de data:', Object.keys(body.data).join(','))
    expect(Object.keys(body.data).sort()).toEqual(['amount', 'id', 'playerId'])
    expect(got[0].body).not.toContain(pix)
    expect(got[0].body).not.toContain('Jogador Teste')
    expect(got[0].body).not.toContain('CPF')
  })
})
