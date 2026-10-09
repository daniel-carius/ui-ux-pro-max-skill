import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, LogOut, Moon, RotateCcw, Search, Sun } from 'lucide-react'
import { cn } from '@/lib/cn'
import { MODULE_BY_ID, PAGES, type PageDef } from '@/nav'
import { useAuthApi, useSession } from '@/domain/session'
import { useTheme } from '@/lib/theme'
import { resetDb } from '@/lib/store'
import { Kbd, normalize, toast } from '@/components/ui'

const RECENT_KEY = 'x2w.recent'

export function pushRecent(pageId: string) {
  try {
    const list: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    const next = [pageId, ...list.filter((x) => x !== pageId)].slice(0, 5)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}

interface Item {
  id: string
  label: string
  sub: string
  icon: PageDef['icon']
  run: () => void
  section: string
}

/** Busca de páginas: lista as 73 telas e serve de mapa rápido do sistema. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const navigate = useNavigate()
  const { canView } = useSession()
  const { resolved, toggle } = useTheme()
  const auth = useAuthApi()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setIdx(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  const items = useMemo<Item[]>(() => {
    const allowed = PAGES.filter((p) => canView(p.id))
    const toItem = (p: PageDef, section: string): Item => ({
      id: p.id,
      label: p.title,
      sub: `${MODULE_BY_ID.get(p.module)?.title} · ${p.description}`,
      icon: p.icon,
      section,
      run: () => navigate(p.path),
    })
    const actions: Item[] = [
      { id: 'act-theme', label: resolved === 'dark' ? 'Usar tema claro' : 'Usar tema escuro', sub: 'Aparência', icon: resolved === 'dark' ? Sun : Moon, section: 'Ações', run: toggle },
      // modo API: os dados são do servidor (nada a restaurar); a ação é sair
      auth.enabled
        ? { id: 'act-logout', label: 'Sair do painel', sub: 'Encerra a sua sessão neste navegador', icon: LogOut, section: 'Ações', run: () => void auth.logout() }
        : {
            id: 'act-reset',
            label: 'Restaurar dados de demonstração',
            sub: 'Apaga as alterações feitas neste navegador',
            icon: RotateCcw,
            section: 'Ações',
            run: () => {
              resetDb()
              toast.success('Dados de demonstração restaurados')
            },
          },
    ]
    if (!q.trim()) {
      const recent = getRecent()
        .map((id) => allowed.find((p) => p.id === id))
        .filter(Boolean) as PageDef[]
      return [...recent.map((p) => ({ ...toItem(p, 'Recentes'), id: `r-${p.id}` })), ...allowed.map((p) => toItem(p, MODULE_BY_ID.get(p.module)!.title)), ...actions]
    }
    const terms = normalize(q.trim()).split(/\s+/)
    const score = (text: string) => terms.every((t) => text.includes(t))
    const pages = allowed
      .filter((p) => score(normalize(`${p.title} ${p.description} ${p.keywords ?? ''} ${MODULE_BY_ID.get(p.module)?.title} ${p.path}`)))
      .sort((a, b) => Number(normalize(b.title).startsWith(terms[0])) - Number(normalize(a.title).startsWith(terms[0])))
      .map((p) => toItem(p, 'Páginas'))
    return [...pages, ...actions.filter((a) => score(normalize(`${a.label} ${a.sub}`)))]
  }, [q, canView, navigate, resolved, toggle, auth])

  useEffect(() => setIdx(0), [q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  if (!open) return null

  const run = (it: Item) => {
    onClose()
    it.run()
  }

  let lastSection = ''
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-start justify-center p-4 pt-[10vh]">
      <div className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Buscar páginas"
        className="relative flex max-h-[70vh] w-full max-w-xl animate-pop-in flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setIdx((i) => Math.min(items.length - 1, i + 1))
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setIdx((i) => Math.max(0, i - 1))
          }
          if (e.key === 'Enter' && items[idx]) {
            e.preventDefault()
            run(items[idx])
          }
        }}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={18} className="shrink-0 text-fg-3" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar entre as 73 telas: saques, banners, KYC..."
            aria-label="Buscar páginas"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={items[idx] ? `cmdk-${items[idx].id}` : undefined}
            className="h-14 w-full bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-3"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} id="cmdk-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
          {items.length === 0 && <p className="px-3 py-10 text-center text-sm text-fg-3">Nenhuma tela encontrada para “{q}”.</p>}
          {items.map((it, i) => {
            const header = it.section !== lastSection ? it.section : null
            lastSection = it.section
            const Icon = it.icon
            return (
              <div key={it.id}>
                {header && <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-fg-3 first:pt-1">{header}</p>}
                <button
                  id={`cmdk-${it.id}`}
                  data-idx={i}
                  role="option"
                  aria-selected={i === idx}
                  type="button"
                  onMouseMove={() => setIdx(i)}
                  onClick={() => run(it)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-75',
                    i === idx ? 'bg-primary/10' : 'hover:bg-surface-3',
                  )}
                >
                  <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', i === idx ? 'bg-primary text-primary-fg' : 'bg-surface-3 text-fg-2')}>
                    <Icon size={16} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{it.label}</span>
                    <span className="block truncate text-xs text-fg-3">{it.sub}</span>
                  </span>
                  {i === idx && <CornerDownLeft size={14} className="shrink-0 text-fg-3" aria-hidden />}
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-fg-3">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navegar</span>
          <span className="flex items-center gap-1"><Kbd>Enter</Kbd> abrir</span>
          <span className="ml-auto">{PAGES.filter((p) => canView(p.id)).length} telas disponíveis</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
