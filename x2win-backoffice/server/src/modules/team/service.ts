// Regras da equipe num lugar só: usadas pelas rotas /api/team e pela chave
// equipe.membros. Toda alteração roda dentro de uma transação que trava a
// versão da equipe (settings 'equipe.membros'), então duas gravações
// simultâneas nunca deixam o sistema sem Superadmin nem passam por cima uma
// da outra. A gravação de cargos (cargos.lista) pega esta mesma trava antes da
// dela (ordem fixa: equipe.membros, depois cargos.lista), porque as duas mexem
// em users.role_id e em roles.
import { isAdminLevelRole, isGovernedRole, type Role } from '@shared/permissions'
import { z } from 'zod'
import { SECURITY } from '../../config'
import type { Db } from '../../db'
import { AppError, Errors } from '../../errors'
import { hashPassword, newId, passwordProblem, randomToken, sha256, temporaryPassword } from '../../lib/crypto'
import { writeAudit } from '../../services/audit'
import { getRole, rowToRole, type RoleRow } from '../../services/roles-repo'
import { revokeUserSessions } from '../../services/sessions'
import type { AuthContext, AuthUser } from '../../types'

/** Linha de settings que guarda a versão da lista da equipe ({ version }). */
export const TEAM_VERSION_KEY = 'equipe.membros'
export const SUPERADMIN_ROLE_ID = 'superadmin'
export const GRANT_PERM = 'cargos.conceder'
export const INVITE_HOURS = 72

export type MemberStatus = AuthUser['status']

// ---------- Versão por chave (controle de concorrência) ----------

export function versionConflict(current: number) {
  return new AppError(409, 'versao_desatualizada', 'Outra pessoa salvou estes dados antes de você. Recarregue a tela e tente de novo.', {
    version: current,
  })
}

/** Garante a linha de versão em settings e a trava até o fim da transação. Devolve a versão atual. */
export async function lockKvVersion(t: Db, key: string): Promise<number> {
  await t.query(`insert into settings (key, value) values ($1, '{"version":0}'::jsonb) on conflict (key) do nothing`, [key])
  const row = await t.one<{ value: { version?: number } }>('select value from settings where key = $1 for update', [key])
  return Number(row?.value?.version ?? 0)
}

/** Confere a versão enviada pelo painel. Na versão 0 (nunca gravado pelo painel) aceita ausência. */
export function assertKvVersion(current: number, expected: number | undefined) {
  if (expected === current) return
  if (current === 0 && expected === undefined) return
  throw versionConflict(current)
}

/** Grava a próxima versão (current + 1). */
export async function bumpKvVersion(t: Db, key: string, current: number, userId: string | null): Promise<number> {
  const next = current + 1
  await t.query(`update settings set value = $2::jsonb, updated_at = now(), updated_by = $3 where key = $1`, [
    key,
    JSON.stringify({ version: next }),
    userId,
  ])
  return next
}

export async function readKvVersion(db: Db, key: string): Promise<{ version: number; updatedAt: string | null }> {
  const row = await db.one<{ value: { version?: number }; updated_at: string }>('select value, updated_at from settings where key = $1', [key])
  return { version: Number(row?.value?.version ?? 0), updatedAt: row?.updated_at ?? null }
}

/**
 * Leitura de uma chave de domínio numa foto só: a versão e os dados saem do mesmo instante do banco
 * (REPEATABLE READ, somente leitura). Sem isso, duas instruções soltas podem ver momentos diferentes: uma gravação
 * que termina entre elas faz a leitura devolver o conteúdo velho com a versão nova, e o painel, ao salvar a lista
 * inteira com essa versão, desfaria em silêncio a alteração da outra pessoa (sem 409).
 * Chamar com o banco fora de transação (app.db): o SET TRANSACTION precisa ser a primeira instrução.
 */
export async function readSnapshot<T>(db: Db, fn: (t: Db) => Promise<T>): Promise<T> {
  return db.tx(async (t) => {
    await t.query('set transaction isolation level repeatable read, read only')
    return fn(t)
  })
}

/** Erros do banco causados por gravações simultâneas: impasse, falha de serialização e referência que sumiu no meio. */
const CONCURRENCY_DB_CODES = new Set(['40P01', '40001', '23503'])

export function isConcurrencyDbError(e: unknown): boolean {
  return !!e && typeof e === 'object' && CONCURRENCY_DB_CODES.has(String((e as { code?: unknown }).code))
}

/**
 * 409 versao_desatualizada para um erro de gravação simultânea (em vez de 500): o painel recarrega a chave e a
 * pessoa refaz a alteração. A versão em details é a atual (lida depois que a transação foi desfeita).
 */
