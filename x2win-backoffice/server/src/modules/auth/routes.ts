// Login, 2FA, troca de senha, sessão atual e saída. Prefixo /api/auth.
import type { FastifyInstance, FastifyRequest } from 'fastify'
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
import { newTotpSecret, otpauthUrl, verifyTotp } from '../../lib/totp'
import { writeAudit } from '../../services/audit'
import {
  clearSessionCookie,
  createSession,
  promoteSession,
  revokeSession,
  revokeUserSessions,
  setSessionCookie,
} from '../../services/sessions'
import type { AuthContext, SessionStage } from '../../types'
import {
  AuthErrors,
  assertNotLocked,
  clearFailures,
  computeStage,
  consumeSecondFactor,
  findUserByEmail,
  generateRecoveryCodes,
  hashRecoveryCode,
  loadStageInputs,
  loadUser,
  recordLogin,
  registerFailure,
  requireStage,
  stageFor,
  toAuthUser,
  type UserRow,
} from './service'
import { ipBucket, loginThrottleFor } from './throttle'

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

/** /2fa/setup: com sessão ativa a senha atual é obrigatória (na etapa enroll ela acabou de ser digitada). */
const setupBody = z
  .object({ currentPassword: z.string('Senha atual inválida.').max(256, 'Senha longa demais.').optional() })
  .optional()

/** No máximo 1 aviso de bloqueio de origem por pessoa a cada período de bloqueio (sem inundar a auditoria). */
const SOURCE_LOCK_AUDIT_MS = SECURITY.lockMinutes * 60_000

