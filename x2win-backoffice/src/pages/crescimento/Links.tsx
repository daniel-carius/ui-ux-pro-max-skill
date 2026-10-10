import { useMemo, useState, type ReactNode } from 'react'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, BadgeCheck, Copy, ExternalLink, Link2, Lock, Pause, Play, RefreshCw, TriangleAlert, UserPlus, Users } from 'lucide-react'
import { BarsChart, DonutChart } from '@/components/charts'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ChipFilter,
  CopyButton,
  DataTable,
  DescriptionList,
  Drawer,
  EmptyState,
  Field,
  FormGrid,
  Input,
  KpiCard,
  Mono,
  PageHeader,
  PersonCell,
  Select,
  confirm,
  confirmWithInput,
  toast,
  type Column,
} from '@/components/ui'
import { brl, brlCompact, date, dateTime, maskEmail, num, pct, relative } from '@/lib/format'
import { useDb } from '@/lib/store'
import { useAffiliates, usePlayers } from '@/data/hooks'
import { SEED_LINK_STATE, type LinkState } from '@/data/afiliados'
import type { Affiliate, Player } from '@/data/players'
import { audit, usePageAccess, useSession } from '@/domain/session'
import { AFILIADOS_KEYS, REVEAL_PAYOUT_PERMISSION, duplicateCodes, makeAffiliateCode, referralLink } from '@/domain/afiliados'
import { AffiliateContact, AffiliateTypeBadge, LevelBadge, MiniBar, StatTile, TYPE_META } from '@/pages/afiliados/_shared'

type LinkStatus = 'ativo' | 'pausado' | 'afiliado_pausado'

interface LinkRow {
  id: string
  affiliate: Affiliate
  manager: Affiliate | undefined
  url: string
  signups: number
  depositors: number
  deposited: number
  conversion: number
  status: LinkStatus
  state: LinkState | undefined
  duplicate: boolean
  recent: Player[]
}

const STATUS_LABEL: Record<LinkStatus, string> = { ativo: 'Ativo', pausado: 'Pausado', afiliado_pausado: 'Afiliado pausado' }
const STATUS_TONE = { ativo: 'success', pausado: 'warning', afiliado_pausado: 'neutral' } as const

const PAUSE_REASONS = [
  'Tráfego suspeito (cliques sem cadastro)',
  'Pedido do afiliado',
  'Revisão de contrato',
  'Divulgação fora das regras de publicidade',
  'Outro motivo',
].map((r) => ({ value: r, label: r }))

type StatusFilter = 'todos' | 'ativo' | 'pausado'

