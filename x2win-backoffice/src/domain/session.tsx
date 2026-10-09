// Sessão do painel: quem está logado, com qual cargo, e o registro de auditoria.
// "Ver como cargo" permite testar o painel com as permissões de outro cargo.
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { seedAudit, seedTeam, type AuditAction, type AuditEntry, type TeamMember } from '@/data/team'
import { dbGet, dbSet, useDb } from '@/lib/store'
import { uid } from '@/lib/random'
import { PAGE_BY_ID } from '@/nav'
import { seedRoles, type Role } from './roles'

export const SESSION_IP = '189.45.12.207'

export const KEYS = {
  team: 'equipe.membros',
  roles: 'cargos.lista',
  audit: 'auditoria.registros',
  session: 'sessao.atual',
} as const

interface SessionState {
  userId: string
  /** cargo simulado (null = cargo real da pessoa) */
  viewAsRoleId: string | null
}

const DEFAULT_SESSION: SessionState = { userId: 'u1', viewAsRoleId: null }

export function useTeam() {
  return useDb<TeamMember[]>(KEYS.team, seedTeam)
}

export function useRoles() {
  return useDb<Role[]>(KEYS.roles, seedRoles)
}

export function useAudit() {
  return useDb<AuditEntry[]>(KEYS.audit, seedAudit)
}

/**
 * Registra uma ação na auditoria (quem, quando, IP).
 *   audit('aprovar', 'Saque #SQ73001', 'Saque de R$ 500,00 aprovado')
 */
export function audit(action: AuditAction, entity: string, summary: string) {
  const session = dbGet<SessionState>(KEYS.session, DEFAULT_SESSION)
  const team = dbGet<TeamMember[]>(KEYS.team, seedTeam)
  const me = team.find((m) => m.id === session.userId) ?? team[0]
  const entry: AuditEntry = {
    id: uid('au'),
    at: new Date().toISOString(),
    actorId: me.id,
    actorName: me.name,
    action,
    entity,
    summary,
    ip: SESSION_IP,
  }
  dbSet<AuditEntry[]>(KEYS.audit, (prev) => [entry, ...prev], seedAudit)
}

interface SessionValue {
  user: TeamMember
  /** cargo efetivo (simulado ou real) */
  role: Role
  realRole: Role
  isSimulating: boolean
  can: (permission: string) => boolean
  canView: (pageId: string) => boolean
  canEdit: (pageId: string) => boolean
  setViewAs: (roleId: string | null) => void
  setUser: (userId: string) => void
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useDb<SessionState>(KEYS.session, DEFAULT_SESSION)
  const [team] = useTeam()
  const [roles] = useRoles()

  const value = useMemo<SessionValue>(() => {
    const user = team.find((m) => m.id === session.userId) ?? team[0]
    const realRole = roles.find((r) => r.id === user.roleId) ?? roles[0]
    const role = (session.viewAsRoleId && roles.find((r) => r.id === session.viewAsRoleId)) || realRole
    const set = new Set(role.permissions)
    const can = (perm: string) => set.has(perm)
    return {
      user,
      role,
      realRole,
      isSimulating: role.id !== realRole.id,
      can,
      canView: (pageId) => can(`${pageId}.ver`) || can(`${pageId}.editar`),
      canEdit: (pageId) => {
        const page = PAGE_BY_ID.get(pageId)
        return !!page?.editable && can(`${pageId}.editar`)
      },
      setViewAs: (roleId) => setSession((s) => ({ ...s, viewAsRoleId: roleId })),
      setUser: (userId) => setSession((s) => ({ ...s, userId })),
    }
  }, [session, team, roles, setSession])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession fora do SessionProvider')
  return ctx
}

// Contexto da tela atual: permite que qualquer componente saiba se pode editar.
const PageContext = createContext<string | null>(null)
export const PageIdProvider = PageContext.Provider

/**
 * Permissões da tela atual.
 *   const { canEdit } = usePageAccess()
 */
export function usePageAccess() {
  const pageId = useContext(PageContext)
  const { canView, canEdit, can } = useSession()
  return {
    pageId,
    canView: pageId ? canView(pageId) : true,
    canEdit: pageId ? canEdit(pageId) : false,
    can,
  }
}
