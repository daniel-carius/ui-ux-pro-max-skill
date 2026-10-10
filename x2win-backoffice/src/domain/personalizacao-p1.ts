// Regras de Personalização (parte 1): tema, sportsbook, página inicial,
// provedores na home, banners, avatares e menus do site.
// Funções puras: valem igual no servidor (validação antes de publicar no site).

// ---------- Cores e contraste (WCAG 2.1) ----------

export const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function isHex(v: string): boolean {
  return HEX_RE.test(v)
}

export function hexToRgb(hex: string): [number, number, number] {
  if (!isHex(hex)) return [0, 0, 0]
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (x: number) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase()
}

/** Luminância relativa (0 = preto, 1 = branco), fórmula da WCAG 2.1. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Razão de contraste entre duas cores: de 1 (igual) a 21 (preto no branco). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** 4,5:1 */
export function formatRatio(r: number): string {
  return `${r.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}:1`
}

export type ContrastLevel = 'AAA' | 'AA' | 'grande' | 'falha'

/** AAA ≥ 7; AA ≥ 4,5 (texto normal); "grande" ≥ 3 (só texto grande e ícones). */
export function contrastLevel(r: number): ContrastLevel {
  if (r >= 7) return 'AAA'
  if (r >= 4.5) return 'AA'
  if (r >= 3) return 'grande'
  return 'falha'
}

export const DARK_INK = '#0B0D14'
export const LIGHT_INK = '#FFFFFF'

/** Texto (branco ou escuro) com mais contraste sobre a cor de fundo. */
export function bestTextOn(bg: string): string {
  return contrastRatio(LIGHT_INK, bg) >= contrastRatio(DARK_INK, bg) ? LIGHT_INK : DARK_INK
}

/** Mistura duas cores: t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function isDarkColor(hex: string): boolean {
  return relativeLuminance(hex) < 0.2
}

// ---------- Identidade e tema ----------

export interface SiteColors {
  /** botões, links e itens ativos */
  primary: string
  /** selos, valores de prêmio e avisos de bônus */
  accent: string
  /** fundo das páginas */
  background: string
  /** cabeçalho, cartões e janelas */
  surface: string
  /** texto principal */
  text: string
}

export interface SiteTheme {
  logo: string | null
  favicon: string | null
  shareImage: string | null
  colors: SiteColors
}

export const COLOR_LABEL: Record<keyof SiteColors, string> = {
  primary: 'Primária',
  accent: 'Destaque',
  background: 'Fundo',
  surface: 'Superfície',
  text: 'Texto',
}

/** Paleta completa usada para desenhar o site (prévias e, no servidor, o CSS do site). */
export interface SitePalette extends SiteColors {
  onPrimary: string
  onAccent: string
  muted: string
  line: string
  surface2: string
  dark: boolean
}

export function sitePalette(c: SiteColors, fallback?: SiteColors): SitePalette {
  const pick = (k: keyof SiteColors) => (isHex(c[k]) ? c[k] : fallback?.[k] && isHex(fallback[k]) ? fallback[k] : '#808080')
  const primary = pick('primary')
  const accent = pick('accent')
  const background = pick('background')
  const surface = pick('surface')
  const text = pick('text')
  return {
    primary,
    accent,
    background,
    surface,
    text,
    onPrimary: bestTextOn(primary),
    onAccent: bestTextOn(accent),
    muted: mix(text, surface, 0.38),
    line: mix(surface, text, 0.12),
    surface2: mix(surface, text, 0.06),
    dark: isDarkColor(background),
  }
}

export interface ContrastCheck {
  id: string
  label: string
  hint: string
  fg: string
  bg: string
  ratio: number
  /** mínimo exigido: 4,5 para texto, 3 para elementos de interface */
  min: number
  ok: boolean
  kind: 'texto' | 'interface'
}

