import { createHmac } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { findKvRule } from '@shared/kv-registry'
import { effectivePermissions } from '@shared/permissions'
import { newId } from '../src/lib/crypto'
import { getRole } from '../src/services/roles-repo'
import type { KvContext } from '../src/kv/types'
import type { AuthContext } from '../src/types'
import { approvalMessage, rejectionMessage } from '@shared/withdrawals'
import {
  enqueueWebhook,
  enqueueWebhookEvent,
  MAX_ATTEMPTS,
  processOutboxOnce,
  retryDelaySeconds,
  sendWebhook,
  startWebhookDispatcher,
  USER_AGENT,
} from '../src/modules/webhooks/dispatcher'
import { destinationUrl, kvHandlers, type DestinationRow } from '../src/modules/webhooks/kv'
import { seedDemo, DEMO_DESTINATIONS } from '../src/modules/webhooks/seed'
import { isPrivateHostname, isPrivateIp, webhookTargetProblem, webhookUrlProblem } from '../src/modules/webhooks/url'
import { api, createTestApp, createUser, loginAs } from './helpers'

// ---------- receptor HTTP local ----------

interface Received {
  url: string
  method: string
  headers: IncomingHttpHeaders
  body: string
}

let server: Server
let base: string
const received: Received[] = []
/** status das próximas respostas (fila); vazio = 200 */
const plan: number[] = []

function verifySignature(r: Received, secret: string) {
  const ts = String(r.headers['x-x2w-timestamp'])
  const expected = `sha256=${createHmac('sha256', secret).update(`${ts}.${r.body}`).digest('hex')}`
  return r.headers['x-x2w-signature'] === expected
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      if (req.url?.startsWith('/pendura')) return // nunca responde (testa o tempo limite)
      received.push({ url: req.url ?? '', method: req.method ?? '', headers: req.headers, body })
      if (req.url?.startsWith('/redireciona')) {
        res.writeHead(302, { location: 'http://127.0.0.1:1/interno' })
        return res.end()
      }
      const status = plan.shift() ?? 200
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: status < 300 }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  received.length = 0
  plan.length = 0
})

// ---------- utilitários ----------

async function authFor(app: FastifyInstance, roleId: string, name = 'Pessoa KV'): Promise<AuthContext> {
  const u = await createUser(app, { roleId, name })
  const role = (await getRole(app.db, roleId))!
  return {
    user: { id: u.id, name, email: u.email, roleId, status: 'ativo', totpEnabled: false, mustChangePassword: false },
    role,
    perms: new Set(effectivePermissions(role)),
    sessionId: 's',
    stage: 'active',
    ip: '10.7.7.7',
  }
}

function kvCtx(app: FastifyInstance, auth: AuthContext, key: string): KvContext {
  return { app, req: { clientIp: auth.ip } as unknown as FastifyRequest, auth, key, rule: findKvRule(key)! }
}

const DEST_KEY = 'campanhas.webhooks.destinos'
const EXEC_KEY = 'campanhas.webhooks.execucoes'

async function insertDestination(app: FastifyInstance, d: { id?: string; event: string; url: string; secret: string; active?: boolean }) {
  const id = d.id ?? newId('wh')
  await app.db.query(`insert into webhook_destinations (id, event, url, active, secret_enc) values ($1, $2, $3, $4, $5)`, [
    id,
    d.event,
    d.url,
    d.active ?? true,
    app.cipher.encrypt(d.secret),
  ])
  return id
}

/** Endereços gravados (decifrados: o banco guarda o endereço cifrado e só o host em claro). */
async function storedUrls(app: FastifyInstance, where = '') {
  const rows = await app.db.query<DestinationRow>(`select * from webhook_destinations ${where} order by id`)
  return rows.map((r) => ({ id: r.id, url: destinationUrl(r, app.cipher), plain: r.url, host: r.host }))
}

type Outbox = { id: number; status: string; attempts: number; next_attempt_at: string; last_error: string | null; destination_id: string }
const outbox = (app: FastifyInstance) => app.db.query<Outbox>('select * from webhook_outbox order by id')
type Exec = { id: string; status: string; http_status: number | null; duration_ms: number; payload: string; test: boolean; destination_id: string; url: string }
const executions = (app: FastifyInstance) => app.db.query<Exec>('select * from webhook_executions order by at, id')

// ---------- testes ----------

describe('enqueueWebhook', () => {
  it('cria um item por destino ATIVO do evento e respeita a transação', async () => {
    const app = await createTestApp()
    const a = await insertDestination(app, { event: 'saque.pago', url: `${base}/a`, secret: 'segredo-aaaa' })
    const b = await insertDestination(app, { event: 'saque.pago', url: `${base}/b`, secret: 'segredo-bbbb' })
    await insertDestination(app, { event: 'saque.pago', url: `${base}/c`, secret: 'segredo-cccc', active: false })
    await insertDestination(app, { event: 'saque.rejeitado', url: `${base}/d`, secret: 'segredo-dddd' })
    expect(await enqueueWebhook(app.db, 'saque.pago', { id: 'SQ1', amount: 10 })).toBe(2)
    const rows = await app.db.query<{ destination_id: string; payload: { id: string; data: unknown }; status: string }>('select * from webhook_outbox order by id')
    expect(rows.map((r) => r.destination_id).sort()).toEqual([a, b].sort())
    expect(rows[0].payload.id).toBe(rows[1].payload.id) // mesmo id de evento para todos os destinos
    expect(rows[0].payload.data).toEqual({ id: 'SQ1', amount: 10 })
    expect(rows.every((r) => r.status === 'pendente')).toBe(true)

    expect(await enqueueWebhook(app.db, 'deposito.primeiro', {})).toBe(0)
    await expect(enqueueWebhook(app.db, 'evento.qualquer', {})).rejects.toThrow(/desconhecido/)

    await expect(
      app.db.tx(async (t) => {
        await enqueueWebhook(t, 'saque.pago', { id: 'SQ2' })
        throw new Error('desfaz')
      }),
    ).rejects.toThrow('desfaz')
    expect(await app.db.query('select id from webhook_outbox')).toHaveLength(2)
    await app.close()
  })
})

