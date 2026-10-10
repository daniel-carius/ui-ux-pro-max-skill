import { useEffect, useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  CircleDashed,
  CircleDot,
  Coins,
  Gamepad2,
  Goal,
  HandFist,
  Hourglass,
  Info,
  Landmark,
  Layers,
  ListChecks,
  Radio,
  RefreshCw,
  ShieldAlert,
  Ticket,
  Trophy,
  UserRound,
  Volleyball,
  X,
} from 'lucide-react'
import { DonutChart, type SeriesSlot } from '@/components/charts'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  DateRangePicker,
  Drawer,
  EmptyState,
  Input,
  KpiCard,
  Mono,
  PageHeader,
  PersonCell,
  Select,
  Tabs,
  inRange,
  presetRange,
  toast,
  useTabParam,
  type Column,
  type DateRange,
  type Tone,
} from '@/components/ui'
import { brl, brlCompact, date, dateTime, mult, num, pct, plural, readDecimalText, relative, time } from '@/lib/format'
import { cn } from '@/lib/cn'
import { isApiMode } from '@/lib/api'
import { dbGet, refreshKey } from '@/lib/store'
import { DATA_KEYS, useSportsBets } from '@/data/hooks'
import { SPORTS_BET_STATUS_LABEL, seedSportsBets, type SportsBet, type SportsBetStatus, type SportsSelection } from '@/data/sports'
import { BET_TYPE_LABEL, LEG_RESULT_LABEL, betSearchText, exposure, legResults, settleFromFeed, sportsTotals, type LegResult } from '@/domain/esportes'
import { PlayerDrawer, TableFrame, useCanOpenPlayer } from '@/pages/geral/_shared'

const STATUS_TONE: Record<SportsBetStatus, Tone> = {
  aberta: 'info',
  ganha: 'success',
  perdida: 'danger',
  cancelada: 'neutral',
  cashout: 'warning',
  reembolsada: 'neutral',
}

const SPORT_ICON: Record<SportsSelection['sport'], LucideIcon> = {
  Futebol: Goal,
  Basquete: CircleDot,
  Tênis: CircleDashed,
  eSports: Gamepad2,
  MMA: HandFist,
  Vôlei: Volleyball,
}

const SPORT_SLOT: Record<SportsSelection['sport'], SeriesSlot> = {
  Futebol: 1,
  Basquete: 2,
  Tênis: 3,
  eSports: 4,
  MMA: 5,
  Vôlei: 7,
}

const LEG_TONE: Record<LegResult, Tone> = { ganhou: 'success', perdeu: 'danger', aberta: 'info', anulada: 'neutral', encerrada: 'warning' }

type TabId = 'abertas' | 'todas'

/** Filtro de valor apostado: aceita a tecla só se o texto ainda forma número ("1.000.000", "R$ 12,50" colado). */
function acceptStake(t: string, set: (v: string) => void) {
  if (t.trim() === '') return set('')
  const r = readDecimalText(t)
  if (r.ok) set(r.text)
}

