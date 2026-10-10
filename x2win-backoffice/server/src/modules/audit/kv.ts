// Chave auditoria.registros (leitura dos registros mais recentes).
import { canReadKey } from '@shared/kv-registry'
import { Errors } from '../../errors'
import type { KvHandlers, KvValue } from '../../kv/types'
import { toAuditEntry, type AuditRow } from './format'

/** Quantos registros do servidor a chave devolve (o restante pela rota paginada /api/audit). */
export const AUDIT_KV_LIMIT = 1000
/**
 * Janela separada para os relatados pelo painel (source = 'painel'): uma rajada deles nunca empurra para fora
 * da chave os registros que o servidor gravou (aprovações, logins, mudanças de equipe...).
 */
export const AUDIT_KV_PANEL_LIMIT = 200

const newestFirst = (a: AuditRow, b: AuditRow) => {
  const t = Date.parse(String(b.at)) - Date.parse(String(a.at))
  return t !== 0 ? t : Number(b.id) - Number(a.id)
}

export const kvHandlers: KvHandlers = {
  audit: {
    async read(ctx): Promise<KvValue> {
      if (!canReadKey(ctx.rule, ctx.auth.perms)) throw Errors.forbidden()
      const server = await ctx.app.db.query<AuditRow>(
        `select * from audit_log where source = 'servidor' order by at desc, id desc limit $1`,
        [AUDIT_KV_LIMIT],
      )
      const panel = await ctx.app.db.query<AuditRow>(
        `select * from audit_log where source = 'painel' order by at desc, id desc limit $1`,
        [AUDIT_KV_PANEL_LIMIT],
      )
      const rows = [...server, ...panel].sort(newestFirst)
      // versão = maior id gravado (a auditoria só cresce)
      const max = await ctx.app.db.one<{ v: number | null }>('select max(id) as v from audit_log')
      return { value: rows.map(toAuditEntry), version: Number(max?.v ?? 0), updatedAt: rows[0]?.at ?? null }
    },
  },
}
