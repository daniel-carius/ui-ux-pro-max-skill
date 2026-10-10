import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarRange, CircleDollarSign, HandCoins, Scale, TrendingUp, UserPlus, Users } from 'lucide-react'
import { BarsChart, FunnelChart } from '@/components/charts'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  DescriptionList,
  Drawer,
  EmptyState,
  Field,
  Formula,
  Input,
  KpiCard,
  NoDataSource,
  PageHeader,
  PersonCell,
  Segmented,
  inRange,
  presetRange,
  previousRange,
  rangeLabel,
  toast,
  type Column,
  type DateRange,
  type PresetId,
} from '@/components/ui'
import { brl, brlCompact, maskEmail, num, numCompact, pct } from '@/lib/format'
import { cn } from '@/lib/cn'
import { isApiMode } from '@/lib/api'
import { NOW, dayKey, endOfDay, startOfDay } from '@/data/now'
import { useAffiliates } from '@/data/hooks'
import { addStats, affiliateStats, oldestAffiliateDay, type PeriodStats } from '@/data/afiliados'
import type { Affiliate } from '@/data/players'
import { audit } from '@/domain/session'
import {
  commissionFor,
  contractLabel,
  monthsInPeriod,
  networkCommission,
  periodDays,
  round2,
  scaleCap,
  useAffiliateWithdrawals,
  useCommissionRules,
  type CommissionRules,
} from '@/domain/afiliados'
import { AffiliateTypeBadge, StatTile } from './_shared'

type Preset = 'mes' | 'mes_passado' | '7d' | '30d'
const PRESETS: { value: Preset; label: string }[] = [
  { value: 'mes', label: 'Este mês' },
  { value: 'mes_passado', label: 'Mês passado' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
]

interface MemberRow extends PeriodStats {
  affiliate: Affiliate
  commission: number
  capped: boolean
}

interface ManagerRow extends PeriodStats {
  id: string
  manager: Affiliate
  members: MemberRow[]
  subs: number
  managerCommission: number
  subsCommission: number
  commission: number
  capped: boolean
  result: number
  paid: number
  toPay: number
}

/** Resultado da rede de cada gerente no período (gerente + subafiliados). */
function buildRows(affiliates: Affiliate[], rules: CommissionRules, range: DateRange, paidByAffiliate: Map<string, number>): ManagerRow[] {
  const fromKey = dayKey(range.from)
  const toKey = dayKey(range.to)
  const days = periodDays(range.from, range.to)
  return affiliates
    .filter((a) => a.type === 'Manager')
    .map((m) => {
      const subs = affiliates.filter((a) => a.managerId === m.id)
      const own = affiliateStats(m, fromKey, toKey)
      const members: MemberRow[] = subs.map((a) => {
        const st = affiliateStats(a, fromKey, toKey)
        const rule = rules[a.type]
        const c = commissionFor({ ...rule, cap: scaleCap(rule.cap, days) }, { depositors: st.ftd, ggr: st.ggr })
        return { ...st, affiliate: a, commission: c.final, capped: c.capped }
      })
      const network = members.reduce<PeriodStats>((acc, x) => addStats(acc, x), own)
      const mc = networkCommission(network, { cpa: m.cpa, revShare: m.revShare }, rules.Manager.cap, days)
      const managerCommission = m.status === 'ativo' ? mc.commission : 0
      const subsCommission = round2(members.reduce((s, x) => s + x.commission, 0))
      const commission = round2(managerCommission + subsCommission)
      const ids = [m.id, ...subs.map((s) => s.id)]
      const paid = round2(ids.reduce((s, id) => s + (paidByAffiliate.get(id) ?? 0), 0))
      return {
        id: m.id,
        manager: m,
        members: [{ ...own, affiliate: m, commission: managerCommission, capped: mc.capped }, ...members],
        subs: subs.length,
        ...network,
        managerCommission,
        subsCommission,
        commission,
        capped: mc.capped,
        result: round2(network.ggr - commission),
        paid,
        toPay: round2(Math.max(0, commission - paid)),
      }
    })
}

function delta(cur: number, prev: number) {
  if (!prev) return null
  return (cur - prev) / Math.abs(prev)
}

export default function AfiliadosVisaoGeral() {
  return isApiMode() ? <ApiVisaoGeral /> : <DemoVisaoGeral />
}

/**
 * Modo API: cliques, cadastros, FTD, GGR e comissão por gerente vêm do serviço de métricas de afiliados da plataforma,
 * ainda não conectado. A série gerada no navegador não aparece como dado real.
 */
function ApiVisaoGeral() {
  return (
    <>
      <PageHeader />
      <NoDataSource
        title="Desempenho dos afiliados ainda sem fonte de dados"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link to="/system/programa-afiliados/saques" className="link text-[13px]">
              Saques de afiliados
            </Link>
            <span className="text-fg-3" aria-hidden>
              ·
            </span>
            <Link to="/analysis/leads" className="link text-[13px]">
              Indicados
            </Link>
          </div>
        }
      >
        Cliques, cadastros, FTD, GGR da rede, comissões e valor a pagar por gerente vêm do serviço de métricas de afiliados da plataforma de
        jogo, que ainda não está conectado a este painel. Os saques de afiliados e os jogadores indicados estão nas telas do servidor.
      </NoDataSource>
    </>
  )
}

