// Regressões da implantação (achados r1-authn-8, r1-web-2 e r1-frontend-3): deploy/nginx.conf termina TLS com
// HSTS, manda os cabeçalhos de segurança (com CSP) em toda resposta do painel, e o IP do cliente chega certo à
// API com o nginx na borda ou atrás de um balanceador. A parte com nginx real é pulada se não houver nginx/openssl.
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, createUser } from './helpers'

const ROOT = resolve(__dirname, '../..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const NGINX_CONF = read('deploy/nginx.conf')
const HEADERS_CONF = read('deploy/security-headers.conf')
const SNIPPET_PATH = '/etc/nginx/snippets/x2win-security-headers.conf'
const noComments = (s: string) => s.replace(/#[^\n]*/g, '')

const SECURITY_HEADERS = {
  'strict-transport-security': /^max-age=31536000; includeSubDomains$/,
  'x-content-type-options': /^nosniff$/,
  'x-frame-options': /^DENY$/,
  'referrer-policy': /^strict-origin-when-cross-origin$/,
  'permissions-policy': /camera=\(\)/,
  'content-security-policy': /frame-ancestors 'none'/,
}

/** Diretivas da CSP do painel, como mapa diretiva -> fontes. */
function csp(): Record<string, string[]> {
  const m = noComments(HEADERS_CONF).match(/add_header\s+Content-Security-Policy\s+"([^"]+)"\s+always;/)
  expect(m, 'CSP ausente em deploy/security-headers.conf').toBeTruthy()
  return Object.fromEntries(
    m![1]
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([k, ...v]) => [k, v]),
  )
}

