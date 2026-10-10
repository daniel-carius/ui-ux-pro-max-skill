// Regras de acesso do painel (Configurações › Equipe e Cargos e permissões).
// Funções puras: quem pode conceder cargos, quem pode ser desativado,
// o que é "acesso amplo" (achados 1 e 2), nomes parecidos (achado 9) e
// consistência da matriz de permissões.
import { MODULES, PAGES, type ModuleId } from '@/nav'
import type { AuditAction, TeamMember } from '@/data/team'
import {
  ADMIN_LEVEL_PERMISSIONS,
  GOVERNED_PERMISSIONS,
  isAdminLevelRole as roleIsAdminLevel,
  isGovernedChange,
  isGovernedRole as roleIsGoverned,
  isRequire2faLocked,
} from '@shared/permissions'
import { PERMISSIONS, PERMISSION_BY_KEY, type Permission, type Role } from './roles'

// ---------- Cargos administrativos e de governança ----------
// As listas vêm de shared/permissions.ts, as mesmas que o servidor usa para recusar (403).

/** Permissões que dão poder sobre acessos, cargos, chaves de IA e destinos de pagamento. */
export const ADMIN_PERMS = ADMIN_LEVEL_PERMISSIONS

/**
 * Permissões de governança: as administrativas e as que decidem dinheiro ou obrigação regulatória
 * (aprovar saques de jogadores e de afiliados, jogo responsável, países bloqueados).
 */
export { GOVERNED_PERMISSIONS, isGovernedChange }

export const GRANT_PERM = 'cargos.conceder'

/** Cargo com alguma permissão administrativa: só quem concede cargos altera, dá ou retira. */
export function isAdminLevelRole(role: Role | undefined): boolean {
  return !!role && roleIsAdminLevel(role)
}

export function isAdminPerm(key: string) {
  return (ADMIN_LEVEL_PERMISSIONS as readonly string[]).includes(key)
}

/** Só quem concede cargos dá ou tira esta permissão de um cargo. */
export function isGovernedPerm(key: string) {
  return (GOVERNED_PERMISSIONS as readonly string[]).includes(key)
}

/** Cargo com alguma permissão de governança (inclui as administrativas): pôr alguém nele exige cargos.conceder. */
export function isGovernedRole(role: Role | undefined): boolean {
  return !!role && roleIsGoverned(role)
}

/**
 * Criar (duplicar) ou excluir este cargo exige cargos.conceder: ele tem permissão de governança ou teto de
 * aprovação diferente de "não aprova" (o servidor compara com um cargo inexistente).
 */
export function needsGrantToCreateOrDelete(role: Pick<Role, 'permissions' | 'approvalCeiling'>): boolean {
  return isGovernedChange(null, role)
}

// ---------- Acesso amplo (achados 1 e 2) ----------

/** Permissões que, sozinhas, já tornam o acesso sensível. */
export const SENSITIVE_PERMS = [
  'cargos.conceder',
  'cargos.editar',
  'equipe.editar',
  'seguranca-painel.editar',
  'mcp.editar',
  'gateways.editar',
  'saques.aprovar',
  'afiliados-saques.aprovar',
  'afiliados-saques.ver-pix',
  'usuarios.editar',
  'usuarios.ver-dados',
  'usuarios.exportar',
  'transacoes.exportar',
  'auditoria.exportar',
  'antifraude.banir',
] as const

export const BROAD_PERMISSION_COUNT = 25

export interface BroadAccess {
  broad: boolean
  reasons: string[]
  sensitive: string[]
}

/** Um cargo tem acesso amplo se reúne muitas permissões ou alguma sensível. */
export function broadAccess(role: Role): BroadAccess {
  const sensitive = role.permissions.filter((p) => (SENSITIVE_PERMS as readonly string[]).includes(p))
  const reasons: string[] = []
  if (role.permissions.length >= BROAD_PERMISSION_COUNT) reasons.push(`${role.permissions.length} permissões`)
  if (sensitive.length) {
    const labels = sensitive.slice(0, 3).map((k) => PERMISSION_BY_KEY.get(k)?.label ?? k)
    reasons.push(labels.join(', ') + (sensitive.length > 3 ? ` e mais ${sensitive.length - 3}` : ''))
  }
  return { broad: reasons.length > 0, reasons, sensitive }
}

/** Cargos de acesso amplo com 2FA opcional (achado 1). O Superadmin sempre exige 2FA (travado). */
export function broadRolesWithout2fa(roles: Role[]): Role[] {
  return roles.filter((r) => !r.require2fa && !isRequire2faLocked(r) && broadAccess(r).broad)
}

export interface RiskyMember {
  member: TeamMember
  role: Role
  reasons: string[]
}

