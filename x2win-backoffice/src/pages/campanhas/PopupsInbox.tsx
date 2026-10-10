import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Copy,
  Eye,
  FlaskConical,
  Inbox,
  Link2,
  Mail,
  MailOpen,
  Megaphone,
  MousePointerClick,
  Pause,
  Pencil,
  Play,
  Plus,
  Send,
  Trash2,
  Trophy,
  X,
  XCircle,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ChipFilter,
  DataTable,
  DescriptionList,
  Drawer,
  Field,
  FormGrid,
  ImageUpload,
  Input,
  KpiCard,
  NumberInput,
  PageHeader,
  RadioCards,
  Segmented,
  Select,
  Switch,
  Tabs,
  Textarea,
  confirm,
  toast,
  useTabParam,
  type Column,
  type Tone,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { date, dateTime, num, pct, relative } from '@/lib/format'
import { useCollection } from '@/lib/store'
import { uid } from '@/lib/random'
import { DAY } from '@/data/now'
import { seedInbox, seedPopups } from '@/data/campanhas3-seeds'
import { audit, usePageAccess, useSession } from '@/domain/session'
import { type Audience, type AudienceKind, DEFAULT_AUDIENCE, audienceError, describeAudience } from '@/domain/campanhas3-audience'
import {
  FREQUENCY_LABEL,
  INBOX_LIMITS,
  POPUP_LIMITS,
  SITE_PAGES,
  SITE_PAGE_LABEL,
  VISIT_LABEL,
  defaultScheduleAt,
  effectiveStatus,
  pickPopup,
  popupErrors,
  popupState,
  priorityTies,
  scheduleError,
  scheduleIso,
  type InboxMessage,
  type Popup,
  type PopupDraft,
  type PopupFrequency,
  type PopupState,
  type Schedule,
  type SitePage,
  type VisitKind,
} from '@/domain/campanhas3-mensagens'
import { AUDIENCE_ICON, AudiencePicker, CharCounter, PhoneFrame, RateBar, ScheduleField, SiteHeaderMock, SiteSkeleton, TableFrame, useAudienceContext, useAudienceEstimate, MiniMark } from './_shared-c3'
import { safeImageSrc } from '@/domain/personalizacao-p1'

const KEY = 'campanhas.popups-inbox'

const STATE_LABEL: Record<PopupState, string> = { ativo: 'Ativo', pausado: 'Pausado', agendado: 'Agendado', encerrado: 'Encerrado' }
const STATE_TONE: Record<PopupState, Tone> = { ativo: 'success', pausado: 'neutral', agendado: 'info', encerrado: 'neutral' }

export default function PopupsInbox() {
  const [tab, setTab] = useTabParam('popups', ['popups', 'inbox'] as const)
  const { canEdit } = usePageAccess()
  const popups = useCollection<Popup>(`${KEY}.popups`, seedPopups)
  const inbox = useCollection<InboxMessage>(`${KEY}.inbox`, seedInbox)
  const [editing, setEditing] = useState<Popup | 'novo' | null>(null)
  const [composing, setComposing] = useState(false)
  const now = Date.now()
  const activeCount = popups.items.filter((p) => popupState(p, now) === 'ativo').length

  return (
    <>
      <PageHeader
        actions={
          tab === 'popups' ? (
            <Button variant="primary" icon={Plus} disabled={!canEdit} title={!canEdit ? 'Seu cargo não cria popups' : undefined} onClick={() => setEditing('novo')}>
              Novo popup
            </Button>
          ) : (
            <Button variant="primary" icon={Plus} disabled={!canEdit} title={!canEdit ? 'Seu cargo não envia mensagens' : undefined} onClick={() => setComposing(true)}>
              Nova mensagem
            </Button>
          )
        }
      >
        <Tabs
          className="mt-5"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'popups', label: 'Popups', icon: Megaphone, count: activeCount },
            { value: 'inbox', label: 'Inbox', icon: Inbox, count: inbox.items.length },
          ]}
        />
      </PageHeader>
      {tab === 'popups' ? (
        <PopupsTab popups={popups} onEdit={setEditing} />
      ) : (
        <InboxTab inbox={inbox} onCompose={() => setComposing(true)} />
      )}
      {editing && (
        <PopupEditor
          initial={editing === 'novo' ? null : editing}
          all={popups.items}
          onClose={() => setEditing(null)}
          onSave={(p, isNew) => {
            if (isNew) popups.add(p)
            else popups.update(p.id, p)
            setEditing(null)
          }}
        />
      )}
      {composing && <InboxComposer onClose={() => setComposing(false)} onSend={(m) => inbox.add(m)} />}
    </>
  )
}

// ======================= POPUPS =======================

