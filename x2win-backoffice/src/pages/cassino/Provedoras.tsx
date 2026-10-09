import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, CirclePause, CirclePlay, Eye, Gamepad2, Network, Pencil, Percent, RefreshCw, Settings2 } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  ChipFilter,
  DataTable,
  DescriptionList,
  Drawer,
  Field,
  FormFieldset,
  KpiCard,
  Mono,
  NumberInput,
  PageHeader,
  Progress,
  Select,
  confirm,
  toast,
  type Column,
  type Tone,
} from '@/components/ui'
import { BarsChart } from '@/components/charts'
import { brl, brlCompact, dateTime, num, pct, relative } from '@/lib/format'
import { useDb } from '@/lib/store'
import { useAggregators, useGames, useProviders } from '@/data/hooks'
import type { Aggregator, Game, Provider } from '@/data/catalog'
import { gameStatsForPeriod, getDailySeries, sumSeries } from '@/data/metrics'
import { CASSINO_KEYS, seedGameBadges } from '@/data/cassino'
import { audit, usePageAccess, useSession } from '@/domain/session'
import { aggregateByProvider, reconcileStats, type ProviderGgr } from '@/domain/ggr'
import { gameHiddenReason, validateProviderFee, type GameBadge } from '@/domain/cassino'
import { AGGREGATOR_HUE, BrandMark, CoverStrip } from './_shared'

type Filter = 'todas' | 'ativa' | 'pausada'
const NO_EDIT = 'Seu cargo pode ver, mas não editar provedoras'

const AGG_STATUS: Record<Aggregator['status'], { label: string; tone: Tone }> = {
  conectado: { label: 'Conectado', tone: 'success' },
  erro: { label: 'Com erro', tone: 'danger' },
  nao_configurado: { label: 'Não configurado', tone: 'neutral' },
}

interface RefreshState {
  at: string | null
  by: string | null
}

