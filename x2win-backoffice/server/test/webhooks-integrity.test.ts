// Integridade dos destinos de webhook (regressões das revisões de segurança):
//  - r1-exposure-3: endereço do destino (token no caminho/query) cifrado em repouso, só o host em claro; execuções
//    gravadas com o token mascarado; endereço completo só pela rota de revelar (webhooks.editar, auditada);
//  - r2 webhooks redirect: trocar a origem (esquema/host/porta) ou o evento de um destino exige segredo novo (o
//    segredo de produção nunca segue para outro lugar); entregas pendentes não seguem o endereço/evento novo
//    ('falhou', "Destino alterado"), nem as reservadas pelo disparador no meio da troca; a auditoria diz o host e o
//    evento antigos e novos; o envio de teste usa o evento webhook.teste, nunca o envelope do evento real;
//  - r3 forged mask: só a máscara EXATA do segredo gravado mantém o segredo ("n3w***..." → 400);
//  - r3 consistent snapshot: GET da lista com versão e dados do mesmo instante (salvar a partir dele nunca desfaz
//    em silêncio a gravação de outra pessoa);
//  - migração 003: excluir um destino não apaga as entregas da fila (ficam 'falhou', "Destino removido").
import { createHmac } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/db'
import { newId } from '../src/lib/crypto'
import { maskSecret } from '../src/lib/mask'
import { enqueueWebhook, MAX_ATTEMPTS, processOutboxOnce } from '../src/modules/webhooks/dispatcher'
import { destinationUrl, type DestinationRow } from '../src/modules/webhooks/kv'
import { api, createTestApp, loginAs } from './helpers'

// ---------- receptores locais: processador legítimo e host de outra pessoa ----------

interface Hit {
  path: string
  headers: IncomingHttpHeaders
  body: string
}
const procHits: Hit[] = []
const procReplies: number[] = []
const evilHits: Hit[] = []
let proc: Server
let evil: Server
let PROC = ''
let EVIL = ''

function sink(store: Hit[], replies?: number[]) {
  return createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      store.push({ path: req.url ?? '', headers: req.headers, body })
      res.writeHead(replies?.shift() ?? 200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
}
const listen = (s: Server) => new Promise<string>((r) => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)))
const signedWith = (h: Hit, secret: string) =>
  h.headers['x-x2w-signature'] === `sha256=${createHmac('sha256', secret).update(`${h.headers['x-x2w-timestamp']}.${h.body}`).digest('hex')}`

beforeAll(async () => {
  proc = sink(procHits, procReplies)
  evil = sink(evilHits)
  PROC = await listen(proc)
  EVIL = await listen(evil)
})
afterAll(async () => {
  for (const s of [proc, evil]) {
    s.closeAllConnections()
    await new Promise<void>((r) => s.close(() => r()))
  }
})
beforeEach(() => {
  procHits.length = 0
  procReplies.length = 0
  evilHits.length = 0
})

// ---------- utilitários ----------

const KEY = 'campanhas.webhooks.destinos'
type Dest = { id: string; event: string; url: string; active: boolean; secret: string }

async function newWithdrawal(app: FastifyInstance, amount = 100) {
  const id = newId('SQ')
  await app.db.query(
    `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                              risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
     values ($1, $2, 'Jogadora Teste', 'jt@exemplo.com', $3, 0, 'pendente', 'baixo', 1, '[]'::jsonb, 'CPF', $4, 'REF', now(), now())`,
    [id, newId('pl'), Math.round(amount * 100), app.cipher.encrypt('52998224725')],
  )
  return id
}

async function getList(app: FastifyInstance, cookie: string) {
  const r = await api(app, 'GET', `/api/kv/${KEY}`, { cookie })
  expect(r.statusCode, r.body).toBe(200)
  return r.json() as { value: Dest[]; version: number }
}

const putList = (app: FastifyInstance, cookie: string, value: unknown[], version: number) => api(app, 'PUT', `/api/kv/${KEY}`, { cookie, body: { value, version } })

async function edit(app: FastifyInstance, cookie: string, id: string, patch: Partial<Dest>) {
  const cur = await getList(app, cookie)
  return putList(app, cookie, cur.value.map((d) => (d.id === id ? { ...d, ...patch } : d)), cur.version)
}

