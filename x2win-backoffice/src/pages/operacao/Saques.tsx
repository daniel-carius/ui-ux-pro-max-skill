import { useEffect, useMemo, useState } from 'react'
import {
  Ban,
  Calculator,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  Hourglass,
  ListChecks,
  Lock,
  RotateCcw,
  Scale,
  ShieldAlert,
  SlidersHorizontal,
  Undo2,
  X,
  XCircle,
  Zap,
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
  PageLink,
  PersonCell,
  RadioCards,
  SaveBar,
  SettingsSection,
  Switch,
  Tabs,
  Tooltip,
  confirm,
  confirmWithInput,
  inRange,
  presetRange,
  toast,
  useSettingsForm,
  useTabParam,
  type Column,
  type DateRange,
  type Tone,
} from '@/components/ui'
import { brl, dateTime, duration, maskCpf, maskEmail, maskPhone, num, pixKey as fmtPixKey, plural, relative } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ApiError, isApiMode } from '@/lib/api'
import { useDb } from '@/lib/store'
import { useWithdrawals } from '@/data/hooks'
import { TEMPLATE_KEY, seedTemplates } from '@/data/campanhas-templates'
import type { WebhookTemplate } from '@/domain/campanhas-templates'
import { WITHDRAWAL_STATUS_LABEL, type RiskLevel, type Withdrawal, type WithdrawalStatus } from '@/data/finance'
import { audit, usePageAccess, useSession } from '@/domain/session'
import { ceilingLabel } from '@/domain/roles'
import {
  DEFAULT_WITHDRAWAL_RULES,
  WITHDRAWAL_KEYS,
  approveWithdrawal,
  knownPayoutHold,
  canDecideWithdrawals,
  checkApprovalCeiling,
  checkAutoApproveCeiling,
  outOfRulesKind,
  rejectWithdrawal,
  revealPixKey,
  simulateWithdrawal,
  validateWithdrawalRules,
  type WithdrawalRules,
} from '@/domain/withdrawals'

const STATUS_TONE: Record<WithdrawalStatus, Tone> = {
  criado: 'neutral',
  pendente: 'warning',
  em_analise: 'info',
  aprovado: 'success',
  recusado: 'danger',
  expirado: 'neutral',
  cancelado: 'neutral',
}

const RISK_TONE: Record<RiskLevel, Tone> = { baixo: 'success', medio: 'warning', alto: 'danger' }
const RISK_LABEL: Record<RiskLevel, string> = { baixo: 'Baixo', medio: 'Médio', alto: 'Alto' }

const REJECT_REASONS = [
  'Rollover não cumprido',
  'Conta duplicada',
  'Dados do PIX divergentes do titular',
  'Suspeita de fraude',
  'KYC pendente',
  'Outro motivo',
].map((r) => ({ value: r, label: r }))

const OPEN: WithdrawalStatus[] = ['criado', 'pendente', 'em_analise']

/** 'abertos' = criado, pendente e em análise (o card "Aguardando decisão"); 'atrasados' = abertos há mais de 24 h */
type Filter = 'todos' | 'abertos' | 'atrasados' | WithdrawalStatus

/** Quem decidiu, com o e-mail (separa pessoas com o mesmo nome). */
function deciderText(w: Withdrawal) {
  if (!w.decidedBy) return ''
  return w.decidedByEmail ? `${w.decidedBy} <${w.decidedByEmail}>` : w.decidedBy
}

/** Decisão em andamento por saque (modo API: espera a resposta do servidor). */
type Busy = Record<string, 'approve' | 'reject'>

export default function Saques() {
  const [tab, setTab] = useTabParam('fila', ['fila', 'regras'] as const)
  const { role } = useSession()
  return (
    <>
      <PageHeader
        actions={
          <Tooltip content="Valor máximo que o seu cargo pode aprovar por saque">
            <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] text-fg-2">
              <Scale size={15} className="text-fg-3" aria-hidden />
              Seu teto: <strong className="text-fg">{ceilingLabel(role)}</strong>
            </span>
          </Tooltip>
        }
      >
        <Tabs
          className="mt-5"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'fila', label: 'Fila operacional', icon: ListChecks },
            { value: 'regras', label: 'Regras de saque', icon: SlidersHorizontal },
          ]}
        />
      </PageHeader>
      {tab === 'fila' ? <Queue /> : <Rules />}
    </>
  )
}

