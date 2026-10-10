// Personalização (parte 2): carrosséis da página do jogo, rodapé, redes sociais e SEO.
// Tipos, valores padrão e regras puras (validação e o que aparece no site).
// Na recriação com servidor, as mesmas regras valem no back-end antes de publicar.
import type { CompanyState } from '@/domain/system'
import type { Game, GameCategory } from './catalog'

export const P2_KEYS = {
  carousels: 'personalizacao.carrosseis',
  footer: 'personalizacao.rodape',
  social: 'personalizacao.redes-sociais',
  seo: 'personalizacao.seo',
} as const

const URL_RE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/[^\s]*)?$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function isHttpsUrl(v: string) {
  return URL_RE.test(v.trim())
}

export function isEmail(v: string) {
  return EMAIL_RE.test(v.trim())
}

/** Completa "instagram.com/x" para "https://instagram.com/x". */
export function withHttps(v: string) {
  const t = v.trim()
  if (!t) return t
  if (/^https?:\/\//i.test(t)) return t.replace(/^http:\/\//i, 'https://')
  return `https://${t}`
}

// ---------- Carrosséis do jogo ----------

export type CarouselKind = 'maiores_vitorias' | 'relacionados' | 'personalizado'
export type WinsPeriod = '24h' | '7d' | '30d' | 'sempre'
export type RelatedCriterion = 'provedora' | 'categoria' | 'manual'
export type CustomSource = 'manual' | 'novos' | 'populares' | 'categoria'

export const WINS_PERIOD_LABEL: Record<WinsPeriod, string> = { '24h': 'Últimas 24 horas', '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias', sempre: 'Desde sempre' }
export const WINS_PERIOD_MS: Record<WinsPeriod, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000, sempre: Infinity }
export const CRITERION_LABEL: Record<RelatedCriterion, string> = { provedora: 'Mesma provedora', categoria: 'Mesma categoria', manual: 'Lista manual' }
export const SOURCE_LABEL: Record<CustomSource, string> = { manual: 'Lista manual', novos: 'Lançamentos', populares: 'Mais jogados', categoria: 'Uma categoria' }

export interface CarouselConfig {
  id: string
  kind: CarouselKind
  title: string
  enabled: boolean
  /** quantos cards o carrossel mostra */
  count: number
  // Maiores vitórias
  period: WinsPeriod
  minWin: number
  maskNickname: boolean
  // Jogos relacionados
  criterion: RelatedCriterion
  // Carrossel personalizado
  source: CustomSource
  category: GameCategory
  /** lista manual (relacionados ou personalizado), na ordem de exibição */
  gameIds: string[]
}

export interface CarouselSettings {
  carousels: CarouselConfig[]
}

export const CAROUSEL_LIMITS = { minCount: 4, maxCount: 24, titleMax: 40, maxCarousels: 6 } as const

const baseCarousel: Omit<CarouselConfig, 'id' | 'kind' | 'title'> = {
  enabled: true,
  count: 10,
  period: '7d',
  minWin: 100,
  maskNickname: true,
  criterion: 'provedora',
  source: 'manual',
  category: 'slots',
  gameIds: [],
}

export function newCarousel(id: string, kind: CarouselKind, title: string, patch: Partial<CarouselConfig> = {}): CarouselConfig {
  return { ...baseCarousel, id, kind, title, ...patch }
}

export const DEFAULT_CAROUSELS: CarouselSettings = {
  carousels: [
    newCarousel('maiores-vitorias', 'maiores_vitorias', 'Maiores vitórias neste jogo', { count: 10, period: '7d', minWin: 100 }),
    newCarousel('relacionados', 'relacionados', 'Jogos relacionados', { count: 12, criterion: 'provedora' }),
  ],
}