function PopupThumb({ p, size = 'sm' }: { p: Pick<Popup, 'image' | 'title'>; size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'h-9 w-14' : 'h-14 w-24'
  const image = safeImageSrc(p.image)
  return image ? (
    <img src={image} alt="" className={cn('shrink-0 rounded-md border border-line object-cover', cls)} />
  ) : (
    <span className={cn('flex shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary/30 to-primary/5 text-primary-text', cls)} aria-hidden>
      <Megaphone size={size === 'sm' ? 15 : 20} />
    </span>
  )
}

function PopupsTab({ popups, onEdit }: { popups: ReturnType<typeof useCollection<Popup>>; onEdit: (p: Popup) => void }) {
  const { canEdit } = usePageAccess()
  const [filter, setFilter] = useState<'todos' | PopupState>('todos')
  const now = Date.now()
  const rows = useMemo(() => popups.items.map((p) => ({ ...p, state: popupState(p, now) })), [popups.items, now])
  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: rows.length }
    for (const r of rows) c[r.state] = (c[r.state] ?? 0) + 1
    return c
  }, [rows])
  const ties = priorityTies(popups.items, now)
  const views = rows.reduce((s, r) => s + r.views, 0)
  const clicks = rows.reduce((s, r) => s + r.clicks, 0)
  const best = [...rows].filter((r) => r.views > 300).sort((a, b) => b.clicks / b.views - a.clicks / a.views)[0]
  const { levelName } = useAudienceContext()

  const toggle = async (p: Popup) => {
    const st = popupState(p, now)
    if (st === 'encerrado') {
      toast.info('Popup encerrado', { description: 'Edite o período para reativar.' })
      return
    }
    if (p.active) {
      const ok = await confirm({ title: `Pausar "${p.title}"?`, description: 'Ele para de aparecer no site na hora. Outro popup elegível pode tomar o lugar.', confirmLabel: 'Pausar popup', tone: 'warning', icon: Pause })
      if (!ok) return
    }
    popups.update(p.id, { active: !p.active, updatedAt: new Date().toISOString() })
    audit(p.active ? 'desligar' : 'ligar', `Popup "${p.title}"`, p.active ? 'Popup pausado' : 'Popup ativado')
    toast.success(p.active ? 'Popup pausado' : 'Popup ativado')
  }

  const remove = async (p: Popup) => {
    const ok = await confirm({
      title: `Excluir "${p.title}"?`,
      description: `O popup sai do site e as métricas (${num(p.views)} visualizações) são apagadas. Não dá para desfazer.`,
      confirmLabel: 'Excluir popup',
      tone: 'danger',
      icon: Trash2,
    })
    if (!ok) return
    popups.remove(p.id)
    audit('excluir', `Popup "${p.title}"`, `Popup excluído (prioridade ${p.priority})`)
    toast.success('Popup excluído')
  }

  const duplicate = (p: Popup) => {
    const nowIso = new Date().toISOString()
    const copy: Popup = { ...p, id: uid('pp'), title: `${p.title} (cópia)`.slice(0, POPUP_LIMITS.title), active: false, views: 0, clicks: 0, createdAt: nowIso, updatedAt: nowIso }
    popups.add(copy)
    audit('criar', `Popup "${copy.title}"`, `Cópia de "${p.title}", criada pausada`)
    toast.success('Popup duplicado', { description: 'A cópia começa pausada.' })
  }

  const columns: Column<(typeof rows)[number]>[] = [
    {
      id: 'title',
      header: 'Popup',
      pinned: true,
      minWidth: 260,
      sortValue: (r) => r.title,
      csv: (r) => r.title,
      cell: (r) => (
        <div className="flex min-w-0 max-w-[320px] items-center gap-2.5">
          <PopupThumb p={r} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-fg">{r.title}</p>
            <p className="truncate text-xs text-fg-3">{r.text}</p>
          </div>
        </div>
      ),
    },
    {
      id: 'priority',
      header: 'Prioridade',
      align: 'right',
      sortValue: (r) => r.priority,
      cell: (r) => (
        <div className="ml-auto w-[72px]">
          <p className="text-[13px] font-semibold text-fg tnum">{r.priority}</p>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-primary" style={{ width: `${r.priority}%` }} />
          </div>
        </div>
      ),
    },
    {
      id: 'pages',
      header: 'Páginas',
      csv: (r) => r.pages.map((p) => SITE_PAGE_LABEL[p]).join(', '),
      cell: (r) => (
        <div className="flex items-center gap-1" title={r.pages.map((p) => SITE_PAGE_LABEL[p]).join(', ')}>
          <Badge>{SITE_PAGE_LABEL[r.pages[0]]}</Badge>
          {r.pages.length > 1 && <Badge tone="primary">{`+${r.pages.length - 1}`}</Badge>}
        </div>
      ),
    },
    { id: 'audience', header: 'Público', sortValue: (r) => r.audience.kind, csv: (r) => describeAudience(r.audience, levelName), cell: (r) => <span className="text-[13px] text-fg-2">{describeAudience(r.audience, levelName)}</span> },
    {
      id: 'period',
      header: 'Período',
      sortValue: (r) => r.startAt,
      csv: (r) => `${date(r.startAt)} - ${r.endAt ? date(r.endAt) : 'sem fim'}`,
      cell: (r) => (
        <span className="whitespace-nowrap text-[13px] text-fg-2">
          {date(r.startAt)} – {r.endAt ? date(r.endAt) : <span className="text-fg-3">sem fim</span>}
        </span>
      ),
    },
    { id: 'frequency', header: 'Frequência', sortValue: (r) => r.frequency, csv: (r) => FREQUENCY_LABEL[r.frequency], cell: (r) => <span className="text-[13px] text-fg-2">{FREQUENCY_LABEL[r.frequency]}</span> },
    {
      id: 'ctr',
      header: 'Visualizações · CTR',
      align: 'right',
      sortValue: (r) => r.views,
      csv: (r) => `${r.views} / ${r.views ? ((r.clicks / r.views) * 100).toFixed(1) : 0}%`,
      cell: (r) => (
        <div className="text-right">
          <p className="text-[13px] font-medium text-fg tnum">{num(r.views)}</p>
          <p className="text-xs text-fg-3 tnum">{r.views ? `${pct(r.clicks / r.views)} clicaram` : '—'}</p>
        </div>
      ),
    },
    {
      id: 'state',
      header: 'Status',
      sortValue: (r) => r.state,
      csv: (r) => STATE_LABEL[r.state],
      cell: (r) => (
        <Badge tone={STATE_TONE[r.state]} dot>
          {STATE_LABEL[r.state]}
        </Badge>
      ),
    },
  ]

  const filtered = filter === 'todos' ? rows : rows.filter((r) => r.state === filter)

  return (
    <div className="space-y-5">
      <section aria-label="Resumo dos popups" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Ativos agora" icon={Megaphone} value={num(counts.ativo ?? 0)} hint={`${num(counts.agendado ?? 0)} agendados · ${num(counts.pausado ?? 0)} pausados`} onClick={() => setFilter('ativo')} active={filter === 'ativo'} />
        <KpiCard label="Visualizações" icon={Eye} tone="info" value={num(views)} hint="soma de todos os popups" />
        <KpiCard label="CTR médio" icon={MousePointerClick} tone="success" value={pct(views ? clicks / views : 0)} hint={`${num(clicks)} cliques no botão`} formula="Cliques no botão ÷ visualizações, somando todos os popups." />
        <KpiCard label="Melhor CTR" icon={Trophy} tone="warning" value={best ? pct(best.clicks / best.views) : '—'} hint={best?.title ?? 'sem dados suficientes'} />
      </section>

      <Alert tone="info" icon={Megaphone} title="No máximo um popup por carregamento de página">
        Entre os popups elegíveis para a página e o jogador, aparece só o de maior prioridade. Em empate, vence o editado mais recentemente. Use o simulador abaixo para conferir.
      </Alert>

      {ties.length > 0 && (
        <Alert tone="warning" icon={AlertTriangle} title="Empate de prioridade">
          {ties.map((t) => `${SITE_PAGE_LABEL[t.page]}: ${t.titles.map((x) => `"${x}"`).join(' e ')} com prioridade ${t.priority}`).join('. ')}. Defina prioridades diferentes para controlar qual aparece.
        </Alert>
      )}

      <TableFrame>
        <DataTable
          caption="Popups do site"
          rows={filtered}
          columns={columns}
          rowKey={(r) => r.id}
          searchText={(r) => `${r.title} ${r.text}`}
          searchPlaceholder="Buscar popup"
          initialSort={{ id: 'priority', dir: 'desc' }}
          exportName="popups"
          onExport={(n) => audit('exportar', 'Popups', `Exportação CSV de ${n} popups`)}
          onRowClick={(r) => onEdit(r)}
          resetKey={filter}
          toolbar={
            <ChipFilter
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'todos', label: 'Todos', count: counts.todos ?? 0 },
                { value: 'ativo', label: 'Ativos', count: counts.ativo ?? 0 },
                { value: 'agendado', label: 'Agendados', count: counts.agendado ?? 0 },
                { value: 'pausado', label: 'Pausados', count: counts.pausado ?? 0 },
                { value: 'encerrado', label: 'Encerrados', count: counts.encerrado ?? 0 },
              ]}
            />
          }
          rowActions={(r) => [
            { label: canEdit ? 'Editar' : 'Ver', icon: canEdit ? Pencil : Eye, onSelect: () => onEdit(r) },
            { label: 'Duplicar', icon: Copy, onSelect: () => duplicate(r), disabled: !canEdit },
            { label: r.active ? 'Pausar' : 'Ativar', icon: r.active ? Pause : Play, onSelect: () => toggle(r), disabled: !canEdit || r.state === 'encerrado' },
            { divider: true },
            { label: 'Excluir', icon: Trash2, danger: true, onSelect: () => remove(r), disabled: !canEdit },
          ]}
          empty={{ title: 'Nenhum popup neste filtro', description: 'Crie um popup para avisar o jogador assim que ele abre o site.', icon: Megaphone }}
        />
      </TableFrame>

      <PopupSimulator popups={popups.items} />
    </div>
  )
}

