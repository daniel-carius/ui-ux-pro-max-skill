// Carrega a sessão do cookie em cada requisição e monta req.auth
// (pessoa, cargo, permissões, etapa do login).
import cookie from '@fastify/cookie'
import type { FastifyInstance } from 'fastify'
import { effectivePermissions } from '@shared/permissions'
import { SECURITY } from '../config'
import { sha256 } from '../lib/crypto'
import { rowToRole, type RoleRow } from '../services/roles-repo'
import type { AuthContext, SessionStage } from '../types'
import fp from './fp'

interface SessionJoin {
  session_id: string
  stage: SessionStage
  last_seen_at: string
  expires_at: string
  user_id: string
  name: string
  email: string
  status: 'ativo' | 'desligado' | 'convidado'
  totp_enabled: boolean
  must_change_password: boolean
  role: RoleRow
  timeout: number
}

export default fp(async function session(app: FastifyInstance) {
  await app.register(cookie, { secret: app.config.APP_SECRET })

  app.addHook('onRequest', async (req) => {
    req.auth = null
    const token = req.cookies[SECURITY.sessionCookie]
    if (!token || token.length > 200) return
    const id = sha256(token)
    const row = await app.db.one<SessionJoin>(
      `select s.id as session_id, s.stage, s.last_seen_at, s.expires_at,
              u.id as user_id, u.name, u.email, u.status, u.totp_enabled, u.must_change_password,
              to_jsonb(r.*) as role,
              (select session_timeout_minutes from panel_security where id = 1) as timeout
         from sessions s
         join users u on u.id = s.user_id
         join roles r on r.id = u.role_id
        where s.id = $1 and s.revoked_at is null and s.expires_at > now()`,
      [id],
    )
    if (!row || row.status !== 'ativo') return
    // inatividade: sessão ativa parada além do tempo configurado cai
    if (row.stage === 'active' && Date.now() - new Date(row.last_seen_at).getTime() > row.timeout * 60_000) {
      await app.db.query('update sessions set revoked_at = now() where id = $1', [id])
      return
    }
    const role = rowToRole(row.role)
    const ctx: AuthContext = {
      user: {
        id: row.user_id,
        name: row.name,
        email: row.email,
        roleId: role.id,
        status: row.status,
        totpEnabled: row.totp_enabled,
        mustChangePassword: row.must_change_password,
      },
      role,
      perms: new Set(effectivePermissions(role)),
      sessionId: row.session_id,
      stage: row.stage,
      ip: req.clientIp,
    }
    req.auth = ctx
    // atualiza o "visto por último" no máximo 1 vez por minuto
    if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) {
      await app.db.query('update sessions set last_seen_at = now() where id = $1', [id])
    }
  })
})