describe('processOutboxOnce (envio real para servidor local)', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('envia POST JSON assinado com os cabeçalhos do contrato e registra a execução', async () => {
    const secret = 'segredo-de-assinatura-123'
    const destId = await insertDestination(app, { event: 'saque.pago', url: `${base}/receber?x=1`, secret })
    await enqueueWebhook(app.db, 'saque.pago', { id: 'SQ9', amount: 55.5, playerId: 'p9' })
    const [item] = await outbox(app)
    expect(await processOutboxOnce(app)).toBe(1)

    expect(received).toHaveLength(1)
    const r = received[0]
    expect(r.method).toBe('POST')
    expect(r.url).toBe('/receber?x=1')
    expect(r.headers['content-type']).toBe('application/json')
    expect(r.headers['user-agent']).toBe(USER_AGENT)
    expect(r.headers['x-x2w-event']).toBe('saque.pago')
    expect(r.headers['x-x2w-delivery']).toBe(String(item.id))
    const ts = Number(r.headers['x-x2w-timestamp'])
    expect(Math.abs(ts - Date.now() / 1000)).toBeLessThan(10)
    expect(verifySignature(r, secret)).toBe(true)
    expect(verifySignature(r, 'outro-segredo')).toBe(false)
    const body = JSON.parse(r.body)
    expect(Object.keys(body)).toEqual(['id', 'event', 'createdAt', 'data'])
    expect(body).toMatchObject({ event: 'saque.pago', data: { id: 'SQ9', amount: 55.5, playerId: 'p9' } })
    expect(body.id).toMatch(/^evt_/)
    expect(Number.isNaN(Date.parse(body.createdAt))).toBe(false)

    const [after] = await outbox(app)
    expect(after).toMatchObject({ status: 'entregue', attempts: 1, last_error: null })
    const ex = await executions(app)
    expect(ex).toHaveLength(1)
    expect(ex[0]).toMatchObject({ status: 'sucesso', http_status: 200, test: false, destination_id: destId, payload: r.body })
    expect(await processOutboxOnce(app)).toBe(0) // nada mais vencido
  })

  it('falha (HTTP 500) reagenda com espera de 30 s; nova tentativa entrega; toda tentativa vira execução', async () => {
    await app.db.query('delete from webhook_outbox')
    const secret = 'segredo-retentativa'
    await insertDestination(app, { event: 'saque.rejeitado', url: `${base}/instavel`, secret })
    await enqueueWebhook(app.db, 'saque.rejeitado', { id: 'SQ10' })
    const before = await executions(app)
    plan.push(500)
    expect(await processOutboxOnce(app)).toBe(1)
    let [item] = await outbox(app)
    expect(item.status).toBe('pendente')
    expect(item.attempts).toBe(1)
    expect(item.last_error).toContain('500')
    const wait = (Date.parse(item.next_attempt_at) - Date.now()) / 1000
    expect(wait).toBeGreaterThan(25)
    expect(wait).toBeLessThanOrEqual(31)
    expect(await processOutboxOnce(app)).toBe(0) // ainda não venceu

    await app.db.query(`update webhook_outbox set next_attempt_at = now() - interval '1 second'`)
    expect(await processOutboxOnce(app)).toBe(1)
    ;[item] = await outbox(app)
    expect(item).toMatchObject({ status: 'entregue', attempts: 2 })
    expect(received).toHaveLength(2)
    expect(received[0].headers['x-x2w-delivery']).toBe(received[1].headers['x-x2w-delivery'])
    expect(JSON.parse(received[0].body).id).toBe(JSON.parse(received[1].body).id) // mesmo evento nas tentativas
    expect(received.every((r) => verifySignature(r, secret))).toBe(true)
    const ex = (await executions(app)).slice(before.length)
    expect(ex.map((e) => [e.status, e.http_status])).toEqual([
      ['falha', 500],
      ['sucesso', 200],
    ])
  })

  it(`após ${MAX_ATTEMPTS} tentativas o item fica 'falhou'`, async () => {
    await app.db.query('delete from webhook_outbox')
    await insertDestination(app, { event: 'saque.expirado', url: `${base}/quebrado`, secret: 'segredo-quebrado' })
    await enqueueWebhook(app.db, 'saque.expirado', { id: 'SQ11' })
    await app.db.query(`update webhook_outbox set attempts = $1`, [MAX_ATTEMPTS - 1])
    plan.push(503)
    await processOutboxOnce(app)
    const [item] = await outbox(app)
    expect(item).toMatchObject({ status: 'falhou', attempts: MAX_ATTEMPTS })
    await app.db.query(`update webhook_outbox set next_attempt_at = now() - interval '1 hour'`)
    expect(await processOutboxOnce(app)).toBe(0)
  })

  it('espera cresce 30 s × 2^tentativas, no máximo 1 h', () => {
    expect([0, 1, 2, 3, 4, 5].map(retryDelaySeconds)).toEqual([30, 60, 120, 240, 480, 960])
    expect(retryDelaySeconds(7)).toBe(3600)
    expect(retryDelaySeconds(20)).toBe(3600)
  })

  it('destino desativado depois de enfileirar: não envia e marca falhou', async () => {
    await app.db.query('delete from webhook_outbox')
    const id = await insertDestination(app, { event: 'deposito.primeiro', url: `${base}/off`, secret: 'segredo-off' })
    await enqueueWebhook(app.db, 'deposito.primeiro', { id: 'DP1' })
    await app.db.query('update webhook_destinations set active = false where id = $1', [id])
    await processOutboxOnce(app)
    expect(received).toHaveLength(0)
    expect((await outbox(app))[0].status).toBe('falhou')
  })

  it('redirecionamento não é seguido (conta como falha)', async () => {
    await app.db.query('delete from webhook_outbox')
    await insertDestination(app, { event: 'saque.solicitado', url: `${base}/redireciona`, secret: 'segredo-redir' })
    await enqueueWebhook(app.db, 'saque.solicitado', { id: 'SQ12' })
    await processOutboxOnce(app)
    expect(received).toHaveLength(1)
    const [item] = await outbox(app)
    expect(item.status).toBe('pendente')
    expect(item.last_error).toContain('302')
  })

  it('processa no máximo 20 itens por rodada', async () => {
    await app.db.query('delete from webhook_outbox')
    await app.db.query('delete from webhook_destinations')
    await insertDestination(app, { event: 'saque.solicitado', url: `${base}/lote`, secret: 'segredo-lote' })
    for (let i = 0; i < 23; i++) await enqueueWebhook(app.db, 'saque.solicitado', { id: `L${i}` })
    expect(await processOutboxOnce(app)).toBe(20)
    expect(await processOutboxOnce(app)).toBe(3)
    expect(received).toHaveLength(23)
  })

  it('sem resposta em 5 s: falha por tempo esgotado', async () => {
    const r = await sendWebhook(app, { url: `${base}/pendura`, secret: 's', event: 'saque.pago', deliveryId: '1', body: '{}' })
    expect(r.ok).toBe(false)
    expect(r.httpStatus).toBeNull()
    expect(r.error).toMatch(/5 s/)
    expect(r.durationMs).toBeGreaterThanOrEqual(4900)
  }, 15_000)

  it('saque aprovado pela API chega ao destino com assinatura válida', async () => {
    await app.db.query('delete from webhook_outbox')
    await app.db.query('delete from webhook_destinations')
    const secret = 'segredo-integracao'
    await insertDestination(app, { event: 'saque.pago', url: `${base}/pagos`, secret })
    await app.db.query(
      `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, status, risk_level, risk_score, pix_key_type, pix_key_enc, reference, created_at, updated_at)
       values ('SQX', 'p1', 'J', 'j@x.com', 25050, 'pendente', 'baixo', 1, 'CPF', $1, 'E1', now(), now())`,
      [app.cipher.encrypt('12345678909')],
    )
    const { cookie } = await loginAs(app)
    expect((await api(app, 'POST', '/api/withdrawals/SQX/approve', { cookie })).statusCode).toBe(200)
    await processOutboxOnce(app)
    expect(received).toHaveLength(1)
    expect(verifySignature(received[0], secret)).toBe(true)
    expect(JSON.parse(received[0].body)).toMatchObject({ event: 'saque.pago', data: { id: 'SQX', amount: 250.5, playerId: 'p1' } })
    expect(received[0].body).not.toContain('12345678909')
  })
})

