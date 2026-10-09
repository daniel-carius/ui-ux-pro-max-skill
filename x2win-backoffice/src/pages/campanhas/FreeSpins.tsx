import { useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowDownToLine,
  Ban,
  CalendarRange,
  CircleDollarSign,
  CirclePause,
  CirclePlay,
  CircleStop,
  Copy,
  Gift,
  Hand,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  TicketPercent,
  Trash2,
  Trophy,
  UserPlus,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  ChipFilter,
  DataTable,
  DescriptionList,
  Drawer,
  EmptyState,
  Field,
  FormFieldset,
  FormGrid,
  IconButton,
  Input,
  KpiCard,
  Menu,
  Modal,
  MoneyInput,
  NumberInput,
  PageHeader,
  PersonCell,
  Progress,
  RadioCards,
  Select,
  Tabs,
  Textarea,
  confirm,
  confirmWithInput,
  toast,
  useTabParam,
  type Column,
  type Tone,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { brl, brlCompact, date, dateTime, maskEmail, mult, num, pct, plural, relative } from '@/lib/format'
import { uid } from '@/lib/random'
import { useCollection } from '@/lib/store'
import { useGames, usePlayers, useProviders } from '@/data/hooks'
import type { Player } from '@/data/players'
import { FS_KEYS, seedFsCampaigns, seedFsGrants } from '@/data/campanhas-freespins'
import { audit, usePageAccess, useSession } from '@/domain/session'
import {
  FS_STATUS_LABEL,
  FS_TRIGGER_DESCRIPTION,
  FS_TRIGGER_LABEL,
  GRANT_STATUS_LABEL,
  canGrant,
  fsCampaignStatus,
  fsConflicts,
  fsEligibleSuggestion,
  fsEstimate,
  fsValuePerPlayer,
  grantStatus,
  triggerText,
  validateFsCampaign,
  type FreeSpinCampaign,
  type FreeSpinGrant,
  type FsCampaignStatus,
  type FsTrigger,
  type GrantStatus,
} from '@/domain/campanhas-freespins'
import { CalcLine, GamePicker, GameTile, PlayerFinder, fromDateInput, providerNameOf, toDateInput } from './_shared-c1'

const STATUS_TONE: Record<FsCampaignStatus, Tone> = { agendada: 'info', ativa: 'success', pausada: 'warning', encerrada: 'neutral' }
const GRANT_TONE: Record<GrantStatus, Tone> = { ativa: 'info', concluida: 'success', expirada: 'neutral', cancelada: 'danger' }
const TRIGGER_ICON: Record<FsTrigger, LucideIcon> = { deposito: ArrowDownToLine, cadastro: UserPlus, manual: Hand, cupom: TicketPercent }

type CampaignRow = FreeSpinCampaign & { status: FsCampaignStatus }
type GrantRow = FreeSpinGrant & { live: GrantStatus }

export default function FreeSpins() {
  const [tab, setTab] = useTabParam('campanhas', ['campanhas', 'concessoes'] as const)
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  const campaigns = useCollection<FreeSpinCampaign>(FS_KEYS.campaigns, seedFsCampaigns)
  const grants = useCollection<FreeSpinGrant>(FS_KEYS.grants, seedFsGrants)
  const { items: games } = useGames()
  const { items: providers } = useProviders()
  const [editing, setEditing] = useState<FreeSpinCampaign | null>(null)
  const [granting, setGranting] = useState<{ campaignId: string | null } | null>(null)

  const rows: CampaignRow[] = useMemo(() => campaigns.items.map((c) => ({ ...c, status: fsCampaignStatus(c) })), [campaigns.items])
  const grantRows: GrantRow[] = useMemo(() => grants.items.map((g) => ({ ...g, live: grantStatus(g) })), [grants.items])

  const since30 = Date.now() - 30 * 86_400_000
  const recent = grantRows.filter((g) => new Date(g.grantedAt).getTime() >= since30 && g.live !== 'cancelada')
  const spins30 = recent.reduce((s, g) => s + g.spins, 0)
  const value30 = recent.reduce((s, g) => s + g.spins * g.spinValue, 0)
  const wins30 = recent.reduce((s, g) => s + g.winnings, 0)
  const activeCount = rows.filter((r) => r.status === 'ativa').length
  const lockedTitle = !canEdit ? 'Seu cargo pode ver, mas não editar free spins' : undefined

  const newCampaign = (): FreeSpinCampaign => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return {
      id: '',
      name: '',
      trigger: 'deposito',
      depositNumber: 1,
      minDeposit: 20,
      couponCode: '',
      gameId: games.find((g) => g.name === 'Fortune Tiger')?.id ?? '',
      spins: 50,
      spinValue: 0.4,
      validityDays: 7,
      winRollover: 10,
      maxPerPlayer: 1,
      paused: false,
      startAt: start.toISOString(),
      endAt: null,
      estimatedPlayers: 300,
      createdAt: '',
      createdBy: user.name,
    }
  }

  const saveCampaign = async (c: FreeSpinCampaign) => {
    const conflicts = fsConflicts(c, campaigns.items)
    if (conflicts.length && !c.paused) {
      const ok = await confirm({
        title: 'Já existe campanha neste depósito',
        description: `"${conflicts[0].name}" também libera giros no ${c.depositNumber}º depósito. O jogador recebe as duas, somando o custo. Quer salvar mesmo assim?`,
        confirmLabel: 'Salvar mesmo assim',
        tone: 'warning',
      })
      if (!ok) return
    }
    const game = games.find((g) => g.id === c.gameId)
    const clean = { ...c, name: c.name.trim(), couponCode: c.couponCode.trim().toUpperCase() }
    if (c.id) {
      campaigns.update(c.id, clean)
      audit('editar', `Free spins ${clean.name}`, `${clean.spins} giros de ${brl(clean.spinValue)} em ${game?.name ?? '—'} · ${triggerText(clean)}`)
      toast.success('Campanha atualizada', { description: 'Concessões novas já usam as regras novas.' })
    } else {
      const created = { ...clean, id: uid('fs'), createdAt: new Date().toISOString(), createdBy: user.name }
      campaigns.add(created)
      audit('criar', `Free spins ${clean.name}`, `${clean.spins} giros de ${brl(clean.spinValue)} em ${game?.name ?? '—'} · ${triggerText(clean)}`)
      toast.success('Campanha criada', { description: fsCampaignStatus(created) === 'agendada' ? `Começa em ${date(created.startAt)}.` : 'Já está valendo no site.' })
    }
    setEditing(null)
  }

  const togglePause = async (c: CampaignRow) => {
    if (c.status === 'pausada') {
      campaigns.update(c.id, { paused: false })
      audit('ligar', `Free spins ${c.name}`, 'Campanha retomada')
      toast.success('Campanha retomada')
      return
    }
    const ok = await confirm({
      title: `Pausar "${c.name}"?`,
      description: 'Novos jogadores deixam de receber os giros. Quem já recebeu continua podendo usar até a validade.',
      confirmLabel: 'Pausar campanha',
      tone: 'warning',
      icon: CirclePause,
    })
    if (!ok) return
    campaigns.update(c.id, { paused: true })
    audit('desligar', `Free spins ${c.name}`, 'Campanha pausada')
    toast.success('Campanha pausada')
  }

  const endNow = async (c: CampaignRow) => {
    const ok = await confirm({ title: `Encerrar "${c.name}"?`, description: 'A campanha para de conceder giros e não pode ser retomada. Giros já concedidos continuam válidos.', confirmLabel: 'Encerrar campanha', tone: 'danger', icon: CircleStop })
    if (!ok) return
    campaigns.update(c.id, { endAt: new Date(Date.now() - 1000).toISOString(), paused: false })
    audit('desligar', `Free spins ${c.name}`, 'Campanha encerrada antes do prazo')
    toast.success('Campanha encerrada')
  }

  const duplicate = (c: CampaignRow) => {
    const copy = { ...newCampaign(), ...c, id: '', name: `${c.name} (cópia)`, paused: true, endAt: null, couponCode: c.trigger === 'cupom' ? `${c.couponCode.slice(0, 12)}2` : '' }
    delete (copy as Partial<CampaignRow>).status
    setEditing(copy)
  }

  const remove = async (c: CampaignRow) => {
    const used = grants.items.filter((g) => g.campaignId === c.id).length
    const ok = await confirm({
      title: `Excluir "${c.name}"?`,
      description: used ? `A campanha tem ${num(used)} concessões. Elas continuam no histórico, mas a campanha sai da lista.` : 'A campanha sai da lista.',
      confirmLabel: 'Excluir campanha',
      tone: 'danger',
      icon: Trash2,
      typeToConfirm: c.status === 'ativa' ? 'EXCLUIR' : undefined,
    })
    if (!ok) return
    campaigns.remove(c.id)
    audit('excluir', `Free spins ${c.name}`, `Campanha excluída (${num(used)} concessões no histórico)`)
    toast.success('Campanha excluída')
  }

  const grant = (player: Player, c: FreeSpinCampaign, spins: number, note: string) => {
    const now = new Date()
    const g: FreeSpinGrant = {
      id: `FS${String(Math.floor(20000 + Math.random() * 79999))}`,
      campaignId: c.id,
      campaignName: c.name,
      playerId: player.id,
      playerName: player.name,
      playerEmail: player.email,
      gameId: c.gameId,
      spins,
      spinValue: c.spinValue,
      used: 0,
      winnings: 0,
      grantedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + c.validityDays * 86_400_000).toISOString(),
      status: 'ativa',
      origin: 'manual',
      grantedBy: user.name,
      note,
    }
    grants.add(g)
    const game = games.find((x) => x.id === c.gameId)
    audit('criar', `Free spins ${c.name}`, `${spins} giros de ${brl(c.spinValue)} (${game?.name ?? '—'}) concedidos a ${player.name} (ID ${player.id}). Motivo: ${note}`)
    toast.success('Giros concedidos', {
      description: `${spins} giros em ${game?.name ?? 'jogo'} para ${player.name}. Valem até ${date(g.expiresAt)}.`,
      action: tab === 'concessoes' ? undefined : { label: 'Ver concessões', onClick: () => setTab('concessoes') },
    })
    setGranting(null)
  }

  return (
    <>
      <PageHeader
        actions={
          <>
            <Button icon={Gift} onClick={() => setGranting({ campaignId: null })} disabled={!canEdit} title={lockedTitle}>
              Conceder manualmente
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => setEditing(newCampaign())} disabled={!canEdit} title={lockedTitle}>
              Nova campanha
            </Button>
          </>
        }
      >
        <Tabs
          className="mt-5"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'campanhas', label: 'Campanhas', icon: Sparkles, count: rows.length },
            { value: 'concessoes', label: 'Concessões', icon: ListChecks, count: grantRows.length },
          ]}
        />
      </PageHeader>

      <section aria-label="Resumo de free spins" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Campanhas ativas" icon={Sparkles} tone="success" value={num(activeCount)} hint={`${plural(rows.filter((r) => r.status === 'pausada').length, 'pausada', 'pausadas')} · ${plural(rows.filter((r) => r.status === 'encerrada').length, 'encerrada', 'encerradas')}`} />
        <KpiCard label="Giros concedidos" icon={Gift} tone="info" value={num(spins30)} hint={`${plural(recent.length, 'concessão', 'concessões')} em 30 dias`} />
        <KpiCard label="Valor em giros" icon={CircleDollarSign} tone="warning" value={brlCompact(value30)} hint="giros × valor por giro, 30 dias" formula={<>Soma de (giros concedidos × valor por giro) nos últimos 30 dias. Concessões canceladas não entram.</>} />
        <KpiCard
          label="Ganho dos jogadores"
          icon={Trophy}
          tone="danger"
          value={brlCompact(wins30)}
          hint={`${pct(value30 ? wins30 / value30 : 0, 0)} do valor em giros`}
          formula={<>Quanto os jogadores ganharam jogando os giros (custo real para a casa antes do rollover), nos últimos 30 dias.</>}
        />
      </section>

      {tab === 'campanhas' ? (
        <CampaignsTab
          rows={rows}
          grants={grantRows}
          canEdit={canEdit}
          onNew={() => setEditing(newCampaign())}
          onEdit={(c) => setEditing(c)}
          onTogglePause={togglePause}
          onEnd={endNow}
          onDuplicate={duplicate}
          onRemove={remove}
          onGrant={(c) => setGranting({ campaignId: c.id })}
          games={games}
          providers={providers}
        />
      ) : (
        <GrantsTab
          rows={grantRows}
          campaigns={rows}
          canEdit={canEdit}
          onCancel={async (g) => {
            const r = await confirmWithInput({
              title: `Cancelar giros de ${g.playerName}?`,
              description: `Os ${g.spins - g.used} giros que faltam deixam de valer. O que o jogador já ganhou continua no saldo bônus.`,
              confirmLabel: 'Cancelar giros',
              tone: 'danger',
              icon: Ban,
              input: { label: 'Motivo', required: true, options: ['Contas ligadas (anti-fraude)', 'Concedido por engano', 'Pedido do jogador', 'Jogo responsável', 'Outro motivo'].map((v) => ({ value: v, label: v })) },
            })
            if (!r.confirmed) return false
            grants.update(g.id, { status: 'cancelada', note: `Cancelado: ${r.value}` })
            audit('editar', `Free spins ${g.campaignName}`, `Giros restantes de ${g.playerName} (ID ${g.playerId}) cancelados: ${r.value}`)
            toast.success('Giros cancelados')
            return true
          }}
          onGrant={() => setGranting({ campaignId: null })}
        />
      )}

      {editing && <CampaignDrawer key={editing.id || 'novo'} initial={editing} others={campaigns.items} canEdit={canEdit} onClose={() => setEditing(null)} onSave={saveCampaign} />}

      {granting && <GrantModal campaignId={granting.campaignId} campaigns={rows} grants={grants.items} onClose={() => setGranting(null)} onGrant={grant} />}
    </>
  )
}

