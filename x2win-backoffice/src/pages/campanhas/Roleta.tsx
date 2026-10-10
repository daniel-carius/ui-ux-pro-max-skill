import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CircleDollarSign,
  Coins,
  Copy,
  Crown,
  Dices,
  Divide,
  History as HistoryIcon,
  LoaderPinwheel,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Scale,
  Trash2,
  UserPlus,
  Users,
  Wand2,
} from 'lucide-react'
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
  PersonCell,
  Progress,
  RadioCards,
  Select,
  Switch,
  confirm,
  toast,
  type Column,
  type Tone,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { brl, dateTime, num, pct } from '@/lib/format'
import { useCollection } from '@/lib/store'
import { uid } from '@/lib/random'
import { DAY, NOW } from '@/data/now'
import { seedWheelSpins, seedWheels } from '@/data/campanhas2-seeds'
import { audit, usePageAccess } from '@/domain/session'
import { C2_KEYS, rewardShort, type CoinInfo } from '@/domain/campanhas2-common'
import {
  MAX_PRIZES,
  PRIZE_KIND_LABEL,
  WHEEL_GROUP_HINT,
  WHEEL_GROUP_LABEL,
  blankChance,
  completeWithLast,
  conflictingWheel,
  distributeEvenly,
  expectedCostPerSpin,
  hasWheelErrors,
  pickPrize,
  prizeCost,
  probabilitySum,
  rotationFor,
  suggestPrizeLabel,
  wheelErrors,
  wheelSegments,
  type PrizeKind,
  type Wheel,
  type WheelGroup,
  type WheelPrize,
  type WheelSpin,
} from '@/domain/campanhas2-roleta'
import { CoinAmount, DrawerSection, MiniStat, READ_ONLY_TITLE, REWARD_ICON, REWARD_TONE, SLOTS, SlotPicker, confirmDiscard, slotColor, useCoin, useReducedMotion, useSavedCollection } from './_shared-c2'

const GROUP_ICON = { todos: Users, novos: UserPlus, vip: Crown } as const
const GROUP_TONE: Record<WheelGroup, Tone> = { todos: 'neutral', novos: 'info', vip: 'gold' }
const SPIN_MS = 4300

function blankWheel(): Wheel {
  const now = new Date().toISOString()
  return {
    id: uid('rl-'),
    name: '',
    group: 'todos',
    spinsPerDay: 1,
    costCoins: 0,
    active: false,
    createdAt: now,
    updatedAt: now,
    prizes: [
      { id: uid('p'), label: 'Tente de novo', kind: 'nada', value: 0, probability: 40, slot: 7 },
      { id: uid('p'), label: '50 EVC', kind: 'moedas', value: 50, probability: 35, slot: 4 },
      { id: uid('p'), label: '10 giros', kind: 'free_spins', value: 10, probability: 20, slot: 3 },
      { id: uid('p'), label: 'R$ 10 bônus', kind: 'bonus_brl', value: 10, probability: 5, slot: 1 },
    ],
  }
}

/** Entidade da auditoria sem repetir "Roleta" quando o nome já começa assim. */
function wheelEntity(name: string) {
  return /^roleta\b/i.test(name.trim()) ? name.trim() : `Roleta ${name.trim()}`
}

function spinCost(s: Pick<WheelSpin, 'kind' | 'value'>, coin: Pick<CoinInfo, 'refValue'>) {
  return prizeCost(s, coin)
}

