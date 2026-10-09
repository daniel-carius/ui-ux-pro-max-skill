// Regras do login: etapa da sessão, bloqueio por tentativas erradas, segundo
// fator (TOTP e códigos de recuperação) e registro do acesso completo.
import type { FastifyRequest } from 'fastify'
import { SECURITY } from '../../config'
import type { Db } from '../../db'
import { AppError, Errors } from '../../errors'
import type { Cipher } from '../../lib/crypto'
import { sha256 } from '../../lib/crypto'
import { verifyTotp } from '../../lib/totp'
import { writeAudit } from '../../services/audit'
import type { AuthContext, AuthUser, SessionStage } from '../../types'

/** Linha de users com o que o login precisa (nunca sai do servidor). */
export interface UserRow {
  id: string
  name: string
  email: string
  role_id: string
  status: AuthUser['status']
  password_hash: string | null
  must_change_password: boolean
  totp_secret_enc: string | null
  totp_pending_enc: string | null
  totp_enabled: boolean
  totp_last_counter: number | null
  recovery_codes: string[] | null
  failed_logins: number
  locked_until: string | null
  /** locked_until no futuro, calculado com o relógio do banco */
  locked: boolean
  last_access_at: string | null
}

const USER_COLUMNS = `id, name, email, role_id, status, password_hash, must_change_password,
  totp_secret_enc, totp_pending_enc, totp_enabled, totp_last_counter, recovery_codes,
  failed_logins, locked_until, (locked_until is not null and locked_until > now()) as locked, last_access_at`

export async function findUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  return db.one<UserRow>(`select ${USER_COLUMNS} from users where lower(email) = lower($1)`, [email])
}

export async function loadUser(db: Db, id: string): Promise<UserRow | null> {
  return db.one<UserRow>(`select ${USER_COLUMNS} from users where id = $1`, [id])
}

export function toAuthUser(u: UserRow): AuthUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    roleId: u.role_id,
    status: u.status,
    totpEnabled: u.totp_enabled,
    mustChangePassword: u.must_change_password,
  }
}

// ---------- Erros próprios do login ----------

export const AuthErrors = {
  /** mesma resposta para e-mail desconhecido, senha errada e pessoa inativa */
  badCredentials: () => new AppError(401, 'credenciais_invalidas', 'E-mail ou senha incorretos.'),
  badCode: () => new AppError(401, 'credenciais_invalidas', 'Código inválido. Confira o aplicativo autenticador e tente de novo.'),
  badCurrentPassword: () => new AppError(401, 'credenciais_invalidas', 'A senha atual está incorreta.'),
  locked: (until: string) => {
    const minutes = Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 60_000))
    return new AppError(
      423,
      'conta_bloqueada',
      `Acesso bloqueado por muitas tentativas erradas. Tente de novo em ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`,
      { until },
    )
  },
  alreadyConfigured: () => new AppError(409, 'ja_configurado', 'O 2FA já está ligado neste acesso.'),
}

// ---------- Guardas de etapa ----------

/** Exige sessão (qualquer pessoa) numa das etapas indicadas. */
export function requireStage(req: FastifyRequest, ...stages: SessionStage[]): AuthContext {
  const a = req.auth
  if (!a) throw Errors.unauthenticated()
  if (!stages.includes(a.stage)) throw Errors.stage(a.stage)
  return a
}

// ---------- Etapa do login ----------

export interface StageInputs {
  must_change_password: boolean
  totp_enabled: boolean
  require_2fa: boolean
  enforce_all: boolean
}

/** password → 2fa → enroll → active, nesta ordem de prioridade. */
export function stageFor(s: StageInputs): SessionStage {
  if (s.must_change_password) return 'password'
  if (s.totp_enabled) return '2fa'
  if (s.require_2fa || s.enforce_all) return 'enroll'
  return 'active'
}

/** Calcula a etapa com o estado atual da pessoa, do cargo e da segurança do painel. */
export async function computeStage(db: Db, userId: string): Promise<SessionStage> {
  const r = await db.one<StageInputs>(
    `select u.must_change_password, u.totp_enabled, r.require_2fa,
            coalesce((select enforce_2fa_all from panel_security where id = 1), false) as enforce_all
       from users u
       join roles r on r.id = u.role_id
      where u.id = $1`,
    [userId],
  )
  if (!r) throw Errors.unauthenticated()
  return stageFor(r)
}

