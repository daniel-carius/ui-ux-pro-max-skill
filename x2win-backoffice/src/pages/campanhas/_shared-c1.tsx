// Componentes compartilhados pelas telas de Campanhas (parte 1):
// seletor de jogo, seletor múltiplo, busca de jogador, indicador de etapas e blocos de código.
import { useMemo, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Check, ChevronsUpDown, Search, UserSearch, X } from 'lucide-react'
import { Badge, Checkbox, ChipFilter, Input, Popover, normalize } from '@/components/ui'
import { cn } from '@/lib/cn'
import { initials, maskEmail, num } from '@/lib/format'
import { GAME_CATEGORY_LABEL, type Game, type GameCategory, type Provider } from '@/data/catalog'
import { PLAYER_STATUS_LABEL, type Player } from '@/data/players'

// ---------- Jogos ----------

/** Miniatura do jogo (cor derivada do jogo, legível nos dois temas). */
export function GameTile({ game, size = 32, className }: { game: Pick<Game, 'name' | 'hue'> | undefined; size?: number; className?: string }) {
  const hue = game?.hue ?? 262
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-lg font-bold ring-1 ring-inset ring-line/60', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.34),
        background: `linear-gradient(135deg, hsl(${hue} 72% 56% / 0.30), hsl(${(hue + 45) % 360} 72% 56% / 0.12))`,
        color: `hsl(${hue} 62% var(--avatar-l, 42%))`,
      }}
    >
      {game ? initials(game.name) : '?'}
    </span>
  )
}

export function providerNameOf(providers: Provider[], id: string) {
  return providers.find((p) => p.id === id)?.name ?? id
}

/** Seletor de jogo com busca. */
export function GamePicker({
  value,
  onChange,
  games,
  providers,
  id,
  disabled,
  invalid,
  placeholder = 'Escolha um jogo',
  filter,
  emptyHint,
}: {
  value: string | null
  onChange: (id: string) => void
  games: Game[]
  providers: Provider[]
  id?: string
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
  filter?: (g: Game) => boolean
  emptyHint?: string
}) {
  const [q, setQ] = useState('')
  const selected = games.find((g) => g.id === value)
  const list = useMemo(() => {
    const nq = normalize(q.trim())
    return games
      .filter((g) => (filter ? filter(g) : true))
      .filter((g) => !nq || normalize(`${g.name} ${providerNameOf(providers, g.providerId)}`).includes(nq))
      .sort((a, b) => b.highlight - a.highlight)
  }, [games, providers, q, filter])
  return (
    <Popover
      width={360}
      trigger={(p) => (
        <button
          {...p}
          id={id}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-invalid={invalid || undefined}
          className={cn('input-base flex items-center gap-2.5 text-left', invalid && 'border-danger')}
        >
          {selected ? (
            <>
              <GameTile game={selected} size={24} />
              <span className="min-w-0 flex-1 truncate">{selected.name}</span>
              <span className="hidden shrink-0 text-xs text-fg-3 sm:inline">{providerNameOf(providers, selected.providerId)}</span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-fg-3">{placeholder}</span>
          )}
          <ChevronsUpDown size={15} className="shrink-0 text-fg-3" aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <div>
          <Input icon={Search} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar jogo ou provedora" aria-label="Buscar jogo ou provedora" />
          <ul role="listbox" aria-label="Jogos" className="-mx-1 mt-2 max-h-72 overflow-y-auto">
            {list.map((g) => {
              const active = g.id === value
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(g.id)
                      setQ('')
                      close()
                    }}
                    className={cn('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-3', active && 'bg-primary/5')}
                  >
                    <GameTile game={g} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-fg">{g.name}</span>
                      <span className="block truncate text-xs text-fg-3">
                        {providerNameOf(providers, g.providerId)} · {GAME_CATEGORY_LABEL[g.category]} · RTP {g.rtp.toLocaleString('pt-BR')}%
                      </span>
                    </span>
                    {!g.active && <Badge>Inativo</Badge>}
                    {active && <Check size={16} className="shrink-0 text-primary-text" aria-hidden />}
                  </button>
                </li>
              )
            })}
            {!list.length && <li className="px-2 py-6 text-center text-[13px] text-fg-3">{emptyHint ?? 'Nenhum jogo encontrado.'}</li>}
          </ul>
        </div>
      )}
    </Popover>
  )
}

