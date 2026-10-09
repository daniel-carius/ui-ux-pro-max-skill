import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './Button'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Trava o scroll, fecha com Esc, prende o foco dentro e devolve ao sair. */
function useModalBehavior(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement>) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return
    const prevFocus = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = setTimeout(() => {
      const el = ref.current
      if (!el) return
      const auto = el.querySelector<HTMLElement>('[data-autofocus]')
      const first = auto ?? el.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? el).focus()
    }, 20)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
      if (e.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null)
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
      prevFocus?.focus?.()
    }
  }, [open, ref])
}

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  iconTone?: 'primary' | 'danger' | 'warning' | 'success'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  footer?: ReactNode
  children?: ReactNode
}

const ICON_TONE = {
  primary: 'bg-primary/10 text-primary-text',
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  success: 'bg-success/10 text-success',
}

export function Modal({ open, onClose, title, description, icon: Icon, iconTone = 'primary', size = 'md', footer, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)
  useModalBehavior(open, onClose, ref)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92dvh] w-full animate-pop-in flex-col rounded-t-2xl border border-line bg-surface shadow-pop outline-none sm:rounded-2xl',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-lg',
          size === 'lg' && 'sm:max-w-2xl',
          size === 'xl' && 'sm:max-w-4xl',
        )}
      >
        <div className="flex items-start gap-3 px-5 pb-2 pt-5">
          {Icon && (
            <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', ICON_TONE[iconTone])}>
              <Icon size={20} aria-hidden />
            </span>
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            {description && <p className="mt-1 text-[13px] leading-5 text-fg-3">{description}</p>}
          </div>
          <IconButton icon={X} label="Fechar" size="sm" onClick={onClose} className="-mr-1 -mt-1" />
        </div>
        {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">{children}</div>}
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  width?: 'md' | 'lg' | 'xl'
  footer?: ReactNode
  headerExtra?: ReactNode
  children?: ReactNode
}

/** Painel lateral para fichas e formulários longos. */
export function Drawer({ open, onClose, title, description, width = 'lg', footer, headerExtra, children }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null)
  useModalBehavior(open, onClose, ref)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[90]">
      <div className="absolute inset-0 animate-fade-in bg-black/45" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 right-0 flex w-full animate-slide-in-right flex-col border-l border-line bg-surface shadow-pop outline-none',
          width === 'md' && 'sm:max-w-md',
          width === 'lg' && 'sm:max-w-xl',
          width === 'xl' && 'sm:max-w-3xl',
        )}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-fg-3">{description}</p>}
          </div>
          {headerExtra}
          <IconButton icon={X} label="Fechar" size="sm" onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/** Posiciona um painel flutuante abaixo do gatilho e fecha ao clicar fora. */
function useFloating(open: boolean, setOpen: (v: boolean) => void, align: 'start' | 'end') {
  const triggerRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const t = triggerRef.current
      const p = panelRef.current
      if (!t) return
      const r = t.getBoundingClientRect()
      const pw = p?.offsetWidth ?? 220
      const ph = p?.offsetHeight ?? 200
      let left = align === 'end' ? r.right - pw : r.left
      left = Math.max(8, Math.min(left, window.innerWidth - pw - 8))
      let top = r.bottom + 6
      if (top + ph > window.innerHeight - 8 && r.top - ph - 6 > 8) top = r.top - ph - 6
      setPos({ top, left, minWidth: r.width })
    }
    place()
    const raf = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])

  return { triggerRef, panelRef, pos }
}

export interface MenuItem {
  label: ReactNode
  icon?: LucideIcon
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
  hint?: ReactNode
  divider?: false
}

export type MenuEntry = MenuItem | { divider: true } | { heading: ReactNode }

/**
 * Menu suspenso.
 *   <Menu trigger={(p) => <IconButton {...p} icon={MoreHorizontal} label="Ações" />} items={[...]} />
 */
export function Menu({
  trigger,
  items,
  align = 'end',
  width = 220,
}: {
  trigger: (props: { ref: (el: HTMLElement | null) => void; onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode
  items: MenuEntry[]
  align?: 'start' | 'end'
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const { triggerRef, panelRef, pos } = useFloating(open, setOpen, align)

  useEffect(() => {
    if (open) setTimeout(() => panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus(), 10)
  }, [open, panelRef])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
    const i = list.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      list[(i + 1) % list.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      list[(i - 1 + list.length) % list.length]?.focus()
    }
  }

  return (
    <>
      {trigger({
        ref: (el) => (triggerRef.current = el),
        onClick: () => setOpen((o) => !o),
        'aria-expanded': open,
        'aria-haspopup': 'menu',
      })}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            onKeyDown={onKeyDown}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
            className="fixed z-[120] animate-pop-in rounded-xl border border-line bg-surface p-1 shadow-pop"
          >
            {items.map((it, idx) => {
              if ('divider' in it && it.divider) return <div key={idx} className="my-1 h-px bg-line" role="separator" />
              if ('heading' in it) return <div key={idx} className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-fg-3">{it.heading}</div>
              const item = it as MenuItem
              const Icon = item.icon
              return (
                <button
                  key={idx}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false)
                    item.onSelect?.()
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors duration-100',
                    'disabled:cursor-not-allowed disabled:opacity-45',
                    item.danger ? 'text-danger hover:bg-danger/10 focus:bg-danger/10' : 'text-fg hover:bg-surface-3 focus:bg-surface-3',
                  )}
                >
                  {Icon && <Icon size={16} className={item.danger ? '' : 'text-fg-3'} aria-hidden />}
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="text-xs text-fg-3">{item.hint}</span>}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </>
  )
}

/** Painel flutuante livre (filtros, "Como é calculado"). */
export function Popover({
  trigger,
  children,
  align = 'start',
  width = 320,
  title,
}: {
  trigger: (props: { ref: (el: HTMLElement | null) => void; onClick: () => void; 'aria-expanded': boolean }) => ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  align?: 'start' | 'end'
  width?: number
  title?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const { triggerRef, panelRef, pos } = useFloating(open, setOpen, align)
  return (
    <>
      {trigger({ ref: (el) => (triggerRef.current = el), onClick: () => setOpen((o) => !o), 'aria-expanded': open })}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
            className="fixed z-[120] max-w-[calc(100vw-16px)] animate-pop-in rounded-xl border border-line bg-surface p-4 shadow-pop"
          >
            {title && <div className="mb-2 text-sm font-semibold text-fg">{title}</div>}
            {typeof children === 'function' ? children(() => setOpen(false)) : children}
          </div>,
          document.body,
        )}
    </>
  )
}

/** Dica ao passar o mouse ou focar (não use para informação essencial). */
export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 z-[130] w-max max-w-[260px] -translate-x-1/2 rounded-lg bg-fg px-2.5 py-1.5 text-xs font-medium leading-4 text-surface opacity-0 shadow-pop transition-opacity duration-150',
          'group-hover/tt:opacity-100 group-focus-within/tt:opacity-100',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
        )}
      >
        {content}
      </span>
    </span>
  )
}
