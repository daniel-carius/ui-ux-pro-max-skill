// Chave cargos.lista (leitura; gravação por diferença validada).
// Regras: Superadmin não muda (só a exigência de 2FA, por quem concede cargos);
// cargos do sistema não são renomeados nem excluídos; permissões precisam
// existir no catálogo; teto null | 0 | > 0 (guardado em centavos); cargo novo
// ganha id do servidor; só exclui cargo personalizado sem pessoas ativas ou
// convidadas; cargo de nível administrativo (antes ou depois) exige
// cargos.conceder. Auditoria com o resumo por cargo.
import { z } from 'zod'
import { canReadKey, canWriteKey } from '@shared/kv-registry'
import { brl } from '@shared/money'
import { isAdminLevelRole, PERMISSION_BY_KEY, PERMISSIONS, type Role } from '@shared/permissions'
import type { Db } from '../../db'
import { Errors } from '../../errors'
import { newId } from '../../lib/crypto'
import type { KvContext, KvHandlers, KvValue } from '../../kv/types'
import { writeAudit } from '../../services/audit'
import { listRoles, toCents } from '../../services/roles-repo'
import type { AuthContext } from '../../types'
import { assertKvVersion, bumpKvVersion, GRANT_PERM, lockKvVersion, readKvVersion, SUPERADMIN_ROLE_ID } from '../team/service'

/** Linha de settings com a versão da lista de cargos ({ version }). */
export const ROLES_VERSION_KEY = 'cargos.lista'
export const MAX_ROLES = 100
export const MAX_CEILING = 1_000_000_000

const incomingRole = z.object({
  id: z.string('Cargo sem identificador.').trim().min(1, 'Cargo sem identificador.').max(64, 'Identificador de cargo inválido.'),
  name: z.string('Informe o nome do cargo.').trim().min(1, 'Informe o nome do cargo.').max(40, 'Use no máximo 40 caracteres no nome do cargo.'),
  description: z.string('Descrição inválida.').trim().max(300, 'Use no máximo 300 caracteres na descrição.').default(''),
  system: z.boolean().optional(),
  permissions: z.array(z.string('Permissão inválida.').max(100, 'Permissão inválida.'), 'Permissões inválidas.').max(1000, 'Permissões demais.'),
  require2fa: z.boolean('Informe se o cargo exige 2FA.'),
  approvalCeiling: z.number('Teto de aprovação inválido.').nullable(),
  color: z.string('Cor inválida.').trim().regex(/^[a-z]{2,20}$/, 'Cor inválida.').optional(),
})

const incomingList = z.array(incomingRole, 'Envie a lista de cargos.').max(MAX_ROLES, `No máximo ${MAX_ROLES} cargos.`)

type IncomingRole = z.infer<typeof incomingRole>

const CATALOG_ORDER = PERMISSIONS.map((p) => p.key)

/** Permissões sem repetição, na ordem do catálogo (desconhecidas já gravadas vão ao fim). */
function canonicalPerms(perms: string[]): string[] {
  const set = new Set(perms)
  const known = CATALOG_ORDER.filter((k) => set.has(k))
  const unknown = [...set].filter((k) => !PERMISSION_BY_KEY.has(k)).sort()
  return [...known, ...unknown]
}

const normName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

function ceilingText(v: number | null) {
  if (v === null) return 'Sem teto'
  if (v === 0) return 'Não aprova saques'
  return brl(v)
}

function listText(keys: string[], max = 15) {
  return keys.length > max ? `${keys.slice(0, max).join(', ')} e mais ${keys.length - max}` : keys.join(', ')
}

function validateCeiling(r: IncomingRole) {
  const v = r.approvalCeiling
  if (v === null) return
  if (!Number.isFinite(v) || v < 0) {
    throw Errors.invalid(`Teto de aprovação inválido em ${r.name}: use vazio (sem teto), 0 (não aprova) ou um valor maior que zero.`, {
      id: r.id,
      field: 'approvalCeiling',
    })
  }
  if (v > MAX_CEILING) throw Errors.invalid(`Teto de aprovação alto demais em ${r.name}.`, { id: r.id, field: 'approvalCeiling' })
}

function validateNewName(r: IncomingRole) {
  if (r.name.length < 3) throw Errors.invalid(`Use pelo menos 3 letras no nome do cargo (${r.name}).`, { id: r.id, field: 'name' })
}

function assertKnownPerms(r: IncomingRole, keys: string[]) {
  const unknown = keys.filter((k) => !PERMISSION_BY_KEY.has(k))
  if (unknown.length) {
    throw Errors.invalid(`Permissão desconhecida em ${r.name}: ${listText(unknown, 5)}.`, { id: r.id, field: 'permissions', unknown })
  }
}

