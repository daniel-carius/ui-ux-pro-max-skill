// Chaves genéricas (sem módulo de domínio): JSON por chave em kv_store, com
// versão, cifra em repouso para segredos/dados pessoais, restauração de valores
// mascarados, validação das chaves com regra de negócio (validators.ts), limite de
// tamanho por chave e auditoria com o resumo do que mudou e as versões (v1→v2):
// cada linha da auditoria aponta para uma versão recuperável (rule.history).
import { KV_DEFAULT_MAX_BYTES, type KvRule } from '@shared/kv-registry'
import { PAGE_INFO_BY_ID } from '@shared/pages'
import { AppError } from '../../errors'
import type { KvContext, KvHandler, KvValue } from '../../kv/types'
import { writeAudit } from '../../services/audit'
import { summarizeChange } from './json'
import { restoreMasked, writePolicy } from './redact'
import { assertVersion, decodeRow, encryptAtRest, loadRow, saveRow, storedValue } from './store'
import { validatorFor } from './validators'

/** Entidade da auditoria: "Dados · <título da tela>". */
export function auditEntity(page: string) {
  return `Dados · ${PAGE_INFO_BY_ID.get(page)?.title ?? page}`
}

/** " (v1→v2)": versões antes e depois da gravação, para achar o valor no histórico. */
export function versionNote(before: number, after: number) {
  return ` (v${before}→v${after})`
}

/** Limite do resumo na auditoria (services/audit corta acima disso). */
const AUDIT_SUMMARY_MAX = 1000

/** "<chave> — <resumo> (v1→v2)", cortando o resumo para as versões nunca sumirem. */
export function auditSummary(key: string, detail: string, before: number, after: number) {
  const head = `${key} — `
  const tail = versionNote(before, after)
  const room = AUDIT_SUMMARY_MAX - head.length - tail.length
  return `${head}${detail.length > room ? `${detail.slice(0, room - 1)}…` : detail}${tail}`
}

/** Recusa valor maior que o limite da chave (413). */
export function assertSize(value: unknown, rule: KvRule) {
  const max = rule.maxBytes ?? KV_DEFAULT_MAX_BYTES
  const bytes = Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')
  if (bytes > max) {
    throw new AppError(413, 'dados_grandes_demais', `Os dados passam do limite desta tela (${Math.round(max / 1024)} KB).`, { bytes, max })
  }
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
      let next = restoreMasked(value, stored, writePolicy(rule))
      let detail: string | undefined
      const validate = validatorFor(key)
      if (validate) {
        const r = await validate({ t, app, auth, key, stored, next, now: Date.now() })
        next = r.value
        detail = r.summary
      }
      assertSize(next, rule)
      const saved = await saveRow(t, app.cipher, key, next, encryptAtRest(rule), row, auth.user.id)
      await writeAudit(t, auth, {
        action: 'editar',
        entity: auditEntity(rule.page),
        summary: auditSummary(key, detail ?? summarizeChange(stored, next), row?.version ?? 0, saved.version),
      })
      return { value: next, version: saved.version, updatedAt: saved.updatedAt }
    })
  },
}
