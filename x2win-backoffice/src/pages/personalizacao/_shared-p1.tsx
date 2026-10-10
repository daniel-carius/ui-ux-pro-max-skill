// Peças compartilhadas pelas telas de Personalização (parte 1): layout com
// prévia ao vivo, moldura de navegador e celular, cabeçalho do site e ícones.
// As prévias desenham o SITE DO JOGADOR, então usam as cores configuradas da
// marca (estilos inline). O cromo do painel ao redor usa só tokens de tema.
import { useEffect, useMemo, useState, type CSSProperties, type ImgHTMLAttributes, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  CircleUserRound,
  Crown,
  Dices,
  Eye,
  Flame,
  Gamepad2,
  Gift,
  HeartHandshake,
  House,
  Headset,
  ImageOff,
  Lock,
  Menu as MenuGlyph,
  Radio,
  Search,
  Star,
  Store,
  Target,
  Ticket,
  Trophy,
  Users,
  Volleyball,
  Wallet,
  X,
  Zap,
} from 'lucide-react'
import { Button, ImageUpload, toast } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useDb } from '@/lib/store'
import { useCompany } from '@/domain/system'
import {
  monogram,
  ratioMatches,
  rgba,
  safeImageSrc,
  sitePalette,
  visibleMenuItems,
  type MenusConfig,
  type ProviderStripItem,
  type ProvidersHomeConfig,
  type SitePalette,
  type SiteTheme,
} from '@/domain/personalizacao-p1'
import type { Provider } from '@/data/catalog'
import { DEFAULT_MENUS, DEFAULT_THEME, P1_KEYS, SITE_DOMAIN } from '@/data/personalizacao-p1'

// ---------- Estado lido por várias telas ----------

/** Tema salvo do site (Identidade e tema). */
export function useSiteTheme(): SiteTheme {
  const [t] = useDb<SiteTheme>(P1_KEYS.tema, DEFAULT_THEME)
  return t
}

export function useSitePalette(): SitePalette {
  const t = useSiteTheme()
  return useMemo(() => sitePalette(t.colors, DEFAULT_THEME.colors), [t.colors])
}

/** Título da aba do navegador: nome fantasia da empresa. */
export function useSiteTitle() {
  const [company] = useCompany()
  return `${company.tradeName || 'X2Win'} · Cassino e apostas`
}

// ---------- Layout: formulário + prévia fixa ----------

/** Formulário à esquerda e prévia fixa à direita (computador); prévia abaixo no celular. */
export function EditorLayout({ preview, children }: { preview: ReactNode; children: ReactNode }) {
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 space-y-5">{children}</div>
      {preview}
    </div>
  )
}

/**
 * Bloco de configuração no mesmo visual do SettingsSection, mas com o título
 * acima dos campos quando a prévia ocupa a lateral (evita coluna apertada).
 */