function assertGrant(auth: AuthContext, ...roles: Pick<Role, 'permissions'>[]) {
  if (roles.some((r) => isAdminLevelRole(r)) && !auth.perms.has(GRANT_PERM)) {
    throw Errors.forbidden('Só quem pode conceder cargos administrativos cria, altera ou exclui cargos de nível administrativo.')
  }
}

export async function readRoles(db: Db): Promise<KvValue> {
  const roles = await listRoles(db)
  const v = await readKvVersion(db, ROLES_VERSION_KEY)
  const row = await db.one<{ at: string | null }>('select max(updated_at) as at from roles')
  const updatedAt = [v.updatedAt, row?.at ?? null].filter((x): x is string => !!x).sort().pop() ?? null
  return { value: roles, version: v.version, updatedAt }
}

interface RoleChange {
  incoming: IncomingRole
  old: Role
  next: { name: string; description: string; permissions: string[]; require2fa: boolean; ceilingCents: number | null; color: string }
  parts: string[]
}

function diffRole(old: Role, r: IncomingRole): RoleChange | null {
  const permissions = canonicalPerms(r.permissions)
  const before = new Set(old.permissions)
  const after = new Set(permissions)
  const added = permissions.filter((k) => !before.has(k))
  const removed = old.permissions.filter((k) => !after.has(k))
  const ceilingCents = toCents(r.approvalCeiling)
  const oldCents = toCents(old.approvalCeiling)
  const color = r.color ?? old.color
  const parts: string[] = []
  if (r.name !== old.name) parts.push(`nome: ${old.name} → ${r.name}`)
  if (r.description !== old.description) parts.push('descrição alterada')
  if (added.length) parts.push(`permissões incluídas: ${listText(added)}`)
  if (removed.length) parts.push(`permissões retiradas: ${listText(removed)}`)
  if (r.require2fa !== old.require2fa) parts.push(r.require2fa ? '2FA passou a ser exigido' : '2FA passou a ser opcional')
  if (ceilingCents !== oldCents) parts.push(`teto: ${ceilingText(old.approvalCeiling)} → ${ceilingText(r.approvalCeiling)}`)
  if (color !== old.color) parts.push(`cor: ${old.color} → ${color}`)
  if (!parts.length) return null
  return {
    incoming: r,
    old,
    next: { name: r.name, description: r.description, permissions, require2fa: r.require2fa, ceilingCents, color },
    parts,
  }
}

function isUniqueViolation(e: unknown) {
  return !!e && typeof e === 'object' && (e as { code?: string }).code === '23505'
}

