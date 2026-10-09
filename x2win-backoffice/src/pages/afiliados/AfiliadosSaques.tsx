import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, CalendarClock, Check, CheckCircle2, Clock, Eye, EyeOff, Hourglass, ListChecks, Lock, ShieldCheck, TriangleAlert, X, XCircle } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  Drawer,
  IconButton,
  KpiCard,
  Mono,
  PageHeader,
  PersonCell,
  Tabs,
  Tooltip,
  confirm,
  confirmWithInput,
  inRange,
  presetRange,
  toast,
  useTabParam,
  type Column,
  type Tone,
} from '@/components/ui'
import { brl, brlCompact, cpf, dateTime, num, phone, relative } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useAffiliates } from '@/data/hooks'
import {
  AFFILIATE_REJECT_REASONS,
  AFFILIATE_WITHDRAWAL_STATUS_LABEL,
  PAYOUT_METHOD_LABEL,
  type AffiliateWithdrawal,
  type AffiliateWithdrawalStatus,
} from '@/data/afiliados'
import type { Affiliate } from '@/data/players'
import { audit, useSession } from '@/domain/session'
import {
  addBusinessDays,
  isLate,
  maskAccount,
  maskPixKey,
  payAffiliateWithdrawal,
  rejectAffiliateWithdrawal,
  useAffiliateWithdrawals,
  useProgramConfig,
  withdrawalIssues,
} from '@/domain/afiliados'
import { MethodBadge, StatTile, TYPE_META } from './_shared'

const STATUS_TONE: Record<AffiliateWithdrawalStatus, Tone> = { pendente: 'warning', pago: 'success', recusado: 'danger' }
const TABS = ['pendentes', 'pagos', 'recusados', 'todos'] as const
type TabV = (typeof TABS)[number]
const TAB_STATUS: Record<TabV, AffiliateWithdrawalStatus | null> = { pendentes: 'pendente', pagos: 'pago', recusados: 'recusado', todos: null }

/** Destino do pagamento, mascarado ou completo. */
function destination(w: AffiliateWithdrawal, revealed: boolean) {
  if (w.method === 'pix') {
    const key = revealed
      ? w.pixKeyType === 'CPF'
        ? cpf(w.pixKey ?? '')
        : w.pixKeyType === 'Celular'
          ? phone(w.pixKey ?? '')
          : w.pixKey
      : maskPixKey(w.pixKeyType, w.pixKey)
    return { label: `Chave ${w.pixKeyType}`, value: key ?? '—' }
  }
  if (w.method === 'ted' && w.bank) {
    return {
      label: `${w.bank.bank} · Ag. ${revealed ? w.bank.agency : `••${w.bank.agency.slice(-2)}`}`,
      value: `C/C ${revealed ? w.bank.account : maskAccount(w.bank.account)}`,
    }
  }
  return { label: 'Conta de jogador', value: 'Saldo real do jogo' }
}