describe('startWebhookDispatcher', () => {
  it('processa a fila sozinho a cada 2 s e para quando pedido', async () => {
    const app = await createTestApp()
    await insertDestination(app, { event: 'saque.pago', url: `${base}/laco`, secret: 'segredo-laco' })
    await enqueueWebhook(app.db, 'saque.pago', { id: 'SQL' })
    const stop = startWebhookDispatcher(app)
    const deadline = Date.now() + 8000
    while (Date.now() < deadline && (await outbox(app))[0].status !== 'entregue') await new Promise((r) => setTimeout(r, 200))
    expect((await outbox(app))[0].status).toBe('entregue')
    stop()
    await enqueueWebhook(app.db, 'saque.pago', { id: 'SQM' })
    await new Promise((r) => setTimeout(r, 2500))
    expect((await outbox(app))[1].status).toBe('pendente')
    expect(received.filter((r) => r.url === '/laco')).toHaveLength(1)
    await app.close()
  }, 20_000)
})

describe('URL de destino', () => {
  it('fora do modo estrito (testes): https em geral; http só para localhost/127.0.0.1', () => {
    expect(webhookUrlProblem('https://hooks.exemplo.com/in', false)).toBeNull()
    expect(webhookUrlProblem('http://127.0.0.1:8080/x', false)).toBeNull()
    expect(webhookUrlProblem('http://localhost/x', false)).toBeNull()
    expect(webhookUrlProblem('http://exemplo.com/x', false)).toMatch(/https/)
    expect(webhookUrlProblem('ftp://exemplo.com/x', false)).toMatch(/https/)
    expect(webhookUrlProblem('', false)).toMatch(/Informe/)
    expect(webhookUrlProblem('https://user:pw@exemplo.com', false)).toMatch(/usuário e senha/)
    expect(webhookUrlProblem('https://exemplo.com/a#b', false)).toMatch(/âncora/)
    expect(webhookUrlProblem('https://exemplo.com/a b', false)).toMatch(/espaços/)
    expect(webhookUrlProblem(`https://exemplo.com/${'a'.repeat(500)}`, false)).toMatch(/longo/)
    expect(webhookUrlProblem('não é url', false)).toBeTruthy()
  })

  it('modo estrito: só https e só host público', () => {
    expect(webhookUrlProblem('https://hooks.exemplo.com/in', true)).toBeNull()
    for (const u of [
      'http://hooks.exemplo.com/in',
      'http://127.0.0.1:8080/x',
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://10.0.0.5/x',
      'https://192.168.0.1/x',
      'https://172.20.1.1/x',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/x',
      'https://[fd00::1]/x',
      'https://[::ffff:127.0.0.1]/x',
      'https://servidor-interno/x',
      'https://banco.internal/x',
      'https://0.0.0.0/x',
    ]) {
      expect(webhookUrlProblem(u, true), u).toBeTruthy()
    }
  })

  it('classifica IPs e nomes internos', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false)
    expect(isPrivateIp('172.32.0.1')).toBe(false)
    expect(isPrivateIp('172.31.255.255')).toBe(true)
    expect(isPrivateIp('100.64.0.1')).toBe(true)
    expect(isPrivateIp('2001:4860:4860::8888')).toBe(false)
    expect(isPrivateIp('fe80::1')).toBe(true)
    expect(isPrivateHostname('api.leadflow.app')).toBe(false)
    expect(isPrivateHostname('x.localhost')).toBe(true)
  })

  it('em produção o envio para endereço interno é bloqueado antes de sair', async () => {
    expect(await webhookTargetProblem(`${base}/x`, true)).toBeTruthy()
    const prod = await createTestApp({ NODE_ENV: 'production' })
    const r = await sendWebhook(prod, { url: `${base}/prod`, secret: 's', event: 'saque.pago', deliveryId: '1', body: '{}' })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
    expect(received).toHaveLength(0)
    await prod.close()
  })
})

