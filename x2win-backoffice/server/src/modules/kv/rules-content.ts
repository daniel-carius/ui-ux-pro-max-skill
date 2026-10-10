// Regras do servidor para o conteúdo que vai para o site público do cassino
// (Personalização, popups/inbox, notificações, disparos e textos legais). As mesmas
// regras do painel (validateLink/validateHttpsUrl, isHex, socialUrlError,
// canonicalError, POPUP_LIMITS…) valiam só no navegador; um PUT direto gravava
// qualquer coisa. Aqui o valor inteiro é percorrido e a gravação é recusada (400) se:
//  - link (link, url, href, …Link, …Url) não for caminho interno ("/promocoes", nunca
//    "//") nem endereço https:// válido (sem javascript:, data:, vbscript:, http:,
//    usuário/senha no endereço, espaços ou aspas);
//  - imagem (image, logo, favicon, shareImage, …Image) não for data URL de imagem em
//    base64 (PNG, JPEG, WEBP, GIF, AVIF, ICO) ou SVG estático (só elementos de
//    desenho, sem script, eventos on*, links externos, <foreignObject>, <image>,
//    animação, entidades nem url() externo). Endereço remoto não é aceito: a imagem
//    é enviada pelo painel;
//  - cor (campos em colors, …Color) não for #RRGGBB (o CSS do site é montado com elas);
//  - fonte não for só letras, números e espaços;
//  - texto tiver marcação HTML ("<b", "</", "<!", "<?"), passar do limite de tamanho
//    ou tiver link markdown [texto](endereço) com endereço fora da regra dos links
//    (nos textos, mailto: também vale);
//  - rede social não for https:// no domínio da própria rede (socialUrlError);
//  - endereço canônico do SEO não for https:// sem parâmetros nem âncora;
//  - versão nova (ou alterada) dos Termos ou da Política de jogo responsável não
//    trouxer o aviso de maioridade (18) e a menção a jogo responsável (Lei 14.790/2023).
import { svgProblem } from '@shared/svg'
import { Errors } from '../../errors'
import { hasOwn, isPlainObject, MISSING, type JsonObject, type Maybe } from './json'
import type { KvValidator } from './validate-util'

