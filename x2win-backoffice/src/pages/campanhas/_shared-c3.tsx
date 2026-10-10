// Peças compartilhadas pelas telas de comunicação de Campanhas (parte 3):
// seletor de público com contagem ao vivo, agendamento, contador de caracteres,
// molduras de celular e e-mail, ícones de notificação e barras de taxa.
import { useMemo, useRef, type ReactNode, type RefObject } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  BatteryFull,
  Bell,
  CalendarClock,
  ChevronLeft,
  Coins,
  Crown,
  Flame,
  Gift,
  Globe,
  Hash,
  Info,
  Megaphone,
  PartyPopper,
  Send,
  ShieldOff,
  Signal,
  Star,
  Trophy,
  UserMinus,
  UserPlus,
  Users,
  UserX,
  Wallet,
  Wifi,
  Zap,
  Award,
  Search,
  Archive,
  X,
} from 'lucide-react'
import { Field, Input, NumberInput, Segmented, Select, Textarea } from '@/components/ui'
import { cn } from '@/lib/cn'
import { num, pct } from '@/lib/format'
import { isApiMode } from '@/lib/api'
import { useDeposits } from '@/data/hooks'
import type { Deposit } from '@/data/finance'
import {
  type Audience,
  type AudienceBase,
  type AudienceContext,
  type AudienceKind,
  type Channel,
  CHANNEL_LABEL,
  NEW_PLAYER_DAYS,
  estimateAudience,
  lastDepositFromPlayers,
  lastDepositMap,
  matchesAudience,
  parseIds,
  sampleRecipient,
} from '@/domain/campanhas3-audience'
import { useCampaignPlayers, type CampaignPlayer } from '@/domain/campanhas-jogadores'
import { levelIndexForXp, slotColor, useLevelsConfig } from '@/domain/campanhas3-niveis'
import type { NotifIcon, Schedule } from '@/domain/campanhas3-mensagens'

// ---------- Público ----------

const NO_DEPOSITS: Deposit[] = []
/**
 * Depósitos pagos para o público "Depositaram recentemente": na demonstração, a lista de
 * depósitos; no modo API a tela não lê os depósitos (o público do servidor já traz o
 * último depósito pago de cada jogador).
 */
const useDepositList: () => Deposit[] = isApiMode() ? () => NO_DEPOSITS : () => useDeposits().items

/**
 * Jogadores, contexto de segmentação e nomes de nível (com a trilha salva em Níveis e XP).
 * Demonstração: a base inteira. Modo API: só o público de marketing que o servidor manda
 * (jogadores ativos, sem dado pessoal) e o tamanho da base em `base`.
 */
export function useAudienceContext() {
  const { players, total, reachableOnly } = useCampaignPlayers()
  const deposits = useDepositList()
  const [levelsCfg] = useLevelsConfig()
  const levels = levelsCfg.levels
  const ctx = useMemo<AudienceContext>(
    () => ({
      now: Date.now(),
      lastDeposit: reachableOnly ? lastDepositFromPlayers(players) : lastDepositMap(deposits),
      levelOf: (p: Pick<CampaignPlayer, 'xp'>) => levelIndexForXp(levels, p.xp) + 1,
    }),
    [players, reachableOnly, deposits, levels],
  )
  const base = useMemo<AudienceBase | undefined>(() => (reachableOnly ? { total } : undefined), [reachableOnly, total])
  const levelName = (n: number) => levels[n - 1]?.name ?? `Nível ${n}`
  return { players, ctx, levels, levelName, base }
}

export function useAudienceEstimate(audience: Audience, channel: Channel) {
  const { players, ctx, levelName, levels, base } = useAudienceContext()
  const estimate = useMemo(() => estimateAudience(players, audience, ctx, channel, base), [players, audience, ctx, channel, base])
  const sample = useMemo(() => sampleRecipient(players, audience, ctx, channel), [players, audience, ctx, channel])
  return { estimate, sample, levelName, levels, ctx }
}

export const AUDIENCE_ICON: Record<AudienceKind, LucideIcon> = {
  todos: Users,
  depositou: Wallet,
  inativos: UserMinus,
  vip: Crown,
  novos: UserPlus,
  sem_deposito: UserX,
  nivel: Award,
  ids: Hash,
}