describe('kv campanhas.webhooks.destinos', () => {
  let app: FastifyInstance
  /** app só para os casos de validação (nada pode ser gravado nele) */
  let validation: FastifyInstance
  let admin: AuthContext
  const h = () => kvHandlers['webhook-destinations']!
  beforeAll(async () => {
    app = await createTestApp()
    validation = await createTestApp()
    admin = await authFor(app, 'superadmin', 'Ana Admin')
  })
  afterAll(async () => {
    await app.close()
    await validation.close()
  })

  it('sem destinos: lista vazia com versão 0', async () => {
    expect(await h().read(kvCtx(app, admin, DEST_KEY))).toEqual({ value: [], version: 0, updatedAt: null })
  })

  it('grava (cifra o segredo), lê mascarado e preserva o segredo quando volta mascarado', async () => {
    const v1 = await h().write!(
      kvCtx(app, admin, DEST_KEY),
      [
        { id: 'wh-a', event: 'saque.pago', url: `${base}/a`, active: true, secret: 'segredo-original-1234', createdAt: '2020-01-01T00:00:00Z' },
        { id: 'wh-b', event: 'saque.solicitado', url: 'https://hooks.exemplo.com/in', active: false, secret: '' },
      ],
      0,
    )
    expect(v1.version).toBe(1)
    const list = v1.value as { id: string; secret: string; event: string; url: string; active: boolean; createdAt: string }[]
    expect(list.map((d) => d.id)).toEqual(['wh-a', 'wh-b'])
    expect(list[0].secret).toBe('••••••••••1234')
    expect(list[1].secret).toMatch(/^•{10}.{4}$/) // gerado pelo servidor
    expect(list[0]).toMatchObject({ event: 'saque.pago', url: `${base}/a`, active: true })
    expect(list[0].createdAt).not.toBe('2020-01-01T00:00:00Z') // data vem do servidor
    expect(JSON.stringify(v1)).not.toContain('segredo-original')
    const rows = await app.db.query<{ id: string; secret_enc: string }>('select id, secret_enc from webhook_destinations order by id')
    expect(rows[0].secret_enc).not.toContain('segredo')
    expect(app.cipher.decrypt(rows[0].secret_enc)).toBe('segredo-original-1234')
    expect(app.cipher.decrypt(rows[1].secret_enc).length).toBeGreaterThanOrEqual(24)

    // painel devolve a lista lida (segredo mascarado) mudando só a URL
    const back = list.map((d) => (d.id === 'wh-a' ? { ...d, url: `${base}/a2` } : d))
    const v2 = await h().write!(kvCtx(app, admin, DEST_KEY), back, 1)
    expect(v2.version).toBe(2)
    const after = await app.db.query<{ id: string; secret_enc: string; url: string }>('select * from webhook_destinations order by id')
    expect(app.cipher.decrypt(after[0].secret_enc)).toBe('segredo-original-1234')
    expect((await storedUrls(app))[0]).toMatchObject({ url: `${base}/a2`, plain: null, host: new URL(base).host })
    expect(app.cipher.decrypt(after[1].secret_enc)).toBe(app.cipher.decrypt(rows[1].secret_enc))

    // e a assinatura continua usando o segredo original
    await enqueueWebhook(app.db, 'saque.pago', { id: 'SQ-KV' })
    await processOutboxOnce(app)
    expect(received).toHaveLength(1)
    expect(received[0].url).toBe('/a2')
    expect(verifySignature(received[0], 'segredo-original-1234')).toBe(true)

    const audit = await app.db.query<{ action: string; entity: string; summary: string; ip: string }>(
      `select * from audit_log where entity = 'Dados · Webhooks' order by id`,
    )
    expect(audit).toHaveLength(2)
    expect(audit[0]).toMatchObject({ action: 'editar', ip: '10.7.7.7' })
    expect(audit[0].summary).toContain('Incluídos')
    expect(audit[1].summary).toContain('wh-a (endereço)')
    expect(audit.map((a) => a.summary).join(' ')).not.toContain('segredo-original')
  })

  it('troca de segredo, exclusão e versão desatualizada', async () => {
    const cur = (await h().read(kvCtx(app, admin, DEST_KEY)))!
    const list = cur.value as { id: string; secret: string }[]
    const next = [{ ...list[0], secret: 'segredo-novo-5678' }] // remove wh-b
    const saved = await h().write!(kvCtx(app, admin, DEST_KEY), next, cur.version)
    expect((saved.value as { secret: string }[])[0].secret).toBe('••••••••••5678')
    expect(await app.db.query('select id from webhook_destinations')).toHaveLength(1)
    const audit = await app.db.one<{ summary: string }>(`select summary from audit_log where entity = 'Dados · Webhooks' order by id desc limit 1`)
    expect(audit?.summary).toContain('segredo')
    expect(audit?.summary).toContain('Removidos: wh-b')
    expect(audit?.summary).not.toContain('5678')

    await expect(h().write!(kvCtx(app, admin, DEST_KEY), next, cur.version)).rejects.toMatchObject({
      status: 409,
      code: 'versao_desatualizada',
      details: { version: saved.version },
    })
    await expect(h().write!(kvCtx(app, admin, DEST_KEY), next, undefined)).rejects.toMatchObject({ status: 409 })
  })

  it.each([
    ['evento inválido', [{ id: 'x1', event: 'saque.qualquer', url: 'https://a.com/x', active: true, secret: '' }], 'ZodError'],
    ['URL http pública', [{ id: 'x1', event: 'saque.pago', url: 'http://exemplo.com/x', active: true, secret: '' }], 'dados_invalidos'],
    ['URL ftp', [{ id: 'x1', event: 'saque.pago', url: 'ftp://exemplo.com/x', active: true, secret: '' }], 'dados_invalidos'],
    ['URL com usuário e senha', [{ id: 'x1', event: 'saque.pago', url: 'https://u:p@exemplo.com/x', active: true, secret: '' }], 'dados_invalidos'],
    [
      'id repetido',
      [
        { id: 'x1', event: 'saque.pago', url: 'https://a.com/x', active: true },
        { id: 'x1', event: 'saque.pago', url: 'https://a.com/y', active: true },
      ],
      'dados_invalidos',
    ],
    ['id com caracteres estranhos', [{ id: "x'; drop", event: 'saque.pago', url: 'https://a.com/x', active: true }], 'ZodError'],
    ['segredo curto', [{ id: 'x1', event: 'saque.pago', url: 'https://a.com/x', active: true, secret: 'abc' }], 'dados_invalidos'],
    ['não é lista', { id: 'x1' }, 'ZodError'],
    ['ativo não booleano', [{ id: 'x1', event: 'saque.pago', url: 'https://a.com/x', active: 'sim' }], 'ZodError'],
  ])('recusa %s', async (_label, value, kind) => {
    const a = await authFor(validation, 'superadmin')
    const err = await h()
      .write!(kvCtx(validation, a, DEST_KEY), value, 0)
      .catch((e) => e)
    if (kind === 'ZodError') expect(err.name).toBe('ZodError')
    else expect(err).toMatchObject({ status: 400, code: kind })
    expect(await validation.db.query('select id from webhook_destinations')).toHaveLength(0)
    expect(await validation.db.query(`select id from audit_log where action = 'editar'`)).toHaveLength(0)
  })

  it('em produção recusa http://localhost e host interno', async () => {
    const prod = await createTestApp({ NODE_ENV: 'production' })
    const a = await authFor(prod, 'superadmin')
    for (const url of ['http://localhost:3000/x', 'https://127.0.0.1/x', 'https://10.1.2.3/x']) {
      await expect(h().write!(kvCtx(prod, a, DEST_KEY), [{ id: 'p1', event: 'saque.pago', url, active: true }], 0)).rejects.toMatchObject({
        status: 400,
      })
    }
    const ok = await h().write!(kvCtx(prod, a, DEST_KEY), [{ id: 'p1', event: 'saque.pago', url: 'https://hooks.exemplo.com/in', active: true }], 0)
    expect(ok.version).toBe(1)
    await prod.close()
  })

  it('permissões: Marketing oficial lê (Estatísticas) mas não grava; Financeiro não lê', async () => {
    const mkt = await authFor(app, 'marketing-oficial')
    const read = await h().read(kvCtx(app, mkt, DEST_KEY))
    expect((read!.value as { secret: string }[]).every((d) => d.secret.startsWith('••••'))).toBe(true)
    await expect(h().write!(kvCtx(app, mkt, DEST_KEY), [], read!.version)).rejects.toMatchObject({ status: 403 })
    const fin = await authFor(app, 'financeiro')
    await expect(h().read(kvCtx(app, fin, DEST_KEY))).rejects.toMatchObject({ status: 403 })
  })
})

