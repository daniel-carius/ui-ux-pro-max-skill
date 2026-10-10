// PoC (verify, impact lens): stored javascript:/data: link in personalizacao.redes-sociais.
//
// Claim: Marketing oficial stores a javascript: URL; superadmin clicks the "Abrir perfil" icon
// (RedesSociais.tsx renders <a href={l.url} target="_blank" rel="noreferrer noopener">) and the
// script runs in the panel origin, POSTing /api/team/direct with the static x2w header.
//
// This test serves the exact anchor markup React emits for that row (same href/target/rel) on the
// same origin as the API (proxy, like nginx), with a superadmin session cookie, and clicks it in
// Chromium. It checks whether the click reaches the API.
//  - storage half: the server stores the javascript: URL verbatim (true, defense-in-depth gap);
//  - no CSP (Vite dev / non-nginx serving): Chromium opens a noopener about:blank tab and does NOT run
//    the javascript: URL in the panel origin -> no API call;
//  - with deploy/security-headers.conf CSP (nginx): "Refused to run the JavaScript URL" -> no API call;
//  - control: same anchor without target=_blank -> the POST does reach the API (detection works).
import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { api, createUser, createTestApp, loginAs, sessionCookie } from './helpers'

const KEY = 'personalizacao.redes-sociais'
const PAYLOAD =
  "javascript:fetch('/api/team/direct',{method:'POST',headers:{'content-type':'application/json','x-requested-with':'x2w'},body:JSON.stringify({name:'x',email:'x@x.x',roleId:'superadmin'})})"
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

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

async function clickStoredLink(opts: { csp: boolean; target: boolean }) {
  const app = await createTestApp()
  try {
    const admin = await createUser(app, { roleId: 'superadmin' })
    const adminCookie = await sessionCookie(app, admin.id)
    const { cookie: mkt } = await loginAs(app, 'marketing-oficial', { totp: true })
    const put = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: mkt, body: { value: { links: [{ id: 'rs-1', network: 'instagram', url: PAYLOAD, visible: true }] }, version: 0 } })
    const got = await api(app, 'GET', `/api/kv/${KEY}`, { cookie: adminCookie })
    const storedUrl: string = got.json().value.links[0].url

    await app.listen({ port: 0, host: '127.0.0.1' })
    const apiPort = (app.server.address() as { port: number }).port
    const apiCalls: string[] = []
    const front = http.createServer((req, res) => {
      if (req.url!.startsWith('/api/')) {
        apiCalls.push(`${req.method} ${req.url}`)
        const p = http.request({ host: '127.0.0.1', port: apiPort, method: req.method, path: req.url, headers: req.headers }, (r) => {
          res.writeHead(r.statusCode!, r.headers)
          r.pipe(res)
        })
        req.pipe(p)
        return
      }
      const h: Record<string, string> = { 'content-type': 'text/html' }
      if (opts.csp) h['content-security-policy'] = CSP
      res.writeHead(200, h)
      // same attributes as RedesSociais.tsx:142-151 (href from the stored value)
      res.end(`<!doctype html><a id="open" href="${esc(storedUrl)}"${opts.target ? ' target="_blank"' : ''} rel="noreferrer noopener" title="Abrir perfil">open</a>`)
    })
    await new Promise<void>((r) => front.listen(0, '127.0.0.1', () => r()))
    const port = (front.address() as { port: number }).port
    const browser = await chromium.launch()
    try {
      const ctx = await browser.newContext()
      const [name, value] = adminCookie.split('=')
      await ctx.addCookies([{ name, value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
      const page = await ctx.newPage()
      const consoleLines: string[] = []
      page.on('console', (m: { text(): string }) => consoleLines.push(m.text()))
      await page.goto(`http://127.0.0.1:${port}/`)
      await page.click('#open')
      await new Promise((r) => setTimeout(r, 1500))
      return { putStatus: put.statusCode, storedUrl, apiCalls, consoleLines, tabs: ctx.pages().map((p: { url(): string }) => p.url()) }
    } finally {
      await browser.close()
      front.close()
    }
  } finally {
    await app.close()
  }
}

describe.skipIf(!chromium)('verify: redes-sociais stored javascript: link impact', () => {
  it('storage: Marketing oficial stores the javascript: URL verbatim (server has no validator)', async () => {
    const r = await clickStoredLink({ csp: false, target: true })
    expect(r.putStatus).toBe(200)
    expect(r.storedUrl.startsWith('javascript:')).toBe(true)
  }, 60_000)

  it('no CSP (dev/non-nginx): target=_blank noopener click does NOT run the payload in the panel origin', async () => {
    const r = await clickStoredLink({ csp: false, target: true })
    console.log('no-CSP', JSON.stringify({ apiCalls: r.apiCalls, tabs: r.tabs }))
    expect(r.apiCalls).toEqual([])
  }, 60_000)

  it('prod CSP (deploy/security-headers.conf): the javascript: URL is refused', async () => {
    const r = await clickStoredLink({ csp: true, target: true })
    console.log('CSP', JSON.stringify({ apiCalls: r.apiCalls, console: r.consoleLines.map((l) => l.slice(0, 80)) }))
    expect(r.apiCalls).toEqual([])
    expect(r.consoleLines.some((l) => l.includes('Refused to run the JavaScript URL'))).toBe(true)
  }, 60_000)

  it('control: the same anchor WITHOUT target=_blank and without CSP would fire the POST (detection works)', async () => {
    const r = await clickStoredLink({ csp: false, target: false })
    console.log('control', JSON.stringify({ apiCalls: r.apiCalls }))
    expect(r.apiCalls).toContain('POST /api/team/direct')
  }, 60_000)
})
