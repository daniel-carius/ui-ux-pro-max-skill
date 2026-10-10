import { useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  CircleDollarSign,
  CircleStop,
  Copy,
  Eye,
  Gamepad2,
  Hourglass,
  ListOrdered,
  Medal,
  Pencil,
  Plus,
  Radio,
  Scale,
  Swords,
  Timer,
  Trash2,
  Trophy,
  Users,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  ChipFilter,
  DataTable,
  DescriptionList,
  Drawer,
  EmptyState,
  Field,
  FormGrid,
  IconButton,
  Input,
  KpiCard,
  MoneyInput,
  NumberInput,
  PageHeader,
  Progress,
  RadioCards,
  Segmented,
  Select,
  Textarea,
  confirm,
  toast,
  type Column,
  type Tone,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { brl, date, dateTime, num, pct, relative } from '@/lib/format'
import { uid } from '@/lib/random'
import { DAY, HOUR } from '@/data/now'
import { useGames } from '@/data/hooks'
import { seedTournaments } from '@/data/campanhas2-seeds'
import { audit, usePageAccess, useSession } from '@/domain/session'
import { useCampaignPlayers, type CampaignPlayer } from '@/domain/campanhas-jogadores'
import { AUDIENCE_LABEL, AUDIENCE_OPTIONS, AUDIENCE_SHORT, C2_KEYS, fromDateTimeInput, timeUntil, toDateTimeInput, type Audience } from '@/domain/campanhas2-common'
import {
  SCORING_HINT,
  SCORING_LABEL,
  TOURNAMENT_PRIZE_LABEL,
  TOURNAMENT_STATUS_LABEL,
  buildLeaderboard,
  effectiveEnd,
  hasTournamentErrors,
  participantsLabel,
  prizeLabel,
  prizePool,
  prizeValueBrl,
  scoreText,
  tournamentErrors,
  tournamentStatus,
  type LeaderboardRow,
  type Scoring,
  type Tournament,
  type TournamentPrize,
  type TournamentPrizeKind,
  type TournamentStatus,
} from '@/domain/campanhas2-torneios'
import { DrawerSection, GamePicker, MiniStat, READ_ONLY_TITLE, confirmDiscard, useCoin, useSavedCollection, type CoinCtx } from './_shared-c2'

const STATUS_TONE: Record<TournamentStatus, Tone> = { agendado: 'info', ao_vivo: 'success', encerrado: 'neutral' }
type Filter = 'todos' | TournamentStatus

function blankTournament(): Tournament {
  const start = new Date(Date.now() + DAY)
  start.setMinutes(0, 0, 0)
  const now = new Date().toISOString()
  return {
    id: uid('tn'),
    name: '',
    description: '',
    gameIds: [],
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 7 * DAY).toISOString(),
    scoring: 'maior_multiplicador',
    minBet: 0.5,
    prizes: [
      { id: uid('pz'), kind: 'dinheiro', value: 1000 },
      { id: uid('pz'), kind: 'dinheiro', value: 500 },
      { id: uid('pz'), kind: 'bonus_brl', value: 200 },
    ],
    audience: 'todos',
    participants: 0,
    closedAt: null,
    closedBy: null,
    createdAt: now,
    updatedAt: now,
  }
}

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), ms)
    return () => window.clearInterval(t)
  }, [ms])
  return now
}

function StatusBadge({ status, size = 'sm' }: { status: TournamentStatus; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={STATUS_TONE[status]} size={size} icon={status === 'ao_vivo' ? undefined : status === 'agendado' ? CalendarClock : undefined} dot={status !== 'agendado'}>
      {status === 'ao_vivo' && <span className="sr-only">Status: </span>}
      {TOURNAMENT_STATUS_LABEL[status]}
    </Badge>
  )
}

