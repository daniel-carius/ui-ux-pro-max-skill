import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  Building2,
  CalendarCheck,
  CircleDollarSign,
  Coins,
  FileCheck2,
  Gamepad2,
  Hourglass,
  LayoutDashboard,
  Lightbulb,
  Lock,
  Percent,
  ReceiptText,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { DonutChart, Sparkline, TrendChart, type SeriesSlot } from '@/components/charts'
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
  KpiCard,
  Mono,
  PageHeader,
  Select,
  Tabs,
  confirm,
  confirmWithInput,
  inRange,
  presetRange,
  previousRange,
  rangeLabel,
  toast,
  useTabParam,
  type Column,
  type DateRange,
  type Tone,
} from '@/components/ui'
import { brl, brlCompact, date, dateShort, dateTime, num, numCompact, pct } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useCollection } from '@/lib/store'
import { useGames, useProviders } from '@/data/hooks'
import { GAME_CATEGORY_LABEL, type GameCategory } from '@/data/catalog'
import { gameStatsForPeriod, getDailySeries, sumSeries, type GameStat } from '@/data/metrics'
import { NOW, dayKey, endOfDay } from '@/data/now'
import { GGR_KEYS, seedSettlements } from '@/data/ggr'
import { audit, useSession } from '@/domain/session'
import {
  SETTLEMENT_PERMISSION,
  SETTLEMENT_STATUS_LABEL,
  aggregateByProvider,
  closeBlocker,
  isOverdue,
  lastMonths,
  monthBounds,
  monthEnded,
  monthKey,
  monthLabel,
  payBlocker,
  reconcileStats,
  settlementView,
  validatePaymentRef,
  type ProviderGgr,
  type Settlement,
  type SettlementStatus,
} from '@/domain/ggr'
import { BrandMark, CATEGORY_ICON, GameCover } from '../cassino/_shared'

type Tab = 'resumo' | 'provedores' | 'jogos' | 'apuracoes'
const TABS = ['resumo', 'provedores', 'jogos', 'apuracoes'] as const

function delta(cur: number, prev: number | undefined | null) {
  if (prev == null || prev === 0) return null
  return (cur - prev) / Math.abs(prev)
}

const fmtDay = (k: string) => dateShort(`${k}T12:00:00`)

/** Mês selecionado, se o período for exatamente um mês. */
function monthOf(r: DateRange): string {
  const m = monthKey(r.from)
  const b = monthBounds(m)
  const isCurrent = m === monthKey(NOW)
  if (dayKey(r.from) !== dayKey(b.from)) return ''
  if (dayKey(r.to) === dayKey(b.to) || (isCurrent && dayKey(r.to) === dayKey(NOW))) return m
  return ''
}

export default function Ggr() {
  const [tab, setTab] = useTabParam<Tab>('resumo', TABS)
  const [range, setRange] = useState<DateRange>(() => presetRange('30d'))
  const { items: providers } = useProviders()
  const months = useMemo(() => lastMonths(13, NOW), [])
  const currentMonth = monthKey(NOW)

  const data = useMemo(() => {
    const series = getDailySeries()
    const rows = series.filter((r) => inRange(r.date, range))
    const prevRows = series.filter((r) => inRange(r.date, previousRange(range)))
    const t = sumSeries(rows)
    const p = prevRows.length ? sumSeries(prevRows) : null
    const stats = reconcileStats(gameStatsForPeriod(t.casinoBets, t.casinoWins, rows.length), t.casinoBets, t.casinoWins)
    const byProvider = aggregateByProvider(stats, providers)
    const prevByProvider = p ? aggregateByProvider(reconcileStats(gameStatsForPeriod(p.casinoBets, p.casinoWins, prevRows.length), p.casinoBets, p.casinoWins), providers) : null
    const fee = byProvider.reduce((s, r) => s + r.fee, 0)
    const prevFee = prevByProvider?.reduce((s, r) => s + r.fee, 0) ?? null
    return { rows, t, p, stats, byProvider, fee, prevFee }
  }, [range, providers])

  const selectMonth = (m: string) => {
    if (!m) return
    if (m === currentMonth) setRange(presetRange('mes'))
    else {
      const b = monthBounds(m)
      setRange({ from: b.from, to: endOfDay(b.to), preset: 'custom' })
    }
  }

  return (
    <>
      <PageHeader
        actions={
          tab !== 'apuracoes' ? (
            <>
              <Select
                aria-label="Escolher mês"
                value={monthOf(range)}
                onChange={selectMonth}
                placeholder="Escolher mês"
                options={months.map((m) => ({ value: m, label: `${monthLabel(m)}${m === currentMonth ? ' (parcial)' : ''}` }))}
                className="w-full sm:w-56 [&_select]:h-9"
              />
              <DateRangePicker value={range} onChange={setRange} />
            </>
          ) : undefined
        }
      >
        <Tabs
          className="mt-5"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'resumo', label: 'Resumo', icon: LayoutDashboard },
            { value: 'provedores', label: 'Provedores', icon: Building2 },
            { value: 'jogos', label: 'Jogos', icon: Gamepad2 },
            { value: 'apuracoes', label: 'Apurações', icon: FileCheck2 },
          ]}
        />
      </PageHeader>

      {tab === 'resumo' && <Summary range={range} data={data} />}
      {tab === 'provedores' && <ProvidersTab range={range} rows={data.byProvider} />}
      {tab === 'jogos' && <GamesTab range={range} stats={data.stats} />}
      {tab === 'apuracoes' && <Settlements />}
    </>
  )
}