export default function AfiliadosSaques() {
  const { can, role, user } = useSession()
  const { items } = useAffiliateWithdrawals()
  const { items: affiliates } = useAffiliates()
  const cfg = useProgramConfig()
  const [tab, setTab] = useTabParam<TabV>('pendentes', TABS)
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const canDecide = can('afiliados-saques.aprovar')
  const canReveal = can('afiliados-saques.ver-pix')
  const affById = useMemo(() => new Map(affiliates.map((a) => [a.id, a])), [affiliates])

  const now = new Date()
  const month = presetRange('mes')
  const counts = useMemo(() => {
    const c = { pendentes: 0, pagos: 0, recusados: 0, todos: items.length }
    for (const w of items) {
      if (w.status === 'pendente') c.pendentes++
      else if (w.status === 'pago') c.pagos++
      else c.recusados++
    }
    return c
  }, [items])
  const rows = TAB_STATUS[tab] ? items.filter((w) => w.status === TAB_STATUS[tab]) : items

  const pending = items.filter((w) => w.status === 'pendente')
  const late = pending.filter((w) => isLate(w, cfg, now))
  const paidMonth = items.filter((w) => w.status === 'pago' && w.decidedAt && inRange(w.decidedAt, month))
  const refusedMonth = items.filter((w) => w.status === 'recusado' && w.decidedAt && inRange(w.decidedAt, month))
  const sum = (l: AffiliateWithdrawal[]) => l.reduce((s, w) => s + w.amount, 0)

  const reveal = (w: AffiliateWithdrawal) => {
    if (!canReveal) {
      toast.error('Seu cargo não pode ver dados do PIX completos', { description: 'Peça a permissão “Ver dados do PIX completos” a um Superadmin.' })
      return
    }
    if (w.method === 'saldo') return
    setRevealed((s) => new Set(s).add(w.id))
    audit('revelar', `Saque de afiliado #${w.id}`, `Dados de pagamento (${PAYOUT_METHOD_LABEL[w.method]}) de ${w.affiliateName} exibidos para conferência`)
  }
  const hide = (w: AffiliateWithdrawal) =>
    setRevealed((s) => {
      const n = new Set(s)
      n.delete(w.id)
      return n
    })

  const pay = async (w: AffiliateWithdrawal) => {
    if (!canDecide) {
      toast.error('Seu cargo não paga saques de afiliados.')
      return
    }
    const issues = withdrawalIssues(w, cfg, affById.get(w.affiliateId))
    const dest = destination(w, false)
    const ok = await confirm({
      title: `Pagar ${brl(w.amount)} para ${w.affiliateName}?`,
      description:
        w.method === 'pix'
          ? 'O PIX é enviado na hora e não pode ser desfeito.'
          : w.method === 'ted'
            ? 'A TED é agendada para hoje e não pode ser cancelada.'
            : 'O valor entra no saldo real do jogo do afiliado.',
      confirmLabel: `Pagar ${brl(w.amount)}`,
      tone: 'success',
      icon: CheckCircle2,
      typeToConfirm: issues.length ? 'PAGAR' : undefined,
      details: (
        <div className="space-y-3">
          <DescriptionList
            columns={2}
            items={[
              { label: 'Afiliado', value: w.affiliateName },
              { label: 'Forma', value: PAYOUT_METHOD_LABEL[w.method] },
              { label: dest.label, value: <Mono>{dest.value}</Mono>, full: true },
            ]}
          />
          {issues.length > 0 && (
            <Alert tone="warning" title="Fora das regras atuais do programa">
              {issues.join(' · ')}. Confirme só se o pagamento foi combinado com o afiliado.
            </Alert>
          )}
        </div>
      ),
    })
    if (!ok) return
    const r = payAffiliateWithdrawal(w, role, user.name)
    if (r.ok) toast.success('Saque pago', { description: r.message })
    else toast.error('Não foi possível pagar', { description: r.message })
  }

  const reject = async (w: AffiliateWithdrawal) => {
    if (!canDecide) {
      toast.error('Seu cargo não recusa saques de afiliados.')
      return
    }
    const r = await confirmWithInput({
      title: `Recusar o pedido de ${brl(w.amount)}?`,
      description: `O valor volta para o saldo de comissão de ${w.affiliateName}, que recebe o motivo por e-mail.`,
      confirmLabel: 'Recusar pedido',
      tone: 'danger',
      icon: XCircle,
      input: { label: 'Motivo', required: true, options: AFFILIATE_REJECT_REASONS.map((x) => ({ value: x, label: x })) },
    })
    if (!r.confirmed) return
    const res = rejectAffiliateWithdrawal(w, role, user.name, r.value)
    if (res.ok) toast.success('Pedido recusado', { description: res.message })
    else toast.error('Não foi possível recusar', { description: res.message })
  }

  const decideTitle = canDecide ? undefined : 'Seu cargo não decide saques de afiliados'

  const columns: Column<AffiliateWithdrawal>[] = [
    {
      id: 'createdAt',
      header: 'Data do pedido',
      pinned: true,
      sortValue: (w) => w.createdAt,
      csv: (w) => dateTime(w.createdAt),
      cell: (w) => {
        const isL = isLate(w, cfg, now)
        return (
          <div>
            <p className="text-[13px] text-fg">{dateTime(w.createdAt)}</p>
            <p className={cn('mt-0.5 flex items-center gap-1 text-xs', isL ? 'font-semibold text-danger' : 'text-fg-3')}>
              <Clock size={11} aria-hidden />
              {isL ? 'fora do prazo' : relative(w.createdAt)}
            </p>
          </div>
        )
      },
    },
    {
      id: 'affiliate',
      header: 'Afiliado',
      minWidth: 180,
      sortValue: (w) => w.affiliateName,
      csv: (w) => w.affiliateName,
      cell: (w) => <PersonCell name={w.affiliateName} sub={TYPE_META[w.affiliateType].label} />,
    },
    { id: 'id', header: 'ID do pedido', defaultHidden: true, sortValue: (w) => w.id, cell: (w) => <Mono>{w.id}</Mono> },
    {
      id: 'amount',
      header: 'Valor',
      align: 'right',
      sortValue: (w) => w.amount,
      csv: (w) => w.amount,
      cell: (w) => {
        const issues = w.status === 'pendente' ? withdrawalIssues(w, cfg, affById.get(w.affiliateId)) : []
        return (
          <span className="inline-flex items-center gap-1.5">
            {issues.length > 0 && (
              <Tooltip content={issues.join(' · ')}>
                <TriangleAlert size={14} className="text-warning" aria-label={`Atenção: ${issues.join(', ')}`} />
              </Tooltip>
            )}
            <span className="font-semibold">{brl(w.amount)}</span>
          </span>
        )
      },
    },
    {
      id: 'method',
      header: 'Forma',
      label: 'Forma de pagamento',
      sortValue: (w) => w.method,
      csv: (w) => PAYOUT_METHOD_LABEL[w.method],
      cell: (w) => <MethodBadge method={w.method} />,
    },
    {
      id: 'pix',
      header: 'Dados do PIX / conta',
      csv: (w) => {
        const d = destination(w, false)
        return `${d.label}: ${d.value}`
      },
      cell: (w) => {
        const open = revealed.has(w.id)
        const d = destination(w, open)
        return (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <div className="min-w-0">
              <Mono className={cn('block', open && 'text-fg')}>{d.value}</Mono>
              <span className="block text-[11px] text-fg-3">{d.label}</span>
            </div>
            {w.method !== 'saldo' &&
              (open ? (
                <IconButton size="sm" icon={EyeOff} onClick={() => hide(w)} label={`Ocultar dados de ${w.affiliateName}`} />
              ) : (
                <IconButton
                  size="sm"
                  icon={Eye}
                  onClick={() => reveal(w)}
                  disabled={!canReveal}
                  label={canReveal ? `Revelar dados de ${w.affiliateName} (fica na auditoria)` : 'Revelar exige a permissão “Ver dados do PIX completos”'}
                />
              ))}
          </div>
        )
      },
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (w) => w.status,
      csv: (w) => AFFILIATE_WITHDRAWAL_STATUS_LABEL[w.status],
      cell: (w) => (
        <Badge tone={STATUS_TONE[w.status]} dot>
          {AFFILIATE_WITHDRAWAL_STATUS_LABEL[w.status]}
        </Badge>
      ),
    },
    {
      id: 'decision',
      header: 'Decisão',
      pinned: true,
      csv: (w) => (w.decidedBy ? `${w.decidedBy} em ${dateTime(w.decidedAt)}` : ''),
      cell: (w) =>
        w.status === 'pendente' ? (
          <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="success" icon={Check} onClick={() => pay(w)} disabled={!canDecide} title={decideTitle}>
              Pagar
            </Button>
            <Button size="sm" variant="secondary" icon={X} onClick={() => reject(w)} disabled={!canDecide} title={decideTitle} className="text-danger">
              Recusar
            </Button>
          </div>
        ) : (
          <div className="text-xs text-fg-3">
            <p>por {w.decidedBy ?? '—'}</p>
            <p>{w.decidedAt ? relative(w.decidedAt) : ''}</p>
          </div>
        ),
    },
  ]

  const open = openId ? items.find((w) => w.id === openId) : undefined

  return (
    <>
      <PageHeader>
        <Tabs<TabV>
          className="mt-5"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'pendentes', label: 'Pendentes', icon: Hourglass, count: counts.pendentes },
            { value: 'pagos', label: 'Pagos', icon: CheckCircle2, count: counts.pagos },
            { value: 'recusados', label: 'Recusados', icon: Ban, count: counts.recusados },
            { value: 'todos', label: 'Todos', icon: ListChecks, count: counts.todos },
          ]}
        />
      </PageHeader>

      <div className="space-y-5">
        <section aria-label="Resumo dos saques de afiliados" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="A pagar"
            icon={Hourglass}
            tone="warning"
            value={brlCompact(sum(pending))}
            hint={
              <>
                {num(pending.length)} pedidos · <span className={late.length ? 'font-semibold text-danger' : ''}>{num(late.length)} fora do prazo</span>
              </>
            }
          />
          <KpiCard
            label="Pagos no mês"
            icon={CheckCircle2}
            tone="success"
            value={brlCompact(sum(paidMonth))}
            hint={`${num(paidMonth.length)} ${paidMonth.length === 1 ? 'pedido pago' : 'pedidos pagos'}`}
          />
          <KpiCard
            label="Recusados no mês"
            icon={Ban}
            tone="danger"
            value={brlCompact(sum(refusedMonth))}
            hint={`${num(refusedMonth.length)} ${refusedMonth.length === 1 ? 'pedido' : 'pedidos'} · valor voltou ao saldo`}
          />
          <KpiCard
            label="Prazo de pagamento"
            icon={CalendarClock}
            tone="neutral"
            value={`${cfg.payoutDays} ${cfg.payoutDays === 1 ? 'dia útil' : 'dias úteis'}`}
            hint={`limites ${brl(cfg.minWithdrawal)} a ${brl(cfg.maxWithdrawal)}`}
            formula={
              <>
                Pedido feito hoje vence em {dateTime(addBusinessDays(now, cfg.payoutDays)).slice(0, 10)}. Prazo e limites vêm de Programa de afiliados ›
                Configuração. Não considera feriados.
              </>
            }
          />
        </section>

        <Alert
          tone={canReveal ? 'info' : 'neutral'}
          icon={ShieldCheck}
          title="Dados do PIX mascarados (LGPD)"
          action={
            <Link to="/settings/auditoria" className="link text-[13px]">
              Ver auditoria
            </Link>
          }
        >
          A lista mostra chave PIX e conta bancária mascaradas, e o CSV também sai mascarado. O botão de olho (Revelar) mostra o dado completo só para cargos
          com a permissão “Ver dados do PIX completos”, e cada revelação fica registrada na auditoria.
          {!canReveal && <strong className="font-semibold text-fg"> Seu cargo ({role.name}) não tem essa permissão.</strong>}
        </Alert>

        {!canDecide && (
          <Alert tone="neutral" icon={Lock}>
            Seu cargo ({role.name}) pode acompanhar os pedidos, mas não pagar nem recusar. Isso exige a permissão “Pagar e recusar saques de afiliados”.
          </Alert>
        )}

        {late.length > 0 && tab !== 'pagos' && tab !== 'recusados' && (
          <Alert tone="warning" title={`${late.length} ${late.length === 1 ? 'pedido passou' : 'pedidos passaram'} do prazo de ${cfg.payoutDays} dias úteis`}>
            Afiliados com pagamento atrasado tendem a levar a audiência para outra casa. Priorize os mais antigos.
          </Alert>
        )}

        <DataTable
          caption="Pedidos de saque de comissão"
          rows={rows}
          columns={columns}
          rowKey={(w) => w.id}
          searchText={(w) => `${w.id} ${w.affiliateName} ${w.affiliateEmail}`}
          searchPlaceholder="Buscar por afiliado, e-mail ou ID"
          initialSort={{ id: 'createdAt', dir: tab === 'pendentes' ? 'asc' : 'desc' }}
          exportName={`saques-afiliados-${tab}`}
          onExport={(n) => audit('exportar', 'Saques de afiliados', `Exportação CSV de ${n} pedidos (${tab}), dados do PIX mascarados`)}
          onRowClick={(w) => setOpenId(w.id)}
          resetKey={tab}
          rowClassName={(w) => (isLate(w, cfg, now) ? 'bg-danger/[0.03]' : undefined)}
          empty={{
            icon: tab === 'pendentes' ? CheckCircle2 : ListChecks,
            title: tab === 'pendentes' ? 'Nenhum pedido pendente' : 'Nenhum pedido nesta aba',
            description: tab === 'pendentes' ? 'Todos os pedidos de saque de comissão foram decididos.' : 'Troque de aba para ver outros pedidos.',
          }}
        />
      </div>

      {open && (
        <WithdrawalDrawer
          w={open}
          affiliate={affById.get(open.affiliateId)}
          history={items.filter((x) => x.affiliateId === open.affiliateId && x.id !== open.id).slice(0, 4)}
          revealed={revealed.has(open.id)}
          canReveal={canReveal}
          canDecide={canDecide}
          onReveal={() => reveal(open)}
          onHide={() => hide(open)}
          onPay={() => pay(open)}
          onReject={() => reject(open)}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  )
}

