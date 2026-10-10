import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, CheckCircle2, CloudOff, Info, Inbox, OctagonAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { initials } from '@/lib/format'

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-3 text-fg-3">
        <Icon size={22} aria-hidden />
      </span>
      <p className="text-sm font-semibold text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-5 text-fg-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/**
 * Modo API: indicador sem fonte de dados nesta versão (serviço de métricas, tráfego do site, sessões...).
 * Aparece no lugar de números gerados no navegador, que antes eram mostrados como se fossem reais.
 *   <NoDataSource title="Tráfego do site sem integração">O painel ainda não recebe...</NoDataSource>
 */
export function NoDataSource({ title, children, action, className, compact }: { title: string; children?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn('rounded-xl border border-dashed border-line-strong/70 bg-surface-2/50', className)}>
      <EmptyState icon={CloudOff} title={title} description={children} action={action} className={compact ? 'py-6' : 'py-10'} />
    </div>
  )
}

/** Texto curto para um número sem fonte (modo API): "—" com a explicação no hint. */
export const NO_SOURCE_HINT = 'sem fonte de dados nesta versão'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('relative overflow-hidden rounded-md bg-surface-3', className)} aria-hidden>
    <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/5" />
  </div>
}

export type AlertTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral'

const ALERT: Record<AlertTone, { icon: LucideIcon; cls: string; iconCls: string }> = {
  info: { icon: Info, cls: 'border-info/25 bg-info/5', iconCls: 'text-info' },
  success: { icon: CheckCircle2, cls: 'border-success/25 bg-success/5', iconCls: 'text-success' },
  warning: { icon: AlertTriangle, cls: 'border-warning/30 bg-warning/5', iconCls: 'text-warning' },
  danger: { icon: OctagonAlert, cls: 'border-danger/25 bg-danger/5', iconCls: 'text-danger' },
  neutral: { icon: Info, cls: 'border-line bg-surface-2', iconCls: 'text-fg-3' },
}

/** Aviso em bloco. Use para regras de negócio, riscos e estados do sistema. */
export function Alert({
  tone = 'info',
  title,
  children,
  icon,
  action,
  className,
}: {
  tone?: AlertTone
  title?: ReactNode
  children?: ReactNode
  icon?: LucideIcon
  action?: ReactNode
  className?: string
}) {
  const S = ALERT[tone]
  const Icon = icon ?? S.icon
  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-start', S.cls, className)} role={tone === 'danger' ? 'alert' : undefined}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon size={18} className={cn('mt-px shrink-0', S.iconCls)} aria-hidden />
        <div className="min-w-0 text-[13px] leading-5 text-fg-2">
          {title && <p className="font-semibold text-fg">{title}</p>}
          {children && <div className={cn(title && 'mt-0.5')}>{children}</div>}
        </div>
      </div>
      {action && <div className="shrink-0 pl-7 sm:pl-0">{action}</div>}
    </div>
  )
}

export function Progress({
  value,
  max = 100,
  tone = 'primary',
  className,
  label,
}: {
  value: number
  max?: number
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
  className?: string
  label?: string
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const color = { primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', info: 'bg-info' }[tone]
  const track = { primary: 'bg-primary/15', success: 'bg-success/15', warning: 'bg-warning/15', danger: 'bg-danger/15', info: 'bg-info/15' }[tone]
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full', track, className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${pct}%` }} />
    </div>
  )
}

const AVATAR_HUES = [262, 210, 160, 24, 330, 190, 45, 290]

export function Avatar({ name, src, size = 32, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const hue = AVATAR_HUES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_HUES.length]
  if (src) {
    return <img src={src} alt="" width={size} height={size} className={cn('shrink-0 rounded-full object-cover', className)} style={{ width: size, height: size }} />
  }
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.38),
        background: `hsl(${hue} 70% 55% / 0.16)`,
        color: `hsl(${hue} 60% var(--avatar-l, 42%))`,
      }}
    >
      {initials(name)}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-line-strong/70 bg-surface-2 px-1 font-sans text-[11px] font-medium text-fg-3">
      {children}
    </kbd>
  )
}

/** Pessoa/jogador em linha de tabela: avatar + nome + linha secundária */
export function PersonCell({ name, sub, src }: { name: string; sub?: ReactNode; src?: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name} src={src} size={30} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-fg">{name}</p>
        {sub && <p className="truncate text-xs text-fg-3">{sub}</p>}
      </div>
    </div>
  )
}

/** Texto monoespaçado para IDs e referências */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[12.5px] text-fg-2', className)}>{children}</span>
}
