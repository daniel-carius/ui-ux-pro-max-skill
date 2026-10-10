import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleDollarSign,
  CloudOff,
  Lightbulb,
  Link2,
  RefreshCw,
  Scale,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'
import { BarsChart, FunnelChart, Sparkline, TrendChart } from '@/components/charts'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  DateRangePicker,
  EmptyState,
  Formula,
  KpiCard,
  PageHeader,
  Segmented,
  Skeleton,
  inRange,
  presetRange,
  previousRange,
  rangeLabel,
  type DateRange,
} from '@/components/ui'
import { brl, brlCompact, dateShort, num, numCompact, pct } from '@/lib/format'
import { cn } from '@/lib/cn'
import { isApiMode } from '@/lib/api'
import { useDb } from '@/lib/store'
import { dayKey } from '@/data/now'
import { gameStatsForPeriod, getDailySeries, sumSeries, walletBalanceAt, type DailyMetrics, type PeriodTotals } from '@/data/metrics'
import { useAffiliates, usePlayers } from '@/data/hooks'

type Status = 'loading' | 'ready' | 'error'

/** Simula a chamada ao serviço de métricas (com carregamento e falha tratada). */
function useMetrics(range: DateRange, attempt: number) {
  const [status, setStatus] = useState<Status>('loading')
  useEffect(() => {
    setStatus('loading')
    const t = setTimeout(() => {
      // a base guarda 400 dias; fora disso o serviço responde "indisponível"
      const series = getDailySeries()
      const oldest = series[0].date
      setStatus(dayKey(range.from) < oldest ? 'error' : 'ready')
    }, 380)
    return () => clearTimeout(t)
  }, [range.from, range.to, attempt])

  const data = useMemo(() => {
    const series = getDailySeries()
    const rows = series.filter((r) => inRange(r.date, range))
    const prevRange = previousRange(range)
    const prevRows = series.filter((r) => inRange(r.date, prevRange))
    return { rows, totals: sumSeries(rows), prev: prevRows.length ? sumSeries(prevRows) : null }
  }, [range])

  return { status, ...data }
}

function delta(cur: number, prev: number | undefined | null) {
  if (prev == null || prev === 0) return null
  return (cur - prev) / Math.abs(prev)
}

type ChartView = 'ggr' | 'caixa' | 'aquisicao'

