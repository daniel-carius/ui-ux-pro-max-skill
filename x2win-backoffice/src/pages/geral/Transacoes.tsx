import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, Copy, Dices, Eye, Trophy, Undo2, UserRound, X } from 'lucide-react'
import { Sparkline } from '@/components/charts'
import {
  Badge,
  Button,
  ChipFilter,
  CopyButton,
  DataTable,
  DateRangePicker,
  DescriptionList,
  Drawer,
  KpiCard,
  Mono,
  PageHeader,
  PersonCell,
  confirmWithInput,
  inRange,
  presetRange,
  toast,
  type Column,
  type DateRange,
  type MenuEntry,
} from '@/components/ui'
import { brl, brlCompact, date, dateTime, num, relative, time } from '@/lib/format'
import { DAY, dayKey, startOfDay } from '@/data/now'
import { usePlayers, useTransactions } from '@/data/hooks'
import { TRANSACTION_TYPE_LABEL, type Transaction, type TransactionType } from '@/data/finance'
import { audit, usePageAccess, useSession } from '@/domain/session'
import {
  REVERSAL_REASONS,
  REVERSAL_WINDOW_DAYS,
  REVERSIBLE_TYPES,
  buildReversalTx,
  canReverse,
  reversalRef,
  reversedIds,
  statementTotals,
  walletPatch,
  type AnnotatedTransaction,
} from '@/domain/geral'
import { PlayerDrawer, SignedAmount, TableFrame, TxTypeBadge, maskEmailShort } from './_shared'

type TypeFilter = 'todos' | TransactionType

const TYPE_ORDER: TransactionType[] = ['aposta', 'ganho', 'deposito', 'saque', 'bonus', 'free_spin', 'cashback', 'credito_manual', 'debito_manual', 'estorno']
const TYPE_CHIP_LABEL: Record<TransactionType, string> = {
  aposta: 'Apostas',
  ganho: 'Ganhos',
  deposito: 'Depósitos',
  saque: 'Saques',
  bonus: 'Bônus',
  free_spin: 'Free spins',
  cashback: 'Cashback',
  credito_manual: 'Creditações',
  debito_manual: 'Subtrações',
  estorno: 'Estornos',
}