// ---------- links ----------

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/
/** Caminho interno: começa com uma barra só; letras, números e os caracteres de URL (sem aspas, <, >, \ e espaço). */
const INTERNAL_PATH = /^\/(?![/\\])[\p{L}\p{N}\-._~!$&()*+,;=:@%/?#]*$/u
const EMAIL = /^[^\s@<>"'()\\,;:]+@[^\s@<>"'()\\,;:]+\.[^\s@<>"'()\\,;:]{2,}$/
const LINK_HINT = 'Use um caminho do site (/promocoes) ou um endereço https://.'

/** Endereço https:// absoluto e seguro, ou a mensagem do problema. */
export function httpsUrlError(raw: string): string | null {
  const s = raw.trim()
  if (!s) return 'Informe o endereço.'
  if (CONTROL.test(s) || /[\s"'<>\\`]/.test(s)) return 'O endereço não pode ter espaços, aspas ou caracteres especiais.'
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return 'Endereço inválido.'
  }
  if (u.protocol !== 'https:' || !/^https:\/\//i.test(s)) return 'Use um endereço seguro, começando com https://'
  if (u.username || u.password) return 'O endereço não pode ter usuário ou senha.'
  const host = u.hostname
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.')) return 'Endereço inválido: confira o domínio.'
  return null
}

/**
 * Link do site: vazio (sem link), caminho interno ou https://. Nos textos (markdown),
 * `mailto:` também vale.
 */
export function linkError(raw: string, opts: { mailto?: boolean } = {}): string | null {
  const s = raw.trim()
  if (!s) return null
  if (s.startsWith('/')) return INTERNAL_PATH.test(s) ? null : 'Caminho interno inválido: comece com uma só barra, sem espaços, aspas ou barra invertida.'
  if (opts.mailto && /^mailto:/i.test(s)) return EMAIL.test(s.slice(7)) && !CONTROL.test(s) ? null : 'E-mail inválido no link.'
  if (!/^https:/i.test(s)) return LINK_HINT
  return httpsUrlError(s)
}

// ---------- imagens ----------

export { svgProblem }
const RASTER_DATA_URL = /^data:image\/(?:png|jpeg|jpg|webp|gif|avif|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/]*={0,2}$/i
const SVG_DATA_URL = /^data:image\/svg\+xml((?:;[a-z0-9-]+=[a-z0-9-]+)*)(;base64)?,([\s\S]*)$/i
const IMAGE_HINT = 'Use PNG, JPG, WEBP, GIF ou um SVG sem scripts.'

/** Imagem enviada pelo painel (data URL), ou a mensagem do problema. Vazio/null = sem imagem. */
export function imageError(v: string): string | null {
  if (!v) return null
  if (RASTER_DATA_URL.test(v)) return null
  const svg = SVG_DATA_URL.exec(v)
  if (!svg) return IMAGE_HINT
  let source: string
  try {
    if (svg[2]) {
      const b64 = svg[3]
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return 'Imagem SVG inválida.'
      source = Buffer.from(b64, 'base64').toString('utf8')
    } else {
      source = decodeURIComponent(svg[3])
    }
  } catch {
    return 'Imagem SVG inválida.'
  }
  const p = svgProblem(source)
  return p ? `Imagem SVG recusada: ${p}. ${IMAGE_HINT}` : null
}

// ---------- textos ----------

const HEX = /^#[0-9A-Fa-f]{6}$/
const FONT = /^[\p{L}\p{N} ]{1,40}$/u
/** Abertura de tag HTML (como o navegador reconhece): "<" seguido de letra, "/", "!" ou "?". */
const MARKUP = /<[A-Za-z!?/]/
/** Link markdown [texto](endereço "título"). */
const MD_LINK = /\]\(\s*<?([^)\s>]*)/g
/** Variável de modelo usada como endereço: {{link}} */
const TEMPLATE_VAR = /^\{\{\s*[a-z_]+\s*\}\}$/

/** Limite padrão de um texto. */
const TEXT_MAX = 20_000
/** Limite de um documento legal (markdown). */
const LEGAL_CONTENT_MAX = 200_000

const isLinkField = (f: string) => /^(link|links|url|urls|href|uri|slug)$/i.test(f) || /(Link|Url|URL|Uri|Href)$/.test(f)
const isImageField = (f: string) => /^(image|images|logo|favicon|avatar|thumbnail|photo|picture)$/i.test(f) || /(Image|Logo|Favicon|Avatar|Thumbnail|Photo|Picture)$/.test(f)
const isColorField = (f: string) => /^colou?r$/i.test(f) || /Colou?r$/.test(f)
const isFontField = (f: string) => /^font(Family)?$/i.test(f)

interface Walk {
  /** caminho para a mensagem e os detalhes do erro */
  path: (string | number)[]
  /** campo dono do valor (listas herdam o campo) */
  field: string
  /** dentro de um objeto de cores (colors/palette) */
  colors: boolean
  /** limite do texto */
  max: number
}

const bad = (w: Walk, message: string) => Errors.invalid(`${w.path.join('.') || 'valor'}: ${message}`, { path: w.path.join('.'), field: w.field })
/** Imagem recusada: a mensagem já diz o que houve ("Imagem SVG recusada: ..."); o caminho do campo vai só em details. */
const badImage = (w: Walk, message: string) => Errors.invalid(message, { path: w.path.join('.'), field: w.field })

function checkText(v: string, w: Walk) {
  if (v.length > w.max) throw bad(w, `texto longo demais (máximo ${w.max} caracteres).`)
  if (MARKUP.test(v)) throw bad(w, 'marcação HTML não é aceita; escreva só o texto.')
  for (const m of v.matchAll(MD_LINK)) {
    const href = m[1]
    if (TEMPLATE_VAR.test(href)) continue
    const e = linkError(href, { mailto: true })
    if (e || !href) throw bad(w, `link do texto inválido (${href || 'vazio'}): ${e ?? LINK_HINT}`)
  }
}

function checkLeaf(v: string, w: Walk) {
  if (w.colors || isColorField(w.field)) {
    if (v !== '' && !HEX.test(v)) throw bad(w, 'cor inválida. Use o formato #RRGGBB.')
    return
  }
  if (isImageField(w.field)) {
    const e = imageError(v)
    if (e) throw badImage(w, e)
    return
  }
  if (isLinkField(w.field)) {
    const e = linkError(v)
    if (e) throw bad(w, e)
    return
  }
  if (isFontField(w.field)) {
    if (!FONT.test(v)) throw bad(w, 'fonte inválida (só letras, números e espaços, até 40).')
    return
  }
  checkText(v, w)
}

/** Percorre o valor e confere cada texto conforme o campo dono. */
function walk(v: unknown, w: Walk) {
  if (typeof v === 'string') return checkLeaf(v, w)
  if (Array.isArray(v)) {
    v.forEach((item, i) => walk(item, { ...w, path: [...w.path, i] }))
    return
  }
  if (isPlainObject(v)) {
    for (const [k, child] of Object.entries(v)) {
      walk(child, { path: [...w.path, k], field: k, colors: w.colors || /^(colors|colours|palette)$/i.test(k), max: w.max })
    }
  }
}

function walkAll(v: unknown, max = TEXT_MAX) {
  walk(v, { path: [], field: '', colors: false, max })
}

// ---------- regras por chave ----------

/** Texto curto (com limite) num campo do item. */
function limitText(item: JsonObject, field: string, max: number, where: string) {
  const v = item[field]
  if (typeof v === 'string' && v.length > max) throw Errors.invalid(`${where}: ${field} com no máximo ${max} caracteres.`, { field })
}

const objects = (v: unknown): JsonObject[] => (Array.isArray(v) ? v.filter(isPlainObject) : [])

// Tema: as cinco cores obrigatórias em #RRGGBB (o servidor monta o CSS do site com elas)
const THEME_COLORS = ['primary', 'accent', 'background', 'surface', 'text'] as const
function checkTheme(v: unknown) {
  if (!isPlainObject(v)) return
  if (!isPlainObject(v.colors)) throw Errors.invalid('Tema: informe as cores do site.', { path: 'colors' })
  for (const k of THEME_COLORS) {
    const c = v.colors[k]
    if (typeof c !== 'string' || !HEX.test(c)) throw Errors.invalid(`Tema: a cor "${k}" é inválida. Use o formato #RRGGBB.`, { path: `colors.${k}` })
  }
}

// Menus: página interna obrigatória no tipo "pagina", https:// no tipo "url"; ícone é um nome
function checkMenus(v: unknown) {
  if (!isPlainObject(v)) return
  for (const list of ['header', 'mobile']) {
    for (const item of objects(v[list])) {
      const where = `Menu ${list}, item ${typeof item.id === 'string' ? item.id : '?'}`
      if (item.linkType === 'url') {
        const e = typeof item.url === 'string' ? httpsUrlError(item.url) : 'Informe o endereço.'
        if (e) throw Errors.invalid(`${where}: ${e}`, { field: 'url' })
      } else if (hasOwn(item, 'page')) {
        if (typeof item.page !== 'string' || !INTERNAL_PATH.test(item.page)) throw Errors.invalid(`${where}: página interna inválida.`, { field: 'page' })
      }
      if (hasOwn(item, 'icon') && (typeof item.icon !== 'string' || !/^[a-z0-9-]{0,40}$/.test(item.icon))) {
        throw Errors.invalid(`${where}: ícone inválido.`, { field: 'icon' })
      }
    }
  }
}

// Rodapé: termos e privacidade em https://; Telegram como @usuario ou https://t.me/…
function checkFooter(v: unknown) {
  if (!isPlainObject(v)) return
  for (const f of ['termsUrl', 'privacyUrl']) {
    const u = v[f]
    if (typeof u === 'string' && u.trim()) {
      const e = httpsUrlError(u)
      if (e) throw Errors.invalid(`Rodapé (${f}): ${e}`, { field: f })
    }
  }
  // canais de contato: mesma regra do painel (data/personalizacao2-config.ts › contactError). Antes só o painel
  // conferia, e o site público receberia "javascript:alert(1)" no WhatsApp gravado direto pela API.
  const onlyDigits = (x: string) => x.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  for (const f of ['phone', 'whatsapp'] as const) {
    const raw = v[f]
    if (typeof raw !== 'string' || !raw.trim()) continue
    const t = raw.trim()
    const d = onlyDigits(t)
    if (!/^[\d\s()+.-]+$/.test(t) || d.length < 10 || d.length > 11) {
      throw Errors.invalid(`Rodapé (${f}): use DDD + número (10 ou 11 dígitos).`, { field: f })
    }
    if (f === 'whatsapp' && d.length !== 11) throw Errors.invalid('Rodapé (whatsapp): WhatsApp precisa ser celular (11 dígitos com DDD).', { field: f })
  }
  const em = v.email
  if (typeof em === 'string' && em.trim() && !EMAIL.test(em.trim())) {
    throw Errors.invalid('Rodapé (email): e-mail inválido.', { field: 'email' })
  }
  const tg = v.telegram
  if (typeof tg === 'string' && tg.trim()) {
    const t = tg.trim()
    if (!/^@[A-Za-z0-9_]{5,32}$/.test(t) && !/^https:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_+]{3,}\/?$/i.test(t)) {
      throw Errors.invalid('Rodapé (telegram): use @usuario (5 a 32 letras) ou https://t.me/usuario.', { field: 'telegram' })
    }
  }
  // texto da licença que termina num separador ("… Ministério da Fazenda · "): o site mostraria a frase sem o número
  // da autorização (mesma regra do painel, footerErrors)
  const lic = typeof v.licenseText === 'string' ? v.licenseText.trim() : ''
  if (/[·•|:;,–—-]$/.test(lic)) {
    throw Errors.invalid(`Rodapé (licenseText): o texto da licença termina em "${lic.slice(-1)}" sem nada depois. Complete com o número da autorização.`, {
      field: 'licenseText',
    })
  }
}

// Redes sociais: https:// no domínio da própria rede, com o perfil no caminho
interface SocialDef {
  domains: string[]
  path: RegExp
}
const SOCIAL: Record<string, SocialDef> = {
  instagram: { domains: ['instagram.com'], path: /^\/[A-Za-z0-9._]{1,30}\/?$/ },
  facebook: { domains: ['facebook.com', 'fb.com'], path: /^\/[A-Za-z0-9.\-/?=]{2,}$/ },
  x: { domains: ['x.com', 'twitter.com'], path: /^\/[A-Za-z0-9_]{1,15}\/?$/ },
  youtube: { domains: ['youtube.com', 'youtu.be'], path: /^\/(@[\w.-]+|c\/[\w.-]+|channel\/[\w-]+|user\/[\w.-]+)\/?$/ },
  tiktok: { domains: ['tiktok.com'], path: /^\/@[\w.]{2,24}\/?$/ },
  telegram: { domains: ['t.me', 'telegram.me'], path: /^\/(\+?[A-Za-z0-9_]{3,})\/?$/ },
  whatsapp: { domains: ['wa.me', 'whatsapp.com', 'chat.whatsapp.com'], path: /^\/(\d{12,13}|channel\/[A-Za-z0-9]{8,}|[A-Za-z0-9]{10,})\/?$/ },
  discord: { domains: ['discord.gg', 'discord.com'], path: /^\/(invite\/)?[A-Za-z0-9-]{2,}\/?$/ },
  kwai: { domains: ['kwai.com', 'k.kwai.com'], path: /^\/(@[\w.]{2,}|u\/[\w-]+|p\/[\w-]+)\/?$/ },
}

/** Mesma regra de socialUrlError do painel. */
export function socialUrlError(network: string, url: string): string | null {
  const def = Object.prototype.hasOwnProperty.call(SOCIAL, network) ? SOCIAL[network] : undefined
  if (!def) return 'rede social desconhecida.'
  const base = httpsUrlError(url)
  if (base) return base
  const u = new URL(url.trim())
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.)/, '')
  if (!def.domains.includes(host)) return `o link não é da rede (use ${def.domains.join(' ou ')}).`
  if (u.pathname === '/' || !u.pathname) return 'falta o perfil no link.'
  if (network === 'whatsapp' && host === 'wa.me' && !/^\/\d{12,13}\/?$/.test(u.pathname)) return 'no wa.me use o número com 55 e DDD, só dígitos.'
  if (network === 'discord' && host === 'discord.com' && !u.pathname.startsWith('/invite/')) return 'use um convite: discord.gg/codigo ou discord.com/invite/codigo.'
  if (!def.path.test(u.pathname + (network === 'facebook' ? u.search : ''))) return 'formato do perfil não reconhecido.'
  return null
}

