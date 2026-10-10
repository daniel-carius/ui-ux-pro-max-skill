import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowDownToLine,
  BatteryFull,
  CheckCircle2,
  ChevronLeft,
  Copy,
  Eye,
  Gift,
  Hourglass,
  Landmark,
  ListChecks,
  Lock,
  Megaphone,
  Percent,
  Plus,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Signal,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Timer,
  UserPlus,
  UserRound,
  Wallet,
  Wifi,
  X,
} from 'lucide-react'
import { Sparkline } from '@/components/charts'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ChipFilter,
  CopyButton,
  DataTable,
  DateRangePicker,
  DescriptionList,
  Drawer,
  Field,
  FormFieldset,
  FormGrid,
  KpiCard,
  MoneyInput,
  Mono,
  NumberInput,
  PageHeader,
  PersonCell,
  SaveBar,
  Select,
  SettingsSection,
  SortableList,
  Switch,
  Tabs,
  confirm,
  inRange,
  presetRange,
  toast,
  useSettingsForm,
  useTabParam,
  type Column,
  type DateRange,
} from '@/components/ui'
import { brl, brlCompact, dateTime, num, pct, relative, time } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ApiError, api, isApiMode } from '@/lib/api'
import { refreshKey, useDb } from '@/lib/store'
import { DAY, dayKey, startOfDay } from '@/data/now'
import { DATA_KEYS, useDeposits } from '@/data/hooks'
import { DEPOSIT_STATUS_LABEL, type Deposit, type DepositStatus } from '@/data/finance'
import { seedDepositCampaigns } from '@/data/operacao'
import { audit, usePageAccess } from '@/domain/session'
import { GATEWAY_NAMES } from '@/domain/system'
import {
  DEFAULT_DEPOSIT_LIMITS,
  DEPOSIT_CAMPAIGN_STATUS_LABEL,
  DEPOSIT_STATUS_TONE,
  MAX_QUICK_AMOUNTS,
  OPERACAO_KEYS,
  campaignSummary,
  computeBonus,
  depositLimitErrors,
  depositStats,
  depositTimeline,
  isPixOverdue,
  pixDeadline,
  quickAmountError,
  recheckStatus,
  shownCampaigns,
  validateCampaignsConfig,
  validateDepositLimits,
  type DepositCampaign,
  type DepositCampaignsConfig,
  type DepositLimits,
  type TimelineStep,
} from '@/domain/operacao'
import { PlayerDrawer, TableFrame, maskEmailShort, useCanOpenPlayer } from '@/pages/geral/_shared'

type TabId = 'depositos' | 'campanhas' | 'limites'

export default function Depositos() {
  const [tab, setTab] = useTabParam<TabId>('depositos', ['depositos', 'campanhas', 'limites'] as const)
  const { items } = useDeposits()
  const [campaigns] = useDb<DepositCampaignsConfig>(OPERACAO_KEYS.depositCampaigns, seedDepositCampaigns)
  const pending = items.filter((d) => d.status === 'pendente').length
  return (
    <>
      <PageHeader>
        <Tabs<TabId>
          className="mt-5"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'depositos', label: 'Depósitos', icon: ListChecks, count: pending || undefined },
            { value: 'campanhas', label: 'Campanhas', icon: Megaphone, count: shownCampaigns(campaigns).length },
            { value: 'limites', label: 'Limites e tela de depósito', icon: SlidersHorizontal },
          ]}
        />
      </PageHeader>
      {tab === 'depositos' ? <DepositList /> : tab === 'campanhas' ? <Campaigns onGoLimits={() => setTab('limites')} /> : <Limits onGoCampaigns={() => setTab('campanhas')} />}
    </>
  )
}

// ======================================================================
// Aba Depósitos
// ======================================================================

type Filter = 'todos' | DepositStatus

/**
 * Modo API: a lista de depósitos é gravada só pelo servidor (PUT em operacao.depositos é 403). A reconsulta vai
 * para POST /api/kv/operacao.depositos/recheck { ids } (depositos.editar), que baixa como expirado o PIX pendente
 * vencido e grava a auditoria; depois a lista é lida de novo.
 */
const API = isApiMode()
/** limite de ids por pedido de reconsulta no servidor */
const RECHECK_BATCH = 500

interface RecheckResponse {
  ok: true
  expired: string[]
  unchanged: string[]
  missing: string[]
  version: number
}

async function recheckOnServer(ids: string[]) {
  const out = { expired: [] as string[], unchanged: [] as string[], missing: [] as string[] }
  for (let i = 0; i < ids.length; i += RECHECK_BATCH) {
    const res = await api<RecheckResponse>('POST', `/api/kv/${encodeURIComponent(DATA_KEYS.deposits)}/recheck`, { ids: ids.slice(i, i + RECHECK_BATCH) })
    out.expired.push(...res.expired)
    out.unchanged.push(...res.unchanged)
    out.missing.push(...res.missing)
  }
  return out
}