/** Pessoas ativas, com acesso amplo e 2FA desligado (achado 2). */
export function riskyMembers(team: TeamMember[], roles: Role[]): RiskyMember[] {
  const out: RiskyMember[] = []
  for (const m of team) {
    // quem nunca entrou ativa o 2FA no primeiro acesso (obrigatório para contas novas)
    if (m.status !== 'ativo' || m.twoFactor || !m.lastAccess) continue
    const role = roles.find((r) => r.id === m.roleId)
    if (!role) continue
    const b = broadAccess(role)
    if (b.broad) out.push({ member: m, role, reasons: b.reasons })
  }
  return out
}

/** A pessoa precisa cadastrar o 2FA? (2FA para todos, exigido no cargo ou travado no Superadmin) */
export function needs2faSetup(member: TeamMember, role: Role | undefined, enforceAll: boolean) {
  return !member.twoFactor && (enforceAll || !!role?.require2fa || (!!role && isRequire2faLocked(role)))
}

// ---------- Equipe ----------

export interface RuleResult {
  ok: boolean
  message?: string
}

export function activeMembers(team: TeamMember[], roleId: string) {
  return team.filter((m) => m.roleId === roleId && m.status === 'ativo')
}

export function canDeactivate(member: TeamMember, team: TeamMember[], currentUserId: string): RuleResult {
  if (member.status === 'desligado') return { ok: false, message: 'Esta pessoa já está desligada.' }
  if (member.id === currentUserId) return { ok: false, message: 'Você não pode desativar o próprio acesso. Peça a outro Superadmin.' }
  if (member.roleId === 'superadmin' && member.status === 'ativo' && activeMembers(team, 'superadmin').length <= 1)
    return { ok: false, message: 'É o último Superadmin ativo. Promova outra pessoa a Superadmin antes.' }
  return { ok: true }
}

