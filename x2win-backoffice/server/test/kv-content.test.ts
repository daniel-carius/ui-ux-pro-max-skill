// Regressões (r3, public-content-and-url-sinks): conteúdo que vai para o site público
// do cassino (Personalização, popups/inbox, notificações, disparos e textos legais) é
// validado pelo servidor. Antes, as regras do painel (socialUrlError, validateLink,
// isHex, canonicalError…) só valiam no navegador e um PUT direto de um cargo baixo
// (Marketing oficial) gravava javascript:/data: em links, SVG com script em imagens,
// paleta que quebra o CSS do site e textos legais sem o aviso de 18+.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { imageError, linkError, socialUrlError, svgProblem } from '../src/modules/kv/rules-content'
import { validatorFor } from '../src/modules/kv/validators'
import { api, createTestApp, loginAs } from './helpers'

const put = (app: FastifyInstance, cookie: string, key: string, value: unknown, version?: number) =>
  api(app, 'PUT', `/api/kv/${key}`, { cookie, body: version === undefined ? { value } : { value, version } })
const get = (app: FastifyInstance, cookie: string, key: string) => api(app, 'GET', `/api/kv/${key}`, { cookie })
const rawRow = (app: FastifyInstance, key: string) => app.db.one<{ version: number }>('select version from kv_store where key = $1', [key])

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
/** SVG como os do painel (logotipo/banners gerados): gradiente, url(#id), texto. */
const SAFE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#A47CFF"/></linearGradient></defs>' +
  `<rect width="64" height="64" rx="16" fill="url(#g)"/><text x="5" y="40" font-family="'Plus Jakarta Sans',Arial" fill="#fff">X2 &amp; WIN</text></svg>`

const CSS_BREAKOUT_PRIMARY = '#FF0000}body{background:url(https://evil.example/x)};a{color:#fff'
const CSS_BREAKOUT_ACCENT = 'red;}@import url(https://evil.example/x.css);.x{color:red'

const theme = (primary: string, accent: string, logo: string | null = PNG) => ({
  logo,
  favicon: null,
  shareImage: null,
  colors: { primary, accent, background: '#0B0B0F', surface: '#15151C', text: '#FFFFFF' },
})

const popup = (over: Record<string, unknown> = {}) => ({
  id: 'pp-1',
  title: 'Bônus',
  image: null,
  text: 'Deposite hoje',
  button: { label: 'Ver', link: '/promocoes' },
  pages: ['home'],
  audience: { kind: 'todos' },
  priority: 50,
  startAt: '2026-10-01T00:00:00.000Z',
  endAt: null,
  frequency: 'uma_vez',
  active: true,
  views: 0,
  clicks: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
})

const banner = (link: string, image: string | null = PNG) => ({
  id: 'bn-1',
  position: 'hero',
  name: 'Hero',
  image,
  link,
  active: true,
  startsAt: null,
  endsAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
})

const social = (url: string, network = 'instagram') => ({ links: [{ id: 'rs-1', network, url, visible: true }] })

const TERMOS_OK = `# Termos de uso\n\nSomente maiores de **18 (dezoito) anos**.\n\n## 5. Jogo responsável\n\nLeia a [política](https://x2win.bet.br/jogo-responsavel) ou escreva para [suporte](mailto:suporte@x2win.bet.br).`
const legalDocs = (termos: string, extraVersion?: string) => [
  {
    id: 'termos',
    title: 'Termos de uso',
    slug: '/termos-de-uso',
    description: 'Regras de uso',
    versions: [
      { version: 1, publishedAt: '2026-01-01T00:00:00.000Z', author: 'Daniel', summary: 'Versão inicial do texto', content: termos, requireReaccept: false, added: 1, removed: 0 },
      ...(extraVersion === undefined
        ? []
        : [{ version: 2, publishedAt: '2026-02-01T00:00:00.000Z', author: 'Daniel', summary: 'Nova versão do texto', content: extraVersion, requireReaccept: true, added: 1, removed: 1 }]),
    ],
  },
]

