import { useEffect, useMemo, useState } from 'react'
import {
  Ban,
  Eye,
  IdCard,
  LockOpen,
  Mail,
  Network,
  ShieldAlert,
  ShieldBan,
  ShieldCheck,
  Smartphone,
  UserPlus,
  Wifi,
  type LucideIcon,
} from 'lucide-react'
import {
  Alert,
  Avatar,
  Badge,
  Button,
  ChipFilter,
  DataTable,
  DescriptionList,
  Drawer,
  EmptyState,
  Field,
  Formula,
  IconButton,
  Input,
  KpiCard,
  Modal,
  Mono,
  PageHeader,
  PersonCell,
  Progress,
  Select,
  Tabs,
  confirm,
  confirmWithInput,
  toast,
  useTabParam,
  type Column,
  type MenuEntry,
  type Tone,
} from '@/components/ui'
import { brl, brlCompact, date, dateTime, maskCpf, maskEmail, maskPhone, num, pct, plural, relative } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useCollection } from '@/lib/store'
import { uid } from '@/lib/random'
import { DAY, NOW } from '@/data/now'
import { useAffiliates, usePlayers } from '@/data/hooks'
import { KYC_LABEL, PLAYER_STATUS_LABEL, type Affiliate, type Player, type PlayerStatus } from '@/data/players'
import { SEGURANCA_KEYS, SIGNAL_SOURCE_LABEL, seedBlocks, seedBonusReceived, seedSignals, type Block, type LinkKind } from '@/data/seguranca'
import { audit, usePageAccess, useSession } from '@/domain/session'
import {
  LINK_LABEL,
  LINK_WEIGHT,
  REFERRAL_BURST,
  RISK_LABEL,
  RISK_THRESHOLDS,
  accountFlags,
  banPlan,
  buildIpRows,
  buildNetworks,
  isValidIp,
  networkIndex,
  simulateActiveIps,
  type AccountFlag,
  type AccountNetwork,
  type IpRow,
  type LinkEvidence,
  type NetworkRisk,
} from '@/domain/seguranca'

type Tab = 'redes' | 'ips' | 'bloqueios' | 'contas'
type RiskFilter = 'todos' | NetworkRisk

const RISK_TONE: Record<NetworkRisk, Tone> = { alto: 'danger', medio: 'warning', baixo: 'success' }
const STATUS_TONE: Record<PlayerStatus, Tone> = { ativo: 'success', bloqueado: 'danger', autoexcluido: 'neutral', pausa: 'warning' }
const NET_STATUS: Record<AccountNetwork['status'], { label: string; tone: Tone }> = {
  ativa: { label: 'Ativa', tone: 'warning' },
  parcial: { label: 'Parcialmente banida', tone: 'info' },
  banida: { label: 'Banida', tone: 'neutral' },
}
const LINK_ICON: Record<LinkKind, LucideIcon> = { ip: Wifi, padrinho: UserPlus, email: Mail, cpf: IdCard, celular: Smartphone }

const IP_REASONS = [
  'Várias contas com bônus no mesmo IP',
  'Tráfego de robô',
  'Rede Tor, VPN ou proxy',
  'Tentativas de login em série',
  'Chargeback ou fraude de pagamento',
  'Outro motivo',
].map((r) => ({ value: r, label: r }))

const RECENT_MS = 30 * DAY

function LinkBadges({ kinds, size = 'sm' }: { kinds: LinkKind[]; size?: 'sm' | 'md' }) {
  return (
    <span className="flex flex-wrap gap-1">
      {kinds.map((k) => (
        <Badge key={k} tone={LINK_WEIGHT[k] >= 20 ? 'danger' : 'neutral'} icon={LINK_ICON[k]} size={size}>
          {LINK_LABEL[k]}
        </Badge>
      ))}
    </span>
  )
}

function FlagBadges({ flags }: { flags: AccountFlag[] }) {
  if (!flags.length) return <span className="text-xs text-fg-3">Nenhum</span>
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f.label} tone={f.tone}>
          {f.label}
        </Badge>
      ))}
    </span>
  )
}

function useActiveIps() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])
  return simulateActiveIps(now)
}

