import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ArrowRight, BadgeCheck, CircleDollarSign, Link2, ShieldCheck, UserPlus, UserRound, Users, Wallet } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  ChipFilter,
  DataTable,
  DescriptionList,
  Drawer,
  KpiCard,
  PageHeader,
  PersonCell,
  Select,
  Tooltip,
  type Column,
} from '@/components/ui'
import { brl, brlCompact, date, maskEmail, maskPhone, num, pct, plural, relative } from '@/lib/format'
import { useAffiliates, usePlayers } from '@/data/hooks'
import { KYC_LABEL, PLAYER_STATUS_LABEL, type Affiliate, type Player } from '@/data/players'
import { audit, usePageAccess } from '@/domain/session'
import { AffiliateTypeBadge, LevelBadge, StatTile, TYPE_META } from '@/pages/afiliados/_shared'

interface Lead {
  id: string
  player: Player
  affiliate: Affiliate | undefined
  manager: Affiliate | undefined
  level: 1 | 2
  balance: number
  deposited: boolean
}

type DepositFilter = 'todos' | 'sim' | 'nao'

export default function Indicados() {
  const { can } = usePageAccess()
  const { items: players } = usePlayers()
  const { items: affiliates } = useAffiliates()
  const [params, setParams] = useSearchParams()
  const affiliateId = params.get('afiliado') ?? ''
  const setAffiliateId = (v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set('afiliado', v)
    else next.delete('afiliado')
    setParams(next, { replace: true })
  }
  const [dep, setDep] = useState<DepositFilter>('todos')
  const [openId, setOpenId] = useState<string | null>(null)
  const canExport = can('usuarios.exportar')

  const affById = useMemo(() => new Map(affiliates.map((a) => [a.id, a])), [affiliates])

  const leads = useMemo<Lead[]>(
    () =>
      players
        .filter((p) => p.referrerId)
        .map((p) => {
          const affiliate = affById.get(p.referrerId!)
          const manager = affiliate?.managerId ? affById.get(affiliate.managerId) : undefined
          return {
            id: p.id,
            player: p,
            affiliate,
            manager,
            level: affiliate?.level ?? 1,
            balance: p.balanceReal + p.balanceBonus,
            deposited: p.depositsCount > 0,
          }
        }),
    [players, affById],
  )

  // afiliados que têm indicados (para o filtro), gerentes mostram a rede inteira
  const affiliateOptions = useMemo(() => {
    const count = new Map<string, number>()
    for (const l of leads) if (l.affiliate) count.set(l.affiliate.id, (count.get(l.affiliate.id) ?? 0) + 1)
    const managers = affiliates.filter((a) => a.type === 'Manager')
    const others = affiliates.filter((a) => count.has(a.id) || a.id === affiliateId).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    return [
      ...managers.map((m) => ({
        value: `rede:${m.id}`,
        label: `Rede de ${m.name} (gerente)`,
      })),
      ...others.map((a) => ({
        value: a.id,
        label: `${a.name} · ${a.code} (${count.get(a.id) ?? 0})`,
      })),
    ]
  }, [leads, affiliates, affiliateId])

  const byAffiliate = useMemo(() => {
    if (!affiliateId) return leads
    if (affiliateId.startsWith('rede:')) {
      const mid = affiliateId.slice(5)
      return leads.filter((l) => l.affiliate && (l.affiliate.id === mid || l.affiliate.managerId === mid))
    }
    return leads.filter((l) => l.affiliate?.id === affiliateId)
  }, [leads, affiliateId])

  const rows = dep === 'todos' ? byAffiliate : byAffiliate.filter((l) => l.deposited === (dep === 'sim'))

  const kpi = useMemo(() => {
    const depositors = byAffiliate.filter((l) => l.deposited)
    const total = byAffiliate.reduce((s, l) => s + l.player.totalDeposited, 0)
    const level2 = byAffiliate.filter((l) => l.level === 2).length
    const balance = byAffiliate.reduce((s, l) => s + l.balance, 0)
    const last30 = byAffiliate.filter((l) => Date.now() - new Date(l.player.createdAt).getTime() < 30 * 86_400_000).length
    return {
      count: byAffiliate.length,
      depositors: depositors.length,
      total,
      level2,
      balance,
      last30,
    }
  }, [byAffiliate])

  const columns: Column<Lead>[] = [
    {
      id: 'player',
      header: 'Jogador',
      pinned: true,
      minWidth: 220,
      sortValue: (l) => l.player.name,
      csv: (l) => l.player.name,
      cell: (l) => <PersonCell name={l.player.name} sub={`${maskEmail(l.player.email)} · ID ${l.player.id}`} />,
    },
    {
      id: 'email',
      header: 'E-mail (mascarado)',
      label: 'E-mail',
      defaultHidden: true,
      csv: (l) => maskEmail(l.player.email),
      cell: (l) => <span className="text-[13px] text-fg-2">{maskEmail(l.player.email)}</span>,
    },
    {
      id: 'affiliate',
      header: 'Quem indicou',
      minWidth: 200,
      sortValue: (l) => l.affiliate?.name ?? '',
      csv: (l) => (l.affiliate ? `${l.affiliate.name} (${l.affiliate.code})` : 'Afiliado removido'),
      cell: (l) =>
        l.affiliate ? (
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm font-medium text-fg">
              {l.affiliate.name}
              <AffiliateTypeBadge type={l.affiliate.type} />
            </p>
            <p className="truncate text-xs text-fg-3">
              <span className="font-mono">?ref={l.affiliate.code}</span>
              {l.manager && <> · rede de {l.manager.name}</>}
            </p>
          </div>
        ) : (
          <span className="text-xs text-fg-3">Afiliado removido</span>
        ),
    },
    {
      id: 'level',
      header: 'Nível',
      sortValue: (l) => l.level,
      csv: (l) => (l.level === 1 ? '1 (direto)' : '2 (subafiliado)'),
      cell: (l) => (
        <Tooltip
          content={l.level === 1 ? 'Indicado direto de um afiliado de nível 1' : `Indicado por subafiliado${l.manager ? ` da rede de ${l.manager.name}` : ''}`}
        >
          <LevelBadge level={l.level} />
        </Tooltip>
      ),
    },
    {
      id: 'deposited', money: true,
      header: 'Valor depositado',
      align: 'right',
      sortValue: (l) => l.player.totalDeposited,
      csv: (l) => l.player.totalDeposited,
      cell: (l) => (
        <div>
          <p className="font-semibold">{brl(l.player.totalDeposited)}</p>
          <p className="text-xs text-fg-3">{l.player.depositsCount ? plural(l.player.depositsCount, 'depósito', 'depósitos') : 'nenhum depósito'}</p>
        </div>
      ),
    },
    {
      id: 'balance', money: true,
      header: 'Saldo',
      align: 'right',
      sortValue: (l) => l.balance,
      csv: (l) => l.balance,
      cell: (l) => (
        <div>
          <p>{brl(l.balance)}</p>
          {l.player.balanceBonus > 0 && <p className="text-xs text-fg-3">{brl(l.player.balanceBonus)} bônus</p>}
        </div>
      ),
    },
    {
      id: 'createdAt',
      header: 'Cadastro',
      sortValue: (l) => l.player.createdAt,
      csv: (l) => date(l.player.createdAt),
      cell: (l) => (
        <div>
          <p className="text-[13px] text-fg">{date(l.player.createdAt)}</p>
          <p className="text-xs text-fg-3">{relative(l.player.createdAt)}</p>
        </div>
      ),
    },
    {
      id: 'didDeposit',
      header: 'Depositou?',
      align: 'center',
      sortValue: (l) => (l.deposited ? 1 : 0),
      csv: (l) => (l.deposited ? 'Sim' : 'Não'),
      cell: (l) =>
        l.deposited ? (
          <Badge tone="success" icon={BadgeCheck}>
            Sim
          </Badge>
        ) : (
          <Badge tone="neutral">Não</Badge>
        ),
    },
    {
      id: 'status',
      header: 'Status da conta',
      defaultHidden: true,
      sortValue: (l) => l.player.status,
      csv: (l) => PLAYER_STATUS_LABEL[l.player.status],
      cell: (l) => (
        <Badge tone={l.player.status === 'ativo' ? 'success' : l.player.status === 'bloqueado' ? 'danger' : 'warning'} dot>
          {PLAYER_STATUS_LABEL[l.player.status]}
        </Badge>
      ),
    },
  ]

  const open = openId ? leads.find((l) => l.id === openId) : undefined
  const convPct = kpi.count ? kpi.depositors / kpi.count : 0

  return (
    <>
      <PageHeader />

      <div className="space-y-5">
        <section aria-label="Resumo dos indicados" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Indicados"
            icon={UserPlus}
            value={num(kpi.count)}
            hint={`${num(kpi.last30)} em 30 dias · ${num(kpi.level2)} de nível 2`}
            formula={<>Jogadores cadastrados com o código de um afiliado (link ?ref=). Nível 2 = indicado por um subafiliado da rede de um gerente.</>}
          />
          <KpiCard
            label="Depositaram"
            icon={BadgeCheck}
            tone="success"
            value={num(kpi.depositors)}
            hint={`${pct(convPct, 0)} dos indicados`}
            formula={<>Indicados com pelo menos um depósito pago. A taxa é depositantes ÷ indicados.</>}
          />
          <KpiCard
            label="Valor depositado"
            icon={ArrowDownToLine}
            tone="info"
            value={brlCompact(kpi.total)}
            hint={`ticket ${brl(kpi.depositors ? kpi.total / kpi.depositors : 0)} por depositante`}
            formula={<>Soma de tudo o que os indicados já depositaram (PIX pagos), desde o cadastro.</>}
          />
          <KpiCard
            label="Saldo dos indicados"
            icon={Wallet}
            tone="neutral"
            value={brlCompact(kpi.balance)}
            hint="real + bônus, em carteira hoje"
            formula={<>Saldo real mais saldo bônus dos indicados agora. É dinheiro que pode virar saque.</>}
          />
        </section>

        <Alert tone="info" icon={ShieldCheck} title="Dados pessoais protegidos (LGPD)">
          O e-mail aparece mascarado na lista e no CSV. A busca aceita o e-mail completo, mas não o revela. Exportar exige a permissão “Exportar jogadores” e
          fica registrado na auditoria.
        </Alert>

        <DataTable
          caption="Jogadores indicados por afiliados"
          rows={rows}
          columns={columns}
          rowKey={(l) => l.id}
          searchText={(l) => `${l.player.name} ${l.player.email} ${l.player.nickname}`}
          searchPlaceholder="Buscar por nome ou e-mail"
          initialSort={{ id: 'createdAt', dir: 'desc' }}
          exportName="indicados"
          canExport={canExport}
          onExport={(n) => audit('exportar', 'Indicados', `Exportação CSV de ${n} indicados (e-mails mascarados)`)}
          onRowClick={(l) => setOpenId(l.id)}
          resetKey={`${affiliateId}|${dep}`}
          toolbar={
            <>
              <Select
                aria-label="Filtrar por afiliado"
                value={affiliateId}
                onChange={setAffiliateId}
                placeholder="Todos os afiliados"
                options={affiliateOptions}
                className="w-full sm:w-64"
              />
              <ChipFilter<DepositFilter>
                value={dep}
                onChange={setDep}
                options={[
                  { value: 'todos', label: 'Todos', count: byAffiliate.length },
                  { value: 'sim', label: 'Depositaram', count: kpi.depositors },
                  {
                    value: 'nao',
                    label: 'Não depositaram',
                    count: byAffiliate.length - kpi.depositors,
                    tone: 'warning',
                  },
                ]}
              />
            </>
          }
          empty={{
            icon: Users,
            title: 'Nenhum indicado neste filtro',
            description: 'Troque o afiliado ou o filtro de depósito para ver outros jogadores.',
            action: (
              <Button
                size="sm"
                onClick={() => {
                  setAffiliateId('')
                  setDep('todos')
                }}
              >
                Limpar filtros
              </Button>
            ),
          }}
        />
      </div>

      <LeadDrawer lead={open} onClose={() => setOpenId(null)} />
    </>
  )
}

