// Componentes compartilhados pelas telas de Configurações (parte 1):
// moldura de prévia do site, moldura de celular, selo de país (ISO) e markdown.
import { Fragment, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Eye, Lock } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui'
import { cn } from '@/lib/cn'
import { parseMarkdown, type MdInline } from '@/domain/config1-textos'

/** Cartão "Prévia" com moldura de navegador: mostra o que o jogador vê. */
export function SitePreview({
  url,
  title = 'Prévia no site',
  description = 'Como o jogador vê. Atualiza enquanto você edita.',
  icon = Eye,
  actions,
  children,
  className,
  bodyClassName,
}: {
  url: string
  title?: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <Card className={className}>
      <CardHeader icon={icon} title={title} description={description} actions={actions} />
      <CardBody>
        <BrowserFrame url={url} className={bodyClassName}>
          {children}
        </BrowserFrame>
      </CardBody>
    </Card>
  )
}

export function BrowserFrame({ url, children, className }: { url: string; children: ReactNode; className?: string }) {
  return (
    <figure className="m-0 overflow-hidden rounded-xl border border-line bg-bg shadow-sm" aria-label={`Prévia da página ${url}`}>
      <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
        <span className="flex shrink-0 gap-1" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-danger/50" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/50" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/50" />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] text-fg-3">
          <Lock size={11} className="shrink-0 text-success" aria-hidden />
          <span className="truncate">{url}</span>
        </span>
      </div>
      <div className={cn('relative', className)}>{children}</div>
    </figure>
  )
}

/** Moldura de celular para prévias de telas do jogador. */
export function PhoneFrame({ children, url, className, maxHeight = 620 }: { children: ReactNode; url?: string; className?: string; maxHeight?: number | 'none' }) {
  return (
    <div className={cn('mx-auto w-full max-w-[320px] rounded-[30px] border-[6px] border-line-strong bg-bg p-1 shadow-pop', className)}>
      <div className="overflow-hidden rounded-[22px] bg-bg">
        <div className="flex items-center justify-between px-4 pb-1 pt-2 text-[10px] font-semibold text-fg-2" aria-hidden>
          <span>9:41</span>
          <span className="h-3.5 w-16 rounded-full bg-line-strong" />
          <span className="flex items-center gap-0.5">
            <span className="h-2 w-0.5 rounded bg-fg-2" />
            <span className="h-2.5 w-0.5 rounded bg-fg-2" />
            <span className="h-3 w-0.5 rounded bg-fg-2" />
          </span>
        </div>
        {url && (
          <div className="mx-3 mb-2 flex items-center justify-center gap-1 rounded-md bg-surface-3 px-2 py-1 font-mono text-[10px] text-fg-3">
            <Lock size={9} className="text-success" aria-hidden />
            <span className="truncate">{url}</span>
          </div>
        )}
        <div className="overflow-y-auto" style={{ maxHeight }}>
          {children}
        </div>
      </div>
    </div>
  )
}

/** Selo com o código ISO do país (sem bandeira em emoji). */
export function IsoBadge({ code, tone = 'neutral', className }: { code: string; tone?: 'neutral' | 'danger' | 'primary'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 w-9 shrink-0 items-center justify-center rounded-md border font-mono text-[11px] font-bold tracking-wide',
        tone === 'neutral' && 'border-line-strong/70 bg-surface-2 text-fg-2',
        tone === 'danger' && 'border-danger/25 bg-danger/10 text-danger',
        tone === 'primary' && 'border-primary/25 bg-primary/10 text-primary-text',
        className,
      )}
      aria-label={`Código do país: ${code}`}
    >
      {code}
    </span>
  )
}

function Inline({ parts }: { parts: MdInline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.t === 'b' ? (
          <strong key={i} className="font-semibold text-fg">
            {p.v}
          </strong>
        ) : p.t === 'i' ? (
          <em key={i}>{p.v}</em>
        ) : p.t === 'a' ? (
          <a key={i} href={p.href} className="link" target="_blank" rel="noreferrer noopener" onClick={(e) => e.preventDefault()}>
            {p.v}
          </a>
        ) : (
          <Fragment key={i}>{p.v}</Fragment>
        ),
      )}
    </>
  )
}

/** Renderiza o markdown simples dos textos legais (sem HTML injetado). */
export function Markdown({ text, className, compact }: { text: string; className?: string; compact?: boolean }) {
  const blocks = parseMarkdown(text)
  return (
    <div className={cn('text-fg-2', compact ? 'space-y-2 text-[13px] leading-5' : 'space-y-3 text-sm leading-6', className)}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'h1':
            return (
              <h2 key={i} className={cn('font-display font-bold text-fg', compact ? 'text-base' : 'text-xl')}>
                <Inline parts={b.inline} />
              </h2>
            )
          case 'h2':
            return (
              <h3 key={i} className={cn('font-display font-semibold text-fg', compact ? 'pt-1 text-[13.5px]' : 'pt-2 text-base')}>
                <Inline parts={b.inline} />
              </h3>
            )
          case 'h3':
            return (
              <h4 key={i} className="pt-1 text-[13.5px] font-semibold text-fg">
                <Inline parts={b.inline} />
              </h4>
            )
          case 'quote':
            return (
              <blockquote key={i} className="rounded-r-lg border-l-4 border-primary/50 bg-primary/5 px-3 py-2 text-fg">
                <Inline parts={b.inline} />
              </blockquote>
            )
          case 'hr':
            return <hr key={i} className="border-line" />
          case 'ul':
            return (
              <ul key={i} className="list-disc space-y-1 pl-5 marker:text-fg-3">
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline parts={it} />
                  </li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={i} className="list-decimal space-y-1 pl-5 marker:text-fg-3">
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline parts={it} />
                  </li>
                ))}
              </ol>
            )
          default:
            return (
              <p key={i}>
                <Inline parts={b.inline} />
              </p>
            )
        }
      })}
    </div>
  )
}

/** Número pequeno com rótulo (dentro de cartões). */
export function MiniStat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-xs text-fg-3">{label}</p>
      <p className="mt-0.5 truncate text-base font-bold text-fg tnum">{value}</p>
      {sub && <p className="truncate text-xs text-fg-3">{sub}</p>}
    </div>
  )
}

/** Lista de verificação com ícone e tom (usada em impactos e riscos). */
export function CheckRow({ icon: Icon, tone = 'neutral', children }: { icon: LucideIcon; tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'info'; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[13px] leading-5 text-fg-2">
      <Icon
        size={15}
        className={cn(
          'mt-0.5 shrink-0',
          tone === 'neutral' && 'text-fg-3',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
          tone === 'info' && 'text-info',
        )}
        aria-hidden
      />
      <span className="min-w-0">{children}</span>
    </li>
  )
}
