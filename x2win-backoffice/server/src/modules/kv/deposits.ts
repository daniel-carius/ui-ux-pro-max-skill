// Registro de depósitos (operacao.depositos): os depósitos vêm do gateway e a
// lista é gravada só pelo servidor (PUT pela rota de dados → 403). A única ação do
// painel é a reconsulta de PIX vencido, por esta rota registrada sob /api/kv:
//
//   POST /api/kv/operacao.depositos/recheck { ids: string[] }
//
// Exige depositos.editar. Numa transação que trava a lista, cada depósito pedido
// que esteja 'pendente' e com o prazo do PIX vencido (createdAt + prazo gravado em
// operacao.depositos.limites, padrão 30 min) passa para 'expirado'; nenhum outro
// campo muda e nenhum depósito é incluído ou removido. Cada baixa vai para a
// auditoria (sincronizar) com valor, gateway e status antes → depois.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { findKvRule } from '@shared/kv-registry'
import { brl } from '@shared/money'
import { Errors } from '../../errors'
import { requirePerm } from '../../http'
import { writeAudit } from '../../services/audit'
import { auditSummary } from './generic'
import { setOwn, type JsonObject } from './json'
import { pixExpirationOf } from './rules-regulated'
import { encryptAtRest, loadRow, saveRow, storedValue } from './store'
import { storedList } from './validate-util'

export const DEPOSITS_KEY = 'operacao.depositos'
export const DEPOSIT_LIMITS_KEY = 'operacao.depositos.limites'
export const MAX_RECHECK_IDS = 500

const DEPOSITS_RULE = findKvRule(DEPOSITS_KEY)!

const recheckBody = z.object(
  {
    ids: z
      .array(z.string('Depósito inválido.').min(1, 'Depósito inválido.').max(64, 'Depósito inválido.'), 'Envie os depósitos a reconsultar.')
      .min(1, 'Envie pelo menos um depósito.')
      .max(MAX_RECHECK_IDS, `No máximo ${MAX_RECHECK_IDS} depósitos por vez.`),
  },
  'Envie { ids }.',
)

export function registerDepositRoutes(app: FastifyInstance) {
  app.post(`/${DEPOSITS_KEY}/recheck`, async (req, reply) => {
    const auth = requirePerm(req, 'depositos.editar')
    const { ids } = recheckBody.parse(req.body ?? {})
    const wanted = new Set(ids)
    const out = await app.db.tx(async (t) => {
      const row = await loadRow(t, DEPOSITS_KEY, true)
      if (!row) throw Errors.notFound('Depósito')
      const list = storedList(storedValue(row, app.cipher))
      const limitsRow = await loadRow(t, DEPOSIT_LIMITS_KEY)
      const expirationMin = pixExpirationOf(limitsRow ? storedValue(limitsRow, app.cipher) : null)
      const now = Date.now()
      const at = new Date(now).toISOString()
      const expired: JsonObject[] = []
      const found = new Set<string>()
      const next = list.map((d) => {
        if (typeof d.id !== 'string' || !wanted.has(d.id)) return d
        found.add(d.id)
        if (d.status !== 'pendente') return d
        const created = typeof d.createdAt === 'string' ? Date.parse(d.createdAt) : Number.NaN
        if (Number.isNaN(created) || created + expirationMin * 60_000 >= now) return d
        const e: JsonObject = { ...d }
        setOwn(e, 'status', 'expirado')
        setOwn(e, 'updatedAt', at)
        expired.push(e)
        return e
      })
      const missing = ids.filter((id) => !found.has(id))
      if (!expired.length) return { expired: [] as string[], missing, version: row.version }
      const saved = await saveRow(t, app.cipher, DEPOSITS_KEY, next, encryptAtRest(DEPOSITS_RULE), row, auth.user.id)
      for (const d of expired) {
        await writeAudit(t, auth, {
          action: 'sincronizar',
          entity: `Depósito #${String(d.id)}`,
          summary: auditSummary(
            DEPOSITS_KEY,
            `PIX de ${brl(Number(d.amount))} no ${String(d.gateway ?? 'gateway')} venceu sem pagamento (prazo de ${expirationMin} min): pendente → expirado`,
            row.version,
            saved.version,
          ),
        })
      }
      return { expired: expired.map((d) => String(d.id)), missing, version: saved.version }
    })
    reply.header('cache-control', 'no-store')
    // fora do prazo vencido ou já decididos ficam como estão
    const unchanged = ids.filter((id) => !out.expired.includes(id) && !out.missing.includes(id))
    return { ok: true as const, expired: out.expired, unchanged, missing: out.missing, version: out.version }
  })
}