describe('kv: conteúdo do site público validado no servidor (unidades)', () => {
  it('todas as chaves de conteúdo público têm validador no servidor', () => {
    for (const k of [
      'personalizacao.tema',
      'personalizacao.sportsbook',
      'personalizacao.home',
      'personalizacao.provedores-home',
      'personalizacao.banners',
      'personalizacao.avatares',
      'personalizacao.menus',
      'personalizacao.carrosseis',
      'personalizacao.rodape',
      'personalizacao.redes-sociais',
      'personalizacao.seo',
      'campanhas.popups-inbox',
      'campanhas.popups-inbox.popups',
      'campanhas.popups-inbox.inbox',
      'campanhas.notificacoes',
      'campanhas.notificacoes.historico',
      'campanhas.disparos',
      'campanhas.disparos.historico',
      'config.textos-legais',
    ]) {
      expect(validatorFor(k), k).toBeTypeOf('function')
    }
  })

  it('links: caminho interno ou https://; nada de javascript:, data:, vbscript:, http:, // nem usuário no endereço', () => {
    for (const ok of ['', '/promocoes', '/', '/cassino/crash?x=1#topo', '/promoções', 'https://x2win.bet.br/termos', 'https://instagram.com/x2win']) {
      expect(linkError(ok), ok).toBeNull()
    }
    for (const bad of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'http://x2win.bet.br',
      '//evil.example/x',
      '/\\evil.example',
      '/a b',
      '/"onmouseover="x',
      'https://x2win.bet.br@evil.example/',
      'https://localhost/x',
      'https://evil.example/"><script>',
      'mailto:a@b.com',
      'promocoes',
    ]) {
      expect(linkError(bad), bad).not.toBeNull()
    }
    // nos textos (markdown) mailto: vale
    expect(linkError('mailto:suporte@x2win.bet.br', { mailto: true })).toBeNull()
    expect(linkError('mailto:a@b.com?bcc=x@y.com', { mailto: true })).not.toBeNull()
  })

  it('imagens: data URL de imagem em base64 ou SVG estático; SVG ativo, HTML e endereço remoto recusados', () => {
    expect(imageError('')).toBeNull()
    expect(imageError(PNG)).toBeNull()
    expect(imageError('data:image/jpeg;base64,/9j/4AAQ')).toBeNull()
    expect(imageError(svgUrl(SAFE_SVG))).toBeNull()
    expect(imageError(`data:image/svg+xml;base64,${Buffer.from(SAFE_SVG).toString('base64')}`)).toBeNull()
    for (const bad of [
      'data:text/html,<script>alert(1)</script>',
      'data:text/html;base64,PHNjcmlwdD4=',
      'javascript:alert(1)',
      'https://cdn.evil.example/x.png',
      'data:image/png;base64,<svg onload=alert(1)>',
      'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
      svgUrl('<svg><script>alert(1)</script></svg>'),
      svgUrl('<svg><foreignObject><div>x</div></foreignObject></svg>'),
      svgUrl('<svg><a href="javascript:alert(1)"><rect/></a></svg>'),
      svgUrl('<svg><use href="https://evil.example/s.svg#a"/></svg>'),
      svgUrl('<svg><image href="https://evil.example/t.png"/></svg>'),
      svgUrl('<svg><set attributeName="href" to="javascript:alert(1)"/></svg>'),
      svgUrl('<svg><rect fill="url(https://evil.example/x)"/></svg>'),
      svgUrl('<svg><rect style="fill:url(//evil.example/x)"/></svg>'),
      svgUrl('<svg><rect ONLOAD="alert(1)"/></svg>'),
      svgUrl('<svg><use xlink:href="&#x6A;avascript:alert(1)"/></svg>'),
      svgUrl('<!DOCTYPE svg [<!ENTITY x "y">]><svg/>'),
      svgUrl('<svg><rect width="1" <script>/></svg>'),
      svgUrl('<html><body>oi</body></html>'),
    ]) {
      expect(imageError(bad), bad.slice(0, 80)).not.toBeNull()
    }
    expect(svgProblem(SAFE_SVG)).toBeNull()
  })

  it('redes sociais: https:// no domínio da própria rede (mesma regra do painel)', () => {
    expect(socialUrlError('instagram', 'https://instagram.com/x2win.oficial')).toBeNull()
    expect(socialUrlError('instagram', 'https://www.instagram.com/x2win.oficial/')).toBeNull()
    expect(socialUrlError('whatsapp', 'https://wa.me/5511999999999')).toBeNull()
    expect(socialUrlError('instagram', "javascript:fetch('/api/team/direct',{method:'POST'})")).not.toBeNull()
    expect(socialUrlError('instagram', 'https://evil.example/x2win')).not.toBeNull()
    expect(socialUrlError('instagram', 'http://instagram.com/x2win')).not.toBeNull()
    expect(socialUrlError('desconhecida', 'https://instagram.com/x2win')).not.toBeNull()
    expect(socialUrlError('constructor', 'https://instagram.com/x2win')).not.toBeNull()
  })
})

