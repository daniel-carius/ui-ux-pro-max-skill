import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { pageByPath } from '@/nav'
import { ConfirmHost, Skeleton, ToastHost, toast } from '@/components/ui'
import { autoOffLabel, runAttackAutoOff } from '@/domain/seguranca'
import { useSession } from '@/domain/session'
import { isApiMode } from '@/lib/api'
import { CommandPalette, pushRecent } from './CommandPalette'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

const COLLAPSE_KEY = 'x2w.sidebar.collapsed'

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  // modo de ataque com desligamento automático vale em qualquer tela
  // (no modo API, só quem pode editar o modo de ataque grava o desligamento)
  const { can } = useSession()
  const autoOffAllowed = !isApiMode() || can('modo-ataque.editar')
  useEffect(() => {
    if (!autoOffAllowed) return
    const check = () => {
      const minutes = runAttackAutoOff()
      if (minutes) toast.info('Modo de ataque desligado automaticamente', { description: `Passou o tempo escolhido (${autoOffLabel(minutes)}).` })
    }
    check()
    const id = setInterval(check, 30_000)
    return () => clearInterval(id)
  }, [autoOffAllowed])

  // Ctrl/Cmd + K abre a busca de páginas
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // troca de tela: volta ao topo, foca o conteúdo e guarda nos recentes
  useEffect(() => {
    window.scrollTo({ top: 0 })
    setMobileOpen(false)
    const page = pageByPath(pathname)
    if (page) {
      pushRecent(page.id)
      document.title = `${page.title} · X2Win Backoffice`
    }
    mainRef.current?.focus({ preventScroll: true })
  }, [pathname])

  return (
    <div className="min-h-dvh bg-bg">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[300] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-pop">
        Pular para o conteúdo
      </a>

      {/* barra lateral fixa (desktop) */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 hidden border-r border-line bg-surface transition-[width] duration-200 lg:block',
          collapsed ? 'w-[76px]' : 'w-[272px]',
        )}
      >
        <Sidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} onOpenSearch={() => setSearchOpen(true)} />
      </aside>

      {/* barra lateral em gaveta (celular/tablet) */}
      {mobileOpen &&
        createPortal(
          <div className="fixed inset-0 z-[95] lg:hidden">
            <div className="absolute inset-0 animate-fade-in bg-black/50" onClick={() => setMobileOpen(false)} aria-hidden />
            <aside className="absolute inset-y-0 left-0 w-[86vw] max-w-[300px] animate-slide-in-left border-r border-line bg-surface shadow-pop">
              <Sidebar
                mobile
                collapsed={false}
                onOpenSearch={() => {
                  setMobileOpen(false)
                  setSearchOpen(true)
                }}
                onNavigate={() => setMobileOpen(false)}
              />
            </aside>
          </div>,
          document.body,
        )}

      <div className={cn('flex min-h-dvh flex-col transition-[padding] duration-200', collapsed ? 'lg:pl-[76px]' : 'lg:pl-[272px]')}>
        <Topbar onOpenMenu={() => setMobileOpen(true)} onOpenSearch={() => setSearchOpen(true)} />
        <main id="conteudo" ref={mainRef} tabIndex={-1} className="flex-1 outline-none">
          <div className="mx-auto w-full max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
          </div>
        </main>
      </div>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ToastHost />
      <ConfirmHost />
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando tela">
      <div className="mb-6 flex items-center gap-3">
        <Skeleton className="h-11 w-11 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="mt-4 h-80 rounded-xl" />
    </div>
  )
}