export default function Antifraude() {
  const [tab, setTab] = useTabParam<Tab>('redes', ['redes', 'ips', 'bloqueios', 'contas'] as const)
  const players = usePlayers()
  const { items: affiliates } = useAffiliates()
  const blocks = useCollection<Block>(SEGURANCA_KEYS.blocks, seedBlocks)
  const { can } = usePageAccess()
  const { user } = useSession()
  const canBan = can('antifraude.banir')
  const activeIps = useActiveIps()
  const [risk, setRisk] = useState<RiskFilter>('todos')
  const [openId, setOpenId] = useState<string | null>(null)
  const [blockModal, setBlockModal] = useState(false)

  const signals = seedSignals()
  const bonus = seedBonusReceived()
  const networks = useMemo(
    () => buildNetworks({ players: players.items, signals, affiliates, bonus, now: NOW.getTime() }),
    [players.items, signals, affiliates, bonus],
  )
  const netIdx = useMemo(() => networkIndex(networks), [networks])
  const ipRows = useMemo(() => buildIpRows(players.items, signals, blocks.items, netIdx), [players.items, signals, blocks.items, netIdx])
  const ipByValue = useMemo(() => new Map(ipRows.map((r) => [r.ip, r])), [ipRows])
  const blockedIps = useMemo(() => new Set(blocks.items.filter((b) => b.kind === 'ip').map((b) => b.value)), [blocks.items])
  const affById = useMemo(() => new Map(affiliates.map((a) => [a.id, a])), [affiliates])
  const recent = useMemo(() => players.items.filter((p) => NOW.getTime() - new Date(p.createdAt).getTime() < RECENT_MS), [players.items])
  const flagsOf = (p: Player) =>
    accountFlags(p, { network: netIdx.get(p.id), ipShared: (ipByValue.get(p.ip)?.playerIds.length ?? 0) > 1, ipBlocked: blockedIps.has(p.ip), bonus: bonus[p.id] ?? 0 })
  const recentFlagged = recent.filter((p) => flagsOf(p).some((f) => f.tone === 'danger' || f.tone === 'warning')).length

  const high = networks.filter((n) => n.level === 'alto' && n.status !== 'banida')
  const ipBlocks = blocks.items.filter((b) => b.kind === 'ip').length
  const openNet = openId ? networks.find((n) => n.id === openId) : undefined

  // ---------- ações ----------

  const denyBan = () => toast.error('Seu cargo não pode banir nem bloquear', { description: 'Peça a permissão "Banir redes e bloquear IPs" em Cargos e permissões.' })

  const banNetwork = async (n: AccountNetwork) => {
    if (!canBan) return denyBan()
    const members = n.playerIds.map((id) => players.get(id)).filter((p): p is Player => !!p)
    const { toBan, previous } = banPlan(members)
    if (!toBan.length) {
      toast.info('Todas as contas desta rede já estão bloqueadas')
      return
    }
    const r = await confirmWithInput({
      title: `Banir a rede ${n.id}?`,
      description: `${plural(toBan.length, 'conta é bloqueada', 'contas são bloqueadas')} na hora: não entram, não depositam, não jogam e não sacam. O saldo fica retido até a análise. Dá para desfazer na aba Bloqueios.`,
      confirmLabel: 'Banir rede inteira',
      tone: 'danger',
      icon: Ban,
      input: { label: 'Motivo', required: true, multiline: true, placeholder: 'Ex.: multicontas para abuso de bônus de boas-vindas' },
      typeToConfirm: 'BANIR',
      details: (
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge tone={RISK_TONE[n.level]} icon={ShieldAlert}>{`Risco ${RISK_LABEL[n.level].toLowerCase()} · ${n.score}`}</Badge>
            <LinkBadges kinds={n.kinds} />
          </div>
          <ul className="space-y-1 text-[13px] text-fg-2">
            {toBan.slice(0, 6).map((m) => (
              <li key={m.id} className="flex justify-between gap-3">
                <span className="truncate">{m.name}</span>
                <span className="shrink-0 text-fg-3 tnum">saldo {brl(m.balanceReal)}</span>
              </li>
            ))}
            {toBan.length > 6 && <li className="text-fg-3">e mais {toBan.length - 6}…</li>}
          </ul>
        </div>
      ),
    })
    if (!r.confirmed) return
    toBan.forEach((m) => players.update(m.id, { status: 'bloqueado' }))
    blocks.add({
      id: uid('bl-'),
      kind: 'rede',
      value: n.id,
      reason: r.value,
      accounts: toBan.map((m) => m.id),
      previousStatuses: previous,
      createdAt: new Date().toISOString(),
      createdBy: user.name,
    })
    audit('banir', `Rede ${n.id}`, `${toBan.length} contas banidas (${n.kinds.map((k) => LINK_LABEL[k]).join(', ')}). Motivo: ${r.value}`)
    toast.success('Rede banida', { description: `${plural(toBan.length, 'conta bloqueada', 'contas bloqueadas')}. O registro está na auditoria.` })
  }

  const blockIp = async (ip: string, accounts: string[], presetReason?: string) => {
    if (!canBan) return denyBan()
    if (blockedIps.has(ip)) {
      toast.info(`O IP ${ip} já está bloqueado`)
      return
    }
    const r = await confirmWithInput({
      title: `Bloquear o IP ${ip} no site?`,
      description: `Quem acessar deste IP vê "acesso bloqueado" e não consegue entrar, se cadastrar nem depositar.${accounts.length ? ` ${plural(accounts.length, 'conta usa', 'contas usam')} este IP; as contas não são banidas.` : ''}`,
      confirmLabel: 'Bloquear IP',
      tone: 'danger',
      icon: ShieldBan,
      input: { label: 'Motivo', required: true, options: IP_REASONS, defaultValue: presetReason },
    })
    if (!r.confirmed) return
    blocks.add({ id: uid('bl-'), kind: 'ip', value: ip, reason: r.value, accounts, previousStatuses: {}, createdAt: new Date().toISOString(), createdBy: user.name })
    audit('bloquear', `IP ${ip}`, `IP bloqueado no site (${accounts.length} contas). Motivo: ${r.value}`)
    toast.success('IP bloqueado', { description: `${ip} não acessa mais o site.` })
  }

  const unblock = async (b: Block) => {
    if (!canBan) return denyBan()
    const isNet = b.kind === 'rede'
    const restore = isNet ? b.accounts.filter((id) => players.get(id)?.status === 'bloqueado') : []
    const ok = await confirm({
      title: isNet ? `Desfazer o banimento da rede ${b.value}?` : `Desbloquear o IP ${b.value}?`,
      description: isNet
        ? `${plural(restore.length, 'conta volta', 'contas voltam')} ao status de antes do banimento e podem entrar, jogar e sacar de novo.`
        : 'Acessos deste IP voltam a ser aceitos no site.',
      confirmLabel: isNet ? 'Desfazer banimento' : 'Desbloquear IP',
      tone: 'warning',
      icon: LockOpen,
    })
    if (!ok) return
    restore.forEach((id) => players.update(id, { status: b.previousStatuses[id] ?? 'ativo' }))
    blocks.remove(b.id)
    audit('desbloquear', isNet ? `Bloqueio da rede ${b.value}` : `Bloqueio do IP ${b.value}`, isNet ? `Banimento desfeito: ${restore.length} contas reativadas` : 'IP desbloqueado no site')
    toast.success(isNet ? 'Banimento desfeito' : 'IP desbloqueado')
  }

  const counts = {
    todos: networks.length,
    alto: networks.filter((n) => n.level === 'alto').length,
    medio: networks.filter((n) => n.level === 'medio').length,
    baixo: networks.filter((n) => n.level === 'baixo').length,
  }

  return (
    <>
      <PageHeader>
        <Tabs
          className="mt-5"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'redes', label: 'Redes', icon: Network, count: networks.length },
            { value: 'ips', label: 'IPs', icon: Wifi, count: ipRows.filter((r) => r.playerIds.length > 1).length },
            { value: 'bloqueios', label: 'Bloqueios', icon: ShieldBan, count: blocks.items.length },
            { value: 'contas', label: 'Contas (últimos 30 dias)', icon: UserPlus, count: recent.length },
          ]}
        />
      </PageHeader>

      <section aria-label="Resumo do anti-fraude" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="IPs em uso agora"
          icon={Wifi}
          tone="info"
          value={num(activeIps)}
          hint={
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" aria-hidden /> sessões abertas no site agora
            </span>
          }
          formula={<>IPs distintos com sessão aberta no site agora (atualiza a cada 15 segundos). Um IP com muitas sessões ao mesmo tempo é sinal de robô.</>}
        />
        <KpiCard
          label="Bloqueios ativos"
          icon={ShieldBan}
          tone="danger"
          value={num(blocks.items.length)}
          hint={`${plural(ipBlocks, 'IP', 'IPs')} · ${plural(blocks.items.length - ipBlocks, 'rede', 'redes')}`}
          onClick={() => setTab('bloqueios')}
          active={tab === 'bloqueios'}
        />
        <KpiCard
          label="Redes de risco alto"
          icon={ShieldAlert}
          tone="warning"
          value={num(high.length)}
          hint={high.length ? `${num(high.reduce((s, n) => s + n.playerIds.length, 0))} contas · ${brlCompact(high.reduce((s, n) => s + n.totals.bonus, 0))} em bônus` : 'nenhuma rede ativa de risco alto'}
          onClick={() => {
            setTab('redes')
            setRisk('alto')
          }}
          active={tab === 'redes' && risk === 'alto'}
        />
        <KpiCard
          label="Contas novas (30 dias)"
          icon={UserPlus}
          tone="primary"
          value={num(recent.length)}
          hint={`${recentFlagged} com sinal de risco`}
          onClick={() => setTab('contas')}
          active={tab === 'contas'}
        />
      </section>

      {!canBan && (
        <Alert tone="info" className="mb-5" title="Você pode investigar, mas não banir">
          Banir redes e bloquear IPs exige a permissão "Banir redes e bloquear IPs" (Cargos e permissões).
        </Alert>
      )}

      {tab === 'redes' && (
        <NetworksTab
          networks={networks}
          risk={risk}
          setRisk={setRisk}
          counts={counts}
          players={players.items}
          canBan={canBan}
          blockedIps={blockedIps}
          onOpen={setOpenId}
          onBan={banNetwork}
          onBlockIp={(n) => {
            const ip = n.sharedIps.find((x) => !blockedIps.has(x))
            if (ip) blockIp(ip, ipByValue.get(ip)?.playerIds ?? [], 'Várias contas com bônus no mesmo IP')
          }}
        />
      )}
      {tab === 'ips' && <IpsTab rows={ipRows} players={players.items} networks={networks} canBan={canBan} onOpen={setOpenId} onBlock={blockIp} onUnblock={(ip) => {
        const b = blocks.items.find((x) => x.kind === 'ip' && x.value === ip)
        if (b) unblock(b)
      }} />}
      {tab === 'bloqueios' && <BlocksTab blocks={blocks.items} players={players.items} canBan={canBan} onUnblock={unblock} onNew={() => (canBan ? setBlockModal(true) : denyBan())} onOpen={setOpenId} networks={networks} />}
      {tab === 'contas' && <AccountsTab recent={recent} netIdx={netIdx} flagsOf={flagsOf} bonus={bonus} affById={affById} canBan={canBan} onOpen={setOpenId} onBlockIp={(p) => blockIp(p.ip, ipByValue.get(p.ip)?.playerIds ?? [p.id])} blockedIps={blockedIps} />}

      <NetworkDrawer
        n={openNet}
        onClose={() => setOpenId(null)}
        players={players.items}
        affById={affById}
        bonus={bonus}
        canBan={canBan}
        blockedIps={blockedIps}
        onBan={banNetwork}
        onBlockIp={(ip, ids) => blockIp(ip, ids, 'Várias contas com bônus no mesmo IP')}
      />

      <BlockIpModal
        open={blockModal}
        onClose={() => setBlockModal(false)}
        blocked={blockedIps}
        onConfirm={(ip, reason) => {
          const accounts = ipByValue.get(ip)?.playerIds ?? []
          blocks.add({ id: uid('bl-'), kind: 'ip', value: ip, reason, accounts, previousStatuses: {}, createdAt: new Date().toISOString(), createdBy: user.name })
          audit('bloquear', `IP ${ip}`, `IP bloqueado no site (${accounts.length} contas). Motivo: ${reason}`)
          toast.success('IP bloqueado', { description: `${ip} não acessa mais o site.` })
          setBlockModal(false)
        }}
      />
    </>
  )
}