export default function Dashboard() {
  const [range, setRange] = useState<DateRange>(() => presetRange('30d'))
  const [attempt, setAttempt] = useState(0)
  const [view, setView] = useState<ChartView>('ggr')
  const { status, rows, totals: t, prev: p } = useMetrics(range, attempt)
  const loading = status === 'loading'

  const walletStart = walletBalanceAt(rows[0]?.date ?? '')
  const walletEnd = walletBalanceAt(rows[rows.length - 1]?.date ?? '')

  const chartRows = useMemo(
    () =>
      rows.map((r: DailyMetrics) => ({
        date: r.date,
        ggr: r.casinoBets - r.casinoWins + (r.sportsBets - r.sportsWins),
        ggrCasino: r.casinoBets - r.casinoWins,
        ggrSports: r.sportsBets - r.sportsWins,
        deposits: r.deposits,
        withdrawals: r.withdrawals,
        signups: r.signups,
        ftd: r.ftd,
      })),
    [rows],
  )
  const spark = (k: keyof (typeof chartRows)[number]) => chartRows.map((r) => Number(r[k]))
  const fmtDay = (k: string) => dateShort(`${k}T12:00:00`)

  return (
    <>
      <PageHeader
        actions={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <Button icon={RefreshCw} onClick={() => setAttempt((a) => a + 1)} loading={loading} aria-label="Atualizar indicadores">
              <span className="hidden sm:inline">Atualizar</span>
            </Button>
          </>
        }
      />

      {status === 'error' ? (
        <Card>
          <EmptyState
            icon={CloudOff}
            title="Métricas ainda não estão disponíveis"
            description={`O serviço de métricas não tem dados para ${rangeLabel(range)}. A base guarda os últimos 400 dias. Escolha outro período ou tente de novo.`}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button icon={RefreshCw} onClick={() => setAttempt((a) => a + 1)}>
                  Tentar novamente
                </Button>
                <Button variant="primary" onClick={() => setRange(presetRange('30d'))}>
                  Ver últimos 30 dias
                </Button>
              </div>
            }
            className="py-20"
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Indicadores principais */}
          <section aria-label="Indicadores principais" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="GGR"
              icon={CircleDollarSign}
              value={brlCompact(t.ggr)}
              delta={delta(t.ggr, p?.ggr)}
              hint="vs período anterior"
              loading={loading}
              formula={<>GGR = total apostado − total pago em vitórias (cassino + esportes). Não desconta bônus nem taxas.</>}
              chart={!loading && <Sparkline data={spark('ggr')} slot={1} ariaLabel="Tendência do GGR" />}
            />
            <KpiCard
              label="Depósitos"
              icon={ArrowDownToLine}
              tone="success"
              value={brlCompact(t.deposits)}
              delta={delta(t.deposits, p?.deposits)}
              hint={`${num(t.depositsCount)} PIX pagos`}
              loading={loading}
              formula={<>Soma dos depósitos com PIX confirmado no período. PIX gerado e não pago não entra.</>}
              chart={!loading && <Sparkline data={spark('deposits')} slot={3} ariaLabel="Tendência dos depósitos" />}
            />
            <KpiCard
              label="Saques"
              icon={ArrowUpFromLine}
              tone="warning"
              value={brlCompact(t.withdrawals)}
              delta={delta(t.withdrawals, p?.withdrawals)}
              goodWhenUp={false}
              hint={`${num(t.withdrawalsCount)} pagos`}
              loading={loading}
              formula={<>Soma dos saques aprovados e pagos no período. Recusados, expirados e cancelados não entram.</>}
              chart={!loading && <Sparkline data={spark('withdrawals')} slot={2} ariaLabel="Tendência dos saques" />}
            />
            <KpiCard
              label="Net (depósitos − saques)"
              icon={Scale}
              tone={t.net >= 0 ? 'primary' : 'danger'}
              value={brlCompact(t.net)}
              delta={delta(t.net, p?.net)}
              hint={`${pct(t.deposits ? t.withdrawals / t.deposits : 0, 0)} dos depósitos saíram`}
              loading={loading}
              formula={<>Net = depósitos − saques. Mostra o caixa líquido que ficou na operação.</>}
            />
            <KpiCard
              label="Usuários ativos"
              icon={Users}
              tone="info"
              value={numCompact(t.activeUsers)}
              delta={delta(t.activeUsers, p?.activeUsers)}
              hint="fizeram ao menos 1 aposta"
              loading={loading}
              formula={<>Jogadores únicos com pelo menos uma aposta (cassino ou esportes) no período.</>}
            />
            <KpiCard
              label="Cadastros"
              icon={UserPlus}
              tone="info"
              value={num(t.signups)}
              delta={delta(t.signups, p?.signups)}
              hint={`${num(t.ftd)} FTD · ${pct(t.signups ? t.ftd / t.signups : 0, 0)} converteram`}
              loading={loading}
              formula={<>Contas criadas no período. FTD = primeiro depósito feito no período.</>}
            />
            <KpiCard
              label="Saldo das carteiras · início"
              icon={Wallet}
              tone="neutral"
              value={brlCompact(walletStart)}
              hint={rows[0] ? `em ${fmtDay(rows[0].date)}` : undefined}
              loading={loading}
              formula={<>Soma do saldo real de todos os jogadores no início do primeiro dia do período (passivo da casa).</>}
            />
            <KpiCard
              label="Saldo das carteiras · fim"
              icon={Wallet}
              tone="neutral"
              value={brlCompact(walletEnd)}
              delta={delta(walletEnd, walletStart)}
              goodWhenUp={false}
              hint="vs início do período"
              loading={loading}
              formula={<>Saldo real somado no fim do último dia. Subir muito indica mais dinheiro a pagar se os jogadores sacarem.</>}
            />
          </section>

          {/* Evolução */}
          <Card>
            <CardHeader
              title="Evolução diária"
              description={rangeLabel(range)}
              actions={
                <Segmented
                  size="sm"
                  ariaLabel="Indicador do gráfico"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'ggr', label: 'GGR' },
                    { value: 'caixa', label: 'Depósitos e saques' },
                    { value: 'aquisicao', label: 'Cadastros e FTD' },
                  ]}
                />
              }
            />
            <CardBody>
              {loading ? (
                <Skeleton className="h-[280px] w-full rounded-xl" />
              ) : view === 'ggr' ? (
                <TrendChart
                  ariaLabel="GGR diário de cassino e esportes"
                  data={chartRows}
                  xKey="date"
                  xFormat={fmtDay}
                  format="brl"
                  height={280}
                  series={[
                    { key: 'ggrCasino', label: 'Cassino', slot: 1 },
                    { key: 'ggrSports', label: 'Esportes', slot: 2 },
                  ]}
                />
              ) : view === 'caixa' ? (
                <TrendChart
                  ariaLabel="Depósitos e saques por dia"
                  data={chartRows}
                  xKey="date"
                  xFormat={fmtDay}
                  format="brl"
                  type="line"
                  height={280}
                  series={[
                    { key: 'deposits', label: 'Depósitos', slot: 1 },
                    { key: 'withdrawals', label: 'Saques', slot: 2 },
                  ]}
                />
              ) : (
                <BarsChart
                  ariaLabel="Cadastros e primeiros depósitos por dia"
                  data={chartRows}
                  xKey="date"
                  xFormat={fmtDay}
                  height={280}
                  series={[
                    { key: 'signups', label: 'Cadastros', slot: 1 },
                    { key: 'ftd', label: 'FTD', slot: 3 },
                  ]}
                />
              )}
            </CardBody>
          </Card>

          <div className="grid gap-6 xl:grid-cols-5">
            <ClosingCard t={t} loading={loading} className="xl:col-span-3" />
            <Card className="xl:col-span-2">
              <CardHeader
                title="Funil de depósitos"
                description="Do clique em depositar ao PIX pago"
                actions={
                  <Formula title="Funil de depósitos">
                    Cada etapa conta sessões únicas. A taxa ao lado é a conversão da etapa anterior. A perda entre “PIX gerado” e “PIX pago”
                    costuma indicar problema no gateway ou no tempo de expiração do PIX.
                  </Formula>
                }
              />
              <CardBody>
                {loading ? (
                  <Skeleton className="h-48 w-full" />
                ) : (
                  <>
                    <FunnelChart
                      ariaLabel="Funil de depósitos"
                      steps={[
                        { label: 'Abriu a tela de depósito', value: t.depositFlowOpened },
                        { label: 'Escolheu o valor', value: t.depositAmountChosen },
                        { label: 'PIX gerado', value: t.pixGenerated },
                        { label: 'PIX pago', value: t.pixPaid },
                      ]}
                    />
                    <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
                      Conversão total: <strong className="text-fg">{pct(t.depositFlowOpened ? t.pixPaid / t.depositFlowOpened : 0)}</strong> · ticket médio{' '}
                      <strong className="text-fg">{brl(t.depositsCount ? t.deposits / t.depositsCount : 0)}</strong>
                    </p>
                  </>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
            <TopGamesCard t={t} loading={loading} rangeKey={dayKey(range.from) + dayKey(range.to)} />
            <ConvertingLinksCard t={t} loading={loading} />
            <InsightsCard rows={rows} t={t} p={p} loading={loading} className="lg:col-span-2 2xl:col-span-1" />
          </div>
        </div>
      )}
    </>
  )
}

