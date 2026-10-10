// Peças compartilhadas do módulo Geral: ficha do jogador (Drawer), selos de status,
// tipo de transação e valor com sinal. Usadas por Usuários, Transações, Rankings,
// Depósitos e Apostas esportivas.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  CircleMinus,
  CirclePause,
  CirclePlay,
  CirclePlus,
  Coins,
  Dices,
  Eye,
  EyeOff,
  Gift,
  Globe,
  History,
  Link2,
  Lock,
  LockOpen,
  Megaphone,
  Network,
  PiggyBank,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Star,
  Tags,
  Trophy,
  Undo2,
  UserPlus,
  Wallet,
} from 'lucide-react'
import {
  Alert,
  Avatar,
  Badge,
  Button,
  CopyButton,
  DescriptionList,
  Drawer,
  EmptyState,
  Field,
  FormFieldset,
  FormGrid,
  Menu,
  MoneyInput,
  Mono,
  Progress,
  Segmented,
  Select,
  TagInput,
  Tabs,
  Textarea,
  confirm,
  confirmWithInput,
  toast,
  type Tone,
} from '@/components/ui'
import { brl, cpf as fmtCpf, date, dateTime, isValidDate, maskCpf, maskEmail, maskPhone, num, pct, phone as fmtPhone, plural, relative } from '@/lib/format'
import { cn } from '@/lib/cn'
import { findKvRule } from '@shared/kv-registry'
import { isApiMode } from '@/lib/api'
import { dbGet, dbSetAndWait, refreshKey, useCollection, useDb } from '@/lib/store'
import { uid } from '@/lib/random'
import { DAY } from '@/data/now'
import { DATA_KEYS, useAffiliates, usePlayers, useTransactions } from '@/data/hooks'
import { KYC_LABEL, PLAYER_STATUS_LABEL, type KycStatus, type Player, type PlayerOrigin, type PlayerRole, type PlayerStatus } from '@/data/players'
import { TRANSACTION_TYPE_LABEL, type Transaction, type TransactionType } from '@/data/finance'
import { SEGURANCA_KEYS, seedBlocks, type Block } from '@/data/seguranca'
import { audit, useSession } from '@/domain/session'
import {
  GERAL_KEYS,
  MANUAL_ADJUST_LIMIT,
  MANUAL_ADJUST_STRONG_CONFIRM,
  MANUAL_REASONS,
  PAUSE_OPTIONS,
  STATUS_ACTION_LABEL,
  STATUS_REASONS,
  ageFrom,
  buildManualTx,
  isPlayerRequestedPause,
  manualAdjustPreview,
  manualCreditsLast24h,
  playerGgr,
  playerRtp,
  sameIpAccounts,
  statusActions,
  validateManualAdjust,
  walletBalance,
  walletPatch,
  type AnnotatedTransaction,
  type BannedNetworkAccount,
  type ManualAdjustInput,
  type StatusAction,
  type StatusActionOption,
  type StatusEvent,
} from '@/domain/geral'

// ---------- Moldura de tabela ----------

/**
 * Envolve o DataTable e corta o que escapar na horizontal. O cabeçalho "Ações"
 * (sr-only, absoluto) do DataTable vaza da área de rolagem quando a tabela é
 * mais larga que o cartão e cria rolagem lateral na página inteira.
 */
export function TableFrame({ children }: { children: ReactNode }) {
  return <div className="relative overflow-x-clip">{children}</div>
}

// ---------- Máscaras ----------

/** E-mail mascarado sem revelar o tamanho do usuário: fa***@gmail.com */
export function maskEmailShort(email: string) {
  const [user, domain] = email.split('@')
  if (!domain) return maskEmail(email)
  return `${user.slice(0, 2)}***@${domain}`
}

// ---------- Selos ----------

export const PLAYER_STATUS_TONE: Record<PlayerStatus, Tone> = {
  ativo: 'success',
  bloqueado: 'danger',
  autoexcluido: 'neutral',
  pausa: 'warning',
}

export const KYC_TONE: Record<KycStatus, Tone> = {
  verificado: 'success',
  pendente: 'info',
  nao_enviado: 'neutral',
  reprovado: 'danger',
}

export const ROLE_TONE: Record<PlayerRole, Tone> = {
  Jogador: 'neutral',
  Afiliado: 'info',
  Influenciador: 'primary',
  Gerente: 'gold',
}

export const ORIGIN_ICON: Record<PlayerOrigin, LucideIcon> = {
  Orgânico: Globe,
  Afiliado: Link2,
  Indicação: UserPlus,
  'Google Ads': Megaphone,
  'Meta Ads': Megaphone,
  'TikTok Ads': Megaphone,
  Influenciador: Star,
}

export function PlayerStatusBadge({ status, size }: { status: PlayerStatus; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={PLAYER_STATUS_TONE[status]} dot size={size}>
      {PLAYER_STATUS_LABEL[status]}
    </Badge>
  )
}