const outbox = (app: FastifyInstance) =>
  app.db.query<{ id: number; status: string; last_error: string | null; destination_id: string | null; payload: { data: { id: string } } }>(
    'select * from webhook_outbox order by id',
  )
const lastWebhookAudit = async (app: FastifyInstance) =>
  (await app.db.one<{ summary: string }>(`select summary from audit_log where summary like 'Destinos de webhook%' order by id desc limit 1`))?.summary ?? ''
const dueNow = (app: FastifyInstance) => app.db.query(`update webhook_outbox set next_attempt_at = now() - interval '1 second' where status = 'pendente'`)
const host = (url: string) => new URL(url).host

// ===========================================================================
// r1-exposure-3: endereço cifrado em repouso, execuções mascaradas, revelar auditado
// ===========================================================================

describe('endereço do destino com token: cifrado no banco, mascarado para quem não edita (r1-exposure-3)', () => {
  const PATH_TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWx'
  const QUERY_TOKEN = 's3cr3tT0k3nValue'
  let app: FastifyInstance
  let admin: Awaited<ReturnType<typeof loginAs>>
  let url = ''

  beforeAll(async () => {
    app = await createTestApp()
    url = `${PROC}/services/T000/B000/${PATH_TOKEN}?token=${QUERY_TOKEN}`
    admin = await loginAs(app, 'superadmin', { name: 'Ana Admin' })
    const w = await putList(app, admin.cookie, [{ id: 'w1', event: 'saque.pago', url, active: true, secret: 'segredo-forte-123' }], 0)
    expect(w.statusCode, w.body).toBe(200)
    // uma execução real (envio de teste) para o mesmo endereço
    expect((await api(app, 'POST', '/api/webhooks/destinations/w1/test', { cookie: admin.cookie })).statusCode).toBe(200)
  })
  afterAll(async () => app.close())

  it('banco: endereço cifrado (nada do token em claro), host em claro; execução gravada com o token mascarado', async () => {
    const rows = await app.db.query<DestinationRow>('select * from webhook_destinations')
    expect(rows).toHaveLength(1)
    expect(rows[0].url).toBeNull()
    expect(rows[0].host).toBe(host(PROC))
    expect(JSON.stringify(rows)).not.toContain(PATH_TOKEN)
    expect(JSON.stringify(rows)).not.toContain(QUERY_TOKEN)
    expect(destinationUrl(rows[0], app.cipher)).toBe(url)
    const execs = await app.db.query<{ url: string }>('select url from webhook_executions')
    expect(execs.map((e) => e.url)).toEqual([`${PROC}/services/T000/B000/AbCd****?token=****`])
  })

  for (const roleId of ['marketing-oficial', 'adm']) {
    it(`${roleId}: destinos e execuções sem o token (máscara de hoje para quem não edita)`, async () => {
      const { cookie } = await loginAs(app, roleId, { totp: true })
      for (const key of ['campanhas.webhooks.destinos', 'campanhas.webhooks.execucoes']) {
        const r = await api(app, 'GET', `/api/kv/${key}`, { cookie })
        expect(r.statusCode, key).toBe(200)
        expect(r.body).not.toContain(PATH_TOKEN)
        expect(r.body).not.toContain(QUERY_TOKEN)
        expect(r.body).not.toContain('segredo-forte-123')
        expect(r.json().value[0].url).toContain(host(PROC))
      }
    })
  }

  it('quem edita webhooks continua lendo o endereço completo na chave (e regrava sem perder nada)', async () => {
    const cur = await getList(app, admin.cookie)
    expect(cur.value[0].url).toBe(url)
    const again = await putList(app, admin.cookie, cur.value, cur.version)
    expect(again.statusCode, again.body).toBe(200)
    const [row] = await app.db.query<DestinationRow>('select * from webhook_destinations')
    expect(destinationUrl(row, app.cipher)).toBe(url)
  })

  it('POST /destinations/:id/reveal: webhooks.editar recebe { url }, auditado sem o token; demais cargos 403; 404; 401; no-store', async () => {
    const r = await api(app, 'POST', '/api/webhooks/destinations/w1/reveal', { cookie: admin.cookie, ip: '10.4.4.4' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ url })
    expect(String(r.headers['cache-control'])).toContain('no-store')
    const audit = await app.db.one<{ action: string; actor_id: string; entity: string; summary: string; ip: string }>(
      `select * from audit_log where action = 'revelar' order by id desc limit 1`,
    )
    expect(audit).toMatchObject({ actor_id: admin.user.id, entity: 'Webhook Saque pago', ip: '10.4.4.4' })
    expect(audit?.summary).toContain(host(PROC))
    expect(audit?.summary).not.toContain(PATH_TOKEN)
    expect(audit?.summary).not.toContain(QUERY_TOKEN)

    for (const roleId of ['marketing-oficial', 'adm', 'financeiro']) {
      const { cookie } = await loginAs(app, roleId, { totp: true })
      const denied = await api(app, 'POST', '/api/webhooks/destinations/w1/reveal', { cookie })
      expect(denied.statusCode, roleId).toBe(403)
      expect(denied.body).not.toContain(PATH_TOKEN)
    }
    expect((await api(app, 'POST', '/api/webhooks/destinations/nao-existe/reveal', { cookie: admin.cookie })).statusCode).toBe(404)
    expect((await api(app, 'POST', '/api/webhooks/destinations/w1/reveal')).statusCode).toBe(401)
    expect(await app.db.query(`select id from audit_log where action = 'revelar'`)).toHaveLength(1)
  })

  it('linhas antigas (antes da migração 003) são cifradas/mascaradas na subida da API', async () => {
    const fresh = await createTestApp()
    try {
      const legacy = `https://hooks.exemplo.com/in/${PATH_TOKEN}?token=${QUERY_TOKEN}`
      await fresh.db.query(`insert into webhook_destinations (id, event, url, active, secret_enc) values ('old1', 'saque.pago', $1, true, $2)`, [
        legacy,
        fresh.cipher.encrypt('segredo-antigo-123'),
      ])
      await fresh.db.query(
        `insert into webhook_executions (id, event, destination_id, url, status, http_status, duration_ms, payload)
         values ('exold', 'saque.pago', 'old1', $1, 'sucesso', 200, 100, '{}'), ('exok', 'saque.pago', 'old1', 'https://a.com/in', 'sucesso', 200, 100, '{}')`,
        [legacy],
      )
      await fresh.ready()
      const [row] = await fresh.db.query<DestinationRow>('select * from webhook_destinations')
      expect(row).toMatchObject({ url: null, host: 'hooks.exemplo.com' })
      expect(destinationUrl(row, fresh.cipher)).toBe(legacy)
      const execs = await fresh.db.query<{ id: string; url: string }>('select id, url from webhook_executions order by id')
      expect(execs).toEqual([
        { id: 'exok', url: 'https://a.com/in' },
        { id: 'exold', url: 'https://hooks.exemplo.com/in/AbCd****?token=****' },
      ])
    } finally {
      await fresh.close()
    }
  })
})

