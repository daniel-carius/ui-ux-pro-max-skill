import { useId, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
  size?: 'sm' | 'md'
  id?: string
  className?: string
  /** só o botão, sem texto (exige ariaLabel) */
  ariaLabel?: string
}

export function Switch({ checked, onChange, label, description, disabled, size = 'md', id, className, ariaLabel }: SwitchProps) {
  const autoId = useId()
  const sid = id ?? `sw-${autoId.replace(/:/g, '')}`
  const btn = (
    <button
      id={sid}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'md' ? 'h-6 w-11' : 'h-5 w-9',
        checked ? 'bg-primary' : 'bg-line-strong',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-200',
          size === 'md' ? 'h-5 w-5' : 'h-4 w-4',
          checked ? (size === 'md' ? 'translate-x-[22px]' : 'translate-x-[18px]') : 'translate-x-0.5',
        )}
      />
    </button>
  )
  if (!label && !description) return <span className={className}>{btn}</span>
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {label && (
          <label htmlFor={sid} className="block text-sm font-medium text-fg">
            {label}
          </label>
        )}
        {description && <p className="mt-0.5 text-[13px] leading-5 text-fg-3">{description}</p>}
      </div>
      <div className="pt-0.5">{btn}</div>
    </div>
  )
}

export interface CheckboxProps {
  checked: boolean | 'indeterminate'
  onChange: (checked: boolean) => void
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
  className?: string
  ariaLabel?: string
}

export function Checkbox({ checked, onChange, label, description, disabled, className, ariaLabel }: CheckboxProps) {
  const isOn = checked === true
  const box = (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked === 'indeterminate' ? 'mixed' : isOn}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!isOn)}
      className={cn(
        'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong bg-surface hover:border-fg-3',
      )}
    >
      {checked === 'indeterminate' ? <Minus size={12} strokeWidth={3} /> : isOn ? <Check size={12} strokeWidth={3} /> : null}
    </button>
  )
  if (!label) return box
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      {box}
      <div className="min-w-0 cursor-pointer" onClick={() => !disabled && onChange(!isOn)}>
        <span className="text-sm text-fg">{label}</span>
        {description && <p className="text-[13px] leading-5 text-fg-3">{description}</p>}
      </div>
    </div>
  )
}

export interface ChoiceOption<V extends string> {
  value: V
  label: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  disabled?: boolean
  badge?: ReactNode
}

/** Opções em cartões (radio). Bom para escolhas com explicação. */
export function RadioCards<V extends string>({
  value,
  onChange,
  options,
  columns = 2,
  disabled,
  name,
  className,
}: {
  value: V
  onChange: (v: V) => void
  options: ChoiceOption<V>[]
  columns?: 1 | 2 | 3 | 4
  disabled?: boolean
  name?: string
  className?: string
}) {
  const gid = useId()
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className={cn(
        'grid gap-2.5',
        columns === 1 && 'grid-cols-1',
        columns === 2 && 'grid-cols-1 sm:grid-cols-2',
        columns === 3 && 'grid-cols-1 sm:grid-cols-3',
        columns === 4 && 'grid-cols-2 lg:grid-cols-4',
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value
        const Icon = o.icon
        return (
          <button
            key={o.value}
            id={`${gid}-${o.value}`}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled || o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative flex items-start gap-3 rounded-xl border p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-150',
              'disabled:cursor-not-allowed disabled:opacity-60',
              active ? 'border-primary bg-primary/5 shadow-ring' : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2',
            )}
          >
            {Icon && (
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                  active ? 'bg-primary text-primary-fg' : 'bg-surface-3 text-fg-2',
                )}
              >
                <Icon size={16} aria-hidden />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium text-fg">
                {o.label}
                {o.badge}
              </span>
              {o.description && <span className="mt-0.5 block text-[13px] leading-5 text-fg-3">{o.description}</span>}
            </span>
            <span
              aria-hidden
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                active ? 'border-primary bg-primary' : 'border-line-strong',
              )}
            >
              {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Controle segmentado compacto (ex.: 7d | 30d | 90d) */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
  ariaLabel,
}: {
  value: V
  onChange: (v: V) => void
  options: { value: V; label: ReactNode; icon?: LucideIcon }[]
  size?: 'sm' | 'md'
  className?: string
  ariaLabel?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('inline-flex rounded-lg border border-line bg-surface-2 p-0.5', className)}
    >
      {options.map((o) => {
        const active = o.value === value
        const Icon = o.icon
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-150',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
              active ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-fg-3 hover:text-fg',
            )}
          >
            {Icon && <Icon size={14} aria-hidden />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Filtros rápidos em chips com contagem */
export function ChipFilter<V extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: V
  onChange: (v: V) => void
  options: { value: V; label: string; count?: number; tone?: 'danger' | 'warning' }[]
  className?: string
}) {
  return (
    <div className={cn('flex gap-1.5 overflow-x-auto scrollbar-none sm:flex-wrap sm:overflow-visible', className)} role="tablist">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors duration-150',
              active
                ? 'border-fg bg-fg text-surface'
                : 'border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg',
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[11px] font-semibold tnum',
                  active ? 'bg-surface/20 text-surface' : o.tone === 'danger' ? 'bg-danger/10 text-danger' : o.tone === 'warning' ? 'bg-warning/10 text-warning' : 'bg-surface-3 text-fg-3',
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
