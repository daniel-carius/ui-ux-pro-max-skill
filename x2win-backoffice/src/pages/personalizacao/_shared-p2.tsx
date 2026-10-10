// Peças compartilhadas pelas telas de Personalização (parte 2), Modo de ataque e
// Manutenção: moldura de prévia do site do jogador, logo, capas de jogo, ícones
// de redes sociais, rodapé do site e um formulário que salva parte de um estado.
//
// Dentro da prévia (o site que o jogador vê) usamos cores explícitas do site,
// em PREVIEW. Fora dela, só tokens de tema do painel.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  BadgeCheck,
  Clock,
  Eye,
  HeartHandshake,
  Lock,
  Mail,
  MapPin,
  Maximize2,
  MessagesSquare,
  Monitor,
  Phone,
  Smartphone,
} from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, IconButton, Modal, Segmented, toast, type SettingsForm } from '@/components/ui'
import { isApiMode } from '@/lib/api'
import { cn } from '@/lib/cn'
import { audit, usePageAccess } from '@/domain/session'
import { safeImageSrc } from '@/domain/personalizacao-p1'
import type { CompanyState } from '@/domain/system'
import type { Game } from '@/data/catalog'
import {
  SOCIAL_DEFS,
  visibleContacts,
  type ContactKey,
  type FooterSettings,
  type SocialLink,
  type SocialNetwork,
} from '@/data/personalizacao2-config'

// ---------- Paleta do site do jogador (só dentro das prévias) ----------

export const PREVIEW = {
  bg: '#0B0A1A',
  bg2: '#100E24',
  surface: '#17142F',
  surface2: '#211D42',
  line: 'rgba(255,255,255,0.08)',
  text: '#F5F3FF',
  muted: '#A9A4CC',
  faint: '#77729B',
  accent: '#7C4DFF',
  accentSoft: 'rgba(124,77,255,0.18)',
  accentText: '#C4B2FF',
  gold: '#FACC15',
  green: '#22C55E',
  red: '#F43F5E',
} as const

export type Device = 'desktop' | 'mobile'

/** Prévia começa no formato do aparelho de quem está editando. */
export function initialDevice(): Device {
  try {
    return window.matchMedia('(max-width: 639px)').matches ? 'mobile' : 'desktop'
  } catch {
    return 'desktop'
  }
}

export function DeviceToggle({ value, onChange }: { value: Device; onChange: (d: Device) => void }) {
  return (
    <Segmented<Device>
      size="sm"
      ariaLabel="Tamanho da prévia"
      value={value}
      onChange={onChange}
      options={[
        { value: 'desktop', label: 'Computador', icon: Monitor },
        { value: 'mobile', label: 'Celular', icon: Smartphone },
      ]}
    />
  )
}

/** Renderiza o conteúdo numa largura virtual e reduz para caber no cartão. */
export function ScaledPreview({ width, children, className }: { width: number; children: ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ scale: 1, height: 0 })
  useLayoutEffect(() => {
    const o = outer.current
    const i = inner.current
    if (!o || !i) return
    const update = () => {
      const scale = Math.min(1, o.clientWidth / width)
      setBox({ scale, height: Math.ceil(i.offsetHeight * scale) })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(o)
    ro.observe(i)
    return () => ro.disconnect()
  }, [width])
  return (
    <div ref={outer} className={cn('relative w-full overflow-hidden', className)} style={{ height: box.height || undefined }}>
      <div ref={inner} className="absolute left-0 top-0" style={{ width, transform: `scale(${box.scale})`, transformOrigin: 'top left' }}>
        {children}
      </div>
    </div>
  )
}

