// PoC (reprodução): instalação nova, a leitura de campanhas.webhooks.destinos falha uma vez (502 do nginx,
// 429, queda de rede). O painel em modo API (src/lib/store.ts fetchKey -> 'failed'; materialize usa o
// seed e apaga a versão) mostra seedWebhookDestinations() e, na primeira edição (desligar o destino
// leadflow), envia o seed inteiro num PUT SEM versão. Corpo abaixo = o PUT capturado no Playwright
// contra o painel real (VITE_API_MODE=1). O servidor aceita (current=0, sem linhas -> exists=false) e
// passa a enfileirar saque.pago/rejeitado para hooks.x2win-crm.com (domínio de terceiro).
// Afirma o comportamento seguro: deve FALHAR enquanto o problema existir.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, createTestApp, loginAs } from './helpers'

const created = '2026-07-11T23:04:13.771Z'
// exatamente o que o painel enviou (src/domain/webhooks.ts seedWebhookDestinations, wh5 desligado pela pessoa)
const PANEL_PUT_BODY = {
  value: [
    { id: 'wh1', event: 'saque.solicitado', url: 'https://hooks.x2win-crm.com/in/saques', active: true, secret: 'DEMO-hmac-1f9a2c', createdAt: created },
    { id: 'wh2', event: 'saque.pago', url: 'https://hooks.x2win-crm.com/in/saques', active: true, secret: 'DEMO-hmac-8b2d4f', createdAt: created },
    { id: 'wh3', event: 'saque.rejeitado', url: 'https://hooks.x2win-crm.com/in/saques', active: true, secret: 'DEMO-hmac-3c5e7a', createdAt: created },
    { id: 'wh4', event: 'saque.expirado', url: 'https://hooks.x2win-crm.com/in/saques', active: true, secret: 'DEMO-hmac-6d8f1b', createdAt: created },
    { id: 'wh5', event: 'deposito.primeiro', url: 'https://api.leadflow.app/v1/ftd/a8c3f1d92e7b', active: false, secret: 'DEMO-hmac-9e1a3c', createdAt: created },
  ],
}

const THIRD_PARTY = /hooks\.x2win-crm\.com|api\.leadflow\.app/

describe('poc-r2-api-mode-seed-fallback-3', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('edição feita depois de uma leitura que falhou não pode gravar os destinos de demonstração como reais', async () => {
    const root = await loginAs(app, 'superadmin', { name: 'Admin PoC' })

    // 1) instalação nova: a chave sempre responde stored:true, lista vazia, versão 0
    const get = await api(app, 'GET', '/api/kv/campanhas.webhooks.destinos', { cookie: root.cookie })
    console.log(`[poc] GET destinos (instalação nova) -> ${get.statusCode} ${get.body}`)

    // 2) o painel (leitura falhou -> seed, versão apagada) envia o seed sem versão
    const put = await api(app, 'PUT', '/api/kv/campanhas.webhooks.destinos', { cookie: root.cookie, body: PANEL_PUT_BODY })
    console.log(`[poc] PUT destinos sem versão -> ${put.statusCode}`)

    const rows = await app.db.query<{ id: string; event: string; url: string; active: boolean; secret_enc: string }>(
      'select id, event, url, active, secret_enc from webhook_destinations order by id',
    )
    console.log(
      `[poc] webhook_destinations: ${JSON.stringify(rows.map((r) => ({ id: r.id, event: r.event, url: r.url, active: r.active, secret: app.cipher.decrypt(r.secret_enc) })))}`,
    )

    // 3) saque real aprovado/rejeitado depois disso
    for (const [id, action] of [
      ['SQ-POC-1', 'approve'],
      ['SQ-POC-2', 'reject'],
    ] as const) {
      await app.db.query(
        `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, status, risk_level, risk_score, pix_key_type, pix_key_enc, reference, created_at, updated_at)
         values ($1, 'p1', 'J', 'j@x.com', 25050, 'pendente', 'baixo', 1, 'CPF', $2, 'E1', now(), now())`,
        [id, app.cipher.encrypt('12345678909')],
      )
      const r = await api(app, 'POST', `/api/withdrawals/${id}/${action}`, {
        cookie: root.cookie,
        body: action === 'reject' ? { reason: 'Documento divergente do titular' } : undefined,
      })
      console.log(`[poc] POST /api/withdrawals/${id}/${action} -> ${r.statusCode}`)
    }
    const outbox = await app.db.query<{ event: string; url: string; payload: unknown }>(
      `select o.event, d.url, o.payload from webhook_outbox o join webhook_destinations d on d.id = o.destination_id order by o.id`,
    )
    console.log(`[poc] webhook_outbox: ${JSON.stringify(outbox)}`)

    // comportamento seguro: nenhum destino de demonstração (domínio de terceiro, segredo público no bundle)
    // vira destino de produção, e nenhum evento real de saque é enfileirado para ele
    expect(rows.filter((r) => THIRD_PARTY.test(r.url)), 'destinos de demonstração gravados como reais').toEqual([])
    expect(outbox.filter((o) => THIRD_PARTY.test(o.url)), 'eventos reais de saque enfileirados para domínio de terceiro').toEqual([])
  })
})
