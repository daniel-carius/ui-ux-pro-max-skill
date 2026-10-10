// Domínio 'ggr-settlements' (crescimento.ggr.apuracoes): apuração mensal do GGR e
// da taxa devida a cada provedora. O ciclo é aberta → fechada → paga e o servidor
// compara a lista enviada com a gravada, por id:
//  - nenhuma apuração é removida (403 campo_nao_permitido);
//  - apuração nova só entra 'aberta', com números válidos (apostado/pago ≥ 0,
//    taxa de 0 a 100%), mês "AAAA-MM" e uma por provedora e mês;
//  - aberta: os números não mudam pelo painel; só fecha (→ fechada) depois do fim
//    do mês: o servidor congela a taxa enviada (0–100%), recalcula a taxa devida
//    (GGR positivo × taxa) e define closedAt/closedBy/closedById;
//  - fechada: só passa para paga, com referência de 6 a 40 caracteres; o servidor
//    define paidAt/paidBy/paidById; nenhum outro campo muda;
//  - paga: não muda mais; status nunca volta (403 transicao_nao_permitida).
// Cada mudança vai para a auditoria com os valores (GGR, taxa, valor devido,
// referência), e a apuração removida ou reescrita continua recuperável pelos registros.
import { z } from 'zod'
import { canWriteKey } from '@shared/kv-registry'
import { brl } from '@shared/money'
import type { AuditAction } from '@shared/audit'
import { Errors } from '../../errors'
import type { KvContext, KvHandlers, KvValue } from '../../kv/types'
import { writeAudit } from '../../services/audit'
import { auditEntity, auditSummary, genericHandler } from './generic'
import { setOwn, type JsonObject } from './json'
import { assertVersion, encryptAtRest, loadRow, saveRow, storedValue } from './store'
import { diffItems, fieldNotAllowed, idOf, incomingList, parseOr400, round2, show, storedList, transitionNotAllowed } from './validate-util'

export const GGR_SETTLEMENTS_KEY = 'crescimento.ggr.apuracoes'
export const MAX_SETTLEMENTS = 20_000
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

const money = (msg: string) => z.number(msg).min(0, msg).max(1e12, msg)
const newSettlement = z.looseObject({
  id: z.string().min(1).max(64),
  month: z.string('Mês inválido.').regex(MONTH_RE, 'Mês inválido (use AAAA-MM).'),
  providerId: z.string('Provedora inválida.').min(1, 'Provedora inválida.').max(64, 'Provedora inválida.'),
  providerName: z.string('Nome da provedora inválido.').max(120, 'Nome da provedora inválido.'),
  bets: money('Valor apostado inválido.'),
  wins: money('Valor pago inválido.'),
  ggr: z.number('GGR inválido.').min(-1e12, 'GGR inválido.').max(1e12, 'GGR inválido.'),
  feePct: z.number('Taxa inválida.').min(0, 'Taxa entre 0% e 100%.').max(100, 'Taxa entre 0% e 100%.'),
  status: z.literal('aberta', 'Apuração nova entra aberta: feche e pague pelas ações da tela.'),
  dueDate: z.string('Vencimento inválido.').max(40, 'Vencimento inválido.').refine((s) => !Number.isNaN(Date.parse(s)), 'Vencimento inválido.'),
})
const feePct = z.number('Taxa inválida.').min(0, 'Taxa entre 0% e 100%.').max(100, 'Taxa entre 0% e 100%.')
const paymentRef = z.string('Referência inválida.').trim().min(6, 'Informe a referência do pagamento (mínimo 6 caracteres).').max(40, 'Use até 40 caracteres.')

/** Taxa da provedora: GGR negativo não gera taxa (mesma regra do painel). */
export function providerFee(ggr: number, pct: number) {
  return ggr > 0 ? round2((ggr * pct) / 100) : 0
}

/** O mês "AAAA-MM" já terminou no horário de Brasília (UTC−3)? */
export function monthEnded(month: string, now: number) {
  const [y, m] = month.split('-').map(Number)
  return now >= Date.UTC(y, m, 1, 3, 0, 0)
}