describe('POST /api/webhooks/destinations/:id/test', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('envia de verdade um evento de teste assinado, grava execução test=true e audita', async () => {
    const secret = 'segredo-do-teste-99'
    const id = await insertDestination(app, { event: 'saque.pago', url: `${base}/teste`, secret })
    const { cookie, user } = await loginAs(app, 'superadmin')
    const r = await api(app, 'POST', `/api/webhooks/destinations/${id}/test`, { cookie, ip: '10.3.3.3' })
    expect(r.statusCode).toBe(200)
    const { execution } = r.json()
    expect(execution).toMatchObject({ destinationId: id, event: 'saque.pago', status: 'sucesso', httpStatus: 200, test: true, url: `${base}/teste` })
    expect(execution.error).toBeUndefined()
    expect(received).toHaveLength(1)
    expect(verifySignature(received[0], secret)).toBe(true)
    expect(received[0].headers['x-x2w-delivery']).toBe(execution.id)
    const body = JSON.parse(received[0].body)
    // envio de teste: evento próprio (nunca o envelope do evento real do destino), assinado com o segredo do destino
    expect(received[0].headers['x-x2w-event']).toBe('webhook.teste')
    expect(body).toEqual({ id: expect.stringMatching(/^evt_/), event: 'webhook.teste', createdAt: expect.any(String), test: true, data: { destinationId: id, destinationEvent: 'saque.pago' } })
    expect(execution.payload).toBe(received[0].body)
    const row = await app.db.one<{ test: boolean }>('select test from webhook_executions where id = $1', [execution.id])
    expect(row?.test).toBe(true)
    const audit = await app.db.one<{ action: string; actor_id: string; entity: string; summary: string; ip: string }>(
      `select * from audit_log where action = 'testar' order by id desc limit 1`,
    )
    expect(audit).toMatchObject({ actor_id: user.id, entity: 'Webhook Saque pago', ip: '10.3.3.3' })
    expect(audit?.summary).toContain('HTTP 200')
    expect(await app.db.query('select id from webhook_outbox')).toHaveLength(0) // teste não passa pela fila
  })

  it('resposta (sucesso ou erro) sai com Cache-Control: no-store', async () => {
    const id = await insertDestination(app, { event: 'saque.pago', url: `${base}/cache`, secret: 'segredo-cache-1' })
    const { cookie } = await loginAs(app, 'superadmin')
    const ok = await api(app, 'POST', `/api/webhooks/destinations/${id}/test`, { cookie })
    expect(ok.statusCode).toBe(200)
    expect(String(ok.headers['cache-control'] ?? '')).toContain('no-store')
    const nf = await api(app, 'POST', '/api/webhooks/destinations/nao-existe/test', { cookie })
    expect(nf.statusCode).toBe(404)
    expect(String(nf.headers['cache-control'] ?? '')).toContain('no-store')
  })

  it('destino respondendo 500: execução com falha e motivo', async () => {
    const id = await insertDestination(app, { event: 'saque.rejeitado', url: `${base}/erro`, secret: 'segredo-erro-1' })
    const { cookie } = await loginAs(app, 'superadmin')
    plan.push(500)
    const r = await api(app, 'POST', `/api/webhooks/destinations/${id}/test`, { cookie })
    expect(r.statusCode).toBe(200)
    expect(r.json().execution).toMatchObject({ status: 'falha', httpStatus: 500, test: true })
    expect(r.json().execution.error).toContain('500')
  })

  it('exige webhooks.editar; destino inexistente → 404; sem sessão → 401', async () => {
    const id = await insertDestination(app, { event: 'saque.pago', url: `${base}/negado`, secret: 'segredo-negado' })
    for (const roleId of ['marketing-oficial', 'financeiro', 'suporte']) {
      // com 2FA ativo: Marketing oficial exige 2FA para ter sessão (sem ele a resposta seria 401, não 403)
      const { cookie } = await loginAs(app, roleId, { totp: true })
      const r = await api(app, 'POST', `/api/webhooks/destinations/${id}/test`, { cookie })
      expect(r.statusCode, roleId).toBe(403)
      expect(r.json().error.code).toBe('sem_permissao')
    }
    expect(received).toHaveLength(0)
    const { cookie } = await loginAs(app)
    const nf = await api(app, 'POST', '/api/webhooks/destinations/nao-existe/test', { cookie })
    expect(nf.statusCode).toBe(404)
    expect((await api(app, 'POST', `/api/webhooks/destinations/${id}/test`)).statusCode).toBe(401)
  })
})

