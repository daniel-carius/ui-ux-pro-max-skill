import { useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgePercent,
  Bell,
  CalendarRange,
  CircleDollarSign,
  CirclePause,
  CirclePlay,
  CircleStop,
  Copy,
  Crown,
  Eye,
  Gift,
  Hourglass,
  LayoutGrid,
  List,
  Mail,
  Megaphone,
  MessageSquare,
  MonitorSmartphone,
  MoreHorizontal,
  Pencil,
  PanelTop,
  Plus,
  Rocket,
  Save,
  Search,
  Sparkles,
  Target,
  TicketPercent,
  Trash2,
  TrendingUp,
  Trophy,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'
import { BarsChart } from '@/components/charts'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ChipFilter,
  DataTable,
  DescriptionList,
  Drawer,
  EmptyState,
  Field,
  FormFieldset,
  FormGrid,
  IconButton,
  Input,
  KpiCard,
  Menu,
  MoneyInput,
  NumberInput,
  PageHeader,
  Progress,
  RadioCards,
  Segmented,
  Select,
  Switch,
  Textarea,
  confirm,
  normalize,
  toast,
  type Column,
  type MenuEntry,
  type Tone,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { brl, brlCompact, date, dateShort, dateTime, mult, num, pct, plural, relative } from '@/lib/format'
import { uid } from '@/lib/random'
import { useCollection, useDb } from '@/lib/store'
import { useGames, useProviders } from '@/data/hooks'
import { PROMO_KEY, promoDailySeries, seedPromos } from '@/data/campanhas-promocoes'
import { audit, usePageAccess, useSession } from '@/domain/session'
import {
  AUDIENCE_LABEL,
  CASHBACK_PERIOD_LABEL,
  CHANNEL_LABEL,
  GOAL_LABEL,
  PROMO_STATUS_LABEL,
  PROMO_STEPS,
  PROMO_TYPE_DESCRIPTION,
  PROMO_TYPE_LABEL,
  SCORING_LABEL,
  audienceDescription,
  audienceMatches,
  emptyPromo,
  firstInvalidStep,
  maxCostPerPlayer,
  periodLabel,
  promoRewardSummary,
  promoStatus,
  suggestedHeadline,
  validatePromoStep,
  type CashbackPeriod,
  type MissionGoal,
  type Promo,
  type PromoAccent,
  type PromoAudienceKind,
  type PromoChannel,
  type PromoRules,
  type PromoStatus,
  type PromoType,
  type TournamentScoring,
} from '@/domain/campanhas-promocoes'
import { useCampaignPlayers } from '@/domain/campanhas-jogadores'
import { BlockTitle, CalcLine, GamePicker, MiniStat, StepIndicator, fromDateInput, toDateInput } from './_shared-c1'

type Draft = Omit<Promo, 'id' | 'createdAt' | 'createdBy' | 'updatedAt'>
type Row = Promo & { status: PromoStatus }

const STATUS_TONE: Record<PromoStatus, Tone> = {
  rascunho: 'neutral',
  agendada: 'info',
  ativa: 'success',
  pausada: 'warning',
  encerrada: 'neutral',
}

const TYPE_ICON: Record<PromoType, LucideIcon> = {
  bonus_deposito: Gift,
  free_spins: Sparkles,
  cashback: BadgePercent,
  cupom: TicketPercent,
  torneio: Trophy,
  missao: Target,
}

const AUDIENCE_ICON: Record<PromoAudienceKind, LucideIcon> = {
  todos: Users,
  novos: UserPlus,
  depositantes: Wallet,
  vip: Crown,
  inativos: Hourglass,
  nivel: TrendingUp,
}

const CHANNEL_ICON: Record<PromoChannel, LucideIcon> = {
  banner: PanelTop,
  popup: MonitorSmartphone,
  notificacao: Bell,
  email: Mail,
  sms: MessageSquare,
}

const ACCENT: Record<PromoAccent, { label: string; bg: string; chip: string; glow: string; swatch: string }> = {
  roxo: { label: 'Roxo', bg: 'from-primary/20', chip: 'bg-primary/15 text-primary-text', glow: 'bg-primary/25', swatch: 'bg-primary' },
  verde: { label: 'Verde', bg: 'from-success/20', chip: 'bg-success/15 text-success', glow: 'bg-success/25', swatch: 'bg-success' },
  ouro: { label: 'Ouro', bg: 'from-gold/25', chip: 'bg-gold/15 text-warning dark:text-gold', glow: 'bg-gold/30', swatch: 'bg-gold' },
  azul: { label: 'Azul', bg: 'from-info/20', chip: 'bg-info/15 text-info', glow: 'bg-info/25', swatch: 'bg-info' },
}

type StatusFilter = 'todas' | PromoStatus

export default function Promocoes() {
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  const promos = useCollection<Promo>(PROMO_KEY, seedPromos)
  const { items: games } = useGames()
  const [view, setView] = useDb<'cards' | 'tabela'>('campanhas.promocoes.visao', 'cards')
  const [filter, setFilter] = useState<StatusFilter>('todas')
  const [typeFilter, setTypeFilter] = useState<'todos' | PromoType>('todos')
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<{ key: string; id: string | null; draft: Draft } | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  const now = new Date()
  const rows: Row[] = useMemo(() => promos.items.map((p) => ({ ...p, status: promoStatus(p) })), [promos.items])
  const gameName = (id: string | null) => games.find((g) => g.id === id)?.name

  const counts = useMemo(() => {
    const c: Record<string, number> = { todas: rows.length }
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [rows])

  const visible = useMemo(() => {
    const q = normalize(query.trim())
    return rows
      .filter((r) => filter === 'todas' || r.status === filter)
      .filter((r) => typeFilter === 'todos' || r.type === typeFilter)
      .filter((r) => !q || normalize(`${r.name} ${PROMO_TYPE_LABEL[r.type]} ${r.rules.couponCode} ${r.comms.headline}`).includes(q))
  }, [rows, filter, typeFilter, query])

  const active = rows.filter((r) => r.status === 'ativa')
  const live = rows.filter((r) => r.status !== 'rascunho')
  const totalCost = live.reduce((s, r) => s + r.cost, 0)
  const totalParticipants = live.reduce((s, r) => s + r.participants, 0)
  const activeParticipants = active.reduce((s, r) => s + r.participants, 0)
  const nearBudget = rows.filter((r) => (r.status === 'ativa' || r.status === 'pausada') && r.budget > 0 && r.cost / r.budget >= 0.8)

  const lockedTitle = !canEdit ? 'Seu cargo pode ver, mas não editar promoções' : undefined

  // ---------- ações ----------
  const openNew = () => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    setEditor({ key: uid('ed'), id: null, draft: emptyPromo(start.toISOString()) })
  }
  const openEdit = (p: Promo) => {
    setDetailId(null)
    setEditor({ key: uid('ed'), id: p.id, draft: toDraft(p) })
  }

  const togglePause = async (p: Row) => {
    if (p.status === 'pausada') {
      promos.update(p.id, { paused: false, updatedAt: new Date().toISOString() })
      audit('ligar', `Promoção ${p.name}`, 'Promoção retomada')
      toast.success('Promoção retomada', { description: promoStatus({ ...p, paused: false }) === 'agendada' ? `Começa em ${date(p.startAt)}.` : 'Ela voltou a aparecer no site.' })
      return
    }
    const ok = await confirm({
      title: `Pausar "${p.name}"?`,
      description: 'A promoção sai do site na hora e ninguém novo entra. Quem já participa mantém o que ganhou.',
      confirmLabel: 'Pausar promoção',
      tone: 'warning',
      icon: CirclePause,
    })
    if (!ok) return
    promos.update(p.id, { paused: true, updatedAt: new Date().toISOString() })
    audit('desligar', `Promoção ${p.name}`, 'Promoção pausada')
    toast.success('Promoção pausada')
  }

  const endNow = async (p: Row) => {
    const ok = await confirm({
      title: `Encerrar "${p.name}" agora?`,
      description: 'O término passa a ser hoje. A promoção não pode ser retomada depois; para repetir, duplique.',
      confirmLabel: 'Encerrar agora',
      tone: 'danger',
      icon: CircleStop,
    })
    if (!ok) return
    promos.update(p.id, { endAt: new Date(Date.now() - 1000).toISOString(), paused: false, updatedAt: new Date().toISOString() })
    audit('desligar', `Promoção ${p.name}`, 'Promoção encerrada antes do prazo')
    toast.success('Promoção encerrada')
  }

  const duplicate = (p: Row) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const copy: Promo = {
      ...structuredClone(p),
      id: uid('pr'),
      name: `${p.name} (cópia)`,
      draft: true,
      paused: false,
      participants: 0,
      cost: 0,
      startAt: new Date(Math.max(today.getTime(), new Date(p.startAt).getTime())).toISOString(),
      endAt: null,
      rules: { ...p.rules, couponCode: p.type === 'cupom' ? `${p.rules.couponCode.slice(0, 12)}2` : p.rules.couponCode },
      createdAt: new Date().toISOString(),
      createdBy: user.name,
      updatedAt: new Date().toISOString(),
    }
    delete (copy as Partial<Row>).status
    promos.add(copy)
    audit('criar', `Promoção ${copy.name}`, `Duplicada de "${p.name}" como rascunho`)
    toast.success('Promoção duplicada como rascunho', { action: { label: 'Editar cópia', onClick: () => openEdit(copy) } })
  }

  const remove = async (p: Row) => {
    const ok = await confirm({
      title: `Excluir "${p.name}"?`,
      description:
        p.status === 'ativa'
          ? 'A promoção está ativa: ela some do site na hora. O histórico de quem participou continua nos relatórios.'
          : 'A promoção sai da lista. O histórico de quem participou continua nos relatórios.',
      confirmLabel: 'Excluir promoção',
      tone: 'danger',
      icon: Trash2,
      typeToConfirm: p.status === 'ativa' ? 'EXCLUIR' : undefined,
    })
    if (!ok) return
    promos.remove(p.id)
    setDetailId(null)
    audit('excluir', `Promoção ${p.name}`, `Promoção excluída (status: ${PROMO_STATUS_LABEL[p.status]})`)
    toast.success('Promoção excluída')
  }

  const save = async (d: Draft, id: string | null, mode: 'rascunho' | 'publicar' | 'salvar') => {
    const nowIso = new Date().toISOString()
    const willBe = promoStatus({ ...d, draft: mode === 'rascunho' ? true : mode === 'publicar' ? false : d.draft })
    if (mode === 'publicar') {
      const scheduled = willBe === 'agendada'
      const ok = await confirm({
        title: scheduled ? 'Agendar promoção?' : 'Publicar promoção agora?',
        description: scheduled ? `Ela entra no site em ${date(d.startAt)}, sem precisar de nova ação.` : 'Ela aparece no site na hora para o público escolhido.',
        confirmLabel: scheduled ? 'Agendar' : 'Publicar agora',
        tone: 'primary',
        icon: Rocket,
        details: (
          <DescriptionList
            columns={2}
            items={[
              { label: 'Tipo', value: PROMO_TYPE_LABEL[d.type] },
              { label: 'Público', value: audienceDescription(d.audience) },
              { label: 'Recompensa', value: promoRewardSummary(d, gameName(d.rules.gameId)), full: true },
              { label: 'Período', value: periodLabel(d), full: true },
            ]}
          />
        ),
      })
      if (!ok) return false
    } else if (mode === 'salvar' && willBe === 'ativa') {
      const ok = await confirm({
        title: 'Salvar mudanças numa promoção ativa?',
        description: 'As novas regras valem na hora para quem entrar a partir de agora. Quem já participa mantém as regras de quando entrou.',
        confirmLabel: 'Salvar alterações',
        tone: 'warning',
      })
      if (!ok) return false
    }
    const next: Draft = { ...d, draft: mode === 'rascunho' ? true : mode === 'publicar' ? false : d.draft, name: d.name.trim(), rules: { ...d.rules, couponCode: d.rules.couponCode.trim().toUpperCase() } }
    if (id) {
      promos.update(id, { ...next, updatedAt: nowIso })
      audit('editar', `Promoção ${next.name}`, mode === 'publicar' ? `Publicada (${PROMO_STATUS_LABEL[willBe].toLowerCase()})` : mode === 'rascunho' ? 'Rascunho atualizado' : 'Regras e comunicação atualizadas')
    } else {
      promos.add({ ...next, id: uid('pr'), createdAt: nowIso, createdBy: user.name, updatedAt: nowIso })
      audit('criar', `Promoção ${next.name}`, mode === 'publicar' ? `Criada e ${willBe === 'agendada' ? 'agendada' : 'publicada'} (${PROMO_TYPE_LABEL[next.type]})` : `Criada como rascunho (${PROMO_TYPE_LABEL[next.type]})`)
    }
    toast.success(mode === 'rascunho' ? 'Rascunho salvo' : mode === 'publicar' ? (willBe === 'agendada' ? 'Promoção agendada' : 'Promoção publicada') : 'Promoção atualizada', {
      description: mode === 'rascunho' ? 'Nada aparece no site até você publicar.' : 'A mudança foi registrada na auditoria.',
    })
    setEditor(null)
    return true
  }

  const actionsFor = (p: Row): MenuEntry[] => [
    { label: 'Ver detalhes', icon: Eye, onSelect: () => setDetailId(p.id) },
    { label: 'Editar', icon: Pencil, onSelect: () => openEdit(p), disabled: !canEdit || p.status === 'encerrada' },
    p.status === 'pausada'
      ? { label: 'Retomar', icon: CirclePlay, onSelect: () => togglePause(p), disabled: !canEdit }
      : { label: 'Pausar', icon: CirclePause, onSelect: () => togglePause(p), disabled: !canEdit || !['ativa', 'agendada'].includes(p.status) },
    { label: 'Duplicar', icon: Copy, onSelect: () => duplicate(p), disabled: !canEdit },
    { label: 'Encerrar agora', icon: CircleStop, onSelect: () => endNow(p), disabled: !canEdit || !['ativa', 'pausada'].includes(p.status) },
    { divider: true },
    { label: 'Excluir', icon: Trash2, danger: true, onSelect: () => remove(p), disabled: !canEdit },
  ]

  const columns: Column<Row>[] = [
    {
      id: 'name',
      header: 'Promoção',
      pinned: true,
      minWidth: 280,
      sortValue: (r) => r.name,
      csv: (r) => r.name,
      cell: (r) => {
        const Icon = TYPE_ICON[r.type]
        return (
          <div className="flex min-w-0 items-center gap-3">
            <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', ACCENT[r.comms.accent].chip)}>
              <Icon size={17} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium text-fg">{r.name}</p>
              <p className="truncate text-xs text-fg-3">{promoRewardSummary(r, gameName(r.rules.gameId))}</p>
            </div>
          </div>
        )
      },
    },
    { id: 'type', header: 'Tipo', sortValue: (r) => PROMO_TYPE_LABEL[r.type], cell: (r) => <Badge>{PROMO_TYPE_LABEL[r.type]}</Badge> },
    { id: 'audience', header: 'Público', sortValue: (r) => audienceDescription(r.audience), cell: (r) => <span className="text-[13px] text-fg-2">{audienceDescription(r.audience)}</span> },
    {
      id: 'period',
      header: 'Período',
      sortValue: (r) => r.startAt,
      csv: (r) => periodLabel(r),
      cell: (r) => (
        <div className="text-[13px]">
          <p className="text-fg-2 tnum">{r.endAt ? `${dateShort(r.startAt)} – ${dateShort(r.endAt)}` : `desde ${dateShort(r.startAt)}`}</p>
          <p className="text-xs text-fg-3">{r.endAt ? daysLeftLabel(r, now) : 'sem término'}</p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (r) => r.status,
      csv: (r) => PROMO_STATUS_LABEL[r.status],
      cell: (r) => (
        <Badge tone={STATUS_TONE[r.status]} dot>
          {PROMO_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    { id: 'participants', header: 'Participantes', align: 'right', sortValue: (r) => r.participants, cell: (r) => num(r.participants) },
    {
      id: 'cost', money: true,
      header: 'Custo',
      align: 'right',
      minWidth: 140,
      sortValue: (r) => r.cost,
      csv: (r) => r.cost,
      cell: (r) => (
        <div className="ml-auto w-32">
          <p className="font-medium text-fg">{brl(r.cost)}</p>
          {r.budget > 0 ? (
            <Progress value={r.cost} max={r.budget} tone={r.cost / r.budget >= 0.9 ? 'danger' : r.cost / r.budget >= 0.8 ? 'warning' : 'primary'} className="mt-1" label={`Orçamento usado: ${pct(r.cost / r.budget, 0)}`} />
          ) : (
            <p className="text-[11px] text-fg-3">sem orçamento</p>
          )}
        </div>
      ),
    },
    { id: 'budget', money: true, header: 'Orçamento', align: 'right', defaultHidden: true, sortValue: (r) => r.budget, cell: (r) => (r.budget ? brl(r.budget) : '—') },
    { id: 'createdBy', header: 'Criada por', defaultHidden: true, sortValue: (r) => r.createdBy, cell: (r) => <span className="text-[13px] text-fg-2">{r.createdBy}</span> },
  ]

  const detail = detailId ? rows.find((r) => r.id === detailId) : undefined

  return (
    <>
      <PageHeader
        actions={
          <>
            <Segmented
              ariaLabel="Modo de visualização"
              value={view}
              onChange={setView}
              options={[
                { value: 'cards', label: <span className="hidden sm:inline">Cartões</span>, icon: LayoutGrid },
                { value: 'tabela', label: <span className="hidden sm:inline">Tabela</span>, icon: List },
              ]}
            />
            <Button variant="primary" icon={Plus} onClick={openNew} disabled={!canEdit} title={lockedTitle}>
              Nova promoção
            </Button>
          </>
        }
      />

      <section aria-label="Resumo das promoções" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Ativas agora"
          icon={Megaphone}
          tone="success"
          value={num(active.length)}
          hint={`${plural(counts.agendada ?? 0, 'agendada', 'agendadas')} · ${plural(counts.pausada ?? 0, 'pausada', 'pausadas')}`}
          onClick={() => setFilter(filter === 'ativa' ? 'todas' : 'ativa')}
          active={filter === 'ativa'}
        />
        <KpiCard
          label="Participantes"
          icon={Users}
          tone="info"
          value={num(totalParticipants)}
          hint={`${num(activeParticipants)} em promoções ativas`}
          formula={<>Jogadores que entraram em cada promoção (um jogador em duas promoções conta duas vezes). Rascunhos não entram.</>}
        />
        <KpiCard
          label="Custo acumulado"
          icon={CircleDollarSign}
          tone="warning"
          value={brlCompact(totalCost)}
          hint={`${brl(totalParticipants ? totalCost / totalParticipants : 0)} por participante`}
          formula={<>Soma do bônus, giros e prêmios já entregues. Bônus que expirou sem rollover não entra.</>}
        />
        <KpiCard
          label="Perto do orçamento"
          icon={AlertTriangle}
          tone={nearBudget.length ? 'danger' : 'neutral'}
          value={num(nearBudget.length)}
          hint={nearBudget.length ? 'com 80% ou mais do orçamento usado' : 'nenhuma passou de 80%'}
          formula={<>Promoções ativas ou pausadas cujo custo já passou de 80% do orçamento definido.</>}
        />
      </section>

      {nearBudget.length > 0 && (
        <Alert
          tone="warning"
          className="mb-5"
          title={nearBudget.length === 1 ? `"${nearBudget[0].name}" já usou ${pct(nearBudget[0].cost / nearBudget[0].budget, 0)} do orçamento` : `${nearBudget.length} promoções passaram de 80% do orçamento`}
          action={
            <Button size="sm" onClick={() => setDetailId(nearBudget[0].id)}>
              Ver promoção
            </Button>
          }
        >
          Revise o orçamento ou pause antes que o custo passe do previsto.
        </Alert>
      )}

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative w-full lg:w-72">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar promoção ou cupom"
            aria-label="Buscar promoção ou cupom"
            className="input-base h-9 pl-9"
          />
        </div>
        <ChipFilter<StatusFilter>
          value={filter}
          onChange={setFilter}
          className="min-w-0 flex-1"
          options={[
            { value: 'todas', label: 'Todas', count: counts.todas ?? 0 },
            { value: 'ativa', label: 'Ativas', count: counts.ativa ?? 0 },
            { value: 'agendada', label: 'Agendadas', count: counts.agendada ?? 0 },
            { value: 'pausada', label: 'Pausadas', count: counts.pausada ?? 0, tone: 'warning' },
            { value: 'rascunho', label: 'Rascunhos', count: counts.rascunho ?? 0 },
            { value: 'encerrada', label: 'Encerradas', count: counts.encerrada ?? 0 },
          ]}
        />
        <Select
          aria-label="Filtrar por tipo"
          className="w-full lg:w-52"
          value={typeFilter}
          onChange={(v) => setTypeFilter(v as 'todos' | PromoType)}
          options={[{ value: 'todos', label: 'Todos os tipos' }, ...(Object.keys(PROMO_TYPE_LABEL) as PromoType[]).map((t) => ({ value: t, label: PROMO_TYPE_LABEL[t] }))]}
        />
      </div>

      {view === 'cards' ? (
        visible.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((p) => (
              <PromoCard
                key={p.id}
                p={p}
                gameName={gameName(p.rules.gameId)}
                now={now}
                canEdit={canEdit}
                onOpen={() => setDetailId(p.id)}
                onEdit={() => openEdit(p)}
                onTogglePause={() => togglePause(p)}
                actions={actionsFor(p)}
              />
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              icon={query ? Search : Megaphone}
              title={query || filter !== 'todas' || typeFilter !== 'todos' ? 'Nenhuma promoção neste filtro' : 'Nenhuma promoção criada'}
              description={query || filter !== 'todas' || typeFilter !== 'todos' ? 'Troque o status, o tipo ou a busca para ver outras promoções.' : 'Crie a primeira promoção para aparecer no site.'}
              action={
                query || filter !== 'todas' || typeFilter !== 'todos' ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setQuery('')
                      setFilter('todas')
                      setTypeFilter('todos')
                    }}
                  >
                    Limpar filtros
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" icon={Plus} onClick={openNew} disabled={!canEdit}>
                    Nova promoção
                  </Button>
                )
              }
              className="py-16"
            />
          </Card>
        )
      ) : (
        <DataTable
          className="relative"
          caption="Promoções"
          rows={visible}
          columns={columns}
          rowKey={(r) => r.id}
          initialSort={{ id: 'period', dir: 'desc' }}
          exportName="promocoes"
          onExport={(n) => audit('exportar', 'Promoções', `Exportação CSV de ${n} promoções`)}
          onRowClick={(r) => setDetailId(r.id)}
          rowActions={actionsFor}
          resetKey={`${filter}-${typeFilter}-${query}`}
          empty={{ title: 'Nenhuma promoção neste filtro', description: 'Troque o status, o tipo ou a busca para ver outras promoções.', icon: Megaphone }}
        />
      )}

      {detail && (
        <PromoDetail
          p={detail}
          gameName={gameName(detail.rules.gameId)}
          canEdit={canEdit}
          onClose={() => setDetailId(null)}
          onEdit={() => openEdit(detail)}
          onTogglePause={() => togglePause(detail)}
          onDuplicate={() => duplicate(detail)}
          onRemove={() => remove(detail)}
        />
      )}

      {editor && (
        <PromoEditor
          key={editor.key}
          id={editor.id}
          initial={editor.draft}
          others={promos.items}
          canEdit={canEdit}
          onClose={() => setEditor(null)}
          onSave={(d, mode) => save(d, editor.id, mode)}
        />
      )}
    </>
  )
}

/** Tira os campos de controle (id, autoria, status derivado) para editar. */
function toDraft(p: Promo): Draft {
  const c = structuredClone(p) as Partial<Row>
  delete c.id
  delete c.createdAt
  delete c.createdBy
  delete c.updatedAt
  delete c.status
  return c as Draft
}

function daysLeftLabel(p: Pick<Promo, 'startAt' | 'endAt'>, now: Date) {
  const start = new Date(p.startAt).getTime()
  if (start > now.getTime()) {
    const d = Math.ceil((start - now.getTime()) / 86_400_000)
    return d === 1 ? 'começa amanhã' : `começa em ${d} dias`
  }
  if (!p.endAt) return 'sem término'
  const end = new Date(p.endAt).getTime()
  if (end < now.getTime()) return `terminou ${relative(p.endAt)}`
  const d = Math.ceil((end - now.getTime()) / 86_400_000)
  return d <= 1 ? 'termina hoje' : `faltam ${d} dias`
}

// ---------- Cartão ----------

function PromoCard({
  p,
  gameName,
  now,
  canEdit,
  onOpen,
  onEdit,
  onTogglePause,
  actions,
}: {
  p: Row
  gameName?: string
  now: Date
  canEdit: boolean
  onOpen: () => void
  onEdit: () => void
  onTogglePause: () => void
  actions: MenuEntry[]
}) {
  const Icon = TYPE_ICON[p.type]
  const A = ACCENT[p.comms.accent]
  const use = p.budget > 0 ? p.cost / p.budget : null
  return (
    <article className="card flex min-w-0 flex-col overflow-hidden">
      <button type="button" onClick={onOpen} className="group text-left" aria-label={`Ver detalhes de ${p.name}`}>
        <div className={cn('relative flex h-[104px] items-end overflow-hidden bg-gradient-to-br to-transparent p-4', A.bg)}>
          <span className={cn('pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full blur-2xl', A.glow)} aria-hidden />
          <Icon size={72} className="pointer-events-none absolute -bottom-3 right-3 text-fg opacity-[0.06]" aria-hidden />
          <span className="absolute right-3 top-3">
            <Badge tone={STATUS_TONE[p.status]} dot>
              {PROMO_STATUS_LABEL[p.status]}
            </Badge>
          </span>
          <div className="relative flex min-w-0 items-center gap-3">
            <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', A.chip)}>
              <Icon size={20} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">{PROMO_TYPE_LABEL[p.type]}</p>
              <p className="truncate font-display text-[15px] font-bold text-fg group-hover:underline">{p.comms.headline || suggestedHeadline(p)}</p>
            </div>
          </div>
        </div>
      </button>
      <div className="flex flex-1 flex-col p-4 pt-3.5">
        <h3 className="truncate text-sm font-semibold text-fg" title={p.name}>
          {p.name}
        </h3>
        <p className="mt-0.5 truncate text-[13px] text-fg-2">{promoRewardSummary(p, gameName)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-3">
          <span className="inline-flex items-center gap-1">
            <CalendarRange size={13} aria-hidden />
            {p.endAt ? `${dateShort(p.startAt)} – ${dateShort(p.endAt)}` : `desde ${dateShort(p.startAt)}`} · {daysLeftLabel(p, now)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users size={13} aria-hidden />
            {audienceDescription(p.audience)}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MiniStat label="Participantes" value={num(p.participants)} />
          <MiniStat label="Custo" value={brlCompact(p.cost)} sub={p.participants ? `${brl(p.cost / p.participants)} cada` : undefined} />
        </div>
        {use !== null && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-fg-3">Orçamento {brlCompact(p.budget)}</span>
              <span className={cn('font-semibold tnum', use >= 0.9 ? 'text-danger' : use >= 0.8 ? 'text-warning' : 'text-fg-2')}>{pct(use, 0)} usado</span>
            </div>
            <Progress value={p.cost} max={p.budget} tone={use >= 0.9 ? 'danger' : use >= 0.8 ? 'warning' : 'primary'} label={`Orçamento usado de ${p.name}`} />
          </div>
        )}
        <div className="mt-auto flex items-center gap-2 pt-4">
          <Button size="sm" icon={Pencil} onClick={onEdit} disabled={!canEdit || p.status === 'encerrada'} title={!canEdit ? 'Seu cargo não edita promoções' : p.status === 'encerrada' ? 'Promoção encerrada: duplique para repetir' : undefined}>
            Editar
          </Button>
          {(p.status === 'ativa' || p.status === 'agendada' || p.status === 'pausada') && (
            <Button size="sm" variant="ghost" icon={p.status === 'pausada' ? CirclePlay : CirclePause} onClick={onTogglePause} disabled={!canEdit}>
              {p.status === 'pausada' ? 'Retomar' : 'Pausar'}
            </Button>
          )}
          <span className="ml-auto">
            <Menu items={actions} trigger={(tp) => <IconButton {...tp} icon={MoreHorizontal} label={`Mais ações de ${p.name}`} size="sm" />} />
          </span>
        </div>
      </div>
    </article>
  )
}

// ---------- Prévia no site ----------

function PromoPreview({ d, gameName, compact }: { d: Draft; gameName?: string; compact?: boolean }) {
  const Icon = TYPE_ICON[d.type]
  const A = ACCENT[d.comms.accent]
  const headline = d.comms.headline.trim() || suggestedHeadline(d)
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card" aria-label="Prévia da promoção no site">
      <div className="flex items-center gap-1.5 border-b border-line bg-surface-2 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-danger/50" aria-hidden />
        <span className="h-2 w-2 rounded-full bg-warning/50" aria-hidden />
        <span className="h-2 w-2 rounded-full bg-success/50" aria-hidden />
        <span className="ml-2 truncate font-mono text-[11px] text-fg-3">x2win.bet.br/promocoes</span>
      </div>
      <div className={cn('relative overflow-hidden bg-gradient-to-br to-transparent', A.bg, compact ? 'p-4' : 'p-5')}>
        <span className={cn('pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full blur-3xl', A.glow)} aria-hidden />
        <div className="relative">
          <div className="flex items-center justify-between gap-2">
            <span className={cn('flex h-11 w-11 items-center justify-center rounded-xl', A.chip)}>
              <Icon size={22} aria-hidden />
            </span>
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', A.chip)}>{PROMO_TYPE_LABEL[d.type]}</span>
          </div>
          <p className="mt-3 break-words font-display text-xl font-extrabold leading-7 text-fg">{headline}</p>
          {d.comms.subtitle && <p className="mt-1 break-words text-[13px] leading-5 text-fg-2">{d.comms.subtitle}</p>}
          <p className={cn('mt-3 inline-flex max-w-full rounded-lg px-2.5 py-1 text-xs font-semibold', A.chip)}>
            <span className="truncate">{promoRewardSummary(d, gameName)}</span>
          </p>
          <div aria-hidden className="mt-4 flex h-10 w-full items-center justify-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-fg shadow-sm">
            <span className="truncate">{d.comms.cta.trim() || 'Quero participar'}</span>
          </div>
          <p className="mt-2.5 text-center text-[11px] text-fg-3">
            {d.endAt ? `Válida até ${date(d.endAt)}` : `A partir de ${date(d.startAt)}`} · Termos e condições
          </p>
        </div>
      </div>
    </div>
  )
}

// ---------- Detalhe ----------

function PromoDetail({
  p,
  gameName,
  canEdit,
  onClose,
  onEdit,
  onTogglePause,
  onDuplicate,
  onRemove,
}: {
  p: Row
  gameName?: string
  canEdit: boolean
  onClose: () => void
  onEdit: () => void
  onTogglePause: () => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const series = useMemo(() => promoDailySeries(p).map((s) => ({ day: s.day, participantes: s.value })), [p])
  const perPlayer = maxCostPerPlayer(p)
  const use = p.budget > 0 ? p.cost / p.budget : null
  return (
    <Drawer
      open
      onClose={onClose}
      width="xl"
      title={p.name}
      description={`${PROMO_TYPE_LABEL[p.type]} · criada por ${p.createdBy} em ${date(p.createdAt)}`}
      headerExtra={
        <Badge tone={STATUS_TONE[p.status]} dot size="md">
          {PROMO_STATUS_LABEL[p.status]}
        </Badge>
      }
      footer={
        <>
          <Button variant="ghost" icon={Trash2} className="mr-auto text-danger" onClick={onRemove} disabled={!canEdit}>
            Excluir
          </Button>
          <Button icon={Copy} onClick={onDuplicate} disabled={!canEdit}>
            Duplicar
          </Button>
          {(p.status === 'ativa' || p.status === 'agendada' || p.status === 'pausada') && (
            <Button icon={p.status === 'pausada' ? CirclePlay : CirclePause} onClick={onTogglePause} disabled={!canEdit}>
              {p.status === 'pausada' ? 'Retomar' : 'Pausar'}
            </Button>
          )}
          <Button variant="primary" icon={Pencil} onClick={onEdit} disabled={!canEdit || p.status === 'encerrada'} title={p.status === 'encerrada' ? 'Promoção encerrada: duplique para repetir' : undefined}>
            Editar
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-6">
          <div className="grid grid-cols-2 gap-2.5">
            <MiniStat label="Participantes" value={num(p.participants)} />
            <MiniStat label="Custo" value={brlCompact(p.cost)} />
            <MiniStat label="Por participante" value={p.participants ? brl(p.cost / p.participants) : '—'} />
            <MiniStat label="Orçamento" value={p.budget ? brlCompact(p.budget) : 'Sem limite'} sub={use !== null ? `${pct(use, 0)} usado` : undefined} />
          </div>
          {use !== null && <Progress value={p.cost} max={p.budget} tone={use >= 0.9 ? 'danger' : use >= 0.8 ? 'warning' : 'primary'} label="Orçamento usado" />}

          <section>
            <BlockTitle icon={Users}>Participações nos últimos 14 dias</BlockTitle>
            {series.some((s) => s.participantes > 0) ? (
              <BarsChart ariaLabel="Participações por dia" data={series} xKey="day" xFormat={(v) => dateShort(v)} height={170} series={[{ key: 'participantes', label: 'Participações', slot: 1 }]} />
            ) : (
              <p className="rounded-xl bg-surface-2 px-4 py-6 text-center text-[13px] text-fg-3">{p.status === 'rascunho' || p.status === 'agendada' ? 'A promoção ainda não começou.' : 'Sem participações nos últimos 14 dias.'}</p>
            )}
          </section>

          <section>
            <BlockTitle icon={Target}>Regras</BlockTitle>
            <DescriptionList
              items={[
                { label: 'Recompensa', value: promoRewardSummary(p, gameName), full: true },
                ...ruleItems(p, gameName),
                { label: 'Custo máximo por jogador', value: perPlayer === null ? 'Depende do resultado' : brl(perPlayer) },
                { label: 'Participações por jogador', value: num(p.rules.maxPerPlayer) },
              ]}
            />
          </section>

          <section>
            <BlockTitle icon={Users}>Público e período</BlockTitle>
            <DescriptionList
              items={[
                { label: 'Público', value: audienceDescription(p.audience) },
                { label: 'Bônus abuser', value: p.audience.excludeAbusers ? 'Excluídos' : 'Incluídos' },
                { label: 'Período', value: periodLabel(p), full: true },
                { label: 'Canais', value: p.comms.channels.map((c) => CHANNEL_LABEL[c]).join(', '), full: true },
                ...(p.description ? [{ label: 'Descrição interna', value: p.description, full: true }] : []),
                { label: 'Última alteração', value: `${dateTime(p.updatedAt)} · ${relative(p.updatedAt)}` },
              ]}
            />
          </section>
        </div>
        <aside className="space-y-2 lg:sticky lg:top-0 lg:self-start">
          <p className="text-xs font-medium text-fg-3">Como aparece no site</p>
          <PromoPreview d={p} gameName={gameName} compact />
        </aside>
      </div>
    </Drawer>
  )
}

function ruleItems(p: Pick<Promo, 'type' | 'rules'>, gameName?: string): { label: string; value: string; full?: boolean }[] {
  const r = p.rules
  switch (p.type) {
    case 'bonus_deposito':
      return [
        { label: 'Bônus', value: `${num(r.pct)}% do depósito` },
        { label: 'Depósito mínimo', value: brl(r.minDeposit) },
        { label: 'Teto do bônus', value: brl(r.maxReward) },
        { label: 'Rollover', value: mult(r.rollover) },
      ]
    case 'free_spins':
      return [
        { label: 'Jogo', value: gameName ?? '—' },
        { label: 'Giros', value: `${num(r.spins)} × ${brl(r.spinValue)}` },
        { label: 'Depósito mínimo', value: brl(r.minDeposit) },
        { label: 'Rollover dos ganhos', value: mult(r.rollover) },
      ]
    case 'cashback':
      return [
        { label: 'Cashback', value: `${num(r.pct)}% da perda` },
        { label: 'Período', value: CASHBACK_PERIOD_LABEL[r.cashbackPeriod] },
        { label: 'Teto por jogador', value: r.maxReward ? brl(r.maxReward) : 'Sem teto' },
        { label: 'Rollover', value: mult(r.rollover) },
      ]
    case 'cupom':
      return [
        { label: 'Código', value: r.couponCode },
        { label: 'Valor', value: brl(r.couponValue) },
        { label: 'Resgates totais', value: r.maxRedemptions ? num(r.maxRedemptions) : 'Sem limite' },
        { label: 'Rollover', value: mult(r.rollover) },
      ]
    case 'torneio':
      return [
        { label: 'Premiação', value: brl(r.prizePool) },
        { label: 'Pontuação', value: SCORING_LABEL[r.scoring] },
        { label: 'Jogo', value: gameName ?? 'Todos os slots' },
        { label: 'Aposta mínima', value: brl(r.minBet) },
      ]
    case 'missao':
      return [
        { label: 'Objetivo', value: GOAL_LABEL[r.goal] },
        { label: 'Meta', value: r.goal === 'apostar' ? brl(r.goalTarget) : num(r.goalTarget) },
        { label: 'Recompensa', value: brl(r.rewardValue) },
        { label: 'Rollover', value: mult(r.rollover) },
      ]
  }
}

// ---------- Assistente: nova/editar promoção ----------

function PromoEditor({
  id,
  initial,
  others,
  canEdit,
  onClose,
  onSave,
}: {
  id: string | null
  initial: Draft
  others: Promo[]
  canEdit: boolean
  onClose: () => void
  onSave: (d: Draft, mode: 'rascunho' | 'publicar' | 'salvar') => Promise<boolean>
}) {
  const { items: games } = useGames()
  const { items: providers } = useProviders()
  // demonstração: a base inteira; modo API: só o público de marketing (ativos) e o tamanho da base
  const { players, total: baseTotal } = useCampaignPlayers()
  const [d, setD] = useState<Draft>(initial)
  const isPublished = !!id && !initial.draft
  const [step, setStep] = useState(0)
  const [maxReached, setMaxReached] = useState(id ? PROMO_STEPS.length - 1 : 0)
  const [touched, setTouched] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)
  const dirty = JSON.stringify(d) !== JSON.stringify(initial)

  useEffect(() => {
    topRef.current?.scrollIntoView({ block: 'start' })
  }, [step])

  const errs = validatePromoStep(step, d, others, id ?? undefined)
  const show = touched.has(step)
  const err = (k: string) => (show ? (errs[k] ?? null) : null)
  const invalidSteps = [...touched].filter((s) => Object.keys(validatePromoStep(s, d, others, id ?? undefined)).length > 0)
  const gameName = games.find((g) => g.id === d.rules.gameId)?.name

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }))
  const setRule = <K extends keyof PromoRules>(k: K, v: PromoRules[K]) => setD((p) => ({ ...p, rules: { ...p.rules, [k]: v } }))

  const reach = useMemo(() => players.filter((pl) => audienceMatches(pl, d.audience)).length, [players, d.audience])

  const goNext = () => {
    if (Object.keys(errs).length) {
      setTouched((t) => new Set(t).add(step))
      toast.error('Revise os campos desta etapa', { description: Object.values(errs)[0] })
      return
    }
    const s = step + 1
    setStep(s)
    setMaxReached((m) => Math.max(m, s))
  }

  const finish = async (mode: 'rascunho' | 'publicar' | 'salvar') => {
    if (mode === 'rascunho') {
      if (d.name.trim().length < 4) {
        setTouched((t) => new Set(t).add(0))
        setStep(0)
        toast.error('Dê um nome para salvar o rascunho')
        return
      }
    } else {
      const bad = firstInvalidStep(d, others, id ?? undefined)
      if (bad >= 0) {
        setTouched(new Set([0, 1, 2, 3]))
        setStep(bad)
        setMaxReached((m) => Math.max(m, bad))
        toast.error(`Falta completar a etapa ${PROMO_STEPS[bad].label}`, { description: Object.values(validatePromoStep(bad, d, others, id ?? undefined))[0] })
        return
      }
    }
    setBusy(true)
    await onSave(d, mode)
    setBusy(false)
  }

  const close = async () => {
    if (dirty) {
      const ok = await confirm({ title: 'Descartar alterações?', description: 'O que você preencheu neste assistente será perdido.', confirmLabel: 'Descartar', tone: 'danger' })
      if (!ok) return
    }
    onClose()
  }

  const last = step === PROMO_STEPS.length - 1
  const startsLater = new Date(d.startAt).getTime() > Date.now()

  return (
    <Drawer
      open
      onClose={close}
      width="xl"
      title={id ? `Editar: ${initial.name}` : 'Nova promoção'}
      description={`Etapa ${step + 1} de ${PROMO_STEPS.length} · ${PROMO_STEPS[step].label}`}
      footer={
        <>
          {!isPublished && (
            <Button variant="ghost" icon={Save} className="mr-auto" onClick={() => finish('rascunho')} disabled={!canEdit || busy}>
              Salvar rascunho
            </Button>
          )}
          {isPublished && !last && (
            <Button variant="ghost" icon={Save} className="mr-auto" onClick={() => finish('salvar')} disabled={!canEdit || busy || !dirty}>
              Salvar alterações
            </Button>
          )}
          {step > 0 && (
            <Button icon={ArrowLeft} onClick={() => setStep(step - 1)}>
              Voltar
            </Button>
          )}
          {!last ? (
            <Button variant="primary" iconRight={ArrowRight} onClick={goNext}>
              Próximo
            </Button>
          ) : isPublished ? (
            <Button variant="primary" icon={Save} onClick={() => finish('salvar')} loading={busy} disabled={!canEdit || !dirty}>
              Salvar alterações
            </Button>
          ) : (
            <Button variant="primary" icon={Rocket} onClick={() => finish('publicar')} loading={busy} disabled={!canEdit}>
              {startsLater ? 'Agendar promoção' : 'Publicar promoção'}
            </Button>
          )}
        </>
      }
    >
      <div ref={topRef} className="scroll-mt-6" />
      <StepIndicator steps={PROMO_STEPS} current={step} maxReached={maxReached} onSelect={setStep} invalidSteps={invalidSteps} />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <FormFieldset readOnly={!canEdit} className="min-w-0">
          {step === 0 && (
            <>
              <Field label="Nome da promoção" htmlFor="pr-name" required error={err('name')} hint="Só a equipe vê. Use algo fácil de achar na lista.">
                <Input id="pr-name" value={d.name} maxLength={60} onChange={(e) => set('name', e.target.value)} invalid={!!err('name')} placeholder="Ex.: Deposite 50 e ganhe o dobro" data-autofocus />
              </Field>
              <Field label="Tipo">
                <RadioCards
                  name="Tipo da promoção"
                  value={d.type}
                  onChange={(t) => set('type', t)}
                  options={(Object.keys(PROMO_TYPE_LABEL) as PromoType[]).map((t) => ({ value: t, label: PROMO_TYPE_LABEL[t], description: PROMO_TYPE_DESCRIPTION[t], icon: TYPE_ICON[t] }))}
                />
              </Field>
              <Field label="Descrição interna" htmlFor="pr-desc" hint="Opcional. Contexto para a equipe: objetivo, aprovações, observações.">
                <Textarea id="pr-desc" rows={2} value={d.description} onChange={(e) => set('description', e.target.value)} />
              </Field>
              <FormGrid>
                <Field label="Início" htmlFor="pr-start" required error={err('startAt')}>
                  <Input id="pr-start" type="date" value={toDateInput(d.startAt)} onChange={(e) => set('startAt', fromDateInput(e.target.value) ?? '')} invalid={!!err('startAt')} />
                </Field>
                <Field label="Término" htmlFor="pr-end" error={err('endAt')} hint={d.endAt ? undefined : 'Sem término: fica no ar até você encerrar.'}>
                  <Input id="pr-end" type="date" value={toDateInput(d.endAt)} min={toDateInput(d.startAt)} onChange={(e) => set('endAt', fromDateInput(e.target.value, true))} invalid={!!err('endAt')} />
                </Field>
              </FormGrid>
              <Checkbox
                checked={d.endAt === null}
                onChange={(on) => set('endAt', on ? null : fromDateInput(toDateInput(new Date(new Date(d.startAt || Date.now()).getTime() + 30 * 86_400_000).toISOString()), true))}
                label="Sem data de término"
                disabled={!canEdit}
              />
              <Field label="Orçamento total" htmlFor="pr-budget" error={err('budget')} hint="R$ 0,00 = sem limite. Avisamos na lista quando o custo passa de 80% do orçamento.">
                <MoneyInput id="pr-budget" value={d.budget} onValueChange={(n) => set('budget', n)} />
              </Field>
            </>
          )}

          {step === 1 && (
            <>
              <RulesFields d={d} setRule={setRule} err={err} games={games} providers={providers} />
              <div className="rounded-xl border border-line p-4">
                <p className="mb-1 text-[13px] font-semibold text-fg">Custo por jogador</p>
                <CalcLine label="Máximo numa participação" value={maxCostPerPlayer(d) === null ? 'depende do resultado' : brl(maxCostPerPlayer(d)!)} />
                <CalcLine label="Participações por jogador" value={`até ${num(d.rules.maxPerPlayer)}`} />
                {maxCostPerPlayer(d) !== null && d.budget > 0 && (
                  <CalcLine label="O orçamento cobre" value={`≈ ${num(Math.floor(d.budget / Math.max(0.01, maxCostPerPlayer(d)! * d.rules.maxPerPlayer)))} jogadores`} strong />
                )}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <Field label="Quem pode participar">
                <RadioCards
                  name="Público"
                  value={d.audience.kind}
                  onChange={(k) => set('audience', { ...d.audience, kind: k })}
                  options={(Object.keys(AUDIENCE_LABEL) as PromoAudienceKind[]).map((k) => ({ value: k, label: AUDIENCE_LABEL[k], icon: AUDIENCE_ICON[k] }))}
                />
              </Field>
              {d.audience.kind === 'nivel' && (
                <Field label="Nível mínimo" htmlFor="pr-level" error={err('minLevel')}>
                  <NumberInput integer id="pr-level" value={d.audience.minLevel} min={1} max={30} onValueChange={(n) => set('audience', { ...d.audience, minLevel: Math.round(n) })} invalid={!!err('minLevel')} />
                </Field>
              )}
              {d.audience.kind === 'inativos' && (
                <Field label="Sem acessar há pelo menos" htmlFor="pr-inactive" error={err('inactiveDays')}>
                  <NumberInput integer id="pr-inactive" value={d.audience.inactiveDays} min={7} max={365} suffix="dias" onValueChange={(n) => set('audience', { ...d.audience, inactiveDays: Math.round(n) })} invalid={!!err('inactiveDays')} />
                </Field>
              )}
              <Switch
                label='Excluir jogadores marcados como "Bônus abuser"'
                description="Recomendado. A etiqueta é aplicada na ficha do jogador pela equipe de risco."
                checked={d.audience.excludeAbusers}
                onChange={(on) => set('audience', { ...d.audience, excludeAbusers: on })}
                disabled={!canEdit}
              />
              <div className="rounded-xl border border-line p-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-xs text-fg-3">Alcance estimado</p>
                    <p className="font-display text-2xl font-bold text-fg tnum">{num(reach)} jogadores</p>
                  </div>
                  <p className="text-xs text-fg-3 tnum">{pct(baseTotal ? reach / baseTotal : 0, 0)} da base</p>
                </div>
                <Progress value={reach} max={Math.max(1, baseTotal)} className="mt-2" label="Parte da base no público" />
              </div>
              <Alert tone="info" title="Jogo responsável">
                Jogadores autoexcluídos, em pausa ou bloqueados nunca entram em promoções, qualquer que seja o público (Lei 14.790/2023).
              </Alert>
            </>
          )}

          {step === 3 && (
            <>
              <Field
                label="Título no site"
                htmlFor="pr-headline"
                required
                error={err('headline')}
                labelAside={<span className={cn('text-xs tnum', d.comms.headline.length > 40 ? 'text-danger' : 'text-fg-3')}>{d.comms.headline.length}/40</span>}
              >
                <Input id="pr-headline" value={d.comms.headline} placeholder={suggestedHeadline(d)} onChange={(e) => set('comms', { ...d.comms, headline: e.target.value })} invalid={!!err('headline')} />
              </Field>
              {!d.comms.headline && (
                <button type="button" className="-mt-3 text-xs font-semibold text-primary-text hover:underline" onClick={() => set('comms', { ...d.comms, headline: suggestedHeadline(d) })}>
                  Usar sugestão: “{suggestedHeadline(d)}”
                </button>
              )}
              <Field label="Subtítulo" htmlFor="pr-sub" error={err('subtitle')} labelAside={<span className={cn('text-xs tnum', d.comms.subtitle.length > 90 ? 'text-danger' : 'text-fg-3')}>{d.comms.subtitle.length}/90</span>}>
                <Input id="pr-sub" value={d.comms.subtitle} onChange={(e) => set('comms', { ...d.comms, subtitle: e.target.value })} invalid={!!err('subtitle')} placeholder="Uma frase com a regra principal" />
              </Field>
              <Field label="Texto do botão" htmlFor="pr-cta" required error={err('cta')} labelAside={<span className={cn('text-xs tnum', d.comms.cta.length > 22 ? 'text-danger' : 'text-fg-3')}>{d.comms.cta.length}/22</span>}>
                <Input id="pr-cta" value={d.comms.cta} onChange={(e) => set('comms', { ...d.comms, cta: e.target.value })} invalid={!!err('cta')} />
              </Field>
              <Field label="Cor de destaque">
                <div role="radiogroup" aria-label="Cor de destaque" className="flex flex-wrap gap-2">
                  {(Object.keys(ACCENT) as PromoAccent[]).map((a) => (
                    <button
                      key={a}
                      type="button"
                      role="radio"
                      aria-checked={d.comms.accent === a}
                      onClick={() => set('comms', { ...d.comms, accent: a })}
                      className={cn(
                        'inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors',
                        d.comms.accent === a ? 'border-primary bg-primary/5 text-fg shadow-ring' : 'border-line text-fg-2 hover:border-line-strong',
                      )}
                    >
                      <span className={cn('h-4 w-4 rounded-full', ACCENT[a].swatch)} aria-hidden />
                      {ACCENT[a].label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Canais" error={err('channels')} hint={d.comms.channels.includes('sms') ? 'SMS depende de uma conta SendWork em Configurações › Integrações. Sem a conta, o SMS não é enviado.' : 'Onde a promoção é anunciada.'}>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(Object.keys(CHANNEL_LABEL) as PromoChannel[]).map((c) => {
                    const Icon = CHANNEL_ICON[c]
                    const on = d.comms.channels.includes(c)
                    return (
                      <label key={c} className={cn('flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors', on ? 'border-primary/50 bg-primary/5' : 'border-line hover:border-line-strong')}>
                        <Checkbox
                          checked={on}
                          disabled={!canEdit}
                          ariaLabel={CHANNEL_LABEL[c]}
                          onChange={(v) => set('comms', { ...d.comms, channels: v ? [...d.comms.channels, c] : d.comms.channels.filter((x) => x !== c) })}
                        />
                        <Icon size={15} className="text-fg-3" aria-hidden />
                        <span className="text-[13px] text-fg">{CHANNEL_LABEL[c]}</span>
                      </label>
                    )
                  })}
                </div>
              </Field>
              <Field label="Termos resumidos" htmlFor="pr-terms" hint="Aparecem ao tocar em “Termos e condições”.">
                <Textarea id="pr-terms" rows={3} value={d.comms.terms} onChange={(e) => set('comms', { ...d.comms, terms: e.target.value })} />
              </Field>
            </>
          )}

          {step === 4 && <ReviewStep d={d} others={others} id={id} gameName={gameName} reach={reach} onGo={setStep} />}
        </FormFieldset>

        <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
          <p className="text-xs font-medium text-fg-3">Prévia no site</p>
          <PromoPreview d={d} gameName={gameName} />
          <ul className="space-y-1.5 rounded-xl bg-surface-2 p-3 text-xs text-fg-2">
            <li className="flex items-center gap-2">
              <CalendarRange size={13} className="text-fg-3" aria-hidden /> {periodLabel(d)}
            </li>
            <li className="flex items-center gap-2">
              <Users size={13} className="text-fg-3" aria-hidden /> {audienceDescription(d.audience)} · ≈ {num(reach)}
            </li>
            <li className="flex items-center gap-2">
              <Megaphone size={13} className="text-fg-3" aria-hidden /> {d.comms.channels.length ? d.comms.channels.map((c) => CHANNEL_LABEL[c]).join(', ') : 'Nenhum canal'}
            </li>
          </ul>
        </aside>
      </div>
    </Drawer>
  )
}

function RulesFields({
  d,
  setRule,
  err,
  games,
  providers,
}: {
  d: Draft
  setRule: <K extends keyof PromoRules>(k: K, v: PromoRules[K]) => void
  err: (k: string) => string | null
  games: ReturnType<typeof useGames>['items']
  providers: ReturnType<typeof useProviders>['items']
}) {
  const r = d.rules
  const rollover = (
    <Field label={d.type === 'free_spins' ? 'Rollover dos ganhos' : 'Rollover'} htmlFor="pr-roll" error={err('rollover')} hint={r.rollover === 0 ? 'Sem rollover: o bônus vira saldo sacável na hora.' : `O jogador aposta ${mult(r.rollover)} o valor antes de sacar.`}>
      <NumberInput id="pr-roll" value={r.rollover} min={0} max={100} step={0.5} suffix="x" onValueChange={(n) => setRule('rollover', n)} invalid={!!err('rollover')} />
    </Field>
  )
  const perPlayer = (
    <Field label="Participações por jogador" htmlFor="pr-per" error={err('maxPerPlayer')}>
      <NumberInput integer id="pr-per" value={r.maxPerPlayer} min={1} suffix="vezes" onValueChange={(n) => setRule('maxPerPlayer', Math.round(n))} invalid={!!err('maxPerPlayer')} />
    </Field>
  )
  switch (d.type) {
    case 'bonus_deposito':
      return (
        <FormGrid>
          <Field label="Bônus" htmlFor="pr-pct" error={err('pct')}>
            <NumberInput id="pr-pct" value={r.pct} min={1} max={500} suffix="%" onValueChange={(n) => setRule('pct', n)} invalid={!!err('pct')} />
          </Field>
          <Field label="Depósito mínimo" htmlFor="pr-min" error={err('minDeposit')}>
            <MoneyInput id="pr-min" value={r.minDeposit} onValueChange={(n) => setRule('minDeposit', n)} invalid={!!err('minDeposit')} />
          </Field>
          <Field label="Teto do bônus" htmlFor="pr-max" error={err('maxReward')} hint={`Bate no teto quem deposita ${brl(r.pct ? (r.maxReward * 100) / r.pct : 0)} ou mais.`}>
            <MoneyInput id="pr-max" value={r.maxReward} onValueChange={(n) => setRule('maxReward', n)} invalid={!!err('maxReward')} />
          </Field>
          {rollover}
          {perPlayer}
        </FormGrid>
      )
    case 'free_spins':
      return (
        <FormGrid>
          <Field label="Jogo" htmlFor="pr-game" error={err('gameId')} className="sm:col-span-2" hint="Giros grátis só funcionam em slots ativos.">
            <GamePicker id="pr-game" value={r.gameId} onChange={(g) => setRule('gameId', g)} games={games} providers={providers} invalid={!!err('gameId')} filter={(g) => g.category === 'slots' && g.active} />
          </Field>
          <Field label="Quantidade de giros" htmlFor="pr-spins" error={err('spins')}>
            <NumberInput integer id="pr-spins" value={r.spins} min={1} max={1000} suffix="giros" onValueChange={(n) => setRule('spins', Math.round(n))} invalid={!!err('spins')} />
          </Field>
          <Field label="Valor por giro" htmlFor="pr-spinv" error={err('spinValue')} hint={`Total em giros: ${brl(r.spins * r.spinValue)}`}>
            <MoneyInput id="pr-spinv" value={r.spinValue} onValueChange={(n) => setRule('spinValue', n)} invalid={!!err('spinValue')} />
          </Field>
          <Field label="Depósito mínimo" htmlFor="pr-min">
            <MoneyInput id="pr-min" value={r.minDeposit} onValueChange={(n) => setRule('minDeposit', n)} />
          </Field>
          {rollover}
          {perPlayer}
        </FormGrid>
      )
    case 'cashback':
      return (
        <FormGrid>
          <Field label="Cashback" htmlFor="pr-pct" error={err('pct')} hint="Percentual sobre a perda líquida (apostas − ganhos) do período.">
            <NumberInput id="pr-pct" value={r.pct} min={1} max={50} suffix="%" onValueChange={(n) => setRule('pct', n)} invalid={!!err('pct')} />
          </Field>
          <Field label="Período de apuração">
            <Segmented<CashbackPeriod>
              ariaLabel="Período de apuração"
              value={r.cashbackPeriod}
              onChange={(v) => setRule('cashbackPeriod', v)}
              options={(Object.keys(CASHBACK_PERIOD_LABEL) as CashbackPeriod[]).map((k) => ({ value: k, label: CASHBACK_PERIOD_LABEL[k] }))}
            />
          </Field>
          <Field label="Teto por jogador" htmlFor="pr-max" hint="R$ 0,00 = sem teto.">
            <MoneyInput id="pr-max" value={r.maxReward} onValueChange={(n) => setRule('maxReward', n)} />
          </Field>
          {rollover}
          {perPlayer}
        </FormGrid>
      )
    case 'cupom':
      return (
        <FormGrid>
          <Field label="Código do cupom" htmlFor="pr-code" error={err('couponCode')} hint="Letras e números, sem espaço. O jogador digita no depósito.">
            <Input id="pr-code" value={r.couponCode} maxLength={16} onChange={(e) => setRule('couponCode', e.target.value.toUpperCase().replace(/\s/g, ''))} invalid={!!err('couponCode')} className="font-mono uppercase" placeholder="SEXTOU30" />
          </Field>
          <Field label="Valor do bônus" htmlFor="pr-cval" error={err('couponValue')}>
            <MoneyInput id="pr-cval" value={r.couponValue} onValueChange={(n) => setRule('couponValue', n)} invalid={!!err('couponValue')} />
          </Field>
          <Field label="Resgates totais" htmlFor="pr-cmax" hint="0 = sem limite. Ao atingir, o cupom deixa de funcionar.">
            <NumberInput integer id="pr-cmax" value={r.maxRedemptions} min={0} suffix="resgates" onValueChange={(n) => setRule('maxRedemptions', Math.round(n))} />
          </Field>
          {rollover}
          {perPlayer}
        </FormGrid>
      )
    case 'torneio':
      return (
        <>
          <Field label="Pontuação">
            <RadioCards<TournamentScoring>
              name="Pontuação do torneio"
              columns={1}
              value={r.scoring}
              onChange={(v) => setRule('scoring', v)}
              options={[
                { value: 'multiplicador', label: SCORING_LABEL.multiplicador, description: 'Maior ganho dividido pela aposta numa rodada.' },
                { value: 'total_apostado', label: SCORING_LABEL.total_apostado, description: 'Soma das apostas no período. Favorece quem joga mais.' },
                { value: 'lucro', label: SCORING_LABEL.lucro, description: 'Ganhos menos apostas no período.' },
              ]}
            />
          </Field>
          <FormGrid>
            <Field label="Premiação total" htmlFor="pr-pool" error={err('prizePool')}>
              <MoneyInput id="pr-pool" value={r.prizePool} onValueChange={(n) => setRule('prizePool', n)} invalid={!!err('prizePool')} />
            </Field>
            <Field label="Aposta mínima para pontuar" htmlFor="pr-minbet" error={err('minBet')}>
              <MoneyInput id="pr-minbet" value={r.minBet} onValueChange={(n) => setRule('minBet', n)} invalid={!!err('minBet')} />
            </Field>
            <Field label="Jogo do torneio" htmlFor="pr-tgame" className="sm:col-span-2" hint="Opcional. Sem jogo, vale para todos os slots.">
              <GamePicker id="pr-tgame" value={r.gameId} onChange={(g) => setRule('gameId', g)} games={games} providers={providers} placeholder="Todos os slots" filter={(g) => g.active} />
            </Field>
            {perPlayer}
          </FormGrid>
        </>
      )
    case 'missao':
      return (
        <FormGrid>
          <Field label="Objetivo" htmlFor="pr-goal">
            <Select id="pr-goal" value={r.goal} onChange={(v) => setRule('goal', v as MissionGoal)} options={(Object.keys(GOAL_LABEL) as MissionGoal[]).map((g) => ({ value: g, label: GOAL_LABEL[g] }))} />
          </Field>
          <Field label="Meta" htmlFor="pr-target" error={err('goalTarget')}>
            {r.goal === 'apostar' ? (
              <MoneyInput id="pr-target" value={r.goalTarget} onValueChange={(n) => setRule('goalTarget', n)} invalid={!!err('goalTarget')} />
            ) : (
              <NumberInput integer id="pr-target" value={r.goalTarget} min={1} suffix={r.goal === 'depositar' ? 'depósitos' : 'rodadas'} onValueChange={(n) => setRule('goalTarget', Math.round(n))} invalid={!!err('goalTarget')} />
            )}
          </Field>
          <Field label="Recompensa" htmlFor="pr-reward" error={err('rewardValue')}>
            <MoneyInput id="pr-reward" value={r.rewardValue} onValueChange={(n) => setRule('rewardValue', n)} invalid={!!err('rewardValue')} />
          </Field>
          {rollover}
          {perPlayer}
        </FormGrid>
      )
  }
}

function ReviewStep({ d, others, id, gameName, reach, onGo }: { d: Draft; others: Promo[]; id: string | null; gameName?: string; reach: number; onGo: (s: number) => void }) {
  const problems = [0, 1, 2, 3].flatMap((s) => Object.values(validatePromoStep(s, d, others, id ?? undefined)).map((m) => ({ step: s, message: m })))
  const status = promoStatus({ ...d, draft: false })
  const section = (title: string, s: number, items: { label: string; value: string; full?: boolean }[]) => (
    <Card>
      <CardHeader
        title={title}
        className="pb-2"
        actions={
          <Button size="xs" variant="ghost" icon={Pencil} onClick={() => onGo(s)}>
            Editar
          </Button>
        }
      />
      <CardBody>
        <DescriptionList items={items} />
      </CardBody>
    </Card>
  )
  return (
    <div className="space-y-4">
      {problems.length ? (
        <Alert tone="danger" title={`Faltam ${problems.length} ${problems.length === 1 ? 'ajuste' : 'ajustes'} antes de publicar`}>
          <ul className="mt-1 space-y-1">
            {problems.map((p, i) => (
              <li key={i}>
                <button type="button" className="text-left hover:underline" onClick={() => onGo(p.step)}>
                  <strong>{PROMO_STEPS[p.step].label}:</strong> {p.message}
                </button>
              </li>
            ))}
          </ul>
        </Alert>
      ) : (
        <Alert tone="success" title="Tudo certo para publicar">
          {status === 'agendada' ? `Ao publicar, a promoção fica agendada e entra no site em ${date(d.startAt)}.` : status === 'encerrada' ? 'Atenção: o término já passou. A promoção será publicada como encerrada.' : 'Ao publicar, a promoção entra no site na hora.'}
        </Alert>
      )}
      {section('Dados', 0, [
        { label: 'Nome', value: d.name || '—', full: true },
        { label: 'Tipo', value: PROMO_TYPE_LABEL[d.type] },
        { label: 'Orçamento', value: d.budget ? brl(d.budget) : 'Sem limite' },
        { label: 'Período', value: periodLabel(d), full: true },
      ])}
      {section('Regras', 1, [{ label: 'Recompensa', value: promoRewardSummary(d, gameName), full: true }, ...ruleItems(d, gameName), { label: 'Por jogador', value: `até ${num(d.rules.maxPerPlayer)} vez(es)` }])}
      {section('Público', 2, [
        { label: 'Público', value: audienceDescription(d.audience) },
        { label: 'Alcance estimado', value: `${num(reach)} jogadores` },
        { label: 'Bônus abuser', value: d.audience.excludeAbusers ? 'Excluídos' : 'Incluídos' },
      ])}
      {section('Comunicação', 3, [
        { label: 'Título', value: d.comms.headline || '—', full: true },
        { label: 'Botão', value: d.comms.cta || '—' },
        { label: 'Cor', value: ACCENT[d.comms.accent].label },
        { label: 'Canais', value: d.comms.channels.map((c) => CHANNEL_LABEL[c]).join(', ') || '—', full: true },
      ])}
    </div>
  )
}
