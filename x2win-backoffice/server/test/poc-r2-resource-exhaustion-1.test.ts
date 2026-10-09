// PoC R2 — DoS anônimo: corpos JSON de ~12 MB são lidos e parseados ANTES da
// autenticação, bloqueando a única thread do Node.
//
// Mecânica (confirmada no código):
//   - buildApp define bodyLimit: 12*1024*1024 global (src/app.ts:38).
//   - Os hooks onRequest de plugins/security.ts e plugins/session.ts NÃO rejeitam
//     o anônimo: security só confere HTTPS (desligado sem TLS), o cabeçalho CSRF
//     estático ('x-requested-with: x2w') e a allowlist de IP (vazia = libera tudo);
//     session apenas faz req.auth = null.
//   - requireActive()/requirePerm() só rodam DENTRO do handler, que no ciclo do
//     Fastify executa DEPOIS da fase de parsing. Logo o corpo de até 12 MB é
//     bufferizado e passado ao JSON.parse (síncrono, bloqueante) antes do 401.
//
// Os dois testes asseguram o comportamento SEGURO e por isso FALHAM enquanto o
// bug existe. Um conserto correto (rejeitar o anônimo em onRequest/preParsing, ou
// um bodyLimit pequeno antes da autenticação) faz ambos passarem.
import { describe, it, expect } from 'vitest'
import http from 'node:http'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { SECURITY } from '../src/config'
import { createTestApp } from './helpers'

const LIMIT = 12 * 1024 * 1024 // 12 MiB, igual ao bodyLimit global

/** Monta um JSON válido logo abaixo do bodyLimit (não dispara 413). */
function bodyUnderLimit(): Buffer {
  const arr: unknown[] = []
  let approx = 20
  while (approx < LIMIT - 60) {
    arr.push({ a: arr.length, b: 'xxxxxxxxxx', c: arr.length * 2 })
    approx += 42
  }
  let s = JSON.stringify({ value: arr })
  while (s.length > LIMIT) {
    arr.pop()
    s = JSON.stringify({ value: arr })
  }
  return Buffer.from(s)
}

function httpReq(port: number, method: string, path: string, body?: Buffer): Promise<{ status: number; ms: number }> {
  return new Promise((resolve, reject) => {
    const start = performance.now()
    const r = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          'content-type': 'application/json',
          [SECURITY.csrfHeader]: SECURITY.csrfValue,
          ...(body ? { 'content-length': body.length } : {}),
        },
      },
      (res) => {
        res.on('data', () => {})
        res.on('end', () => resolve({ status: res.statusCode ?? 0, ms: performance.now() - start }))
      },
    )
    r.on('error', reject)
    r.end(body)
  })
}

describe('R2 — anonymous large-body DoS (parse antes da autenticação)', () => {
  // (A) Ordenação determinística: corpo JSON inválido, anônimo, numa rota protegida.
  //     SEGURO  -> 401 (a sessão ausente é barrada antes de tocar no corpo).
  //     BUG     -> 400 (o JSON.parse roda primeiro e falha, provando parse-antes-de-auth).
  it('rejeita o anônimo ANTES de parsear o corpo (JSON inválido deveria dar 401, não 400)', async () => {
    const app = await createTestApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/team/direct', // exige permissão equipe.editar
        remoteAddress: '203.0.113.7',
        headers: { 'content-type': 'application/json', [SECURITY.csrfHeader]: SECURITY.csrfValue },
        payload: '{ isto nao e json valido ',
      })
      // Comportamento seguro: autenticação barra o anônimo sem parsear o corpo.
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  // (B) Impacto real sobre HTTP: uma rajada anônima de corpos ~12 MB (um único IP,
  //     bem abaixo do teto de 600/min) satura a thread e trava o /api/health.
  //     SEGURO  -> o health responde rápido mesmo sob a rajada.
  //     BUG     -> o health fica em vários segundos (parse síncrono em série).
  it('mantém a API responsiva sob rajada anônima de 12 MB (health não deve estourar)', async () => {
    const app = await createTestApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    try {
      const addr = app.server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      const payload = bodyUnderLimit()
      expect(payload.length).toBeLessThanOrEqual(LIMIT)

      const baseline = await httpReq(port, 'GET', '/api/health')
      expect(baseline.status).toBe(200)

      const h = monitorEventLoopDelay({ resolution: 10 })
      h.enable()

      const N = 20 // << 600/min: não é barrado pelo rate limit
      const flood: Promise<{ status: number; ms: number }>[] = []
      for (let i = 0; i < N; i++) flood.push(httpReq(port, 'PUT', '/api/kv/x', payload))

      // dispara o health logo após o início da rajada
      await new Promise((r) => setTimeout(r, 15))
      const healthUnderLoad = await httpReq(port, 'GET', '/api/health')

      const results = await Promise.all(flood)
      h.disable()

      // Todos passam pelo parse e só então recebem 401 — nenhum barrado antes (sem 413, sem 429).
      expect(results.every((r) => r.status === 401)).toBe(true)

      const loopMaxMs = h.max / 1e6
      // eslint-disable-next-line no-console
      console.log(
        `[R2] baseline health ${baseline.ms.toFixed(0)}ms | health sob carga ${healthUnderLoad.ms.toFixed(0)}ms | loop delay max ${loopMaxMs.toFixed(0)}ms`,
      )

      // Comportamento seguro: outros clientes continuam sendo atendidos rápido.
      expect(healthUnderLoad.ms).toBeLessThan(1000)
    } finally {
      await app.close()
    }
  })
})
