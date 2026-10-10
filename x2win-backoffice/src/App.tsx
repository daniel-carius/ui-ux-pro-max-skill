import { Suspense, lazy } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { PAGES } from '@/nav'
import { ThemeProvider } from '@/lib/theme'
import { isApiMode } from '@/lib/api'
import { SessionProvider } from '@/domain/session'
import { AppShell } from '@/components/layout/AppShell'
import { HomeRedirect, LandingGuard, NotFound, PageFrame } from '@/components/layout/PageFrame'
import { SplashScreen } from '@/components/layout/Splash'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'

// rota pública do modo API (aceite de convite), carregada sob demanda
const AcceptInvitePage = lazy(() => import('@/pages/auth/AcceptInvitePage'))

function Panel() {
  return (
    <AppShell>
      <LandingGuard />
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        {PAGES.map((p) => (
          <Route key={p.id} path={p.path} element={<PageFrame pageId={p.id} />} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  )
}

// HashRouter: funciona em qualquer hospedagem estática, sem regra de servidor.
export default function App() {
  // último recurso: um erro fora das telas (menu, topo, sessão) mostra um aviso em vez da página em branco
  return (
    <ErrorBoundary fullPage>
      <AppRoot />
    </ErrorBoundary>
  )
}

function AppRoot() {
  if (!isApiMode()) {
    // modo demonstração: sem login, dados no navegador
    return (
      <ThemeProvider>
        <SessionProvider>
          <HashRouter>
            <Panel />
          </HashRouter>
        </SessionProvider>
      </ThemeProvider>
    )
  }
  // modo API: tudo passa pela sessão, menos o aceite de convite (#/convite?token=...)
  return (
    <ThemeProvider>
      <HashRouter>
        <Routes>
          <Route
            path="/convite"
            element={
              <Suspense fallback={<SplashScreen label="Abrindo o convite" />}>
                <AcceptInvitePage />
              </Suspense>
            }
          />
          <Route
            path="*"
            element={
              <SessionProvider>
                <Panel />
              </SessionProvider>
            }
          />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  )
}
