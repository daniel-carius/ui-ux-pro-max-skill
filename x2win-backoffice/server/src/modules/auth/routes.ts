// Login, 2FA, troca de senha, sessão atual e saída. Prefixo /api/auth.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type {
  LoginResponse,
  MeResponse,
  TwoFactorEnableResponse,
  TwoFactorSetupResponse,
} from '@shared/api'
import { SECURITY } from '../../config'
import { Errors } from '../../errors'
import { hashPassword, passwordProblem, sha256, verifyPassword } from '../../lib/crypto'
import { newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from '../../lib/totp'
import { writeAudit } from '../../services/audit'
import {
  clearSessionCookie,
  createSession,
  promoteSession,
  revokeSession,
  revokeUserSessions,
  setSessionCookie,
} from '../../services/sessions'
import type { SessionStage } from '../../types'
import {
  AuthErrors,
  clearFailures,
  computeStage,
  consumeSecondFactor,
  findUserByEmail,
  hashRecoveryCode,
  loadUser,
  recordLogin,
  registerFailure,
  requireStage,
  toAuthUser,
} from './service'

/** 10 por minuto por IP (a chave do limite é o IP do cliente). */
const TEN_PER_MINUTE = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }

const RECOVERY_CODES = 8

const loginBody = z.object({
  email: z.string('Informe o e-mail.').trim().min(1, 'Informe o e-mail.').max(254, 'E-mail longo demais.'),
  password: z.string('Informe a senha.').min(1, 'Informe a senha.').max(256, 'Senha longa demais.'),
})

const codeBody = z.object({
  code: z.string('Informe o código.').trim().min(1, 'Informe o código.').max(32, 'Código longo demais.'),
})

const passwordBody = z.object({
  currentPassword: z.string('Senha atual inválida.').max(256, 'Senha longa demais.').optional(),
  newPassword: z.string('Informe a nova senha.').max(256, 'Senha longa demais.'),
})

