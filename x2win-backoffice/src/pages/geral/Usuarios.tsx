import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownToLine, Copy, Eye, ListFilter, Lock, ReceiptText, ShieldCheck, UserCog, Users, Wallet, X } from 'lucide-react'
import {
  Badge,
  Button,
  Checkbox,
  ChipFilter,
  DataTable,
  Field,
  KpiCard,
  Mono,
  PageHeader,
  PersonCell,
  Popover,
  Select,
  toast,
  type Column,
} from '@/components/ui'
import { brl, brlCompact, date, dateTime, maskPhone, num, pct, plural, relative } from '@/lib/format'
import { DAY, NOW } from '@/data/now'
import { usePlayers } from '@/data/hooks'
import { KYC_LABEL, PLAYER_STATUS_LABEL, type KycStatus, type Player, type PlayerOrigin, type PlayerStatus } from '@/data/players'
import { audit, usePageAccess } from '@/domain/session'
import { BALANCE_BANDS, inBalanceBand, playerBalance, playerSearchText, type BalanceBand } from '@/domain/geral'
import { KYC_TONE, ORIGIN_ICON, PlayerDrawer, PlayerStatusBadge, ROLE_TONE, TableFrame, maskEmailShort } from './_shared'

const ORIGINS: PlayerOrigin[] = ['Orgânico', 'Afiliado', 'Indicação', 'Google Ads', 'Meta Ads', 'TikTok Ads', 'Influenciador']

interface Filters {
  origins: PlayerOrigin[]
  kyc: KycStatus | 'todos'
  tag: string
  band: BalanceBand
}

const NO_FILTERS: Filters = { origins: [], kyc: 'todos', tag: '', band: 'todos' }

type StatusFilter = 'todos' | PlayerStatus

function matches(p: Player, f: Filters) {
  if (f.origins.length && !f.origins.includes(p.origin)) return false
  if (f.kyc !== 'todos' && p.kyc !== f.kyc) return false
  if (f.tag && !p.tags.includes(f.tag)) return false
  return inBalanceBand(p, f.band)
}

function describeFilters(f: Filters) {
  const parts: string[] = []
  if (f.origins.length) parts.push(`origem: ${f.origins.join(', ')}`)
  if (f.kyc !== 'todos') parts.push(`KYC: ${KYC_LABEL[f.kyc]}`)
  if (f.tag) parts.push(`etiqueta: ${f.tag}`)
  if (f.band !== 'todos') parts.push(`saldo: ${BALANCE_BANDS.find((b) => b.value === f.band)?.label}`)
  return parts
}

