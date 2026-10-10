// Peças visuais compartilhadas por Moeda, Roleta, Loja, Cupons, Indicação,
// Missões e Torneios (Campanhas, parte 2).
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Banknote, BadgePercent, Check, CircleSlash, Coins, Eye, Gift, Percent, Search, Sparkles, Ticket, X } from 'lucide-react'
import { Badge, Checkbox, Popover, confirm, type Tone } from '@/components/ui'
import { cn } from '@/lib/cn'
import { brl, num } from '@/lib/format'
import { dbSetAndWait, useCollection, useDb, type Collection } from '@/lib/store'
import { GAME_CATEGORY_LABEL, type GameCategory } from '@/data/catalog'
import { useGames, useProviders } from '@/data/hooks'
import { C2_KEYS, rewardText, type Reward, type RewardKind } from '@/domain/campanhas2-common'
import { DEFAULT_COIN_CONFIG, coinInfo, type CoinConfig } from '@/domain/campanhas2-moeda'
import type { ColorSlot } from '@/domain/campanhas2-roleta'
import { safeImageSrc } from '@/domain/personalizacao-p1'

// ---------- Moeda do site ----------

/** Configuração salva da moeda (nome, sigla, ícone, valor). */
export function useCoin() {
  const [cfg] = useDb<CoinConfig>(C2_KEYS.moeda, DEFAULT_COIN_CONFIG)
  return useMemo(() => ({ ...coinInfo(cfg), icon: cfg.icon, config: cfg }), [cfg])
}

export type CoinCtx = ReturnType<typeof useCoin>

/** Ícone da moeda: imagem enviada ou moeda desenhada. */
export function CoinGlyph({ size = 16, src, className }: { size?: number; src?: string | null; className?: string }) {
  // ícone gravado: só imagem embutida, https ou arquivo do painel (nada de javascript: ou http:)
  const safe = safeImageSrc(src)
  if (safe) return <img src={safe} alt="" aria-hidden width={size} height={size} className={cn('shrink-0 rounded-full object-cover', className)} style={{ width: size, height: size }} />
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={cn('shrink-0 text-gold', className)}>
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <circle cx="12" cy="12" r="8.2" fill="none" stroke="rgb(var(--surface))" strokeOpacity="0.5" strokeWidth="1.2" />
      <path d="M14.6 8.4H9.8v7.2h4.8M9.8 12h3.8" fill="none" stroke="rgb(var(--surface))" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** "1.250 EVC" com o ícone da moeda e, opcionalmente, o valor em R$. */
export function CoinAmount({ value, showBrl, size = 14, className }: { value: number; showBrl?: boolean; size?: number; className?: string }) {
  const coin = useCoin()
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap tnum', className)}>
      <CoinGlyph size={size} src={coin.icon} />
      <span className="font-semibold text-fg">{num(value)}</span>
      <span className="text-[0.85em] font-medium text-fg-3">{coin.symbol}</span>
      {showBrl && <span className="text-[0.85em] text-fg-3">≈ {brl(value * coin.refValue)}</span>}
    </span>
  )
}

// ---------- Recompensas ----------

export const REWARD_ICON: Record<RewardKind, LucideIcon> = {
  bonus_brl: Gift,
  bonus_pct: Percent,
  free_spins: Sparkles,
  moedas: Coins,
  cashback: BadgePercent,
  aposta_gratis: Ticket,
  dinheiro: Banknote,
  nada: CircleSlash,
}

export const REWARD_TONE: Record<RewardKind, Tone> = {
  bonus_brl: 'primary',
  bonus_pct: 'primary',
  free_spins: 'info',
  moedas: 'gold',
  cashback: 'success',
  aposta_gratis: 'warning',
  dinheiro: 'success',
  nada: 'neutral',
}

export function RewardBadge({ reward, text }: { reward: Reward; text?: string }) {
  const coin = useCoin()
  return (
    <Badge tone={REWARD_TONE[reward.kind]} icon={REWARD_ICON[reward.kind]}>
      {text ?? rewardText(reward, coin)}
    </Badge>
  )
}

// ---------- Prévia "como o jogador vê" ----------

