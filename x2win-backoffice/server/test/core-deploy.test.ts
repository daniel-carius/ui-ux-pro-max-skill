// Regressões da implantação (achados r1-authn-8, r1-web-2 e r1-frontend-3): deploy/nginx.conf termina TLS com
// HSTS, manda os cabeçalhos de segurança (com CSP) em toda resposta do painel, e o IP do cliente chega certo à
// API com o nginx na borda ou atrás de um balanceador. Também: limite de corpo do nginx igual ao da API (1m, e 12m
// só em /api/kv/), imagem da API (build, pool de threads, healthcheck) e o que fica fora do contexto do Docker.
// A parte com nginx real é pulada se não houver nginx/openssl.
import { build } from 'esbuild'
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
/** Blocos location do server HTTPS: [nome, corpo]. Aceita o modificador (ex.: "location ^~ /api/kv/ {"). */
const locationsOf = (conf: string) =>
  [...conf.slice(conf.indexOf('listen 443')).matchAll(/location\s+(?:[=~^*]+\s+)?(\S+)\s*\{([^}]*)\}/g)].map((m) => [m[1], m[2]] as const)

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
    const locations = locationsOf(conf)
    expect(locations.map((l) => l[0])).toEqual(expect.arrayContaining(['/assets/', '/api/', '/api/kv/', '/']))
    for (const [name, body] of locations) {
      if (/add_header/.test(body)) expect(body, `location ${name}`).toContain(`include ${SNIPPET_PATH};`)
    }
    // e o nível do server (vale para as locations sem add_header, como /api/)
    const serverLevel = https.replace(/location\s+(?:[=~^*]+\s+)?\S+\s*\{[^}]*\}/g, '')
    expect(serverLevel).toContain(`include ${SNIPPET_PATH};`)
  })

  // O nginx aceitava 12m em toda a /api/: qualquer rota recebia (e repassava à API) corpos de 12 MB. Agora o limite é
  // o da API (1 MiB) e só /api/kv/ (imagens e importações, limite próprio nas rotas da API) aceita 12m.
  it('limite de corpo: 1m em /api/ e 12m só em /api/kv/, que repete as regras de /api/', () => {
    const loc = Object.fromEntries(locationsOf(conf))
    expect(loc['/api/']).toMatch(/^\s*client_max_body_size 1m;$/m)
    expect(loc['/api/kv/']).toMatch(/^\s*client_max_body_size 12m;$/m)
    expect(conf).toMatch(/location \^~ \/api\/kv\/ \{/)
    // nenhuma outra location passa de 1m
    for (const [name, body] of locationsOf(conf)) {
      if (name !== '/api/kv/') expect(body, name).not.toMatch(/client_max_body_size (?!1m;)/)
    }
    // mesmas diretivas de proxy, resolver e cabeçalhos (sem add_header: herda os do server)
    const rules = (b: string) =>
      b
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('client_max_body_size'))
    expect(rules(loc['/api/kv/'])).toEqual(rules(loc['/api/']))
    expect(loc['/api/kv/']).not.toMatch(/add_header/)
    // a recusa do nginx sai no formato de erro da API
    expect(loc['/api/']).toMatch(/^\s*error_page 413 = @x2w_corpo_grande;$/m)
    expect(loc['@x2w_corpo_grande']).toContain('"code":"corpo_grande_demais"')
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
    // dist/migrate.js sai do mesmo build da API (npm run build), sem um esbuild à parte no Dockerfile.api
    const pkg = JSON.parse(read('server/package.json')) as { scripts: Record<string, string> }
    expect(pkg.scripts.build).toMatch(/^esbuild src\/index\.ts src\/seed\.ts src\/migrate\.ts /)
    expect(read('Dockerfile.api')).toMatch(/RUN cd server && npm run build && npm prune --omit=dev/)
    expect(read('Dockerfile.api')).not.toMatch(/esbuild src\/migrate\.ts/)
    expect(read('deploy/db-init/10-x2win-app-role.sh')).toMatch(/create role x2win_app login password :'app_pw' nosuperuser/)
  })

  // NODE_ENV ausente agora vale produção: o desenvolvimento local diz development nos scripts do npm.
  it('npm run dev roda em development; seed e migrate usam development só sem NODE_ENV', () => {
    const { scripts, engines } = JSON.parse(read('server/package.json')) as { scripts: Record<string, string>; engines: Record<string, string> }
    // server/.env é lido quando existe (--env-file-if-exists, Node 22.9+); variável exportada no shell vale mais que o arquivo
    expect(scripts.dev).toBe('NODE_ENV=development tsx watch --env-file-if-exists=.env src/index.ts')
    expect(scripts.seed).toBe('NODE_ENV=${NODE_ENV:-development} tsx --env-file-if-exists=.env src/seed.ts')
    expect(scripts.migrate).toBe('NODE_ENV=${NODE_ENV:-development} tsx --env-file-if-exists=.env src/migrate.ts')
    expect(engines.node).toBe('>=22.9')
    expect(scripts.start).toBe('node dist/index.js')
    // a imagem fixa production (não depende do padrão)
    expect(read('Dockerfile.api')).toMatch(/^ENV NODE_ENV=production$/m)
  })

  // password-gate.ts usa metade do pool do libuv para o scrypt: com o padrão (4 threads) só 2 senhas por vez.
  it('Dockerfile.api: pool de threads do libuv com 16 (UV_THREADPOOL_SIZE) na imagem final', () => {
    const api = read('Dockerfile.api')
    const final = api.slice(api.lastIndexOf('\nFROM '))
    expect(final).toMatch(/^ENV UV_THREADPOOL_SIZE=16$/m)
  })

  // deploy/certs (certificado e chave privada do TLS) entrava no contexto de build enviado ao Docker.
  it('.dockerignore deixa fora do contexto o .env e os certificados', () => {
    const lines = read('.dockerignore')
      .split('\n')
      .map((l) => l.trim())
    for (const entry of ['deploy/certs', 'deploy/.env', '**/.env', '**/node_modules']) expect(lines, entry).toContain(entry)
  })

  // A imagem da API só copia de src/ (o painel) o que os dados de demonstração usam: arquivo novo importado pelo
  // servidor e não copiado quebra o build do Docker ("Could not resolve").
  it('Dockerfile.api copia todo arquivo de src/ que o bundle do servidor importa', async () => {
    const meta = await build({
      entryPoints: ['src/index.ts', 'src/seed.ts', 'src/migrate.ts'].map((f) => join(ROOT, 'server', f)),
      absWorkingDir: join(ROOT, 'server'),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      packages: 'external',
      write: false,
      outdir: 'dist',
      metafile: true,
      logLevel: 'silent',
    })
    const used = Object.keys(meta.metafile.inputs)
      .map((f) => resolve(ROOT, 'server', f))
      .filter((f) => f.startsWith(join(ROOT, 'src') + '/'))
      .map((f) => f.slice(ROOT.length + 1))
    expect(used.length).toBeGreaterThan(0)
    const copied = [...read('Dockerfile.api').matchAll(/^COPY (src\/\S+) \.\/(\S+)$/gm)].map((m) => {
      expect(m[2], 'mesmo caminho dentro da imagem').toBe(m[1])
      return m[1]
    })
    for (const f of used) expect(copied.some((c) => f === c || f.startsWith(c.replace(/\/?$/, '/'))), f).toBe(true)
  })

  // r3-process-resilience-and-restart-2: sem a chave restart o Docker usa "no" e um crash da API, do banco ou um
  // reinício do dockerd/host deixava o painel fora do ar até alguém intervir. "on-failure" não basta: o Docker não o
  // aplica quando o daemon reinicia.
  it('compose: db, api e web voltam sozinhos (restart unless-stopped); só o migrate é passo único', () => {
    const compose = read('docker-compose.yml')
    const block = (name: string) => {
      const lines = compose.split('\n')
      const start = lines.indexOf(`  ${name}:`)
      expect(start, `serviço ${name}`).toBeGreaterThan(-1)
      const end = lines.findIndex((l, i) => i > start && /^ {0,2}\S/.test(l))
      return lines.slice(start + 1, end).join('\n')
    }
    for (const name of ['db', 'api', 'web']) expect(block(name), name).toMatch(/^ {4}restart: unless-stopped$/m)
    expect(block('migrate')).toMatch(/^ {4}restart: "no"$/m)
    // a sonda do contêiner olha /api/health, que agora consulta o banco (core.test.ts)
    expect(read('Dockerfile.api')).toMatch(/^HEALTHCHECK .*http:\/\/127\.0\.0\.1:3333\/api\/health/m)
    // e o compose declara a mesma sonda para a API (docker compose ps mostra healthy/unhealthy)
    expect(block('api')).toMatch(/^ {4}healthcheck:\n {6}test: \["CMD", "wget", "-qO-", "http:\/\/127\.0\.0\.1:3333\/api\/health"\]$/m)
  })

  // r3-process-resilience-and-restart-3: "proxy_pass http://api:3333;" resolvia "api" uma vez, ao carregar: com a API
  // parada o nginx nem subia, e com a API recriada em outro IP ficava em 502 até reiniciar o web. O cenário com DNS
  // do Docker simulado está em core-deploy-dns.test.ts.
  it('nginx resolve "api" pelo DNS do Docker a cada requisição (variável + resolver), sem fixar o IP na subida', () => {
    const start = conf.indexOf('location /api/ {')
    const api = conf.slice(start, conf.indexOf('\n  }', start))
    expect(api).toMatch(/^\s*resolver 127\.0\.0\.11 valid=10s ipv6=off;$/m)
    expect(api).toMatch(/^\s*set \$x2w_api http:\/\/api:3333;$/m)
    expect(api).toMatch(/^\s*proxy_pass \$x2w_api;$/m)
    // nenhum proxy_pass com nome fixo (resolvido só na subida) em lugar nenhum
    expect(conf).not.toMatch(/proxy_pass\s+https?:\/\/[a-z]/)
  })
})

