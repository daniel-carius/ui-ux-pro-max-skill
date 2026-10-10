import { useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Coins,
  Gift,
  Megaphone,
  Pause,
  Pencil,
  Percent,
  Play,
  Plus,
  Receipt,
  Shuffle,
  Sparkles,
  TicketCheck,
  TicketPercent,
  Trash2,
  UserCheck,
  Users,
  Wand2,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CopyButton,
  DataTable,
  Drawer,
  EmptyState,
  Field,
  FormGrid,
  Input,
  KpiCard,
  Menu,
  MoneyInput,
  Mono,
  NumberInput,
  PageHeader,
  PersonCell,
  Progress,
  RadioCards,
  Select,
  Tabs,
  confirm,
  toast,
  useTabParam,
  type Column,
  type Tone,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { brl, date, dateTime, maskEmail, num, pct } from '@/lib/format'
import { useCollection } from '@/lib/store'
import { uid } from '@/lib/random'
import { DAY } from '@/data/now'
import { seedCouponRedemptions, seedCoupons } from '@/data/campanhas2-seeds'
import { audit, usePageAccess, useSession } from '@/domain/session'
import { useDemoPlayers } from '@/domain/campanhas-jogadores'
import { AUDIENCE_LABEL, AUDIENCE_OPTIONS, AUDIENCE_SHORT, C2_KEYS, fromDateInput, inAudience, timeUntil, toDateInput, type Audience } from '@/domain/campanhas2-common'
import {
  COUPON_REWARD_LABEL,
  COUPON_STATUS_LABEL,
  checkRedemption,
  couponErrors,
  couponRewardText,
  couponStatus,
  maxCouponCost,
  normalizeCode,
  uniqueCode,
  type Coupon,
  type CouponRedemption,
  type CouponReward,
  type CouponStatus,
} from '@/domain/campanhas2-cupons'
import { DrawerSection, PlayerPreview, READ_ONLY_TITLE, REWARD_ICON, confirmDiscard, useCoin, type CoinCtx } from './_shared-c2'

const STATUS_TONE: Record<CouponStatus, Tone> = { ativo: 'success', pausado: 'neutral', agendado: 'info', expirado: 'neutral', esgotado: 'warning' }
const REWARD_ICONS: Record<CouponReward, LucideIcon> = { bonus_pct: Percent, bonus_brl: Gift, free_spins: Sparkles, moedas: Coins }
const REWARD_HINT: Record<CouponReward, string> = {
  bonus_pct: 'Sobre o depósito, com teto.',
  bonus_brl: 'Valor fixo no saldo bônus.',
  free_spins: 'Giros de R$ 0,40.',
  moedas: 'Crédito na moeda do site.',
}

type Template = { id: string; title: string; description: string; icon: LucideIcon; patch: Partial<Coupon> }

const TEMPLATES: Template[] = [
  { id: 'boas-vindas', title: 'Boas-vindas 100%', description: 'Dobra o 1º depósito até R$ 200', icon: Percent, patch: { reward: 'bonus_pct', value: 100, maxBonus: 200, rollover: 10, minDeposit: 20, audience: 'novos', maxUses: 500, perPlayer: 1 } },
  { id: 'giros', title: '50 giros grátis', description: 'Com depósito a partir de R$ 30', icon: Sparkles, patch: { reward: 'free_spins', value: 50, rollover: 0, minDeposit: 30, audience: 'todos', maxUses: 300, perPlayer: 1 } },
  { id: 'sem-deposito', title: 'R$ 20 sem depósito', description: 'Para novos jogadores, rollover 20x', icon: Gift, patch: { reward: 'bonus_brl', value: 20, rollover: 20, minDeposit: 0, audience: 'novos', maxUses: 100, perPlayer: 1 } },
  { id: 'reativacao', title: 'Volta, jogador', description: 'R$ 30 para inativos que depositarem', icon: Users, patch: { reward: 'bonus_brl', value: 30, rollover: 10, minDeposit: 50, audience: 'inativos', maxUses: 200, perPlayer: 1 } },
]

function blankCoupon(existing: Coupon[], userName: string, patch: Partial<Coupon> = {}): Coupon {
  const now = new Date()
  return {
    id: uid('cp'),
    code: uniqueCode(existing.map((c) => c.code)),
    reward: 'bonus_brl',
    value: 20,
    maxBonus: 0,
    rollover: 10,
    maxUses: 100,
    perPlayer: 1,
    startsAt: fromDateInput(toDateInput(now.toISOString())),
    endsAt: fromDateInput(toDateInput(new Date(now.getTime() + 30 * DAY).toISOString()), true),
    audience: 'todos',
    minDeposit: 20,
    paused: false,
    uses: 0,
    createdAt: now.toISOString(),
    createdBy: userName,
    ...patch,
  }
}

export default function Cupons() {
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  const [tab, setTab] = useTabParam('cupons', ['cupons', 'resgates'] as const)
  const coupons = useCollection<Coupon>(C2_KEYS.cupons, seedCoupons)
  const redemptions = useCollection<CouponRedemption>(C2_KEYS.cuponsResgates, seedCouponRedemptions)
  // simulação de resgate só na demonstração: no modo API os resgates vêm da plataforma
  // (campanhas.cupons.resgates é gravado só pelo servidor) e a tela não lê a base de jogadores
  const players = useDemoPlayers()
  const coin = useCoin()
  const [editing, setEditing] = useState<{ coupon: Coupon; isNew: boolean } | null>(null)
  const now = new Date()

  const startNew = (patch?: Partial<Coupon>) => {
    if (!canEdit) return
    setEditing({ coupon: blankCoupon(coupons.items, user.name, patch), isNew: true })
  }

  const save = (c: Coupon, isNew: boolean) => {
    const next = { ...c, code: normalizeCode(c.code) }
    if (isNew) coupons.add(next)
    else coupons.update(c.id, next)
    audit(isNew ? 'criar' : 'editar', `Cupom ${next.code}`, `${couponRewardText(next, coin)} · ${next.maxUses ? `${num(next.maxUses)} usos` : 'usos ilimitados'} · ${AUDIENCE_SHORT[next.audience]} · até ${date(next.endsAt)}`)
    toast.success(isNew ? 'Cupom criado' : 'Cupom salvo', { description: `O código ${next.code} já pode ser divulgado.` })
    setEditing(null)
  }

  const togglePause = (c: Coupon) => {
    const paused = !c.paused
    coupons.update(c.id, { paused })
    audit(paused ? 'desligar' : 'ligar', `Cupom ${c.code}`, paused ? 'Cupom pausado' : 'Cupom retomado')
    toast.success(paused ? 'Cupom pausado' : 'Cupom retomado', {
      description: paused ? 'Quem digitar o código recebe "cupom indisponível".' : 'O código voltou a valer.',
      action: { label: 'Desfazer', onClick: () => coupons.update(c.id, { paused: !paused }) },
    })
  }

  const remove = async (c: Coupon) => {
    const ok = await confirm({
      title: `Excluir o cupom ${c.code}?`,
      description: c.uses ? `O código para de funcionar na hora. Os ${num(c.uses)} resgates continuam no histórico.` : 'O código para de funcionar na hora. Não dá para desfazer.',
      confirmLabel: 'Excluir cupom',
      tone: 'danger',
      icon: Trash2,
      typeToConfirm: c.uses ? c.code : undefined,
    })
    if (!ok) return
    coupons.remove(c.id)
    audit('excluir', `Cupom ${c.code}`, `Cupom excluído com ${num(c.uses)} resgates`)
    toast.success('Cupom excluído')
  }

  /** Resgata o cupom com um jogador elegível sorteado (demonstração da regra). */
  const simulate = (c: Coupon) => {
    if (!canEdit || !players) return
    const st = couponStatus(c, new Date())
    if (st !== 'ativo') {
      toast.error(`Cupom ${COUPON_STATUS_LABEL[st].toLowerCase()}`, { description: st === 'agendado' ? `Começa em ${date(c.startsAt)}.` : 'Resgates só valem com o cupom ativo.' })
      return
    }
    const used = new Map<string, number>()
    for (const r of redemptions.items) if (r.couponId === c.id) used.set(r.playerId, (used.get(r.playerId) ?? 0) + 1)
    const pool = players.items.filter((p) => p.status === 'ativo' && inAudience(p, c.audience) && (used.get(p.id) ?? 0) < c.perPlayer)
    if (!pool.length) {
      toast.error('Nenhum jogador elegível', { description: `Ninguém do público "${AUDIENCE_LABEL[c.audience]}" pode resgatar agora.` })
      return
    }
    const p = pool[Math.floor(Math.random() * pool.length)]
    const deposit = c.minDeposit > 0 ? Math.round(c.minDeposit * (1 + Math.random() * 2)) : 0
    const res = checkRedemption(c, p, redemptions.items, deposit, coin)
    if (!res.ok) {
      toast.error('Resgate recusado', { description: res.reason })
      return
    }
    const reward = couponRewardText({ ...c, rollover: 0 }, coin)
    const rewardValue = c.reward === 'bonus_pct' ? `${brl(res.cost)} de bônus (${num(c.value)}% de ${brl(deposit)})` : reward
    redemptions.add({ id: uid('rs'), couponId: c.id, code: c.code, playerId: p.id, playerName: p.name, playerEmail: p.email, deposit, reward: rewardValue, cost: res.cost, at: new Date().toISOString() })
    coupons.update(c.id, (x) => ({ ...x, uses: x.uses + 1 }))
    if (c.reward === 'moedas') players.update(p.id, (x) => ({ ...x, coins: x.coins + c.value }))
    audit('criar', `Cupom ${c.code}`, `Resgate simulado por ${p.name} (#${p.id})${deposit ? ` com depósito de ${brl(deposit)}` : ''}: ${rewardValue}`)
    toast.success(`${p.name} resgatou ${c.code}`, { description: `Ganhou ${rewardValue}.` })
  }

  const active = coupons.items.filter((c) => couponStatus(c, now) === 'ativo')
  const cost = redemptions.items.reduce((s, r) => s + r.cost, 0)
  const limited = coupons.items.filter((c) => c.maxUses > 0)
  const usage = limited.length ? limited.reduce((s, c) => s + c.uses / c.maxUses, 0) / limited.length : null

  return (
    <>
      <PageHeader
        actions={
          coupons.items.length > 0 && (
            <>
              <TemplateMenu onPick={(t) => startNew(t.patch)} disabled={!canEdit} />
              <Button variant="primary" icon={Plus} disabled={!canEdit} title={!canEdit ? READ_ONLY_TITLE : undefined} onClick={() => startNew()}>
                Novo cupom
              </Button>
            </>
          )
        }
      >
        <Tabs
          className="mt-5"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'cupons', label: 'Cupons', icon: TicketPercent, count: coupons.items.length },
            { value: 'resgates', label: 'Resgates', icon: Receipt, count: redemptions.items.length },
          ]}
        />
      </PageHeader>

      {coupons.items.length > 0 && (
        <section aria-label="Resumo dos cupons" className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Cupons ativos" icon={TicketPercent} value={`${active.length} de ${coupons.items.length}`} hint={`${coupons.items.filter((c) => couponStatus(c, now) === 'agendado').length} agendados`} />
          <KpiCard label="Resgates" icon={TicketCheck} tone="success" value={num(redemptions.items.length)} hint={`${num(new Set(redemptions.items.map((r) => r.playerId)).size)} jogadores diferentes`} />
          <KpiCard
            label="Custo dos resgates"
            icon={CircleDollarSign}
            tone="warning"
            value={brl(cost)}
            hint={`média de ${brl(redemptions.items.length ? cost / redemptions.items.length : 0)}`}
            formula={<>Bônus em R$ pelo valor, bônus % sobre o depósito (respeitando o teto), free spins a R$ 0,40 por giro e moedas pelo valor de referência.</>}
          />
          <KpiCard label="Uso dos limites" icon={Users} tone="info" value={usage == null ? '—' : pct(usage, 0)} hint="média dos cupons com limite de usos" />
        </section>
      )}

      {tab === 'cupons' ? (
        coupons.items.length === 0 ? (
          <FirstCoupon onNew={() => startNew()} onTemplate={(t) => startNew(t.patch)} canEdit={canEdit} />
        ) : (
          <CouponTable coupons={coupons.items} coin={coin} canEdit={canEdit} onEdit={(c) => setEditing({ coupon: structuredClone(c), isNew: false })} onPause={togglePause} onDelete={remove} onSimulate={players ? simulate : undefined} />
        )
      ) : (
        <Redemptions redemptions={redemptions.items} coupons={coupons.items} canEdit={canEdit} onSimulate={players ? simulate : undefined} onNew={() => startNew()} onGoCoupons={() => setTab('cupons')} />
      )}

      {editing && <CouponDrawer key={editing.coupon.id} initial={editing.coupon} isNew={editing.isNew} all={coupons.items} coin={coin} onClose={() => setEditing(null)} onSave={(c) => save(c, editing.isNew)} />}
    </>
  )
}

