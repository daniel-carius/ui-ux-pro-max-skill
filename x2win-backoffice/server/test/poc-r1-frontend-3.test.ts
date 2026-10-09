// PoC r1-frontend-3: os cabeçalhos de segurança do nginx não chegam ao HTML nem
// aos assets do painel, e não há CSP. Em nginx, `add_header` só é herdado do
// nível de cima quando o nível atual NÃO declara nenhum `add_header`; as
// locations `/assets/` e `/` declaram Cache-Control, então perdem
// X-Frame-Options, nosniff, Referrer-Policy e Permissions-Policy.
//
// O teste afirma o comportamento SEGURO, então FALHA enquanto o bug existir.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const NGINX_CONF = process.env.POC_NGINX_CONF || path.resolve(__dirname, '../../deploy/nginx.conf')
const conf = fs.readFileSync(NGINX_CONF, 'utf8')

type Block = { name: string; headers: string[] }

/** Separa o bloco server em: nível server + cada location, com os add_header de cada um. */
function parse(src: string) {
  const noComments = src.replace(/#[^\n]*/g, '')
  const locations: Block[] = []
  const locRe = /location\s+([^{]+)\{([^}]*)\}/g
  let serverLevel = noComments
  for (const m of noComments.matchAll(locRe)) {
    locations.push({ name: m[1].trim(), headers: [...m[2].matchAll(/add_header\s+([\w-]+)/g)].map((h) => h[1].toLowerCase()) })
    serverLevel = serverLevel.replace(m[0], '')
  }
  const server = [...serverLevel.matchAll(/add_header\s+([\w-]+)/g)].map((h) => h[1].toLowerCase())
  return { server, locations }
}

/** Cabeçalhos que efetivamente chegam a cada location (regra de herança do nginx). */
function effective(src: string) {
  const { server, locations } = parse(src)
  return Object.fromEntries(locations.map((l) => [l.name, l.headers.length ? l.headers : server]))
}

const REQUIRED = ['x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy']

describe('deploy/nginx.conf (análise estática com a regra de herança do add_header)', () => {
  const eff = effective(conf)

  it('a configuração tem as locations do painel', () => {
    expect(Object.keys(eff)).toEqual(expect.arrayContaining(['/assets/', '/', '/api/']))
  })

  for (const loc of ['/', '/assets/']) {
    it(`location ${loc} entrega os cabeçalhos de segurança declarados no server`, () => {
      for (const h of REQUIRED) expect(eff[loc], `${h} ausente em ${loc}`).toContain(h)
    })
  }

  it('o painel (location /) envia uma Content-Security-Policy com frame-ancestors', () => {
    expect(eff['/']).toContain('content-security-policy')
    expect(conf).toMatch(/Content-Security-Policy[^\n]*frame-ancestors/i)
  })
})

// Verificação dinâmica: sobe o nginx real com o nginx.conf entregue (só troca
// listen/root/proxy_pass) e lê os cabeçalhos. Pulada se não houver nginx.
function hasNginx() {
  try {
    execFileSync('nginx', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function freePort() {
  return new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port
      s.close(() => resolve(p))
    })
  })
}

function head(port: number, p: string) {
  return new Promise<http.IncomingHttpHeaders & { status?: number }>((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: p }, (res) => {
        res.resume()
        resolve({ ...res.headers, status: res.statusCode })
      })
      .on('error', reject)
  })
}

describe.skipIf(!hasNginx())('deploy/nginx.conf rodando no nginx real', () => {
  let dir = ''
  let port = 0
  let proc: ChildProcess | undefined

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-nginx-'))
    fs.mkdirSync(path.join(dir, 'html/assets'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'tmp'))
    fs.writeFileSync(path.join(dir, 'html/index.html'), '<!doctype html><title>x</title>')
    fs.writeFileSync(path.join(dir, 'html/assets/index-abc.js'), 'console.log(1)')
    port = await freePort()
    const server = conf
      .replace(/listen\s+80;/, `listen 127.0.0.1:${port};`)
      .replace(/root\s+\/usr\/share\/nginx\/html;/, `root ${dir}/html;`)
      .replace(/http:\/\/api:3333/, 'http://127.0.0.1:9')
    const main = `${process.getuid?.() === 0 ? 'user root;\n' : ''}daemon off;\nworker_processes 1;\npid ${dir}/nginx.pid;\nerror_log ${dir}/error.log;\nevents {}\nhttp {\n  access_log off;\n  client_body_temp_path ${dir}/tmp; proxy_temp_path ${dir}/tmp; fastcgi_temp_path ${dir}/tmp; uwsgi_temp_path ${dir}/tmp; scgi_temp_path ${dir}/tmp;\n${server}\n}\n`
    fs.writeFileSync(path.join(dir, 'nginx.conf'), main)
    proc = spawn('nginx', ['-c', path.join(dir, 'nginx.conf'), '-p', dir], { stdio: 'ignore' })
    for (let i = 0; i < 50; i++) {
      try {
        await head(port, '/')
        return
      } catch {
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    throw new Error('nginx não subiu')
  })

  afterAll(() => {
    proc?.kill('SIGQUIT')
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  for (const p of ['/', '/index.html', '/system/saques', '/assets/index-abc.js']) {
    it(`GET ${p} traz X-Frame-Options, nosniff, Referrer-Policy e Permissions-Policy`, async () => {
      const h = await head(port, p)
      expect(h.status).toBe(200)
      expect({ path: p, xfo: h['x-frame-options'], nosniff: h['x-content-type-options'], ref: h['referrer-policy'], perm: h['permissions-policy'], cache: h['cache-control'] }).toMatchObject({
        xfo: 'DENY',
        nosniff: 'nosniff',
        ref: expect.any(String),
        perm: expect.any(String),
      })
    })
  }

  it('GET / traz Content-Security-Policy com frame-ancestors', async () => {
    const h = await head(port, '/')
    expect(String(h['content-security-policy'] ?? '')).toMatch(/frame-ancestors/)
  })
})