function checkSocial(v: unknown) {
  if (!isPlainObject(v)) return
  if (hasOwn(v, 'links') && !Array.isArray(v.links)) throw Errors.invalid('Redes sociais: envie a lista de links.', { path: 'links' })
  objects(v.links).forEach((l, i) => {
    const e = typeof l.url === 'string' && typeof l.network === 'string' ? socialUrlError(l.network, l.url) : 'informe a rede e o link.'
    if (e) throw Errors.invalid(`Redes sociais (${typeof l.network === 'string' ? l.network : '?'}): ${e}`, { path: `links.${i}.url` })
  })
}

// SEO: endereço canônico https:// sem parâmetros nem âncora
function checkSeo(v: unknown) {
  if (!isPlainObject(v) || !hasOwn(v, 'canonicalUrl')) return
  const c = v.canonicalUrl
  if (typeof c !== 'string') throw Errors.invalid('SEO: endereço canônico inválido.', { path: 'canonicalUrl' })
  if (!c.trim()) return
  const e = httpsUrlError(c)
  if (e) throw Errors.invalid(`SEO (endereço canônico): ${e}`, { path: 'canonicalUrl' })
  const u = new URL(c.trim())
  if (u.search || u.hash) throw Errors.invalid('SEO: tire parâmetros (?…) e âncoras (#…) do endereço canônico.', { path: 'canonicalUrl' })
}