// ---------- Aba Redes ----------

function AvatarStack({ ids, players }: { ids: string[]; players: Map<string, Player> }) {
  const shown = ids.slice(0, 4)
  return (
    <span className="flex items-center gap-2">
      <span className="flex -space-x-1.5">
        {shown.map((id) => (
          <span key={id} className="rounded-full bg-surface ring-2 ring-surface">
            <Avatar name={players.get(id)?.name ?? '?'} size={26} />
          </span>
        ))}
      </span>
      <span className="text-[13px] font-medium text-fg tnum">{ids.length}</span>
    </span>
  )
}

function NetworksTab({
  networks,
  risk,
  setRisk,
  counts,
  players,
  canBan,
  blockedIps,
  onOpen,
  onBan,
  onBlockIp,
}: {
  networks: AccountNetwork[]
  risk: RiskFilter
  setRisk: (r: RiskFilter) => void
  counts: Record<RiskFilter, number>
  players: Player[]
  canBan: boolean
  blockedIps: Set<string>
  onOpen: (id: string) => void
  onBan: (n: AccountNetwork) => void
  onBlockIp: (n: AccountNetwork) => void
}) {
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
  const rows = risk === 'todos' ? networks : networks.filter((n) => n.level === risk)
  const columns: Column<AccountNetwork>[] = [
    {
      id: 'id',
      header: 'Rede',
      pinned: true,
      sortValue: (n) => n.lastCreatedAt,
      csv: (n) => n.id,
      cell: (n) => (
        <div>
          <Mono className="font-medium text-fg">{n.id}</Mono>
          <p className="mt-0.5 text-xs text-fg-3">{n.firstCreatedAt.slice(0, 10) === n.lastCreatedAt.slice(0, 10) ? `criadas em ${date(n.firstCreatedAt)}` : `criadas de ${date(n.firstCreatedAt)} a ${date(n.lastCreatedAt)}`}</p>
        </div>
      ),
    },
    { id: 'contas', header: 'Contas', sortValue: (n) => n.playerIds.length, csv: (n) => n.playerIds.length, cell: (n) => <AvatarStack ids={n.playerIds} players={byId} /> },
    { id: 'links', header: 'Ligadas por', minWidth: 250, wrap: true, csv: (n) => n.kinds.map((k) => LINK_LABEL[k]).join(', '), cell: (n) => <LinkBadges kinds={n.kinds} /> },
    {
      id: 'mov',
      header: 'Depositado / sacado',
      align: 'right',
      sortValue: (n) => n.totals.deposited,
      csv: (n) => `${n.totals.deposited} / ${n.totals.withdrawn}`,
      cell: (n) => (
        <div className="text-right tnum">
          <p className="text-[13px] font-medium text-fg">{brl(n.totals.deposited)}</p>
          <p className="text-xs text-fg-3">sacou {brl(n.totals.withdrawn)}</p>
        </div>
      ),
    },
    {
      id: 'bonus',
      header: 'Bônus recebido',
      align: 'right',
      sortValue: (n) => n.totals.bonus,
      csv: (n) => n.totals.bonus,
      cell: (n) => (
        <div className="text-right tnum">
          <p className="text-[13px] font-medium text-fg">{brl(n.totals.bonus)}</p>
          <p className={cn('text-xs', n.totals.bonus >= n.totals.deposited * 0.5 ? 'font-semibold text-danger' : 'text-fg-3')}>
            {n.totals.deposited ? `${pct(n.totals.bonus / n.totals.deposited, 0)} do depósito` : 'sem depósito'}
          </p>
        </div>
      ),
    },
    {
      id: 'risk',
      header: 'Risco',
      sortValue: (n) => n.score,
      csv: (n) => `${RISK_LABEL[n.level]} (${n.score})`,
      cell: (n) => (
        <span className="inline-flex items-center gap-1.5">
          <Badge tone={RISK_TONE[n.level]} icon={n.level === 'alto' ? ShieldAlert : undefined}>
            {RISK_LABEL[n.level]}
          </Badge>
          <span className="text-xs text-fg-3 tnum">{n.score}</span>
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Situação',
      sortValue: (n) => n.status,
      csv: (n) => NET_STATUS[n.status].label,
      cell: (n) => (
        <Badge tone={NET_STATUS[n.status].tone} dot>
          {NET_STATUS[n.status].label}
        </Badge>
      ),
    },
  ]

  return (
    // o cabeçalho "Ações" do DataTable tem um texto sr-only absoluto que escapa da rolagem
    // horizontal da tabela no celular; o recorte aqui evita a rolagem lateral da página
    <div className="relative overflow-x-clip">
    <DataTable
      caption="Redes de contas ligadas"
      rows={rows}
      columns={columns}
      rowKey={(n) => n.id}
      searchText={(n) => `${n.id} ${n.playerIds.map((id) => `${id} ${byId.get(id)?.name ?? ''}`).join(' ')} ${n.sharedIps.join(' ')}`}
      searchPlaceholder="Buscar por rede, conta, ID ou IP"
      initialSort={{ id: 'risk', dir: 'desc' }}
      exportName="redes-antifraude"
      onExport={(c) => audit('exportar', 'Anti-fraude', `Exportação CSV de ${c} redes`)}
      onRowClick={(n) => onOpen(n.id)}
      resetKey={risk}
      rowClassName={(n) => (n.level === 'alto' && n.status !== 'banida' ? 'bg-danger/[0.03]' : undefined)}
      toolbar={
        <ChipFilter<RiskFilter>
          value={risk}
          onChange={setRisk}
          options={[
            { value: 'todos', label: 'Todos', count: counts.todos },
            { value: 'alto', label: 'Risco alto', count: counts.alto, tone: 'danger' },
            { value: 'medio', label: 'Médio', count: counts.medio, tone: 'warning' },
            { value: 'baixo', label: 'Baixo', count: counts.baixo },
          ]}
          className="max-w-full"
        />
      }
      toolbarRight={
        <Formula title="Como a rede e o risco são calculados">
          <p>
            Contas com o <strong>mesmo IP, e-mail, CPF ou celular</strong> (no cadastro, no login, no PIX ou na verificação por SMS) formam uma rede. E-mails do Gmail com pontos ou +apelido contam como o mesmo.
          </p>
          <p className="mt-2">
            <strong>Mesmo padrinho</strong> sozinho não forma rede: conta quando as contas já estão ligadas, quando o próprio padrinho está na rede ou quando {REFERRAL_BURST.accounts}+ indicados se cadastram em até {REFERRAL_BURST.hours} h.
          </p>
          <p className="mt-2">
            Pontos: CPF 30, celular 20, e-mail 20, IP 10, padrinho 10; +5 por conta além de 2; bônus ≥ 50% do depositado +15; saque rápido +10; contas novas +10. Alto a partir de {RISK_THRESHOLDS.alto}, médio a partir de {RISK_THRESHOLDS.medio}.
          </p>
        </Formula>
      }
      rowActions={(n): MenuEntry[] => [
        { label: 'Ver contas da rede', icon: Eye, onSelect: () => onOpen(n.id) },
        {
          label: 'Bloquear IP no site',
          icon: ShieldBan,
          disabled: !canBan || !n.sharedIps.some((ip) => !blockedIps.has(ip)),
          onSelect: () => onBlockIp(n),
        },
        { divider: true },
        { label: 'Banir rede inteira', icon: Ban, danger: true, disabled: !canBan || n.status === 'banida', onSelect: () => onBan(n) },
      ]}
      empty={{ title: 'Nenhuma rede neste filtro', description: 'Troque o nível de risco para ver outras redes.', icon: ShieldCheck }}
    />
    </div>
  )
}

// ---------- Aba IPs ----------

type IpFilter = 'compartilhados' | 'bloqueados' | 'todos'

function IpsTab({
  rows,
  players,
  networks,
  canBan,
  onOpen,
  onBlock,
  onUnblock,
}: {
  rows: IpRow[]
  players: Player[]
  networks: AccountNetwork[]
  canBan: boolean
  onOpen: (id: string) => void
  onBlock: (ip: string, accounts: string[]) => void
  onUnblock: (ip: string) => void
}) {
  const [filter, setFilter] = useState<IpFilter>('compartilhados')
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
  const netById = useMemo(() => new Map(networks.map((n) => [n.id, n])), [networks])
  const shared = rows.filter((r) => r.playerIds.length > 1)
  const blocked = rows.filter((r) => r.blocked)
  const list = filter === 'compartilhados' ? shared : filter === 'bloqueados' ? blocked : rows
  const columns: Column<IpRow>[] = [
    {
      id: 'ip',
      header: 'IP',
      pinned: true,
      sortValue: (r) => r.ip,
      cell: (r) => (
        <div>
          <Mono className="font-medium text-fg">{r.ip}</Mono>
          <p className="mt-0.5 text-xs text-fg-3">{r.sources.length ? `visto em ${r.sources.map((s) => SIGNAL_SOURCE_LABEL[s]).join(', ')}` : 'bloqueio manual'}</p>
        </div>
      ),
    },
    {
      id: 'contas',
      header: 'Contas',
      minWidth: 200,
      sortValue: (r) => r.playerIds.length,
      csv: (r) => r.playerIds.length,
      cell: (r) =>
        r.playerIds.length ? (
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-fg">{plural(r.playerIds.length, 'conta', 'contas')}</p>
            <p className="max-w-[240px] truncate text-xs text-fg-3">{r.playerIds.map((id) => byId.get(id)?.name).filter(Boolean).join(', ')}</p>
          </div>
        ) : (
          <span className="text-xs text-fg-3">Nenhuma conta</span>
        ),
    },
    { id: 'local', header: 'Local', sortValue: (r) => r.city, cell: (r) => <span className="text-[13px] text-fg-2">{r.city}</span> },
    { id: 'seen', header: 'Último acesso', sortValue: (r) => r.lastSeen, csv: (r) => dateTime(r.lastSeen), cell: (r) => <span className="whitespace-nowrap text-[13px] text-fg-2">{relative(r.lastSeen)}</span> },
    {
      id: 'rede',
      header: 'Rede',
      sortValue: (r) => (r.networkId ? netById.get(r.networkId)?.score ?? 0 : -1),
      csv: (r) => r.networkId ?? '',
      cell: (r) => {
        const n = r.networkId ? netById.get(r.networkId) : undefined
        if (!n) return <span className="text-xs text-fg-3">—</span>
        return (
          <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(n.id) }} className="inline-flex items-center gap-1.5 text-left">
            <Mono className="text-primary-text underline-offset-2 hover:underline">{n.id}</Mono>
            <Badge tone={RISK_TONE[n.level]}>{RISK_LABEL[n.level]}</Badge>
          </button>
        )
      },
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (r) => Number(r.blocked),
      csv: (r) => (r.blocked ? 'Bloqueado' : 'Liberado'),
      cell: (r) => (
        <Badge tone={r.blocked ? 'danger' : 'success'} dot>
          {r.blocked ? 'Bloqueado' : 'Liberado'}
        </Badge>
      ),
    },
    {
      id: 'acao',
      header: 'Ação',
      pinned: true,
      csv: () => '',
      cell: (r) => (
        <span onClick={(e) => e.stopPropagation()}>
          {r.blocked ? (
            <Button size="sm" icon={LockOpen} onClick={() => onUnblock(r.ip)} disabled={!canBan} title={!canBan ? 'Seu cargo não desbloqueia IPs' : undefined}>
              Desbloquear
            </Button>
          ) : (
            <Button size="sm" icon={ShieldBan} className="text-danger" onClick={() => onBlock(r.ip, r.playerIds)} disabled={!canBan} title={!canBan ? 'Seu cargo não bloqueia IPs' : undefined}>
              Bloquear IP
            </Button>
          )}
        </span>
      ),
    },
  ]
  return (
    <DataTable
      caption="IPs usados pelas contas"
      rows={list}
      columns={columns}
      rowKey={(r) => r.ip}
      searchText={(r) => `${r.ip} ${r.city} ${r.playerIds.map((id) => byId.get(id)?.name ?? '').join(' ')}`}
      searchPlaceholder="Buscar por IP, cidade ou conta"
      initialSort={{ id: 'contas', dir: 'desc' }}
      exportName="ips-antifraude"
      onExport={(c) => audit('exportar', 'Anti-fraude', `Exportação CSV de ${c} IPs`)}
      onRowClick={(r) => r.networkId && onOpen(r.networkId)}
      resetKey={filter}
      rowClassName={(r) => (r.blocked ? 'bg-danger/[0.03]' : undefined)}
      toolbar={
        <ChipFilter<IpFilter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'compartilhados', label: 'Usados por 2+ contas', count: shared.length, tone: 'warning' },
            { value: 'bloqueados', label: 'Bloqueados', count: blocked.length, tone: 'danger' },
            { value: 'todos', label: 'Todos', count: rows.length },
          ]}
          className="max-w-full"
        />
      }
      empty={{ title: 'Nenhum IP neste filtro', description: 'Troque o filtro para ver outros IPs.', icon: Wifi }}
    />
  )
}

