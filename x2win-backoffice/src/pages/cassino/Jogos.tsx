import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  FilterX,
  Gamepad2,
  ImageUp,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Undo2,
  Wand2,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ChipFilter,
  DataTable,
  DescriptionList,
  Drawer,
  EmptyState,
  Field,
  FormFieldset,
  IconButton,
  ImageUpload,
  KpiCard,
  Menu,
  Modal,
  Mono,
  NumberInput,
  PageHeader,
  Pagination,
  Progress,
  Segmented,
  Select,
  Switch,
  confirm,
  toast,
  type Column,
  type MenuEntry,
} from '@/components/ui'
import { brl, brlCompact, date, num, numCompact, relative } from '@/lib/format'
import { useDb } from '@/lib/store'
import { useAggregators, useGames, useProviders } from '@/data/hooks'
import { GAME_CATEGORY_LABEL, type Game, type GameCategory, type Provider } from '@/data/catalog'
import { gameStatsForPeriod, getDailySeries, sumSeries, type GameStat } from '@/data/metrics'
import { CASSINO_KEYS, seedGameBadges } from '@/data/cassino'
import { audit, usePageAccess } from '@/domain/session'
import { reconcileStats } from '@/domain/ggr'
import { safeImageSrc } from '@/domain/personalizacao-p1'
import {
  CATEGORY_ORDER,
  GAME_BADGE_LABEL,
  GAME_SORT_LABEL,
  gameHiddenReason,
  highlightLabel,
  sortGames,
  validateHighlight,
  type GameBadge,
  type GameSort,
} from '@/domain/cassino'
import { BADGE_ICON, BrandMark, CATEGORY_ICON, GameCover } from './_shared'

type View = 'grade' | 'lista'
type StatusFilter = 'todos' | 'no_site' | 'fora' | 'novos'
const STATUS_LABEL: Record<StatusFilter, string> = { todos: 'Todas as situações', no_site: 'No site', fora: 'Fora do site', novos: 'Com selo Novo' }
const EXTRA_BADGES: GameBadge[] = ['em_alta', 'exclusivo', 'jackpot']
const NO_EDIT = 'Seu cargo pode ver, mas não editar jogos'

/** Desempenho de cada jogo nos últimos 30 dias (mesma base do GGR). */
function useStats30() {
  return useMemo(() => {
    const t = sumSeries(getDailySeries().slice(-30))
    const list = reconcileStats(gameStatsForPeriod(t.casinoBets, t.casinoWins, 30), t.casinoBets, t.casinoWins).sort((a, b) => b.ggr - a.ggr)
    return new Map(list.map((s, i) => [s.gameId, { ...s, rank: i + 1 }]))
  }, [])
}

