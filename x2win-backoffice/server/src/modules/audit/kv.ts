// Chave auditoria.registros (leitura dos registros mais recentes).
import { canReadKey } from '@shared/kv-registry'
import { Errors } from '../../errors'
import type { KvHandlers, KvValue } from '../../kv/types'
import { toAuditEntry, type AuditRow } from './format'

/** Quantos registros a chave devolve (o restante pela rota paginada /api/audit). */
export const AUDIT_KV_LIMIT = 1000

export const kvHandlers: KvHandlers = {
  audit: {
    async read(ctx): Promise<KvValue> {
      if (!canReadKey(ctx.rule, ctx.auth.perms)) throw Errors.forbidden()
      const rows = await ctx.app.db.query<AuditRow>('select * from audit_log order by at desc, id desc limit $1', [AUDIT_KV_LIMIT])
      // versão = maior id gravado (a auditoria só cresce)
      const max = await ctx.app.db.one<{ v: number | null }>('select max(id) as v from audit_log')
      return { value: rows.map(toAuditEntry), version: Number(max?.v ?? 0), updatedAt: rows[0]?.at ?? null }
    },
  },
}