function DemoVisaoGeral() {
  const { items: affiliates } = useAffiliates()
  const { items: withdrawals } = useAffiliateWithdrawals()
  const rules = useCommissionRules()
  const [range, setRange] = useState<DateRange>(() => presetRange('mes'))
  const [draft, setDraft] = useState(() => ({ from: dayKey(range.from), to: dayKey(range.to) }))
  const [openId, setOpenId] = useState<string | null>(null)

  const applyPreset = (p: Preset) => {
    const r = presetRange(p as PresetId)
    setRange(r)
    setDraft({ from: dayKey(r.from), to: dayKey(r.to) })
  }

  const applyCustom = () => {
    const oldest = oldestAffiliateDay()
    const today = dayKey(NOW)
    if (!draft.from || !draft.to) return toast.error('Informe as duas datas.')
    if (draft.from > draft.to) return toast.error('Período inválido', { description: 'A data “de” precisa ser antes da data “até”.' })
    if (draft.to > today) return toast.error('Período inválido', { description: 'A data “até” não pode passar de hoje.' })
    if (draft.from < oldest) return toast.error('Fora do histórico', { description: 'A base guarda os últimos 400 dias de desempenho dos afiliados.' })
    setRange({ from: startOfDay(new Date(`${draft.from}T00:00:00`)), to: endOfDay(new Date(`${draft.to}T00:00:00`)), preset: 'custom' })
  }

  const paidIn = (r: DateRange) => {
    const map = new Map<string, number>()
    for (const w of withdrawals) {
      if (w.status !== 'pago' || !w.decidedAt || !inRange(w.decidedAt, r)) continue
      map.set(w.affiliateId, (map.get(w.affiliateId) ?? 0) + w.amount)
    }
    return map
  }

  const rows = useMemo(() => buildRows(affiliates, rules, range, paidIn(range)), [affiliates, rules, range, withdrawals]) // eslint-disable-line react-hooks/exhaustive-deps
  const prevRows = useMemo(() => buildRows(affiliates, rules, previousRange(range), paidIn(previousRange(range))), [affiliates, rules, range, withdrawals]) // eslint-disable-line react-hooks/exhaustive-deps

  const sum = (list: ManagerRow[], k: keyof Pick<ManagerRow, 'clicks' | 'signups' | 'ftd' | 'deposits' | 'ggr' | 'commission' | 'result' | 'toPay' | 'paid'>) =>
    round2(list.reduce((s, r) => s + r[k], 0))
  const t = {
    clicks: sum(rows, 'clicks'),
    signups: sum(rows, 'signups'),
    ftd: sum(rows, 'ftd'),
    deposits: sum(rows, 'deposits'),
    ggr: sum(rows, 'ggr'),
    commission: sum(rows, 'commission'),
    result: sum(rows, 'result'),
    toPay: sum(rows, 'toPay'),
    paid: sum(rows, 'paid'),
  }
  const p = { signups: sum(prevRows, 'signups'), ggr: sum(prevRows, 'ggr'), commission: sum(prevRows, 'commission'), result: sum(prevRows, 'result') }
  const days = periodDays(range.from, range.to)
  const draftChanged = draft.from !== dayKey(range.from) || draft.to !== dayKey(range.to)

  const chartData = rows.map((r) => ({
    name: r.manager.name.split(' ')[0],
    ggr: r.ggr,
    commission: r.commission,
    result: r.result,
  }))

  const columns: Column<ManagerRow>[] = [
    {
      id: 'manager',
      header: 'Gerente',
      pinned: true,
      minWidth: 200,
      sortValue: (r) => r.manager.name,
      csv: (r) => r.manager.name,
      cell: (r) => (
        <PersonCell
          name={r.manager.name}
          sub={
            <span className="inline-flex items-center gap-1.5">
              {r.subs} subafiliados
              {r.manager.status === 'pausado' && <Badge tone="warning">pausado</Badge>}
            </span>
          }
        />
      ),
    },
    { id: 'clicks', header: 'Cliques', align: 'right', sortValue: (r) => r.clicks, cell: (r) => num(r.clicks) },
    { id: 'signups', header: 'Cadastros', align: 'right', sortValue: (r) => r.signups, cell: (r) => num(r.signups) },
    {
      id: 'ftd',
      header: 'FTD',
      align: 'right',
      sortValue: (r) => r.ftd,
      cell: (r) => (
        <span>
          {num(r.ftd)} <span className="text-xs text-fg-3">{pct(r.signups ? r.ftd / r.signups : 0, 0)}</span>
        </span>
      ),
      csv: (r) => r.ftd,
    },
    { id: 'deposits', money: true, header: 'Valor depositado', align: 'right', sortValue: (r) => r.deposits, cell: (r) => brl(r.deposits) },
    {
      id: 'ggr', money: true,
      header: 'GGR',
      align: 'right',
      sortValue: (r) => r.ggr,
      cell: (r) => <span className={r.ggr < 0 ? 'text-danger' : ''}>{brl(r.ggr)}</span>,
    },
    {
      id: 'commission', money: true,
      header: 'Comissão',
      align: 'right',
      sortValue: (r) => r.commission,
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          {r.capped && <Badge tone="warning">teto</Badge>}
          {brl(r.commission)}
        </span>
      ),
      csv: (r) => r.commission,
    },
    {
      id: 'result', money: true,
      header: 'Resultado',
      align: 'right',
      sortValue: (r) => r.result,
      cell: (r) => <span className={cn('font-semibold', r.result < 0 ? 'text-danger' : 'text-success')}>{brl(r.result)}</span>,
    },
    {
      id: 'toPay', money: true,
      header: 'Valor a pagar',
      align: 'right',
      pinned: true,
      sortValue: (r) => r.toPay,
      cell: (r) => (
        <div>
          <p className="font-semibold text-fg">{brl(r.toPay)}</p>
          {r.paid > 0 && <p className="text-xs text-fg-3">{brl(r.paid)} já pagos</p>}
        </div>
      ),
      csv: (r) => r.toPay,
    },
  ]

  const open = openId ? rows.find((r) => r.id === openId) : undefined

  return (
    <>
      <PageHeader />

      <div className="space-y-5">
        <Card>
          <CardBody className="flex flex-col gap-4 pt-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0 space-y-2">
              <p className="flex items-center gap-2 text-[13px] font-medium text-fg">
                <CalendarRange size={15} className="text-fg-3" aria-hidden /> Período
              </p>
              <div className="overflow-x-auto scrollbar-none">
                <Segmented<Preset | 'custom'>
                  ariaLabel="Atalhos de período"
                  value={(PRESETS.some((x) => x.value === range.preset) ? range.preset : 'custom') as Preset | 'custom'}
                  onChange={(v) => v !== 'custom' && applyPreset(v)}
                  options={PRESETS}
                />
              </div>
            </div>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                applyCustom()
              }}
            >
              <Field label="De" htmlFor="vg-from" className="w-[calc(50%-6px)] sm:w-40">
                <Input
                  id="vg-from"
                  type="date"
                  value={draft.from}
                  min={oldestAffiliateDay()}
                  max={dayKey(NOW)}
                  onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                />
              </Field>
              <Field label="Até" htmlFor="vg-to" className="w-[calc(50%-6px)] sm:w-40">
                <Input
                  id="vg-to"
                  type="date"
                  value={draft.to}
                  min={oldestAffiliateDay()}
                  max={dayKey(NOW)}
                  onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                />
              </Field>
              <Button type="submit" variant={draftChanged ? 'primary' : 'secondary'} className="w-full sm:w-auto">
                Aplicar
              </Button>
            </form>
          </CardBody>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-5 py-2.5 text-[13px] text-fg-3">
            <span>
              Mostrando <strong className="font-semibold text-fg tnum">{rangeLabel(range)}</strong> · {num(days)} {days === 1 ? 'dia' : 'dias'}
            </span>
            <span className="hidden sm:inline" aria-hidden>
              ·
            </span>
            <span>comparado com os {num(days)} dias anteriores</span>
          </div>
        </Card>

        <section aria-label="Resultado do programa no período" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Cadastros"
            icon={UserPlus}
            tone="info"
            value={num(t.signups)}
            delta={delta(t.signups, p.signups)}
            hint={`${num(t.ftd)} FTD · ${numCompact(t.clicks)} cliques`}
            formula={<>Contas criadas pelos links da rede (gerente + subafiliados). FTD = primeiro depósito feito no período.</>}
          />
          <KpiCard
            label="GGR da rede"
            icon={CircleDollarSign}
            value={brlCompact(t.ggr)}
            delta={delta(t.ggr, p.ggr)}
            hint={`${brlCompact(t.deposits)} depositados`}
            formula={<>GGR = apostado − pago em vitórias pelos jogadores indicados pela rede no período.</>}
          />
          <KpiCard
            label="Comissão"
            icon={HandCoins}
            tone="warning"
            value={brlCompact(t.commission)}
            delta={delta(t.commission, p.commission)}
            goodWhenUp={false}
            hint={`${pct(t.ggr > 0 ? t.commission / t.ggr : 0, 0)} do GGR`}
            formula={
              <>
                Contrato do gerente sobre a rede (CPA × FTD + Rev Share × GGR positivo) mais a comissão de cada subafiliado pela regra do tipo dele em
                Comissões. Tetos mensais são multiplicados pelos meses do período.
              </>
            }
          />
          <KpiCard
            label="Resultado"
            icon={Scale}
            tone={t.result >= 0 ? 'success' : 'danger'}
            value={brlCompact(t.result)}
            delta={delta(t.result, p.result)}
            hint="GGR − comissão"
            formula={<>Resultado = GGR da rede − comissão. É o que sobra para a casa antes de bônus, impostos e taxas.</>}
          />
        </section>

        <div className="grid gap-5 xl:grid-cols-5">
          <Card className="min-w-0 xl:col-span-3">
            <CardHeader
              title="Resultado por gerente"
              description={rangeLabel(range)}
              actions={
                <Formula title="Resultado por gerente">
                  Cada grupo de barras é a rede de um gerente: GGR gerado pelos indicados, comissão devida e o resultado da casa (GGR − comissão).
                </Formula>
              }
            />
            <CardBody>
              {rows.length ? (
                <BarsChart
                  ariaLabel="GGR, comissão e resultado por gerente"
                  data={chartData}
                  xKey="name"
                  format="brl"
                  height={260}
                  series={[
                    { key: 'ggr', label: 'GGR', slot: 1 },
                    { key: 'commission', label: 'Comissão', slot: 4 },
                    { key: 'result', label: 'Resultado', slot: 3 },
                  ]}
                />
              ) : (
                <EmptyState icon={Users} title="Nenhum gerente cadastrado" />
              )}
            </CardBody>
          </Card>

          <Card className="min-w-0 xl:col-span-2">
            <CardHeader title="Funil da rede" description="Do clique no link ao primeiro depósito" />
            <CardBody className="space-y-4">
              <FunnelChart
                ariaLabel="Funil de cliques, cadastros e FTD"
                steps={[
                  { label: 'Cliques nos links', value: t.clicks },
                  { label: 'Cadastros', value: t.signups },
                  { label: 'Primeiro depósito (FTD)', value: t.ftd },
                ]}
              />
              <div className="rounded-xl border border-line p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-fg-3">Valor a pagar no período</p>
                    <p className="font-display text-xl font-bold text-fg tnum">{brl(t.toPay)}</p>
                    <p className="text-xs text-fg-3">{brl(t.paid)} já pagos em saques de afiliados</p>
                  </div>
                  <Link to="/system/programa-afiliados/saques" className="link shrink-0 text-[13px]">
                    Ver saques
                  </Link>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>

        {monthsInPeriod(days) > 1 && rules.Manager.cap !== null && (
          <Alert tone="info">
            O teto mensal de Manager ({brl(rules.Manager.cap)}) foi multiplicado por {monthsInPeriod(days)} meses neste período.
          </Alert>
        )}

        <DataTable
          caption="Resultado por gerente de afiliados"
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          searchText={(r) => `${r.manager.name} ${r.manager.email}`}
          searchPlaceholder="Buscar gerente"
          initialSort={{ id: 'ggr', dir: 'desc' }}
          exportName="afiliados-visao-geral"
          onExport={(n) => audit('exportar', 'Afiliados · Visão geral', `Exportação CSV de ${n} gerentes (${rangeLabel(range)})`)}
          onRowClick={(r) => setOpenId(r.id)}
          empty={{ icon: Users, title: 'Nenhum gerente', description: 'Cadastre gerentes em Programa de afiliados › Gerentes.' }}
        />
      </div>

      {open && <ManagerDrawer row={open} range={range} onClose={() => setOpenId(null)} />}
    </>
  )
}