const CLOSE_FIELDS = ['status', 'feePct', 'feeDue', 'closedAt', 'closedBy', 'closedById']
const PAY_FIELDS = ['status', 'paidAt', 'paidBy', 'paidById', 'paymentRef']

function name(s: JsonObject) {
  return `${show(s.providerName)} ${show(s.month)}`
}

async function writeSettlements(ctx: KvContext, value: unknown, expectedVersion: number | undefined): Promise<KvValue> {
  const { app, auth, key, rule } = ctx
  if (!canWriteKey(rule, auth.perms)) throw Errors.forbidden()
  if (key !== GGR_SETTLEMENTS_KEY) throw Errors.forbidden('Estes dados não podem ser alterados pela tela.')
  const list = incomingList(value, 'apurações', MAX_SETTLEMENTS)

  return app.db.tx(async (t) => {
    const row = await loadRow(t, key, true)
    assertVersion(row, expectedVersion)
    const old = storedList(storedValue(row, app.cipher))
    const d = diffItems(old, list)
    if (d.removed.length) {
      throw fieldNotAllowed('Apurações não podem ser removidas.', { fields: [], removed: d.removed.slice(0, 20).map(idOf) })
    }
    const now = Date.now()
    const at = new Date(now).toISOString()
    const events: { action: AuditAction; entity: string; summary: string }[] = []
    const replaced = new Map<string, JsonObject>()

    for (const raw of d.added) {
      const s = parseOr400(newSettlement, raw, `Apuração ${idOf(raw)}: `)
      const out: JsonObject = { ...raw }
      for (const [f, v] of Object.entries({ feeDue: providerFee(s.ggr, s.feePct), closedAt: null, closedBy: null, paidAt: null, paidBy: null, paymentRef: null })) setOwn(out, f, v)
      delete out.closedById
      delete out.paidById
      replaced.set(s.id, out)
      events.push({
        action: 'criar',
        entity: `Apuração ${name(out)}`,
        summary: `Apuração aberta: apostado ${brl(s.bets)}, pago ${brl(s.wins)}, GGR ${brl(s.ggr)}, taxa ${s.feePct}%`,
      })
    }

    for (const c of d.changed) {
      const from = String(c.before.status)
      const to = String(c.after.status)
      if (from === 'aberta' && to === 'fechada') {
        const bad = c.fields.filter((f) => !CLOSE_FIELDS.includes(f))
        if (bad.length) throw fieldNotAllowed(`Apuração ${c.id}: ao fechar, só a taxa é congelada; os números do mês não mudam.`, { fields: bad, id: c.id })
        if (typeof c.before.month !== 'string' || !MONTH_RE.test(c.before.month) || !monthEnded(c.before.month, now)) {
          throw transitionNotAllowed(`Apuração ${c.id}: o mês ainda não terminou. A apuração fecha a partir do dia 1º do mês seguinte.`, { id: c.id })
        }
        const pct = parseOr400(feePct, c.after.feePct, `Apuração ${c.id}: `)
        const ggr = typeof c.before.ggr === 'number' ? c.before.ggr : 0
        const due = providerFee(ggr, pct)
        const out: JsonObject = { ...c.before }
        for (const [f, v] of Object.entries({ status: 'fechada', feePct: pct, feeDue: due, closedAt: at, closedBy: auth.user.name, closedById: auth.user.id })) setOwn(out, f, v)
        replaced.set(c.id, out)
        events.push({
          action: 'aprovar',
          entity: `Apuração ${name(out)}`,
          summary: `Apuração fechada: GGR ${brl(ggr)} × ${pct}% = ${brl(due)} (taxa antes ${show(c.before.feePct)}%, devido antes ${show(c.before.feeDue, true)}) · aberta → fechada`,
        })
      } else if (from === 'fechada' && to === 'paga') {
        const bad = c.fields.filter((f) => !PAY_FIELDS.includes(f))
        if (bad.length) throw fieldNotAllowed(`Apuração ${c.id}: depois de fechada, só o pagamento é registrado.`, { fields: bad, id: c.id })
        const ref = parseOr400(paymentRef, c.after.paymentRef, `Apuração ${c.id}: `)
        const out: JsonObject = { ...c.before }
        for (const [f, v] of Object.entries({ status: 'paga', paidAt: at, paidBy: auth.user.name, paidById: auth.user.id, paymentRef: ref })) setOwn(out, f, v)
        replaced.set(c.id, out)
        events.push({
          action: 'editar',
          entity: `Apuração ${name(out)}`,
          summary: `Marcada como paga: ${show(c.before.feeDue, true)} (ref. ${ref}) · fechada → paga`,
        })
      } else if (from === to) {
        throw fieldNotAllowed(
          from === 'aberta'
            ? `Apuração ${c.id}: os números da apuração aberta vêm da plataforma e não mudam pelo painel.`
            : `Apuração ${c.id}: apuração ${from} não pode ser alterada.`,
          { fields: c.fields, id: c.id },
        )
      } else {
        throw transitionNotAllowed(`Apuração ${c.id}: não é possível passar de ${show(from)} para ${show(to)}.`, { id: c.id })
      }
    }

    // uma apuração por provedora e mês
    const seen = new Set<string>()
    const oldById = new Map(old.map((o) => [idOf(o), o]))
    const next = list.map((s) => replaced.get(idOf(s)) ?? oldById.get(idOf(s)) ?? s)
    for (const s of next) {
      const k = `${String(s.providerId)}|${String(s.month)}`
      if (seen.has(k)) throw Errors.invalid(`Já existe apuração de ${name(s)}.`, { id: idOf(s) })
      seen.add(k)
    }

    const saved = await saveRow(t, app.cipher, key, next, encryptAtRest(rule), row, auth.user.id)
    const v0 = row?.version ?? 0
    if (events.length) {
      for (const e of events) await writeAudit(t, auth, { ...e, summary: auditSummary(key, e.summary, v0, saved.version) })
    } else {
      await writeAudit(t, auth, { action: 'editar', entity: auditEntity(rule.page), summary: auditSummary(key, 'Salvo sem alterações', v0, saved.version) })
    }
    return { value: next, version: saved.version, updatedAt: saved.updatedAt }
  })
}

