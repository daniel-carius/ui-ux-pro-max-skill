// Equipe: criar acesso direto, convidar, aceitar convite, desativar, reativar, trocar cargo, redefinir 2FA. Prefixo /api/team.
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { CreateMemberResponse, InviteMemberResponse } from '@shared/api'
import { requirePerm } from '../../http'
import {
  acceptInvite,
  canSeeLastIp,
  changeMemberRole,
  createDirectMember,
  deactivateMember,
  emailSchema,
  inviteMember,
  memberIdSchema,
  memberNameSchema,
  reactivateMember,
  resendInvite,
  resetMember2fa,
  roleIdSchema,
  toPanelMember,
  withTeamLock,
} from './service'

/** Aceite de convite: 10 por minuto por IP. */
const TEN_PER_MINUTE = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }

const directBody = z.object({ name: memberNameSchema, email: emailSchema, roleId: roleIdSchema })

const inviteBody = z.object({
  email: emailSchema,
  roleId: roleIdSchema,
  // vazio = nome montado a partir do e-mail; digitado = mesma regra do cadastro direto
  name: z
    .string('Nome inválido.')
    .max(300, 'Nome longo demais.')
    .optional()
    .transform((v) => (v?.trim() ? v : undefined))
    .pipe(memberNameSchema.optional()),
})

const roleBody = z.object({ roleId: roleIdSchema })

// `name` é aceito por compatibilidade e ignorado: o nome é o que quem convidou registrou (veja acceptInvite)
const acceptBody = z.object({
  token: z.string('Convite inválido.').trim().min(16, 'Convite inválido.').max(200, 'Convite inválido.'),
  password: z.string('Informe a senha.').max(256, 'Senha longa demais.'),
})

const idParams = z.object({ id: memberIdSchema })

const ORIGIN_RE = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/
const HOST_RE = /^[A-Za-z0-9.-]+(:\d{1,5})?$/

/** Origem do painel para o link do convite: 1º CORS_ORIGIN; senão a origem/host da requisição. */
export function panelOrigin(app: FastifyInstance, req: FastifyRequest): string {
  const configured = app.config.CORS_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean)[0]
  if (configured) return configured.replace(/\/+$/, '')
  const origin = req.headers.origin
  if (typeof origin === 'string' && ORIGIN_RE.test(origin)) return origin
  const host = req.host
  return `${req.protocol === 'https' ? 'https' : 'http'}://${typeof host === 'string' && HOST_RE.test(host) ? host : 'localhost'}`
}

export default async function routes(app: FastifyInstance) {
  // senha temporária e link de convite nunca vão para cache
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('cache-control', 'no-store')
    return payload
  })

  // ---------- POST /direct ----------
  app.post('/direct', async (req) => {
    const auth = requirePerm(req, 'equipe.editar')
    const body = directBody.parse(req.body ?? {})
    const { member, temporaryPassword } = await createDirectMember(app.db, auth, body)
    const res: CreateMemberResponse = { member: { ...toPanelMember(member, canSeeLastIp(auth)) }, temporaryPassword }
    return res
  })

  // ---------- POST /invite ----------
  app.post('/invite', async (req) => {
    const auth = requirePerm(req, 'equipe.editar')
    const body = inviteBody.parse(req.body ?? {})
    const out = await inviteMember(app.db, auth, body, panelOrigin(app, req))
    const res: InviteMemberResponse = { member: { ...toPanelMember(out.member, canSeeLastIp(auth)) }, inviteUrl: out.inviteUrl }
    return res
  })

  // ---------- POST /invites/accept (pública) ----------
  app.post('/invites/accept', TEN_PER_MINUTE, async (req) => {
    const { token, password } = acceptBody.parse(req.body ?? {})
    await acceptInvite(app.db, { token, password }, req.clientIp)
    return { ok: true as const }
  })

  // ---------- POST /:id/resend-invite ----------
  app.post('/:id/resend-invite', async (req) => {
    const auth = requirePerm(req, 'equipe.editar')
    const { id } = idParams.parse(req.params)
    const out = await resendInvite(app.db, auth, id, panelOrigin(app, req))
    return { inviteUrl: out.inviteUrl }
  })

  // ---------- POST /:id/deactivate ----------
  app.post('/:id/deactivate', async (req) => {
    const auth = requirePerm(req, 'equipe.editar')
    const { id } = idParams.parse(req.params)
    const m = await withTeamLock(app.db, auth.user.id, (t) => deactivateMember(t, auth, id))
    return { ok: true as const, member: toPanelMember(m, canSeeLastIp(auth)) }
  })

  // ---------- POST /:id/reactivate ----------
  app.post('/:id/reactivate', async (req) => {
    const auth = requirePerm(req, 'equipe.editar')
    const { id } = idParams.parse(req.params)
    const m = await withTeamLock(app.db, auth.user.id, (t) => reactivateMember(t, auth, id))
    return { ok: true as const, member: toPanelMember(m, canSeeLastIp(auth)) }
  })

  // ---------- POST /:id/role ----------
  app.post('/:id/role', async (req) => {
    const auth = requirePerm(req, 'equipe.editar')
    const { id } = idParams.parse(req.params)
    const { roleId } = roleBody.parse(req.body ?? {})
    const m = await withTeamLock(app.db, auth.user.id, (t) => changeMemberRole(t, auth, id, roleId))
    return { ok: true as const, member: toPanelMember(m, canSeeLastIp(auth)) }
  })

  // ---------- POST /:id/reset-2fa ----------
  app.post('/:id/reset-2fa', async (req) => {
    const auth = requirePerm(req, 'equipe.editar')
    const { id } = idParams.parse(req.params)
    const m = await withTeamLock(app.db, auth.user.id, (t) => resetMember2fa(t, auth, id))
    return { ok: true as const, member: toPanelMember(m, canSeeLastIp(auth)) }
  })
}