// ---------- Aba Bloqueios ----------

function BlocksTab({
  blocks,
  players,
  networks,
  canBan,
  onUnblock,
  onNew,
  onOpen,
}: {
  blocks: Block[]
  players: Player[]
  networks: AccountNetwork[]
  canBan: boolean
  onUnblock: (b: Block) => void
  onNew: () => void
  onOpen: (id: string) => void
}) {
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
  const netIds = new Set(networks.map((n) => n.id))
  const columns: Column<Block>[] = [
    {
      id: 'tipo',
      header: 'Bloqueio',
      pinned: true,
      sortValue: (b) => b.kind,
      csv: (b) => `${b.kind === 'ip' ? 'IP' : 'Rede'} ${b.value}`,
      cell: (b) => (
        <div className="flex items-center gap-2.5">
          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', b.kind === 'ip' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning')}>
            {b.kind === 'ip' ? <Wifi size={15} aria-hidden /> : <Network size={15} aria-hidden />}
          </span>
          <div>
            <Mono className="font-medium text-fg">{b.value}</Mono>
            <p className="text-xs text-fg-3">{b.kind === 'ip' ? 'IP bloqueado no site' : 'Rede banida'}</p>
          </div>
        </div>
      ),
    },
    { id: 'motivo', header: 'Motivo', minWidth: 200, wrap: true, sortValue: (b) => b.reason, cell: (b) => <span className="text-[13px] text-fg-2">{b.reason}</span> },
    {
      id: 'contas',
      header: 'Contas atingidas',
      sortValue: (b) => b.accounts.length,
      csv: (b) => b.accounts.length,
      cell: (b) =>
        b.accounts.length ? (
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-fg">{plural(b.accounts.length, 'conta', 'contas')}</p>
            <p className="max-w-[220px] truncate text-xs text-fg-3">{b.accounts.map((id) => byId.get(id)?.name).filter(Boolean).join(', ')}</p>
          </div>
        ) : (
          <span className="text-xs text-fg-3">Nenhuma conta</span>
        ),
    },
    { id: 'por', header: 'Bloqueado por', sortValue: (b) => b.createdBy, cell: (b) => <PersonCell name={b.createdBy} /> },
    {
      id: 'quando',
      header: 'Desde',
      sortValue: (b) => b.createdAt,
      csv: (b) => dateTime(b.createdAt),
      cell: (b) => (
        <div className="whitespace-nowrap">
          <p className="text-[13px] text-fg-2">{dateTime(b.createdAt)}</p>
          <p className="text-xs text-fg-3">{relative(b.createdAt)}</p>
        </div>
      ),
    },
    {
      id: 'acao',
      header: 'Ação',
      pinned: true,
      csv: () => '',
      cell: (b) => (
        <span className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
          {b.kind === 'rede' && netIds.has(b.value) && <IconButton icon={Eye} label={`Ver rede ${b.value}`} size="sm" onClick={() => onOpen(b.value)} />}
          <Button size="sm" icon={LockOpen} onClick={() => onUnblock(b)} disabled={!canBan} title={!canBan ? 'Seu cargo não desbloqueia' : b.kind === 'rede' ? 'Desfazer o banimento da rede' : undefined}>
            {b.kind === 'ip' ? 'Desbloquear' : 'Desfazer'}
          </Button>
        </span>
      ),
    },
  ]
  return (
    <DataTable
      caption="Bloqueios ativos"
      rows={blocks}
      columns={columns}
      rowKey={(b) => b.id}
      searchText={(b) => `${b.value} ${b.reason} ${b.createdBy}`}
      searchPlaceholder="Buscar por IP, rede ou motivo"
      initialSort={{ id: 'quando', dir: 'desc' }}
      exportName="bloqueios-antifraude"
      onExport={(c) => audit('exportar', 'Anti-fraude', `Exportação CSV de ${c} bloqueios`)}
      toolbarRight={
        <Button variant="primary" size="sm" icon={ShieldBan} onClick={onNew} disabled={!canBan} title={!canBan ? 'Seu cargo não bloqueia IPs' : undefined} className="h-9">
          Bloquear IP
        </Button>
      }
      empty={{
        title: 'Nenhum bloqueio ativo',
        description: 'IPs bloqueados e redes banidas aparecem aqui, com quem bloqueou e o motivo.',
        icon: ShieldCheck,
      }}
    />
  )
}

