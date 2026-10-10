// Regras do login: etapa da sessão, bloqueio por tentativas erradas, segundo
// fator (TOTP e códigos de recuperação) e registro do acesso completo.
import { randomBytes } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { SECURITY } from '../../config'
import type { Db } from '../../db'
import { AppError, Errors } from '../../errors'
import { hmacSha256, type Cipher } from '../../lib/crypto'
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
  badRecoveryCode: () =>
    new AppError(
      401,
      'credenciais_invalidas',
      'Código de recuperação inválido ou já usado. Cada código funciona uma vez; confira a digitação ou use outro da lista.',
      { kind: 'recuperacao' },
    ),
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

/** Estado atual da pessoa, do cargo e da segurança do painel que decide a etapa. */
export async function loadStageInputs(db: Db, userId: string): Promise<StageInputs> {
  const r = await db.one<StageInputs>(
    `select u.must_change_password, u.totp_enabled, r.require_2fa,
            coalesce((select enforce_2fa_all from panel_security where id = 1), false) as enforce_all
       from users u
       join roles r on r.id = u.role_id
      where u.id = $1`,
    [userId],
  )
  if (!r) throw Errors.unauthenticated()
  return r
}

/** Calcula a etapa com o estado atual da pessoa, do cargo e da segurança do painel. */
export async function computeStage(db: Db, userId: string): Promise<SessionStage> {
  return stageFor(await loadStageInputs(db, userId))
}

// ---------- Bloqueio da conta (erros depois da senha) ----------
//
// users.failed_logins / locked_until contam só erros de quem JÁ passou da senha ou tem uma sessão:
// código do 2FA errado (/2fa/verify e /2fa/enable) e senha atual errada com sessão ativa (/password e
// /2fa/setup). Senha errada no /login não entra aqui: vai para o freio por (e-mail, origem) de
// throttle.ts, que responde igual exista ou não a pessoa.
// A contagem só volta a zero com um acesso completo (2FA aceito, ou senha certa de quem não tem 2FA):
// acertar só a senha de quem tem 2FA não zera os erros do código.

/**
 * Conta um erro. Ao chegar em SECURITY.maxFailedLogins bloqueia por SECURITY.lockMinutes; durante o
 * bloqueio os erros seguem somando sem estender o prazo; depois do prazo a contagem recomeça em 1.
 * Todo erro vai para a auditoria (quem erra aqui já sabe a senha ou tem uma sessão): 'recusar' com o
 * motivo, ou 'bloquear' na tentativa que bloqueia.
 * Devolve o erro 423 se a conta está bloqueada depois deste erro; senão null.
 * Não rode dentro de uma transação que vai ser desfeita (a contagem precisa ficar).
 */
export async function registerFailure(db: Db, user: UserRow, ip: string, reason: string): Promise<AppError | null> {
  const r = await db.one<{ failed_logins: number; locked_until: string | null; locked: boolean; was_locked: boolean }>(
    `with prev as (
       select id, coalesce(locked_until > now(), false) as was_locked from users where id = $1 for update
     )
     update users u set
        failed_logins = case when u.locked_until is not null and u.locked_until <= now() then 1 else u.failed_logins + 1 end,
        locked_until = case
          when u.locked_until > now() then u.locked_until
          when (case when u.locked_until is not null then 1 else u.failed_logins + 1 end) >= $2
            then now() + ($3 || ' minutes')::interval
          else null end,
        updated_at = now()
       from prev
      where u.id = prev.id
      returning u.failed_logins, u.locked_until, coalesce(u.locked_until > now(), false) as locked, prev.was_locked`,
    [user.id, SECURITY.maxFailedLogins, String(SECURITY.lockMinutes)],
  )
  if (!r) return null
  const justLocked = r.locked && !r.was_locked
  await writeAudit(
    db,
    { user: toAuthUser(user), ip },
    justLocked
      ? {
          action: 'bloquear',
          entity: 'Acesso ao painel',
          summary: `Acesso bloqueado por ${SECURITY.lockMinutes} min após ${SECURITY.maxFailedLogins} tentativas erradas seguidas (${reason})`,
        }
      : {
          action: 'recusar',
          entity: 'Acesso ao painel',
          summary: `${reason} (${r.locked ? 'acesso já bloqueado' : `tentativa ${r.failed_logins} de ${SECURITY.maxFailedLogins}`})`,
        },
  )
  return r.locked && r.locked_until ? AuthErrors.locked(r.locked_until) : null
}