type Data = {
  rows: ReturnType<typeof getDailySeries>
  t: ReturnType<typeof sumSeries>
  p: ReturnType<typeof sumSeries> | null
  stats: GameStat[]
  byProvider: ProviderGgr[]
  fee: number
  prevFee: number | null
}

// ---------- Resumo ----------

function Summary({ range, data }: { range: DateRange; data: Data }) {
  const { rows, t, p, byProvider, fee, prevFee, stats } = data
  const feeRate = t.ggrCasino > 0 ? fee / t.ggrCasino : 0
  const net = t.ggrCasino - fee
  const prevNet = p && prevFee != null ? p.ggrCasino - prevFee : null
  const chart = rows.map((r) => {
    const ggr = r.casinoBets - r.casinoWins
    return { date: r.date, ggr: Math.round(ggr * 100) / 100, net: Math.round(ggr * (1 - feeRate) * 100) / 100, bets: r.casinoBets }
  })
  const top = byProvider.slice(0, 4)
  const others = byProvider.slice(4).reduce((s, r) => s + Math.max(0, r.ggr), 0)
  const donut = [
    ...top.map((r, i) => ({ label: r.providerName, value: Math.max(0, Math.round(r.ggr)), slot: (i + 1) as SeriesSlot })),
    { label: 'Outros', value: Math.round(others), slot: 5 as SeriesSlot },
  ]
  const negativeGames = stats.filter((s) => s.ggr < 0)
  const best = rows.length ? rows.reduce((a, b) => (b.casinoBets - b.casinoWins > a.casinoBets - a.casinoWins ? b : a)) : null
  const rtp = t.casinoBets ? t.casinoWins / t.casinoBets : 0
  const topShare = t.ggrCasino > 0 && byProvider[0] ? byProvider[0].ggr / t.ggrCasino : 0

  return (
    <div className="space-y-6">
      <section aria-label="Indicadores de GGR" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Apostado no cassino"
          icon={Coins}
          tone="info"
          value={brlCompact(t.casinoBets)}
          delta={delta(t.casinoBets, p?.casinoBets)}
          hint="vs período anterior"
          formula={<>Soma de todas as apostas de cassino no período, com saldo real e bônus.</>}
          chart={<Sparkline data={chart.map((c) => c.bets)} slot={4} ariaLabel="Tendência do apostado" />}
        />
        <KpiCard
          label="Receita bruta (GGR)"
          icon={CircleDollarSign}
          value={brlCompact(t.ggrCasino)}
          delta={delta(t.ggrCasino, p?.ggrCasino)}
          hint={`RTP real ${pct(rtp)}`}
          formula={<>GGR = apostado − pago em prêmios. RTP real = pago ÷ apostado.</>}
          chart={<Sparkline data={chart.map((c) => c.ggr)} slot={1} ariaLabel="Tendência do GGR" />}
        />
        <KpiCard
          label="Taxas das provedoras"
          icon={Percent}
          tone="warning"
          value={brlCompact(fee)}
          delta={delta(fee, prevFee)}
          goodWhenUp={false}
          hint={`${pct(feeRate)} do GGR`}
          formula={<>Para cada provedora: GGR do período × taxa da provedora. GGR negativo não gera taxa.</>}
        />
        <KpiCard
          label="GGR líquido"
          icon={Wallet}
          tone="success"
          value={brlCompact(net)}
          delta={delta(net, prevNet)}
          hint="depois das taxas"
          formula={<>GGR líquido = GGR − taxas das provedoras. Não desconta bônus nem impostos.</>}
          chart={<Sparkline data={chart.map((c) => c.net)} slot={3} ariaLabel="Tendência do GGR líquido" />}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="GGR diário do cassino" description={rangeLabel(range)} />
          <CardBody>
            <TrendChart
              ariaLabel="GGR bruto e líquido por dia"
              data={chart}
              xKey="date"
              xFormat={fmtDay}
              format="brl"
              height={280}
              series={[
                { key: 'ggr', label: 'GGR bruto', slot: 1 },
                { key: 'net', label: 'GGR líquido', slot: 3 },
              ]}
            />
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Participação por provedora" description="Parte de cada uma no GGR do período" />
          <CardBody>
            <DonutChart ariaLabel="GGR por provedora" data={donut} format={(v) => brlCompact(v)} height={170} centerValue={brlCompact(t.ggrCasino)} centerLabel="GGR" />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Maiores provedoras" description="GGR, taxa e líquido no período" />
          <CardBody>
            <ul className="space-y-3.5">
              {byProvider.slice(0, 6).map((r) => {
                const max = Math.max(1, byProvider[0]?.ggr ?? 1)
                return (
                  <li key={r.providerId} className="flex items-center gap-3">
                    <BrandMark name={r.providerName} hue={r.logoHue} size={30} className="rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-[13px] font-medium text-fg">{r.providerName}</p>
                        <p className="shrink-0 text-[13px] font-semibold text-fg tnum">{brl(r.ggr)}</p>
                      </div>
                      <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-surface-3">
                        <div className="h-full" style={{ width: `${(Math.max(0, r.net) / max) * 100}%`, background: 'var(--chart-1)' }} />
                        <div className="h-full" style={{ width: `${(r.fee / max) * 100}%`, background: 'var(--chart-2)' }} />
                      </div>
                      <p className="mt-1 text-[11.5px] text-fg-3 tnum">
                        taxa {pct(r.feePct, 0, true)} = {brl(r.fee)} · líquido {brl(r.net)}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Leituras do período" icon={Lightbulb} description="Pontos que merecem atenção" />
          <CardBody>
            <ul className="space-y-3">
              <Insight tone={topShare > 0.3 ? 'down' : 'info'}>
                {byProvider[0]?.providerName} responde por {pct(topShare)} do GGR.{' '}
                {topShare > 0.3 ? 'Concentração alta: uma queda nessa provedora pesa no resultado.' : 'O resultado está bem distribuído.'}
              </Insight>
              <Insight tone={rtp > 0.965 ? 'down' : 'up'}>
                RTP real de {pct(rtp, 2)} no cassino. {rtp > 0.965 ? 'Acima do esperado: confira jogos com prêmios fora da curva.' : 'Dentro da faixa esperada para o mix de jogos.'}
              </Insight>
              <Insight tone={negativeGames.length ? 'down' : 'up'}>
                {negativeGames.length
                  ? `${negativeGames.length} jogo(s) fecharam com GGR negativo: ${negativeGames
                      .slice(0, 3)
                      .map((g) => g.gameName)
                      .join(', ')}${negativeGames.length > 3 ? '…' : ''}.`
                  : 'Nenhum jogo fechou o período com GGR negativo.'}
              </Insight>
              {best && (
                <Insight tone="info">
                  Melhor dia: {new Date(`${best.date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long' })}, {fmtDay(best.date)}, com {brl(best.casinoBets - best.casinoWins)} de GGR.
                </Insight>
              )}
              <Insight tone="info">
                Taxas consumiram {pct(feeRate)} do GGR. Veja e feche as apurações mensais na aba{' '}
                <Link to="/dashboard/ggr?aba=apuracoes" className="link">
                  Apurações
                </Link>
                .
              </Insight>
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function Insight({ tone, children }: { tone: 'up' | 'down' | 'info'; children: ReactNode }) {
  const Icon = tone === 'up' ? TrendingUp : tone === 'down' ? TrendingDown : Lightbulb
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={cn(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
          tone === 'up' ? 'bg-success/10 text-success' : tone === 'down' ? 'bg-danger/10 text-danger' : 'bg-info/10 text-info',
        )}
      >
        <Icon size={14} aria-hidden />
      </span>
      <p className="text-[13px] leading-5 text-fg-2">{children}</p>
    </li>
  )
}

// ---------- Provedores ----------

function ProvidersTab({ range, rows }: { range: DateRange; rows: ProviderGgr[] }) {
  const [providerId, setProviderId] = useState('')
  const list = providerId ? rows.filter((r) => r.providerId === providerId) : rows
  const tot = list.reduce(
    (a, r) => ({ bets: a.bets + r.bets, wins: a.wins + r.wins, ggr: a.ggr + r.ggr, fee: a.fee + r.fee, net: a.net + r.net }),
    { bets: 0, wins: 0, ggr: 0, fee: 0, net: 0 },
  )
  const columns: Column<ProviderGgr>[] = [
    {
      id: 'provider',
      header: 'Provedor',
      pinned: true,
      minWidth: 200,
      sortValue: (r) => r.providerName,
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <BrandMark name={r.providerName} hue={r.logoHue} size={28} className="rounded-lg" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-fg">{r.providerName}</span>
            <span className="block text-[11.5px] text-fg-3">
              {r.games} jogos{r.status === 'pausada' ? ' · pausada' : ''}
            </span>
          </span>
        </span>
      ),
    },
    { id: 'bets', header: 'Apostado', align: 'right', sortValue: (r) => r.bets, csv: (r) => r.bets.toFixed(2), cell: (r) => brl(r.bets) },
    { id: 'wins', header: 'Pago', align: 'right', sortValue: (r) => r.wins, csv: (r) => r.wins.toFixed(2), cell: (r) => <span className="text-fg-2">{brl(r.wins)}</span> },
    {
      id: 'ggr',
      header: 'Receita bruta',
      align: 'right',
      sortValue: (r) => r.ggr,
      csv: (r) => r.ggr.toFixed(2),
      cell: (r) => <span className={cn('font-semibold', r.ggr < 0 ? 'text-danger' : 'text-fg')}>{brl(r.ggr)}</span>,
    },
    { id: 'rtp', header: 'RTP', align: 'right', sortValue: (r) => r.rtp, csv: (r) => (r.rtp * 100).toFixed(2), cell: (r) => pct(r.rtp, 2) },
    { id: 'feePct', header: 'Taxa %', align: 'right', sortValue: (r) => r.feePct, csv: (r) => r.feePct, cell: (r) => pct(r.feePct, 0, true) },
    { id: 'fee', header: 'Valor da taxa', align: 'right', sortValue: (r) => r.fee, csv: (r) => r.fee.toFixed(2), cell: (r) => <span className="text-warning">{brl(r.fee)}</span> },
    { id: 'net', header: 'GGR líquido', align: 'right', sortValue: (r) => r.net, csv: (r) => r.net.toFixed(2), cell: (r) => <span className={cn('font-semibold', r.net < 0 ? 'text-danger' : 'text-success')}>{brl(r.net)}</span> },
    { id: 'rounds', header: 'Rodadas', align: 'right', defaultHidden: true, sortValue: (r) => r.rounds, cell: (r) => num(r.rounds) },
  ]
  return (
    <div className="space-y-5">
      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: 'Apostado', value: brl(tot.bets) },
          { label: 'Pago', value: brl(tot.wins) },
          { label: 'Receita bruta', value: brl(tot.ggr) },
          { label: 'Taxas', value: brl(tot.fee), cls: 'text-warning' },
          { label: 'GGR líquido', value: brl(tot.net), cls: 'text-success' },
        ].map((s) => (
          <div key={s.label} className="min-w-0">
            <p className="text-xs text-fg-3">{s.label}</p>
            <p className={cn('mt-0.5 truncate text-[15px] font-bold tnum', s.cls ?? 'text-fg')}>{s.value}</p>
          </div>
        ))}
        <p className="col-span-full -mt-1 text-xs text-fg-3">
          {providerId ? '1 provedor' : `${rows.length} provedores`} · {rangeLabel(range)}
        </p>
      </Card>
      <DataTable
        className="relative"
        caption="GGR por provedor"
        rows={list}
        columns={columns}
        rowKey={(r) => r.providerId}
        initialSort={{ id: 'ggr', dir: 'desc' }}
        exportName="ggr-provedores"
        onExport={(n) => audit('exportar', 'GGR por provedor', `Exportação CSV de ${n} provedores (${rangeLabel(range)})`)}
        resetKey={providerId}
        pageSize={25}
        toolbar={
          <Select
            aria-label="Filtrar por provedor"
            value={providerId}
            onChange={setProviderId}
            placeholder="Todos os provedores"
            options={[...rows].sort((a, b) => a.providerName.localeCompare(b.providerName)).map((r) => ({ value: r.providerId, label: r.providerName }))}
            className="w-full sm:w-60 [&_select]:h-9"
          />
        }
        empty={{ title: 'Sem dados no período', description: 'Escolha outro período ou provedor.' }}
      />
    </div>
  )
}

// ---------- Jogos ----------

function GamesTab({ range, stats }: { range: DateRange; stats: GameStat[] }) {
  const { items: games } = useGames()
  const { items: providers } = useProviders()
  const gmap = useMemo(() => new Map(games.map((g) => [g.id, g])), [games])
  const [providerId, setProviderId] = useState('')
  const [category, setCategory] = useState('')
  const list = stats.filter((s) => (!providerId || s.providerId === providerId) && (!category || gmap.get(s.gameId)?.category === category))
  const columns: Column<GameStat>[] = [
    {
      id: 'game',
      header: 'Jogo',
      pinned: true,
      minWidth: 220,
      sortValue: (s) => s.gameName,
      cell: (s) => {
        const g = gmap.get(s.gameId)
        return (
          <span className="flex items-center gap-2.5">
            {g && (
              <span className="w-8 shrink-0">
                <GameCover game={g} size="thumb" />
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate font-medium text-fg">{s.gameName}</span>
              <span className="block text-[11.5px] text-fg-3">{s.providerName}</span>
            </span>
          </span>
        )
      },
    },
    {
      id: 'category',
      header: 'Categoria',
      sortValue: (s) => gmap.get(s.gameId)?.category ?? '',
      csv: (s) => {
        const c = gmap.get(s.gameId)?.category
        return c ? GAME_CATEGORY_LABEL[c] : ''
      },
      cell: (s) => {
        const c = gmap.get(s.gameId)?.category
        return c ? <Badge icon={CATEGORY_ICON[c]}>{GAME_CATEGORY_LABEL[c]}</Badge> : '—'
      },
    },
    { id: 'bets', header: 'Apostado', align: 'right', sortValue: (s) => s.bets, csv: (s) => s.bets.toFixed(2), cell: (s) => brl(s.bets) },
    { id: 'wins', header: 'Pago', align: 'right', sortValue: (s) => s.wins, csv: (s) => s.wins.toFixed(2), cell: (s) => <span className="text-fg-2">{brl(s.wins)}</span> },
    { id: 'ggr', header: 'GGR', align: 'right', sortValue: (s) => s.ggr, csv: (s) => s.ggr.toFixed(2), cell: (s) => <span className={cn('font-semibold', s.ggr < 0 ? 'text-danger' : 'text-fg')}>{brl(s.ggr)}</span> },
    { id: 'rtp', header: 'RTP real', align: 'right', sortValue: (s) => (s.bets ? s.wins / s.bets : 0), csv: (s) => (s.bets ? ((s.wins / s.bets) * 100).toFixed(2) : ''), cell: (s) => pct(s.bets ? s.wins / s.bets : 0, 2) },
    { id: 'rounds', header: 'Rodadas', align: 'right', sortValue: (s) => s.rounds, cell: (s) => numCompact(s.rounds) },
    { id: 'players', header: 'Jogadores', align: 'right', sortValue: (s) => s.players, cell: (s) => num(s.players) },
    { id: 'perPlayer', header: 'GGR por jogador', align: 'right', defaultHidden: true, sortValue: (s) => s.ggr / Math.max(1, s.players), csv: (s) => (s.ggr / Math.max(1, s.players)).toFixed(2), cell: (s) => brl(s.ggr / Math.max(1, s.players)) },
  ]
  const categories = [...new Set(games.map((g) => g.category))] as GameCategory[]
  return (
    <DataTable
      className="relative"
      caption="GGR por jogo"
      rows={list}
      columns={columns}
      rowKey={(s) => s.gameId}
      searchText={(s) => `${s.gameName} ${s.providerName}`}
      searchPlaceholder="Buscar jogo"
      initialSort={{ id: 'ggr', dir: 'desc' }}
      exportName="ggr-jogos"
      onExport={(n) => audit('exportar', 'GGR por jogo', `Exportação CSV de ${n} jogos (${rangeLabel(range)})`)}
      resetKey={`${providerId}|${category}`}
      pageSize={25}
      rowClassName={(s) => (s.ggr < 0 ? 'bg-danger/[0.03]' : undefined)}
      toolbar={
        <>
          <Select
            aria-label="Filtrar por provedor"
            value={providerId}
            onChange={setProviderId}
            placeholder="Todos os provedores"
            options={[...providers].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.name }))}
            className="w-full sm:w-52 [&_select]:h-9"
          />
          <Select
            aria-label="Filtrar por categoria"
            value={category}
            onChange={setCategory}
            placeholder="Todas as categorias"
            options={categories.map((c) => ({ value: c, label: GAME_CATEGORY_LABEL[c] }))}
            className="w-full sm:w-48 [&_select]:h-9"
          />
        </>
      }
      empty={{ title: 'Nenhum jogo neste filtro', description: 'Troque o provedor ou a categoria.' }}
    />
  )
}

// ---------- Apurações ----------

const ST_TONE: Record<SettlementStatus, Tone> = { aberta: 'info', fechada: 'warning', paga: 'success' }

function Settlements() {
  const settlements = useCollection<Settlement>(GGR_KEYS.settlements, seedSettlements)
  const { items: providers } = useProviders()
  const { can, user, role } = useSession()
  const allowed = can(SETTLEMENT_PERMISSION)
  const now = new Date()
  const feeOf = useMemo(() => new Map(providers.map((p) => [p.id, p.feePct])), [providers])
  const hueOf = useMemo(() => new Map(providers.map((p) => [p.id, p.logoHue])), [providers])
  const months = [...new Set(settlements.items.map((s) => s.month))].sort().reverse()
  const lastEnded = months.find((m) => monthEnded(m, now) && settlements.items.some((s) => s.month === m && s.status === 'aberta')) ?? ''
  const [month, setMonth] = useState<string>(lastEnded || months[0] || '')
  const [status, setStatus] = useState<'todas' | SettlementStatus>('todas')
  const [openId, setOpenId] = useState<string | null>(null)

  const view = (s: Settlement) => settlementView(s, feeOf.get(s.providerId))
  const inMonth = settlements.items.filter((s) => !month || s.month === month)
  const rows = status === 'todas' ? inMonth : inMonth.filter((s) => s.status === status)
  const counts = { todas: inMonth.length, aberta: 0, fechada: 0, paga: 0 } as Record<'todas' | SettlementStatus, number>
  for (const s of inMonth) counts[s.status]++

  const toClose = settlements.items.filter((s) => s.status === 'aberta' && monthEnded(s.month, now))
  const awaiting = settlements.items.filter((s) => s.status === 'fechada')
  const overdue = awaiting.filter((s) => isOverdue(s, now))
  const year = String(now.getFullYear())
  const paidYear = settlements.items.filter((s) => s.status === 'paga' && s.paidAt?.startsWith(year))
  const sumFee = (list: Settlement[]) => list.reduce((acc, s) => acc + view(s).feeDue, 0)
  const monthOpenEnded = month && monthEnded(month, now) ? inMonth.filter((s) => s.status === 'aberta') : []

  const noPerm = `Fechar e pagar apurações exige a permissão de aprovar pagamentos. Seu cargo (${role.name}) não tem.`

  const close = async (s: Settlement) => {
    if (!allowed) return toast.error(noPerm)
    const b = closeBlocker(s, now)
    if (b) return toast.error('Não dá para fechar ainda', { description: b })
    const v = view(s)
    const ok = await confirm({
      title: `Fechar a apuração de ${s.providerName}?`,
      description: `Os valores de ${monthLabel(s.month)} ficam congelados, inclusive a taxa. Depois de fechada, a apuração só muda para paga.`,
      confirmLabel: 'Fechar apuração',
      icon: Lock,
      details: (
        <DescriptionList
          columns={2}
          items={[
            { label: 'GGR do mês', value: brl(s.ggr) },
            { label: 'Taxa', value: pct(v.feePct, 0, true) },
            { label: 'Taxa devida', value: <strong>{brl(v.feeDue)}</strong> },
            { label: 'Vencimento', value: date(s.dueDate) },
          ]}
        />
      ),
    })
    if (!ok) return
    settlements.update(s.id, { status: 'fechada', feePct: v.feePct, feeDue: v.feeDue, closedAt: new Date().toISOString(), closedBy: user.name })
    audit('aprovar', `Apuração ${s.providerName} ${monthLabel(s.month, 'short')}`, `Apuração fechada: GGR ${brl(s.ggr)} × ${v.feePct}% = ${brl(v.feeDue)} a pagar até ${date(s.dueDate)}`)
    toast.success('Apuração fechada', { description: `${s.providerName}: ${brl(v.feeDue)} a pagar até ${date(s.dueDate)}.` })
  }

  const closeAll = async () => {
    if (!allowed) return toast.error(noPerm)
    const list = monthOpenEnded
    if (!list.length) return
    const total = sumFee(list)
    const ok = await confirm({
      title: `Fechar ${list.length} apurações de ${monthLabel(month)}?`,
      description: 'Os valores e as taxas de cada provedora ficam congelados. Confira os números antes: depois de fechadas, só mudam para pagas.',
      confirmLabel: `Fechar ${list.length} apurações`,
      icon: Lock,
      details: (
        <DescriptionList
          columns={2}
          items={[
            { label: 'Provedoras', value: num(list.length) },
            { label: 'Total de taxas', value: <strong>{brl(total)}</strong> },
          ]}
        />
      ),
    })
    if (!ok) return
    const at = new Date().toISOString()
    settlements.replace(
      settlements.items.map((s) => {
        if (!list.some((x) => x.id === s.id)) return s
        const v = view(s)
        return { ...s, status: 'fechada' as const, feePct: v.feePct, feeDue: v.feeDue, closedAt: at, closedBy: user.name }
      }),
    )
    audit('aprovar', `Apurações ${monthLabel(month, 'short')}`, `${list.length} apurações fechadas; total de taxas ${brl(total)}`)
    toast.success(`${list.length} apurações fechadas`, { description: `Total de ${brl(total)} em taxas de ${monthLabel(month)}.` })
  }

  const pay = async (s: Settlement) => {
    if (!allowed) return toast.error(noPerm)
    const b = payBlocker(s)
    if (b) return toast.error('Não dá para marcar como paga', { description: b })
    const r = await confirmWithInput({
      title: `Registrar pagamento de ${brl(s.feeDue)}?`,
      description: `Taxa de ${monthLabel(s.month)} da ${s.providerName}. Use depois de o pagamento sair do banco. A ação não pode ser desfeita.`,
      confirmLabel: 'Marcar como paga',
      tone: 'success',
      icon: Banknote,
      input: { label: 'Referência do pagamento', required: true, placeholder: 'Ex.: TED 123456 ou ID do PIX' },
    })
    if (!r.confirmed) return
    const err = validatePaymentRef(r.value)
    if (err) return toast.error('Referência inválida', { description: err })
    settlements.update(s.id, { status: 'paga', paidAt: new Date().toISOString(), paidBy: user.name, paymentRef: r.value })
    audit('editar', `Apuração ${s.providerName} ${monthLabel(s.month, 'short')}`, `Marcada como paga: ${brl(s.feeDue)} (ref. ${r.value})`)
    toast.success('Pagamento registrado', { description: `${s.providerName} · ${brl(s.feeDue)}` })
  }

  const actionCell = (s: Settlement, size: 'sm' | 'md' = 'sm') => {
    if (s.status === 'aberta') {
      const b = closeBlocker(s, now)
      return (
        <Button size={size} icon={Lock} onClick={() => close(s)} disabled={!allowed || !!b} title={!allowed ? noPerm : b ?? undefined}>
          Fechar
        </Button>
      )
    }
    if (s.status === 'fechada')
      return (
        <Button size={size} variant={size === 'md' ? 'success' : 'secondary'} icon={Banknote} onClick={() => pay(s)} disabled={!allowed} title={!allowed ? noPerm : undefined} className={size === 'sm' ? 'text-success' : undefined}>
          Marcar como paga
        </Button>
      )
    return <span className="text-xs text-fg-3">Paga em {date(s.paidAt)}</span>
  }

  const columns: Column<Settlement>[] = [
    { id: 'month', header: 'Mês', sortValue: (s) => s.month, csv: (s) => monthLabel(s.month, 'short'), cell: (s) => <span className="font-medium capitalize">{monthLabel(s.month, 'short')}</span> },
    {
      id: 'provider',
      header: 'Provedor',
      pinned: true,
      minWidth: 180,
      sortValue: (s) => s.providerName,
      cell: (s) => (
        <span className="flex items-center gap-2">
          <BrandMark name={s.providerName} hue={hueOf.get(s.providerId) ?? 0} size={24} className="rounded-md" />
          <span className="font-medium text-fg">{s.providerName}</span>
        </span>
      ),
    },
    { id: 'ggr', header: 'GGR', align: 'right', sortValue: (s) => s.ggr, csv: (s) => s.ggr.toFixed(2), cell: (s) => <span className={cn(s.ggr < 0 && 'text-danger')}>{brl(s.ggr)}</span> },
    { id: 'feePct', header: 'Taxa', align: 'right', sortValue: (s) => view(s).feePct, csv: (s) => view(s).feePct, cell: (s) => pct(view(s).feePct, 0, true) },
    { id: 'feeDue', header: 'Taxa devida', align: 'right', sortValue: (s) => view(s).feeDue, csv: (s) => view(s).feeDue.toFixed(2), cell: (s) => <span className="font-semibold">{brl(view(s).feeDue)}</span> },
    {
      id: 'status',
      header: 'Status',
      sortValue: (s) => s.status,
      csv: (s) => SETTLEMENT_STATUS_LABEL[s.status],
      cell: (s) => (
        <span className="flex items-center gap-1.5">
          <Badge tone={ST_TONE[s.status]} dot>
            {SETTLEMENT_STATUS_LABEL[s.status]}
          </Badge>
          {s.status === 'aberta' && !monthEnded(s.month, now) && <Badge>Parcial</Badge>}
          {isOverdue(s, now) && (
            <Badge tone="danger" icon={AlertTriangle}>
              Vencida
            </Badge>
          )}
        </span>
      ),
    },
    { id: 'due', header: 'Vencimento', sortValue: (s) => s.dueDate, csv: (s) => date(s.dueDate), cell: (s) => <span className="text-fg-2">{date(s.dueDate)}</span> },
    { id: 'closed', header: 'Fechada por', defaultHidden: true, csv: (s) => (s.closedBy ? `${s.closedBy} ${dateTime(s.closedAt)}` : ''), cell: (s) => (s.closedBy ? <span className="text-fg-2">{s.closedBy}</span> : '—') },
    { id: 'ref', header: 'Referência', defaultHidden: true, csv: (s) => s.paymentRef ?? '', cell: (s) => (s.paymentRef ? <Mono>{s.paymentRef}</Mono> : '—') },
    { id: 'action', header: 'Ação', pinned: true, csv: () => '', cell: (s) => <div onClick={(e) => e.stopPropagation()}>{actionCell(s)}</div> },
  ]

  const open = openId ? settlements.get(openId) : undefined

  return (
    <div className="space-y-5">
      <section aria-label="Resumo das apurações" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="A fechar" icon={Hourglass} tone={toClose.length ? 'warning' : 'neutral'} value={brl(sumFee(toClose))} hint={`${toClose.length} apurações de meses encerrados`} />
        <KpiCard label="Fechadas a pagar" icon={ReceiptText} tone="info" value={brl(sumFee(awaiting))} hint={<span className={cn(overdue.length && 'font-semibold text-danger')}>{`${awaiting.length} apurações · ${overdue.length} vencidas`}</span>} />
        <KpiCard label={`Pagas em ${year}`} icon={BadgeCheck} tone="success" value={brlCompact(sumFee(paidYear))} hint={`${paidYear.length} pagamentos registrados`} />
        <KpiCard label="Mês atual (parcial)" icon={CalendarCheck} tone="primary" value={brlCompact(sumFee(settlements.items.filter((s) => s.month === monthKey(now))))} hint="taxa estimada até hoje" formula={<>O mês em andamento fica aberto até o fim. A taxa muda conforme o GGR e a taxa atual de cada provedora.</>} />
      </section>

      {!allowed ? (
        <Alert tone="neutral" icon={Lock} title="Somente consulta">
          {noPerm} Os cargos Financeiro, Administrador e Superadmin podem fechar e pagar.
        </Alert>
      ) : (
        <Alert tone="info" title="Como funciona a apuração">
          Cada mês gera uma apuração por provedora: GGR do mês × taxa da provedora. GGR negativo não gera taxa. A apuração fecha a partir do dia 1º do mês seguinte e vence no dia 10. Ao fechar, a taxa
          fica congelada; mudar a taxa em Provedoras só afeta as apurações abertas.
        </Alert>
      )}

      <DataTable
        className="relative"
        caption="Apurações mensais por provedora"
        rows={rows}
        columns={columns}
        rowKey={(s) => s.id}
        searchText={(s) => s.providerName}
        searchPlaceholder="Buscar provedor"
        initialSort={{ id: 'feeDue', dir: 'desc' }}
        exportName="apuracoes"
        onExport={(n) => audit('exportar', 'Apurações de GGR', `Exportação CSV de ${n} apurações`)}
        onRowClick={(s) => setOpenId(s.id)}
        resetKey={`${month}|${status}`}
        pageSize={25}
        rowClassName={(s) => (isOverdue(s, now) ? 'bg-danger/[0.03]' : undefined)}
        toolbar={
          <>
            <Select
              aria-label="Mês da apuração"
              value={month}
              onChange={setMonth}
              placeholder="Todos os meses"
              options={months.map((m) => ({ value: m, label: `${monthLabel(m)}${!monthEnded(m, now) ? ' (em andamento)' : ''}` }))}
              className="w-full sm:w-60 [&_select]:h-9"
            />
            <ChipFilter<'todas' | SettlementStatus>
              value={status}
              onChange={setStatus}
              options={[
                { value: 'todas', label: 'Todas', count: counts.todas },
                { value: 'aberta', label: 'Abertas', count: counts.aberta, tone: monthOpenEnded.length ? 'warning' : undefined },
                { value: 'fechada', label: 'Fechadas', count: counts.fechada },
                { value: 'paga', label: 'Pagas', count: counts.paga },
              ]}
            />
          </>
        }
        toolbarRight={
          monthOpenEnded.length > 0 ? (
            <Button size="sm" variant="primary" icon={Lock} onClick={closeAll} disabled={!allowed} title={!allowed ? noPerm : undefined}>
              Fechar {monthOpenEnded.length} de {monthLabel(month, 'short')}
            </Button>
          ) : undefined
        }
        empty={{ title: 'Nenhuma apuração neste filtro', description: 'Troque o mês ou o status.' }}
      />

      {open && (
        <Drawer
          open
          onClose={() => setOpenId(null)}
          title={`Apuração · ${open.providerName}`}
          description={`${monthLabel(open.month)} · vence em ${date(open.dueDate)}`}
          headerExtra={
            <Badge tone={ST_TONE[open.status]} dot size="md">
              {SETTLEMENT_STATUS_LABEL[open.status]}
            </Badge>
          }
          footer={open.status !== 'paga' ? actionCell(open, 'md') : undefined}
        >
          <div className="space-y-6">
            <div className="rounded-xl bg-surface-2 p-4">
              <p className="text-xs text-fg-3">Taxa devida</p>
              <p className="mt-1 font-display text-3xl font-bold text-fg tnum">{brl(view(open).feeDue)}</p>
              <p className="mt-1 text-[13px] text-fg-3">
                {brl(Math.max(0, open.ggr))} de GGR × {pct(view(open).feePct, 0, true)}
                {open.ggr < 0 && ' · GGR negativo não gera taxa'}
              </p>
            </div>
            {open.status === 'aberta' && closeBlocker(open, now) && <Alert tone="info">{closeBlocker(open, now)}</Alert>}
            {isOverdue(open, now) && (
              <Alert tone="danger" title="Pagamento vencido">
                O vencimento foi em {date(open.dueDate)}. Registre o pagamento assim que sair do banco.
              </Alert>
            )}
            <DescriptionList
              items={[
                { label: 'Apostado', value: brl(open.bets) },
                { label: 'Pago em prêmios', value: brl(open.wins) },
                { label: 'GGR (receita bruta)', value: brl(open.ggr) },
                { label: 'RTP real', value: pct(open.bets ? open.wins / open.bets : 0, 2) },
              ]}
            />
            <section>
              <h3 className="mb-3 text-sm font-semibold text-fg">Histórico</h3>
              <ol className="relative space-y-4 border-l border-line pl-5">
                {[
                  { done: true, label: 'Aberta', sub: `Apuração de ${monthLabel(open.month)}` },
                  { done: !!open.closedAt, label: 'Fechada', sub: open.closedAt ? `${dateTime(open.closedAt)} por ${open.closedBy}` : 'Aguardando fechamento' },
                  { done: !!open.paidAt, label: 'Paga', sub: open.paidAt ? `${dateTime(open.paidAt)} por ${open.paidBy} · ref. ${open.paymentRef}` : 'Aguardando pagamento' },
                ].map((st) => (
                  <li key={st.label} className="relative">
                    <span className={cn('absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2', st.done ? 'border-success bg-success' : 'border-line-strong bg-surface')} aria-hidden />
                    <p className={cn('text-[13px] font-semibold', st.done ? 'text-fg' : 'text-fg-3')}>{st.label}</p>
                    <p className="text-xs text-fg-3">{st.sub}</p>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </Drawer>
      )}
    </div>
  )
}