export const TX_TYPE_META: Record<TransactionType, { icon: LucideIcon; tone: Tone }> = {
  deposito: { icon: ArrowDownToLine, tone: 'success' },
  saque: { icon: ArrowUpFromLine, tone: 'warning' },
  aposta: { icon: Dices, tone: 'neutral' },
  ganho: { icon: Trophy, tone: 'success' },
  bonus: { icon: Gift, tone: 'primary' },
  free_spin: { icon: Sparkles, tone: 'primary' },
  cashback: { icon: PiggyBank, tone: 'info' },
  credito_manual: { icon: CirclePlus, tone: 'info' },
  debito_manual: { icon: CircleMinus, tone: 'danger' },
  estorno: { icon: Undo2, tone: 'gold' },
}

export function TxTypeBadge({ type }: { type: TransactionType }) {
  const m = TX_TYPE_META[type]
  return (
    <Badge tone={m.tone} icon={m.icon}>
      {TRANSACTION_TYPE_LABEL[type]}
    </Badge>
  )
}

/** Valor com sinal em texto (+/−) e cor: o status nunca depende só da cor. */
export function SignedAmount({ value, className }: { value: number; className?: string }) {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return (
    <span className={cn('whitespace-nowrap font-semibold tnum', value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-fg-2', className)}>
      {sign}
      {sign && ' '}
      {brl(Math.abs(value))}
    </span>
  )
}

// ---------- Ficha do jogador ----------

const EMPTY_HISTORY: StatusEvent[] = []
const EMPTY_NET_BANS: BannedNetworkAccount[] = []

const STATUS_ACTION_ICON: Record<StatusAction, LucideIcon> = {
  bloquear: Ban,
  desbloquear: LockOpen,
  pausar: CirclePause,
  encerrar_pausa: CirclePlay,
}

const STATUS_ACTION_TEXT: Record<StatusAction, string> = {
  bloquear: 'O jogador sai do site na hora e não consegue entrar, depositar, jogar nem sacar. O saldo fica guardado.',
  desbloquear: 'O jogador volta a entrar, depositar, jogar e sacar normalmente.',
  pausar: 'O jogador não entra nem deposita até o fim da pausa. Pausa pedida pelo jogador não pode ser encerrada antes do prazo.',
  encerrar_pausa: 'A conta volta a ficar ativa agora e o jogador pode entrar de novo.',
}

const TAG_SUGGESTIONS = ['VIP', 'Alto valor', 'Suporte prioritário', 'Revisar KYC', 'Bônus abuser', 'Reativado']

type DrawerTab = 'resumo' | 'acoes' | 'transacoes'

/**
 * Ficha do jogador. Abra com o id; feche com onClose.
 *   <PlayerDrawer playerId={openId} onClose={() => setOpenId(null)} />
 */
export function PlayerDrawer({ playerId, onClose, initialTab = 'resumo' }: { playerId: string | null; onClose: () => void; initialTab?: DrawerTab }) {
  // a base de jogadores só é lida quando uma ficha é aberta
  if (!playerId) return null
  return <PlayerDrawerGate playerId={playerId} onClose={onClose} initialTab={initialTab} />
}

/**
 * Abre a ficha do jogador? Modo API: a ficha lê a base de jogadores (geral.jogadores), que só Usuários e as
 * telas de readPages (shared/kv-registry.ts) leem; em Depósitos ou Apostas, um cargo sem elas vê um aviso.
 * Demonstração: sempre.
 */
export function useCanOpenPlayer(): boolean {
  const { canView } = useSession()
  if (!isApiMode()) return true
  const rule = findKvRule(DATA_KEYS.players)
  return !!rule && (rule.read === 'equipe' || [rule.page, ...(rule.readPages ?? [])].some((pg) => canView(pg)))
}

function PlayerDrawerGate({ playerId, onClose, initialTab }: { playerId: string; onClose: () => void; initialTab: DrawerTab }) {
  const canOpen = useCanOpenPlayer()
  if (!canOpen) return <PlayerDrawerDenied onClose={onClose} />
  return <PlayerDrawerFromBase playerId={playerId} onClose={onClose} initialTab={initialTab} />
}

function PlayerDrawerFromBase({ playerId, onClose, initialTab }: { playerId: string; onClose: () => void; initialTab: DrawerTab }) {
  const players = usePlayers()
  const p = players.get(playerId)
  if (!p) return null
  return <PlayerDrawerContent key={p.id} p={p} onClose={onClose} initialTab={initialTab} />
}

/** Sem leitura da base: avisa uma vez e fecha (o servidor recusaria a leitura com 403). */
function PlayerDrawerDenied({ onClose }: { onClose: () => void }) {
  const warned = useRef(false)
  useEffect(() => {
    if (!warned.current) {
      warned.current = true
      toast.error('Ficha do jogador indisponível', { description: 'Seu cargo não abre a base de jogadores. A ficha completa fica em Usuários.' })
    }
    onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

function PlayerDrawerContent({ p, onClose, initialTab }: { p: Player; onClose: () => void; initialTab: DrawerTab }) {
  const players = usePlayers()
  const { can } = useSession()
  const [tab, setTab] = useState<DrawerTab>(initialTab)
  const txs = useTransactions()
  const playerTx = useMemo(() => txs.items.filter((t) => t.playerId === p.id).sort((a, b) => b.at.localeCompare(a.at)), [txs.items, p.id])

  return (
    <Drawer
      open
      onClose={onClose}
      width="xl"
      title="Resumo do usuário"
      description={`ID ${p.id} · último acesso ${relative(p.lastAccess)}`}
      headerExtra={<PlayerStatusBadge status={p.status} size="md" />}
    >
      <div className="space-y-5">
        <div className="flex items-start gap-4">
          <Avatar name={p.name} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-lg font-bold text-fg">{p.nickname}</h3>
              <Badge tone={ROLE_TONE[p.role]}>{p.role}</Badge>
            </div>
            <p className="text-[13px] text-fg-2">
              {p.name} · {p.city}/{p.uf}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={KYC_TONE[p.kyc]} icon={ShieldCheck}>
                {`KYC ${KYC_LABEL[p.kyc].toLowerCase()}`}
              </Badge>
              <Badge tone="primary">{`Nível ${p.level}`}</Badge>
              <Badge icon={ORIGIN_ICON[p.origin]}>{p.origin}</Badge>
              <Badge>{`Desde ${date(p.createdAt)}`}</Badge>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <BalanceTile icon={Wallet} tone="success" label="Saldo real" value={brl(p.balanceReal)} />
          <BalanceTile icon={Gift} tone="primary" label="Bônus" value={brl(p.balanceBonus)} />
          <BalanceTile icon={Coins} tone="gold" label="Moedas" value={`${num(p.coins)} EVC`} />
        </div>

        <Tabs<DrawerTab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'resumo', label: 'Resumo' },
            { value: 'acoes', label: 'Status e saldo' },
            { value: 'transacoes', label: 'Transações', count: playerTx.length },
          ]}
        />

        {tab === 'resumo' && <SummaryTab p={p} players={players.items} canReveal={can('usuarios.ver-dados')} canEdit={can('usuarios.editar')} />}
        {tab === 'acoes' && <ActionsTab p={p} canEdit={can('usuarios.editar')} />}
        {tab === 'transacoes' && <RecentTx p={p} list={playerTx} onNavigate={onClose} />}
      </div>
    </Drawer>
  )
}

const TILE_TONE: Record<'success' | 'primary' | 'gold', string> = {
  success: 'bg-success/10 text-success',
  primary: 'bg-primary/10 text-primary-text',
  gold: 'bg-gold/15 text-warning dark:text-gold',
}

function BalanceTile({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: keyof typeof TILE_TONE }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface-2 p-2.5 sm:p-3">
      <div className="flex items-center gap-1.5">
        {/* no celular (3 colunas estreitas) o ícone sai para o rótulo caber ("Saldo real" ficava "Saldo r…") */}
        <span className={cn('hidden h-6 w-6 shrink-0 items-center justify-center rounded-md min-[440px]:flex', TILE_TONE[tone])}>
          <Icon size={13} aria-hidden />
        </span>
        <span className="truncate text-xs text-fg-3">{label}</span>
      </div>
      <p className="mt-1.5 truncate text-sm font-bold text-fg tnum sm:text-base">{value}</p>
    </div>
  )
}

function Section({ title, icon: Icon, actions, children }: { title: string; icon?: LucideIcon; actions?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
          {Icon && <Icon size={15} className="text-fg-3" aria-hidden />}
          {title}
        </h3>
        {actions}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'success' | 'danger' }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 px-3 py-2.5">
      <p className="truncate text-xs text-fg-3">{label}</p>
      <p className={cn('mt-0.5 truncate text-[15px] font-bold tnum', tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-fg')}>{value}</p>
      {sub && <p className="truncate text-[11.5px] text-fg-3">{sub}</p>}
    </div>
  )
}

/** Concordância com "conta" (feminino): "Conta reativada", não "Conta ativo". */
const ACCOUNT_STATUS_TOAST: Record<PlayerStatus, string> = {
  ativo: 'Conta reativada',
  bloqueado: 'Conta bloqueada',
  autoexcluido: 'Conta autoexcluída',
  pausa: 'Conta em pausa',
}

function SummaryTab({ p, players, canReveal, canEdit }: { p: Player; players: Player[]; canReveal: boolean; canEdit: boolean }) {
  const { update } = usePlayers()
  const { items: affiliates } = useAffiliates()
  const [revealed, setRevealed] = useState(false)
  const ggr = playerGgr(p)
  const rtp = playerRtp(p)
  const sameIp = useMemo(() => sameIpAccounts(players, p), [players, p])
  const referrer = p.referrerId ? affiliates.find((a) => a.id === p.referrerId) : undefined

  const reveal = () => {
    if (!canReveal) {
      toast.error('Seu cargo não pode ver dados completos', { description: 'Peça a permissão "Ver CPF e celular completos" ao Superadmin.' })
      return
    }
    setRevealed(true)
    audit('revelar', `Jogador #${p.id}`, 'CPF, celular e e-mail completos exibidos na ficha')
    toast.info('Dados revelados', { description: 'O acesso ficou registrado na auditoria.' })
  }

  const setTags = (next: string[]) => {
    const clean = [...new Set(next.map((t) => t.trim()).filter(Boolean))]
    if (clean.some((t) => t.length > 24)) {
      toast.error('Etiqueta muito longa', { description: 'Use até 24 caracteres.' })
      return
    }
    if (clean.length > 8) {
      toast.error('Limite de etiquetas', { description: 'Cada jogador pode ter até 8 etiquetas.' })
      return
    }
    const added = clean.filter((t) => !p.tags.includes(t))
    const removed = p.tags.filter((t) => !clean.includes(t))
    if (!added.length && !removed.length) return
    update(p.id, { tags: clean })
    audit('editar', `Jogador #${p.id}`, [...added.map((t) => `Etiqueta "${t}" adicionada`), ...removed.map((t) => `Etiqueta "${t}" removida`)].join('; '))
    toast.success('Etiquetas salvas', { description: added.length ? `"${added.join('", "')}" adicionada.` : `"${removed.join('", "')}" removida.` })
  }

  return (
    <div className="space-y-6">
      <Section title="Resultado do jogador" icon={ReceiptText}>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <Stat label="Depositado" value={brl(p.totalDeposited)} sub={plural(p.depositsCount, 'depósito', 'depósitos')} />
          <Stat label="Sacado" value={brl(p.totalWithdrawn)} sub={`${pct(p.totalDeposited ? p.totalWithdrawn / p.totalDeposited : 0, 0)} do depositado`} />
          <Stat label="Net de caixa" value={brl(p.totalDeposited - p.totalWithdrawn)} sub="depositado − sacado" />
          <Stat label="Apostado" value={brl(p.totalBet)} sub={plural(p.betsCount, 'aposta', 'apostas')} />
          <Stat label="Ganho" value={brl(p.totalWon)} sub={`maior prêmio ${brl(p.biggestWin)}`} />
          <Stat label="GGR do jogador" value={brl(ggr)} sub="apostado − ganho" tone={ggr >= 0 ? 'success' : 'danger'} />
        </div>
        {p.totalBet > 0 && (
          <div className="mt-3 rounded-lg border border-line px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="text-fg-2">RTP do jogador (quanto voltou de cada R$ apostado)</span>
              <span className="font-semibold text-fg tnum">{pct(rtp)}</span>
            </div>
            <Progress value={Math.min(rtp, 1.2)} max={1.2} tone={rtp > 1 ? 'danger' : rtp > 0.97 ? 'warning' : 'success'} label="RTP do jogador" />
            <p className="mt-1.5 text-[11.5px] text-fg-3">{rtp > 1 ? 'Jogador ganhou mais do que apostou: acompanhe os saques.' : 'Abaixo de 100%: a casa ficou com parte do que ele apostou.'}</p>
          </div>
        )}
      </Section>

      <Section
        title="Dados pessoais"
        icon={ShieldCheck}
        actions={
          revealed ? (
            <Button size="xs" variant="ghost" icon={EyeOff} onClick={() => setRevealed(false)}>
              Ocultar
            </Button>
          ) : (
            <Button size="xs" variant="soft" icon={Eye} onClick={reveal} disabled={!canReveal} title={!canReveal ? 'Seu cargo não pode ver CPF e celular completos' : undefined}>
              Revelar dados
            </Button>
          )
        }
      >
        <DescriptionList
          items={[
            { label: 'E-mail', value: <span className="break-all">{revealed ? p.email : maskEmailShort(p.email)}</span> },
            { label: 'Celular', value: <Mono className="text-fg">{revealed ? fmtPhone(p.phone) : maskPhone(p.phone)}</Mono> },
            { label: 'CPF', value: <Mono className="text-fg">{revealed ? fmtCpf(p.cpf) : maskCpf(p.cpf)}</Mono> },
            {
              label: 'Nascimento',
              // quem não vê dados pessoais recebe a data mascarada pelo servidor ("•••000Z")
              value: isValidDate(p.birthDate) ? `${date(p.birthDate)} · ${ageFrom(p.birthDate)} anos` : <span className="text-fg-3">Mascarada (LGPD)</span>,
            },
            { label: 'Código de indicação', value: <Mono className="text-fg">{p.refCode}</Mono> },
            { label: 'Indicado por', value: referrer ? `${referrer.name} (${referrer.code})` : '—' },
          ]}
        />
        {!revealed && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-3">
            <Lock size={12} aria-hidden />
            {canReveal ? 'Revelar fica registrado na auditoria (LGPD).' : 'Seu cargo vê os dados mascarados (LGPD).'}
          </p>
        )}
      </Section>

      <Section title="Rede e IP" icon={Network}>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-2">
          Último IP <Mono className="text-fg">{p.ip}</Mono>
          <CopyButton value={p.ip} label="Copiar IP" />
        </div>
        {sameIp.length > 0 ? (
          <Alert
            tone="warning"
            className="mt-3"
            title={`${plural(sameIp.length, 'outra conta usa', 'outras contas usam')} o mesmo IP`}
            action={
              <Link to={`/seguranca/antifraude?aba=ips&ip=${encodeURIComponent(p.ip)}`} className="link text-[13px]">
                Ver no Anti-fraude
              </Link>
            }
          >
            {sameIp
              .slice(0, 3)
              .map((x) => `${x.nickname} (ID ${x.id})`)
              .join(', ')}
            {sameIp.length > 3 ? ` e mais ${sameIp.length - 3}` : ''}. Pode ser a mesma casa ou multicontas.
          </Alert>
        ) : (
          <p className="mt-2 text-[13px] text-fg-3">Nenhuma outra conta usa este IP.</p>
        )}
      </Section>

      <Section title="Etiquetas" icon={Tags}>
        <TagInput id="player-tags" value={p.tags} onChange={setTags} disabled={!canEdit} placeholder="Digite uma etiqueta e tecle Enter" />
        {canEdit ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-fg-3">Sugestões:</span>
            {TAG_SUGGESTIONS.filter((t) => !p.tags.includes(t)).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTags([...p.tags, t])}
                className="rounded-full border border-dashed border-line-strong px-2 py-0.5 text-xs text-fg-2 hover:border-primary hover:text-primary-text"
              >
                + {t}
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-fg-3">Seu cargo pode ver, mas não editar etiquetas.</p>
        )}
      </Section>
    </div>
  )
}

