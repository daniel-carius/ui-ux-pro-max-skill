// PoC r1-authn-8: a implantação nginx enviada (deploy/nginx.conf) é só HTTP e,
// atrás de qualquer terminador TLS, reescreve X-Forwarded-For com o IP do
// terminador. Com TRUST_PROXY=1 (docker-compose.yml), todo cliente passa a
// dividir um único balde de 10/min no login.
//
// O teste sobe a API em processo (TRUST_PROXY=1, como no compose), o nginx real
// com deploy/nginx.conf (só listen/root/upstream adaptados) e, à frente, um
// proxy padrão que simula o terminador TLS (X-Forwarded-For anexado). Atacante
// e vítima saem de IPs de loopback diferentes (127.0.0.2 e 127.0.0.3).
// Afirma o comportamento seguro, então FALHA enquanto o problema existir.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, createUser } from './helpers'

const ROOT = resolve(__dirname, '../..')
const SHIPPED_CONF = readFileSync(join(ROOT, 'deploy/nginx.conf'), 'utf8')
const HAS_NGINX = spawnSync('nginx', ['-v']).status === 0

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port
      s.close(() => ok(p))
    })
    s.on('error', fail)
  })
}

function post(port: number, path: string, body: unknown, localAddress: string): Promise<{ status: number; body: string }> {
  const data = JSON.stringify(body)
  return new Promise((ok, fail) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'POST', localAddress, agent: false, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-requested-with': 'x2w' } },
      (res) => {
        let b = ''
        res.on('data', (c) => (b += c))
        res.on('end', () => ok({ status: res.statusCode ?? 0, body: b }))
      },
    )
    req.on('error', fail)
    req.end(data)
  })
}

async function waitUp(port: number) {
  for (let i = 0; i < 50; i++) {
    const up = await new Promise<boolean>((ok) => {
      const s = net.connect(port, '127.0.0.1', () => (s.end(), ok(true)))
      s.on('error', () => ok(false))
    })
    if (up) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`porta ${port} não subiu`)
}

describe('poc r1-authn-8: nginx enviado (HTTP puro, X-Forwarded-For atrás de TLS)', () => {
  it('deploy/nginx.conf termina TLS e envia HSTS', () => {
    expect(SHIPPED_CONF).toMatch(/listen\s+[^;]*443[^;]*ssl/)
    expect(SHIPPED_CONF).toMatch(/Strict-Transport-Security/i)
  })

  describe.skipIf(!HAS_NGINX)('atrás de um terminador TLS padrão', () => {
    let app: FastifyInstance
    let nginx: ChildProcess
    let dir: string
    let lbPort: number
    let victim: { email: string; password: string }

    beforeAll(async () => {
      app = await createTestApp({ TRUST_PROXY: '1' })
      const u = await createUser(app, { roleId: 'suporte' })
      victim = { email: u.email, password: u.password }
      await app.listen({ port: 0, host: '127.0.0.1' })
      const apiPort = (app.server.address() as net.AddressInfo).port
      const edgePort = await freePort()
      lbPort = await freePort()
      dir = mkdtempSync(join(tmpdir(), 'poc-authn-8-'))
      const shipped = SHIPPED_CONF.replace('listen 80;', `listen 127.0.0.1:${edgePort};`)
        .replace('root /usr/share/nginx/html;', `root ${dir};`)
        .replace('proxy_pass http://api:3333;', `proxy_pass http://127.0.0.1:${apiPort};`)
      expect(shipped).toContain(`127.0.0.1:${apiPort}`)
      writeFileSync(
        join(dir, 'main.conf'),
        `pid ${dir}/nginx.pid;
error_log ${dir}/error.log;
events {}
http {
  access_log off;
  client_body_temp_path ${dir}/cb; proxy_temp_path ${dir}/px; fastcgi_temp_path ${dir}/fc; uwsgi_temp_path ${dir}/uw; scgi_temp_path ${dir}/sc;
  ${shipped}
  # terminador TLS / balanceador à frente do nginx enviado (configuração padrão)
  server {
    listen 127.0.0.1:${lbPort};
    location / {
      proxy_pass http://127.0.0.1:${edgePort};
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto https;
    }
  }
}
`,
      )
      nginx = spawn('nginx', ['-p', dir, '-c', join(dir, 'main.conf'), '-g', 'daemon off;'], { stdio: 'ignore' })
      await waitUp(edgePort)
      await waitUp(lbPort)
    }, 30_000)

    afterAll(async () => {
      nginx?.kill('SIGTERM')
      await app?.close()
      if (dir) rmSync(dir, { recursive: true, force: true })
    })

    it('10 logins errados de um atacante não bloqueiam o login de outra pessoa (outro IP)', async () => {
      for (let i = 0; i < 10; i++) {
        const r = await post(lbPort, '/api/auth/login', { email: `ninguem${i}@atacante.test`, password: 'errada-errada' }, '127.0.0.2')
        expect(r.status).toBe(401)
      }
      const v = await post(lbPort, '/api/auth/login', victim, '127.0.0.3')
      // hoje: 429 muitas_tentativas, porque a API vê o IP do terminador para todos
      expect(v.body).not.toContain('muitas_tentativas')
      expect(v.status).toBe(200)
    }, 30_000)
  })
})
