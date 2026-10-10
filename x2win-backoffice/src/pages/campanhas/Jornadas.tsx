import { useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Award,
  Banknote,
  Bell,
  CheckCircle2,
  Copy,
  Flag,
  GitFork,
  Hourglass,
  LogIn,
  Mail,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  Route,
  Save,
  Target,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
  Gift,
  Sparkles,
  Zap,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Drawer,
  EmptyState,
  Field,
  FormGrid,
  IconButton,
  Input,
  KpiCard,
  Menu,
  MoneyInput,
  NumberInput,
  PageHeader,
  PageLink,
  RadioCards,
  Segmented,
  Select,
  Switch,
  Textarea,
  Tooltip,
  confirm,
  toast,
  type Column,
  type Tone,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { dateTime, num, pct, relative } from '@/lib/format'
import { useCollection } from '@/lib/store'
import { isApiMode } from '@/lib/api'
import { uid } from '@/lib/random'
import { audit, usePageAccess, useSession } from '@/domain/session'
import { availableChannels, useIntegrations } from '@/domain/system'
import { slotColor, useLevelsConfig } from '@/domain/campanhas3-niveis'
import { smsInfo } from '@/domain/campanhas3-disparos'
import {
  ACTION_STEPS,
  GOAL_LABEL,
  JORNADAS_KEY,
  JOURNEY_STATUS_LABEL,
  JOURNEY_TEMPLATES,
  STEP_LABEL,
  TRIGGER_LABEL,
  describeStep,
  describeTrigger,
  emptyJourney,
  hoursLabel,
  journeyFromTemplate,
  journeyMetrics,
  newStep,
  totalWaitHours,
  validateJourney,
  type Journey,
  type JourneyGoal,
  type JourneyStatus,
  type JourneyStep,
  type JourneyTemplate,
  type StepKind,
  type TriggerKind,
} from '@/domain/campanhas3-jornadas'
import { CharCounter, MiniStat, TableFrame } from './_shared-c3'

const STEP_ICON: Record<StepKind, LucideIcon> = { email: Mail, sms: MessageSquare, notificacao: Bell, bonus: Gift, esperar: Hourglass, condicao: GitFork }
const STEP_SLOT: Record<StepKind, 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8> = { email: 1, sms: 3, notificacao: 7, bonus: 5, esperar: 4, condicao: 2 }
const TRIGGER_ICON: Record<TriggerKind, LucideIcon> = { cadastro: UserPlus, primeiro_deposito: Wallet, inatividade: UserMinus, nivel: Award, saque_pago: Banknote }
const TEMPLATE_ICON: Record<JourneyTemplate['id'], LucideIcon> = { 'boas-vindas': LogIn, reativacao: UserMinus, 'pos-ftd': Wallet }
const STATUS_TONE: Record<JourneyStatus, Tone> = { rascunho: 'neutral', ativa: 'success', pausada: 'warning' }

const mix = (c: string, p: number) => `color-mix(in srgb, ${c} ${p}%, transparent)`

function StepIcon({ kind, size = 30 }: { kind: StepKind; size?: number }) {
  const Icon = STEP_ICON[kind]
  const c = slotColor(STEP_SLOT[kind])
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-lg" style={{ width: size, height: size, color: c, background: mix(c, 15) }} aria-hidden>
      <Icon size={Math.round(size * 0.5)} />
    </span>
  )
}

/**
 * Modo API: o servidor ainda não executa jornadas nem envia mensagens. As métricas de jornada eram simuladas no
 * navegador ("crescem com o tempo ativo"); aqui ficam sem fonte e a tela diz que nada é enviado.
 */
const API = isApiMode()
const NO_RUN = 'O servidor ainda não executa jornadas nem envia e-mail, SMS ou RCS nesta versão: ativar só registra a jornada.'
const NO_METRICS: ReturnType<typeof journeyMetrics> = { entered: 0, inProgress: 0, completed: 0, converted: 0, conversion: null, hoursActive: 0 }
const metricsOf = (j: Journey, now?: number) => (API ? NO_METRICS : journeyMetrics(j, now))