describe('kv campanhas.webhooks.execucoes', () => {
  it('as 1000 mais recentes no formato do painel; leitura conforme a regra', async () => {
    const app = await createTestApp()
    await app.db.query(
      `insert into webhook_executions (id, at, event, destination_id, url, status, http_status, duration_ms, payload, test)
       select 'ex' || g, now() - (g || ' minutes')::interval, 'saque.pago', 'wh1', 'https://a.com', 'sucesso', 200, 100, '{}', g = 1
       from generate_series(1, 1003) g`,
    )
    await app.db.query(
      `insert into webhook_executions (id, event, url, status, payload) values ('exfalha', 'saque.pago', 'https://a.com', 'falha', '{}')`,
    )
    const admin = await authFor(app, 'superadmin')
    const v = await kvHandlers['webhook-executions']!.read(kvCtx(app, admin, EXEC_KEY))
    const list = v!.value as Record<string, unknown>[]
    expect(list).toHaveLength(1000)
    expect(list[0]).toEqual({
      id: 'exfalha',
      at: expect.any(String),
      event: 'saque.pago',
      destinationId: '',
      url: 'https://a.com',
      status: 'falha',
      httpStatus: 0,
      durationMs: 0,
      payload: '{}',
      test: false,
    })
    expect(list[1]).toMatchObject({ id: 'ex1', test: true, httpStatus: 200, destinationId: 'wh1' })
    expect(kvHandlers['webhook-executions']!.write).toBeUndefined()
    const fin = await authFor(app, 'financeiro')
    await expect(kvHandlers['webhook-executions']!.read(kvCtx(app, fin, EXEC_KEY))).rejects.toMatchObject({ status: 403 })
    const mkt = await authFor(app, 'marketing-oficial')
    expect(await kvHandlers['webhook-executions']!.read(kvCtx(app, mkt, EXEC_KEY))).toBeTruthy()
    await app.close()
  })
})

describe('seed de demonstração', () => {
  it('5 destinos com segredo cifrado e 134 execuções de sucesso nos últimos 30 dias; não repete', async () => {
    const app = await createTestApp()
    expect(await seedDemo(app)).toMatch(/5 destinos e 134 execuções/)
    const dests = await app.db.query<DestinationRow>('select * from webhook_destinations order by id')
    expect(dests.map((d) => d.id)).toEqual(['wh1', 'wh2', 'wh3', 'wh4', 'wh5'])
    for (const d of dests) {
      const demo = DEMO_DESTINATIONS.find((x) => x.id === d.id)!
      expect(d.secret_enc).not.toContain(demo.secret)
      expect(app.cipher.decrypt(d.secret_enc)).toBe(demo.secret)
      // endereço cifrado; só o host em claro
      expect(d.url).toBeNull()
      expect(d.url_enc).not.toContain(new URL(demo.url).pathname)
      expect(destinationUrl(d, app.cipher)).toBe(demo.url)
      expect(d.host).toBe(new URL(demo.url).host)
    }
    // execuções de demonstração com o token do caminho mascarado
    const leadflow = await app.db.query<{ url: string }>(`select distinct url from webhook_executions where destination_id = 'wh5'`)
    expect(leadflow.map((e) => e.url)).toEqual(['https://api.leadflow.app/v1/ftd/a8c3****'])
    const ex = await app.db.query<{ status: string; at: string; http_status: number; test: boolean }>('select * from webhook_executions')
    expect(ex).toHaveLength(134)
    expect(ex.every((e) => e.status === 'sucesso' && e.http_status === 200 && !e.test)).toBe(true)
    const thirtyDays = Date.now() - 30 * 86_400_000 - 60_000
    expect(ex.every((e) => Date.parse(e.at) >= thirtyDays && Date.parse(e.at) <= Date.now() + 1000)).toBe(true)
    const admin = await authFor(app, 'superadmin')
    const read = await kvHandlers['webhook-destinations']!.read(kvCtx(app, admin, DEST_KEY))
    expect(read!.version).toBe(1)
    expect((read!.value as { secret: string }[])[0].secret).toBe('••••••••••9a2c')
    expect(await seedDemo(app)).toMatch(/nada a semear/)
    expect(await app.db.query('select id from webhook_executions')).toHaveLength(134)
    await app.close()
  })
})

// ---------------------------------------------------------------------------
// Regressão r2-api-mode-seed-fallback-3: depois de uma leitura que falhou (502 do nginx, 429, queda de rede) o
// painel mostrava seedWebhookDestinations() e, na primeira edição, mandava o seed inteiro num PUT SEM versão. O
// servidor aceitava (nada gravado -> qualquer versão) e passava a enfileirar saque.pago/rejeitado para
// hooks.x2win-crm.com / api.leadflow.app (terceiros), assinados com segredos públicos no bundle.
// ---------------------------------------------------------------------------