const settlementRecord = newSettlement.extend({
  status: z.enum(['aberta', 'fechada', 'paga'], { error: 'Situação da apuração inválida.' }),
})

/**
 * Apurações vindas da plataforma (dados de demonstração): números válidos, uma por
 * provedora e mês, taxa devida = GGR positivo × taxa, e só fechada/paga depois do fim
 * do mês, com a referência do pagamento na paga.
 */
export function checkSettlementRecords(list: readonly JsonObject[], now: number) {
  const seen = new Set<string>()
  for (const raw of list) {
    const s = parseOr400(settlementRecord, raw, `Apuração ${idOf(raw)}: `)
    const k = `${s.providerId}|${s.month}`
    if (seen.has(k)) throw Errors.invalid(`Já existe apuração de ${name(raw)}.`, { id: s.id })
    seen.add(k)
    // tolerância de 1 centavo (arredondamento do GGR antes ou depois da taxa)
    if (typeof raw.feeDue !== 'number' || Math.abs(raw.feeDue - providerFee(s.ggr, s.feePct)) > 0.011) {
      throw Errors.invalid(`Apuração ${s.id}: a taxa devida não confere com o GGR e a taxa.`, { id: s.id })
    }
    if (s.status !== 'aberta' && !monthEnded(s.month, now)) throw Errors.invalid(`Apuração ${s.id}: o mês ainda não terminou.`, { id: s.id })
    if (s.status === 'paga') parseOr400(paymentRef, raw.paymentRef, `Apuração ${s.id}: `)
  }
}

export const kvHandlers: KvHandlers = {
  'ggr-settlements': { read: (ctx) => genericHandler.read(ctx), write: writeSettlements },
}