/** Combinações que o jogador lê no site. Texto abaixo de 4,5:1 vira alerta. */
export function themeContrastChecks(c: SiteColors): ContrastCheck[] {
  if (!(Object.keys(COLOR_LABEL) as (keyof SiteColors)[]).every((k) => isHex(c[k]))) return []
  const rows: Omit<ContrastCheck, 'ratio' | 'ok'>[] = [
    { id: 'texto-fundo', label: 'Texto sobre o fundo', hint: 'Textos das páginas', fg: c.text, bg: c.background, min: 4.5, kind: 'texto' },
    { id: 'texto-superficie', label: 'Texto sobre a superfície', hint: 'Cabeçalho, cartões e janelas', fg: c.text, bg: c.surface, min: 4.5, kind: 'texto' },
    { id: 'botao', label: 'Texto do botão principal', hint: 'Depositar, Entrar, Apostar', fg: bestTextOn(c.primary), bg: c.primary, min: 4.5, kind: 'texto' },
    { id: 'destaque', label: 'Texto sobre o destaque', hint: 'Selos de bônus e prêmios', fg: bestTextOn(c.accent), bg: c.accent, min: 4.5, kind: 'texto' },
    { id: 'primaria-fundo', label: 'Botão sobre o fundo', hint: 'O botão precisa se destacar da página', fg: c.primary, bg: c.background, min: 3, kind: 'interface' },
  ]
  return rows.map((r) => {
    const ratio = contrastRatio(r.fg, r.bg)
    return { ...r, ratio, ok: ratio >= r.min }
  })
}

export function validateTheme(t: SiteTheme): string | null {
  for (const k of Object.keys(COLOR_LABEL) as (keyof SiteColors)[]) {
    if (!isHex(t.colors[k])) return `A cor "${COLOR_LABEL[k]}" é inválida. Use o formato #RRGGBB.`
  }
  if (!t.logo) return 'Envie o logotipo: ele aparece no cabeçalho, no rodapé e nas telas de entrada.'
  return null
}

// ---------- Sportsbook ----------

export type SportsbookMode = 'escuro' | 'claro'

export interface SportsbookConfig {
  mode: SportsbookMode
  font: string
  useSiteColors: boolean
}

export interface SportsbookPalette {
  background: string
  surface: string
  surface2: string
  text: string
  muted: string
  line: string
  primary: string
  onPrimary: string
  accent: string
  /** destaque legível sobre a superfície (cai para a primária se o destaque for claro demais) */
  accentText: string
  odd: string
  oddText: string
  live: string
  source: 'betby' | 'site'
}

/** Visual padrão da Betby: escuro e azul. */
export const BETBY_DEFAULT = {
  background: '#0B1424',
  surface: '#121F36',
  text: '#E7EEF9',
  primary: '#2F7CF6',
  accent: '#2F7CF6',
}

export function sportsbookPalette(cfg: SportsbookConfig, site: SiteColors): SportsbookPalette {
  let base: { background: string; surface: string; text: string; primary: string; accent: string }
  if (!cfg.useSiteColors) {
    base = BETBY_DEFAULT
  } else if (cfg.mode === 'claro') {
    const siteLight = isHex(site.background) && !isDarkColor(site.background)
    base = {
      background: siteLight ? site.background : '#F2F4F8',
      surface: siteLight && isHex(site.surface) ? site.surface : '#FFFFFF',
      text: siteLight && isHex(site.text) ? site.text : '#12141C',
      primary: isHex(site.primary) ? site.primary : BETBY_DEFAULT.primary,
      accent: isHex(site.accent) ? site.accent : BETBY_DEFAULT.accent,
    }
  } else {
    const siteDark = isHex(site.background) && isDarkColor(site.background)
    base = {
      background: siteDark ? site.background : '#0F1117',
      surface: siteDark && isHex(site.surface) ? site.surface : '#191C24',
      text: siteDark && isHex(site.text) ? site.text : '#F1F2F6',
      primary: isHex(site.primary) ? site.primary : BETBY_DEFAULT.primary,
      accent: isHex(site.accent) ? site.accent : BETBY_DEFAULT.accent,
    }
  }
  const odd = mix(base.surface, base.text, 0.07)
  return {
    background: base.background,
    surface: base.surface,
    surface2: mix(base.surface, base.text, 0.04),
    text: base.text,
    muted: mix(base.text, base.surface, 0.42),
    line: mix(base.surface, base.text, 0.12),
    primary: base.primary,
    onPrimary: bestTextOn(base.primary),
    accent: base.accent,
    accentText: contrastRatio(base.accent, base.surface) >= 3 ? base.accent : contrastRatio(base.primary, base.surface) >= 3 ? base.primary : base.text,
    odd,
    oddText: base.text,
    live: '#EF4444',
    source: cfg.useSiteColors ? 'site' : 'betby',
  }
}

// ---------- Página inicial ----------

export type HomeBlockId =
  | 'banner-principal'
  | 'jogos-destaque'
  | 'top10'
  | 'ganhadores'
  | 'provedores'
  | 'esportes-ao-vivo'
  | 'torneios'
  | 'missoes'
  | 'promocoes'
  | 'categorias'
  | 'jogo-responsavel'

