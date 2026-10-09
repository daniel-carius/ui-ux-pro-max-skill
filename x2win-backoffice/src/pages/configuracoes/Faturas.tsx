import { useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Download,
  Eye,
  Gamepad2,
  Hourglass,
  Info,
  Mail,
  MessageSquareText,
  Percent,
  QrCode,
  ReceiptText,
  Server,
  Wallet,
} from 'lucide-react'
import { BarsChart, seriesColor, type SeriesSlot } from '@/components/charts'
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
  Field,
  IconButton,
  KpiCard,
  Modal,
  Mono,
  PageHeader,
  Textarea,
  confirm,
  toast,
  type Column,
  type Tone,
} from '@/components/ui'
import { brl, date, dateTime, num, pct } from '@/lib/format'
import { cn } from '@/lib/cn'
import { downloadFile } from '@/lib/csv'
import { useCollection } from '@/lib/store'
import { audit, usePageAccess, useSession } from '@/domain/session'
import { useCompany } from '@/domain/system'
import {
  INVOICES_KEY,
  INVOICE_STATUS_LABEL,
  LATE_FINE,
  LATE_INTEREST_MONTH,
  competenceLabel,
  daysUntilDue,
  demoPixPayload,
  dueLabel,
  invoiceKpis,
  invoiceStatus,
  invoiceText,
  lateCharges,
  type Invoice,
  type InvoiceItemKind,
  type InvoiceStatus,
} from '@/domain/config1-faturas'
import { seedInvoices } from '@/data/config1-faturas'

const STATUS_TONE: Record<InvoiceStatus, Tone> = { aberta: 'warning', vencida: 'danger', paga: 'success' }

const KIND_META: Record<InvoiceItemKind, { icon: LucideIcon; slot: SeriesSlot; group: 'mensalidade' | 'ggr' | 'mensagens' | 'licencas' }> = {
  mensalidade: { icon: Server, slot: 1, group: 'mensalidade' },
  ggr: { icon: Percent, slot: 2, group: 'ggr' },
  sms: { icon: MessageSquareText, slot: 3, group: 'mensagens' },
  email: { icon: Mail, slot: 3, group: 'mensagens' },
  licencas: { icon: Gamepad2, slot: 4, group: 'licencas' },
}

type Filter = 'todas' | InvoiceStatus

