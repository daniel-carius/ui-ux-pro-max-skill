// Regressões de esgotamento de recursos antes da autenticação (achados r2-resource-exhaustion-1 e -2).
//  - Escrita sem sessão é recusada no preParsing, antes de o corpo ser lido e passar pelo JSON.parse.
//  - Rotas públicas e etapas pendentes do login só aceitam corpo pequeno, de tamanho declarado.
//  - O scrypt das rotas de login passa por uma fila do processo (não por IP): logins de muitas origens não ocupam
//    o pool de threads do libuv inteiro (dns.lookup do Postgres e da conferência anti-SSRF dos webhooks).
import { lookup } from 'node:dns'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SECURITY } from '../src/config'
import { PRE_AUTH_BODY_LIMIT } from '../src/plugins/session'
import {
  PASSWORD_BUSY_RETRY_AFTER_SECONDS,
  PASSWORD_GATE_LIMITS,
  PasswordGateFull,
  createPasswordGate,
  passwordGate,
} from '../src/modules/auth/password-gate'
import { api, createTestApp, createUser, loginAs, sessionCookie, type TestUser } from './helpers'

let ipSeq = 0
const freshIp = () => {
  ipSeq++
  return `10.${200 + Math.floor(ipSeq / 250)}.${ipSeq % 250}.1`
}

function expectError(r: LightMyRequestResponse, status: number, code: string) {
  expect(r.statusCode, r.body).toBe(status)
  expect(r.json().error.code).toBe(code)
}

/** Requisição crua (inject), para mandar corpo que não é JSON válido. */
function raw(app: FastifyInstance, method: 'POST' | 'PUT', url: string, payload: string, opts: { cookie?: string; ip?: string } = {}) {
  return app.inject({
    method,
    url,
    remoteAddress: opts.ip ?? freshIp(),
    headers: {
      'content-type': 'application/json',
      [SECURITY.csrfHeader]: SECURITY.csrfValue,
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    payload,
  })
}

/** JSON válido de ~`size` bytes e caro de parsear (lista de objetos), como o do ataque. */
function costlyJson(size: number): Buffer {
  const item = '{"a":1,"b":"xxxxxxxxxx","c":2},'
  const n = Math.floor((size - 16) / item.length)
  return Buffer.from(`{"value":[${item.repeat(n)}{}]}`)
}

interface HttpResult {
  status: number
  ms: number
  headers: http.IncomingHttpHeaders
  body: string
}

/**
 * Requisição HTTP de verdade. `chunked`: corpo em partes, sem Content-Length. Resolve quando a resposta chegou e a
 * requisição terminou (corpo enviado ou conexão fechada pelo servidor), para nada continuar subindo depois do teste.
 */
function httpReq(port: number, method: string, path: string, body?: Buffer, opts: { chunked?: boolean } = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const start = performance.now()
    let result: HttpResult | null = null
    let closed = false
    const settle = () => {
      if (result && closed) resolve(result)
    }
    const r = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          'content-type': 'application/json',
          [SECURITY.csrfHeader]: SECURITY.csrfValue,
          ...(body && !opts.chunked ? { 'content-length': body.length } : {}),
        },
      },
      (res) => {
        let text = ''
        res.on('data', (c) => (text += c))
        res.on('end', () => {
          result = { status: res.statusCode ?? 0, ms: performance.now() - start, headers: res.headers, body: text }
          settle()
        })
      },
    )
    // a resposta pode chegar (e a conexão fechar) antes de o corpo terminar de subir
    r.on('error', (err) => {
      if (!result) reject(err)
    })
    r.on('close', () => {
      closed = true
      settle()
    })
    if (body && opts.chunked) {
      const half = Math.floor(body.length / 2)
      r.write(body.subarray(0, half))
      r.end(body.subarray(half))
    } else {
      r.end(body)
    }
  })
}

function dnsLookupMs(): Promise<number> {
  const t0 = performance.now()
  return new Promise((resolve) => lookup('localhost', () => resolve(performance.now() - t0)))
}