export default function Provedoras() {
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  const providers = useProviders()
  const { items: games } = useGames()
  const { items: aggregators } = useAggregators()
  const [badgesMap] = useDb<Record<string, GameBadge[]>>(CASSINO_KEYS.gameBadges, seedGameBadges)
  const [refresh, setRefresh] = useDb<RefreshState>(CASSINO_KEYS.providersRefresh, { at: null, by: null })
  const [filter, setFilter] = useState<Filter>('todas')
  const [aggFilter, setAggFilter] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // GGR dos últimos 30 dias por provedora (mesma base da tela GGR)
  const ggr30 = useMemo(() => {
    const t = sumSeries(getDailySeries().slice(-30))
    return new Map(aggregateByProvider(reconcileStats(gameStatsForPeriod(t.casinoBets, t.casinoWins, 30), t.casinoBets, t.casinoWins), providers.items).map((r) => [r.providerId, r]))
  }, [providers.items])

  const gamesBy = useMemo(() => {
    const m = new Map<string, Game[]>()
    for (const g of games) m.set(g.providerId, [...(m.get(g.providerId) ?? []), g])
    for (const list of m.values()) list.sort((a, b) => b.highlight - a.highlight)
    return m
  }, [games])

  const counts = {
    todas: providers.items.length,
    ativa: providers.items.filter((p) => p.status === 'ativa').length,
    pausada: providers.items.filter((p) => p.status === 'pausada').length,
  }
  const paused = providers.items.filter((p) => p.status === 'pausada')
  const gamesOffByPause = paused.reduce((s, p) => s + (gamesBy.get(p.id)?.filter((g) => g.active).length ?? 0), 0)
  const rows = providers.items.filter((p) => (filter === 'todas' || p.status === filter) && (!aggFilter || p.aggregatorId === aggFilter))
  const totalGgr = [...ggr30.values()].reduce((s, r) => s + r.ggr, 0)
  const totalFee = [...ggr30.values()].reduce((s, r) => s + r.fee, 0)
  const avgFee = providers.items.length ? providers.items.reduce((s, p) => s + p.feePct, 0) / providers.items.length : 0

  const setStatus = async (p: Provider, next: Provider['status']) => {
    if (!canEdit) {
      toast.error(NO_EDIT)
      return
    }
    const list = gamesBy.get(p.id) ?? []
    const activeGames = list.filter((g) => g.active).length
    const ok =
      next === 'pausada'
        ? await confirm({
            title: `Pausar ${p.name}?`,
            description: `Os ${activeGames} jogos ativos da ${p.name} somem do site e das vitrines na hora. Rodadas em andamento terminam normalmente. Os jogos continuam no catálogo e voltam quando a provedora for reativada.`,
            confirmLabel: 'Pausar provedora',
            tone: 'warning',
            icon: CirclePause,
            details: (
              <DescriptionList
                columns={2}
                items={[
                  { label: 'Jogos que saem do site', value: num(activeGames) },
                  { label: 'GGR nos últimos 30 dias', value: brl(ggr30.get(p.id)?.ggr ?? 0) },
                ]}
              />
            ),
          })
        : await confirm({
            title: `Reativar ${p.name}?`,
            description: `Os ${activeGames} jogos ativos da ${p.name} voltam ao site e às vitrines automáticas.`,
            confirmLabel: 'Reativar provedora',
            tone: 'success',
            icon: CirclePlay,
          })
    if (!ok) return
    providers.update(p.id, { status: next, updatedAt: new Date().toISOString() })
    audit(
      next === 'pausada' ? 'desligar' : 'ligar',
      `Provedora ${p.name}`,
      next === 'pausada' ? `Provedora pausada: ${activeGames} jogos saíram do site` : `Provedora reativada: ${activeGames} jogos voltaram ao site`,
    )
    toast.success(next === 'pausada' ? `${p.name} pausada` : `${p.name} reativada`, {
      description: next === 'pausada' ? `${activeGames} jogos saíram do site.` : `${activeGames} jogos voltaram ao site.`,
    })
  }

  const doRefresh = () => {
    if (!canEdit) {
      toast.error(NO_EDIT)
      return
    }
    setRefreshing(true)
    setTimeout(() => {
      // recalcula a contagem de jogos de cada provedora a partir do catálogo atual
      let changed = 0
      providers.replace(
        providers.items.map((p) => {
          const n = gamesBy.get(p.id)?.length ?? 0
          if (n !== p.games) changed++
          return n !== p.games ? { ...p, games: n } : p
        }),
      )
      const at = new Date().toISOString()
      setRefresh({ at, by: user.name })
      audit('sincronizar', 'Provedoras', `Lista de provedoras atualizada a partir dos agregadores (${providers.items.length} provedoras)`)
      setRefreshing(false)
      toast.success('Lista de provedoras atualizada', {
        description: changed ? `${changed} provedoras tiveram a contagem de jogos ajustada.` : `${providers.items.length} provedoras conferidas. Nenhuma mudança.`,
      })
    }, 1100)
  }

  const columns: Column<Provider>[] = [
    {
      id: 'name',
      header: 'Provedora',
      pinned: true,
      minWidth: 220,
      sortValue: (p) => p.name,
      cell: (p) => (
        <div className="flex items-center gap-3">
          <BrandMark name={p.name} hue={p.logoHue} size={34} />
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{p.name}</p>
            <Mono className="text-[11.5px] text-fg-3">{p.id}</Mono>
          </div>
        </div>
      ),
    },
    {
      id: 'games',
      header: 'Jogos',
      sortValue: (p) => gamesBy.get(p.id)?.length ?? 0,
      csv: (p) => gamesBy.get(p.id)?.length ?? 0,
      cell: (p) => {
        const list = gamesBy.get(p.id) ?? []
        const on = list.filter((g) => !gameHiddenReason(g, p)).length
        return (
          <div className="w-32">
            <p className="text-[13px] text-fg tnum">
              <strong className="font-semibold">{on}</strong>
              <span className="text-fg-3"> de {list.length} no site</span>
            </p>
            <Progress value={on} max={Math.max(1, list.length)} tone={p.status === 'pausada' ? 'warning' : 'success'} className="mt-1" label={`${on} de ${list.length} jogos no site`} />
          </div>
        )
      },
    },
    {
      id: 'aggregator',
      header: 'Agregador',
      sortValue: (p) => p.aggregatorId,
      cell: (p) => {
        const a = aggregators.find((x) => x.id === p.aggregatorId)
        return (
          <span className="flex items-center gap-2">
            <BrandMark name={a?.name ?? p.aggregatorId} hue={AGGREGATOR_HUE[p.aggregatorId] ?? 200} size={22} className="rounded-md" />
            <span className="text-fg-2">{a?.name ?? p.aggregatorId}</span>
          </span>
        )
      },
    },
    {
      id: 'fee',
      header: 'Taxa',
      align: 'right',
      sortValue: (p) => p.feePct,
      csv: (p) => `${p.feePct}%`,
      cell: (p) => <span className="font-medium tnum">{pct(p.feePct, 0, true)}</span>,
    },
    {
      id: 'ggr',
      header: 'GGR 30 dias',
      align: 'right',
      sortValue: (p) => ggr30.get(p.id)?.ggr ?? 0,
      cell: (p) => {
        const r = ggr30.get(p.id)
        return (
          <div>
            <p className="font-medium text-fg tnum">{brlCompact(r?.ggr ?? 0)}</p>
            <p className="text-[11.5px] text-fg-3 tnum">taxa {brlCompact(r?.fee ?? 0)}</p>
          </div>
        )
      },
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (p) => p.status,
      csv: (p) => (p.status === 'ativa' ? 'Ativa' : 'Pausada'),
      cell: (p) => (
        <Badge tone={p.status === 'ativa' ? 'success' : 'warning'} dot>
          {p.status === 'ativa' ? 'Ativa' : 'Pausada'}
        </Badge>
      ),
    },
    {
      id: 'updatedAt',
      header: 'Atualizada',
      sortValue: (p) => p.updatedAt,
      csv: (p) => dateTime(p.updatedAt),
      cell: (p) => (
        <span className="text-[13px] text-fg-2" title={dateTime(p.updatedAt)}>
          {relative(p.updatedAt)}
        </span>
      ),
    },
    {
      id: 'action',
      header: 'Ação',
      pinned: true,
      csv: () => '',
      cell: (p) => (
        <div onClick={(e) => e.stopPropagation()}>
          {p.status === 'ativa' ? (
            <Button size="sm" icon={CirclePause} onClick={() => setStatus(p, 'pausada')} disabled={!canEdit} title={!canEdit ? NO_EDIT : undefined}>
              Pausar
            </Button>
          ) : (
            <Button size="sm" variant="soft" icon={CirclePlay} onClick={() => setStatus(p, 'ativa')} disabled={!canEdit} title={!canEdit ? NO_EDIT : undefined}>
              Reativar
            </Button>
          )}
        </div>
      ),
    },
  ]

  const open = openId ? providers.get(openId) : undefined
  const chartRows = [...ggr30.values()].slice(0, 8).map((r) => ({ name: r.providerName, ggr: Math.round(r.ggr), fee: Math.round(r.fee) }))

  return (
    <>
      <PageHeader
        actions={
          <>
            {refresh.at && <span className="hidden text-[13px] text-fg-3 sm:inline">Atualizada {relative(refresh.at)}</span>}
            <Button icon={RefreshCw} onClick={doRefresh} loading={refreshing} disabled={!canEdit} title={!canEdit ? NO_EDIT : 'Buscar a lista de provedoras nos agregadores'}>
              Atualizar
            </Button>
          </>
        }
      />

      <section aria-label="Resumo das provedoras" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Provedoras" icon={Building2} value={num(counts.todas)} hint={`${counts.ativa} ativas`} onClick={() => setFilter('todas')} active={filter === 'todas'} />
        <KpiCard
          label="Pausadas"
          icon={CirclePause}
          tone={counts.pausada ? 'warning' : 'neutral'}
          value={num(counts.pausada)}
          hint={`${gamesOffByPause} jogos fora do site`}
          onClick={() => setFilter(filter === 'pausada' ? 'todas' : 'pausada')}
          active={filter === 'pausada'}
        />
        <KpiCard label="Jogos no catálogo" icon={Gamepad2} tone="info" value={num(games.length)} hint={`em ${gamesBy.size} provedoras`} />
        <KpiCard
          label="Taxas · 30 dias"
          icon={Percent}
          tone="primary"
          value={brlCompact(totalFee)}
          hint={`${pct(totalGgr ? totalFee / totalGgr : 0)} do GGR · média ${pct(avgFee, 1, true)}`}
          formula={<>Soma da taxa de cada provedora sobre o GGR dela nos últimos 30 dias. GGR negativo não gera taxa. Detalhe por mês em Crescimento › GGR › Apurações.</>}
        />
      </section>

      {paused.length > 0 && (
        <Alert tone="warning" className="mb-5" title={`${paused.length} ${paused.length === 1 ? 'provedora está pausada' : 'provedoras estão pausadas'}: ${paused.map((p) => p.name).join(', ')}`}>
          Pausar uma provedora esconde todos os jogos dela do site e das vitrines, sem apagar nada. O histórico e o GGR continuam nos relatórios.
        </Alert>
      )}

      {/* Integrações do catálogo */}
      <section aria-labelledby="integracoes" className="mb-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="integracoes" className="text-[15px] font-semibold text-fg">
              Integrações do catálogo
            </h2>
            <p className="text-[13px] text-fg-3">Os agregadores entregam os jogos de cada provedora.</p>
          </div>
          <Link to="/games/agregadores" className="link inline-flex items-center gap-1 text-[13px]">
            <Settings2 size={14} aria-hidden /> Configurar agregadores
          </Link>
        </div>
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-1">
          {aggregators.map((a) => {
            const st = AGG_STATUS[a.status]
            const list = providers.items.filter((p) => p.aggregatorId === a.id)
            const active = list.filter((p) => p.status === 'ativa').length
            const env = a.environments.find((e) => e.id === a.currentEnv)
            const gamesCount = list.reduce((s, p) => s + (gamesBy.get(p.id)?.length ?? 0), 0)
            return (
              <Card key={a.id} className="p-4">
                <div className="flex items-start gap-3">
                  <BrandMark name={a.name} hue={AGGREGATOR_HUE[a.id] ?? 200} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-semibold text-fg">{a.name}</p>
                      <Badge tone={st.tone} dot>
                        {st.label}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-fg-3">
                      {a.contracted ? 'Contratado' : 'Não contratado'} · {env?.label ?? a.currentEnv}
                    </p>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3">
                  <div>
                    <dt className="text-[11px] text-fg-3">Provedoras</dt>
                    <dd className="text-[15px] font-bold text-fg tnum">
                      {active}
                      <span className="text-xs font-normal text-fg-3">/{list.length}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-fg-3">Jogos</dt>
                    <dd className="text-[15px] font-bold text-fg tnum">{num(gamesCount)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-fg-3">Catálogo</dt>
                    <dd className="text-[15px] font-bold text-fg tnum">{num(a.lastSyncGames)}</dd>
                  </div>
                </dl>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-3">
                  <RefreshCw size={12} aria-hidden /> Sincronizado {relative(a.lastSyncAt)}
                </p>
              </Card>
            )
          })}
          </div>
          <Card className="p-4 lg:col-span-3">
            <p className="text-[13px] font-semibold text-fg">GGR por provedora · 30 dias</p>
            <p className="mb-3 text-xs text-fg-3">As 8 maiores. A parte laranja é a taxa paga à provedora.</p>
            <BarsChart
              ariaLabel="GGR e taxa das 8 maiores provedoras nos últimos 30 dias"
              data={chartRows}
              xKey="name"
              layout="horizontal"
              format="brl"
              height={236}
              categoryWidth={108}
              stacked
              series={[
                { key: 'fee', label: 'Taxa', slot: 2 },
                { key: 'ggr', label: 'GGR', slot: 1 },
              ]}
            />
          </Card>
        </div>
      </section>

      <DataTable
        className="relative"
        caption="Provedoras de jogos"
        rows={rows}
        columns={columns}
        rowKey={(p) => p.id}
        searchText={(p) => `${p.name} ${p.id}`}
        searchPlaceholder="Buscar provedora"
        initialSort={{ id: 'ggr', dir: 'desc' }}
        exportName="provedoras"
        onExport={(n) => audit('exportar', 'Provedoras', `Exportação CSV de ${n} provedoras`)}
        onRowClick={(p) => setOpenId(p.id)}
        resetKey={`${filter}|${aggFilter}`}
        pageSize={25}
        rowClassName={(p) => (p.status === 'pausada' ? 'bg-warning/[0.04]' : undefined)}
        rowActions={(p) => [
          { label: 'Ver detalhes', icon: Eye, onSelect: () => setOpenId(p.id) },
          { label: 'Editar taxa', icon: Pencil, onSelect: () => setOpenId(p.id), disabled: !canEdit },
          { divider: true },
          p.status === 'ativa'
            ? { label: 'Pausar provedora', icon: CirclePause, danger: true, onSelect: () => setStatus(p, 'pausada'), disabled: !canEdit }
            : { label: 'Reativar provedora', icon: CirclePlay, onSelect: () => setStatus(p, 'ativa'), disabled: !canEdit },
        ]}
        toolbar={
          <>
            <ChipFilter<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'todas', label: 'Todas', count: counts.todas },
                { value: 'ativa', label: 'Ativas', count: counts.ativa },
                { value: 'pausada', label: 'Pausadas', count: counts.pausada, tone: 'warning' },
              ]}
            />
            <Select
              aria-label="Filtrar por agregador"
              value={aggFilter}
              onChange={setAggFilter}
              placeholder="Todos os agregadores"
              options={aggregators.map((a) => ({ value: a.id, label: a.name }))}
              className="w-full sm:w-52 [&_select]:h-9"
            />
          </>
        }
        empty={{ title: 'Nenhuma provedora neste filtro', description: 'Troque o filtro de status ou de agregador.', icon: Network }}
      />

      {open && (
        <ProviderDrawer
          key={open.id}
          provider={open}
          games={gamesBy.get(open.id) ?? []}
          ggr={ggr30.get(open.id)}
          aggregatorName={aggregators.find((a) => a.id === open.aggregatorId)?.name ?? open.aggregatorId}
          badgesOf={(g) => badgesMap[g.id] ?? []}
          canEdit={canEdit}
          onClose={() => setOpenId(null)}
          onToggle={() => setStatus(open, open.status === 'ativa' ? 'pausada' : 'ativa')}
          onSaveFee={(fee) => {
            providers.update(open.id, { feePct: fee, updatedAt: new Date().toISOString() })
            audit('editar', `Provedora ${open.name}`, `Taxa sobre o GGR: ${pct(open.feePct, 2, true)} → ${pct(fee, 2, true)}`)
            toast.success('Taxa atualizada', { description: 'Vale para as apurações ainda abertas. As fechadas mantêm a taxa da época.' })
          }}
        />
      )}
    </>
  )
}