export default function Jogos() {
  const { canEdit } = usePageAccess()
  const games = useGames()
  const { items: providers } = useProviders()
  const { items: aggregators } = useAggregators()
  const [badgesMap, setBadgesMap] = useDb<Record<string, GameBadge[]>>(CASSINO_KEYS.gameBadges, seedGameBadges)
  const [view, setView] = useDb<View>(CASSINO_KEYS.gamesView, 'grade')
  const stats30 = useStats30()

  const [query, setQuery] = useState('')
  const [providerId, setProviderId] = useState('')
  const [category, setCategory] = useState<'todas' | GameCategory>('todas')
  const [status, setStatus] = useState<StatusFilter>('todos')
  const [sort, setSort] = useState<GameSort>('destaque')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(30)
  const [openId, setOpenId] = useState<string | null>(null)
  const [coverId, setCoverId] = useState<string | null>(null)

  const pmap = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers])
  const badgesOf = (g: Game) => badgesMap[g.id] ?? []
  const hiddenReason = (g: Game) => gameHiddenReason(g, pmap.get(g.providerId))

  // filtros (menos a categoria, para as contagens dos chips)
  const baseFiltered = useMemo(() => {
    const q = query
      .trim()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
    return games.items.filter((g) => {
      if (providerId && g.providerId !== providerId) return false
      if (status === 'no_site' && hiddenReason(g)) return false
      if (status === 'fora' && !hiddenReason(g)) return false
      if (status === 'novos' && !g.isNew) return false
      if (q) {
        const hay = `${g.name} ${pmap.get(g.providerId)?.name ?? ''}`
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games.items, providerId, status, query, pmap])

  const filtered = useMemo(
    () => sortGames(category === 'todas' ? baseFiltered : baseFiltered.filter((g) => g.category === category), sort),
    [baseFiltered, category, sort],
  )
  const catCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const g of baseFiltered) c[g.category] = (c[g.category] ?? 0) + 1
    return c
  }, [baseFiltered])

  const hasFilters = !!query || !!providerId || category !== 'todas' || status !== 'todos' || sort !== 'destaque'
  const clearFilters = () => {
    setQuery('')
    setProviderId('')
    setCategory('todas')
    setStatus('todos')
    setSort('destaque')
    setPage(0)
  }
  const filterKey = `${query}|${providerId}|${category}|${status}|${sort}`

  // KPIs
  const onSite = games.items.filter((g) => !hiddenReason(g))
  const inactive = games.items.filter((g) => !g.active).length
  const byPausedProvider = games.items.filter((g) => g.active && pmap.get(g.providerId)?.status === 'pausada').length
  const providersWithGames = new Set(games.items.map((g) => g.providerId))
  const activeProviders = providers.filter((p) => providersWithGames.has(p.id) && p.status === 'ativa').length
  const newCount = games.items.filter((g) => g.isNew).length
  const lastSync = aggregators.map((a) => a.lastSyncAt).filter(Boolean).sort().pop() ?? null

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize)

  const toggleActive = async (g: Game, next: boolean) => {
    if (!canEdit) {
      toast.error(NO_EDIT)
      return
    }
    if (!next) {
      const ok = await confirm({
        title: `Desativar ${g.name}?`,
        description: 'O jogo some do site e das vitrines na hora. Rodadas em andamento terminam normalmente e o histórico continua nos relatórios.',
        confirmLabel: 'Desativar jogo',
        tone: 'warning',
        icon: EyeOff,
      })
      if (!ok) return
    }
    games.update(g.id, { active: next })
    audit(next ? 'ligar' : 'desligar', `Jogo ${g.name}`, next ? 'Jogo ativado no site' : 'Jogo desativado do site')
    const paused = pmap.get(g.providerId)?.status === 'pausada'
    toast.success(next ? 'Jogo ativado' : 'Jogo desativado', {
      description: next && paused ? `A provedora ${pmap.get(g.providerId)?.name} está pausada: o jogo só aparece quando ela voltar.` : undefined,
    })
  }

  const actionsFor = (g: Game): MenuEntry[] => [
    { label: 'Ver detalhes', icon: Eye, onSelect: () => setOpenId(g.id) },
    { label: 'Trocar capa', icon: ImageUp, onSelect: () => setCoverId(g.id), disabled: !canEdit },
    { label: 'Editar destaque e selos', icon: Pencil, onSelect: () => setOpenId(g.id), disabled: !canEdit },
    { divider: true },
    g.active
      ? { label: 'Desativar jogo', icon: EyeOff, danger: true, onSelect: () => toggleActive(g, false), disabled: !canEdit }
      : { label: 'Ativar jogo', icon: CheckCircle2, onSelect: () => toggleActive(g, true), disabled: !canEdit },
  ]

  const columns: Column<Game>[] = [
    {
      id: 'name',
      header: 'Jogo',
      pinned: true,
      minWidth: 240,
      sortValue: (g) => g.name,
      cell: (g) => (
        <div className="flex items-center gap-3">
          <div className="w-9 shrink-0">
            <GameCover game={g} size="thumb" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{g.name}</p>
            <Mono className="text-[11.5px] text-fg-3">{g.id}</Mono>
          </div>
        </div>
      ),
    },
    {
      id: 'provider',
      header: 'Provedora',
      sortValue: (g) => pmap.get(g.providerId)?.name ?? '',
      cell: (g) => {
        const p = pmap.get(g.providerId)
        return (
          <span className="flex items-center gap-2">
            <BrandMark name={p?.name ?? g.providerId} hue={p?.logoHue ?? 0} size={24} className="rounded-md" />
            <span className="text-fg-2">{p?.name ?? g.providerId}</span>
          </span>
        )
      },
    },
    {
      id: 'category',
      header: 'Categoria',
      sortValue: (g) => GAME_CATEGORY_LABEL[g.category],
      cell: (g) => <Badge icon={CATEGORY_ICON[g.category]}>{GAME_CATEGORY_LABEL[g.category]}</Badge>,
    },
    { id: 'rtp', header: 'RTP', align: 'right', sortValue: (g) => g.rtp, cell: (g) => <span className="tnum">{g.rtp.toFixed(2).replace('.', ',')}%</span> },
    {
      id: 'highlight',
      header: 'Destaque',
      sortValue: (g) => g.highlight,
      cell: (g) => (
        <div className="flex w-28 items-center gap-2">
          <Progress value={g.highlight} tone={g.highlight >= 85 ? 'primary' : 'info'} label={`Destaque ${g.highlight}`} />
          <span className="w-7 text-right text-xs font-semibold text-fg tnum">{g.highlight}</span>
        </div>
      ),
    },
    {
      id: 'ggr30',
      header: 'GGR 30 dias',
      align: 'right',
      sortValue: (g) => stats30.get(g.id)?.ggr ?? 0,
      cell: (g) => <span className="tnum">{brlCompact(stats30.get(g.id)?.ggr ?? 0)}</span>,
    },
    {
      id: 'badges',
      header: 'Selos',
      csv: (g) => [g.isNew ? 'Novo' : '', ...badgesOf(g).map((b) => GAME_BADGE_LABEL[b])].filter(Boolean).join(', '),
      cell: (g) => {
        const list = [...(g.isNew ? ['novo' as const] : []), ...badgesOf(g)]
        return list.length ? (
          <span className="flex gap-1">
            {list.map((b) => (
              <Badge key={b} tone={b === 'novo' ? 'gold' : b === 'em_alta' ? 'danger' : b === 'jackpot' ? 'primary' : 'info'} icon={BADGE_ICON[b]}>
                {b === 'novo' ? 'Novo' : GAME_BADGE_LABEL[b]}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-fg-3">—</span>
        )
      },
    },
    {
      id: 'status',
      header: 'Situação',
      sortValue: (g) => (hiddenReason(g) ? 1 : 0),
      csv: (g) => hiddenReason(g) ?? 'No site',
      cell: (g) => {
        const r = hiddenReason(g)
        return r ? (
          <Badge tone={g.active ? 'warning' : 'neutral'} dot>
            {g.active ? 'Provedora pausada' : 'Desativado'}
          </Badge>
        ) : (
          <Badge tone="success" dot>
            No site
          </Badge>
        )
      },
    },
    { id: 'bets', header: 'Aposta mín–máx', defaultHidden: true, csv: (g) => `${g.minBet}–${g.maxBet}`, cell: (g) => <span className="text-fg-2 tnum">{`${brl(g.minBet)} – ${brl(g.maxBet)}`}</span> },
    { id: 'createdAt', header: 'No catálogo desde', defaultHidden: true, sortValue: (g) => g.createdAt, csv: (g) => date(g.createdAt), cell: (g) => <span className="text-fg-2">{date(g.createdAt)}</span> },
    {
      id: 'active',
      header: 'Ativo',
      align: 'center',
      csv: (g) => (g.active ? 'Sim' : 'Não'),
      cell: (g) => (
        <span onClick={(e) => e.stopPropagation()} title={!canEdit ? NO_EDIT : undefined} className="inline-flex">
          <Switch size="sm" checked={g.active} onChange={(v) => toggleActive(g, v)} disabled={!canEdit} ariaLabel={`${g.active ? 'Desativar' : 'Ativar'} ${g.name}`} />
        </span>
      ),
    },
  ]

  const open = openId ? games.get(openId) : undefined
  const coverGame = coverId ? games.get(coverId) : undefined

  return (
    <>
      <PageHeader
        actions={
          <Link
            to="/games/agregadores"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] text-fg-2 transition-colors hover:border-line-strong hover:text-fg"
            title="Abrir Agregadores de jogos"
          >
            <RefreshCw size={14} className="text-fg-3" aria-hidden />
            Catálogo sincronizado <strong className="font-semibold text-fg">{relative(lastSync)}</strong>
          </Link>
        }
      />

      <section aria-label="Resumo do catálogo" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Jogos no catálogo" icon={Gamepad2} value={num(games.items.length)} hint={`${CATEGORY_ORDER.filter((c) => games.items.some((g) => g.category === c)).length} categorias`} />
        <KpiCard
          label="No site"
          icon={CheckCircle2}
          tone="success"
          value={num(onSite.length)}
          hint={`${inactive} desativados · ${byPausedProvider} fora por provedora pausada`}
          formula={<>Um jogo aparece no site quando está ativo e a provedora dele também está ativa. Pausar a provedora esconde todos os jogos dela.</>}
        />
        <KpiCard label="Provedoras" icon={Building2} tone="info" value={num(providersWithGames.size)} hint={`${activeProviders} ativas · ${providersWithGames.size - activeProviders} pausadas`} />
        <KpiCard label="Novos" icon={Sparkles} tone="warning" value={num(newCount)} hint="com o selo Novo no site" onClick={() => setStatus(status === 'novos' ? 'todos' : 'novos')} active={status === 'novos'} />
      </section>

      {/* Filtros */}
      <Card className="mb-4 p-3">
        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(0)
              }}
              placeholder="Buscar jogo ou provedora"
              aria-label="Buscar jogo pelo nome"
              className="input-base h-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 xl:w-[620px] xl:shrink-0">
            <Select
              aria-label="Filtrar por provedora"
              value={providerId}
              onChange={(v) => {
                setProviderId(v)
                setPage(0)
              }}
              placeholder="Todas as provedoras"
              options={[...providers].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: `${p.name}${p.status === 'pausada' ? ' (pausada)' : ''}` }))}
              className="[&_select]:h-9"
            />
            <Select
              aria-label="Filtrar por situação"
              value={status}
              onChange={(v) => {
                setStatus(v as StatusFilter)
                setPage(0)
              }}
              options={(Object.keys(STATUS_LABEL) as StatusFilter[]).map((k) => ({ value: k, label: STATUS_LABEL[k] }))}
              className="[&_select]:h-9"
            />
            <Select
              aria-label="Ordenar jogos"
              value={sort}
              onChange={(v) => setSort(v as GameSort)}
              options={(Object.keys(GAME_SORT_LABEL) as GameSort[]).map((k) => ({ value: k, label: GAME_SORT_LABEL[k] }))}
              className="[&_select]:h-9"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
          <ChipFilter<'todas' | GameCategory>
            className="min-w-0"
            value={category}
            onChange={(c) => {
              setCategory(c)
              setPage(0)
            }}
            options={[
              { value: 'todas', label: 'Todas', count: baseFiltered.length },
              ...CATEGORY_ORDER.map((c) => ({ value: c, label: GAME_CATEGORY_LABEL[c], count: catCounts[c] ?? 0 })),
            ]}
          />
          <div className="flex shrink-0 items-center justify-between gap-2">
            <Button size="sm" variant="ghost" icon={FilterX} onClick={clearFilters} disabled={!hasFilters}>
              Limpar filtros
            </Button>
            <Segmented
              ariaLabel="Modo de exibição"
              value={view}
              onChange={setView}
              options={[
                { value: 'grade', label: 'Grade', icon: LayoutGrid },
                { value: 'lista', label: 'Lista', icon: List },
              ]}
            />
          </div>
        </div>
      </Card>

      <p className="mb-3 text-[13px] text-fg-3" aria-live="polite">
        {filtered.length === games.items.length ? `${num(filtered.length)} jogos` : `${num(filtered.length)} de ${num(games.items.length)} jogos`} · ordem: {GAME_SORT_LABEL[sort].toLowerCase()}
      </p>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={Search}
            title="Nenhum jogo encontrado"
            description="Nenhum jogo atende aos filtros escolhidos. Limpe os filtros ou busque por outro nome."
            action={
              <Button icon={FilterX} onClick={clearFilters}>
                Limpar filtros
              </Button>
            }
            className="py-16"
          />
        </Card>
      ) : view === 'grade' ? (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {pageRows.map((g) => {
              const p = pmap.get(g.providerId)
              const reason = hiddenReason(g)
              const CatIcon = CATEGORY_ICON[g.category]
              return (
                <li key={g.id} className="card group flex min-w-0 flex-col p-2">
                  <button
                    type="button"
                    onClick={() => setOpenId(g.id)}
                    className="block w-full overflow-hidden rounded-xl"
                    aria-label={`Abrir detalhes de ${g.name}`}
                  >
                    <GameCover
                      game={g}
                      providerName={p?.name}
                      badges={badgesOf(g)}
                      hidden={!!reason}
                      className="transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  </button>
                  <div className="flex flex-1 flex-col px-1 pb-0.5 pt-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-[13px] font-semibold text-fg" title={g.name}>
                        {g.name}
                      </p>
                      <span title={!canEdit ? NO_EDIT : g.active ? 'Desativar jogo' : 'Ativar jogo'} className="inline-flex">
                        <Switch size="sm" checked={g.active} onChange={(v) => toggleActive(g, v)} disabled={!canEdit} ariaLabel={`${g.active ? 'Desativar' : 'Ativar'} ${g.name}`} />
                      </span>
                    </div>
                    <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-fg-3">
                      <CatIcon size={12} className="shrink-0" aria-hidden />
                      <span className="truncate">
                        {GAME_CATEGORY_LABEL[g.category]} · {p?.name}
                      </span>
                    </p>
                    <div className="mt-2.5 flex items-center gap-2 text-[11px] text-fg-3">
                      <span className="shrink-0 tnum" title="Retorno ao jogador">
                        RTP <strong className="font-semibold text-fg-2">{g.rtp.toFixed(1).replace('.', ',')}%</strong>
                      </span>
                      <Progress value={g.highlight} tone={g.highlight >= 85 ? 'primary' : 'info'} label={`Destaque ${g.highlight} de 100`} className="flex-1" />
                      <span className="shrink-0 font-semibold text-fg-2 tnum" title="Destaque (0 a 100)">
                        {g.highlight}
                      </span>
                    </div>
                    {reason && <p className="mt-1.5 truncate text-[11px] font-medium text-warning">{reason}</p>}
                    <div className="mt-auto flex items-center gap-1 pt-2.5">
                      <div className="min-w-0 flex-1">
                        <Button size="xs" icon={ImageUp} block onClick={() => setCoverId(g.id)} disabled={!canEdit} title={!canEdit ? NO_EDIT : undefined}>
                          Trocar capa
                        </Button>
                      </div>
                      <Menu items={actionsFor(g)} trigger={(tp) => <IconButton {...tp} icon={MoreHorizontal} label={`Mais ações de ${g.name}`} size="sm" className="h-7 w-7" />} />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="card mt-4 overflow-hidden [&>div]:border-t-0">
            <Pagination
              page={safePage}
              pageCount={pageCount}
              total={filtered.length}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(n) => {
                setPageSize(n)
                setPage(0)
              }}
              pageSizeOptions={[12, 30, 60, 120]}
            />
          </div>
        </>
      ) : (
        <DataTable
          className="relative"
          caption="Catálogo de jogos"
          rows={filtered}
          columns={columns}
          rowKey={(g) => g.id}
          exportName="jogos"
          onExport={(n) => audit('exportar', 'Jogos', `Exportação CSV de ${n} jogos`)}
          onRowClick={(g) => setOpenId(g.id)}
          rowActions={actionsFor}
          resetKey={filterKey}
          pageSize={25}
          rowClassName={(g) => (hiddenReason(g) ? 'opacity-70' : undefined)}
        />
      )}

      <GameDrawer
        game={open}
        provider={open ? pmap.get(open.providerId) : undefined}
        aggregatorName={open ? aggregators.find((a) => a.id === pmap.get(open.providerId)?.aggregatorId)?.name : undefined}
        badges={open ? badgesOf(open) : []}
        stat={open ? stats30.get(open.id) : undefined}
        total={games.items.length}
        allGames={games.items}
        canEdit={canEdit}
        onClose={() => setOpenId(null)}
        onChangeCover={() => open && setCoverId(open.id)}
        onSave={async (g, patch, nextBadges) => {
          if (g.active && !patch.active) {
            const ok = await confirm({
              title: `Desativar ${g.name}?`,
              description: 'O jogo some do site e das vitrines na hora. Rodadas em andamento terminam normalmente.',
              confirmLabel: 'Salvar e desativar',
              tone: 'warning',
              icon: EyeOff,
            })
            if (!ok) return false
          }
          const changes: string[] = []
          if (patch.highlight !== g.highlight) changes.push(`destaque ${g.highlight} → ${patch.highlight}`)
          if (patch.isNew !== g.isNew) changes.push(patch.isNew ? 'selo Novo ligado' : 'selo Novo desligado')
          if (patch.active !== g.active) changes.push(patch.active ? 'ativado' : 'desativado')
          const before = badgesOf(g).slice().sort().join(',')
          if (before !== nextBadges.slice().sort().join(',')) changes.push(`selos: ${nextBadges.map((b) => GAME_BADGE_LABEL[b]).join(', ') || 'nenhum'}`)
          games.update(g.id, patch)
          setBadgesMap((m) => ({ ...m, [g.id]: nextBadges }))
          audit('editar', `Jogo ${g.name}`, changes.length ? `Alterado: ${changes.join('; ')}` : 'Sem mudanças')
          toast.success('Jogo atualizado', { description: 'A mudança já vale no site e foi registrada na auditoria.' })
          return true
        }}
      />

      <CoverModal
        game={coverGame}
        providerName={coverGame ? pmap.get(coverGame.providerId)?.name : undefined}
        badges={coverGame ? badgesOf(coverGame) : []}
        onClose={() => setCoverId(null)}
        onSave={(g, cover) => {
          games.update(g.id, { cover })
          audit('editar', `Jogo ${g.name}`, cover ? 'Capa trocada por imagem enviada' : 'Capa restaurada para a arte gerada')
          toast.success(cover ? 'Capa trocada' : 'Capa gerada restaurada', { description: `${g.name} já aparece com a capa nova no site.` })
          setCoverId(null)
        }}
      />
    </>
  )
}

