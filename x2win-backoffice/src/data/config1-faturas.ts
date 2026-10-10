// Faturas da plataforma: a fatura em aberto (OPEN_INVOICE) e 8 meses anteriores pagos.
import { createRng } from '@/lib/random'
import { OPEN_INVOICE } from '@/domain/system'
import { round2, sumItems, type Invoice, type InvoiceItem } from '@/domain/config1-faturas'
import { demoRecords } from './demo'

const MONTHLY_FEE = 2490
const GGR_RATE = 0.015
const SMS_PRICE = 0.09
const EMAIL_PRICE = 0.004
const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty = (v: number) => v.toLocaleString('pt-BR')

function items(ggrBase: number, sms: number, emails: number, licences: number, providers: string): InvoiceItem[] {
  const list: InvoiceItem[] = [
    { kind: 'mensalidade', description: 'Mensalidade da plataforma', detail: 'Plano Operação · site, backoffice, sportsbook e suporte técnico', amount: MONTHLY_FEE },
    { kind: 'ggr', description: 'Comissão sobre o GGR', detail: `1,5% sobre GGR de R$ ${fmt(ggrBase)}`, amount: round2(ggrBase * GGR_RATE) },
    { kind: 'licencas', description: 'Licenças de jogos', detail: `Repasse das provedoras: ${providers}`, amount: licences },
  ]
  if (sms > 0) list.push({ kind: 'sms', description: 'SMS excedente', detail: `${qty(sms)} SMS acima da franquia de 1.000 × R$ ${fmt(SMS_PRICE)}`, amount: round2(sms * SMS_PRICE) })
  if (emails > 0) list.push({ kind: 'email', description: 'E-mail excedente', detail: `${qty(emails)} e-mails acima da franquia de 50.000 × R$ ${EMAIL_PRICE.toLocaleString('pt-BR', { minimumFractionDigits: 3 })}`, amount: round2(emails * EMAIL_PRICE) })
  return list
}

/** dia D às 12h do mês (ano, mês 1-12) */
function at(y: number, m: number, day: number, hour = 12) {
  return new Date(y, m - 1, day, hour, 0, 0).toISOString()
}

export function seedInvoices(): Invoice[] {
  const rng = createRng(2026_10)
  const due = new Date(OPEN_INVOICE.dueDate)
  const y = due.getFullYear()
  const m = due.getMonth() + 1 // mês do vencimento da fatura aberta
  const compMonth = m === 1 ? 12 : m - 1
  const compYear = m === 1 ? y - 1 : y

  // Fatura em aberto: R$ 6.498,68 (bate com o aviso do topo do painel)
  const openItems = items(180_000, 3_812, 18_900, 890, 'Pragmatic Play, PG Soft e Evolution')
  const open: Invoice = {
    id: `fat-${compYear}-${String(compMonth).padStart(2, '0')}`,
    number: `FAT-${compYear}-${String(compMonth).padStart(2, '0')}`,
    competence: `${compYear}-${String(compMonth).padStart(2, '0')}`,
    issuedAt: at(y, m, 2, 9),
    dueDate: OPEN_INVOICE.dueDate,
    items: openItems,
    total: sumItems(openItems),
    paid: false,
    paidAt: null,
    paidBy: null,
    method: null,
  }

  const payers = ['Daniel Carius', 'Daniel Carius', 'Rafael Lima']
  const past: Invoice[] = []
  for (let k = 1; k <= 8; k++) {
    // competência k meses antes da competência em aberto
    const cm0 = compMonth - k
    const cy = compYear + Math.floor((cm0 - 1) / 12)
    const cm = ((((cm0 - 1) % 12) + 12) % 12) + 1
    const dm = cm === 12 ? 1 : cm + 1
    const dy = cm === 12 ? cy + 1 : cy
    const ggr = Math.round(rng.float(118_000, 176_000, 0) / 100) * 100
    const sms = rng.bool(0.8) ? rng.int(600, 4200) : 0
    const emails = rng.bool(0.55) ? rng.int(2_000, 22_000) : 0
    const lic = k > 5 ? 640 : rng.pick([890, 890, 760])
    const prov = k > 5 ? 'Pragmatic Play e PG Soft' : 'Pragmatic Play, PG Soft e Evolution'
    const it = items(ggr, sms, emails, lic, prov)
    const paidDay = rng.int(7, 11)
    past.push({
      id: `fat-${cy}-${String(cm).padStart(2, '0')}`,
      number: `FAT-${cy}-${String(cm).padStart(2, '0')}`,
      competence: `${cy}-${String(cm).padStart(2, '0')}`,
      issuedAt: at(dy, dm, 2, 9),
      dueDate: at(dy, dm, 12),
      items: it,
      total: sumItems(it),
      paid: true,
      paidAt: at(dy, dm, paidDay, rng.int(9, 18)),
      paidBy: rng.pick(payers),
      method: k === 8 ? 'Boleto' : 'PIX',
    })
  }
  return [open, ...past]
}

// modo API: registros só do servidor (sem nada gravado, lista vazia; o gerador não roda)
demoRecords(seedInvoices)