/**
 * Dentro da transação que concede o acesso: trava a linha da pessoa e recusa se a conta está bloqueada.
 * Um erro registrado durante a conferência lenta (scrypt/TOTP) de outra requisição é visto aqui, então
 * um acerto não passa nem limpa um bloqueio que acabou de ser aplicado.
 */
export async function assertNotLocked(db: Db, userId: string): Promise<void> {
  const r = await db.one<{ locked_until: string | null; locked: boolean }>(
    `select locked_until, coalesce(locked_until > now(), false) as locked from users where id = $1 for update`,
    [userId],
  )
  if (r?.locked && r.locked_until) throw AuthErrors.locked(r.locked_until)
}

/** Acesso completo: zera a contagem de erros e o bloqueio vencido. */
export async function clearFailures(db: Db, userId: string) {
  await db.query(
    `update users set failed_logins = 0, locked_until = null
      where id = $1 and (failed_logins <> 0 or locked_until is not null)
        and (locked_until is null or locked_until <= now())`,
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

// Códigos de recuperação: 20 caracteres Crockford base32 (sem I, L, O, U) = 100 bits cada, em grupos
// de 5 ("7K3QF-2M9XD-HV0TC-8BN4R"). Busca exaustiva fora de alcance mesmo com o hash vazado.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RECOVERY_CHARS = 20
export const RECOVERY_CODE_BITS = RECOVERY_CHARS * 5
const RECOVERY_RE = /^[0-9A-HJKMNP-TV-Z]{20}$/

const groupsOf5 = (s: string) => s.match(/.{5}/g)!.join('-')

/** Códigos de recuperação de uso único (mostrados uma vez). */
export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    // 1 byte por caractere; 256 é múltiplo de 32, então "& 31" não enviesa
    const bytes = randomBytes(RECOVERY_CHARS)
    let s = ''
    for (const b of bytes) s += CROCKFORD[b & 31]
    return groupsOf5(s)
  })
}

/**
 * Aceita minúsculas, espaços e hífens em qualquer lugar e as trocas comuns ao ler do papel
 * (O→0, I/L→1). Devolve "XXXXX-XXXXX-XXXXX-XXXXX" ou null se o formato não confere.
 */
export function normalizeRecoveryCode(input: string): string | null {
  const clean = input.replace(/[\s-]+/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1')
  return RECOVERY_RE.test(clean) ? groupsOf5(clean) : null
}

/**
 * Hash guardado no banco: HMAC-SHA256 com um segredo do servidor (APP_SECRET, fora do banco) e o id da
 * pessoa. Sem o segredo, um backup do banco não permite testar códigos; com o id, o mesmo código de
 * duas pessoas dá hashes diferentes (nenhuma tabela pronta cobre todo mundo).
 * O prefixo "v2$" separa do formato antigo (sha256 puro de 40 bits), que não é mais aceito.
 */
export function hashRecoveryCode(serverSecret: string, userId: string, code: string): string {
  return `v2$${hmacSha256(serverSecret, `x2w-recovery-code|v2|${userId}|${code}`)}`
}

/**
 * Confere e consome o segundo fator de forma atômica:
 *  - TOTP: aceita só passo de tempo posterior ao último usado (impede reuso);
 *  - código de recuperação: remove o hash (uso único).
 * Devolve o tipo aceito ou null.
 */
export async function consumeSecondFactor(
  db: Db,
  keys: { cipher: Cipher; serverSecret: string },
  user: UserRow,
  input: string,
): Promise<'totp' | 'recovery' | null> {
  if (!user.totp_enabled) return null
  const digits = input.replace(/\s+/g, '')
  if (/^\d{6}$/.test(digits)) {
    if (!user.totp_secret_enc) return null
    let secret: string
    try {
      secret = keys.cipher.decrypt(user.totp_secret_enc)
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
    [user.id, hashRecoveryCode(keys.serverSecret, user.id, code)],
  )
  return row ? 'recovery' : null
}
