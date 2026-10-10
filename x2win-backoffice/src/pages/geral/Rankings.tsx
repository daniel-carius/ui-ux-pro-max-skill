import { useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ChartColumn, Coins, Dices, Eye, Landmark, Lightbulb, Medal, Trophy, TrendingUp, Users, Zap } from 'lucide-react'
import { BarsChart } from '@/components/charts'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  Formula,
  KpiCard,
  PageHeader,
  PersonCell,
  Progress,
  Segmented,
  Switch,
  Tabs,
  useTabParam,
  type Column,
} from '@/components/ui'
import { brl, brlCompact, num, numCompact, pct } from '@/lib/format'
import { cn } from '@/lib/cn'
import { isApiMode } from '@/lib/api'
import { usePlayers, useTransactions } from '@/data/hooks'
import type { Transaction } from '@/data/finance'
import type { Player } from '@/data/players'
import { RANK_PERIODS, playerStatsForPeriod, type RankPeriod } from '@/data/geral'
import { audit } from '@/domain/session'
import { RANK_CRITERIA, rankPlayers, topShare, type RankCriterion } from '@/domain/geral'
import { PlayerDrawer, PlayerStatusBadge, SignedAmount, TableFrame, maskEmailShort } from './_shared'

const CRITERIA: RankCriterion[] = ['apostou', 'apostas', 'ganhou', 'maior_ganho', 'resultado', 'ggr']

/**
 * Extrato para somar o período: na demonstração, o mesmo de Transações (estorno feito na sessão já conta); no modo
 * API o ranking não lê as transações e usa os totais da ficha.
 */
const useRankStatement: () => Transaction[] | null = isApiMode() ? () => null : () => useTransactions().items
const CRITERIA_ICON: Record<RankCriterion, LucideIcon> = {
  apostou: Coins,
  apostas: Dices,
  ganhou: Trophy,
  maior_ganho: Zap,
  resultado: TrendingUp,
  ggr: Landmark,
}

interface Row {
  playerId: string
  position: number
  value: number
  wagered: number
  bets: number
  won: number
  biggestWin: number
  player: Player
}

