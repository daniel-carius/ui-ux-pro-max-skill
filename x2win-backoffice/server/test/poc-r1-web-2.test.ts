// PoC r1-web-2: deploy/nginx.conf sets the panel security headers at server level, but
// `location /` and `location /assets/` each declare their own `add_header Cache-Control`.
// nginx only inherits add_header from the enclosing level when the current level declares
// none, so index.html (every SPA route via try_files) and the bundles go out WITHOUT
// X-Frame-Options / nosniff / Referrer-Policy / Permissions-Policy. These tests assert the
// secure behaviour, so they FAIL while the bug exists.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const CONF_PATH = fileURLToPath(new URL('../../deploy/nginx.conf', import.meta.url))
const conf = readFileSync(CONF_PATH, 'utf8').replace(/#[^\n]*/g, '')

const SECURITY_HEADERS = ['x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy']

/** Minimal model of nginx add_header inheritance for `server { ... location X { ... } }`. */
function effectiveHeaders(locationPrefix: string): string[] {
  const locRe = /location\s+(\S+)\s*\{([^}]*)\}/g
  const locations = new Map<string, string>()
  let m: RegExpExecArray | null
  while ((m = locRe.exec(conf))) locations.set(m[1], m[2])
  const serverLevel = conf.replace(locRe, '')
  const names = (body: string) => [...body.matchAll(/add_header\s+([A-Za-z0-9-]+)/g)].map((x) => x[1].toLowerCase())
  const own = names(locations.get(locationPrefix) ?? '')
  // add_header is inherited from the previous level only if the current level has none
  return own.length ? own : names(serverLevel)
}

describe('r1-web-2: nginx add_header inheritance (static model of deploy/nginx.conf)', () => {
  it('server level declares the security headers (intent)', () => {
    for (const h of SECURITY_HEADERS) expect(effectiveHeaders('/nonexistent-location')).toContain(h)
  })
  it('location / (index.html and every SPA route) carries the security headers', () => {
    expect(effectiveHeaders('/')).toEqual(expect.arrayContaining(SECURITY_HEADERS))
  })
  it('location /assets/ carries the security headers', () => {
    expect(effectiveHeaders('/assets/')).toEqual(expect.arrayContaining(SECURITY_HEADERS))
  })
})

// Runtime check against a real nginx binary running deploy/nginx.conf (skipped if absent).
let nginxBin: string | null = null
try {
  nginxBin = execFileSync('sh', ['-c', 'command -v nginx'], { encoding: 'utf8' }).trim() || null
} catch {
  nginxBin = null
}
const mimeTypes = ['/etc/nginx/mime.types', '/usr/local/nginx/conf/mime.types'].find((p) => existsSync(p))

describe.skipIf(!nginxBin)('r1-web-2: real nginx running deploy/nginx.conf', () => {
  const port = 18000 + Math.floor(Math.random() * 1000)
  let dir = ''
  let proc: ChildProcess | null = null

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'poc-r1-web-2-'))
    const html = join(dir, 'html')
    mkdirSync(join(html, 'assets'), { recursive: true })
    writeFileSync(join(html, 'index.html'), '<!doctype html><title>panel</title>')
    writeFileSync(join(html, 'assets', 'app-abc123.js'), 'console.log(1)')
    mkdirSync(join(dir, 'tmp'))
    const site = readFileSync(CONF_PATH, 'utf8')
      .replace(/listen\s+80;/, `listen 127.0.0.1:${port};`)
      .replace('/usr/share/nginx/html', html)
      .replace('http://api:3333', 'http://127.0.0.1:9') // /api is not exercised here
    writeFileSync(join(dir, 'site.conf'), site)
    const t = join(dir, 'tmp')
    writeFileSync(
      join(dir, 'nginx.conf'),
      `${process.getuid?.() === 0 ? 'user root;\n' : ''}worker_processes 1;
pid ${dir}/nginx.pid;
error_log ${dir}/error.log;
events { worker_connections 32; }
http {
  ${mimeTypes ? `include ${mimeTypes};` : ''}
  access_log off;
  client_body_temp_path ${t}; proxy_temp_path ${t}; fastcgi_temp_path ${t}; uwsgi_temp_path ${t}; scgi_temp_path ${t};
  include ${dir}/site.conf;
}
`,
    )
    proc = spawn(nginxBin!, ['-c', join(dir, 'nginx.conf'), '-p', dir, '-g', 'daemon off;'], { stdio: 'ignore' })
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`http://127.0.0.1:${port}/`)
        return
      } catch {
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    throw new Error('nginx did not start: ' + (existsSync(join(dir, 'error.log')) ? readFileSync(join(dir, 'error.log'), 'utf8') : ''))
  })

  afterAll(() => {
    proc?.kill('SIGQUIT')
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  for (const path of ['/', '/index.html', '/saques', '/assets/app-abc123.js']) {
    it(`GET ${path} is served with the security headers`, async () => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`)
      expect(res.status).toBe(200)
      const got = Object.fromEntries([...res.headers.entries()].filter(([k]) => SECURITY_HEADERS.includes(k) || k === 'cache-control'))
      expect(got).toMatchObject({
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      })
    })
  }
})
