// Regressões de SSRF no envio de webhooks.
//
// r1-web-3: a checagem de rede interna precisa valer para o endereço que a conexão usa de fato.
// Antes, a checagem resolvia o nome (dns/promises) e o envio resolvia de novo por conta própria;
// um DNS que alterna (público -> 127.0.0.1) passava na checagem e conectava no serviço interno, e a
// mensagem de erro (código de baixo nível) virava um oráculo de portas internas.
//
// r1-web-4: a proteção estrita (só https, só host público, DNS conferido) não pode depender de
// NODE_ENV=production: sem a variável (npm start + .env.example) ela ficava desligada.
//
// O resolvedor abaixo modela um servidor DNS de rebinding e é ligado aos DOIS caminhos de resolução
// do Node: dns/promises (checagem antecipada) e dns.lookup do módulo CJS (o que a conexão usa).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { createRequire } from 'node:module'
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createTlsServer, type Server as TlsServer } from 'node:tls'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { newId } from '../src/lib/crypto'
import { DELIVERY_ERRORS, DELIVERY_TIMEOUT_MS, enqueueWebhook, processOutboxOnce, sendWebhook } from '../src/modules/webhooks/dispatcher'
import { BLOCKED_PRIVATE_CODE, safeLookup, webhookStrictMode } from '../src/modules/webhooks/url'
import { api, createTestApp, loginAs } from './helpers'

const PUBLIC_IP = '93.184.216.34'
const INTERNAL_IP = '127.0.0.1'
const counts = new Map<string, number>()

/** Servidor DNS de teste. null = resolução normal do sistema. 'hang' = nunca responde. */
function fakeAnswer(host: string): string[] | 'hang' | null {
  if (host.endsWith('.static.attacker.example')) return [INTERNAL_IP] // sempre interno
  if (host.endsWith('.public.attacker.example')) return [PUBLIC_IP] // sempre público
  if (host.endsWith('.mixed.attacker.example')) return [PUBLIC_IP, INTERNAL_IP] // resposta com os dois
  if (host.endsWith('.slow.attacker.example')) return 'hang'
  if (!host.endsWith('.rebind.attacker.example')) return null
  // rebinding: 1ª resposta pública, as seguintes internas
  const n = (counts.get(host) ?? 0) + 1
  counts.set(host, n)
  return [n === 1 ? PUBLIC_IP : INTERNAL_IP]
}

// caminho 1: checagem antecipada (url.ts usa lookup de node:dns/promises)
vi.mock('node:dns/promises', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:dns/promises')>()
  const lookup = async (host: string, opts?: unknown) => {
    const ans = fakeAnswer(host)
    if (ans === 'hang') return new Promise(() => undefined)
    if (ans) {
      const list = ans.map((address) => ({ address, family: 4 }))
      return (opts as { all?: boolean } | undefined)?.all ? list : list[0]
    }
    return (orig.lookup as (h: string, o?: unknown) => Promise<unknown>)(host, opts)
  }
  return { ...orig, lookup, default: { ...orig, lookup } }
})

// caminho 2: a conexão (net/tls e o safeLookup chamam dns.lookup do módulo CJS)
const cjsDns = createRequire(import.meta.url)('node:dns') as typeof import('node:dns')
const origLookup = cjsDns.lookup
beforeAll(() => {
  ;(cjsDns as { lookup: unknown }).lookup = function patched(host: string, opts: unknown, cb?: unknown) {
    const callback = (typeof opts === 'function' ? opts : cb) as (...a: unknown[]) => void
    const o = (typeof opts === 'object' && opts) || {}
    const ans = fakeAnswer(host)
    if (ans === 'hang') return undefined
    if (ans) {
      const list = ans.map((address) => ({ address, family: 4 }))
      return process.nextTick(() => ((o as { all?: boolean }).all ? callback(null, list) : callback(null, list[0].address, 4)))
    }
    return (origLookup as (...a: unknown[]) => void).call(cjsDns, host, opts, cb)
  }
})
afterAll(() => {
  ;(cjsDns as { lookup: unknown }).lookup = origLookup
})

