// Regras de Configurações › Faturas (cobranças da plataforma Evox à operação).
// Status, prazos, multa e juros, PIX de demonstração e o texto da fatura para baixar.
import type { CompanyState } from './system'

const DAY_MS = 86_400_000

export const INVOICES_KEY = 'config.faturas'

export type InvoiceItemKind = 'mensalidade' | 'ggr' | 'sms' | 'email' | 'licencas'

export const ITEM_KIND_LABEL: Record<InvoiceItemKind, string> = {
  mensalidade: 'Mensalidade da plataforma',
  ggr: 'Comissão sobre o GGR',
  sms: 'SMS excedente',
  email: 'E-mail excedente',
  licencas: 'Licenças de jogos',
}

export interface InvoiceItem {
  kind: InvoiceItemKind
  description: string
  /** como o valor foi calculado (ex.: "1,5% sobre GGR de R$ 180.000,00") */
  detail: string
  amount: number
}

export interface Invoice {
  id: string
  /** número da fatura, ex.: FAT-2026-09 */
  number: string
  /** competência AAAA-MM */
  competence: string
  issuedAt: string
  dueDate: string
  items: InvoiceItem[]
  total: number
  /** guardado: aberta ou paga. "Vencida" é calculado pela data. */
  paid: boolean
  paidAt: string | null
  paidBy: string | null
  method: 'PIX' | 'Boleto' | null
}

export type InvoiceStatus = 'aberta' | 'vencida' | 'paga'

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = { aberta: 'Em aberto', vencida: 'Vencida', paga: 'Paga' }

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Dias corridos até o vencimento (negativo = já venceu). */
export function daysUntilDue(dueDate: string, now: Date = new Date()): number {
  return Math.round((startOfDay(new Date(dueDate)).getTime() - startOfDay(now).getTime()) / DAY_MS)
}

export function invoiceStatus(inv: Invoice, now: Date = new Date()): InvoiceStatus {
  if (inv.paid) return 'paga'
  return daysUntilDue(inv.dueDate, now) < 0 ? 'vencida' : 'aberta'
}

export function dueLabel(inv: Invoice, now: Date = new Date()): string {
  if (inv.paid) return 'paga'
  const d = daysUntilDue(inv.dueDate, now)
  if (d === 0) return 'vence hoje'
  if (d === 1) return 'vence amanhã'
  if (d > 1) return `vence em ${d} dias`
  return `venceu há ${Math.abs(d)} ${Math.abs(d) === 1 ? 'dia' : 'dias'}`
}

/** Multa de 2% + juros de 1% ao mês (pro rata dia) após o vencimento. */
export const LATE_FINE = 0.02
export const LATE_INTEREST_MONTH = 0.01

export function lateCharges(inv: Invoice, now: Date = new Date()) {
  const late = inv.paid ? 0 : Math.max(0, -daysUntilDue(inv.dueDate, now))
  if (!late) return { daysLate: 0, fine: 0, interest: 0, total: inv.total }
  const fine = round2(inv.total * LATE_FINE)
  const interest = round2(inv.total * LATE_INTEREST_MONTH * (late / 30))
  return { daysLate: late, fine, interest, total: round2(inv.total + fine + interest) }
}

export function round2(n: number) {
  return Math.round(n * 100) / 100
}

export function sumItems(items: InvoiceItem[]) {
  return round2(items.reduce((s, i) => s + i.amount, 0))
}

export function invoiceKpis(list: Invoice[], now: Date = new Date()) {
  const open = list.filter((i) => !i.paid)
  const overdue = open.filter((i) => invoiceStatus(i, now) === 'vencida')
  const next = [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null
  const year = now.getFullYear()
  const paidYear = list.filter((i) => i.paid && i.paidAt && new Date(i.paidAt).getFullYear() === year)
  return {
    openAmount: round2(open.reduce((s, i) => s + lateCharges(i, now).total, 0)),
    openCount: open.length,
    overdueAmount: round2(overdue.reduce((s, i) => s + lateCharges(i, now).total, 0)),
    overdueCount: overdue.length,
    next,
    nextDays: next ? daysUntilDue(next.dueDate, now) : null,
    paidYearAmount: round2(paidYear.reduce((s, i) => s + i.total, 0)),
    paidYearCount: paidYear.length,
  }
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "2026-09" → "setembro/2026" */
export function competenceLabel(c: string, short = false): string {
  const [y, m] = c.split('-').map(Number)
  const name = MONTHS[m - 1] ?? c
  return short ? `${name.slice(0, 3)}/${String(y).slice(2)}` : `${name}/${y}`
}

/**
 * PIX copia e cola de DEMONSTRAÇÃO. Não é um código EMV válido e não pode ser
 * pago em banco nenhum: o texto deixa isso explícito.
 */
export function demoPixPayload(inv: Invoice): string {
  const value = inv.total.toFixed(2)
  return `DEMO-PIX-COPIA-E-COLA|NAO-E-UM-PIX-REAL|RECEBEDOR=EVOX-PLATAFORMA-DEMO|FATURA=${inv.number}|VALOR=${value}|TXID=DEMO${inv.id.replace(/\W/g, '').toUpperCase()}`
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const d = (iso: string) => new Date(iso).toLocaleDateString('pt-BR')

/** Fatura em texto simples, para baixar e arquivar. */
export function invoiceText(inv: Invoice, company: CompanyState, now: Date = new Date()): string {
  const st = invoiceStatus(inv, now)
  const late = lateCharges(inv, now)
  const width = 64
  const line = '-'.repeat(width)
  const row = (label: string, value: string) => {
    const space = Math.max(1, width - label.length - value.length)
    return `${label}${' '.repeat(space)}${value}`
  }
  const out: string[] = [
    'FATURA DE SERVIÇOS DA PLATAFORMA (DEMONSTRAÇÃO)',
    line,
    `Fatura: ${inv.number}`,
    `Competência: ${competenceLabel(inv.competence)}`,
    `Emissão: ${d(inv.issuedAt)}    Vencimento: ${d(inv.dueDate)}`,
    `Status: ${INVOICE_STATUS_LABEL[st]}${inv.paidAt ? ` em ${d(inv.paidAt)} (${inv.method ?? 'PIX'})` : ''}`,
    '',
    'CLIENTE',
    `${company.legalName}`,
    `CNPJ ${company.cnpj.replace(/^(\w{2})(\w{3})(\w{3})(\w{4})(\d{2})$/, '$1.$2.$3/$4-$5')}`,
    company.address,
    '',
    'PRESTADORA',
    'Evox Plataforma de Jogos (dados de demonstração)',
    '',
    'ITENS',
    line,
    ...inv.items.flatMap((it) => [row(it.description, brl(it.amount)), `  ${it.detail}`]),
    line,
    row('TOTAL', brl(inv.total)),
  ]
  if (late.daysLate > 0) {
    out.push(row(`Multa (2%)`, brl(late.fine)), row(`Juros (${late.daysLate} dias)`, brl(late.interest)), row('TOTAL ATUALIZADO', brl(late.total)))
  }
  out.push('', 'Após o vencimento: multa de 2% e juros de 1% ao mês, pro rata dia.', 'Documento gerado pelo backoffice X2Win. Sem valor fiscal.')
  return out.join('\r\n')
}