function Queue() {
  const { items, get } = useWithdrawals()
  const { role, user, can } = useSession()
  const [range, setRange] = useState<DateRange>(() => presetRange('30d'))
  const [filter, setFilter] = useState<Filter>('todos')
  const [openId, setOpenId] = useState<string | null>(null)
  const [rules] = useDb<WithdrawalRules>(WITHDRAWAL_KEYS.rules, DEFAULT_WITHDRAWAL_RULES)
  // template "Saque pago" desligado: nenhum aviso sai na aprovação (a confirmação avisa antes, não só o resultado)
  const [templates] = useDb<WebhookTemplate[]>(TEMPLATE_KEY, seedTemplates)
  const paidNoticeOff = templates.some((t) => t.event === 'saque.pago' && t.active === false)
  const [busy, setBusy] = useState<Busy>({})
  const canDecide = can('saques.aprovar') && role.approvalCeiling !== 0

  // só no modo API a decisão espera o servidor; na demonstração ela é imediata
  const track = async <T,>(w: Withdrawal, kind: Busy[string], run: () => Promise<T>): Promise<T> => {
    if (!isApiMode()) return run()
    setBusy((b) => ({ ...b, [w.id]: kind }))
    try {
      return await run()
    } finally {
      setBusy((b) => {
        const next = { ...b }
        delete next[w.id]
        return next
      })
    }
  }

  const now = Date.now()
  const inPeriod = useMemo(() => items.filter((w) => OPEN.includes(w.status) || inRange(w.createdAt, range)), [items, range])
  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: inPeriod.length }
    for (const w of inPeriod) c[w.status] = (c[w.status] ?? 0) + 1
    return c
  }, [inPeriod])
  const isLate = (w: Withdrawal) => OPEN.includes(w.status) && now - new Date(w.createdAt).getTime() > 24 * 3600_000
  const rows =
    filter === 'todos'
      ? inPeriod
      : filter === 'abertos'
        ? inPeriod.filter((w) => OPEN.includes(w.status))
        : filter === 'atrasados'
          ? inPeriod.filter(isLate)
          : inPeriod.filter((w) => w.status === filter)

  const waiting = items.filter((w) => OPEN.includes(w.status))
  const waitingLate = waiting.filter((w) => now - new Date(w.createdAt).getTime() > 24 * 3600_000)
  const sum = (list: Withdrawal[]) => list.reduce((s, w) => s + w.amount, 0)
  const approved = inPeriod.filter((w) => w.status === 'aprovado')
  const refused = inPeriod.filter((w) => w.status === 'recusado' || w.status === 'expirado')
  const cancelled = inPeriod.filter((w) => w.status === 'cancelado')

  /** Aprovação segurada (conta bloqueada ou de rede banida): o saque continua aberto; recusar devolve o valor. */
  const holdToast = (w: Withdrawal, message: string) =>
    toast.error('Aprovação bloqueada', {
      // a mensagem do servidor já começa com "Aprovação bloqueada:" (o título não se repete)
      description: `${message.replace(/^(Aprovação|Pagamento) bloquead[ao]:\s*/i, '')} Recuse o saque se ele não for seguir.`,
      action: canDecide ? { label: 'Recusar saque', onClick: () => void reject(w) } : undefined,
      duration: 8000,
    })

  const approve = async (w: Withdrawal) => {
    if (busy[w.id]) return
    const check = checkApprovalCeiling(role, w.amount)
    if (!check.ok) {
      toast.error('Não foi possível aprovar', { description: check.message })
      return
    }
    // demonstração: conta bloqueada ou de rede banida já se sabe aqui (mesma regra do servidor); nem pede confirmação
    const hold = knownPayoutHold(w.playerId)
    if (hold) {
      holdToast(w, hold)
      return
    }
    const ok = await confirm({
      title: `Aprovar saque de ${brl(w.amount)}?`,
      description: paidNoticeOff
        ? 'Aprovar registra a decisão; não paga o PIX. O template "Saque pago" está desativado em Campanhas › Templates: nenhum aviso "saque.pago" sai, e o financeiro precisa fazer o pagamento no gateway. Não pode ser desfeito.'
        : 'Aprovar registra a decisão e põe na fila o aviso "saque.pago" para os sistemas cadastrados em Webhooks; não paga o PIX. Sem destino ativo, o financeiro faz o pagamento no gateway (o resultado avisa). Não pode ser desfeito.',
      tone: paidNoticeOff ? 'warning' : 'success',
      confirmLabel: 'Aprovar saque',
      icon: CheckCircle2,
      details: (
        <DescriptionList
          columns={2}
          items={[
            { label: 'Jogador', value: w.playerName },
            { label: 'Chave PIX', value: `${w.pixKeyType} · ${maskPix(w)}` },
            { label: 'Risco', value: <Badge tone={RISK_TONE[w.risk.level]} dot>{`${RISK_LABEL[w.risk.level]} · ${w.risk.score}`}</Badge> },
            { label: 'Valor líquido', value: brl(Math.max(0, w.amount - rules.fee)) },
          ]}
        />
      ),
    })
    if (!ok) return
    const r = await track(w, 'approve', () => approveWithdrawal(w, role, { id: user.id, name: user.name, email: user.email }))
    if (r.ok) {
      toast.success('Saque aprovado', { description: r.message })
      return
    }
    // regras do servidor: o saque continua aberto (não é conflito de versão); explica o próximo passo
    if (r.code === 'jogador_bloqueado') {
      // aprovar não paga o PIX: o que a conta bloqueada segura é a aprovação
      holdToast(w, r.message)
    } else if (r.code === 'fora_das_regras') {
      const kind = outOfRulesKind(r.details)
      toast.error('Fora das regras de saque', {
        description: `${r.message} ${
          kind === 'dailyLimit' ? 'Aguarde a janela de 24 horas ou recuse o saque.' : 'Recuse o saque ou revise o valor máximo nas regras de saque.'
        }`,
        duration: 8000,
      })
    } else if (r.code === 'segregacao_funcoes') {
      toast.warning('Outra pessoa precisa aprovar', { description: r.message, duration: 8000 })
    } else {
      toast.error('Não foi possível aprovar', { description: r.message })
    }
  }

  const reject = async (w: Withdrawal) => {
    if (busy[w.id]) return
    const r = await confirmWithInput({
      title: `Recusar saque de ${brl(w.amount)}?`,
      description:
        'Recusar registra a decisão e põe na fila o aviso "saque.rejeitado" para os sistemas cadastrados em Webhooks. A devolução do valor ao saldo do jogador é feita pela plataforma de jogo; o painel não envia e-mail.',
      confirmLabel: 'Recusar saque',
      tone: 'danger',
      icon: XCircle,
      input: { label: 'Motivo', required: true, options: REJECT_REASONS },
    })
    if (!r.confirmed) return
    const res = await track(w, 'reject', () => rejectWithdrawal(w, role, { id: user.id, name: user.name, email: user.email }, r.value))
    if (res.ok) toast.success('Saque recusado', { description: res.message })
    else toast.error('Não foi possível recusar', { description: res.message })
  }

  const columns: Column<Withdrawal>[] = [
    {
      id: 'id',
      header: 'Solicitação',
      pinned: true,
      sortValue: (w) => w.createdAt,
      csv: (w) => w.id,
      cell: (w) => {
        const late = OPEN.includes(w.status) && now - new Date(w.createdAt).getTime() > 24 * 3600_000
        return (
          <div>
            <Mono className="font-medium text-fg">{w.id}</Mono>
            <p className={cn('mt-0.5 flex items-center gap-1 text-xs', late ? 'font-semibold text-danger' : 'text-fg-3')}>
              <Clock size={11} aria-hidden />
              {OPEN.includes(w.status) ? `aguarda ${duration(now - new Date(w.createdAt).getTime())}` : relative(w.createdAt)}
            </p>
          </div>
        )
      },
    },
    {
      id: 'player',
      header: 'Usuário',
      minWidth: 200,
      sortValue: (w) => w.playerName,
      cell: (w) => <PersonCell name={w.playerName} sub={maskEmail(w.playerEmail)} />,
    },
    { id: 'amount', money: true, header: 'Valor', align: 'right', sortValue: (w) => w.amount, cell: (w) => <span className="font-semibold">{brl(w.amount)}</span> },
    {
      id: 'risk',
      header: 'Risco',
      sortValue: (w) => w.risk.score,
      csv: (w) => `${RISK_LABEL[w.risk.level]} (${w.risk.score})`,
      cell: (w) => (
        <Tooltip content={w.risk.reasons.length ? w.risk.reasons.join(' · ') : 'Sem sinais de risco'}>
          <span className="inline-flex items-center gap-1.5">
            <Badge tone={RISK_TONE[w.risk.level]} icon={w.risk.level === 'alto' ? ShieldAlert : undefined}>
              {RISK_LABEL[w.risk.level]}
            </Badge>
            <span className="text-xs text-fg-3 tnum">{w.risk.score}</span>
          </span>
        </Tooltip>
      ),
    },
    { id: 'reference', header: 'Referência', defaultHidden: true, csv: (w) => w.reference, cell: (w) => <Mono className="block max-w-[160px] truncate">{w.reference}</Mono> },
    {
      id: 'status',
      header: 'Status',
      sortValue: (w) => w.status,
      csv: (w) => WITHDRAWAL_STATUS_LABEL[w.status],
      cell: (w) => (
        <Badge tone={STATUS_TONE[w.status]} dot>
          {WITHDRAWAL_STATUS_LABEL[w.status]}
        </Badge>
      ),
    },
    { id: 'updatedAt', header: 'Atualizado', sortValue: (w) => w.updatedAt, csv: (w) => dateTime(w.updatedAt), cell: (w) => <span className="whitespace-nowrap text-[13px] text-fg-2">{dateTime(w.updatedAt)}</span> },
    {
      id: 'decision',
      header: 'Decisão',
      // no CSV a coluna diz quem decidiu (vazia nos abertos); os botões ficam só na tela
      label: 'Decidido por',
      pinned: true,
      csv: deciderText,
      cell: (w) =>
        OPEN.includes(w.status) ? (
          <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              variant="success"
              icon={Check}
              onClick={() => approve(w)}
              disabled={!canDecide || !!busy[w.id]}
              loading={busy[w.id] === 'approve'}
              title={!canDecide ? 'Seu cargo não decide saques' : undefined}
            >
              Aprovar
            </Button>
            <Button size="sm" variant="secondary" icon={X} onClick={() => reject(w)} disabled={!canDecide || !!busy[w.id]} loading={busy[w.id] === 'reject'} className="text-danger">
              Recusar
            </Button>
          </div>
        ) : w.decidedBy ? (
          <span className="block text-xs text-fg-3">
            por {w.decidedBy}
            {w.decidedByEmail && <span className="block text-[11px]">{w.decidedByEmail}</span>}
          </span>
        ) : (
          <span className="text-xs text-fg-3">—</span>
        ),
    },
  ]

  const open = openId ? get(openId) : undefined

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-fg-3">Cards e lista mostram o período escolhido. Saques abertos aparecem sempre.</p>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      <section aria-label="Resumo da fila" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <KpiCard
          label="Aguardando decisão"
          icon={Hourglass}
          tone="warning"
          value={brl(sum(waiting))}
          hint={
            <>
              {num(waiting.length)} saques · <span className={waitingLate.length ? 'font-semibold text-danger' : ''}>{waitingLate.length} há +24 h</span>
            </>
          }
          onClick={() => setFilter('abertos')}
          active={filter === 'abertos'}
        />
        <KpiCard label="Aprovado no período" icon={CheckCircle2} tone="success" value={brl(sum(approved))} hint={`${plural(approved.length, 'saque aprovado', 'saques aprovados')} (aprovar não paga o PIX)`} onClick={() => setFilter('aprovado')} active={filter === 'aprovado'} />
        <KpiCard label="Recusado ou expirado" icon={Ban} tone="danger" value={brl(sum(refused))} hint={`${num(refused.length)} saques`} onClick={() => setFilter('recusado')} active={filter === 'recusado'} />
        <KpiCard label="Cancelado pelo jogador" icon={Undo2} tone="neutral" value={brl(sum(cancelled))} hint="valor devolvido ao saldo" onClick={() => setFilter('cancelado')} active={filter === 'cancelado'} />
        <KpiCard
          label="Aprovação automática"
          icon={Zap}
          tone={rules.autoApproveMax > 0 ? 'primary' : 'neutral'}
          value={rules.autoApproveMax > 0 ? `até ${brl(rules.autoApproveMax)}` : 'Desligada'}
          hint={rules.autoApproveMax > 0 ? 'só risco baixo' : 'todo saque passa pela fila'}
        />
      </section>

      {waitingLate.length > 0 && (
        <Alert
          tone="warning"
          title={`${plural(waitingLate.length, 'saque está aberto', 'saques estão abertos')} há mais de 24 horas`}
          action={
            <Button size="sm" onClick={() => setFilter('atrasados')}>
              Ver os atrasados
            </Button>
          }
        >
          Jogadores esperando muito tendem a abrir reclamação. Priorize os de risco baixo.
        </Alert>
      )}

      <DataTable
        caption="Fila de saques"
        rows={rows}
        columns={columns}
        rowKey={(w) => w.id}
        searchText={(w) => `${w.id} ${w.playerName} ${w.playerEmail} ${w.playerId}`}
        searchPlaceholder="Buscar por ID, usuário ou e-mail"
        initialSort={{ id: 'id', dir: 'desc' }}
        exportName="saques"
        onExport={(n) => audit('exportar', 'Saques', `Exportação CSV de ${n} saques`)}
        onRowClick={(w) => setOpenId(w.id)}
        resetKey={filter}
        rowClassName={(w) => (OPEN.includes(w.status) && now - new Date(w.createdAt).getTime() > 24 * 3600_000 ? 'bg-danger/[0.03]' : undefined)}
        toolbar={
          <ChipFilter<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'todos', label: 'Todos', count: counts.todos ?? 0 },
              { value: 'abertos', label: 'Abertos', count: waiting.length, tone: 'warning' },
              { value: 'atrasados', label: 'Abertos há +24 h', count: waitingLate.length, tone: 'danger' },
              { value: 'criado', label: 'Criados', count: counts.criado ?? 0 },
              { value: 'pendente', label: 'Pendentes', count: counts.pendente ?? 0 },
              { value: 'em_analise', label: 'Em análise', count: counts.em_analise ?? 0 },
              { value: 'aprovado', label: 'Aprovados', count: counts.aprovado ?? 0 },
              { value: 'recusado', label: 'Recusados', count: counts.recusado ?? 0 },
              { value: 'expirado', label: 'Expirados', count: counts.expirado ?? 0 },
              { value: 'cancelado', label: 'Cancelados', count: counts.cancelado ?? 0 },
            ]}
            className="max-w-full"
          />
        }
        empty={{ title: 'Nenhum saque neste filtro', description: 'Troque o status ou o período para ver outros saques.' }}
      />

      <WithdrawalDrawer w={open} onClose={() => setOpenId(null)} onApprove={approve} onReject={reject} canDecide={canDecide} busy={open ? busy[open.id] : undefined} />
    </div>
  )
}