function optionLabel(kind: AudienceKind, days: number) {
  switch (kind) {
    case 'todos':
      return 'Todos'
    case 'depositou':
      return `Depositaram em ${days} dias`
    case 'inativos':
      return `Inativos há ${days} dias`
    case 'vip':
      return 'VIP'
    case 'novos':
      return 'Novos'
    case 'sem_deposito':
      return 'Sem depósito'
    case 'nivel':
      return 'Nível mínimo'
    case 'ids':
      return 'Lista de IDs'
  }
}

const OPTION_HINT: Partial<Record<AudienceKind, string>> = {
  novos: `cadastro há até ${NEW_PLAYER_DAYS} dias`,
  vip: 'etiqueta VIP na ficha',
  sem_deposito: 'cadastrados que nunca depositaram',
}

/**
 * Seletor de público com contagem ao vivo por opção, parâmetros (dias, nível,
 * IDs) e resumo de quem recebe de fato.
 */
export function AudiencePicker({
  value,
  onChange,
  kinds,
  channel,
  idPrefix,
  disabled,
  fixedDays,
  error,
  narrow,
}: {
  value: Audience
  onChange: (a: Audience) => void
  kinds: AudienceKind[]
  channel: Channel
  idPrefix: string
  disabled?: boolean
  /** janelas fixas (ex.: notificações usam 7 e 14 dias) */
  fixedDays?: Partial<Record<'depositou' | 'inativos', number>>
  error?: string | null
  /** coluna estreita (ex.: formulário dentro de Drawer com prévia ao lado) */
  narrow?: boolean
}) {
  const { players, ctx, levels, levelName, base } = useAudienceContext()
  const daysFor = (kind: AudienceKind) =>
    kind === 'depositou'
      ? (fixedDays?.depositou ?? (value.kind === 'depositou' ? value.days : 7))
      : kind === 'inativos'
        ? (fixedDays?.inativos ?? (value.kind === 'inativos' ? value.days : 14))
        : value.days
  const select = (kind: AudienceKind) => onChange({ ...value, kind, days: daysFor(kind) })
  const counts = useMemo(() => {
    const out: Partial<Record<AudienceKind, number>> = {}
    for (const k of kinds) {
      if (k === 'ids') continue
      const a: Audience = { ...value, kind: k, days: daysFor(k) }
      out[k] = players.reduce((s, p) => s + (matchesAudience(p, a, ctx) ? 1 : 0), 0)
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, ctx, kinds, value, fixedDays])
  const [idsText, setIdsTextRaw] = useIdsDraft(value)
  const estimate = useMemo(() => estimateAudience(players, value, ctx, channel, base), [players, value, ctx, channel, base])

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Público" className={cn('grid grid-cols-1 gap-2 sm:grid-cols-2', narrow && 'lg:grid-cols-1')}>
        {kinds.map((k) => {
          const Icon = AUDIENCE_ICON[k]
          const active = value.kind === k
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => select(k)}
              className={cn(
                'flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-[border-color,background-color,box-shadow] duration-150',
                'disabled:cursor-not-allowed disabled:opacity-60',
                active ? 'border-primary bg-primary/5 shadow-ring' : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2',
              )}
            >
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', active ? 'bg-primary text-primary-fg' : 'bg-surface-3 text-fg-2')}>
                <Icon size={16} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-fg">{optionLabel(k, daysFor(k))}</span>
                {OPTION_HINT[k] && <span className="block truncate text-[11.5px] text-fg-3">{OPTION_HINT[k]}</span>}
              </span>
              {counts[k] !== undefined && (
                <span className={cn('shrink-0 rounded-full px-1.5 text-[11px] font-semibold tnum', active ? 'bg-primary/10 text-primary-text' : 'bg-surface-3 text-fg-3')}>
                  {num(counts[k]!)}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {(value.kind === 'depositou' || value.kind === 'inativos') && !fixedDays?.[value.kind] && (
        <Field
          label={value.kind === 'depositou' ? 'Depositaram nos últimos' : 'Sem acessar há pelo menos'}
          htmlFor={`${idPrefix}-days`}
          error={value.days < 1 || value.days > 365 ? 'De 1 a 365 dias.' : null}
          className="max-w-xs"
        >
          <NumberInput id={`${idPrefix}-days`} value={value.days} min={1} max={365} suffix="dias" disabled={disabled} onValueChange={(n) => onChange({ ...value, days: Math.round(n) })} />
        </Field>
      )}
      {value.kind === 'nivel' && (
        <Field label="Nível mínimo" htmlFor={`${idPrefix}-level`} hint="Usa a trilha de Níveis e XP." className="max-w-xs">
          <Select
            id={`${idPrefix}-level`}
            value={String(value.level)}
            disabled={disabled}
            onChange={(v) => onChange({ ...value, level: Number(v) })}
            options={levels.map((l, i) => ({ value: String(i + 1), label: `${i + 1}. ${l.name} (${num(l.xp)} XP)` }))}
          />
        </Field>
      )}
      {value.kind === 'ids' && (
        <Field
          label="IDs dos jogadores"
          htmlFor={`${idPrefix}-ids`}
          hint="Separe por vírgula, espaço ou uma linha por ID."
          error={estimate.invalidIds.length ? `${invalidIdsText(estimate)}: ${estimate.invalidIds.slice(0, 4).join(', ')}${estimate.invalidIds.length > 4 ? '…' : ''}` : null}
        >
          <Textarea
            id={`${idPrefix}-ids`}
            rows={3}
            disabled={disabled}
            value={idsText}
            placeholder="100231, 100238, 100245"
            onChange={(e) => {
              setIdsTextRaw(e.target.value)
              onChange({ ...value, ids: parseIds(e.target.value) })
            }}
            className="font-mono text-[13px]"
          />
        </Field>
      )}

      <AudienceSummary estimate={estimate} channel={channel} levelName={levelName} />
      {error && (
        <p className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/** Modo API a lista é só o público de marketing: um ID fora dela pode existir e não receber campanhas. */
function invalidIdsText(e: ReturnType<typeof estimateAudience>) {
  const n = e.invalidIds.length
  if (e.outsideBase !== null) return `${n} ${n === 1 ? 'ID não está' : 'IDs não estão'} no público (não existe${n === 1 ? '' : 'm'} ou não pode${n === 1 ? '' : 'm'} receber campanhas)`
  return `${n} ${n === 1 ? 'ID não existe' : 'IDs não existem'} na base`
}

/** Guarda o texto digitado da lista de IDs (sem perder vírgulas enquanto digita). */
function useIdsDraft(value: Audience): [string, (v: string) => void] {
  const ref = useRef<string>(value.ids.join(', '))
  const parsed = parseIds(ref.current).join(',')
  if (parsed !== value.ids.join(',')) ref.current = value.ids.join(', ')
  const set = (v: string) => {
    ref.current = v
  }
  return [ref.current, set]
}

export function AudienceSummary({
  estimate,
  channel,
}: {
  estimate: ReturnType<typeof estimateAudience>
  channel: Channel
  levelName?: (n: number) => string
}) {
  const consentChannel = channel === 'email' || channel === 'sms' || channel === 'rcs'
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3.5" aria-live="polite">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-fg-3">Recebem {channel === 'popup' ? 'o popup' : `por ${CHANNEL_LABEL[channel]}`}</p>
          <p className="mt-0.5 font-display text-2xl font-bold leading-8 text-fg tnum">
            {num(estimate.reachable)} <span className="text-sm font-medium text-fg-3">{estimate.reachable === 1 ? 'jogador' : 'jogadores'}</span>
          </p>
        </div>
        <p className="text-xs text-fg-3 tnum">{pct(estimate.total ? estimate.reachable / estimate.total : 0, 0)} da base de {num(estimate.total)}</p>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${estimate.total ? (estimate.reachable / estimate.total) * 100 : 0}%` }} />
      </div>
      <ul className="mt-2.5 space-y-1 text-xs text-fg-3">
        <li className="flex items-center gap-1.5">
          <Users size={12} aria-hidden /> {num(estimate.matched)} no público
        </li>
        {estimate.blocked > 0 && (
          <li className="flex items-center gap-1.5">
            <ShieldOff size={12} aria-hidden /> {num(estimate.blocked)} fora por autoexclusão, pausa ou bloqueio (Lei 14.790/2023)
          </li>
        )}
        {!!estimate.outsideBase && (
          <li className="flex items-center gap-1.5">
            <ShieldOff size={12} aria-hidden /> {num(estimate.outsideBase)} da base {estimate.outsideBase === 1 ? 'fica' : 'ficam'} fora por autoexclusão, pausa ou bloqueio (Lei 14.790/2023)
          </li>
        )}
        {consentChannel && estimate.noConsent > 0 && (
          <li className="flex items-center gap-1.5">
            <UserX size={12} aria-hidden /> {num(estimate.noConsent)} sem consentimento para {CHANNEL_LABEL[channel]} (LGPD)
          </li>
        )}
      </ul>
    </div>
  )
}

// ---------- Agendamento ----------

export function ScheduleField({
  value,
  onChange,
  idPrefix,
  error,
  disabled,
  nowLabel = 'Enviar agora',
}: {
  value: Schedule
  onChange: (s: Schedule) => void
  idPrefix: string
  error?: string | null
  disabled?: boolean
  nowLabel?: string
}) {
  return (
    <div className="space-y-3">
      <Segmented
        ariaLabel="Quando enviar"
        value={value.mode}
        onChange={(mode) => !disabled && onChange({ ...value, mode })}
        options={[
          { value: 'agora', label: nowLabel, icon: Send },
          { value: 'agendar', label: 'Agendar', icon: CalendarClock },
        ]}
      />
      {value.mode === 'agendar' && (
        <Field label="Data e hora" htmlFor={`${idPrefix}-at`} error={error} hint="Horário de Brasília. Dá para cancelar até a hora do envio.">
          <Input id={`${idPrefix}-at`} type="datetime-local" value={value.at} disabled={disabled} onChange={(e) => onChange({ ...value, at: e.target.value })} className="max-w-xs" invalid={!!error} />
        </Field>
      )}
    </div>
  )
}

// ---------- Texto ----------

export function CharCounter({ value, max, className }: { value: string | number; max: number; className?: string }) {
  const n = typeof value === 'number' ? value : [...value].length
  const over = n > max
  const near = !over && n > max * 0.9
  return (
    <span className={cn('text-xs tnum', over ? 'font-semibold text-danger' : near ? 'text-warning' : 'text-fg-3', className)} aria-live="polite">
      {num(n)}/{num(max)}
    </span>
  )
}

/** Chips de variáveis que inserem {{variavel}} na posição do cursor. */
export function VarChips({
  vars,
  targetRef,
  value,
  onChange,
  disabled,
}: {
  vars: readonly { key: string; label: string }[]
  targetRef: RefObject<HTMLTextAreaElement | HTMLInputElement>
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const insert = (key: string) => {
    const token = `{{${key}}}`
    const el = targetRef.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const next = value.slice(0, start) + token + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-fg-3">Inserir:</span>
      {vars.map((v) => (
        <button
          key={v.key}
          type="button"
          disabled={disabled}
          onClick={() => insert(v.key)}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-surface-2 px-2 font-mono text-[11.5px] text-fg-2 transition-colors hover:border-primary/50 hover:text-primary-text disabled:cursor-not-allowed disabled:opacity-50"
          title={`Inserir ${v.label}`}
        >
          {`{{${v.key}}}`}
        </button>
      ))}
    </div>
  )
}

// ---------- Ícones de notificação ----------

export const NOTIF_ICONS: { value: NotifIcon; label: string; icon: LucideIcon; slot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 }[] = [
  { value: 'bell', label: 'Sino', icon: Bell, slot: 7 },
  { value: 'gift', label: 'Presente', icon: Gift, slot: 5 },
  { value: 'trophy', label: 'Troféu', icon: Trophy, slot: 4 },
  { value: 'flame', label: 'Chama', icon: Flame, slot: 2 },
  { value: 'zap', label: 'Raio', icon: Zap, slot: 4 },
  { value: 'star', label: 'Estrela', icon: Star, slot: 4 },
  { value: 'megaphone', label: 'Megafone', icon: Megaphone, slot: 1 },
  { value: 'party', label: 'Festa', icon: PartyPopper, slot: 5 },
  { value: 'coins', label: 'Moedas', icon: Coins, slot: 3 },
  { value: 'crown', label: 'Coroa', icon: Crown, slot: 7 },
]

export const NOTIF_ICON_MAP = Object.fromEntries(NOTIF_ICONS.map((i) => [i.value, i])) as Record<NotifIcon, (typeof NOTIF_ICONS)[number]>

/** Bolinha colorida com o ícone (cor da paleta de gráficos, legível nos dois temas). */
export function IconBubble({ icon: Icon, slot, size = 32, className }: { icon: LucideIcon; slot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8; size?: number; className?: string }) {
  const color = slotColor(slot)
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full', className)}
      style={{ width: size, height: size, color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}
      aria-hidden
    >
      <Icon size={Math.round(size * 0.5)} />
    </span>
  )
}

// ---------- Molduras ----------

/** Moldura de celular para prévias (SMS, RCS, inbox). */
export function PhoneFrame({ children, title, subtitle, className, avatar }: { children: ReactNode; title?: ReactNode; subtitle?: ReactNode; className?: string; avatar?: ReactNode }) {
  return (
    <div className={cn('mx-auto w-full max-w-[300px] rounded-[2.4rem] border border-line-strong bg-surface-3 p-2.5 shadow-pop', className)}>
      <div className="relative overflow-hidden rounded-[1.9rem] border border-line bg-bg">
        <div className="flex items-center justify-between px-5 pb-1 pt-2.5 text-[11px] font-semibold text-fg">
          <span className="tnum">9:41</span>
          <span className="absolute left-1/2 top-2 h-[18px] w-20 -translate-x-1/2 rounded-full bg-fg/90" aria-hidden />
          <span className="flex items-center gap-1 text-fg-2">
            <Signal size={12} aria-hidden />
            <Wifi size={12} aria-hidden />
            <BatteryFull size={14} aria-hidden />
          </span>
        </div>
        {title && (
          <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
            <ChevronLeft size={16} className="text-primary-text" aria-hidden />
            {avatar}
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-fg">{title}</p>
              {subtitle && <p className="truncate text-[11px] text-fg-3">{subtitle}</p>}
            </div>
          </div>
        )}
        <div className="min-h-[360px] px-3 py-3">{children}</div>
        <div className="flex justify-center pb-2 pt-1" aria-hidden>
          <span className="h-1 w-24 rounded-full bg-fg/30" />
        </div>
      </div>
    </div>
  )
}

/**
 * Marca da X2Win para as prévias. Não usa o BrandMark do layout: o SVG dele tem
 * id de gradiente fixo e some quando a primeira cópia (barra lateral) está oculta.
 */
export function MiniMark({ size = 22 }: { size?: number }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center bg-gradient-to-br from-primary to-primary/70 text-primary-fg"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.27) }}
      aria-hidden
    >
      <X size={Math.round(size * 0.62)} strokeWidth={3} />
      <span className="absolute rounded-full bg-gold" style={{ width: Math.max(3, size * 0.14), height: Math.max(3, size * 0.14), top: size * 0.12, right: size * 0.12 }} />
    </span>
  )
}

/** Logotipo da X2Win em miniatura para as prévias. */
export function SiteLogo({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <MiniMark size={size} />
      <span className="font-display text-[13px] font-extrabold tracking-tight text-fg">
        X2<span className="text-primary-text">WIN</span>
      </span>
    </span>
  )
}

/** Cabeçalho do site (prévias de sino e popup). */
export function SiteHeaderMock({ right, className, nav = false }: { right?: ReactNode; className?: string; nav?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2', className)}>
      <SiteLogo size={20} />
      <div className={cn('hidden items-center gap-3 text-[11px] font-medium text-fg-3', nav && 'md:flex')}>
        <span>Cassino</span>
        <span>Esportes</span>
        <span>Promoções</span>
      </div>
      <div className="flex items-center gap-2">{right}</div>
    </div>
  )
}

/** Blocos neutros que imitam o conteúdo do site atrás de modais. */
export function SiteSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 p-3" aria-hidden>
      <div className="h-20 rounded-lg bg-gradient-to-r from-primary/20 to-primary/5" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((__, j) => (
            <div key={j} className="aspect-[3/4] rounded-md bg-surface-3" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function EmailFrame({
  fromName,
  fromEmail,
  subject,
  preheader,
  children,
}: {
  fromName: string
  fromEmail: string
  subject: string
  preheader: string
  children: ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <div className="flex items-center gap-1.5 border-b border-line bg-surface-2 px-3 py-2" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
        <span className="ml-2 flex h-6 flex-1 items-center gap-1.5 rounded-md bg-surface px-2 text-[11px] text-fg-3">
          <Search size={11} /> Caixa de entrada
        </span>
      </div>
      {/* linha da caixa de entrada */}
      <div className="flex items-start gap-2.5 border-b border-line bg-primary/[0.04] px-3 py-2.5">
        <MiniMark size={28} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-[13px] font-bold text-fg">{fromName}</p>
            <span className="shrink-0 text-[11px] text-fg-3">agora</span>
          </div>
          <p className="truncate text-[12.5px] font-semibold text-fg">{subject || 'Sem assunto'}</p>
          <p className="truncate text-[12px] text-fg-3">{preheader || 'O pré-cabeçalho aparece aqui, ao lado do assunto.'}</p>
        </div>
        <Star size={14} className="mt-0.5 shrink-0 text-fg-3" aria-hidden />
      </div>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-[11.5px] text-fg-3">
        <Archive size={12} aria-hidden />
        De:{' '}
        {/* sem e-mail do remetente em Integrações: diz isso, em vez de "X2Win <>" */}
        {fromEmail.trim() ? (
          <>
            <span className="font-medium text-fg-2">{fromName}</span> &lt;{fromEmail}&gt;
          </>
        ) : (
          <span className="text-warning">remetente não definido (Integrações)</span>
        )}
      </div>
      <div className="bg-surface-2 p-3 sm:p-5">
        <div className="mx-auto max-w-[480px] overflow-hidden rounded-lg border border-line bg-surface">
          <div className="flex items-center justify-center border-b border-line py-3">
            <SiteLogo />
          </div>
          <div className="px-5 py-5">{children}</div>
          <div className="border-t border-line px-5 py-3 text-center text-[10.5px] leading-4 text-fg-3">
            Você recebe este e-mail porque aceitou comunicações da X2Win. <span className="underline">Descadastrar</span>
            <br />
            Jogue com responsabilidade. Proibido para menores de 18 anos.
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- Tabelas ----------

/**
 * Contorno para o DataTable com rowActions: o rótulo "Ações" (sr-only, posição
 * absoluta) escapa da rolagem horizontal da tabela e alarga a página. Este
 * invólucro posicionado corta o excesso só na horizontal.
 */
export function TableFrame({ children }: { children: ReactNode }) {
  return <div className="relative -mx-1 overflow-x-clip px-1 pb-1">{children}</div>
}

// ---------- Indicadores ----------

/** Taxa com barra: "58% · 180 de 311". */
export function RateBar({ value, total, tone = 'primary', showCount = true }: { value: number; total: number; tone?: 'primary' | 'success' | 'info' | 'warning'; showCount?: boolean }) {
  const r = total ? value / total : 0
  const color = { primary: 'bg-primary', success: 'bg-success', info: 'bg-info', warning: 'bg-warning' }[tone]
  return (
    <div className="min-w-[110px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-fg tnum">{total ? pct(r, 0) : '—'}</span>
        {showCount && <span className="text-[11px] text-fg-3 tnum">{num(value)}</span>}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`${pct(r, 0)}`}>
        <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.min(100, r * 100)}%` }} />
      </div>
    </div>
  )
}

export function MiniStat({ label, value, sub, icon: Icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs text-fg-3">
        {Icon && <Icon size={12} aria-hidden />}
        {label}
      </p>
      <p className="mt-0.5 truncate text-base font-bold text-fg tnum">{value}</p>
      {sub && <p className="truncate text-[11.5px] text-fg-3">{sub}</p>}
    </div>
  )
}

/** Aviso curto e discreto em linha. */
export function InlineNote({ children, icon: Icon = Info, tone = 'neutral' }: { children: ReactNode; icon?: LucideIcon; tone?: 'neutral' | 'warning' | 'success' | 'danger' }) {
  return (
    <p
      className={cn(
        'flex items-start gap-1.5 text-xs leading-5',
        tone === 'neutral' && 'text-fg-3',
        tone === 'warning' && 'text-warning',
        tone === 'success' && 'text-success',
        tone === 'danger' && 'text-danger',
      )}
    >
      <Icon size={13} className="mt-[3px] shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

/** Pequeno selo "link do site" para mostrar destino de botões. */
export function LinkChip({ link }: { link: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-fg-2">
      <Globe size={10} className="shrink-0" aria-hidden />
      <span className="truncate">{link}</span>
    </span>
  )
}

