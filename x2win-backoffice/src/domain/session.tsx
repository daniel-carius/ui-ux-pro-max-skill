// Sessão do painel: quem está logado, com qual cargo, e o registro de auditoria.
// "Ver como cargo" permite testar o painel com as permissões de outro cargo.
//
// Modo demonstração: a pessoa logada e os cargos vêm do navegador, sem login.
// Modo API (VITE_API_MODE=1): login real. A sessão vem de GET /api/auth/me; as
// permissões do servidor são a fonte da verdade ("Ver como cargo" só restringe).
import {
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { AuditEventRequest, MeResponse } from '@shared/api'
import { canReadKey, findKvRule } from '@shared/kv-registry'
import { seedAudit, seedTeam, type AuditAction, type AuditEntry, type TeamMember } from '@/data/team'
import { ApiError, api, isApiMode, onUnauthorized } from '@/lib/api'
import { dbGet, dbSet, prefetchKeys, refreshKey, resetDb, useDb } from '@/lib/store'
import { uid } from '@/lib/random'
import { PAGE_BY_ID } from '@/nav'
// imports diretos (e não de '@/components/ui') para não criar ciclo com ui/Page
import { toast } from '@/components/ui/Feedback'
import { OfflineScreen, SplashScreen } from '@/components/layout/Splash'
import { seedRoles, type Role } from './roles'

// telas de login (só carregadas no modo API)
const AuthFlow = lazy(() => import('@/pages/auth/AuthFlow'))

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
 * No modo API vira POST /api/audit/events (quem, quando e IP vêm do servidor).
 */
export function audit(action: AuditAction, entity: string, summary: string) {
  if (isApiMode()) {
    // login é registrado só pelo servidor
    if (action === 'login') return
    const body: AuditEventRequest = { action, entity: entity.slice(0, 200), summary: summary.slice(0, 1000) }
    void api<{ id: string }>('POST', '/api/audit/events', body)
      .then(() => refreshKey(KEYS.audit))
      .catch(() => {
        /* auditoria do painel é complementar: o servidor já audita as gravações */
      })
    return
  }
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

function buildSession(
  user: TeamMember,
  role: Role,
  realRole: Role,
  perms: ReadonlySet<string>,
  setSession: (next: (s: SessionState) => SessionState) => void,
): SessionValue {
  const can = (perm: string) => perms.has(perm)
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
}

export function SessionProvider({ children }: { children: ReactNode }) {
  // o modo é fixo no build: trocar de componente aqui não muda a ordem dos hooks
  return isApiMode() ? <ApiSessionProvider>{children}</ApiSessionProvider> : <DemoSessionProvider>{children}</DemoSessionProvider>
}

function DemoSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useDb<SessionState>(KEYS.session, DEFAULT_SESSION)
  const [team] = useTeam()
  const [roles] = useRoles()

  const value = useMemo<SessionValue>(() => {
    const user = team.find((m) => m.id === session.userId) ?? team[0]
    const realRole = roles.find((r) => r.id === user.roleId) ?? roles[0]
    const role = (session.viewAsRoleId && roles.find((r) => r.id === session.viewAsRoleId)) || realRole
    return buildSession(user, role, realRole, new Set(role.permissions), setSession)
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

// ---------------------------------------------------------------------------
// Modo API: login, etapas e sessão real
// ---------------------------------------------------------------------------

/** Por que a tela de entrada apareceu (mostra um aviso no topo do formulário). */
export type LoginReason = 'expired' | 'logout' | 'ip'

export type AuthStatus =
  /** modo demonstração: não há login */
  | { kind: 'demo' }
  | { kind: 'loading' }
  /** sem conexão ao abrir o painel */
  | { kind: 'offline'; message: string }
  | { kind: 'login'; reason?: LoginReason }
  /** login começou, falta uma etapa (troca de senha, cadastro do 2FA ou código) */
  | { kind: 'step'; me: MeResponse }
  | { kind: 'active'; me: MeResponse }

export interface AuthApi {
  /** true no modo API */
  enabled: boolean
  status: AuthStatus
  /** dados de /api/auth/me (durante as etapas e com sessão ativa) */
  me: MeResponse | null
  /** relê /api/auth/me e segue para a etapa certa (use depois de cada passo do login) */
  reload: () => Promise<AuthStatus>
  /** encerra a sessão no servidor, limpa os dados em memória e volta para a entrada */
  logout: () => Promise<void>
}

const DEMO_AUTH: AuthApi = {
  enabled: false,
  status: { kind: 'demo' },
  me: null,
  reload: async () => ({ kind: 'demo' }),
  logout: async () => {
    toast.info('Sessão encerrada (demonstração)')
  },
}

const AuthContext = createContext<AuthApi | null>(null)

/**
 * Login e sessão do modo API.
 *   const { enabled, me, logout } = useAuthApi()
 * No modo demonstração, `enabled` é false e `logout` só mostra um aviso.
 */
export function useAuthApi(): AuthApi {
  return useContext(AuthContext) ?? DEMO_AUTH
}

/** Chaves que o menu, a barra do topo e a sessão leem: buscadas em paralelo ao entrar. */
const SHELL_KEYS = [
  KEYS.roles,
  KEYS.team,
  'operacao.saques',
  'config.seguranca-painel',
  'config.faturas',
  'seguranca.modo-ataque',
  'config.manutencao',
]

function sameStatus(a: AuthStatus, b: AuthStatus) {
  if (a.kind !== b.kind) return false
  if ((a.kind === 'step' || a.kind === 'active') && (b.kind === 'step' || b.kind === 'active')) return JSON.stringify(a.me) === JSON.stringify(b.me)
  if (a.kind === 'login' && b.kind === 'login') return a.reason === b.reason
  if (a.kind === 'offline' && b.kind === 'offline') return a.message === b.message
  return true
}

function hasSession(s: AuthStatus) {
  return s.kind === 'active' || s.kind === 'step'
}

function ApiSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>({ kind: 'loading' })
  const statusRef = useRef<AuthStatus>(status)
  /** cada leitura de /me ganha um número; só a mais recente vale */
  const seq = useRef(0)
  const rechecking = useRef(false)
  const started = useRef(false)

  const apply = useCallback((next: AuthStatus): AuthStatus => {
    const cur = statusRef.current
    // mesma etapa e mesmos dados: mantém o estado (não reinicia formulários)
    if (sameStatus(cur, next)) return cur
    if (next.kind === 'active') {
      const perms = new Set(next.me.permissions ?? [])
      prefetchKeys(SHELL_KEYS.filter((k) => {
        const rule = findKvRule(k)
        return !!rule && canReadKey(rule, perms)
      }))
    }
    statusRef.current = next
    setStatus(next)
    return next
  }, [])

  const reload = useCallback(async (): Promise<AuthStatus> => {
    const my = ++seq.current
    try {
      const me = await api<MeResponse>('GET', '/api/auth/me')
      if (my !== seq.current) return statusRef.current
      return apply(me.stage === 'active' ? { kind: 'active', me } : { kind: 'step', me })
    } catch (e) {
      if (my !== seq.current) return statusRef.current
      const err = e instanceof ApiError ? e : null
      const cur = statusRef.current
      if (err?.status === 401) {
        if (hasSession(cur)) toast.warning('Sua sessão expirou', { description: 'Entre de novo para continuar de onde parou.', duration: 6000 })
        return apply({ kind: 'login', reason: hasSession(cur) ? 'expired' : cur.kind === 'login' ? cur.reason : undefined })
      }
      if (err?.status === 403 && err.code === 'ip_nao_autorizado') return apply({ kind: 'login', reason: 'ip' })
      // falha de rede com a sessão aberta: segue como está (a próxima chamada tenta de novo)
      if (hasSession(cur)) return cur
      return apply({ kind: 'offline', message: err?.message ?? 'Não foi possível falar com o servidor.' })
    }
  }, [apply])

  const logout = useCallback(async () => {
    seq.current++ // descarta leituras de /me em andamento
    try {
      await api<void>('POST', '/api/auth/logout')
    } catch {
      /* sai mesmo assim: o cookie expira sozinho */
    }
    toast.clear()
    apply({ kind: 'login', reason: 'logout' })
  }, [apply])

  // abre a sessão (uma vez, mesmo com StrictMode)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void reload()
  }, [reload])

  // 401 em qualquer chamada: confere /me (a sessão pode ter caído ou ser só uma senha errada)
  useEffect(() => {
    const off = onUnauthorized(() => {
      if (!hasSession(statusRef.current) || rechecking.current) return
      rechecking.current = true
      void reload().finally(() => {
        rechecking.current = false
      })
    })
    return () => {
      off()
    }
  }, [reload])

  // voltou para a aba: confere a sessão (pode ter caído, ou o cargo mudou), no máximo a cada 30 s
  useEffect(() => {
    let last = Date.now()
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !hasSession(statusRef.current) || rechecking.current) return
      if (Date.now() - last < 30_000) return
      last = Date.now()
      rechecking.current = true
      void reload().finally(() => {
        rechecking.current = false
      })
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [reload])

  // saiu da sessão (ou trocou de pessoa): nada da sessão anterior fica em memória
  const prev = useRef<AuthStatus>(status)
  useEffect(() => {
    const was = prev.current
    prev.current = status
    const leftSession = hasSession(was) && !hasSession(status)
    const otherUser = was.kind === 'active' && status.kind === 'active' && was.me.user.id !== status.me.user.id
    if (leftSession || otherUser) resetDb()
  }, [status])

  const value = useMemo<AuthApi>(
    () => ({ enabled: true, status, me: hasSession(status) ? (status as { me: MeResponse }).me : null, reload, logout }),
    [status, reload, logout],
  )

  let body: ReactNode
  if (status.kind === 'active') {
    body = (
      <Suspense fallback={<SplashScreen label="Carregando seus dados" />}>
        <ApiActiveSession me={status.me}>{children}</ApiActiveSession>
      </Suspense>
    )
  } else if (status.kind === 'offline') {
    body = <OfflineScreen message={status.message} onRetry={reload} />
  } else if (status.kind === 'login' || status.kind === 'step') {
    body = (
      <Suspense fallback={<SplashScreen />}>
        <AuthFlow />
      </Suspense>
    )
  } else {
    body = <SplashScreen />
  }
  return <AuthContext.Provider value={value}>{body}</AuthContext.Provider>
}

/** Teto de aprovação mais restritivo (null = sem teto; 0 = não aprova). */
function minCeiling(a: number | null, b: number | null) {
  if (a === null) return b
  if (b === null) return a
  return Math.min(a, b)
}

function ApiActiveSession({ me, children }: { me: MeResponse; children: ReactNode }) {
  // preferência local ("Ver como cargo"); a pessoa logada vem do servidor
  const [session, setSession] = useDb<SessionState>(KEYS.session, DEFAULT_SESSION)
  const [roles] = useRoles()

  const value = useMemo<SessionValue>(() => {
    const serverPerms = new Set(me.permissions ?? [])
    const base: Role = me.role ?? {
      id: me.user.roleId,
      name: me.user.roleId,
      description: '',
      system: false,
      permissions: [],
      require2fa: false,
      approvalCeiling: 0,
      color: 'violet',
    }
    const realRole: Role = { ...base, permissions: [...serverPerms] }
    const view = session.viewAsRoleId && session.viewAsRoleId !== realRole.id ? roles.find((r) => r.id === session.viewAsRoleId) : undefined
    // "Ver como" só restringe: nunca passa das permissões dadas pelo servidor
    const perms = view ? new Set(view.permissions.filter((p) => serverPerms.has(p))) : serverPerms
    const role: Role = view
      ? { ...view, permissions: [...perms], approvalCeiling: minCeiling(realRole.approvalCeiling, view.approvalCeiling) }
      : realRole
    const user: TeamMember = {
      id: me.user.id,
      name: me.user.name,
      email: me.user.email,
      roleId: me.user.roleId,
      status: 'ativo',
      twoFactor: me.user.twoFactor,
      lastAccess: me.user.lastAccess,
      lastIp: null,
      createdAt: me.user.lastAccess ?? new Date().toISOString(),
      activeSessions: 1,
    }
    return buildSession(user, role, realRole, perms, setSession)
  }, [me, session.viewAsRoleId, roles, setSession])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