function DepositList() {
  const { canEdit } = usePageAccess()
  const deposits = useDeposits()
  const [limits] = useDb<DepositLimits>(OPERACAO_KEYS.depositLimits, DEFAULT_DEPOSIT_LIMITS)
  const [range, setRange] = useState<DateRange>(() => presetRange('30d'))
  const [filter, setFilter] = useState<Filter>('todos')
  const [openId, setOpenId] = useState<string | null>(null)
  const [playerId, setPlayerId] = useState<string | null>(null)
  const canOpenPlayer = useCanOpenPlayer()

  const inPeriod = useMemo(() => deposits.items.filter((d) => d.status === 'pendente' || inRange(d.createdAt, range)), [deposits.items, range])
  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: inPeriod.length }
    for (const d of inPeriod) c[d.status] = (c[d.status] ?? 0) + 1
    return c
  }, [inPeriod])
  const rows = filter === 'todos' ? inPeriod : inPeriod.filter((d) => d.status === filter)
  const stats = useMemo(() => depositStats(deposits.items.filter((d) => inRange(d.createdAt, range))), [deposits.items, range])
  const allPending = deposits.items.filter((d) => d.status === 'pendente')
  const overdue = allPending.filter((d) => isPixOverdue(d, limits.pixExpirationMin))

  const spark = useMemo(() => {
    const days: string[] = []
    for (let t = startOfDay(range.from).getTime(); t <= range.to.getTime(); t += DAY) days.push(dayKey(new Date(t)))
    const idx = new Map(days.map((k, i) => [k, i]))
    const paid = days.map(() => 0)
    for (const d of deposits.items) {
      if (d.status !== 'pago') continue
      const i = idx.get(dayKey(new Date(d.createdAt)))
      if (i !== undefined) paid[i] += d.amount
    }
    return paid
  }, [deposits.items, range])

  const [rechecking, setRechecking] = useState(false)
  const recheckApi = async (list: Deposit[]) => {
    if (rechecking || !list.length) return
    setRechecking(true)
    try {
      const res = await recheckOnServer(list.map((d) => d.id))
      await refreshKey(DATA_KEYS.deposits).catch(() => {})
      if (list.length === 1) {
        const d = list[0]
        if (res.expired.includes(d.id)) toast.success('PIX baixado como expirado', { description: `${d.id}: o prazo venceu sem pagamento.` })
        else if (res.missing.includes(d.id)) toast.warning('Depósito não encontrado', { description: `${d.id} não está mais na lista do servidor.` })
        else if (d.status === 'pendente') toast.info('Ainda aguardando pagamento', { description: `O código vale até ${time(pixDeadline(d, limits.pixExpirationMin))}.` })
        else toast.info('Nada mudou', { description: `${d.id} já estava ${DEPOSIT_STATUS_LABEL[d.status].toLowerCase()}.` })
      } else {
        toast.success('Gateways reconsultados', {
          description: `${num(res.expired.length)} PIX vencidos baixados como expirados${res.unchanged.length ? `; ${num(res.unchanged.length)} sem mudança` : ''}.`,
        })
      }
    } catch (e) {
      toast.error('Não foi possível reconsultar', { description: e instanceof ApiError ? e.message : 'Tente de novo em instantes.', duration: 6000 })
      refreshKey(DATA_KEYS.deposits).catch(() => {})
    } finally {
      setRechecking(false)
    }
  }

  const recheck = (list: Deposit[]) => {
    if (!canEdit) {
      toast.error('Seu cargo só consulta depósitos.')
      return
    }
    if (API) {
      void recheckApi(list)
      return
    }
    const now = Date.now()
    let expired = 0
    for (const d of list) {
      const next = recheckStatus(d, limits.pixExpirationMin, now)
      if (next !== d.status) {
        deposits.update(d.id, { status: next, updatedAt: new Date(now).toISOString() })
        audit('sincronizar', `Depósito #${d.id}`, `Status reconsultado no ${d.gateway}: ${DEPOSIT_STATUS_LABEL[next]}`)
        expired++
      }
    }
    if (list.length === 1) {
      if (expired) toast.success('PIX baixado como expirado', { description: `${list[0].id}: o prazo venceu sem pagamento.` })
      else toast.info('Ainda aguardando pagamento', { description: `O código vale até ${time(pixDeadline(list[0], limits.pixExpirationMin))}.` })
    } else {
      toast.success('Gateways reconsultados', { description: `${num(expired)} PIX vencidos baixados como expirados.` })
    }
  }

  const recheckAll = async () => {
    const ok = await confirm({
      title: `Reconsultar ${overdue.length} PIX vencidos?`,
      description: 'O painel pergunta ao gateway o status de cada cobrança. Os que não foram pagos no prazo passam para "Expirado". Nenhum valor é movido.',
      confirmLabel: 'Reconsultar agora',
      icon: RefreshCw,
    })
    if (ok) recheck(overdue)
  }

  const copyRef = async (d: Deposit) => {
    try {
      await navigator.clipboard.writeText(d.reference)
    } catch {
      /* sem permissão */
    }
    toast.success('Referência copiada', { description: d.reference })
  }

  const columns: Column<Deposit>[] = [
    {
      id: 'id',
      header: 'ID',
      pinned: true,
      sortValue: (d) => d.createdAt,
      csv: (d) => d.id,
      cell: (d) => (
        <div>
          <Mono className="font-medium text-fg">{d.id}</Mono>
          <p className="mt-0.5 text-xs text-fg-3">{relative(d.createdAt)}</p>
        </div>
      ),
    },
    {
      id: 'player',
      header: 'Usuário',
      minWidth: 200,
      sortValue: (d) => d.playerName,
      csv: (d) => `${d.playerName} (${d.playerId})`,
      cell: (d) => <PersonCell name={d.playerName} sub={`ID ${d.playerId} · ${maskEmailShort(d.playerEmail)}`} />,
    },
    {
      id: 'amount',
      header: 'Valor',
      align: 'right',
      sortValue: (d) => d.amount,
      csv: (d) => d.amount,
      cell: (d) => (
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-semibold text-fg">{brl(d.amount)}</span>
          {d.isFirst && (
            <Badge tone="primary" icon={UserPlus}>
              1º depósito
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: 'reference',
      header: 'Referência (E2E)',
      label: 'Referência',
      csv: (d) => d.reference,
      cell: (d) => (
        <Mono className="block max-w-[150px] truncate" >
          <span title={d.reference}>{d.reference}</span>
        </Mono>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (d) => d.status,
      csv: (d) => DEPOSIT_STATUS_LABEL[d.status],
      cell: (d) => (
        <div className="flex flex-col items-start gap-0.5">
          <Badge tone={DEPOSIT_STATUS_TONE[d.status]} dot>
            {DEPOSIT_STATUS_LABEL[d.status]}
          </Badge>
          {isPixOverdue(d, limits.pixExpirationMin) && <span className="text-[11px] font-medium text-danger">prazo vencido</span>}
        </div>
      ),
    },
    { id: 'gateway', header: 'Gateway', sortValue: (d) => d.gateway, cell: (d) => <Badge icon={Landmark}>{d.gateway}</Badge> },
    {
      id: 'campaign',
      header: 'Campanha',
      defaultHidden: true,
      sortValue: (d) => d.bonusCampaign ?? '',
      csv: (d) => d.bonusCampaign ?? '',
      cell: (d) => (d.bonusCampaign ? <Badge tone="primary" icon={Gift}>{d.bonusCampaign}</Badge> : <span className="text-fg-3">—</span>),
    },
    {
      id: 'updatedAt',
      header: 'Atualizado',
      sortValue: (d) => d.updatedAt,
      csv: (d) => dateTime(d.updatedAt),
      cell: (d) => <span className="whitespace-nowrap text-[13px] text-fg-2">{dateTime(d.updatedAt)}</span>,
    },
  ]

  const open = openId ? deposits.get(openId) : undefined

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-fg-3">Cartões e lista mostram o período escolhido. PIX aguardando pagamento aparecem sempre.</p>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      <section aria-label="Resumo dos depósitos" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Pago no período"
          icon={CheckCircle2}
          tone="success"
          value={brlCompact(stats.paid)}
          hint={`${num(stats.paidCount)} PIX · ${num(stats.ftdCount)} primeiros depósitos`}
          formula={<>Soma dos depósitos com PIX confirmado pelo gateway no período. PIX gerado e não pago não entra.</>}
          chart={<Sparkline data={spark} slot={3} ariaLabel="Depósitos pagos por dia" />}
        />
        <KpiCard
          label="Conversão PIX"
          icon={Percent}
          tone={stats.conversion >= 0.75 ? 'primary' : 'warning'}
          value={pct(stats.conversion)}
          hint={`${num(stats.paidCount)} pagos de ${num(stats.generated - stats.pendingCount)} gerados`}
          formula={<>Conversão = PIX pagos ÷ PIX gerados já decididos (pagos, expirados, falhos e estornados). Os que ainda aguardam ficam de fora.</>}
        />
        <KpiCard
          label="Ticket médio"
          icon={Receipt}
          tone="info"
          value={brl(stats.avgTicket)}
          hint={`1º depósito médio ${brl(stats.ftdCount ? stats.ftdAmount / stats.ftdCount : 0)}`}
          formula={<>Valor pago no período ÷ quantidade de PIX pagos.</>}
        />
        <KpiCard
          label="Aguardando PIX"
          icon={Hourglass}
          tone="warning"
          value={num(allPending.length)}
          hint={
            <>
              {brl(allPending.reduce((s, d) => s + d.amount, 0))}
              {overdue.length > 0 && <span className="font-semibold text-danger"> · {overdue.length} vencidos</span>}
            </>
          }
          onClick={() => setFilter(filter === 'pendente' ? 'todos' : 'pendente')}
          active={filter === 'pendente'}
        />
      </section>

      {overdue.length > 0 && (
        <Alert
          tone="warning"
          title={`${overdue.length} PIX passaram do prazo de ${limits.pixExpirationMin} min e seguem como aguardando`}
          action={
            <Button size="sm" icon={RefreshCw} onClick={recheckAll} disabled={!canEdit} loading={rechecking} title={!canEdit ? 'Seu cargo só consulta depósitos' : undefined}>
              Reconsultar no gateway
            </Button>
          }
        >
          O gateway não avisou a baixa. Enquanto isso, eles contam como aguardando e distorcem a conversão.
        </Alert>
      )}

      <TableFrame>
        <DataTable
          caption="Depósitos"
          rows={rows}
          columns={columns}
          rowKey={(d) => d.id}
          searchText={(d) => `${d.id} ${d.playerName} ${d.playerEmail} ${d.playerId} ${d.reference}`}
          searchPlaceholder="Buscar por ID, usuário ou e-mail"
          initialSort={{ id: 'id', dir: 'desc' }}
          exportName="depositos"
          onExport={(n) => audit('exportar', 'Depósitos', `Exportação CSV de ${n} depósitos`)}
          onRowClick={(d) => setOpenId(d.id)}
          resetKey={filter}
          rowClassName={(d) => (isPixOverdue(d, limits.pixExpirationMin) ? 'bg-danger/[0.03]' : undefined)}
          rowActions={(d) => [
            { label: 'Ver detalhes', icon: Eye, onSelect: () => setOpenId(d.id) },
            { label: 'Ver jogador', icon: UserRound, disabled: !canOpenPlayer, hint: canOpenPlayer ? undefined : 'só em Usuários', onSelect: () => setPlayerId(d.playerId) },
            { label: 'Copiar referência', icon: Copy, onSelect: () => copyRef(d) },
            ...(d.status === 'pendente'
              ? [{ divider: true as const }, { label: 'Reconsultar no gateway', icon: RefreshCw, disabled: !canEdit, hint: canEdit ? undefined : 'só leitura', onSelect: () => recheck([d]) }]
              : []),
          ]}
          toolbar={
            <ChipFilter<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'todos', label: 'Todos', count: counts.todos ?? 0 },
                { value: 'pago', label: 'Pagos', count: counts.pago ?? 0 },
                { value: 'pendente', label: 'Aguardando PIX', count: counts.pendente ?? 0, tone: 'warning' },
                { value: 'expirado', label: 'Expirados', count: counts.expirado ?? 0 },
                { value: 'falhou', label: 'Falharam', count: counts.falhou ?? 0, tone: 'danger' },
                { value: 'estornado', label: 'Estornados', count: counts.estornado ?? 0 },
              ]}
              className="max-w-full"
            />
          }
          empty={{ icon: ArrowDownToLine, title: 'Nenhum depósito neste filtro', description: 'Troque o status ou o período para ver outros depósitos.' }}
        />
      </TableFrame>

      <DepositDrawer
        d={open}
        expirationMin={limits.pixExpirationMin}
        canEdit={canEdit}
        onClose={() => setOpenId(null)}
        onRecheck={(d) => recheck([d])}
        onPlayer={(id) => {
          setOpenId(null)
          setPlayerId(id)
        }}
      />
      <PlayerDrawer playerId={playerId} onClose={() => setPlayerId(null)} />
    </div>
  )
}

