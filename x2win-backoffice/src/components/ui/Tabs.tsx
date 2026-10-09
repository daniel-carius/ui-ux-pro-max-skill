import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/cn'

export interface TabItem<V extends string = string> {
  value: V
  label: ReactNode
  icon?: LucideIcon
  count?: number
}

export function Tabs<V extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: V
  onChange: (v: V) => void
  items: TabItem<V>[]
  className?: string
}) {
  return (
    <div className={cn('-mb-px flex gap-1 overflow-x-auto border-b border-line scrollbar-none', className)} role="tablist">
      {items.map((t) => {
        const active = t.value === value
        const Icon = t.icon
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            className={cn(
              'relative inline-flex h-10 shrink-0 items-center gap-2 px-3 text-sm font-medium transition-colors duration-150',
              active ? 'text-fg' : 'text-fg-3 hover:text-fg',
            )}
          >
            {Icon && <Icon size={16} aria-hidden />}
            {t.label}
            {t.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[11px] font-semibold tnum',
                  active ? 'bg-primary/10 text-primary-text' : 'bg-surface-3 text-fg-3',
                )}
              >
                {t.count}
              </span>
            )}
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-2 -bottom-px h-0.5 rounded-full transition-colors duration-150',
                active ? 'bg-primary' : 'bg-transparent',
              )}
            />
          </button>
        )
      })}
    </div>
  )
}

/**
 * Aba guardada na URL (?aba=...), para link direto e botão voltar.
 *   const [tab, setTab] = useTabParam('fila', ['fila', 'regras'])
 */
export function useTabParam<V extends string>(fallback: V, allowed: readonly V[], param = 'aba'): [V, (v: V) => void] {
  const [params, setParams] = useSearchParams()
  const raw = params.get(param) as V | null
  const value = raw && allowed.includes(raw) ? raw : fallback
  const set = (v: V) => {
    const next = new URLSearchParams(params)
    if (v === fallback) next.delete(param)
    else next.set(param, v)
    setParams(next, { replace: true })
  }
  return [value, set]
}