/** Moldura de navegador (computador) ou de celular em volta da prévia. */
export function BrowserFrame({
  url,
  device,
  children,
  label,
  virtualWidth = 1024,
}: {
  url: string
  device: Device
  children: ReactNode
  label: string
  /** largura simulada da tela do computador */
  virtualWidth?: number
}) {
  if (device === 'mobile') {
    return (
      <figure aria-label={label} className="m-0">
        <div className="mx-auto w-full max-w-[320px] rounded-[2rem] border border-line-strong bg-surface-3 p-2 shadow-card">
          <div className="mx-auto mb-1.5 h-1.5 w-16 rounded-full bg-line-strong" aria-hidden />
          <div className="overflow-hidden rounded-[1.5rem]">
            <div className="max-h-[640px] overflow-y-auto scrollbar-none">
              <ScaledPreview width={390}>{children}</ScaledPreview>
            </div>
          </div>
        </div>
      </figure>
    )
  }
  return (
    <figure aria-label={label} className="m-0 overflow-hidden rounded-xl border border-line-strong/80 shadow-card">
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
        <span className="flex gap-1" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
        </span>
        <span className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-surface px-2 text-[11px] text-fg-3 ring-1 ring-inset ring-line">
          <Lock size={10} className="shrink-0" aria-hidden />
          <span className="truncate">{url}</span>
        </span>
      </div>
      <ScaledPreview width={virtualWidth}>{children}</ScaledPreview>
    </figure>
  )
}

/** Cartão "Prévia ao vivo" que acompanha a rolagem no computador. */
export function LivePreview({
  title = 'Prévia ao vivo',
  description,
  actions,
  dirty,
  children,
  footnote,
  className,
  expand,
  sticky = true,
}: {
  title?: string
  description?: ReactNode
  actions?: ReactNode
  dirty?: boolean
  children: ReactNode
  footnote?: ReactNode
  className?: string
  /** conteúdo maior mostrado no botão "Ampliar" */
  expand?: ReactNode
  /** acompanha a rolagem no computador */
  sticky?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <Card className={cn(sticky && 'xl:sticky xl:top-24', className)}>
      <CardHeader
        icon={Eye}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {title}
            {dirty ? <Badge tone="warning" dot>Rascunho não salvo</Badge> : <Badge tone="success" dot>Igual ao site</Badge>}
          </span>
        }
        description={description}
        actions={
          actions || expand ? (
            <>
              {actions}
              {expand && <IconButton icon={Maximize2} label="Ampliar prévia" variant="secondary" size="sm" onClick={() => setOpen(true)} />}
            </>
          ) : undefined
        }
      />
      <CardBody>
        {children}
        {footnote && <p className="mt-3 text-xs leading-5 text-fg-3">{footnote}</p>}
      </CardBody>
      {expand && (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title={title}
          description="Prévia em tamanho maior. Feche para continuar editando."
          icon={Eye}
          size="xl"
          footer={<Button onClick={() => setOpen(false)}>Fechar</Button>}
        >
          {expand}
        </Modal>
      )}
    </Card>
  )
}

/** Contador de caracteres com faixa recomendada. */
export function CharCount({ count, max, min, id }: { count: number; max: number; min?: number; id?: string }) {
  const over = count > max
  const under = min !== undefined && count > 0 && count < min
  return (
    <span id={id} className={cn('text-xs font-medium tnum', over ? 'text-danger' : under ? 'text-warning' : 'text-fg-3')} aria-live="polite">
      {count}/{max}
    </span>
  )
}

// ---------- Marca, capas e ícones (dentro da prévia) ----------

export function SiteLogo({ name = 'X2Win', size = 28, color = PREVIEW.text }: { name?: string; size?: number; color?: string }) {
  return (
    <span className="inline-flex items-center gap-2" style={{ color }}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="16" fill={PREVIEW.accent} />
        <path d="M18 20l10 12-10 12h7l6.5-8 6.5 8h7L35 32l10-12h-7l-6.5 8-6.5-8z" fill="#fff" />
        <circle cx="49" cy="15" r="4" fill={PREVIEW.gold} />
      </svg>
      <span style={{ fontSize: size * 0.64, fontWeight: 800, letterSpacing: '-0.02em', fontFamily: '"Plus Jakarta Sans", Inter, sans-serif' }}>{name}</span>
    </span>
  )
}