export default function Transacoes() {
  const { canEdit, can } = usePageAccess()
  const { user } = useSession()
  const txs = useTransactions()
  const players = usePlayers()
  const [params, setParams] = useSearchParams()
  const playerFilter = params.get('jogador')
  const filterPlayer = playerFilter ? players.get(playerFilter) : undefined
  const [range, setRange] = useState<DateRange>(() => presetRange('30d'))
  const [type, setType] = useState<TypeFilter>('todos')
  const [playerOpen, setPlayerOpen] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  const reversed = useMemo(() => reversedIds(txs.items), [txs.items])
  const inPeriod = useMemo(
    () => txs.items.filter((t) => inRange(t.at, range) && (!playerFilter || t.playerId === playerFilter)),
    [txs.items, range, playerFilter],
  )
  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: inPeriod.length }
    for (const t of inPeriod) c[t.type] = (c[t.type] ?? 0) + 1
    return c
  }, [inPeriod])
  const rows = type === 'todos' ? inPeriod : inPeriod.filter((t) => t.type === type)
  const totals = useMemo(() => statementTotals(inPeriod), [inPeriod])

  // séries diárias para os mini gráficos dos cartões
  const daily = useMemo(() => {
    const days: string[] = []
    for (let d = startOfDay(range.from).getTime(); d <= range.to.getTime(); d += DAY) days.push(dayKey(new Date(d)))
    const idx = new Map(days.map((k, i) => [k, i]))
    const s = { dep: days.map(() => 0), wd: days.map(() => 0), bets: days.map(() => 0), wins: days.map(() => 0) }
    for (const t of inPeriod) {
      const i = idx.get(dayKey(new Date(t.at)))
      if (i === undefined) continue
      if (t.type === 'deposito') s.dep[i] += t.amount
      else if (t.type === 'saque') s.wd[i] += -t.amount
      else if (t.type === 'aposta') s.bets[i] += -t.amount
      else if (t.type === 'ganho' || t.type === 'free_spin') s.wins[i] += t.amount
    }
    return s
  }, [inPeriod, range])

  const clearPlayer = () => {
    const next = new URLSearchParams(params)
    next.delete('jogador')
    setParams(next, { replace: true })
  }

  const copyId = async (t: Transaction) => {
    try {
      await navigator.clipboard.writeText(t.id)
    } catch {
      /* sem permissão */
    }
    toast.success('ID copiado', { description: t.id })
  }

  const reverse = async (t: Transaction) => {
    if (!canEdit) {
      toast.error('Seu cargo não pode estornar transações.')
      return
    }
    const check = canReverse(t, reversed)
    if (!check.ok) {
      toast.error('Não é possível estornar', { description: check.reason })
      return
    }
    const amount = Math.abs(t.amount)
    const r = await confirmWithInput({
      title: `Estornar ${brl(amount)}?`,
      description: `O valor volta para o saldo ${t.wallet === 'real' ? 'real' : 'bônus'} de ${t.playerName}. A transação original continua no extrato, marcada como estornada.`,
      confirmLabel: 'Estornar',
      tone: 'warning',
      icon: Undo2,
      details: (
        <DescriptionList
          columns={2}
          items={[
            { label: 'Transação', value: <Mono className="text-fg">{t.id}</Mono> },
            { label: 'Tipo', value: TRANSACTION_TYPE_LABEL[t.type] },
            { label: 'Data', value: dateTime(t.at) },
            { label: 'Jogo', value: t.gameName ?? '—' },
          ]}
        />
      ),
      input: { label: 'Motivo do estorno', required: true, options: REVERSAL_REASONS },
    })
    if (!r.confirmed) return
    const p = players.get(t.playerId)
    const est = buildReversalTx(t, p, r.value, user.name)
    txs.add(est)
    if (p) players.update(p.id, walletPatch(t.wallet, est.balanceAfter))
    audit('estornar', `Transação #${t.id}`, `Estorno de ${brl(amount)} para ${t.playerName} (${est.id}). Motivo: ${r.value}`)
    toast.success('Estorno lançado', { description: `${est.id} devolveu ${brl(amount)} ao saldo ${t.wallet === 'real' ? 'real' : 'bônus'}.` })
  }

  const actionsFor = (t: Transaction): MenuEntry[] => {
    const entries: MenuEntry[] = [
      { label: 'Ver detalhes', icon: Eye, onSelect: () => setDetailId(t.id) },
      { label: 'Ver jogador', icon: UserRound, onSelect: () => setPlayerOpen(t.playerId) },
      { label: 'Copiar ID', icon: Copy, onSelect: () => copyId(t) },
    ]
    if (REVERSIBLE_TYPES.includes(t.type)) {
      const r = canReverse(t, reversed)
      entries.push(
        { divider: true },
        {
          label: 'Estornar',
          icon: Undo2,
          danger: true,
          disabled: !canEdit || !r.ok,
          hint: !canEdit ? 'sem permissão' : !r.ok ? (reversed.has(t.id) ? 'já estornada' : 'fora do prazo') : undefined,
          onSelect: () => reverse(t),
        },
      )
    }
    return entries
  }

  const columns: Column<Transaction>[] = [
    { id: 'id', header: 'ID', pinned: true, sortValue: (t) => t.id, cell: (t) => <Mono className="font-medium text-fg">{t.id}</Mono> },
    {
      id: 'at',
      header: 'Data',
      sortValue: (t) => t.at,
      csv: (t) => dateTime(t.at),
      cell: (t) => (
        <div className="text-[13px] leading-tight">
          <p className="text-fg">{date(t.at)}</p>
          <p className="text-xs text-fg-3">{time(t.at)}</p>
        </div>
      ),
    },
    {
      id: 'player',
      header: 'Usuário',
      minWidth: 180,
      sortValue: (t) => t.playerName,
      csv: (t) => `${t.playerName} (${t.playerId})`,
      cell: (t) => <PersonCell name={t.playerName} sub={`ID ${t.playerId} · ${maskEmailShort(t.playerEmail)}`} />,
    },
    {
      id: 'type',
      header: 'Tipo',
      sortValue: (t) => TRANSACTION_TYPE_LABEL[t.type],
      csv: (t) => `${TRANSACTION_TYPE_LABEL[t.type]}${reversed.has(t.id) ? ' (estornada)' : ''}`,
      cell: (t) => (
        <div className="flex flex-col items-start gap-0.5">
          <TxTypeBadge type={t.type} />
          {reversed.has(t.id) && <span className="text-[11px] font-medium text-warning">estornada</span>}
        </div>
      ),
    },
    {
      id: 'amount',
      header: 'Valor',
      align: 'right',
      sortValue: (t) => t.amount,
      csv: (t) => t.amount,
      cell: (t) => (
        <div className="leading-tight">
          <SignedAmount value={t.amount} />
          {t.wallet === 'bonus' && <p className="text-[11px] font-medium text-primary-text">saldo bônus</p>}
        </div>
      ),
    },
    { id: 'balanceBefore', header: 'Saldo anterior', align: 'right', sortValue: (t) => t.balanceBefore, cell: (t) => <span className="text-fg-2">{brl(t.balanceBefore)}</span> },
    { id: 'balanceAfter', header: 'Saldo atual', align: 'right', sortValue: (t) => t.balanceAfter, cell: (t) => <span className="font-medium text-fg">{brl(t.balanceAfter)}</span> },
    {
      id: 'game',
      header: 'Jogo',
      sortValue: (t) => t.gameName ?? '',
      csv: (t) => t.gameName ?? '',
      cell: (t) =>
        t.gameName ? (
          <div className="max-w-[180px] leading-tight">
            <p className="truncate text-[13px] text-fg">{t.gameName}</p>
            <p className="truncate text-xs text-fg-3">{t.providerName}</p>
          </div>
        ) : (
          <span className="text-fg-3">—</span>
        ),
    },
    { id: 'provider', header: 'Provedor', defaultHidden: true, sortValue: (t) => t.providerName ?? '', csv: (t) => t.providerName ?? '', cell: (t) => <span className="text-[13px] text-fg-2">{t.providerName ?? '—'}</span> },
    {
      id: 'wallet',
      header: 'Carteira',
      defaultHidden: true,
      sortValue: (t) => t.wallet,
      csv: (t) => (t.wallet === 'real' ? 'Real' : 'Bônus'),
      cell: (t) => <Badge tone={t.wallet === 'real' ? 'neutral' : 'primary'}>{t.wallet === 'real' ? 'Real' : 'Bônus'}</Badge>,
    },
    { id: 'reference', header: 'Referência', defaultHidden: true, csv: (t) => t.reference, cell: (t) => <Mono className="block max-w-[160px] truncate">{t.reference}</Mono> },
  ]

  const detail = detailId ? txs.get(detailId) : undefined

  return (
    <>
      <PageHeader actions={<DateRangePicker value={range} onChange={setRange} />} />

      <section aria-label="Resumo do extrato" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Entradas"
          icon={ArrowDownToLine}
          tone="success"
          value={brlCompact(totals.deposits)}
          hint={`${num(totals.depositsCount)} depósitos`}
          formula={<>Soma dos depósitos creditados nas carteiras no período. É o dinheiro novo que entrou na casa.</>}
          chart={<Sparkline data={daily.dep} slot={3} ariaLabel="Entradas por dia" />}
        />
        <KpiCard
          label="Saídas"
          icon={ArrowUpFromLine}
          tone="warning"
          value={brlCompact(totals.withdrawals)}
          hint={`${num(totals.withdrawalsCount)} saques`}
          formula={<>Soma dos saques debitados das carteiras no período.</>}
          chart={<Sparkline data={daily.wd} slot={2} ariaLabel="Saídas por dia" />}
        />
        <KpiCard
          label="Volume de apostas"
          icon={Dices}
          value={brlCompact(totals.bets)}
          hint={`${num(totals.betsCount)} apostas`}
          formula={<>Soma das apostas debitadas no período, com saldo real e bônus.</>}
          chart={<Sparkline data={daily.bets} slot={1} ariaLabel="Apostas por dia" />}
        />
        <KpiCard
          label="Ganhos pagos"
          icon={Trophy}
          tone="info"
          value={brlCompact(totals.winnings)}
          hint={`${num(totals.winningsCount)} prêmios creditados`}
          formula={<>Prêmios creditados no período: ganhos em jogos e em free spins. Não inclui bônus nem cashback.</>}
          chart={<Sparkline data={daily.wins} slot={4} ariaLabel="Ganhos por dia" />}
        />
      </section>

      <TableFrame>
        <DataTable
          caption="Extrato de transações"
          rows={rows}
          columns={columns}
          rowKey={(t) => t.id}
          searchText={(t) => `${t.id} ${t.playerName} ${t.playerEmail} ${t.playerId} ${t.reference}`}
          searchPlaceholder="Buscar por ID ou jogador"
          initialSort={{ id: 'at', dir: 'desc' }}
          pageSize={25}
          exportName="transacoes"
          canExport={can('transacoes.exportar')}
          onExport={(n) => audit('exportar', 'Transações', `Exportação CSV de ${n} transações${type !== 'todos' ? ` (${TYPE_CHIP_LABEL[type]})` : ''}${filterPlayer ? ` do jogador #${filterPlayer.id}` : ''}`)}
          onRowClick={(t) => setDetailId(t.id)}
          rowActions={actionsFor}
          resetKey={`${type}|${playerFilter}|${range.from.getTime()}`}
          toolbar={
            <>
              {playerFilter && (
                <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary/10 pl-3 pr-1 text-[13px] font-medium text-primary-text">
                  <UserRound size={14} aria-hidden />
                  {filterPlayer ? filterPlayer.nickname : `ID ${playerFilter}`}
                  <button type="button" onClick={clearPlayer} aria-label="Remover filtro de jogador" className="rounded-full p-1 hover:bg-primary/15">
                    <X size={13} aria-hidden />
                  </button>
                </span>
              )}
              <ChipFilter<TypeFilter>
                value={type}
                onChange={setType}
                options={[
                  { value: 'todos', label: 'Todos', count: counts.todos ?? 0 },
                  ...TYPE_ORDER.map((k) => ({ value: k, label: TYPE_CHIP_LABEL[k], count: counts[k] ?? 0 })),
                ]}
                className="max-w-full"
              />
            </>
          }
          empty={{
            title: playerFilter ? 'Nenhuma transação deste jogador' : 'Nenhuma transação neste filtro',
            description: 'Troque o tipo ou o período para ver outras movimentações.',
            action: playerFilter ? (
              <Button size="sm" onClick={clearPlayer}>
                Ver todos os jogadores
              </Button>
            ) : undefined,
          }}
        />
      </TableFrame>

      <TxDrawer
        t={detail}
        all={txs.items}
        reversed={reversed}
        canEdit={canEdit}
        onClose={() => setDetailId(null)}
        onPlayer={(id) => {
          setDetailId(null)
          setPlayerOpen(id)
        }}
        onReverse={reverse}
        onOpenTx={setDetailId}
      />
      <PlayerDrawer playerId={playerOpen} onClose={() => setPlayerOpen(null)} />
    </>
  )
}

function TxDrawer({
  t,
  all,
  reversed,
  canEdit,
  onClose,
  onPlayer,
  onReverse,
  onOpenTx,
}: {
  t: Transaction | undefined
  all: Transaction[]
  reversed: Set<string>
  canEdit: boolean
  onClose: () => void
  onPlayer: (id: string) => void
  onReverse: (t: Transaction) => void
  onOpenTx: (id: string) => void
}) {
  if (!t) return null
  const a = t as AnnotatedTransaction
  const check = canReverse(t, reversed)
  const reversal = reversed.has(t.id) ? all.find((x) => x.reference === reversalRef(t.id)) : undefined
  const originalId = t.type === 'estorno' && t.reference.startsWith('EST-') ? t.reference.slice(4) : null
  const original = originalId ? all.find((x) => x.id === originalId) : undefined
  return (
    <Drawer
      open
      onClose={onClose}
      width="md"
      title={`Transação ${t.id}`}
      description={`${dateTime(t.at)} · ${relative(t.at)}`}
      headerExtra={<TxTypeBadge type={t.type} />}
      footer={
        <>
          <Button icon={UserRound} onClick={() => onPlayer(t.playerId)}>
            Ver jogador
          </Button>
          {REVERSIBLE_TYPES.includes(t.type) && (
            <Button
              variant="secondary"
              className="text-danger"
              icon={Undo2}
              disabled={!canEdit || !check.ok}
              title={!canEdit ? 'Seu cargo não pode estornar' : check.reason}
              onClick={() => onReverse(t)}
            >
              Estornar
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-6">
        <div className="rounded-xl bg-surface-2 p-4">
          <p className="text-xs text-fg-3">Valor</p>
          <SignedAmount value={t.amount} className="mt-1 block font-display text-3xl font-bold" />
          <p className="mt-1 text-[13px] text-fg-3 tnum">
            Saldo {t.wallet === 'real' ? 'real' : 'bônus'}: {brl(t.balanceBefore)} → <strong className="text-fg">{brl(t.balanceAfter)}</strong>
          </p>
        </div>
        {reversal && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/5 px-3.5 py-3 text-[13px] text-fg-2">
            <span className="flex items-center gap-2">
              <Undo2 size={15} className="text-warning" aria-hidden /> Estornada em {dateTime(reversal.at)}
            </span>
            <button type="button" className="link" onClick={() => onOpenTx(reversal.id)}>
              Ver {reversal.id}
            </button>
          </div>
        )}
        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Jogador</h3>
          <button type="button" onClick={() => onPlayer(t.playerId)} className="w-full rounded-xl border border-line p-3 text-left hover:bg-surface-2">
            <PersonCell name={t.playerName} sub={`ID ${t.playerId} · ${maskEmailShort(t.playerEmail)}`} />
          </button>
        </section>
        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Detalhes</h3>
          <DescriptionList
            items={[
              { label: 'Carteira', value: t.wallet === 'real' ? 'Saldo real' : 'Saldo bônus' },
              { label: 'Tipo', value: TRANSACTION_TYPE_LABEL[t.type] },
              { label: 'Jogo', value: t.gameName ?? '—' },
              { label: 'Provedor', value: t.providerName ?? '—' },
              {
                label: 'Referência',
                full: true,
                value: (
                  <span className="flex items-center gap-1">
                    <Mono className="break-all">{t.reference}</Mono>
                    <CopyButton value={t.reference} label="Copiar referência" />
                  </span>
                ),
              },
              ...(original
                ? [
                    {
                      label: 'Estorno de',
                      full: true,
                      value: (
                        <button type="button" className="link" onClick={() => onOpenTx(original.id)}>
                          {original.id} · {TRANSACTION_TYPE_LABEL[original.type]} de {brl(Math.abs(original.amount))}
                        </button>
                      ),
                    },
                  ]
                : []),
              ...(a.by ? [{ label: 'Lançado por', value: a.by }] : []),
              ...(a.note ? [{ label: 'Motivo', value: a.note, full: true }] : []),
            ]}
          />
        </section>
        {REVERSIBLE_TYPES.includes(t.type) && !reversal && (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs leading-5 text-fg-3">
            Apostas e subtrações manuais podem ser estornadas em até {REVERSAL_WINDOW_DAYS} dias. Depois disso, a correção vira um ajuste manual na ficha do jogador.
          </p>
        )}
      </div>
    </Drawer>
  )
}