// Popups, inbox e notificações: limites do painel (POPUP_LIMITS, INBOX_LIMITS, NOTIF_LIMITS)
export const POPUP_LIMITS = { title: 60, text: 280, buttonLabel: 24 }
export const INBOX_LIMITS = { subject: 80, body: 2000 }
export const NOTIF_LIMITS = { title: 50, message: 160, ctaLabel: 20 }

function checkPopups(v: unknown) {
  for (const p of objects(v)) {
    limitText(p, 'title', POPUP_LIMITS.title, 'Popup')
    limitText(p, 'text', POPUP_LIMITS.text, 'Popup')
    if (isPlainObject(p.button)) limitText(p.button, 'label', POPUP_LIMITS.buttonLabel, 'Popup (botão)')
  }
}

function checkInbox(v: unknown) {
  for (const m of objects(v)) {
    limitText(m, 'subject', INBOX_LIMITS.subject, 'Inbox')
    limitText(m, 'body', INBOX_LIMITS.body, 'Inbox')
  }
}

function checkNotifications(v: unknown) {
  for (const n of objects(v)) {
    limitText(n, 'title', NOTIF_LIMITS.title, 'Notificação')
    limitText(n, 'message', NOTIF_LIMITS.message, 'Notificação')
    if (isPlainObject(n.cta)) limitText(n.cta, 'label', NOTIF_LIMITS.ctaLabel, 'Notificação (botão)')
  }
}

