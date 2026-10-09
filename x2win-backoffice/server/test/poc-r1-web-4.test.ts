// PoC r1-web-4: NODE_ENV ausente (npm start + .env.example) => config cai em 'development'
// e a proteção contra SSRF dos webhooks fica desligada. Este teste afirma o comportamento
// seguro e FALHA enquanto o problema existir.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'
import { api, createTestApp, loginAs } from './helpers'

let server: Server
let port = 0
const hits: { url: string; headers: Record<string, unknown> }[] = []

beforeAll(async () => {
  // "serviço só local" no host da API
  server = createServer((req, res) => {
    hits.push({ url: req.url ?? '', headers: req.headers })
    req.resume()
    res.writeHead(418)
    res.end('internal-admin')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as AddressInfo).port
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((r) => server.close(() => r()))
})

describe('PoC r1-web-4: NODE_ENV default', () => {
  it('config sem NODE_ENV (como .env.example) não deveria virar development', () => {
    const cfg = loadConfig({
      APP_SECRET: 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres',
      ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
    })
    console.log('NODE_ENV efetivo sem variável:', cfg.NODE_ENV, '| COOKIE_SECURE:', cfg.COOKIE_SECURE)
    // seguro: sem NODE_ENV explícito, aplicar as proteções de produção
    expect(cfg.NODE_ENV).toBe('production')
  })

  it('sem NODE_ENV, destino http://127.0.0.1:<porta interna> deveria ser recusado e nada enviado', async () => {
    // remove o NODE_ENV=test do kit => mesmo efeito de subir com .env.example
    const app = await createTestApp({ NODE_ENV: undefined })
    try {
      console.log('app.config.NODE_ENV =', app.config.NODE_ENV)
      const { cookie } = await loginAs(app, 'superadmin')
      const url = `http://127.0.0.1:${port}/admin/internal`
      const put = await api(app, 'PUT', '/api/kv/campanhas.webhooks.destinos', {
        cookie,
        body: { value: [{ id: 'poc1', event: 'saque.pago', url, active: true, secret: 'segredo-poc-123456' }] },
      })
      console.log('PUT destino ->', put.statusCode, put.body.slice(0, 200))
      if (put.statusCode === 200) {
        const t = await api(app, 'POST', '/api/webhooks/destinations/poc1/test', { cookie })
        const ex = t.json().execution
        console.log('POST test ->', t.statusCode, JSON.stringify({ status: ex?.status, httpStatus: ex?.httpStatus, error: ex?.error }))
        console.log('requisições recebidas pelo serviço interno:', JSON.stringify(hits.map((h) => ({ url: h.url, sig: h.headers['x-x2w-signature'] ? 'sim' : 'nao' }))))
      }
      // seguro: endereço interno via http recusado e nenhuma requisição chega ao serviço local
      expect(put.statusCode).toBe(400)
      expect(hits).toHaveLength(0)
    } finally {
      await app.close()
    }
  })

  it('controle: com NODE_ENV=production o mesmo destino é recusado', async () => {
    const app = await createTestApp({ NODE_ENV: 'production' })
    try {
      const { cookie } = await loginAs(app, 'superadmin')
      const put = await api(app, 'PUT', '/api/kv/campanhas.webhooks.destinos', {
        cookie,
        body: { value: [{ id: 'poc2', event: 'saque.pago', url: `http://127.0.0.1:${port}/x`, active: true, secret: 'segredo-poc-123456' }] },
      })
      console.log('[controle production] PUT destino ->', put.statusCode, put.body.slice(0, 200))
      expect(put.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })
})