export default function Rankings() {
  const [criterion, setCriterion] = useTabParam<RankCriterion>('apostou', CRITERIA, 'criterio')
  const [period, setPeriod] = useState<RankPeriod>('30d')
  const [onlyPlayers, setOnlyPlayers] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const { items: players } = usePlayers()
  const statement = useRankStatement()
  const meta = RANK_CRITERIA[criterion]
  const fmt = (v: number) => (meta.format === 'brl' ? brl(v) : num(v))

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
  const stats = useMemo(() => playerStatsForPeriod(players, period, statement), [players, period, statement])
  const pool = useMemo(() => (onlyPlayers ? stats.filter((s) => byId.get(s.playerId)?.role === 'Jogador') : stats), [stats, onlyPlayers, byId])
  const ranked: Row[] = useMemo(
    () =>
      rankPlayers(pool, criterion)
        .map((r) => ({ ...r, player: byId.get(r.playerId)! }))
        .filter((r) => !!r.player),
    [pool, criterion, byId],
  )

  const totals = useMemo(() => {
    const wagered = pool.reduce((s, x) => s + x.wagered, 0)
    const won = pool.reduce((s, x) => s + x.won, 0)
    const bets = pool.reduce((s, x) => s + x.bets, 0)
    const best = pool.reduce<(typeof pool)[number] | null>((a, x) => (!a || x.biggestWin > a.biggestWin ? x : a), null)
    return { wagered, won, bets, ggr: wagered - won, best, bestPlayer: best ? byId.get(best.playerId) : undefined }
  }, [pool, byId])

  const periodLabel = RANK_PERIODS.find((p) => p.value === period)!.label.toLowerCase()
  const top = ranked.slice(0, 3)
  const top10 = ranked.slice(0, 10)
  const maxAbs = Math.max(1, ...ranked.slice(0, 50).map((r) => Math.abs(r.value)))
  const concentration = topShare(
    ranked.map((r) => r.value),
    10,
  )
  const winners = ranked.filter((r) => r.won > r.wagered).length

  const extraCols: Column<Row>[] = [
    { id: 'wagered', money: true, header: 'Apostado', align: 'right', sortValue: (r) => r.wagered, cell: (r) => brl(r.wagered) },
    { id: 'bets', header: 'Apostas', align: 'right', sortValue: (r) => r.bets, cell: (r) => num(r.bets) },
    { id: 'won', money: true, header: 'Ganho', align: 'right', sortValue: (r) => r.won, cell: (r) => brl(r.won) },
    { id: 'biggestWin', money: true, header: 'Maior ganho', align: 'right', sortValue: (r) => r.biggestWin, cell: (r) => brl(r.biggestWin) },
    {
      id: 'result', money: true,
      header: 'Resultado do jogador',
      label: 'Resultado do jogador',
      align: 'right',
      sortValue: (r) => r.won - r.wagered,
      csv: (r) => Math.round((r.won - r.wagered) * 100) / 100,
      cell: (r) => <SignedAmount value={r.won - r.wagered} className="font-medium" />,
    },
  ]
  const duplicate: Partial<Record<RankCriterion, string>> = { apostou: 'wagered', apostas: 'bets', ganhou: 'won', maior_ganho: 'biggestWin', resultado: 'result' }

  const columns: Column<Row>[] = [
    {
      id: 'position',
      header: '#',
      pinned: true,
      sortValue: (r) => r.position,
      csv: (r) => r.position,
      cell: (r) => <PositionMark position={r.position} />,
    },
    {
      id: 'player',
      header: 'Jogador',
      minWidth: 200,
      pinned: true,
      sortValue: (r) => r.player.nickname.toLowerCase(),
      csv: (r) => `${r.player.nickname} (ID ${r.player.id})`,
      cell: (r) => (
        <div className="flex items-center gap-2">
          <PersonCell name={r.player.nickname} sub={`ID ${r.player.id} · ${maskEmailShort(r.player.email)}`} />
          {r.player.tags.includes('VIP') && <Badge tone="gold">VIP</Badge>}
        </div>
      ),
    },
    {
      id: 'metric',
      header: meta.metric,
      label: meta.metric,
      // valor em reais: no CSV sempre com duas casas ("254,00", não "254")
      money: meta.format === 'brl',
      pinned: true,
      minWidth: 180,
      sortValue: (r) => r.value,
      csv: (r) => r.value,
      cell: (r) => (
        <div className="min-w-[160px]">
          <div className={cn('text-[13px] font-bold tnum', meta.signed ? (r.value >= 0 ? 'text-success' : 'text-danger') : 'text-fg')}>
            {meta.signed && r.value > 0 ? '+' : meta.signed && r.value < 0 ? '−' : ''}
            {meta.signed ? fmt(Math.abs(r.value)) : fmt(r.value)}
          </div>
          <Progress value={Math.abs(r.value)} max={maxAbs} tone={meta.signed && r.value < 0 ? 'danger' : 'primary'} className="mt-1 h-1" label={`${r.player.nickname}: ${fmt(r.value)}`} />
        </div>
      ),
    },
    ...extraCols.filter((c) => c.id !== duplicate[criterion]),
    { id: 'status', header: 'Status', defaultHidden: true, sortValue: (r) => r.player.status, csv: (r) => r.player.status, cell: (r) => <PlayerStatusBadge status={r.player.status} /> },
  ]

  return (
    <>
      <PageHeader
        actions={
          <Segmented
            ariaLabel="Período do ranking"
            value={period}
            onChange={setPeriod}
            options={RANK_PERIODS.map((p) => ({ value: p.value, label: p.label }))}
          />
        }
      >
        <Tabs<RankCriterion>
          className="mt-5"
          value={criterion}
          onChange={setCriterion}
          items={CRITERIA.map((c) => ({ value: c, label: RANK_CRITERIA[c].label, icon: CRITERIA_ICON[c] }))}
        />
      </PageHeader>

      <div className="space-y-6">
        <section aria-label="Resumo do período" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Jogadores no ranking" icon={Users} value={num(ranked.length)} hint={`apostaram nos ${periodLabel}`.replace('nos desde o início', 'desde o início')} />
          <KpiCard label="Total apostado" icon={Coins} tone="info" value={brlCompact(totals.wagered)} hint={`${numCompact(totals.bets)} apostas`} />
          <KpiCard
            label="GGR para a casa"
            icon={Landmark}
            tone={totals.ggr >= 0 ? 'success' : 'danger'}
            value={brlCompact(totals.ggr)}
            hint={`${pct(totals.wagered ? totals.ggr / totals.wagered : 0)} do apostado`}
            formula={<>GGR = apostado − ganho, somando os jogadores do ranking no período.</>}
          />
          <KpiCard
            label="Maior ganho único"
            icon={Zap}
            tone="warning"
            value={brl(totals.best?.biggestWin ?? 0)}
            hint={totals.bestPlayer ? `por ${totals.bestPlayer.nickname}` : '—'}
          />
        </section>

        {ranked.length === 0 ? (
          <Card>
            <EmptyState icon={Trophy} title="Ninguém apostou neste período" description="Escolha um período maior para ver o ranking." className="py-16" />
          </Card>
        ) : (
          <>
            <section aria-label="Pódio" className="grid gap-4 md:grid-cols-3 md:items-end">
              {top.map((r) => (
                <PodiumCard key={r.playerId} r={r} value={r.value} fmt={fmt} signed={!!meta.signed} metric={meta.metric} onOpen={() => setOpenId(r.playerId)} />
              ))}
            </section>

            <div className="grid gap-6 xl:grid-cols-5">
              <Card className="xl:col-span-3">
                <CardHeader title={`Top 10 · ${meta.label.toLowerCase()}`} icon={ChartColumn} description={`${meta.metric} nos ${periodLabel}`.replace('nos desde o início', 'desde o início')} actions={<Formula title={meta.label}>{meta.formula}</Formula>} />
                <CardBody>
                  <BarsChart
                    ariaLabel={`Top 10 jogadores por ${meta.metric.toLowerCase()}`}
                    data={top10.map((r) => ({ name: r.player.nickname, value: r.value }))}
                    xKey="name"
                    layout="horizontal"
                    categoryWidth={124}
                    height={Math.max(220, top10.length * 30)}
                    format={meta.format}
                    series={[{ key: 'value', label: meta.metric, slot: meta.signed ? 3 : 1 }]}
                  />
                </CardBody>
              </Card>
              <Card className="xl:col-span-2">
                <CardHeader title="Leitura do ranking" icon={Lightbulb} description="O que os números do período mostram" />
                <CardBody className="space-y-4">
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="text-fg-2">Peso dos 10 primeiros</span>
                      <span className="font-semibold text-fg tnum">{pct(concentration, 0)}</span>
                    </div>
                    <Progress value={concentration} max={1} tone={concentration > 0.5 ? 'warning' : 'primary'} label="Concentração do top 10" />
                    <p className="mt-1.5 text-xs leading-5 text-fg-3">
                      {concentration > 0.5
                        ? 'Mais da metade do resultado depende de poucos jogadores. Vale um cuidado VIP com eles.'
                        : 'Resultado bem distribuído entre os jogadores.'}
                    </p>
                  </div>
                  <ul className="space-y-2.5 border-t border-line pt-4 text-[13px]">
                    <Insight label="Jogadores no lucro" value={`${num(winners)} de ${num(ranked.length)}`} sub={`${pct(ranked.length ? winners / ranked.length : 0, 0)} ganharam mais do que apostaram`} />
                    <Insight label="VIP no top 10" value={num(top10.filter((r) => r.player.tags.includes('VIP')).length)} sub="com a etiqueta VIP na ficha" />
                    <Insight
                      label="Afiliados e influenciadores no top 10"
                      value={num(top10.filter((r) => r.player.role !== 'Jogador').length)}
                      sub="contas que também divulgam a casa"
                    />
                    <Insight label="Aposta média" value={brl(totals.bets ? totals.wagered / totals.bets : 0)} sub="valor apostado ÷ apostas" />
                  </ul>
                </CardBody>
              </Card>
            </div>
          </>
        )}

        <TableFrame>
          <DataTable
            caption={`Ranking: ${meta.label}`}
            rows={ranked}
            columns={columns}
            rowKey={(r) => r.playerId}
            searchText={(r) => `${r.player.nickname} ${r.player.id} ${r.player.name}`}
            searchPlaceholder="Buscar jogador por apelido ou ID"
            initialSort={{ id: 'position', dir: 'asc' }}
            pageSize={25}
            exportName={`ranking-${criterion}-${period}`}
            onExport={(n) => audit('exportar', 'Rankings', `Ranking "${meta.label}" (${RANK_PERIODS.find((p) => p.value === period)!.label}) exportado com ${n} jogadores`)}
            onRowClick={(r) => setOpenId(r.playerId)}
            rowActions={(r) => [{ label: 'Ver resumo do usuário', icon: Eye, onSelect: () => setOpenId(r.playerId) }]}
            resetKey={`${criterion}|${period}|${onlyPlayers}`}
            toolbar={<Switch size="sm" checked={onlyPlayers} onChange={setOnlyPlayers} label="Só jogadores" description="Sem afiliados e influenciadores" className="sm:min-w-[260px]" />}
            empty={{ icon: Trophy, title: 'Ninguém no ranking', description: 'Nenhum jogador apostou no período escolhido.' }}
          />
        </TableFrame>
      </div>

      <PlayerDrawer playerId={openId} onClose={() => setOpenId(null)} />
    </>
  )
}