export default function Usuarios() {
  const { can, canEdit } = usePageAccess()
  const navigate = useNavigate()
  const { items } = usePlayers()
  const [status, setStatus] = useState<StatusFilter>('todos')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [open, setOpen] = useState<{ id: string; tab: 'resumo' | 'acoes' } | null>(null)

  const filtered = useMemo(() => items.filter((p) => matches(p, filters)), [items, filters])
  const rows = useMemo(() => (status === 'todos' ? filtered : filtered.filter((p) => p.status === status)), [filtered, status])
  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: filtered.length }
    for (const p of filtered) c[p.status] = (c[p.status] ?? 0) + 1
    return c
  }, [filtered])

  const allTags = useMemo(() => {
    const s = new Set<string>()
    items.forEach((p) => p.tags.forEach((t) => s.add(t)))
    return [...s].sort((a, b) => (a === 'VIP' ? -1 : b === 'VIP' ? 1 : a.localeCompare(b, 'pt-BR')))
  }, [items])

  const kpi = useMemo(() => {
    const newWeek = items.filter((p) => NOW.getTime() - new Date(p.createdAt).getTime() <= 7 * DAY).length
    const real = items.reduce((s, p) => s + p.balanceReal, 0)
    const bonus = items.reduce((s, p) => s + p.balanceBonus, 0)
    const depositors = items.filter((p) => p.depositsCount > 0).length
    const kycPending = items.filter((p) => p.kyc === 'pendente').length
    return { newWeek, real, bonus, depositors, kycPending }
  }, [items])

  const activeFilters = describeFilters(filters)
  const clearAll = () => {
    setFilters(NO_FILTERS)
    setStatus('todos')
  }

  const copyId = async (p: Player) => {
    try {
      await navigator.clipboard.writeText(p.id)
    } catch {
      /* sem permissão */
    }
    toast.success('ID copiado', { description: p.id })
  }

  const columns: Column<Player>[] = [
    { id: 'id', header: 'ID', pinned: true, sortValue: (p) => Number(p.id), csv: (p) => p.id, cell: (p) => <Mono className="font-medium text-fg">{p.id}</Mono> },
    {
      id: 'nickname',
      header: 'Apelido',
      minWidth: 190,
      sortValue: (p) => p.nickname.toLowerCase(),
      csv: (p) => p.nickname,
      cell: (p) => <PersonCell name={p.nickname} sub={maskEmailShort(p.email)} />,
    },
    { id: 'email', header: 'E-mail', defaultHidden: true, sortValue: (p) => p.email, csv: (p) => maskEmailShort(p.email), cell: (p) => <span className="text-[13px] text-fg-2">{maskEmailShort(p.email)}</span> },
    { id: 'phone', header: 'Celular', defaultHidden: true, csv: (p) => maskPhone(p.phone), cell: (p) => <Mono>{maskPhone(p.phone)}</Mono> },
    { id: 'name', header: 'Nome', defaultHidden: true, sortValue: (p) => p.name, cell: (p) => <span className="text-[13px] text-fg-2">{p.name}</span> },
    {
      id: 'origin',
      header: 'Origem',
      sortValue: (p) => p.origin,
      cell: (p) => <Badge icon={ORIGIN_ICON[p.origin]}>{p.origin}</Badge>,
    },
    { id: 'role', header: 'Cargo', sortValue: (p) => p.role, cell: (p) => <Badge tone={ROLE_TONE[p.role]}>{p.role}</Badge> },
    { id: 'status', header: 'Status', sortValue: (p) => p.status, csv: (p) => PLAYER_STATUS_LABEL[p.status], cell: (p) => <PlayerStatusBadge status={p.status} /> },
    {
      id: 'kyc',
      header: 'KYC',
      defaultHidden: true,
      sortValue: (p) => p.kyc,
      csv: (p) => KYC_LABEL[p.kyc],
      cell: (p) => <Badge tone={KYC_TONE[p.kyc]}>{KYC_LABEL[p.kyc]}</Badge>,
    },
    {
      id: 'balance', money: true,
      header: 'Saldo',
      align: 'right',
      sortValue: (p) => playerBalance(p),
      csv: (p) => playerBalance(p),
      cell: (p) => (
        <div>
          <p className="font-semibold text-fg">{brl(playerBalance(p))}</p>
          <p className="text-[11.5px] text-fg-3">{p.balanceBonus > 0 ? `${brl(p.balanceBonus)} bônus` : 'só saldo real'}</p>
        </div>
      ),
    },
    { id: 'createdAt', header: 'Entrada', sortValue: (p) => p.createdAt, csv: (p) => date(p.createdAt), cell: (p) => <span className="text-[13px] text-fg-2">{date(p.createdAt)}</span> },
    {
      id: 'lastAccess',
      header: 'Último acesso',
      sortValue: (p) => p.lastAccess,
      csv: (p) => dateTime(p.lastAccess),
      cell: (p) => (
        <span className="text-[13px] text-fg-2" title={dateTime(p.lastAccess)}>
          {relative(p.lastAccess)}
        </span>
      ),
    },
    {
      id: 'totalDeposited', money: true,
      header: 'Total depositado',
      align: 'right',
      sortValue: (p) => p.totalDeposited,
      cell: (p) => (
        <div>
          <p className="font-medium text-fg">{brl(p.totalDeposited)}</p>
          <p className="text-[11.5px] text-fg-3">{p.depositsCount ? plural(p.depositsCount, 'depósito', 'depósitos') : 'nunca depositou'}</p>
        </div>
      ),
    },
    {
      id: 'tags',
      header: 'Etiquetas',
      defaultHidden: true,
      csv: (p) => p.tags.join(', '),
      cell: (p) =>
        p.tags.length ? (
          <div className="flex gap-1">
            {p.tags.slice(0, 2).map((t) => (
              <Badge key={t} tone={t === 'VIP' ? 'gold' : 'neutral'}>
                {t}
              </Badge>
            ))}
            {p.tags.length > 2 && <Badge>{`+${p.tags.length - 2}`}</Badge>}
          </div>
        ) : (
          <span className="text-fg-3">—</span>
        ),
    },
    { id: 'city', header: 'Cidade', defaultHidden: true, sortValue: (p) => p.city, csv: (p) => `${p.city}/${p.uf}`, cell: (p) => <span className="text-[13px] text-fg-2">{`${p.city}/${p.uf}`}</span> },
  ]

  return (
    <>
      <PageHeader />

      <section aria-label="Resumo dos jogadores" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Jogadores" icon={Users} value={num(items.length)} hint={`+${num(kpi.newWeek)} nos últimos 7 dias`} />
        <KpiCard
          label="Saldo nas carteiras"
          icon={Wallet}
          tone="neutral"
          value={brlCompact(kpi.real)}
          hint={`+ ${brlCompact(kpi.bonus)} em bônus`}
          formula={<>Soma do saldo real de todos os jogadores agora. É o valor que a casa deve se todos sacarem. Bônus não é sacável e aparece à parte.</>}
        />
        <KpiCard
          label="Já depositaram"
          icon={ArrowDownToLine}
          tone="success"
          value={num(kpi.depositors)}
          hint={`${pct(items.length ? kpi.depositors / items.length : 0, 0)} dos cadastros`}
          formula={<>Jogadores com pelo menos um depósito pago desde o cadastro.</>}
        />
        <KpiCard
          label="KYC em análise"
          icon={ShieldCheck}
          tone="info"
          value={num(kpi.kycPending)}
          hint="documentos aguardando revisão"
          onClick={() => setFilters((f) => ({ ...f, kyc: f.kyc === 'pendente' ? 'todos' : 'pendente' }))}
          active={filters.kyc === 'pendente'}
        />
      </section>

      <p className="mb-3 flex items-start gap-1.5 text-[13px] text-fg-3">
        <Lock size={14} className="mt-0.5 shrink-0" aria-hidden />
        CPF, e-mail e celular aparecem mascarados (LGPD). A busca por CPF compara só os dígitos. A exportação sai mascarada e fica registrada na auditoria.
      </p>

      <TableFrame>
        <DataTable
          caption="Lista de jogadores"
          rows={rows}
          columns={columns}
          rowKey={(p) => p.id}
          searchText={playerSearchText}
          searchPlaceholder="Buscar por e-mail, ID ou CPF"
          initialSort={{ id: 'createdAt', dir: 'desc' }}
          pageSize={10}
          exportName="usuarios"
          canExport={can('usuarios.exportar')}
          onExport={(n) =>
            audit('exportar', 'Usuários', `Exportação CSV de ${n} jogadores com dados mascarados${activeFilters.length || status !== 'todos' ? ` (filtro: ${[status !== 'todos' ? PLAYER_STATUS_LABEL[status] : null, ...activeFilters].filter(Boolean).join('; ')})` : ''}`)
          }
          onRowClick={(p) => setOpen({ id: p.id, tab: 'resumo' })}
          resetKey={`${status}|${JSON.stringify(filters)}`}
          rowActions={(p) => [
            { label: 'Ver resumo do usuário', icon: Eye, onSelect: () => setOpen({ id: p.id, tab: 'resumo' }) },
            { label: 'Ver transações', icon: ReceiptText, onSelect: () => navigate(`/dashboard/transacoes?jogador=${p.id}`) },
            { label: 'Copiar ID', icon: Copy, onSelect: () => copyId(p) },
            { divider: true },
            {
              label: 'Status e saldo',
              icon: UserCog,
              hint: canEdit ? undefined : 'só leitura',
              onSelect: () => setOpen({ id: p.id, tab: 'acoes' }),
            },
          ]}
          toolbar={
            <>
              <ChipFilter<StatusFilter>
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'todos', label: 'Todos', count: counts.todos ?? 0 },
                  { value: 'ativo', label: 'Ativos', count: counts.ativo ?? 0 },
                  { value: 'pausa', label: 'Em pausa', count: counts.pausa ?? 0, tone: 'warning' },
                  { value: 'bloqueado', label: 'Bloqueados', count: counts.bloqueado ?? 0, tone: 'danger' },
                  { value: 'autoexcluido', label: 'Autoexcluídos', count: counts.autoexcluido ?? 0 },
                ]}
                className="max-w-full"
              />
              <FiltersPopover value={filters} onChange={setFilters} tags={allTags} />
              {activeFilters.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {filters.origins.length > 0 && <FilterChip label={`Origem: ${filters.origins.length === 1 ? filters.origins[0] : `${filters.origins.length} origens`}`} onClear={() => setFilters((f) => ({ ...f, origins: [] }))} />}
                  {filters.kyc !== 'todos' && <FilterChip label={`KYC: ${KYC_LABEL[filters.kyc]}`} onClear={() => setFilters((f) => ({ ...f, kyc: 'todos' }))} />}
                  {filters.tag && <FilterChip label={`Etiqueta: ${filters.tag}`} onClear={() => setFilters((f) => ({ ...f, tag: '' }))} />}
                  {filters.band !== 'todos' && <FilterChip label={`Saldo: ${BALANCE_BANDS.find((b) => b.value === filters.band)?.label}`} onClear={() => setFilters((f) => ({ ...f, band: 'todos' }))} />}
                </div>
              )}
            </>
          }
          empty={{
            icon: Users,
            title: 'Nenhum jogador neste filtro',
            description: 'Troque o status ou limpe os filtros para ver outros jogadores.',
            action: (
              <Button size="sm" onClick={clearAll}>
                Limpar filtros
              </Button>
            ),
          }}
        />
      </TableFrame>

      <PlayerDrawer playerId={open?.id ?? null} initialTab={open?.tab} onClose={() => setOpen(null)} />
    </>
  )
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-full bg-primary/10 pl-2.5 pr-1 text-xs font-medium text-primary-text">
      {label}
      <button type="button" onClick={onClear} aria-label={`Remover filtro ${label}`} className="rounded-full p-0.5 hover:bg-primary/15">
        <X size={12} aria-hidden />
      </button>
    </span>
  )
}