export interface HomeBlock {
  id: HomeBlockId
  enabled: boolean
}

export interface HomeConfig {
  blocks: HomeBlock[]
}

export function enabledBlocks(c: HomeConfig): HomeBlock[] {
  return c.blocks.filter((b) => b.enabled)
}

export function validateHome(c: HomeConfig): string | null {
  if (!c.blocks.some((b) => b.enabled)) return 'Ligue pelo menos um bloco: a home não pode ficar vazia.'
  return null
}

// ---------- Provedores na home ----------

export interface ProviderStripItem {
  providerId: string
  /** logotipo enviado; sem ele, o site mostra o monograma gerado */
  logo: string | null
}

export interface ProvidersHomeConfig {
  enabled: boolean
  title: string
  showGameCount: boolean
  items: ProviderStripItem[]
}

export const PROVIDERS_STRIP_MAX = 24

export function validateProvidersHome(c: ProvidersHomeConfig): string | null {
  if (c.enabled && !c.title.trim()) return 'Informe o título da faixa.'
  if (c.title.trim().length > 40) return 'O título da faixa pode ter até 40 caracteres.'
  if (c.enabled && c.items.length === 0) return 'Adicione pelo menos um provedor ou desligue a faixa.'
  if (c.items.length > PROVIDERS_STRIP_MAX) return `A faixa aceita até ${PROVIDERS_STRIP_MAX} provedores.`
  const ids = new Set<string>()
  for (const it of c.items) {
    if (ids.has(it.providerId)) return 'Há provedores repetidos na faixa.'
    ids.add(it.providerId)
  }
  return null
}

/** Duas letras para o monograma: "Pragmatic Play" → "PP", "Spribe" → "SP". */
export function monogram(name: string): string {
  const words = name.replace(/[^A-Za-zÀ-ú0-9 ]/g, '').trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (words[0] ?? '?').slice(0, 2).toUpperCase()
}

// ---------- Links do site (menus e banners) ----------

/** Link interno (/promocoes) ou endereço externo seguro (https://...). */
export function validateLink(v: string, { required = true } = {}): string | null {
  const s = v.trim()
  if (!s) return required ? 'Informe o link.' : null
  if (s.startsWith('/')) {
    return /^\/[a-z0-9\-/]*$/.test(s) ? null : 'Página interna inválida.'
  }
  return validateHttpsUrl(s)
}