export const kvHandlers: KvHandlers = {
  roles: {
    async read(ctx: KvContext) {
      if (!canReadKey(ctx.rule, ctx.auth.perms)) throw Errors.forbidden()
      return readRoles(ctx.app.db)
    },

    async write(ctx: KvContext, value: unknown, expectedVersion: number | undefined) {
      if (!canWriteKey(ctx.rule, ctx.auth.perms)) throw Errors.forbidden()
      const auth = ctx.auth
      const incoming = incomingList.parse(value)

      const ids = new Set<string>()
      const names = new Map<string, string>()
      for (const r of incoming) {
        if (ids.has(r.id)) throw Errors.invalid(`Cargo repetido na lista (${r.name}).`, { id: r.id })
        ids.add(r.id)
        const n = normName(r.name)
        if (names.has(n)) throw Errors.invalid(`Já existe o cargo "${names.get(n)}".`, { id: r.id, field: 'name' })
        names.set(n, r.name)
        validateCeiling(r)
      }

      try {
        return await ctx.app.db.tx(async (t) => {
          const current = await lockKvVersion(t, ROLES_VERSION_KEY)
          assertKvVersion(current, expectedVersion)
          const stored = await listRoles(t)
          const byId = new Map(stored.map((r) => [r.id, r]))

          const created: IncomingRole[] = []
          const changes: RoleChange[] = []
          for (const r of incoming) {
            const old = byId.get(r.id)
            if (!old) {
              validateNewName(r)
              assertKnownPerms(r, r.permissions)
              created.push(r)
              continue
            }
            // só as permissões novas precisam existir (as já gravadas podem ser de um catálogo anterior)
            assertKnownPerms(r, r.permissions.filter((k) => !old.permissions.includes(k)))
            const change = diffRole(old, r)
            if (!change) continue
            if (old.id === SUPERADMIN_ROLE_ID) {
              const fields = change.parts.filter((p) => !p.startsWith('2FA'))
              if (fields.length) {
                throw Errors.invalid('O cargo Superadmin tem acesso total e não pode ser alterado (só a exigência de 2FA).', {
                  id: old.id,
                  changes: fields,
                })
              }
            }
            if (old.system && change.next.name !== old.name) {
              throw Errors.invalid(`Cargos do sistema não podem ser renomeados (${old.name}).`, { id: old.id, field: 'name' })
            }
            if (change.next.name !== old.name) validateNewName(r)
            changes.push(change)
          }
          const deleted = stored.filter((r) => !ids.has(r.id))
          for (const r of deleted) {
            if (r.system) throw Errors.invalid(`Cargos do sistema não podem ser excluídos (${r.name}).`, { id: r.id })
          }

          // cargo administrativo antes ou depois da mudança exige cargos.conceder
          for (const r of created) assertGrant(auth, { permissions: r.permissions })
          for (const c of changes) assertGrant(auth, c.old, { permissions: c.next.permissions })
          for (const r of deleted) assertGrant(auth, r)

          // exclusões primeiro: liberam nomes para os cargos novos
          for (const r of deleted) {
            const inUse = await t.query<{ name: string; status: string }>(
              `select name, status from users where role_id = $1 and status in ('ativo', 'convidado') order by name limit 10`,
              [r.id],
            )
            if (inUse.length) {
              throw Errors.invalid(
                `O cargo ${r.name} ainda é usado por ${inUse.map((u) => `${u.name} (${u.status})`).join(', ')}. Troque o cargo dessas pessoas em Equipe antes de excluir.`,
                { id: r.id },
              )
            }
            // pessoas desligadas não impedem a exclusão: passam para o cargo do sistema mais restrito
            let moved = 0
            const gone = await t.one<{ n: number }>(`select count(*)::int as n from users where role_id = $1`, [r.id])
            if (gone?.n) {
              const fallback = (await listRoles(t))
                .filter((x) => x.system && x.id !== r.id && !isAdminLevelRole(x))
                .sort((a, b) => a.permissions.length - b.permissions.length || a.id.localeCompare(b.id))[0]
              if (!fallback) throw Errors.invalid(`Não há cargo do sistema para receber as pessoas desligadas de ${r.name}.`, { id: r.id })
              const rows = await t.query(`update users set role_id = $2, updated_at = now() where role_id = $1 returning id`, [r.id, fallback.id])
              moved = rows.length
              await t.query('delete from roles where id = $1', [r.id])
              await writeAudit(t, auth, {
                action: 'excluir',
                entity: `Cargo ${r.name}`,
                summary: `Cargo personalizado excluído (${r.permissions.length} permissões); ${moved} ${moved === 1 ? 'pessoa desligada passou' : 'pessoas desligadas passaram'} para ${fallback.name}.`,
              })
              continue
            }
            await t.query('delete from roles where id = $1', [r.id])
            await writeAudit(t, auth, {
              action: 'excluir',
              entity: `Cargo ${r.name}`,
              summary: `Cargo personalizado excluído (${r.permissions.length} permissões).`,
            })
          }

          for (const c of changes) {
            await t.query(
              `update roles set name = $2, description = $3, permissions = $4, require_2fa = $5, approval_ceiling_cents = $6,
                      color = $7, updated_at = now()
                where id = $1`,
              [c.old.id, c.next.name, c.next.description, c.next.permissions, c.next.require2fa, c.next.ceilingCents, c.next.color],
            )
            await writeAudit(t, auth, { action: 'editar', entity: `Cargo ${c.next.name}`, summary: `${c.parts.join('; ')}.` })
          }

          for (const r of created) {
            const id = newId('cargo')
            const permissions = canonicalPerms(r.permissions)
            await t.query(
              `insert into roles (id, name, description, system, permissions, require_2fa, approval_ceiling_cents, color)
               values ($1, $2, $3, false, $4, $5, $6, $7)`,
              [id, r.name, r.description, permissions, r.require2fa, toCents(r.approvalCeiling), r.color ?? 'violet'],
            )
            await writeAudit(t, auth, {
              action: 'criar',
              entity: `Cargo ${r.name}`,
              summary: `Cargo criado com ${permissions.length} ${permissions.length === 1 ? 'permissão' : 'permissões'}; 2FA ${r.require2fa ? 'exigido' : 'opcional'}; teto: ${ceilingText(r.approvalCeiling)}.`,
            })
          }

          if (!changes.length && !created.length && !deleted.length) {
            await writeAudit(t, auth, { action: 'editar', entity: 'Dados · Cargos e permissões', summary: 'Cargos salvos sem alterações.' })
          }
          await bumpKvVersion(t, ROLES_VERSION_KEY, current, auth.user.id)
          return readRoles(t)
        })
      } catch (e) {
        if (isUniqueViolation(e)) throw Errors.invalid('Já existe um cargo com este nome.', { field: 'name' })
        throw e
      }
    },
  },
}
