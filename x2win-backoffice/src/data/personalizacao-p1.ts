// Dados de demonstração de Personalização (parte 1): padrões da plataforma,
// sementes e artes geradas em SVG (logotipo, banners, avatares e medalhas),
// para que as prévias já abram bonitas sem depender de arquivos externos.
import { createRng } from '@/lib/random'
import type {
  AchievementKind,
  AchievementTier,
  AvatarConfig,
  Banner,
  BannerPosition,
  BannerPositionId,
  HomeBlockId,
  HomeConfig,
  MenusConfig,
  ProvidersHomeConfig,
  SiteColors,
  SiteMenuItem,
  SiteTheme,
  SportsbookConfig,
} from '@/domain/personalizacao-p1'
import { FIRST_NAMES, LAST_NAMES, NICK_PARTS_A, NICK_PARTS_B } from './names'
import { DAY, NOW, dayKey } from './now'
import { demoRecords } from './demo'

export const P1_KEYS = {
  tema: 'personalizacao.tema',
  sportsbook: 'personalizacao.sportsbook',
  home: 'personalizacao.home',
  provedoresHome: 'personalizacao.provedores-home',
  banners: 'personalizacao.banners',
  bannersShowUnused: 'personalizacao.banners.mostrar-nao-usadas',
  avatares: 'personalizacao.avatares',
  menus: 'personalizacao.menus',
} as const

// ---------- Artes em SVG ----------

