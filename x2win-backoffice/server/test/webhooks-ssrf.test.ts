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
// O resolvedor abaixo modela um servidor DNS de rebinding. A checagem antecipada e a conexão resolvem pelo mesmo
// caminho (url.ts › resolveHost: dns.promises.resolve4/resolve6, c-ares, fora do pool de threads do libuv); o
// dns.lookup (getaddrinfo, no pool de threads que o scrypt das senhas usa) não pode ser chamado.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { createRequire } from 'node:module'
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createTlsServer, type Server as TlsServer } from 'node:tls'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

// o resolvedor de url.ts (dns.promises do módulo CJS, lido na hora da chamada)
const cjsDns = createRequire(import.meta.url)('node:dns') as typeof import('node:dns')
const dnsPromises = cjsDns.promises as { resolve4: unknown; resolve6: unknown }
type Resolve = (host: string) => Promise<string[]>
const orig = {
  resolve4: cjsDns.promises.resolve4 as Resolve,
  resolve6: cjsDns.promises.resolve6 as Resolve,
  lookup: cjsDns.lookup,
}
/** nomes passados ao dns.lookup (getaddrinfo) — o envio estrito não pode usá-lo */
const lookupCalls: string[] = []
beforeAll(() => {
  dnsPromises.resolve4 = async (host: string) => {
    if (host.endsWith('.nxdomain.attacker.example')) throw Object.assign(new Error(`queryA ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
    const ans = fakeAnswer(host)
    if (ans === 'hang') return new Promise(() => undefined)
    if (ans) return ans
    return orig.resolve4.call(cjsDns.promises, host)
  }
  dnsPromises.resolve6 = async (host: string) => {
    // os nomes de teste só têm registro A
    if (/\.(static|public|mixed|slow|rebind|nxdomain)\.attacker\.example$/.test(host)) {
      throw Object.assign(new Error(`queryAaaa ENODATA ${host}`), { code: 'ENODATA' })
    }
    return orig.resolve6.call(cjsDns.promises, host)
  }
  ;(cjsDns as { lookup: unknown }).lookup = function counted(host: string, ...rest: unknown[]) {
    lookupCalls.push(host)
    return (orig.lookup as (...a: unknown[]) => void).call(cjsDns, host, ...rest)
  }
})
afterAll(() => {
  dnsPromises.resolve4 = orig.resolve4
  dnsPromises.resolve6 = orig.resolve6
  ;(cjsDns as { lookup: unknown }).lookup = orig.lookup
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
  lookupCalls.length = 0
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
    // nenhuma resolução pelo getaddrinfo (pool de threads do libuv, o mesmo do scrypt)
    expect(lookupCalls).toEqual([])
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

  it('respeita a família pedida pela conexão e não usa dns.lookup (getaddrinfo)', async () => {
    const v4 = await new Promise<{ err: NodeJS.ErrnoException | null; address: unknown }>((resolve) =>
      safeLookup(`${uniq()}.public.attacker.example`, { family: 4, all: true }, (err, address) => resolve({ err, address })),
    )
    expect(v4).toEqual({ err: null, address: [{ address: PUBLIC_IP, family: 4 }] })
    const v6 = await new Promise<{ err: NodeJS.ErrnoException | null }>((resolve) =>
      safeLookup(`${uniq()}.public.attacker.example`, { family: 6 }, (err) => resolve({ err })),
    )
    expect(v6.err?.code).toBe('ENOTFOUND')
    const missing = await new Promise<{ err: NodeJS.ErrnoException | null }>((resolve) =>
      safeLookup(`${uniq()}.nxdomain.attacker.example`, { all: true }, (err) => resolve({ err })),
    )
    expect(missing.err?.code).toBe('ENOTFOUND')
    expect(lookupCalls).toEqual([])
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
        body: { value: [{ id: 'ssrf1', event: 'saque.pago', url, active: true, secret: 'segredo-ssrf-123456' }], version: 0 },
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