export default function ApostasEsportivas() {
  const bets = useSportsBets()
  const [tab, setTab] = useTabParam<TabId>('abertas', ['abertas', 'todas'] as const)
  const [range, setRange] = useState<DateRange>(() => presetRange('30d'))
  const [playerQ, setPlayerQ] = useState('')
  const [provider, setProvider] = useState('')
  const [minV, setMinV] = useState('')
  const [maxV, setMaxV] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [playerOpen, setPlayerOpen] = useState<string | null>(null)
  const canOpenPlayer = useCanOpenPlayer()
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(() => new Date())
  const [, setTick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 15_000)
    return () => clearInterval(t)
  }, [])

  const open = useMemo(() => bets.items.filter((b) => b.status === 'aberta'), [bets.items])
  const inPeriod = useMemo(() => bets.items.filter((b) => inRange(b.at, range)), [bets.items, range])
  const providers = useMemo(() => [...new Set(bets.items.map((b) => b.provider))], [bets.items])

  // texto pt-BR ("12,5", "1.000"); o campo recusa o que não forma número (readDecimalText)
  const stakeOf = (t: string) => {
    const r = t.trim() === '' ? null : readDecimalText(t)
    return r?.ok ? r.value : null
  }
  const min = stakeOf(minV)
  const max = stakeOf(maxV)
  const rangeError = min !== null && max !== null && min > max ? 'O mínimo é maior que o máximo.' : null
  const filtersActive = !!(playerQ.trim() || provider || minV || maxV)

  const rows = useMemo(() => {
    const base = tab === 'abertas' ? open : inPeriod
    const q = playerQ.trim()
    return base.filter(
      (b) =>
        (!q || b.playerId.includes(q)) &&
        (!provider || b.provider === provider) &&
        (min === null || b.stake >= min) &&
        (max === null || b.stake <= max),
    )
  }, [tab, open, inPeriod, playerQ, provider, min, max])

  const exp = useMemo(() => exposure(open), [open])
  const totals = useMemo(() => sportsTotals(inPeriod), [inPeriod])
  const bySport = useMemo(() => {
    const m = new Map<SportsSelection['sport'], number>()
    for (const b of inPeriod) m.set(b.selections[0].sport, (m.get(b.selections[0].sport) ?? 0) + b.stake)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([sport, value]) => ({ label: sport, value, slot: SPORT_SLOT[sport] }))
  }, [inPeriod])
  const topExposure = useMemo(() => [...open].sort((a, b) => b.potential - a.potential).slice(0, 5), [open])

  const clearFilters = () => {
    setPlayerQ('')
    setProvider('')
    setMinV('')
    setMaxV('')
  }

  /** Modo API: as apostas vêm da plataforma; "Atualizar" só relê a lista do servidor (nada é liquidado no painel). */
  const refreshFromServer = async () => {
    const openBefore = new Set(open.map((b) => b.id))
    setRefreshing(true)
    try {
      const before = dbGet<SportsBet[]>(DATA_KEYS.sportsBets, seedSportsBets)
      await refreshKey(DATA_KEYS.sportsBets)
      const after = dbGet<SportsBet[]>(DATA_KEYS.sportsBets, seedSportsBets)
      // a recarga troca a lista por uma nova; a mesma lista (e não a padrão, de chave nunca gravada)
      // indica que a leitura falhou: o aviso de erro já apareceu
      if (after === before && before !== seedSportsBets()) return
      const settled = after.filter((b) => openBefore.has(b.id) && b.status !== 'aberta')
      setLastUpdate(new Date())
      toast.success('Lista atualizada', {
        description: settled.length
          ? `${plural(settled.length, 'aposta liquidada', 'apostas liquidadas')} desde a última consulta: ${plural(settled.filter((s) => s.status === 'ganha').length, 'ganha', 'ganhas')} e ${plural(settled.filter((s) => s.status === 'perdida').length, 'perdida', 'perdidas')}.`
          : 'Nenhuma aposta nova liquidada desde a última consulta.',
      })
    } finally {
      setRefreshing(false)
    }
  }

  const refresh = () => {
    if (isApiMode()) {
      if (!refreshing) void refreshFromServer()
      return
    }
    setRefreshing(true)
    setTimeout(() => {
      const { next, settled } = settleFromFeed(bets.items, Date.now(), 5)
      if (settled.length) bets.replace(next)
      setLastUpdate(new Date())
      setRefreshing(false)
      toast.success('Lista atualizada', {
        description: settled.length
          ? `${plural(settled.length, 'aposta liquidada', 'apostas liquidadas')} pela Betby: ${plural(settled.filter((s) => s.status === 'ganha').length, 'ganha', 'ganhas')} e ${plural(settled.filter((s) => s.status === 'perdida').length, 'perdida', 'perdidas')}.`
          : 'Nenhuma aposta nova liquidada desde a última consulta.',
      })
    }, 700)
  }

  const columns: Column<SportsBet>[] = [
    {
      id: 'at',
      header: 'Data',
      sortValue: (b) => b.at,
      csv: (b) => dateTime(b.at),
      cell: (b) => (
        <div className="text-[13px] leading-tight">
          <p className="text-fg">{date(b.at)}</p>
          <p className="text-xs text-fg-3">{time(b.at)}</p>
        </div>
      ),
    },
    {
      id: 'player',
      header: 'Jogador',
      sortValue: (b) => b.playerName,
      csv: (b) => `${b.playerName} (${b.playerId})`,
      cell: (b) => (
        <div className="max-w-[170px] leading-tight">
          <p className="truncate text-[13px] font-medium text-fg">{b.playerName}</p>
          <p className="text-xs text-fg-3">ID {b.playerId}</p>
        </div>
      ),
    },
    {
      id: 'bet',
      header: 'Aposta',
      minWidth: 230,
      pinned: true,
      csv: (b) => b.selections.map((s) => `${s.event} · ${s.market}: ${s.pick}`).join(' | '),
      cell: (b) => {
        const s = b.selections[0]
        const Icon = SPORT_ICON[s.sport]
        return (
          <div className="flex max-w-[260px] items-start gap-2">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-3 text-fg-2" title={s.sport}>
              <Icon size={14} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                <span className="truncate">{s.event}</span>
                {b.selections.length > 1 && <Badge tone="primary">{`+${b.selections.length - 1}`}</Badge>}
                {b.live && (
                  <Badge tone="danger" icon={Radio}>
                    Ao vivo
                  </Badge>
                )}
              </p>
              <p className="truncate text-xs text-fg-3">
                {s.market}: <span className="text-fg-2">{s.pick}</span>
              </p>
            </div>
          </div>
        )
      },
    },
    {
      id: 'type',
      header: 'Tipo',
      sortValue: (b) => b.type,
      csv: (b) => BET_TYPE_LABEL[b.type],
      cell: (b) => (
        <span className="text-[13px] text-fg-2">
          {BET_TYPE_LABEL[b.type]}
          {b.selections.length > 1 && <span className="text-fg-3"> · {b.selections.length}</span>}
        </span>
      ),
    },
    { id: 'stake', money: true, header: 'Valor', align: 'right', sortValue: (b) => b.stake, cell: (b) => <span className="font-semibold text-fg">{brl(b.stake)}</span> },
    { id: 'odd', header: 'Odd', align: 'right', sortValue: (b) => b.odd, csv: (b) => b.odd, cell: (b) => <span className="text-fg-2">{mult(b.odd).replace('x', '')}</span> },
    { id: 'potential', money: true, header: 'Potencial', label: 'Potencial de ganho', align: 'right', sortValue: (b) => b.potential, cell: (b) => <span className="text-fg">{brl(b.potential)}</span> },
    {
      id: 'paid', money: true,
      header: 'Valor pago',
      align: 'right',
      sortValue: (b) => b.paid,
      csv: (b) => b.paid,
      cell: (b) => (b.status === 'aberta' ? <span className="text-fg-3">—</span> : <span className={cn('font-medium', b.paid > 0 ? 'text-fg' : 'text-fg-3')}>{brl(b.paid)}</span>),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (b) => b.status,
      csv: (b) => SPORTS_BET_STATUS_LABEL[b.status],
      cell: (b) => (
        <Badge tone={STATUS_TONE[b.status]} dot>
          {SPORTS_BET_STATUS_LABEL[b.status]}
        </Badge>
      ),
    },
    { id: 'id', header: 'Bilhete', defaultHidden: true, sortValue: (b) => b.id, cell: (b) => <Mono>{b.id}</Mono> },
    { id: 'provider', header: 'Provedor', defaultHidden: true, sortValue: (b) => b.provider, cell: (b) => <Badge>{b.provider}</Badge> },
  ]

  const openBet = openId ? bets.get(openId) : undefined

  return (
    <>
      <PageHeader
        actions={
          <>
            <span className="text-[13px] text-fg-3" aria-live="polite">
              Atualizado {relative(lastUpdate) === 'agora' ? 'agora' : relative(lastUpdate)}
            </span>
            <Button icon={RefreshCw} onClick={refresh} loading={refreshing}>
              Atualizar
            </Button>
          </>
        }
      >
        <Tabs<TabId>
          className="mt-5"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'abertas', label: 'Abertas', icon: Hourglass, count: open.length },
            { value: 'todas', label: 'Todas', icon: ListChecks },
          ]}
        />
      </PageHeader>

      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-[13px] text-fg-3">
            <Info size={14} className="shrink-0" aria-hidden />
            Somente consulta. Cancelar ou ajustar bilhetes é feito no back-office da Betby, que também liquida as apostas.
          </p>
          <DateRangePicker value={range} onChange={setRange} />
        </div>

        <section aria-label="Resumo das apostas esportivas" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <KpiCard label="Em aberto" icon={Hourglass} tone="info" value={brlCompact(exp.stake)} hint={`${num(open.length)} bilhetes sem resultado`} />
          <KpiCard
            label="Exposição"
            icon={ShieldAlert}
            tone="danger"
            value={brlCompact(exp.potential)}
            hint={`risco líquido ${brlCompact(exp.liability)}`}
            formula={<>Exposição = soma do potencial de ganho das apostas abertas. É o máximo que a casa paga se todas ganharem. Risco líquido = exposição − valor já apostado nelas.</>}
          />
          <KpiCard label="Apostado" icon={Coins} value={brlCompact(totals.staked)} hint={`${num(totals.count)} bilhetes no período`} formula={<>Soma do valor de todos os bilhetes feitos no período, de qualquer status.</>} />
          <KpiCard
            label="Pago"
            icon={Trophy}
            tone="warning"
            value={brlCompact(totals.paid)}
            hint={`${num(totals.won)} ganhas · ${num(totals.cashouts)} cash out`}
            formula={<>Prêmios de bilhetes ganhos e valores de cash out. Cancelados e reembolsados ({brl(totals.refunded)}) não entram: o valor só voltou ao jogador.</>}
          />
          <KpiCard
            label="GGR esportes"
            icon={Landmark}
            tone={totals.ggr >= 0 ? 'success' : 'danger'}
            value={brlCompact(totals.ggr)}
            hint={`margem de ${pct(totals.margin)}`}
            formula={<>GGR = apostado nos bilhetes decididos (ganhos, perdidos e cash out) − valor pago. Bilhetes abertos entram quando forem liquidados.</>}
          />
        </section>

        <div className="grid gap-6 xl:grid-cols-5">
          <Card className="xl:col-span-3">
            <CardHeader title="Maiores exposições" icon={ShieldAlert} description="Bilhetes abertos com maior potencial de pagamento" />
            <CardBody>
              {topExposure.length === 0 ? (
                <EmptyState icon={Ticket} title="Nenhuma aposta aberta" description="Quando houver bilhetes aguardando resultado, os maiores aparecem aqui." className="py-8" />
              ) : (
                <ul className="divide-y divide-line">
                  {topExposure.map((b) => (
                    <li key={b.id}>
                      <button type="button" onClick={() => setOpenId(b.id)} className="flex w-full items-center gap-3 rounded-lg py-2.5 text-left hover:bg-surface-2 sm:px-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger">
                          {b.selections.length > 1 ? <Layers size={15} aria-hidden /> : <Ticket size={15} aria-hidden />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-fg">
                            {b.selections[0].event}
                            {b.selections.length > 1 && <span className="text-fg-3"> +{b.selections.length - 1}</span>}
                          </p>
                          <p className="truncate text-xs text-fg-3">
                            {b.playerName} · {brl(b.stake)} a {mult(b.odd).replace('x', '')}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[13px] font-semibold text-fg tnum">{brl(b.potential)}</p>
                          <p className="text-[11px] text-fg-3">potencial</p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader title="Apostado por esporte" description="Valor apostado no período, pelo esporte da 1ª seleção" />
            <CardBody>
              {bySport.length ? (
                <DonutChart ariaLabel="Valor apostado por esporte" data={bySport.slice(0, 5)} format="brl" height={170} centerValue={brlCompact(totals.staked)} centerLabel="apostado" />
              ) : (
                <EmptyState title="Sem apostas no período" className="py-8" />
              )}
            </CardBody>
          </Card>
        </div>

        <TableFrame>
          <DataTable
            caption={tab === 'abertas' ? 'Apostas abertas' : 'Todas as apostas'}
            rows={rows}
            columns={columns}
            rowKey={(b) => b.id}
            searchText={betSearchText}
            searchPlaceholder="Buscar evento, time ou mercado"
            initialSort={{ id: 'at', dir: 'desc' }}
            pageSize={25}
            exportName={tab === 'abertas' ? 'apostas-abertas' : 'apostas-esportivas'}
            onRowClick={(b) => setOpenId(b.id)}
            rowActions={(b) => [
              { label: 'Ver bilhete', icon: Ticket, onSelect: () => setOpenId(b.id) },
              { label: 'Ver jogador', icon: UserRound, disabled: !canOpenPlayer, hint: canOpenPlayer ? undefined : 'só em Usuários', onSelect: () => setPlayerOpen(b.playerId) },
            ]}
            resetKey={`${tab}|${playerQ}|${provider}|${minV}|${maxV}|${range.from.getTime()}`}
            toolbar={
              <>
                <div className="w-full sm:w-36">
                  <label htmlFor="ae-player" className="sr-only">
                    ID do jogador
                  </label>
                  <Input id="ae-player" icon={UserRound} inputMode="numeric" placeholder="ID do jogador" value={playerQ} onChange={(e) => setPlayerQ(e.target.value.replace(/\D/g, ''))} className="[&_input]:h-9" />
                </div>
                <div className="w-full sm:w-36">
                  <label htmlFor="ae-provider" className="sr-only">
                    Provedor
                  </label>
                  <Select id="ae-provider" value={provider} onChange={setProvider} options={[{ value: '', label: 'Todos provedores' }, ...providers.map((p) => ({ value: p, label: p }))]} className="[&_select]:h-9" />
                </div>
                <div className="flex w-full items-center gap-1.5 sm:w-auto">
                  <label htmlFor="ae-min" className="sr-only">
                    Valor mínimo
                  </label>
                  <Input id="ae-min" prefix="R$" type="text" inputMode="decimal" autoComplete="off" placeholder="mín." value={minV} onChange={(e) => acceptStake(e.target.value, setMinV)} invalid={!!rangeError} className="w-full sm:w-28 [&_input]:h-9" />
                  <span className="text-fg-3" aria-hidden>
                    –
                  </span>
                  <label htmlFor="ae-max" className="sr-only">
                    Valor máximo
                  </label>
                  <Input id="ae-max" prefix="R$" type="text" inputMode="decimal" autoComplete="off" placeholder="máx." value={maxV} onChange={(e) => acceptStake(e.target.value, setMaxV)} invalid={!!rangeError} className="w-full sm:w-28 [&_input]:h-9" />
                </div>
                {rangeError && (
                  <span className="text-xs font-medium text-danger" role="alert">
                    {rangeError}
                  </span>
                )}
                {filtersActive && (
                  <Button size="sm" variant="ghost" icon={X} onClick={clearFilters}>
                    Limpar filtros
                  </Button>
                )}
              </>
            }
            empty={{
              icon: Ticket,
              title: tab === 'abertas' ? 'Nenhuma aposta aberta neste filtro' : 'Nenhuma aposta neste filtro',
              description: 'Troque os filtros ou o período para ver outras apostas.',
              action: filtersActive ? (
                <Button size="sm" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              ) : undefined,
            }}
          />
        </TableFrame>
      </div>

      <BetDrawer
        b={openBet}
        onClose={() => setOpenId(null)}
        onPlayer={(id) => {
          setOpenId(null)
          setPlayerOpen(id)
        }}
      />
      <PlayerDrawer playerId={playerOpen} onClose={() => setPlayerOpen(null)} />
    </>
  )
}

function BetDrawer({ b, onClose, onPlayer }: { b: SportsBet | undefined; onClose: () => void; onPlayer: (id: string) => void }) {
  if (!b) return null
  const results = legResults(b)
  return (
    <Drawer
      open
      onClose={onClose}
      title={`Bilhete ${b.id}`}
      description={`${dateTime(b.at)} · ${relative(b.at)}`}
      headerExtra={
        <Badge tone={STATUS_TONE[b.status]} dot size="md">
          {SPORTS_BET_STATUS_LABEL[b.status]}
        </Badge>
      }
      footer={
        <Button icon={UserRound} onClick={() => onPlayer(b.playerId)}>
          Ver jogador
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="primary" icon={b.selections.length > 1 ? Layers : Ticket}>
            {`${BET_TYPE_LABEL[b.type]}${b.selections.length > 1 ? ` · ${b.selections.length} seleções` : ''}`}
          </Badge>
          {b.live && (
            <Badge tone="danger" icon={Radio}>
              Ao vivo
            </Badge>
          )}
          <Badge>{b.provider}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <SlipStat label="Valor apostado" value={brl(b.stake)} />
          <SlipStat label="Odd total" value={mult(b.odd).replace('x', '')} />
          <SlipStat label="Potencial de ganho" value={brl(b.potential)} />
          <SlipStat
            label="Valor pago"
            value={b.status === 'aberta' ? '—' : brl(b.paid)}
            tone={b.status === 'ganha' || b.status === 'cashout' ? 'success' : undefined}
            sub={b.status === 'cancelada' || b.status === 'reembolsada' ? 'valor devolvido' : b.status === 'cashout' ? 'encerrado antes do fim' : undefined}
          />
        </div>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Jogador</h3>
          <button type="button" onClick={() => onPlayer(b.playerId)} className="w-full rounded-xl border border-line p-3 text-left hover:bg-surface-2">
            <PersonCell name={b.playerName} sub={`ID ${b.playerId}`} />
          </button>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Seleções</h3>
          <ol className="space-y-2.5">
            {b.selections.map((s, i) => {
              const Icon = SPORT_ICON[s.sport]
              const r = results[i]
              return (
                <li key={i} className="rounded-xl border border-line p-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg-2">
                      <Icon size={15} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-fg-3">
                        {s.sport} · {s.league}
                      </p>
                      <p className="text-sm font-semibold text-fg">{s.event}</p>
                      <p className="mt-0.5 text-[13px] text-fg-2">
                        {s.market}: <strong className="text-fg">{s.pick}</strong>
                      </p>
                      <p className="mt-1 text-xs text-fg-3">Início {dateTime(s.startsAt)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="rounded-md bg-surface-2 px-2 py-0.5 font-display text-sm font-bold text-fg tnum ring-1 ring-line">{mult(s.odd).replace('x', '')}</span>
                      <Badge tone={LEG_TONE[r]}>{LEG_RESULT_LABEL[r]}</Badge>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
          {b.selections.length > 1 && (
            <p className="mt-3 text-xs leading-5 text-fg-3">
              Odd total = produto das odds ({b.selections.map((s) => mult(s.odd).replace('x', '')).join(' × ')}). Na múltipla, basta uma seleção errada para o bilhete perder.
            </p>
          )}
        </section>

        <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-xs leading-5 text-fg-3">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
          Somente consulta. Cancelamento, anulação de seleção e ajuste de odd são feitos pela Betby e chegam aqui na próxima atualização.
        </p>
      </div>
    </Drawer>
  )
}

function SlipStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'success' }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 px-3.5 py-3">
      <p className="text-xs text-fg-3">{label}</p>
      <p className={cn('mt-0.5 truncate font-display text-lg font-bold tnum', tone === 'success' ? 'text-success' : 'text-fg')}>{value}</p>
      {sub && <p className="text-[11px] text-fg-3">{sub}</p>}
    </div>
  )
}
