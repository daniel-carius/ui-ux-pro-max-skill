import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { PAGES } from '@/nav'
import { ThemeProvider } from '@/lib/theme'
import { SessionProvider } from '@/domain/session'
import { AppShell } from '@/components/layout/AppShell'
import { NotFound, PageFrame } from '@/components/layout/PageFrame'

// HashRouter: funciona em qualquer hospedagem estática, sem regra de servidor.
export default function App() {
  return (
    <ThemeProvider>
      <SessionProvider>
        <HashRouter>
          <AppShell>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              {PAGES.map((p) => (
                <Route key={p.id} path={p.path} element={<PageFrame pageId={p.id} />} />
              ))}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppShell>
        </HashRouter>
      </SessionProvider>
    </ThemeProvider>
  )
}