const MEDAL: Record<1 | 2 | 3, { label: string; cls: string; style?: React.CSSProperties }> = {
  1: { label: '1º lugar', cls: 'bg-gold/15 text-warning dark:text-gold ring-gold/30' },
  2: { label: '2º lugar', cls: 'bg-surface-3 text-fg-2 ring-line-strong/60' },
  3: { label: '3º lugar', cls: 'ring-transparent', style: { color: 'var(--chart-2)', background: 'color-mix(in srgb, var(--chart-2) 14%, transparent)' } },
}

function PositionMark({ position }: { position: number }) {
  if (position <= 3) {
    const m = MEDAL[position as 1 | 2 | 3]
    return (
      <span className={cn('inline-flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-bold ring-1 ring-inset tnum', m.cls)} style={m.style} title={m.label}>
        {position}
      </span>
    )
  }
  return <span className="inline-flex h-7 w-7 items-center justify-center text-[13px] font-semibold text-fg-3 tnum">{position}</span>
}

function PodiumCard({ r, value, fmt, signed, metric, onOpen }: { r: Row; value: number; fmt: (v: number) => string; signed: boolean; metric: string; onOpen: () => void }) {
  const pos = r.position as 1 | 2 | 3
  const m = MEDAL[pos]
  return (
    <div
      className={cn(
        'card relative flex flex-col items-center overflow-hidden px-5 pb-5 text-center',
        pos === 1 ? 'pt-8 md:order-2 md:pb-8' : 'pt-6',
        pos === 2 && 'md:order-1',
        pos === 3 && 'md:order-3',
      )}
    >
      {pos === 1 && <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-gold/15 to-transparent" aria-hidden />}
      <span className={cn('relative mb-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset', m.cls)} style={m.style}>
        {pos === 1 ? <Trophy size={13} aria-hidden /> : <Medal size={13} aria-hidden />}
        {m.label}
      </span>
      <Avatar name={r.player.nickname} size={pos === 1 ? 64 : 52} className="relative" />
      <p className="relative mt-2.5 max-w-full truncate text-[15px] font-bold text-fg">{r.player.nickname}</p>
      <p className="relative max-w-full truncate text-xs text-fg-3">
        ID {r.player.id} · {maskEmailShort(r.player.email)}
      </p>
      <p className="relative mt-3 text-xs text-fg-3">{metric}</p>
      <p className={cn('relative font-display font-bold tnum', pos === 1 ? 'text-[28px] leading-9' : 'text-2xl', signed ? (value >= 0 ? 'text-success' : 'text-danger') : 'text-fg')}>
        {signed && value > 0 ? '+' : signed && value < 0 ? '−' : ''}
        {fmt(Math.abs(value))}
      </p>
      <div className="relative mt-3 flex flex-wrap justify-center gap-1.5">
        <Badge>{`${num(r.bets)} apostas`}</Badge>
        <Badge>{`apostou ${brlCompact(r.wagered)}`}</Badge>
        {r.player.tags.includes('VIP') && <Badge tone="gold">VIP</Badge>}
      </div>
      <Button size="sm" variant="ghost" icon={Eye} className="relative mt-3" onClick={onOpen}>
        Ver ficha
      </Button>
    </div>
  )
}

function Insight({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <li className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-fg-2">{label}</p>
        <p className="text-xs text-fg-3">{sub}</p>
      </div>
      <p className="shrink-0 font-semibold text-fg tnum">{value}</p>
    </li>
  )
}