export function carouselError(c: CarouselConfig): string | null {
  if (!c.title.trim()) return 'Dê um título ao carrossel.'
  if (c.title.length > CAROUSEL_LIMITS.titleMax) return `Título com até ${CAROUSEL_LIMITS.titleMax} caracteres.`
  if (c.count < CAROUSEL_LIMITS.minCount || c.count > CAROUSEL_LIMITS.maxCount) return `Quantidade entre ${CAROUSEL_LIMITS.minCount} e ${CAROUSEL_LIMITS.maxCount}.`
  if (c.kind === 'maiores_vitorias' && c.minWin < 0) return 'O valor mínimo não pode ser negativo.'
  const manual = (c.kind === 'relacionados' && c.criterion === 'manual') || (c.kind === 'personalizado' && c.source === 'manual')
  if (manual && c.gameIds.length === 0) return 'Escolha pelo menos um jogo para a lista manual.'
  return null
}

export function validateCarousels(v: CarouselSettings): string | null {
  for (const c of v.carousels) {
    const e = carouselError(c)
    if (e) return `${c.title || 'Carrossel sem título'}: ${e}`
  }
  const titles = v.carousels.map((c) => c.title.trim().toLowerCase())
  if (new Set(titles).size !== titles.length) return 'Dois carrosséis têm o mesmo título.'
  return null
}

/** Jogos que o carrossel mostra na página de `current` (mesma regra do site). */
export function resolveCarouselGames(c: CarouselConfig, current: Game, games: Game[]): Game[] {
  const pool = games.filter((g) => g.active && g.id !== current.id)
  const byHighlight = (a: Game, b: Game) => b.highlight - a.highlight
  let list: Game[] = []
  const manual = (ids: string[]) => ids.map((id) => pool.find((g) => g.id === id)).filter((g): g is Game => !!g)
  if (c.kind === 'relacionados') {
    if (c.criterion === 'provedora') list = pool.filter((g) => g.providerId === current.providerId).sort(byHighlight)
    else if (c.criterion === 'categoria') list = pool.filter((g) => g.category === current.category).sort(byHighlight)
    else list = manual(c.gameIds)
  } else if (c.kind === 'personalizado') {
    if (c.source === 'manual') list = manual(c.gameIds)
    else if (c.source === 'novos') list = [...pool].sort((a, b) => Number(b.isNew) - Number(a.isNew) || b.createdAt.localeCompare(a.createdAt))
    else if (c.source === 'populares') list = [...pool].sort(byHighlight)
    else list = pool.filter((g) => g.category === c.category).sort(byHighlight)
  }
  return list.slice(0, c.count)
}

/** "lu***x" — mostra o começo e o fim do apelido. */
export function maskNickname(nick: string) {
  if (nick.length <= 3) return `${nick[0] ?? ''}***`
  return `${nick.slice(0, 2)}***${nick.slice(-1)}`
}

// ---------- Rodapé e contato ----------

export type ContactKey = 'phone' | 'email' | 'whatsapp' | 'telegram' | 'chat' | 'address' | 'hours'

export interface FooterSettings {
  companyName: string
  description: string
  termsUrl: string
  privacyUrl: string
  /** mostra razão social e CNPJ (de Empresa e licença) na última linha */
  showLegalLine: boolean
  phone: string
  email: string
  whatsapp: string
  telegram: string
  /** texto do botão do chat ao vivo */
  chat: string
  address: string
  hours: string
  seal18: boolean
  sealResponsible: boolean
  sealLicense: boolean
  licenseText: string
}

export function footerDefaults(c: CompanyState): FooterSettings {
  return {
    companyName: c.tradeName,
    description: c.description,
    termsUrl: 'https://x2win.bet.br/termos',
    privacyUrl: 'https://x2win.bet.br/privacidade',
    showLegalLine: true,
    phone: c.phone,
    email: c.email,
    whatsapp: '',
    telegram: '',
    chat: 'Atendimento 24h pelo chat',
    address: c.address,
    hours: 'Todos os dias, 24 horas',
    seal18: true,
    sealResponsible: true,
    sealLicense: true,
    // sem licença em Empresa e licença: campo vazio (a validação pede o texto), nunca "Fazenda · " com nada depois
    licenseText: c.license.trim() ? `Autorizada pela Secretaria de Prêmios e Apostas do Ministério da Fazenda · ${c.license.trim()}` : '',
  }
}

export interface ContactDef {
  key: ContactKey
  label: string
  placeholder: string
  hint: string
}