export function EditorSection({
  title,
  description,
  aside,
  children,
  className,
  id,
}: {
  title: ReactNode
  description?: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <section
      id={id}
      className={cn(
        'card grid scroll-mt-24 gap-5 p-5',
        'lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)] lg:gap-8 xl:grid-cols-1 xl:gap-5 min-[1760px]:grid-cols-[minmax(0,220px)_minmax(0,1fr)] min-[1760px]:gap-8',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-[13px] leading-5 text-fg-3">{description}</p>}
        {aside && <div className="mt-3">{aside}</div>}
      </div>
      <div className="min-w-0 space-y-5">{children}</div>
    </section>
  )
}

/** Cartão da prévia ao vivo, fixo na lateral em telas largas. */
export function PreviewPanel({
  title = 'Prévia ao vivo',
  description,
  actions,
  footer,
  children,
}: {
  title?: string
  description?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <aside id="previa" aria-label={title} className="min-w-0 scroll-mt-24 xl:sticky xl:top-[84px]">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              {title}
            </h2>
            {description && <p className="mt-0.5 text-xs text-fg-3">{description}</p>}
          </div>
          {actions}
        </div>
        <div className="p-3 sm:p-4 xl:max-h-[calc(100dvh-210px)] xl:overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-line bg-surface-2 px-4 py-2.5 text-xs leading-5 text-fg-3">{footer}</div>}
      </div>
    </aside>
  )
}

/** Atalho para a prévia quando ela fica abaixo do formulário. */
export function PreviewJumpButton() {
  return (
    <Button
      icon={Eye}
      className="xl:hidden"
      onClick={() => document.getElementById('previa')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
    >
      Ver prévia
    </Button>
  )
}

// ---------- Molduras ----------

/** Janela de navegador: aba com ícone e título, barra de endereço. */
export function BrowserFrame({
  favicon,
  title,
  path = '',
  children,
  className,
}: {
  favicon?: string | null
  title?: string
  path?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('overflow-hidden rounded-xl border border-line-strong/70 bg-surface-3 shadow-card', className)}>
      <div className="flex items-end gap-2 px-2 pt-2">
        <div className="flex gap-1 pb-2 pl-1" aria-hidden>
          <span className="h-2 w-2 rounded-full bg-danger/70" />
          <span className="h-2 w-2 rounded-full bg-warning/70" />
          <span className="h-2 w-2 rounded-full bg-success/70" />
        </div>
        <div className="flex min-w-0 max-w-[230px] flex-1 items-center gap-1.5 rounded-t-lg bg-surface px-2.5 py-1.5">
          <SafeImage
            src={favicon}
            className="h-3.5 w-3.5 shrink-0 rounded-sm object-contain"
            fallback={<span className="h-3.5 w-3.5 shrink-0 rounded-sm bg-line-strong" aria-hidden />}
          />
          <span className="min-w-0 flex-1 truncate text-[10.5px] font-medium text-fg-2">{title}</span>
          <X size={10} className="shrink-0 text-fg-3" aria-hidden />
        </div>
      </div>
      <div className="flex items-center gap-2 border-b border-line bg-surface px-2.5 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[10.5px] text-fg-3">
          <Lock size={9} aria-hidden className="shrink-0" />
          <span className="truncate">
            {SITE_DOMAIN}
            {path}
          </span>
        </div>
      </div>
      <div className="bg-surface">{children}</div>
    </div>
  )
}

/** Celular com área de conteúdo. */
export function PhoneFrame({ children, className, background }: { children: ReactNode; className?: string; background?: string }) {
  return (
    <div className={cn('mx-auto w-full max-w-[250px] rounded-[30px] border border-line-strong bg-fg p-[7px] shadow-pop', className)}>
      <div className="relative overflow-hidden rounded-[24px]" style={{ background }}>
        <div className="pointer-events-none absolute left-1/2 top-1.5 z-10 h-[14px] w-[64px] -translate-x-1/2 rounded-full bg-fg" aria-hidden />
        {children}
      </div>
    </div>
  )
}

// ---------- Peças do site ----------

/**
 * Imagem gravada (logotipo, banner, avatar, capa): só vira <img> com endereço seguro
 * (safeImageSrc: imagem enviada pelo painel, blob:, /assets ou https://). Sem imagem segura,
 * ou se ela não carregar (em produção a CSP bloqueia imagem externa), mostra `fallback` ou um
 * espaço neutro do mesmo tamanho.
 */
export function SafeImage({
  src,
  fallback,
  alt = '',
  className,
  style,
  ...rest
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & { src: string | null | undefined; fallback?: ReactNode }) {
  const safe = safeImageSrc(src)
  const [failed, setFailed] = useState<string | null>(null)
  if (!safe || failed === safe) {
    if (fallback !== undefined) return <>{fallback}</>
    return (
      <span
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        className={cn('inline-flex items-center justify-center overflow-hidden bg-surface-3 text-fg-3', className)}
        style={style}
      >
        <ImageOff className="h-1/2 max-h-[24px] w-1/2 max-w-[24px]" aria-hidden />
      </span>
    )
  }
  return <img {...rest} src={safe} alt={alt} className={className} style={style} onError={() => setFailed(safe)} />
}

export function SiteLogo({
  src,
  className,
  style,
  alt = 'Logotipo',
  center,
}: {
  src: string | null
  className?: string
  style?: CSSProperties
  alt?: string
  center?: boolean
}) {
  const text = (
    <span className={cn('inline-flex items-center font-display text-sm font-extrabold tracking-tight', center && 'justify-center', className)} style={style}>
      X2WIN
    </span>
  )
  // sem logotipo (ou imagem que não carrega): o nome em texto
  return <SafeImage src={src} alt={alt} className={cn('object-contain', center ? 'object-center' : 'object-left', className)} style={style} fallback={text} />
}

/** Cabeçalho do site do jogador, com os itens configurados em Menus do site. */
export function SiteHeaderMock({
  palette: p,
  logo,
  viewer = 'visitante',
  active = 0,
  items: itemsProp,
  className,
}: {
  palette: SitePalette
  logo: string | null
  viewer?: 'visitante' | 'logado'
  active?: number
  items?: MenusConfig['header']
  className?: string
}) {
  const [menus] = useDb<MenusConfig>(P1_KEYS.menus, DEFAULT_MENUS)
  const items = visibleMenuItems(itemsProp ?? menus.header, viewer)
  return (
    <div className={cn('flex items-center gap-2.5 px-2.5 py-1.5', className)} style={{ background: p.surface, borderBottom: `1px solid ${p.line}` }}>
      <SiteLogo src={logo} className="h-7 w-[56px] shrink-0" style={{ color: p.text }} />
      <nav
        aria-label="Menu do site (prévia)"
        className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden text-[9.5px] font-semibold"
        style={{ maskImage: 'linear-gradient(90deg,#000 85%,transparent)', WebkitMaskImage: 'linear-gradient(90deg,#000 85%,transparent)' }}
      >
        {items.map((it, i) => (
          <span key={it.id} className="relative flex shrink-0 items-center gap-1 py-1" style={{ color: i === active ? p.text : p.muted }}>
            <MenuIcon name={it.icon} size={10} />
            {it.label}
            {i === active && <span className="absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full" style={{ background: p.primary }} aria-hidden />}
          </span>
        ))}
      </nav>
      {viewer === 'visitante' ? (
        <div className="flex shrink-0 items-center gap-1">
          <span className="rounded-md px-2 py-1 text-[9.5px] font-semibold" style={{ color: p.text, border: `1px solid ${p.line}` }}>
            Entrar
          </span>
          <span className="rounded-md px-2 py-1 text-[9.5px] font-bold" style={{ background: p.primary, color: p.onPrimary }}>
            Cadastrar
          </span>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <span className="rounded-md px-1.5 py-1 text-[9.5px] font-semibold tnum" style={{ background: p.surface2, color: p.text }}>
            R$ 250,00
          </span>
          <span className="rounded-md px-2 py-1 text-[9.5px] font-bold" style={{ background: p.primary, color: p.onPrimary }}>
            Depositar
          </span>
        </div>
      )}
    </div>
  )
}

/** Título de bloco do site (prévias). */
export function SiteBlockTitle({ palette: p, children, action = 'Ver todos' }: { palette: SitePalette; children: ReactNode; action?: string | null }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <span className="text-[10.5px] font-bold" style={{ color: p.text }}>
        {children}
      </span>
      {action && (
        <span className="text-[9px] font-semibold" style={{ color: p.primary }}>
          {action}
        </span>
      )}
    </div>
  )
}

/** Capa de jogo de mentira (degradê com o tom do jogo). */
export function GameTileMock({ hue, label, className }: { hue: number; label?: string; className?: string }) {
  return (
    <div
      className={cn('relative aspect-[3/4] overflow-hidden rounded-md', className)}
      style={{ background: `linear-gradient(150deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 65% 28%))` }}
    >
      <span className="absolute -right-2 -top-2 h-6 w-6 rounded-full" style={{ background: 'rgba(255,255,255,0.2)' }} aria-hidden />
      {label && (
        <span className="absolute inset-x-1 bottom-1 truncate text-[7.5px] font-bold drop-shadow" style={{ color: '#FFFFFF' }}>
          {label}
        </span>
      )}
    </div>
  )
}

/** Monograma da provedora quando não há logotipo enviado. */
export function Monogram({ name, hue, className, style }: { name: string; hue: number; className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex items-center justify-center rounded-lg font-display font-extrabold tracking-tight', className)}
      style={{ background: `linear-gradient(140deg, hsl(${hue} 65% 52%), hsl(${(hue + 35) % 360} 60% 34%))`, color: '#FFFFFF', ...style }}
    >
      {monogram(name)}
    </span>
  )
}

/** Borda tracejada para posição vazia na prévia. */
export function EmptySlot({ palette: p, children, className, style }: { palette: SitePalette; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div
      className={cn('flex items-center justify-center rounded-md border border-dashed p-2 text-center text-[9px] font-medium', className)}
      style={{ borderColor: rgba(p.text, 0.25), color: p.muted, ...style }}
    >
      {children}
    </div>
  )
}

// ---------- Ícones de menu ----------

export const MENU_ICON_MAP: Record<string, LucideIcon> = {
  house: House,
  gamepad: Gamepad2,
  dices: Dices,
  radio: Radio,
  volleyball: Volleyball,
  zap: Zap,
  trophy: Trophy,
  gift: Gift,
  target: Target,
  crown: Crown,
  store: Store,
  users: Users,
  wallet: Wallet,
  user: CircleUserRound,
  headset: Headset,
  search: Search,
  menu: MenuGlyph,
  flame: Flame,
  star: Star,
  ticket: Ticket,
  heart: HeartHandshake,
}

export function MenuIcon({ name, size = 16, className, style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  const Icon = MENU_ICON_MAP[name] ?? Star
  return <Icon size={size} className={className} style={style} aria-hidden />
}

// ---------- Envio de imagem com proporção obrigatória ----------

/**
 * ImageUpload que recusa imagens fora da proporção da posição (tolerância de 2%).
 * O ImageUpload compartilhado só avisa; aqui a regra é obrigatória.
 */
export function RatioImageUpload({
  width,
  height,
  value,
  onChange,
  disabled,
  label,
  hint,
  previewClassName,
  className,
}: {
  width: number
  height: number
  value: string | null
  onChange: (v: string | null) => void
  disabled?: boolean
  label?: string
  hint?: ReactNode
  previewClassName?: string
  className?: string
}) {
  const handle = (url: string | null) => {
    if (!url) {
      onChange(null)
      return
    }
    const img = new window.Image()
    img.onload = () => {
      const w = img.naturalWidth
      const h = img.naturalHeight
      // SVG sem tamanho declarado: aceita (é vetor e se ajusta)
      if (!w || !h || ratioMatches(w, h, width, height)) {
        onChange(url)
        return
      }
      toast.error('Proporção diferente da posição', {
        description: `A imagem tem ${w}×${h} px. Esta posição pede ${width}×${height} px (ou o mesmo formato maior). Recorte e envie de novo.`,
        duration: 6000,
      })
    }
    img.onerror = () => toast.error('Não foi possível ler a imagem', { description: 'Tente outro arquivo PNG, JPG ou WEBP.' })
    img.src = url
  }
  return (
    <ImageUpload
      width={width}
      height={height}
      value={safeImageSrc(value)}
      onChange={handle}
      disabled={disabled}
      label={label}
      hint={hint}
      previewClassName={previewClassName}
      className={className}
    />
  )
}

// ---------- Fontes do Google (prévia do sportsbook) ----------

/** Carrega as fontes da lista uma única vez (para a amostra e a prévia). */
export function useGoogleFonts(families: string[]) {
  const key = families.join('|')
  useEffect(() => {
    const id = `p1-gf-${key.replace(/[^a-z0-9]+/gi, '-')}`
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;600;700`).join('&')}&display=swap`
    document.head.appendChild(link)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------- Faixa de provedores (Home e Provedores na home) ----------

/** Faixa de provedores como o jogador vê. Provedoras pausadas não aparecem. */
export function ProviderStripMock({
  palette: p,
  config,
  providers,
  columns = 4,
  limit,
}: {
  palette: SitePalette
  config: ProvidersHomeConfig
  providers: Provider[]
  columns?: number
  limit?: number
}) {
  const byId = new Map(providers.map((x) => [x.id, x]))
  const list = config.items
    .map((it) => ({ it, prov: byId.get(it.providerId) }))
    .filter((x): x is { it: ProviderStripItem; prov: Provider } => !!x.prov && x.prov.status === 'ativa')
  const shown = limit ? list.slice(0, limit) : list
  return (
    <div>
      <SiteBlockTitle palette={p}>{config.title.trim() || 'Provedores'}</SiteBlockTitle>
      {shown.length === 0 ? (
        <EmptySlot palette={p} className="h-12">
          Nenhum provedor ativo na faixa
        </EmptySlot>
      ) : (
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {shown.map(({ it, prov }) => (
            <div key={prov.id} className="flex min-w-0 flex-col items-center gap-1 rounded-md px-1 py-1.5" style={{ background: p.surface, border: `1px solid ${p.line}` }}>
              <SafeImage
                src={it.logo}
                alt={prov.name}
                className="h-5 w-full object-contain"
                fallback={<Monogram name={prov.name} hue={prov.logoHue} className="h-5 w-8 rounded text-[8.5px]" />}
              />
              <span className="w-full truncate text-center text-[8px] font-semibold" style={{ color: p.text }}>
                {prov.name}
              </span>
              {config.showGameCount && (
                <span className="-mt-0.5 text-[7.5px]" style={{ color: p.muted }}>
                  {prov.games} jogos
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