function TemplateMenu({ onPick, disabled }: { onPick: (t: Template) => void; disabled?: boolean }) {
  return (
    <Menu
      width={280}
      items={[{ heading: 'Começar de um modelo' }, ...TEMPLATES.map((t) => ({ label: t.title, icon: t.icon, hint: undefined, onSelect: () => onPick(t) }))]}
      trigger={(p) => (
        <Button {...p} icon={Wand2} iconRight={ChevronDown} disabled={disabled}>
          Modelos
        </Button>
      )}
    />
  )
}

// ---------- Estado vazio (a tela começa sem cupons) ----------

function FirstCoupon({ onNew, onTemplate, canEdit }: { onNew: () => void; onTemplate: (t: Template) => void; canEdit: boolean }) {
  const steps = [
    { icon: Wand2, title: 'Crie o código', text: 'Escolha a recompensa, o limite de usos e a validade.' },
    { icon: Megaphone, title: 'Divulgue', text: 'Redes sociais, e-mail, influenciadores ou afiliados.' },
    { icon: UserCheck, title: 'O jogador resgata', text: 'Digita o código na carteira ou no depósito e recebe na hora.' },
  ]
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="relative bg-gradient-to-br from-primary/10 via-surface to-gold/10">
          <EmptyState
            icon={TicketPercent}
            title="Nenhum cupom criado ainda"
            description="Cupons liberam bônus, giros ou moedas para quem digitar o código. Use para campanhas pontuais, parcerias e reativação de jogadores."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" icon={Plus} onClick={onNew} disabled={!canEdit} title={!canEdit ? READ_ONLY_TITLE : undefined}>
                  Criar primeiro cupom
                </Button>
              </div>
            }
            className="py-14"
          />
        </div>
        <ol className="grid border-t border-line sm:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-3 border-line p-5 sm:border-l sm:first:border-l-0 [&:not(:first-child)]:border-t sm:[&:not(:first-child)]:border-t-0">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary-text">
                <s.icon size={17} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">
                  <span className="mr-1 text-fg-3 tnum">{i + 1}.</span>
                  {s.title}
                </p>
                <p className="mt-0.5 text-[13px] leading-5 text-fg-3">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <section aria-label="Modelos de cupom">
        <h2 className="mb-3 text-[15px] font-semibold text-fg">Ou comece de um modelo</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={!canEdit}
              onClick={() => onTemplate(t)}
              className="card group flex items-start gap-3 p-4 text-left transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-warning dark:text-gold">
                <t.icon size={17} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-fg group-hover:text-primary-text">{t.title}</span>
                <span className="mt-0.5 block text-[13px] leading-5 text-fg-3">{t.description}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