/** Capa do jogo: imagem enviada (endereço seguro e que carrega) ou arte gerada pela cor do jogo. */
export function GameCover({ game, provider, style, compact }: { game: Game; provider?: string; style?: CSSProperties; compact?: boolean }) {
  const cover = safeImageSrc(game.cover)
  const [failed, setFailed] = useState<string | null>(null)
  if (cover && failed !== cover) {
    return <img src={cover} alt={game.name} className="h-full w-full object-cover" style={style} onError={() => setFailed(cover)} />
  }
  return (
    <div
      className="relative flex h-full w-full flex-col justify-end overflow-hidden"
      style={{
        background: `radial-gradient(120% 90% at 20% 10%, hsl(${(game.hue + 30) % 360} 85% 62%) 0%, hsl(${game.hue} 75% 42%) 45%, hsl(${(game.hue + 320) % 360} 70% 18%) 100%)`,
        padding: compact ? 8 : 12,
        ...style,
      }}
      role="img"
      aria-label={game.name}
    >
      <span
        aria-hidden
        className="absolute rounded-full"
        style={{ width: '70%', aspectRatio: '1', right: '-18%', top: '-12%', background: 'rgba(255,255,255,0.14)' }}
      />
      <span
        aria-hidden
        className="absolute rounded-full"
        style={{ width: '38%', aspectRatio: '1', left: '-8%', bottom: '28%', background: 'rgba(0,0,0,0.12)' }}
      />
      <span className="relative font-display font-extrabold leading-tight" style={{ color: '#fff', fontSize: compact ? 12 : 15, textShadow: '0 1px 6px rgba(0,0,0,0.35)' }}>
        {game.name}
      </span>
      {provider && (
        <span className="relative mt-0.5 font-semibold uppercase" style={{ color: 'rgba(255,255,255,0.75)', fontSize: compact ? 8 : 9, letterSpacing: '0.06em' }}>
          {provider}
        </span>
      )}
    </div>
  )
}

/** Cor da marca de cada rede (null = usa a cor do texto). */
export const SOCIAL_COLOR: Record<SocialNetwork, string | null> = {
  instagram: '#E1306C',
  facebook: '#1877F2',
  x: null,
  youtube: '#FF0033',
  tiktok: null,
  telegram: '#229ED9',
  whatsapp: '#25D366',
  discord: '#5865F2',
  kwai: '#FF7A00',
}

