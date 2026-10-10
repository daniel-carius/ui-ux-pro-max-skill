import { useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowDownToLine,
  CalendarCheck,
  CalendarClock,
  CircleDollarSign,
  CircleStop,
  Copy,
  Flag,
  Gift,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Rocket,
  RotateCw,
  Send,
  Target,
  Timer,
  Trash2,
  Trophy,
  Users,
} from 'lucide-react'
import { TrendChart } from '@/components/charts'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ChipFilter,
  DataTable,
  Drawer,
  Field,
  FormGrid,
  Input,
  KpiCard,
  NoDataSource,
  MoneyInput,
  NumberInput,
  PageHeader,
  Progress,
  RadioCards,
  Segmented,
  Select,
  Switch,
  confirm,
  toast,
  type Column,
  type Tone,
} from '@/components/ui'
import { brl, date, dateShort, mult, num, pct } from '@/lib/format'
import { isApiMode } from '@/lib/api'
import { uid } from '@/lib/random'
import { DAY } from '@/data/now'
import { GAME_CATEGORY_LABEL, type GameCategory } from '@/data/catalog'
import { useGames } from '@/data/hooks'
import { seedMissionDaily, seedMissions } from '@/data/campanhas2-seeds'
import { audit, usePageAccess } from '@/domain/session'
import { AUDIENCE_LABEL, AUDIENCE_OPTIONS, AUDIENCE_SHORT, C2_KEYS, fromDateInput, rewardText, timeUntil, toDateInput, type Audience } from '@/domain/campanhas2-common'
import {
  MISSION_REWARD_LABEL,
  MISSION_STATUS_LABEL,
  OBJECTIVE_HINT,
  OBJECTIVE_LABEL,
  RECURRENCE_HINT,
  RECURRENCE_LABEL,
  completionRate,
  describeObjective,
  formatProgress,
  missionErrors,
  missionRewardCost,
  objectiveHasScope,
  objectiveUnit,
  type Mission,
  type MissionRewardKind,
  type MissionStatus,
  type ObjectiveKind,
  type ObjectiveScope,
  type Recurrence,
} from '@/domain/campanhas2-missoes'
import { DrawerSection, PlayerPreview, READ_ONLY_TITLE, REWARD_ICON, RewardBadge, confirmDiscard, useCoin, useGameName, useSavedCollection, type CoinCtx } from './_shared-c2'

const OBJECTIVE_ICON: Record<ObjectiveKind, LucideIcon> = { apostar: CircleDollarSign, depositar: ArrowDownToLine, rodadas: RotateCw, multiplicador: Rocket, login: CalendarCheck }
const RECURRENCE_ICON: Record<Recurrence, LucideIcon> = { diaria: Timer, semanal: Repeat, unica: Flag }
const STATUS_TONE: Record<MissionStatus, Tone> = { ativa: 'success', pausada: 'warning', rascunho: 'neutral', encerrada: 'neutral' }

type Filter = 'todas' | MissionStatus

function blankMission(): Mission {
  const now = new Date().toISOString()
  return {
    id: uid('ms'),
    name: '',
    objective: { kind: 'apostar', target: 100, scope: 'qualquer', category: 'slots', gameId: null },
    reward: { kind: 'moedas', value: 200 },
    recurrence: 'diaria',
    audience: 'todos',
    status: 'rascunho',
    startsAt: fromDateInput(toDateInput(now)),
    endsAt: null,
    started: 0,
    completions: 0,
    createdAt: now,
    updatedAt: now,
  }
}

