import { useMemo, useState } from 'react'
import {
  Ban,
  Calculator,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  Hourglass,
  ListChecks,
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
  Mono,
  MoneyInput,
  NumberInput,
  PageHeader,
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
import { brl, dateTime, duration, maskCpf, maskEmail, maskPhone, num, relative } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useDb } from '@/lib/store'
import { useWithdrawals } from '@/data/hooks'
import { WITHDRAWAL_STATUS_LABEL, type RiskLevel, type Withdrawal, type WithdrawalStatus } from '@/data/finance'
import { audit, usePageAccess, useSession } from '@/domain/session'
import { ceilingLabel } from '@/domain/roles'
import {
  DEFAULT_WITHDRAWAL_RULES,
  WITHDRAWAL_KEYS,
  approveWithdrawal,
  checkApprovalCeiling,
  rejectWithdrawal,
  simulateWithdrawal,
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

type Filter = 'todos' | WithdrawalStatus

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
  const canDecide = can('saques.aprovar') && role.approvalCeiling !== 0

  const now = Date.now()
  const inPeriod = useMemo(() => items.filter((w) => OPEN.includes(w.status) || inRange(w.createdAt, range)), [items, range])
  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: inPeriod.length }
    for (const w of inPeriod) c[w.status] = (c[w.status] ?? 0) + 1
    return c
  }, [inPeriod])
  const rows = filter === 'todos' ? inPeriod : inPeriod.filter((w) => w.status === filter)

  const waiting = items.filter((w) => OPEN.includes(w.status))
  const waitingLate = waiting.filter((w) => now - new Date(w.createdAt).getTime() > 24 * 3600_000)
  const sum = (list: Withdrawal[]) => list.reduce((s, w) => s + w.amount, 0)
  const approved = inPeriod.filter((w) => w.status === 'aprovado')
  const refused = inPeriod.filter((w) => w.status === 'recusado' || w.status === 'expirado')
  const cancelled = inPeriod.filter((w) => w.status === 'cancelado')

  const approve = async (w: Withdrawal) => {
    const check = checkApprovalCeiling(role, w.amount)
    if (!check.ok) {
      toast.error('Não foi possível aprovar', { description: check.message })
      return
    }
    const ok = await confirm({
      title: `Aprovar saque de ${brl(w.amount)}?`,
      description: 'O PIX é enviado na hora e não pode ser desfeito.',
      confirmLabel: 'Aprovar e pagar',
      tone: 'success',
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
    const r = approveWithdrawal(w, role, user.name)
    if (r.ok) toast.success('Saque aprovado', { description: r.message })
    else toast.error('Não foi possível aprovar', { description: r.message })
  }

  const reject = async (w: Withdrawal) => {
    const r = await confirmWithInput({
      title: `Recusar saque de ${brl(w.amount)}?`,
      description: 'O valor volta para o saldo do jogador e ele recebe o motivo por e-mail.',
      confirmLabel: 'Recusar saque',
      tone: 'danger',
      icon: XCircle,
      input: { label: 'Motivo', required: true, options: REJECT_REASONS },
    })
    if (!r.confirmed) return
    const res = rejectWithdrawal(w, role, user.name, r.value)
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
    { id: 'amount', header: 'Valor', align: 'right', sortValue: (w) => w.amount, cell: (w) => <span className="font-semibold">{brl(w.amount)}</span> },
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
      pinned: true,
      csv: (w) => w.decidedBy ?? '',
      cell: (w) =>
        OPEN.includes(w.status) ? (
          <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="success" icon={Check} onClick={() => approve(w)} disabled={!canDecide} title={!canDecide ? 'Seu cargo não decide saques' : undefined}>
              Aprovar
            </Button>
            <Button size="sm" variant="secondary" icon={X} onClick={() => reject(w)} disabled={!canDecide} className="text-danger">
              Recusar
            </Button>
          </div>
        ) : (
          <span className="text-xs text-fg-3">{w.decidedBy ? `por ${w.decidedBy}` : '—'}</span>
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
          onClick={() => setFilter('pendente')}
          active={filter === 'pendente'}
        />
        <KpiCard label="Aprovado no período" icon={CheckCircle2} tone="success" value={brl(sum(approved))} hint={`${num(approved.length)} saques pagos`} onClick={() => setFilter('aprovado')} active={filter === 'aprovado'} />
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
          title={`${waitingLate.length} saques estão em análise há mais de 24 horas`}
          action={
            <Button size="sm" onClick={() => setFilter('em_analise')}>
              Ver em análise
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
              { value: 'criado', label: 'Criados', count: counts.criado ?? 0 },
              { value: 'pendente', label: 'Pendentes', count: counts.pendente ?? 0, tone: 'warning' },
              { value: 'em_analise', label: 'Em análise (+24h)', count: counts.em_analise ?? 0, tone: 'danger' },
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

      <WithdrawalDrawer w={open} onClose={() => setOpenId(null)} onApprove={approve} onReject={reject} canDecide={canDecide} />
    </div>
  )
}

function maskPix(w: Withdrawal) {
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
}: {
  w: Withdrawal | undefined
  onClose: () => void
  onApprove: (w: Withdrawal) => void
  onReject: (w: Withdrawal) => void
  canDecide: boolean
}) {
  const { can } = useSession()
  const [revealed, setRevealed] = useState(false)
  if (!w) return null
  const isOpen = OPEN.includes(w.status)
  const reveal = () => {
    if (!can('usuarios.ver-dados')) {
      toast.error('Seu cargo não pode ver dados completos do PIX.')
      return
    }
    setRevealed(true)
    audit('revelar', `Saque #${w.id}`, `Chave PIX completa exibida para conferência`)
  }
  return (
    <Drawer
      open
      onClose={() => {
        setRevealed(false)
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
            <Button icon={X} onClick={() => onReject(w)} disabled={!canDecide} className="text-danger">
              Recusar
            </Button>
            <Button variant="success" icon={Check} onClick={() => onApprove(w)} disabled={!canDecide}>
              Aprovar {brl(w.amount)}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-6">
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
                    <Mono>{revealed ? w.pixKey : maskPix(w)}</Mono>
                    {!revealed && (
                      <button type="button" onClick={reveal} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-text hover:underline">
                        <Eye size={12} aria-hidden /> Revelar
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
                { label: 'Decidido por', value: w.decidedBy ?? '—' },
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


function Rules() {
  const { canEdit } = usePageAccess()
  const form = useSettingsForm<WithdrawalRules>(WITHDRAWAL_KEYS.rules, DEFAULT_WITHDRAWAL_RULES, {
    entity: 'Regras de saque',
    successMessage: 'Regras de saque salvas',
    validate: (v) => {
      if (v.min <= 0) return 'O valor mínimo precisa ser maior que zero.'
      if (v.maxPerRequest < v.min) return 'O valor máximo precisa ser maior que o mínimo.'
      if (v.dailyLimit < 1) return 'O limite diário precisa ser de pelo menos 1 saque.'
      if (v.autoApproveMax > v.maxPerRequest) return 'O teto da aprovação automática não pode passar do valor máximo por saque.'
      if (v.rolloverPct < 0 || v.rolloverPct > 5000) return 'Rollover precisa estar entre 0% e 5.000%.'
      return null
    },
  })
  const v = form.values
  const autoOn = v.autoApproveMax > 0
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
              <NumberInput id="r-daily" value={v.dailyLimit} onValueChange={(n) => form.set('dailyLimit', Math.round(n))} min={1} suffix="por dia" />
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
            <a href="#/campanhas/rollover" className="link">
              Campanhas › Rollover
            </a>
            .
          </Alert>
        </SettingsSection>

        <SettingsSection
          title="Aprovação automática"
          description="Saques até o teto, de risco baixo e que passam em todas as regras, são pagos sem entrar na fila."
        >
          <Switch
            label="Aprovar automaticamente saques pequenos"
            description={autoOn ? `Ligada até ${brl(v.autoApproveMax)}.` : 'Desligada: todo saque passa pela fila operacional.'}
            checked={autoOn}
            onChange={(on) => form.set('autoApproveMax', on ? Math.min(200, v.maxPerRequest) : 0)}
          />
          {autoOn && (
            <Field label="Máximo automático" htmlFor="r-auto" hint="Recomendado: até R$ 200,00 enquanto o anti-fraude estiver em calibração.">
              <MoneyInput id="r-auto" value={v.autoApproveMax} onValueChange={(n) => form.set('autoApproveMax', n)} />
            </Field>
          )}
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
              <NumberInput id="s-today" value={sim.withdrawalsToday} min={0} onValueChange={(n) => setSim((s) => ({ ...s, withdrawalsToday: Math.round(n) }))} />
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
                {result.allowed ? (result.auto ? 'Pago automaticamente' : 'Vai para a fila') : 'Bloqueado'}
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
