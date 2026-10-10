// Chave config.seguranca-painel (lista de IPs com trava contra se bloquear, 2FA para todos, tempo de sessão).
// Formato do painel: { allowlist: [{ id, value, label, createdAt, createdBy }], enforce2faForAll, sessionTimeoutMinutes }.
// Incluir ou retirar IPs da lista exige cargos.conceder (a lista pode deixar Superadmins de fora, como mexer
// no cargo deles); descrição, 2FA para todos e tempo de inatividade seguem com seguranca-painel.editar.
// Recuperação sem SQL: PANEL_ALLOWLIST_RESET=<valor novo> no ambiente da API esvazia a lista na subida, uma vez
// por valor, com auditoria (resetAllowlistFromEnv, chamada pelo bootstrap).
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { canReadKey, canWriteKey } from '@shared/kv-registry'
import type { Db } from '../../db'
import { AppError, Errors } from '../../errors'
import { ipAllowed, isIpOrCidr } from '../../lib/ip'
import { newId, sha256 } from '../../lib/crypto'
import type { KvContext, KvHandlers, KvValue } from '../../kv/types'
import { invalidateAllowlistCache } from '../../plugins/security'
import { writeAudit } from '../../services/audit'
import { assertKvVersion, bumpKvVersion, GRANT_PERM, lockKvVersion, readKvVersion, readSnapshot } from '../team/service'

/** Linha de settings com a versão da segurança do painel ({ version }). */
export const PANEL_SECURITY_VERSION_KEY = 'config.seguranca-painel'
/** Linha de settings com o último pedido de recuperação da lista já aplicado ({ tokenHash, at }). */
export const ALLOWLIST_RESET_KEY = 'config.seguranca-painel.recuperacao'
export const MAX_ALLOWLIST = 100
export const MAX_LABEL = 60
export const MIN_TIMEOUT = 5
export const MAX_TIMEOUT = 1440

export interface AllowEntry {
  id: string
  value: string
  label: string
  createdAt: string
  createdBy: string
}

export interface PanelSecurity {
  allowlist: AllowEntry[]
  enforce2faForAll: boolean
  sessionTimeoutMinutes: number
}