function WithdrawalDrawer({
  w,
  affiliate,
  history,
  revealed,
  canReveal,
  canDecide,
  onReveal,
  onHide,
  onPay,
  onReject,
  onClose,
}: {
  w: AffiliateWithdrawal
  affiliate: Affiliate | undefined
  history: AffiliateWithdrawal[]
  revealed: boolean
  canReveal: boolean
  canDecide: boolean
  onReveal: () => void
  onHide: () => void
  onPay: () => void
  onReject: () => void
  onClose: () => void
}) {
  const cfg = useProgramConfig()
  const issues = w.status === 'pendente' ? withdrawalIssues(w, cfg, affiliate) : []
  const dest = destination(w, revealed)
  const deadline = addBusinessDays(new Date(w.createdAt), cfg.payoutDays)
  return (
    <Drawer
      open
      onClose={onClose}
      title={`Pedido ${w.id}`}
      description={`Pedido em ${dateTime(w.createdAt)} · ${relative(w.createdAt)}`}
      headerExtra={
        <Badge tone={STATUS_TONE[w.status]} dot size="md">
          {AFFILIATE_WITHDRAWAL_STATUS_LABEL[w.status]}
        </Badge>
      }
      footer={
        w.status === 'pendente' ? (
          <>
            <Button icon={X} onClick={onReject} disabled={!canDecide} className="text-danger">
              Recusar
            </Button>
            <Button variant="success" icon={Check} onClick={onPay} disabled={!canDecide}>
              Pagar {brl(w.amount)}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-6">
        <div className="rounded-xl bg-surface-2 p-4">
          <p className="text-xs text-fg-3">Valor pedido</p>
          <p className="mt-1 font-display text-3xl font-bold text-fg tnum">{brl(w.amount)}</p>
          <p className="mt-1 text-[13px] text-fg-3">
            {w.status === 'pendente' ? (
              <>
                Pagar até <strong className="text-fg-2">{dateTime(deadline).slice(0, 10)}</strong> ({cfg.payoutDays} dias úteis)
              </>
            ) : (
              <>
                {w.status === 'pago' ? 'Pago' : 'Recusado'} por {w.decidedBy} em {dateTime(w.decidedAt)}
              </>
            )}
          </p>
        </div>

        {issues.length > 0 && (
          <Alert tone="warning" title="Atenção antes de pagar">
            <ul className="list-disc space-y-0.5 pl-4">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </Alert>
        )}

        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Afiliado</h3>
          <PersonCell name={w.affiliateName} sub={`${TYPE_META[w.affiliateType].label} · ${affiliate ? `?ref=${affiliate.code}` : 'removido'}`} />
          {affiliate && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <StatTile label="Saldo de comissão hoje" value={brl(affiliate.balance)} />
              <StatTile label="Status no programa" value={affiliate.status === 'ativo' ? 'Ativo' : 'Pausado'} />
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
            Pagamento <MethodBadge method={w.method} />
          </h3>
          <DescriptionList
            items={[
              {
                label: dest.label,
                full: true,
                value: (
                  <span className="flex flex-wrap items-center gap-2">
                    <Mono className="text-fg">{dest.value}</Mono>
                    {w.method !== 'saldo' &&
                      (revealed ? (
                        <button
                          type="button"
                          onClick={onHide}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary-text hover:underline"
                        >
                          <EyeOff size={12} aria-hidden /> Ocultar
                        </button>
                      ) : canReveal ? (
                        <button
                          type="button"
                          onClick={onReveal}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary-text hover:underline"
                        >
                          <Eye size={12} aria-hidden /> Revelar
                        </button>
                      ) : (
                        <span className="text-xs text-fg-3">sem permissão para revelar</span>
                      ))}
                  </span>
                ),
              },
              ...(w.method === 'ted' && w.bank ? [{ label: 'Titular', value: w.bank.holder }] : []),
              ...(w.reference ? [{ label: 'Comprovante', value: <Mono className="break-all">{w.reference}</Mono>, full: true }] : []),
              ...(w.reason ? [{ label: 'Motivo da recusa', value: w.reason, full: true }] : []),
            ]}
          />
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Outros pedidos deste afiliado</h3>
          {history.length ? (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-fg tnum">{brl(h.amount)}</p>
                    <p className="text-xs text-fg-3">
                      {h.id} · {relative(h.createdAt)}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[h.status]} dot>
                    {AFFILIATE_WITHDRAWAL_STATUS_LABEL[h.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg bg-surface-2 px-3 py-3 text-[13px] text-fg-3">Primeiro pedido de saque deste afiliado.</p>
          )}
        </section>
      </div>
    </Drawer>
  )
}