describe('escrita sem sessão é recusada antes de ler o corpo (r2-resource-exhaustion-1)', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => {
    await app.close()
  })

  it('JSON inválido numa rota protegida dá 401, não 400: a sessão é conferida antes do parse', async () => {
    const r = await raw(app, 'POST', '/api/team/direct', '{ isto nao e json valido ')
    expectError(r, 401, 'nao_autenticado')
    // vale para qualquer escrita protegida, inclusive rota inexistente e chave de dados
    expectError(await raw(app, 'PUT', '/api/kv/x', '{ nao e json'), 401, 'nao_autenticado')
    expectError(await raw(app, 'POST', '/api/audit/events', '{ nao e json'), 401, 'nao_autenticado')
    expectError(await raw(app, 'POST', '/api/nao-existe', '{ nao e json'), 401, 'nao_autenticado')
    expectError(await raw(app, 'POST', '/api/auth/2fa/verify', '{ nao e json'), 401, 'nao_autenticado')
    // cookie vencido/forjado é o mesmo que sem sessão
    expectError(await raw(app, 'POST', '/api/team/direct', '{ nao e json', { cookie: `${SECURITY.sessionCookie}=forjado` }), 401, 'nao_autenticado')
  })

  it('corpo grande sem sessão: 401 sem ler; acima do bodyLimit da rota, fecha a conexão', async () => {
    const within = await raw(app, 'PUT', '/api/kv/x', `{"value":"${'A'.repeat(2 * 1024 * 1024)}"`)
    expectError(within, 401, 'nao_autenticado')
    // dentro do limite o Node descarta o corpo sem parse e a conexão continua (o proxy recebe o 401 inteiro)
    expect(within.headers.connection).not.toBe('close')

    const over = await raw(app, 'PUT', '/api/kv/x', 'x'.repeat(13 * 1024 * 1024))
    expectError(over, 401, 'nao_autenticado')
    expect(over.headers.connection).toBe('close')
  })

  it('a recusa sem sessão continua contando para o limite de taxa da rota', async () => {
    const ip = freshIp()
    // POST /api/audit/events: 30 por minuto por IP sem sessão
    const statuses: number[] = []
    for (let i = 0; i < 31; i++) statuses.push((await raw(app, 'POST', '/api/audit/events', '{}', { ip })).statusCode)
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true)
    expect(statuses[30]).toBe(429)
  })

  it('rotas públicas continuam abertas sem sessão: login, saída e aceite de convite', async () => {
    const login = await api(app, 'POST', '/api/auth/login', { ip: freshIp(), body: { email: 'ninguem@x2win.bet.br', password: 'SenhaErrada123' } })
    expectError(login, 401, 'credenciais_invalidas')
    const logout = await api(app, 'POST', '/api/auth/logout', { ip: freshIp(), cookie: `${SECURITY.sessionCookie}=vencido` })
    expect(logout.statusCode).toBe(204)
    const accept = await api(app, 'POST', '/api/team/invites/accept', { ip: freshIp(), body: { token: 'z'.repeat(43), password: 'SenhaForte123' } })
    expectError(accept, 400, 'dados_invalidos')
    // JSON inválido numa rota pública: aí sim o parser responde
    expect((await raw(app, 'POST', '/api/auth/login', '{ nao e json')).statusCode).toBe(400)
  })

  it('rota pública só aceita corpo pequeno: 413 sem ler (nem calcular o hash) e fecha a conexão', async () => {
    const big = JSON.stringify({ email: 'ninguem@x2win.bet.br', password: 'x', pad: 'y'.repeat(PRE_AUTH_BODY_LIMIT) })
    const r = await raw(app, 'POST', '/api/auth/login', big)
    expectError(r, 413, 'corpo_grande_demais')
    expect(r.headers.connection).toBe('close')
    expectError(await raw(app, 'POST', '/api/team/invites/accept', big), 413, 'corpo_grande_demais')
  })

  it('etapa pendente do login também só manda corpo pequeno; sessão ativa segue o limite normal', async () => {
    const user = await createUser(app, { totp: true })
    const pending = await sessionCookie(app, user.id, '2fa')
    const big = JSON.stringify({ code: '123456', pad: 'y'.repeat(PRE_AUTH_BODY_LIMIT) })
    expectError(await raw(app, 'POST', '/api/auth/2fa/verify', big, { cookie: pending }), 413, 'corpo_grande_demais')
    expectError(await raw(app, 'PUT', '/api/kv/x', big, { cookie: pending }), 413, 'corpo_grande_demais')
    // corpo pequeno da etapa pendente numa rota protegida: chega na guarda da rota (403 etapa_pendente)
    expectError(await raw(app, 'PUT', '/api/kv/x', '{"value":1}', { cookie: pending }), 403, 'etapa_pendente')

    const { cookie } = await loginAs(app)
    // sessão ativa: o corpo é lido e a rota decide (chave inexistente), sem o teto de antes do login
    expectError(await raw(app, 'PUT', '/api/kv/x', JSON.stringify({ value: 'y'.repeat(64 * 1024) }), { cookie }), 404, 'chave_desconhecida')
    // e as rotas de /api/auth não aceitam corpo grande nem de sessão ativa
    expect((await raw(app, 'POST', '/api/auth/password', big, { cookie })).statusCode).toBe(413)
  })

  describe('por HTTP', () => {
    let port = 0

    beforeAll(async () => {
      await app.listen({ port: 0, host: '127.0.0.1' })
      port = (app.server.address() as AddressInfo).port
    })

    it('corpo em partes (sem Content-Length) numa rota pública: 411 sem ler', async () => {
      const body = Buffer.from(JSON.stringify({ email: 'ninguem@x2win.bet.br', password: 'SenhaErrada123' }))
      const r = await httpReq(port, 'POST', '/api/auth/login', body, { chunked: true })
      expect(r.status, r.body).toBe(411)
      expect(r.headers.connection).toBe('close')
    })

    it('rajada anônima de corpos de ~12 MB (um IP, abaixo do limite de taxa) não trava a API', async () => {
      const payload = costlyJson(12 * 1024 * 1024 - 1024)
      const baseline = await httpReq(port, 'GET', '/api/health')
      expect(baseline.status).toBe(200)

      const h = monitorEventLoopDelay({ resolution: 10 })
      h.enable()
      const flood = Array.from({ length: 20 }, () => httpReq(port, 'PUT', '/api/kv/x', payload))
      await new Promise((r) => setTimeout(r, 15))
      const health = await httpReq(port, 'GET', '/api/health')
      const results = await Promise.all(flood)
      h.disable()

      expect(results.every((r) => r.status === 401)).toBe(true)
      expect(health.status).toBe(200)
      // antes da correção: health em ~2,2 s e o laço de eventos parado ~0,3 s por corpo parseado
      expect(health.ms).toBeLessThan(1000)
      expect(h.max / 1e6).toBeLessThan(200)
    })
  })
})