// ---------- "serviços internos" em 127.0.0.1 ----------

let tcpInternal: TcpServer // serviço interno sem TLS (ex.: Redis/Postgres)
let tlsInternal: TlsServer // serviço interno com TLS (certificado próprio)
let httpInternal: HttpServer // serviço HTTP só local no host da API
let closedPort: number // porta sem nada escutando
const tcpConns: string[] = []
const tlsConns: string[] = []
const httpHits: string[] = []
const sockets: Socket[] = []

beforeAll(async () => {
  tcpInternal = createTcpServer((s) => {
    sockets.push(s)
    s.once('data', (d) => {
      tcpConns.push(d.toString('latin1'))
      s.end('-ERR wrong protocol\r\n')
    })
    s.on('error', () => undefined)
  })
  await new Promise<void>((r) => tcpInternal.listen(0, INTERNAL_IP, r))

  const dir = mkdtempSync(join(tmpdir(), 'webhooks-ssrf-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=interno.local', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], {
    stdio: 'ignore',
  })
  tlsInternal = createTlsServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }, (s) => s.end())
  tlsInternal.on('connection', (s: Socket) => {
    sockets.push(s)
    tlsConns.push('conn')
  })
  tlsInternal.on('tlsClientError', () => undefined)
  await new Promise<void>((r) => tlsInternal.listen(0, INTERNAL_IP, r))

  httpInternal = createHttpServer((req, res) => {
    httpHits.push(req.url ?? '')
    req.resume()
    res.writeHead(418)
    res.end('internal-admin')
  })
  await new Promise<void>((r) => httpInternal.listen(0, INTERNAL_IP, r))

  const tmp = createTcpServer()
  await new Promise<void>((r) => tmp.listen(0, INTERNAL_IP, r))
  closedPort = (tmp.address() as AddressInfo).port
  await new Promise<void>((r) => tmp.close(() => r()))
})

afterAll(async () => {
  for (const s of sockets) s.destroy()
  httpInternal.closeAllConnections()
  await new Promise<void>((r) => tcpInternal.close(() => r()))
  await new Promise<void>((r) => tlsInternal.close(() => r()))
  await new Promise<void>((r) => httpInternal.close(() => r()))
})

beforeEach(() => {
  counts.clear()
})

const portOf = (s: TcpServer | TlsServer | HttpServer) => (s.address() as AddressInfo).port

// ---------- app em produção ----------

let app: FastifyInstance
let cookie: string

beforeAll(async () => {
  app = await createTestApp({ NODE_ENV: 'production' })
  ;({ cookie } = await loginAs(app, 'superadmin'))
})
afterAll(async () => {
  await app.close()
})

async function destination(target: FastifyInstance, url: string, event = 'saque.pago') {
  const id = newId('wh')
  await target.db.query(`insert into webhook_destinations (id, event, url, active, secret_enc) values ($1, $2, $3, $4, $5)`, [
    id,
    event,
    url,
    true,
    target.cipher.encrypt('segredo-do-destino'),
  ])
  return id
}

async function testSend(url: string) {
  const id = await destination(app, url)
  const res = await api(app, 'POST', `/api/webhooks/destinations/${id}/test`, { cookie })
  return { status: res.statusCode, body: res.json() as { execution?: { error?: string; status?: string } } }
}

const uniq = () => `h${Date.now()}${Math.random().toString(36).slice(2, 8)}`