export default async function routes(app: FastifyInstance) {
  const throttle = loginThrottleFor(app.db, app.config.APP_SECRET)
  const recoveryKeys = { cipher: app.cipher, serverSecret: app.config.APP_SECRET }
  const lastSourceLockAudit = new Map<string, number>()

  // respostas com sessão, segredo do 2FA e códigos de recuperação nunca vão para cache
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('cache-control', 'no-store')
    return payload
  })

  /** Registra (sem atrasar a resposta) que uma origem foi bloqueada para uma pessoa ativa. */
  function auditSourceLock(user: UserRow, ip: string) {
    const now = Date.now()
    const last = lastSourceLockAudit.get(user.id)
    if (last !== undefined && now - last < SOURCE_LOCK_AUDIT_MS) return
    lastSourceLockAudit.set(user.id, now)
    if (lastSourceLockAudit.size > 10_000) lastSourceLockAudit.clear()
    void writeAudit(
      app.db,
      { user: toAuthUser(user), ip },
      {
        action: 'bloquear',
        entity: 'Acesso ao painel',
        summary:
          `Login bloqueado por ${SECURITY.lockMinutes} min para a origem ${ipBucket(ip)} após ${SECURITY.maxFailedLogins} ` +
          'senhas erradas seguidas (as outras origens continuam entrando)',
      },
    ).catch((err) => app.log.error({ err }, 'falha ao auditar bloqueio de origem no login'))
  }

  /**
   * Senha atual exigida de uma sessão ativa (troca de senha, cadastro do 2FA). O erro conta para o
   * bloqueio da conta; o erro que bloqueia também encerra esta sessão (um cookie roubado não vira um
   * oráculo de senha).
   */
  async function confirmCurrentPassword(req: FastifyRequest, auth: AuthContext, user: UserRow, currentPassword: string | undefined, reason: string) {
    if (!currentPassword) throw Errors.invalid('Informe a senha atual.')
    if (user.locked && user.locked_until) throw AuthErrors.locked(user.locked_until)
    if (await verifyPassword(currentPassword, user.password_hash)) return
    const lock = await registerFailure(app.db, user, req.clientIp, reason)
    if (lock) {
      await revokeSession(app.db, auth.sessionId)
      throw lock
    }
    throw AuthErrors.badCurrentPassword()
  }

  // ---------- POST /login ----------
  app.post('/login', TEN_PER_MINUTE, async (req, reply) => {
    const body = loginBody.parse(req.body ?? {})
    const email = body.email.toLowerCase()
    const user = await findUserByEmail(app.db, email)
    const usable = !!user && user.status === 'ativo'

    // sempre calcula o hash (mesmo sem pessoa e com a origem bloqueada): o tempo de resposta não revela
    // quem existe nem o estado do bloqueio
    const ok = await verifyPassword(body.password, user?.password_hash ?? null)

    // freio por (e-mail, origem), decidido depois do hash e sem await entre ler e gravar
    const outcome = throttle.settle(throttle.key(email, req.clientIp), usable && ok)
    if (outcome.kind === 'locked') {
      if (outcome.justLocked && usable) auditSourceLock(user, req.clientIp)
      throw AuthErrors.locked(outcome.until)
    }
    if (outcome.kind === 'failed' || !usable) throw AuthErrors.badCredentials()

    const previous = req.cookies[SECURITY.sessionCookie]
    const { stage, token } = await app.db.tx(async (db) => {
      // conta bloqueada por erros depois da senha (código do 2FA, senha atual): só quem acertou a senha vê
      await assertNotLocked(db, user.id)
      const inputs = await loadStageInputs(db, user.id)
      const stage = stageFor(inputs)
      // com 2FA a contagem só zera quando o código é aceito (/2fa/verify): acertar só a senha não
      // devolve as tentativas do código
      if (!inputs.totp_enabled) await clearFailures(db, user.id)
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
      // de novo, com a linha travada: um erro de outra requisição pode ter bloqueado a conta agora
      await assertNotLocked(db, user.id)
      const kind = await consumeSecondFactor(db, recoveryKeys, user, code)
      if (!kind) return null
      await clearFailures(db, user.id)
      await promoteSession(db, auth.sessionId, 'active')
      await recordLogin(db, auth.user, req.clientIp, kind === 'recovery' ? 'Login com 2FA (código de recuperação)' : 'Login com 2FA')
      return kind
    })
    if (!accepted) {
      // fora da transação: a tentativa errada precisa ficar registrada
      const lock = await registerFailure(app.db, user, req.clientIp, 'Código do 2FA incorreto depois da senha correta')
      if (lock) throw lock
      throw AuthErrors.badCode()
    }
    const res: LoginResponse = { stage: 'active' }
    return res
  })

  // ---------- POST /2fa/setup ----------
  app.post('/2fa/setup', TEN_PER_MINUTE, async (req) => {
    const auth = requireStage(req, 'enroll', 'active')
    const body = setupBody.parse(req.body ?? undefined)
    const user = await loadUser(app.db, auth.user.id)
    if (!user) throw Errors.unauthenticated()
    if (user.totp_enabled) throw AuthErrors.alreadyConfigured()
    // sessão ativa: reautenticação antes de ligar um autenticador (um cookie roubado não cadastra o
    // aplicativo de outra pessoa nem leva os códigos de recuperação)
    if (auth.stage === 'active') {
      await confirmCurrentPassword(req, auth, user, body?.currentPassword, 'Senha atual incorreta ao cadastrar o 2FA')
    }
    const secret = newTotpSecret()
    const row = await app.db.tx(async (db) => {
      await assertNotLocked(db, user.id)
      if (auth.stage === 'active') await clearFailures(db, user.id)
      return db.one(
        `update users set totp_pending_enc = $2, updated_at = now()
          where id = $1 and totp_enabled = false
          returning id`,
        [user.id, app.cipher.encrypt(secret)],
      )
    })
    if (!row) throw AuthErrors.alreadyConfigured()
    const res: TwoFactorSetupResponse = { secret, otpauthUrl: otpauthUrl(secret, auth.user.email) }
    return res
  })

  // ---------- POST /2fa/enable ----------
  app.post('/2fa/enable', TEN_PER_MINUTE, async (req) => {
    const auth = requireStage(req, 'enroll', 'active')
    const { code } = codeBody.parse(req.body ?? {})
    const user = await loadUser(app.db, auth.user.id)
    if (!user) throw Errors.unauthenticated()
    if (user.totp_enabled) throw AuthErrors.alreadyConfigured()
    if (user.locked && user.locked_until) throw AuthErrors.locked(user.locked_until)
    if (!user.totp_pending_enc) throw Errors.invalid('Gere o QR code do 2FA antes de confirmar o código.')
    let secret: string
    try {
      secret = app.cipher.decrypt(user.totp_pending_enc)
    } catch {
      throw Errors.invalid('Não foi possível ler o QR code gerado. Gere um novo e tente de novo.')
    }
    const counter = verifyTotp(secret, code)
    if (counter === null) {
      // código errado conta para o bloqueio (impede adivinhar o código do segredo pendente)
      const lock = await registerFailure(app.db, user, req.clientIp, 'Código incorreto ao confirmar o cadastro do 2FA')
      if (lock) {
        if (auth.stage === 'active') await revokeSession(app.db, auth.sessionId)
        throw lock
      }
      throw AuthErrors.badCode()
    }

    const recoveryCodes = generateRecoveryCodes(RECOVERY_CODES)
    const stage: SessionStage = auth.stage === 'enroll' ? 'active' : auth.stage
    await app.db.tx(async (db) => {
      await assertNotLocked(db, user.id)
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
        [user.id, counter, recoveryCodes.map((c) => hashRecoveryCode(app.config.APP_SECRET, user.id, c)), user.totp_pending_enc],
      )
      if (!row) {
        // outra requisição ligou o 2FA ou gerou outro QR code no meio do caminho
        const now = await db.one<{ totp_enabled: boolean }>('select totp_enabled from users where id = $1', [user.id])
        if (now?.totp_enabled) throw AuthErrors.alreadyConfigured()
        throw Errors.invalid('O QR code mudou. Leia o código mais recente e tente de novo.')
      }
      await clearFailures(db, user.id)
      // o novo fator vale a partir de agora: as outras sessões (abertas sem ele) caem
      const revoked = await revokeUserSessions(db, user.id, auth.sessionId)
      const parts = [`Ligou o 2FA com aplicativo autenticador e gerou ${RECOVERY_CODES} códigos de recuperação`]
      if (revoked > 0) parts.push(`${revoked} ${revoked === 1 ? 'outra sessão encerrada' : 'outras sessões encerradas'}`)
      await writeAudit(db, { user: auth.user, ip: req.clientIp }, { action: 'ligar', entity: '2FA', summary: parts.join('; ') })
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
    // com sessão ativa a senha atual é obrigatória e o erro conta para o bloqueio da conta
    if (auth.stage === 'active') await confirmCurrentPassword(req, auth, user, body.currentPassword, 'Senha atual incorreta ao trocar a senha')
    const problem = passwordProblem(body.newPassword, SECURITY.passwordMinLength)
    if (problem) throw Errors.invalid(problem)
    if (await verifyPassword(body.newPassword, user.password_hash)) throw Errors.invalid('A nova senha precisa ser diferente da atual.')

    const hash = await hashPassword(body.newPassword)
    const stage = await app.db.tx(async (db) => {
      if (auth.stage === 'active') {
        await assertNotLocked(db, user.id)
        await clearFailures(db, user.id)
      }
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