function BlockIpModal({ open, onClose, onConfirm, blocked }: { open: boolean; onClose: () => void; onConfirm: (ip: string, reason: string) => void; blocked: Set<string> }) {
  const [ip, setIp] = useState('')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const ipErr = !ip.trim() ? 'Informe o IP.' : !isValidIp(ip) ? 'IP inválido. Use o formato 189.45.12.207 ou uma faixa 189.45.12.0/24.' : blocked.has(ip.trim()) ? 'Este IP já está bloqueado.' : null
  const reasonErr = !reason ? 'Escolha o motivo.' : null
  const close = () => {
    setIp('')
    setReason('')
    setTouched(false)
    onClose()
  }
  const submit = () => {
    setTouched(true)
    if (ipErr || reasonErr) return
    onConfirm(ip.trim(), reason)
    setIp('')
    setReason('')
    setTouched(false)
  }
  return (
    <Modal
      open={open}
      onClose={close}
      title="Bloquear IP no site"
      description="Quem acessar deste IP vê “acesso bloqueado”. As contas que usam o IP não são banidas."
      icon={ShieldBan}
      iconTone="danger"
      size="sm"
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="danger" icon={ShieldBan} onClick={submit}>
            Bloquear IP
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label="IP ou faixa" htmlFor="blk-ip" required error={touched ? ipErr : null} hint="IPv4, com faixa CIDR opcional (/8 a /32).">
          <Input id="blk-ip" data-autofocus value={ip} onChange={(e) => setIp(e.target.value)} placeholder="189.45.12.207" className="font-mono" invalid={touched && !!ipErr} autoComplete="off" />
        </Field>
        <Field label="Motivo" htmlFor="blk-reason" required error={touched ? reasonErr : null}>
          <Select id="blk-reason" value={reason} onChange={setReason} options={IP_REASONS} placeholder="Selecione" />
        </Field>
      </form>
    </Modal>
  )
}