/** Desenho simples de cada rede (a Lucide desta versão não tem marcas). */
export function SocialGlyph({ network, size = 18, className, style }: { network: SocialNetwork; size?: number; className?: string; style?: CSSProperties }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, className, style, fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (network) {
    case 'instagram':
      return (
        <svg {...common}>
          <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5" />
          <circle cx="12" cy="12" r="4.1" />
          <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'facebook':
      return (
        <svg {...common} stroke="none" fill="currentColor">
          <path d="M13.6 21v-7.6h2.6l.4-3.1h-3V8.4c0-.9.3-1.5 1.6-1.5h1.6V4.1c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.3H7.9v3.1h2.7V21z" />
        </svg>
      )
    case 'x':
      return (
        <svg {...common}>
          <path d="M4.5 4h4.2l10.8 16h-4.2z" fill="currentColor" stroke="none" />
          <path d="M19.2 4l-6.1 6.9M10.9 13.1L4.8 20" />
        </svg>
      )
    case 'youtube':
      return (
        <svg {...common} stroke="none" fill="currentColor">
          <path fillRule="evenodd" d="M6.2 5.2h11.6a4.2 4.2 0 0 1 4.2 4.2v5.2a4.2 4.2 0 0 1-4.2 4.2H6.2A4.2 4.2 0 0 1 2 14.6V9.4a4.2 4.2 0 0 1 4.2-4.2zM10 9v6l5.2-3z" />
        </svg>
      )
    case 'tiktok':
      return (
        <svg {...common} stroke="none" fill="currentColor">
          <path d="M14.6 3c.4 2.3 1.9 3.8 4.4 4v3.1a7.6 7.6 0 0 1-4.4-1.4v6.6a5.7 5.7 0 1 1-5.7-5.7c.3 0 .6 0 .9.1v3.2a2.5 2.5 0 1 0 1.7 2.4V3z" />
        </svg>
      )
    case 'telegram':
      return (
        <svg {...common}>
          <path d="M21.4 3.6L2.8 10.9l6.6 2.4 2.5 6.9 3.4-4.3 5 3.6z" />
          <path d="M9.4 13.3l11.9-9.6" />
        </svg>
      )
    case 'whatsapp':
      return (
        <svg {...common}>
          <path d="M20.2 11.7a8.3 8.3 0 0 1-12.2 7.3L3.6 20.4l1.4-4.2a8.3 8.3 0 1 1 15.2-4.5z" />
          <path
            d="M9.1 8.4c.2-.5.4-.5.7-.5h.5c.2 0 .4.1.5.4l.7 1.6c.1.2 0 .4-.1.6l-.5.6c.4.9 1.3 1.8 2.3 2.3l.6-.5c.2-.2.4-.2.6-.1l1.6.7c.3.1.4.3.4.5v.5c0 .3-.1.6-.6.8-.5.3-1.6.5-3.2-.3a8.6 8.6 0 0 1-3.6-3.6c-.6-1.4-.5-2.6-.3-3z"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      )
    case 'discord':
      return (
        <svg {...common}>
          <path d="M8.6 5.6c-1.6.3-2.9.8-4 1.5-1.6 2.4-2.3 5-2.1 9.1 1.4 1.1 3 1.8 4.6 2.3l1.1-1.8M15.4 5.6c1.6.3 2.9.8 4 1.5 1.6 2.4 2.3 5 2.1 9.1-1.4 1.1-3 1.8-4.6 2.3l-1.1-1.8" />
          <path d="M7.2 16.2c3.2 1.4 6.4 1.4 9.6 0M7.6 7.8c2.9-1 5.9-1 8.8 0" />
          <circle cx="9.1" cy="12.4" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="14.9" cy="12.4" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'kwai':
      return (
        <svg {...common}>
          <rect x="2.8" y="6.4" width="12.6" height="11.2" rx="3" />
          <path d="M15.4 10.6l5.4-3v8.8l-5.4-3z" />
          <circle cx="9.1" cy="12" r="2" fill="currentColor" stroke="none" />
        </svg>
      )
  }
}

/** Ícone da rede num quadrado neutro (para listas do painel). */
export function SocialTile({ network, size = 36 }: { network: SocialNetwork; size?: number }) {
  const color = SOCIAL_COLOR[network]
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-xl bg-surface-2 ring-1 ring-inset ring-line', !color && 'text-fg')}
      style={{ width: size, height: size, color: color ?? undefined }}
      aria-hidden
    >
      <SocialGlyph network={network} size={Math.round(size * 0.5)} />
    </span>
  )
}

// ---------- Rodapé do site (prévia) ----------

export function fmtCnpj(v: string) {
  const d = v.replace(/\D/g, '')
  if (d.length !== 14) return v
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

/**
 * Linha legal do rodapé ("Razão social · CNPJ 00.000.000/0000-00") só com o que existe em Empresa e licença,
 * sem separador sobrando; null sem razão social nem CNPJ (o rodapé deixa a linha de fora).
 */
export function legalLine(company: Pick<CompanyState, 'legalName' | 'cnpj'>): string | null {
  const name = company.legalName.trim()
  const cnpj = company.cnpj.trim()
  const parts = [name, cnpj ? `CNPJ ${fmtCnpj(cnpj)}` : ''].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

const CONTACT_ICON: Partial<Record<ContactKey, typeof Phone>> = { phone: Phone, email: Mail, chat: MessagesSquare, hours: Clock, address: MapPin }

export function SocialRow({ links, mobile, highlight }: { links: SocialLink[]; mobile?: boolean; highlight?: boolean }) {
  const shown = links.filter((l) => l.visible)
  return (
    <div
      className="flex flex-wrap items-center"
      style={{
        gap: 10,
        justifyContent: mobile ? 'center' : 'flex-start',
        outline: highlight ? `2px dashed ${PREVIEW.accentText}` : undefined,
        outlineOffset: 6,
        borderRadius: 12,
        minHeight: 40,
      }}
    >
      {shown.length === 0 ? (
        <span style={{ color: PREVIEW.faint, fontSize: 12 }}>Sem redes cadastradas</span>
      ) : (
        shown.map((l) => (
          <span
            key={l.id}
            title={SOCIAL_DEFS[l.network].label}
            className="inline-flex items-center justify-center rounded-full"
            style={{ width: 40, height: 40, background: 'rgba(255,255,255,0.07)', border: `1px solid ${PREVIEW.line}`, color: SOCIAL_COLOR[l.network] ?? PREVIEW.text }}
          >
            <SocialGlyph network={l.network} size={19} />
          </span>
        ))
      )}
    </div>
  )
}

export function SiteFooter({
  footer,
  socials,
  company,
  mobile,
  highlightSocial,
}: {
  footer: FooterSettings
  socials: SocialLink[]
  company: CompanyState
  mobile?: boolean
  highlightSocial?: boolean
}) {
  const contacts = visibleContacts(footer)
  const main = contacts.filter((c) => c.key !== 'hours' && c.key !== 'address' && c.key !== 'chat')
  const chat = contacts.find((c) => c.key === 'chat')
  const hours = contacts.find((c) => c.key === 'hours')
  const address = contacts.find((c) => c.key === 'address')
  const heading: CSSProperties = { color: PREVIEW.text, fontSize: 13, fontWeight: 700, marginBottom: 12, letterSpacing: '0.02em' }
  const linkStyle: CSSProperties = { color: PREVIEW.muted, fontSize: 13, lineHeight: '26px' }
  const year = new Date().getFullYear()
  const legal = legalLine(company)

  const contactIcon = (key: ContactKey) => {
    if (key === 'whatsapp') return <SocialGlyph network="whatsapp" size={15} />
    if (key === 'telegram') return <SocialGlyph network="telegram" size={15} />
    const I = CONTACT_ICON[key] ?? Phone
    return <I size={15} aria-hidden />
  }

  return (
    <footer style={{ background: PREVIEW.bg2, borderTop: `1px solid ${PREVIEW.line}`, color: PREVIEW.muted, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: mobile ? '1fr' : '1.5fr 1fr 1.3fr 1fr',
          gap: mobile ? 28 : 40,
          padding: mobile ? '28px 20px' : '44px 56px 36px',
          textAlign: mobile ? 'center' : 'left',
        }}
      >
        <div>
          <SiteLogo name={footer.companyName || 'X2Win'} size={30} />
          {footer.description.trim() && <p style={{ marginTop: 14, fontSize: 13, lineHeight: '21px', color: PREVIEW.muted, maxWidth: 360, marginInline: mobile ? 'auto' : undefined }}>{footer.description}</p>}
        </div>
        <div>
          <p style={heading}>Institucional</p>
          <ul>
            <li style={linkStyle}>Termos de uso</li>
            {footer.privacyUrl.trim() && <li style={linkStyle}>Política de privacidade</li>}
            {footer.sealResponsible && <li style={linkStyle}>Jogo responsável</li>}
            <li style={linkStyle}>Central de ajuda</li>
          </ul>
        </div>
        <div>
          <p style={heading}>Fale com a gente</p>
          {contacts.length === 0 ? (
            <p style={{ fontSize: 12, color: PREVIEW.faint }}>Nenhum canal preenchido</p>
          ) : (
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: mobile ? 'center' : 'flex-start' }}>
              {main.map((c) => (
                <li key={c.key} className="flex items-center" style={{ gap: 8, fontSize: 13, color: PREVIEW.text }}>
                  <span style={{ color: PREVIEW.accentText, display: 'inline-flex' }}>{contactIcon(c.key)}</span>
                  <span>{c.display}</span>
                </li>
              ))}
              {chat && (
                <li>
                  <span
                    className="inline-flex items-center"
                    style={{ gap: 8, marginTop: 4, padding: '8px 14px', borderRadius: 999, background: PREVIEW.accent, color: '#fff', fontSize: 12, fontWeight: 700 }}
                  >
                    <MessagesSquare size={14} aria-hidden /> {chat.display}
                  </span>
                </li>
              )}
              {hours && (
                <li className="flex items-center" style={{ gap: 6, fontSize: 12, color: PREVIEW.muted }}>
                  <Clock size={13} aria-hidden /> {hours.display}
                </li>
              )}
              {address && (
                <li className="flex items-start" style={{ gap: 6, fontSize: 12, color: PREVIEW.muted, maxWidth: 280, textAlign: mobile ? 'center' : 'left' }}>
                  <MapPin size={13} aria-hidden style={{ marginTop: 2, flexShrink: 0 }} /> {address.display}
                </li>
              )}
            </ul>
          )}
        </div>
        <div>
          <p style={heading}>Siga a {footer.companyName || 'X2Win'}</p>
          <SocialRow links={socials} mobile={mobile} highlight={highlightSocial} />
        </div>
      </div>

      {(footer.seal18 || footer.sealResponsible || footer.sealLicense) && (
        <div
          className="flex flex-wrap items-center"
          style={{ gap: 12, padding: mobile ? '18px 20px' : '18px 56px', borderTop: `1px solid ${PREVIEW.line}`, justifyContent: mobile ? 'center' : 'flex-start' }}
        >
          {footer.seal18 && (
            <span
              className="inline-flex items-center justify-center rounded-full"
              style={{ width: 38, height: 38, border: `2px solid ${PREVIEW.red}`, color: PREVIEW.text, fontWeight: 800, fontSize: 13 }}
              title="Proibido para menores de 18 anos"
            >
              18+
            </span>
          )}
          {footer.sealResponsible && (
            <span className="inline-flex items-center" style={{ gap: 6, padding: '7px 12px', borderRadius: 10, border: `1px solid ${PREVIEW.line}`, fontSize: 12, color: PREVIEW.text }}>
              <HeartHandshake size={15} aria-hidden style={{ color: PREVIEW.green }} /> Jogo responsável
            </span>
          )}
          {footer.sealLicense && (
            <span className="inline-flex items-center" style={{ gap: 8, padding: '7px 12px', borderRadius: 10, border: `1px solid ${PREVIEW.line}`, fontSize: 11.5, color: PREVIEW.muted, maxWidth: mobile ? '100%' : 560, textAlign: 'left' }}>
              <BadgeCheck size={16} aria-hidden style={{ color: PREVIEW.gold, flexShrink: 0 }} />
              <span>{footer.licenseText || 'Licença SPA/MF'}</span>
            </span>
          )}
        </div>
      )}

      <div style={{ padding: mobile ? '14px 20px 22px' : '14px 56px 22px', borderTop: `1px solid ${PREVIEW.line}`, fontSize: 11.5, color: PREVIEW.faint, textAlign: mobile ? 'center' : 'left', lineHeight: '18px' }}>
        © {year} {footer.companyName || 'X2Win'}
        {footer.showLegalLine && legal && (
          <>
            {' · '}
            {legal}
          </>
        )}
        {' · '}Jogue com responsabilidade.
      </div>
    </footer>
  )
}

// ---------- Formulário que salva só parte de um estado compartilhado ----------

/**
 * Igual ao useSettingsForm, mas o rascunho cobre só algumas chaves de um estado
 * compartilhado (ex.: opções do modo de ataque). Ao salvar, mescla no estado
 * atual sem mexer nas outras chaves (como "ligado" ou "desde").
 */
export function useMergedSettingsForm<S extends object, K extends keyof S>(
  state: S,
  setState: (next: (prev: S) => S) => void,
  keys: readonly K[],
  opts: { entity: string; validate?: (v: Pick<S, K>) => string | null; successMessage?: string; describe?: (v: Pick<S, K>, prev: Pick<S, K>) => string },
): SettingsForm<Pick<S, K>> {
  const { canEdit } = usePageAccess()
  const pick = (s: S) => {
    const o = {} as Pick<S, K>
    for (const k of keys) o[k] = s[k]
    return o
  }
  const saved = pick(state)
  const savedStr = JSON.stringify(saved)
  const [values, setValues] = useState<Pick<S, K>>(saved)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setValues(JSON.parse(savedStr) as Pick<S, K>)
  }, [savedStr])
  const dirty = useMemo(() => JSON.stringify(values) !== savedStr, [values, savedStr])
  return {
    values,
    saved,
    set: (k, v) => setValues((prev) => ({ ...prev, [k]: v })),
    patch: (p) => setValues((prev) => ({ ...prev, ...p })),
    setValues,
    dirty,
    readOnly: !canEdit,
    saving,
    reset: () => setValues(saved),
    save: () => {
      if (!canEdit) {
        toast.error('Seu cargo não pode editar esta tela.')
        return
      }
      const err = opts.validate?.(values)
      if (err) {
        toast.error('Revise os campos', { description: err })
        return
      }
      setSaving(true)
      const prev = saved
      const next = values
      setTimeout(() => {
        setState((s) => ({ ...s, ...next }))
        const changed = keys.filter((k) => JSON.stringify(next[k]) !== JSON.stringify(prev[k]))
        // modo API: o servidor registra a gravação da chave (Modo de ataque e Manutenção são só dele)
        if (!isApiMode()) audit('editar', opts.entity, opts.describe?.(next, prev) ?? (changed.length ? `Campos alterados: ${changed.join(', ')}` : 'Configuração salva'))
        setSaving(false)
        toast.success(opts.successMessage ?? 'Alterações salvas', { description: 'A mudança já vale no site e foi registrada na auditoria.' })
      }, 400)
    },
  }
}