describe('kv: conteúdo do site público (ponta a ponta, Marketing oficial)', () => {
  let app: FastifyInstance
  let mkt: string
  let admin: string
  beforeAll(async () => {
    app = await createTestApp()
    mkt = (await loginAs(app, 'marketing-oficial', { totp: true })).cookie
    admin = (await loginAs(app, 'superadmin', { totp: true })).cookie
  })
  afterAll(async () => app.close())

  it('controle: Marketing oficial grava valores normais (tema, popups, banners, redes, SVG do painel)', async () => {
    expect((await put(app, mkt, 'personalizacao.tema', theme('#E11D48', '#F59E0B', svgUrl(SAFE_SVG)), 0)).statusCode).toBe(200)
    expect((await put(app, mkt, 'campanhas.popups-inbox.popups', [popup()], 0)).statusCode).toBe(200)
    expect((await put(app, mkt, 'personalizacao.banners', [banner('/promocoes'), { ...banner('https://x2win.bet.br/promo'), id: 'bn-2' }], 0)).statusCode).toBe(200)
    expect((await put(app, mkt, 'personalizacao.redes-sociais', social('https://instagram.com/x2win.oficial'), 0)).statusCode).toBe(200)
  })

  it('redes sociais: javascript: e data:text/html no link → 400, nada gravado (r3-public-content-1)', async () => {
    const cur = await get(app, mkt, 'personalizacao.redes-sociais')
    const version = cur.json().version
    for (const evil of [
      "javascript:fetch('/api/team/direct',{method:'POST',headers:{'content-type':'application/json','x-requested-with':'x2w'},body:JSON.stringify({name:'x',email:'x@x.x',roleId:'superadmin'})})",
      'data:text/html,<script>document.title="pwned"</script>',
      'vbscript:msgbox(1)',
      'https://evil.example/instagram',
    ]) {
      const r = await put(app, mkt, 'personalizacao.redes-sociais', social(evil), version)
      expect(r.statusCode, evil).toBe(400)
      expect(r.json().error.code).toBe('dados_invalidos')
    }
    const after = JSON.stringify((await get(app, mkt, 'personalizacao.redes-sociais')).json())
    expect(after).not.toContain('javascript:')
    expect(after).not.toContain('data:text/html')
    expect((await rawRow(app, 'personalizacao.redes-sociais'))?.version).toBe(version)
  })

  it('tema: paleta que quebra o CSS do site (cor fora de #RRGGBB) → 400 (r3-public-content-2)', async () => {
    const version = (await get(app, mkt, 'personalizacao.tema')).json().version
    const r = await put(app, mkt, 'personalizacao.tema', theme(CSS_BREAKOUT_PRIMARY, CSS_BREAKOUT_ACCENT), version)
    expect(r.statusCode).toBe(400)
    const accent = await put(app, mkt, 'personalizacao.tema', theme('#E11D48', CSS_BREAKOUT_ACCENT), version)
    expect(accent.statusCode).toBe(400)
    expect(accent.json().error.details.path).toBe('colors.accent')
    const body = JSON.stringify((await get(app, mkt, 'personalizacao.tema')).json())
    expect(body).not.toContain('@import')
    expect(body).not.toContain('}body{')
    // cor faltando também é recusada
    const missing = await put(app, mkt, 'personalizacao.tema', { ...theme('#E11D48', '#F59E0B'), colors: { primary: '#E11D48' } }, version)
    expect(missing.statusCode).toBe(400)
    // logotipo SVG com script → 400
    const svg = await put(app, mkt, 'personalizacao.tema', theme('#E11D48', '#F59E0B', svgUrl('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')), version)
    expect(svg.statusCode).toBe(400)
    expect(svg.json().error.details.path).toBe('logo')
  })

  it('popup: botão javascript:, imagem SVG com onload e título com HTML → 400 (r3-public-content-2)', async () => {
    const version = (await get(app, mkt, 'campanhas.popups-inbox.popups')).json().version
    const cases = [
      popup({ title: '<img src=x onerror=alert(1)>' }),
      popup({ image: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>' }),
      popup({ button: { label: 'Ver', link: 'javascript:alert(document.cookie)' } }),
      popup({ button: { label: 'Ver', link: '//evil.example/x' } }),
      popup({ title: 'x'.repeat(61) }),
      popup({ text: 'Veja [aqui](javascript:alert(1))' }),
    ]
    for (const p of cases) {
      const r = await put(app, mkt, 'campanhas.popups-inbox.popups', [p], version)
      expect(r.statusCode, JSON.stringify(p).slice(0, 120)).toBe(400)
    }
    const body = JSON.stringify((await get(app, mkt, 'campanhas.popups-inbox.popups')).json())
    expect(body).not.toContain('javascript:')
    expect(body).not.toContain('data:image/svg+xml')
    expect(body).not.toContain('onerror')
  })

  it('banner com link javascript: ou imagem data:text/html → 400 (r3-public-content-2)', async () => {
    const version = (await get(app, mkt, 'personalizacao.banners')).json().version
    expect((await put(app, mkt, 'personalizacao.banners', [banner('javascript:alert(1)')], version)).statusCode).toBe(400)
    expect((await put(app, mkt, 'personalizacao.banners', [banner('/promocoes', 'data:text/html,<script>alert(1)</script>')], version)).statusCode).toBe(400)
    expect(JSON.stringify((await get(app, mkt, 'personalizacao.banners')).json())).not.toContain('javascript:')
  })

  it('menus, rodapé, SEO, fonte do sportsbook, notificações e disparos seguem as mesmas regras', async () => {
    const item = (over: Record<string, unknown>) => ({ id: 'h1', label: 'Cassino', icon: 'gamepad', linkType: 'pagina', page: '/cassino', url: '', audience: 'todos', ...over })
    expect((await put(app, mkt, 'personalizacao.menus', { header: [item({})], mobile: [item({ id: 'm1', page: '/' })] })).statusCode).toBe(200)
    const menusV = (await get(app, mkt, 'personalizacao.menus')).json().version
    for (const bad of [item({ linkType: 'url', url: 'javascript:alert(1)' }), item({ page: 'javascript:alert(1)' }), item({ linkType: 'url', url: 'http://x.com' }), item({ icon: '<svg>' })]) {
      expect((await put(app, mkt, 'personalizacao.menus', { header: [bad], mobile: [] }, menusV)).statusCode, JSON.stringify(bad)).toBe(400)
    }
    expect((await put(app, mkt, 'personalizacao.rodape', { companyName: 'X2Win', termsUrl: 'javascript:alert(1)', telegram: '' })).statusCode).toBe(400)
    expect((await put(app, mkt, 'personalizacao.rodape', { companyName: 'X2Win', termsUrl: 'https://x2win.bet.br/termos', telegram: 'javascript:alert(1)' })).statusCode).toBe(400)
    // r1: WhatsApp, telefone e e-mail do rodapé eram conferidos só pelo painel
    const footer = { companyName: 'X2Win', termsUrl: 'https://x2win.bet.br/termos', telegram: '' }
    // r3: texto da licença com o separador e sem o número ("… Fazenda · ") ia para o site
    for (const bad of [
      { whatsapp: 'javascript:alert(1)' },
      { whatsapp: '(11) 4002-8922' },
      { phone: '123' },
      { phone: 'tel:11987654321' },
      { email: 'nao-e-email' },
      { licenseText: 'Autorizada pela Secretaria de Prêmios e Apostas do Ministério da Fazenda · ' },
    ]) {
      const r = await put(app, mkt, 'personalizacao.rodape', { ...footer, ...bad })
      expect(r.statusCode, JSON.stringify(bad)).toBe(400)
    }
    for (const ok of [
      { whatsapp: '(11) 94002-8922' },
      { whatsapp: '+55 11 94002-8922' },
      { phone: '(11) 4002-8922' },
      { email: 'suporte@x2win.bet.br' },
      { whatsapp: '', phone: '', email: '' },
      { licenseText: 'Autorizada pela Secretaria de Prêmios e Apostas do Ministério da Fazenda · Portaria SPA/MF nº 1.234/2024' },
    ]) {
      const cur = (await get(app, mkt, 'personalizacao.rodape')).json() as { version: number; stored: boolean }
      const r = await put(app, mkt, 'personalizacao.rodape', { ...footer, ...ok }, cur.stored ? cur.version : undefined)
      expect(r.statusCode, `${JSON.stringify(ok)} ${r.body}`).toBe(200)
    }
    expect((await put(app, mkt, 'personalizacao.seo', { canonicalUrl: 'https://x2win.bet.br/?utm=1', title: 'X2Win' })).statusCode).toBe(400)
    expect((await put(app, mkt, 'personalizacao.seo', { canonicalUrl: 'https://x2win.bet.br', title: '<script>alert(1)</script>' })).statusCode).toBe(400)
    expect((await put(app, mkt, 'personalizacao.sportsbook', { mode: 'escuro', font: "Roboto;}body{background:url(//evil.example)}", useSiteColors: true })).statusCode).toBe(400)
    expect((await put(app, mkt, 'campanhas.notificacoes.historico', [{ id: 'n1', title: 'Oi', message: 'Bônus', cta: { label: 'Ver', link: 'javascript:alert(1)' } }])).statusCode).toBe(400)
    expect(
      (await put(app, mkt, 'campanhas.disparos.historico', [{ id: 'd1', name: 'x', channel: 'rcs', rcs: { title: 'x', text: 'y', image: 'data:image/svg+xml,<svg><script>alert(1)</script></svg>', buttonLabel: 'Ver', buttonLink: '/promocoes', smsFallback: true } }]))
        .statusCode,
    ).toBe(400)
    // e-mail com link de variável e mailto: continua aceito
    expect(
      (await put(app, mkt, 'campanhas.disparos.historico', [{ id: 'd1', name: 'x', channel: 'email', email: { subject: 'Oi', preheader: '', body: 'Clique [aqui]({{link}}) ou [fale conosco](mailto:suporte@x2win.bet.br).', ctaLabel: 'Ver', ctaLink: 'https://x2win.bet.br/promo' } }]))
        .statusCode,
    ).toBe(200)
  })

  it('textos legais: links seguros no markdown; Termos sem o aviso de 18+ ou sem jogo responsável → 400', async () => {
    expect((await put(app, admin, 'config.textos-legais', legalDocs(TERMOS_OK))).statusCode).toBe(200)
    const version = (await get(app, admin, 'config.textos-legais')).json().version
    // versão nova sem o aviso de maioridade
    const no18 = await put(app, admin, 'config.textos-legais', legalDocs(TERMOS_OK, TERMOS_OK.replace('**18 (dezoito) anos**', 'idade mínima')), version)
    expect(no18.statusCode).toBe(400)
    expect(no18.json().error.message).toContain('18')
    // versão nova sem a seção de jogo responsável
    expect((await put(app, admin, 'config.textos-legais', legalDocs(TERMOS_OK, TERMOS_OK.replace('Jogo responsável', 'Outros')), version)).statusCode).toBe(400)
    // versão publicada reescrita sem o aviso também é recusada
    expect((await put(app, admin, 'config.textos-legais', legalDocs(TERMOS_OK.replace('**18 (dezoito) anos**', 'adultos')), version)).statusCode).toBe(400)
    // link perigoso no markdown e HTML no texto
    expect((await put(app, admin, 'config.textos-legais', legalDocs(TERMOS_OK, `${TERMOS_OK}\n\n[clique](javascript:alert(1))`), version)).statusCode).toBe(400)
    expect((await put(app, admin, 'config.textos-legais', legalDocs(TERMOS_OK, `${TERMOS_OK}\n\n<img src=x onerror=alert(1)>`), version)).statusCode).toBe(400)
    // versão nova correta é aceita
    expect((await put(app, admin, 'config.textos-legais', legalDocs(TERMOS_OK, `${TERMOS_OK}\n\nTexto novo.`), version)).statusCode).toBe(200)
  })
})