export default async function routes(app: FastifyInstance) {
  // respostas com sessão, segredo do 2FA e códigos de recuperação nunca vão para cache
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('cache-control', 'no-store')
    return payload
  })

  // ---------- POST /login ----------
  app.post('/login', TEN_PER_MINUTE, async (req, reply) => {
    const body = loginBody.parse(req.body ?? {})
    const user = await findUserByEmail(app.db, body.email.toLowerCase())
    const usable = !!user && user.status === 'ativo'
    if (usable && user.locked && user.locked_until) throw AuthErrors.locked(user.locked_until)

    // sempre calcula o hash (mesmo sem pessoa) para o tempo de resposta não revelar quem existe
    const ok = await verifyPassword(body.password, user?.password_hash ?? null)
    if (!usable || !ok) {
      if (usable) {
        const lock = await registerFailure(app.db, user, req.clientIp)
        if (lock) throw lock
      }
      throw AuthErrors.badCredentials()
    }

    const previous = req.cookies[SECURITY.sessionCookie]
    const { stage, token } = await app.db.tx(async (db) => {
      await clearFailures(db, user.id)
      const stage = await computeStage(db, user.id)
      // mesmo navegador: a sessão anterior deixa de valer
      if (previous) await revokeSession(db, sha256(previous))
      const s = await createSession(db, user.id, stage, { ip: req.clientIp, userAgent: req.headers['user-agent'] })
      if (stage === 'active') await recordLogin(db, toAuthUser(user), req.clientIp, 'Login com senha')
      return { stage, token: s.token }
    })
    setSessionCookie(reply, token, app.config)
    const res: LoginResponse = { stage }
    return res
  })

  // ---------- POST /2fa/verify ----------
  app.post('/2fa/verify', TEN_PER_MINUTE, async (req) => {
    const auth = requireStage(req, '2fa')
    const { code } = codeBody.parse(req.body ?? {})
    const user = await loadUser(app.db, auth.user.id)
    if (!user) throw Errors.unauthenticated()
    if (user.locked && user.locked_until) throw AuthErrors.locked(user.locked_until)

    const accepted = await app.db.tx(async (db) => {
      const kind = await consumeSecondFactor(db, app.cipher, user, code)
      if (!kind) return null
      await clearFailures(db, user.id)
      await promoteSession(db, auth.sessionId, 'active')
      await recordLogin(db, auth.user, req.clientIp, kind === 'recovery' ? 'Login com 2FA (código de recuperação)' : 'Login com 2FA')
      return kind
    })
    if (!accepted) {
      // fora da transação: a tentativa errada precisa ficar registrada
      const lock = await registerFailure(app.db, user, req.clientIp)
      if (lock) throw lock
      throw AuthErrors.badCode()
    }
    const res: LoginResponse = { stage: 'active' }
    return res
  })

  // ---------- POST /2fa/setup ----------
  app.post('/2fa/setup', async (req) => {
    const auth = requireStage(req, 'enroll', 'active')
    const secret = newTotpSecret()
    const row = await app.db.one(
      `update users set totp_pending_enc = $2, updated_at = now()
        where id = $1 and totp_enabled = false
        returning id`,
      [auth.user.id, app.cipher.encrypt(secret)],
    )
    if (!row) throw AuthErrors.alreadyConfigured()
    const res: TwoFactorSetupResponse = { secret, otpauthUrl: otpauthUrl(secret, auth.user.email) }
    return res
  })

  // ---------- POST /2fa/enable ----------
  app.post('/2fa/enable', async (req) => {
    const auth = requireStage(req, 'enroll', 'active')
    const { code } = codeBody.parse(req.body ?? {})
    const user = await loadUser(app.db, auth.user.id)
    if (!user) throw Errors.unauthenticated()
    if (user.totp_enabled) throw AuthErrors.alreadyConfigured()
    if (!user.totp_pending_enc) throw Errors.invalid('Gere o QR code do 2FA antes de confirmar o código.')
    let secret: string
    try {
      secret = app.cipher.decrypt(user.totp_pending_enc)
    } catch {
      throw Errors.invalid('Não foi possível ler o QR code gerado. Gere um novo e tente de novo.')
    }
    const counter = verifyTotp(secret, code)
    if (counter === null) throw AuthErrors.badCode()

    const recoveryCodes = newRecoveryCodes(RECOVERY_CODES)
    const stage: SessionStage = auth.stage === 'enroll' ? 'active' : auth.stage
    await app.db.tx(async (db) => {
      const row = await db.one(
        `update users set
            totp_secret_enc = totp_pending_enc,
            totp_pending_enc = null,
            totp_enabled = true,
            totp_last_counter = $2,
            recovery_codes = $3,
            updated_at = now()
          where id = $1 and totp_enabled = false and totp_pending_enc = $4
          returning id`,
        [user.id, counter, recoveryCodes.map(hashRecoveryCode), user.totp_pending_enc],
      )
      if (!row) {
        // outra requisição ligou o 2FA ou gerou outro QR code no meio do caminho
        const now = await db.one<{ totp_enabled: boolean }>('select totp_enabled from users where id = $1', [user.id])
        if (now?.totp_enabled) throw AuthErrors.alreadyConfigured()
        throw Errors.invalid('O QR code mudou. Leia o código mais recente e tente de novo.')
      }
      await writeAudit(
        db,
        { user: auth.user, ip: req.clientIp },
        { action: 'ligar', entity: '2FA', summary: `Ligou o 2FA com aplicativo autenticador e gerou ${RECOVERY_CODES} códigos de recuperação` },
      )
      if (auth.stage === 'enroll') {
        await promoteSession(db, auth.sessionId, 'active')
        await recordLogin(db, auth.user, req.clientIp, 'Login com 2FA')
      }
    })
    const res: TwoFactorEnableResponse = { stage, recoveryCodes }
    return res
  })

  // ---------- POST /password ----------
  app.post('/password', TEN_PER_MINUTE, async (req) => {
    const auth = requireStage(req, 'password', 'active')
    const body = passwordBody.parse(req.body ?? {})
    const user = await loadUser(app.db, auth.user.id)
    if (!user) throw Errors.unauthenticated()
    if (auth.stage === 'active') {
      if (!body.currentPassword) throw Errors.invalid('Informe a senha atual.')
      if (!(await verifyPassword(body.currentPassword, user.password_hash))) throw AuthErrors.badCurrentPassword()
    }
    const problem = passwordProblem(body.newPassword, SECURITY.passwordMinLength)
    if (problem) throw Errors.invalid(problem)
    if (await verifyPassword(body.newPassword, user.password_hash)) throw Errors.invalid('A nova senha precisa ser diferente da atual.')

    const hash = await hashPassword(body.newPassword)
    const stage = await app.db.tx(async (db) => {
      await db.query(
        `update users set password_hash = $2, must_change_password = false, updated_at = now() where id = $1`,
        [user.id, hash],
      )
      const revoked = await revokeUserSessions(db, user.id, auth.sessionId)
      // sessão ativa continua ativa; na troca obrigatória segue para a próxima etapa
      const next: SessionStage = auth.stage === 'password' ? await computeStage(db, user.id) : 'active'
      if (next !== auth.stage) await promoteSession(db, auth.sessionId, next)
      const parts = [auth.stage === 'password' ? 'Trocou a senha (troca obrigatória)' : 'Trocou a própria senha']
      if (revoked > 0) parts.push(`${revoked} ${revoked === 1 ? 'outra sessão encerrada' : 'outras sessões encerradas'}`)
      await writeAudit(db, { user: auth.user, ip: req.clientIp }, { action: 'editar', entity: 'Senha', summary: parts.join('; ') })
      if (next === 'active' && auth.stage !== 'active') await recordLogin(db, auth.user, req.clientIp, 'Login com senha')
      return next
    })
    const res: LoginResponse = { stage }
    return res
  })

  // ---------- POST /logout ----------
  app.post('/logout', async (req, reply) => {
    const token = req.cookies[SECURITY.sessionCookie]
    if (token) await revokeSession(app.db, sha256(token))
    clearSessionCookie(reply, app.config)
    return reply.status(204).send()
  })

  // ---------- GET /me ----------
  app.get('/me', async (req) => {
    const auth = req.auth
    if (!auth) throw Errors.unauthenticated()
    const row = await app.db.one<{
      id: string
      name: string
      email: string
      role_id: string
      totp_enabled: boolean
      must_change_password: boolean
      last_access_at: string | null
      timeout: number | null
    }>(
      `select u.id, u.name, u.email, u.role_id, u.totp_enabled, u.must_change_password, u.last_access_at,
              (select session_timeout_minutes from panel_security where id = 1) as timeout
         from users u
        where u.id = $1`,
      [auth.user.id],
    )
    if (!row) throw Errors.unauthenticated()
    const res: MeResponse = {
      stage: auth.stage,
      user: {
        id: row.id,
        name: row.name,
        email: row.email,
        roleId: row.role_id,
        twoFactor: row.totp_enabled,
        mustChangePassword: row.must_change_password,
        lastAccess: row.last_access_at,
      },
    }
    if (auth.stage === 'active') {
      res.role = auth.role
      res.permissions = [...auth.perms]
      res.sessionTimeoutMinutes = row.timeout ?? 240
    }
    return res
  })
}
