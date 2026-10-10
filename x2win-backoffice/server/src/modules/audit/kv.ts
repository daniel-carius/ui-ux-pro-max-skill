// Chave auditoria.registros (leitura dos registros mais recentes).
//
// A trilha inteira só para quem vê a Auditoria (auditoria.ver). As outras telas que leem a chave (readPages em
// shared/kv-registry.ts) recebem só a fatia que mostram, filtrada no banco antes do limite:
//  - Modo de ataque: registros do "Modo de ataque" (quem ligou/desligou e quando);
//  - Segurança do painel: registros da própria configuração (lista de IPs, 2FA para todos, sessão), do 2FA e os
//    logins (entradas no painel);
//  - Equipe: registros sobre pessoas da equipe (acessos, convites, cargos, 2FA de cada pessoa).
// Nessas fatias o IP só vem nos registros da própria pessoa (login de outra pessoa sai sem IP).
import { canReadKey } from '@shared/kv-registry'
import { canViewPage } from '@shared/permissions'
import { Errors } from '../../errors'
import type { KvHandlers, KvValue } from '../../kv/types'
import type { AuthContext } from '../../types'
import { toAuditEntry, type AuditRow } from './format'

/** Quantos registros do servidor a chave devolve (o restante pela rota paginada /api/audit). */
export const AUDIT_KV_LIMIT = 1000
/**
 * Janela separada para os relatados pelo painel (source = 'painel'): uma rajada deles nunca empurra para fora
 * da chave os registros que o servidor gravou (aprovações, logins, mudanças de equipe...).
 */
export const AUDIT_KV_PANEL_LIMIT = 200

/** Permissão que libera a trilha inteira na chave. */
export const AUDIT_FULL_PERMISSION = 'auditoria.ver'

/** Fatia de cada tela que lê a chave sem ver a Auditoria (SQL fixo, sem dado de quem pede). */
const PAGE_SLICES: Record<string, string> = {
  'modo-ataque': `entity = 'Modo de ataque'`,
  'seguranca-painel': `entity = 'Segurança do painel' or entity = '2FA' or entity like '2FA · %' or (action = 'login' and entity = 'Acesso ao painel')`,
  equipe: `entity = 'Equipe' or entity like 'Equipe · %' or entity = 'Dados · Equipe' or entity like '2FA · %'`,
}

/** Filtro da leitura: null = trilha inteira; senão a condição das fatias que a pessoa pode ver. */
export function auditSliceWhere(perms: ReadonlySet<string>): string | null {
  if (perms.has(AUDIT_FULL_PERMISSION)) return null
  const parts = Object.entries(PAGE_SLICES)
    .filter(([page]) => canViewPage(perms, page))
    .map(([, where]) => `(${where})`)
  return parts.length ? `(${parts.join(' or ')})` : 'false'
}

const newestFirst = (a: AuditRow, b: AuditRow) => {
  const t = Date.parse(String(b.at)) - Date.parse(String(a.at))
  return t !== 0 ? t : Number(b.id) - Number(a.id)
}

/** Fatia: IP só nos registros da própria pessoa. */
function sliceEntry(r: AuditRow, auth: AuthContext) {
  const e = toAuditEntry(r)
  return r.actor_id === auth.user.id ? e : { ...e, ip: '' }
}

export const kvHandlers: KvHandlers = {
  audit: {
    async read(ctx): Promise<KvValue> {
      if (!canReadKey(ctx.rule, ctx.auth.perms)) throw Errors.forbidden()
      const slice = auditSliceWhere(ctx.auth.perms)
      // o limite vale depois do filtro: a fatia de uma tela não some atrás de registros que ela não vê
      const filter = slice ? ` and ${slice}` : ''
      const server = await ctx.app.db.query<AuditRow>(
        `select * from audit_log where source = 'servidor'${filter} order by at desc, id desc limit $1`,
        [AUDIT_KV_LIMIT],
      )
      const panel = await ctx.app.db.query<AuditRow>(
        `select * from audit_log where source = 'painel'${filter} order by at desc, id desc limit $1`,
        [AUDIT_KV_PANEL_LIMIT],
      )
      const rows = [...server, ...panel].sort(newestFirst)
      // versão = maior id gravado (a auditoria só cresce)
      const max = await ctx.app.db.one<{ v: number | null }>('select max(id) as v from audit_log')
      return {
        value: rows.map((r) => (slice ? sliceEntry(r, ctx.auth) : toAuditEntry(r))),
        version: Number(max?.v ?? 0),
        updatedAt: rows[0]?.at ?? null,
      }
    },
  },
}