function maskPix(w: Withdrawal) {
  // modo API: a lista já chega do servidor com a chave mascarada
  if (isApiMode()) return w.pixKey
  if (w.pixKeyType === 'CPF') return maskCpf(w.pixKey)
  if (w.pixKeyType === 'E-mail') return maskEmail(w.pixKey)
  if (w.pixKeyType === 'Celular') return maskPhone(w.pixKey)
  return `${w.pixKey.slice(0, 6)}…${w.pixKey.slice(-4)}`
}

function WithdrawalDrawer({
  w,
  onClose,
  onApprove,
  onReject,
  canDecide,
  busy,
}: {
  w: Withdrawal | undefined
  onClose: () => void
  onApprove: (w: Withdrawal) => void
  onReject: (w: Withdrawal) => void
  canDecide: boolean
  busy?: Busy[string]
}) {
  const { can } = useSession()
  /** chave revelada (por saque, para não vazar ao abrir outro) */
  const [revealedKey, setRevealedKey] = useState<{ id: string; pixKey: string } | null>(null)
  const [revealing, setRevealing] = useState(false)
  if (!w) return null
  const isOpen = OPEN.includes(w.status)
  const hold = isOpen ? knownPayoutHold(w.playerId) : null
  const revealed = revealedKey?.id === w.id ? revealedKey.pixKey : null
  const reveal = async () => {
    if (!can('usuarios.ver-dados')) {
      toast.error('Seu cargo não pode ver dados completos do PIX.')
      return
    }
    if (revealing) return
    setRevealing(true)
    try {
      const pixKey = await revealPixKey(w)
      setRevealedKey({ id: w.id, pixKey })
    } catch (e) {
      toast.error('Não foi possível revelar a chave PIX', { description: e instanceof ApiError ? e.message : 'Tente de novo em instantes.' })
    } finally {
      setRevealing(false)
    }
  }
  return (
    <Drawer
      open
      onClose={() => {
        setRevealedKey(null)
        onClose()
      }}
      title={`Saque ${w.id}`}
      description={`Solicitado em ${dateTime(w.createdAt)} · ${relative(w.createdAt)}`}
      headerExtra={
        <Badge tone={STATUS_TONE[w.status]} dot size="md">
          {WITHDRAWAL_STATUS_LABEL[w.status]}
        </Badge>
      }
      footer={
        isOpen ? (
          <>
            <Button icon={X} onClick={() => onReject(w)} disabled={!canDecide || !!busy} loading={busy === 'reject'} className="text-danger">
              Recusar
            </Button>
            <Button variant="success" icon={Check} onClick={() => onApprove(w)} disabled={!canDecide || !!busy} loading={busy === 'approve'}>
              Aprovar {brl(w.amount)}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-6">
        {/* demonstração: a conta bloqueada (ou de rede banida) já é conhecida; o servidor recusa a aprovação do mesmo jeito */}
        {isOpen && hold && (
          <Alert tone="danger" title="Aprovação bloqueada">
            {hold} Recuse o saque se ele não for seguir.
          </Alert>
        )}
        <div className="rounded-xl bg-surface-2 p-4">
          <p className="text-xs text-fg-3">Valor solicitado</p>
          <p className="mt-1 font-display text-3xl font-bold text-fg">{brl(w.amount)}</p>
          <p className="mt-1 text-[13px] text-fg-3">Taxa {brl(w.fee)} · líquido {brl(w.amount - w.fee)}</p>
        </div>
        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Jogador</h3>
          <PersonCell name={w.playerName} sub={`ID ${w.playerId} · ${maskEmail(w.playerEmail)}`} />
        </section>
        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Pagamento</h3>
          <DescriptionList
            items={[
              { label: 'Tipo de chave', value: w.pixKeyType },
              {
                label: 'Chave PIX',
                value: (
                  <span className="flex items-center gap-2">
                    <Mono>{revealed !== null ? fmtPixKey(w.pixKeyType, revealed) : maskPix(w)}</Mono>
                    {revealed === null && !can('usuarios.ver-dados') && (
                      <span className="inline-flex items-center gap-1 text-xs text-fg-3" title="Seu cargo vê a chave mascarada (LGPD)">
                        <Lock size={11} aria-hidden /> mascarada
                      </span>
                    )}
                    {revealed === null && can('usuarios.ver-dados') && (
                      <button
                        type="button"
                        onClick={reveal}
                        disabled={revealing}
                        aria-busy={revealing || undefined}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary-text hover:underline disabled:cursor-wait disabled:opacity-60"
                      >
                        <Eye size={12} aria-hidden /> {revealing ? 'Revelando…' : 'Revelar'}
                      </button>
                    )}
                  </span>
                ),
              },
              { label: 'Referência (E2E)', value: <Mono className="break-all">{w.reference}</Mono>, full: true },
            ]}
          />
        </section>
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
            Risco <Badge tone={RISK_TONE[w.risk.level]}>{`${RISK_LABEL[w.risk.level]} · ${w.risk.score}/100`}</Badge>
          </h3>
          {w.risk.reasons.length ? (
            <ul className="space-y-2">
              {w.risk.reasons.map((r) => (
                <li key={r} className="flex items-start gap-2 text-[13px] text-fg-2">
                  <ShieldAlert size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden /> {r}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-fg-3">Nenhum sinal de risco encontrado.</p>
          )}
        </section>
        {(w.decidedBy || w.decisionNote) && (
          <section>
            <h3 className="mb-3 text-sm font-semibold text-fg">Decisão</h3>
            <DescriptionList
              items={[
                {
                  label: 'Decidido por',
                  value: w.decidedBy ? (
                    <span>
                      {w.decidedBy}
                      {w.decidedByEmail && <span className="block text-xs text-fg-3">{w.decidedByEmail}</span>}
                    </span>
                  ) : (
                    '—'
                  ),
                },
                { label: 'Em', value: dateTime(w.updatedAt) },
                ...(w.decisionNote ? [{ label: 'Motivo', value: w.decisionNote, full: true }] : []),
              ]}
            />
          </section>
        )}
      </div>
    </Drawer>
  )
}


/**
 * Ligar ou mudar a aprovação automática equivale a aprovar saques até esse valor: só quem decide saques, e nunca
 * acima do próprio teto (o servidor responde 403 teto_excedido). Desligar (0) ou manter o valor salvo vale sempre.
 */
function autoApproveError(role: Parameters<typeof checkAutoApproveCeiling>[0], next: number, saved: number) {
  const c = checkAutoApproveCeiling(role, next, saved)
  return c.ok ? null : c.message
}

const isCeilingError = (e: ApiError) => e.status === 403 && e.code === 'teto_excedido'

function Rules() {
  const { canEdit } = usePageAccess()
  const { role } = useSession()
  const [savedRules] = useDb<WithdrawalRules>(WITHDRAWAL_KEYS.rules, DEFAULT_WITHDRAWAL_RULES)
  const form = useSettingsForm<WithdrawalRules>(WITHDRAWAL_KEYS.rules, DEFAULT_WITHDRAWAL_RULES, {
    entity: 'Regras de saque',
    successMessage: 'Regras de saque salvas',
    fieldLabels: {
      min: 'valor mínimo',
      maxPerRequest: 'valor máximo',
      rolloverPct: 'rollover exigido',
      fee: 'taxa fixa',
      dailyLimit: 'limite diário',
      autoApproveMax: 'aprovação automática',
      rolloverMode: 'modo de contagem',
      rolloverBets: 'apostas que contam',
    },
    // mesma validação do servidor (shared/withdrawals): limites, centavos e teto da aprovação automática
    validate: (r) => validateWithdrawalRules(r) ?? autoApproveError(role, r.autoApproveMax, savedRules.autoApproveMax),
    // modo API: 403 teto_excedido (cargo no servidor diferente do da sessão) aparece no campo do máximo automático
    quiet: isCeilingError,
  })
  const v = form.values
  // ligada pelo switch, mesmo com o campo vazio enquanto a pessoa digita (vazio vira 0 no campo de dinheiro, e
  // "0 = desligada" escondia o campo e desligava o switch no meio da digitação)
  const [autoTyping, setAutoTyping] = useState(false)
  useEffect(() => {
    // voltou ao salvo (descartar, salvar) com a automática desligada: o switch acompanha, a não ser que a pessoa
    // esteja no campo (apagou o valor para digitar outro)
    if (!form.dirty && v.autoApproveMax === 0 && document.activeElement?.id !== 'r-auto') setAutoTyping(false)
  }, [form.dirty, v.autoApproveMax])
  const autoOn = v.autoApproveMax > 0 || autoTyping
  const autoErr = autoApproveError(role, v.autoApproveMax, form.saved.autoApproveMax) ?? (form.error && isCeilingError(form.error) ? form.error.message : null)
  // sem decidir saques, só dá para desligar ou manter o valor salvo
  const canTurnOnAuto = canDecideWithdrawals(role)
  const centsErr = (n: number) => (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6 ? 'Use no máximo 2 casas decimais.' : null)
  const [sim, setSim] = useState({ amount: 150, withdrawalsToday: 0, deposited: 200, wagered: 120 })
  const result = simulateWithdrawal(v, sim)

  return (
    <div className="space-y-5">
      <FormFieldset readOnly={!canEdit}>
        <SettingsSection title="Limites" description="Valem para todo saque pedido no site. O jogador vê a mensagem do limite antes de confirmar.">
          <FormGrid>
            <Field label="Valor mínimo" htmlFor="r-min" hint="Abaixo disso o botão de sacar fica bloqueado.">
              <MoneyInput id="r-min" value={v.min} onValueChange={(n) => form.set('min', n)} />
            </Field>
            <Field label="Valor máximo por solicitação" htmlFor="r-max" error={v.maxPerRequest < v.min ? 'Precisa ser maior que o mínimo.' : null}>
              <MoneyInput id="r-max" value={v.maxPerRequest} onValueChange={(n) => form.set('maxPerRequest', n)} invalid={v.maxPerRequest < v.min} />
            </Field>
            <Field label="Limite diário" htmlFor="r-daily" hint="Quantidade de saques por jogador por dia.">
              <NumberInput integer id="r-daily" value={v.dailyLimit} onValueChange={(n) => form.set('dailyLimit', Math.round(n))} min={1} suffix="por dia" />
            </Field>
            <Field label="Taxa fixa do saque" htmlFor="r-fee" hint="Descontada do valor pago. R$ 0,00 = sem taxa.">
              <MoneyInput id="r-fee" value={v.fee} onValueChange={(n) => form.set('fee', n)} />
            </Field>
          </FormGrid>
        </SettingsSection>

        <SettingsSection
          title="Rollover"
          description="Quanto o jogador precisa apostar, em relação ao que depositou, antes de sacar. 0% desliga a exigência."
        >
          <Field label="Rollover exigido" htmlFor="r-roll" hint={v.rolloverPct === 0 ? 'Desligado: o jogador saca sem apostar.' : `Quem depositou R$ 100 precisa apostar ${brl(v.rolloverPct)} antes de sacar.`}>
            <NumberInput id="r-roll" value={v.rolloverPct} onValueChange={(n) => form.set('rolloverPct', n)} min={0} suffix="%" />
          </Field>
          <Field label="Modo de contagem">
            <RadioCards
              name="Modo de contagem"
              value={v.rolloverMode}
              onChange={(m) => form.set('rolloverMode', m)}
              options={[
                { value: 'acumulado', label: 'Acumulado', description: 'Tudo o que o jogador apostou sobre tudo o que depositou.' },
                { value: 'por_deposito', label: 'Por depósito', description: 'Cada depósito tem seu rollover. Só contam apostas feitas depois dele.' },
              ]}
            />
          </Field>
          <Field label="Quais apostas contam">
            <RadioCards
              name="Quais apostas contam"
              columns={3}
              value={v.rolloverBets}
              onChange={(m) => form.set('rolloverBets', m)}
              options={[
                { value: 'todas', label: 'Toda aposta', description: 'Padrão.' },
                { value: 'saldo_real', label: 'Só saldo real', description: 'Apostas pagas com dinheiro depositado.' },
                { value: 'bonus', label: 'Só a parte bônus', description: 'Apostas pagas com saldo bônus.' },
              ]}
            />
          </Field>
          <Alert tone="info">
            O peso de cada tipo de jogo (slots, ao vivo, crash) é definido em{' '}
            <PageLink to="/campanhas/rollover" className="link">
              Campanhas › Rollover
            </PageLink>
            .
          </Alert>
        </SettingsSection>

        <SettingsSection
          title="Aprovação automática"
          description="Saques até o teto, de risco baixo e que passam em todas as regras, são aprovados sem entrar na fila."
        >
          <Switch
            label="Aprovar automaticamente saques pequenos"
            description={autoOn ? (v.autoApproveMax > 0 ? `Ligada até ${brl(v.autoApproveMax)}.` : 'Informe o valor máximo abaixo.') : 'Desligada: todo saque passa pela fila operacional.'}
            checked={autoOn}
            disabled={!autoOn && !canTurnOnAuto}
            title={!autoOn && !canTurnOnAuto ? `O cargo ${role.name} não aprova saques e por isso não liga a aprovação automática.` : undefined}
            onChange={(on) => {
              // ao religar, volta ao valor salvo se houver; senão, o menor entre R$ 200,00, o máximo por saque e o teto do cargo
              const ceiling = role.approvalCeiling ?? Number.POSITIVE_INFINITY
              const start = form.saved.autoApproveMax > 0 ? form.saved.autoApproveMax : Math.min(200, v.maxPerRequest, ceiling)
              setAutoTyping(on)
              form.set('autoApproveMax', on ? start : 0)
            }}
          />
          {autoOn && (
            <Field
              label="Máximo automático"
              htmlFor="r-auto"
              error={autoErr ?? centsErr(v.autoApproveMax) ?? (v.autoApproveMax <= 0 ? 'Informe o valor máximo. Salvar com o campo vazio (ou zero) desliga a aprovação automática.' : null)}
              hint={`Recomendado: até R$ 200,00 enquanto o anti-fraude estiver em calibração.${
                canTurnOnAuto && role.approvalCeiling !== null ? ` Não passa do teto do seu cargo (${brl(role.approvalCeiling)}).` : ''
              }`}
            >
              <MoneyInput
                id="r-auto"
                value={v.autoApproveMax}
                invalid={!!autoErr}
                onValueChange={(n) => {
                  setAutoTyping(true)
                  form.set('autoApproveMax', n)
                }}
              />
            </Field>
          )}
          {!canTurnOnAuto && <p className="text-xs text-fg-3">Só quem aprova saques liga ou muda a aprovação automática. Desligar vale para qualquer pessoa que edita as regras.</p>}
        </SettingsSection>
      </FormFieldset>

      <Card>
        <CardHeader
          icon={Calculator}
          title="Simular um saque"
          description="Teste as regras do rascunho antes de salvar. Nada é enviado."
          actions={
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setSim({ amount: 150, withdrawalsToday: 0, deposited: 200, wagered: 120 })}>
              Limpar
            </Button>
          }
        />
        <CardBody className="grid gap-6 lg:grid-cols-2">
          <FormGrid>
            <Field label="Valor do saque" htmlFor="s-amount">
              <MoneyInput id="s-amount" value={sim.amount} onValueChange={(n) => setSim((s) => ({ ...s, amount: n }))} />
            </Field>
            <Field label="Saques já feitos hoje" htmlFor="s-today">
              <NumberInput integer id="s-today" value={sim.withdrawalsToday} min={0} onValueChange={(n) => setSim((s) => ({ ...s, withdrawalsToday: Math.round(n) }))} />
            </Field>
            <Field label="Total depositado" htmlFor="s-dep">
              <MoneyInput id="s-dep" value={sim.deposited} onValueChange={(n) => setSim((s) => ({ ...s, deposited: n }))} />
            </Field>
            <Field label="Total apostado" htmlFor="s-wag">
              <MoneyInput id="s-wag" value={sim.wagered} onValueChange={(n) => setSim((s) => ({ ...s, wagered: n }))} />
            </Field>
          </FormGrid>
          <div className="rounded-xl border border-line p-4" aria-live="polite">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-fg">Resultado</p>
              <Badge tone={result.allowed ? (result.auto ? 'success' : 'info') : 'danger'} size="md">
                {result.allowed ? (result.auto ? 'Aprovado automaticamente' : 'Vai para a fila') : 'Bloqueado'}
              </Badge>
            </div>
            <ul className="space-y-2">
              {result.checks.map((c) => (
                <li key={c.label} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="flex items-center gap-2 text-fg-2">
                    {c.ok ? <CheckCircle2 size={15} className="text-success" aria-label="ok" /> : <XCircle size={15} className="text-danger" aria-label="bloqueia" />}
                    {c.label}
                  </span>
                  <span className="text-fg-3">{c.detail}</span>
                </li>
              ))}
            </ul>
            {result.allowed && <p className="mt-3 border-t border-line pt-3 text-[13px] text-fg-2">O jogador recebe <strong className="text-fg">{brl(result.net)}</strong>.</p>}
          </div>
        </CardBody>
      </Card>

      <SaveBar form={form} label="Salvar regras" />
    </div>
  )
}
