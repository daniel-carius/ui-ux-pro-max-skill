import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, Calculator, CircleDollarSign, Copy, Gift, Pencil, Plus, Power, PowerOff, Repeat, Trash2, TrendingUp } from 'lucide-react'
import { Sparkline } from '@/components/charts'
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
  FormFieldset,
  FormGrid,
  Input,
  KpiCard,
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
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { brl, brlCompact, dateTime, mult, num, pct, relative } from '@/lib/format'
import { uid } from '@/lib/random'
import { useCollection } from '@/lib/store'
import { DEPOSIT_BONUS_KEY, depositBonusDaily, seedDepositBonus } from '@/data/campanhas-bonus'
import { audit, usePageAccess, useSession } from '@/domain/session'
import {
  ROLLOVER_BASE_LABEL,
  TRIGGER_LABEL,
  USAGE_LABEL,
  bonusSummary,
  calcDepositBonus,
  capDeposit,
  depositConflicts,
  rolloverSummary,
  validateDepositBonus,
  type BonusUsage,
  type DepositBonusCampaign,
  type DepositTrigger,
} from '@/domain/campanhas-bonus'
import { MiniStat } from './_shared-c1'

type Filter = 'todas' | 'ativas' | 'inativas'

export default function BonusDeposito() {
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  const campaigns = useCollection<DepositBonusCampaign>(DEPOSIT_BONUS_KEY, seedDepositBonus)
  const [filter, setFilter] = useState<Filter>('todas')
  const [editing, setEditing] = useState<DepositBonusCampaign | null>(null)
  const [simId, setSimId] = useState<string>('')
  const [simDeposit, setSimDeposit] = useState(50)
  const daily = useMemo(() => depositBonusDaily(), [])

  const items = campaigns.items
  const active = items.filter((c) => c.active)
  const redemptions = items.reduce((s, c) => s + c.redemptions, 0)
  const granted = items.reduce((s, c) => s + c.bonusGranted, 0)
  const converted = items.reduce((s, c) => s + c.bonusConverted, 0)
  const rows = items.filter((c) => filter === 'todas' || (filter === 'ativas' ? c.active : !c.active))
  const sim = items.find((c) => c.id === simId) ?? active[0] ?? items[0]
  const lockedTitle = !canEdit ? 'Seu cargo pode ver, mas não editar bônus de depósito' : undefined

  const blank = (): DepositBonusCampaign => ({
    id: '',
    name: '',
    active: false,
    bonusPct: 100,
    minDeposit: 20,
    maxBonus: 300,
    rollover: 10,
    rolloverBase: 'bonus',
    usage: 'uma_vez',
    depositTrigger: 'qualquer',
    validityDays: 7,
    redemptions: 0,
    bonusGranted: 0,
    bonusConverted: 0,
    createdAt: '',
    updatedAt: '',
    updatedBy: user.name,
  })

  const confirmActivate = async (c: DepositBonusCampaign) => {
    const conflicts = depositConflicts(c, items)
    return confirm({
      title: `Ativar "${c.name}"?`,
      description: conflicts.length
        ? `“${conflicts[0].name}” já está ativa no mesmo depósito. Com as duas ativas, o jogador recebe só uma: a de maior bônus para o valor depositado.`
        : `A partir de agora, ${TRIGGER_LABEL[c.depositTrigger].toLowerCase()} a partir de ${brl(c.minDeposit)} recebe ${bonusSummary(c)}.`,
      confirmLabel: conflicts.length ? 'Ativar mesmo assim' : 'Ativar campanha',
      tone: conflicts.length ? 'warning' : 'primary',
      icon: conflicts.length ? AlertTriangle : Power,
    })
  }

  const toggle = async (c: DepositBonusCampaign, on: boolean) => {
    if (on) {
      if (!(await confirmActivate(c))) return
    } else {
      const ok = await confirm({
        title: `Desativar "${c.name}"?`,
        description: 'Novos depósitos deixam de receber bônus. Quem já recebeu mantém o saldo bônus e o rollover.',
        confirmLabel: 'Desativar',
        tone: 'warning',
        icon: PowerOff,
      })
      if (!ok) return
    }
    campaigns.update(c.id, { active: on, updatedAt: new Date().toISOString(), updatedBy: user.name })
    audit(on ? 'ligar' : 'desligar', `Bônus de depósito ${c.name}`, on ? `Campanha ativada (${bonusSummary(c)})` : 'Campanha desativada')
    toast.success(on ? 'Campanha ativada' : 'Campanha desativada')
  }

  const save = async (c: DepositBonusCampaign) => {
    const prev = c.id ? campaigns.get(c.id) : undefined
    if (c.active && (!prev || !prev.active)) {
      if (!(await confirmActivate(c))) return
    } else if (c.active && prev) {
      const ok = await confirm({
        title: 'Salvar mudanças numa campanha ativa?',
        description: 'As regras novas valem para os próximos depósitos. Bônus já concedidos mantêm as regras de quando foram dados.',
        confirmLabel: 'Salvar alterações',
        tone: 'warning',
      })
      if (!ok) return
    }
    const now = new Date().toISOString()
    const clean = { ...c, name: c.name.trim(), updatedAt: now, updatedBy: user.name }
    if (c.id) {
      campaigns.update(c.id, clean)
      audit('editar', `Bônus de depósito ${clean.name}`, `${bonusSummary(clean)} · mín. ${brl(clean.minDeposit)} · ${rolloverSummary(clean)}`)
      toast.success('Campanha atualizada')
    } else {
      campaigns.add({ ...clean, id: uid('db'), createdAt: now })
      audit('criar', `Bônus de depósito ${clean.name}`, `${bonusSummary(clean)} · mín. ${brl(clean.minDeposit)} · ${rolloverSummary(clean)}${clean.active ? ' (ativa)' : ''}`)
      toast.success('Campanha criada', { description: clean.active ? 'Já vale para os próximos depósitos.' : 'Ela fica inativa até você ativar.' })
    }
    setEditing(null)
  }

  const remove = async (c: DepositBonusCampaign) => {
    const ok = await confirm({
      title: `Excluir "${c.name}"?`,
      description: c.redemptions ? `A campanha teve ${num(c.redemptions)} resgates. O histórico de bônus continua nos relatórios e na ficha de cada jogador.` : 'A campanha sai da lista.',
      confirmLabel: 'Excluir campanha',
      tone: 'danger',
      icon: Trash2,
    })
    if (!ok) return
    campaigns.remove(c.id)
    audit('excluir', `Bônus de depósito ${c.name}`, 'Campanha excluída')
    toast.success('Campanha excluída')
  }

  const columns: Column<DepositBonusCampaign>[] = [
    {
      id: 'name',
      header: 'Campanha',
      pinned: true,
      minWidth: 250,
      sortValue: (c) => c.name,
      cell: (c) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn('flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg text-[11px] font-bold leading-none', c.active ? 'bg-primary/10 text-primary-text' : 'bg-surface-3 text-fg-3')}>
            {num(c.bonusPct)}%
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-fg">{c.name}</p>
            <p className="truncate text-xs text-fg-3">
              {bonusSummary(c)} · mín. {brl(c.minDeposit)}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: 'trigger',
      header: 'Quando vale',
      sortValue: (c) => TRIGGER_LABEL[c.depositTrigger],
      csv: (c) => `${TRIGGER_LABEL[c.depositTrigger]} · ${USAGE_LABEL[c.usage]}`,
      cell: (c) => (
        <div className="text-[13px]">
          <p className="text-fg-2">{TRIGGER_LABEL[c.depositTrigger]}</p>
          <p className="text-xs text-fg-3">{USAGE_LABEL[c.usage]}</p>
        </div>
      ),
    },
    { id: 'min', header: 'Depósito mín.', align: 'right', defaultHidden: true, sortValue: (c) => c.minDeposit, cell: (c) => brl(c.minDeposit) },
    {
      id: 'rollover',
      header: 'Rollover',
      sortValue: (c) => c.rollover,
      csv: (c) => rolloverSummary(c),
      cell: (c) => (
        <div className="text-[13px]">
          <p className="font-medium text-fg">{mult(c.rollover)}</p>
          <p className="text-xs text-fg-3">sobre {c.rolloverBase === 'bonus' ? 'o bônus' : 'depósito + bônus'}</p>
        </div>
      ),
    },
    { id: 'redemptions', header: 'Resgates', align: 'right', sortValue: (c) => c.redemptions, cell: (c) => num(c.redemptions) },
    { id: 'granted', header: 'Bônus concedido', align: 'right', sortValue: (c) => c.bonusGranted, cell: (c) => brl(c.bonusGranted) },
    {
      id: 'converted',
      header: 'Convertido',
      align: 'right',
      minWidth: 120,
      sortValue: (c) => (c.bonusGranted ? c.bonusConverted / c.bonusGranted : 0),
      csv: (c) => c.bonusConverted,
      cell: (c) =>
        c.bonusGranted ? (
          <div className="ml-auto w-24">
            <p className="text-[13px] font-medium tnum">{pct(c.bonusConverted / c.bonusGranted, 0)}</p>
            <Progress value={c.bonusConverted} max={c.bonusGranted} tone="warning" className="mt-1" label="Bônus convertido em saldo real" />
          </div>
        ) : (
          <span className="text-xs text-fg-3">—</span>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      pinned: true,
      sortValue: (c) => (c.active ? 1 : 0),
      csv: (c) => (c.active ? 'Ativa' : 'Inativa'),
      cell: (c) => (
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Switch size="sm" checked={c.active} onChange={(on) => toggle(c, on)} disabled={!canEdit} ariaLabel={`${c.active ? 'Desativar' : 'Ativar'} ${c.name}`} />
          <span className={cn('text-xs font-medium', c.active ? 'text-success' : 'text-fg-3')}>{c.active ? 'Ativa' : 'Inativa'}</span>
        </div>
      ),
    },
    { id: 'updated', header: 'Atualizada', defaultHidden: true, sortValue: (c) => c.updatedAt, csv: (c) => dateTime(c.updatedAt), cell: (c) => <span className="text-[13px] text-fg-2">{relative(c.updatedAt)} · {c.updatedBy}</span> },
  ]

  return (
    <>
      <PageHeader
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setEditing(blank())} disabled={!canEdit} title={lockedTitle}>
            Nova campanha
          </Button>
        }
      />

      <section aria-label="Resumo do bônus de depósito" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Resgates"
          icon={Gift}
          value={num(redemptions)}
          hint={`${num(daily.reduce((s, d) => s + d.resgates, 0))} nos últimos 30 dias`}
          chart={<Sparkline data={daily.map((d) => d.resgates)} slot={1} ariaLabel="Resgates por dia nos últimos 30 dias" />}
        />
        <KpiCard
          label="Bônus concedido"
          icon={ArrowDownToLine}
          tone="info"
          value={brlCompact(granted)}
          hint={`${brl(redemptions ? granted / redemptions : 0)} por resgate`}
          chart={<Sparkline data={daily.map((d) => d.bonus)} slot={4} ariaLabel="Bônus concedido por dia nos últimos 30 dias" />}
        />
        <KpiCard
          label="Convertido"
          icon={TrendingUp}
          tone="warning"
          value={pct(granted ? converted / granted : 0)}
          hint="do bônus cumpriu o rollover"
          formula={<>Bônus que cumpriu o rollover e virou saldo real ÷ bônus concedido. O resto expirou ou ainda está em andamento.</>}
        />
        <KpiCard
          label="Custo real"
          icon={CircleDollarSign}
          tone="danger"
          value={brlCompact(converted)}
          hint="bônus que virou saldo sacável"
          formula={<>Soma do bônus convertido em saldo real. É o custo efetivo da campanha: bônus que expirou sem rollover não custa nada à casa.</>}
        />
      </section>

      {active.length === 0 ? (
        <Alert tone="warning" className="mb-5" title="Nenhuma campanha ativa">
          Depósitos não recebem bônus agora. Ative uma campanha na lista abaixo.
        </Alert>
      ) : (
        <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-fg">
            <Gift size={18} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-primary-text">{active.length === 1 ? 'Campanha ativa agora' : `${active.length} campanhas ativas`}</p>
            <p className="truncate text-sm font-semibold text-fg">
              {active[0].name}: {bonusSummary(active[0])} · mín. {brl(active[0].minDeposit)} · rollover {rolloverSummary(active[0])} · {USAGE_LABEL[active[0].usage].toLowerCase()}
            </p>
          </div>
          <Button size="sm" variant="soft" icon={Calculator} onClick={() => document.getElementById('simulador-bonus')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            Simular depósito
          </Button>
        </div>
      )}

      <DataTable
        className="relative"
        caption="Campanhas de bônus de depósito"
        rows={rows}
        columns={columns}
        rowKey={(c) => c.id}
        searchText={(c) => c.name}
        searchPlaceholder="Buscar campanha"
        initialSort={{ id: 'status', dir: 'desc' }}
        exportName="bonus-deposito"
        onExport={(n) => audit('exportar', 'Bônus de depósito', `Exportação CSV de ${n} campanhas`)}
        onRowClick={(c) => setEditing(c)}
        resetKey={filter}
        toolbar={
          <ChipFilter
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'todas', label: 'Todas', count: items.length },
              { value: 'ativas', label: 'Ativas', count: active.length },
              { value: 'inativas', label: 'Inativas', count: items.length - active.length },
            ]}
          />
        }
        rowActions={(c) => [
          { label: 'Editar', icon: Pencil, onSelect: () => setEditing(c) },
          { label: 'Duplicar', icon: Copy, onSelect: () => setEditing({ ...c, id: '', name: `${c.name} (cópia)`, active: false, redemptions: 0, bonusGranted: 0, bonusConverted: 0 }), disabled: !canEdit },
          { label: c.active ? 'Desativar' : 'Ativar', icon: c.active ? PowerOff : Power, onSelect: () => toggle(c, !c.active), disabled: !canEdit },
          { divider: true },
          { label: c.active ? 'Desative para excluir' : 'Excluir', icon: Trash2, danger: true, onSelect: () => remove(c), disabled: !canEdit || c.active },
        ]}
        empty={{
          title: 'Nenhuma campanha neste filtro',
          description: 'Crie uma campanha de bônus para depósitos.',
          icon: Gift,
          action: (
            <Button size="sm" variant="primary" icon={Plus} onClick={() => setEditing(blank())} disabled={!canEdit}>
              Nova campanha
            </Button>
          ),
        }}
      />

      {sim && (
        <Card className="mt-5 scroll-mt-6" id="simulador-bonus">
          <CardHeader
            icon={Calculator}
            title="Simular um depósito"
            description="Veja quanto de bônus o jogador recebe e quanto precisa apostar. Nada é creditado."
            actions={
              <Select
                aria-label="Campanha para simular"
                className="w-full sm:w-64"
                value={sim.id}
                onChange={setSimId}
                options={items.map((c) => ({ value: c.id, label: `${c.name}${c.active ? '' : ' (inativa)'}` }))}
              />
            }
          />
          <CardBody>
            <DepositCalculator c={sim} deposit={simDeposit} onDeposit={setSimDeposit} wide />
          </CardBody>
        </Card>
      )}

      {editing && <CampaignEditor key={editing.id || 'novo'} initial={editing} canEdit={canEdit} others={items} onClose={() => setEditing(null)} onSave={save} />}
    </>
  )
}