// ---------- Ficha do jogo ----------

function GameDrawer({
  game,
  provider,
  aggregatorName,
  badges,
  stat,
  total,
  allGames,
  canEdit,
  onClose,
  onChangeCover,
  onSave,
}: {
  game: Game | undefined
  provider: Provider | undefined
  aggregatorName: string | undefined
  badges: GameBadge[]
  stat: (GameStat & { rank: number }) | undefined
  total: number
  allGames: Game[]
  canEdit: boolean
  onClose: () => void
  onChangeCover: () => void
  onSave: (g: Game, patch: Pick<Game, 'highlight' | 'isNew' | 'active'>, badges: GameBadge[]) => Promise<boolean>
}) {
  if (!game) return null
  return (
    <GameDrawerBody
      key={game.id}
      game={game}
      provider={provider}
      aggregatorName={aggregatorName}
      badges={badges}
      stat={stat}
      total={total}
      allGames={allGames}
      canEdit={canEdit}
      onClose={onClose}
      onChangeCover={onChangeCover}
      onSave={onSave}
    />
  )
}

function GameDrawerBody({
  game,
  provider,
  aggregatorName,
  badges,
  stat,
  total,
  allGames,
  canEdit,
  onClose,
  onChangeCover,
  onSave,
}: {
  game: Game
  provider: Provider | undefined
  aggregatorName: string | undefined
  badges: GameBadge[]
  stat: (GameStat & { rank: number }) | undefined
  total: number
  allGames: Game[]
  canEdit: boolean
  onClose: () => void
  onChangeCover: () => void
  onSave: (g: Game, patch: Pick<Game, 'highlight' | 'isNew' | 'active'>, badges: GameBadge[]) => Promise<boolean>
}) {
  const [highlight, setHighlight] = useState(game.highlight)
  const [isNew, setIsNew] = useState(game.isNew)
  const [active, setActive] = useState(game.active)
  const [extra, setExtra] = useState<GameBadge[]>(badges)
  const [saving, setSaving] = useState(false)
  const err = validateHighlight(highlight)
  const dirty =
    highlight !== game.highlight || isNew !== game.isNew || active !== game.active || extra.slice().sort().join(',') !== badges.slice().sort().join(',')
  const reason = gameHiddenReason({ ...game, active }, provider)
  // posição na ordem "maior destaque" com o valor do rascunho
  const position = err ? null : allGames.filter((g) => g.id !== game.id && g.highlight > highlight).length + 1
  const CatIcon = CATEGORY_ICON[game.category]

  const save = async () => {
    if (err || !canEdit) return
    setSaving(true)
    const ok = await onSave(game, { highlight, isNew, active }, extra)
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={game.name}
      description={`${provider?.name ?? game.providerId} · ${GAME_CATEGORY_LABEL[game.category]}`}
      headerExtra={
        <Badge tone={reason ? 'warning' : 'success'} dot size="md">
          {reason ? 'Fora do site' : 'No site'}
        </Badge>
      }
      footer={
        <>
          <Button onClick={onClose}>{dirty ? 'Cancelar' : 'Fechar'}</Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!canEdit || !dirty || !!err} title={!canEdit ? NO_EDIT : undefined}>
            Salvar alterações
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-5 sm:grid-cols-[160px_minmax(0,1fr)]">
          <div className="mx-auto w-40 sm:w-full">
            <GameCover game={{ ...game, isNew }} providerName={provider?.name} badges={extra} hidden={!!reason} />
            <Button size="sm" icon={ImageUp} block className="mt-2" onClick={onChangeCover} disabled={!canEdit} title={!canEdit ? NO_EDIT : undefined}>
              Trocar capa
            </Button>
            <p className="mt-1.5 text-center text-[11px] text-fg-3">{game.cover ? 'Imagem enviada' : 'Capa gerada automaticamente'}</p>
          </div>
          <DescriptionList
            items={[
              {
                label: 'Provedora',
                value: (
                  <span className="flex items-center gap-2">
                    <BrandMark name={provider?.name ?? game.providerId} hue={provider?.logoHue ?? 0} size={22} className="rounded-md" />
                    {provider?.name}
                  </span>
                ),
              },
              { label: 'Agregador', value: aggregatorName ?? '—' },
              {
                label: 'Categoria',
                value: (
                  <span className="inline-flex items-center gap-1.5">
                    <CatIcon size={14} className="text-fg-3" aria-hidden />
                    {GAME_CATEGORY_LABEL[game.category]}
                  </span>
                ),
              },
              { label: 'RTP', value: `${game.rtp.toFixed(2).replace('.', ',')}%` },
              { label: 'Aposta mínima e máxima', value: `${brl(game.minBet)} – ${brl(game.maxBet)}` },
              { label: 'No catálogo desde', value: date(game.createdAt) },
              { label: 'ID', value: <Mono>{game.id}</Mono> },
            ]}
          />
        </div>

        {reason && (
          <Alert tone="warning" title="Este jogo não aparece no site">
            {reason}.{' '}
            {active && provider?.status === 'pausada' ? (
              <>
                Reative a provedora em{' '}
                <Link to="/games/provedoras" className="link">
                  Provedoras
                </Link>{' '}
                para o jogo voltar.
              </>
            ) : (
              'Ligue "Ativo no site" para ele voltar ao catálogo e às vitrines.'
            )}
          </Alert>
        )}

        {stat && (
          <section>
            <h3 className="mb-3 text-sm font-semibold text-fg">Últimos 30 dias</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Apostado', value: brlCompact(stat.bets) },
                { label: 'GGR', value: brlCompact(stat.ggr) },
                { label: 'Rodadas', value: numCompact(stat.rounds) },
                { label: 'Posição no GGR', value: `${stat.rank}º de ${total}` },
              ].map((s) => (
                <div key={s.label} className="rounded-xl bg-surface-2 p-3">
                  <p className="text-xs text-fg-3">{s.label}</p>
                  <p className="mt-0.5 truncate text-[15px] font-bold text-fg tnum">{s.value}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <FormFieldset readOnly={!canEdit}>
          <section className="space-y-5">
            <h3 className="text-sm font-semibold text-fg">Exibição no site</h3>
            <Switch
              label="Ativo no site"
              description={active ? 'O jogo aparece no catálogo e nas vitrines.' : 'O jogo fica fora do site e das vitrines.'}
              checked={active}
              onChange={setActive}
            />
            <Field
              label="Destaque"
              htmlFor="g-highlight"
              error={err}
              hint={
                position
                  ? `${highlightLabel(highlight)} · fica em ${position}º na ordem "maior destaque", que é a padrão do site.`
                  : undefined
              }
            >
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Number.isFinite(highlight) ? highlight : 0}
                  onChange={(e) => setHighlight(Number(e.target.value))}
                  aria-label="Destaque, de 0 a 100"
                  className="h-2 flex-1 cursor-pointer accent-primary"
                />
                <div className="w-24">
                  <NumberInput id="g-highlight" value={highlight} onValueChange={(n) => setHighlight(n)} min={0} max={100} suffix="/100" invalid={!!err} />
                </div>
              </div>
            </Field>
            <Field label="Selos">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Checkbox label="Novo" description="Selo dourado e entra na vitrine de novos." checked={isNew} onChange={setIsNew} />
                {EXTRA_BADGES.map((b) => (
                  <Checkbox
                    key={b}
                    label={GAME_BADGE_LABEL[b]}
                    description={b === 'em_alta' ? 'Chama atenção para jogos quentes.' : b === 'exclusivo' ? 'Jogo exclusivo da X2Win.' : 'Jogo com prêmio acumulado.'}
                    checked={extra.includes(b)}
                    onChange={(on) => setExtra((x) => (on ? [...x, b] : x.filter((y) => y !== b)))}
                  />
                ))}
              </div>
            </Field>
          </section>
        </FormFieldset>
      </div>
    </Drawer>
  )
}

// ---------- Trocar capa ----------

function CoverModal({
  game,
  providerName,
  badges,
  onClose,
  onSave,
}: {
  game: Game | undefined
  providerName: string | undefined
  badges: GameBadge[]
  onClose: () => void
  onSave: (g: Game, cover: string | null) => void
}) {
  if (!game) return null
  return <CoverModalBody key={game.id} game={game} providerName={providerName} badges={badges} onClose={onClose} onSave={onSave} />
}

function CoverModalBody({
  game,
  providerName,
  badges,
  onClose,
  onSave,
}: {
  game: Game
  providerName: string | undefined
  badges: GameBadge[]
  onClose: () => void
  onSave: (g: Game, cover: string | null) => void
}) {
  const [draft, setDraft] = useState<string | null>(game.cover)
  const changed = draft !== game.cover
  return (
    <Modal
      open
      onClose={onClose}
      title={`Trocar capa · ${game.name}`}
      description="A capa aparece no catálogo, nas vitrines e na busca do site."
      icon={ImageUp}
      size="lg"
      footer={
        <>
          {game.cover && (
            <Button variant="ghost" icon={Undo2} onClick={() => onSave(game, null)} className="mr-auto">
              Usar capa gerada
            </Button>
          )}
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={() => onSave(game, draft)} disabled={!changed}>
            Salvar capa
          </Button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-[150px_minmax(0,1fr)]">
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-fg">Como fica no site</p>
          <div className="mx-auto w-[150px]">
            <GameCover game={{ ...game, cover: draft }} providerName={providerName} badges={badges} />
          </div>
          {!draft && (
            <p className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-4 text-fg-3">
              <Wand2 size={13} className="mt-px shrink-0" aria-hidden />
              Sem imagem, o site usa a arte gerada com a cor e o nome do jogo.
            </p>
          )}
        </div>
        <ImageUpload label="Nova capa" value={safeImageSrc(draft)} onChange={setDraft} width={400} height={500} hint="400×500 px · PNG, JPG ou WEBP até 3 MB" previewClassName="mx-auto max-w-[220px]" />
      </div>
    </Modal>
  )
}