// ---------- Aba Contas (últimos 30 dias) ----------

type AccountFilter = 'todas' | 'sinais' | 'rede' | 'limpas'

function AccountsTab({
  recent,
  netIdx,
  flagsOf,
  bonus,
  affById,
  canBan,
  onOpen,
  onBlockIp,
  blockedIps,
}: {
  recent: Player[]
  netIdx: Map<string, AccountNetwork>
  flagsOf: (p: Player) => AccountFlag[]
  bonus: Record<string, number>
  affById: Map<string, Affiliate>
  canBan: boolean
  onOpen: (id: string) => void
  onBlockIp: (p: Player) => void
  blockedIps: Set<string>
}) {
  const [filter, setFilter] = useState<AccountFilter>('todas')
  const enriched = useMemo(() => recent.map((p) => ({ p, flags: flagsOf(p), net: netIdx.get(p.id) })), [recent, flagsOf, netIdx])
  const risky = (f: AccountFlag[]) => f.some((x) => x.tone === 'danger' || x.tone === 'warning')
  const rows = enriched.filter((r) => (filter === 'sinais' ? risky(r.flags) : filter === 'rede' ? !!r.net : filter === 'limpas' ? !risky(r.flags) : true))
  type Row = (typeof enriched)[number]
  const columns: Column<Row>[] = [
    {
      id: 'conta',
      header: 'Conta',
      pinned: true,
      minWidth: 210,
      sortValue: (r) => r.p.name,
      csv: (r) => `${r.p.name} (${r.p.id})`,
      cell: (r) => <PersonCell name={r.p.name} sub={`ID ${r.p.id} · ${maskEmail(r.p.email)}`} />,
    },
    {
      id: 'criada',
      header: 'Criada',
      sortValue: (r) => r.p.createdAt,
      csv: (r) => dateTime(r.p.createdAt),
      cell: (r) => (
        <div className="whitespace-nowrap">
          <p className="text-[13px] text-fg-2">{relative(r.p.createdAt)}</p>
          <p className="text-xs text-fg-3">{date(r.p.createdAt)}</p>
        </div>
      ),
    },
    {
      id: 'origem',
      header: 'Origem',
      sortValue: (r) => r.p.origin,
      csv: (r) => r.p.origin,
      cell: (r) => (
        <div>
          <p className="text-[13px] text-fg-2">{r.p.origin}</p>
          {r.p.referrerId && <p className="text-xs text-fg-3">padrinho {affById.get(r.p.referrerId)?.name ?? r.p.referrerId}</p>}
        </div>
      ),
    },
    { id: 'dep', header: 'Depositado', align: 'right', sortValue: (r) => r.p.totalDeposited, csv: (r) => r.p.totalDeposited, cell: (r) => <span className="text-[13px] font-medium tnum">{brl(r.p.totalDeposited)}</span> },
    { id: 'bonus', header: 'Bônus recebido', align: 'right', sortValue: (r) => bonus[r.p.id] ?? 0, csv: (r) => bonus[r.p.id] ?? 0, cell: (r) => <span className="text-[13px] tnum">{brl(bonus[r.p.id] ?? 0)}</span> },
    { id: 'kyc', header: 'KYC', defaultHidden: true, sortValue: (r) => r.p.kyc, csv: (r) => KYC_LABEL[r.p.kyc], cell: (r) => <Badge tone={r.p.kyc === 'verificado' ? 'success' : r.p.kyc === 'reprovado' ? 'danger' : 'neutral'}>{KYC_LABEL[r.p.kyc]}</Badge> },
    { id: 'sinais', header: 'Sinais', minWidth: 240, wrap: true, sortValue: (r) => r.flags.filter((f) => f.tone !== 'neutral').length, csv: (r) => r.flags.map((f) => f.label).join('; '), cell: (r) => <FlagBadges flags={r.flags} /> },
    {
      id: 'status',
      header: 'Status',
      sortValue: (r) => r.p.status,
      csv: (r) => PLAYER_STATUS_LABEL[r.p.status],
      cell: (r) => (
        <Badge tone={STATUS_TONE[r.p.status]} dot>
          {PLAYER_STATUS_LABEL[r.p.status]}
        </Badge>
      ),
    },
  ]
  const counts = {
    todas: enriched.length,
    sinais: enriched.filter((r) => risky(r.flags)).length,
    rede: enriched.filter((r) => r.net).length,
    limpas: enriched.filter((r) => !risky(r.flags)).length,
  }
  return (
    <div className="relative overflow-x-clip">
    <DataTable
      caption="Contas criadas nos últimos 30 dias"
      rows={rows}
      columns={columns}
      rowKey={(r) => r.p.id}
      searchText={(r) => `${r.p.id} ${r.p.name} ${r.p.email} ${r.p.ip}`}
      searchPlaceholder="Buscar por ID, nome, e-mail ou IP"
      initialSort={{ id: 'criada', dir: 'desc' }}
      exportName="contas-novas-antifraude"
      onExport={(c) => audit('exportar', 'Anti-fraude', `Exportação CSV de ${c} contas novas`)}
      onRowClick={(r) => r.net && onOpen(r.net.id)}
      resetKey={filter}
      rowClassName={(r) => (r.flags.some((f) => f.tone === 'danger') ? 'bg-danger/[0.03]' : undefined)}
      toolbar={
        <ChipFilter<AccountFilter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'todas', label: 'Todas', count: counts.todas },
            { value: 'sinais', label: 'Com sinais de risco', count: counts.sinais, tone: 'warning' },
            { value: 'rede', label: 'Em rede', count: counts.rede, tone: 'danger' },
            { value: 'limpas', label: 'Sem sinais', count: counts.limpas },
          ]}
          className="max-w-full"
        />
      }
      rowActions={(r): MenuEntry[] => [
        { label: 'Ver rede', icon: Network, disabled: !r.net, onSelect: () => r.net && onOpen(r.net.id) },
        { label: blockedIps.has(r.p.ip) ? 'IP já bloqueado' : `Bloquear IP ${r.p.ip}`, icon: ShieldBan, danger: true, disabled: !canBan || blockedIps.has(r.p.ip), onSelect: () => onBlockIp(r.p) },
      ]}
      empty={{ title: 'Nenhuma conta neste filtro', description: 'Troque o filtro para ver outras contas novas.', icon: UserPlus }}
    />
    </div>
  )
}

