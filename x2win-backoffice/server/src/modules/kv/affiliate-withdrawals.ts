// Saques de afiliados (afiliados.saques): os pedidos vêm da plataforma e a lista
// é gravada só pelo servidor (PUT pela rota de dados → 403). O painel decide cada
// pedido por estas rotas, registradas sob /api/kv:
//
//   POST /api/kv/afiliados.saques/:id/pay              → paga o pedido
//   POST /api/kv/afiliados.saques/:id/reject {reason}  → recusa e devolve o valor
//
// Exigem afiliados-saques.aprovar. Cada uma roda numa transação que trava a lista:
//  - só pedido 'pendente' é decidido (senão 409 ja_decidido);
//  - valor, afiliado, forma de pagamento e dados bancários são os gravados;
//  - quem decidiu (decidedBy/decidedById), quando (decidedAt) e a referência do
//    pagamento são definidos pelo servidor;
//  - cargo com teto de aprovação (approvalCeiling > 0) não paga acima do teto
//    (403 teto_excedido);
//  - na recusa, motivo de 3 a 300 caracteres e o valor reservado volta para o saldo
//    de comissão do afiliado (crescimento.afiliados) na mesma transação;
//  - auditoria do servidor com valor, afiliado, forma e status antes → depois.
import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { findKvRule } from '@shared/kv-registry'
import { brl } from '@shared/money'
import type { Db } from '../../db'
import { AppError, Errors } from '../../errors'
import { requirePerm } from '../../http'
import { writeAudit } from '../../services/audit'
import type { AuthContext } from '../../types'
import { affiliateBalance, AFFILIATES_KEY } from './affiliates'
import { auditSummary } from './generic'
import { setOwn, type JsonObject } from './json'
import { readPolicy, redact } from './redact'
import { encryptAtRest, loadRow, rewriteRowValue, saveRow, storedValue, type KvRow } from './store'
import { round2, storedList } from './validate-util'

export const AFFILIATE_WITHDRAWALS_KEY = 'afiliados.saques'
export const APPROVE_PERM = 'afiliados-saques.aprovar'

const WITHDRAWALS_RULE = findKvRule(AFFILIATE_WITHDRAWALS_KEY)!
const AFFILIATES_RULE = findKvRule(AFFILIATES_KEY)!

const idParams = z.object({ id: z.string().trim().min(1).max(64) })
const rejectBody = z.object({
  reason: z
    .string({ error: 'Informe o motivo da recusa.' })
    .trim()
    .min(3, 'O motivo precisa ter pelo menos 3 caracteres.')
    .max(300, 'O motivo pode ter no máximo 300 caracteres.'),
})

const alreadyDecided = () => new AppError(409, 'ja_decidido', 'Este pedido já foi decidido.')
const METHOD_LABEL: Record<string, string> = { pix: 'PIX', ted: 'TED', saldo: 'saldo do jogo' }

/** Referência do pagamento (gerada pelo servidor). */
export function paymentReference(method: unknown, now: Date): string {
  const rand = randomBytes(6).toString('hex').toUpperCase()
  if (method === 'pix') return `E${now.toISOString().slice(0, 10).replace(/-/g, '')}${rand}`
  if (method === 'ted') return `TED-${rand}`
  return `CRED-${rand}`
}

interface Locked {
  row: KvRow
  list: JsonObject[]
  index: number
  item: JsonObject
  amount: number
}

/** Trava a lista e acha o pedido pendente (404 sem pedido, 409 já decidido). */
async function lockPending(t: Db, cipher: FastifyInstance['cipher'], id: string): Promise<Locked> {
  const row = await loadRow(t, AFFILIATE_WITHDRAWALS_KEY, true)
  const list = row ? storedList(storedValue(row, cipher)) : []
  const index = list.findIndex((w) => w.id === id)
  if (!row || index < 0) throw Errors.notFound('Pedido de saque de afiliado')
  const item = list[index]
  if (item.status !== 'pendente') throw alreadyDecided()
  const amount = typeof item.amount === 'number' && Number.isFinite(item.amount) && item.amount > 0 ? round2(item.amount) : NaN
  if (Number.isNaN(amount)) throw new AppError(409, 'pedido_invalido', 'O pedido tem valor inválido. Peça a correção à plataforma.')
  return { row, list, index, item, amount }
}

function decided(item: JsonObject, auth: AuthContext, at: string, patch: JsonObject): JsonObject {
  const out: JsonObject = { ...item }
  for (const [k, v] of Object.entries({ ...patch, decidedAt: at, decidedBy: auth.user.name, decidedById: auth.user.id })) setOwn(out, k, v)
  return out
}

function who(item: JsonObject) {
  return `${typeof item.affiliateName === 'string' ? item.affiliateName : 'afiliado'} (${String(item.affiliateId ?? '—')})`
}