export async function concurrentWriteConflict(db: Db, key: string): Promise<AppError> {
  const v = await readKvVersion(db, key).catch(() => null)
  return new AppError(409, 'versao_desatualizada', 'Outra alteração foi gravada ao mesmo tempo que a sua. Recarregue a tela e tente de novo.', {
    version: v?.version ?? 0,
  })
}

/** Executa uma alteração da equipe travando e avançando a versão da lista. */
export async function withTeamLock<T>(db: Db, actorId: string | null, fn: (t: Db) => Promise<T>): Promise<T> {
  try {
    return await db.tx(async (t) => {
      const current = await lockKvVersion(t, TEAM_VERSION_KEY)
      const out = await fn(t)
      await bumpKvVersion(t, TEAM_VERSION_KEY, current, actorId)
      return out
    })
  } catch (e) {
    if (isConcurrencyDbError(e)) throw await concurrentWriteConflict(db, TEAM_VERSION_KEY)
    throw e
  }
}

// ---------- Leitura no formato do painel ----------

export interface MemberRow {
  id: string
  name: string
  email: string
  role_id: string
  status: MemberStatus
  totp_enabled: boolean
  has_password: boolean
  last_access_at: string | null
  last_ip: string | null
  created_at: string
  updated_at: string
  active_sessions: number
}

export interface PanelMember {
  id: string
  name: string
  email: string
  roleId: string
  status: MemberStatus
  twoFactor: boolean
  lastAccess: string | null
  lastIp: string | null
  createdAt: string
  activeSessions: number
}

// sessões que ainda valem: não revogadas, não vencidas e (se ativas) sem passar do tempo de inatividade
const MEMBER_SELECT = `
  select u.id, u.name, u.email, u.role_id, u.status, u.totp_enabled, (u.password_hash is not null) as has_password,
         u.last_access_at, u.last_ip, u.created_at, u.updated_at,
         (select count(*)::int from sessions s
           where s.user_id = u.id and s.revoked_at is null and s.expires_at > now()
             and (s.stage <> 'active'
                  or s.last_seen_at > now() - make_interval(mins => (select session_timeout_minutes from panel_security where id = 1)))
         ) as active_sessions
    from users u`

export async function listMembers(db: Db): Promise<MemberRow[]> {
  return db.query<MemberRow>(`${MEMBER_SELECT} order by u.created_at asc, u.id asc`)
}

export async function findMember(db: Db, id: string): Promise<MemberRow | null> {
  return db.one<MemberRow>(`${MEMBER_SELECT} where u.id = $1`, [id])
}

/** IP do último acesso só para quem vê a tela Equipe. */
export function canSeeLastIp(auth: AuthContext) {
  return auth.perms.has('equipe.ver')
}

export function toPanelMember(r: MemberRow, showIp: boolean): PanelMember {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    roleId: r.role_id,
    status: r.status,
    twoFactor: r.totp_enabled,
    lastAccess: r.last_access_at,
    lastIp: showIp ? r.last_ip : null,
    createdAt: r.created_at,
    activeSessions: Number(r.active_sessions ?? 0),
  }
}

// ---------- Validação ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// ---------- Nome exibido ----------
// O nome aparece como "quem fez" na auditoria, nos saques e nos CSVs: precisa identificar uma pessoa só.
// Por isso ele é normalizado (NFKC, espaços colapsados), não aceita caracteres invisíveis/de controle nem
// letras de outros alfabetos que imitam as latinas (ex.: "а" cirílico), e é único na equipe comparando sem
// maiúsculas, acentos, pontuação, espaços e com as trocas visuais mais comuns (I/l/1, 0/O, rn/m, vv/w).

