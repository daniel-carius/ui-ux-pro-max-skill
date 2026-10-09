// Gravação na auditoria (somente inclusão; o banco bloqueia alteração e exclusão).
import type { AuditAction } from '@shared/audit'
import type { Db } from '../db'
import type { AuthContext } from '../types'

export interface AuditInput {
  action: AuditAction
  entity: string
  summary: string
  source?: 'servidor' | 'painel'
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Registra uma ação. Quem fez, quando e o IP vêm sempre do servidor. */
export async function writeAudit(db: Db, actor: Pick<AuthContext, 'user' | 'ip'> | { id: null; name: string; ip: string }, input: AuditInput) {
  const actorId = 'user' in actor ? actor.user.id : actor.id
  const actorName = 'user' in actor ? actor.user.name : actor.name
  await db.query(
    `insert into audit_log (actor_id, actor_name, action, entity, summary, ip, source) values ($1, $2, $3, $4, $5, $6, $7)`,
    [actorId, actorName, input.action, clip(input.entity, 200), clip(input.summary, 1000), actor.ip, input.source ?? 'servidor'],
  )
}