function ClosingCard({ t, loading, className }: { t: PeriodTotals; loading: boolean; className?: string }) {
  const lines: { label: string; value: number; formula: string; strong?: boolean; negative?: boolean; isCount?: boolean; sub?: string }[] = [
    { label: 'GGR cassino', value: t.ggrCasino, formula: 'Apostas de cassino − vitórias de cassino.' },
    { label: 'GGR esportes', value: t.ggrSports, formula: 'Apostas esportivas liquidadas − prêmios pagos.' },
    { label: 'GGR total', value: t.ggr, formula: 'GGR cassino + GGR esportes.', strong: true },
    { label: 'Bônus convertido', value: -t.bonusConverted, formula: 'Bônus que cumpriu rollover e virou saldo real (custo da casa).', negative: true },
    { label: 'Free spins', value: -t.freeSpinsValue, formula: 'Valor ganho em giros grátis e creditado ao jogador.', negative: true },
    { label: 'Creditações manuais', value: -t.credits, formula: 'Créditos lançados pela equipe na ficha do jogador.', negative: true },
    { label: 'Subtrações manuais', value: t.debits, formula: 'Débitos lançados pela equipe na ficha do jogador.' },
    { label: 'NGR', value: t.ngr, formula: 'NGR = GGR − bônus convertido − free spins − creditações + subtrações.', strong: true },
  ]
  return (
    <Card className={className}>
      <CardHeader title="Fechamento do período" description="Do GGR ao NGR, linha a linha" />
      <CardBody className="pb-3">
        {loading ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <>
            <dl className="divide-y divide-line">
              {lines.map((l) => (
                <div key={l.label} className={cn('flex items-center justify-between gap-3 py-2.5', l.strong && 'bg-surface-2/60 -mx-2 rounded-lg px-2')}>
                  <dt className={cn('flex items-center gap-1 text-[13px]', l.strong ? 'font-semibold text-fg' : 'text-fg-2')}>
                    {l.label}
                    <Formula title={l.label}>{l.formula}</Formula>
                  </dt>
                  <dd className={cn('text-sm tnum', l.strong ? 'font-bold text-fg' : l.value < 0 ? 'text-danger' : 'text-fg')}>{brl(l.value)}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3">
              <MiniStat label="FTD" value={num(t.ftd)} sub={brl(t.ftdAmount)} />
              <MiniStat label="Indicações" value={num(t.referrals)} sub="cadastros por indicação" />
              <MiniStat label="Bônus concedido" value={brlCompact(t.bonusGranted)} sub={`${pct(t.bonusGranted ? t.bonusConverted / t.bonusGranted : 0, 0)} convertido`} />
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-fg-3">{label}</p>
      <p className="mt-0.5 truncate text-base font-bold text-fg">{value}</p>
      <p className="truncate text-xs text-fg-3">{sub}</p>
    </div>
  )
}

function TopGamesCard({ t, loading, rangeKey }: { t: PeriodTotals; loading: boolean; rangeKey: string }) {
  const games = useMemo(
    () => gameStatsForPeriod(t.casinoBets, t.casinoWins, rangeKey.length).slice(0, 5),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t.casinoBets, t.casinoWins, rangeKey],
  )
  const max = Math.max(1, ...games.map((g) => g.ggr))
  return (
    <Card>
      <CardHeader
        title="Top 5 jogos por GGR"
        actions={
          <Link to="/dashboard/ggr?aba=jogos" className="link text-[13px]">
            Ver GGR
          </Link>
        }
      />
      <CardBody>
        {loading ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <ol className="space-y-3.5">
            {games.map((g, i) => (
              <li key={g.gameId} className="flex items-center gap-3">
                <span className="w-4 shrink-0 text-center text-xs font-bold text-fg-3 tnum">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[13px] font-medium text-fg">
                      {g.gameName} <span className="font-normal text-fg-3">· {g.providerName}</span>
                    </p>
                    <p className="shrink-0 text-[13px] font-semibold text-fg tnum">{brl(g.ggr)}</p>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full" style={{ width: `${(g.ggr / max) * 100}%`, background: 'var(--chart-1)' }} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  )
}

/** Link de afiliado com cadastros: totais históricos dos indicados. */
interface ReferralLinkStats {
  id: string
  /** nome do afiliado (demonstração); no modo API só o código do link */
  name: string | null
  code: string
  signups: number
  depositors: number
  deposited: number
}

/** Os links com mais depósitos dos indicados, e a soma de todos (para a participação de cada um). */
interface ReferralRanking {
  links: ReferralLinkStats[]
  totalDeposited: number
}

/** Demonstração: calculado da base de jogadores e de afiliados do navegador. */
function useDemoReferralRanking(): ReferralRanking {
  const { items: affiliates } = useAffiliates()
  const { items: players } = usePlayers()
  return useMemo(() => {
    const byRef = new Map<string, { signups: number; depositors: number; deposited: number }>()
    for (const pl of players) {
      if (!pl.referrerId) continue
      const cur = byRef.get(pl.referrerId) ?? { signups: 0, depositors: 0, deposited: 0 }
      cur.signups++
      if (pl.depositsCount > 0) cur.depositors++
      cur.deposited += pl.totalDeposited
      byRef.set(pl.referrerId, cur)
    }
    const totalDeposited = [...byRef.values()].reduce((s, x) => s + x.deposited, 0)
    const links = affiliates
      .map((a) => ({ id: a.id, name: a.name, code: a.code, ...(byRef.get(a.id) ?? { signups: 0, depositors: 0, deposited: 0 }) }))
      .filter((x) => x.signups > 0)
    return { links, totalDeposited }
  }, [affiliates, players])
}

const PLAYER_METRICS_KEY = 'geral.jogadores.metricas'
/** valor padrão estável (o store compara a referência) */
const NO_METRICS: unknown = {}

/**
 * Modo API: o Dashboard não lê a base de jogadores nem a de afiliados (dado pessoal). Usa as
 * contagens calculadas pelo servidor em geral.jogadores.metricas (top 50 links por valor depositado).
 */
function useServerReferralRanking(): ReferralRanking {
  const [value] = useDb<unknown>(PLAYER_METRICS_KEY, NO_METRICS)
  return useMemo(() => {
    const v = (value && typeof value === 'object' ? value : {}) as { referrals?: unknown; referralsDeposited?: unknown }
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
    const list = Array.isArray(v.referrals) ? (v.referrals as Record<string, unknown>[]) : []
    const links: ReferralLinkStats[] = []
    for (const r of list) {
      // afiliado fora da base (sem código) não tem link para mostrar
      if (!r || typeof r !== 'object' || typeof r.code !== 'string' || !r.code) continue
      links.push({ id: String(r.affiliateId ?? r.code), name: null, code: r.code, signups: n(r.signups), depositors: n(r.depositors), deposited: n(r.deposited) })
    }
    return { links, totalDeposited: n(v.referralsDeposited) || links.reduce((s, x) => s + x.deposited, 0) }
  }, [value])
}

/** Escolhido uma vez: o modo não muda com a página aberta. */
const useReferralRanking: () => ReferralRanking = isApiMode() ? useServerReferralRanking : useDemoReferralRanking

function ConvertingLinksCard({ t, loading }: { t: PeriodTotals; loading: boolean }) {
  const { links, totalDeposited } = useReferralRanking()
  const ranked = useMemo(() => {
    const total = totalDeposited || 1
    // distribui os depósitos do período na proporção histórica de cada link
    return links
      .map((l) => ({ ...l, periodDeposits: (l.deposited / total) * t.deposits * 0.31 }))
      .sort((x, y) => y.periodDeposits - x.periodDeposits)
      .slice(0, 5)
  }, [links, totalDeposited, t.deposits])
  return (
    <Card>
      <CardHeader
        title="Links que converteram"
        actions={
          <Link to="/analysis/links" className="link text-[13px]">
            Ver links
          </Link>
        }
      />
      <CardBody>
        {loading ? (
          <Skeleton className="h-56 w-full" />
        ) : ranked.length === 0 ? (
          <p className="rounded-lg bg-surface-2 px-3 py-3 text-[13px] text-fg-3">Nenhum cadastro por link de afiliado ainda.</p>
        ) : (
          <ul className="divide-y divide-line">
            {ranked.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5 first:pt-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-text">
                  <Link2 size={15} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-fg">{r.name ?? `Link ${r.code}`}</p>
                  <p className="truncate font-mono text-[11.5px] text-fg-3">x2win.bet.br/?ref={r.code}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[13px] font-semibold text-fg tnum">{brlCompact(r.periodDeposits)}</p>
                  <p className="text-[11px] text-fg-3 tnum">
                    {r.depositors}/{r.signups} depositaram
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

function InsightsCard({
  rows,
  t,
  p,
  loading,
  className,
}: {
  rows: DailyMetrics[]
  t: PeriodTotals
  p: PeriodTotals | null
  loading: boolean
  className?: string
}) {
  const insights = useMemo(() => {
    const out: { tone: 'up' | 'down' | 'info'; text: string }[] = []
    if (!rows.length) return out
    if (p) {
      const g = delta(t.ggr, p.ggr) ?? 0
      const casinoShare = t.ggr ? t.ggrCasino / t.ggr : 0
      out.push({
        tone: g >= 0 ? 'up' : 'down',
        text: `GGR ${g >= 0 ? 'subiu' : 'caiu'} ${pct(Math.abs(g))} contra o período anterior. Cassino responde por ${pct(casinoShare, 0)} do resultado.`,
      })
      const convNow = t.pixGenerated ? t.pixPaid / t.pixGenerated : 0
      const convPrev = p.pixGenerated ? p.pixPaid / p.pixGenerated : 0
      out.push({
        tone: convNow >= convPrev ? 'up' : 'down',
        text: `${pct(convNow)} dos PIX gerados foram pagos (antes: ${pct(convPrev)}). ${convNow < convPrev ? 'Vale revisar o gateway e o tempo de expiração.' : 'Gateway estável.'}`,
      })
    }
    const best = rows.reduce((a, b) => (b.casinoBets - b.casinoWins + b.sportsBets - b.sportsWins > a.casinoBets - a.casinoWins + a.sportsBets - a.sportsWins ? b : a))
    const bestGgr = best.casinoBets - best.casinoWins + best.sportsBets - best.sportsWins
    const weekday = new Date(`${best.date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long' })
    out.push({ tone: 'info', text: `Melhor dia: ${weekday}, ${dateShort(`${best.date}T12:00:00`)}, com ${brl(bestGgr)} de GGR.` })
    if (t.ggrSports < 0) out.push({ tone: 'down', text: `Esportes fechou negativo (${brl(t.ggrSports)}). Confira apostas grandes liquidadas em Apostas esportivas.` })
    const bonusShare = t.ggr ? t.bonusCost / t.ggr : 0
    out.push({
      tone: bonusShare > 0.15 ? 'down' : 'info',
      text: `Bônus e free spins consumiram ${pct(bonusShare)} do GGR${bonusShare > 0.15 ? ', acima do teto saudável de 15%' : ''}.`,
    })
    return out
  }, [rows, t, p])
  return (
    <Card className={className}>
      <CardHeader title="Insights" icon={Lightbulb} description="Leituras automáticas do período" />
      <CardBody>
        {loading ? (
          <Skeleton className="h-56 w-full" />
        ) : insights.length === 0 ? (
          <Alert tone="neutral">Sem dados suficientes no período.</Alert>
        ) : (
          <ul className="space-y-3">
            {insights.map((it, i) => {
              const Icon = it.tone === 'up' ? TrendingUp : it.tone === 'down' ? TrendingDown : Lightbulb
              return (
                <li key={i} className="flex items-start gap-2.5">
                  <span
                    className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                      it.tone === 'up' ? 'bg-success/10 text-success' : it.tone === 'down' ? 'bg-danger/10 text-danger' : 'bg-info/10 text-info',
                    )}
                  >
                    <Icon size={14} aria-hidden />
                  </span>
                  <p className="text-[13px] leading-5 text-fg-2">{it.text}</p>
                </li>
              )
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