function ProviderDrawer({
  provider: p,
  games,
  ggr,
  aggregatorName,
  badgesOf,
  canEdit,
  onClose,
  onToggle,
  onSaveFee,
}: {
  provider: Provider
  games: Game[]
  ggr: ProviderGgr | undefined
  aggregatorName: string
  badgesOf: (g: Game) => GameBadge[]
  canEdit: boolean
  onClose: () => void
  onToggle: () => void
  onSaveFee: (fee: number) => void
}) {
  const [fee, setFee] = useState(p.feePct)
  const err = validateProviderFee(fee)
  const dirty = fee !== p.feePct
  const onSite = games.filter((g) => !gameHiddenReason(g, p))
  const previewFee = ggr && !err ? (ggr.ggr > 0 ? (ggr.ggr * fee) / 100 : 0) : 0

  return (
    <Drawer
      open
      onClose={onClose}
      title={p.name}
      description={`Via ${aggregatorName} · atualizada ${relative(p.updatedAt)}`}
      headerExtra={
        <Badge tone={p.status === 'ativa' ? 'success' : 'warning'} dot size="md">
          {p.status === 'ativa' ? 'Ativa' : 'Pausada'}
        </Badge>
      }
      footer={
        <>
          <Button
            icon={p.status === 'ativa' ? CirclePause : CirclePlay}
            onClick={onToggle}
            disabled={!canEdit}
            className="mr-auto"
            title={!canEdit ? NO_EDIT : undefined}
          >
            {p.status === 'ativa' ? 'Pausar provedora' : 'Reativar provedora'}
          </Button>
          <Button onClick={onClose}>Fechar</Button>
          <Button variant="primary" disabled={!canEdit || !dirty || !!err} onClick={() => onSaveFee(fee)}>
            Salvar taxa
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="flex items-center gap-4 rounded-xl bg-surface-2 p-4">
          <BrandMark name={p.name} hue={p.logoHue} size={56} />
          <div className="grid flex-1 grid-cols-3 gap-3">
            <div>
              <p className="text-xs text-fg-3">No site</p>
              <p className="text-lg font-bold text-fg tnum">
                {onSite.length}
                <span className="text-xs font-normal text-fg-3">/{games.length}</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-fg-3">GGR 30 dias</p>
              <p className="truncate text-lg font-bold text-fg tnum">{brlCompact(ggr?.ggr ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs text-fg-3">RTP real</p>
              <p className="text-lg font-bold text-fg tnum">{pct(ggr?.rtp ?? 0)}</p>
            </div>
          </div>
        </div>

        {p.status === 'pausada' && (
          <Alert tone="warning" title="Provedora pausada">
            Os jogos dela não aparecem no site nem nas vitrines. Reative para que voltem.
          </Alert>
        )}

        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Jogos com mais destaque</h3>
          <CoverStrip games={games} providerName={() => p.name} badgesOf={badgesOf} max={5} size="sm" className="flex-wrap" empty={<p className="text-[13px] text-fg-3">Nenhum jogo no catálogo.</p>} />
          <p className="mt-2 text-xs text-fg-3">
            Capas, destaque e status de cada jogo ficam em{' '}
            <Link to="/games/jogos" className="link">
              Jogos
            </Link>
            .
          </p>
        </section>

        <FormFieldset readOnly={!canEdit}>
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-fg">Taxa sobre o GGR</h3>
            <Field
              label="Taxa da provedora"
              htmlFor="p-fee"
              error={err}
              hint={
                ggr
                  ? `Nos últimos 30 dias, ${pct(fee, 2, true)} sobre ${brl(ggr.ggr)} de GGR dariam ${brl(previewFee)} de taxa.`
                  : 'Percentual cobrado sobre o GGR (apostado − pago) do mês.'
              }
            >
              <div className="max-w-[180px]">
                <NumberInput id="p-fee" value={fee} onValueChange={setFee} min={0} max={50} step={0.5} suffix="%" invalid={!!err} />
              </div>
            </Field>
            <Alert tone="info">A nova taxa vale para as apurações ainda abertas. Apurações fechadas e pagas mantêm a taxa da época.</Alert>
          </section>
        </FormFieldset>

        <DescriptionList
          items={[
            { label: 'Agregador', value: aggregatorName },
            { label: 'ID', value: <Mono>{p.id}</Mono> },
            { label: 'Rodadas em 30 dias', value: num(ggr?.rounds ?? 0) },
            { label: 'Última atualização', value: dateTime(p.updatedAt) },
          ]}
        />
      </div>
    </Drawer>
  )
}