export function canChangeRole(
  member: TeamMember,
  from: Role | undefined,
  to: Role | undefined,
  team: TeamMember[],
  currentUserId: string,
  canGrant: boolean,
): RuleResult {
  if (!to) return { ok: false, message: 'Escolha um cargo.' }
  if (from?.id === to.id) return { ok: false, message: 'A pessoa já tem este cargo.' }
  if ((isAdminLevelRole(from) || isAdminLevelRole(to)) && !canGrant)
    return { ok: false, message: 'Só o Superadmin concede ou retira cargos administrativos (Superadmin, Administrador ou cargos com controle de acesso).' }
  if (isGovernedRole(to) && !canGrant)
    return { ok: false, message: `Só quem pode conceder cargos põe pessoas no cargo ${to.name} (aprova saques ou altera jogo responsável ou países bloqueados).` }
  if (from?.id === 'superadmin' && member.id === currentUserId)
    return { ok: false, message: 'Você não pode retirar o próprio cargo de Superadmin.' }
  if (from?.id === 'superadmin' && member.status === 'ativo' && activeMembers(team, 'superadmin').length <= 1)
    return { ok: false, message: 'É o último Superadmin ativo. Promova outra pessoa antes de trocar este cargo.' }
  return { ok: true }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateEmail(email: string): string | null {
  const e = email.trim()
  if (!e) return 'Informe o e-mail.'
  if (!EMAIL_RE.test(e)) return 'E-mail inválido.'
  return null
}

export function validateTeamEmail(email: string, team: TeamMember[], ignoreId?: string): string | null {
  const base = validateEmail(email)
  if (base) return base
  const e = email.trim().toLowerCase()
  const dup = team.find((m) => m.email.toLowerCase() === e && m.id !== ignoreId)
  if (dup) return `${dup.name} já usa este e-mail (${dup.status}).`
  return null
}

/** Nome provisório a partir do e-mail ("ana.paula@x" → "Ana Paula"). */
export function nameFromEmail(email: string) {
  const local = email.split('@')[0] ?? email
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

const PASS_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

function randomChars(len: number, chars = PASS_CHARS) {
  const out: string[] = []
  const buf = new Uint32Array(len)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf)
  else for (let i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 2 ** 32)
  for (let i = 0; i < len; i++) out.push(chars[buf[i] % chars.length])
  return out.join('')
}

/** Senha temporária: troca obrigatória no primeiro acesso. */
export function generateTempPassword() {
  return `${randomChars(4)}-${randomChars(4)}-${randomChars(4)}`
}

export { randomChars }

// ---------- Nomes parecidos (achado 9) ----------

export function normalizeName(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshtein(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

/** Dois nomes de cargo podem ser confundidos na hora de atribuir? */
export function namesLookAlike(a: string, b: string): boolean {
  const x = normalizeName(a)
  const y = normalizeName(b)
  if (!x || !y) return false
  if (x === y) return true
  const wx = x.split(' ')
  const wy = y.split(' ')
  // uma palavra inteira do nome curto aparece no nome longo ("marketing" × "marketing oficial")
  if (wx.length !== wy.length && (wx.every((w) => wy.includes(w)) || wy.every((w) => wx.includes(w)))) return true
  // abreviação ("adm" × "administrador")
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  if (short.length >= 3 && !short.includes(' ') && long.startsWith(short)) return true
  // diferença de 1 ou 2 letras em nomes médios
  if (Math.min(x.length, y.length) >= 5 && levenshtein(x, y) <= 2) return true
  return false
}

export function similarRolePairs(roles: Role[]): [Role, Role][] {
  const out: [Role, Role][] = []
  for (let i = 0; i < roles.length; i++)
    for (let j = i + 1; j < roles.length; j++) if (namesLookAlike(roles[i].name, roles[j].name)) out.push([roles[i], roles[j]])
  return out
}

export interface RoleNameCheck {
  error: string | null
  similar: Role[]
}

export function checkRoleName(name: string, roles: Role[], ignoreId?: string): RoleNameCheck {
  const n = name.trim()
  const others = roles.filter((r) => r.id !== ignoreId)
  if (!n) return { error: 'Informe o nome do cargo.', similar: [] }
  if (n.length < 3) return { error: 'Use pelo menos 3 letras.', similar: [] }
  if (n.length > 40) return { error: 'Use no máximo 40 caracteres.', similar: [] }
  const dup = others.find((r) => normalizeName(r.name) === normalizeName(n))
  if (dup) return { error: `Já existe o cargo "${dup.name}".`, similar: [] }
  return { error: null, similar: others.filter((r) => namesLookAlike(r.name, n)) }
}

/** Sugestão de nome mais claro para um cargo personalizado parecido com outro. */
export function suggestDistinctName(role: Role, roles: Role[]) {
  const presets: Record<string, string> = { adm: 'Operação geral', marketing: 'Marketing parceiro' }
  const base = presets[normalizeName(role.name)] ?? `${role.name} (personalizado)`
  let candidate = base
  let i = 2
  while (roles.some((r) => r.id !== role.id && normalizeName(r.name) === normalizeName(candidate))) candidate = `${base} ${i++}`
  return candidate
}

// ---------- Matriz de permissões ----------

export function permsOfPage(pageId: string): Permission[] {
  return PERMISSIONS.filter((p) => p.pageId === pageId)
}

export function permsOfModule(module: ModuleId): Permission[] {
  return PERMISSIONS.filter((p) => p.module === module)
}

/**
 * Liga/desliga uma permissão mantendo a matriz coerente:
 * editar ou especial exigem "ver"; tirar "ver" tira o resto da tela.
 */
export function togglePermission(perms: string[], key: string, on: boolean): string[] {
  const p = PERMISSION_BY_KEY.get(key)
  const set = new Set(perms)
  if (!p) return perms
  if (on) {
    set.add(key)
    if (p.kind !== 'ver') set.add(`${p.pageId}.ver`)
  } else {
    set.delete(key)
    if (p.kind === 'ver') for (const x of permsOfPage(p.pageId)) set.delete(x.key)
  }
  return PERMISSIONS.map((x) => x.key).filter((k) => set.has(k))
}

export function setManyPermissions(perms: string[], keys: string[], on: boolean): string[] {
  const set = new Set(perms)
  for (const k of keys) {
    if (on) set.add(k)
    else set.delete(k)
  }
  return PERMISSIONS.map((x) => x.key).filter((k) => set.has(k))
}

export function diffPermissions(before: string[], after: string[]) {
  const b = new Set(before)
  const a = new Set(after)
  return { added: after.filter((k) => !b.has(k)), removed: before.filter((k) => !a.has(k)) }
}

/** Contagem por módulo para o resumo do cargo. */
export function moduleCounts(role: Role) {
  return MODULES.map((m) => {
    const all = permsOfModule(m.id)
    const has = all.filter((p) => role.permissions.includes(p.key))
    return { module: m, total: all.length, granted: has.length, pages: PAGES.filter((pg) => pg.module === m.id).length }
  })
}

export const ROLE_COLOR_SLOT: Record<string, number> = {
  violet: 7,
  blue: 1,
  emerald: 3,
  pink: 5,
  sky: 1,
  amber: 4,
  rose: 8,
  orange: 2,
  green: 6,
}

export const ROLE_COLORS = ['violet', 'blue', 'emerald', 'pink', 'amber', 'rose', 'orange', 'green'] as const

export function roleColorVar(color: string) {
  return `var(--chart-${ROLE_COLOR_SLOT[color] ?? 7})`
}

// ---------- Auditoria ----------

/** Ações que contam como sensíveis no resumo da auditoria. */
export const SENSITIVE_ACTIONS: AuditAction[] = ['revelar', 'banir', 'desativar', 'ligar']

/** Resumo curto do acesso: "144 permissões · 15 sensíveis". */
export function accessSummary(role: Role) {
  const b = broadAccess(role)
  return `${role.permissions.length} permissões${b.sensitive.length ? ` · ${b.sensitive.length} sensíve${b.sensitive.length === 1 ? 'l' : 'is'}` : ''}`
}