describe('r1-web-3: DNS rebinding no envio de webhook', () => {
  it('controle: nome que SEMPRE resolve para 127.0.0.1 é bloqueado antes de sair', async () => {
    const before = tcpConns.length
    const r = await testSend(`https://${uniq()}.static.attacker.example:${portOf(tcpInternal)}/hook`)
    expect(r.status).toBe(200)
    expect(r.body.execution?.error).toBe(DELIVERY_ERRORS.internal)
    expect(tcpConns.length - before).toBe(0)
  })

  it('DNS alternando (público -> 127.0.0.1) não gera conexão para o serviço interno', async () => {
    const before = tcpConns.length
    const host = `${uniq()}.rebind.attacker.example`
    const r = await testSend(`https://${host}:${portOf(tcpInternal)}/hook`)
    expect(r.status).toBe(200)
    expect(r.body.execution).toMatchObject({ status: 'falha' })
    expect(r.body.execution?.error).toBe(DELIVERY_ERRORS.internal)
    // a checagem antecipada viu o IP público; a conexão resolveu de novo, conferiu e recusou
    expect(counts.get(host)).toBeGreaterThanOrEqual(2)
    expect(tcpConns.length - before).toBe(0)
  })

  it('resposta de DNS com um endereço público e um interno é recusada inteira', async () => {
    const before = tcpConns.length
    const r = await testSend(`https://${uniq()}.mixed.attacker.example:${portOf(tcpInternal)}/hook`)
    expect(r.body.execution?.error).toBe(DELIVERY_ERRORS.internal)
    expect(tcpConns.length - before).toBe(0)
  })

  it('o erro devolvido ao painel, gravado na auditoria e na fila não serve de oráculo de portas internas', async () => {
    const tcpBefore = tcpConns.length
    const tlsBefore = tlsConns.length
    const open = await testSend(`https://${uniq()}.rebind.attacker.example:${portOf(tcpInternal)}/x`)
    const tls = await testSend(`https://${uniq()}.rebind.attacker.example:${portOf(tlsInternal)}/x`)
    const closed = await testSend(`https://${uniq()}.rebind.attacker.example:${closedPort}/x`)
    const errs = [open, tls, closed].map((r) => r.body.execution?.error)
    expect(new Set(errs).size).toBe(1)
    expect(errs[0]).toBe(DELIVERY_ERRORS.internal)
    expect(tcpConns.length - tcpBefore).toBe(0)
    expect(tlsConns.length - tlsBefore).toBe(0)
    const audit = await app.db.query<{ summary: string }>(`select summary from audit_log where action = 'testar'`)
    expect(audit.length).toBeGreaterThan(0)
    for (const a of audit) expect(a.summary).not.toMatch(/E[A-Z]{3,}|CERT|SELF_SIGNED|ECONN|EPROTO/)
  })

  it('o laço da fila também confere o endereço na conexão (last_error genérico, nada chega ao serviço interno)', async () => {
    const q = await createTestApp({ NODE_ENV: 'production' })
    try {
      await destination(q, `https://${uniq()}.rebind.attacker.example:${portOf(tcpInternal)}/fila`, 'saque.rejeitado')
      const before = tcpConns.length
      expect(await enqueueWebhook(q.db, 'saque.rejeitado', { id: 'SQ-SSRF' })).toBe(1)
      expect(await processOutboxOnce(q)).toBe(1)
      const [item] = await q.db.query<{ status: string; last_error: string }>('select status, last_error from webhook_outbox')
      expect(item.last_error).toBe(DELIVERY_ERRORS.internal)
      expect(tcpConns.length - before).toBe(0)
    } finally {
      await q.close()
    }
  })

  it('DNS lento não segura o envio: um prazo só cobre DNS e conexão', async () => {
    const started = Date.now()
    const r = await sendWebhook(app, {
      url: `https://${uniq()}.slow.attacker.example/hook`,
      secret: 's',
      event: 'saque.pago',
      deliveryId: '1',
      body: '{}',
    })
    const took = Date.now() - started
    expect(r).toMatchObject({ ok: false, httpStatus: null, error: DELIVERY_ERRORS.timeout })
    expect(took).toBeGreaterThanOrEqual(DELIVERY_TIMEOUT_MS - 200)
    expect(took).toBeLessThan(DELIVERY_TIMEOUT_MS + 2000)
  }, 15_000)
})