// Textos legais: markdown com links seguros; Termos e Jogo responsável mantêm o aviso
// de maioridade e a menção a jogo responsável em toda versão nova ou alterada
const LEGAL_REQUIRED: Record<string, { label: string; checks: { re: RegExp; what: string }[] }> = {
  termos: {
    label: 'Termos de uso',
    checks: [
      { re: /\b18\b|dezoito/i, what: 'o aviso de proibição para menores de 18 anos' },
      { re: /jogo\s+respons[aá]vel/i, what: 'a seção de jogo responsável' },
    ],
  },
  'jogo-responsavel': {
    label: 'Política de jogo responsável',
    checks: [
      { re: /\b18\b|dezoito/i, what: 'o aviso de proibição para menores de 18 anos' },
      { re: /jogo\s+respons[aá]vel/i, what: 'a menção a jogo responsável' },
    ],
  },
}

function storedVersionContent(stored: Maybe<unknown>, docId: string, version: unknown): string | undefined {
  if (stored === MISSING) return undefined
  const doc = objects(stored).find((d) => d.id === docId)
  const v = doc ? objects(doc.versions).find((x) => x.version === version) : undefined
  return typeof v?.content === 'string' ? v.content : undefined
}

function checkLegal(v: unknown, stored: Maybe<unknown>) {
  if (!Array.isArray(v)) return
  for (const [d, doc] of v.entries()) {
    if (!isPlainObject(doc) || !Array.isArray(doc.versions)) continue
    for (const [i, ver] of doc.versions.entries()) {
      if (isPlainObject(ver) && typeof ver.content === 'string') {
        walk(ver.content, { path: [d, 'versions', i, 'content'], field: 'content', colors: false, max: LEGAL_CONTENT_MAX })
      }
    }
    const req = typeof doc.id === 'string' && Object.prototype.hasOwnProperty.call(LEGAL_REQUIRED, doc.id) ? LEGAL_REQUIRED[doc.id] : undefined
    const versions = objects(doc.versions)
    const last = versions[versions.length - 1]
    if (!req || !last) continue
    const content = typeof last.content === 'string' ? last.content : ''
    // versão nova ou texto de uma versão gravada alterado
    if (storedVersionContent(stored, doc.id as string, last.version) === content) continue
    for (const c of req.checks) {
      if (!c.re.test(content)) {
        throw Errors.invalid(`${req.label}: a versão publicada precisa manter ${c.what} (Lei 14.790/2023).`, { doc: doc.id, version: last.version })
      }
    }
  }
}