export default function Jornadas() {
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  const [integrations] = useIntegrations()
  const smsAvailable = availableChannels(integrations).sms
  const [levelsCfg] = useLevelsConfig()
  const levelName = (n: number) => levelsCfg.levels[n - 1]?.name ?? `Nível ${n}`
  const journeys = useCollection<Journey>(JORNADAS_KEY, [])
  const [editing, setEditing] = useState<{ journey: Journey; isNew: boolean } | null>(null)
  const now = Date.now()

  const rows = useMemo(() => journeys.items.map((j) => ({ ...j, m: metricsOf(j, now) })), [journeys.items, now])
  const active = rows.filter((r) => r.status === 'ativa')
  const entered = rows.reduce((s, r) => s + r.m.entered, 0)
  const completed = rows.reduce((s, r) => s + r.m.completed, 0)
  const converted = rows.reduce((s, r) => s + r.m.converted, 0)
  const withGoal = rows.filter((r) => r.goal !== 'nenhum').reduce((s, r) => s + r.m.entered, 0)

  const startNew = () => setEditing({ journey: emptyJourney(user.name), isNew: true })
  const startFromTemplate = (t: JourneyTemplate) => setEditing({ journey: journeyFromTemplate(t, user.name, smsAvailable), isNew: true })

  const activate = async (j: Journey) => {
    const v = validateJourney(j, { smsAvailable, levelsCount: levelsCfg.levels.length })
    if (v.errors.length) {
      toast.error('Não dá para ativar ainda', { description: v.errors[0] })
      setEditing({ journey: j, isNew: false })
      return
    }
    const ok = await confirm({
      title: `Ativar "${j.name}"?`,
      description: `${describeTrigger(j.trigger, levelName)}, o jogador entra na jornada. Quem cumpriu o gatilho antes de agora não entra.${API ? ` ${NO_RUN}` : ''}`,
      confirmLabel: 'Ativar jornada',
      tone: 'success',
      icon: Play,
    })
    if (!ok) return
    const nowIso = new Date().toISOString()
    journeys.update(j.id, { status: 'ativa', activatedAt: nowIso, updatedAt: nowIso })
    audit('ligar', `Jornada "${j.name}"`, `Jornada ativada · ${TRIGGER_LABEL[j.trigger.kind]} · ${j.steps.length} etapas`)
    toast.success('Jornada ativada', { description: API ? NO_RUN : 'Novos jogadores entram assim que cumprirem o gatilho.' })
  }

  const pause = async (j: Journey) => {
    const ok = await confirm({
      title: `Pausar "${j.name}"?`,
      description: 'Ninguém novo entra. Quem está no meio da jornada fica parado na etapa atual até você reativar.',
      confirmLabel: 'Pausar jornada',
      tone: 'warning',
      icon: Pause,
    })
    if (!ok) return
    const t = Date.now()
    journeys.update(j.id, (x) => ({
      ...x,
      status: 'pausada',
      activeMs: x.activeMs + (x.activatedAt ? Math.max(0, t - new Date(x.activatedAt).getTime()) : 0),
      activatedAt: null,
      updatedAt: new Date(t).toISOString(),
    }))
    audit('desligar', `Jornada "${j.name}"`, 'Jornada pausada')
    toast.success('Jornada pausada')
  }

  const remove = async (j: Journey & { m: ReturnType<typeof journeyMetrics> }) => {
    const ok = await confirm({
      title: `Excluir "${j.name}"?`,
      description: j.m.inProgress > 0 ? `${num(j.m.inProgress)} jogadores estão no meio da jornada e saem dela. O histórico de métricas é apagado.` : 'A jornada e as métricas dela são apagadas. Não dá para desfazer.',
      confirmLabel: 'Excluir jornada',
      tone: 'danger',
      icon: Trash2,
      typeToConfirm: j.status === 'ativa' ? 'EXCLUIR' : undefined,
    })
    if (!ok) return
    journeys.remove(j.id)
    audit('excluir', `Jornada "${j.name}"`, `Jornada excluída (${JOURNEY_STATUS_LABEL[j.status]})`)
    toast.success('Jornada excluída')
  }

  const duplicate = (j: Journey) => {
    const nowIso = new Date().toISOString()
    const copy: Journey = {
      ...j,
      id: uid('jr'),
      name: `${j.name} (cópia)`.slice(0, 60),
      steps: j.steps.map((s) => ({ ...s, id: uid('st') })),
      status: 'rascunho',
      activatedAt: null,
      activeMs: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
      createdBy: user.name,
    }
    journeys.add(copy)
    audit('criar', `Jornada "${copy.name}"`, `Cópia de "${j.name}" criada como rascunho`)
    toast.success('Jornada duplicada', { description: 'A cópia começa como rascunho.' })
  }

  const columns: Column<(typeof rows)[number]>[] = [
    {
      id: 'name',
      header: 'Jornada',
      pinned: true,
      minWidth: 260,
      sortValue: (r) => r.name,
      csv: (r) => r.name,
      cell: (r) => {
        const Icon = TRIGGER_ICON[r.trigger.kind]
        return (
          <div className="flex min-w-0 max-w-[320px] items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-text" aria-hidden>
              <Icon size={15} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">{r.name}</p>
              <p className="truncate text-xs text-fg-3">{describeTrigger(r.trigger, levelName)}</p>
            </div>
          </div>
        )
      },
    },
    {
      id: 'steps',
      header: 'Etapas',
      sortValue: (r) => r.steps.length,
      csv: (r) => r.steps.map((s) => STEP_LABEL[s.kind]).join(' > '),
      cell: (r) => (
        <div className="flex items-center gap-1" aria-label={r.steps.map((s) => STEP_LABEL[s.kind]).join(', ')}>
          {r.steps.slice(0, 6).map((s, i) => (
            <span key={s.id} className="flex items-center gap-1">
              {i > 0 && <span className="h-px w-1.5 bg-line-strong" aria-hidden />}
              <Tooltip content={`${STEP_LABEL[s.kind]}: ${describeStep(s)}`}>
                <StepIcon kind={s.kind} size={22} />
              </Tooltip>
            </span>
          ))}
          {r.steps.length > 6 && <span className="text-xs text-fg-3">+{r.steps.length - 6}</span>}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (r) => r.status,
      csv: (r) => JOURNEY_STATUS_LABEL[r.status],
      cell: (r) => (
        <Badge tone={STATUS_TONE[r.status]} dot>
          {JOURNEY_STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    { id: 'entered', header: 'Entradas', align: 'right', sortValue: (r) => r.m.entered, cell: (r) => <span className="font-medium">{API ? '—' : num(r.m.entered)}</span> },
    { id: 'completed', header: 'Concluíram', align: 'right', sortValue: (r) => r.m.completed, cell: (r) => <span>{API ? '—' : num(r.m.completed)}</span> },
    {
      id: 'conversion',
      header: 'Conversão',
      align: 'right',
      sortValue: (r) => r.m.conversion ?? -1,
      csv: (r) => (r.m.conversion === null ? '' : (r.m.conversion * 100).toFixed(1)),
      cell: (r) =>
        r.m.conversion === null ? (
          <span className="text-xs text-fg-3">{r.goal === 'nenhum' ? 'sem objetivo' : '—'}</span>
        ) : (
          <div className="text-right">
            <p className="text-[13px] font-semibold text-fg tnum">{pct(r.m.conversion)}</p>
            <p className="text-[11px] text-fg-3">{GOAL_LABEL[r.goal].toLowerCase()}</p>
          </div>
        ),
    },
    {
      id: 'updatedAt',
      header: 'Atualizada',
      sortValue: (r) => r.updatedAt,
      csv: (r) => dateTime(r.updatedAt),
      cell: (r) => (
        <div>
          <p className="whitespace-nowrap text-[13px] text-fg-2">{relative(r.updatedAt)}</p>
          <p className="text-xs text-fg-3">por {r.createdBy}</p>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        actions={
          <>
            {rows.length > 0 && (
              <Menu
                width={260}
                items={[{ heading: 'Começar de um template' }, ...JOURNEY_TEMPLATES.map((t) => ({ label: t.name, icon: TEMPLATE_ICON[t.id], onSelect: () => startFromTemplate(t), disabled: !canEdit }))]}
                trigger={(p) => (
                  <Button {...p} icon={Sparkles} disabled={!canEdit}>
                    Templates
                  </Button>
                )}
              />
            )}
            <Button variant="primary" icon={Plus} onClick={startNew} disabled={!canEdit} title={!canEdit ? 'Seu cargo não cria jornadas' : undefined}>
              Nova jornada
            </Button>
          </>
        }
      />

      {!smsAvailable && (
        <Alert tone="info" className="mb-5" title="Etapas de SMS precisam da SendWork">
          Sem conta SendWork, as jornadas usam e-mail, notificação e bônus.{' '}
          <PageLink to="/settings/integracoes" className="link">
            Conectar em Integrações
          </PageLink>
          .
        </Alert>
      )}

      {API && (
        <Alert tone="warning" className="mb-5" title="Jornadas ainda não rodam no servidor">
          {NO_RUN} Entradas, conclusões e conversão aparecem quando a execução for ligada.
        </Alert>
      )}

      {rows.length === 0 ? (
        <div className="space-y-5">
          <Card>
            <EmptyState
              icon={Route}
              title="Nenhuma jornada criada"
              description="Jornadas mandam mensagens e bônus automaticamente, no momento certo de cada jogador: depois do cadastro, do primeiro depósito ou quando ele some."
              action={
                <Button variant="primary" icon={Plus} onClick={startNew} disabled={!canEdit}>
                  Criar jornada do zero
                </Button>
              }
              className="py-14"
            />
          </Card>
          <TemplateGrid onUse={startFromTemplate} disabled={!canEdit} />
        </div>
      ) : (
        <div className="space-y-5">
          <section aria-label="Resumo das jornadas" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Jornadas ativas" icon={Route} value={`${num(active.length)} de ${num(rows.length)}`} hint={`${num(rows.filter((r) => r.status === 'rascunho').length)} rascunhos · ${num(rows.filter((r) => r.status === 'pausada').length)} pausadas`} />
            <KpiCard label="Entradas" icon={Users} tone="info" value={API ? '—' : num(entered)} hint={API ? 'sem execução no servidor nesta versão' : `${num(rows.reduce((s, r) => s + r.m.inProgress, 0))} no meio da jornada`} />
            <KpiCard label="Concluíram" icon={Flag} tone="success" value={API ? '—' : num(completed)} hint={API ? 'sem execução no servidor nesta versão' : `${pct(entered ? completed / entered : 0, 0)} das entradas`} />
            <KpiCard label="Conversão" icon={Target} tone="warning" value={!API && withGoal ? pct(converted / withGoal) : '—'} hint={API ? 'sem execução no servidor nesta versão' : `${num(converted)} cumpriram o objetivo`} formula="Jogadores que cumpriram o objetivo (depósito ou aposta) ÷ entradas, só nas jornadas com objetivo." />
          </section>


          <TableFrame>
            <DataTable
              caption="Jornadas"
              rows={rows}
              columns={columns}
              rowKey={(r) => r.id}
              searchText={(r) => `${r.name} ${r.description} ${TRIGGER_LABEL[r.trigger.kind]}`}
              searchPlaceholder="Buscar jornada"
              initialSort={{ id: 'updatedAt', dir: 'desc' }}
              exportName="jornadas"
              onExport={(n) => audit('exportar', 'Jornadas', `Exportação CSV de ${n} jornadas`)}
              onRowClick={(r) => setEditing({ journey: r, isNew: false })}
              rowActions={(r) => [
                { label: canEdit ? 'Editar' : 'Ver', icon: Pencil, onSelect: () => setEditing({ journey: r, isNew: false }) },
                r.status === 'ativa'
                  ? { label: 'Pausar', icon: Pause, onSelect: () => pause(r), disabled: !canEdit }
                  : { label: 'Ativar', icon: Play, onSelect: () => activate(r), disabled: !canEdit },
                { label: 'Duplicar', icon: Copy, onSelect: () => duplicate(r), disabled: !canEdit },
                { divider: true },
                { label: 'Excluir', icon: Trash2, danger: true, onSelect: () => remove(r), disabled: !canEdit },
              ]}
              empty={{ title: 'Nenhuma jornada', icon: Route }}
            />
          </TableFrame>

          <TemplateGrid onUse={startFromTemplate} disabled={!canEdit} compact />
        </div>
      )}

      {editing && (
        <JourneyEditor
          key={editing.journey.id}
          initial={editing.journey}
          isNew={editing.isNew}
          smsAvailable={smsAvailable}
          levelNames={levelsCfg.levels.map((l) => l.name)}
          onClose={() => setEditing(null)}
          onSave={(j, activateNow) => {
            const nowIso = new Date().toISOString()
            const exists = journeys.get(j.id)
            let next: Journey = { ...j, updatedAt: nowIso }
            if (activateNow && next.status !== 'ativa') next = { ...next, status: 'ativa', activatedAt: nowIso }
            if (exists) journeys.update(j.id, next)
            else journeys.add(next)
            audit(exists ? 'editar' : 'criar', `Jornada "${next.name}"`, `${TRIGGER_LABEL[next.trigger.kind]} · ${next.steps.length} etapas · ${JOURNEY_STATUS_LABEL[next.status]}`)
            if (activateNow && j.status !== 'ativa') audit('ligar', `Jornada "${next.name}"`, 'Jornada ativada ao salvar')
            toast.success(activateNow && j.status !== 'ativa' ? 'Jornada salva e ativada' : exists ? 'Jornada salva' : 'Rascunho criado', {
              description: next.status === 'ativa' ? 'Mudanças valem para quem entrar daqui em diante.' : 'Ative quando estiver pronta.',
            })
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

function TemplateGrid({ onUse, disabled, compact }: { onUse: (t: JourneyTemplate) => void; disabled?: boolean; compact?: boolean }) {
  return (
    <section aria-label="Templates de jornada">
      <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-fg">
        <Sparkles size={16} className="text-primary-text" aria-hidden /> {compact ? 'Começar de um template' : 'Ou comece de um template'}
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {JOURNEY_TEMPLATES.map((t) => {
          const Icon = TEMPLATE_ICON[t.id]
          const steps = t.build(false)
          return (
            <Card key={t.id} className="flex flex-col p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary-text ring-1 ring-inset ring-primary/15" aria-hidden>
                  <Icon size={19} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg">{t.name}</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-fg-3">{t.description}</p>
                </div>
              </div>
              {!compact && (
                <ol className="mt-4 space-y-1.5 border-l border-dashed border-line-strong pl-3">
                  <li className="flex items-center gap-2 text-xs text-fg-2">
                    <Zap size={12} className="text-warning" aria-hidden /> {describeTrigger(t.trigger)}
                  </li>
                  {steps.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 text-xs text-fg-3">
                      <StepIcon kind={s.kind} size={18} />
                      <span className="truncate">
                        {STEP_LABEL[s.kind]}
                        {s.kind === 'esperar' || s.kind === 'condicao' ? ` · ${hoursLabel(s.hours)}` : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <div className="mt-4 flex flex-1 items-end justify-between gap-2">
                <span className="text-xs text-fg-3">
                  {steps.length} etapas · objetivo: {GOAL_LABEL[t.goal].toLowerCase()}
                </span>
                <Button size="sm" variant="soft" icon={Plus} onClick={() => onUse(t)} disabled={disabled}>
                  Usar
                </Button>
              </div>
            </Card>
          )
        })}
      </div>
    </section>
  )
}

const TRIGGER_OPTIONS: { value: TriggerKind; description: string }[] = [
  { value: 'cadastro', description: 'Logo depois de criar a conta.' },
  { value: 'primeiro_deposito', description: 'Quando o 1º PIX é confirmado.' },
  { value: 'inatividade', description: 'Depois de X dias sem acessar.' },
  { value: 'nivel', description: 'Ao subir para um nível da trilha.' },
  { value: 'saque_pago', description: 'Quando um saque é aprovado e pago.' },
]

const WAIT_PRESETS = [1, 6, 24, 48, 72, 168]

function JourneyEditor({
  initial,
  isNew,
  smsAvailable,
  levelNames,
  onClose,
  onSave,
}: {
  initial: Journey
  isNew: boolean
  smsAvailable: boolean
  levelNames: string[]
  onClose: () => void
  onSave: (j: Journey, activate: boolean) => void
}) {
  const { canEdit } = usePageAccess()
  const [j, setJ] = useState<Journey>(initial)
  const [tried, setTried] = useState(false)
  const v = validateJourney(j, { smsAvailable, levelsCount: levelNames.length })
  const levelName = (n: number) => levelNames[n - 1] ?? `Nível ${n}`
  const setStep = (id: string, patch: Partial<JourneyStep>) => setJ((x) => ({ ...x, steps: x.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  const move = (i: number, to: number) =>
    setJ((x) => {
      if (to < 0 || to >= x.steps.length) return x
      const steps = [...x.steps]
      const [s] = steps.splice(i, 1)
      steps.splice(to, 0, s)
      return { ...x, steps }
    })
  const addStep = (kind: StepKind) => setJ((x) => ({ ...x, steps: [...x.steps, newStep(kind)] }))
  const removeStep = (id: string) => setJ((x) => ({ ...x, steps: x.steps.filter((s) => s.id !== id) }))
  const wait = totalWaitHours(j)
  const actions = j.steps.filter((s) => ACTION_STEPS.includes(s.kind)).length
  const dirty = JSON.stringify(j) !== JSON.stringify(initial)

  const save = (activate: boolean) => {
    setTried(true)
    if (!j.name.trim()) {
      toast.error('Dê um nome à jornada')
      return
    }
    if (activate && v.errors.length) {
      toast.error('Não dá para ativar ainda', { description: v.errors[0] })
      return
    }
    if (j.status === 'ativa' && v.errors.length) {
      toast.error('Corrija antes de salvar', { description: `Uma jornada ativa não pode ficar incompleta. ${v.errors[0]}` })
      return
    }
    onSave({ ...j, name: j.name.trim() }, activate)
  }

  const close = async () => {
    if (dirty && canEdit) {
      const ok = await confirm({ title: 'Descartar alterações?', description: 'O que você mudou nesta jornada será perdido.', confirmLabel: 'Descartar', tone: 'warning' })
      if (!ok) return
    }
    onClose()
  }

  return (
    <Drawer
      open
      onClose={close}
      width="xl"
      title={isNew ? 'Nova jornada' : canEdit ? 'Editar jornada' : 'Jornada'}
      description={isNew ? 'Defina o gatilho e as etapas. A jornada só roda depois de ativada.' : `${JOURNEY_STATUS_LABEL[j.status]} · criada por ${j.createdBy} em ${dateTime(j.createdAt)}`}
      headerExtra={
        <Badge tone={STATUS_TONE[j.status]} dot size="md">
          {JOURNEY_STATUS_LABEL[j.status]}
        </Badge>
      }
      footer={
        canEdit ? (
          <>
            <Button onClick={close}>Cancelar</Button>
            {j.status === 'ativa' ? (
              <Button variant="primary" icon={Save} onClick={() => save(false)} disabled={!dirty}>
                Salvar alterações
              </Button>
            ) : (
              <>
                <Button icon={Save} onClick={() => save(false)}>
                  Salvar rascunho
                </Button>
                <Button variant="success" icon={Play} onClick={() => save(true)}>
                  Salvar e ativar
                </Button>
              </>
            )}
          </>
        ) : (
          <Button onClick={onClose}>Fechar</Button>
        )
      }
    >
      <fieldset disabled={!canEdit} className="min-w-0 space-y-6">
        {j.status === 'ativa' && (
          <Alert tone="info">Esta jornada está ativa. Mudanças valem para quem entrar daqui em diante; quem já está no meio segue o fluxo antigo.</Alert>
        )}
        <FormGrid>
          <Field label="Nome" htmlFor="jr-name" required error={tried && !j.name.trim() ? 'Dê um nome à jornada.' : null} labelAside={<CharCounter value={j.name} max={60} />}>
            <Input id="jr-name" data-autofocus value={j.name} onChange={(e) => setJ({ ...j, name: e.target.value })} placeholder="Ex.: Boas-vindas" invalid={tried && !j.name.trim()} />
          </Field>
          <Field label="Descrição" htmlFor="jr-desc" hint="Opcional, só a equipe vê.">
            <Input id="jr-desc" value={j.description} onChange={(e) => setJ({ ...j, description: e.target.value })} maxLength={140} />
          </Field>
        </FormGrid>

        <Field label="Gatilho: quando o jogador entra">
          <RadioCards<TriggerKind>
            name="Gatilho"
            columns={2}
            value={j.trigger.kind}
            onChange={(kind) => setJ({ ...j, trigger: { ...j.trigger, kind } })}
            options={TRIGGER_OPTIONS.map((t) => ({ value: t.value, label: TRIGGER_LABEL[t.value], description: t.description, icon: TRIGGER_ICON[t.value] }))}
          />
        </Field>
        {j.trigger.kind === 'inatividade' && (
          <Field label="Dias sem acessar" htmlFor="jr-days" className="max-w-xs" error={j.trigger.days < 1 || j.trigger.days > 365 ? 'De 1 a 365 dias.' : null}>
            <NumberInput integer id="jr-days" value={j.trigger.days} min={1} max={365} suffix="dias" onValueChange={(n) => setJ({ ...j, trigger: { ...j.trigger, days: Math.round(n) } })} />
          </Field>
        )}
        {j.trigger.kind === 'nivel' && (
          <Field label="Nível alcançado" htmlFor="jr-level" className="max-w-xs" hint="Trilha de Níveis e XP.">
            <Select id="jr-level" value={String(j.trigger.level)} onChange={(x) => setJ({ ...j, trigger: { ...j.trigger, level: Number(x) } })} options={levelNames.slice(1).map((n, i) => ({ value: String(i + 2), label: `${i + 2}. ${n}` }))} />
          </Field>
        )}

        <FormGrid>
          <Field label="Objetivo (conta como conversão)" htmlFor="jr-goal">
            <Select id="jr-goal" value={j.goal} onChange={(g) => setJ({ ...j, goal: g as JourneyGoal })} options={(Object.keys(GOAL_LABEL) as JourneyGoal[]).map((g) => ({ value: g, label: GOAL_LABEL[g] }))} />
          </Field>
          <div className="self-end pb-1.5">
            <Switch label="Sai ao cumprir o objetivo" description="Para de receber as próximas etapas." checked={j.exitOnGoal && j.goal !== 'nenhum'} disabled={j.goal === 'nenhum'} onChange={(on) => setJ({ ...j, exitOnGoal: on })} />
          </div>
        </FormGrid>

        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg">Etapas</h3>
            <span className="text-xs text-fg-3">
              {j.steps.length} etapas · {actions} {actions === 1 ? 'ação' : 'ações'} · duração mínima {wait ? hoursLabel(wait) : 'imediata'}
            </span>
          </div>
          <ol className="relative">
            <FlowNode icon={Zap} tone="warning" title="Gatilho" text={describeTrigger(j.trigger, levelName)} />
            {j.steps.map((s, i) => (
              <li key={s.id}>
                <Connector />
                <StepCard
                  step={s}
                  index={i}
                  count={j.steps.length}
                  error={tried || s.kind === 'sms' ? v.stepErrors[s.id] : undefined}
                  smsAvailable={smsAvailable}
                  onChange={(p) => setStep(s.id, p)}
                  onMove={(to) => move(i, to)}
                  onRemove={() => removeStep(s.id)}
                />
              </li>
            ))}
            <li>
              <Connector />
              <div className="flex justify-center">
                <Menu
                  align="start"
                  width={250}
                  items={(['email', 'sms', 'notificacao', 'bonus', 'esperar', 'condicao'] as StepKind[]).map((k) => ({
                    label: STEP_LABEL[k],
                    icon: STEP_ICON[k],
                    onSelect: () => addStep(k),
                    disabled: (k === 'sms' && !smsAvailable) || j.steps.length >= 12,
                    hint: k === 'sms' && !smsAvailable ? 'SendWork' : undefined,
                  }))}
                  trigger={(p) => (
                    <Button {...p} size="sm" variant="outline" icon={Plus} disabled={!canEdit || j.steps.length >= 12}>
                      Adicionar etapa
                    </Button>
                  )}
                />
              </div>
            </li>
            <li>
              <Connector />
              <FlowNode icon={Flag} tone="neutral" title="Fim da jornada" text={j.goal === 'nenhum' ? 'O jogador sai da jornada.' : `Converte quem cumprir: ${GOAL_LABEL[j.goal].toLowerCase()}.`} />
            </li>
          </ol>
        </div>

        {(v.errors.length > 0 || v.warnings.length > 0) && (
          <div className="space-y-2">
            {v.errors.length > 0 && (
              <Alert tone={tried ? 'danger' : 'neutral'} title={tried ? 'Falta pouco para ativar' : 'Para ativar'}>
                <ul className="list-disc space-y-0.5 pl-4">
                  {v.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Alert>
            )}
            {v.warnings.map((w) => (
              <Alert key={w} tone="warning" icon={AlertTriangle}>
                {w}
              </Alert>
            ))}
          </div>
        )}
        {v.errors.length === 0 && (
          <p className="flex items-center gap-1.5 text-xs text-success">
            <CheckCircle2 size={14} aria-hidden /> Pronta para ativar.
          </p>
        )}

        {!isNew && !API && (
          <div className="grid grid-cols-3 gap-3">
            {(() => {
              const m = metricsOf(initial)
              return (
                <>
                  <MiniStat label="Entradas" value={num(m.entered)} sub={`${num(m.inProgress)} em andamento`} />
                  <MiniStat label="Concluíram" value={num(m.completed)} />
                  <MiniStat label="Conversão" value={m.conversion === null ? '—' : pct(m.conversion)} sub={`${num(m.converted)} jogadores`} />
                </>
              )
            })()}
          </div>
        )}
      </fieldset>
    </Drawer>
  )
}

function Connector() {
  return (
    <div className="flex justify-center py-1" aria-hidden>
      <span className="flex flex-col items-center">
        <span className="h-4 w-px bg-line-strong" />
        <ArrowDown size={12} className="-mt-1 text-line-strong" />
      </span>
    </div>
  )
}

function FlowNode({ icon: Icon, tone, title, text }: { icon: LucideIcon; tone: 'warning' | 'neutral'; title: string; text: string }) {
  return (
    <div className="mx-auto flex max-w-md items-center gap-3 rounded-full border border-line bg-surface-2 px-4 py-2.5">
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', tone === 'warning' ? 'bg-warning/15 text-warning' : 'bg-surface-3 text-fg-2')} aria-hidden>
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">{title}</p>
        <p className="text-[13px] font-medium text-fg">{text}</p>
      </div>
    </div>
  )
}

function StepCard({
  step: s,
  index,
  count,
  error,
  smsAvailable,
  onChange,
  onMove,
  onRemove,
}: {
  step: JourneyStep
  index: number
  count: number
  error?: string
  smsAvailable: boolean
  onChange: (p: Partial<JourneyStep>) => void
  onMove: (to: number) => void
  onRemove: () => void
}) {
  const id = `st-${s.id}`
  const color = slotColor(STEP_SLOT[s.kind])
  return (
    <div className={cn('rounded-xl border bg-surface p-3.5 shadow-card', error ? 'border-danger/50' : 'border-line')} style={{ boxShadow: `inset 3px 0 0 ${color}` }}>
      <div className="flex items-center gap-2.5">
        <StepIcon kind={s.kind} />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
          <span className="mr-1.5 text-fg-3 tnum">{index + 1}.</span>
          {STEP_LABEL[s.kind]}
        </p>
        <div className="flex shrink-0 items-center">
          <IconButton icon={ArrowUp} label="Subir etapa" size="sm" disabled={index === 0} onClick={() => onMove(index - 1)} />
          <IconButton icon={ArrowDown} label="Descer etapa" size="sm" disabled={index === count - 1} onClick={() => onMove(index + 1)} />
          <IconButton icon={Trash2} label="Remover etapa" size="sm" variant="danger" onClick={onRemove} />
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {s.kind === 'email' && (
          <>
            <Field label="Assunto" htmlFor={`${id}-t`}>
              <Input id={`${id}-t`} value={s.title} onChange={(e) => onChange({ title: e.target.value })} />
            </Field>
            <Field label="Texto" htmlFor={`${id}-x`} hint="Aceita {{primeiro_nome}}, {{saldo}} e {{nivel}}.">
              <Textarea id={`${id}-x`} rows={2} value={s.text} onChange={(e) => onChange({ text: e.target.value })} />
            </Field>
          </>
        )}
        {s.kind === 'sms' && (
          <>
            {!smsAvailable && (
              <Alert tone="warning" icon={MessageSquare}>
                SMS precisa de uma conta SendWork.{' '}
                <PageLink to="/settings/integracoes" className="link">
                  Conectar
                </PageLink>{' '}
                ou troque esta etapa por notificação.
              </Alert>
            )}
            <Field
              label="Mensagem"
              htmlFor={`${id}-x`}
              labelAside={
                <span className="text-xs text-fg-3 tnum">
                  {smsInfo(s.text).length} caracteres · {smsInfo(s.text).segments} {smsInfo(s.text).segments === 1 ? 'parte' : 'partes'}
                </span>
              }
            >
              <Textarea id={`${id}-x`} rows={2} value={s.text} onChange={(e) => onChange({ text: e.target.value })} disabled={!smsAvailable} />
            </Field>
            {!smsAvailable && (
              <Button size="xs" variant="soft" icon={Bell} onClick={() => onChange({ kind: 'notificacao', title: 'Tem novidade para você', text: s.text.slice(0, 160) })}>
                Trocar por notificação
              </Button>
            )}
          </>
        )}
        {s.kind === 'notificacao' && (
          <>
            <Field label="Título" htmlFor={`${id}-t`}>
              <Input id={`${id}-t`} value={s.title} maxLength={50} onChange={(e) => onChange({ title: e.target.value })} />
            </Field>
            <Field label="Mensagem" htmlFor={`${id}-x`} labelAside={<CharCounter value={s.text} max={160} />}>
              <Textarea id={`${id}-x`} rows={2} value={s.text} onChange={(e) => onChange({ text: e.target.value })} />
            </Field>
          </>
        )}
        {s.kind === 'bonus' && (
          <FormGrid>
            <Field label="Valor do bônus" htmlFor={`${id}-a`}>
              <MoneyInput id={`${id}-a`} value={s.amount} onValueChange={(n) => onChange({ amount: n })} />
            </Field>
            <Field label="Rollover" htmlFor={`${id}-r`} hint={`Precisa apostar R$ ${(s.amount * s.rollover).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} para sacar.`}>
              <NumberInput id={`${id}-r`} value={s.rollover} min={0} max={60} suffix="x" onValueChange={(n) => onChange({ rollover: n })} />
            </Field>
          </FormGrid>
        )}
        {s.kind === 'esperar' && (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Esperar" htmlFor={`${id}-h`} className="w-40">
              <NumberInput integer id={`${id}-h`} value={s.hours} min={1} suffix="horas" onValueChange={(n) => onChange({ hours: Math.round(n) })} />
            </Field>
            <div className="flex flex-wrap gap-1.5 pb-1">
              {WAIT_PRESETS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => onChange({ hours: h })}
                  aria-pressed={s.hours === h}
                  className={cn('h-7 rounded-full border px-2.5 text-xs font-medium transition-colors', s.hours === h ? 'border-primary bg-primary/10 text-primary-text' : 'border-line text-fg-2 hover:border-line-strong')}
                >
                  {hoursLabel(h)}
                </button>
              ))}
            </div>
          </div>
        )}
        {s.kind === 'condicao' && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Janela" htmlFor={`${id}-h`} className="w-40" hint="Olha os depósitos desde a entrada.">
                <NumberInput integer id={`${id}-h`} value={s.hours} min={1} suffix="horas" onValueChange={(n) => onChange({ hours: Math.round(n) })} />
              </Field>
              <Field label="Segue na jornada quem">
                <Segmented
                  ariaLabel="Segue na jornada quem"
                  value={s.continueIf}
                  onChange={(c) => onChange({ continueIf: c })}
                  options={[
                    { value: 'nao_depositou', label: 'Não depositou' },
                    { value: 'depositou', label: 'Depositou' },
                  ]}
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-xs font-medium text-success">
                <CheckCircle2 size={13} aria-hidden />
                {s.continueIf === 'depositou' ? 'Depositou' : 'Não depositou'} → segue para a próxima etapa
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-surface-3 px-3 py-2 text-xs font-medium text-fg-2">
                <Flag size={13} aria-hidden />
                {s.continueIf === 'depositou' ? 'Não depositou' : 'Depositou'} → sai da jornada
              </div>
            </div>
          </>
        )}
      </div>
      {error && (
        <p className="mt-2 text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
