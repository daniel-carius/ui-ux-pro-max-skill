// Chave equipe.membros (leitura sanitizada; gravação por diferença validada).
// A gravação só aplica mudança de nome, cargo e status (ativo ↔ desligado),
// sempre pelas mesmas funções das rotas /api/team. Incluir ou remover pessoas
// pela chave é recusado.
import { z } from 'zod'
import { canReadKey, canWriteKey } from '@shared/kv-registry'
import type { Db } from '../../db'
import { AppError, Errors } from '../../errors'
import type { KvContext, KvHandlers, KvValue } from '../../kv/types'
import { writeAudit } from '../../services/audit'
import type { AuthContext } from '../../types'
import {
  assertKvVersion,
  bumpKvVersion,
  canSeeLastIp,
  changeMemberRole,
  deactivateMember,
  listMembers,
  lockKvVersion,
  reactivateMember,
  readKvVersion,
  renameMember,
  SUPERADMIN_ROLE_ID,
  TEAM_VERSION_KEY,
  toPanelMember,
  type MemberRow,
} from './service'

const MAX_MEMBERS = 2000

const incomingMember = z.object({
  id: z.string('Pessoa sem identificador.').min(1, 'Pessoa sem identificador.').max(64, 'Identificador inválido.'),
  name: z.string('Nome inválido.').max(200, 'Nome longo demais.').optional(),
  roleId: z.string('Cargo inválido.').max(64, 'Cargo inválido.').optional(),
  status: z.enum(['ativo', 'desligado', 'convidado'], { error: 'Status inválido.' }).optional(),
})

const incomingList = z.array(incomingMember, 'Envie a lista da equipe.').max(MAX_MEMBERS, 'Lista grande demais.')

export async function readTeam(db: Db, auth: AuthContext): Promise<KvValue> {
  const rows = await listMembers(db)
  const v = await readKvVersion(db, TEAM_VERSION_KEY)
  const showIp = canSeeLastIp(auth)
  const updatedAt = rows.reduce<string | null>((max, r) => (!max || r.updated_at > max ? r.updated_at : max), v.updatedAt)
  return { value: rows.map((r) => toPanelMember(r, showIp)), version: v.version, updatedAt }
}

type Op = { kind: 'rename' | 'role' | 'reactivate' | 'deactivate'; id: string; value?: string }

/** Ordem segura: nomes, reativações, promoções a Superadmin, demais cargos e, por fim, desativações. */
function planChanges(current: Map<string, MemberRow>, incoming: z.infer<typeof incomingList>): Op[] {
  const renames: Op[] = []
  const reactivations: Op[] = []
  const promotions: Op[] = []
  const roles: Op[] = []
  const deactivations: Op[] = []
  for (const m of incoming) {
    const old = current.get(m.id)!
    if (m.name !== undefined && m.name.trim() !== old.name) renames.push({ kind: 'rename', id: m.id, value: m.name })
    if (m.roleId !== undefined && m.roleId !== old.role_id) {
      ;(m.roleId === SUPERADMIN_ROLE_ID ? promotions : roles).push({ kind: 'role', id: m.id, value: m.roleId })
    }
    if (m.status !== undefined && m.status !== old.status) {
      if (m.status === 'desligado') deactivations.push({ kind: 'deactivate', id: m.id })
      else if (m.status === 'ativo' && old.status === 'desligado') reactivations.push({ kind: 'reactivate', id: m.id })
      else {
        throw Errors.invalid(`Mudança de status não permitida para ${old.name} (${old.status} → ${m.status}). Use as ações da tela Equipe.`, {
          id: m.id,
          field: 'status',
        })
      }
    }
  }
  return [...renames, ...reactivations, ...promotions, ...roles, ...deactivations]
}

export const kvHandlers: KvHandlers = {
  team: {
    async read(ctx: KvContext) {
      if (!canReadKey(ctx.rule, ctx.auth.perms)) throw Errors.forbidden()
      return readTeam(ctx.app.db, ctx.auth)
    },

    async write(ctx: KvContext, value: unknown, expectedVersion: number | undefined) {
      if (!canWriteKey(ctx.rule, ctx.auth.perms)) throw Errors.forbidden()
      const incoming = incomingList.parse(value)
      const seen = new Set<string>()
      for (const m of incoming) {
        if (seen.has(m.id)) throw Errors.invalid(`Pessoa repetida na lista (${m.id}).`, { id: m.id })
        seen.add(m.id)
      }
      const auth = ctx.auth

      return ctx.app.db.tx(async (t) => {
        const current = await lockKvVersion(t, TEAM_VERSION_KEY)
        assertKvVersion(current, expectedVersion)

        const rows = await listMembers(t)
        const byId = new Map(rows.map((r) => [r.id, r]))
        const added = incoming.filter((m) => !byId.has(m.id)).map((m) => m.id)
        const removed = rows.filter((r) => !seen.has(r.id)).map((r) => r.id)
        if (added.length || removed.length) {
          throw new AppError(
            403,
            'campo_nao_permitido',
            added.length
              ? 'Para incluir alguém na equipe, use "Criar acesso" ou "Convidar".'
              : 'Pessoas não são removidas da equipe: desative o acesso.',
            { fields: ['id'], added, removed },
          )
        }

        const ops = planChanges(byId, incoming)
        for (const op of ops) {
          if (op.kind === 'rename') await renameMember(t, auth, op.id, op.value!)
          else if (op.kind === 'role') await changeMemberRole(t, auth, op.id, op.value!)
          else if (op.kind === 'reactivate') await reactivateMember(t, auth, op.id)
          else await deactivateMember(t, auth, op.id)
        }
        if (!ops.length) {
          await writeAudit(t, auth, { action: 'editar', entity: 'Dados · Equipe', summary: 'Equipe salva sem alterações.' })
        }
        await bumpKvVersion(t, TEAM_VERSION_KEY, current, auth.user.id)
        return readTeam(t, auth)
      })
    },
  },
}