// ---------- Aba Campanhas ----------

function CampaignsTab({
  rows,
  grants,
  canEdit,
  onNew,
  onEdit,
  onTogglePause,
  onEnd,
  onDuplicate,
  onRemove,
  onGrant,
  games,
  providers,
}: {
  rows: CampaignRow[]
  grants: GrantRow[]
  canEdit: boolean
  onNew: () => void
  onEdit: (c: FreeSpinCampaign) => void
  onTogglePause: (c: CampaignRow) => void
  onEnd: (c: CampaignRow) => void
  onDuplicate: (c: CampaignRow) => void
  onRemove: (c: CampaignRow) => void
  onGrant: (c: CampaignRow) => void
  games: ReturnType<typeof useGames>['items']
  providers: ReturnType<typeof useProviders>['items']
}) {
  const [filter, setFilter] = useState<'todas' | FsCampaignStatus>('todas')
  const count = (s: FsCampaignStatus) => rows.filter((r) => r.status === s).length
  const visible = rows.filter((r) => filter === 'todas' || r.status === filter).sort((a, b) => order(a.status) - order(b.status))
  return (
    <div className="space-y-4">
      <ChipFilter
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'todas', label: 'Todas', count: rows.length },
          { value: 'ativa', label: 'Ativas', count: count('ativa') },
          { value: 'agendada', label: 'Agendadas', count: count('agendada') },
          { value: 'pausada', label: 'Pausadas', count: count('pausada'), tone: 'warning' },
          { value: 'encerrada', label: 'Encerradas', count: count('encerrada') },
        ]}
      />
      {visible.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map((c) => {
            const game = games.find((g) => g.id === c.gameId)
            const list = grants.filter((g) => g.campaignId === c.id && g.live !== 'cancelada')
            const totalSpins = list.reduce((s, g) => s + g.spins, 0)
            const used = list.reduce((s, g) => s + g.used, 0)
            const wins = list.reduce((s, g) => s + g.winnings, 0)
            const est = fsEstimate(c, game?.rtp ?? 96)
            const TIcon = TRIGGER_ICON[c.trigger]
            return (
              <article key={c.id} className={cn('card flex min-w-0 flex-col overflow-hidden', c.status === 'encerrada' && 'opacity-90')}>
                <div className="flex gap-4 p-4">
                  <GameTile game={game} size={60} className="rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="min-w-0 truncate text-[15px] font-semibold text-fg" title={c.name}>
                        {c.name}
                      </h3>
                      <Badge tone={STATUS_TONE[c.status]} dot>
                        {FS_STATUS_LABEL[c.status]}
                      </Badge>
                    </div>
                    <p className="truncate text-[13px] text-fg-2">
                      {game?.name ?? 'Jogo removido'} · {game ? providerNameOf(providers, game.providerId) : '—'} · RTP {game?.rtp.toLocaleString('pt-BR') ?? '—'}%
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone="primary" icon={TIcon}>
                        {triggerText(c)}
                      </Badge>
                      <Badge>Validade {c.validityDays} dias</Badge>
                      <Badge>Rollover {mult(c.winRollover)}</Badge>
                      {c.maxPerPlayer > 1 && <Badge>Até {c.maxPerPlayer}x por jogador</Badge>}
                    </div>
                  </div>
                </div>
                <dl className="grid grid-cols-3 divide-x divide-line border-y border-line bg-surface-2/50">
                  <Stat label="Giros por jogador" value={`${num(c.spins)} × ${brl(c.spinValue)}`} />
                  <Stat label="Valor por jogador" value={brl(est.valuePerPlayer)} />
                  <Stat label="Custo esperado" value={brl(est.expectedPerPlayer)} hint="valor × RTP" />
                </dl>
                <div className="grid grid-cols-3 gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-xs text-fg-3">Concessões</p>
                    <p className="text-sm font-semibold text-fg tnum">{num(list.length)}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-fg-3">Giros usados</p>
                    <p className="text-sm font-semibold text-fg tnum">{pct(totalSpins ? used / totalSpins : 0, 0)}</p>
                    <Progress value={used} max={Math.max(1, totalSpins)} className="mt-1" label={`Giros usados em ${c.name}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-fg-3">Ganho dos jogadores</p>
                    <p className="text-sm font-semibold text-fg tnum">{brl(wins)}</p>
                  </div>
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
                  <span className="mr-auto inline-flex items-center gap-1 text-xs text-fg-3">
                    <CalendarRange size={13} aria-hidden />
                    {c.endAt ? `${date(c.startAt)} – ${date(c.endAt)}` : `Desde ${date(c.startAt)}`}
                  </span>
                  {c.status !== 'encerrada' && (
                    <Button size="sm" variant="ghost" icon={Gift} onClick={() => onGrant(c)} disabled={!canEdit}>
                      Conceder
                    </Button>
                  )}
                  {(c.status === 'ativa' || c.status === 'pausada' || c.status === 'agendada') && (
                    <Button size="sm" variant="ghost" icon={c.status === 'pausada' ? CirclePlay : CirclePause} onClick={() => onTogglePause(c)} disabled={!canEdit}>
                      {c.status === 'pausada' ? 'Retomar' : 'Pausar'}
                    </Button>
                  )}
                  <Button size="sm" icon={Pencil} onClick={() => onEdit(c)} disabled={!canEdit || c.status === 'encerrada'} title={c.status === 'encerrada' ? 'Campanha encerrada: duplique para repetir' : undefined}>
                    Editar
                  </Button>
                  <Menu
                    items={[
                      { label: 'Duplicar', icon: Copy, onSelect: () => onDuplicate(c), disabled: !canEdit },
                      { label: 'Encerrar agora', icon: CircleStop, onSelect: () => onEnd(c), disabled: !canEdit || c.status === 'encerrada' },
                      { divider: true },
                      { label: 'Excluir', icon: Trash2, danger: true, onSelect: () => onRemove(c), disabled: !canEdit },
                    ]}
                    trigger={(p) => <IconButton {...p} icon={MoreHorizontal} label={`Mais ações de ${c.name}`} size="sm" />}
                  />
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={Sparkles}
            title={filter === 'todas' ? 'Nenhuma campanha de giros' : 'Nenhuma campanha neste filtro'}
            description={filter === 'todas' ? 'Crie uma campanha para liberar giros grátis por depósito, cadastro ou cupom.' : 'Troque o filtro de status.'}
            action={
              filter === 'todas' ? (
                <Button variant="primary" icon={Plus} onClick={onNew} disabled={!canEdit}>
                  Nova campanha
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}
    </div>
  )
}

function order(s: FsCampaignStatus) {
  return { ativa: 0, agendada: 1, pausada: 2, encerrada: 3 }[s]
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 px-4 py-2.5">
      <dt className="truncate text-xs text-fg-3">{label}</dt>
      <dd className="truncate text-sm font-bold text-fg tnum">{value}</dd>
      {hint && <dd className="truncate text-[11px] text-fg-3">{hint}</dd>}
    </div>
  )
}

// ---------- Aba Concessões ----------

function GrantsTab({
  rows,
  campaigns,
  canEdit,
  onCancel,
  onGrant,
}: {
  rows: GrantRow[]
  campaigns: CampaignRow[]
  canEdit: boolean
  onCancel: (g: GrantRow) => Promise<boolean>
  onGrant: () => void
}) {
  const { items: games } = useGames()
  const [filter, setFilter] = useState<'todas' | GrantStatus>('todas')
  const [campaignId, setCampaignId] = useState('todas')
  const [openId, setOpenId] = useState<string | null>(null)
  const byCampaign = rows.filter((g) => campaignId === 'todas' || g.campaignId === campaignId)
  const count = (s: GrantStatus) => byCampaign.filter((g) => g.live === s).length
  const visible = byCampaign.filter((g) => filter === 'todas' || g.live === filter)
  const open = openId ? rows.find((g) => g.id === openId) : undefined
  const gameName = (id: string) => games.find((g) => g.id === id)?.name ?? '—'

  const columns: Column<GrantRow>[] = [
    {
      id: 'player',
      header: 'Jogador',
      pinned: true,
      minWidth: 220,
      sortValue: (g) => g.playerName,
      csv: (g) => `${g.playerName} (ID ${g.playerId})`,
      cell: (g) => <PersonCell name={g.playerName} sub={`ID ${g.playerId} · ${maskEmail(g.playerEmail)}`} />,
    },
    {
      id: 'campaign',
      header: 'Campanha',
      minWidth: 200,
      sortValue: (g) => g.campaignName,
      csv: (g) => `${g.campaignName} (${g.origin === 'manual' ? 'manual' : 'automática'})`,
      cell: (g) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] text-fg">{g.campaignName}</p>
          <p className="text-xs text-fg-3">{g.origin === 'manual' ? `Manual · ${g.grantedBy ?? '—'}` : 'Automática'}</p>
        </div>
      ),
    },
    {
      id: 'game',
      header: 'Jogo',
      defaultHidden: true,
      sortValue: (g) => gameName(g.gameId),
      csv: (g) => gameName(g.gameId),
      cell: (g) => {
        const game = games.find((x) => x.id === g.gameId)
        return (
          <span className="flex items-center gap-2">
            <GameTile game={game} size={24} />
            <span className="text-[13px]">{game?.name ?? '—'}</span>
          </span>
        )
      },
    },
    {
      id: 'spins',
      header: 'Giros usados',
      align: 'right',
      minWidth: 120,
      sortValue: (g) => g.used / g.spins,
      csv: (g) => `${g.used}/${g.spins}`,
      cell: (g) => (
        <div className="ml-auto w-24">
          <p className="text-[13px] tnum">
            {num(g.used)}/{num(g.spins)}
          </p>
          <Progress value={g.used} max={g.spins} tone={g.used >= g.spins ? 'success' : 'primary'} className="mt-1" label="Giros usados" />
        </div>
      ),
    },
    { id: 'value', header: 'Valor', align: 'right', sortValue: (g) => g.spins * g.spinValue, csv: (g) => g.spins * g.spinValue, cell: (g) => brl(g.spins * g.spinValue) },
    {
      id: 'winnings',
      header: 'Ganho',
      align: 'right',
      sortValue: (g) => g.winnings,
      cell: (g) => <span className={cn('font-medium', g.winnings > g.spins * g.spinValue * 2 ? 'text-danger' : 'text-fg')}>{brl(g.winnings)}</span>,
    },
    { id: 'grantedAt', header: 'Concedido em', sortValue: (g) => g.grantedAt, csv: (g) => dateTime(g.grantedAt), cell: (g) => <span className="text-[13px] text-fg-2 tnum">{dateTime(g.grantedAt)}</span> },
    { id: 'expiresAt', header: 'Expira', defaultHidden: true, sortValue: (g) => g.expiresAt, csv: (g) => date(g.expiresAt), cell: (g) => <span className="text-[13px] text-fg-2">{date(g.expiresAt)}</span> },
    {
      id: 'status',
      header: 'Status',
      sortValue: (g) => g.live,
      csv: (g) => GRANT_STATUS_LABEL[g.live],
      cell: (g) => (
        <Badge tone={GRANT_TONE[g.live]} dot>
          {GRANT_STATUS_LABEL[g.live]}
        </Badge>
      ),
    },
  ]

  return (
    <>
      <DataTable
        className="relative"
        caption="Concessões de free spins"
        rows={visible}
        columns={columns}
        rowKey={(g) => g.id}
        searchText={(g) => `${g.id} ${g.playerName} ${g.playerId} ${g.playerEmail} ${g.campaignName}`}
        searchPlaceholder="Buscar jogador, ID ou e-mail"
        initialSort={{ id: 'grantedAt', dir: 'desc' }}
        exportName="free-spins-concessoes"
        onExport={(n) => audit('exportar', 'Free spins', `Exportação CSV de ${n} concessões`)}
        onRowClick={(g) => setOpenId(g.id)}
        resetKey={`${filter}-${campaignId}`}
        toolbar={
          <>
            <ChipFilter
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'todas', label: 'Todas', count: byCampaign.length },
                { value: 'ativa', label: 'Em uso', count: count('ativa') },
                { value: 'concluida', label: 'Concluídas', count: count('concluida') },
                { value: 'expirada', label: 'Expiradas', count: count('expirada') },
                { value: 'cancelada', label: 'Canceladas', count: count('cancelada'), tone: 'danger' },
              ]}
            />
            <Select
              aria-label="Filtrar por campanha"
              className="w-full sm:w-56"
              value={campaignId}
              onChange={setCampaignId}
              options={[{ value: 'todas', label: 'Todas as campanhas' }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))]}
            />
          </>
        }
        empty={{
          title: 'Nenhuma concessão neste filtro',
          description: 'Troque o status ou a campanha. Para dar giros a um jogador, use "Conceder manualmente".',
          icon: Gift,
          action: canEdit ? (
            <Button size="sm" icon={Gift} onClick={onGrant}>
              Conceder manualmente
            </Button>
          ) : undefined,
        }}
      />
      {open && (
        <Drawer
          open
          onClose={() => setOpenId(null)}
          title={`Concessão ${open.id}`}
          description={`${open.campaignName} · ${relative(open.grantedAt)}`}
          headerExtra={
            <Badge tone={GRANT_TONE[open.live]} dot size="md">
              {GRANT_STATUS_LABEL[open.live]}
            </Badge>
          }
          footer={
            open.live === 'ativa' ? (
              <Button
                variant="danger"
                icon={Ban}
                disabled={!canEdit}
                onClick={async () => {
                  if (await onCancel(open)) setOpenId(null)
                }}
              >
                Cancelar giros restantes
              </Button>
            ) : undefined
          }
        >
          <div className="space-y-6">
            <div className="flex items-center gap-4 rounded-xl bg-surface-2 p-4">
              <GameTile game={games.find((g) => g.id === open.gameId)} size={52} className="rounded-xl" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-fg-3">{gameName(open.gameId)}</p>
                <p className="font-display text-2xl font-bold text-fg tnum">
                  {num(open.used)} de {num(open.spins)} giros
                </p>
                <Progress value={open.used} max={open.spins} tone={open.used >= open.spins ? 'success' : 'primary'} className="mt-2" label="Giros usados" />
              </div>
            </div>
            <section>
              <h3 className="mb-3 text-sm font-semibold text-fg">Jogador</h3>
              <PersonCell name={open.playerName} sub={`ID ${open.playerId} · ${maskEmail(open.playerEmail)}`} />
            </section>
            <DescriptionList
              items={[
                { label: 'Valor por giro', value: brl(open.spinValue) },
                { label: 'Valor total', value: brl(open.spins * open.spinValue) },
                { label: 'Ganho nos giros', value: brl(open.winnings) },
                { label: 'Retorno', value: pct(open.used ? open.winnings / (open.used * open.spinValue) : 0, 0) },
                { label: 'Concedido em', value: dateTime(open.grantedAt) },
                { label: 'Expira em', value: `${dateTime(open.expiresAt)} · ${new Date(open.expiresAt).getTime() > Date.now() ? 'faltam ' + Math.ceil((new Date(open.expiresAt).getTime() - Date.now()) / 86_400_000) + ' dias' : 'vencido'}` },
                { label: 'Origem', value: open.origin === 'manual' ? `Manual, por ${open.grantedBy ?? '—'}` : 'Automática (gatilho da campanha)' },
                ...(open.note ? [{ label: 'Observação', value: open.note, full: true }] : []),
              ]}
            />
            {open.winnings > open.spins * open.spinValue * 2 && (
              <Alert tone="warning" title="Ganho acima de 2x o valor dos giros">
                Confira o rollover antes de liberar saque desse ganho.
              </Alert>
            )}
          </div>
        </Drawer>
      )}
    </>
  )
}

// ---------- Formulário de campanha ----------

function CampaignDrawer({
  initial,
  others,
  canEdit,
  onClose,
  onSave,
}: {
  initial: FreeSpinCampaign
  others: FreeSpinCampaign[]
  canEdit: boolean
  onClose: () => void
  onSave: (c: FreeSpinCampaign) => void
}) {
  const { items: games } = useGames()
  const { items: providers } = useProviders()
  const { items: players } = usePlayers()
  const [c, setC] = useState<FreeSpinCampaign>(initial)
  const [touched, setTouched] = useState(false)
  const game = games.find((g) => g.id === c.gameId)
  const errs = validateFsCampaign(c, game, others)
  const err = (k: string) => (touched ? (errs[k] ?? null) : null)
  const set = <K extends keyof FreeSpinCampaign>(k: K, v: FreeSpinCampaign[K]) => setC((p) => ({ ...p, [k]: v }))
  const est = fsEstimate(c, game?.rtp ?? 96)
  const suggestion = fsEligibleSuggestion(c, players)
  const dirty = JSON.stringify(c) !== JSON.stringify(initial)
  const conflicts = fsConflicts(c, others)

  const submit = () => {
    setTouched(true)
    if (Object.keys(errs).length) {
      toast.error('Revise os campos', { description: Object.values(errs)[0] })
      return
    }
    onSave(c)
  }
  const close = async () => {
    if (dirty && !(await confirm({ title: 'Descartar alterações?', description: 'O que você preencheu será perdido.', confirmLabel: 'Descartar', tone: 'danger' }))) return
    onClose()
  }

  return (
    <Drawer
      open
      onClose={close}
      width="xl"
      title={c.id ? `Editar: ${initial.name}` : initial.name ? 'Duplicar campanha' : 'Nova campanha de giros'}
      description="Gatilho, jogo e valor dos giros. O custo é estimado ao lado."
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" icon={Sparkles} onClick={submit} disabled={!canEdit}>
            {c.id ? 'Salvar campanha' : 'Criar campanha'}
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_270px]">
        <FormFieldset readOnly={!canEdit} className="min-w-0">
          <Field label="Nome da campanha" htmlFor="fs-name" required error={err('name')}>
            <Input id="fs-name" value={c.name} maxLength={60} onChange={(e) => set('name', e.target.value)} invalid={!!err('name')} placeholder="Ex.: 100 giros no 2º depósito" data-autofocus />
          </Field>
          <Field label="Gatilho">
            <RadioCards
              name="Gatilho"
              value={c.trigger}
              onChange={(t) => set('trigger', t)}
              options={(Object.keys(FS_TRIGGER_LABEL) as FsTrigger[]).map((t) => ({ value: t, label: FS_TRIGGER_LABEL[t], description: FS_TRIGGER_DESCRIPTION[t], icon: TRIGGER_ICON[t] }))}
            />
          </Field>
          {c.trigger === 'deposito' && (
            <FormGrid>
              <Field label="Nº do depósito" htmlFor="fs-depn" error={err('depositNumber')} hint={`Libera no ${c.depositNumber}º depósito pago.`}>
                <NumberInput id="fs-depn" value={c.depositNumber} min={1} max={20} suffix="º dep." onValueChange={(n) => set('depositNumber', Math.round(n))} invalid={!!err('depositNumber')} />
              </Field>
              <Field label="Depósito mínimo" htmlFor="fs-min" error={err('minDeposit')}>
                <MoneyInput id="fs-min" value={c.minDeposit} onValueChange={(n) => set('minDeposit', n)} invalid={!!err('minDeposit')} />
              </Field>
            </FormGrid>
          )}
          {c.trigger === 'cupom' && (
            <Field label="Código do cupom" htmlFor="fs-code" error={err('couponCode')} hint="O jogador digita no depósito ou na área de bônus.">
              <Input id="fs-code" value={c.couponCode} maxLength={16} onChange={(e) => set('couponCode', e.target.value.toUpperCase().replace(/\s/g, ''))} invalid={!!err('couponCode')} className="font-mono uppercase" placeholder="GIROS50" />
            </Field>
          )}
          {c.trigger === 'manual' && <Alert tone="info">Campanha manual: os giros só saem pelo botão “Conceder manualmente”, com motivo registrado na auditoria.</Alert>}
          {conflicts.length > 0 && (
            <Alert tone="warning" title="Outra campanha usa o mesmo depósito">
              “{conflicts[0].name}” também libera giros no {c.depositNumber}º depósito. O jogador receberia as duas.
            </Alert>
          )}
          <Field label="Jogo" htmlFor="fs-game" required error={err('gameId')} hint={game ? `Aposta mínima ${brl(game.minBet)} · RTP ${game.rtp.toLocaleString('pt-BR')}%` : 'Só slots ativos aceitam giros grátis.'}>
            <GamePicker id="fs-game" value={c.gameId || null} onChange={(g) => set('gameId', g)} games={games} providers={providers} invalid={!!err('gameId')} filter={(g) => g.category === 'slots' && g.active} emptyHint="Nenhum slot ativo com esse nome." />
          </Field>
          <FormGrid>
            <Field label="Quantidade de giros" htmlFor="fs-spins" required error={err('spins')}>
              <NumberInput id="fs-spins" value={c.spins} min={1} max={1000} suffix="giros" onValueChange={(n) => set('spins', Math.round(n))} invalid={!!err('spins')} />
            </Field>
            <Field label="Valor por giro" htmlFor="fs-value" required error={err('spinValue')}>
              <MoneyInput id="fs-value" value={c.spinValue} step={0.1} onValueChange={(n) => set('spinValue', n)} invalid={!!err('spinValue')} />
            </Field>
            <Field label="Validade" htmlFor="fs-valid" error={err('validityDays')} hint="Dias para usar depois de receber.">
              <NumberInput id="fs-valid" value={c.validityDays} min={1} max={60} suffix="dias" onValueChange={(n) => set('validityDays', Math.round(n))} invalid={!!err('validityDays')} />
            </Field>
            <Field label="Rollover dos ganhos" htmlFor="fs-roll" error={err('winRollover')} hint="O ganho vira bônus e precisa ser apostado N vezes.">
              <NumberInput id="fs-roll" value={c.winRollover} min={0} max={100} step={0.5} suffix="x" onValueChange={(n) => set('winRollover', n)} invalid={!!err('winRollover')} />
            </Field>
            <Field label="Limite por jogador" htmlFor="fs-limit" error={err('maxPerPlayer')}>
              <NumberInput id="fs-limit" value={c.maxPerPlayer} min={1} suffix="vezes" onValueChange={(n) => set('maxPerPlayer', Math.round(n))} invalid={!!err('maxPerPlayer')} />
            </Field>
          </FormGrid>
          <FormGrid>
            <Field label="Início" htmlFor="fs-start">
              <Input id="fs-start" type="date" value={toDateInput(c.startAt)} onChange={(e) => set('startAt', fromDateInput(e.target.value) ?? c.startAt)} />
            </Field>
            <Field label="Término" htmlFor="fs-end" error={err('endAt')} hint={c.endAt ? undefined : 'Vazio = sem término.'}>
              <Input id="fs-end" type="date" value={toDateInput(c.endAt)} min={toDateInput(c.startAt)} onChange={(e) => set('endAt', fromDateInput(e.target.value, true))} invalid={!!err('endAt')} />
            </Field>
          </FormGrid>
        </FormFieldset>

        <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
          <div className="rounded-xl border border-line p-4">
            <div className="mb-3 flex items-center gap-3">
              <GameTile game={game} size={40} className="rounded-xl" />
              <div className="min-w-0">
                <p className="text-xs text-fg-3">Custo da campanha</p>
                <p className="truncate text-sm font-semibold text-fg">{game?.name ?? 'Escolha o jogo'}</p>
              </div>
            </div>
            <CalcLine label="Giros por jogador" value={`${num(c.spins)} × ${brl(c.spinValue)}`} />
            <CalcLine label="Valor por jogador" value={brl(fsValuePerPlayer(c))} />
            <CalcLine label={`Custo esperado (RTP ${game?.rtp.toLocaleString('pt-BR') ?? '96'}%)`} value={brl(est.expectedPerPlayer)} />
            <CalcLine label="Apostar para sacar o ganho" value={brl(est.wagerToWithdraw)} />
            <div className="mt-3 border-t border-line pt-3">
              <FormFieldset readOnly={!canEdit}>
                <Field label="Jogadores estimados" htmlFor="fs-est" error={err('estimatedPlayers')} hint={suggestion?.text}>
                  <NumberInput id="fs-est" value={c.estimatedPlayers} min={0} suffix="jogadores" onValueChange={(n) => set('estimatedPlayers', Math.round(n))} />
                </Field>
              </FormFieldset>
              {suggestion && suggestion.count !== c.estimatedPlayers && canEdit && (
                <button type="button" className="mt-1.5 text-xs font-semibold text-primary-text hover:underline" onClick={() => set('estimatedPlayers', suggestion.count)}>
                  Usar {num(suggestion.count)} jogadores
                </button>
              )}
            </div>
            <CalcLine label="Estimativa total" value={brl(est.expectedTotal)} strong />
            <p className="mt-1 text-[11px] leading-4 text-fg-3">
              Pior caso (todos usam tudo, {c.maxPerPlayer}x): <strong className="text-fg-2">{brl(est.ceilingTotal)}</strong>
            </p>
          </div>
          <div className="rounded-xl bg-surface-2 p-3 text-xs leading-5 text-fg-2">
            O ganho dos giros entra como <strong className="text-fg">saldo bônus</strong> e segue as regras de{' '}
            <a href="#/campanhas/saldo-bonus" className="link">
              Saldo bônus
            </a>{' '}
            e{' '}
            <a href="#/campanhas/rollover" className="link">
              Rollover
            </a>
            .
          </div>
        </aside>
      </div>
    </Drawer>
  )
}

// ---------- Concessão manual ----------

function GrantModal({
  campaignId,
  campaigns,
  grants,
  onClose,
  onGrant,
}: {
  campaignId: string | null
  campaigns: CampaignRow[]
  grants: FreeSpinGrant[]
  onClose: () => void
  onGrant: (p: Player, c: FreeSpinCampaign, spins: number, note: string) => void
}) {
  const { items: players } = usePlayers()
  const { items: games } = useGames()
  const options = campaigns.filter((c) => c.status !== 'encerrada')
  const [player, setPlayer] = useState<Player | null>(null)
  const [cid, setCid] = useState(campaignId ?? options.find((c) => c.status === 'ativa')?.id ?? options[0]?.id ?? '')
  const campaign = campaigns.find((c) => c.id === cid)
  const [spins, setSpins] = useState(campaign?.spins ?? 50)
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const check = canGrant(player, campaign, grants, spins)
  const noteError = touched && note.trim().length < 5 ? 'Explique o motivo (mínimo 5 caracteres).' : null
  const game = games.find((g) => g.id === campaign?.gameId)
  const history = player ? grants.filter((g) => g.playerId === player.id) : []

  const submit = () => {
    setTouched(true)
    if (!check.ok || note.trim().length < 5 || !player || !campaign) return
    onGrant(player, campaign, spins, note.trim())
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Conceder free spins"
      description="Crédito manual de giros. Fica registrado na auditoria com o motivo."
      icon={Gift}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" icon={Gift} onClick={submit} disabled={!player || !campaign}>
            Conceder {num(spins)} giros
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Jogador" htmlFor="gr-player" required hint="Busque por ID, e-mail ou nome.">
          <PlayerFinder id="gr-player" players={players} value={player} onChange={setPlayer} />
        </Field>
        {player && history.length > 0 && <p className="-mt-2 text-xs text-fg-3">Este jogador já recebeu giros {history.length} {history.length === 1 ? 'vez' : 'vezes'}; a última {relative(history[0].grantedAt)}.</p>}
        {!options.length ? (
          <Alert tone="warning">Nenhuma campanha ativa ou pausada. Crie uma campanha (pode ser do tipo Manual) para conceder giros.</Alert>
        ) : (
          <FormGrid>
            <Field label="Campanha" htmlFor="gr-campaign" required>
              <Select
                id="gr-campaign"
                value={cid}
                onChange={(v) => {
                  setCid(v)
                  const nc = campaigns.find((c) => c.id === v)
                  if (nc) setSpins(nc.spins)
                }}
                options={options.map((c) => ({ value: c.id, label: `${c.name}${c.status !== 'ativa' ? ` (${FS_STATUS_LABEL[c.status].toLowerCase()})` : ''}` }))}
              />
            </Field>
            <Field label="Giros" htmlFor="gr-spins" required>
              <NumberInput id="gr-spins" value={spins} min={1} max={1000} suffix="giros" onValueChange={(n) => setSpins(Math.round(n))} />
            </Field>
          </FormGrid>
        )}
        {campaign && (
          <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
            <GameTile game={game} size={40} className="rounded-xl" />
            <div className="min-w-0 flex-1 text-[13px]">
              <p className="font-medium text-fg">
                {num(spins)} giros de {brl(campaign.spinValue)} em {game?.name ?? '—'} = <span className="tnum">{brl(spins * campaign.spinValue)}</span>
              </p>
              <p className="text-xs text-fg-3">
                Valem por {campaign.validityDays} dias (até {date(new Date(Date.now() + campaign.validityDays * 86_400_000))}) · rollover dos ganhos {mult(campaign.winRollover)}
              </p>
            </div>
          </div>
        )}
        <Field label="Motivo" htmlFor="gr-note" required error={noteError} hint="Aparece na ficha da concessão e na auditoria.">
          <Textarea id="gr-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: compensação por instabilidade no jogo em 08/10" invalid={!!noteError} />
        </Field>
        {player && !check.ok && (
          <Alert tone="danger" title="Não é possível conceder">
            {check.reason}
          </Alert>
        )}
      </div>
    </Modal>
  )
}