/** Controle (Cc), formatação (Cf: zero-width, bidi, BOM, soft hyphen), uso privado, não atribuídos e separadores de linha. */
const NAME_FORBIDDEN_RE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}]/u
/** Letras latinas que não se decompõem em letra + acento. */
const NAME_LETTER_FOLD: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i', ĸ: 'k' }
const NAME_BASE_RE = /^[a-z0-9 .'’-]$/

/** Texto-base (sem acentos, minúsculo, só a-z 0-9 espaço . ' ’ -) ou null se tiver caractere fora disso. */
function nameBase(name: string, keepCase = false): string | null {
  const stripped = name.normalize('NFD').replace(/\p{M}/gu, '')
  let out = ''
  for (const ch of stripped) {
    const lower = ch.toLowerCase()
    const folded = NAME_BASE_RE.test(lower) ? lower : NAME_LETTER_FOLD[lower]
    if (folded === undefined) return null
    out += keepCase && ch !== lower && folded === lower ? ch : folded
  }
  return out
}

/** Normaliza e confere o nome. Devolve o nome pronto para gravar ou o problema (mensagem para a pessoa). */
export function checkMemberName(raw: string): { name: string } | { problem: string } {
  if (raw.length > 400) return { problem: 'Use no máximo 100 caracteres no nome.' }
  const nfkc = raw.normalize('NFKC')
  if (NAME_FORBIDDEN_RE.test(nfkc)) return { problem: 'O nome tem caracteres invisíveis ou de controle. Digite o nome de novo, sem colar de outro lugar.' }
  const name = nfkc.replace(/\s+/g, ' ').trim()
  if (name.length < 2) return { problem: 'O nome precisa de pelo menos 2 letras.' }
  if (name.length > 100) return { problem: 'Use no máximo 100 caracteres no nome.' }
  if (/\p{M}{3,}/u.test(name.normalize('NFD'))) return { problem: 'O nome tem acentos demais numa mesma letra.' }
  const base = nameBase(name)
  if (base === null) return { problem: 'Use no nome só letras do alfabeto latino (com ou sem acento), números, espaços, ponto, hífen e apóstrofo.' }
  if (!/^[a-z]/.test(base)) return { problem: 'O nome precisa começar com uma letra.' }
  return { name }
}

/**
 * Chaves de comparação do nome: dois nomes que compartilham alguma chave se confundem na tela.
 *  - "k:" ignora maiúsculas, acentos, espaços e pontuação, com 1 → l, 0 → o, rn → m e vv → w;
 *  - "s:" (esqueleto visual) mantém maiúsculas e troca I maiúsculo e 1 por l, 0 por O, rn por m e vv por w
 *    ("DanieI" com I maiúsculo se lê "Daniel").
 * Nomes antigos fora da regra também ganham chaves.
 */
export function memberNameKeys(raw: string): string[] {
  const name = raw.normalize('NFKC').replace(NAME_FORBIDDEN_RE, '').replace(/\s+/g, ' ').trim()
  const base = nameBase(name, true) ?? name.normalize('NFD').replace(/\p{M}/gu, '')
  const alnum = base.replace(/[^\p{L}\p{N}]/gu, '')
  const fold = (v: string) => v.replace(/1/g, 'l').replace(/rn/g, 'm').replace(/vv/g, 'w')
  return [`k:${fold(alnum.toLowerCase().replace(/0/g, 'o'))}`, `s:${fold(alnum.replace(/I/g, 'l').replace(/0/g, 'O'))}`]
}

/** Os dois nomes se confundem (mesma pessoa aos olhos de quem lê a auditoria)? */
export function namesConflict(a: string, b: string): boolean {
  const ka = memberNameKeys(a)
  return memberNameKeys(b).some((k) => ka.includes(k))
}

export const memberNameSchema = z.string('Informe o nome.').transform((raw, ctx) => {
  const r = checkMemberName(raw)
  if ('problem' in r) {
    ctx.issues.push({ code: 'custom', message: r.problem, input: raw })
    return z.NEVER
  }
  return r.name
})

export const emailSchema = z
  .string('Informe o e-mail.')
  .trim()
  .min(1, 'Informe o e-mail.')
  .max(254, 'E-mail longo demais.')
  .regex(EMAIL_RE, 'E-mail inválido.')
  .transform((v) => v.toLowerCase())

export const roleIdSchema = z.string('Escolha um cargo.').trim().min(1, 'Escolha um cargo.').max(64, 'Cargo inválido.')

export const memberIdSchema = z.string().trim().min(1, 'Pessoa inválida.').max(64, 'Pessoa inválida.')

/** Nome provisório a partir do e-mail ("ana.paula@x" → "Ana Paula"); só letras e números de cada parte. */
export function nameFromEmail(email: string) {
  const local = email.split('@')[0] ?? email
  return local
    .split(/[._+-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 100)
}

// ---------- Erros ----------

export const TeamErrors = {
  notFound: () => new AppError(404, 'nao_encontrado', 'Pessoa não encontrada na equipe.'),
  emailInUse: () => new AppError(409, 'email_em_uso', 'Este e-mail já está cadastrado na equipe.'),
  unknownRole: () => Errors.invalid('Cargo não encontrado. Recarregue a tela e escolha um cargo da lista.', { field: 'roleId' }),
  needsGrant: (msg = 'Só quem pode conceder cargos administrativos mexe em pessoas com cargo administrativo.') => Errors.forbidden(msg),
  lastSuperadmin: () => Errors.invalid('É o último Superadmin ativo. Promova outra pessoa a Superadmin antes.'),
  inviteInvalid: () => Errors.invalid('Convite inválido. Peça um novo link a quem convidou você.'),
  inviteUsed: () => Errors.invalid('Este convite já foi usado. Entre com seu e-mail e senha.'),
  inviteExpired: () => Errors.invalid('Este convite expirou. Peça um novo link a quem convidou você.'),
  /** `derivedName`: o nome não foi digitado e veio do e-mail; a mensagem diz qual nome colidiu (o campo está vazio). */
  nameInUse: (derivedName?: string) =>
    new AppError(
      409,
      'nome_em_uso',
      derivedName
        ? `O nome "${derivedName}", montado a partir do e-mail, é igual ou se confunde com o de outra pessoa da equipe. Digite no campo Nome um nome que identifique a pessoa sem dúvida (por exemplo, com o sobrenome completo).`
        : 'Já existe uma pessoa na equipe com este nome ou com um nome que se confunde com ele. Use um nome que identifique a pessoa sem dúvida (por exemplo, com o sobrenome completo).',
      { field: 'name' },
    ),
}

function isUniqueViolation(e: unknown) {
  return !!e && typeof e === 'object' && (e as { code?: string }).code === '23505'
}

// ---------- Guardas ----------

async function requireMember(t: Db, id: string): Promise<MemberRow> {
  const m = await findMember(t, id)
  if (!m) throw TeamErrors.notFound()
  return m
}

/**
 * Cargo de destino. Com `lock` (dentro da transação que grava) a linha fica travada (FOR SHARE) até o fim: uma
 * exclusão ou alteração simultânea do cargo espera, e um cargo excluído no meio vira "Cargo não encontrado" (400)
 * em vez de violação de chave estrangeira (500). A conferência de cargo administrativo vale até o commit.
 */
async function requireRole(t: Db, id: string, lock = true): Promise<Role> {
  const role = lock ? await lockRoleRow(t, id) : await getRole(t, id)
  if (!role) throw TeamErrors.unknownRole()
  return role
}

async function lockRoleRow(t: Db, id: string): Promise<Role | null> {
  const r = await t.one<RoleRow>('select * from roles where id = $1 for share', [id])
  return r ? rowToRole(r) : null
}

/** Cargo de nível administrativo só com cargos.conceder. */
export function assertMayHandleRole(auth: AuthContext, role: Pick<Role, 'permissions'> | null, msg?: string) {
  if (role && isAdminLevelRole(role) && !auth.perms.has(GRANT_PERM)) throw TeamErrors.needsGrant(msg)
}

/**
 * Pôr alguém num cargo com permissão de governança (aprovar saques de jogadores ou de afiliados, jogo responsável,
 * países bloqueados e as administrativas) só com cargos.conceder: trocar o cargo, criar acesso, convidar, reenviar convite e reativar.
 * Tirar alguém desse cargo segue só a regra de cargo administrativo (assertMayHandleRole).
 */
export function assertMayPlaceInRole(auth: AuthContext, role: Pick<Role, 'name' | 'permissions'> | null, action = 'põe pessoas no cargo') {
  if (role && isGovernedRole(role) && !auth.perms.has(GRANT_PERM)) {
    throw TeamErrors.needsGrant(
      `Só quem pode conceder cargos ${action} ${role.name} (aprova saques ou altera jogo responsável ou países bloqueados).`,
    )
  }
}

/** Recusa se a pessoa é o último Superadmin ativo (chamar antes de tirá-la desse papel). */
async function assertNotLastSuperadmin(t: Db, m: Pick<MemberRow, 'id' | 'role_id' | 'status'>) {
  if (m.role_id !== SUPERADMIN_ROLE_ID || m.status !== 'ativo') return
  const row = await t.one<{ n: number }>(
    `select count(*)::int as n from users where role_id = $1 and status = 'ativo' and id <> $2`,
    [SUPERADMIN_ROLE_ID, m.id],
  )
  if (!row?.n) throw TeamErrors.lastSuperadmin()
}

async function assertEmailFree(t: Db, email: string) {
  const dup = await t.one('select id from users where lower(email) = lower($1)', [email])
  if (dup) throw TeamErrors.emailInUse()
}

/** Nomes que a auditoria usa para ações sem pessoa (ninguém da equipe pode se chamar assim). */
const RESERVED_NAMES = ['Sistema', 'Recuperação de acesso (servidor)']

/**
 * Recusa (409 nome_em_uso) se o nome se confunde com o de outra pessoa da equipe, em qualquer status (quem foi
 * desligado continua na auditoria e pode ser reativado). Chamar dentro da trava da equipe (TEAM_VERSION_KEY):
 * toda gravação de users.name passa por ela, então duas gravações simultâneas não escapam da conferência.
 */
export async function assertNameFree(t: Db, name: string, exceptUserId: string | null = null, derivedFromEmail = false) {
  const inUse = () => TeamErrors.nameInUse(derivedFromEmail ? name : undefined)
  if (RESERVED_NAMES.some((r) => namesConflict(r, name))) throw inUse()
  const rows = await t.query<{ id: string; name: string }>('select id, name from users where id <> coalesce($1, \'\')', [exceptUserId])
  if (rows.some((r) => namesConflict(r.name, name))) throw inUse()
}

const entityOf = (m: Pick<MemberRow, 'name'>) => `Equipe · ${m.name}`

const sessionsLabel = (n: number) => (n === 1 ? '1 sessão encerrada' : `${n} sessões encerradas`)

// ---------- Alterações (rodam dentro de withTeamLock) ----------

/** Desativa o acesso (ativo ou convidado → desligado), encerra as sessões e invalida convites. */
export async function deactivateMember(t: Db, auth: AuthContext, id: string): Promise<MemberRow> {
  const m = await requireMember(t, id)
  if (m.id === auth.user.id) throw Errors.invalid('Você não pode desativar o próprio acesso. Peça a outra pessoa com acesso à equipe.')
  assertMayHandleRole(auth, await getRole(t, m.role_id), 'Só quem pode conceder cargos administrativos desativa pessoas com cargo administrativo.')
  if (m.status === 'desligado') throw Errors.invalid('Esta pessoa já está desligada.')
  await assertNotLastSuperadmin(t, m)
  await t.query(`update users set status = 'desligado', updated_at = now() where id = $1`, [m.id])
  const revoked = await revokeUserSessions(t, m.id, 'desativado')
  await t.query('delete from invites where user_id = $1 and used_at is null', [m.id])
  await writeAudit(t, auth, {
    action: 'desativar',
    entity: entityOf(m),
    summary: `Acesso desativado (${m.email}); ${sessionsLabel(revoked)}.`,
  })
  return requireMember(t, m.id)
}

/** Reativa quem estava desligado. Quem nunca definiu senha volta como convidado (reenviar convite). */
export async function reactivateMember(t: Db, auth: AuthContext, id: string): Promise<MemberRow> {
  const m = await requireMember(t, id)
  const role = await getRole(t, m.role_id)
  assertMayHandleRole(auth, role, 'Só quem pode conceder cargos administrativos reativa pessoas com cargo administrativo.')
  assertMayPlaceInRole(auth, role)
  if (m.status !== 'desligado') throw Errors.invalid('Esta pessoa não está desligada.')
  const next: MemberStatus = m.has_password ? 'ativo' : 'convidado'
  await t.query(`update users set status = $2, failed_logins = 0, locked_until = null, updated_at = now() where id = $1`, [m.id, next])
  await writeAudit(t, auth, {
    action: 'editar',
    entity: entityOf(m),
    summary: next === 'ativo' ? `Acesso reativado (${m.email}).` : `Acesso reativado como convite pendente (${m.email}); reenvie o convite.`,
  })
  return requireMember(t, m.id)
}

/** Troca o cargo. Cargo administrativo (atual ou novo) ou novo cargo com governança exige cargos.conceder. */
export async function changeMemberRole(t: Db, auth: AuthContext, id: string, roleId: string): Promise<MemberRow> {
  const m = await requireMember(t, id)
  if (m.id === auth.user.id) throw Errors.invalid('Você não pode mudar o próprio cargo. Peça a outra pessoa com acesso à equipe.')
  const to = await requireRole(t, roleId)
  if (m.role_id === to.id) throw Errors.invalid('A pessoa já tem este cargo.')
  const from = await getRole(t, m.role_id)
  if (((from && isAdminLevelRole(from)) || isAdminLevelRole(to)) && !auth.perms.has(GRANT_PERM)) {
    throw TeamErrors.needsGrant('Só quem pode conceder cargos administrativos dá ou retira cargos administrativos.')
  }
  assertMayPlaceInRole(auth, to)
  if (to.id !== SUPERADMIN_ROLE_ID) await assertNotLastSuperadmin(t, m)
  await t.query(`update users set role_id = $2, updated_at = now() where id = $1`, [m.id, to.id])
  await writeAudit(t, auth, {
    action: 'editar',
    entity: entityOf(m),
    summary: `Cargo alterado: ${from?.name ?? m.role_id} → ${to.name}.`,
  })
  return requireMember(t, m.id)
}

/** Muda o nome exibido. */
export async function renameMember(t: Db, auth: AuthContext, id: string, rawName: string): Promise<MemberRow> {
  const name = memberNameSchema.parse(rawName)
  const m = await requireMember(t, id)
  assertMayHandleRole(auth, await getRole(t, m.role_id))
  if (m.name === name) return m
  await assertNameFree(t, name, m.id)
  await t.query(`update users set name = $2, updated_at = now() where id = $1`, [m.id, name])
  await writeAudit(t, auth, { action: 'editar', entity: `Equipe · ${name}`, summary: `Nome alterado: ${m.name} → ${name}.` })
  return requireMember(t, m.id)
}

/** Desliga o 2FA da pessoa e encerra as sessões (ela cadastra de novo no próximo login se for exigido). */
export async function resetMember2fa(t: Db, auth: AuthContext, id: string): Promise<MemberRow> {
  const m = await requireMember(t, id)
  if (m.id === auth.user.id) throw Errors.invalid('Você não pode redefinir o próprio 2FA por aqui. Peça a outra pessoa com acesso à equipe.')
  assertMayHandleRole(auth, await getRole(t, m.role_id), 'Só quem pode conceder cargos administrativos redefine o 2FA de pessoas com cargo administrativo.')
  await t.query(
    `update users set totp_enabled = false, totp_secret_enc = null, totp_pending_enc = null, totp_last_counter = null,
            recovery_codes = '{}', updated_at = now()
      where id = $1`,
    [m.id],
  )
  const revoked = await revokeUserSessions(t, m.id, '2fa_redefinido')
  await writeAudit(t, auth, {
    action: 'desligar',
    entity: `2FA · ${m.name}`,
    summary: `2FA redefinido (${m.email}); ${sessionsLabel(revoked)}. Novo cadastro no próximo login.`,
  })
  return requireMember(t, m.id)
}

/**
 * Gera uma senha temporária para quem esqueceu a dela: troca obrigatória no próximo acesso, sessões encerradas.
 * O 2FA continua (a senha nova sozinha não abre a conta de quem tem 2FA; sem o celular, "Redefinir 2FA").
 * A senha volta para quem gerou, como no acesso direto: cargo administrativo e cargo com governança só com
 * cargos.conceder (equivale a pôr alguém no cargo). Ninguém gera para si mesmo (use "Trocar senha").
 * O hash (lento) vem pronto de fora da transação; a guarda da rota confere antes de calculá-lo.
 */
export async function resetMemberPassword(
  t: Db,
  auth: AuthContext,
  id: string,
  hash: string,
): Promise<{ member: MemberRow; sessionsEnded: number }> {
  const m = await assertMayResetPassword(t, auth, id)
  await t.query(
    `update users set password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = null, updated_at = now()
      where id = $1`,
    [m.id, hash],
  )
  const revoked = await revokeUserSessions(t, m.id, 'senha_redefinida')
  await writeAudit(t, auth, {
    action: 'editar',
    entity: `Senha · ${m.name}`,
    summary: `Senha temporária gerada (${m.email}); ${sessionsLabel(revoked)}. Troca obrigatória no próximo acesso.`,
  })
  return { member: await requireMember(t, m.id), sessionsEnded: revoked }
}

/** Confere se quem pede pode gerar a senha temporária desta pessoa (antes e dentro da transação). */
export async function assertMayResetPassword(t: Db, auth: AuthContext, id: string): Promise<MemberRow> {
  const m = await requireMember(t, id)
  if (m.id === auth.user.id) throw Errors.invalid('Você não gera senha temporária para si mesmo. Use "Trocar senha" no menu da sua conta.')
  const role = await getRole(t, m.role_id)
  assertMayHandleRole(auth, role, 'Só quem pode conceder cargos administrativos gera senha temporária para pessoas com cargo administrativo.')
  // a senha volta para quem gerou: equivale a pôr alguém no cargo (a mensagem fala da ação recusada)
  assertMayPlaceInRole(auth, role, 'gera senha temporária para pessoas no cargo')
  if (m.status === 'convidado') throw Errors.invalid('Esta pessoa ainda não aceitou o convite. Reenvie o convite em vez de gerar senha.')
  if (m.status !== 'ativo') throw Errors.invalid('Este acesso está desativado. Reative o acesso antes de gerar uma senha temporária.')
  return m
}

// ---------- Criação e convites ----------

export interface DirectInput {
  name: string
  email: string
  roleId: string
}

export interface InviteInput {
  email: string
  roleId: string
  name?: string
}

/**
 * Cálculo de senha (hashPassword) pela fila única do processo. A rota passa withPasswordSlot (auth/password-gate):
 * com a fila cheia, 503 servidor_ocupado com Retry-After, sem calcular nada.
 */
export type PasswordSlot = <T>(work: () => Promise<T>) => Promise<T>

/** Senha temporária que já atende à regra de senha forte. */
export function strongTemporaryPassword(): string {
  for (;;) {
    const p = temporaryPassword()
    if (!passwordProblem(p, SECURITY.passwordMinLength)) return p
  }
}

/** Cria a pessoa já ativa com senha temporária (troca obrigatória no 1º acesso). */
export async function createDirectMember(
  db: Db,
  auth: AuthContext,
  input: DirectInput,
  slot: PasswordSlot,
): Promise<{ member: MemberRow; temporaryPassword: string }> {
  const name = memberNameSchema.parse(input.name)
  const check = async (t: Db, lock: boolean) => {
    const role = await requireRole(t, input.roleId, lock)
    assertMayHandleRole(auth, role, 'Só quem pode conceder cargos administrativos cria acessos com cargo administrativo.')
    assertMayPlaceInRole(auth, role)
    await assertEmailFree(t, input.email)
    await assertNameFree(t, name)
    return role
  }
  // o hash é lento: confere o barato antes e calcula fora da transação (que confere de novo, com trava)
  await check(db, false)
  const password = strongTemporaryPassword()
  const hash = await slot(() => hashPassword(password))
  try {
    const member = await withTeamLock(db, auth.user.id, async (t) => {
      const role = await check(t, true)
      const id = newId('u')
      await t.query(
        `insert into users (id, name, email, role_id, status, password_hash, must_change_password)
         values ($1, $2, $3, $4, 'ativo', $5, true)`,
        [id, name, input.email, role.id, hash],
      )
      await writeAudit(t, auth, {
        action: 'criar',
        entity: `Equipe · ${name}`,
        summary: `Acesso direto criado (${input.email}) com o cargo ${role.name}; troca de senha obrigatória no 1º acesso.`,
      })
      return requireMember(t, id)
    })
    return { member, temporaryPassword: password }
  } catch (e) {
    if (isUniqueViolation(e)) throw TeamErrors.emailInUse()
    throw e
  }
}

async function issueInvite(t: Db, userId: string, createdBy: string): Promise<string> {
  const token = randomToken(32)
  await t.query(
    `insert into invites (token_hash, user_id, created_by, expires_at) values ($1, $2, $3, now() + ($4 || ' hours')::interval)`,
    [sha256(token), userId, createdBy, String(INVITE_HOURS)],
  )
  return token
}

export function inviteUrl(origin: string, token: string) {
  return `${origin.replace(/\/+$/, '')}/#/convite?token=${encodeURIComponent(token)}`
}

/** Nome do convite: o digitado por quem convida ou, sem ele, o montado a partir do e-mail (com a mesma regra). */
function inviteName(input: InviteInput): string {
  if (input.name?.trim()) return memberNameSchema.parse(input.name)
  const r = checkMemberName(nameFromEmail(input.email))
  if ('problem' in r) throw Errors.invalid('Não deu para montar o nome a partir do e-mail. Informe o nome da pessoa convidada.', { field: 'name' })
  return r.name
}

/** Convida: pessoa com status convidado e link de aceite válido por 72 h (só o hash do token fica no banco). */
export async function inviteMember(db: Db, auth: AuthContext, input: InviteInput, origin: string): Promise<{ member: MemberRow; inviteUrl: string }> {
  const name = inviteName(input)
  try {
    return await withTeamLock(db, auth.user.id, async (t) => {
      const role = await requireRole(t, input.roleId)
      assertMayHandleRole(auth, role, 'Só quem pode conceder cargos administrativos convida pessoas para cargo administrativo.')
      assertMayPlaceInRole(auth, role)
      await assertEmailFree(t, input.email)
      await assertNameFree(t, name, null, !input.name?.trim())
      const id = newId('u')
      await t.query(
        `insert into users (id, name, email, role_id, status, password_hash, must_change_password)
         values ($1, $2, $3, $4, 'convidado', null, false)`,
        [id, name, input.email, role.id],
      )
      const token = await issueInvite(t, id, auth.user.id)
      await writeAudit(t, auth, {
        action: 'convidar',
        entity: `Equipe · ${name}`,
        summary: `Convite enviado para ${input.email} com o cargo ${role.name} (válido por ${INVITE_HOURS} h).`,
      })
      return { member: await requireMember(t, id), inviteUrl: inviteUrl(origin, token) }
    })
  } catch (e) {
    if (isUniqueViolation(e)) throw TeamErrors.emailInUse()
    throw e
  }
}

/** Gera um link novo; o anterior deixa de valer. */
export async function resendInvite(db: Db, auth: AuthContext, id: string, origin: string): Promise<{ member: MemberRow; inviteUrl: string }> {
  return withTeamLock(db, auth.user.id, async (t) => {
    const m = await requireMember(t, id)
    const role = await getRole(t, m.role_id)
    assertMayHandleRole(auth, role, 'Só quem pode conceder cargos administrativos reenvia convite para cargo administrativo.')
    // o link volta para quem reenvia: equivale a pôr alguém no cargo
    assertMayPlaceInRole(auth, role)
    if (m.status !== 'convidado') throw Errors.invalid('Só dá para reenviar o convite de quem ainda não aceitou.')
    await t.query('delete from invites where user_id = $1 and used_at is null', [m.id])
    const token = await issueInvite(t, m.id, auth.user.id)
    await writeAudit(t, auth, {
      action: 'convidar',
      entity: entityOf(m),
      summary: `Convite reenviado para ${m.email} (válido por ${INVITE_HOURS} h); o link anterior deixou de valer.`,
    })
    return { member: m, inviteUrl: inviteUrl(origin, token) }
  })
}

interface InviteRow {
  token_hash: string
  user_id: string
  used_at: string | null
  expired: boolean
  status: MemberStatus
  name: string
  email: string
  role_id: string
  totp_enabled: boolean
}

async function findInvite(db: Db, token: string, lock: boolean): Promise<InviteRow | null> {
  return db.one<InviteRow>(
    `select i.token_hash, i.user_id, i.used_at, (i.expires_at <= now()) as expired,
            u.status, u.name, u.email, u.role_id, u.totp_enabled
       from invites i join users u on u.id = i.user_id
      where i.token_hash = $1${lock ? ' for update of i, u' : ''}`,
    [sha256(token)],
  )
}

function assertInviteUsable(inv: InviteRow | null): asserts inv is InviteRow {
  if (!inv) throw TeamErrors.inviteInvalid()
  if (inv.used_at) throw TeamErrors.inviteUsed()
  if (inv.expired) throw TeamErrors.inviteExpired()
  if (inv.status !== 'convidado') throw TeamErrors.inviteInvalid()
}

/**
 * Aceite do convite (sem sessão): define a senha e ativa o acesso. O nome continua o que quem convidou registrou
 * (a rota é pública: quem tem o link não escolhe como aparece na auditoria); trocar o nome é pela tela Equipe,
 * com auditoria. Um `name` enviado é ignorado.
 */
export async function acceptInvite(db: Db, input: { token: string; password: string }, ip: string, slot: PasswordSlot): Promise<void> {
  const problem = passwordProblem(input.password, SECURITY.passwordMinLength)
  if (problem) throw Errors.invalid(problem, { field: 'password' })
  // confere antes de gastar o hash; confere de novo com trava dentro da transação
  assertInviteUsable(await findInvite(db, input.token, false))
  const hash = await slot(() => hashPassword(input.password))
  await db.tx(async (t) => {
    const current = await lockKvVersion(t, TEAM_VERSION_KEY)
    const inv = await findInvite(t, input.token, true)
    assertInviteUsable(inv)
    await t.query(
      `update users set password_hash = $2, status = 'ativo', must_change_password = false,
              failed_logins = 0, locked_until = null, updated_at = now()
        where id = $1`,
      [inv.user_id, hash],
    )
    await t.query('update invites set used_at = now() where user_id = $1 and used_at is null', [inv.user_id])
    await bumpKvVersion(t, TEAM_VERSION_KEY, current, inv.user_id)
    const actor: AuthUser = {
      id: inv.user_id,
      name: inv.name,
      email: inv.email,
      roleId: inv.role_id,
      status: 'ativo',
      totpEnabled: inv.totp_enabled,
      mustChangePassword: false,
    }
    await writeAudit(t, { user: actor, ip }, { action: 'editar', entity: `Equipe · ${inv.name}`, summary: `Convite aceito (${inv.email}); acesso ativado.` })
  })
}