function FiltersPopover({ value, onChange, tags }: { value: Filters; onChange: (f: Filters) => void; tags: string[] }) {
  const count = describeFilters(value).length
  return (
    <Popover
      width={340}
      title="Filtrar jogadores"
      trigger={(p) => (
        <Button {...p} size="sm" icon={ListFilter} className={count ? 'border-primary text-primary-text' : undefined}>
          Filtros
          {count > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-fg tnum">{count}</span>}
        </Button>
      )}
    >
      {(close) => (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[13px] font-medium text-fg">Origem</p>
            <div className="grid grid-cols-2 gap-2">
              {ORIGINS.map((o) => (
                <Checkbox
                  key={o}
                  label={o}
                  checked={value.origins.includes(o)}
                  onChange={(on) => onChange({ ...value, origins: on ? [...value.origins, o] : value.origins.filter((x) => x !== o) })}
                />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="KYC" htmlFor="flt-kyc">
              <Select
                id="flt-kyc"
                value={value.kyc}
                onChange={(v) => onChange({ ...value, kyc: v as Filters['kyc'] })}
                options={[{ value: 'todos', label: 'Todos' }, ...(Object.keys(KYC_LABEL) as KycStatus[]).map((k) => ({ value: k, label: KYC_LABEL[k] }))]}
              />
            </Field>
            <Field label="Etiqueta" htmlFor="flt-tag">
              <Select id="flt-tag" value={value.tag} onChange={(v) => onChange({ ...value, tag: v })} options={[{ value: '', label: 'Todas' }, ...tags.map((t) => ({ value: t, label: t }))]} />
            </Field>
          </div>
          <Field label="Faixa de saldo (real + bônus)" htmlFor="flt-band">
            <Select id="flt-band" value={value.band} onChange={(v) => onChange({ ...value, band: v as BalanceBand })} options={BALANCE_BANDS} />
          </Field>
          <div className="flex justify-between gap-2 border-t border-line pt-3">
            <Button size="sm" variant="ghost" onClick={() => onChange(NO_FILTERS)} disabled={count === 0}>
              Limpar filtros
            </Button>
            <Button size="sm" variant="primary" onClick={close}>
              Ver resultados
            </Button>
          </div>
        </div>
      )}
    </Popover>
  )
}