export default function Torneios() {
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  // modo API: inscritos (participants), data de criação e quem encerrou e quando são do servidor;
  // torneio encerrado não muda nem reabre
  const tournaments = useSavedCollection<Tournament>(C2_KEYS.torneios, seedTournaments)
  // ranking ilustrativo: demonstração, a base inteira; modo API, o público de marketing (apelido, sem dado pessoal)
  const { players } = useCampaignPlayers()
  const { items: games } = useGames()
  const coin = useCoin()
  const now = useNow()
  const [filter, setFilter] = useState<Filter>('todos')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ t: Tournament; isNew: boolean } | null>(null)

  const all = tournaments.items
  const st = (t: Tournament) => tournamentStatus(t, now)
  const live = all.filter((t) => st(t) === 'ao_vivo')
  const scheduled = all.filter((t) => st(t) === 'agendado').sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const inPlay = [...live, ...scheduled].reduce((s, t) => s + prizePool(t, coin), 0)
  const gameName = useMemo(() => new Map(games.map((g) => [g.id, g.name])), [games])

  const closeNow = async (t: Tournament) => {
    const board = buildLeaderboard(t, players, now)
    const paid = board.filter((r) => r.prize)
    const ok = await confirm({
      title: `Encerrar ${t.name} agora?`,
      description: `O torneio termina antes do previsto (${dateTime(t.endsAt)}). O ranking congela e os prêmios vão para as posições atuais. Não dá para reabrir.`,
      confirmLabel: 'Encerrar e pagar prêmios',
      tone: 'danger',
      icon: CircleStop,
      typeToConfirm: 'ENCERRAR',
      details: (
        <div className="rounded-xl border border-line p-3">
          <p className="mb-2 text-xs font-semibold text-fg-3">Pódio atual</p>
          <ol className="space-y-1.5">
            {board.slice(0, 3).map((r) => (
              <li key={r.playerId} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="flex items-center gap-2">
                  <PositionMark position={r.position} />
                  <span className="font-mono text-fg">{r.nick}</span>
                </span>
                <span className="font-semibold text-fg tnum">{r.prize ? prizeLabel(r.prize, coin) : '—'}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 border-t border-line pt-2 text-xs text-fg-3">
            {num(paid.length)} prêmios · {brl(prizePool(t, coin))} no total
          </p>
        </div>
      ),
    })
    if (!ok) return
    const at = new Date().toISOString()
    // quem encerrou e quando: o servidor grava os dele e devolve na resposta
    if (!(await tournaments.updateAndWait(t.id, { closedAt: at, closedBy: user.name, updatedAt: at }))) return
    audit('desligar', `Torneio ${t.name}`, `Encerrado antes do fim por ${user.name}. ${num(paid.length)} prêmios distribuídos (${brl(prizePool(t, coin))}). 1º lugar: ${board[0]?.nick ?? '—'}`)
    toast.success('Torneio encerrado', { description: `${num(paid.length)} prêmios enviados para as posições do ranking.` })
  }

  const remove = async (t: Tournament) => {
    const ok = await confirm({
      title: `Excluir ${t.name}?`,
      description: st(t) === 'encerrado' ? 'O torneio sai do painel. Os prêmios já pagos continuam no extrato dos jogadores.' : 'O torneio agendado sai do site antes de começar. Não dá para desfazer.',
      confirmLabel: 'Excluir torneio',
      tone: 'danger',
      icon: Trash2,
    })
    if (!ok || !(await tournaments.removeAndWait(t.id))) return
    if (detailId === t.id) setDetailId(null)
    audit('excluir', `Torneio ${t.name}`, `Torneio ${TOURNAMENT_STATUS_LABEL[st(t)].toLowerCase()} excluído`)
    toast.success('Torneio excluído')
  }

  const duplicate = (t: Tournament) => {
    const nowIso = new Date().toISOString()
    const dur = new Date(t.endsAt).getTime() - new Date(t.startsAt).getTime()
    const start = new Date(Date.now() + DAY)
    start.setMinutes(0, 0, 0)
    const copy: Tournament = {
      ...structuredClone(t),
      id: uid('tn'),
      name: `${t.name} (cópia)`,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + dur).toISOString(),
      participants: 0,
      closedAt: null,
      closedBy: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      prizes: t.prizes.map((p) => ({ ...p, id: uid('pz') })),
    }
    setEditing({ t: copy, isNew: true })
  }

  const save = async (t: Tournament, isNew: boolean) => {
    // encerrado enquanto o formulário estava aberto: não muda mais
    if (!isNew && tournaments.get(t.id)?.closedAt) {
      toast.error('Torneio encerrado', { description: 'Um torneio encerrado não pode ser alterado nem reaberto. Duplique para criar outro.' })
      setEditing(null)
      return
    }
    const next = { ...t, name: t.name.trim(), description: t.description.trim(), updatedAt: new Date().toISOString() }
    const ok = isNew ? await tournaments.addAndWait(next) : await tournaments.updateAndWait(t.id, next)
    if (!ok) return
    audit(
      isNew ? 'criar' : 'editar',
      `Torneio ${next.name}`,
      `${SCORING_LABEL[next.scoring]} · ${next.gameIds.length} jogos · ${dateTime(next.startsAt)} a ${dateTime(next.endsAt)} · ${next.prizes.length} prêmios (${brl(prizePool(next, coin))})`,
    )
    toast.success(isNew ? 'Torneio criado' : 'Torneio salvo', { description: tournamentStatus(next) === 'agendado' ? `Começa em ${timeUntil(next.startsAt)}.` : 'As mudanças já valem no site.' })
    setEditing(null)
  }

  const columns: Column<Tournament>[] = [
    {
      id: 'name',
      header: 'Torneio',
      pinned: true,
      minWidth: 240,
      sortValue: (t) => t.name,
      cell: (t) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', st(t) === 'ao_vivo' ? 'bg-success/10 text-success' : 'bg-gold/15 text-warning dark:text-gold')}>
            <Trophy size={15} aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-fg">{t.name}</span>
            <span className="block truncate text-xs text-fg-3">
              {t.gameIds.length === 1 ? gameName.get(t.gameIds[0]) : `${t.gameIds.length} jogos`} · {SCORING_LABEL[t.scoring]}
            </span>
          </span>
        </span>
      ),
    },
    {
      id: 'period',
      header: 'Período',
      sortValue: (t) => t.startsAt,
      csv: (t) => `${dateTime(t.startsAt)} a ${dateTime(effectiveEnd(t))}`,
      cell: (t) => {
        const s = st(t)
        return (
          <div className="text-[13px]">
            <p className="text-fg-2 tnum">
              {date(t.startsAt)} – {date(effectiveEnd(t))}
            </p>
            <p className={cn('text-xs', s === 'ao_vivo' ? 'font-semibold text-success' : 'text-fg-3')}>
              {s === 'agendado' ? `começa em ${timeUntil(t.startsAt, now)}` : s === 'ao_vivo' ? `termina em ${timeUntil(t.endsAt, now)}` : t.closedAt ? `encerrado manualmente ${relative(t.closedAt, now)}` : `encerrou ${relative(t.endsAt, now)}`}
            </p>
          </div>
        )
      },
    },
    {
      id: 'pool',
      header: 'Prêmios',
      align: 'right',
      sortValue: (t) => prizePool(t, coin),
      csv: (t) => prizePool(t, coin).toFixed(2),
      cell: (t) => (
        <div>
          <p className="font-semibold text-fg tnum">{brl(prizePool(t, coin))}</p>
          <p className="text-xs text-fg-3">{t.prizes.length} posições</p>
        </div>
      ),
    },
    { id: 'participants', header: 'Participantes', align: 'right', sortValue: (t) => t.participants, cell: (t) => <span className="tnum">{t.participants ? num(t.participants) : '—'}</span> },
    { id: 'audience', header: 'Público', sortValue: (t) => t.audience, csv: (t) => AUDIENCE_LABEL[t.audience], cell: (t) => <span className="text-[13px] text-fg-2">{AUDIENCE_SHORT[t.audience]}</span> },
    { id: 'status', header: 'Status', sortValue: (t) => st(t), csv: (t) => TOURNAMENT_STATUS_LABEL[st(t)], cell: (t) => <StatusBadge status={st(t)} /> },
  ]

  const rows = filter === 'todos' ? all : all.filter((t) => st(t) === filter)
  const count = (s: TournamentStatus) => all.filter((t) => st(t) === s).length
  const detail = all.find((t) => t.id === detailId)

  return (
    <>
      <PageHeader
        actions={
          <Button variant="primary" icon={Plus} disabled={!canEdit} title={!canEdit ? READ_ONLY_TITLE : undefined} onClick={() => setEditing({ t: blankTournament(), isNew: true })}>
            Novo torneio
          </Button>
        }
      />

      <div className="space-y-6">
        <section aria-label="Resumo dos torneios" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Ao vivo" icon={Radio} tone="success" value={num(live.length)} hint={live.length ? live.map((t) => t.name).join(' · ') : 'nenhum torneio rodando'} onClick={() => setFilter('ao_vivo')} active={filter === 'ao_vivo'} />
          <KpiCard
            label="Agendados"
            icon={CalendarClock}
            tone="info"
            value={num(scheduled.length)}
            hint={scheduled[0] ? `próximo em ${timeUntil(scheduled[0].startsAt, now)}` : 'nada agendado'}
            onClick={() => setFilter('agendado')}
            active={filter === 'agendado'}
          />
          <KpiCard
            label="Prêmios em jogo"
            icon={CircleDollarSign}
            tone="warning"
            value={brl(inPlay)}
            hint="torneios ao vivo e agendados"
            formula={<>Soma dos prêmios por posição. Saldo real e bônus pelo valor, free spins a R$ 0,40 e moedas pelo valor de referência (1 {coin.symbol} = {brl(coin.refValue)}).</>}
          />
          <KpiCard label="Jogadores ao vivo" icon={Users} tone="primary" value={num(live.reduce((s, t) => s + t.participants, 0))} hint="inscritos nos torneios ao vivo" />
        </section>

        {live.length > 0 && (
          <section aria-label="Torneios ao vivo" className="grid gap-4 lg:grid-cols-2">
            {live.map((t) => (
              <LiveCard key={t.id} t={t} players={players} now={now} coin={coin} gameName={gameName} onOpen={() => setDetailId(t.id)} />
            ))}
          </section>
        )}

        <DataTable
          caption="Torneios"
          rows={rows}
          columns={columns}
          rowKey={(t) => t.id}
          searchText={(t) => `${t.name} ${t.description} ${t.gameIds.map((g) => gameName.get(g) ?? '').join(' ')}`}
          searchPlaceholder="Buscar torneio ou jogo"
          initialSort={{ id: 'period', dir: 'desc' }}
          exportName="torneios"
          onExport={(n) => audit('exportar', 'Torneios', `Exportação CSV de ${n} torneios`)}
          onRowClick={(t) => setDetailId(t.id)}
          resetKey={filter}
          toolbar={
            <ChipFilter<Filter>
              value={filter}
              onChange={setFilter}
              className="max-w-full"
              options={[
                { value: 'todos', label: 'Todos', count: all.length },
                { value: 'ao_vivo', label: 'Ao vivo', count: count('ao_vivo') },
                { value: 'agendado', label: 'Agendados', count: count('agendado') },
                { value: 'encerrado', label: 'Encerrados', count: count('encerrado') },
              ]}
            />
          }
          rowActions={(t) => {
            const s = st(t)
            return [
              { label: 'Ver ranking', icon: ListOrdered, onSelect: () => setDetailId(t.id) },
              { label: 'Editar', icon: Pencil, onSelect: () => setEditing({ t: structuredClone(t), isNew: false }), disabled: !canEdit || s === 'encerrado' },
              { label: 'Duplicar', icon: Copy, onSelect: () => duplicate(t), disabled: !canEdit },
              { label: 'Encerrar agora', icon: CircleStop, onSelect: () => closeNow(t), disabled: !canEdit || s !== 'ao_vivo' },
              { divider: true },
              { label: 'Excluir', icon: Trash2, danger: true, onSelect: () => remove(t), disabled: !canEdit || s === 'ao_vivo', hint: s === 'ao_vivo' ? 'encerre antes' : undefined },
            ]
          }}
          empty={{ title: 'Nenhum torneio neste filtro', description: 'Troque o filtro ou crie um torneio.', icon: Swords }}
        />
      </div>

      {detail && (
        <DetailDrawer
          t={detail}
          players={players}
          now={now}
          coin={coin}
          gameName={gameName}
          canEdit={canEdit}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setDetailId(null)
            setEditing({ t: structuredClone(detail), isNew: false })
          }}
          onCloseNow={() => closeNow(detail)}
        />
      )}
      {editing && <TournamentDrawer key={editing.t.id} initial={editing.t} isNew={editing.isNew} coin={coin} onClose={() => setEditing(null)} onSave={(t) => save(t, editing.isNew)} />}
    </>
  )
}