describe('fila do cálculo de senha (r2-resource-exhaustion-2)', () => {
  describe('createPasswordGate', () => {
    function deferred() {
      let resolve!: () => void
      let reject!: (e: Error) => void
      const promise = new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    }

    it('roda no máximo maxActive ao mesmo tempo, enfileira até maxQueued e recusa o resto sem rodar', async () => {
      const gate = createPasswordGate({ maxActive: 2, maxQueued: 2 })
      const started: number[] = []
      const jobs = Array.from({ length: 5 }, () => deferred())
      const runs = jobs.map((d, i) =>
        gate.run(async () => {
          started.push(i)
          await d.promise
          return i
        }),
      )
      const refused = runs[4].catch((e) => e)
      await new Promise((r) => setImmediate(r))
      expect(started).toEqual([0, 1])
      expect(gate.active).toBe(2)
      expect(gate.queued).toBe(2)
      expect(await refused).toBeInstanceOf(PasswordGateFull)

      // erro também devolve a vaga; a fila anda na ordem de chegada
      jobs[1].reject(new Error('falhou'))
      await expect(runs[1]).rejects.toThrow('falhou')
      await new Promise((r) => setImmediate(r))
      expect(started).toEqual([0, 1, 2])
      expect(gate.active).toBe(2)
      expect(gate.queued).toBe(1)

      jobs[0].resolve()
      jobs[2].resolve()
      jobs[3].resolve()
      expect(await Promise.all([runs[0], runs[2], runs[3]])).toEqual([0, 2, 3])
      expect(started).toEqual([0, 1, 2, 3])
      expect(gate.active).toBe(0)
      expect(gate.queued).toBe(0)
    })
  })

  describe('rotas', () => {
    let app: FastifyInstance
    let staff: TestUser

    beforeAll(async () => {
      app = await createTestApp()
      staff = await createUser(app, { roleId: 'suporte', password: 'SenhaForte123' })
    })
    afterAll(async () => {
      await app.close()
    })

    /** Ocupa todas as vagas e a fila da fila do processo; devolve quem as libera. */
    async function saturate() {
      let release!: () => void
      const hold = new Promise<void>((r) => (release = r))
      const total = PASSWORD_GATE_LIMITS.maxActive + PASSWORD_GATE_LIMITS.maxQueued
      const held = Array.from({ length: total }, () => passwordGate.run(() => hold))
      await new Promise((r) => setImmediate(r))
      expect(passwordGate.active).toBe(PASSWORD_GATE_LIMITS.maxActive)
      expect(passwordGate.queued).toBe(PASSWORD_GATE_LIMITS.maxQueued)
      return async () => {
        release()
        await Promise.all(held)
      }
    }

    it('com a fila cheia o login (de quem existe ou não) recusa na hora com 503 e Retry-After', async () => {
      const release = await saturate()
      try {
        for (const email of [staff.email, 'ninguem@x2win.bet.br']) {
          const t0 = performance.now()
          const r = await api(app, 'POST', '/api/auth/login', { ip: freshIp(), body: { email, password: 'SenhaErrada123' } })
          expectError(r, 503, 'servidor_ocupado')
          expect(r.headers['retry-after']).toBe(String(PASSWORD_BUSY_RETRY_AFTER_SECONDS))
          expect(performance.now() - t0).toBeLessThan(100)
        }
        // troca de senha de sessão ativa também passa pela fila
        const { cookie } = await loginAs(app)
        const pw = await api(app, 'POST', '/api/auth/password', { cookie, ip: freshIp(), body: { currentPassword: 'SenhaForte123', newPassword: 'OutraSenha456' } })
        expectError(pw, 503, 'servidor_ocupado')
      } finally {
        await release()
      }
      // fila livre: entra normalmente, e a recusa por fila cheia não contou como senha errada
      const ok = await api(app, 'POST', '/api/auth/login', { ip: freshIp(), body: { email: staff.email, password: staff.password } })
      expect(ok.statusCode, ok.body).toBe(200)
      const row = await app.db.one<{ failed_logins: number }>('select failed_logins from users where id = $1', [staff.id])
      expect(row?.failed_logins).toBe(0)
    })

    it('enxurrada de logins de IPs diferentes não ocupa o pool de threads inteiro (dns.lookup segue rápido)', async () => {
      await api(app, 'POST', '/api/auth/login', { ip: freshIp(), body: { email: 'aquece@x.y', password: 'x' } })
      const baselineDns = await dnsLookupMs()

      let peak = 0
      const sampler = setInterval(() => (peak = Math.max(peak, passwordGate.active)), 1)
      const N = 40
      const flood = Array.from({ length: N }, (_, i) =>
        api(app, 'POST', '/api/auth/login', {
          ip: `203.0.${Math.floor(i / 200)}.${(i % 200) + 1}`,
          body: { email: `atacante${i}@x.y`, password: 'qualquer' },
        }),
      )
      await new Promise((r) => setTimeout(r, 30))
      const dnsMs = await dnsLookupMs()
      const results = await Promise.all(flood)
      clearInterval(sampler)

      // cada origem está dentro do seu limite por IP: quem segura é a fila do processo
      expect(results.every((r) => r.statusCode === 401 || r.statusCode === 503)).toBe(true)
      const busy = results.filter((r) => r.statusCode === 503)
      expect(busy.length).toBeGreaterThanOrEqual(N - PASSWORD_GATE_LIMITS.maxActive - PASSWORD_GATE_LIMITS.maxQueued)
      for (const r of busy) {
        expect(r.json().error.code).toBe('servidor_ocupado')
        expect(r.headers['retry-after']).toBe(String(PASSWORD_BUSY_RETRY_AFTER_SECONDS))
      }
      expect(peak).toBeLessThanOrEqual(PASSWORD_GATE_LIMITS.maxActive)
      // antes da correção: ~0,9-1,3 s atrás dos 40 scrypt; agora sobra thread para o DNS
      expect(dnsMs).toBeLessThan(Math.max(50, baselineDns * 10))
    })
  })
})