export function validateHttpsUrl(v: string): string | null {
  const s = v.trim()
  if (!s) return 'Informe o endereço.'
  if (/^http:\/\//i.test(s)) return 'Use um endereço seguro, começando com https://'
  if (!/^https:\/\//i.test(s)) return 'O endereço precisa começar com https://'
  try {
    const u = new URL(s)
    if (!u.hostname.includes('.') || u.hostname.startsWith('.') || u.hostname.endsWith('.')) return 'Endereço inválido: confira o domínio.'
  } catch {
    return 'Endereço inválido.'
  }
  return null
}

// ---------- Endereços gravados que viram link ou imagem na tela ----------
// O valor vem da base (pode ter sido gravado antes da validação do servidor, ou por outro
// caminho). Antes de virar href, window.open ou src, passa por estas listas; o que não passa
// não vira link nem imagem (a tela mostra o texto ou um espaço neutro).

/** Caminho interno do site: uma barra só no início, sem espaço, aspas, barra invertida ou "<>". */
const SAFE_INTERNAL_PATH = /^\/(?!\/)[^\s\\"'<>`]*$/

function httpsHref(s: string): string | null {
  if (!/^https:\/\//i.test(s)) return null
  try {
    const u = new URL(s)
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password ? u.href : null
  } catch {
    return null
  }
}

/**
 * Link seguro para href ou window.open: https:// ou página interna (/promocoes). Qualquer outro
 * esquema (javascript:, data:, http:, //host) volta null.
 */
export function safeLinkHref(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return null
  if (s.startsWith('/')) return SAFE_INTERNAL_PATH.test(s) ? s : null
  return httpsHref(s)
}

/**
 * Imagens enviadas pelo painel (data URL de imagem, como o servidor aceita; SVG dentro de <img>
 * não roda script nem carrega nada de fora), blob: de arquivo local, arquivos do próprio painel
 * (/assets/...) e https://. Em produção a CSP (img-src 'self' data: blob:) bloqueia imagem
 * externa: a tela mostra um espaço neutro quando a imagem não carrega.
 */
const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)[;,]/i

/** Imagem segura para src (ou null). */
export function safeImageSrc(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return null
  if (SAFE_DATA_IMAGE.test(s)) return s
  if (/^blob:/i.test(s)) return s
  if (s.startsWith('/')) return SAFE_INTERNAL_PATH.test(s) ? s : null
  return httpsHref(s)
}

// ---------- Banners ----------

export type BannerPositionId = 'hero' | 'login' | 'cadastro' | 'compacto' | 'deposito' | 'promocoes' | 'lateral'

export interface BannerPosition {
  id: BannerPositionId
  label: string
  width: number
  height: number
  /** máximo de banners na posição */
  max: number
  /** carrossel: passa sozinho; alterna: um por visita */
  rotation: 'carrossel' | 'alterna'
  where: string
}

export interface Banner {
  id: string
  position: BannerPositionId
  /** nome interno, só aparece no painel */
  name: string
  image: string | null
  /** página interna (/promocoes) ou https://; vazio = sem link */
  link: string
  active: boolean
  /** AAAA-MM-DD */
  startsAt: string | null
  endsAt: string | null
  createdAt: string
}

export type BannerStatus = 'no_ar' | 'agendado' | 'encerrado' | 'pausado'

export const BANNER_STATUS_LABEL: Record<BannerStatus, string> = {
  no_ar: 'No ar',
  agendado: 'Agendado',
  encerrado: 'Encerrado',
  pausado: 'Pausado',
}

/** today = "AAAA-MM-DD" */
export function bannerStatus(b: Banner, today: string): BannerStatus {
  if (!b.active) return 'pausado'
  if (b.endsAt && b.endsAt < today) return 'encerrado'
  if (b.startsAt && b.startsAt > today) return 'agendado'
  return 'no_ar'
}

export type BannerErrors = Partial<Record<'name' | 'image' | 'link' | 'period', string>>

export function bannerErrors(b: Banner): BannerErrors {
  const e: BannerErrors = {}
  if (!b.name.trim()) e.name = 'Dê um nome para achar o banner depois.'
  else if (b.name.trim().length > 60) e.name = 'Use até 60 caracteres.'
  if (!b.image) e.image = 'Envie a imagem do banner.'
  const link = validateLink(b.link, { required: false })
  if (link) e.link = link
  if (b.startsAt && b.endsAt && b.endsAt < b.startsAt) e.period = 'O fim precisa ser depois do início.'
  return e
}

/** A imagem tem a proporção da posição (tolerância de 2%)? */
export function ratioMatches(w: number, h: number, targetW: number, targetH: number, tolerance = 0.02): boolean {
  if (!w || !h) return false
  const r = w / h
  const t = targetW / targetH
  return Math.abs(r - t) / t <= tolerance
}

// ---------- Perfil e avatares ----------

export type AvatarMode = 'gerado' | 'proprio'
export type GeneratedStyle = 'iniciais' | 'ilustracao'
export type PhotoModeration = 'antes' | 'depois'
export type NameDisplay = 'apelido' | 'nome-mascarado'
export type AchievementKind = 'apostas' | 'vitorias'

export interface AchievementTier {
  id: string
  kind: AchievementKind
  name: string
  /** meta: quantidade de apostas ou de vitórias */
  threshold: number
  image: string | null
}

export interface LibraryAvatar {
  id: string
  name: string
  image: string
}

export interface AvatarConfig {
  mode: AvatarMode
  generatedStyle: GeneratedStyle
  moderation: PhotoModeration
  allowLibrary: boolean
  library: LibraryAvatar[]
  achievementsEnabled: boolean
  tiers: AchievementTier[]
  nameDisplay: NameDisplay
}

export const TIERS_MAX_PER_KIND = 5
export const LIBRARY_MAX = 24

/** "Mariana Souza" → "Ma***** S." */
export function maskName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '—'
  const first = parts[0]
  const head = first.slice(0, 2)
  const masked = `${head}${'*'.repeat(Math.max(3, first.length - 2))}`
  const last = parts.length > 1 ? ` ${parts[parts.length - 1][0].toUpperCase()}.` : ''
  return masked + last
}

export function displayName(p: { name: string; nick: string }, mode: NameDisplay): string {
  return mode === 'apelido' ? p.nick : maskName(p.name)
}

export function tierErrors(tiers: AchievementTier[]): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const kind of ['apostas', 'vitorias'] as AchievementKind[]) {
    const list = tiers.filter((t) => t.kind === kind)
    list.forEach((t, i) => {
      if (!t.name.trim()) errors[t.id] = 'Dê um nome ao nível.'
      else if (!Number.isFinite(t.threshold) || t.threshold < 1) errors[t.id] = 'A meta precisa ser de pelo menos 1.'
      else if (!Number.isInteger(t.threshold)) errors[t.id] = 'Use um número inteiro.'
      else if (i > 0 && t.threshold <= list[i - 1].threshold) errors[t.id] = `A meta precisa ser maior que a do nível anterior (${list[i - 1].threshold.toLocaleString('pt-BR')}).`
    })
  }
  return errors
}