/** Seleção de vários jogos com busca, filtro por tipo e chips dos escolhidos. */
export function GameMultiPicker({
  value,
  onChange,
  games,
  providers,
  disabled,
  invalid,
}: {
  value: string[]
  onChange: (ids: string[]) => void
  games: Game[]
  providers: Provider[]
  disabled?: boolean
  invalid?: boolean
}) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<'todos' | GameCategory>('todos')
  const selected = new Set(value)
  const visible = useMemo(() => {
    const nq = normalize(q.trim())
    return games
      .filter((g) => cat === 'todos' || g.category === cat)
      .filter((g) => !nq || normalize(`${g.name} ${providerNameOf(providers, g.providerId)}`).includes(nq))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [games, providers, q, cat])
  const cats = (Object.keys(GAME_CATEGORY_LABEL) as GameCategory[]).filter((c) => games.some((g) => g.category === c))
  const allVisibleOn = visible.length > 0 && visible.every((g) => selected.has(g.id))
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    onChange([...next])
  }
  return (
    <div className={cn('rounded-xl border', invalid ? 'border-danger' : 'border-line')}>
      <div className="space-y-2.5 border-b border-line p-3">
        <Input icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar jogo ou provedora" aria-label="Buscar jogo ou provedora" disabled={disabled} />
        <ChipFilter
          value={cat}
          onChange={setCat}
          options={[{ value: 'todos' as const, label: 'Todos' }, ...cats.map((c) => ({ value: c, label: GAME_CATEGORY_LABEL[c], count: games.filter((g) => g.category === c && selected.has(g.id)).length || undefined }))]}
        />
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-fg-3">
        <span>
          {num(visible.length)} jogos · <strong className="text-fg">{num(value.length)} escolhidos</strong>
        </span>
        <span className="flex gap-3">
          <button
            type="button"
            disabled={disabled || !visible.length}
            className="font-semibold text-primary-text hover:underline disabled:opacity-50"
            onClick={() => {
              const next = new Set(selected)
              visible.forEach((g) => (allVisibleOn ? next.delete(g.id) : next.add(g.id)))
              onChange([...next])
            }}
          >
            {allVisibleOn ? 'Desmarcar visíveis' : 'Marcar visíveis'}
          </button>
          {value.length > 0 && (
            <button type="button" disabled={disabled} className="font-semibold text-fg-2 hover:underline disabled:opacity-50" onClick={() => onChange([])}>
              Limpar
            </button>
          )}
        </span>
      </div>
      <ul className="max-h-64 overflow-y-auto px-1.5 pb-1.5" aria-label="Jogos para escolher">
        {visible.map((g) => (
          <li key={g.id} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-surface-2">
            <Checkbox checked={selected.has(g.id)} onChange={(on) => toggle(g.id, on)} disabled={disabled} ariaLabel={`Escolher ${g.name}`} />
            <GameTile game={g} size={26} />
            <button type="button" disabled={disabled} onClick={() => toggle(g.id, !selected.has(g.id))} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[13px] font-medium text-fg">{g.name}</span>
              <span className="block truncate text-xs text-fg-3">
                {providerNameOf(providers, g.providerId)} · {GAME_CATEGORY_LABEL[g.category]}
              </span>
            </button>
          </li>
        ))}
        {!visible.length && <li className="px-2 py-6 text-center text-[13px] text-fg-3">Nenhum jogo encontrado.</li>}
      </ul>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-line p-3">
          {value.slice(0, 24).map((id) => {
            const g = games.find((x) => x.id === id)
            if (!g) return null
            return (
              <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-surface-3 py-0.5 pl-1 pr-2 text-xs text-fg">
                <GameTile game={g} size={18} className="rounded-full" />
                {g.name}
                {!disabled && (
                  <button type="button" aria-label={`Remover ${g.name}`} onClick={() => toggle(id, false)} className="text-fg-3 hover:text-fg">
                    <X size={12} />
                  </button>
                )}
              </span>
            )
          })}
          {value.length > 24 && <span className="text-xs text-fg-3">+{value.length - 24}</span>}
        </div>
      )}
    </div>
  )
}

// ---------- Jogadores ----------

/** Busca de jogador por ID, e-mail ou nome. A lista mostra e-mail mascarado (LGPD). */
export function PlayerFinder({
  players,
  value,
  onChange,
  id,
  disabled,
}: {
  players: Player[]
  value: Player | null
  onChange: (p: Player | null) => void
  id?: string
  disabled?: boolean
}) {
  const [q, setQ] = useState('')
  const results = useMemo(() => {
    const t = q.trim()
    if (t.length < 2) return []
    const nq = normalize(t)
    const exact = players.filter((p) => p.id === t || p.email.toLowerCase() === t.toLowerCase())
    if (exact.length) return exact
    return players.filter((p) => p.id.includes(t) || normalize(p.email).includes(nq) || normalize(p.name).includes(nq)).slice(0, 6)
  }, [players, q])

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3">
        <PlayerAvatar name={value.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">{value.name}</p>
          <p className="truncate text-xs text-fg-3">
            ID {value.id} · {maskEmail(value.email)}
          </p>
        </div>
        <Badge tone={value.status === 'ativo' ? 'success' : 'danger'} dot>
          {PLAYER_STATUS_LABEL[value.status]}
        </Badge>
        <button type="button" disabled={disabled} onClick={() => onChange(null)} className="rounded-md p-1 text-fg-3 hover:bg-surface-3 hover:text-fg" aria-label="Trocar jogador">
          <X size={15} />
        </button>
      </div>
    )
  }
  return (
    <div>
      <Input id={id} icon={UserSearch} value={q} disabled={disabled} onChange={(e) => setQ(e.target.value)} placeholder="ID, e-mail ou nome do jogador" autoComplete="off" />
      {q.trim().length >= 2 && (
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line" aria-label="Jogadores encontrados">
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onChange(p)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2">
                <PlayerAvatar name={p.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-fg">{p.name}</span>
                  <span className="block truncate text-xs text-fg-3">
                    ID {p.id} · {maskEmail(p.email)}
                  </span>
                </span>
                {p.status !== 'ativo' && <Badge tone="danger">{PLAYER_STATUS_LABEL[p.status]}</Badge>}
              </button>
            </li>
          ))}
          {!results.length && <li className="px-3 py-4 text-center text-[13px] text-fg-3">Nenhum jogador com esse ID, e-mail ou nome.</li>}
        </ul>
      )}
    </div>
  )
}

