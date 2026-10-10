// Apurações mensais por provedora (demonstração): o GGR de cassino de cada mês,
// distribuído por jogo e somado por provedora, com a taxa devida.
import { createRng } from '@/lib/random'
import { seedProviders } from './catalog'
import { DEMO_STAFF_LABEL, demoRecords } from './demo'
import { gameStatsForPeriod, getDailySeries, sumSeries } from './metrics'
import { NOW, DAY } from './now'
import { aggregateByProvider, dueDateFor, reconcileStats, lastMonths, monthBounds, providerFee, type Settlement } from '@/domain/ggr'

export const GGR_KEYS = {
  settlements: 'crescimento.ggr.apuracoes',
} as const

const r2 = (v: number) => Math.round(v * 100) / 100
/** autor de fechamento e pagamento: um rótulo genérico (o sorteio continua, para não mudar os demais valores) */
const DECIDERS = [DEMO_STAFF_LABEL] as const

export function seedSettlements(): Settlement[] {
  const rng = createRng(4401)
  const series = getDailySeries()
  const providers = seedProviders()
  const months = lastMonths(6, NOW)
  const out: Settlement[] = []
  months.forEach((month, mi) => {
    const rows = series.filter((r) => r.date.startsWith(month))
    if (!rows.length) return
    const t = sumSeries(rows)
    const byProvider = aggregateByProvider(reconcileStats(gameStatsForPeriod(t.casinoBets, t.casinoWins, 500 + mi), t.casinoBets, t.casinoWins), providers)
    const end = monthBounds(month).to
    byProvider.forEach((p, pi) => {
      // mês atual: aberta (parcial); mês passado: quase todas abertas; 2 meses: parte fechada; mais antigas: pagas
      const status: Settlement['status'] = mi === 0 ? 'aberta' : mi === 1 ? (pi % 4 === 1 ? 'fechada' : 'aberta') : mi === 2 ? (pi % 3 === 0 ? 'fechada' : 'paga') : 'paga'
      const closedAt = status === 'aberta' ? null : new Date(end.getTime() + rng.int(1, 4) * DAY + rng.int(9, 18) * 3_600_000).toISOString()
      const paidAt = status === 'paga' && closedAt ? new Date(new Date(closedAt).getTime() + rng.int(2, 6) * DAY).toISOString() : null
      out.push({
        id: `ap-${month}-${p.providerId}`,
        month,
        providerId: p.providerId,
        providerName: p.providerName,
        bets: r2(p.bets),
        wins: r2(p.wins),
        ggr: r2(p.ggr),
        feePct: p.feePct,
        feeDue: providerFee(p.ggr, p.feePct),
        status,
        dueDate: dueDateFor(month),
        closedAt,
        closedBy: closedAt ? rng.pick(DECIDERS) : null,
        paidAt,
        paidBy: paidAt ? rng.pick(DECIDERS) : null,
        paymentRef: paidAt ? `DEMO-TED-${month.replace('-', '')}-${String(pi + 1).padStart(3, '0')}` : null,
      })
    })
  })
  return out
}

// modo API: as apurações vêm do servidor (DEMO_DATA grava estas mesmas); sem nada gravado, lista vazia
demoRecords(seedSettlements)