export const CONTACT_DEFS: ContactDef[] = [
  { key: 'phone', label: 'Telefone', placeholder: '(11) 4002-8922', hint: 'Fixo ou celular com DDD.' },
  { key: 'email', label: 'E-mail', placeholder: 'contato@x2win.bet.br', hint: 'Aparece como link para escrever.' },
  { key: 'whatsapp', label: 'WhatsApp', placeholder: '(11) 94002-8922', hint: 'Número com DDD. Abre a conversa no WhatsApp.' },
  { key: 'telegram', label: 'Telegram', placeholder: '@x2winsuporte', hint: 'Usuário com @ ou link t.me.' },
  { key: 'chat', label: 'Chat ao vivo', placeholder: 'Atendimento 24h pelo chat', hint: 'Texto do botão que abre o chat do site.' },
  { key: 'hours', label: 'Horário de atendimento', placeholder: 'Todos os dias, 24 horas', hint: 'Aparece abaixo dos canais.' },
  { key: 'address', label: 'Endereço', placeholder: 'Rua, número · Cidade/UF · CEP', hint: 'Endereço da sede, como no cadastro da empresa.' },
]

export function digits(v: string) {
  return v.replace(/\D/g, '')
}

export function formatPhoneBr(v: string) {
  const d = digits(v).replace(/^55(?=\d{10,11}$)/, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return v
}

/** Erro de um canal de contato (canal em branco é válido: só não aparece). */
export function contactError(key: ContactKey, value: string): string | null {
  const v = value.trim()
  if (!v) return null
  if (key === 'phone' || key === 'whatsapp') {
    const d = digits(v).replace(/^55(?=\d{10,11}$)/, '')
    if (d.length < 10 || d.length > 11) return 'Use DDD + número (10 ou 11 dígitos).'
    if (key === 'whatsapp' && d.length !== 11) return 'WhatsApp precisa ser celular (11 dígitos com DDD).'
  }
  if (key === 'email' && !isEmail(v)) return 'E-mail inválido.'
  if (key === 'telegram' && !/^@[A-Za-z0-9_]{5,32}$/.test(v) && !/^https:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_+]{3,}\/?$/i.test(v))
    return 'Use @usuario (5 a 32 letras) ou https://t.me/usuario.'
  if ((key === 'chat' || key === 'hours') && v.length > 60) return 'Use até 60 caracteres.'
  if (key === 'address' && v.length > 140) return 'Use até 140 caracteres.'
  return null
}

export interface VisibleContact {
  key: ContactKey
  label: string
  display: string
  href: string | null
}

/** Canais que aparecem no rodapé: os preenchidos. Canal em branco não aparece. */
export function visibleContacts(v: FooterSettings): VisibleContact[] {
  const out: VisibleContact[] = []
  for (const def of CONTACT_DEFS) {
    const raw = v[def.key].trim()
    if (!raw || contactError(def.key, raw)) continue
    let display = raw
    let href: string | null = null
    if (def.key === 'phone') {
      display = formatPhoneBr(raw)
      href = `tel:+55${digits(raw).replace(/^55(?=\d{10,11}$)/, '')}`
    } else if (def.key === 'whatsapp') {
      display = formatPhoneBr(raw)
      href = `https://wa.me/55${digits(raw).replace(/^55(?=\d{10,11}$)/, '')}`
    } else if (def.key === 'email') href = `mailto:${raw}`
    else if (def.key === 'telegram') {
      href = raw.startsWith('@') ? `https://t.me/${raw.slice(1)}` : raw
      display = raw.startsWith('@') ? raw : `@${raw.split('/').filter(Boolean).pop()}`
    }
    out.push({ key: def.key, label: def.label, display, href })
  }
  return out
}

