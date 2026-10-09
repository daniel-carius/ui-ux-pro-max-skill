import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, EyeOff, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { MODULES, pagesOf, type ModuleDef, type PageDef } from '@/nav'
import { useSession } from '@/domain/session'
import { useWithdrawals } from '@/data/hooks'
import { Kbd } from '@/components/ui'
import { BrandMark } from './Brand'

const OPEN_KEY = 'x2w.sidebar.groups'

function loadOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/** Contadores ao lado de itens do menu (fila de trabalho). */
function useNavBadges(): Record<string, { count: number; tone: 'danger' | 'warning' | 'primary' }> {
  const { items } = useWithdrawals()
  const waiting = items.filter((w) => ['pendente', 'em_analise', 'criado'].includes(w.status)).length
  return waiting ? { saques: { count: waiting, tone: 'warning' } } : {}
}

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  onOpenSearch,
  onNavigate,
  mobile,
}: {
  collapsed: boolean
  onToggleCollapsed?: () => void
  onOpenSearch: () => void
  onNavigate?: () => void
  mobile?: boolean
}) {
  const { pathname } = useLocation()
  const { canView } = useSession()
  const badges = useNavBadges()
  const [open, setOpen] = useState<Record<string, boolean>>(loadOpen)

  // garante que o grupo da tela atual esteja aberto
  useEffect(() => {
    const mod = MODULES.find((m) => pagesOf(m.id).some((p) => p.path === pathname))
    if (mod && open[mod.id] === false) setOpen((o) => ({ ...o, [mod.id]: true }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(open))
    } catch {
      /* ignore */
    }
  }, [open])

  const visibleModules = MODULES.map((m) => ({ module: m, pages: pagesOf(m.id).filter((p) => canView(p.id)) })).filter(
    (x) => x.pages.length > 0,
  )
  const hiddenCount = MODULES.reduce((s, m) => s + pagesOf(m.id).filter((p) => !canView(p.id)).length, 0)
  const isCollapsed = collapsed && !mobile

  return (
    <div className="flex h-full flex-col">
      {/* Marca */}
      <div className={cn('flex h-16 shrink-0 items-center gap-2.5 px-4', isCollapsed && 'justify-center px-0')}>
        <BrandMark />
        {!isCollapsed && (
          <div className="min-w-0 flex-1 leading-tight">
            <p className="font-display text-[15px] font-extrabold tracking-tight text-fg">X2Win</p>
            <p className="text-[11px] font-medium text-fg-3">Backoffice · Evox</p>
          </div>
        )}
        {!mobile && !isCollapsed && onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Recolher menu"
            title="Recolher menu"
            className="hidden h-8 w-8 items-center justify-center rounded-lg text-fg-3 hover:bg-surface-3 hover:text-fg lg:flex"
          >
            <PanelLeftClose size={17} />
          </button>
        )}
      </div>

      {/* Busca de páginas */}
      <div className={cn('px-3 pb-2', isCollapsed && 'px-2')}>
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Buscar páginas"
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-surface-2 text-[13px] text-fg-3 transition-colors hover:border-line-strong hover:text-fg-2',
            isCollapsed ? 'justify-center' : 'px-2.5',
          )}
        >
          <Search size={15} aria-hidden />
          {!isCollapsed && (
            <>
              <span className="flex-1 text-left">Buscar páginas</span>
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </>
          )}
        </button>
      </div>

      {/* Navegação */}
      <nav aria-label="Menu principal" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1">
        {isCollapsed ? (
          <ul className="flex flex-col items-center gap-1">
            {visibleModules.map(({ module, pages }) => (
              <li key={module.id}>
                <CollapsedModule module={module} pages={pages} pathname={pathname} badges={badges} />
              </li>
            ))}
          </ul>
        ) : (
          <ul className="space-y-0.5">
            {visibleModules.map(({ module, pages }) => {
              const isOpen = open[module.id] ?? true
              const hasActive = pages.some((p) => p.path === pathname)
              const MIcon = module.icon
              const groupBadge = pages.reduce((s, p) => s + (badges[p.id]?.count ?? 0), 0)
              return (
                <li key={module.id}>
                  <button
                    type="button"
                    onClick={() => setOpen((o) => ({ ...o, [module.id]: !isOpen }))}
                    aria-expanded={isOpen}
                    className={cn(
                      'group flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-[13px] font-semibold transition-colors duration-150',
                      hasActive ? 'text-fg' : 'text-fg-2 hover:text-fg',
                      'hover:bg-surface-3/70',
                    )}
                  >
                    <MIcon size={17} className={cn('shrink-0', hasActive ? 'text-primary-text' : 'text-fg-3 group-hover:text-fg-2')} aria-hidden />
                    <span className="flex-1 truncate text-left">{module.title}</span>
                    {!isOpen && groupBadge > 0 && (
                      <span className="rounded-full bg-warning/15 px-1.5 text-[11px] font-semibold text-warning tnum">{groupBadge}</span>
                    )}
                    <span className="text-[11px] font-medium text-fg-3 tnum">{pages.length}</span>
                    <ChevronDown
                      size={14}
                      className={cn('shrink-0 text-fg-3 transition-transform duration-200', !isOpen && '-rotate-90')}
                      aria-hidden
                    />
                  </button>
                  {isOpen && (
                    <ul className="relative mb-1.5 ml-[17px] mt-0.5 space-y-px border-l border-line pl-2">
                      {pages.map((p) => (
                        <li key={p.id}>
                          <NavItem page={p} active={p.path === pathname} badge={badges[p.id]} onNavigate={onNavigate} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {hiddenCount > 0 && !isCollapsed && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs leading-5 text-fg-3">
            <EyeOff size={14} className="mt-0.5 shrink-0" aria-hidden />
            {hiddenCount} telas estão ocultas porque o cargo atual não tem acesso.
          </p>
        )}
      </nav>

      {!mobile && isCollapsed && onToggleCollapsed && (
        <div className="flex justify-center border-t border-line py-3">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Expandir menu"
            title="Expandir menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-3 hover:bg-surface-3 hover:text-fg"
          >
            <PanelLeftOpen size={17} />
          </button>
        </div>
      )}
    </div>
  )
}

function NavItem({
  page,
  active,
  badge,
  onNavigate,
}: {
  page: PageDef
  active: boolean
  badge?: { count: number; tone: 'danger' | 'warning' | 'primary' }
  onNavigate?: () => void
}) {
  const Icon = page.icon
  return (
    <NavLink
      to={page.path}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors duration-150',
        active ? 'bg-primary/10 font-semibold text-primary-text' : 'text-fg-2 hover:bg-surface-3/70 hover:text-fg',
      )}
    >
      {active && <span className="absolute -left-[9px] top-1.5 h-5 w-0.5 rounded-full bg-primary" aria-hidden />}
      <Icon size={15} className="shrink-0" aria-hidden />
      <span className="flex-1 truncate">{page.title}</span>
      {badge && (
        <span
          className={cn(
            'rounded-full px-1.5 text-[11px] font-semibold tnum',
            badge.tone === 'danger' ? 'bg-danger/15 text-danger' : badge.tone === 'warning' ? 'bg-warning/15 text-warning' : 'bg-primary/15 text-primary-text',
          )}
        >
          {badge.count}
        </span>
      )}
    </NavLink>
  )
}

/** No menu recolhido, cada módulo abre um painel lateral com as telas. */
function CollapsedModule({
  module,
  pages,
  pathname,
  badges,
}: {
  module: ModuleDef
  pages: PageDef[]
  pathname: string
  badges: ReturnType<typeof useNavBadges>
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const active = pages.some((p) => p.path === pathname)
  const Icon = module.icon

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const h = panelRef.current?.offsetHeight ?? 300
    setPos({ top: Math.max(8, Math.min(r.top, window.innerHeight - h - 8)), left: r.right + 10 })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={module.title}
        aria-expanded={open}
        title={module.title}
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-150',
          active ? 'bg-primary/10 text-primary-text' : 'text-fg-3 hover:bg-surface-3 hover:text-fg',
        )}
      >
        <Icon size={19} aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-[120] w-60 animate-pop-in rounded-xl border border-line bg-surface p-1.5 shadow-pop"
          >
            <p className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-fg-3">{module.title}</p>
            {pages.map((p) => (
              <NavItem key={p.id} page={p} active={p.path === pathname} badge={badges[p.id]} onNavigate={() => setOpen(false)} />
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