describe('regressão r2-api-mode-seed-fallback-3: destinos de demonstração não viram destinos reais', () => {
  const created = '2026-07-11T23:04:13.771Z'
  // exatamente o que o painel enviou (src/domain/webhooks.ts seedWebhookDestinations, wh5 desligado pela pessoa)
  const PANEL_SEED = [
    { id: 'wh1', event: 'saque.solicitado', url: 'https://hooks.x2win-crm.com/in/saques', active: true, secret: 'DEMO-hmac-1f9a2c', createdAt: created },
    { id: 'wh2', event: 'saque.pago', url: 'https://hooks.x2win-crm.com/in/saques', active: true, secret: 'DEMO-hmac-8b2d4f', createdAt: created },
    { id: 'wh3', event: 'saque.rejeitado', url: 'https://hooks.x2win-crm.com/in/saques', active: true, secret: 'DEMO-hmac-3c5e7a', createdAt: created },
    { id: 'wh4', event: 'saque.expirado', url: 'https://hooks.x2win-crm.com/in/saques', active: true, secret: 'DEMO-hmac-6d8f1b', createdAt: created },
    { id: 'wh5', event: 'deposito.primeiro', url: 'https://api.leadflow.app/v1/ftd/a8c3f1d92e7b', active: false, secret: 'DEMO-hmac-9e1a3c', createdAt: created },
  ]
  const THIRD_PARTY = /hooks\.x2win-crm\.com|api\.leadflow\.app/
  const GOOD_SECRET = 'whsec_0123456789abcdef0123456789abcdef'

  let app: FastifyInstance
  let root: Awaited<ReturnType<typeof loginAs>>
  beforeAll(async () => {
    app = await createTestApp()
    root = await loginAs(app, 'superadmin', { name: 'Admin PoC' })
  })
  afterAll(async () => app.close())

  const put = (body: unknown) => api(app, 'PUT', `/api/kv/${DEST_KEY}`, { cookie: root.cookie, body })

  it('PUT do seed sem versão numa instalação nova → 409; nada gravado, nenhum saque real vai para terceiro', async () => {
    // instalação nova: a chave responde stored:true, lista vazia, versão 0
    const get = await api(app, 'GET', `/api/kv/${DEST_KEY}`, { cookie: root.cookie })
    expect(get.json()).toMatchObject({ value: [], version: 0, stored: true })

    const blind = await put({ value: PANEL_SEED })
    expect(blind.statusCode).toBe(409)
    expect(blind.json().error).toMatchObject({ code: 'versao_desatualizada', details: { version: 0 } })
    // versão diferente da atual também não passa (a única aceita numa instalação nova é 0)
    expect((await put({ value: [], version: 7 })).statusCode).toBe(409)

    // saques reais aprovados/rejeitados depois disso
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
      expect(r.statusCode, r.body).toBe(200)
    }
    const rows = await storedUrls(app)
    expect(rows.filter((r) => THIRD_PARTY.test(r.url)), 'destinos de demonstração gravados como reais').toEqual([])
    const queued = await storedUrls(app, `where id in (select destination_id from webhook_outbox)`)
    expect(queued.filter((o) => THIRD_PARTY.test(o.url)), 'eventos reais de saque enfileirados para terceiro').toEqual([])
  })

  it('mesmo com a versão certa: host de demonstração ou segredo de demonstração → 400', async () => {
    const withVersion = await put({ value: PANEL_SEED, version: 0 })
    expect(withVersion.statusCode).toBe(400)
    expect(withVersion.json().error.code).toBe('dados_invalidos')

    // só o host (segredo novo, gerado pelo painel)
    const host = await put({ value: [{ ...PANEL_SEED[1], id: 'n1', secret: GOOD_SECRET }], version: 0 })
    expect(host.statusCode).toBe(400)
    expect(host.json().error).toMatchObject({ code: 'dados_invalidos', details: { id: 'n1', field: 'url' } })
    const sub = await put({ value: [{ id: 'n2', event: 'saque.pago', url: 'https://in.API.LeadFlow.app./x', active: true, secret: GOOD_SECRET }], version: 0 })
    expect(sub.statusCode).toBe(400)

    // só o segredo (público no bundle do painel)
    const secret = await put({ value: [{ id: 'n3', event: 'saque.pago', url: 'https://hooks.exemplo.com/in', active: true, secret: 'demo-HMAC-8b2d4f' }], version: 0 })
    expect(secret.statusCode).toBe(400)
    expect(secret.json().error).toMatchObject({ code: 'dados_invalidos', details: { id: 'n3', field: 'secret' } })
    expect(await app.db.query('select id from webhook_destinations')).toHaveLength(0)

    // caminho normal do painel: leu versão 0, manda versão 0, destino real
    const ok = await put({ value: [{ id: 'n4', event: 'saque.pago', url: 'https://hooks.exemplo.com/in', active: true, secret: GOOD_SECRET }], version: 0 })
    expect(ok.statusCode, ok.body).toBe(200)
    expect(ok.json().version).toBe(1)
    // trocar o endereço de um destino existente para host de demonstração também é recusado
    const cur = ok.json().value as { id: string; url: string }[]
    const moved = await put({ value: cur.map((d) => ({ ...d, url: 'https://hooks.x2win-crm.com/in/saques' })), version: 1 })
    expect(moved.statusCode).toBe(400)
    expect((await storedUrls(app))[0].url).toBe('https://hooks.exemplo.com/in')
  })

  it('destino de demonstração já gravado e ativo (ex.: antes desta trava) não recebe evento real', async () => {
    const probe = await createTestApp()
    try {
      const demo = await insertDestination(probe, { id: 'wh2', event: 'saque.pago', url: 'https://hooks.x2win-crm.com/in/saques', secret: 'DEMO-hmac-8b2d4f' })
      const real = await insertDestination(probe, { id: 'real1', event: 'saque.pago', url: `${base}/real`, secret: 'segredo-real-123456' })
      // item que já estava na fila para o destino de demonstração
      await probe.db.query(`insert into webhook_outbox (event, payload, destination_id) values ('saque.pago', '{"id":"evt_old","data":{}}'::jsonb, $1)`, [demo])
      expect(await enqueueWebhook(probe.db, 'saque.pago', { id: 'SQ-1', amount: 4800, playerId: 'p1' })).toBe(1)
      const queued = await outbox(probe)
      expect(queued.filter((o) => o.destination_id === real)).toHaveLength(1)
      expect(queued.filter((o) => o.destination_id === demo)).toHaveLength(1) // só o antigo
      await processOutboxOnce(probe)
      const after = await outbox(probe)
      expect(after.find((o) => o.destination_id === demo)).toMatchObject({ status: 'falhou', attempts: 0 })
      expect(after.find((o) => o.destination_id === demo)?.last_error).toContain('demonstração')
      expect(after.find((o) => o.destination_id === real)?.status).toBe('entregue')
      expect(received.map((r) => r.url)).toEqual(['/real'])
      expect((await executions(probe)).every((e) => e.destination_id === real)).toBe(true)
    } finally {
      await probe.close()
    }
  })

  it('instalação com DEMO_DATA (destinos semeados direto no banco): a lista volta mascarada e continua editável', async () => {
    const demo = await createTestApp()
    try {
      await seedDemo(demo)
      const admin = await authFor(demo, 'superadmin')
      const cur = (await kvHandlers['webhook-destinations']!.read(kvCtx(demo, admin, DEST_KEY)))!
      const list = cur.value as { id: string; active: boolean }[]
      // desligar um destino semeado (mesma URL, segredo mascarado) é aceito
      const saved = await kvHandlers['webhook-destinations']!.write!(
        kvCtx(demo, admin, DEST_KEY),
        list.map((d) => (d.id === 'wh5' ? { ...d, active: false } : d)),
        cur.version,
      )
      expect(saved.version).toBe(cur.version + 1)
      const wh5 = await demo.db.one<{ active: boolean }>(`select active from webhook_destinations where id = 'wh5'`)
      expect(wh5?.active).toBe(false)
    } finally {
      await demo.close()
    }
  })
})