/** Validador: regras gerais do conteúdo público + regra da chave. */
function content(extra?: (v: unknown, stored: Maybe<unknown>) => void, opts: { extraFirst?: boolean } = {}): KvValidator {
  return ({ next, stored }) => {
    // regra da chave antes das gerais quando ela tem a mensagem certa (redes sociais: um caminho interno nunca vale)
    if (opts.extraFirst) extra?.(next, stored)
    walkAll(next)
    if (!opts.extraFirst) extra?.(next, stored)
    return { value: next }
  }
}

/** Sem o texto das versões (conferido em checkLegal, com o limite maior dos documentos). */
function withoutLegalContent(v: unknown): unknown {
  if (!Array.isArray(v)) return v
  return v.map((d) => {
    if (!isPlainObject(d) || !Array.isArray(d.versions)) return d
    return { ...d, versions: d.versions.map((ver) => (isPlainObject(ver) ? Object.fromEntries(Object.entries(ver).filter(([k]) => k !== 'content')) : ver)) }
  })
}

/** Textos legais: markdown dos documentos com limite maior; demais campos com as regras gerais. */
const legalTexts: KvValidator = ({ next, stored }) => {
  walkAll(withoutLegalContent(next))
  checkLegal(next, stored)
  return { value: next }
}

export const CONTENT_VALIDATORS: Record<string, KvValidator> = {
  'personalizacao.tema': content((v) => checkTheme(v)),
  'personalizacao.sportsbook': content(),
  'personalizacao.home': content(),
  'personalizacao.provedores-home': content(),
  'personalizacao.banners': content(),
  'personalizacao.avatares': content(),
  'personalizacao.menus': content((v) => checkMenus(v)),
  'personalizacao.carrosseis': content(),
  'personalizacao.rodape': content((v) => checkFooter(v)),
  'personalizacao.redes-sociais': content((v) => checkSocial(v), { extraFirst: true }),
  'personalizacao.seo': content((v) => checkSeo(v)),
  'campanhas.popups-inbox': content(),
  'campanhas.popups-inbox.popups': content((v) => checkPopups(v)),
  'campanhas.popups-inbox.inbox': content((v) => checkInbox(v)),
  'campanhas.notificacoes': content(),
  'campanhas.notificacoes.historico': content((v) => checkNotifications(v)),
  'campanhas.disparos': content(),
  'campanhas.disparos.historico': content(),
  'config.textos-legais': legalTexts,
}