function ManagerDrawer({ row, range, onClose }: { row: ManagerRow; range: DateRange; onClose: () => void }) {
  const m = row.manager
  const maxGgr = Math.max(1, ...row.members.map((x) => Math.abs(x.ggr)))
  return (
    <Drawer
      open
      onClose={onClose}
      width="xl"
      title={`Rede de ${m.name}`}
      description={`${rangeLabel(range)} · ${maskEmail(m.email)}`}
      headerExtra={
        <Badge tone={m.status === 'ativo' ? 'success' : 'warning'} dot size="md">
          {m.status === 'ativo' ? 'Ativo' : 'Pausado'}
        </Badge>
      }
      footer={
        <Link to="/system/programa-afiliados/gerentes" className="link text-[13px]">
          Abrir em Gerentes
        </Link>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="GGR" value={brlCompact(row.ggr)} sub={`${brlCompact(row.deposits)} depositados`} />
          <StatTile label="Comissão" value={brlCompact(row.commission)} sub={`${brlCompact(row.managerCommission)} do gerente`} />
          <StatTile label="Resultado" value={brlCompact(row.result)} />
          <StatTile label="A pagar" value={brlCompact(row.toPay)} sub={row.paid ? `${brlCompact(row.paid)} já pagos` : 'nada pago ainda'} />
        </div>

        <DescriptionList
          columns={3}
          items={[
            { label: 'Contrato do gerente', value: contractLabel({ cpa: m.cpa, revShare: m.revShare }) },
            { label: 'Subafiliados', value: num(row.subs) },
            { label: 'Funil', value: `${num(row.clicks)} cliques → ${num(row.signups)} cadastros → ${num(row.ftd)} FTD` },
          ]}
        />
        {m.status === 'pausado' && (
          <Alert tone="warning">Gerente pausado: a comissão de rede dele fica zerada no período. Os subafiliados continuam recebendo.</Alert>
        )}

        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
            <TrendingUp size={15} className="text-fg-3" aria-hidden /> Quem gerou o resultado
          </h3>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[560px] text-sm">
              <caption className="sr-only">Desempenho de cada afiliado da rede</caption>
              <thead>
                <tr className="border-b border-line bg-surface-2 text-xs text-fg-3">
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Afiliado
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Cadastros
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    FTD
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    GGR
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    Comissão
                  </th>
                </tr>
              </thead>
              <tbody>
                {row.members.map((x) => (
                  <tr key={x.affiliate.id} className="border-b border-line/70 last:border-0">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-fg">{x.affiliate.name}</span>
                        <AffiliateTypeBadge type={x.affiliate.type} />
                      </div>
                      <div className="mt-1 h-1 w-full max-w-[180px] overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(Math.abs(x.ggr) / maxGgr) * 100}%`, background: x.ggr < 0 ? 'var(--chart-8)' : 'var(--chart-1)' }}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tnum">{num(x.signups)}</td>
                    <td className="px-3 py-2 text-right tnum">{num(x.ftd)}</td>
                    <td className={cn('px-3 py-2 text-right tnum', x.ggr < 0 && 'text-danger')}>{brl(x.ggr)}</td>
                    <td className="px-3 py-2 text-right tnum">
                      {x.capped && (
                        <Badge tone="warning" className="mr-1">
                          teto
                        </Badge>
                      )}
                      {brl(x.commission)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-fg-3">
            Na linha do gerente, a comissão é a de rede (contrato dele). Subafiliados recebem pela regra do próprio tipo, em Crescimento › Comissões.
          </p>
        </section>
      </div>
    </Drawer>
  )
}