// ---------- Ao vivo ----------

function PositionMark({ position }: { position: number }) {
  if (position > 3) return <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-xs font-bold text-fg-3 tnum">{position}º</span>
  const cls = position === 1 ? 'bg-gold/20 text-warning dark:text-gold ring-gold/40' : position === 2 ? 'bg-surface-3 text-fg-2 ring-line-strong' : 'bg-warning/10 text-warning ring-warning/30'
  const Icon = position === 1 ? Trophy : Medal
  return (
    <span className={cn('inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1', cls)} title={`${position}º lugar`}>
      <Icon size={13} aria-hidden />
      <span className="sr-only">{position}º lugar</span>
    </span>
  )
}

function LiveCard({ t, players, now, coin, gameName, onOpen }: { t: Tournament; players: CampaignPlayer[]; now: Date; coin: CoinCtx; gameName: Map<string, string>; onOpen: () => void }) {
  const board = useMemo(() => buildLeaderboard(t, players, now).slice(0, 3), [t, players, now])
  const total = new Date(t.endsAt).getTime() - new Date(t.startsAt).getTime()
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - new Date(t.startsAt).getTime()) / total))
  return (
    <article className="card relative overflow-hidden border-success/30">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-success/10 to-transparent" aria-hidden />
      <div className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-success">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              Ao vivo
            </span>
            <h3 className="mt-2 truncate text-lg font-bold text-fg">{t.name}</h3>
            <p className="truncate text-[13px] text-fg-3">
              {SCORING_LABEL[t.scoring]} · {t.gameIds.slice(0, 3).map((g) => gameName.get(g)).join(', ')}
              {t.gameIds.length > 3 ? ` e mais ${t.gameIds.length - 3}` : ''}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-fg-3">Termina em</p>
            <p className="font-display text-lg font-bold text-fg tnum">{timeUntil(t.endsAt, now)}</p>
          </div>
        </div>
        <Progress className="mt-4" value={elapsed * 100} tone="success" label={`Tempo decorrido de ${t.name}`} />
        <div className="mt-4 grid grid-cols-3 gap-3">
          <MiniStat label="Prêmios" value={brl(prizePool(t, coin))} />
          <MiniStat label="Participantes" value={num(t.participants)} />
          <MiniStat label="Decorrido" value={pct(elapsed, 0)} />
        </div>
        <ol className="mt-4 space-y-1.5 rounded-xl bg-surface-2 p-3">
          {board.map((r) => (
            <li key={r.playerId} className="flex items-center justify-between gap-2 text-[13px]">
              <span className="flex min-w-0 items-center gap-2">
                <PositionMark position={r.position} />
                <span className="truncate font-mono text-fg">{r.nick}</span>
              </span>
              <span className="shrink-0 font-semibold text-fg tnum">{scoreText(t.scoring, r.score)}</span>
            </li>
          ))}
        </ol>
        <Button className="mt-4" block icon={ListOrdered} onClick={onOpen}>
          Ver ranking completo
        </Button>
      </div>
    </article>
  )
}