function LeadDrawer({ lead, onClose }: { lead: Lead | undefined; onClose: () => void }) {
  if (!lead) return null
  const p = lead.player
  const ggr = p.totalBet - p.totalWon
  return (
    <Drawer
      open
      onClose={onClose}
      title={p.name}
      description={`Indicado em ${date(p.createdAt)} · ${relative(p.createdAt)}`}
      headerExtra={
        lead.deposited ? (
          <Badge tone="success" icon={BadgeCheck} size="md">
            Depositou
          </Badge>
        ) : (
          <Badge tone="neutral" size="md">
            Sem depósito
          </Badge>
        )
      }
    >
      <div className="space-y-6">
        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Caminho da indicação</h3>
          <ol className="flex flex-col gap-1.5">
            {lead.manager && (
              <>
                <ChainStep icon={TYPE_META.Manager.icon} title={lead.manager.name} sub={`Gerente · ${lead.manager.code}`} />
                <ChainArrow />
              </>
            )}
            {lead.affiliate ? (
              <ChainStep
                icon={TYPE_META[lead.affiliate.type].icon}
                title={lead.affiliate.name}
                sub={`${TYPE_META[lead.affiliate.type].label} · nível ${lead.affiliate.level}`}
              />
            ) : (
              <ChainStep icon={Link2} title="Afiliado removido" sub="o vínculo continua no cadastro" />
            )}
            <ChainArrow />
            <ChainStep icon={UserRound} title={p.nickname} sub="jogador indicado" highlight />
          </ol>
          {lead.affiliate && (
            <p className="mt-3 text-[13px] text-fg-3">
              Cadastro pelo link <span className="font-mono text-fg-2">x2win.bet.br/?ref={lead.affiliate.code}</span>.{' '}
              <Link to={`/analysis/links?afiliado=${lead.affiliate.id}`} className="link">
                Ver desempenho do link
              </Link>
            </p>
          )}
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Resultado do jogador</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Depositado" value={brl(p.totalDeposited)} sub={plural(p.depositsCount, 'depósito', 'depósitos')} />
            <StatTile label="Sacado" value={brl(p.totalWithdrawn)} />
            <StatTile label="GGR gerado" value={brl(ggr)} sub="apostado − ganho" />
            <StatTile label="Saldo real" value={brl(p.balanceReal)} />
            <StatTile label="Saldo bônus" value={brl(p.balanceBonus)} />
            <StatTile label="Primeiro depósito" value={p.firstDepositAt ? date(p.firstDepositAt) : '—'} />
          </div>
        </section>

        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
            Cadastro{' '}
            <Badge tone="neutral" icon={ShieldCheck}>
              dados mascarados
            </Badge>
          </h3>
          <DescriptionList
            items={[
              { label: 'ID', value: p.id },
              { label: 'Apelido', value: p.nickname },
              { label: 'E-mail', value: maskEmail(p.email) },
              { label: 'Celular', value: maskPhone(p.phone) },
              { label: 'Cidade', value: `${p.city}/${p.uf}` },
              { label: 'Status', value: PLAYER_STATUS_LABEL[p.status] },
              { label: 'KYC', value: KYC_LABEL[p.kyc] },
              { label: 'Último acesso', value: relative(p.lastAccess) },
            ]}
          />
          <p className="mt-3 text-xs text-fg-3">
            Dados completos ficam na ficha do jogador, em{' '}
            <Link to="/dashboard/usuarios" className="link">
              Usuários
            </Link>
            , para cargos com a permissão de ver dados pessoais.
          </p>
        </section>

        <section className="rounded-xl border border-line p-3.5">
          <div className="flex items-start gap-2 text-[13px] leading-5 text-fg-2">
            <CircleDollarSign size={15} className="mt-0.5 shrink-0 text-fg-3" aria-hidden />
            <p className="min-w-0">
              {lead.affiliate ? (
                <>
                  Este jogador gera comissão para <strong className="text-fg">{lead.affiliate.name}</strong> conforme a regra do tipo{' '}
                  {TYPE_META[lead.affiliate.type].label} em{' '}
                  <Link to="/system/affiliates" className="link">
                    Comissões
                  </Link>
                  .
                </>
              ) : (
                'Sem afiliado ativo: o jogador não gera comissão.'
              )}
            </p>
          </div>
        </section>
      </div>
    </Drawer>
  )
}

function ChainArrow() {
  return (
    <li aria-hidden className="flex h-4 items-center pl-[22px] text-fg-3">
      <ArrowRight size={14} className="rotate-90" />
    </li>
  )
}

function ChainStep({ icon: Icon, title, sub, highlight }: { icon: typeof UserRound; title: string; sub: string; highlight?: boolean }) {
  return (
    <li
      className={`flex min-w-0 items-center gap-2.5 rounded-xl border px-2.5 py-2 ${highlight ? 'border-primary/40 bg-primary/5' : 'border-line bg-surface-2'}`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${highlight ? 'bg-primary/15 text-primary-text' : 'bg-surface-3 text-fg-2'}`}
      >
        <Icon size={15} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-fg">{title}</span>
        <span className="block truncate text-xs text-fg-3">{sub}</span>
      </span>
    </li>
  )
}