export function footerErrors(v: FooterSettings) {
  const e: Partial<Record<keyof FooterSettings, string>> = {}
  if (!v.companyName.trim()) e.companyName = 'Informe o nome exibido.'
  if (v.description.length > 300) e.description = 'Use até 300 caracteres.'
  if (!isHttpsUrl(v.termsUrl)) e.termsUrl = 'Use um endereço https:// válido.'
  if (v.privacyUrl.trim() && !isHttpsUrl(v.privacyUrl)) e.privacyUrl = 'Use um endereço https:// válido.'
  for (const def of CONTACT_DEFS) {
    const err = contactError(def.key, v[def.key])
    if (err) e[def.key] = err
  }
  const lic = v.licenseText.trim()
  if (v.sealLicense && !lic) e.licenseText = 'O selo de licença precisa do texto da autorização, com o número (cadastre em Empresa e licença e use "Usar dados da empresa").'
  // texto que termina num separador ("… Fazenda · "): falta o número da autorização
  else if (/[·•|:;,–—-]$/.test(lic)) e.licenseText = `O texto termina em "${lic.slice(-1)}" sem nada depois: complete com o número da autorização ou tire o separador.`
  return e
}

export function validateFooter(v: FooterSettings): string | null {
  const e = footerErrors(v)
  const first = Object.values(e)[0]
  if (first) return first
  if (!visibleContacts(v).length) return 'Deixe pelo menos um canal de contato preenchido.'
  return null
}

// ---------- Redes sociais ----------

export type SocialNetwork = 'instagram' | 'facebook' | 'x' | 'youtube' | 'tiktok' | 'telegram' | 'whatsapp' | 'discord' | 'kwai'

export interface SocialLink {
  id: string
  network: SocialNetwork
  url: string
  visible: boolean
}

export interface SocialSettings {
  links: SocialLink[]
}

export const DEFAULT_SOCIAL: SocialSettings = { links: [] }

export interface SocialDef {
  label: string
  /** domínios aceitos (sem www.) */
  domains: string[]
  example: string
  /** formato do caminho depois do domínio */
  path: RegExp
  pathHint: string
}

export const SOCIAL_DEFS: Record<SocialNetwork, SocialDef> = {
  instagram: { label: 'Instagram', domains: ['instagram.com'], example: 'https://instagram.com/x2win.oficial', path: /^\/[A-Za-z0-9._]{1,30}\/?$/, pathHint: 'instagram.com/seu.perfil' },
  facebook: { label: 'Facebook', domains: ['facebook.com', 'fb.com'], example: 'https://facebook.com/x2win', path: /^\/[A-Za-z0-9.\-/?=]{2,}$/, pathHint: 'facebook.com/suapagina' },
  x: { label: 'X (Twitter)', domains: ['x.com', 'twitter.com'], example: 'https://x.com/x2win', path: /^\/[A-Za-z0-9_]{1,15}\/?$/, pathHint: 'x.com/seuperfil' },
  youtube: { label: 'YouTube', domains: ['youtube.com', 'youtu.be'], example: 'https://youtube.com/@x2win', path: /^\/(@[\w.-]+|c\/[\w.-]+|channel\/[\w-]+|user\/[\w.-]+)\/?$/, pathHint: 'youtube.com/@seucanal' },
  tiktok: { label: 'TikTok', domains: ['tiktok.com'], example: 'https://tiktok.com/@x2win', path: /^\/@[\w.]{2,24}\/?$/, pathHint: 'tiktok.com/@seuperfil' },
  telegram: { label: 'Telegram', domains: ['t.me', 'telegram.me'], example: 'https://t.me/x2winoficial', path: /^\/(\+?[A-Za-z0-9_]{3,})\/?$/, pathHint: 't.me/seucanal' },
  whatsapp: { label: 'WhatsApp', domains: ['wa.me', 'whatsapp.com', 'chat.whatsapp.com'], example: 'https://whatsapp.com/channel/0029Va000000', path: /^\/(\d{12,13}|channel\/[A-Za-z0-9]{8,}|[A-Za-z0-9]{10,})\/?$/, pathHint: 'wa.me/5511999999999 ou whatsapp.com/channel/...' },
  discord: { label: 'Discord', domains: ['discord.gg', 'discord.com'], example: 'https://discord.gg/x2win', path: /^\/(invite\/)?[A-Za-z0-9-]{2,}\/?$/, pathHint: 'discord.gg/convite' },
  kwai: { label: 'Kwai', domains: ['kwai.com', 'k.kwai.com'], example: 'https://kwai.com/@x2win', path: /^\/(@[\w.]{2,}|u\/[\w-]+|p\/[\w-]+)\/?$/, pathHint: 'kwai.com/@seuperfil' },
}