const TRAIT_OPTIONS: { value: AudienceKind; label: string }[] = [
  { value: 'novos', label: 'Novo' },
  { value: 'vip', label: 'VIP' },
  { value: 'depositou', label: 'Depositou recentemente' },
  { value: 'inativos', label: 'Inativo' },
  { value: 'sem_deposito', label: 'Sem depósito' },
]

function PopupSimulator({ popups }: { popups: Popup[] }) {
  const { levels, levelName } = useAudienceContext()
  const [page, setPage] = useState<SitePage>('home')
  const [segments, setSegments] = useState<AudienceKind[]>(['sem_deposito', 'novos'])
  const [level, setLevel] = useState(1)
  const [visit, setVisit] = useState<VisitKind>('primeira')
  const result = useMemo(() => pickPopup(popups, { page, traits: { segments, level }, visit, levelName }), [popups, page, segments, level, visit, levelName])

  return (
    <Card>
      <CardHeader icon={FlaskConical} title="Qual popup aparece?" description="Escolha a página e o perfil do jogador. O simulador aplica a regra do site e mostra por que os outros perderam." />
      <CardBody className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="space-y-4">
          <FormGrid>
            <Field label="Página" htmlFor="sim-page">
              <Select id="sim-page" value={page} onChange={(v) => setPage(v as SitePage)} options={SITE_PAGES.map((p) => ({ value: p, label: SITE_PAGE_LABEL[p] }))} />
            </Field>
            <Field label="Nível do jogador" htmlFor="sim-level">
              <Select id="sim-level" value={String(level)} onChange={(v) => setLevel(Number(v))} options={levels.map((l, i) => ({ value: String(i + 1), label: `${i + 1}. ${l.name}` }))} />
            </Field>
          </FormGrid>
          <Field label="Perfil do jogador">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Perfil do jogador">
              {TRAIT_OPTIONS.map((t) => {
                const on = segments.includes(t.value)
                const Icon = AUDIENCE_ICON[t.value]
                return (
                  <button
                    key={t.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSegments((s) => (on ? s.filter((x) => x !== t.value) : [...s, t.value]))}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors',
                      on ? 'border-primary bg-primary/10 text-primary-text' : 'border-line bg-surface text-fg-2 hover:border-line-strong',
                    )}
                  >
                    <Icon size={13} aria-hidden />
                    {t.label}
                  </button>
                )
              })}
            </div>
          </Field>
          <Field label="Visita">
            <Segmented ariaLabel="Visita" value={visit} onChange={setVisit} options={(Object.keys(VISIT_LABEL) as VisitKind[]).map((v) => ({ value: v, label: VISIT_LABEL[v] }))} className="max-w-full overflow-x-auto" />
          </Field>
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <p className="mb-2 text-xs font-medium text-fg-3">O site vê</p>
            {result.winner ? <PopupPreview popup={result.winner} page={page} compact /> : <EmptyPreview page={page} />}
          </div>
        </div>

        <div aria-live="polite">
          <p className="mb-2 text-sm font-semibold text-fg">
            {result.winner ? (
              <>
                Aparece: <span className="text-primary-text">{result.winner.title}</span>
              </>
            ) : (
              'Nenhum popup aparece'
            )}
          </p>
          <ol className="space-y-2">
            {result.entries.map((e) => (
              <li
                key={e.popup.id}
                className={cn(
                  'flex items-start gap-3 rounded-xl border px-3 py-2.5',
                  e.won ? 'border-success/40 bg-success/5' : e.eligible ? 'border-warning/30 bg-warning/[0.04]' : 'border-line',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                    e.won ? 'bg-success/15 text-success' : e.eligible ? 'bg-warning/15 text-warning' : 'bg-surface-3 text-fg-3',
                  )}
                  aria-hidden
                >
                  {e.won ? <Trophy size={14} /> : e.eligible ? <AlertTriangle size={14} /> : <XCircle size={14} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="truncate text-[13px] font-medium text-fg">{e.popup.title}</p>
                    <Badge tone={e.won ? 'success' : e.eligible ? 'warning' : 'neutral'}>{e.won ? 'Vence' : e.eligible ? 'Elegível, perdeu' : 'Fora'}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-fg-3">{e.reason}</p>
                </div>
                <span className="shrink-0 text-xs text-fg-3 tnum" title="Prioridade">
                  P{e.popup.priority}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </CardBody>
    </Card>
  )
}

function EmptyPreview({ page }: { page: SitePage }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-bg">
      <SiteHeaderMock />
      <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
        <CheckCircle2 size={20} className="text-fg-3" aria-hidden />
        <p className="text-[13px] font-medium text-fg-2">{SITE_PAGE_LABEL[page]} abre sem popup</p>
        <p className="text-xs text-fg-3">Nenhum popup elegível para este jogador.</p>
      </div>
    </div>
  )
}

/** Prévia do modal sobre o site. */
function PopupPreview({ popup, page, compact }: { popup: Pick<Popup, 'title' | 'text' | 'image' | 'button'>; page: SitePage; compact?: boolean }) {
  return (
    <div className={cn('relative overflow-hidden rounded-xl border border-line bg-bg', compact ? 'min-h-[400px]' : 'min-h-[430px]')}>
      <SiteHeaderMock />
      <p className="px-3 pt-2 text-[10.5px] font-medium uppercase tracking-wide text-fg-3">{SITE_PAGE_LABEL[page]}</p>
      <SiteSkeleton rows={3} />
      <div className="absolute inset-0 top-[41px] flex items-center justify-center bg-bg/75 p-4 backdrop-blur-[1.5px]">
        <span className="sr-only">Prévia do popup em {SITE_PAGE_LABEL[page]}</span>
        <div className="relative w-full max-w-[280px] overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
          <span className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-surface/90 text-fg-2 shadow-sm" aria-hidden>
            <X size={13} />
          </span>
          {safeImageSrc(popup.image) ? (
            <img src={safeImageSrc(popup.image)!} alt="" className="aspect-[2/1] w-full object-cover" />
          ) : (
            <div className="flex aspect-[2/1] w-full items-center justify-center bg-gradient-to-br from-primary/35 via-primary/15 to-transparent">
              <Megaphone size={compact ? 26 : 32} className="text-primary-text" aria-hidden />
            </div>
          )}
          <div className="p-4 text-center">
            <p className="break-words font-display text-[15px] font-bold leading-5 text-fg">{popup.title || 'Título do popup'}</p>
            <p className="mt-1.5 line-clamp-4 break-words text-xs leading-[18px] text-fg-2">{popup.text || 'O texto do popup aparece aqui.'}</p>
            <span className="mt-3 flex h-9 w-full items-center justify-center rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-fg">
              <span className="truncate">{popup.button.label || 'Botão'}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

const toDateInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const fromDateInput = (v: string, end = false) => (v ? new Date(`${v}T${end ? '23:59:00' : '00:00:00'}`).toISOString() : null)

const POPUP_KINDS: AudienceKind[] = ['todos', 'depositou', 'inativos', 'vip', 'novos', 'sem_deposito', 'nivel']

function PopupEditor({ initial, all, onClose, onSave }: { initial: Popup | null; all: Popup[]; onClose: () => void; onSave: (p: Popup, isNew: boolean) => void }) {
  const { canEdit } = usePageAccess()
  const [d, setD] = useState<PopupDraft>(() =>
    initial
      ? { title: initial.title, image: initial.image, text: initial.text, button: { ...initial.button }, pages: [...initial.pages], audience: initial.audience, priority: initial.priority, startAt: initial.startAt, endAt: initial.endAt, frequency: initial.frequency, active: initial.active }
      : { title: '', image: null, text: '', button: { label: 'Aproveitar', link: '/promocoes' }, pages: ['home'], audience: DEFAULT_AUDIENCE, priority: 50, startAt: fromDateInput(toDateInput(new Date().toISOString()))!, endAt: null, frequency: 'por_sessao', active: true },
  )
  const [touched, setTouched] = useState(false)
  const [previewPage, setPreviewPage] = useState<SitePage>(d.pages[0] ?? 'home')
  const errs = popupErrors(d)
  const show = (k: keyof typeof errs) => (touched || (k !== 'title' && k !== 'text' && k !== 'buttonLabel') ? errs[k] : undefined)
  const set = <K extends keyof PopupDraft>(k: K, v: PopupDraft[K]) => setD((x) => ({ ...x, [k]: v }))
  const { estimate } = useAudienceEstimate(d.audience, 'popup')

  // concorrência: popups ativos que dividem página com este
  const competitors = all
    .filter((p) => p.id !== initial?.id && popupState(p) !== 'encerrado' && p.active && p.pages.some((pg) => d.pages.includes(pg)))
    .sort((a, b) => b.priority - a.priority)
  const above = competitors.filter((p) => p.priority > d.priority)
  const tie = competitors.filter((p) => p.priority === d.priority)

  const save = () => {
    setTouched(true)
    const first = Object.values(errs)[0]
    if (first) {
      toast.error('Revise o popup', { description: first })
      return
    }
    const nowIso = new Date().toISOString()
    const p: Popup = initial
      ? { ...initial, ...d, title: d.title.trim(), text: d.text.trim(), updatedAt: nowIso }
      : { ...d, title: d.title.trim(), text: d.text.trim(), id: uid('pp'), views: 0, clicks: 0, createdAt: nowIso, updatedAt: nowIso }
    onSave(p, !initial)
    audit(initial ? 'editar' : 'criar', `Popup "${p.title}"`, `Prioridade ${p.priority} · ${p.pages.map((x) => SITE_PAGE_LABEL[x]).join(', ')} · ${FREQUENCY_LABEL[p.frequency]}`)
    toast.success(initial ? 'Popup salvo' : 'Popup criado', { description: p.active ? 'Já vale no site para o público escolhido.' : 'Está pausado: ative quando quiser.' })
  }

  return (
    <Drawer
      open
      onClose={onClose}
      width="xl"
      title={initial ? (canEdit ? 'Editar popup' : 'Popup') : 'Novo popup'}
      description="Modal que aparece ao carregar a página. No máximo um por carregamento: o de maior prioridade."
      headerExtra={initial && <Badge tone={STATE_TONE[popupState(initial)]} dot size="md">{STATE_LABEL[popupState(initial)]}</Badge>}
      footer={
        <>
          <Button onClick={onClose}>{canEdit ? 'Cancelar' : 'Fechar'}</Button>
          {canEdit && (
            <Button variant="primary" icon={CheckCircle2} onClick={save}>
              {initial ? 'Salvar popup' : 'Criar popup'}
            </Button>
          )}
        </>
      }
    >
      <fieldset disabled={!canEdit} className="grid grid-cols-1 min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-5">
          <Field label="Título" htmlFor="pp-title" required error={show('title')} labelAside={<CharCounter value={d.title} max={POPUP_LIMITS.title} />}>
            <Input id="pp-title" data-autofocus value={d.title} onChange={(e) => set('title', e.target.value)} invalid={!!show('title')} placeholder="Ex.: Deposite 50 e ganhe o dobro" />
          </Field>
          <ImageUpload label="Imagem" value={d.image} onChange={(v) => set('image', v)} width={600} height={300} hint="600×300 px · até 3 MB" disabled={!canEdit} />
          <Field label="Texto" htmlFor="pp-text" required error={show('text')} labelAside={<CharCounter value={d.text} max={POPUP_LIMITS.text} />}>
            <Textarea id="pp-text" rows={3} value={d.text} onChange={(e) => set('text', e.target.value)} invalid={!!show('text')} />
          </Field>
          <FormGrid>
            <Field label="Texto do botão" htmlFor="pp-btn" required error={show('buttonLabel')} labelAside={<CharCounter value={d.button.label} max={POPUP_LIMITS.buttonLabel} />}>
              <Input id="pp-btn" value={d.button.label} onChange={(e) => set('button', { ...d.button, label: e.target.value })} invalid={!!show('buttonLabel')} />
            </Field>
            <Field label="Link do botão" htmlFor="pp-link" required error={show('buttonLink')}>
              <Input id="pp-link" icon={Link2} value={d.button.link} onChange={(e) => set('button', { ...d.button, link: e.target.value })} invalid={!!show('buttonLink')} />
            </Field>
          </FormGrid>

          <Field label="Páginas onde aparece" error={show('pages')}>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Páginas onde aparece">
              {SITE_PAGES.map((pg) => {
                const on = d.pages.includes(pg)
                return (
                  <button
                    key={pg}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set('pages', on ? d.pages.filter((x) => x !== pg) : [...d.pages, pg])}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                      on ? 'border-primary bg-primary/10 text-primary-text' : 'border-line bg-surface text-fg-2 hover:border-line-strong',
                    )}
                  >
                    {on && <CheckCircle2 size={13} aria-hidden />}
                    {SITE_PAGE_LABEL[pg]}
                  </button>
                )
              })}
            </div>
          </Field>

          <div>
            <p className="mb-2 text-[13px] font-medium text-fg">Público</p>
            <AudiencePicker value={d.audience} onChange={(a) => set('audience', a)} kinds={POPUP_KINDS} channel="popup" idPrefix="pp-aud" narrow disabled={!canEdit} error={show('audience')} />
          </div>

          <FormGrid>
            <Field label="Prioridade" htmlFor="pp-prio" error={show('priority')} hint="1 a 100. O maior vence.">
              <NumberInput id="pp-prio" value={d.priority} min={1} max={100} onValueChange={(n) => set('priority', Math.round(n))} invalid={!!show('priority')} />
            </Field>
            <div className="self-end rounded-lg bg-surface-2 px-3 py-2 text-xs leading-5 text-fg-2" aria-live="polite">
              {competitors.length === 0
                ? 'Nenhum outro popup ativo nestas páginas.'
                : above.length
                  ? `Fica atrás de ${above.map((p) => `"${p.title}" (${p.priority})`).slice(0, 2).join(', ')}${above.length > 2 ? '…' : ''} para quem estiver nos dois públicos.`
                  : tie.length
                    ? `Empata com "${tie[0].title}". Vence o editado por último.`
                    : `Vence os outros ${competitors.length} popups ativos destas páginas.`}
            </div>
            <Field label="Início" htmlFor="pp-start" error={show('startAt')}>
              <Input id="pp-start" type="date" value={toDateInput(d.startAt)} onChange={(e) => set('startAt', fromDateInput(e.target.value) ?? '')} />
            </Field>
            <Field label="Fim" htmlFor="pp-end" error={show('endAt')} hint="Vazio = sem data para acabar.">
              <Input id="pp-end" type="date" value={toDateInput(d.endAt)} onChange={(e) => set('endAt', fromDateInput(e.target.value, true))} invalid={!!show('endAt')} />
            </Field>
          </FormGrid>

          <Field label="Frequência">
            <RadioCards<PopupFrequency>
              name="Frequência"
              columns={3}
              value={d.frequency}
              onChange={(f) => set('frequency', f)}
              options={[
                { value: 'uma_vez', label: 'Uma vez', description: 'Só na primeira visita.' },
                { value: 'por_sessao', label: 'Por sessão', description: 'Uma vez a cada acesso.' },
                { value: 'sempre', label: 'Sempre', description: 'Toda vez que a página carrega.' },
              ]}
            />
          </Field>
          <Switch label="Ativo" description={d.active ? 'Aparece no site dentro do período.' : 'Pausado: não aparece até ser ativado.'} checked={d.active} onChange={(on) => set('active', on)} />
        </div>

        <div className="min-w-0 lg:sticky lg:top-0 lg:self-start">
          <p className="mb-2 text-[13px] font-medium text-fg">Prévia</p>
          <PopupPreview popup={d} page={previewPage} />
          {d.pages.length > 1 && (
            <div className="mt-2">
              <label htmlFor="pp-prev-page" className="sr-only">
                Página da prévia
              </label>
              <Select id="pp-prev-page" value={previewPage} onChange={(v) => setPreviewPage(v as SitePage)} options={d.pages.map((p) => ({ value: p, label: SITE_PAGE_LABEL[p] }))} />
            </div>
          )}
          <p className="mt-3 text-xs text-fg-3">
            Público estimado: <strong className="text-fg">{num(estimate.reachable)}</strong> jogadores ativos.
          </p>
          {initial && (
            <DescriptionList
              className="mt-4"
              columns={1}
              items={[
                { label: 'Visualizações', value: `${num(initial.views)} · ${initial.views ? pct(initial.clicks / initial.views) : '—'} clicaram` },
                { label: 'Última edição', value: `${dateTime(initial.updatedAt)} (${relative(initial.updatedAt)})` },
              ]}
            />
          )}
        </div>
      </fieldset>
    </Drawer>
  )
}

