// PoC (verify, impact lens): "no server-side validation of personalizacao.* / textos-legais /
// popups-inbox keys destined for the public casino site".
//
// What this checks, end to end:
//  1. storage half (TRUE): Marketing oficial PUTs a CSS-breakout palette and a popup with an SVG data:
//     image + javascript: button link; the server returns 200 and stores them verbatim.
//  2. delivery half (the impact): is there ANY path in the system under review that hands these values
//     to a player / the public site, or builds CSS from them? -> anonymous GET is 401, the app exposes no
//     route outside the authenticated /api/* surface, and no server source file reads these keys.
//  3. the only in-scope consumer is the panel itself. Its sinks: React style objects (CSSOM assignment,
//     what react-dom 18 does for style={{ background }}) and <img src> for popup images. In Chromium,
//     with and without the production CSP, the breakout string does not escape the declaration, no
//     request reaches the attacker host, and the SVG onload never runs.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { api, createTestApp, loginAs } from './helpers'

const BREAKOUT_PRIMARY = '#FF0000}body{background:url(https://evil.example/x)};a{color:#fff'
const BREAKOUT_ACCENT = 'red;}@import url(https://evil.example/x.css);.x{color:red'
const SVG_IMG = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" onload="window.__pwned=1"><rect width="10" height="10"/></svg>'
const CSP = fs.readFileSync(new URL('../../deploy/security-headers.conf', import.meta.url), 'utf8').match(/Content-Security-Policy "([^"]+)"/)![1]

function loadChromium() {
  for (const base of ['/opt/node22/lib/node_modules/', process.cwd() + '/']) {
    try {
      return createRequire(base)('playwright').chromium
    } catch {
      /* next */
    }
  }
  return null
}
const chromium = loadChromium()

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]))
}

describe('verify: public-site content keys without server validation', () => {
  it('storage: Marketing oficial stores CSS-breakout palette and dangerous popup verbatim (200)', async () => {
    const app = await createTestApp()
    try {
      const { cookie } = await loginAs(app, 'marketing-oficial', { totp: true })
      const tema = await api(app, 'PUT', '/api/kv/personalizacao.tema', {
        cookie,
        body: { value: { logo: 'data:image/png;base64,iVBORw0KGgo=', favicon: null, shareImage: null, colors: { primary: BREAKOUT_PRIMARY, accent: BREAKOUT_ACCENT, background: '#0B0B0F', surface: '#15151C', text: '#FFFFFF' } }, version: 0 },
      })
      const pop = await api(app, 'PUT', '/api/kv/campanhas.popups-inbox.popups', {
        cookie,
        body: { value: [{ id: 'pp-1', title: '<img src=x onerror=alert(1)>', image: SVG_IMG, button: { label: 'x', link: 'javascript:alert(1)' } }], version: 0 },
      })
      console.log('storage', JSON.stringify({ tema: tema.statusCode, primary: tema.json().value.colors.primary, popups: pop.statusCode, link: pop.json().value[0].button.link }))
      expect(tema.statusCode).toBe(200)
      expect(pop.statusCode).toBe(200)
      expect(tema.json().value.colors.primary).toBe(BREAKOUT_PRIMARY)
    } finally {
      await app.close()
    }
  })

  it('delivery: no unauthenticated read, no public route, no server code consumes these keys', async () => {
    const app = await createTestApp()
    try {
      const anon = await Promise.all(
        ['personalizacao.tema', 'personalizacao.redes-sociais', 'campanhas.popups-inbox.popups', 'config.textos-legais'].map(async (k) => {
          const r = await api(app, 'GET', `/api/kv/${k}`)
          return `${k}=${r.statusCode}`
        }),
      )
      // every route is registered under /api (app.ts: /api/health + /api/{auth,team,withdrawals,audit,webhooks,kv});
      // probe the obvious public-site shapes: all 404
      const publicProbe = await Promise.all(['/site.css', '/public/tema', '/api/public/personalizacao.tema', '/api/site/tema'].map(async (u) => `${u}=${(await api(app, 'GET', u)).statusCode}`))
      const srcRoot = path.resolve(__dirname, '../src')
      const consumers = walk(srcRoot)
        .filter((f) => f.endsWith('.ts'))
        .filter((f) => /personalizacao|textos-legais|popups-inbox|campanhas\.notificacoes|campanhas\.disparos/.test(fs.readFileSync(f, 'utf8')))
        .map((f) => path.relative(srcRoot, f))
      console.log('delivery', JSON.stringify({ anon, publicProbe, serverFilesReferencingKeys: consumers }))
      expect(anon.every((s) => s.endsWith('=401'))).toBe(true)
      expect(consumers).toEqual([])
    } finally {
      await app.close()
    }
  })

  it.skipIf(!chromium)('panel sinks: React-style CSSOM assignment and <img src> do not break out / execute, with or without CSP', async () => {
    const results: Record<string, unknown> = {}
    for (const withCsp of [false, true]) {
      const evilHits: string[] = []
      const server = http.createServer((req, res) => {
        const headers: Record<string, string> = { 'content-type': 'text/html' }
        if (withCsp) headers['content-security-policy'] = CSP
        res.writeHead(200, headers)
        res.end('<!doctype html><html><body><span id="chip"></span><div id="host"></div><script src="/app.js"></script></body></html>')
      })
      // external script (CSP allows 'self'); mimics react-dom setValueForStyles: style[name] = value, and <img src>
      const appJs = `
        const chip = document.getElementById('chip');
        chip.style.background = ${JSON.stringify(BREAKOUT_PRIMARY)};
        chip.style.background = ${JSON.stringify(BREAKOUT_ACCENT)};
        const img = document.createElement('img'); img.src = ${JSON.stringify(SVG_IMG)};
        document.getElementById('host').appendChild(img);
      `
      const srv2 = http.createServer()
      void srv2
      server.removeAllListeners('request')
      server.on('request', (req, res) => {
        if (req.url === '/app.js') {
          res.writeHead(200, { 'content-type': 'text/javascript' })
          res.end(appJs)
          return
        }
        const headers: Record<string, string> = { 'content-type': 'text/html' }
        if (withCsp) headers['content-security-policy'] = CSP
        res.writeHead(200, headers)
        res.end('<!doctype html><html><body><span id="chip"></span><div id="host"></div><script src="/app.js"></script></body></html>')
      })
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      const port = (server.address() as { port: number }).port
      const browser = await chromium.launch()
      try {
        const page = await browser.newPage()
        await page.route('**/*', (route: { request(): { url(): string }; abort(): Promise<void>; continue(): Promise<void> }) => {
          const u = route.request().url()
          if (u.includes('evil.example')) {
            evilHits.push(u)
            return route.abort()
          }
          return route.continue()
        })
        await page.goto(`http://127.0.0.1:${port}/`)
        await page.waitForTimeout(800)
        const state = await page.evaluate(() => ({
          chipStyleAttr: document.getElementById('chip')!.getAttribute('style'),
          bodyBg: getComputedStyle(document.body).backgroundImage,
          styleSheets: document.styleSheets.length,
          pwned: (window as unknown as { __pwned?: number }).__pwned ?? 0,
        }))
        results[withCsp ? 'csp' : 'noCsp'] = { ...state, evilHits }
        expect(evilHits).toEqual([])
        expect(state.pwned).toBe(0)
        expect(state.bodyBg).toBe('none')
      } finally {
        await browser.close()
        server.close()
      }
    }
    console.log('panel', JSON.stringify(results))
  }, 60_000)
})