// ---------- Lista ----------

function CouponTable({
  coupons,
  coin,
  canEdit,
  onEdit,
  onPause,
  onDelete,
  onSimulate,
}: {
  coupons: Coupon[]
  coin: CoinCtx
  canEdit: boolean
  onEdit: (c: Coupon) => void
  onPause: (c: Coupon) => void
  onDelete: (c: Coupon) => void
  /** só na demonstração */
  onSimulate?: (c: Coupon) => void
}) {
  const now = new Date()
  const columns: Column<Coupon>[] = [
    {
      id: 'code',
      header: 'Código',
      pinned: true,
      sortValue: (c) => c.code,
      cell: (c) => (
        <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Mono className="rounded-md bg-surface-3 px-2 py-1 font-semibold text-fg">{c.code}</Mono>
          <CopyButton value={c.code} label={`Copiar ${c.code}`} />
        </span>
      ),
    },
    {
      id: 'reward',
      header: 'Recompensa',
      sortValue: (c) => c.reward,
      csv: (c) => couponRewardText(c, coin),
      cell: (c) => {
        const I = REWARD_ICONS[c.reward]
        const [main, ...rest] = couponRewardText(c, coin).split(' · ')
        return (
          <span className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-text" title={COUPON_REWARD_LABEL[c.reward]}>
              <I size={15} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-fg">{main}</span>
              <span className="block text-xs text-fg-3">{[COUPON_REWARD_LABEL[c.reward], ...rest].join(' · ')}</span>
            </span>
          </span>
        )
      },
    },
    {
      id: 'uses',
      header: 'Usos',
      sortValue: (c) => (c.maxUses ? c.uses / c.maxUses : c.uses / 1e6),
      csv: (c) => `${c.uses}/${c.maxUses || 'ilimitado'}`,
      cell: (c) =>
        c.maxUses ? (
          <div className="w-28">
            <div className="mb-1 flex justify-between text-xs tnum">
              <span className="font-semibold text-fg">{num(c.uses)}</span>
              <span className="text-fg-3">de {num(c.maxUses)}</span>
            </div>
            <Progress value={c.uses} max={c.maxUses} tone={c.uses >= c.maxUses ? 'warning' : 'primary'} label={`Usos de ${c.code}`} />
          </div>
        ) : (
          <span className="text-[13px] tnum">
            <strong className="text-fg">{num(c.uses)}</strong> <span className="text-fg-3">· ilimitado</span>
          </span>
        ),
    },
    {
      id: 'period',
      header: 'Validade',
      sortValue: (c) => c.endsAt,
      csv: (c) => `${date(c.startsAt)} a ${date(c.endsAt)}`,
      cell: (c) => {
        const st = couponStatus(c, now)
        return (
          <div className="text-[13px]">
            <p className="text-fg-2 tnum">
              {date(c.startsAt)} – {date(c.endsAt)}
            </p>
            <p className={cn('text-xs', st === 'expirado' ? 'text-fg-3' : new Date(c.endsAt).getTime() - now.getTime() < 3 * DAY ? 'font-semibold text-warning' : 'text-fg-3')}>
              {st === 'expirado' ? 'expirou' : st === 'agendado' ? `começa em ${timeUntil(c.startsAt, now)}` : `termina em ${timeUntil(c.endsAt, now)}`}
            </p>
          </div>
        )
      },
    },
    { id: 'audience', header: 'Público', sortValue: (c) => c.audience, csv: (c) => AUDIENCE_LABEL[c.audience], cell: (c) => <span className="text-[13px] text-fg-2">{AUDIENCE_SHORT[c.audience]}</span> },
    { id: 'minDeposit', header: 'Depósito mín.', align: 'right', sortValue: (c) => c.minDeposit, cell: (c) => (c.minDeposit ? <span className="tnum">{brl(c.minDeposit)}</span> : <span className="text-xs text-fg-3">sem depósito</span>) },
    {
      id: 'status',
      header: 'Status',
      sortValue: (c) => couponStatus(c, now),
      csv: (c) => COUPON_STATUS_LABEL[couponStatus(c, now)],
      cell: (c) => {
        const st = couponStatus(c, now)
        return (
          <Badge tone={STATUS_TONE[st]} dot>
            {COUPON_STATUS_LABEL[st]}
          </Badge>
        )
      },
    },
    { id: 'createdBy', header: 'Criado por', defaultHidden: true, sortValue: (c) => c.createdBy, cell: (c) => <span className="text-[13px] text-fg-2">{c.createdBy}</span> },
  ]

  return (
    <DataTable
      caption="Cupons"
      rows={coupons}
      columns={columns}
      rowKey={(c) => c.id}
      searchText={(c) => `${c.code} ${COUPON_REWARD_LABEL[c.reward]} ${AUDIENCE_LABEL[c.audience]}`}
      searchPlaceholder="Buscar código"
      initialSort={{ id: 'period', dir: 'desc' }}
      exportName="cupons"
      onExport={(n) => audit('exportar', 'Cupons', `Exportação CSV de ${n} cupons`)}
      onRowClick={canEdit ? onEdit : undefined}
      rowActions={(c) => {
        const st = couponStatus(c, now)
        return [
          ...(onSimulate
            ? [{ label: 'Simular resgate', icon: Shuffle, onSelect: () => onSimulate(c), disabled: !canEdit || st !== 'ativo', hint: st !== 'ativo' ? COUPON_STATUS_LABEL[st].toLowerCase() : undefined }]
            : []),
          { label: 'Editar', icon: Pencil, onSelect: () => onEdit(c), disabled: !canEdit },
          c.paused
            ? { label: 'Retomar', icon: Play, onSelect: () => onPause(c), disabled: !canEdit }
            : { label: 'Pausar', icon: Pause, onSelect: () => onPause(c), disabled: !canEdit || st === 'expirado' || st === 'esgotado' },
          { divider: true },
          { label: 'Excluir', icon: Trash2, danger: true, onSelect: () => onDelete(c), disabled: !canEdit },
        ]
      }}
      empty={{ title: 'Nenhum cupom', description: 'Crie um cupom para começar.' }}
    />
  )
}