interface PanelSecurityRow {
  allowlist: Partial<AllowEntry>[] | null
  enforce_2fa_all: boolean
  session_timeout_minutes: number
  updated_at: string
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

const entrySchema = z.object({
  id: z.string('Identificador inválido.').max(64, 'Identificador inválido.').optional(),
  value: z.string('Informe o IP ou a faixa.').trim().min(1, 'Informe o IP ou a faixa.').max(50, 'IP ou faixa inválido.'),
  label: z.string('Descrição inválida.').trim().max(MAX_LABEL, `Use no máximo ${MAX_LABEL} caracteres na descrição.`).default(''),
  // createdAt/createdBy vindos do painel são ignorados: o servidor carimba quem e quando
  createdAt: z.unknown().optional(),
  createdBy: z.unknown().optional(),
})

const stateSchema = z.object({
  allowlist: z.array(entrySchema, 'Envie a lista de IPs.').max(MAX_ALLOWLIST, `No máximo ${MAX_ALLOWLIST} IPs ou faixas na lista.`),
  enforce2faForAll: z.boolean('Informe se o 2FA é exigido de todos.'),
  sessionTimeoutMinutes: z
    .number('Informe o tempo de inatividade.')
    .int('Use minutos inteiros.')
    .min(MIN_TIMEOUT, `O tempo de inatividade vai de ${MIN_TIMEOUT} a ${MAX_TIMEOUT} minutos.`)
    .max(MAX_TIMEOUT, `O tempo de inatividade vai de ${MIN_TIMEOUT} a ${MAX_TIMEOUT} minutos.`),
})

function toPanel(row: PanelSecurityRow): PanelSecurity {
  const list = Array.isArray(row.allowlist) ? row.allowlist : []
  return {
    allowlist: list.map((e, i) => ({
      id: typeof e.id === 'string' && e.id ? e.id : `ip_${i + 1}`,
      value: String(e.value ?? ''),
      label: typeof e.label === 'string' ? e.label : '',
      createdAt: typeof e.createdAt === 'string' && e.createdAt ? e.createdAt : row.updated_at,
      createdBy: typeof e.createdBy === 'string' ? e.createdBy : '',
    })),
    enforce2faForAll: row.enforce_2fa_all,
    sessionTimeoutMinutes: row.session_timeout_minutes,
  }
}

async function loadRow(db: Db, lock = false): Promise<PanelSecurityRow> {
  const row = await db.one<PanelSecurityRow>(
    `select allowlist, enforce_2fa_all, session_timeout_minutes, updated_at from panel_security where id = 1${lock ? ' for update' : ''}`,
  )
  if (!row) throw new Error('Linha de panel_security ausente (migração não aplicada).')
  return row
}

/**
 * Configuração e versão. Chamar numa foto só (readSnapshot) ou dentro da transação que grava com a versão travada:
 * versão e conteúdo precisam ser do mesmo instante (veja readSnapshot).
 */
export async function readPanelSecurity(db: Db): Promise<KvValue> {
  const v = await readKvVersion(db, PANEL_SECURITY_VERSION_KEY)
  const row = await loadRow(db)
  return { value: toPanel(row), version: v.version, updatedAt: row.updated_at }
}

const describe = (e: Pick<AllowEntry, 'value' | 'label'>) => (e.label ? `${e.value} (${e.label})` : e.value)

/** Conjunto de IPs/faixas da lista (sem ordem nem descrição). */
function allowValues(list: Pick<AllowEntry, 'value'>[]): string[] {
  return [...new Set(list.map((e) => String(e.value).trim()))].sort()
}

/** A lista nova inclui ou retira algum IP/faixa em relação à gravada? */
export function allowlistValuesChanged(before: Pick<AllowEntry, 'value'>[], after: Pick<AllowEntry, 'value'>[]): boolean {
  const a = allowValues(before)
  const b = allowValues(after)
  return a.length !== b.length || a.some((v, i) => v !== b[i])
}

function summarize(before: PanelSecurity, after: PanelSecurity): string {
  const parts: string[] = []
  const beforeIds = new Map(before.allowlist.map((e) => [e.id, e]))
  const afterIds = new Set(after.allowlist.map((e) => e.id))
  const added = after.allowlist.filter((e) => !beforeIds.has(e.id) || beforeIds.get(e.id)!.value !== e.value)
  const removed = before.allowlist.filter((e) => !afterIds.has(e.id) || after.allowlist.find((x) => x.id === e.id)!.value !== e.value)
  const relabeled = after.allowlist.filter((e) => {
    const old = beforeIds.get(e.id)
    return old && old.value === e.value && old.label !== e.label
  })
  if (added.length) parts.push(`IPs incluídos: ${added.map(describe).join(', ')}`)
  if (removed.length) parts.push(`IPs retirados: ${removed.map(describe).join(', ')}`)
  if (relabeled.length) parts.push(`descrição alterada: ${relabeled.map((e) => e.value).join(', ')}`)
  if (before.allowlist.length && !after.allowlist.length) parts.push('lista de IPs esvaziada (qualquer IP entra)')
  if (before.enforce2faForAll !== after.enforce2faForAll) parts.push(after.enforce2faForAll ? '2FA passou a ser exigido de todos' : '2FA para todos desligado')
  if (before.sessionTimeoutMinutes !== after.sessionTimeoutMinutes) {
    parts.push(`tempo de inatividade: ${before.sessionTimeoutMinutes} → ${after.sessionTimeoutMinutes} min`)
  }
  return parts.length ? `Segurança do painel: ${parts.join('; ')}.` : 'Segurança do painel salva sem alterações.'
}

export const kvHandlers: KvHandlers = {
  'panel-security': {
    async read(ctx: KvContext) {
      if (!canReadKey(ctx.rule, ctx.auth.perms)) throw Errors.forbidden()
      return readSnapshot(ctx.app.db, (t) => readPanelSecurity(t))
    },

    async write(ctx: KvContext, value: unknown, expectedVersion: number | undefined) {
      if (!canWriteKey(ctx.rule, ctx.auth.perms)) throw Errors.forbidden()
      const input = stateSchema.parse(value)

      const seenValues = new Set<string>()
      const seenIds = new Set<string>()
      for (const [i, e] of input.allowlist.entries()) {
        if (!isIpOrCidr(e.value)) {
          throw Errors.invalid(`"${e.value}" não é um IPv4 nem uma faixa CIDR válida (ex.: 189.45.12.207 ou 189.45.12.0/24).`, {
            index: i,
            field: 'value',
          })
        }
        if (seenValues.has(e.value)) throw Errors.invalid(`${e.value} aparece mais de uma vez na lista.`, { index: i, field: 'value' })
        seenValues.add(e.value)
        if (e.id !== undefined && ID_RE.test(e.id)) {
          if (seenIds.has(e.id)) throw Errors.invalid('Item repetido na lista de IPs.', { index: i, field: 'id' })
          seenIds.add(e.id)
        }
      }

      // trava contra se bloquear: a lista nova precisa incluir o IP de quem grava
      const ip = ctx.req.clientIp
      if (input.allowlist.length && !ipAllowed(ip, input.allowlist)) {
        throw new AppError(409, 'bloquearia_voce', `A lista deixaria o seu IP (${ip || 'desconhecido'}) de fora. Inclua o seu IP antes de salvar.`, { ip })
      }

      const saved = await ctx.app.db.tx(async (t) => {
        const current = await lockKvVersion(t, PANEL_SECURITY_VERSION_KEY)
        assertKvVersion(current, expectedVersion)
        const before = toPanel(await loadRow(t, true))
        // a lista de IPs vale para todos, inclusive Superadmins: mexer nela segue a regra de cargos administrativos
        if (allowlistValuesChanged(before.allowlist, input.allowlist) && !ctx.auth.perms.has(GRANT_PERM)) {
          throw Errors.forbidden('Só quem pode conceder cargos administrativos inclui ou retira IPs da lista de acesso do painel.')
        }
        const beforeById = new Map(before.allowlist.map((e) => [e.id, e]))
        const now = new Date().toISOString()

        const allowlist: AllowEntry[] = input.allowlist.map((e) => {
          const id = e.id !== undefined && ID_RE.test(e.id) ? e.id : newId('ip')
          const old = beforeById.get(id)
          // item já gravado com o mesmo valor mantém quem/quando incluiu; o resto é carimbado agora
          if (old && old.value === e.value) return { id, value: e.value, label: e.label, createdAt: old.createdAt, createdBy: old.createdBy }
          return { id, value: e.value, label: e.label, createdAt: now, createdBy: ctx.auth.user.name }
        })
        const after: PanelSecurity = { allowlist, enforce2faForAll: input.enforce2faForAll, sessionTimeoutMinutes: input.sessionTimeoutMinutes }

        await t.query(
          `update panel_security set allowlist = $1::jsonb, enforce_2fa_all = $2, session_timeout_minutes = $3, updated_at = now(), updated_by = $4
            where id = 1`,
          [JSON.stringify(allowlist), after.enforce2faForAll, after.sessionTimeoutMinutes, ctx.auth.user.id],
        )
        await bumpKvVersion(t, PANEL_SECURITY_VERSION_KEY, current, ctx.auth.user.id)
        await writeAudit(t, ctx.auth, { action: 'editar', entity: 'Segurança do painel', summary: summarize(before, after) })
        return readPanelSecurity(t)
      })
      // a lista nova vale na próxima requisição
      invalidateAllowlistCache()
      return saved
    },
  },
}

/**
 * Recuperação de acesso sem SQL: com PANEL_ALLOWLIST_RESET definida no ambiente da API, a subida esvazia a lista
 * de IPs (qualquer IP volta a entrar no login, que continua exigindo senha e 2FA) e registra na auditoria.
 * Cada valor vale uma vez: subir de novo com o mesmo valor não mexe na lista (troque o valor para usar outra vez
 * e retire a variável depois). Só quem opera o servidor define a variável.
 */
export async function resetAllowlistFromEnv(app: FastifyInstance, raw: string | undefined): Promise<'sem-pedido' | 'ja-aplicado' | 'esvaziada'> {
  const token = raw?.trim()
  if (!token) return 'sem-pedido'
  const tokenHash = sha256(token)
  const result = await app.db.tx(async (t): Promise<'ja-aplicado' | 'esvaziada'> => {
    await t.query(`insert into settings (key, value) values ($1, '{}'::jsonb) on conflict (key) do nothing`, [ALLOWLIST_RESET_KEY])
    const mark = await t.one<{ value: { tokenHash?: string } }>('select value from settings where key = $1 for update', [ALLOWLIST_RESET_KEY])
    if (mark?.value?.tokenHash === tokenHash) return 'ja-aplicado'
    const current = await lockKvVersion(t, PANEL_SECURITY_VERSION_KEY)
    const before = toPanel(await loadRow(t, true))
    await t.query(`update panel_security set allowlist = '[]'::jsonb, updated_at = now(), updated_by = null where id = 1`)
    await bumpKvVersion(t, PANEL_SECURITY_VERSION_KEY, current, null)
    await t.query(`update settings set value = $2::jsonb, updated_at = now(), updated_by = null where key = $1`, [
      ALLOWLIST_RESET_KEY,
      JSON.stringify({ tokenHash, at: new Date().toISOString() }),
    ])
    const removed = before.allowlist.length ? `IPs retirados: ${before.allowlist.map(describe).join(', ')}` : 'a lista já estava vazia'
    await writeAudit(
      t,
      { id: null, name: 'Recuperação de acesso (servidor)', ip: '' },
      {
        action: 'desbloquear',
        entity: 'Segurança do painel',
        summary: `Lista de IPs do painel esvaziada pela variável PANEL_ALLOWLIST_RESET na subida da API (qualquer IP entra); ${removed}.`,
      },
    )
    return 'esvaziada'
  })
  invalidateAllowlistCache()
  if (result === 'esvaziada') {
    app.log.warn('PANEL_ALLOWLIST_RESET: lista de IPs do painel esvaziada e registrada na auditoria. Retire a variável e refaça a lista pelo painel.')
  } else {
    app.log.warn('PANEL_ALLOWLIST_RESET já aplicada com este valor: a lista de IPs não foi alterada. Retire a variável do ambiente.')
  }
  return result
}