function PlayerAvatar({ name }: { name: string }) {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
  return (
    <span
      aria-hidden
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
      style={{ background: `hsl(${hue} 70% 55% / 0.16)`, color: `hsl(${hue} 60% var(--avatar-l, 42%))` }}
    >
      {initials(name)}
    </span>
  )
}

// ---------- Assistente em etapas ----------

export function StepIndicator({
  steps,
  current,
  maxReached,
  onSelect,
  invalidSteps = [],
}: {
  steps: readonly { id: string; label: string }[]
  current: number
  maxReached: number
  onSelect: (i: number) => void
  invalidSteps?: number[]
}) {
  return (
    <nav aria-label="Etapas">
      <ol className="flex items-center gap-1.5">
        {steps.map((s, i) => {
          const done = i < current
          const active = i === current
          const reachable = i <= maxReached
          const invalid = invalidSteps.includes(i) && i !== current
          return (
            <li key={s.id} className={cn('flex min-w-0 items-center gap-1.5', i < steps.length - 1 && 'flex-1')}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onSelect(i)}
                aria-current={active ? 'step' : undefined}
                aria-label={`Etapa ${i + 1}: ${s.label}${invalid ? ' (com pendências)' : done ? ' (concluída)' : ''}`}
                className="group flex min-w-0 items-center gap-2 rounded-full disabled:cursor-not-allowed"
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset transition-colors',
                    active && 'bg-primary text-primary-fg ring-primary',
                    !active && invalid && 'bg-danger/10 text-danger ring-danger/40',
                    !active && !invalid && done && 'bg-primary/10 text-primary-text ring-primary/30 group-hover:bg-primary/15',
                    !active && !invalid && !done && 'bg-surface-2 text-fg-3 ring-line',
                  )}
                >
                  {done && !invalid ? <Check size={14} strokeWidth={3} aria-hidden /> : invalid ? '!' : i + 1}
                </span>
                <span className={cn('hidden truncate text-[13px] font-medium sm:inline', active ? 'text-fg' : 'text-fg-3 group-hover:text-fg-2')}>{s.label}</span>
              </button>
              {i < steps.length - 1 && <span className={cn('h-px min-w-[8px] flex-1', done ? 'bg-primary/40' : 'bg-line')} aria-hidden />}
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-xs text-fg-3 sm:hidden">
        Etapa {current + 1} de {steps.length} · <strong className="text-fg-2">{steps[current].label}</strong>
      </p>
    </nav>
  )
}

// ---------- Blocos ----------

export function MiniStat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-xl bg-surface-2 px-3 py-2.5', className)}>
      <p className="truncate text-xs text-fg-3">{label}</p>
      <p className="mt-0.5 truncate text-base font-bold text-fg tnum">{value}</p>
      {sub && <p className="truncate text-xs text-fg-3">{sub}</p>}
    </div>
  )
}

export function CodeBlock({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <pre
      aria-label={label}
      className={cn('max-h-80 overflow-auto rounded-xl border border-line bg-surface-2 p-3.5 font-mono text-[12.5px] leading-5 text-fg-2', className)}
    >
      {children}
    </pre>
  )
}

/** Título de bloco dentro de drawers e cartões. */
export function BlockTitle({ icon: Icon, children, aside }: { icon?: LucideIcon; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
        {Icon && <Icon size={16} className="text-fg-3" aria-hidden />}
        {children}
      </h3>
      {aside}
    </div>
  )
}

const TONE_TEXT = { success: 'text-success', danger: 'text-danger', warning: 'text-warning' } as const

/** Linha "rótulo ........ valor" para resumos de cálculo. */
export function CalcLine({ label, value, strong, tone }: { label: ReactNode; value: ReactNode; strong?: boolean; tone?: 'success' | 'danger' | 'warning' }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1.5 text-[13px]', strong && 'border-t border-line pt-2.5')}>
      <span className={cn(strong ? 'font-semibold text-fg' : 'text-fg-2')}>{label}</span>
      <span className={cn('shrink-0 tnum', strong ? 'text-base font-bold' : 'font-medium', tone ? TONE_TEXT[tone] : 'text-fg')}>{value}</span>
    </div>
  )
}

/** Data ISO → "AAAA-MM-DD" (para input type=date, fuso local). */
export function toDateInput(isoStr: string | null): string {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "AAAA-MM-DD" → ISO no início (ou fim) do dia local. */
export function fromDateInput(v: string, endOfDay = false): string | null {
  if (!v) return null
  const d = new Date(`${v}T${endOfDay ? '23:59:59' : '00:00:00'}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
