import { useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Award, BadgeDollarSign, Crown, HandCoins, Link2, Medal, UserCheck, UserPlus, Users } from 'lucide-react'
import { BarsChart } from '@/components/charts'
import {
  Alert,
  Avatar,
  Badge,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ChipFilter,
  CopyButton,
  DataTable,
  DateRangePicker,
  DescriptionList,
  Drawer,
  EmptyState,
  KpiCard,
  Mono,
  PageHeader,
  PersonCell,
  Segmented,
  presetRange,
  rangeLabel,
  type Column,
  type DateRange,
  type Tone,
} from '@/components/ui'
import { brl, brlCompact, maskEmail, num, pct } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useAffiliates, usePlayers } from '@/data/hooks'
import type { AffiliateType } from '@/data/players'
import { audit } from '@/domain/session'
import { RANK_METRIC_LABEL, activityShare, rankAffiliates, sortRank, type AffiliateRankRow, type RankMetric } from '@/domain/ranking-afiliados'

const TYPE_TONE: Record<AffiliateType, Tone> = { Manager: 'primary', Influencer: 'info', Organic: 'success' }
const TYPE_LABEL: Record<AffiliateType, string> = { Manager: 'Manager', Influencer: 'Influencer', Organic: 'Organic' }
const SITE = 'x2win.bet.br'

const metricValue = (r: AffiliateRankRow, m: RankMetric) => (m === 'referred' ? num(r.referred) : brl(r[m]))