// ---------- Ficha da rede ----------

function evidenceValue(l: LinkEvidence, revealed: boolean, affById: Map<string, Affiliate>) {
  if (l.kind === 'padrinho') {
    const a = affById.get(l.value)
    return a ? `${a.name} (${a.code})` : l.value
  }
  if (revealed || l.kind === 'ip') return l.value
  if (l.kind === 'cpf') return maskCpf(l.value)
  if (l.kind === 'email') return maskEmail(l.value)
  return maskPhone(l.value)
}

function NetworkDrawer({
  n,
  onClose,
  players,
  affById,
  bonus,
  canBan,
  blockedIps,
  onBan,
  onBlockIp,
}: {
  n: AccountNetwork | undefined
  onClose: () => void
  players: Player[]
  affById: Map<string, Affiliate>
  bonus: Record<string, number>
  canBan: boolean
  blockedIps: Set<string>
  onBan: (n: AccountNetwork) => void
  onBlockIp: (ip: string, ids: string[]) => void
}) {
  const { can } = useSession()
  const [revealed, setRevealed] = useState(false)
  if (!n) return null
  const byId = new Map(players.map((p) => [p.id, p]))
  const members = n.playerIds.map((id) => byId.get(id)).filter((p): p is Player => !!p)
  const reveal = () => {
    if (!can('usuarios.ver-dados')) {
      toast.error('Seu cargo não pode ver CPF, e-mail e celular completos.')
      return
    }
    setRevealed(true)
    audit('revelar', `Rede ${n.id}`, 'CPF, e-mail e celular completos exibidos na ficha da rede')
  }
  const close = () => {
    setRevealed(false)
    onClose()
  }
  return (
    <Drawer
      open
      onClose={close}
      width="xl"
      title={`Rede ${n.id}`}
      description={`${plural(members.length, 'conta ligada', 'contas ligadas')} · última atividade ${relative(n.lastAccess)}`}
      headerExtra={
        <Badge tone={RISK_TONE[n.level]} size="md" icon={ShieldAlert}>
          {`Risco ${RISK_LABEL[n.level].toLowerCase()}`}
        </Badge>
      }
      footer={
        <>
          {!revealed && (
            <Button variant="ghost" icon={Eye} onClick={reveal} className="mr-auto">
              Mostrar dados completos
            </Button>
          )}
          <Button
            icon={ShieldBan}
            className="text-danger"
            disabled={!canBan || !n.sharedIps.some((ip) => !blockedIps.has(ip))}
            title={!canBan ? 'Seu cargo não bloqueia IPs' : !n.sharedIps.length ? 'As contas não compartilham IP' : undefined}
            onClick={() => {
              const ip = n.sharedIps.find((x) => !blockedIps.has(x))
              if (ip) onBlockIp(ip, n.links.find((l) => l.kind === 'ip' && l.value === ip)?.playerIds ?? [])
            }}
          >
            Bloquear IP no site
          </Button>
          <Button variant="danger" icon={Ban} disabled={!canBan || n.status === 'banida'} title={!canBan ? 'Seu cargo não bane redes' : n.status === 'banida' ? 'Rede já banida' : undefined} onClick={() => onBan(n)}>
            Banir rede inteira
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <section className="grid gap-4 rounded-xl bg-surface-2 p-4 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div className="flex flex-col items-center justify-center px-2 text-center">
            <p className={cn('font-display text-4xl font-bold tnum', n.level === 'alto' ? 'text-danger' : n.level === 'medio' ? 'text-warning' : 'text-success')}>{n.score}</p>
            <p className="text-xs text-fg-3">de 100 pontos</p>
          </div>
          <div className="min-w-0">
            <Progress value={n.score} tone={n.level === 'alto' ? 'danger' : n.level === 'medio' ? 'warning' : 'success'} label="Pontuação de risco" className="mb-3" />
            <ul className="space-y-1.5">
              {n.reasons.map((r) => (
                <li key={r} className="flex items-start gap-2 text-[13px] text-fg-2">
                  <ShieldAlert size={14} className={cn('mt-0.5 shrink-0', n.level === 'baixo' ? 'text-fg-3' : 'text-warning')} aria-hidden /> {r}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Depositado', brl(n.totals.deposited)],
            ['Sacado', brl(n.totals.withdrawn)],
            ['Apostado', brlCompact(n.totals.bet)],
            ['Bônus recebido', brl(n.totals.bonus)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-line p-3">
              <p className="text-xs text-fg-3">{k}</p>
              <p className="mt-1 text-[15px] font-semibold text-fg tnum">{v}</p>
            </div>
          ))}
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Por que estão ligadas</h3>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {n.links.map((l, i) => {
              const Icon = LINK_ICON[l.kind]
              const ipBlocked = l.kind === 'ip' && blockedIps.has(l.value)
              return (
                <li key={`${l.kind}-${l.value}-${i}`} className="flex flex-wrap items-center gap-3 p-3">
                  <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', LINK_WEIGHT[l.kind] >= 20 ? 'bg-danger/10 text-danger' : 'bg-surface-3 text-fg-2')}>
                    <Icon size={15} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-fg">
                      {LINK_LABEL[l.kind]} <Mono>{evidenceValue(l, revealed, affById)}</Mono>
                    </p>
                    <p className="text-xs text-fg-3">
                      {plural(l.playerIds.length, 'conta', 'contas')}
                      {l.kind !== 'padrinho' && ` · visto em ${l.sources.map((s) => SIGNAL_SOURCE_LABEL[s]).join(', ')}`}
                      {l.selfReferral && ' · o padrinho está na rede'}
                      {l.burst && ` · ${REFERRAL_BURST.accounts}+ cadastros em ${REFERRAL_BURST.hours} h`}
                    </p>
                  </div>
                  {l.kind === 'ip' &&
                    (ipBlocked ? (
                      <Badge tone="danger" dot>
                        Bloqueado
                      </Badge>
                    ) : (
                      <Button size="sm" icon={ShieldBan} className="text-danger" disabled={!canBan} onClick={() => onBlockIp(l.value, l.playerIds)}>
                        Bloquear
                      </Button>
                    ))}
                </li>
              )
            })}
          </ul>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Contas e o que cada uma fez</h3>
          {members.length === 0 ? (
            <EmptyState title="Contas não encontradas" />
          ) : (
            <ul className="space-y-3">
              {members.map((m) => {
                const ref = m.referrerId ? affById.get(m.referrerId) : undefined
                return (
                  <li key={m.id} className={cn('rounded-xl border p-3.5', m.status === 'bloqueado' ? 'border-danger/25 bg-danger/[0.03]' : 'border-line')}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <PersonCell name={m.name} sub={`ID ${m.id} · ${revealed ? m.email : maskEmail(m.email)}`} />
                      <Badge tone={STATUS_TONE[m.status]} dot>
                        {PLAYER_STATUS_LABEL[m.status]}
                      </Badge>
                    </div>
                    <div className="mt-2">
                      <LinkBadges kinds={n.memberKinds[m.id] ?? []} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
                      <Stat label="Depósitos" value={brl(m.totalDeposited)} sub={plural(m.depositsCount, 'depósito', 'depósitos')} />
                      <Stat label="Saques" value={brl(m.totalWithdrawn)} sub={m.totalDeposited ? `${pct(m.totalWithdrawn / m.totalDeposited, 0)} do depositado` : '—'} danger={m.totalDeposited > 0 && m.totalWithdrawn >= m.totalDeposited * 0.8} />
                      <Stat label="Apostado" value={brlCompact(m.totalBet)} sub={plural(m.betsCount, 'aposta', 'apostas')} />
                      <Stat label="Bônus recebido" value={brl(bonus[m.id] ?? 0)} sub={`saldo ${brl(m.balanceReal)}`} danger={(bonus[m.id] ?? 0) > 0 && (bonus[m.id] ?? 0) >= Math.max(50, m.totalDeposited)} />
                    </div>
                    <DescriptionList
                      className="mt-3 border-t border-line pt-3"
                      columns={3}
                      items={[
                        { label: 'Criada em', value: dateTime(m.createdAt) },
                        { label: 'Último acesso', value: relative(m.lastAccess) },
                        { label: 'KYC', value: KYC_LABEL[m.kyc] },
                        { label: 'IP do cadastro', value: <Mono>{m.ip}</Mono> },
                        { label: 'CPF', value: <Mono>{revealed ? m.cpf : maskCpf(m.cpf)}</Mono> },
                        { label: 'Celular', value: <Mono>{revealed ? m.phone : maskPhone(m.phone)}</Mono> },
                        { label: 'Origem', value: m.origin },
                        { label: 'Padrinho', value: ref ? `${ref.name} (${ref.code})` : '—' },
                        { label: 'Cidade', value: `${m.city}/${m.uf}` },
                      ]}
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </Drawer>
  )
}

function Stat({ label, value, sub, danger }: { label: string; value: string; sub: string; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-fg-3">{label}</p>
      <p className={cn('font-semibold tnum', danger ? 'text-danger' : 'text-fg')}>{value}</p>
      <p className="truncate text-xs text-fg-3">{sub}</p>
    </div>
  )
}