// ===========================================================================
// r2 webhooks redirect + r3 forged mask
// ===========================================================================

describe('troca de URL/evento de destino: segredo de produção não segue, fila não segue (r2 webhooks redirect)', () => {
  const S_PAGO = 'prod-hmac-pagar-7f3a9c2e'
  const S_ESTORNO = 'prod-hmac-estornar-1b8d4e6f'
  let app: FastifyInstance
  let adm: Awaited<ReturnType<typeof loginAs>>
  const pagoId = 'pago'
  const estornoId = 'estorno'

  beforeAll(async () => {
    app = await createTestApp()
    const sa = await loginAs(app, 'superadmin')
    const created = await putList(
      app,
      sa.cookie,
      [
        { id: pagoId, event: 'saque.pago', url: `${PROC}/pix/pagar`, active: true, secret: S_PAGO },
        { id: estornoId, event: 'saque.rejeitado', url: `${PROC}/pix/estornar`, active: true, secret: S_ESTORNO },
      ],
      0,
    )
    expect(created.statusCode, created.body).toBe(200)
    adm = await loginAs(app, 'administrador', { name: 'Adm Webhooks' })
  })
  afterAll(async () => app.close())

  it('passo A: outra origem com o segredo mascarado → 400 e nada muda; com segredo novo → a fila antiga não segue, novos eventos vão assinados com o segredo novo; auditoria com host antigo → novo', async () => {
    // saque aprovado com o processador fora (503): item pendente para nova tentativa
    const w1 = await newWithdrawal(app, 1500)
    expect((await api(app, 'POST', `/api/withdrawals/${w1}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    procReplies.push(503)
    await processOutboxOnce(app)
    expect((await outbox(app)).map((o) => o.status)).toEqual(['pendente'])

    // GET (segredo mascarado) + PUT só com a URL trocada para outro host/porta
    const masked = await edit(app, adm.cookie, pagoId, { url: `${EVIL}/coleta` })
    expect(masked.statusCode).toBe(400)
    expect(masked.json().error).toMatchObject({ code: 'dados_invalidos', message: 'O destino mudou: digite um novo segredo.', details: { id: pagoId, field: 'secret' } })
    // trocar só o esquema/porta também é outra origem
    expect((await edit(app, adm.cookie, pagoId, { url: PROC.replace('http://127.0.0.1', 'http://localhost') + '/pix/pagar' })).statusCode).toBe(400)
    const [row] = await app.db.query<DestinationRow>('select * from webhook_destinations where id = $1', [pagoId])
    expect(destinationUrl(row, app.cipher)).toBe(`${PROC}/pix/pagar`)
    expect((await outbox(app)).map((o) => o.status)).toEqual(['pendente'])

    // com segredo novo digitado: aceito
    const NEW = 'segredo-novo-do-destino-0099'
    const moved = await edit(app, adm.cookie, pagoId, { url: `${EVIL}/coleta`, secret: NEW })
    expect(moved.statusCode, moved.body).toBe(200)
    const items = await outbox(app)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ status: 'falhou', last_error: 'Destino alterado', destination_id: pagoId })
    const audit = await lastWebhookAudit(app)
    expect(audit).toContain(`endereço ${host(PROC)} → ${host(EVIL)}`)
    expect(audit).toContain('segredo')
    expect(audit).toContain('1 entrega pendente cancelada')

    // a nova tentativa do saque antigo não sai; um saque novo vai ao destino novo com o segredo novo
    await dueNow(app)
    const w2 = await newWithdrawal(app, 2500)
    expect((await api(app, 'POST', `/api/withdrawals/${w2}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    await processOutboxOnce(app)
    expect(evilHits.map((h) => JSON.parse(h.body).data.id)).toEqual([w2])
    expect(evilHits.filter((h) => signedWith(h, S_PAGO))).toEqual([])
    expect(signedWith(evilHits[0], NEW)).toBe(true)
    expect(procHits).toHaveLength(1) // só a tentativa de antes da troca (503)
  })

  it('mesma origem (só o caminho muda) com o segredo mascarado: mantém o segredo, mas as pendentes não seguem o caminho novo', async () => {
    await app.db.query('delete from webhook_outbox')
    await edit(app, adm.cookie, pagoId, { url: `${PROC}/pix/pagar`, secret: 'segredo-de-volta-ao-processador' })
    const w = await newWithdrawal(app, 700)
    expect((await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    const r = await edit(app, adm.cookie, pagoId, { url: `${PROC}/pix/pagar-v2` })
    expect(r.statusCode, r.body).toBe(200)
    expect((await outbox(app))[0]).toMatchObject({ status: 'falhou', last_error: 'Destino alterado' })
    const audit = await lastWebhookAudit(app)
    expect(audit).toContain(`${pagoId} (endereço; 1 entrega pendente cancelada)`)
    await processOutboxOnce(app)
    expect(procHits).toHaveLength(0)
    const [row] = await app.db.query<DestinationRow>('select * from webhook_destinations where id = $1', [pagoId])
    expect(app.cipher.decrypt(row.secret_enc)).toBe('segredo-de-volta-ao-processador')
  })

  it('passo B: envio de teste usa o evento webhook.teste (cabeçalho e corpo), nunca o envelope saque.pago', async () => {
    const r = await api(app, 'POST', `/api/webhooks/destinations/${pagoId}/test`, { cookie: adm.cookie })
    expect(r.statusCode).toBe(200)
    expect(procHits).toHaveLength(1)
    const hit = procHits[0]
    expect(hit.headers['x-x2w-event']).toBe('webhook.teste')
    const body = JSON.parse(hit.body)
    expect(body).toMatchObject({ event: 'webhook.teste', test: true, data: { destinationId: pagoId, destinationEvent: 'saque.pago' } })
    expect(hit.body).not.toContain('"event":"saque.pago"')
    expect(r.json().execution).toMatchObject({ event: 'saque.pago', test: true, destinationId: pagoId })
  })

  it('passo C: trocar o evento (estorno → saque.pago) com o segredo mascarado → 400; com segredo novo → aceito, auditado e a fila do evento antigo não segue', async () => {
    await app.db.query('delete from webhook_outbox')
    const wr = await newWithdrawal(app, 300)
    expect((await api(app, 'POST', `/api/withdrawals/${wr}/reject`, { cookie: adm.cookie, body: { reason: 'Documento divergente' } })).statusCode).toBe(200)
    expect((await outbox(app)).map((o) => o.destination_id)).toEqual([estornoId])

    const masked = await edit(app, adm.cookie, estornoId, { event: 'saque.pago' })
    expect(masked.statusCode).toBe(400)
    expect(masked.json().error.message).toBe('O destino mudou: digite um novo segredo.')

    const ok = await edit(app, adm.cookie, estornoId, { event: 'saque.pago', secret: 'segredo-novo-do-estorno-01' })
    expect(ok.statusCode, ok.body).toBe(200)
    expect((await outbox(app))[0]).toMatchObject({ status: 'falhou', last_error: 'Destino alterado' })
    expect(await lastWebhookAudit(app)).toContain('evento Saque rejeitado → Saque pago')

    const w3 = await newWithdrawal(app, 3500)
    expect((await api(app, 'POST', `/api/withdrawals/${w3}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    await processOutboxOnce(app)
    const toRefund = procHits.filter((h) => h.path === '/pix/estornar')
    expect(toRefund.filter((h) => signedWith(h, S_ESTORNO))).toEqual([])
    // o evento rejeitado antigo não saiu para o endpoint (já com o evento novo)
    expect(toRefund.map((h) => JSON.parse(h.body).event)).toEqual(['saque.pago'])
  })

  it('item reservado pelo disparador no meio da troca de endereço não segue o endereço novo', async () => {
    await app.db.query('delete from webhook_outbox')
    const race = 'corrida'
    const sa = await loginAs(app, 'superadmin')
    const cur = await getList(app, sa.cookie)
    expect((await putList(app, sa.cookie, [...cur.value, { id: race, event: 'saque.expirado', url: `${PROC}/expirado`, active: true, secret: 'segredo-da-corrida-01' }], cur.version)).statusCode).toBe(200)
    expect(await enqueueWebhook(app.db, 'saque.expirado', { id: 'SQ-RACE' })).toBe(1)

    // a troca de endereço confirma logo depois de o disparador reservar o item (antes de ele ler o destino)
    const query = app.db.query.bind(app.db)
    let swapped = false
    app.db.query = (async (sql: string, params?: unknown[]) => {
      const out = await query(sql, params)
      if (!swapped && sql.trimStart().startsWith('with due as')) {
        swapped = true
        const moved = await edit(app, sa.cookie, race, { url: `${EVIL}/expirado`, secret: 'segredo-novo-da-corrida' })
        expect(moved.statusCode, moved.body).toBe(200)
      }
      return out
    }) as Db['query']
    try {
      await processOutboxOnce(app)
    } finally {
      app.db.query = query
    }
    expect(swapped).toBe(true)
    expect(evilHits).toEqual([])
    expect(procHits).toEqual([])
    expect((await outbox(app))[0]).toMatchObject({ status: 'falhou', last_error: 'Destino alterado' })
  })
})

describe('segredo forjado com cara de máscara (r3 forged mask)', () => {
  let app: FastifyInstance
  let sa: Awaited<ReturnType<typeof loginAs>>
  const OLD = 'old-leaked-hmac-secret-01'

  beforeAll(async () => {
    app = await createTestApp()
    sa = await loginAs(app, 'superadmin')
    expect((await putList(app, sa.cookie, [{ id: 'f1', event: 'saque.pago', url: `${PROC}/f1`, active: true, secret: OLD }], 0)).statusCode).toBe(200)
  })
  afterAll(async () => app.close())

  const stored = async () => app.cipher.decrypt((await app.db.one<{ secret_enc: string }>(`select secret_enc from webhook_destinations where id = 'f1'`))!.secret_enc)

  it.each([
    ['texto com *** no meio', 'n3w***rotated-hmac-secret'],
    ['pontos de máscara com outro final', '••••••••••XXXX'],
    ['máscara curta (só pontos) de segredo longo', '••••••••••'],
    ['máscara com *** de outro formato', '***t-01'],
  ])('%s → 400 e o segredo antigo continua', async (_label, secret) => {
    const r = await edit(app, sa.cookie, 'f1', { secret })
    expect(r.statusCode).toBe(400)
    expect(r.json().error).toMatchObject({ code: 'dados_invalidos', details: { id: 'f1', field: 'secret' } })
    expect(await stored()).toBe(OLD)
  })

  it('máscara exata ou campo vazio mantêm; valor novo troca; valor curto ou de demonstração → 400', async () => {
    expect(maskSecret(OLD)).toBe('••••••••••t-01')
    expect((await edit(app, sa.cookie, 'f1', { secret: '••••••••••t-01', active: false })).statusCode).toBe(200)
    expect(await stored()).toBe(OLD)
    expect((await edit(app, sa.cookie, 'f1', { secret: '', active: true })).statusCode).toBe(200)
    expect(await stored()).toBe(OLD)
    expect((await edit(app, sa.cookie, 'f1', { secret: 'curto' })).statusCode).toBe(400)
    expect((await edit(app, sa.cookie, 'f1', { secret: 'DEMO-hmac-qualquer-coisa' })).statusCode).toBe(400)
    expect(await stored()).toBe(OLD)
    expect((await edit(app, sa.cookie, 'f1', { secret: 'rotacionado-de-verdade-2026' })).statusCode).toBe(200)
    expect(await stored()).toBe('rotacionado-de-verdade-2026')
  })

  it('destino novo com valor de máscara (sem segredo gravado para manter) → 400', async () => {
    const cur = await getList(app, sa.cookie)
    const r = await putList(app, sa.cookie, [...cur.value, { id: 'f2', event: 'saque.pago', url: `${PROC}/f2`, active: true, secret: '••••••••••t-01' }], cur.version)
    expect(r.statusCode).toBe(400)
    expect(await app.db.query(`select id from webhook_destinations where id = 'f2'`)).toHaveLength(0)
  })
})

// ===========================================================================
// migração 003: excluir destino não apaga a fila; sinais de entrega
// ===========================================================================

describe('fila de entregas x exclusão de destino e sinais de falha', () => {
  let app: FastifyInstance
  let adm: Awaited<ReturnType<typeof loginAs>>
  beforeAll(async () => {
    app = await createTestApp()
    adm = await loginAs(app, 'administrador')
    const sa = await loginAs(app, 'superadmin')
    expect((await putList(app, sa.cookie, [{ id: 'pix', event: 'saque.pago', url: `${PROC}/pix`, active: true, secret: 'segredo-pix-producao-01' }], 0)).statusCode).toBe(200)
  })
  afterAll(async () => app.close())

  it('saque.pago entregue leva só { id, amount, playerId } (sem chave PIX, nome nem CPF)', async () => {
    const w = await newWithdrawal(app, 700)
    expect((await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    await processOutboxOnce(app)
    expect(procHits).toHaveLength(1)
    const body = JSON.parse(procHits[0].body)
    expect(Object.keys(body.data).sort()).toEqual(['amount', 'id', 'playerId'])
    expect(procHits[0].body).not.toContain('52998224725')
    expect(procHits[0].body).not.toContain('Jogadora Teste')
  })

  it(`cada tentativa que falha fica visível em execuções (com o id do saque); após ${MAX_ATTEMPTS} o item vira 'falhou'`, async () => {
    await app.db.query('delete from webhook_outbox')
    const w = await newWithdrawal(app, 500)
    expect((await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      procReplies.push(503)
      await dueNow(app)
      await processOutboxOnce(app)
    }
    expect((await outbox(app))[0]).toMatchObject({ status: 'falhou' })
    const r = await api(app, 'GET', '/api/kv/campanhas.webhooks.execucoes', { cookie: adm.cookie })
    const execs = (r.json().value as { status: string; httpStatus: number; payload: string; test: boolean }[]).filter((e) => !e.test && e.payload.includes(w))
    expect(execs).toHaveLength(MAX_ATTEMPTS)
    expect(execs.every((e) => e.status === 'falha' && e.httpStatus === 503)).toBe(true)
  })

  it('excluir o destino com entrega pendente: o item fica na fila como falhou ("Destino removido"), o saque segue aprovado e a auditoria diz quantas', async () => {
    await app.db.query('delete from webhook_outbox')
    const w = await newWithdrawal(app, 900)
    expect((await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    expect((await outbox(app)).filter((o) => o.status === 'pendente')).toHaveLength(1)
    const cur = await getList(app, adm.cookie)
    expect((await putList(app, adm.cookie, [], cur.version)).statusCode).toBe(200)
    const items = await outbox(app)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ status: 'falhou', last_error: 'Destino removido', destination_id: null })
    expect(items[0].payload.data.id).toBe(w)
    expect((await app.db.one<{ status: string }>('select status from withdrawals where id = $1', [w]))?.status).toBe('aprovado')
    const audit = await app.db.one<{ actor_id: string; summary: string }>(`select actor_id, summary from audit_log where summary like 'Destinos de webhook%' order by id desc limit 1`)
    expect(audit?.actor_id).toBe(adm.user.id)
    expect(audit?.summary).toMatch(/Removidos: pix \(Saque pago → 127\.0\.0\.1:\d+; 1 entrega pendente cancelada\)/)
    await dueNow(app)
    expect(await processOutboxOnce(app)).toBe(0)
    expect(procHits).toHaveLength(0)
  })

  it('item pendente sem destino (excluído por fora da tela): o disparador marca falhou sem enviar', async () => {
    await app.db.query(`insert into webhook_outbox (event, payload, destination_id) values ('saque.pago', '{"id":"evt_x","data":{"id":"SQ-X"}}'::jsonb, null)`)
    await processOutboxOnce(app)
    const [item] = (await outbox(app)).filter((o) => o.payload.data.id === 'SQ-X')
    expect(item).toMatchObject({ status: 'falhou', last_error: 'Destino removido' })
    expect(procHits).toHaveLength(0)
  })

  it('desligar e excluir ficam na auditoria com o autor; cargos sem webhooks.editar não alteram destinos', async () => {
    const sa = await loginAs(app, 'superadmin')
    const cur = await getList(app, sa.cookie)
    const added = await putList(app, sa.cookie, [...cur.value, { id: 'crm', event: 'saque.pago', url: `${PROC}/crm`, active: true, secret: 'segredo-crm-000001' }], cur.version)
    expect(added.statusCode).toBe(200)
    const off = await edit(app, adm.cookie, 'crm', { active: false })
    expect(off.statusCode).toBe(200)
    expect(await lastWebhookAudit(app)).toMatch(/Alterados: crm \(ativo\)/)
    const v = await getList(app, adm.cookie)
    expect((await putList(app, adm.cookie, [], v.version)).statusCode).toBe(200)
    expect(await lastWebhookAudit(app)).toMatch(/Removidos: crm \(Saque pago/)
    for (const role of ['financeiro', 'marketing-oficial', 'suporte']) {
      const u = await loginAs(app, role, { totp: true })
      expect((await putList(app, u.cookie, [], v.version + 1)).statusCode, role).toBe(403)
    }
  })
})

// ===========================================================================
// r3 consistent snapshot: GET com versão e lista do mesmo instante
// ===========================================================================

describe('GET dos destinos: versão e lista do mesmo instante (r3 consistent snapshot)', () => {
  type Match = (sql: string, params: unknown[]) => boolean
  let app: FastifyInstance
  let armed: { match: Match; parked: () => void; gate: Promise<void> } | null = null

  /** Intercepta query/one do banco e das transações abertas a partir dele (para parar a instrução escolhida). */
  function hook(db: Db) {
    const query = db.query.bind(db)
    const one = db.one.bind(db)
    const tx = db.tx.bind(db)
    const around = async <T,>(sql: string, params: unknown[], run: () => Promise<T>): Promise<T> => {
      const g = armed
      if (!g || !g.match(sql, params)) return run()
      armed = null
      const out = await run()
      g.parked()
      await g.gate
      return out
    }
    db.query = ((sql: string, params: unknown[] = []) => around(sql, params, () => query(sql, params))) as Db['query']
    db.one = ((sql: string, params: unknown[] = []) => around(sql, params, () => one(sql, params))) as Db['one']
    db.tx = ((fn: (t: Db) => Promise<unknown>) =>
      tx((t) => {
        hook(t)
        return fn(t)
      })) as Db['tx']
  }

  /** GET parado logo depois da primeira instrução de leitura que casar com `match`. */
  async function parkedGet(cookie: string, match: Match) {
    let release!: () => void
    let parked!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const isParked = new Promise<void>((r) => (parked = r))
    armed = { match, parked, gate }
    const res = api(app, 'GET', `/api/kv/${KEY}`, { cookie })
    await isParked
    return { res, release }
  }

  /** Deixa a gravação rodar enquanto a leitura está parada (ou esperar por ela, se a leitura trava) e solta a leitura. */
  async function whileParked<T>(write: Promise<T>, release: () => void): Promise<T> {
    await Promise.race([write, new Promise((r) => setTimeout(r, 1000))])
    release()
    return write
  }

  beforeEach(async () => {
    app = await createTestApp()
    hook(app.db)
  })
  afterEach(async () => {
    armed = null
    await app.close()
  })

  it.each([
    ['parado depois da leitura dos destinos', (sql: string) => sql.startsWith('select * from webhook_destinations order by')],
    ['parado depois da leitura da versão', (sql: string, p: unknown[]) => sql.startsWith('select value, updated_at from settings where key = $1') && p[0] === KEY],
  ])('%s: outra pessoa desativa d1; salvar a partir da leitura parada → 409 e d1 continua desativado', async (_label, match) => {
    const ana = await loginAs(app, 'superadmin', { name: 'Admin Ana' })
    const bruno = await loginAs(app, 'superadmin', { name: 'Admin Bruno' })
    const created = await putList(
      app,
      ana.cookie,
      [
        { id: 'd1', event: 'saque.pago', url: `${PROC}/d1`, active: true, secret: 'segredo-do-d1-0001' },
        { id: 'd2', event: 'saque.rejeitado', url: `${PROC}/d2`, active: true, secret: 'segredo-do-d2-0002' },
      ],
      0,
    )
    expect(created.statusCode).toBe(200)
    const g0 = await getList(app, ana.cookie)

    const { res, release } = await parkedGet(bruno.cookie, match)
    const off = await whileParked(
      putList(app, ana.cookie, g0.value.map((d) => (d.id === 'd1' ? { ...d, active: false } : d)), g0.version),
      release,
    )
    expect(off.statusCode, off.body).toBe(200)
    const view = (await res).json() as { value: Dest[]; version: number }
    const stale = view.value.find((d) => d.id === 'd1')!.active
    // conteúdo velho só viaja com a versão velha
    expect(stale ? view.version === g0.version : view.version === off.json().version, JSON.stringify(view)).toBe(true)

    // Bruno só desliga o d2
    const save = await putList(app, bruno.cookie, view.value.map((d) => (d.id === 'd2' ? { ...d, active: false } : d)), view.version)
    if (stale) {
      expect(save.statusCode, save.body).toBe(409)
      expect(save.json().error.code).toBe('versao_desatualizada')
    }
    const d1 = await app.db.one<{ active: boolean }>(`select active from webhook_destinations where id = 'd1'`)
    expect(d1?.active).toBe(false)
  })
})