export default function RankingAfiliados() {
  const { items: affiliates } = useAffiliates()
  const { items: players } = usePlayers()
  const [range, setRange] = useState<DateRange>(() => presetRange('30d'))
  const [metric, setMetric] = useState<RankMetric>('deposited')
  const [type, setType] = useState<'todos' | AffiliateType>('todos')
  const [showEmpty, setShowEmpty] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const all = useMemo(() => rankAffiliates(affiliates, players, range), [affiliates, players, range])
  const ranked = useMemo(() => sortRank(all, metric), [all, metric])
  const rankOf = useMemo(() => new Map(ranked.map((r, i) => [r.id, i + 1])), [ranked])
  const hasResult = (r: AffiliateRankRow) => r.referred > 0 || r.deposited > 0 || r.commission > 0
  const rows = ranked.filter((r) => (type === 'todos' || r.affiliate.type === type) && (showEmpty || hasResult(r)))

  const tot = all.reduce(
    (a, r) => ({ referred: a.referred + r.referred, depositors: a.depositors + r.depositors, deposited: a.deposited + r.deposited, cpa: a.cpa + r.cpaTotal, rev: a.rev + r.revShareValue }),
    { referred: 0, depositors: 0, deposited: 0, cpa: 0, rev: 0 },
  )
  const withResult = all.filter(hasResult).length
  const podium = ranked.filter(hasResult).slice(0, 3)
  const top10 = sortRank(all, 'deposited')
    .filter((r) => r.deposited > 0)
    .slice(0, 10)
    .map((r) => ({ name: r.affiliate.name.split(' ').slice(0, 2).join(' '), deposited: Math.round(r.deposited), commission: Math.round(r.commission) }))
  const typeCounts = all.reduce<Record<string, number>>((acc, r) => {
    if (showEmpty || hasResult(r)) acc[r.affiliate.type] = (acc[r.affiliate.type] ?? 0) + 1
    return acc
  }, {})

  const columns: Column<AffiliateRankRow>[] = [
    {
      id: 'rank',
      header: '#',
      align: 'center',
      sortValue: (r) => -(rankOf.get(r.id) ?? 999),
      csv: (r) => rankOf.get(r.id) ?? '',
      cell: (r) => {
        const n = rankOf.get(r.id) ?? 0
        return (
          <span
            className={cn(
              'inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-xs font-bold tnum',
              n === 1 ? 'bg-gold/20 text-warning dark:text-gold' : n === 2 ? 'bg-surface-3 text-fg-2' : n === 3 ? 'bg-warning/10 text-warning' : 'text-fg-3',
            )}
          >
            {n}
          </span>
        )
      },
    },
    {
      id: 'affiliate',
      header: 'Afiliado',
      pinned: true,
      minWidth: 210,
      sortValue: (r) => r.affiliate.name,
      csv: (r) => `${r.affiliate.name} (${r.affiliate.code})`,
      cell: (r) => (
        <PersonCell
          name={r.affiliate.name}
          sub={
            <span className="flex items-center gap-1.5">
              <Mono className="text-[11.5px]">{r.affiliate.code}</Mono>
              {r.affiliate.status === 'pausado' && <span className="text-warning">· pausado</span>}
            </span>
          }
        />
      ),
    },
    {
      id: 'type',
      header: 'Tipo',
      sortValue: (r) => r.affiliate.type,
      csv: (r) => r.affiliate.type,
      cell: (r) => <Badge tone={TYPE_TONE[r.affiliate.type]}>{TYPE_LABEL[r.affiliate.type]}</Badge>,
    },
    { id: 'referred', header: 'Indicados', align: 'right', sortValue: (r) => r.referred, cell: (r) => <span className="font-medium">{num(r.referred)}</span> },
    {
      id: 'depositors',
      header: 'Depositaram',
      align: 'right',
      sortValue: (r) => r.depositors,
      cell: (r) => (
        <span>
          {num(r.depositors)}
          {r.referred > 0 && <span className="ml-1 text-xs text-fg-3">({pct(Math.min(1, r.depositors / r.referred), 0)})</span>}
        </span>
      ),
    },
    { id: 'deposited', money: true, header: 'Valor depositado', align: 'right', sortValue: (r) => r.deposited, csv: (r) => r.deposited.toFixed(2), cell: (r) => <span className="font-semibold">{brl(r.deposited)}</span> },
    {
      id: 'cpa', money: true,
      header: 'CPA',
      align: 'right',
      sortValue: (r) => r.cpaTotal,
      csv: (r) => r.cpaTotal.toFixed(2),
      cell: (r) => (
        <div>
          <p className="tnum">{brl(r.cpaTotal)}</p>
          <p className="text-[11.5px] text-fg-3 tnum">{r.cpaUnit ? `${brl(r.cpaUnit)} × ${r.depositors}` : 'sem CPA'}</p>
        </div>
      ),
    },
    {
      id: 'rev', money: true,
      header: 'Rev Share',
      align: 'right',
      sortValue: (r) => r.revShareValue,
      csv: (r) => r.revShareValue.toFixed(2),
      cell: (r) => (
        <div>
          <p className="tnum">{brl(r.revShareValue)}</p>
          <p className="text-[11.5px] text-fg-3 tnum">
            {pct(r.revSharePct, 0)} de {brlCompact(r.ggr)}
          </p>
        </div>
      ),
    },
    {
      id: 'commission', money: true,
      header: 'Comissão total',
      align: 'right',
      sortValue: (r) => r.commission,
      csv: (r) => r.commission.toFixed(2),
      cell: (r) => <span className="font-bold text-primary-text">{brl(r.commission)}</span>,
    },
    { id: 'ggr', money: true, header: 'GGR dos indicados', align: 'right', defaultHidden: true, sortValue: (r) => r.ggr, csv: (r) => r.ggr.toFixed(2), cell: (r) => brl(r.ggr) },
    { id: 'total', header: 'Indicados (total)', align: 'right', defaultHidden: true, sortValue: (r) => r.totalReferred, cell: (r) => num(r.totalReferred) },
  ]

  const open = openId ? all.find((r) => r.id === openId) : undefined

  return (
    <>
      <PageHeader actions={<DateRangePicker value={range} onChange={setRange} />} />

      <section aria-label="Resumo dos afiliados" className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Afiliados com resultado" icon={Users} value={num(withResult)} hint={`de ${num(affiliates.length)} afiliados`} />
        <KpiCard
          label="Indicados no período"
          icon={UserPlus}
          tone="info"
          value={num(tot.referred)}
          hint={`${num(tot.depositors)} fizeram o 1º depósito`}
          formula={<>Indicados = cadastros feitos pelo link do afiliado no período. Depositaram = indicados com o 1º depósito no período (base do CPA).</>}
        />
        <KpiCard
          label="Depósitos dos indicados"
          icon={BadgeDollarSign}
          tone="success"
          value={brlCompact(tot.deposited)}
          formula={<>Estimativa: o total depositado por cada indicado, na proporção do tempo de atividade dele que cai no período.</>}
        />
        <KpiCard
          label="Comissão estimada"
          icon={HandCoins}
          tone="primary"
          value={brlCompact(tot.cpa + tot.rev)}
          hint={`CPA ${brlCompact(tot.cpa)} · Rev Share ${brlCompact(tot.rev)}`}
          formula={
            <>
              CPA = depositantes × valor fixo do afiliado. Rev Share = GGR estimado dos indicados × percentual. GGR negativo não gera Rev Share. Afiliado pausado não gera comissão.
            </>
          }
        />
      </section>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-fg">Pódio do período</h2>
          <p className="text-[13px] text-fg-3">{rangeLabel(range)}</p>
        </div>
        <Segmented
          ariaLabel="Classificar ranking por"
          value={metric}
          onChange={setMetric}
          options={(Object.keys(RANK_METRIC_LABEL) as RankMetric[]).map((m) => ({ value: m, label: RANK_METRIC_LABEL[m] }))}
        />
      </div>

      {podium.length === 0 ? (
        <Card className="mb-6">
          <EmptyState icon={Medal} title="Nenhum afiliado com resultado no período" description="Escolha um período maior para ver o pódio." />
        </Card>
      ) : (
        <section aria-label="Três primeiros do ranking" className="mb-6 grid items-end gap-4 md:grid-cols-3">
          {[podium[1], podium[0], podium[2]].map((r, i) => {
            if (!r) return <div key={i} className="hidden md:block" />
            const place = rankOf.get(r.id) ?? 0
            return <PodiumCard key={r.id} row={r} place={place} metric={metric} onOpen={() => setOpenId(r.id)} className={cn(place === 1 ? 'order-first md:order-none' : place === 2 ? 'order-2 md:order-none' : 'order-3')} />
          })}
        </section>
      )}

      <Card className="mb-6">
        <CardHeader title="Top 10 por valor depositado" description="Depósitos dos indicados e comissão gerada no período" />
        <CardBody>
          {top10.length ? (
            <BarsChart
              ariaLabel="Top 10 afiliados por valor depositado"
              data={top10}
              xKey="name"
              layout="horizontal"
              format="brl"
              height={Math.max(220, top10.length * 34)}
              categoryWidth={130}
              series={[
                { key: 'deposited', label: 'Valor depositado', slot: 1 },
                { key: 'commission', label: 'Comissão', slot: 3 },
              ]}
            />
          ) : (
            <p className="py-10 text-center text-[13px] text-fg-3">Sem depósitos de indicados no período.</p>
          )}
        </CardBody>
      </Card>

      <DataTable
        key={metric}
        className="relative"
        caption="Ranking de afiliados"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.affiliate.name} ${r.affiliate.code} ${r.affiliate.email}`}
        searchPlaceholder="Buscar afiliado ou código"
        initialSort={{ id: metric, dir: 'desc' }}
        exportName="ranking-afiliados"
        onExport={(n) => audit('exportar', 'Ranking de afiliados', `Exportação CSV de ${n} afiliados (${rangeLabel(range)})`)}
        onRowClick={(r) => setOpenId(r.id)}
        resetKey={`${type}|${showEmpty}|${range.from.getTime()}`}
        pageSize={25}
        rowClassName={(r) => (r.affiliate.status === 'pausado' ? 'opacity-70' : undefined)}
        toolbar={
          <>
            <ChipFilter<'todos' | AffiliateType>
              value={type}
              onChange={setType}
              options={[
                { value: 'todos', label: 'Todos', count: Object.values(typeCounts).reduce((s, n) => s + n, 0) },
                { value: 'Manager', label: 'Manager', count: typeCounts.Manager ?? 0 },
                { value: 'Influencer', label: 'Influencer', count: typeCounts.Influencer ?? 0 },
                { value: 'Organic', label: 'Organic', count: typeCounts.Organic ?? 0 },
              ]}
            />
            <Checkbox label="Mostrar sem resultado" checked={showEmpty} onChange={setShowEmpty} />
          </>
        }
        empty={{ title: 'Nenhum afiliado neste filtro', description: 'Troque o tipo, marque "Mostrar sem resultado" ou escolha outro período.', icon: Users }}
      />

      <p className="mt-3 text-xs text-fg-3">Valores estimados para acompanhamento. O pagamento das comissões é feito em Programa de afiliados › Saques de afiliados.</p>

      {open && <AffiliateDrawer row={open} place={rankOf.get(open.id) ?? 0} metric={metric} range={range} onClose={() => setOpenId(null)} />}
    </>
  )
}

const PLACE: Record<number, { icon: LucideIcon; label: string; ring: string; chip: string; bar: string }> = {
  1: { icon: Crown, label: '1º lugar', ring: 'ring-gold/50', chip: 'bg-gold/20 text-warning dark:text-gold', bar: 'h-3 bg-gold/70' },
  2: { icon: Medal, label: '2º lugar', ring: 'ring-line-strong', chip: 'bg-surface-3 text-fg-2', bar: 'h-2 bg-fg-3/50' },
  3: { icon: Award, label: '3º lugar', ring: 'ring-warning/40', chip: 'bg-warning/10 text-warning', bar: 'h-1.5 bg-warning/60' },
}

function PodiumCard({ row: r, place, metric, onOpen, className }: { row: AffiliateRankRow; place: number; metric: RankMetric; onOpen: () => void; className?: string }) {
  const P = PLACE[place] ?? PLACE[3]
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn('card group relative overflow-hidden text-left transition-[border-color,box-shadow] duration-150 hover:border-line-strong', className)}
      aria-label={`${P.label}: ${r.affiliate.name}, ${RANK_METRIC_LABEL[metric]} ${metricValue(r, metric)}`}
    >
      <span className={cn('absolute inset-x-0 top-0', P.bar)} aria-hidden />
      <div className={cn('flex flex-col items-center px-4 text-center', place === 1 ? 'pb-4 pt-7' : 'pb-4 pt-6')}>
        <span className={cn('mb-3 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold', P.chip)}>
          <P.icon size={13} aria-hidden /> {P.label}
        </span>
        <span className={cn('rounded-full ring-4', P.ring)}>
          <Avatar name={r.affiliate.name} size={place === 1 ? 64 : 52} />
        </span>
        <p className="mt-3 max-w-full truncate text-[15px] font-semibold text-fg">{r.affiliate.name}</p>
        <div className="mt-1 flex items-center gap-1.5">
          <Badge tone={TYPE_TONE[r.affiliate.type]}>{r.affiliate.type}</Badge>
          <Mono className="text-[11.5px] text-fg-3">{r.affiliate.code}</Mono>
        </div>
        <p className={cn('mt-3 font-display font-bold tracking-tight text-fg tnum', place === 1 ? 'text-[28px] leading-9' : 'text-2xl')}>{metricValue(r, metric)}</p>
        <p className="text-xs text-fg-3">{RANK_METRIC_LABEL[metric].toLowerCase()}</p>
        <dl className="mt-4 grid w-full grid-cols-3 gap-2 border-t border-line pt-3 text-left">
          <div className="min-w-0 text-center">
            <dt className="text-[11px] text-fg-3">Indicados</dt>
            <dd className="text-sm font-semibold text-fg tnum">{num(r.referred)}</dd>
          </div>
          <div className="min-w-0 text-center">
            <dt className="text-[11px] text-fg-3">Depositaram</dt>
            <dd className="text-sm font-semibold text-fg tnum">{num(r.depositors)}</dd>
          </div>
          <div className="min-w-0 text-center">
            <dt className="text-[11px] text-fg-3">{metric === 'commission' ? 'Depósitos' : 'Comissão'}</dt>
            <dd className="truncate text-sm font-semibold text-fg tnum">{brlCompact(metric === 'commission' ? r.deposited : r.commission)}</dd>
          </div>
        </dl>
      </div>
    </button>
  )
}

function AffiliateDrawer({ row: r, place, metric, range, onClose }: { row: AffiliateRankRow; place: number; metric: RankMetric; range: DateRange; onClose: () => void }) {
  const a = r.affiliate
  const link = `https://${SITE}/?ref=${a.code}`
  const top = [...r.players]
    .map((p) => ({ p, dep: p.totalDeposited * activityShare(p, range) }))
    .sort((x, y) => y.dep - x.dep)
    .slice(0, 8)
  return (
    <Drawer
      open
      onClose={onClose}
      title={a.name}
      description={`${place}º em ${RANK_METRIC_LABEL[metric].toLowerCase()} · ${rangeLabel(range)}`}
      headerExtra={
        <Badge tone={a.status === 'ativo' ? 'success' : 'warning'} dot size="md">
          {a.status === 'ativo' ? 'Ativo' : 'Pausado'}
        </Badge>
      }
    >
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Avatar name={a.name} size={48} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={TYPE_TONE[a.type]}>{a.type}</Badge>
              <span className="text-xs text-fg-3">{a.level === 1 ? 'Afiliado direto' : 'Subafiliado'}</span>
            </div>
            <p className="mt-1 truncate text-[13px] text-fg-3">{maskEmail(a.email)}</p>
          </div>
        </div>

        <div className="rounded-xl border border-line p-3">
          <p className="flex items-center gap-1 text-xs font-medium text-fg-3">
            <Link2 size={12} aria-hidden /> Link de indicação
          </p>
          <div className="mt-1 flex items-center gap-1">
            <Mono className="truncate text-fg">{link}</Mono>
            <CopyButton value={link} label="Copiar link de indicação" />
          </div>
        </div>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Comissão do período</h3>
          <div className="space-y-2 rounded-xl bg-surface-2 p-4 text-[13px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-fg-2">
                CPA: {num(r.depositors)} depositante(s) × {brl(r.cpaUnit)}
              </span>
              <span className="font-medium text-fg tnum">{brl(r.cpaTotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-fg-2">
                Rev Share: {pct(r.revSharePct, 0)} × {brl(Math.max(0, r.ggr))} de GGR
              </span>
              <span className="font-medium text-fg tnum">{brl(r.revShareValue)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line pt-2">
              <span className="font-semibold text-fg">Comissão total</span>
              <span className="text-base font-bold text-primary-text tnum">{brl(r.commission)}</span>
            </div>
          </div>
          {a.status === 'pausado' && (
            <Alert tone="warning" className="mt-3">
              Afiliado pausado: os indicados continuam contando no ranking, mas não geram comissão.
            </Alert>
          )}
          {r.ggr < 0 && (
            <Alert tone="info" className="mt-3">
              O GGR dos indicados ficou negativo ({brl(r.ggr)}). Rev Share negativo não é cobrado do afiliado.
            </Alert>
          )}
        </section>

        <DescriptionList
          columns={2}
          items={[
            { label: 'Indicados no período', value: num(r.referred) },
            { label: 'Depositaram (1º depósito)', value: num(r.depositors) },
            { label: 'Valor depositado', value: brl(r.deposited) },
            { label: 'Indicados no total', value: num(r.totalReferred) },
          ]}
        />

        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
            <UserCheck size={15} className="text-fg-3" aria-hidden /> Indicados ativos no período
          </h3>
          {top.length ? (
            <ul className="divide-y divide-line">
              {top.map(({ p, dep }) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <PersonCell name={p.name} sub={maskEmail(p.email)} />
                  <div className="shrink-0 text-right">
                    <p className="text-[13px] font-semibold text-fg tnum">{brl(dep)}</p>
                    <p className="text-[11px] text-fg-3">depositado no período</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-fg-3">Nenhum indicado ativo no período.</p>
          )}
          <p className="mt-2 text-xs text-fg-3">E-mails mascarados (LGPD). A ficha completa fica em Usuários.</p>
        </section>
      </div>
    </Drawer>
  )
}