function ActionsTab({ p, canEdit }: { p: Player; canEdit: boolean }) {
  const players = usePlayers()
  const txs = useTransactions()
  const history = useCollection<StatusEvent>(GERAL_KEYS.statusHistory, EMPTY_HISTORY)
  // bloqueios do anti-fraude (modo API: só para quem lê o Anti-fraude; sem leitura, lista vazia)
  const [blocks] = useDb<Block[]>(SEGURANCA_KEYS.blocks, seedBlocks)
  // modo API, sem leitura do Anti-fraude (Suporte): o servidor diz só a rede e a data do banimento da conta
  const [netBanView] = useDb<BannedNetworkAccount[]>(GERAL_KEYS.bannedNetworks, EMPTY_NET_BANS)
  const { user, can, canView } = useSession()
  const mine = history.items.filter((h) => h.playerId === p.id)
  const lastPause = mine.find((h) => h.action === 'pausar') ?? null
  const lastBlock = mine.find((h) => h.action === 'bloquear') ?? null
  // conta bloqueada pelo banimento de uma rede: só sai do bloqueio desfazendo o banimento (o servidor recusa
  // o desbloqueio pela ficha com 409 rede_banida, e a aprovação de saque da conta segue recusada)
  const fullBan = blocks.find((b) => b.kind === 'rede' && b.accounts.includes(p.id)) ?? null
  const viewBan = !fullBan && isApiMode() ? (netBanView.find((b) => b.playerId === p.id) ?? null) : null
  const netBan =
    p.status !== 'bloqueado'
      ? null
      : fullBan
        ? { network: fullBan.value, detail: `Banida em ${dateTime(fullBan.createdAt)} por ${fullBan.createdBy}. Motivo: ${fullBan.reason}. ` }
        : viewBan
          ? { network: viewBan.network, detail: viewBan.bannedAt ? `Banida em ${dateTime(viewBan.bannedAt)}. ` : '' }
          : null
  const netBanReason = netBan ? `A conta faz parte da rede ${netBan.network}, banida pelo anti-fraude: desfaça o banimento em Anti-fraude › Bloqueios.` : undefined
  // mesma tabela de transições do servidor (shared/players.ts), com as permissões da pessoa
  const statusPerms = new Set(['usuarios.editar', 'antifraude.banir'].filter((perm) => can(perm)))
  const actions = statusActions(p.status, lastPause, Date.now(), statusPerms, lastBlock).map((a) =>
    a.action === 'desbloquear' && netBan ? { ...a, allowed: false, reason: netBanReason } : a,
  )
  const [busy, setBusy] = useState(false)

  const changeStatus = async (opt: StatusActionOption, pauseDays?: number) => {
    const { action, next } = opt
    const pauseLabel = PAUSE_OPTIONS.find((o) => o.days === pauseDays)?.label
    const r = await confirmWithInput({
      title: action === 'pausar' ? `Pausar a conta por ${pauseLabel}?` : `${STATUS_ACTION_LABEL[action]} de ${p.nickname}?`,
      description: next === 'pausa' && action === 'desbloquear' ? `${STATUS_ACTION_TEXT[action]} A pausa pedida pelo jogador continua até o prazo.` : STATUS_ACTION_TEXT[action],
      confirmLabel: action === 'pausar' ? `Pausar por ${pauseLabel}` : STATUS_ACTION_LABEL[action],
      tone: action === 'bloquear' ? 'danger' : action === 'pausar' ? 'warning' : 'success',
      icon: STATUS_ACTION_ICON[action],
      input: { label: 'Motivo', required: true, options: STATUS_REASONS[action].map((x) => ({ value: x, label: x })) },
    })
    if (!r.confirmed) return
    const now = new Date()
    const until = action === 'pausar' && pauseDays ? new Date(now.getTime() + pauseDays * DAY).toISOString() : null
    const event: StatusEvent = {
      id: uid('st'),
      playerId: p.id,
      at: now.toISOString(),
      action,
      from: p.status,
      to: next,
      reason: r.value,
      by: user.name,
      until,
      byPlayer: action === 'pausar' && isPlayerRequestedPause(r.value),
    }
    if (isApiMode()) {
      // o servidor confere a transição (e a pausa do jogador) ao gravar o status; o histórico só entra
      // depois, para não registrar uma mudança recusada. Recusa: o aviso com o motivo já aparece.
      setBusy(true)
      try {
        const saved = await dbSetAndWait<Player[]>(DATA_KEYS.players, (prev) => prev.map((x) => (x.id === p.id ? { ...x, status: next } : x)))
        if (!saved) return
        await dbSetAndWait<StatusEvent[]>(GERAL_KEYS.statusHistory, (prev) => [event, ...prev], EMPTY_HISTORY)
      } finally {
        setBusy(false)
      }
    } else {
      players.update(p.id, { status: next })
      history.add(event)
    }
    audit(action === 'bloquear' ? 'bloquear' : 'editar', `Jogador #${p.id}`, `${STATUS_ACTION_LABEL[action]}${until ? ` até ${dateTime(until)}` : ''}. Motivo: ${r.value}`)
    toast.success(ACCOUNT_STATUS_TOAST[next], { description: `${p.nickname} · registrado na auditoria.` })
  }

  // ajuste manual
  const blank: ManualAdjustInput = { kind: 'credito', wallet: 'real', amount: 0, reason: '', note: '' }
  const [adj, setAdj] = useState<ManualAdjustInput>(blank)
  const [touched, setTouched] = useState(false)
  const credited24h = useMemo(() => manualCreditsLast24h(txs.items, p.id), [txs.items, p.id])
  const errors = validateManualAdjust(adj, p, credited24h)
  const hasErrors = Object.keys(errors).length > 0
  const preview = manualAdjustPreview(adj, p)
  const show = (k: keyof typeof errors) => (touched || (k === 'amount' && adj.amount > 0) || k === 'kind' ? errors[k] : undefined)

  const submit = async () => {
    setTouched(true)
    if (hasErrors) return
    const verb = adj.kind === 'credito' ? 'Creditar' : 'Debitar'
    const ok = await confirm({
      title: `${verb} ${brl(adj.amount)} no saldo ${adj.wallet === 'real' ? 'real' : 'bônus'}?`,
      description: 'O lançamento entra no extrato do jogador e na auditoria. Para desfazer, faça um lançamento contrário.',
      confirmLabel: verb,
      tone: adj.kind === 'credito' ? 'primary' : 'danger',
      icon: adj.kind === 'credito' ? CirclePlus : CircleMinus,
      typeToConfirm: adj.amount >= MANUAL_ADJUST_STRONG_CONFIRM ? verb.toUpperCase() : undefined,
      details: (
        <DescriptionList
          columns={2}
          items={[
            { label: 'Jogador', value: `${p.nickname} (ID ${p.id})` },
            { label: 'Carteira', value: adj.wallet === 'real' ? 'Saldo real' : 'Saldo bônus' },
            { label: 'Saldo antes', value: brl(preview.before) },
            { label: 'Saldo depois', value: <strong>{brl(preview.after)}</strong> },
            { label: 'Motivo', value: adj.reason === 'Outro motivo' ? adj.note : adj.reason, full: true },
          ]}
        />
      ),
    })
    if (!ok) return
    const tx = buildManualTx(adj, p, user.name)
    let balanceAfter = tx.balanceAfter
    if (isApiMode()) {
      // o servidor lança no extrato, aplica o saldo e audita numa transação (o saldo enviado é ignorado);
      // recusa (teto de 24 h, saldo, autoexcluído): o aviso com o motivo já aparece e nada muda
      setBusy(true)
      try {
        const saved = await dbSetAndWait<Transaction[]>(DATA_KEYS.transactions, (prev) => [tx, ...prev])
        if (!saved) return
        await refreshKey(DATA_KEYS.players)
        const stored = dbGet<Transaction[]>(DATA_KEYS.transactions, []).find((t) => t.id === tx.id)
        if (stored) balanceAfter = stored.balanceAfter
      } finally {
        setBusy(false)
      }
    } else {
      txs.add(tx)
      players.update(p.id, walletPatch(adj.wallet, tx.balanceAfter))
      audit('creditar', `Jogador #${p.id}`, `${adj.kind === 'credito' ? 'Creditação' : 'Subtração'} de ${brl(adj.amount)} no saldo ${adj.wallet === 'real' ? 'real' : 'bônus'} (${tx.id}). Motivo: ${tx.note}`)
    }
    toast.success(adj.kind === 'credito' ? 'Crédito lançado' : 'Débito lançado', { description: `${tx.id} · novo saldo ${brl(balanceAfter)}.` })
    setAdj(blank)
    setTouched(false)
  }

  return (
    <div className="space-y-6">
      <Section title="Status da conta" icon={Lock}>
        <div className="rounded-xl border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[13px] text-fg-2">
              Situação atual <PlayerStatusBadge status={p.status} />
              {p.status === 'pausa' && lastPause?.until && <span className="text-xs text-fg-3">até {dateTime(lastPause.until)}</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {actions.map((a) =>
                a.action === 'pausar' ? (
                  <Menu
                    key={a.action}
                    align="end"
                    items={[{ heading: 'Pausar por' }, ...PAUSE_OPTIONS.map((o) => ({ label: o.label, icon: CirclePause, onSelect: () => changeStatus(a, o.days) }))]}
                    trigger={(t) => (
                      <Button
                        {...t}
                        size="sm"
                        icon={CirclePause}
                        disabled={!canEdit || !a.allowed || busy}
                        title={!canEdit ? 'Seu cargo não altera o status de jogadores' : a.reason}
                      >
                        Pausar
                      </Button>
                    )}
                  />
                ) : (
                  <Button
                    key={a.action}
                    size="sm"
                    variant={a.action === 'bloquear' ? 'secondary' : 'success'}
                    className={a.action === 'bloquear' ? 'text-danger' : undefined}
                    icon={STATUS_ACTION_ICON[a.action]}
                    disabled={!canEdit || !a.allowed || busy}
                    title={!canEdit ? 'Seu cargo não altera o status de jogadores' : a.reason}
                    onClick={() => changeStatus(a)}
                  >
                    {STATUS_ACTION_LABEL[a.action]}
                  </Button>
                ),
              )}
            </div>
          </div>
          {p.status === 'autoexcluido' && (
            <Alert tone="neutral" className="mt-3">
              Autoexclusão é decisão do jogador e não pode ser desfeita pelo painel. O jogador não recebe creditações nem comunicações.
            </Alert>
          )}
          {netBan && (
            <Alert tone="danger" className="mt-3" title={`Bloqueada pelo banimento da rede ${netBan.network}`}>
              {netBan.detail}
              Enquanto o banimento valer, a conta não é desbloqueada por aqui e os saques dela são recusados na aprovação. Para liberar, desfaça o
              banimento da rede em{' '}
              {canView('antifraude') ? (
                <Link to="/seguranca/antifraude?aba=bloqueios" className="link">
                  Anti-fraude › Bloqueios
                </Link>
              ) : (
                'Anti-fraude › Bloqueios'
              )}
              .
            </Alert>
          )}
          {!canEdit && p.status !== 'autoexcluido' && <p className="mt-3 text-xs text-fg-3">Seu cargo pode ver, mas não alterar o status da conta.</p>}
          {canEdit && !netBan && actions.some((a) => !a.allowed && a.reason) && (
            <p className="mt-3 text-xs text-fg-3">{actions.find((a) => !a.allowed)?.reason}</p>
          )}
        </div>
        {mine.length > 0 && (
          <ol className="mt-3 space-y-2.5 border-l border-line pl-4">
            {mine.slice(0, 6).map((h) => (
              <li key={h.id} className="relative text-[13px]">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-line-strong" aria-hidden />
                <p className="text-fg">
                  {STATUS_ACTION_LABEL[h.action]} <span className="text-fg-3">· {h.reason}</span>
                </p>
                <p className="text-xs text-fg-3">
                  {dateTime(h.at)} por {h.by}
                  {h.until ? ` · até ${dateTime(h.until)}` : ''}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Ajuste manual de saldo" icon={History}>
        <FormFieldset readOnly={!canEdit} className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              ariaLabel="Tipo de ajuste"
              value={adj.kind}
              onChange={(kind) => setAdj((a) => ({ ...a, kind }))}
              options={[
                { value: 'credito', label: 'Creditar', icon: CirclePlus },
                { value: 'debito', label: 'Debitar', icon: CircleMinus },
              ]}
            />
            <Segmented
              ariaLabel="Carteira"
              value={adj.wallet}
              onChange={(wallet) => setAdj((a) => ({ ...a, wallet }))}
              options={[
                { value: 'real', label: 'Saldo real' },
                { value: 'bonus', label: 'Saldo bônus' },
              ]}
            />
          </div>
          {errors.kind && <p className="text-xs font-medium text-danger">{errors.kind}</p>}
          <FormGrid>
            <Field label="Valor" htmlFor="adj-amount" required error={show('amount')} hint={`Até ${brl(MANUAL_ADJUST_LIMIT)} por lançamento e ${brl(MANUAL_ADJUST_LIMIT)} em créditos por jogador em 24 h${credited24h > 0 ? ` (já lançado: ${brl(credited24h)})` : ''}.`}>
              <MoneyInput id="adj-amount" value={adj.amount} onValueChange={(amount) => setAdj((a) => ({ ...a, amount }))} invalid={!!show('amount')} blankWhenZero placeholder="0,00" />
            </Field>
            <Field label="Motivo" htmlFor="adj-reason" required error={show('reason')}>
              <Select id="adj-reason" value={adj.reason} placeholder="Selecione" options={MANUAL_REASONS.map((r) => ({ value: r, label: r }))} onChange={(reason) => setAdj((a) => ({ ...a, reason }))} />
            </Field>
          </FormGrid>
          <Field
            label={adj.reason === 'Outro motivo' ? 'Descrição do motivo' : 'Observação (opcional)'}
            htmlFor="adj-note"
            required={adj.reason === 'Outro motivo'}
            error={show('note')}
            hint="Aparece no extrato e na auditoria."
          >
            <Textarea id="adj-note" rows={2} value={adj.note} onChange={(e) => setAdj((a) => ({ ...a, note: e.target.value }))} placeholder="Ex.: chamado #4821, rodada travada no Fortune Tiger" />
          </Field>
          <div className="flex flex-col gap-3 rounded-xl bg-surface-2 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[13px] text-fg-2" aria-live="polite">
              Saldo {adj.wallet === 'real' ? 'real' : 'bônus'}: <span className="tnum">{brl(walletBalance(p, adj.wallet))}</span>
              {adj.amount > 0 && !errors.amount && (
                <>
                  {' '}
                  → <strong className={cn('tnum', adj.kind === 'credito' ? 'text-success' : 'text-danger')}>{brl(preview.after)}</strong>
                </>
              )}
              {adj.amount >= MANUAL_ADJUST_STRONG_CONFIRM && !errors.amount && <p className="mt-0.5 text-xs text-fg-3">Acima de {brl(MANUAL_ADJUST_STRONG_CONFIRM)} pedimos para digitar a confirmação.</p>}
            </div>
            <Button variant={adj.kind === 'credito' ? 'primary' : 'danger'} icon={adj.kind === 'credito' ? CirclePlus : CircleMinus} onClick={submit} disabled={!canEdit} loading={busy}>
              {adj.kind === 'credito' ? 'Lançar crédito' : 'Lançar débito'}
            </Button>
          </div>
          {!canEdit && <p className="text-xs text-fg-3">Seu cargo pode ver, mas não lançar ajustes de saldo.</p>}
        </FormFieldset>
      </Section>
    </div>
  )
}

function RecentTx({ p, list, onNavigate }: { p: Player; list: Transaction[]; onNavigate: () => void }) {
  if (!list.length) {
    return <EmptyState icon={ReceiptText} title="Sem transações nos últimos 30 dias" description="Depósitos, apostas e ajustes deste jogador aparecem aqui." />
  }
  return (
    <div>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {list.slice(0, 15).map((t) => {
          const note = (t as AnnotatedTransaction).note
          const Icon = TX_TYPE_META[t.type].icon
          return (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg-2">
                <Icon size={15} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-fg">
                  {TRANSACTION_TYPE_LABEL[t.type]}
                  {t.gameName && <span className="font-normal text-fg-3"> · {t.gameName}</span>}
                  {t.wallet === 'bonus' && <span className="font-normal text-fg-3"> · bônus</span>}
                </p>
                <p className="truncate text-xs text-fg-3">
                  {dateTime(t.at)} · <Mono className="text-[11.5px] text-fg-3">{t.id}</Mono>
                  {note ? ` · ${note}` : ''}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <SignedAmount value={t.amount} className="text-[13px]" />
                <p className="text-[11px] text-fg-3 tnum">saldo {brl(t.balanceAfter)}</p>
              </div>
            </li>
          )
        })}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-2 text-[13px]">
        <span className="text-fg-3">{list.length > 15 ? `Mostrando 15 de ${num(list.length)}` : plural(list.length, 'transação', 'transações')}</span>
        <Link to={`/dashboard/transacoes?jogador=${p.id}`} onClick={onNavigate} className="link inline-flex items-center gap-1">
          Ver extrato completo
        </Link>
      </div>
    </div>
  )
}
