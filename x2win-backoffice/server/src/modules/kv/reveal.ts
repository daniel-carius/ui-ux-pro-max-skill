// Dados de pagamento de afiliados em claro, um registro por vez. As listas
// afiliados.saques e crescimento.afiliados saem com chave PIX, dados bancários e
// e-mail mascarados para todos (KvRule.pii.revealByRecord); quem tem
// afiliados-saques.ver-pix (e lê a chave) pede o registro em claro por estas rotas,
// registradas sob /api/kv:
//
//   POST /api/kv/afiliados.saques/:id/reveal      → chave PIX, dados bancários e e-mail do pedido
//   POST /api/kv/crescimento.afiliados/:id/reveal → e-mail e chave PIX do afiliado
//
// Cada pedido fica na auditoria do servidor ('revelar'), com o registro e quais
// campos saíram (nunca os valores).
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { canReadKey, findKvRule } from '@shared/kv-registry'
import { Errors } from '../../errors'
import { requirePerm } from '../../http'
import { writeAudit } from '../../services/audit'
import { AFFILIATE_WITHDRAWALS_KEY } from './affiliate-withdrawals'
import { AFFILIATES_KEY } from './affiliates'
import { isPlainObject, type JsonObject } from './json'
import { loadRow, storedValue } from './store'
import { storedList } from './validate-util'

export const REVEAL_PERM = 'afiliados-saques.ver-pix'

const idParams = z.object({ id: z.string().trim().min(1).max(64) })

const text = (v: unknown) => (typeof v === 'string' && v ? v : null)

/** Pessoa com a permissão de revelar e que lê a chave; o registro gravado com o id. */
async function revealable(app: FastifyInstance, req: FastifyRequest, key: string, what: string) {
  const auth = requirePerm(req, REVEAL_PERM)
  const rule = findKvRule(key)!
  if (!canReadKey(rule, auth.perms)) throw Errors.forbidden('Seu cargo não pode ver estes dados.')
  const { id } = idParams.parse(req.params)
  const row = await loadRow(app.db, key)
  const item = row ? storedList(storedValue(row, app.cipher)).find((x) => x.id === id) : undefined
  if (!item) throw Errors.notFound(what)
  return { auth, id, item }
}

function who(name: unknown, id: unknown) {
  return `${typeof name === 'string' && name ? name : 'afiliado'} (${String(id ?? '—')})`
}

export function registerRevealRoutes(app: FastifyInstance) {
  app.post(`/${AFFILIATE_WITHDRAWALS_KEY}/:id/reveal`, async (req, reply) => {
    const { auth, id, item } = await revealable(app, req, AFFILIATE_WITHDRAWALS_KEY, 'Pedido de saque de afiliado')
    const bank = isPlainObject(item.bank) ? (item.bank as JsonObject) : null
    const out = {
      ok: true as const,
      id,
      affiliateId: text(item.affiliateId),
      affiliateEmail: text(item.affiliateEmail),
      method: text(item.method),
      pixKeyType: text(item.pixKeyType),
      pixKey: text(item.pixKey),
      bank: bank ? { bank: text(bank.bank), agency: text(bank.agency), account: text(bank.account), holder: text(bank.holder) } : null,
    }
    const fields = [out.pixKey && `chave PIX${out.pixKeyType ? ` (${out.pixKeyType})` : ''}`, out.bank && 'dados bancários', out.affiliateEmail && 'e-mail'].filter(Boolean)
    await writeAudit(app.db, auth, {
      action: 'revelar',
      entity: `Saque de afiliado #${id}`,
      summary: `${AFFILIATE_WITHDRAWALS_KEY} — dados de pagamento de ${who(item.affiliateName, item.affiliateId)} vistos em claro: ${fields.length ? fields.join(', ') : 'nenhum dado pessoal no pedido'}`,
    })
    reply.header('cache-control', 'no-store')
    return out
  })

  app.post(`/${AFFILIATES_KEY}/:id/reveal`, async (req, reply) => {
    const { auth, id, item } = await revealable(app, req, AFFILIATES_KEY, 'Afiliado')
    const out = { ok: true as const, id, email: text(item.email), pixKey: text(item.pixKey) }
    const fields = [out.pixKey && 'chave PIX', out.email && 'e-mail'].filter(Boolean)
    await writeAudit(app.db, auth, {
      action: 'revelar',
      entity: `Afiliado #${id}`,
      summary: `${AFFILIATES_KEY} — dados de ${who(item.name, id)} vistos em claro: ${fields.length ? fields.join(', ') : 'nenhum dado pessoal no cadastro'}`,
    })
    reply.header('cache-control', 'no-store')
    return out
  })
}