export function svgDataUrl(w: number, h: number, body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const FONT = `font-family="'Plus Jakarta Sans','Segoe UI',Arial,Helvetica,sans-serif"`
const BRAND_GRADIENT = (id: string) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#A47CFF"/><stop offset="1" stop-color="#5B21B6"/></linearGradient>`
const BRAND_X = 'M18 20h7.5l6.5 9 6.5-9H46L36 32l10 12h-7.5L32 35l-6.5 9H18l10-12z'

function brandBadge(gradId: string) {
  return `<rect width="64" height="64" rx="16" fill="url(#${gradId})"/><path d="${BRAND_X}" fill="#fff"/><circle cx="50" cy="14" r="5" fill="#FACC15"/>`
}

export function logoArt(): string {
  return svgDataUrl(
    200,
    100,
    `<defs>${BRAND_GRADIENT('g')}</defs><g transform="translate(6 22) scale(0.875)">${brandBadge('g')}</g>` +
      `<text x="70" y="63" ${FONT} font-size="33" font-weight="800" letter-spacing="-1"><tspan fill="#C4B5FD">X2</tspan><tspan fill="#FACC15">WIN</tspan></text>`,
  )
}

export function faviconArt(): string {
  return svgDataUrl(64, 64, `<defs>${BRAND_GRADIENT('g')}</defs>${brandBadge('g')}`)
}

export function shareArt(): string {
  return svgDataUrl(
    1200,
    630,
    `<defs>${BRAND_GRADIENT('g')}<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2A1260"/><stop offset="1" stop-color="#0B0D14"/></linearGradient>` +
      `<radialGradient id="glow" cx="0.82" cy="0.2" r="0.6"><stop offset="0" stop-color="#7C4DFF" stop-opacity="0.6"/><stop offset="1" stop-color="#7C4DFF" stop-opacity="0"/></radialGradient></defs>` +
      `<rect width="1200" height="630" fill="url(#bg)"/><rect width="1200" height="630" fill="url(#glow)"/>` +
      `<circle cx="1010" cy="150" r="220" fill="none" stroke="#FACC15" stroke-opacity="0.22" stroke-width="2"/>` +
      `<circle cx="1010" cy="150" r="150" fill="none" stroke="#FACC15" stroke-opacity="0.32" stroke-width="2"/>` +
      `<circle cx="1010" cy="150" r="64" fill="#FACC15" fill-opacity="0.9"/>` +
      `<g transform="translate(92 170) scale(2.4)">${brandBadge('g')}</g>` +
      `<text x="270" y="300" ${FONT} font-size="128" font-weight="800" letter-spacing="-4"><tspan fill="#FFFFFF">X2</tspan><tspan fill="#FACC15">WIN</tspan></text>` +
      `<text x="94" y="420" ${FONT} font-size="46" fill="#C9CEDD">Cassino e apostas esportivas</text>` +
      `<rect x="94" y="465" width="440" height="68" rx="34" fill="#FACC15"/>` +
      `<text x="314" y="510" text-anchor="middle" ${FONT} font-size="29" font-weight="700" fill="#1A1405">Bônus de boas-vindas</text>`,
  )
}

export interface BannerArtOptions {
  width: number
  height: number
  title: string
  subtitle?: string
  cta?: string
  from: string
  to: string
  accent: string
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Arte de banner com degradê, texto e botão. Use "\n" para quebrar o título. */
export function bannerArt(o: BannerArtOptions): string {
  const { width: w, height: h } = o
  const tall = h > w
  const lines = o.title.split('\n')
  const defs =
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${o.from}"/><stop offset="1" stop-color="${o.to}"/></linearGradient>` +
    `<radialGradient id="gl" cx="${tall ? 0.5 : 0.8}" cy="${tall ? 0.22 : 0.4}" r="0.55"><stop offset="0" stop-color="${o.accent}" stop-opacity="0.55"/><stop offset="1" stop-color="${o.accent}" stop-opacity="0"/></radialGradient></defs>`
  let body = `<rect width="${w}" height="${h}" fill="url(#bg)"/><rect width="${w}" height="${h}" fill="url(#gl)"/>`
  if (tall) {
    const cx = w / 2
    const r = w * 0.26
    const cy = h * 0.26
    body +=
      `<circle cx="${cx}" cy="${cy}" r="${r * 1.45}" fill="none" stroke="${o.accent}" stroke-opacity="0.25" stroke-width="2"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${o.accent}" fill-opacity="0.92"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r * 0.72}" fill="none" stroke="#000" stroke-opacity="0.18" stroke-width="${r * 0.08}" stroke-dasharray="${r * 0.22} ${r * 0.14}"/>`
    const size = w * 0.105
    const y0 = h * 0.56
    body += lines
      .map((l, i) => `<text x="${cx}" y="${y0 + i * size * 1.15}" text-anchor="middle" ${FONT} font-size="${size}" font-weight="800" fill="#FFFFFF">${esc(l)}</text>`)
      .join('')
    if (o.subtitle) {
      body += `<text x="${cx}" y="${y0 + lines.length * size * 1.15 + size * 0.2}" text-anchor="middle" ${FONT} font-size="${size * 0.48}" fill="#FFFFFF" fill-opacity="0.82">${esc(o.subtitle)}</text>`
    }
    if (o.cta) {
      const bw = w * 0.7
      const bh = size * 1.3
      const by = h - bh - h * 0.07
      body +=
        `<rect x="${cx - bw / 2}" y="${by}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="${o.accent}"/>` +
        `<text x="${cx}" y="${by + bh * 0.64}" text-anchor="middle" ${FONT} font-size="${size * 0.5}" font-weight="700" fill="#14110A">${esc(o.cta)}</text>`
    }
  } else {
    const r = h * 0.62
    body +=
      `<circle cx="${w * 0.84}" cy="${h * 0.5}" r="${r}" fill="none" stroke="${o.accent}" stroke-opacity="0.22" stroke-width="2"/>` +
      `<circle cx="${w * 0.84}" cy="${h * 0.5}" r="${r * 0.62}" fill="${o.accent}" fill-opacity="0.92"/>` +
      `<circle cx="${w * 0.84}" cy="${h * 0.5}" r="${r * 0.45}" fill="none" stroke="#000" stroke-opacity="0.18" stroke-width="${r * 0.05}" stroke-dasharray="${r * 0.14} ${r * 0.09}"/>` +
      `<circle cx="${w * 0.66}" cy="${h * 0.22}" r="${h * 0.06}" fill="${o.accent}" fill-opacity="0.75"/>`
    const compact = h / w < 0.3
    const size = compact ? h * 0.2 : h * 0.15
    const x = compact ? h * 0.28 : w * 0.06
    const total = lines.length * size * 1.12 + (o.subtitle ? size * 0.75 : 0) + (o.cta && !compact ? size * 1.5 : 0)
    let y = (h - total) / 2 + size * 0.85
    body += lines
      .map((l, i) => `<text x="${x}" y="${y + i * size * 1.12}" ${FONT} font-size="${size}" font-weight="800" fill="#FFFFFF">${esc(l)}</text>`)
      .join('')
    y += (lines.length - 1) * size * 1.12
    if (o.subtitle) {
      y += size * 0.78
      body += `<text x="${x}" y="${y}" ${FONT} font-size="${size * 0.5}" fill="#FFFFFF" fill-opacity="0.82">${esc(o.subtitle)}</text>`
    }
    if (o.cta && !compact) {
      const bh = size * 0.95
      const bw = size * 0.32 * o.cta.length + size * 1.2
      const by = y + size * 0.55
      body +=
        `<rect x="${x}" y="${by}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="${o.accent}"/>` +
        `<text x="${x + bw / 2}" y="${by + bh * 0.66}" text-anchor="middle" ${FONT} font-size="${size * 0.42}" font-weight="700" fill="#14110A">${esc(o.cta)}</text>`
    }
  }
  return svgDataUrl(w, h, defs + body)
}

const SKIN = ['#F5D0B5', '#E8B48F', '#C68863', '#8D5B3E', '#F1C27D', '#6B4429']
const HAIR = ['#2B1B10', '#5A3825', '#C48A3A', '#1F1F1F', '#8B2E2E', '#3D2B1F']

/** Avatar ilustrado (128×128), determinístico pelo índice. */
export function avatarArt(i: number): string {
  const rng = createRng(500 + i * 13)
  const hue = (i * 47 + 250) % 360
  const skin = SKIN[i % SKIN.length]
  const hair = HAIR[rng.int(0, HAIR.length - 1)]
  const shirt = `hsl(${(hue + 160) % 360} 55% 38%)`
  const acc = i % 5
  const long = i % 3 === 1
  let s = `<defs><clipPath id="c"><circle cx="64" cy="64" r="64"/></clipPath></defs><g clip-path="url(#c)">`
  s += `<rect width="128" height="128" fill="hsl(${hue} 62% 60%)"/><circle cx="100" cy="22" r="40" fill="#fff" fill-opacity="0.12"/>`
  if (long) s += `<rect x="34" y="40" width="60" height="62" rx="26" fill="${hair}"/>`
  s += `<path d="M22 128c4-26 20-38 42-38s38 12 42 38z" fill="${shirt}"/>`
  s += `<rect x="56" y="76" width="16" height="18" rx="6" fill="${skin}"/>`
  s += `<circle cx="64" cy="58" r="26" fill="${skin}"/>`
  s += `<path d="M38 57c0-19 12-29 26-29s26 10 26 29c-6-9-15-13-26-13s-20 4-26 13z" fill="${hair}"/>`
  s += `<circle cx="55" cy="61" r="3" fill="#1F2430"/><circle cx="73" cy="61" r="3" fill="#1F2430"/>`
  s += `<path d="M56 70q8 7 16 0" stroke="#1F2430" stroke-width="3" fill="none" stroke-linecap="round"/>`
  if (acc === 1) s += `<g fill="none" stroke="#1F2430" stroke-width="2.5"><circle cx="55" cy="61" r="7.5"/><circle cx="73" cy="61" r="7.5"/><path d="M62.5 61h3"/></g>`
  if (acc === 2) s += `<path d="M37 50c2-16 13-24 27-24s25 8 27 24z" fill="hsl(${(hue + 40) % 360} 75% 45%)"/><rect x="60" y="45" width="40" height="7" rx="3.5" fill="hsl(${(hue + 40) % 360} 75% 36%)"/>`
  if (acc === 3) s += `<path d="M36 62a28 28 0 0 1 56 0" stroke="#1F2430" stroke-width="5" fill="none"/><rect x="30" y="56" width="11" height="18" rx="5" fill="#1F2430"/><rect x="87" y="56" width="11" height="18" rx="5" fill="#1F2430"/>`
  if (acc === 4) s += `<path d="M44 36l6-15 7 10 7-13 7 13 7-10 6 15z" fill="#FACC15" stroke="#B45309" stroke-width="1.5" stroke-linejoin="round"/>`
  s += `</g>`
  return svgDataUrl(128, 128, s)
}

const METALS: [string, string][] = [
  ['#CD7F32', '#8A4F1C'],
  ['#D9DEE5', '#8D96A3'],
  ['#FACC15', '#B7791F'],
  ['#7DD3FC', '#2B7AB0'],
  ['#D8B4FE', '#7E3FBF'],
]

function starPoints(cx: number, cy: number, r: number, ri: number) {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2
    const rr = i % 2 === 0 ? r : ri
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`)
  }
  return pts.join(' ')
}

/** Medalha de conquista (96×96): ficha para apostas, estrela para vitórias. */
export function medalArt(kind: AchievementKind, level: number): string {
  const [metal, dark] = METALS[Math.max(0, Math.min(METALS.length - 1, level))]
  let s = `<defs><radialGradient id="sh" cx="0.35" cy="0.3" r="0.7"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>`
  s += `<circle cx="48" cy="48" r="45" fill="${dark}"/><circle cx="48" cy="48" r="38" fill="${metal}"/>`
  if (kind === 'apostas') {
    s += `<circle cx="48" cy="48" r="32" fill="none" stroke="#fff" stroke-opacity="0.85" stroke-width="7" stroke-dasharray="10 8"/>`
    s += `<circle cx="48" cy="48" r="19" fill="${dark}" fill-opacity="0.35"/><circle cx="48" cy="48" r="13" fill="#fff" fill-opacity="0.9"/>`
  } else {
    s += `<polygon points="${starPoints(48, 50, 24, 10)}" fill="#fff" fill-opacity="0.92"/>`
  }
  s += `<circle cx="48" cy="48" r="38" fill="url(#sh)"/>`
  return svgDataUrl(96, 96, s)
}

// ---------- Identidade e tema ----------

export interface ThemePreset {
  id: string
  name: string
  colors: SiteColors
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'x2win', name: 'X2Win', colors: { primary: '#7C4DFF', accent: '#FACC15', background: '#0B0D14', surface: '#151924', text: '#F2F4F8' } },
  { id: 'esmeralda', name: 'Esmeralda', colors: { primary: '#10B981', accent: '#FBBF24', background: '#06110D', surface: '#0F1F18', text: '#ECFDF5' } },
  { id: 'oceano', name: 'Oceano', colors: { primary: '#3B82F6', accent: '#22D3EE', background: '#0A0F1C', surface: '#121A2E', text: '#E6EDF7' } },
  { id: 'rubi', name: 'Rubi', colors: { primary: '#E11D48', accent: '#F59E0B', background: '#12070A', surface: '#1E0D12', text: '#FDECEF' } },
  { id: 'ouro', name: 'Ouro VIP', colors: { primary: '#D4A017', accent: '#F5F5F4', background: '#0E0C08', surface: '#1A1710', text: '#FAF5E6' } },
  { id: 'claro', name: 'Claro', colors: { primary: '#6C3BEB', accent: '#F59E0B', background: '#F5F6FA', surface: '#FFFFFF', text: '#101322' } },
]

export const DEFAULT_THEME: SiteTheme = {
  logo: logoArt(),
  favicon: faviconArt(),
  shareImage: shareArt(),
  colors: { ...THEME_PRESETS[0].colors },
}

export const SITE_DOMAIN = 'x2win.bet.br'

// ---------- Sportsbook ----------

export const SPORTSBOOK_FONTS = [
  { value: 'Roboto', label: 'Roboto (padrão da Betby)' },
  { value: 'Inter', label: 'Inter' },
  { value: 'Montserrat', label: 'Montserrat' },
  { value: 'Poppins', label: 'Poppins' },
  { value: 'Open Sans', label: 'Open Sans' },
  { value: 'Nunito', label: 'Nunito' },
  { value: 'Rubik', label: 'Rubik' },
]

export const DEFAULT_SPORTSBOOK: SportsbookConfig = { mode: 'escuro', font: 'Roboto', useSiteColors: false }

export interface SampleEvent {
  id: string
  league: string
  home: string
  away: string
  live: boolean
  when: string
  score?: [number, number]
  odds: [number, number, number]
}

export const SAMPLE_EVENTS: SampleEvent[] = [
  { id: 'e1', league: 'Brasileirão Série A', home: 'Flamengo', away: 'Palmeiras', live: true, when: "67'", score: [1, 1], odds: [2.35, 3.1, 3.05] },
  { id: 'e2', league: 'Brasileirão Série A', home: 'Corinthians', away: 'São Paulo', live: false, when: 'Hoje, 21:30', odds: [2.6, 3.2, 2.75] },
  { id: 'e3', league: 'Brasileirão Série A', home: 'Grêmio', away: 'Internacional', live: false, when: 'Amanhã, 16:00', odds: [2.45, 3.15, 2.95] },
  { id: 'e4', league: 'Liga dos Campeões', home: 'Real Madrid', away: 'Manchester City', live: false, when: 'Ter, 16:00', odds: [2.7, 3.6, 2.45] },
]

// ---------- Página inicial ----------

export interface HomeBlockInfo {
  label: string
  description: string
  configure?: { to: string; label: string }
}

export const HOME_BLOCK_INFO: Record<HomeBlockId, HomeBlockInfo> = {
  'banner-principal': { label: 'Banner principal', description: 'Carrossel de banners no topo da home.', configure: { to: '/settings/banners', label: 'Banners' } },
  'jogos-destaque': { label: 'Jogos em destaque', description: 'Jogos com maior destaque no catálogo.', configure: { to: '/games/jogos', label: 'Jogos' } },
  top10: { label: 'Top 10 da semana', description: 'Os 10 jogos mais jogados nos últimos 7 dias.', configure: { to: '/settings/game-preview', label: 'Vitrines' } },
  ganhadores: { label: 'Ganhadores ao vivo', description: 'Faixa com as últimas vitórias do site.', configure: { to: '/settings/avatar', label: 'Avatares' } },
  provedores: { label: 'Provedores', description: 'Faixa com os logotipos das provedoras.', configure: { to: '/settings/provedores-home', label: 'Provedores na home' } },
  'esportes-ao-vivo': { label: 'Esportes ao vivo', description: 'Partidas em andamento com odds.', configure: { to: '/settings/sportsbook', label: 'Sportsbook' } },
  torneios: { label: 'Torneios', description: 'Torneios abertos com ranking e prêmio.', configure: { to: '/campanhas/torneios', label: 'Torneios' } },
  missoes: { label: 'Missões', description: 'Missões do jogador com progresso.', configure: { to: '/campanhas/missoes', label: 'Missões' } },
  promocoes: { label: 'Promoções', description: 'Cartões das promoções ativas.', configure: { to: '/campanhas/promocoes', label: 'Promoções' } },
  categorias: { label: 'Categorias', description: 'Atalhos para slots, ao vivo, crash e mesa.' },
  'jogo-responsavel': { label: 'Jogo responsável', description: 'Aviso 18+ e link para os limites do jogador.', configure: { to: '/settings/jogo-responsavel', label: 'Jogo responsável' } },
}

export const DEFAULT_HOME: HomeConfig = {
  blocks: [
    { id: 'banner-principal', enabled: true },
    { id: 'categorias', enabled: false },
    { id: 'jogos-destaque', enabled: true },
    { id: 'top10', enabled: true },
    { id: 'esportes-ao-vivo', enabled: false },
    { id: 'ganhadores', enabled: true },
    { id: 'torneios', enabled: false },
    { id: 'promocoes', enabled: false },
    { id: 'missoes', enabled: false },
    { id: 'provedores', enabled: true },
    { id: 'jogo-responsavel', enabled: false },
  ],
}

// ---------- Provedores na home ----------

export const DEFAULT_PROVIDERS_HOME: ProvidersHomeConfig = {
  enabled: true,
  title: 'Provedores',
  showGameCount: true,
  items: ['pgsoft', 'pragmatic', 'spribe', 'evolution', 'playtech', 'hacksaw', 'netent', 'redtiger'].map((providerId) => ({ providerId, logo: null })),
}

// ---------- Banners ----------

export const BANNER_POSITIONS: BannerPosition[] = [
  { id: 'hero', label: 'Banner Hero', width: 1372, height: 476, max: 5, rotation: 'carrossel', where: 'Topo da home, em carrossel' },
  { id: 'login', label: 'Login', width: 320, height: 480, max: 3, rotation: 'alterna', where: 'Ao lado do formulário de login' },
  { id: 'cadastro', label: 'Cadastro', width: 320, height: 480, max: 3, rotation: 'alterna', where: 'Ao lado do formulário de cadastro' },
  { id: 'compacto', label: 'Banner Compacto', width: 500, height: 120, max: 3, rotation: 'alterna', where: 'Faixa entre os blocos da home' },
  { id: 'deposito', label: 'Depósito', width: 400, height: 200, max: 3, rotation: 'alterna', where: 'Janela de depósito, acima dos valores' },
  { id: 'promocoes', label: 'Promoções', width: 800, height: 300, max: 5, rotation: 'carrossel', where: 'Topo da página de promoções' },
  { id: 'lateral', label: 'Lateral da home', width: 300, height: 600, max: 2, rotation: 'alterna', where: 'Coluna direita da home, só no computador' },
]

export const BANNER_POSITION_BY_ID = new Map<BannerPositionId, BannerPosition>(BANNER_POSITIONS.map((p) => [p.id, p]))

const dk = (offsetDays: number) => dayKey(new Date(NOW.getTime() + offsetDays * DAY))

export function seedBanners(): Banner[] {
  const at = new Date(NOW.getTime() - 20 * DAY).toISOString()
  const pos = (id: BannerPositionId) => BANNER_POSITION_BY_ID.get(id)!
  const art = (id: BannerPositionId, o: Omit<Parameters<typeof bannerArt>[0], 'width' | 'height'>) => bannerArt({ width: pos(id).width, height: pos(id).height, ...o })
  return [
    {
      id: 'bn-hero-1',
      position: 'hero',
      name: 'Boas-vindas 100%',
      image: art('hero', { title: 'Bônus de 100%\nno 1º depósito', subtitle: 'Até R$ 500 para começar a jogar', cta: 'Depositar agora', from: '#3B1C8C', to: '#0E0A24', accent: '#FACC15' }),
      link: '/carteira/deposito',
      active: true,
      startsAt: dk(-10),
      endsAt: dk(20),
      createdAt: at,
    },
    {
      id: 'bn-hero-2',
      position: 'hero',
      name: 'Torneio Fortune Tiger',
      image: art('hero', { title: 'Torneio Fortune Tiger\nR$ 50 mil em prêmios', subtitle: 'Jogue e suba no ranking até domingo', cta: 'Participar', from: '#7A1F0E', to: '#1A0A06', accent: '#FB923C' }),
      link: '/torneios',
      active: true,
      startsAt: null,
      endsAt: null,
      createdAt: at,
    },
    {
      id: 'bn-hero-3',
      position: 'hero',
      name: 'Cashback de domingo',
      image: art('hero', { title: 'Cashback de 10%\ntodo domingo', subtitle: 'Perdeu? Parte volta para o seu saldo', cta: 'Ver regras', from: '#0B5D4B', to: '#04140F', accent: '#34D399' }),
      link: '/promocoes',
      active: true,
      startsAt: dk(3),
      endsAt: dk(60),
      createdAt: at,
    },
    {
      id: 'bn-login-1',
      position: 'login',
      name: 'Login · giros grátis',
      image: art('login', { title: '50 giros\ngrátis', subtitle: 'no seu primeiro depósito', cta: 'Entrar e jogar', from: '#2A1260', to: '#0B0D14', accent: '#FACC15' }),
      link: '/promocoes',
      active: true,
      startsAt: null,
      endsAt: null,
      createdAt: at,
    },
    {
      id: 'bn-cadastro-1',
      position: 'cadastro',
      name: 'Cadastro · bônus',
      image: art('cadastro', { title: 'Crie sua conta\ne ganhe 100%', subtitle: 'bônus no 1º depósito', cta: 'Cadastrar', from: '#0E3A73', to: '#060B18', accent: '#22D3EE' }),
      link: '',
      active: true,
      startsAt: null,
      endsAt: null,
      createdAt: at,
    },
    {
      id: 'bn-compacto-1',
      position: 'compacto',
      name: 'Faixa Aviator',
      image: art('compacto', { title: 'Aviator: voe até 10.000x', subtitle: 'Saque antes do avião sumir', from: '#8B0F2E', to: '#22050C', accent: '#F43F5E' }),
      link: '/cassino/crash',
      active: true,
      startsAt: null,
      endsAt: null,
      createdAt: at,
    },
    {
      id: 'bn-compacto-2',
      position: 'compacto',
      name: 'Faixa Dia das Crianças',
      image: art('compacto', { title: 'Semana das Crianças', subtitle: 'Giros extras em slots selecionados', from: '#5B21B6', to: '#1E0B45', accent: '#FACC15' }),
      link: '/promocoes',
      active: true,
      startsAt: dk(-30),
      endsAt: dk(-5),
      createdAt: at,
    },
  ]
}

// ---------- Perfil e avatares ----------

const TIER_DEFS: [AchievementKind, string, number][] = [
  ['apostas', 'Bronze', 100],
  ['apostas', 'Prata', 1000],
  ['apostas', 'Ouro', 10000],
  ['vitorias', 'Sortudo', 10],
  ['vitorias', 'Campeão', 100],
  ['vitorias', 'Lenda', 1000],
]

export const DEFAULT_TIERS: AchievementTier[] = TIER_DEFS.map(([kind, name, threshold], i) => ({
  id: `tier-${kind}-${i % 3}`,
  kind,
  name,
  threshold,
  image: medalArt(kind, i % 3),
}))

const LIBRARY_NAMES = ['Craque', 'Sortuda', 'Boné', 'DJ', 'Realeza', 'Estrela', 'Rockeira', 'Gamer']

export const DEFAULT_AVATARS: AvatarConfig = {
  mode: 'gerado',
  generatedStyle: 'iniciais',
  moderation: 'antes',
  allowLibrary: true,
  library: LIBRARY_NAMES.map((name, i) => ({ id: `av-${i + 1}`, name, image: avatarArt(i) })),
  achievementsEnabled: true,
  tiers: DEFAULT_TIERS,
  nameDisplay: 'apelido',
}

export interface SamplePlayer {
  id: string
  name: string
  nick: string
  /** jogador enviou foto (vale no modo "próprio") */
  photo: string | null
  bets: number
  wins: number
}

/** Jogadores de exemplo das prévias (sempre os mesmos). */
export function samplePlayers(): SamplePlayer[] {
  const rng = createRng(911)
  return Array.from({ length: 8 }, (_, i) => {
    const first = rng.pick(FIRST_NAMES)
    const last = rng.pick(LAST_NAMES)
    return {
      id: `sp${i + 1}`,
      name: `${first} ${last}`,
      nick: `${rng.pick(NICK_PARTS_A)}${rng.pick(NICK_PARTS_B)}`,
      photo: i % 3 === 0 ? avatarArt(10 + i) : null,
      bets: [12500, 3400, 820, 15200, 140, 2100, 60, 980][i],
      wins: [1300, 240, 35, 2100, 4, 160, 2, 75][i],
    }
  })
}

export const SAMPLE_WINS = [
  { player: 0, game: 'Fortune Tiger', amount: 2840.5 },
  { player: 1, game: 'Aviator', amount: 1265 },
  { player: 2, game: 'Gates of Olympus', amount: 918.4 },
  { player: 3, game: 'Crazy Time', amount: 5120 },
  { player: 4, game: 'Mines', amount: 342.8 },
]

export const SAMPLE_RANKING = [
  { player: 3, points: 18420, prize: 10000 },
  { player: 0, points: 15990, prize: 5000 },
  { player: 5, points: 12310, prize: 2500 },
  { player: 1, points: 9875, prize: 1000 },
]

// ---------- Menus do site ----------

export const SITE_PAGES = [
  { value: '/', label: 'Início' },
  { value: '/cassino', label: 'Cassino' },
  { value: '/cassino/ao-vivo', label: 'Cassino ao vivo' },
  { value: '/cassino/crash', label: 'Crash' },
  { value: '/esportes', label: 'Esportes' },
  { value: '/esportes/ao-vivo', label: 'Esportes ao vivo' },
  { value: '/promocoes', label: 'Promoções' },
  { value: '/torneios', label: 'Torneios' },
  { value: '/missoes', label: 'Missões' },
  { value: '/loja', label: 'Loja' },
  { value: '/vip', label: 'VIP e níveis' },
  { value: '/indique', label: 'Indique e ganhe' },
  { value: '/carteira/deposito', label: 'Depositar' },
  { value: '/conta', label: 'Minha conta' },
  { value: '/suporte', label: 'Suporte' },
  { value: '/jogo-responsavel', label: 'Jogo responsável' },
  { value: '/buscar', label: 'Buscar jogos' },
  { value: '/menu', label: 'Menu completo' },
]

export const SITE_PAGE_LABEL = new Map(SITE_PAGES.map((p) => [p.value, p.label]))

/** Ícones disponíveis para itens de menu (nomes da Lucide mapeados na tela). */
export const MENU_ICON_OPTIONS = [
  { key: 'house', label: 'Início' },
  { key: 'gamepad', label: 'Controle' },
  { key: 'dices', label: 'Dados' },
  { key: 'radio', label: 'Ao vivo' },
  { key: 'volleyball', label: 'Bola' },
  { key: 'zap', label: 'Raio' },
  { key: 'trophy', label: 'Troféu' },
  { key: 'gift', label: 'Presente' },
  { key: 'target', label: 'Alvo' },
  { key: 'crown', label: 'Coroa' },
  { key: 'store', label: 'Loja' },
  { key: 'users', label: 'Pessoas' },
  { key: 'wallet', label: 'Carteira' },
  { key: 'user', label: 'Perfil' },
  { key: 'headset', label: 'Suporte' },
  { key: 'search', label: 'Busca' },
  { key: 'menu', label: 'Menu' },
  { key: 'flame', label: 'Chama' },
  { key: 'star', label: 'Estrela' },
  { key: 'ticket', label: 'Cupom' },
  { key: 'heart', label: 'Cuidado' },
] as const

const mi = (id: string, label: string, icon: string, page: string, audience: SiteMenuItem['audience'] = 'todos'): SiteMenuItem => ({
  id,
  label,
  icon,
  linkType: 'pagina',
  page,
  url: '',
  audience,
})

export const DEFAULT_MENUS: MenusConfig = {
  header: [
    mi('h1', 'Cassino', 'gamepad', '/cassino'),
    mi('h2', 'Ao vivo', 'radio', '/cassino/ao-vivo'),
    mi('h3', 'Esportes', 'volleyball', '/esportes'),
    mi('h4', 'Crash', 'zap', '/cassino/crash'),
    mi('h5', 'Promoções', 'gift', '/promocoes'),
    mi('h6', 'Torneios', 'trophy', '/torneios'),
    mi('h7', 'VIP', 'crown', '/vip', 'logados'),
  ],
  mobile: [
    mi('m1', 'Início', 'house', '/'),
    mi('m2', 'Cassino', 'gamepad', '/cassino'),
    mi('m3', 'Esportes', 'volleyball', '/esportes'),
    mi('m4', 'Promoções', 'gift', '/promocoes'),
    mi('m5', 'Menu', 'menu', '/menu'),
  ],
}

// modo API: registros só do servidor (sem nada gravado, lista vazia; o gerador não roda)
demoRecords(seedBanners)