export function validateAvatarConfig(c: AvatarConfig): string | null {
  if (c.allowLibrary && c.library.length === 0) return 'A biblioteca está ligada, mas sem avatares. Envie pelo menos um ou desligue a biblioteca.'
  if (c.achievementsEnabled) {
    if (c.tiers.length === 0) return 'Crie pelo menos um nível de conquista ou desligue os avatares por conquista.'
    const errs = Object.values(tierErrors(c.tiers))
    if (errs.length) return `Revise os níveis de conquista: ${errs[0]}`
  }
  return null
}

/** Maior nível alcançado (ou null). */
export function achievedTier(kind: AchievementKind, value: number, tiers: AchievementTier[]): AchievementTier | null {
  const list = tiers.filter((t) => t.kind === kind && value >= t.threshold)
  return list.length ? list[list.length - 1] : null
}

// ---------- Menus do site ----------

export type MenuAudience = 'todos' | 'logados' | 'visitantes'
export type MenuListId = 'header' | 'mobile'

export const MENU_AUDIENCE_LABEL: Record<MenuAudience, string> = {
  todos: 'Todos',
  logados: 'Só logados',
  visitantes: 'Só visitantes',
}

export interface SiteMenuItem {
  id: string
  label: string
  icon: string
  linkType: 'pagina' | 'url'
  page: string
  url: string
  audience: MenuAudience
}

export interface MenusConfig {
  header: SiteMenuItem[]
  mobile: SiteMenuItem[]
}

export const MENU_LIMITS: Record<MenuListId, { max: number; labelMax: number }> = {
  header: { max: 8, labelMax: 18 },
  mobile: { max: 5, labelMax: 10 },
}

export const MENU_LIST_LABEL: Record<MenuListId, string> = {
  header: 'Cabeçalho (computador)',
  mobile: 'Barra do celular',
}

export type MenuItemErrors = Partial<Record<'label' | 'link', string>>

export function menuItemErrors(item: SiteMenuItem, list: MenuListId): MenuItemErrors {
  const e: MenuItemErrors = {}
  const label = item.label.trim()
  const { labelMax } = MENU_LIMITS[list]
  if (!label) e.label = 'Informe o rótulo.'
  else if (label.length > labelMax) e.label = `Use até ${labelMax} caracteres${list === 'mobile' ? ' (a barra do celular é estreita)' : ''}.`
  if (item.linkType === 'pagina') {
    if (!item.page) e.link = 'Escolha a página.'
  } else {
    const err = validateHttpsUrl(item.url)
    if (err) e.link = err
  }
  return e
}

export function validateMenus(c: MenusConfig): string | null {
  for (const list of ['header', 'mobile'] as MenuListId[]) {
    const items = c[list]
    const { max } = MENU_LIMITS[list]
    if (items.length > max) return `${MENU_LIST_LABEL[list]}: no máximo ${max} itens. Remova ${items.length - max}.`
    if (items.length === 0) return `${MENU_LIST_LABEL[list]}: adicione pelo menos um item.`
    const bad = items.find((it) => Object.keys(menuItemErrors(it, list)).length > 0)
    if (bad) {
      const errs = menuItemErrors(bad, list)
      return `${MENU_LIST_LABEL[list]}, item "${bad.label || 'sem rótulo'}": ${errs.label ?? errs.link}`
    }
  }
  return null
}

export function menuItemHref(item: SiteMenuItem): string {
  return item.linkType === 'pagina' ? item.page : item.url
}

/** Itens que o jogador vê: visitante (não logado) ou logado. */
export function visibleMenuItems(items: SiteMenuItem[], viewer: 'visitante' | 'logado'): SiteMenuItem[] {
  return items.filter((it) => it.audience === 'todos' || (viewer === 'logado' ? it.audience === 'logados' : it.audience === 'visitantes'))
}