export default function Missoes() {
  const { canEdit } = usePageAccess()
  // modo API: quem começou e concluiu (started, completions) e a data de criação são do servidor
  const missions = useSavedCollection<Mission>(C2_KEYS.missoes, seedMissions)
  const coin = useCoin()
  const gameName = useGameName()
  const [filter, setFilter] = useState<Filter>('todas')
  const [editing, setEditing] = useState<{ mission: Mission; isNew: boolean } | null>(null)
  // série diária da demonstração; no modo API não há fonte (o gráfico mostra o aviso, nada gerado no navegador)
  const daily = useMemo(() => (isApiMode() ? [] : seedMissionDaily()), [])

  const all = missions.items
  const active = all.filter((m) => m.status === 'ativa')
  const completions = all.reduce((s, m) => s + m.completions, 0)
  const started = all.reduce((s, m) => s + m.started, 0)
  const cost = all.reduce((s, m) => s + m.completions * missionRewardCost(m, coin), 0)
  const byRec = (r: Recurrence) => active.filter((m) => m.recurrence === r).length
  const ranked = [...all].filter((m) => m.started > 0).sort((a, b) => completionRate(b) - completionRate(a))

  const objText = (m: Mission) => describeObjective(m.objective, gameName(m.objective.gameId))

  const setStatus = async (m: Mission, status: MissionStatus) => {
    if (status === 'encerrada') {
      const ok = await confirm({
        title: `Encerrar ${m.name}?`,
        description: 'A missão sai do site e quem está no meio perde o progresso. As conclusões continuam nos relatórios.',
        confirmLabel: 'Encerrar missão',
        tone: 'danger',
        icon: CircleStop,
      })
      if (!ok) return
    }
    const ok = await missions.updateAndWait(m.id, { status, updatedAt: new Date().toISOString(), ...(status === 'encerrada' && !m.endsAt ? { endsAt: new Date().toISOString() } : {}) })
    if (!ok) return
    const verb = { ativa: 'ligar', pausada: 'desligar', encerrada: 'desligar', rascunho: 'editar' } as const
    audit(verb[status], `Missão ${m.name}`, `Status: ${MISSION_STATUS_LABEL[m.status]} → ${MISSION_STATUS_LABEL[status]}`)
    toast.success(status === 'ativa' ? (m.status === 'rascunho' ? 'Missão publicada' : 'Missão ativada') : status === 'pausada' ? 'Missão pausada' : 'Missão encerrada', {
      description: status === 'ativa' ? 'Já aparece para os jogadores do público.' : status === 'pausada' ? 'O progresso dos jogadores fica guardado.' : undefined,
    })
  }

  const remove = async (m: Mission) => {
    const ok = await confirm({
      title: `Excluir ${m.name}?`,
      description: m.completions ? `A missão some do painel e do site. As ${num(m.completions)} conclusões continuam no histórico do jogador.` : 'A missão some do painel e do site. Não dá para desfazer.',
      confirmLabel: 'Excluir missão',
      tone: 'danger',
      icon: Trash2,
    })
    if (!ok || !(await missions.removeAndWait(m.id))) return
    audit('excluir', `Missão ${m.name}`, `Missão ${RECURRENCE_LABEL[m.recurrence].toLowerCase()} excluída`)
    toast.success('Missão excluída')
  }

  const save = async (m: Mission, isNew: boolean) => {
    const next = { ...m, name: m.name.trim(), updatedAt: new Date().toISOString() }
    const ok = isNew ? await missions.addAndWait(next) : await missions.updateAndWait(m.id, next)
    if (!ok) return
    audit(isNew ? 'criar' : 'editar', `Missão ${next.name}`, `${objText(next)} → ${rewardText(next.reward, coin)} · ${RECURRENCE_LABEL[next.recurrence]} · ${AUDIENCE_SHORT[next.audience]} · ${MISSION_STATUS_LABEL[next.status]}`)
    toast.success(isNew ? 'Missão criada' : 'Missão salva', { description: next.status === 'ativa' ? 'Já vale no site.' : `Status: ${MISSION_STATUS_LABEL[next.status]}.` })
    setEditing(null)
  }

  const columns: Column<Mission>[] = [
    {
      id: 'name',
      header: 'Missão',
      pinned: true,
      minWidth: 280,
      sortValue: (m) => m.name,
      csv: (m) => `${m.name} — ${objText(m)}`,
      cell: (m) => {
        const I = OBJECTIVE_ICON[m.objective.kind]
        return (
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-text">
              <I size={15} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-fg">{m.name}</span>
              <span className="block truncate text-xs text-fg-3">{objText(m)}</span>
            </span>
          </span>
        )
      },
    },
    { id: 'reward', header: 'Recompensa', sortValue: (m) => missionRewardCost(m, coin), csv: (m) => rewardText(m.reward, coin), cell: (m) => <RewardBadge reward={m.reward} /> },
    {
      id: 'recurrence',
      header: 'Período',
      sortValue: (m) => m.recurrence,
      csv: (m) => RECURRENCE_LABEL[m.recurrence],
      cell: (m) => {
        const I = RECURRENCE_ICON[m.recurrence]
        return (
          <div className="text-[13px]">
            <p className="flex items-center gap-1.5 font-medium text-fg">
              <I size={13} className="text-fg-3" aria-hidden /> {RECURRENCE_LABEL[m.recurrence]}
            </p>
            <p className="text-xs text-fg-3">{m.endsAt ? `até ${date(m.endsAt)}` : `desde ${date(m.startsAt)}`}</p>
          </div>
        )
      },
    },
    { id: 'audience', header: 'Público', sortValue: (m) => m.audience, csv: (m) => AUDIENCE_LABEL[m.audience], cell: (m) => <span className="text-[13px] text-fg-2">{AUDIENCE_SHORT[m.audience]}</span> },
    {
      id: 'completions',
      header: 'Conclusões',
      sortValue: (m) => m.completions,
      csv: (m) => `${m.completions}/${m.started}`,
      cell: (m) => (
        <div className="w-36">
          <div className="mb-1 flex items-baseline justify-between text-xs tnum">
            <span className="font-semibold text-fg">{num(m.completions)}</span>
            <span className="text-fg-3">{m.started ? `${pct(completionRate(m), 0)} de ${num(m.started)}` : 'sem início'}</span>
          </div>
          <Progress value={m.completions} max={Math.max(1, m.started)} tone={completionRate(m) >= 0.5 ? 'success' : completionRate(m) >= 0.2 ? 'primary' : 'warning'} label={`Taxa de conclusão de ${m.name}`} />
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (m) => m.status,
      csv: (m) => MISSION_STATUS_LABEL[m.status],
      cell: (m) => (
        <Badge tone={STATUS_TONE[m.status]} dot>
          {MISSION_STATUS_LABEL[m.status]}
        </Badge>
      ),
    },
    { id: 'cost', money: true, header: 'Custo (30 dias)', align: 'right', defaultHidden: true, sortValue: (m) => m.completions * missionRewardCost(m, coin), csv: (m) => (m.completions * missionRewardCost(m, coin)).toFixed(2), cell: (m) => <span className="tnum">{brl(m.completions * missionRewardCost(m, coin))}</span> },
  ]

  const rows = filter === 'todas' ? all : all.filter((m) => m.status === filter)
  const count = (s: MissionStatus) => all.filter((m) => m.status === s).length

  return (
    <>
      <PageHeader
        actions={
          <Button variant="primary" icon={Plus} disabled={!canEdit} title={!canEdit ? READ_ONLY_TITLE : undefined} onClick={() => setEditing({ mission: blankMission(), isNew: true })}>
            Nova missão
          </Button>
        }
      />

      <div className="space-y-6">
        <section aria-label="Resumo das missões" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Missões ativas" icon={Target} value={num(active.length)} hint={`${byRec('diaria')} diárias · ${byRec('semanal')} semanais · ${byRec('unica')} únicas`} onClick={() => setFilter('ativa')} active={filter === 'ativa'} />
          <KpiCard label="Conclusões" icon={Trophy} tone="success" value={num(completions)} hint={`últimos 30 dias · ${num(started)} começaram`} />
          <KpiCard
            label="Taxa de conclusão"
            icon={Flag}
            tone="info"
            value={pct(started ? completions / started : 0, 0)}
            hint="de quem começou, quantos terminaram"
            formula={<>Conclusões ÷ jogadores que começaram, somando todas as missões nos últimos 30 dias. Abaixo de 20% costuma indicar meta alta demais.</>}
          />
          <KpiCard
            label="Custo das recompensas"
            icon={Gift}
            tone="warning"
            value={brl(cost)}
            hint={`média de ${brl(completions ? cost / completions : 0)} por conclusão`}
            formula={<>Conclusões × valor da recompensa: bônus pelo valor, free spins a R$ 0,40, moedas pelo valor de referência e cashback sobre a meta em R$.</>}
          />
        </section>

        <div className="grid gap-6 xl:grid-cols-5">
          <Card className="xl:col-span-3">
            <CardHeader title="Missões por dia" description="Jogadores que começaram e que concluíram, últimos 14 dias" />
            <CardBody>
              {!daily.length ? (
                <NoDataSource compact title="Sem fonte de dados nesta versão">
                  Quem começou e concluiu cada missão por dia vem da plataforma de jogo, ainda não conectada a este painel.
                </NoDataSource>
              ) : (
              <TrendChart
                ariaLabel="Missões iniciadas e concluídas por dia"
                data={daily}
                xKey="date"
                xFormat={(k) => dateShort(`${k}T12:00:00`)}
                height={230}
                series={[
                  { key: 'started', label: 'Começaram', slot: 1 },
                  { key: 'completions', label: 'Concluíram', slot: 3 },
                ]}
              />
              )}
            </CardBody>
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader title="Taxa de conclusão por missão" description="Quem começou e terminou" />
            <CardBody>
              <ul className="space-y-3">
                {ranked.slice(0, 6).map((m) => {
                  const r = completionRate(m)
                  return (
                    <li key={m.id}>
                      <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="truncate text-fg">{m.name}</span>
                        <span className="shrink-0 font-semibold text-fg tnum">{pct(r, 0)}</span>
                      </div>
                      <Progress value={r * 100} tone={r >= 0.5 ? 'success' : r >= 0.2 ? 'primary' : 'warning'} label={`Taxa de conclusão de ${m.name}`} />
                    </li>
                  )
                })}
              </ul>
              {ranked.some((m) => completionRate(m) < 0.2) && (
                <p className="mt-4 rounded-lg bg-warning/10 px-3 py-2 text-xs text-fg-2">
                  <strong className="text-warning">Meta difícil:</strong> {ranked.filter((m) => completionRate(m) < 0.2).map((m) => m.name).join(', ')} {ranked.filter((m) => completionRate(m) < 0.2).length > 1 ? 'têm' : 'tem'} menos de 20% de conclusão.
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        <DataTable
          caption="Missões"
          rows={rows}
          columns={columns}
          rowKey={(m) => m.id}
          searchText={(m) => `${m.name} ${objText(m)} ${AUDIENCE_LABEL[m.audience]}`}
          searchPlaceholder="Buscar missão ou objetivo"
          initialSort={{ id: 'completions', dir: 'desc' }}
          exportName="missoes"
          onExport={(n) => audit('exportar', 'Missões', `Exportação CSV de ${n} missões`)}
          onRowClick={canEdit ? (m) => setEditing({ mission: structuredClone(m), isNew: false }) : undefined}
          resetKey={filter}
          toolbar={
            <ChipFilter<Filter>
              value={filter}
              onChange={setFilter}
              className="max-w-full"
              options={[
                { value: 'todas', label: 'Todas', count: all.length },
                { value: 'ativa', label: 'Ativas', count: count('ativa') },
                { value: 'pausada', label: 'Pausadas', count: count('pausada'), tone: 'warning' },
                { value: 'rascunho', label: 'Rascunhos', count: count('rascunho') },
                { value: 'encerrada', label: 'Encerradas', count: count('encerrada') },
              ]}
            />
          }
          rowActions={(m) => [
            { label: 'Editar', icon: Pencil, onSelect: () => setEditing({ mission: structuredClone(m), isNew: false }), disabled: !canEdit },
            {
              label: 'Duplicar',
              icon: Copy,
              disabled: !canEdit,
              onSelect: async () => {
                const now = new Date().toISOString()
                const copy: Mission = { ...structuredClone(m), id: uid('ms'), name: `${m.name} (cópia)`, status: 'rascunho', started: 0, completions: 0, createdAt: now, updatedAt: now }
                if (!(await missions.addAndWait(copy))) return
                audit('criar', `Missão ${copy.name}`, `Cópia de ${m.name}, criada como rascunho`)
                toast.success('Missão duplicada', { description: 'A cópia começa como rascunho.' })
              },
            },
            m.status === 'ativa'
              ? { label: 'Pausar', icon: Pause, onSelect: () => setStatus(m, 'pausada'), disabled: !canEdit }
              : m.status === 'rascunho'
                ? { label: 'Publicar', icon: Send, onSelect: () => setStatus(m, 'ativa'), disabled: !canEdit }
                : { label: 'Ativar', icon: Play, onSelect: () => setStatus(m, 'ativa'), disabled: !canEdit || m.status === 'encerrada' },
            { label: 'Encerrar', icon: CircleStop, onSelect: () => setStatus(m, 'encerrada'), disabled: !canEdit || m.status === 'encerrada' || m.status === 'rascunho' },
            { divider: true },
            { label: 'Excluir', icon: Trash2, danger: true, onSelect: () => remove(m), disabled: !canEdit },
          ]}
          empty={{ title: 'Nenhuma missão neste filtro', description: 'Troque o filtro ou crie uma missão nova.', icon: Target }}
        />
      </div>

      {editing && (
        <MissionDrawer key={editing.mission.id} initial={editing.mission} isNew={editing.isNew} coin={coin} onClose={() => setEditing(null)} onSave={(m) => save(m, editing.isNew)} />
      )}
    </>
  )
}

// ---------- Prévia ----------

function MissionCard({ m, coin, gameName }: { m: Mission; coin: CoinCtx; gameName?: string }) {
  const I = OBJECTIVE_ICON[m.objective.kind]
  const RI = REWARD_ICON[m.reward.kind]
  const o = m.objective
  const unit = objectiveUnit(o.kind)
  const done = unit === 'mult' ? Math.round(o.target * 0.42 * 100) / 100 : unit === 'brl' ? Math.round(o.target * 0.6 * 100) / 100 : Math.floor(o.target * 0.6)
  const progress = unit === 'mult' ? 0 : o.target ? done / o.target : 0
  const timer =
    m.recurrence === 'diaria' ? 'Renova em 14h 20min' : m.recurrence === 'semanal' ? 'Renova na segunda-feira' : m.endsAt ? `Termina em ${timeUntil(m.endsAt)}` : 'Sem prazo'
  return (
    <div className="mx-auto max-w-md overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex items-start gap-3 p-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-fg shadow-sm">
          <I size={20} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-bold text-fg">{m.name || 'Nome da missão'}</p>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-fg-2">
              <CalendarClock size={11} aria-hidden /> {RECURRENCE_LABEL[m.recurrence]}
            </span>
          </div>
          <p className="mt-0.5 text-[13px] text-fg-2">{describeObjective(o, gameName)}</p>
        </div>
      </div>
      <div className="px-4 pb-3">
        <div className="mb-1 flex justify-between text-xs text-fg-3 tnum">
          <span>{formatProgress(o, done)}</span>
          {unit !== 'mult' && <span className="font-semibold text-fg">{pct(progress, 0)}</span>}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-gradient-to-r from-primary to-gold" style={{ width: `${(unit === 'mult' ? 0.08 : progress) * 100}%` }} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-2 px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
          <RI size={15} className="text-warning dark:text-gold" aria-hidden />
          {rewardText(m.reward, coin)}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-fg-3">
          <Timer size={11} aria-hidden /> {timer}
        </span>
      </div>
    </div>
  )
}

// ---------- Formulário ----------

function MissionDrawer({ initial, isNew, coin, onClose, onSave }: { initial: Mission; isNew: boolean; coin: CoinCtx; onClose: () => void; onSave: (m: Mission) => Promise<void> }) {
  const [m, setM] = useState<Mission>(initial)
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(!isNew)
  const { items: games } = useGames()
  const errs = touched ? missionErrors(m) : {}
  const dirty = JSON.stringify(m) !== JSON.stringify(initial)
  const o = m.objective
  const unit = objectiveUnit(o.kind)
  const gameName = games.find((g) => g.id === o.gameId)?.name
  const setObj = (patch: Partial<Mission['objective']>) => setM((x) => ({ ...x, objective: { ...x.objective, ...patch } }))
  const setKind = (kind: ObjectiveKind) =>
    setObj({ kind, target: { apostar: 100, depositar: 50, rodadas: 100, multiplicador: 50, login: 5 }[kind], scope: objectiveHasScope(kind) ? o.scope : 'qualquer' })
  const extra = coin.config.mission.enabled ? coin.config.mission.amount : 0
  const scopedGames = games.filter((g) => g.active && (o.kind !== 'multiplicador' || g.category !== 'ao_vivo'))

  const close = async () => {
    if (await confirmDiscard(dirty)) onClose()
  }
  /** espera o servidor: recusada, o drawer fica aberto com o que foi digitado */
  const send = async (next: Mission) => {
    if (saving) return
    setSaving(true)
    try {
      await onSave(next)
    } finally {
      setSaving(false)
    }
  }
  const submit = () => {
    setTouched(true)
    const first = Object.values(missionErrors(m)).find(Boolean)
    if (first) {
      toast.error('Revise a missão', { description: first })
      return
    }
    void send(m)
  }

  return (
    <Drawer
      open
      onClose={close}
      width="xl"
      title={isNew ? 'Nova missão' : `Editar ${initial.name}`}
      description="Objetivo, recompensa, período e público."
      headerExtra={
        !isNew ? (
          <Badge tone={STATUS_TONE[initial.status]} dot size="md">
            {MISSION_STATUS_LABEL[initial.status]}
          </Badge>
        ) : undefined
      }
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          {isNew && m.status === 'rascunho' && (
            <Button
              onClick={() => {
                setTouched(true)
                const first = Object.values(missionErrors(m)).find(Boolean)
                if (first) {
                  toast.error('Revise a missão', { description: first })
                  return
                }
                void send({ ...m, status: 'ativa' })
              }}
              icon={Send}
              disabled={saving}
            >
              Criar e publicar
            </Button>
          )}
          <Button variant="primary" onClick={submit} loading={saving}>
            {isNew ? (m.status === 'rascunho' ? 'Salvar rascunho' : 'Criar missão') : 'Salvar missão'}
          </Button>
        </>
      }
    >
      <div className="space-y-8">
        <PlayerPreview>
          <MissionCard m={m} coin={coin} gameName={gameName} />
        </PlayerPreview>

        <DrawerSection title="Missão" icon={Target}>
          <Field label="Nome" htmlFor="ms-name" required error={errs.name}>
            <Input id="ms-name" value={m.name} maxLength={60} invalid={!!errs.name} placeholder="Ex.: Aquecimento diário" onChange={(e) => setM({ ...m, name: e.target.value })} />
          </Field>
          <FormGrid>
            <Field label="Público" htmlFor="ms-aud">
              <Select id="ms-aud" value={m.audience} onChange={(v) => setM({ ...m, audience: v as Audience })} options={AUDIENCE_OPTIONS} />
            </Field>
            <Field label="Status" htmlFor="ms-status">
              <Select
                id="ms-status"
                value={m.status}
                onChange={(v) => setM({ ...m, status: v as MissionStatus })}
                options={(Object.keys(MISSION_STATUS_LABEL) as MissionStatus[]).map((s) => ({ value: s, label: MISSION_STATUS_LABEL[s] }))}
              />
            </Field>
          </FormGrid>
        </DrawerSection>

        <DrawerSection title="Objetivo" icon={Flag} description={describeObjective(o, gameName)}>
          <RadioCards
            name="Tipo de objetivo"
            columns={3}
            value={o.kind}
            onChange={setKind}
            options={(Object.keys(OBJECTIVE_LABEL) as ObjectiveKind[]).map((k) => ({ value: k, label: OBJECTIVE_LABEL[k], description: OBJECTIVE_HINT[k], icon: OBJECTIVE_ICON[k] }))}
          />
          <FormGrid>
            <Field
              label={unit === 'brl' ? 'Valor da meta' : unit === 'mult' ? 'Multiplicador mínimo' : unit === 'days' ? 'Dias seguidos' : 'Rodadas'}
              htmlFor="ms-target"
              required
              error={errs.target}
              hint={unit === 'mult' ? `Ganho de ${mult(o.target)} a aposta numa única rodada.` : undefined}
            >
              {unit === 'brl' ? (
                <MoneyInput id="ms-target" value={o.target} invalid={!!errs.target} onValueChange={(n) => setObj({ target: n })} />
              ) : (
                <NumberInput
                  id="ms-target"
                  value={o.target}
                  min={unit === 'mult' ? 1.01 : 1}
                  step={unit === 'mult' ? 0.5 : 1}
                  suffix={unit === 'mult' ? 'x' : unit === 'days' ? 'dias' : 'rodadas'}
                  invalid={!!errs.target}
                  onValueChange={(n) => setObj({ target: unit === 'mult' ? n : Math.round(n) })}
                />
              )}
            </Field>
            {objectiveHasScope(o.kind) && (
              <Field label="Onde vale">
                <Segmented<ObjectiveScope>
                  ariaLabel="Onde vale"
                  className="w-full [&>button]:flex-1 [&>button]:justify-center"
                  value={o.scope}
                  onChange={(scope) => setObj({ scope, gameId: scope === 'jogo' ? (o.gameId ?? scopedGames[0]?.id ?? null) : o.gameId })}
                  options={[
                    { value: 'qualquer', label: 'Qualquer jogo' },
                    { value: 'categoria', label: 'Categoria' },
                    { value: 'jogo', label: 'Um jogo' },
                  ]}
                />
              </Field>
            )}
          </FormGrid>
          {objectiveHasScope(o.kind) && o.scope === 'categoria' && (
            <Field label="Categoria" htmlFor="ms-cat">
              <Select
                id="ms-cat"
                value={o.category}
                onChange={(v) => setObj({ category: v as GameCategory })}
                options={(Object.keys(GAME_CATEGORY_LABEL) as GameCategory[]).map((c) => ({ value: c, label: GAME_CATEGORY_LABEL[c] }))}
              />
            </Field>
          )}
          {objectiveHasScope(o.kind) && o.scope === 'jogo' && (
            <Field label="Jogo" htmlFor="ms-game" required error={errs.gameId}>
              <Select id="ms-game" value={o.gameId ?? ''} placeholder="Escolha o jogo" onChange={(v) => setObj({ gameId: v || null })} options={scopedGames.map((g) => ({ value: g.id, label: `${g.name} · ${GAME_CATEGORY_LABEL[g.category]}` }))} />
            </Field>
          )}
        </DrawerSection>

        <DrawerSection title="Recompensa" icon={Gift}>
          <FormGrid>
            <Field label="Tipo" htmlFor="ms-rk">
              <Select
                id="ms-rk"
                value={m.reward.kind}
                onChange={(v) => {
                  const kind = v as MissionRewardKind
                  setM({ ...m, reward: { kind, value: kind === 'moedas' ? 200 : kind === 'free_spins' ? 20 : 10 } })
                }}
                options={(Object.keys(MISSION_REWARD_LABEL) as MissionRewardKind[]).map((k) => ({ value: k, label: MISSION_REWARD_LABEL[k] }))}
              />
            </Field>
            <Field
              label="Valor"
              htmlFor="ms-rv"
              required
              error={errs.reward}
              hint={`Custo por conclusão ≈ ${brl(missionRewardCost(m, coin))}${m.reward.kind === 'cashback' ? (unit === 'brl' ? ` (sobre ${brl(o.target)})` : ' (base de R$ 100)') : ''}.`}
            >
              {m.reward.kind === 'bonus_brl' ? (
                <MoneyInput id="ms-rv" value={m.reward.value} invalid={!!errs.reward} onValueChange={(n) => setM({ ...m, reward: { ...m.reward, value: n } })} />
              ) : (
                <NumberInput
                  id="ms-rv"
                  value={m.reward.value}
                  min={1}
                  suffix={m.reward.kind === 'moedas' ? coin.symbol : m.reward.kind === 'free_spins' ? 'giros' : '%'}
                  invalid={!!errs.reward}
                  onValueChange={(n) => setM({ ...m, reward: { ...m.reward, value: m.reward.kind === 'cashback' ? n : Math.round(n) } })}
                />
              )}
            </Field>
          </FormGrid>
          {extra > 0 && (
            <Alert tone="info">
              Além da recompensa, cada missão concluída rende {num(extra)} {coin.symbol} extras (regra da tela Moeda).
            </Alert>
          )}
        </DrawerSection>

        <DrawerSection title="Período" icon={CalendarClock}>
          <RadioCards
            name="Recorrência"
            columns={3}
            value={m.recurrence}
            onChange={(r) => setM({ ...m, recurrence: r })}
            options={(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map((r) => ({ value: r, label: RECURRENCE_LABEL[r], description: RECURRENCE_HINT[r], icon: RECURRENCE_ICON[r] }))}
          />
          <FormGrid>
            <Field label="Começa em" htmlFor="ms-from" error={errs.period}>
              <Input id="ms-from" type="date" value={toDateInput(m.startsAt)} invalid={!!errs.period} onChange={(e) => e.target.value && setM({ ...m, startsAt: fromDateInput(e.target.value) })} />
            </Field>
            <Field label="Termina em" htmlFor="ms-to" hint={m.endsAt ? 'Vale até 23:59 do dia.' : 'Sem data de fim.'}>
              <Input
                id="ms-to"
                type="date"
                value={toDateInput(m.endsAt)}
                disabled={!m.endsAt}
                invalid={!!errs.period && !!m.endsAt}
                onChange={(e) => e.target.value && setM({ ...m, endsAt: fromDateInput(e.target.value, true) })}
              />
            </Field>
          </FormGrid>
          <Switch
            label="Sem data de fim"
            description="A missão segue valendo até você pausar ou encerrar."
            checked={!m.endsAt}
            onChange={(on) => setM({ ...m, endsAt: on ? null : fromDateInput(toDateInput(new Date(Date.now() + 30 * DAY).toISOString()), true) })}
          />
          {m.recurrence === 'unica' && !m.endsAt && (
            <p className="flex items-center gap-1.5 text-xs text-fg-3">
              <Users size={12} aria-hidden /> Missão única sem fim: cada jogador conclui uma vez, para sempre.
            </p>
          )}
        </DrawerSection>
      </div>
    </Drawer>
  )
}