export const SOCIAL_ORDER: SocialNetwork[] = ['instagram', 'telegram', 'whatsapp', 'youtube', 'tiktok', 'x', 'facebook', 'discord', 'kwai']

/** Valida o link da rede: https, domínio da própria rede e perfil no caminho. */
export function socialUrlError(network: SocialNetwork, url: string): string | null {
  const def = SOCIAL_DEFS[network]
  const v = url.trim()
  if (!v) return 'Cole o link do perfil.'
  let u: URL
  try {
    u = new URL(v)
  } catch {
    return `Link inválido. Exemplo: ${def.example}`
  }
  if (u.protocol !== 'https:') return 'O link precisa começar com https://'
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.)/, '')
  if (!def.domains.includes(host)) return `Esse link não é do ${def.label}. Use ${def.domains.join(' ou ')}.`
  if (u.pathname === '/' || !u.pathname) return `Falta o perfil no link: ${def.pathHint}`
  if (network === 'whatsapp' && host === 'wa.me' && !/^\/\d{12,13}\/?$/.test(u.pathname)) return 'No wa.me use o número com 55 e DDD, só dígitos.'
  if (network === 'discord' && host === 'discord.com' && !u.pathname.startsWith('/invite/')) return 'Use um convite: discord.gg/codigo ou discord.com/invite/codigo.'
  if (!def.path.test(u.pathname + (network === 'facebook' ? u.search : ''))) return `Formato do perfil não reconhecido. Exemplo: ${def.pathHint}`
  return null
}

/** Nome curto para mostrar (ex.: @x2win). */
export function socialHandle(network: SocialNetwork, url: string) {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop() ?? ''
    if (network === 'whatsapp') return u.hostname.includes('wa.me') ? formatPhoneBr(last) : 'Canal do WhatsApp'
    if (network === 'discord') return `Convite ${last}`
    return last.startsWith('@') ? last : `@${last}`
  } catch {
    return url
  }
}

export function validateSocial(v: SocialSettings): string | null {
  for (const l of v.links) {
    const e = socialUrlError(l.network, l.url)
    if (e) return `${SOCIAL_DEFS[l.network].label}: ${e}`
  }
  const nets = v.links.map((l) => l.network)
  if (new Set(nets).size !== nets.length) return 'Cada rede pode aparecer uma vez.'
  return null
}

// ---------- SEO ----------

export interface SeoSettings {
  canonicalUrl: string
  logo: string | null
  favicon: string | null
  shareImage: string | null
  siteName: string
  title: string
  description: string
  keywords: string[]
}

export const SEO_LIMITS = { title: 60, titleMin: 30, description: 160, descriptionMin: 70, keywords: 10, siteName: 40 } as const

export const DEFAULT_SEO: SeoSettings = {
  canonicalUrl: 'https://x2win.bet.br',
  logo: null,
  favicon: null,
  shareImage: null,
  siteName: 'X2Win',
  title: 'X2Win · Cassino on-line e apostas esportivas',
  description: 'Jogue Fortune Tiger, Aviator e cassino ao vivo com saque por PIX em minutos. Casa autorizada pela SPA/MF. Proibido para menores de 18 anos.',
  keywords: ['cassino online', 'apostas esportivas', 'fortune tiger', 'aviator', 'saque pix'],
}

/** Endereço canônico: https, domínio válido, sem parâmetros nem âncora. */
export function canonicalError(url: string): string | null {
  const v = url.trim()
  if (!v) return 'Informe o endereço principal do site.'
  let u: URL
  try {
    u = new URL(v)
  } catch {
    return 'Endereço inválido. Exemplo: https://x2win.bet.br'
  }
  if (u.protocol !== 'https:') return 'Use https:// (o Google prefere a versão segura).'
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return 'Domínio inválido.'
  if (u.search || u.hash) return 'Tire parâmetros (?…) e âncoras (#…) do endereço canônico.'
  return null
}