// O próprio Compose renderiza o arquivo (sem daemon), numa cópia com um deploy/.env falso: a política de reinício
// vale de fato para db, api e web. Sem o plugin do Compose, pulado (a checagem estática acima continua valendo).
const HAS_COMPOSE = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0
describe.skipIf(!HAS_COMPOSE)('docker compose config (renderizado)', () => {
  it('db, api e web com restart unless-stopped; migrate sem reinício', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'x2w-compose-'))
    try {
      for (const f of ['docker-compose.yml', 'Dockerfile.api', 'Dockerfile.web']) copyFileSync(join(ROOT, f), join(scratch, f))
      cpSync(join(ROOT, 'deploy'), join(scratch, 'deploy'), { recursive: true })
      writeFileSync(join(scratch, 'deploy/.env'), `POSTGRES_PASSWORD=p1\nAPP_DB_PASSWORD=p2\nAPP_SECRET=${'x'.repeat(48)}\n`)
      const out = execFileSync('docker', ['compose', '--env-file', 'deploy/.env', 'config', '--format', 'json'], { cwd: scratch, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      const services = JSON.parse(out).services as Record<string, { restart?: string; healthcheck?: { test?: string[] } }>
      expect(Object.keys(services).sort()).toEqual(['api', 'db', 'migrate', 'web'])
      expect(Object.fromEntries(Object.entries(services).map(([n, v]) => [n, v.restart]))).toEqual({
        db: 'unless-stopped',
        api: 'unless-stopped',
        web: 'unless-stopped',
        migrate: 'no',
      })
      expect(services.api.healthcheck?.test).toEqual(['CMD', 'wget', '-qO-', 'http://127.0.0.1:3333/api/health'])
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
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

// r3-runtime-resilience-nginx-upstream: com "api" fora do DNS (contêiner parado), o nginx recusava a configuração
// ([emerg] host not found in upstream "api") e o web nem subia. O bloco location /api/ entregue, sem mudanças,
// agora passa no nginx -t mesmo sem "api" resolvível (o cenário completo, com DNS do Docker, em core-deploy-dns).
describe.skipIf(!HAS_TOOLS)('location /api/ entregue com "api" fora do DNS', () => {
  it('nginx -t aceita a configuração (o nome só é resolvido por requisição)', () => {
    const start = NGINX_CONF.indexOf('location /api/ {')
    const location = NGINX_CONF.slice(start, NGINX_CONF.indexOf('\n  }', start) + 4)
    expect(location).toContain('proxy_pass $x2w_api;')
    const dir = mkdtempSync(join(tmpdir(), 'x2w-nginx-t-'))
    try {
      writeFileSync(
        join(dir, 'nginx.conf'),
        `pid ${dir}/nginx.pid;\nerror_log ${dir}/error.log;\nevents {}\nhttp {\n  access_log off;\n  client_body_temp_path ${dir}; proxy_temp_path ${dir}; fastcgi_temp_path ${dir}; uwsgi_temp_path ${dir}; scgi_temp_path ${dir};\n  server {\n    listen 127.0.0.1:18990;\n    ${location}\n  }\n}\n`,
      )
      const t = spawnSync('nginx', ['-t', '-p', dir, '-c', join(dir, 'nginx.conf')], { encoding: 'utf8' })
      expect(t.status, t.stderr).toBe(0)
      expect(t.stderr).not.toContain('host not found')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

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
        .split('set $x2w_api http://api:3333;')
        .join(`set $x2w_api http://127.0.0.1:${apiPort};`)
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

  it('corpo acima de 1m em /api/ para no nginx (413, nem chega à API); /api/kv/ repassa até 12m', async () => {
    const over1m = 'x'.repeat(1024 * 1024 + 1024)
    const r = await request({ tls: true, port: edgeHttps, path: '/api/team/direct', method: 'POST', body: { pad: over1m } })
    expect(r.status).toBe(413)
    // o mesmo erro da API, em JSON e pt-BR (não a página HTML do nginx), sem chegar a ela (nada de nao_autenticado)
    expect(r.headers['content-type']).toMatch(/^application\/json/)
    expect(JSON.parse(r.body)).toEqual({ error: { code: 'corpo_grande_demais', message: 'Os dados enviados passam do tamanho permitido.' } })
    for (const [name, re] of Object.entries(SECURITY_HEADERS)) expect(r.headers[name], name).toMatch(re)
    // /api/kv/ (com as mesmas regras de proxy): chega à API, que recusa sem sessão
    const kv = await request({ tls: true, port: edgeHttps, path: '/api/kv/x', method: 'PUT', body: { value: over1m } })
    expect(kv.status, kv.body.slice(0, 200)).toBe(401)
    expect(JSON.parse(kv.body).error.code).toBe('nao_autenticado')
    expect(occurrences(kv, 'x-frame-options')).toBe(1)
    const over12m = await request({ tls: true, port: edgeHttps, path: '/api/kv/x', method: 'PUT', body: { value: 'x'.repeat(12 * 1024 * 1024 + 1024) } })
    expect(over12m.status).toBe(413)
    expect(JSON.parse(over12m.body).error.code).toBe('corpo_grande_demais')
  })

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