// ---------- Bloqueio por tentativas erradas ----------

/**
 * Conta uma tentativa errada (senha ou código). Ao chegar em
 * SECURITY.maxFailedLogins bloqueia por SECURITY.lockMinutes e zera a contagem.
 * Devolve o erro 423 quando esta tentativa causou o bloqueio; senão null.
 * Não rode dentro de uma transação que vai ser desfeita (a contagem precisa ficar).
 */
export async function registerFailure(db: Db, user: UserRow, ip: string): Promise<AppError | null> {
  const r = await db.one<{ locked_until: string | null; locked: boolean }>(
    `update users set
        failed_logins = case when failed_logins + 1 >= $2 then 0 else failed_logins + 1 end,
        locked_until = case when failed_logins + 1 >= $2 then now() + ($3 || ' minutes')::interval else locked_until end,
        updated_at = now()
      where id = $1
      returning locked_until, (locked_until is not null and locked_until > now()) as locked`,
    [user.id, SECURITY.maxFailedLogins, String(SECURITY.lockMinutes)],
  )
  if (!r?.locked || !r.locked_until) return null
  await writeAudit(
    db,
    { user: toAuthUser(user), ip },
    {
      action: 'bloquear',
      entity: 'Acesso ao painel',
      summary: `Acesso bloqueado por ${SECURITY.lockMinutes} min após ${SECURITY.maxFailedLogins} tentativas erradas`,
    },
  )
  return AuthErrors.locked(r.locked_until)
}

/** Acerto: zera a contagem de erros e o bloqueio vencido. */
export async function clearFailures(db: Db, userId: string) {
  await db.query(
    `update users set failed_logins = 0, locked_until = null
      where id = $1 and (failed_logins <> 0 or locked_until is not null)`,
    [userId],
  )
}

// ---------- Acesso completo ----------

/** Ao chegar em 'active': último acesso, IP e auditoria 'login'. */
export async function recordLogin(db: Db, user: AuthUser, ip: string, summary: string) {
  await db.query('update users set last_access_at = now(), last_ip = $2 where id = $1', [user.id, ip])
  await writeAudit(db, { user, ip }, { action: 'login', entity: 'Acesso ao painel', summary })
}

// ---------- Segundo fator ----------

const RECOVERY_RE = /^([0-9A-F]{5})-?([0-9A-F]{5})$/

/** "abcde-12345", "ABCDE12345" ou com espaços → "ABCDE-12345"; formato errado → null. */
export function normalizeRecoveryCode(input: string): string | null {
  const m = input.replace(/\s+/g, '').toUpperCase().match(RECOVERY_RE)
  return m ? `${m[1]}-${m[2]}` : null
}

export function hashRecoveryCode(code: string): string {
  return sha256(code)
}

/**
 * Confere e consome o segundo fator de forma atômica:
 *  - TOTP: aceita só passo de tempo posterior ao último usado (impede reuso);
 *  - código de recuperação: remove o hash (uso único).
 * Devolve o tipo aceito ou null.
 */
export async function consumeSecondFactor(db: Db, cipher: Cipher, user: UserRow, input: string): Promise<'totp' | 'recovery' | null> {
  if (!user.totp_enabled) return null
  const digits = input.replace(/\s+/g, '')
  if (/^\d{6}$/.test(digits)) {
    if (!user.totp_secret_enc) return null
    let secret: string
    try {
      secret = cipher.decrypt(user.totp_secret_enc)
    } catch {
      return null
    }
    const counter = verifyTotp(secret, digits)
    if (counter === null) return null
    const row = await db.one(
      `update users set totp_last_counter = $2
        where id = $1 and totp_enabled and (totp_last_counter is null or totp_last_counter < $2)
        returning id`,
      [user.id, counter],
    )
    return row ? 'totp' : null
  }
  const code = normalizeRecoveryCode(input)
  if (!code) return null
  const row = await db.one(
    `update users set recovery_codes = array_remove(recovery_codes, $2::text)
      where id = $1 and totp_enabled and $2::text = any(recovery_codes)
      returning id`,
    [user.id, hashRecoveryCode(code)],
  )
  return row ? 'recovery' : null
}