export function seoErrors(v: SeoSettings) {
  const e: Partial<Record<keyof SeoSettings, string>> = {}
  const c = canonicalError(v.canonicalUrl)
  if (c) e.canonicalUrl = c
  if (!v.siteName.trim()) e.siteName = 'Informe o nome do site.'
  else if (v.siteName.length > SEO_LIMITS.siteName) e.siteName = `Use até ${SEO_LIMITS.siteName} caracteres.`
  if (!v.title.trim()) e.title = 'O título é obrigatório.'
  if (!v.description.trim()) e.description = 'A descrição é obrigatória.'
  if (v.keywords.length > 20) e.keywords = 'Use no máximo 20 palavras-chave.'
  return e
}

export function validateSeo(v: SeoSettings): string | null {
  return Object.values(seoErrors(v))[0] ?? null
}

export interface SeoCheck {
  id: string
  label: string
  ok: boolean
  detail: string
}

/** Checklist de boas práticas (não bloqueia salvar, só orienta). */
export function seoChecks(v: SeoSettings): SeoCheck[] {
  const t = v.title.trim().length
  const d = v.description.trim().length
  return [
    { id: 'canonical', label: 'Endereço canônico seguro', ok: !canonicalError(v.canonicalUrl), detail: canonicalError(v.canonicalUrl) ?? 'https e sem parâmetros.' },
    {
      id: 'title',
      label: 'Título no tamanho certo',
      ok: t >= SEO_LIMITS.titleMin && t <= SEO_LIMITS.title,
      detail: t > SEO_LIMITS.title ? `${t} caracteres: o Google corta depois de ~${SEO_LIMITS.title}.` : t < SEO_LIMITS.titleMin ? `${t} caracteres: curto demais, use de ${SEO_LIMITS.titleMin} a ${SEO_LIMITS.title}.` : `${t} de ${SEO_LIMITS.title} caracteres.`,
    },
    {
      id: 'description',
      label: 'Descrição no tamanho certo',
      ok: d >= SEO_LIMITS.descriptionMin && d <= SEO_LIMITS.description,
      detail: d > SEO_LIMITS.description ? `${d} caracteres: o Google corta depois de ~${SEO_LIMITS.description}.` : d < SEO_LIMITS.descriptionMin ? `${d} caracteres: escreva pelo menos ${SEO_LIMITS.descriptionMin}.` : `${d} de ${SEO_LIMITS.description} caracteres.`,
    },
    { id: 'brand', label: 'Nome do site no título', ok: !!v.siteName.trim() && v.title.toLowerCase().includes(v.siteName.trim().toLowerCase()), detail: 'Ajuda o jogador a reconhecer a marca no resultado.' },
    { id: 'share', label: 'Imagem de compartilhamento', ok: !!v.shareImage, detail: v.shareImage ? '1200×630 px enviada.' : 'Sem imagem, WhatsApp e redes mostram o link sem foto.' },
    { id: 'favicon', label: 'Ícone do navegador', ok: !!v.favicon, detail: v.favicon ? 'Enviado.' : 'Aparece na aba e no resultado do Google no celular.' },
    {
      id: 'keywords',
      label: 'Palavras-chave',
      ok: v.keywords.length >= 3 && v.keywords.length <= SEO_LIMITS.keywords,
      detail: v.keywords.length > SEO_LIMITS.keywords ? `${v.keywords.length} palavras: foque em até ${SEO_LIMITS.keywords}.` : v.keywords.length < 3 ? 'Adicione de 3 a 10 termos que o jogador busca.' : `${v.keywords.length} palavras.`,
    },
    { id: 'responsible', label: 'Aviso de maioridade', ok: /18/.test(v.description), detail: 'Mencionar 18+ na descrição segue a regra de publicidade da SPA/MF.' },
  ]
}

/** Corta o texto como o Google faz (palavra inteira + reticências). */
export function truncateSerp(text: string, max: number) {
  const t = text.trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`
}

/** "x2win.bet.br" a partir do canônico */
export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0]
  }
}