const QUICK = [10, 50, 100, 250, 500, 1000]

/** Calculadora: depósito → bônus (com teto) e rollover a cumprir. */
function DepositCalculator({ c, deposit, onDeposit, wide }: { c: DepositBonusCampaign; deposit: number; onDeposit: (n: number) => void; wide?: boolean }) {
  const r = calcDepositBonus(c, deposit)
  const total = Math.max(0.01, deposit + r.bonus)
  const examples = [...new Set([c.minDeposit, 50, 100, capDeposit(c), 1000].filter((v) => v > 0))].sort((a, b) => a - b).slice(0, 5)
  return (
    <div className={cn('grid gap-5', wide && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]')}>
      <div className="min-w-0 space-y-4">
        <Field label="Valor do depósito" htmlFor={wide ? 'sim-dep' : 'calc-dep'}>
          <MoneyInput id={wide ? 'sim-dep' : 'calc-dep'} value={deposit} onValueChange={onDeposit} />
        </Field>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Valores rápidos">
          {QUICK.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onDeposit(v)}
              className={cn('h-7 rounded-full border px-2.5 text-xs font-medium transition-colors tnum', deposit === v ? 'border-primary bg-primary/10 text-primary-text' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg')}
            >
              {brl(v).replace(',00', '')}
            </button>
          ))}
        </div>

        <div aria-live="polite" className="space-y-3">
          <div className={cn('grid gap-2', wide ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2')}>
            <MiniStat label="Bônus" value={brl(r.bonus)} sub={r.eligible ? `${pct(r.effectivePct, 0)} efetivo` : 'não recebe'} />
            <MiniStat label="Saldo para jogar" value={brl(r.playable)} />
            <MiniStat
              label="Rollover a cumprir"
              value={brl(r.rolloverRequired)}
              sub={c.rollover ? `${mult(c.rollover)} × ${brl(r.rolloverBaseValue)}` : 'sem rollover'}
              className={wide ? undefined : 'col-span-2'}
            />
          </div>
          <div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`Depósito ${brl(deposit)} e bônus ${brl(r.bonus)}`}>
              <div style={{ width: `${(deposit / total) * 100}%`, background: 'var(--chart-1)' }} />
              <div style={{ width: `${(r.bonus / total) * 100}%`, background: 'var(--chart-4)' }} />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: 'var(--chart-1)' }} aria-hidden />
                Depósito <strong className="text-fg tnum">{brl(deposit)}</strong>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: 'var(--chart-4)' }} aria-hidden />
                Bônus <strong className="text-fg tnum">{brl(r.bonus)}</strong>
              </span>
            </div>
          </div>
          {!r.eligible ? (
            <Alert tone="danger">{r.reason}</Alert>
          ) : r.capped ? (
            <Alert tone="warning">
              {r.reason} Acima de {brl(capDeposit(c))} o bônus não cresce mais.
            </Alert>
          ) : null}
          {r.eligible && c.rollover > 0 && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
              <Repeat size={13} className="mr-1 inline text-fg-3" aria-hidden />
              Rollover = {c.rolloverBase === 'bonus' ? `${brl(r.bonus)} (bônus)` : `(${brl(deposit)} + ${brl(r.bonus)})`} × {mult(c.rollover)} = <strong className="text-fg">{brl(r.rolloverRequired)}</strong> em apostas, em até {c.validityDays} dias.
            </p>
          )}
        </div>
      </div>
      <div className="min-w-0">
        <p className="mb-2 text-xs font-medium text-fg-3">Exemplos com as regras desta campanha</p>
        <table className={cn('w-full', wide ? 'text-[13px]' : 'text-xs')}>
          <caption className="sr-only">Exemplos de depósito, bônus e rollover</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-fg-3">
              <th scope="col" className="py-1.5 font-semibold">Depósito</th>
              <th scope="col" className="py-1.5 text-right font-semibold">Bônus</th>
              <th scope="col" className="py-1.5 text-right font-semibold">Apostar</th>
            </tr>
          </thead>
          <tbody>
            {examples.map((v) => {
              const e = calcDepositBonus(c, v)
              return (
                <tr key={v} className={cn('border-b border-line/70 last:border-0', v === deposit && 'bg-primary/5')}>
                  <td className="py-1.5">
                    <button type="button" className="font-medium text-fg tnum hover:underline" onClick={() => onDeposit(v)}>
                      {brl(v)}
                    </button>
                  </td>
                  <td className="whitespace-nowrap py-1.5 text-right tnum">
                    {brl(e.bonus)}
                    {e.capped && <Badge tone="warning" className="ml-1.5">teto</Badge>}
                  </td>
                  <td className="whitespace-nowrap py-1.5 text-right text-fg-2 tnum">{brl(e.rolloverRequired)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CampaignEditor({
  initial,
  canEdit,
  others,
  onClose,
  onSave,
}: {
  initial: DepositBonusCampaign
  canEdit: boolean
  others: DepositBonusCampaign[]
  onClose: () => void
  onSave: (c: DepositBonusCampaign) => void
}) {
  const [c, setC] = useState(initial)
  const [touched, setTouched] = useState(false)
  const [deposit, setDeposit] = useState(50)
  const errs = validateDepositBonus(c)
  const err = (k: string) => (touched ? (errs[k] ?? null) : null)
  const set = <K extends keyof DepositBonusCampaign>(k: K, v: DepositBonusCampaign[K]) => setC((p) => ({ ...p, [k]: v }))
  const dirty = JSON.stringify(c) !== JSON.stringify(initial)
  const conflicts = c.active ? depositConflicts(c, others) : []

  const submit = () => {
    setTouched(true)
    if (Object.keys(errs).length) {
      toast.error('Revise os campos', { description: Object.values(errs)[0] })
      return
    }
    onSave(c)
  }
  const close = async () => {
    if (dirty && !(await confirm({ title: 'Descartar alterações?', description: 'O que você mudou nesta campanha será perdido.', confirmLabel: 'Descartar', tone: 'danger' }))) return
    onClose()
  }

  return (
    <Drawer
      open
      onClose={close}
      width="xl"
      title={c.id ? initial.name : initial.name ? 'Duplicar campanha' : 'Nova campanha de bônus'}
      description={c.id ? `${num(initial.redemptions)} resgates · ${brl(initial.bonusGranted)} concedidos · atualizada ${relative(initial.updatedAt)} por ${initial.updatedBy}` : 'Bônus em % sobre o depósito, com teto e rollover.'}
      headerExtra={
        <Badge tone={c.active ? 'success' : 'neutral'} dot size="md">
          {c.active ? 'Ativa' : 'Inativa'}
        </Badge>
      }
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" icon={Gift} onClick={submit} disabled={!canEdit || (!!c.id && !dirty)}>
            {c.id ? 'Salvar campanha' : 'Criar campanha'}
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        <FormFieldset readOnly={!canEdit} className="min-w-0">
          <Field label="Nome da campanha" htmlFor="db-name" required error={err('name')}>
            <Input id="db-name" value={c.name} maxLength={60} onChange={(e) => set('name', e.target.value)} invalid={!!err('name')} placeholder="Ex.: Deposite 50 e ganhe o dobro" data-autofocus />
          </Field>
          <FormGrid>
            <Field label="Bônus" htmlFor="db-pct" required error={err('bonusPct')} hint={c.bonusPct === 100 ? 'Dobra o depósito.' : undefined}>
              <NumberInput id="db-pct" value={c.bonusPct} min={1} max={500} suffix="%" onValueChange={(n) => set('bonusPct', n)} invalid={!!err('bonusPct')} />
            </Field>
            <Field label="Depósito mínimo" htmlFor="db-min" required error={err('minDeposit')}>
              <MoneyInput id="db-min" value={c.minDeposit} onValueChange={(n) => set('minDeposit', n)} invalid={!!err('minDeposit')} />
            </Field>
            <Field label="Teto do bônus" htmlFor="db-max" required error={err('maxBonus')} hint={errs.maxBonus ? undefined : `Bate no teto quem deposita ${brl(capDeposit(c))} ou mais.`}>
              <MoneyInput id="db-max" value={c.maxBonus} onValueChange={(n) => set('maxBonus', n)} invalid={!!err('maxBonus')} />
            </Field>
            <Field label="Prazo para cumprir" htmlFor="db-valid" error={err('validityDays')} hint="Depois disso, o bônus restante expira.">
              <NumberInput id="db-valid" value={c.validityDays} min={1} max={90} suffix="dias" onValueChange={(n) => set('validityDays', Math.round(n))} invalid={!!err('validityDays')} />
            </Field>
          </FormGrid>
          <Field label="Rollover" htmlFor="db-roll" error={err('rollover')}>
            <NumberInput id="db-roll" value={c.rollover} min={0} max={100} step={0.5} suffix="x" onValueChange={(n) => set('rollover', n)} invalid={!!err('rollover')} />
          </Field>
          <Field label="Base do rollover" hint="O peso de cada tipo de jogo (slots, ao vivo, crash) é aplicado em Campanhas › Rollover.">
            <RadioCards
              name="Base do rollover"
              value={c.rolloverBase}
              onChange={(v) => set('rolloverBase', v)}
              options={[
                { value: 'bonus', label: ROLLOVER_BASE_LABEL.bonus, description: `Bônus × ${mult(c.rollover)}. Mais fácil para o jogador.` },
                { value: 'deposito_bonus', label: ROLLOVER_BASE_LABEL.deposito_bonus, description: `(Depósito + bônus) × ${mult(c.rollover)}. Mais exigente.` },
              ]}
            />
          </Field>
          <Field label="Em qual depósito">
            <Segmented<DepositTrigger>
              ariaLabel="Em qual depósito"
              value={c.depositTrigger}
              onChange={(v) => set('depositTrigger', v)}
              options={(Object.keys(TRIGGER_LABEL) as DepositTrigger[]).map((t) => ({ value: t, label: t === 'qualquer' ? 'Qualquer' : TRIGGER_LABEL[t].replace(' depósito', '') }))}
              className="flex-wrap"
            />
          </Field>
          <Field label="Quantas vezes o jogador recebe">
            <RadioCards<BonusUsage>
              name="Uso por jogador"
              columns={1}
              value={c.usage}
              onChange={(v) => set('usage', v)}
              options={[
                { value: 'uma_vez', label: USAGE_LABEL.uma_vez, description: 'Só no primeiro depósito que se encaixar.' },
                { value: 'diario', label: USAGE_LABEL.diario, description: 'No primeiro depósito de cada dia.' },
                { value: 'cada_deposito', label: USAGE_LABEL.cada_deposito, description: 'Todo depósito elegível. Custo alto.' },
              ]}
            />
          </Field>
          <Switch label="Campanha ativa" description={c.active ? 'Os próximos depósitos recebem o bônus.' : 'Fica salva sem valer no site.'} checked={c.active} onChange={(on) => set('active', on)} />
          {conflicts.length > 0 && (
            <Alert tone="warning" title="Outra campanha ativa no mesmo depósito">
              “{conflicts[0].name}” também vale para {TRIGGER_LABEL[conflicts[0].depositTrigger].toLowerCase()}. O jogador recebe só a de maior bônus.
            </Alert>
          )}
        </FormFieldset>
        <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
          <div className="rounded-xl border border-line p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
              <Calculator size={16} className="text-fg-3" aria-hidden /> Calculadora
            </p>
            <DepositCalculator c={c} deposit={deposit} onDeposit={setDeposit} />
          </div>
        </aside>
      </div>
    </Drawer>
  )
}