export default function Links() {
  const { can } = usePageAccess()
  const { user } = useSession()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { items: affiliates, update: updateAffiliate } = useAffiliates()
  const { items: players } = usePlayers()
  const [linkState, setLinkState] = useDb<Record<string, LinkState>>(AFILIADOS_KEYS.links, SEED_LINK_STATE)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos')
  const [openId, setOpenId] = useState<string | null>(null)
  const affiliateFilter = params.get('afiliado') ?? ''
  const setAffiliateFilter = (v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set('afiliado', v)
    else next.delete('afiliado')
    setParams(next, { replace: true })
  }

  // pausar link não tem permissão própria: vale a de editar Comissões (mesmo módulo)
  const canManage = can('comissoes.editar')
  const lockedTitle = canManage ? undefined : 'Seu cargo não pode pausar links (exige editar Comissões)'

  const dups = useMemo(() => duplicateCodes(affiliates), [affiliates])

  const rows = useMemo<LinkRow[]>(() => {
    const byRef = new Map<string, Player[]>()
    for (const p of players) {
      if (!p.referrerId) continue
      byRef.set(p.referrerId, [...(byRef.get(p.referrerId) ?? []), p])
    }
    const byId = new Map(affiliates.map((a) => [a.id, a]))
    return affiliates.map((a) => {
      const refs = byRef.get(a.id) ?? []
      const depositors = refs.filter((p) => p.depositsCount > 0)
      const state = linkState[a.id]
      const status: LinkStatus = a.status === 'pausado' ? 'afiliado_pausado' : state?.paused ? 'pausado' : 'ativo'
      return {
        id: a.id,
        affiliate: a,
        manager: a.managerId ? byId.get(a.managerId) : undefined,
        url: referralLink(a.code),
        signups: refs.length,
        depositors: depositors.length,
        deposited: Math.round(refs.reduce((s, p) => s + p.totalDeposited, 0) * 100) / 100,
        conversion: refs.length ? depositors.length / refs.length : 0,
        status,
        state,
        duplicate: dups.has(a.code.toUpperCase()),
        recent: [...refs].sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 5),
      }
    })
  }, [affiliates, players, linkState, dups])

  const affiliateOptions = useMemo(
    () => [
      ...affiliates.filter((a) => a.type === 'Manager').map((m) => ({ value: `rede:${m.id}`, label: `Rede de ${m.name} (gerente)` })),
      ...[...affiliates].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map((a) => ({ value: a.id, label: `${a.name} · ${a.code}` })),
    ],
    [affiliates],
  )

  const byAffiliate = useMemo(() => {
    if (!affiliateFilter) return rows
    if (affiliateFilter.startsWith('rede:')) {
      const mid = affiliateFilter.slice(5)
      return rows.filter((r) => r.id === mid || r.affiliate.managerId === mid)
    }
    return rows.filter((r) => r.id === affiliateFilter)
  }, [rows, affiliateFilter])

  const visible = statusFilter === 'todos' ? byAffiliate : byAffiliate.filter((r) => (statusFilter === 'ativo' ? r.status === 'ativo' : r.status !== 'ativo'))

  const totals = useMemo(() => {
    const active = byAffiliate.filter((r) => r.status === 'ativo')
    const signups = byAffiliate.reduce((s, r) => s + r.signups, 0)
    const depositors = byAffiliate.reduce((s, r) => s + r.depositors, 0)
    const deposited = byAffiliate.reduce((s, r) => s + r.deposited, 0)
    return { active: active.length, paused: byAffiliate.length - active.length, signups, depositors, deposited }
  }, [byAffiliate])

  const top = useMemo(
    () =>
      [...byAffiliate]
        .filter((r) => r.deposited > 0)
        .sort((a, b) => b.deposited - a.deposited)
        .slice(0, 8)
        .map((r) => ({ code: r.affiliate.code, deposited: r.deposited })),
    [byAffiliate],
  )

  const statusCounts = useMemo(() => {
    const c = { ativo: 0, pausado: 0, afiliado_pausado: 0 }
    for (const r of byAffiliate) c[r.status]++
    return c
  }, [byAffiliate])

  // ---------- ações ----------

  const pause = async (r: LinkRow) => {
    const res = await confirmWithInput({
      title: `Pausar o link de ${r.affiliate.name}?`,
      description: 'Cadastros feitos por este link deixam de ser atribuídos ao afiliado. Os jogadores já indicados continuam vinculados e gerando comissão.',
      confirmLabel: 'Pausar link',
      tone: 'warning',
      icon: Pause,
      input: { label: 'Motivo', required: true, options: PAUSE_REASONS },
      details: <p className="rounded-lg bg-surface-2 px-3 py-2 font-mono text-[12.5px] text-fg-2">{r.url.replace('https://', '')}</p>,
    })
    if (!res.confirmed) return
    setLinkState((prev) => ({ ...prev, [r.id]: { paused: true, at: new Date().toISOString(), by: user.name, reason: res.value } }))
    audit('desligar', `Link ?ref=${r.affiliate.code}`, `Link de ${r.affiliate.name} pausado: ${res.value}`)
    toast.success('Link pausado', { description: `?ref=${r.affiliate.code} não atribui novos cadastros.` })
  }

  const activate = async (r: LinkRow) => {
    const ok = await confirm({
      title: `Reativar o link de ${r.affiliate.name}?`,
      description: 'Novos cadastros por este link voltam a ser atribuídos ao afiliado.',
      confirmLabel: 'Reativar link',
      tone: 'success',
      icon: Play,
    })
    if (!ok) return
    setLinkState((prev) => ({ ...prev, [r.id]: { paused: false, at: new Date().toISOString(), by: user.name } }))
    audit('ligar', `Link ?ref=${r.affiliate.code}`, `Link de ${r.affiliate.name} reativado`)
    toast.success('Link reativado')
  }

  const regenerate = async (r: LinkRow) => {
    const code = makeAffiliateCode(
      r.affiliate.name + r.affiliate.id,
      affiliates.map((a) => a.code),
    )
    const ok = await confirm({
      title: `Gerar novo código para ${r.affiliate.name}?`,
      description: 'O link antigo deixa de atribuir cadastros. Avise o afiliado para trocar o link nas divulgações.',
      confirmLabel: 'Trocar código',
      tone: 'warning',
      icon: RefreshCw,
      details: (
        <DescriptionList
          columns={2}
          items={[
            { label: 'Código atual', value: <Mono>{r.affiliate.code}</Mono> },
            { label: 'Novo código', value: <Mono className="font-semibold text-fg">{code}</Mono> },
          ]}
        />
      ),
    })
    if (!ok) return
    updateAffiliate(r.id, { code })
    audit('editar', `Link de ${r.affiliate.name}`, `Código de indicação trocado de ${r.affiliate.code} para ${code}`)
    toast.success('Código trocado', { description: `Novo link: x2win.bet.br/?ref=${code}` })
  }

  const copy = async (r: LinkRow) => {
    try {
      await navigator.clipboard.writeText(r.url)
    } catch {
      /* sem permissão */
    }
    toast.success('Link copiado', { description: r.url })
  }

  const toggleButton = (r: LinkRow, size: 'sm' | 'md' = 'sm') =>
    r.status === 'afiliado_pausado' ? (
      <Button size={size} disabled title="O afiliado está pausado no programa. Reative o afiliado para usar o link.">
        Indisponível
      </Button>
    ) : r.status === 'pausado' ? (
      <Button size={size} variant="soft" icon={Play} onClick={() => activate(r)} disabled={!canManage} title={lockedTitle}>
        Ativar
      </Button>
    ) : (
      <Button size={size} icon={Pause} onClick={() => pause(r)} disabled={!canManage} title={lockedTitle}>
        Pausar
      </Button>
    )

  const maxConv = Math.max(0.0001, ...byAffiliate.map((r) => r.conversion))

  const columns: Column<LinkRow>[] = [
    {
      id: 'affiliate',
      header: 'Afiliado',
      pinned: true,
      minWidth: 220,
      sortValue: (r) => r.affiliate.name,
      csv: (r) => r.affiliate.name,
      cell: (r) => (
        <PersonCell
          name={r.affiliate.name}
          sub={
            <span className="inline-flex items-center gap-1">
              {TYPE_META[r.affiliate.type].label}
              {r.manager && <> · rede de {r.manager.name.split(' ')[0]}</>}
            </span>
          }
        />
      ),
    },
    {
      id: 'level',
      header: 'Nível',
      sortValue: (r) => r.affiliate.level,
      csv: (r) => r.affiliate.level,
      cell: (r) => <LevelBadge level={r.affiliate.level} />,
    },
    {
      id: 'link',
      header: 'Link',
      minWidth: 170,
      sortValue: (r) => r.affiliate.code,
      csv: (r) => r.url,
      cell: (r) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <span className="min-w-0">
            <Mono className={r.status === 'ativo' ? 'block font-medium text-fg' : 'block text-fg-3 line-through decoration-fg-3/50'}>
              ?ref={r.affiliate.code}
            </Mono>
            <span className="block text-[11px] text-fg-3">x2win.bet.br</span>
          </span>
          {r.duplicate && (
            <Badge tone="danger" icon={TriangleAlert}>
              duplicado
            </Badge>
          )}
          <CopyButton value={r.url} label={`Copiar link de ${r.affiliate.name}`} />
        </div>
      ),
    },
    { id: 'signups', header: 'Cadastros', align: 'right', sortValue: (r) => r.signups, cell: (r) => num(r.signups) },
    { id: 'depositors', header: 'Depositaram', align: 'right', sortValue: (r) => r.depositors, cell: (r) => num(r.depositors) },
    {
      id: 'deposited', money: true,
      header: 'Valor depositado',
      align: 'right',
      sortValue: (r) => r.deposited,
      csv: (r) => r.deposited,
      cell: (r) => <span className="font-semibold">{brl(r.deposited)}</span>,
    },
    {
      id: 'conversion',
      header: 'Conversão',
      align: 'right',
      minWidth: 120,
      sortValue: (r) => r.conversion,
      csv: (r) => pct(r.conversion),
      cell: (r) =>
        r.signups ? (
          <div className="ml-auto w-24">
            <p className="text-[13px] font-medium text-fg">{pct(r.conversion, 0)}</p>
            <MiniBar value={r.conversion} max={maxConv} slot={3} className="mt-1" label={`Conversão ${pct(r.conversion, 0)}`} />
          </div>
        ) : (
          <span className="text-xs text-fg-3">sem cadastros</span>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (r) => r.status,
      csv: (r) => STATUS_LABEL[r.status],
      cell: (r) => (
        <Badge tone={STATUS_TONE[r.status]} dot>
          {STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    {
      id: 'action',
      header: 'Ação',
      pinned: true,
      csv: false,
      cell: (r) => <div onClick={(e) => e.stopPropagation()}>{toggleButton(r)}</div>,
    },
  ]

  const open = openId ? rows.find((r) => r.id === openId) : undefined
  const dupList = [...dups.entries()]

  return (
    <>
      <PageHeader />

      <div className="space-y-5">
        <section aria-label="Resumo dos links" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Links ativos"
            icon={Link2}
            value={`${num(totals.active)} de ${num(byAffiliate.length)}`}
            hint={totals.paused ? `${num(totals.paused)} pausados ou de afiliado pausado` : 'nenhum pausado'}
            formula={<>Um link por afiliado, no formato x2win.bet.br/?ref=CÓDIGO. Link pausado não atribui novos cadastros.</>}
          />
          <KpiCard
            label="Cadastros"
            icon={UserPlus}
            tone="info"
            value={num(totals.signups)}
            hint={`média de ${(byAffiliate.length ? totals.signups / byAffiliate.length : 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} por link`}
            formula={<>Jogadores que se cadastraram com o código do link, desde a criação do link.</>}
          />
          <KpiCard
            label="Depositaram"
            icon={BadgeCheck}
            tone="success"
            value={num(totals.depositors)}
            hint={`conversão de ${pct(totals.signups ? totals.depositors / totals.signups : 0, 0)}`}
            formula={<>Conversão = jogadores que depositaram ÷ cadastros do link.</>}
          />
          <KpiCard
            label="Valor depositado"
            icon={ArrowDownToLine}
            tone="primary"
            value={brlCompact(totals.deposited)}
            hint={`${brl(totals.depositors ? totals.deposited / totals.depositors : 0)} por depositante`}
            formula={<>Soma dos depósitos pagos dos jogadores vindos de cada link.</>}
          />
        </section>

        {!canManage && (
          <Alert tone="neutral" icon={Lock}>
            Seu cargo pode ver e copiar os links, mas não pausar, reativar ou trocar códigos. Isso exige a permissão de editar Comissões.
          </Alert>
        )}

        {dupList.length > 0 && (
          <Alert
            tone="danger"
            title={`${dupList.length === 1 ? 'Um código está' : `${dupList.length} códigos estão`} em mais de um link`}
            action={
              <Button
                size="sm"
                icon={RefreshCw}
                disabled={!canManage}
                title={lockedTitle}
                onClick={() => {
                  const [, list] = dupList[0]
                  const newest = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
                  const row = rows.find((r) => r.id === newest.id)
                  if (row) regenerate(row)
                }}
              >
                Corrigir o mais recente
              </Button>
            }
          >
            {dupList.map(([code, list]) => (
              <span key={code} className="block">
                <Mono className="font-semibold text-fg">?ref={code}</Mono> é usado por {list.map((a) => a.name).join(' e ')}. O cadastro pode ser atribuído ao
                afiliado errado. Gere um código novo para um deles.
              </span>
            ))}
          </Alert>
        )}

        <div className="grid gap-5 xl:grid-cols-5">
          <Card className="min-w-0 xl:col-span-3">
            <CardHeader title="Top links por valor depositado" description="Os 8 links que mais trouxeram depósitos" />
            <CardBody>
              {top.length ? (
                <BarsChart
                  ariaLabel="Valor depositado pelos jogadores de cada link"
                  data={top}
                  xKey="code"
                  layout="horizontal"
                  format="brl"
                  categoryWidth={78}
                  height={Math.max(160, top.length * 34)}
                  series={[{ key: 'deposited', label: 'Valor depositado', slot: 1 }]}
                />
              ) : (
                <EmptyState icon={Link2} title="Sem depósitos neste filtro" description="Nenhum link do filtro trouxe jogadores que depositaram." />
              )}
            </CardBody>
          </Card>
          <Card className="min-w-0 xl:col-span-2">
            <CardHeader title="Situação dos links" description="Ativos, pausados pela equipe e de afiliados pausados" />
            <CardBody className="space-y-4">
              <DonutChart
                ariaLabel="Situação dos links"
                height={150}
                centerValue={num(byAffiliate.length)}
                centerLabel="links"
                data={[
                  { label: 'Ativos', value: statusCounts.ativo, slot: 3 },
                  { label: 'Pausados pela equipe', value: statusCounts.pausado, slot: 4 },
                  { label: 'Afiliado pausado', value: statusCounts.afiliado_pausado, slot: 8 },
                ]}
              />
              {byAffiliate.some((r) => r.status === 'pausado') && (
                <ul className="divide-y divide-line border-t border-line">
                  {byAffiliate
                    .filter((r) => r.status === 'pausado')
                    .slice(0, 3)
                    .map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 last:pb-0">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-fg">
                            {r.affiliate.name} <span className="font-mono text-xs font-normal text-fg-3">?ref={r.affiliate.code}</span>
                          </p>
                          <p className="truncate text-xs text-fg-3">
                            {r.state?.reason ?? 'Pausado'} · {r.state ? relative(r.state.at) : ''}
                          </p>
                        </div>
                        <Button size="xs" variant="soft" icon={Play} onClick={() => activate(r)} disabled={!canManage} title={lockedTitle}>
                          Ativar
                        </Button>
                      </li>
                    ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <DataTable
          caption="Links de indicação por afiliado"
          className="relative"
          rows={visible}
          columns={columns}
          rowKey={(r) => r.id}
          searchText={(r) => `${r.affiliate.name} ${r.affiliate.code} ${r.affiliate.email}`}
          searchPlaceholder="Buscar por afiliado ou código"
          initialSort={{ id: 'deposited', dir: 'desc' }}
          exportName="links-indicacao"
          onExport={(n) => audit('exportar', 'Links', `Exportação CSV de ${n} links de indicação`)}
          onRowClick={(r) => setOpenId(r.id)}
          resetKey={`${affiliateFilter}|${statusFilter}`}
          rowActions={(r) => [
            { label: 'Copiar link', icon: Copy, onSelect: () => copy(r) },
            { label: 'Abrir no site', icon: ExternalLink, onSelect: () => window.open(r.url, '_blank', 'noopener,noreferrer') },
            { label: 'Ver indicados', icon: Users, onSelect: () => navigate(`/analysis/leads?afiliado=${r.id}`) },
            { divider: true },
            r.status === 'pausado'
              ? { label: 'Ativar link', icon: Play, onSelect: () => activate(r), disabled: !canManage }
              : { label: 'Pausar link', icon: Pause, onSelect: () => pause(r), disabled: !canManage || r.status === 'afiliado_pausado' },
            { label: 'Gerar novo código', icon: RefreshCw, onSelect: () => regenerate(r), disabled: !canManage },
          ]}
          toolbar={
            <>
              <Select
                aria-label="Filtrar por afiliado"
                value={affiliateFilter}
                onChange={setAffiliateFilter}
                placeholder="Todos os afiliados"
                options={affiliateOptions}
                className="w-full sm:w-64"
              />
              <ChipFilter<StatusFilter>
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: 'todos', label: 'Todos', count: byAffiliate.length },
                  { value: 'ativo', label: 'Ativos', count: statusCounts.ativo },
                  { value: 'pausado', label: 'Pausados', count: statusCounts.pausado + statusCounts.afiliado_pausado, tone: 'warning' },
                ]}
              />
            </>
          }
          empty={{
            icon: Link2,
            title: 'Nenhum link neste filtro',
            description: 'Troque o afiliado ou o status para ver outros links.',
            action: (
              <Button
                size="sm"
                onClick={() => {
                  setAffiliateFilter('')
                  setStatusFilter('todos')
                }}
              >
                Limpar filtros
              </Button>
            ),
          }}
        />
      </div>

      {open && <LinkDrawer row={open} onClose={() => setOpenId(null)} action={toggleButton(open, 'md')} />}
    </>
  )
}

function LinkDrawer({ row, onClose, action }: { row: LinkRow; onClose: () => void; action: ReactNode }) {
  const { can } = useSession()
  const [utm, setUtm] = useState({ source: '', campaign: '' })
  const slug = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-|-$/g, '')
  const tagged = (() => {
    const q = new URLSearchParams()
    if (slug(utm.source)) q.set('utm_source', slug(utm.source))
    if (slug(utm.campaign)) q.set('utm_campaign', slug(utm.campaign))
    const extra = q.toString()
    return extra ? `${row.url}&${extra}` : row.url
  })()
  const a = row.affiliate
  return (
    <Drawer
      open
      onClose={onClose}
      title={`Link de ${a.name}`}
      description={`Afiliado desde ${date(a.createdAt)} · ${maskEmail(a.email)}`}
      headerExtra={
        <Badge tone={STATUS_TONE[row.status]} dot size="md">
          {STATUS_LABEL[row.status]}
        </Badge>
      }
      footer={action}
    >
      <div className="space-y-6">
        <section className="rounded-xl border border-line bg-surface-2 p-4">
          <div className="flex items-center gap-2">
            <AffiliateTypeBadge type={a.type} />
            <LevelBadge level={a.level} />
            {row.duplicate && (
              <Badge tone="danger" icon={TriangleAlert}>
                código duplicado
              </Badge>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Mono className="min-w-0 flex-1 break-all text-[13px] text-fg">{row.url}</Mono>
            <CopyButton value={row.url} label="Copiar link" />
          </div>
          {row.manager && <p className="mt-2 text-xs text-fg-3">Faz parte da rede do gerente {row.manager.name}.</p>}
        </section>

        <AffiliateContact key={a.id} affiliate={a} canReveal={can(REVEAL_PAYOUT_PERMISSION)} />

        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Desempenho do link</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Cadastros" value={num(row.signups)} />
            <StatTile label="Depositaram" value={num(row.depositors)} />
            <StatTile label="Conversão" value={pct(row.conversion, 0)} />
            <StatTile label="Depositado" value={brlCompact(row.deposited)} />
          </div>
        </section>

        <section>
          <h3 className="mb-1 text-sm font-semibold text-fg">Link com campanha</h3>
          <p className="mb-3 text-[13px] text-fg-3">Monte uma versão do link com UTM para medir cada divulgação. O código do afiliado continua o mesmo.</p>
          <FormGrid>
            <Field label="Origem (utm_source)" htmlFor="utm-source" hint="Ex.: instagram, telegram, youtube">
              <Input id="utm-source" value={utm.source} onChange={(e) => setUtm((u) => ({ ...u, source: e.target.value }))} placeholder="instagram" />
            </Field>
            <Field label="Campanha (utm_campaign)" htmlFor="utm-campaign" hint="Ex.: copa-2026, live-sexta">
              <Input id="utm-campaign" value={utm.campaign} onChange={(e) => setUtm((u) => ({ ...u, campaign: e.target.value }))} placeholder="live-sexta" />
            </Field>
          </FormGrid>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-2">
            <Mono className="min-w-0 flex-1 break-all">{tagged}</Mono>
            <CopyButton value={tagged} label="Copiar link com campanha" />
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Últimos indicados</h3>
          {row.recent.length ? (
            <ul className="divide-y divide-line">
              {row.recent.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                  <PersonCell name={p.name} sub={`${maskEmail(p.email)} · ${relative(p.createdAt)}`} />
                  {p.depositsCount > 0 ? (
                    <span className="shrink-0 text-[13px] font-semibold text-fg tnum">{brl(p.totalDeposited)}</span>
                  ) : (
                    <Badge tone="neutral">sem depósito</Badge>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg bg-surface-2 px-3 py-3 text-[13px] text-fg-3">Ninguém se cadastrou por este link ainda.</p>
          )}
          <RouterLink to={`/analysis/leads?afiliado=${a.id}`} className="link mt-3 inline-block text-[13px]">
            Ver todos os indicados
          </RouterLink>
        </section>

        {row.state && (
          <section>
            <h3 className="mb-3 text-sm font-semibold text-fg">Última mudança de status</h3>
            <DescriptionList
              items={[
                { label: row.state.paused ? 'Pausado por' : 'Reativado por', value: row.state.by },
                { label: 'Em', value: dateTime(row.state.at) },
                ...(row.state.reason ? [{ label: 'Motivo', value: row.state.reason, full: true }] : []),
              ]}
            />
          </section>
        )}
      </div>
    </Drawer>
  )
}