export default function Roleta() {
  const { canEdit } = usePageAccess()
  // modo API: a data de criação é do servidor; giros (campanhas.roleta.giros) vêm da plataforma
  const wheels = useSavedCollection<Wheel>(C2_KEYS.roleta, seedWheels)
  const spins = useCollection<WheelSpin>(C2_KEYS.roletaGiros, seedWheelSpins)
  const coin = useCoin()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ wheel: Wheel; isNew: boolean } | null>(null)
  const [spinFilter, setSpinFilter] = useState<string>('todas')

  const selected = wheels.items.find((w) => w.id === selectedId) ?? wheels.items[0]

  const recent = useMemo(() => spins.items.filter((s) => NOW.getTime() - new Date(s.at).getTime() <= 30 * DAY), [spins.items])
  const paid = recent.reduce((s, x) => s + spinCost(x, coin), 0)
  const coinsSpent = recent.reduce((s, x) => s + x.costCoins, 0)
  const active = wheels.items.filter((w) => w.active)

  const toggleActive = async (w: Wheel, on: boolean) => {
    if (!canEdit) return
    if (on) {
      const other = conflictingWheel(wheels.items, w)
      if (other) {
        const ok = await confirm({
          title: `Ativar ${w.name}?`,
          description: `${other.name} também é do grupo ${WHEEL_GROUP_LABEL[w.group]} e será desativada. O jogador vê uma roleta por grupo.`,
          confirmLabel: 'Ativar e trocar',
          tone: 'warning',
          icon: LoaderPinwheel,
        })
        if (!ok) return
      }
      // as duas mudanças numa gravação só (o servidor aceita ou recusa as duas)
      const at = new Date().toISOString()
      const saved = await wheels.saveAndWait((prev) => prev.map((x) => (x.id === w.id ? { ...x, active: true, updatedAt: at } : other && x.id === other.id ? { ...x, active: false, updatedAt: at } : x)))
      if (!saved) return
      if (other) audit('desligar', wheelEntity(other.name), `Desativada ao ativar ${w.name} no grupo ${WHEEL_GROUP_LABEL[w.group]}`)
      audit('ligar', wheelEntity(w.name), `Roleta ativada para o grupo ${WHEEL_GROUP_LABEL[w.group]}`)
      toast.success('Roleta ativada', { description: `${w.name} já aparece para o grupo ${WHEEL_GROUP_LABEL[w.group]}.` })
    } else {
      const ok = await confirm({
        title: `Desativar ${w.name}?`,
        description: `A roleta some do site para o grupo ${WHEEL_GROUP_LABEL[w.group]}. Os giros já feitos continuam no histórico.`,
        confirmLabel: 'Desativar',
        tone: 'warning',
      })
      if (!ok || !(await wheels.updateAndWait(w.id, { active: false, updatedAt: new Date().toISOString() }))) return
      audit('desligar', wheelEntity(w.name), 'Roleta desativada')
      toast.success('Roleta desativada')
    }
  }

  const remove = async (w: Wheel) => {
    const ok = await confirm({
      title: `Excluir ${w.name}?`,
      description: 'A roleta sai do painel e do site. Os giros já feitos continuam no histórico. Não dá para desfazer.',
      confirmLabel: 'Excluir roleta',
      tone: 'danger',
      icon: Trash2,
    })
    if (!ok || !(await wheels.removeAndWait(w.id))) return
    if (selectedId === w.id) setSelectedId(null)
    audit('excluir', wheelEntity(w.name), `Roleta do grupo ${WHEEL_GROUP_LABEL[w.group]} com ${w.prizes.length} prêmios excluída`)
    toast.success('Roleta excluída')
  }

  const duplicate = async (w: Wheel) => {
    const now = new Date().toISOString()
    const copy: Wheel = { ...w, id: uid('rl-'), name: `${w.name} (cópia)`, active: false, createdAt: now, updatedAt: now, prizes: w.prizes.map((p) => ({ ...p, id: uid('p') })) }
    if (!(await wheels.addAndWait(copy, 'end'))) return
    setSelectedId(copy.id)
    audit('criar', wheelEntity(copy.name), `Cópia de ${w.name}, criada desativada`)
    toast.success('Roleta duplicada', { description: 'A cópia começa desativada.' })
  }

  const save = async (w: Wheel, isNew: boolean) => {
    const other = w.active ? conflictingWheel(wheels.items, w) : undefined
    if (other) {
      const ok = await confirm({
        title: 'Trocar a roleta ativa do grupo?',
        description: `${other.name} também é do grupo ${WHEEL_GROUP_LABEL[w.group]} e será desativada ao salvar.`,
        confirmLabel: 'Salvar e trocar',
        tone: 'warning',
      })
      if (!ok) return false
    }
    const next = { ...w, name: w.name.trim(), updatedAt: new Date().toISOString() }
    // a roleta e a que sai do grupo numa gravação só; recusada (regra do servidor), nada muda e o drawer fica aberto
    const saved = await wheels.saveAndWait((prev) => {
      const list = prev.map((x) => (other && x.id === other.id ? { ...x, active: false, updatedAt: next.updatedAt } : x))
      return isNew ? [...list, next] : list.map((x) => (x.id === next.id ? next : x))
    })
    if (!saved) return false
    if (other) audit('desligar', wheelEntity(other.name), `Desativada ao ativar ${w.name}`)
    setSelectedId(next.id)
    audit(
      isNew ? 'criar' : 'editar',
      wheelEntity(next.name),
      `${next.prizes.length} prêmios · ${WHEEL_GROUP_LABEL[next.group]} · ${next.spinsPerDay} giro(s)/dia · ${next.costCoins ? `${next.costCoins} ${coin.symbol}` : 'grátis'}${next.active ? ' · ativa' : ''}`,
    )
    toast.success(isNew ? 'Roleta criada' : 'Roleta salva', { description: next.active ? 'Já vale no site.' : 'Ela está desativada. Ative quando quiser publicar.' })
    return true
  }

  const spinColumns: Column<WheelSpin>[] = [
    { id: 'at', header: 'Data', sortValue: (s) => s.at, csv: (s) => dateTime(s.at), cell: (s) => <span className="whitespace-nowrap text-[13px] text-fg-2">{dateTime(s.at)}</span> },
    { id: 'player', header: 'Jogador', minWidth: 200, sortValue: (s) => s.playerName, csv: (s) => `${s.playerName} (${s.playerId})`, cell: (s) => <PersonCell name={s.playerName} sub={`ID ${s.playerId}`} /> },
    { id: 'wheel', header: 'Roleta', sortValue: (s) => s.wheelName, cell: (s) => <span className="text-[13px]">{s.wheelName}</span> },
    {
      id: 'prize',
      header: 'Prêmio',
      sortValue: (s) => spinCost(s, coin),
      csv: (s) => s.prizeLabel,
      cell: (s) => (
        <Badge tone={REWARD_TONE[s.kind]} icon={REWARD_ICON[s.kind]}>
          {s.kind === 'nada' ? s.prizeLabel : rewardShort(s, coin)}
        </Badge>
      ),
    },
    { id: 'cost', money: true, header: 'Custo do prêmio', label: 'Custo do prêmio (R$)', align: 'right', sortValue: (s) => spinCost(s, coin), csv: (s) => spinCost(s, coin).toFixed(2), cell: (s) => <span className="tnum">{brl(spinCost(s, coin))}</span> },
    {
      id: 'coins',
      header: 'Pagou para girar',
      // CSV com a unidade no cabeçalho, como as colunas em R$: "Pagou para girar (EVC)" com 500, ou 0 no giro grátis
      label: `Pagou para girar (${coin.symbol})`,
      align: 'right',
      sortValue: (s) => s.costCoins,
      csv: (s) => s.costCoins,
      cell: (s) => (s.costCoins ? <CoinAmount value={s.costCoins} size={13} /> : <span className="text-xs text-fg-3">Grátis</span>),
    },
  ]

  const spinRows = spinFilter === 'todas' ? spins.items : spins.items.filter((s) => s.wheelId === spinFilter)
  const wheelNames = [...new Map(spins.items.map((s) => [s.wheelId, s.wheelName])).entries()]

  return (
    <>
      <PageHeader
        actions={
          <Button variant="primary" icon={Plus} disabled={!canEdit} title={!canEdit ? READ_ONLY_TITLE : undefined} onClick={() => setEditing({ wheel: blankWheel(), isNew: true })}>
            Nova roleta
          </Button>
        }
      />

      <div className="space-y-6">
        <section aria-label="Resumo das roletas" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Roletas ativas"
            icon={LoaderPinwheel}
            value={`${active.length} de ${wheels.items.length}`}
            hint={active.length ? active.map((w) => WHEEL_GROUP_LABEL[w.group]).join(' · ') : 'nenhum grupo com roleta'}
          />
          <KpiCard label="Giros em 30 dias" icon={Dices} tone="info" value={num(recent.length)} hint={`${num(recent.filter((s) => s.kind === 'nada').length)} sem prêmio`} />
          <KpiCard
            label="Custo dos prêmios"
            icon={CircleDollarSign}
            tone="warning"
            value={brl(paid)}
            hint={`30 dias · média de ${brl(recent.length ? paid / recent.length : 0)} por giro`}
            formula={<>Bônus em R$ pelo valor, free spins a {brl(0.4)} por giro e moedas pelo valor de referência (1 {coin.symbol} = {brl(coin.refValue)}).</>}
          />
          <KpiCard
            label="Moedas gastas para girar"
            icon={Coins}
            tone="success"
            value={`${num(coinsSpent)} ${coin.symbol}`}
            hint={`≈ ${brl(coinsSpent * coin.refValue)} em 30 dias`}
          />
        </section>

        {wheels.items.length === 0 ? (
          <Card>
            <EmptyState
              icon={LoaderPinwheel}
              title="Nenhuma roleta criada"
              description="Crie uma roleta por grupo de jogadores: todos, novos ou VIP. Cada uma tem seus prêmios e chances."
              action={
                <Button variant="primary" icon={Plus} disabled={!canEdit} onClick={() => setEditing({ wheel: blankWheel(), isNew: true })}>
                  Criar roleta
                </Button>
              }
              className="py-16"
            />
          </Card>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
            <section aria-label="Roletas" className="grid content-start gap-4 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              {wheels.items.map((w) => (
                <WheelCard
                  key={w.id}
                  wheel={w}
                  coin={coin}
                  selected={selected?.id === w.id}
                  canEdit={canEdit}
                  onSelect={() => setSelectedId(w.id)}
                  onEdit={() => setEditing({ wheel: structuredClone(w), isNew: false })}
                  onToggle={(on) => toggleActive(w, on)}
                  onDuplicate={() => duplicate(w)}
                  onDelete={() => remove(w)}
                />
              ))}
            </section>
            {selected && <WheelSimulator key={selected.id} wheel={selected} coin={coin} />}
          </div>
        )}

        <DataTable
          caption="Últimos giros"
          rows={spinRows}
          columns={spinColumns}
          rowKey={(s) => s.id}
          searchText={(s) => `${s.playerName} ${s.playerId} ${s.prizeLabel} ${s.wheelName}`}
          searchPlaceholder="Buscar jogador ou prêmio"
          initialSort={{ id: 'at', dir: 'desc' }}
          exportName="roleta-giros"
          onExport={(n) => audit('exportar', 'Roleta · giros', `Exportação CSV de ${n} giros`)}
          resetKey={spinFilter}
          toolbar={
            <ChipFilter
              value={spinFilter}
              onChange={setSpinFilter}
              options={[
                { value: 'todas', label: 'Todas', count: spins.items.length },
                ...wheelNames.map(([id, name]) => ({ value: id, label: name, count: spins.items.filter((s) => s.wheelId === id).length })),
              ]}
              className="max-w-full"
            />
          }
          toolbarRight={
            <span className="hidden items-center gap-1.5 text-xs text-fg-3 xl:flex">
              <HistoryIcon size={13} aria-hidden /> Giros reais dos jogadores
            </span>
          }
          empty={{ title: 'Nenhum giro ainda', description: 'Os giros aparecem aqui assim que os jogadores usarem a roleta.' }}
        />
      </div>

      {editing && (
        <WheelDrawer
          key={editing.wheel.id}
          initial={editing.wheel}
          isNew={editing.isNew}
          all={wheels.items}
          coin={coin}
          onClose={() => setEditing(null)}
          onSave={async (w) => {
            if (await save(w, editing.isNew)) setEditing(null)
          }}
        />
      )}
    </>
  )
}

