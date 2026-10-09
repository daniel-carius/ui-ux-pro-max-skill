// Chaves genéricas (sem módulo de domínio): JSON por chave em kv_store, com
// versão, cifra em repouso para segredos/dados pessoais, restauração de valores
// mascarados e auditoria com o resumo do que mudou.
import { PAGE_INFO_BY_ID } from '@shared/pages'
import type { KvContext, KvHandler, KvValue } from '../../kv/types'
import { writeAudit } from '../../services/audit'
import { summarizeChange } from './json'
import { restoreMasked, writePolicy } from './redact'
import { assertVersion, decodeRow, encryptAtRest, loadRow, saveRow, storedValue } from './store'

/** Entidade da auditoria: "Dados · <título da tela>". */
export function auditEntity(page: string) {
  return `Dados · ${PAGE_INFO_BY_ID.get(page)?.title ?? page}`
}

export const genericHandler: Required<KvHandler> = {
  async read(ctx: KvContext): Promise<KvValue | null> {
    const row = await loadRow(ctx.app.db, ctx.key)
    if (!row) return null
    return { value: decodeRow(row, ctx.app.cipher), version: row.version, updatedAt: row.updated_at }
  },

  async write(ctx: KvContext, value: unknown, expectedVersion: number | undefined): Promise<KvValue> {
    const { app, auth, key, rule } = ctx
    return app.db.tx(async (t) => {
      const row = await loadRow(t, key, true)
      assertVersion(row, expectedVersion)
      const stored = storedValue(row, app.cipher)
      const next = restoreMasked(value, stored, writePolicy(rule))
      const saved = await saveRow(t, app.cipher, key, next, encryptAtRest(rule), row, auth.user.id)
      await writeAudit(t, auth, {
        action: 'editar',
        entity: auditEntity(rule.page),
        summary: `${key} — ${summarizeChange(stored, next)}`,
      })
      return { value: next, version: saved.version, updatedAt: saved.updatedAt }
    })
  },
}