export default function Faturas() {
  const invoices = useCollection<Invoice>(INVOICES_KEY, seedInvoices)
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  const [company] = useCompany()
  const [filter, setFilter] = useState<Filter>('todas')
  const [openId, setOpenId] = useState<string | null>(null)
  const [payId, setPayId] = useState<string | null>(null)
  const now = new Date()

  const k = invoiceKpis(invoices.items, now)
  const counts = useMemo(() => {
    const c: Record<string, number> = { todas: invoices.items.length, aberta: 0, vencida: 0, paga: 0 }
    for (const i of invoices.items) c[invoiceStatus(i)]++
    return c
  }, [invoices.items])
  const rows = filter === 'todas' ? invoices.items : invoices.items.filter((i) => invoiceStatus(i) === filter)

  const download = (inv: Invoice) => {
    downloadFile(`fatura-${inv.number}.txt`, invoiceText(inv, company), 'text/plain;charset=utf-8')
    audit('exportar', `Fatura ${inv.number}`, `Fatura de ${competenceLabel(inv.competence)} baixada (${brl(inv.total)})`)
    toast.success('Fatura baixada', { description: `fatura-${inv.number}.txt` })
  }

  const payBlocked = !canEdit ? 'Seu cargo só consulta faturas. Peça a um administrador para pagar.' : undefined

  const markPaid = async (inv: Invoice) => {
    const charges = lateCharges(inv)
    // fecha a janela do PIX enquanto pede a confirmação (evita duas janelas empilhadas)
    setPayId(null)
    const ok = await confirm({
      title: `Confirmar pagamento de ${brl(charges.total)}?`,
      description: 'A fatura passa a constar como paga e a cobrança some do aviso do painel. Só confirme depois de concluir o PIX no app do banco.',
      confirmLabel: 'Já paguei',
      tone: 'success',
      icon: CheckCircle2,
      details: (
        <DescriptionList
          columns={2}
          items={[
            { label: 'Fatura', value: inv.number },
            { label: 'Competência', value: competenceLabel(inv.competence) },
            { label: 'Vencimento', value: date(inv.dueDate) },
            { label: 'Forma', value: 'PIX' },
          ]}
        />
      ),
    })
    if (!ok) {
      setPayId(inv.id)
      return
    }
    invoices.update(inv.id, { paid: true, paidAt: new Date().toISOString(), paidBy: user.name, method: 'PIX' })
    audit('editar', `Fatura ${inv.number}`, `Marcada como paga via PIX: ${brl(charges.total)}`)
    toast.success('Pagamento registrado', { description: 'O comprovante do banco é conferido pela plataforma em até 1 dia útil.' })
  }

  const columns: Column<Invoice>[] = [
    {
      id: 'number',
      header: 'Fatura',
      pinned: true,
      sortValue: (i) => i.competence,
      csv: (i) => i.number,
      cell: (i) => (
        <div>
          <Mono className="font-medium text-fg">{i.number}</Mono>
          <p className="mt-0.5 text-xs capitalize text-fg-3">{competenceLabel(i.competence)}</p>
        </div>
      ),
    },
    { id: 'issuedAt', header: 'Emissão', sortValue: (i) => i.issuedAt, csv: (i) => date(i.issuedAt), cell: (i) => <span className="text-[13px] text-fg-2">{date(i.issuedAt)}</span> },
    {
      id: 'dueDate',
      header: 'Vencimento',
      sortValue: (i) => i.dueDate,
      csv: (i) => date(i.dueDate),
      cell: (i) => {
        const st = invoiceStatus(i)
        return (
          <div>
            <p className="text-[13px] text-fg">{date(i.dueDate)}</p>
            {st !== 'paga' && <p className={cn('mt-0.5 text-xs font-medium', st === 'vencida' ? 'text-danger' : 'text-warning')}>{dueLabel(i)}</p>}
          </div>
        )
      },
    },
    { id: 'total', header: 'Valor', align: 'right', sortValue: (i) => i.total, csv: (i) => i.total, cell: (i) => <span className="font-semibold tnum">{brl(i.total)}</span> },
    {
      id: 'status',
      header: 'Status',
      sortValue: (i) => invoiceStatus(i),
      csv: (i) => INVOICE_STATUS_LABEL[invoiceStatus(i)],
      cell: (i) => (
        <Badge tone={STATUS_TONE[invoiceStatus(i)]} dot>
          {INVOICE_STATUS_LABEL[invoiceStatus(i)]}
        </Badge>
      ),
    },
    {
      id: 'paidAt',
      header: 'Pagamento',
      sortValue: (i) => i.paidAt ?? '',
      csv: (i) => (i.paidAt ? `${date(i.paidAt)} ${i.method ?? ''}` : ''),
      cell: (i) =>
        i.paidAt ? (
          <div>
            <p className="text-[13px] text-fg">{date(i.paidAt)}</p>
            <p className="mt-0.5 text-xs text-fg-3">
              {i.method} · {i.paidBy}
            </p>
          </div>
        ) : (
          <span className="text-xs text-fg-3">—</span>
        ),
    },
    {
      id: 'acoes',
      header: '',
      label: 'Itens',
      pinned: true,
      align: 'right',
      // na tela é a coluna de ações; no CSV vira o detalhamento dos itens
      csv: (i) => i.items.map((it) => `${it.description}: ${brl(it.amount)}`).join(' | '),
      cell: (i) => (
        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          {!i.paid && (
            <Button size="sm" variant="primary" icon={QrCode} onClick={() => setPayId(i.id)} disabled={!canEdit} title={payBlocked}>
              Pagar
            </Button>
          )}
          <IconButton icon={Eye} label={`Ver itens da fatura ${i.number}`} size="sm" onClick={() => setOpenId(i.id)} />
          <IconButton icon={Download} label={`Baixar fatura ${i.number}`} size="sm" onClick={() => download(i)} />
        </div>
      ),
    },
  ]

  const chartData = useMemo(
    () =>
      [...invoices.items]
        .sort((a, b) => a.competence.localeCompare(b.competence))
        .map((i) => {
          const g = { mensalidade: 0, ggr: 0, mensagens: 0, licencas: 0 }
          for (const it of i.items) g[KIND_META[it.kind].group] += it.amount
          return { comp: competenceLabel(i.competence, true), ...g }
        }),
    [invoices.items],
  )

  const nextInv = k.next
  const open = openId ? invoices.get(openId) : undefined
  const paying = payId ? invoices.get(payId) : undefined

  return (
    <>
      <PageHeader />

      {nextInv && (
        <Alert
          tone={k.overdueCount ? 'danger' : (k.nextDays ?? 99) <= 5 ? 'warning' : 'info'}
          title={
            k.overdueCount
              ? `${k.overdueCount === 1 ? 'Uma fatura vencida' : `${k.overdueCount} faturas vencidas`}: ${brl(k.overdueAmount)} com multa e juros`
              : `Fatura ${nextInv.number} de ${brl(nextInv.total)} ${dueLabel(nextInv)} (${date(nextInv.dueDate)})`
          }
          action={
            <Button variant="primary" size="sm" icon={QrCode} onClick={() => setPayId(nextInv.id)} disabled={!canEdit} title={payBlocked}>
              Pagar com PIX
            </Button>
          }
          className="mb-5"
        >
          Após o vencimento, há multa de {pct(LATE_FINE, 0)} e juros de {pct(LATE_INTEREST_MONTH, 0)} ao mês. O pagamento por PIX é confirmado em até 1 dia útil.
          {!canEdit && <span className="mt-1 block font-medium text-fg">Seu cargo só consulta e baixa faturas. O pagamento é registrado por um administrador.</span>}
        </Alert>
      )}

      <section aria-label="Resumo das faturas" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Em aberto"
          icon={Wallet}
          tone={k.openCount ? 'warning' : 'success'}
          value={brl(k.openAmount)}
          hint={k.openCount ? `${k.openCount} ${k.openCount === 1 ? 'fatura' : 'faturas'}` : 'nada a pagar'}
          onClick={() => setFilter('aberta')}
          active={filter === 'aberta'}
        />
        <KpiCard
          label="Vencidas"
          icon={AlertTriangle}
          tone={k.overdueCount ? 'danger' : 'success'}
          value={k.overdueCount ? brl(k.overdueAmount) : 'Nenhuma'}
          hint={k.overdueCount ? `${k.overdueCount} com multa e juros` : 'todas em dia'}
          onClick={() => setFilter('vencida')}
          active={filter === 'vencida'}
        />
        <KpiCard
          label="Próximo vencimento"
          icon={CalendarClock}
          tone={k.nextDays == null ? 'neutral' : k.nextDays < 0 ? 'danger' : k.nextDays <= 5 ? 'warning' : 'info'}
          value={nextInv ? date(nextInv.dueDate) : '—'}
          hint={
            k.nextDays == null
              ? 'sem faturas em aberto'
              : k.nextDays === 0
                ? 'vence hoje'
                : k.nextDays > 0
                  ? `faltam ${k.nextDays} ${k.nextDays === 1 ? 'dia' : 'dias'}`
                  : `atrasada há ${Math.abs(k.nextDays)} dias`
          }
        />
        <KpiCard
          label={`Pago em ${now.getFullYear()}`}
          icon={CircleDollarSign}
          tone="success"
          value={brl(k.paidYearAmount)}
          hint={`${k.paidYearCount} ${k.paidYearCount === 1 ? 'fatura paga' : 'faturas pagas'}`}
          onClick={() => setFilter('paga')}
          active={filter === 'paga'}
        />
      </section>

      <div className="mb-5 grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Composição por mês" description="Quanto cada parte pesou em cada fatura, por competência." />
          <CardBody>
            <BarsChart
              ariaLabel="Valor das faturas por competência, separado por tipo de cobrança"
              data={chartData}
              xKey="comp"
              format="brl"
              stacked
              height={250}
              series={[
                { key: 'mensalidade', label: 'Mensalidade', slot: 1 },
                { key: 'ggr', label: 'Comissão sobre GGR', slot: 2 },
                { key: 'mensagens', label: 'SMS e e-mail excedente', slot: 3 },
                { key: 'licencas', label: 'Licenças de jogos', slot: 4 },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={ReceiptText} title="Como a fatura é calculada" description="Contrato da plataforma (dados de demonstração)." />
          <CardBody>
            <ul className="space-y-3">
              <PriceRow icon={Server} slot={1} title="Mensalidade" text="R$ 2.490,00 fixos: site, painel, sportsbook e suporte técnico." />
              <PriceRow icon={Percent} slot={2} title="Comissão sobre o GGR" text="1,5% do GGR do mês (apostas menos prêmios)." />
              <PriceRow icon={MessageSquareText} slot={3} title="Mensagens excedentes" text="Franquia de 1.000 SMS e 50.000 e-mails. Acima disso, R$ 0,09 por SMS e R$ 0,004 por e-mail." />
              <PriceRow icon={Gamepad2} slot={4} title="Licenças de jogos" text="Repasse das provedoras contratadas no mês." />
            </ul>
            <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-xs leading-5 text-fg-3">
              Emitida no dia 2, vence no dia 12. Atraso: multa de 2% e juros de 1% ao mês, pro rata dia.
            </p>
          </CardBody>
        </Card>
      </div>

      <DataTable
        caption="Faturas da plataforma"
        rows={rows}
        columns={columns}
        rowKey={(i) => i.id}
        searchText={(i) => `${i.number} ${competenceLabel(i.competence)}`}
        searchPlaceholder="Buscar por número ou mês"
        initialSort={{ id: 'number', dir: 'desc' }}
        exportName="faturas"
        onExport={(n) => audit('exportar', 'Faturas', `Exportação CSV de ${n} faturas`)}
        onRowClick={(i) => setOpenId(i.id)}
        resetKey={filter}
        toolbar={
          <ChipFilter<Filter>
            value={filter}
            onChange={setFilter}
            className="max-w-full"
            options={[
              { value: 'todas', label: 'Todas', count: counts.todas },
              { value: 'aberta', label: 'Em aberto', count: counts.aberta, tone: 'warning' },
              { value: 'vencida', label: 'Vencidas', count: counts.vencida, tone: 'danger' },
              { value: 'paga', label: 'Pagas', count: counts.paga },
            ]}
          />
        }
        empty={{
          title: filter === 'vencida' ? 'Nenhuma fatura vencida' : 'Nenhuma fatura neste filtro',
          description: filter === 'vencida' ? 'Tudo em dia com a plataforma.' : 'Troque o filtro para ver outras faturas.',
          icon: filter === 'vencida' ? CheckCircle2 : ReceiptText,
        }}
      />

      <InvoiceDrawer inv={open} onClose={() => setOpenId(null)} onPay={(i) => setPayId(i.id)} onDownload={download} canPay={canEdit} payBlocked={payBlocked} />
      <PayModal inv={paying} onClose={() => setPayId(null)} onPaid={markPaid} />
    </>
  )
}

function PriceRow({ icon: Icon, slot, title, text }: { icon: LucideIcon; slot: SeriesSlot; title: string; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-3" style={{ color: seriesColor(slot) }}>
        <Icon size={15} aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-fg">{title}</p>
        <p className="text-xs leading-5 text-fg-3">{text}</p>
      </div>
    </li>
  )
}

function InvoiceDrawer({
  inv,
  onClose,
  onPay,
  onDownload,
  canPay,
  payBlocked,
}: {
  inv: Invoice | undefined
  onClose: () => void
  onPay: (i: Invoice) => void
  onDownload: (i: Invoice) => void
  canPay: boolean
  payBlocked?: string
}) {
  if (!inv) return null
  const st = invoiceStatus(inv)
  const late = lateCharges(inv)
  const total = inv.total || 1
  return (
    <Drawer
      open
      onClose={onClose}
      title={`Fatura ${inv.number}`}
      description={`Competência ${competenceLabel(inv.competence)} · emitida em ${date(inv.issuedAt)}`}
      headerExtra={
        <Badge tone={STATUS_TONE[st]} dot size="md">
          {INVOICE_STATUS_LABEL[st]}
        </Badge>
      }
      footer={
        <>
          <Button icon={Download} onClick={() => onDownload(inv)}>
            Baixar fatura
          </Button>
          {!inv.paid && (
            <Button variant="primary" icon={QrCode} onClick={() => onPay(inv)} disabled={!canPay} title={payBlocked}>
              Pagar {brl(late.total)}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-6">
        <div className="rounded-xl bg-surface-2 p-4">
          <p className="text-xs text-fg-3">{inv.paid ? 'Valor pago' : late.daysLate ? 'Valor atualizado' : 'Valor a pagar'}</p>
          <p className="mt-1 font-display text-3xl font-bold text-fg tnum">{brl(late.total)}</p>
          <p className={cn('mt-1 text-[13px]', st === 'vencida' ? 'font-medium text-danger' : st === 'aberta' ? 'text-warning' : 'text-fg-3')}>
            {inv.paid ? `Paga em ${dateTime(inv.paidAt)} por ${inv.paidBy}` : `Vencimento ${date(inv.dueDate)} · ${dueLabel(inv)}`}
          </p>
          {late.daysLate > 0 && (
            <p className="mt-2 border-t border-line pt-2 text-xs text-fg-3">
              Original {brl(inv.total)} + multa {brl(late.fine)} + juros de {late.daysLate} dias {brl(late.interest)}
            </p>
          )}
        </div>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Composição</h3>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden>
            {inv.items.map((it, i) => (
              <span key={i} style={{ width: `${(it.amount / total) * 100}%`, background: seriesColor(KIND_META[it.kind].slot), opacity: it.kind === 'email' ? 0.6 : 1 }} />
            ))}
          </div>
          <ul className="mt-4 divide-y divide-line">
            {inv.items.map((it, i) => {
              const Icon = KIND_META[it.kind].icon
              return (
                <li key={i} className="flex items-start gap-3 py-3 first:pt-0">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-3" style={{ color: seriesColor(KIND_META[it.kind].slot) }}>
                    <Icon size={15} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-fg">{it.description}</p>
                    <p className="text-xs leading-5 text-fg-3">{it.detail}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[13px] font-semibold text-fg tnum">{brl(it.amount)}</p>
                    <p className="text-[11px] text-fg-3 tnum">{pct(it.amount / total, 0)}</p>
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="mt-1 flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2.5">
            <span className="text-[13px] font-semibold text-fg">Total da fatura</span>
            <span className="text-sm font-bold text-fg tnum">{brl(inv.total)}</span>
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Dados da cobrança</h3>
          <DescriptionList
            items={[
              { label: 'Número', value: <Mono>{inv.number}</Mono> },
              { label: 'Competência', value: <span className="capitalize">{competenceLabel(inv.competence)}</span> },
              { label: 'Emissão', value: date(inv.issuedAt) },
              { label: 'Vencimento', value: date(inv.dueDate) },
              { label: 'Forma de pagamento', value: inv.method ?? 'PIX ou boleto' },
              { label: 'Itens', value: num(inv.items.length) },
            ]}
          />
        </section>
      </div>
    </Drawer>
  )
}

function PayModal({ inv, onClose, onPaid }: { inv: Invoice | undefined; onClose: () => void; onPaid: (i: Invoice) => void }) {
  if (!inv) return null
  const payload = demoPixPayload(inv)
  const late = lateCharges(inv)
  const d = daysUntilDue(inv.dueDate)
  return (
    <Modal
      open
      onClose={onClose}
      title={`Pagar fatura ${inv.number}`}
      description="Pague com PIX pelo app do banco e depois confirme aqui."
      icon={QrCode}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Fechar</Button>
          <Button variant="success" icon={CheckCircle2} onClick={() => onPaid(inv)}>
            Já paguei
          </Button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-2">
          <DemoQr payload={payload} />
          <Badge tone="warning" icon={Info}>
            QR de demonstração
          </Badge>
        </div>
        <div className="min-w-0 space-y-4">
          <div>
            <p className="text-xs text-fg-3">Valor</p>
            <p className="font-display text-2xl font-bold text-fg tnum">{brl(late.total)}</p>
            <p className={cn('text-[13px]', d < 0 ? 'text-danger' : 'text-fg-3')}>
              Vence em {date(inv.dueDate)} · {dueLabel(inv)}
              {late.daysLate > 0 && ' · inclui multa e juros'}
            </p>
          </div>
          <Field label="PIX copia e cola" htmlFor="pix-code" labelAside={<CopyButton value={payload} label="Copiar código PIX" />}>
            <Textarea id="pix-code" readOnly rows={3} value={payload} className="break-all font-mono text-[12px] leading-5" onFocus={(e) => e.currentTarget.select()} />
          </Field>
          <ol className="space-y-1.5 text-[13px] text-fg-2">
            <li className="flex gap-2">
              <StepNum n={1} /> No app do banco, abra PIX › Pix copia e cola.
            </li>
            <li className="flex gap-2">
              <StepNum n={2} /> Cole o código e confira o valor e o recebedor (Evox Plataforma).
            </li>
            <li className="flex gap-2">
              <StepNum n={3} /> Volte aqui e toque em “Já paguei”.
            </li>
          </ol>
        </div>
      </div>
      <Alert tone="neutral" icon={Hourglass} className="mt-5">
        Ambiente de demonstração: o código começa com “DEMO” e não é um PIX real. Nenhum banco aceita este pagamento.
      </Alert>
    </Modal>
  )
}

function StepNum({ n }: { n: number }) {
  return <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary-text">{n}</span>
}

/** QR ilustrativo gerado a partir do texto (não é um QR Code legível). */
function DemoQr({ payload }: { payload: string }) {
  const size = 25
  const cells = useMemo(() => {
    let h = 2166136261
    for (let i = 0; i < payload.length; i++) h = Math.imul(h ^ payload.charCodeAt(i), 16777619)
    const out: boolean[] = []
    for (let i = 0; i < size * size; i++) {
      h ^= h << 13
      h ^= h >>> 17
      h ^= h << 5
      out.push(((h >>> 0) & 3) === 0 || ((h >>> 0) & 7) === 1)
    }
    return out
  }, [payload])
  const finder = (x: number, y: number) => {
    const inBox = (ox: number, oy: number) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7
    for (const [ox, oy] of [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ]) {
      if (inBox(ox, oy)) {
        const dx = x - ox
        const dy = y - oy
        const ring = dx === 0 || dx === 6 || dy === 0 || dy === 6
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4
        return ring || core ? 1 : 0
      }
      if (x >= ox - 1 && x <= ox + 7 && y >= oy - 1 && y <= oy + 7) return 0
    }
    return -1
  }
  return (
    <svg viewBox={`-2 -2 ${size + 4} ${size + 4}`} className="h-[172px] w-[172px] rounded-xl border border-line bg-surface text-fg" role="img" aria-label="QR Code ilustrativo do PIX de demonstração">
      {cells.map((on, i) => {
        const x = i % size
        const y = Math.floor(i / size)
        const f = finder(x, y)
        const fill = f === -1 ? on : f === 1
        return fill ? <rect key={i} x={x} y={y} width={1} height={1} fill="currentColor" /> : null
      })}
    </svg>
  )
}