// ======================= INBOX =======================

const INBOX_STATUS_LABEL = { agendada: 'Agendada', enviada: 'Enviada' } as const

function InboxTab({ inbox, onCompose }: { inbox: ReturnType<typeof useCollection<InboxMessage>>; onCompose: () => void }) {
  const { canEdit } = usePageAccess()
  const [openId, setOpenId] = useState<string | null>(null)
  const now = Date.now()
  const rows = useMemo(() => inbox.items.map((m) => ({ ...m, status: effectiveStatus(m.status, m.sendAt, now) as InboxMessage['status'] })), [inbox.items, now])
  const sent = rows.filter((r) => r.status === 'enviada')
  const delivered = sent.reduce((s, r) => s + r.recipients, 0)
  const reads = sent.reduce((s, r) => s + r.reads, 0)
  const scheduled = rows.filter((r) => r.status === 'agendada')
  const expired = rows.filter((r) => r.expiresAt && new Date(r.expiresAt).getTime() < now).length

  const remove = async (m: InboxMessage) => {
    const ok = await confirm({
      title: `Excluir "${m.subject}"?`,
      description: m.status === 'agendada' ? 'A mensagem agendada não será enviada.' : `A mensagem some da inbox de ${num(m.recipients)} jogadores, inclusive de quem ainda não leu.`,
      confirmLabel: 'Excluir mensagem',
      tone: 'danger',
      icon: Trash2,
    })
    if (!ok) return
    inbox.remove(m.id)
    audit('excluir', `Inbox "${m.subject}"`, `Mensagem excluída (${m.audienceLabel}, ${num(m.recipients)} jogadores)`)
    toast.success('Mensagem excluída')
    setOpenId(null)
  }

  const columns: Column<(typeof rows)[number]>[] = [
    {
      id: 'subject',
      header: 'Assunto',
      pinned: true,
      minWidth: 260,
      sortValue: (r) => r.subject,
      cell: (r) => (
        <div className="flex min-w-0 max-w-[360px] items-center gap-2.5">
          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', r.status === 'agendada' ? 'bg-info/10 text-info' : 'bg-primary/10 text-primary-text')} aria-hidden>
            {r.status === 'agendada' ? <CalendarClock size={15} /> : <Mail size={15} />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-fg">{r.subject}</p>
            <p className="truncate text-xs text-fg-3">{r.body}</p>
          </div>
        </div>
      ),
    },
    { id: 'audience', header: 'Público', sortValue: (r) => r.audienceLabel, cell: (r) => <span className="text-[13px] text-fg-2">{r.audienceLabel}</span> },
    { id: 'recipients', header: 'Destinatários', align: 'right', sortValue: (r) => r.recipients, cell: (r) => <span className="font-medium">{num(r.recipients)}</span> },
    {
      id: 'reads',
      header: 'Lidas',
      sortValue: (r) => (r.recipients ? r.reads / r.recipients : 0),
      csv: (r) => r.reads,
      cell: (r) => (r.status === 'enviada' ? <RateBar value={r.reads} total={r.recipients} tone="success" /> : <span className="text-xs text-fg-3">—</span>),
    },
    {
      id: 'sendAt',
      header: 'Data',
      sortValue: (r) => r.sendAt,
      csv: (r) => dateTime(r.sendAt),
      cell: (r) => (
        <div>
          <p className="whitespace-nowrap text-[13px] text-fg-2">{dateTime(r.sendAt)}</p>
          <p className="text-xs text-fg-3">{r.expiresAt ? (new Date(r.expiresAt).getTime() < now ? 'expirou' : `expira ${date(r.expiresAt)}`) : 'não expira'}</p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (r) => r.status,
      csv: (r) => INBOX_STATUS_LABEL[r.status],
      cell: (r) => (
        <Badge tone={r.status === 'agendada' ? 'info' : 'success'} dot>
          {INBOX_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
  ]
  const open = openId ? rows.find((r) => r.id === openId) : undefined

  return (
    <div className="space-y-5">
      <section aria-label="Resumo da inbox" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Mensagens enviadas" icon={Send} value={num(sent.length)} hint={`${num(delivered)} entregas`} />
        <KpiCard label="Taxa de leitura" icon={MailOpen} tone="success" value={pct(delivered ? reads / delivered : 0)} hint={`${num(reads)} abertas`} formula="Mensagens abertas ÷ entregues, em todas as mensagens enviadas." />
        <KpiCard label="Agendadas" icon={CalendarClock} tone="info" value={num(scheduled.length)} hint={scheduled[0] ? `próxima ${dateTime(scheduled[0].sendAt)}` : 'nenhuma na fila'} />
        <KpiCard label="Expiradas" icon={Inbox} tone="neutral" value={num(expired)} hint="já saíram da inbox do jogador" />
      </section>

      <TableFrame>
        <DataTable
          caption="Mensagens da inbox"
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          searchText={(r) => `${r.subject} ${r.body} ${r.audienceLabel}`}
          searchPlaceholder="Buscar por assunto ou texto"
          initialSort={{ id: 'sendAt', dir: 'desc' }}
          exportName="inbox"
          onExport={(n) => audit('exportar', 'Inbox', `Exportação CSV de ${n} mensagens`)}
          onRowClick={(r) => setOpenId(r.id)}
          rowActions={(r) => [
            { label: 'Ver mensagem', icon: Eye, onSelect: () => setOpenId(r.id) },
            { divider: true },
            { label: 'Excluir', icon: Trash2, danger: true, onSelect: () => remove(r), disabled: !canEdit },
          ]}
          empty={{
            title: 'Nenhuma mensagem na inbox',
            description: 'Mensagens da inbox ficam guardadas para o jogador ler quando quiser.',
            icon: Inbox,
            action: (
              <Button variant="primary" icon={Plus} onClick={onCompose} disabled={!canEdit}>
                Nova mensagem
              </Button>
            ),
          }}
        />
      </TableFrame>

      <Drawer
        open={!!open}
        onClose={() => setOpenId(null)}
        title={open?.subject ?? ''}
        description={open ? `${open.status === 'agendada' ? 'Agendada para' : 'Enviada em'} ${dateTime(open.sendAt)} · por ${open.createdBy}` : undefined}
        footer={
          open && (
            <Button icon={Trash2} className="text-danger" onClick={() => remove(open)} disabled={!canEdit}>
              Excluir mensagem
            </Button>
          )
        }
      >
        {open && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-surface-2 px-3 py-2.5">
                <p className="text-xs text-fg-3">Destinatários</p>
                <p className="mt-0.5 font-display text-xl font-bold text-fg tnum">{num(open.recipients)}</p>
              </div>
              <div className="rounded-xl bg-surface-2 px-3 py-2.5">
                <p className="text-xs text-fg-3">Lidas</p>
                <p className="mt-0.5 font-display text-xl font-bold text-fg tnum">{open.status === 'enviada' ? pct(open.recipients ? open.reads / open.recipients : 0, 0) : '—'}</p>
              </div>
            </div>
            <DescriptionList
              items={[
                { label: 'Público', value: open.audienceLabel },
                { label: 'Expira', value: open.expiresAt ? dateTime(open.expiresAt) : 'Não expira' },
              ]}
            />
            <InboxPhone subject={open.subject} body={open.body} when={open.status === 'agendada' ? dateTime(open.sendAt) : relative(open.sendAt)} />
          </div>
        )}
      </Drawer>
    </div>
  )
}

function InboxPhone({ subject, body, when }: { subject: string; body: string; when: string }) {
  return (
    <PhoneFrame title="Caixa de mensagens" subtitle="X2Win" avatar={<MiniMark size={26} />}>
      <div className="space-y-2">
        <div className="rounded-xl border border-primary/30 bg-surface p-3 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-primary-text">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden /> Nova
            </span>
            <span className="text-[10.5px] text-fg-3">{when}</span>
          </div>
          <p className="mt-1 break-words text-[13px] font-semibold leading-5 text-fg">{subject || 'Assunto da mensagem'}</p>
          <p className="mt-1 whitespace-pre-line break-words text-[12px] leading-[18px] text-fg-2">{body || 'O corpo da mensagem aparece aqui quando o jogador abre.'}</p>
        </div>
        {['Termos de uso atualizados', 'Resultado do Torneio de Setembro'].map((t) => (
          <div key={t} className="rounded-xl bg-surface px-3 py-2.5 opacity-70">
            <p className="truncate text-[12px] font-medium text-fg-2">{t}</p>
            <p className="text-[10.5px] text-fg-3">lida</p>
          </div>
        ))}
      </div>
    </PhoneFrame>
  )
}

function InboxComposer({ onClose, onSend }: { onClose: () => void; onSend: (m: InboxMessage) => void }) {
  const { user } = useSession()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<Audience>(DEFAULT_AUDIENCE)
  const [schedule, setSchedule] = useState<Schedule>({ mode: 'agora', at: defaultScheduleAt() })
  const [expires, setExpires] = useState('0')
  const [touched, setTouched] = useState(false)
  const { estimate, levelName } = useAudienceEstimate(audience, 'inbox')
  const errors = {
    subject: !subject.trim() ? (touched ? 'Escreva o assunto.' : null) : subject.length > INBOX_LIMITS.subject ? `Máximo de ${INBOX_LIMITS.subject}.` : null,
    body: !body.trim() ? (touched ? 'Escreva a mensagem.' : null) : body.length > INBOX_LIMITS.body ? `Máximo de ${num(INBOX_LIMITS.body)}.` : null,
    audience: audienceError(audience) ?? (estimate.invalidIds.length ? 'Remova os IDs que não existem.' : null),
    schedule: scheduleError(schedule),
  }

  const send = async () => {
    setTouched(true)
    const first = (!subject.trim() && 'Escreva o assunto.') || (!body.trim() && 'Escreva a mensagem.') || Object.values(errors).find(Boolean)
    if (first) {
      toast.error('Revise a mensagem', { description: first })
      return
    }
    if (!estimate.reachable) {
      toast.error('Ninguém recebe esta mensagem', { description: 'O público não tem jogadores ativos.' })
      return
    }
    const later = schedule.mode === 'agendar'
    const when = scheduleIso(schedule)
    const audienceLabel = describeAudience(audience, levelName)
    const ok = await confirm({
      title: later ? `Agendar para ${num(estimate.reachable)} jogadores?` : `Enviar para ${num(estimate.reachable)} jogadores?`,
      description: later ? `A mensagem entra na inbox em ${dateTime(when)}.` : 'A mensagem entra na inbox de cada jogador agora.',
      confirmLabel: later ? 'Agendar mensagem' : 'Enviar mensagem',
      icon: later ? CalendarClock : Send,
      details: <DescriptionList columns={2} items={[{ label: 'Assunto', value: subject, full: true }, { label: 'Público', value: audienceLabel }, { label: 'Destinatários', value: num(estimate.reachable) }]} />,
    })
    if (!ok) return
    const days = Number(expires)
    const m: InboxMessage = {
      id: uid('ib'),
      subject: subject.trim(),
      body: body.trim(),
      audience,
      audienceLabel,
      recipients: estimate.reachable,
      reads: 0,
      sendAt: when,
      status: later ? 'agendada' : 'enviada',
      createdAt: new Date().toISOString(),
      createdBy: user.name,
      expiresAt: days ? new Date(new Date(when).getTime() + days * DAY).toISOString() : null,
    }
    onSend(m)
    audit('enviar', 'Inbox', `"${m.subject}" ${later ? `agendada para ${dateTime(when)}` : 'enviada'} · ${audienceLabel} · ${num(m.recipients)} jogadores`)
    toast.success(later ? 'Mensagem agendada' : 'Mensagem enviada', { description: `${num(m.recipients)} jogadores na inbox.` })
    onClose()
  }

  return (
    <Drawer
      open
      onClose={onClose}
      width="xl"
      title="Nova mensagem na inbox"
      description="Fica guardada na caixa de mensagens do jogador, no site e no app."
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" icon={schedule.mode === 'agendar' ? CalendarClock : Send} onClick={send}>
            {schedule.mode === 'agendar' ? 'Agendar' : 'Enviar'} para {num(estimate.reachable)}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          <Field label="Assunto" htmlFor="ib-subject" required error={errors.subject} labelAside={<CharCounter value={subject} max={INBOX_LIMITS.subject} />}>
            <Input id="ib-subject" data-autofocus value={subject} onChange={(e) => setSubject(e.target.value)} invalid={!!errors.subject} />
          </Field>
          <Field label="Mensagem" htmlFor="ib-body" required error={errors.body} labelAside={<CharCounter value={body} max={INBOX_LIMITS.body} />}>
            <Textarea id="ib-body" rows={7} value={body} onChange={(e) => setBody(e.target.value)} invalid={!!errors.body} />
          </Field>
          <div>
            <p className="mb-2 text-[13px] font-medium text-fg">Público</p>
            <AudiencePicker value={audience} onChange={setAudience} kinds={['todos', 'depositou', 'inativos', 'vip', 'novos', 'ids']} fixedDays={{ depositou: 7, inativos: 14 }} channel="inbox" idPrefix="ib-aud" narrow error={touched ? errors.audience : null} />
          </div>
          <div>
            <p className="mb-2 text-[13px] font-medium text-fg">Quando enviar</p>
            <ScheduleField value={schedule} onChange={setSchedule} idPrefix="ib-sch" error={errors.schedule} />
          </div>
          <Field label="Expira" htmlFor="ib-exp" hint="Depois disso a mensagem some da inbox." className="max-w-xs">
            <Select
              id="ib-exp"
              value={expires}
              onChange={setExpires}
              options={[
                { value: '0', label: 'Não expira' },
                { value: '7', label: 'Em 7 dias' },
                { value: '14', label: 'Em 14 dias' },
                { value: '30', label: 'Em 30 dias' },
              ]}
            />
          </Field>
        </div>
        <div className="min-w-0 lg:sticky lg:top-0 lg:self-start">
          <p className="mb-2 text-[13px] font-medium text-fg">Prévia</p>
          <InboxPhone subject={subject} body={body} when={schedule.mode === 'agendar' ? 'agendada' : 'agora'} />
          <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-3">
            <Mail size={13} aria-hidden /> Não precisa de consentimento de marketing.
          </p>
        </div>
      </div>
    </Drawer>
  )
}