// ---------- Desenho da roleta ----------

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)] as const
}

function WheelSvg({ prizes, size, label = true, highlightId, hub, coin }: { prizes: WheelPrize[]; size: number; label?: boolean; highlightId?: string | null; hub?: string; coin: Pick<CoinInfo, 'symbol'> }) {
  const segs = wheelSegments(prizes)
  const c = 100
  const r = 94
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className="block" aria-hidden>
      <circle cx={c} cy={c} r={99} fill="rgb(var(--surface-3))" stroke="rgb(var(--line-strong))" strokeWidth={1} />
      {segs.length === 0 && <circle cx={c} cy={c} r={r} fill="rgb(var(--surface-2))" />}
      {segs.map((s) => {
        const dim = highlightId && s.prize.id !== highlightId
        const fill = slotColor(s.prize.slot)
        if (s.end - s.start >= 359.99) return <circle key={s.prize.id} cx={c} cy={c} r={r} fill={fill} opacity={dim ? 0.35 : 1} />
        const [x1, y1] = polar(c, c, r, s.start)
        const [x2, y2] = polar(c, c, r, s.end)
        const large = s.end - s.start > 180 ? 1 : 0
        return (
          <path
            key={s.prize.id}
            d={`M${c} ${c} L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
            fill={fill}
            stroke="rgb(var(--surface))"
            strokeWidth={1.4}
            opacity={dim ? 0.35 : 1}
            style={{ transition: 'opacity 200ms' }}
          />
        )
      })}
      {label &&
        segs.map((s) => {
          const span = s.end - s.start
          if (span < 11) return null
          const flip = s.mid > 180
          const text = s.prize.kind === 'nada' ? s.prize.label : rewardShort(s.prize, coin)
          const fs = span < 20 ? 7.5 : 9
          return (
            <text
              key={`t-${s.prize.id}`}
              x={flip ? c - r * 0.6 : c + r * 0.6}
              y={c}
              transform={`rotate(${flip ? s.mid + 90 : s.mid - 90} ${c} ${c})`}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={fs}
              fontWeight={700}
              fill="rgb(var(--primary-fg))"
              stroke="rgb(var(--shadow) / 0.35)"
              strokeWidth={2}
              paintOrder="stroke"
              opacity={highlightId && s.prize.id !== highlightId ? 0.5 : 1}
            >
              {text.length > 13 ? `${text.slice(0, 12)}…` : text}
            </text>
          )
        })}
      {segs.map((s) => {
        const [x, y] = polar(c, c, 96.5, s.start)
        return <circle key={`d-${s.prize.id}`} cx={x} cy={y} r={1.6} fill="rgb(var(--surface))" />
      })}
      <circle cx={c} cy={c} r={hub ? 19 : 12} fill="rgb(var(--surface))" stroke="rgb(var(--line-strong))" strokeWidth={1} />
      {hub && (
        <text x={c} y={c} textAnchor="middle" dominantBaseline="central" fontSize={7.5} fontWeight={800} letterSpacing={0.6} fill="rgb(var(--fg))">
          {hub}
        </text>
      )}
    </svg>
  )
}

function Pointer({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.1} viewBox="0 0 20 22" className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1/3 drop-shadow" aria-hidden>
      <path d="M2 2h16L10 20z" fill="rgb(var(--fg))" stroke="rgb(var(--surface))" strokeWidth={2} strokeLinejoin="round" />
    </svg>
  )
}

// ---------- Cartão de roleta ----------

function WheelCard({
  wheel: w,
  coin,
  selected,
  canEdit,
  onSelect,
  onEdit,
  onToggle,
  onDuplicate,
  onDelete,
}: {
  wheel: Wheel
  coin: CoinInfo
  selected: boolean
  canEdit: boolean
  onSelect: () => void
  onEdit: () => void
  onToggle: (on: boolean) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const GIcon = GROUP_ICON[w.group]
  const cost = expectedCostPerSpin(w.prizes, coin)
  return (
    <article
      onClick={onSelect}
      className={cn(
        'card flex cursor-pointer gap-4 p-4 transition-[border-color,box-shadow] duration-150 hover:border-line-strong',
        selected && 'border-primary shadow-ring hover:border-primary',
      )}
      aria-current={selected || undefined}
    >
      <div className={cn('shrink-0 transition-opacity', !w.active && 'opacity-60 grayscale')}>
        <WheelSvg prizes={w.prizes} size={88} label={false} coin={coin} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold text-fg">{w.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone={GROUP_TONE[w.group]} icon={GIcon}>
                {WHEEL_GROUP_LABEL[w.group]}
              </Badge>
              <Badge tone={w.active ? 'success' : 'neutral'} dot>
                {w.active ? 'Ativa' : 'Desativada'}
              </Badge>
            </div>
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <Menu
              items={[
                { label: 'Editar', icon: Pencil, onSelect: onEdit, disabled: !canEdit },
                { label: 'Duplicar', icon: Copy, onSelect: onDuplicate, disabled: !canEdit },
                { divider: true },
                { label: 'Excluir', icon: Trash2, danger: true, onSelect: onDelete, disabled: !canEdit },
              ]}
              trigger={(p) => <IconButton {...p} icon={MoreHorizontal} label={`Ações da roleta ${w.name}`} size="sm" />}
            />
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-fg-3">Prêmios</dt>
            <dd className="mt-0.5 font-semibold text-fg tnum">{w.prizes.length}</dd>
          </div>
          <div>
            <dt className="text-fg-3">Giros/dia</dt>
            <dd className="mt-0.5 font-semibold text-fg tnum">{w.spinsPerDay}</dd>
          </div>
          <div>
            <dt className="text-fg-3">Custo/giro</dt>
            <dd className="mt-0.5 font-semibold text-fg tnum">{brl(cost)}</dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3" onClick={(e) => e.stopPropagation()}>
          <span className="text-xs text-fg-3">{w.costCoins ? <CoinAmount value={w.costCoins} size={13} /> : 'Grátis para girar'}</span>
          <div className="flex items-center gap-2">
            <Button size="xs" variant="ghost" icon={Play} onClick={onSelect}>
              Simular
            </Button>
            <Switch size="sm" ariaLabel={`Roleta ${w.name} ativa`} checked={w.active} disabled={!canEdit} onChange={onToggle} />
          </div>
        </div>
      </div>
    </article>
  )
}

// ---------- Simulação ----------

function WheelSimulator({ wheel, coin }: { wheel: Wheel; coin: CoinInfo }) {
  const reduced = useReducedMotion()
  const [rotation, setRotation] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [result, setResult] = useState<WheelPrize | null>(null)
  const [tally, setTally] = useState<Record<string, number>>({})
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const total = Object.values(tally).reduce((s, n) => s + n, 0)
  const simCost = wheel.prizes.reduce((s, p) => s + (tally[p.id] ?? 0) * prizeCost(p, coin), 0)
  const expected = expectedCostPerSpin(wheel.prizes, coin)
  const sum = probabilitySum(wheel.prizes)

  const spin = () => {
    if (spinning) return
    const p = pickPrize(wheel.prizes, Math.random())
    const seg = wheelSegments(wheel.prizes).find((s) => s.prize.id === p.id)
    if (!seg) return
    setResult(null)
    setSpinning(true)
    setRotation((r) => rotationFor(r, seg, Math.random(), reduced ? 0 : 6))
    timer.current = window.setTimeout(
      () => {
        setSpinning(false)
        setResult(p)
        setTally((t) => ({ ...t, [p.id]: (t[p.id] ?? 0) + 1 }))
      },
      reduced ? 0 : SPIN_MS,
    )
  }

  const spinMany = (n: number) => {
    const next = { ...tally }
    for (let i = 0; i < n; i++) {
      const p = pickPrize(wheel.prizes, Math.random())
      next[p.id] = (next[p.id] ?? 0) + 1
    }
    setTally(next)
    setResult(null)
    toast.info(`${num(n)} giros simulados`, { description: 'Compare o simulado com a chance configurada na tabela.' })
  }

  return (
    <Card className="xl:sticky xl:top-20 xl:self-start">
      <CardHeader
        icon={Wand2}
        title={`Simular: ${wheel.name}`}
        description="Teste os prêmios sem creditar nada."
        actions={
          total > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              icon={RotateCcw}
              onClick={() => {
                setTally({})
                setResult(null)
              }}
            >
              Zerar
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-5">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-full max-w-[300px] pt-2">
            <Pointer />
            <div
              className="aspect-square w-full"
              style={{
                transform: `rotate(${rotation}deg)`,
                transition: spinning && !reduced ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.8, 0.18, 1)` : 'none',
                willChange: spinning ? 'transform' : undefined,
              }}
            >
              <div className="h-full w-full [&>svg]:h-full [&>svg]:w-full">
                <WheelSvg prizes={wheel.prizes} size={300} highlightId={result?.id} hub="GIRAR" coin={coin} />
              </div>
            </div>
          </div>
          <div className="w-full" aria-live="polite">
            {result ? (
              <div className={cn('flex items-center gap-3 rounded-xl border p-3', result.kind === 'nada' ? 'border-line bg-surface-2' : 'border-success/30 bg-success/5')}>
                <span className="h-9 w-9 shrink-0 rounded-lg" style={{ background: slotColor(result.slot) }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-fg-3">{result.kind === 'nada' ? 'Resultado' : 'O jogador ganharia'}</p>
                  <p className="truncate text-sm font-semibold text-fg">{result.label}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-fg-3">Chance</p>
                  <p className="text-sm font-semibold text-fg tnum">{pct(result.probability, 1, true)}</p>
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-line px-3 py-3 text-center text-[13px] text-fg-3">
                {spinning ? 'Girando…' : 'Clique em "Simular giro" para sortear um prêmio pela chance.'}
              </p>
            )}
          </div>
          <div className="grid w-full grid-cols-2 gap-2">
            <Button variant="primary" icon={Play} onClick={spin} loading={spinning} disabled={Math.abs(sum - 100) > 0.001}>
              Simular giro
            </Button>
            <Button icon={Dices} onClick={() => spinMany(100)} disabled={spinning}>
              Simular 100 giros
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 rounded-xl bg-surface-2 p-3">
          <MiniStat label="Custo esperado" value={brl(expected)} sub="por giro" />
          <MiniStat label="Sem prêmio" value={pct(blankChance(wheel.prizes), 0, true)} sub="dos giros" />
          <MiniStat label={total ? 'Custo simulado' : 'Por dia, por jogador'} value={total ? brl(simCost / total) : brl(expected * wheel.spinsPerDay)} sub={total ? `média de ${num(total)} giros` : `${wheel.spinsPerDay} giro(s)`} />
        </div>
        {wheel.costCoins > 0 && (
          <p className="text-xs text-fg-3">
            O jogador paga {num(wheel.costCoins)} {coin.symbol} ({brl(wheel.costCoins * coin.refValue)}) por giro.{' '}
            {wheel.costCoins * coin.refValue >= expected ? (
              <span className="font-medium text-success">As moedas cobrem o custo esperado.</span>
            ) : (
              <span className="font-medium text-warning">O custo esperado passa do valor das moedas em {brl(expected - wheel.costCoins * coin.refValue)}.</span>
            )}
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <caption className="sr-only">Distribuição dos prêmios da roleta {wheel.name}</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs text-fg-3">
                <th scope="col" className="py-2 pr-2 font-semibold">
                  Prêmio
                </th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">
                  Chance
                </th>
                <th scope="col" className="px-2 py-2 text-right font-semibold">
                  Simulado
                </th>
                <th scope="col" className="py-2 pl-2 text-right font-semibold">
                  Custo
                </th>
              </tr>
            </thead>
            <tbody>
              {wheel.prizes.map((p) => {
                const n = tally[p.id] ?? 0
                const obs = total ? (n / total) * 100 : 0
                return (
                  <tr key={p.id} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pr-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: slotColor(p.slot) }} aria-hidden />
                        <span className="truncate text-fg">{p.label}</span>
                      </span>
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                        <span className="block h-full rounded-full" style={{ width: `${p.probability}%`, background: slotColor(p.slot) }} />
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right font-semibold text-fg tnum">{pct(p.probability, p.probability % 1 ? 1 : 0, true)}</td>
                    <td className="px-2 py-2 text-right tnum">
                      {total ? (
                        <span className={cn(Math.abs(obs - p.probability) > Math.max(3, p.probability * 0.5) && total >= 50 ? 'text-warning' : 'text-fg-2')}>
                          {pct(obs, 1, true)} <span className="text-xs text-fg-3">({num(n)})</span>
                        </span>
                      ) : (
                        <span className="text-fg-3">—</span>
                      )}
                    </td>
                    <td className="py-2 pl-2 text-right text-fg-2 tnum">{p.kind === 'nada' ? '—' : brl(prizeCost(p, coin))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  )
}

// ---------- Formulário ----------

function WheelDrawer({
  initial,
  isNew,
  all,
  coin,
  onClose,
  onSave,
}: {
  initial: Wheel
  isNew: boolean
  all: Wheel[]
  coin: CoinInfo
  onClose: () => void
  onSave: (w: Wheel) => Promise<void>
}) {
  const [w, setW] = useState<Wheel>(initial)
  const [touched, setTouched] = useState(false)
  const errs = wheelErrors(w)
  const show = touched || !isNew
  const sum = probabilitySum(w.prizes)
  const sumOk = Math.abs(sum - 100) < 0.001
  const dirty = JSON.stringify(w) !== JSON.stringify(initial)
  const conflict = w.active ? conflictingWheel(all, w) : undefined

  const setPrize = (id: string, patch: Partial<WheelPrize>) => setW((x) => ({ ...x, prizes: x.prizes.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  const addPrize = () =>
    setW((x) => {
      const used = new Set(x.prizes.map((p) => p.slot))
      const slot = SLOTS.find((s) => !used.has(s)) ?? SLOTS[x.prizes.length % 8]
      return { ...x, prizes: [...x.prizes, { id: uid('p'), label: suggestPrizeLabel('moedas', 100, coin.symbol), kind: 'moedas', value: 100, probability: 0, slot }] }
    })

  const close = async () => {
    if (await confirmDiscard(dirty)) onClose()
  }

  const [saving, setSaving] = useState(false)
  const submit = async () => {
    setTouched(true)
    if (hasWheelErrors(errs)) {
      toast.error('Revise a roleta', { description: errs.sum ?? errs.name ?? errs.prizes ?? Object.values(errs.prize)[0] ?? 'Há campos inválidos.' })
      return
    }
    if (saving) return
    setSaving(true)
    try {
      await onSave(w)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open
      onClose={close}
      width="xl"
      title={isNew ? 'Nova roleta' : `Editar ${initial.name}`}
      description="Prêmios, chances e quem pode girar."
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" onClick={submit} loading={saving}>
            {isNew ? 'Criar roleta' : 'Salvar roleta'}
          </Button>
        </>
      }
    >
      <div className="space-y-8">
        <DrawerSection title="Dados da roleta" icon={LoaderPinwheel}>
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_200px]">
            <div className="space-y-5">
              <Field label="Nome" htmlFor="w-name" required error={show ? errs.name : null}>
                <Input id="w-name" value={w.name} invalid={show && !!errs.name} placeholder="Ex.: Roleta de sexta" onChange={(e) => setW({ ...w, name: e.target.value })} />
              </Field>
              <FormGrid>
                <Field label="Giros por dia" htmlFor="w-spins" error={show ? errs.spinsPerDay : null} hint="Por jogador. Renova à 00:00.">
                  <NumberInput integer id="w-spins" value={w.spinsPerDay} min={1} max={50} suffix="giros" invalid={show && !!errs.spinsPerDay} onValueChange={(n) => setW({ ...w, spinsPerDay: Math.round(n) })} />
                </Field>
                <Field
                  label="Custo em moedas"
                  htmlFor="w-cost"
                  error={show ? errs.costCoins : null}
                  hint={w.costCoins ? `≈ ${brl(w.costCoins * coin.refValue)} por giro.` : 'Grátis: 0 moedas.'}
                >
                  <NumberInput integer id="w-cost" value={w.costCoins} min={0} suffix={coin.symbol} invalid={show && !!errs.costCoins} onValueChange={(n) => setW({ ...w, costCoins: Math.round(n) })} />
                </Field>
              </FormGrid>
              <Switch
                label="Roleta ativa"
                description={w.active ? `Aparece no site para o grupo ${WHEEL_GROUP_LABEL[w.group]}.` : 'Fica salva, mas não aparece no site.'}
                checked={w.active}
                onChange={(on) => setW({ ...w, active: on })}
              />
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="relative w-full max-w-[200px] pt-2">
                <Pointer size={18} />
                <WheelSvg prizes={w.prizes} size={200} coin={coin} />
              </div>
              <div className="w-full rounded-xl bg-surface-2 p-3 text-center">
                <p className="text-xs text-fg-3">Custo esperado por giro</p>
                <p className="text-base font-bold text-fg tnum">{sumOk ? brl(expectedCostPerSpin(w.prizes, coin)) : '—'}</p>
                <p className="text-xs text-fg-3">{pct(blankChance(w.prizes), 0, true)} sem prêmio</p>
              </div>
            </div>
          </div>
          <Field label="Grupo de jogadores">
            <RadioCards
              name="Grupo de jogadores"
              columns={3}
              value={w.group}
              onChange={(g) => setW({ ...w, group: g })}
              options={(['todos', 'novos', 'vip'] as WheelGroup[]).map((g) => ({ value: g, label: WHEEL_GROUP_LABEL[g], description: WHEEL_GROUP_HINT[g], icon: GROUP_ICON[g] }))}
            />
          </Field>
          {conflict && (
            <Alert tone="warning" title={`${conflict.name} será desativada`}>
              Ela também é do grupo {WHEEL_GROUP_LABEL[w.group]}. O jogador vê uma roleta por grupo.
            </Alert>
          )}
        </DrawerSection>

        <DrawerSection
          title="Prêmios"
          icon={Scale}
          description="O tamanho da fatia segue a chance. As chances precisam somar 100%."
          actions={
            <Button size="sm" icon={Plus} onClick={addPrize} disabled={w.prizes.length >= MAX_PRIZES}>
              Adicionar prêmio
            </Button>
          }
        >
          <div className="hidden grid-cols-[40px_minmax(0,1fr)_140px_110px_96px_32px] gap-2 px-3 text-xs font-semibold text-fg-3 sm:grid">
            <span>Cor</span>
            <span>Rótulo</span>
            <span>Tipo</span>
            <span>Valor</span>
            <span>Chance</span>
            <span className="sr-only">Remover</span>
          </div>
          <ol className="space-y-2">
            {w.prizes.map((p, i) => {
              const err = show ? errs.prize[p.id] : undefined
              return (
                <li key={p.id} className={cn('rounded-xl border p-2.5', err ? 'border-danger/50 bg-danger/[0.03]' : 'border-line')}>
                  <div className="grid grid-cols-[40px_minmax(0,1fr)_32px] items-start gap-2 sm:grid-cols-[40px_minmax(0,1fr)_140px_110px_96px_32px]">
                    <SlotPicker value={p.slot} onChange={(s) => setPrize(p.id, { slot: s })} label={`Cor do prêmio ${i + 1}`} />
                    <Input aria-label={`Rótulo do prêmio ${i + 1}`} value={p.label} maxLength={24} invalid={!!err && !p.label.trim()} onChange={(e) => setPrize(p.id, { label: e.target.value })} />
                    <IconButton
                      icon={Trash2}
                      label={`Remover prêmio ${i + 1}`}
                      size="sm"
                      variant="danger"
                      className="mt-1 sm:order-last"
                      disabled={w.prizes.length <= 2}
                      onClick={() => setW((x) => ({ ...x, prizes: x.prizes.filter((y) => y.id !== p.id) }))}
                    />
                    <div className="col-span-3 grid grid-cols-3 gap-2 sm:contents">
                      <Select
                        aria-label={`Tipo do prêmio ${i + 1}`}
                        value={p.kind}
                        onChange={(k) => {
                          const kind = k as PrizeKind
                          const value = kind === 'nada' ? 0 : p.value || (kind === 'bonus_brl' ? 5 : kind === 'free_spins' ? 10 : 100)
                          setPrize(p.id, { kind, value, label: suggestPrizeLabel(kind, value, coin.symbol) })
                        }}
                        options={(Object.keys(PRIZE_KIND_LABEL) as PrizeKind[]).map((k) => ({ value: k, label: PRIZE_KIND_LABEL[k] }))}
                      />
                      {p.kind === 'bonus_brl' ? (
                        <MoneyInput value={p.value} onValueChange={(n) => setPrize(p.id, { value: n })} invalid={!!err && !(p.value > 0)} />
                      ) : (
                        <NumberInput
                          integer
                          value={p.value}
                          min={0}
                          disabled={p.kind === 'nada'}
                          suffix={p.kind === 'free_spins' ? 'giros' : p.kind === 'moedas' ? coin.symbol : undefined}
                          invalid={!!err && p.kind !== 'nada' && !(p.value > 0)}
                          onValueChange={(n) => setPrize(p.id, { value: Math.round(n) })}
                        />
                      )}
                      <NumberInput value={p.probability} min={0} max={100} step={0.1} suffix="%" onValueChange={(n) => setPrize(p.id, { probability: n })} />
                    </div>
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
          {show && errs.prizes && <p className="text-xs font-medium text-danger">{errs.prizes}</p>}
          <div className={cn('rounded-xl border p-3', sumOk ? 'border-success/25 bg-success/5' : 'border-warning/30 bg-warning/5')} aria-live="polite">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <span className="font-medium text-fg">Soma das chances</span>
              <span className={cn('font-bold tnum', sumOk ? 'text-success' : sum > 100 ? 'text-danger' : 'text-warning')}>
                {sum.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% {sumOk ? '· ok' : sum > 100 ? `· ${(sum - 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% acima` : `· faltam ${(100 - sum).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`}
              </span>
            </div>
            <Progress value={Math.min(sum, 100)} tone={sumOk ? 'success' : sum > 100 ? 'danger' : 'warning'} label="Soma das chances" />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="xs" variant="ghost" icon={Divide} onClick={() => setW((x) => ({ ...x, prizes: distributeEvenly(x.prizes) }))}>
                Distribuir igualmente
              </Button>
              <Button size="xs" variant="ghost" icon={Wand2} disabled={sumOk} onClick={() => setW((x) => ({ ...x, prizes: completeWithLast(x.prizes) }))}>
                Ajustar o último para fechar 100%
              </Button>
            </div>
          </div>
        </DrawerSection>
      </div>
    </Drawer>
  )
}
