import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

export type Tone = 'neutral' | 'primary' | 'success' | 'danger' | 'warning' | 'info' | 'gold'

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-fg-2 ring-line-strong/40',
  primary: 'bg-primary/10 text-primary-text ring-primary/20',
  success: 'bg-success/10 text-success ring-success/20',
  danger: 'bg-danger/10 text-danger ring-danger/20',
  warning: 'bg-warning/10 text-warning ring-warning/25',
  info: 'bg-info/10 text-info ring-info/20',
  gold: 'bg-gold/15 text-warning ring-gold/25 dark:text-gold',
}

const DOTS: Record<Tone, string> = {
  neutral: 'bg-fg-3',
  primary: 'bg-primary',
  success: 'bg-success',
  danger: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-info',
  gold: 'bg-gold',
}

export interface BadgeProps {
  tone?: Tone
  icon?: LucideIcon
  dot?: boolean
  size?: 'sm' | 'md'
  className?: string
  children: ReactNode
}

export function Badge({ tone = 'neutral', icon: Icon, dot, size = 'sm', className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full font-medium ring-1 ring-inset',
        size === 'sm' ? 'h-[22px] px-2 text-xs' : 'h-7 px-2.5 text-[13px]',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOTS[tone])} aria-hidden />}
      {Icon && <Icon size={12} className="shrink-0" aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
  )
}

/** Mapa de status → tom. Use em listas: <StatusBadge status="aprovado" map={...} /> */
export function StatusBadge<S extends string>({
  status,
  labels,
  tones,
}: {
  status: S
  labels: Record<S, string>
  tones: Partial<Record<S, Tone>>
}) {
  return (
    <Badge tone={tones[status] ?? 'neutral'} dot>
      {labels[status] ?? status}
    </Badge>
  )
}

/** Indicador de variação: ▲ 12,3% */
export function Delta({ value, goodWhenUp = true, className }: { value: number | null; goodWhenUp?: boolean; className?: string }) {
  if (value == null || !Number.isFinite(value)) return <span className={cn('text-xs text-fg-3', className)}>—</span>
  const up = value >= 0
  const good = up === goodWhenUp
  const txt = `${up ? '+' : ''}${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`
  return (
    <span
      className={cn('inline-flex items-center gap-0.5 text-xs font-semibold tnum', good ? 'text-success' : 'text-danger', className)}
      aria-label={`${up ? 'alta' : 'queda'} de ${txt}`}
    >
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden className={up ? '' : 'rotate-180'}>
        <path d="M4 1l3 5H1z" fill="currentColor" />
      </svg>
      {txt}
    </span>
  )
}