describe('safeLookup (lookup usado pela conexão)', () => {
  const run = (host: string, all: boolean) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) =>
      safeLookup(host, { all }, (err, address, family) => resolve({ err, address, family })),
    )

  it('nome público: devolve exatamente o endereço conferido (com e sem all)', async () => {
    const one = await run(`${uniq()}.public.attacker.example`, false)
    expect(one.err).toBeNull()
    expect(one).toMatchObject({ address: PUBLIC_IP, family: 4 })
    const all = await run(`${uniq()}.public.attacker.example`, true)
    expect(all.err).toBeNull()
    expect(all.address).toEqual([{ address: PUBLIC_IP, family: 4 }])
  })

  it('nome interno, resposta mista ou rebinding na conexão: erro EBLOCKED_PRIVATE', async () => {
    for (const host of [`${uniq()}.static.attacker.example`, `${uniq()}.mixed.attacker.example`]) {
      const r = await run(host, true)
      expect(r.err?.code, host).toBe(BLOCKED_PRIVATE_CODE)
    }
    const host = `${uniq()}.rebind.attacker.example`
    expect((await run(host, false)).address).toBe(PUBLIC_IP)
    expect((await run(host, false)).err?.code).toBe(BLOCKED_PRIVATE_CODE)
  })
})

describe('r1-web-4: proteção estrita não depende de NODE_ENV=production', () => {
  it('webhookStrictMode: ligado em produção, desenvolvimento e sem variável; desliga só em teste ou com liberação explícita', () => {
    expect(webhookStrictMode({ NODE_ENV: 'production' })).toBe(true)
    expect(webhookStrictMode({ NODE_ENV: 'development' })).toBe(true)
    expect(webhookStrictMode({ NODE_ENV: 'development', WEBHOOK_ALLOW_LOCAL_TARGETS: false })).toBe(true)
    expect(webhookStrictMode({ NODE_ENV: 'development', WEBHOOK_ALLOW_LOCAL_TARGETS: 'false' })).toBe(true)
    expect(webhookStrictMode({ NODE_ENV: 'test' })).toBe(false)
    expect(webhookStrictMode({ NODE_ENV: 'development', WEBHOOK_ALLOW_LOCAL_TARGETS: true })).toBe(false)
    expect(webhookStrictMode({ NODE_ENV: 'development', WEBHOOK_ALLOW_LOCAL_TARGETS: 'true' })).toBe(false)
  })

  it.each([
    ['sem NODE_ENV (npm start + .env.example)', undefined],
    ['NODE_ENV=development', 'development'],
    ['NODE_ENV=production', 'production'],
  ])('%s: destino http://127.0.0.1:<porta interna> é recusado e nada é enviado', async (_label, nodeEnv) => {
    const target = await createTestApp({ NODE_ENV: nodeEnv })
    try {
      const { cookie: c } = await loginAs(target, 'superadmin')
      const before = httpHits.length
      const url = `http://127.0.0.1:${portOf(httpInternal)}/admin/internal`
      const put = await api(target, 'PUT', '/api/kv/campanhas.webhooks.destinos', {
        cookie: c,
        body: { value: [{ id: 'ssrf1', event: 'saque.pago', url, active: true, secret: 'segredo-ssrf-123456' }] },
      })
      expect(put.statusCode).toBe(400)
      expect(put.json().error.code).toBe('dados_invalidos')
      // destino gravado por fora (ex.: backup antigo) também não sai no envio
      await destination(target, url)
      const [{ id }] = await target.db.query<{ id: string }>('select id from webhook_destinations limit 1')
      const t = await api(target, 'POST', `/api/webhooks/destinations/${id}/test`, { cookie: c })
      expect(t.statusCode).toBe(200)
      expect(t.json().execution.status).toBe('falha')
      expect(t.json().execution.error).toMatch(/https/)
      expect(httpHits.length - before).toBe(0)
    } finally {
      await target.close()
    }
  })

  it('ambiente de teste (NODE_ENV=test): falha de conexão sai com mensagem genérica, sem código de rede', async () => {
    const t = await createTestApp()
    try {
      const r = await sendWebhook(t, { url: `http://127.0.0.1:${closedPort}/x`, secret: 's', event: 'saque.pago', deliveryId: '1', body: '{}' })
      expect(r).toMatchObject({ ok: false, httpStatus: null, error: DELIVERY_ERRORS.connection })
      expect(r.error).not.toMatch(/ECONN|\(/)
    } finally {
      await t.close()
    }
  })
})