describe('deploy/nginx.conf e deploy/security-headers.conf (estático)', () => {
  const conf = noComments(NGINX_CONF)

  it('HTTP só redireciona para HTTPS; HTTPS com TLS 1.2+ e certificado montado', () => {
    expect(conf).toMatch(/server\s*\{\s*listen 80;\s*server_name _;\s*return 301 https:\/\/\$host\$request_uri;\s*\}/)
    expect(conf).toMatch(/listen\s+443\s+ssl;/)
    expect(conf).toMatch(/ssl_protocols TLSv1\.2 TLSv1\.3;/)
    expect(conf).toMatch(/ssl_certificate \/etc\/nginx\/certs\/fullchain\.pem;/)
    expect(conf).toMatch(/ssl_certificate_key \/etc\/nginx\/certs\/privkey\.pem;/)
  })

  it('a API recebe um único IP (o da conexão, ou o do cliente via realip) e o esquema real', () => {
    expect(conf).toMatch(/proxy_set_header X-Forwarded-For \$remote_addr;/)
    expect(conf).not.toMatch(/\$proxy_add_x_forwarded_for/)
    expect(conf).toMatch(/proxy_set_header X-Forwarded-Proto \$scheme;/)
    // a topologia com balanceador fica documentada (e desligada por padrão)
    expect(NGINX_CONF).toMatch(/#\s*set_real_ip_from\s+\S+;/)
    expect(NGINX_CONF).toMatch(/#\s*real_ip_header X-Forwarded-For;/)
    expect(NGINX_CONF).toMatch(/#\s*real_ip_recursive on;/)
  })

  it('toda location com add_header própria inclui os cabeçalhos de segurança (o nginx não herda)', () => {
    const https = conf.slice(conf.indexOf('listen 443'))
    const locations = [...https.matchAll(/location\s+(\S+)\s*\{([^}]*)\}/g)]
    expect(locations.map((l) => l[1])).toEqual(expect.arrayContaining(['/assets/', '/api/', '/']))
    for (const [, name, body] of locations) {
      if (/add_header/.test(body)) expect(body, `location ${name}`).toContain(`include ${SNIPPET_PATH};`)
    }
    // e o nível do server (vale para as locations sem add_header, como /api/)
    const serverLevel = https.replace(/location\s+\S+\s*\{[^}]*\}/g, '')
    expect(serverLevel).toContain(`include ${SNIPPET_PATH};`)
  })

  it('o snippet traz HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy e CSP, todos com always', () => {
    const lines = noComments(HEADERS_CONF)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const names = lines.map((l) => l.match(/^add_header\s+([\w-]+)/)?.[1].toLowerCase())
    expect(names).toEqual(expect.arrayContaining(Object.keys(SECURITY_HEADERS)))
    for (const l of lines) expect(l, l).toMatch(/ always;$/)
  })

  it('CSP: sem frame, sem plugin, sem base, script só do domínio e do script de tema (hash confere com index.html)', () => {
    const d = csp()
    expect(d['frame-ancestors']).toEqual(["'none'"])
    expect(d['object-src']).toEqual(["'none'"])
    expect(d['base-uri']).toEqual(["'none'"])
    expect(d['default-src']).toEqual(["'self'"])
    expect(d['connect-src']).toEqual(["'self'"])
    expect(d['script-src']).not.toContain("'unsafe-inline'")
    expect(d['script-src']).not.toContain("'unsafe-eval'")
    expect(d['img-src']).not.toContain('https:')
    expect(d['img-src']).not.toContain('*')
    const html = read('index.html')
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
    expect(inline.length).toBeGreaterThan(0)
    for (const body of inline) {
      const hash = `'sha256-${createHash('sha256').update(body).digest('base64')}'`
      expect(d['script-src'], 'recalcule o hash do script embutido em index.html').toContain(hash)
    }
  })

  it('Dockerfile.web instala o snippet onde o nginx.conf o inclui; compose publica 443 com o certificado', () => {
    const web = read('Dockerfile.web')
    expect(web).toContain(`COPY deploy/security-headers.conf ${SNIPPET_PATH}`)
    expect(web).not.toMatch(/^COPY \. \.$/m)
    const compose = read('docker-compose.yml')
    expect(compose).toMatch(/- "443:443"/)
    expect(compose).toMatch(/\.\/deploy\/certs:\/etc\/nginx\/certs:ro/)
    expect(compose).toMatch(/TRUST_PROXY: "1"/)
    expect(compose).toMatch(/COOKIE_SECURE: "true"/)
  })

  it('compose: a API conecta com o papel de execução e não recebe a senha do dono do banco', () => {
    const compose = read('docker-compose.yml')
    const api = compose.slice(compose.indexOf('\n  api:'), compose.indexOf('\n  web:'))
    expect(api).toMatch(/DATABASE_URL: postgres:\/\/x2win_app:\$\{APP_DB_PASSWORD\}@db:5432\/x2win/)
    expect(api).toMatch(/POSTGRES_PASSWORD: ""/)
    expect(api).toMatch(/condition: service_completed_successfully/)
    const migrateSvc = compose.slice(compose.indexOf('\n  migrate:'), compose.indexOf('\n  api:'))
    expect(migrateSvc).toMatch(/command: \["node", "dist\/migrate\.js"\]/)
    expect(read('Dockerfile.api')).toMatch(/esbuild src\/migrate\.ts/)
    expect(read('deploy/db-init/10-x2win-app-role.sh')).toMatch(/create role x2win_app login password :'app_pw' nosuperuser/)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// nginx real com o nginx.conf entregue (só portas, caminhos e upstream trocados).

function has(cmd: string, args: string[]) {
  try {
    return spawnSync(cmd, args, { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}
const HAS_TOOLS = has('nginx', ['-v']) && has('openssl', ['version'])

function nginxVersion(): number[] {
  const out = spawnSync('nginx', ['-v'], { encoding: 'utf8' })
  const m = `${out.stderr}${out.stdout}`.match(/nginx\/(\d+)\.(\d+)\.(\d+)/)
  return m ? m.slice(1).map(Number) : [0, 0, 0]
}

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

async function waitUp(port: number) {
  for (let i = 0; i < 100; i++) {
    const up = await new Promise<boolean>((ok) => {
      const s = net.connect(port, '127.0.0.1', () => (s.end(), ok(true)))
      s.on('error', () => ok(false))
    })
    if (up) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`porta ${port} não subiu`)
}

interface Res {
  status: number
  headers: http.IncomingHttpHeaders
  raw: string[]
  body: string
}

function request(
  opts: { tls: boolean; port: number; path: string; method?: string; body?: unknown; localAddress?: string; headers?: Record<string, string> },
): Promise<Res> {
  const data = opts.body === undefined ? undefined : JSON.stringify(opts.body)
  const mod = opts.tls ? https : http
  return new Promise((ok, fail) => {
    const req = mod.request(
      {
        host: '127.0.0.1',
        port: opts.port,
        path: opts.path,
        method: opts.method ?? 'GET',
        localAddress: opts.localAddress,
        agent: false,
        rejectUnauthorized: false,
        servername: 'painel.teste',
        headers: {
          host: 'painel.teste',
          ...(data ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(data)), 'x-requested-with': 'x2w' } : {}),
          ...(opts.headers ?? {}),
        },
      },
      (res) => {
        let b = ''
        res.on('data', (c) => (b += c))
        res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, raw: res.rawHeaders, body: b }))
      },
    )
    req.on('error', fail)
    req.end(data)
  })
}

/** Quantas vezes um cabeçalho veio na resposta (duplicado = valores conflitantes). */
const occurrences = (r: Res, name: string) => r.raw.filter((_, i) => i % 2 === 0).filter((h) => h.toLowerCase() === name).length

describe.skipIf(!HAS_TOOLS)('deploy/nginx.conf rodando no nginx real', () => {
  let app: FastifyInstance
  let nginx: ChildProcess
  let dir = ''
  // borda: o nginx entregue sozinho na frente (padrão)
  let edgeHttp = 0
  let edgeHttps = 0
  // atrás de balanceador: o nginx entregue com o realip descomentado
  let innerHttp = 0
  let innerHttps = 0
  let lb = 0
  let victim: { email: string; password: string }

  beforeAll(async () => {
    app = await createTestApp({ TRUST_PROXY: '1', COOKIE_SECURE: 'true' })
    app.get('/api/_teste/cliente', async (req) => ({ ip: req.clientIp, protocol: req.protocol }))
    const u = await createUser(app, { roleId: 'suporte' })
    victim = { email: u.email, password: u.password }
    await app.listen({ port: 0, host: '127.0.0.1' })
    const apiPort = (app.server.address() as net.AddressInfo).port
    ;[edgeHttp, edgeHttps, innerHttp, innerHttps, lb] = await Promise.all([freePort(), freePort(), freePort(), freePort(), freePort()])

    dir = mkdtempSync(join(tmpdir(), 'x2w-nginx-'))
    const html = join(dir, 'html')
    mkdirSync(join(html, 'assets'), { recursive: true })
    mkdirSync(join(dir, 'tmp'))
    writeFileSync(join(html, 'index.html'), '<!doctype html><title>painel</title>')
    writeFileSync(join(html, 'assets', 'index-abc123.js'), 'console.log(1)')
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=painel.teste', '-keyout', join(dir, 'privkey.pem'), '-out', join(dir, 'fullchain.pem')], {
      stdio: 'ignore',
    })

    const [maj, min, patch] = nginxVersion()
    const supportsHttp2On = maj > 1 || (maj === 1 && (min > 25 || (min === 25 && patch >= 1)))
    const adapt = (httpPort: number, httpsPort: number, realIp: boolean) => {
      let c = NGINX_CONF.replace(/listen 80;/, `listen 127.0.0.1:${httpPort};`)
        .replace(/listen 443 ssl;/, `listen 127.0.0.1:${httpsPort} ssl;`)
        .replace('/etc/nginx/certs/fullchain.pem', join(dir, 'fullchain.pem'))
        .replace('/etc/nginx/certs/privkey.pem', join(dir, 'privkey.pem'))
        .replace('root /usr/share/nginx/html;', `root ${html};`)
        .replace('proxy_pass http://api:3333;', `proxy_pass http://127.0.0.1:${apiPort};`)
        .split(`include ${SNIPPET_PATH};`)
        .join(`include ${join(ROOT, 'deploy/security-headers.conf')};`)
      if (!supportsHttp2On) c = c.replace(/http2 on;/, '')
      if (realIp) {
        // a "faixa do balanceador" aqui é só o endereço de onde o balanceador de teste conecta
        c = c
          .replace(/#\s*set_real_ip_from\s+\S+;/, 'set_real_ip_from 127.0.0.1;')
          .replace(/#\s*real_ip_header X-Forwarded-For;/, 'real_ip_header X-Forwarded-For;')
          .replace(/#\s*real_ip_recursive on;/, 'real_ip_recursive on;')
        expect(c).toContain('set_real_ip_from 127.0.0.1;')
      }
      expect(c).toContain(`127.0.0.1:${apiPort}`)
      return c
    }
    const mime = ['/etc/nginx/mime.types', '/usr/local/nginx/conf/mime.types'].find((p) => existsSync(p))
    const t = join(dir, 'tmp')
    writeFileSync(
      join(dir, 'nginx.conf'),
      `${process.getuid?.() === 0 ? 'user root;\n' : ''}worker_processes 1;
pid ${dir}/nginx.pid;
error_log ${dir}/error.log;
events { worker_connections 64; }
http {
  ${mime ? `include ${mime};` : ''}
  access_log off;
  client_body_temp_path ${t}; proxy_temp_path ${t}; fastcgi_temp_path ${t}; uwsgi_temp_path ${t}; scgi_temp_path ${t};
  ${adapt(edgeHttp, edgeHttps, false)}
  ${adapt(innerHttp, innerHttps, true)}
  # balanceador / terminador TLS padrão à frente (anexa o IP ao X-Forwarded-For e fala HTTPS com o nginx)
  server {
    listen 127.0.0.1:${lb};
    location / {
      proxy_pass https://127.0.0.1:${innerHttps};
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto https;
    }
  }
}
`,
    )
    const check = spawnSync('nginx', ['-t', '-p', dir, '-c', join(dir, 'nginx.conf')], { encoding: 'utf8' })
    expect(check.status, check.stderr).toBe(0)
    nginx = spawn('nginx', ['-p', dir, '-c', join(dir, 'nginx.conf'), '-g', 'daemon off;'], { stdio: 'ignore' })
    await Promise.all([edgeHttp, edgeHttps, innerHttp, innerHttps, lb].map(waitUp))
  }, 60_000)

  afterAll(async () => {
    nginx?.kill('SIGQUIT')
    await app?.close()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('HTTP redireciona para HTTPS sem encaminhar nada (nem /api)', async () => {
    for (const path of ['/', '/api/auth/login']) {
      const r = await request({ tls: false, port: edgeHttp, path, method: path === '/' ? 'GET' : 'POST', body: path === '/' ? undefined : victim })
      expect(r.status).toBe(301)
      expect(r.headers.location).toBe(`https://painel.teste${path}`)
      expect(r.headers['set-cookie']).toBeUndefined()
    }
  })

  for (const path of ['/', '/index.html', '/operacao/saques', '/assets/index-abc123.js', '/assets/nao-existe.js', '/api/health']) {
    it(`GET ${path} por HTTPS traz os cabeçalhos de segurança, cada um uma vez`, async () => {
      const r = await request({ tls: true, port: edgeHttps, path })
      expect(r.status).toBe(path.includes('nao-existe') ? 404 : 200)
      for (const [name, re] of Object.entries(SECURITY_HEADERS)) {
        expect(r.headers[name], `${name} em ${path}`).toMatch(re)
        expect(occurrences(r, name), `${name} duplicado em ${path}`).toBe(1)
      }
    })
  }

  it('o Cache-Control de cada location continua valendo', async () => {
    expect((await request({ tls: true, port: edgeHttps, path: '/' })).headers['cache-control']).toBe('no-cache')
    expect((await request({ tls: true, port: edgeHttps, path: '/assets/index-abc123.js' })).headers['cache-control']).toBe('public, max-age=31536000, immutable')
  })

  it('nginx na borda: a API vê o IP da conexão e HTTPS; X-Forwarded-For forjado é descartado', async () => {
    const r = await request({ tls: true, port: edgeHttps, path: '/api/_teste/cliente', localAddress: '127.0.0.4', headers: { 'x-forwarded-for': '6.6.6.6', 'x-forwarded-proto': 'http' } })
    expect(JSON.parse(r.body)).toEqual({ ip: '127.0.0.4', protocol: 'https' })
  })

  it('atrás do balanceador (realip): cada cliente chega com o próprio IP, e forjar X-Forwarded-For não adianta', async () => {
    const a = await request({ tls: false, port: lb, path: '/api/_teste/cliente', localAddress: '127.0.0.2' })
    const b = await request({ tls: false, port: lb, path: '/api/_teste/cliente', localAddress: '127.0.0.3', headers: { 'x-forwarded-for': '6.6.6.6' } })
    expect(JSON.parse(a.body)).toEqual({ ip: '127.0.0.2', protocol: 'https' })
    expect(JSON.parse(b.body)).toEqual({ ip: '127.0.0.3', protocol: 'https' })
  })

  it('atrás do balanceador: 10 logins errados de um atacante não bloqueiam o login de outra pessoa', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await request({ tls: false, port: lb, path: '/api/auth/login', method: 'POST', localAddress: '127.0.0.2', body: { email: `ninguem${i}@atacante.test`, password: 'errada-errada' } })
      expect(r.status).toBe(401)
    }
    const blocked = await request({ tls: false, port: lb, path: '/api/auth/login', method: 'POST', localAddress: '127.0.0.2', body: { email: 'ninguem@atacante.test', password: 'errada-errada' } })
    expect(blocked.status).toBe(429)
    const v = await request({ tls: false, port: lb, path: '/api/auth/login', method: 'POST', localAddress: '127.0.0.3', body: victim })
    expect(v.body).not.toContain('muitas_tentativas')
    expect(v.status).toBe(200)
    expect(String(v.headers['set-cookie'])).toMatch(/; Secure/)
  })
})