export function registerAffiliateWithdrawalRoutes(app: FastifyInstance) {
  app.post(`/${AFFILIATE_WITHDRAWALS_KEY}/:id/pay`, async (req, reply) => {
    const auth = requirePerm(req, APPROVE_PERM)
    const { id } = idParams.parse(req.params)
    const out = await app.db.tx(async (t) => {
      const { row, list, index, item, amount } = await lockPending(t, app.cipher, id)
      const ceiling = auth.role.approvalCeiling
      if (typeof ceiling === 'number' && ceiling > 0 && amount > ceiling) {
        throw new AppError(403, 'teto_excedido', `Valor acima do teto do cargo ${auth.role.name} (${brl(ceiling)}). Peça a um Administrador ou Superadmin.`, {
          ceiling,
          amount,
        })
      }
      const now = new Date()
      const reference = paymentReference(item.method, now)
      const next = decided(item, auth, now.toISOString(), { status: 'pago', reason: null, reference })
      const nextList = list.map((w, i) => (i === index ? next : w))
      const saved = await saveRow(t, app.cipher, AFFILIATE_WITHDRAWALS_KEY, nextList, encryptAtRest(WITHDRAWALS_RULE), row, auth.user.id)
      const method = METHOD_LABEL[String(item.method)] ?? String(item.method)
      await writeAudit(t, auth, {
        action: 'aprovar',
        entity: `Saque de afiliado #${id}`,
        summary: auditSummary(
          AFFILIATE_WITHDRAWALS_KEY,
          `Pagamento de ${brl(amount)} para ${who(item)} (${method}) · pendente → pago · ref. ${reference}`,
          row.version,
          saved.version,
        ),
      })
      return { item: next, version: saved.version, amount, method }
    })
    reply.header('cache-control', 'no-store')
    const how = out.item.method === 'pix' ? 'O PIX foi enviado.' : out.item.method === 'ted' ? 'A TED foi agendada.' : 'O valor entrou no saldo do jogo.'
    return {
      ok: true as const,
      message: `${brl(out.amount)} pagos a ${String(out.item.affiliateName ?? 'afiliado')}. ${how}`,
      withdrawal: redact(out.item, readPolicy(WITHDRAWALS_RULE, auth.perms)),
      version: out.version,
    }
  })

  app.post(`/${AFFILIATE_WITHDRAWALS_KEY}/:id/reject`, async (req, reply) => {
    const auth = requirePerm(req, APPROVE_PERM)
    const { id } = idParams.parse(req.params)
    const { reason } = rejectBody.parse(req.body ?? {})
    const out = await app.db.tx(async (t) => {
      const { row, list, index, item, amount } = await lockPending(t, app.cipher, id)
      const now = new Date().toISOString()
      const next = decided(item, auth, now, { status: 'recusado', reason, reference: null })
      const nextList = list.map((w, i) => (i === index ? next : w))
      const saved = await saveRow(t, app.cipher, AFFILIATE_WITHDRAWALS_KEY, nextList, encryptAtRest(WITHDRAWALS_RULE), row, auth.user.id)

      // o valor reservado volta para o saldo de comissão (campo do servidor: não muda a versão da lista de afiliados)
      let refund: string
      const affRow = await loadRow(t, AFFILIATES_KEY, true)
      const affiliates = affRow ? storedList(storedValue(affRow, app.cipher)) : []
      const ai = affiliates.findIndex((a) => a.id === item.affiliateId)
      if (affRow && ai >= 0) {
        const before = affiliateBalance(affiliates[ai])
        const after = round2(before + amount)
        const updated: JsonObject = { ...affiliates[ai] }
        setOwn(updated, 'balance', after)
        await rewriteRowValue(
          t,
          app.cipher,
          AFFILIATES_KEY,
          affiliates.map((a, i) => (i === ai ? updated : a)),
          encryptAtRest(AFFILIATES_RULE),
          affRow,
        )
        refund = `saldo de comissão ${brl(before)} → ${brl(after)}`
      } else {
        refund = 'afiliado não encontrado na base: saldo não devolvido'
      }
      await writeAudit(t, auth, {
        action: 'recusar',
        entity: `Saque de afiliado #${id}`,
        summary: auditSummary(
          AFFILIATE_WITHDRAWALS_KEY,
          `Pedido de ${brl(amount)} de ${who(item)} recusado: ${reason} · pendente → recusado · ${refund}`,
          row.version,
          saved.version,
        ),
      })
      return { item: next, version: saved.version, amount, refunded: affRow !== null && ai >= 0 }
    })
    reply.header('cache-control', 'no-store')
    return {
      ok: true as const,
      message: out.refunded
        ? `${brl(out.amount)} voltaram para o saldo de comissão de ${String(out.item.affiliateName ?? 'afiliado')}.`
        : 'Pedido recusado. O afiliado não está na base: confira o saldo com a plataforma.',
      withdrawal: redact(out.item, readPolicy(WITHDRAWALS_RULE, auth.perms)),
      version: out.version,
    }
  })
}