// ---------------------------------------------------------------------------
// e2e r2: o que a tela mostra de cada entrega, template desligado e teste para destino de demonstração
// ---------------------------------------------------------------------------

describe('entregas: X-X2W-Delivery, tentativa e X-X2W-Timestamp registrados como o destino recebeu', () => {
  it('as tentativas da fila têm o mesmo deliveryId (o id do item), attempt 1, 2… e o timestamp assinado; o teste usa o id da execução', async () => {
    const app = await createTestApp()
    try {
      const id = await insertDestination(app, { event: 'saque.rejeitado', url: `${base}/tentativas`, secret: 'segredo-tentativas' })
      await enqueueWebhook(app.db, 'saque.rejeitado', { id: 'SQ-T' })
      const [item] = await outbox(app)
      plan.push(500)
      await processOutboxOnce(app)
      await app.db.query(`update webhook_outbox set next_attempt_at = now() - interval '1 second'`)
      await processOutboxOnce(app)
      expect(received).toHaveLength(2)
      const admin = await authFor(app, 'superadmin')
      const list = (await kvHandlers['webhook-executions']!.read(kvCtx(app, admin, EXEC_KEY)))!.value as Record<string, unknown>[]
      const mine = list.filter((e) => e.destinationId === id).sort((a, b) => Number(a.attempt) - Number(b.attempt))
      expect(mine.map((e) => [e.status, e.attempt, e.deliveryId])).toEqual([
        ['falha', 1, String(item.id)],
        ['sucesso', 2, String(item.id)],
      ])
      expect(mine.map((e) => e.timestamp)).toEqual(received.map((r) => Number(r.headers['x-x2w-timestamp'])))
      expect(received.map((r) => r.headers['x-x2w-delivery'])).toEqual([String(item.id), String(item.id)])

      received.length = 0
      const { cookie } = await loginAs(app, 'superadmin')
      const r = await api(app, 'POST', `/api/webhooks/destinations/${id}/test`, { cookie })
      expect(r.statusCode, r.body).toBe(200)
      const ex = r.json().execution
      expect(ex).toMatchObject({ deliveryId: ex.id, attempt: 1, timestamp: Number(received[0].headers['x-x2w-timestamp']) })
      expect(received[0].headers['x-x2w-delivery']).toBe(ex.id)
    } finally {
      await app.close()
    }
  })
})

describe('template desligado em Campanhas › Templates: o evento acontece e nada sai', () => {
  it('enqueue não cria item (templateOff); ligado de novo, volta a enfileirar; a aprovação diz que o template está desligado', async () => {
    const app = await createTestApp()
    try {
      await insertDestination(app, { event: 'saque.pago', url: `${base}/tpl`, secret: 'segredo-template' })
      const setTemplates = (active: boolean) =>
        app.db.query(
          `insert into kv_store (key, value, version) values ('campanhas.templates', $1::jsonb, 1)
           on conflict (key) do update set value = excluded.value, version = kv_store.version + 1`,
          [JSON.stringify([{ id: 'tp06', event: 'saque.pago', active, body: '{"marcador":"CORPO-EDITADO"}' }, { id: 'tp07', event: 'saque.rejeitado', active: true, body: '{}' }])],
        )
      await setTemplates(false)
      expect(await enqueueWebhookEvent(app.db, 'saque.pago', { id: 'SQ-OFF' })).toEqual({ queued: 0, templateOff: true })
      expect(await enqueueWebhook(app.db, 'saque.pago', { id: 'SQ-OFF' })).toBe(0)
      expect(await outbox(app)).toHaveLength(0)
      // outro evento, com o template ligado e sem destino: nada a enviar, mas não por causa do template
      expect(await enqueueWebhookEvent(app.db, 'saque.rejeitado', { id: 'SQ-R' })).toEqual({ queued: 0, templateOff: false })

      // aprovação real: a mensagem diz que o template está desligado (não "nenhum destino ativo")
      const w = newId('SQ')
      await app.db.query(
        `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                                  risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
         values ($1, 'p-tpl', 'Jogador', 'j@x.com', 5000, 0, 'pendente', 'baixo', 5, '[]'::jsonb, 'CPF', $2, 'E1', now(), now())`,
        [w, app.cipher.encrypt('12345678909')],
      )
      const { cookie } = await loginAs(app, 'administrador')
      const r = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie })
      expect(r.statusCode, r.body).toBe(200)
      expect(r.json()).toMatchObject({ queuedDeliveries: 0, message: approvalMessage(50, 0, true) })
      expect(r.json().message).toContain('template "Saque pago" está desativado')
      expect(await outbox(app)).toHaveLength(0)

      await setTemplates(true)
      expect(await enqueueWebhookEvent(app.db, 'saque.pago', { id: 'SQ-ON' })).toEqual({ queued: 1, templateOff: false })
      expect(rejectionMessage(10, 0, true)).toContain('template "Saque rejeitado" está desativado')
    } finally {
      await app.close()
    }
  })
})

describe('teste para destino de demonstração', () => {
  it('POST .../test em host de demonstração → 409 destino_demonstracao, nada enviado nem gravado', async () => {
    const app = await createTestApp()
    try {
      const id = await insertDestination(app, { event: 'saque.solicitado', url: 'https://hooks.x2win-crm.com/in/saques', secret: 'segredo-demo-x' })
      const { cookie } = await loginAs(app, 'superadmin')
      const r = await api(app, 'POST', `/api/webhooks/destinations/${id}/test`, { cookie })
      expect(r.statusCode).toBe(409)
      expect(r.json().error.code).toBe('destino_demonstracao')
      expect(await executions(app)).toHaveLength(0)
      expect(await app.db.query(`select id from audit_log where action = 'testar'`)).toHaveLength(0)
    } finally {
      await app.close()
    }
  })
})
