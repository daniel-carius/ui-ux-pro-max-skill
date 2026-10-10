import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { Info, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { isApiMode } from '@/lib/api'
import { pageByPath } from '@/nav'
import { ConfirmHost, Skeleton, ToastHost, toast } from '@/components/ui'
import { autoOffLabel, runAttackAutoOff } from '@/domain/seguranca'
import { CommandPalette, pushRecent } from './CommandPalette'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { ErrorBoundary } from './ErrorBoundary'

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
  // (no modo API, o servidor desliga no prazo; aqui só relê a chave)
  useEffect(() => {
    const check = () => {
      const minutes = runAttackAutoOff()
      if (minutes) toast.info('Modo de ataque desligado automaticamente', { description: `Passou o tempo escolhido (${autoOffLabel(minutes)}).` })
    }
    check()
    const id = setInterval(check, 30_000)
    return () => clearInterval(id)
  }, [])

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
            {/* erro numa tela fica nela: menu, topo e as outras telas seguem funcionando */}
            {!isApiMode() && <DemoDataNotice />}
            <ErrorBoundary resetKey={pathname}>
              <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ToastHost />
      <ConfirmHost />
    </div>
  )
}

const DEMO_NOTICE_KEY = 'x2w.aviso-dados-demo'

/**
 * Modo demonstração: os marcadores de dado fictício (e-mail em .invalid, CPF com dígito errado, IP de jogador na faixa
 * privada 10.x) pareciam dados quebrados sem explicação. O aviso diz o que são; quem fechar não vê de novo neste navegador.
 */
function DemoDataNotice() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(DEMO_NOTICE_KEY) === '1'
    } catch {
      return false
    }
  })
  if (hidden) return null
  const close = () => {
    setHidden(true)
    try {
      localStorage.setItem(DEMO_NOTICE_KEY, '1')
    } catch {
      /* sem armazenamento: some só nesta visita */
    }
  }
  return (
    <div role="note" className="mb-5 flex items-start gap-2.5 rounded-xl border border-info/25 bg-info/5 px-3.5 py-2.5 text-[13px] text-fg-2">
      <Info size={16} className="mt-0.5 shrink-0 text-info" aria-hidden />
      <p className="min-w-0 flex-1">
        <strong className="font-semibold text-fg">Dados de demonstração, todos fictícios.</strong> E-mails terminam em <span className="font-mono">.invalid</span>{' '}
        (domínio reservado, nunca entrega), CPFs têm o dígito verificador errado e IPs de jogadores ficam na faixa privada <span className="font-mono">10.x</span> (os
        IPs da equipe são exemplos inventados). A cidade ao lado de um IP é a do cadastro da conta, não a localização do IP.
      </p>
      <button type="button" onClick={close} aria-label="Fechar aviso de dados de demonstração" className="-m-1 rounded-md p-1 text-fg-3 hover:bg-surface-3 hover:text-fg">
        <X size={15} aria-hidden />
      </button>
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