export function PlayerPreview({ title = 'Como o jogador vê', children, className, aside }: { title?: string; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <figure className={cn('m-0 overflow-hidden rounded-xl border border-line bg-surface-2', className)} aria-label={title}>
      <figcaption className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-line bg-surface px-3 py-2">
        <span className="flex items-center gap-2">
          <span className="flex gap-1" aria-hidden>
            <span className="h-2 w-2 rounded-full bg-danger/50" />
            <span className="h-2 w-2 rounded-full bg-warning/50" />
            <span className="h-2 w-2 rounded-full bg-success/50" />
          </span>
          <span className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-fg-3">
            <Eye size={12} aria-hidden /> {title}
          </span>
        </span>
        {aside}
      </figcaption>
      <div className="p-4">{children}</div>
    </figure>
  )
}

// ---------- Movimento ----------

/** true quando o sistema pede menos animação. */
export function useReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

// ---------- Cor por posição (paleta dos gráficos) ----------

export const SLOTS: ColorSlot[] = [1, 2, 3, 4, 5, 6, 7, 8]
export const slotColor = (s: number) => `var(--chart-${s})`

export function SlotPicker({ value, onChange, disabled, label = 'Cor' }: { value: ColorSlot; onChange: (s: ColorSlot) => void; disabled?: boolean; label?: string }) {
  return (
    <Popover
      width={196}
      title={label}
      trigger={(p) => (
        <button
          {...p}
          type="button"
          disabled={disabled}
          aria-label={`${label}: cor ${value}. Trocar`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line-strong/80 bg-surface hover:border-line-strong disabled:cursor-not-allowed"
        >
          <span className="h-5 w-5 rounded-md" style={{ background: slotColor(value) }} />
        </button>
      )}
    >
      {(close) => (
        <div role="radiogroup" aria-label={label} className="grid grid-cols-4 gap-2">
          {SLOTS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={s === value}
              aria-label={`Cor ${s}`}
              onClick={() => {
                onChange(s)
                close()
              }}
              className={cn('flex h-9 w-9 items-center justify-center rounded-lg ring-offset-2 ring-offset-surface', s === value && 'ring-2 ring-fg')}
              style={{ background: slotColor(s) }}
            >
              {s === value && <Check size={14} className="text-primary-fg" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </Popover>
  )
}

// ---------- Estrutura ----------

export function MiniStat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-xs text-fg-3">{label}</p>
      <p className="mt-0.5 truncate text-base font-bold text-fg tnum">{value}</p>
      {sub && <p className="truncate text-xs text-fg-3">{sub}</p>}
    </div>
  )
}

/** Bloco de campos dentro de um Drawer. */
export function DrawerSection({ title, description, icon: Icon, children, actions }: { title: string; description?: ReactNode; icon?: LucideIcon; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          {Icon && (
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-text">
              <Icon size={15} aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-fg">{title}</h3>
            {description && <p className="mt-0.5 text-[13px] leading-5 text-fg-3">{description}</p>}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

/** Pergunta antes de fechar um formulário com alterações. */
export async function confirmDiscard(dirty: boolean) {
  if (!dirty) return true
  return confirm({
    title: 'Descartar alterações?',
    description: 'O que você mudou neste formulário ainda não foi salvo.',
    confirmLabel: 'Descartar',
    cancelLabel: 'Continuar editando',
    tone: 'warning',
  })
}

/** Texto do motivo de somente leitura (title de botões). */
export const READ_ONLY_TITLE = 'Seu cargo pode ver, mas não editar esta tela'

// ---------- Listas gravadas ----------

export interface SavedCollection<T extends { id: string }> extends Collection<T> {
  /**
   * Como add/update/remove, mas espera a gravação. Modo API: true quando o servidor aceitou;
   * false quando recusou (regra da campanha, versão): a tela volta ao valor salvo e o aviso
   * "Alteração desfeita" já mostra a mensagem do servidor. Campos que o servidor controla
   * (contadores da plataforma, data de criação, quem encerrou) voltam na resposta e
   * substituem os enviados. Demonstração: grava na hora e devolve true.
   */
  addAndWait: (item: T, position?: 'start' | 'end') => Promise<boolean>
  updateAndWait: (id: string, patch: Partial<T> | ((item: T) => T)) => Promise<boolean>
  removeAndWait: (id: string) => Promise<boolean>
  /** várias mudanças numa gravação só */
  saveAndWait: (next: (prev: T[]) => T[]) => Promise<boolean>
}

/** Lista de campanha (missões, torneios, roletas, itens da loja) com gravação que espera o servidor. */
export function useSavedCollection<T extends { id: string }>(key: string, seed: T[] | (() => T[])): SavedCollection<T> {
  const col = useCollection<T>(key, seed)
  const saveAndWait = (next: (prev: T[]) => T[]) => dbSetAndWait<T[]>(key, next, seed)
  return {
    ...col,
    saveAndWait,
    addAndWait: (item, position = 'start') => saveAndWait((prev) => (position === 'start' ? [item, ...prev] : [...prev, item])),
    updateAndWait: (id, patch) => saveAndWait((prev) => prev.map((it) => (it.id === id ? (typeof patch === 'function' ? patch(it) : { ...it, ...patch }) : it))),
    removeAndWait: (id) => saveAndWait((prev) => prev.filter((it) => it.id !== id)),
  }
}

// ---------- Seleção de jogos ----------

export function useGameName() {
  const { items: games } = useGames()
  return useMemo(() => {
    const map = new Map(games.map((g) => [g.id, g.name]))
    return (id: string | null | undefined) => (id ? map.get(id) : undefined)
  }, [games])
}

/** Escolha de vários jogos, com busca e atalho por categoria. */
export function GamePicker({ value, onChange, disabled, invalid, id }: { value: string[]; onChange: (ids: string[]) => void; disabled?: boolean; invalid?: boolean; id?: string }) {
  const { items: games } = useGames()
  const { items: providers } = useProviders()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<GameCategory | 'todas'>('todas')
  const provName = useMemo(() => new Map(providers.map((p) => [p.id, p.name])), [providers])
  const selected = new Set(value)
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const list = games.filter(
    (g) => g.active && (cat === 'todas' || g.category === cat) && (!q.trim() || norm(`${g.name} ${provName.get(g.providerId) ?? ''}`).includes(norm(q.trim()))),
  )
  const toggle = (gid: string, on: boolean) => onChange(on ? [...value, gid] : value.filter((x) => x !== gid))
  const allOn = list.length > 0 && list.every((g) => selected.has(g.id))
  const cats = Object.keys(GAME_CATEGORY_LABEL) as GameCategory[]
  return (
    <div className={cn('rounded-xl border', invalid ? 'border-danger' : 'border-line-strong/80')}>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-line p-2.5">
          {value.map((gid) => {
            const g = games.find((x) => x.id === gid)
            return (
              <span key={gid} className="inline-flex items-center gap-1 rounded-md bg-primary/10 py-0.5 pl-2 pr-1 text-[12.5px] font-medium text-primary-text">
                {g?.name ?? gid}
                {!disabled && (
                  <button type="button" aria-label={`Remover ${g?.name ?? gid}`} onClick={() => toggle(gid, false)} className="rounded p-0.5 hover:bg-primary/15">
                    <X size={12} />
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}
      <div className="flex flex-col gap-2 p-2.5 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
          <input
            id={id}
            type="search"
            value={q}
            disabled={disabled}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar jogo ou provedora"
            aria-label="Buscar jogo ou provedora"
            className="input-base h-9 pl-9"
          />
        </div>
        <select
          value={cat}
          disabled={disabled}
          onChange={(e) => setCat(e.target.value as GameCategory | 'todas')}
          aria-label="Categoria"
          className="input-base h-9 sm:w-52"
        >
          <option value="todas">Todas as categorias</option>
          {cats.map((c) => (
            <option key={c} value={c}>
              {GAME_CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between gap-2 border-y border-line bg-surface-2 px-3 py-1.5 text-xs text-fg-3">
        <span className="tnum">
          {num(value.length)} {value.length === 1 ? 'jogo escolhido' : 'jogos escolhidos'} · {num(list.length)} na lista
        </span>
        <button
          type="button"
          disabled={disabled || !list.length}
          onClick={() => onChange(allOn ? value.filter((x) => !list.some((g) => g.id === x)) : [...new Set([...value, ...list.map((g) => g.id)])])}
          className="font-semibold text-primary-text hover:underline disabled:opacity-50"
        >
          {allOn ? 'Desmarcar a lista' : 'Marcar a lista'}
        </button>
      </div>
      <ul className="max-h-56 divide-y divide-line/70 overflow-y-auto">
        {list.map((g) => (
          <li key={g.id} className="px-3 py-2">
            <Checkbox
              checked={selected.has(g.id)}
              disabled={disabled}
              onChange={(on) => toggle(g.id, on)}
              label={
                <span className="flex flex-wrap items-center gap-x-2">
                  {g.name}
                  <span className="text-xs text-fg-3">
                    {provName.get(g.providerId)} · {GAME_CATEGORY_LABEL[g.category]}
                  </span>
                </span>
              }
            />
          </li>
        ))}
        {!list.length && <li className="px-3 py-6 text-center text-[13px] text-fg-3">Nenhum jogo encontrado.</li>}
      </ul>
    </div>
  )
}