const STEP_DOT: Record<TimelineStep['tone'], string> = {
  success: 'bg-success',
  danger: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-info',
  neutral: 'bg-fg-3',
  primary: 'bg-primary',
}

function DepositDrawer({
  d,
  expirationMin,
  canEdit,
  onClose,
  onRecheck,
  onPlayer,
}: {
  d: Deposit | undefined
  expirationMin: number
  canEdit: boolean
  onClose: () => void
  onRecheck: (d: Deposit) => void
  onPlayer: (id: string) => void
}) {
  const [campaigns] = useDb<DepositCampaignsConfig>(OPERACAO_KEYS.depositCampaigns, seedDepositCampaigns)
  if (!d) return null
  const steps = depositTimeline(d, expirationMin)
  const campaign = d.bonusCampaign ? campaigns.items.find((c) => c.name === d.bonusCampaign) : undefined
  const bonus = campaign ? computeBonus(d.amount, campaign) : null
  return (
    <Drawer
      open
      onClose={onClose}
      title={`Depósito ${d.id}`}
      description={`Criado em ${dateTime(d.createdAt)} · ${relative(d.createdAt)}`}
      headerExtra={
        <Badge tone={DEPOSIT_STATUS_TONE[d.status]} dot size="md">
          {DEPOSIT_STATUS_LABEL[d.status]}
        </Badge>
      }
      footer={
        <>
          <Button icon={UserRound} onClick={() => onPlayer(d.playerId)}>
            Ver jogador
          </Button>
          {d.status === 'pendente' && (
            <Button variant="primary" icon={RefreshCw} onClick={() => onRecheck(d)} disabled={!canEdit} title={!canEdit ? 'Seu cargo só consulta depósitos' : undefined}>
              Reconsultar no gateway
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-6">
        <div className="rounded-xl bg-surface-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-fg-3">Valor do PIX</p>
            {d.isFirst && (
              <Badge tone="primary" icon={UserPlus}>
                1º depósito do jogador
              </Badge>
            )}
          </div>
          <p className="mt-1 font-display text-3xl font-bold text-fg">{brl(d.amount)}</p>
          <p className="mt-1 text-[13px] text-fg-3">
            {d.gateway} · {d.status === 'pendente' ? `vale até ${dateTime(pixDeadline(d, expirationMin))}` : `atualizado ${relative(d.updatedAt)}`}
          </p>
        </div>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Jogador</h3>
          <button type="button" onClick={() => onPlayer(d.playerId)} className="w-full rounded-xl border border-line p-3 text-left hover:bg-surface-2">
            <PersonCell name={d.playerName} sub={`ID ${d.playerId} · ${maskEmailShort(d.playerEmail)}`} />
          </button>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Pagamento</h3>
          <DescriptionList
            items={[
              { label: 'Gateway', value: d.gateway },
              { label: 'Atualizado em', value: dateTime(d.updatedAt) },
              {
                label: 'Referência (E2E)',
                full: true,
                value: (
                  <span className="flex items-center gap-1">
                    <Mono className="break-all">{d.reference}</Mono>
                    <CopyButton value={d.reference} label="Copiar referência" />
                  </span>
                ),
              },
              {
                label: 'Campanha de bônus',
                full: true,
                value: d.bonusCampaign ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone="primary" icon={Gift}>
                      {d.bonusCampaign}
                    </Badge>
                    {bonus?.eligible && (
                      <span className="text-[13px] text-fg-2">
                        bônus de {brl(bonus.bonus)} · apostar {brl(bonus.wagerTarget)} para liberar
                      </span>
                    )}
                  </span>
                ) : (
                  'Sem bônus'
                ),
              },
            ]}
          />
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Linha do tempo</h3>
          <ol className="relative space-y-4 border-l border-line pl-5">
            {steps.map((s, i) => (
              <li key={i} className="relative">
                <span className={cn('absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-surface', STEP_DOT[s.tone])} aria-hidden />
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-[13px] font-medium text-fg">{s.label}</p>
                  <p className="text-xs text-fg-3 tnum">{s.at ? dateTime(s.at) : 'agora'}</p>
                </div>
                {s.description && <p className="mt-0.5 text-[13px] leading-5 text-fg-3">{s.description}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </Drawer>
  )
}

// ======================================================================
// Aba Campanhas
// ======================================================================

const CAMPAIGN_TONE = { ativa: 'success', pausada: 'warning', encerrada: 'neutral' } as const

function Campaigns({ onGoLimits }: { onGoLimits: () => void }) {
  const { canEdit } = usePageAccess()
  const navigate = useNavigate()
  const [limits] = useDb<DepositLimits>(OPERACAO_KEYS.depositLimits, DEFAULT_DEPOSIT_LIMITS)
  const form = useSettingsForm<DepositCampaignsConfig>(OPERACAO_KEYS.depositCampaigns, seedDepositCampaigns, {
    entity: 'Campanhas na tela de depósito',
    successMessage: 'Campanhas da tela de depósito salvas',
    validate: validateCampaignsConfig,
  })
  const v = form.values
  const shown = shownCampaigns(v)
  const shownIds = new Set(shown.map((c) => c.id))
  const setItem = (id: string, patch: Partial<DepositCampaign>) => form.set('items', v.items.map((c) => (c.id === id ? { ...c, ...patch } : c)))

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        {!limits.showBonusSelector && (
          <Alert
            tone="warning"
            title="O seletor de bônus está desligado"
            action={
              <Button size="sm" onClick={onGoLimits}>
                Abrir limites
              </Button>
            }
          >
            Nenhuma oferta aparece para o jogador até ligar “Exibir seletor de bônus” na aba Limites e tela de depósito.
          </Alert>
        )}
        <FormFieldset readOnly={!canEdit}>
          <Card>
            <CardHeader
              icon={Megaphone}
              title="Ofertas na tela de depósito"
              description="Arraste ou use as setas para mudar a ordem. Só campanhas ativas podem aparecer."
              actions={
                <Button size="sm" variant="outline" icon={Plus} onClick={() => navigate('/campanhas/bonus-deposito')}>
                  Criar campanha
                </Button>
              }
            />
            <CardBody>
              <SortableList
                items={v.items}
                getKey={(c) => c.id}
                onChange={(items) => form.set('items', items)}
                disabled={!canEdit}
                render={(c) => {
                  const position = shown.findIndex((x) => x.id === c.id)
                  const blocked = c.status !== 'ativa'
                  return (
                    <div className="flex flex-col gap-2 py-0.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className={cn('mt-0.5 hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:flex', blocked ? 'bg-surface-3 text-fg-3' : 'bg-primary/10 text-primary-text')}>
                          <Gift size={17} aria-hidden />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className={cn('text-sm font-semibold sm:truncate', blocked ? 'text-fg-3' : 'text-fg')}>{c.name}</p>
                            <Badge tone={CAMPAIGN_TONE[c.status]} dot>
                              {DEPOSIT_CAMPAIGN_STATUS_LABEL[c.status]}
                            </Badge>
                            {shownIds.has(c.id) && <Badge tone="primary">{`${position + 1}ª na tela`}</Badge>}
                            {c.visible && c.status === 'ativa' && !shownIds.has(c.id) && <Badge tone="warning">fora do limite</Badge>}
                          </div>
                          <p className="mt-0.5 text-xs text-fg-3 sm:truncate">
                            {campaignSummary(c)} · {c.audience}
                          </p>
                        </div>
                      </div>
                      <Switch
                        size="sm"
                        ariaLabel={`Exibir ${c.name} na tela de depósito`}
                        checked={c.visible && !blocked}
                        disabled={!canEdit || blocked}
                        onChange={(on) => setItem(c.id, { visible: on })}
                        className="self-end sm:self-auto"
                      />
                    </div>
                  )
                }}
              />
              <p className="mt-3 text-xs text-fg-3">
                Campanha pausada ou encerrada não aparece para o jogador. Para criar, editar regras ou reativar, use{' '}
                <Link to="/campanhas/bonus-deposito" className="link">
                  Campanhas › Bônus de depósito
                </Link>
                .
              </p>
            </CardBody>
          </Card>

          <SettingsSection title="Exibição" description="Como as ofertas aparecem para o jogador na hora de depositar.">
            <Field label="Máximo de ofertas na tela" htmlFor="c-max" hint="Mais de 3 ofertas costuma confundir e reduzir a conversão.">
              <NumberInput id="c-max" value={v.maxVisible} min={1} max={5} onValueChange={(n) => form.set('maxVisible', Math.round(n))} suffix="ofertas" invalid={v.maxVisible < 1 || v.maxVisible > 5} />
            </Field>
            <Switch
              label="Já marcar a primeira oferta"
              description={
                v.preselectFirst
                  ? 'Ligado: o jogador aceita o bônus e o rollover sem escolher. Tende a gerar reclamação na hora do saque.'
                  : 'Desligado (recomendado): o jogador escolhe o bônus de forma ativa.'
              }
              checked={v.preselectFirst}
              onChange={(on) => form.set('preselectFirst', on)}
            />
            {v.preselectFirst && (
              <Alert tone="warning">O jogador pode não perceber que aceitou rollover. Prefira deixar a escolha com ele.</Alert>
            )}
            <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-3">
              <Lock size={16} className="mt-0.5 shrink-0 text-fg-3" aria-hidden />
              <div className="text-[13px] leading-5">
                <p className="font-medium text-fg">Opção “Sem bônus” sempre visível</p>
                <p className="text-fg-3">O jogador sempre pode depositar sem aceitar oferta. Essa opção não pode ser desligada.</p>
              </div>
            </div>
          </SettingsSection>
        </FormFieldset>
      </div>

      <PreviewCard limits={limits} campaigns={v} />
      <div className="xl:col-span-2">
        <SaveBar form={form} label="Salvar campanhas" />
      </div>
    </div>
  )
}

// ======================================================================
// Aba Limites e tela de depósito
// ======================================================================

function Limits({ onGoCampaigns }: { onGoCampaigns: () => void }) {
  const [campaigns] = useDb<DepositCampaignsConfig>(OPERACAO_KEYS.depositCampaigns, seedDepositCampaigns)
  const form = useSettingsForm<DepositLimits>(OPERACAO_KEYS.depositLimits, DEFAULT_DEPOSIT_LIMITS, {
    entity: 'Limites de depósito',
    successMessage: 'Limites de depósito salvos',
    validate: validateDepositLimits,
  })
  const v = form.values
  const e = depositLimitErrors(v)
  const [draft, setDraft] = useState(0)
  const [draftError, setDraftError] = useState<string | null>(null)

  const addQuick = () => {
    const err = quickAmountError(draft, v)
    setDraftError(err)
    if (err) return
    form.set('quickAmounts', [...v.quickAmounts, draft].sort((a, b) => a - b))
    setDraft(0)
  }
  const removeQuick = (a: number) => {
    const next = v.quickAmounts.filter((x) => x !== a)
    form.patch({ quickAmounts: next, defaultAmount: v.defaultAmount === a ? 0 : v.defaultAmount })
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <FormFieldset readOnly={form.readOnly} className="min-w-0">
        <SettingsSection title="Valores" description="Valem para todo depósito feito no site. O jogador vê o mínimo e o máximo antes de gerar o PIX.">
          <FormGrid>
            <Field label="Depósito mínimo" htmlFor="l-min" error={e.min} hint="Abaixo disso o botão de gerar PIX fica bloqueado.">
              <MoneyInput id="l-min" value={v.min} onValueChange={(n) => form.set('min', n)} invalid={!!e.min} />
            </Field>
            <Field label="Depósito máximo" htmlFor="l-max" error={e.max} hint="Por PIX gerado.">
              <MoneyInput id="l-max" value={v.max} onValueChange={(n) => form.set('max', n)} invalid={!!e.max} />
            </Field>
            <Field label="Limite diário por jogador" htmlFor="l-daily" error={e.dailyLimit} hint="Soma dos depósitos pagos no mesmo dia. Limites do jogo responsável valem por cima deste.">
              <MoneyInput id="l-daily" value={v.dailyLimit} onValueChange={(n) => form.set('dailyLimit', n)} invalid={!!e.dailyLimit} />
            </Field>
          </FormGrid>
        </SettingsSection>

        <SettingsSection title="Valores rápidos" description={`Botões que preenchem o valor com um toque. Até ${MAX_QUICK_AMOUNTS} valores, dentro da faixa de mínimo e máximo.`}>
          <div>
            <div className="flex flex-wrap gap-2" aria-label="Valores rápidos">
              {v.quickAmounts.map((a) => {
                const out = a < v.min || a > v.max
                return (
                  <span
                    key={a}
                    className={cn(
                      'inline-flex h-9 items-center gap-1.5 rounded-lg border pl-3 pr-1.5 text-sm font-semibold tnum',
                      out ? 'border-danger/50 bg-danger/5 text-danger' : a === v.defaultAmount ? 'border-primary bg-primary/10 text-primary-text' : 'border-line-strong bg-surface text-fg',
                    )}
                    title={out ? 'Fora da faixa de mínimo e máximo' : undefined}
                  >
                    {brl(a)}
                    <button type="button" onClick={() => removeQuick(a)} aria-label={`Remover ${brl(a)}`} className="rounded p-1 text-fg-3 hover:bg-surface-3 hover:text-fg disabled:cursor-not-allowed">
                      <X size={13} aria-hidden />
                    </button>
                  </span>
                )
              })}
              {v.quickAmounts.length === 0 && <span className="text-[13px] text-fg-3">Nenhum valor rápido.</span>}
            </div>
            {e.quickAmounts && <p className="mt-2 text-xs font-medium text-danger">{e.quickAmounts}</p>}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <Field
              label="Novo valor"
              htmlFor="l-quick"
              error={draftError}
              hint={v.quickAmounts.length >= MAX_QUICK_AMOUNTS ? `Limite de ${MAX_QUICK_AMOUNTS} atingido: remova um para incluir outro.` : undefined}
              className="sm:w-56"
            >
              <MoneyInput
                id="l-quick"
                value={draft}
                onValueChange={(n) => {
                  setDraft(n)
                  setDraftError(null)
                }}
                invalid={!!draftError}
              />
            </Field>
            <Button icon={Plus} onClick={addQuick} className="sm:mt-[26px]" disabled={v.quickAmounts.length >= MAX_QUICK_AMOUNTS}>
              Adicionar valor
            </Button>
          </div>
          <Field label="Valor já marcado ao abrir a tela" htmlFor="l-default" error={e.defaultAmount}>
            <Select
              id="l-default"
              value={String(v.defaultAmount)}
              onChange={(x) => form.set('defaultAmount', Number(x))}
              options={[{ value: '0', label: 'Nenhum (campo vazio)' }, ...v.quickAmounts.map((a) => ({ value: String(a), label: brl(a) }))]}
            />
          </Field>
        </SettingsSection>

        <SettingsSection title="PIX e gateway" description="Quem gera a cobrança e por quanto tempo o código vale.">
          <FormGrid>
            <Field label="Expiração do PIX" htmlFor="l-exp" error={e.pixExpirationMin} hint="Prazo curto reduz PIX pago fora do prazo; longo demais deixa cobranças abertas.">
              <NumberInput id="l-exp" value={v.pixExpirationMin} min={5} max={1440} onValueChange={(n) => form.set('pixExpirationMin', Math.round(n))} suffix="min" invalid={!!e.pixExpirationMin} />
            </Field>
            <Field label="Gateway principal" htmlFor="l-gw">
              <Select id="l-gw" value={v.mainGateway} onChange={(x) => form.set('mainGateway', x)} options={GATEWAY_NAMES.map((g) => ({ value: g, label: g }))} />
            </Field>
            <Field label="Gateway reserva" htmlFor="l-gw2" error={e.fallbackGateway} hint="Assume se o principal falhar ao gerar o PIX.">
              <Select
                id="l-gw2"
                value={v.fallbackGateway}
                onChange={(x) => form.set('fallbackGateway', x)}
                options={[{ value: '', label: 'Sem reserva' }, ...GATEWAY_NAMES.map((g) => ({ value: g, label: g, disabled: g === v.mainGateway }))]}
              />
            </Field>
          </FormGrid>
          <p className="text-xs text-fg-3">
            Contas e credenciais de cada gateway ficam em{' '}
            <Link to="/settings/gateways" className="link">
              Configurações › Gateways
            </Link>
            .
          </p>
          <Switch
            label="Aceitar só PIX de conta no CPF do jogador"
            description={v.holderOnly ? 'PIX de terceiros é devolvido automaticamente. Evita lavagem e uso de contas de laranjas.' : 'Desligado: qualquer pessoa pode pagar o PIX do jogador.'}
            checked={v.holderOnly}
            onChange={(on) => form.set('holderOnly', on)}
          />
          {!v.holderOnly && <Alert tone="danger">Aceitar PIX de terceiros aumenta o risco de fraude e de contas usadas por outra pessoa. Recomendamos manter ligado.</Alert>}
        </SettingsSection>

        <SettingsSection
          title="Bônus na tela de depósito"
          description="Mostra as ofertas de bônus de depósito antes de gerar o PIX."
          aside={
            <Button size="sm" variant="ghost" icon={Megaphone} onClick={onGoCampaigns}>
              Ordenar campanhas
            </Button>
          }
        >
          <Switch
            label="Exibir seletor de bônus"
            description={v.showBonusSelector ? `${shownCampaigns(campaigns).length} ofertas aparecem, mais a opção “Sem bônus”.` : 'Desligado: o jogador deposita sem ver ofertas.'}
            checked={v.showBonusSelector}
            onChange={(on) => form.set('showBonusSelector', on)}
          />
        </SettingsSection>
      </FormFieldset>

      <PreviewCard limits={v} campaigns={campaigns} />
      <div className="xl:col-span-2">
        <SaveBar form={form} label="Salvar limites" />
      </div>
    </div>
  )
}

// ======================================================================
// Prévia da tela de depósito (celular)
// ======================================================================

function PreviewCard({ limits, campaigns }: { limits: DepositLimits; campaigns: DepositCampaignsConfig }) {
  return (
    <aside className="min-w-0 xl:sticky xl:top-20 xl:self-start">
      <Card>
        <CardHeader icon={Smartphone} title="Prévia da tela de depósito" description="Como o jogador vê no celular. Toque nos valores para testar." />
        <CardBody>
          <DepositPhonePreview limits={limits} campaigns={campaigns} />
        </CardBody>
      </Card>
    </aside>
  )
}

function DepositPhonePreview({ limits, campaigns }: { limits: DepositLimits; campaigns: DepositCampaignsConfig }) {
  const shown = limits.showBonusSelector ? shownCampaigns(campaigns) : []
  const initialAmount = limits.defaultAmount || 0
  const initialChoice = campaigns.preselectFirst && shown[0] ? shown[0].id : 'none'
  const [amount, setAmount] = useState(initialAmount)
  const [choice, setChoice] = useState(initialChoice)
  useEffect(() => setAmount(initialAmount), [initialAmount])
  useEffect(() => setChoice(initialChoice), [initialChoice])

  const selected = shown.find((c) => c.id === choice)
  const bonus = selected ? computeBonus(amount, selected) : null
  const empty = amount <= 0
  const outOfRange = !empty && (amount < limits.min || amount > limits.max)

  return (
    <div className="mx-auto w-full max-w-[300px]" aria-label="Prévia da tela de depósito no celular">
      <div className="rounded-[2.25rem] border border-line-strong bg-surface-3 p-2 shadow-pop">
        <div className="relative overflow-hidden rounded-[1.8rem] border border-line bg-bg">
          <div className="flex items-center justify-between px-5 pb-1 pt-2.5 text-[10px] font-semibold text-fg-2">
            <span className="tnum">9:41</span>
            <span className="h-4 w-20 rounded-full bg-surface-3" aria-hidden />
            <span className="flex items-center gap-1" aria-hidden>
              <Signal size={11} />
              <Wifi size={11} />
              <BatteryFull size={13} />
            </span>
          </div>
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <ChevronLeft size={16} className="text-fg-2" aria-hidden />
            <p className="text-sm font-bold text-fg">Depositar</p>
            <span className="ml-auto rounded-full bg-surface px-2 py-0.5 text-[10.5px] font-semibold text-fg-2 ring-1 ring-line">Saldo R$ 25,40</span>
          </div>

          <div className="space-y-3 px-4 pb-4 pt-3">
            <div>
              <p className="mb-1 text-[11px] font-medium text-fg-3">Quanto você quer depositar?</p>
              <div className={cn('flex items-baseline gap-1 rounded-xl border bg-surface px-3 py-2', outOfRange ? 'border-danger' : 'border-line-strong')}>
                <span className="text-sm font-semibold text-fg-3">R$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  aria-label="Valor do depósito na prévia"
                  value={amount || ''}
                  placeholder="0,00"
                  onChange={(ev) => setAmount(Number(ev.target.value) || 0)}
                  className="w-full min-w-0 bg-transparent font-display text-2xl font-bold text-fg outline-none placeholder:text-fg-3 tnum"
                />
              </div>
              <p className={cn('mt-1 text-[10.5px]', outOfRange ? 'font-semibold text-danger' : 'text-fg-3')}>
                Mín. {brl(limits.min)} · máx. {brl(limits.max)} · até {brlCompact(limits.dailyLimit)} por dia
              </p>
            </div>

            {limits.quickAmounts.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5">
                {limits.quickAmounts.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAmount(a)}
                    title={a < limits.min || a > limits.max ? 'Fora da faixa de mínimo e máximo' : undefined}
                    className={cn(
                      'h-8 rounded-lg border text-[12px] font-semibold tnum transition-colors',
                      amount === a ? 'border-primary bg-primary/10 text-primary-text' : 'border-line bg-surface text-fg-2 hover:border-line-strong',
                      (a < limits.min || a > limits.max) && 'border-dashed opacity-50 line-through',
                    )}
                  >
                    {brl(a).replace(',00', '')}
                  </button>
                ))}
              </div>
            )}

            {limits.showBonusSelector && (
              <div>
                <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-fg-3">
                  <Sparkles size={11} aria-hidden /> Escolha seu bônus
                </p>
                <div className="space-y-1.5" role="radiogroup" aria-label="Bônus na prévia">
                  {shown.map((c) => {
                    const b = computeBonus(amount, c)
                    return (
                      <PhoneOption
                        key={c.id}
                        active={choice === c.id}
                        onClick={() => setChoice(c.id)}
                        title={c.name}
                        sub={b.eligible ? `+ ${brl(b.bonus)} de bônus · rollover ${c.rollover}x` : (b.reason ?? '')}
                        icon={Gift}
                        muted={!b.eligible}
                      />
                    )
                  })}
                  <PhoneOption active={choice === 'none'} onClick={() => setChoice('none')} title="Sem bônus" sub="Saque sem rollover de bônus" icon={Wallet} />
                </div>
              </div>
            )}

            <div className="rounded-xl bg-surface px-3 py-2.5 ring-1 ring-line">
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="text-fg-3">Você recebe</span>
                <span className="font-bold text-fg tnum">
                  {brl(amount)}
                  {bonus?.eligible && <span className="text-primary-text"> + {brl(bonus.bonus)}</span>}
                </span>
              </div>
              {bonus?.eligible && <p className="mt-1 text-[10.5px] leading-4 text-fg-3">Para sacar o bônus, aposte {brl(bonus.wagerTarget)} ({selected?.rollover}x o bônus).</p>}
            </div>

            <button
              type="button"
              disabled={empty || outOfRange}
              className="flex h-10 w-full items-center justify-center rounded-xl bg-primary text-[13px] font-bold text-primary-fg disabled:opacity-50"
              onClick={() => toast.info('Só uma prévia', { description: 'Na tela real, o PIX é gerado aqui.' })}
            >
              {empty ? 'Digite um valor' : outOfRange ? 'Valor fora do limite' : `Gerar PIX de ${brl(amount)}`}
            </button>

            <ul className="space-y-1 text-[10.5px] leading-4 text-fg-3">
              <PhoneNote icon={Timer}>O código PIX vale {limits.pixExpirationMin} min</PhoneNote>
              {limits.holderOnly && <PhoneNote icon={ShieldCheck}>Pague com uma conta no seu CPF</PhoneNote>}
              <PhoneNote icon={Landmark}>Processado por {limits.mainGateway}</PhoneNote>
            </ul>
          </div>
          <div className="mx-auto mb-2 h-1 w-24 rounded-full bg-fg-3/40" aria-hidden />
        </div>
      </div>
    </div>
  )
}

function PhoneOption({ active, onClick, title, sub, icon: Icon, muted }: { active: boolean; onClick: () => void; title: string; sub: string; icon: LucideIcon; muted?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors',
        active ? 'border-primary bg-primary/10' : 'border-line bg-surface hover:border-line-strong',
      )}
    >
      <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', active ? 'bg-primary text-primary-fg' : 'bg-surface-3 text-fg-3')}>
        <Icon size={12} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11.5px] font-semibold text-fg">{title}</span>
        <span className={cn('block truncate text-[10px]', muted ? 'text-warning' : 'text-fg-3')}>{sub}</span>
      </span>
      <span className={cn('h-3.5 w-3.5 shrink-0 rounded-full border', active ? 'border-[4px] border-primary' : 'border-line-strong')} aria-hidden />
    </button>
  )
}

function PhoneNote({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <Icon size={11} className="shrink-0" aria-hidden />
      {children}
    </li>
  )
}