// ---------- Resgates ----------

function Redemptions({
  redemptions,
  coupons,
  canEdit,
  onSimulate,
  onNew,
  onGoCoupons,
}: {
  redemptions: CouponRedemption[]
  coupons: Coupon[]
  canEdit: boolean
  /** só na demonstração */
  onSimulate?: (c: Coupon) => void
  onNew: () => void
  onGoCoupons: () => void
}) {
  const now = new Date()
  const activeCoupons = coupons.filter((c) => couponStatus(c, now) === 'ativo')
  const [pick, setPick] = useState<string>('')
  const chosen = coupons.find((c) => c.id === pick) ?? activeCoupons[0]
  const [couponFilter, setCouponFilter] = useState('')

  if (!coupons.length) {
    return (
      <Card>
        <EmptyState
          icon={Receipt}
          title="Sem resgates por enquanto"
          description="Os resgates aparecem aqui quando existir pelo menos um cupom e alguém usar o código."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" icon={Plus} onClick={onNew} disabled={!canEdit}>
                Criar cupom
              </Button>
              <Button onClick={onGoCoupons}>Ver cupons</Button>
            </div>
          }
          className="py-16"
        />
      </Card>
    )
  }

  const simulator = (
    <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:flex-nowrap">
      <Select
        aria-label="Cupom para simular"
        className="w-56"
        value={chosen?.id ?? ''}
        onChange={setPick}
        placeholder={activeCoupons.length ? undefined : 'Nenhum cupom ativo'}
        options={activeCoupons.map((c) => ({ value: c.id, label: `${c.code} · ${COUPON_REWARD_LABEL[c.reward]}` }))}
      />
      <Button size="md" icon={Shuffle} disabled={!canEdit || !chosen} onClick={() => chosen && onSimulate?.(chosen)} title={!canEdit ? READ_ONLY_TITLE : 'Sorteia um jogador elegível e aplica as regras do cupom'}>
        Simular resgate
      </Button>
    </div>
  )

  const columns: Column<CouponRedemption>[] = [
    { id: 'at', header: 'Data', sortValue: (r) => r.at, csv: (r) => dateTime(r.at), cell: (r) => <span className="whitespace-nowrap text-[13px] text-fg-2">{dateTime(r.at)}</span> },
    { id: 'player', header: 'Jogador', minWidth: 200, sortValue: (r) => r.playerName, csv: (r) => `${r.playerName} (${r.playerId})`, cell: (r) => <PersonCell name={r.playerName} sub={r.playerEmail ? maskEmail(r.playerEmail) : `ID ${r.playerId}`} /> },
    { id: 'code', header: 'Cupom', sortValue: (r) => r.code, cell: (r) => <Mono className="font-semibold text-fg">{r.code}</Mono> },
    { id: 'deposit', header: 'Depósito', align: 'right', sortValue: (r) => r.deposit, cell: (r) => (r.deposit ? <span className="tnum">{brl(r.deposit)}</span> : <span className="text-xs text-fg-3">sem depósito</span>) },
    { id: 'reward', header: 'Recompensa', minWidth: 220, sortValue: (r) => r.reward, cell: (r) => <span className="text-[13px] text-fg-2">{r.reward}</span>, wrap: true },
    { id: 'cost', header: 'Custo', align: 'right', sortValue: (r) => r.cost, csv: (r) => r.cost.toFixed(2), cell: (r) => <span className="font-semibold tnum">{brl(r.cost)}</span> },
  ]
  const rows = couponFilter ? redemptions.filter((r) => r.couponId === couponFilter) : redemptions

  return (
    <div className="space-y-4">
      {onSimulate && (
        <Card>
          <CardBody className="flex flex-col gap-3 pt-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary-text">
                <Shuffle size={17} aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold text-fg">Simular um resgate</p>
                <p className="text-[13px] leading-5 text-fg-3">Sorteia um jogador do público do cupom e aplica as regras: validade, limite por jogador e depósito mínimo.</p>
              </div>
            </div>
            {simulator}
          </CardBody>
        </Card>
      )}
      <DataTable
        caption="Resgates de cupons"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.playerName} ${r.playerEmail ?? ''} ${r.playerId} ${r.code}`}
        searchPlaceholder="Buscar jogador ou código"
        initialSort={{ id: 'at', dir: 'desc' }}
        exportName="cupons-resgates"
        onExport={(n) => audit('exportar', 'Cupons · resgates', `Exportação CSV de ${n} resgates`)}
        resetKey={couponFilter}
        toolbar={
          <Select
            aria-label="Filtrar por cupom"
            className="w-full sm:w-52"
            value={couponFilter}
            onChange={setCouponFilter}
            options={[{ value: '', label: 'Todos os cupons' }, ...coupons.map((c) => ({ value: c.id, label: c.code }))]}
          />
        }
        empty={{
          icon: TicketCheck,
          title: 'Nenhum resgate ainda',
          description: !activeCoupons.length
            ? 'Nenhum cupom está ativo agora. Retome ou crie um cupom.'
            : onSimulate
              ? 'Divulgue o código ou use "Simular resgate" para testar as regras.'
              : 'Divulgue o código. Cada uso no site aparece aqui.',
          action: chosen && onSimulate ? (
            <Button size="sm" icon={Shuffle} disabled={!canEdit} onClick={() => onSimulate(chosen)}>
              Simular resgate de {chosen.code}
            </Button>
          ) : undefined,
        }}
      />
    </div>
  )
}

// ---------- Formulário ----------

function CouponDrawer({ initial, isNew, all, coin, onClose, onSave }: { initial: Coupon; isNew: boolean; all: Coupon[]; coin: CoinCtx; onClose: () => void; onSave: (c: Coupon) => void }) {
  const [c, setC] = useState<Coupon>(initial)
  const [touched, setTouched] = useState(!isNew)
  const liveErrs = couponErrors(c, all)
  // código: valida enquanto digita (unicidade é o erro mais comum)
  const errs = touched ? liveErrs : { code: liveErrs.code && c.code !== initial.code ? liveErrs.code : undefined }
  const dirty = JSON.stringify(c) !== JSON.stringify(initial)
  const set = <K extends keyof Coupon>(k: K, v: Coupon[K]) => setC((x) => ({ ...x, [k]: v }))
  const maxCost = useMemo(() => maxCouponCost(c, coin), [c, coin])
  const RIcon = REWARD_ICON[c.reward]

  const close = async () => {
    if (await confirmDiscard(dirty)) onClose()
  }
  const submit = () => {
    setTouched(true)
    const first = Object.values(liveErrs).find(Boolean)
    if (first) {
      toast.error('Revise o cupom', { description: first })
      return
    }
    onSave(c)
  }

  const setReward = (r: CouponReward) =>
    setC((x) => ({
      ...x,
      reward: r,
      value: r === 'bonus_pct' ? 100 : r === 'bonus_brl' ? 20 : r === 'free_spins' ? 50 : 1000,
      maxBonus: r === 'bonus_pct' ? 200 : 0,
      rollover: r === 'bonus_pct' || r === 'bonus_brl' ? x.rollover || 10 : 0,
      minDeposit: r === 'bonus_pct' && !x.minDeposit ? 20 : x.minDeposit,
    }))

  const conditions = [
    c.minDeposit ? `Depósito mínimo de ${brl(c.minDeposit)}` : 'Não precisa depositar',
    `${c.perPlayer} ${c.perPlayer === 1 ? 'uso' : 'usos'} por jogador`,
    `Válido até ${date(c.endsAt)}`,
    c.audience !== 'todos' ? `Só para: ${AUDIENCE_LABEL[c.audience]}` : null,
    (c.reward === 'bonus_pct' || c.reward === 'bonus_brl') && c.rollover ? `Rollover de ${num(c.rollover)}x` : null,
  ].filter(Boolean) as string[]

  return (
    <Drawer
      open
      onClose={close}
      width="xl"
      title={isNew ? 'Novo cupom' : `Editar ${initial.code}`}
      description="Código, recompensa, limites e validade."
      headerExtra={!isNew ? <Badge tone={STATUS_TONE[couponStatus(initial)]} dot size="md">{COUPON_STATUS_LABEL[couponStatus(initial)]}</Badge> : undefined}
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" onClick={submit}>
            {isNew ? 'Criar cupom' : 'Salvar cupom'}
          </Button>
        </>
      }
    >
      <div className="space-y-8">
        <PlayerPreview title="Na carteira do jogador">
          <div className="mx-auto max-w-sm space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium text-fg-2">Tem um cupom?</p>
              <div className="flex gap-2">
                <div className="input-base flex min-w-0 items-center font-mono text-[13px] font-semibold uppercase text-fg">
                  <span className="truncate">{normalizeCode(c.code) || 'SEU-CODIGO'}</span>
                </div>
                <span className="inline-flex h-10 shrink-0 items-center rounded-lg bg-primary px-3 text-[13px] font-bold text-primary-fg" aria-hidden>
                  Aplicar
                </span>
              </div>
            </div>
            <div className="relative overflow-hidden rounded-xl border border-dashed border-success/40 bg-success/5 p-3">
              <span className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-success/40 bg-surface-2" aria-hidden />
              <span className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-success/40 bg-surface-2" aria-hidden />
              <p className="flex items-center gap-1.5 text-xs font-semibold text-success">
                <CheckCircle2 size={13} aria-hidden /> Cupom aplicado
              </p>
              <p className="mt-1 flex items-center gap-2 text-sm font-bold text-fg">
                <RIcon size={16} className="shrink-0 text-primary-text" aria-hidden />
                {couponRewardText({ ...c, rollover: 0 }, coin)}
              </p>
              <ul className="mt-2 space-y-0.5">
                {conditions.map((t) => (
                  <li key={t} className="text-[11.5px] text-fg-3">
                    · {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </PlayerPreview>

        <DrawerSection title="Código" icon={TicketPercent}>
          <Field label="Código do cupom" htmlFor="cp-code" required error={errs.code} hint="O jogador digita na carteira ou no depósito. Maiúsculas e minúsculas são iguais.">
            <div className="flex gap-2">
              <Input
                id="cp-code"
                value={c.code}
                maxLength={20}
                invalid={!!errs.code}
                autoComplete="off"
                className="font-mono uppercase"
                onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
              />
              <Button icon={Shuffle} onClick={() => set('code', uniqueCode(all.map((x) => x.code)))}>
                Gerar código
              </Button>
            </div>
          </Field>
        </DrawerSection>

        <DrawerSection title="Recompensa" icon={Gift}>
          <RadioCards
            name="Tipo de recompensa"
            columns={2}
            value={c.reward}
            onChange={setReward}
            options={(Object.keys(COUPON_REWARD_LABEL) as CouponReward[]).map((r) => ({ value: r, label: COUPON_REWARD_LABEL[r], description: REWARD_HINT[r], icon: REWARD_ICONS[r] }))}
          />
          <FormGrid columns={3}>
            {c.reward === 'bonus_pct' && (
              <>
                <Field label="Percentual" htmlFor="cp-val" required error={errs.value}>
                  <NumberInput id="cp-val" value={c.value} min={1} suffix="%" invalid={!!errs.value} onValueChange={(n) => set('value', n)} />
                </Field>
                <Field label="Teto do bônus" htmlFor="cp-cap" error={errs.maxBonus} hint="R$ 0,00 = sem teto.">
                  <MoneyInput id="cp-cap" value={c.maxBonus} invalid={!!errs.maxBonus} onValueChange={(n) => set('maxBonus', n)} />
                </Field>
              </>
            )}
            {c.reward === 'bonus_brl' && (
              <Field label="Valor do bônus" htmlFor="cp-val" required error={errs.value}>
                <MoneyInput id="cp-val" value={c.value} invalid={!!errs.value} onValueChange={(n) => set('value', n)} />
              </Field>
            )}
            {c.reward === 'free_spins' && (
              <Field label="Quantidade de giros" htmlFor="cp-val" required error={errs.value}>
                <NumberInput id="cp-val" value={c.value} min={1} suffix="giros" invalid={!!errs.value} onValueChange={(n) => set('value', Math.round(n))} />
              </Field>
            )}
            {c.reward === 'moedas' && (
              <Field label="Moedas" htmlFor="cp-val" required error={errs.value} hint={`≈ ${brl(c.value * coin.refValue)}`}>
                <NumberInput id="cp-val" value={c.value} min={1} suffix={coin.symbol} invalid={!!errs.value} onValueChange={(n) => set('value', Math.round(n))} />
              </Field>
            )}
            {(c.reward === 'bonus_pct' || c.reward === 'bonus_brl') && (
              <Field label="Rollover" htmlFor="cp-roll" error={errs.rollover} hint="0 = sem rollover.">
                <NumberInput id="cp-roll" value={c.rollover} min={0} suffix="x" invalid={!!errs.rollover} onValueChange={(n) => set('rollover', n)} />
              </Field>
            )}
          </FormGrid>
        </DrawerSection>

        <DrawerSection title="Quem pode usar" icon={Users}>
          <FormGrid>
            <Field label="Público" htmlFor="cp-aud">
              <Select id="cp-aud" value={c.audience} onChange={(v) => set('audience', v as Audience)} options={AUDIENCE_OPTIONS} />
            </Field>
            <Field label="Depósito mínimo" htmlFor="cp-dep" error={errs.minDeposit} hint={c.minDeposit ? 'O cupom vale no depósito.' : 'R$ 0,00: resgate direto na carteira.'}>
              <MoneyInput id="cp-dep" value={c.minDeposit} invalid={!!errs.minDeposit} onValueChange={(n) => set('minDeposit', n)} />
            </Field>
            <Field label="Usos máximos no total" htmlFor="cp-max" error={errs.maxUses} hint={c.maxUses ? `${num(c.uses)} já usados.` : '0 = ilimitado.'}>
              <NumberInput id="cp-max" value={c.maxUses} min={0} suffix="usos" invalid={!!errs.maxUses} onValueChange={(n) => set('maxUses', Math.round(n))} />
            </Field>
            <Field label="Usos por jogador" htmlFor="cp-per" error={errs.perPlayer}>
              <NumberInput id="cp-per" value={c.perPlayer} min={1} suffix="usos" invalid={!!errs.perPlayer} onValueChange={(n) => set('perPlayer', Math.round(n))} />
            </Field>
          </FormGrid>
        </DrawerSection>

        <DrawerSection title="Validade" icon={CalendarRange}>
          <FormGrid>
            <Field label="Começa em" htmlFor="cp-from" error={errs.period}>
              <Input id="cp-from" type="date" value={toDateInput(c.startsAt)} invalid={!!errs.period} onChange={(e) => e.target.value && set('startsAt', fromDateInput(e.target.value))} />
            </Field>
            <Field label="Termina em" htmlFor="cp-to" hint="Vale até 23:59 do dia.">
              <Input id="cp-to" type="date" value={toDateInput(c.endsAt)} invalid={!!errs.period} onChange={(e) => e.target.value && set('endsAt', fromDateInput(e.target.value, true))} />
            </Field>
          </FormGrid>
          {maxCost != null ? (
            <Alert tone="info" icon={CircleDollarSign} title={`Custo máximo estimado: ${brl(maxCost)}`}>
              Se todos os {num(c.maxUses)} usos forem resgatados{c.reward === 'bonus_pct' ? (c.maxBonus ? ' com o bônus no teto' : ` com depósitos de ${brl(Math.max(c.minDeposit, 100))}`) : ''}.
            </Alert>
          ) : (
            <Alert tone="warning" title="Usos ilimitados">
              Sem limite total, o custo cresce com cada resgate. Considere definir um teto de usos.
            </Alert>
          )}
        </DrawerSection>
      </div>
    </Drawer>
  )
}