// ---------- Detalhe ----------

function DetailDrawer({
  t,
  players,
  now,
  coin,
  gameName,
  canEdit,
  onClose,
  onEdit,
  onCloseNow,
}: {
  t: Tournament
  players: CampaignPlayer[]
  now: Date
  coin: CoinCtx
  gameName: Map<string, string>
  canEdit: boolean
  onClose: () => void
  onEdit: () => void
  onCloseNow: () => void
}) {
  const [view, setView] = useState<'ranking' | 'premios'>('ranking')
  const s = tournamentStatus(t, now)
  const board = useMemo(() => buildLeaderboard(t, players, now), [t, players, now])
  const pool = prizePool(t, coin)
  return (
    <Drawer
      open
      onClose={onClose}
      width="xl"
      title={t.name}
      description={t.description || SCORING_HINT[t.scoring]}
      headerExtra={<StatusBadge status={s} size="md" />}
      footer={
        s !== 'encerrado' ? (
          <>
            {s === 'ao_vivo' && (
              <Button variant="danger" icon={CircleStop} disabled={!canEdit} onClick={onCloseNow} title={!canEdit ? READ_ONLY_TITLE : undefined}>
                Encerrar agora
              </Button>
            )}
            <Button variant="primary" icon={Pencil} disabled={!canEdit} onClick={onEdit} title={!canEdit ? READ_ONLY_TITLE : undefined}>
              Editar torneio
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-6">
        {t.closedAt && (
          <Alert tone="warning" icon={CircleStop} title="Encerrado manualmente">
            Por {t.closedBy ?? 'alguém da equipe'} em {dateTime(t.closedAt)}, antes do fim previsto ({dateTime(t.endsAt)}).
          </Alert>
        )}
        <div className="grid gap-3 rounded-xl bg-surface-2 p-4 sm:grid-cols-4">
          <MiniStat label="Total em prêmios" value={brl(pool)} sub={`${t.prizes.length} posições`} />
          <MiniStat label="Participantes" value={t.participants ? num(t.participants) : '—'} sub={AUDIENCE_SHORT[t.audience]} />
          <MiniStat label={s === 'agendado' ? 'Começa em' : s === 'ao_vivo' ? 'Termina em' : 'Encerrou'} value={s === 'agendado' ? timeUntil(t.startsAt, now) : s === 'ao_vivo' ? timeUntil(t.endsAt, now) : date(effectiveEnd(t))} />
          <MiniStat label="Aposta mínima" value={brl(t.minBet)} sub="para pontuar" />
        </div>
        <DescriptionList
          items={[
            { label: 'Período', value: `${dateTime(t.startsAt)} – ${dateTime(t.endsAt)}` },
            { label: 'Pontuação', value: SCORING_LABEL[t.scoring] },
            {
              label: `Jogos (${t.gameIds.length})`,
              full: true,
              value: (
                <span className="flex flex-wrap gap-1.5">
                  {t.gameIds.map((g) => (
                    <span key={g} className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-0.5 text-[12.5px] text-fg-2">
                      <Gamepad2 size={12} aria-hidden /> {gameName.get(g) ?? g}
                    </span>
                  ))}
                </span>
              ),
            },
          ]}
        />

        <div>
          <Segmented
            ariaLabel="Ver"
            value={view}
            onChange={setView}
            options={[
              { value: 'ranking', label: 'Ranking', icon: ListOrdered },
              { value: 'premios', label: 'Distribuição dos prêmios', icon: Scale },
            ]}
          />
        </div>

        {view === 'ranking' ? (
          s === 'agendado' ? (
            <EmptyState icon={Hourglass} title="O ranking abre quando o torneio começar" description={`Começa em ${dateTime(t.startsAt)} (${timeUntil(t.startsAt, now)}).`} className="rounded-xl border border-dashed border-line" />
          ) : (
            <Leaderboard rows={board} t={t} coin={coin} total={t.participants} final={s === 'encerrado'} />
          )
        ) : (
          <PrizeDistribution t={t} coin={coin} pool={pool} />
        )}
      </div>
    </Drawer>
  )
}

function Leaderboard({ rows, t, coin, total, final }: { rows: LeaderboardRow[]; t: Tournament; coin: CoinCtx; total: number; final: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-2.5 text-xs text-fg-3">
        <span>{final ? 'Ranking final' : 'Ranking parcial, atualiza a cada rodada'}</span>
        <span className="tnum">
          top {rows.length} de {participantsLabel(total)}
        </span>
      </div>
      <table className="w-full text-[13px]">
        <caption className="sr-only">Ranking do torneio {t.name}</caption>
        <thead>
          <tr className="border-b border-line text-left text-xs text-fg-3">
            <th scope="col" className="w-14 px-4 py-2 font-semibold">
              Pos.
            </th>
            <th scope="col" className="px-2 py-2 font-semibold">
              Jogador
            </th>
            <th scope="col" className="px-2 py-2 text-right font-semibold">
              {SCORING_LABEL[t.scoring]}
            </th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">
              {final ? 'Prêmio pago' : 'Prêmio'}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.playerId} className={cn('border-b border-line/60 last:border-0', r.prize && 'bg-gold/[0.04]')}>
              <td className="px-4 py-2">
                <PositionMark position={r.position} />
              </td>
              <td className="px-2 py-2">
                <span className="font-mono text-fg">{r.nick}</span>
              </td>
              <td className="px-2 py-2 text-right font-semibold text-fg tnum">{scoreText(t.scoring, r.score)}</td>
              <td className="px-4 py-2 text-right tnum">{r.prize ? <span className="font-medium text-fg">{prizeLabel(r.prize, coin)}</span> : <span className="text-fg-3">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-2 text-xs text-fg-3">Apelidos mascarados, como aparecem no site.</p>
    </div>
  )
}

function PrizeDistribution({ t, coin, pool }: { t: Tournament; coin: CoinCtx; pool: number }) {
  const max = Math.max(1, ...t.prizes.map((p) => prizeValueBrl(p, coin)))
  return (
    <div className="space-y-4">
      <ol className="space-y-2.5">
        {t.prizes.map((p, i) => {
          const v = prizeValueBrl(p, coin)
          return (
            <li key={p.id} className="flex items-center gap-3">
              <PositionMark position={i + 1} />
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="truncate text-fg">
                    {prizeLabel(p, coin)} <span className="text-xs text-fg-3">· {TOURNAMENT_PRIZE_LABEL[p.kind]}</span>
                  </span>
                  <span className="shrink-0 text-xs text-fg-3 tnum">
                    {brl(v)} · {pct(pool ? v / pool : 0, 0)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: i === 0 ? 'var(--chart-4)' : i < 3 ? 'var(--chart-2)' : 'var(--chart-1)' }} />
                </div>
              </div>
            </li>
          )
        })}
      </ol>
      <div className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3 text-[13px]">
        <span className="text-fg-2">Total</span>
        <span className="text-base font-bold text-fg tnum">{brl(pool)}</span>
      </div>
      <p className="text-xs text-fg-3">
        O 1º lugar leva {pct(pool ? prizeValueBrl(t.prizes[0] ?? { kind: 'dinheiro', value: 0 }, coin) / pool : 0, 0)} do total. Empate: vence quem pontuou primeiro.
      </p>
    </div>
  )
}

// ---------- Formulário ----------

function TournamentDrawer({ initial, isNew, coin, onClose, onSave }: { initial: Tournament; isNew: boolean; coin: CoinCtx; onClose: () => void; onSave: (t: Tournament) => Promise<void> }) {
  const [t, setT] = useState<Tournament>(initial)
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(!isNew)
  const live = !isNew && tournamentStatus(initial) === 'ao_vivo'
  const errs = tournamentErrors(t, coin)
  const show = touched
  const dirty = JSON.stringify(t) !== JSON.stringify(initial)
  const pool = prizePool(t, coin)
  const durMs = new Date(t.endsAt).getTime() - new Date(t.startsAt).getTime()
  const durText = durMs > 0 ? `${Math.floor(durMs / DAY) ? `${Math.floor(durMs / DAY)} dia(s) e ` : ''}${Math.floor((durMs % DAY) / HOUR)} hora(s)` : null
  const willBe = tournamentStatus(t)

  const setPrize = (id: string, patch: Partial<TournamentPrize>) => setT((x) => ({ ...x, prizes: x.prizes.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  const close = async () => {
    if (await confirmDiscard(dirty)) onClose()
  }
  const submit = async () => {
    setTouched(true)
    if (hasTournamentErrors(errs)) {
      toast.error('Revise o torneio', { description: errs.name ?? errs.games ?? errs.period ?? errs.prizes ?? Object.values(errs.prize)[0] ?? 'Há campos inválidos.' })
      return
    }
    if (saving) return
    // espera o servidor: recusado, o drawer fica aberto com o que foi digitado
    setSaving(true)
    try {
      await onSave(t)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open
      onClose={close}
      width="xl"
      title={isNew ? 'Novo torneio' : `Editar ${initial.name}`}
      description="Jogos, período, pontuação e prêmios por posição."
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" onClick={submit} loading={saving}>
            {isNew ? 'Criar torneio' : 'Salvar torneio'}
          </Button>
        </>
      }
    >
      <div className="space-y-8">
        {live && (
          <Alert tone="warning" title="Torneio ao vivo">
            Jogos, início e pontuação ficam travados para não mudar a regra no meio. Você ainda pode ajustar nome, fim e prêmios.
          </Alert>
        )}

        <DrawerSection title="Torneio" icon={Trophy}>
          <Field label="Nome" htmlFor="tn-name" required error={show ? errs.name : null}>
            <Input id="tn-name" value={t.name} maxLength={48} invalid={show && !!errs.name} placeholder="Ex.: Corrida do Tigre" onChange={(e) => setT({ ...t, name: e.target.value })} />
          </Field>
          <Field label="Descrição" htmlFor="tn-desc" hint="Aparece na página do torneio.">
            <Textarea id="tn-desc" rows={2} maxLength={160} value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} />
          </Field>
          <Field label="Público" htmlFor="tn-aud">
            <Select id="tn-aud" value={t.audience} onChange={(v) => setT({ ...t, audience: v as Audience })} options={AUDIENCE_OPTIONS} />
          </Field>
        </DrawerSection>

        <DrawerSection title="Jogos" icon={Gamepad2} description="Só rodadas nestes jogos pontuam.">
          <Field error={show ? errs.games : null}>
            <GamePicker value={t.gameIds} onChange={(ids) => setT({ ...t, gameIds: ids })} disabled={live} invalid={show && !!errs.games} />
          </Field>
        </DrawerSection>

        <DrawerSection title="Período" icon={Timer} description={durText ? `Dura ${durText}. ${isNew || !live ? `Ao salvar, fica ${TOURNAMENT_STATUS_LABEL[willBe].toLowerCase()}.` : ''}` : undefined}>
          <FormGrid>
            <Field label="Começa em" htmlFor="tn-from" error={show ? errs.period : null}>
              <Input id="tn-from" type="datetime-local" disabled={live} value={toDateTimeInput(t.startsAt)} invalid={show && !!errs.period} onChange={(e) => e.target.value && setT({ ...t, startsAt: fromDateTimeInput(e.target.value) })} />
            </Field>
            <Field label="Termina em" htmlFor="tn-to">
              <Input id="tn-to" type="datetime-local" value={toDateTimeInput(t.endsAt)} invalid={show && !!errs.period} onChange={(e) => e.target.value && setT({ ...t, endsAt: fromDateTimeInput(e.target.value) })} />
            </Field>
          </FormGrid>
        </DrawerSection>

        <DrawerSection title="Pontuação" icon={ListOrdered}>
          <RadioCards
            name="Pontuação"
            columns={3}
            value={t.scoring}
            disabled={live}
            onChange={(sc) => setT({ ...t, scoring: sc as Scoring })}
            options={(Object.keys(SCORING_LABEL) as Scoring[]).map((sc) => ({ value: sc, label: SCORING_LABEL[sc], description: SCORING_HINT[sc] }))}
          />
          <Field label="Aposta mínima para pontuar" htmlFor="tn-min" error={show ? errs.minBet : null} className="sm:max-w-xs">
            <MoneyInput id="tn-min" value={t.minBet} disabled={live} invalid={show && !!errs.minBet} onValueChange={(n) => setT({ ...t, minBet: n })} />
          </Field>
        </DrawerSection>

        <DrawerSection
          title="Prêmios por posição"
          icon={Medal}
          description="Do 1º lugar para baixo. Cada posição vale no máximo o mesmo que a anterior."
          actions={
            <Button
              size="sm"
              icon={Plus}
              disabled={t.prizes.length >= 50}
              onClick={() => setT((x) => ({ ...x, prizes: [...x.prizes, { id: uid('pz'), kind: x.prizes[x.prizes.length - 1]?.kind ?? 'bonus_brl', value: x.prizes[x.prizes.length - 1]?.value ?? 50 }] }))}
            >
              Adicionar posição
            </Button>
          }
        >
          {show && errs.prizes && <Alert tone="danger">{errs.prizes}</Alert>}
          <ol className="space-y-2">
            {t.prizes.map((p, i) => {
              const err = show ? errs.prize[p.id] : undefined
              return (
                <li key={p.id} className={cn('rounded-xl border p-2.5', err ? 'border-danger/50 bg-danger/[0.03]' : 'border-line')}>
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[auto_150px_minmax(0,1fr)_96px_auto]">
                    <PositionMark position={i + 1} />
                    <Select
                      aria-label={`Tipo do prêmio do ${i + 1}º lugar`}
                      value={p.kind}
                      onChange={(k) => setPrize(p.id, { kind: k as TournamentPrizeKind, value: k === 'moedas' ? 5000 : k === 'free_spins' ? 50 : p.kind === 'moedas' || p.kind === 'free_spins' ? 100 : p.value })}
                      options={(Object.keys(TOURNAMENT_PRIZE_LABEL) as TournamentPrizeKind[]).map((k) => ({ value: k, label: TOURNAMENT_PRIZE_LABEL[k] }))}
                    />
                    {p.kind === 'dinheiro' || p.kind === 'bonus_brl' ? (
                      <MoneyInput value={p.value} invalid={!!err} onValueChange={(n) => setPrize(p.id, { value: n })} />
                    ) : (
                      <NumberInput value={p.value} min={1} suffix={p.kind === 'moedas' ? coin.symbol : 'giros'} invalid={!!err} onValueChange={(n) => setPrize(p.id, { value: Math.round(n) })} />
                    )}
                    <span className="hidden text-right text-xs text-fg-3 tnum sm:block">≈ {brl(prizeValueBrl(p, coin))}</span>
                    <IconButton icon={Trash2} label={`Remover prêmio do ${i + 1}º lugar`} size="sm" variant="danger" disabled={t.prizes.length <= 1} onClick={() => setT((x) => ({ ...x, prizes: x.prizes.filter((y) => y.id !== p.id) }))} />
                  </div>
                  {err && (
                    <p className="mt-1.5 text-xs font-medium text-danger" role="alert">
                      {err}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
          <div className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3 text-[13px]">
            <span className="flex items-center gap-1.5 text-fg-2">
              <Eye size={14} aria-hidden /> Total em prêmios ({t.prizes.length} posições)
            </span>
            <span className="text-base font-bold text-fg tnum">{brl(pool)}</span>
          </div>
        </DrawerSection>
      </div>
    </Drawer>
  )
}
