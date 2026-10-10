// Sessão do painel: quem está logado, com qual cargo, e o registro de auditoria.
// "Ver como cargo" permite testar o painel com as permissões de outro cargo.
//
// Modo demonstração: a pessoa logada e os cargos vêm do navegador, sem login.
// Modo API (VITE_API_MODE=1): login real. A sessão vem de GET /api/auth/session (o corpo de /me); as
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
import { flushSync } from 'react-dom'
import type { AuditEventRequest, MeResponse, SessionResponse } from '@shared/api'
import { panelAuditDecision } from '@shared/audit'
import { effectivePermissions } from '@shared/permissions'
import { seedAudit, seedTeam, type AuditAction, type AuditEntry, type TeamMember } from '@/data/team'
import { ApiError, api, isApiMode, lastApiResponseAt, onUnauthorized } from '@/lib/api'
import { dbGet, dbSet, prefetchKeys, refreshKey, resetDb, setReadPermissions, useDb } from '@/lib/store'
import {
  LOGIN_NOTICES,
  focusRecheckDue,
  hasSession,
  idleExpired,
  logoutFailureText,
  readAccessFor,
  requestLogout,
  resolveSession,
  sameStatus,
  setLogoutPending,
  transition,
  type AuthStatus,
  type FlagStorage,
  type SessionIo,
} from './auth-state'
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

// modo API: equipe, cargos e auditoria vêm só do servidor (sem leitura: lista vazia, nunca a demonstração)
const NO_TEAM: TeamMember[] = []
const NO_ROLES: Role[] = []
const NO_AUDIT: AuditEntry[] = []

export function useTeam() {
  return useDb<TeamMember[]>(KEYS.team, isApiMode() ? NO_TEAM : seedTeam)
}

export function useRoles() {
  return useDb<Role[]>(KEYS.roles, isApiMode() ? NO_ROLES : seedRoles)
}

export function useAudit() {
  return useDb<AuditEntry[]>(KEYS.audit, isApiMode() ? NO_AUDIT : seedAudit)
}

/**
 * Registra uma ação na auditoria (quem, quando, IP).
 *   audit('aprovar', 'Saque #SQ73001', 'Saque de R$ 500,00 aprovado')
 * No modo API vira POST /api/audit/events (quem, quando e IP vêm do servidor). Eventos que só o
 * servidor registra (login, decisões, telas gravadas por ele, como Manutenção) não são enviados:
 * o servidor já gravou a linha ao salvar, e o POST seria recusado.
 */
export function audit(action: AuditAction, entity: string, summary: string) {
  if (isApiMode()) {
    const body: AuditEventRequest = { action, entity: entity.slice(0, 200), summary: summary.slice(0, 1000) }
    // mesma regra do servidor (shared/audit.ts): o que ele recusaria nem sai do painel
    if (!panelAuditDecision(body.action, body.entity).ok) return
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

/**
 * "Ver como" um cargo: só cargos cujas permissões cabem nas da pessoa. Um cargo maior seria só o nome
 * (as permissões ficam limitadas às reais), e a tela diria "como Superadmin" sem as telas dele.
 */
export function canSimulate(real: Pick<Role, 'permissions'>, view: Pick<Role, 'permissions'>): boolean {
  const mine = new Set(real.permissions)
  // permissões que não existem mais (cargo antigo) não contam
  return effectivePermissions(view).every((p) => mine.has(p))
}

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
    const view = session.viewAsRoleId ? roles.find((r) => r.id === session.viewAsRoleId) : undefined
    const role = view && canSimulate(realRole, view) ? view : realRole
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

export type { AuthStatus, LoginReason } from './auth-state'

/** Códigos de recuperação recém-gerados, na tela até a pessoa confirmar que guardou. */
export interface RecoveryCodesView {
  email: string
  codes: string[]
}

export interface AuthApi {
  /** true no modo API */
  enabled: boolean
  status: AuthStatus
  /** dados de /api/auth/me (durante as etapas e com sessão ativa) */
  me: MeResponse | null
  /** relê /api/auth/me e segue para a etapa certa (use depois de cada passo do login) */
  reload: () => Promise<AuthStatus>
  /** depois de POST /api/auth/login: a sessão anterior deste navegador já foi encerrada pelo servidor */
  signedIn: () => Promise<AuthStatus>
  /**
   * Encerra a sessão no servidor, limpa os dados em memória e volta para a entrada.
   * Se o servidor não confirmar, a sessão continua na tela com um aviso de erro.
   */
  logout: () => Promise<void>
  /** códigos de recuperação em exibição (sobrevivem a releituras de /me) */
  recoveryCodes: RecoveryCodesView | null
  /** guarda os códigos recém-gerados: a tela deles fica até `releaseRecoveryCodes` */
  holdRecoveryCodes: (codes: string[]) => void
  /** a pessoa confirmou que guardou os códigos: segue para o painel */
  releaseRecoveryCodes: () => Promise<AuthStatus>
}

const DEMO_AUTH: AuthApi = {
  enabled: false,
  status: { kind: 'demo' },
  me: null,
  reload: async () => ({ kind: 'demo' }),
  signedIn: async () => ({ kind: 'demo' }),
  logout: async () => {
    toast.info('Sessão encerrada (demonstração)')
  },
  recoveryCodes: null,
  holdRecoveryCodes: () => {},
  releaseRecoveryCodes: async () => ({ kind: 'demo' }),
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

/** localStorage do navegador (null em modo privado sem armazenamento). */
function flagStorage(): FlagStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** /me, logout e a marca de saída pendente (a lógica fica em auth-state.ts) */
const SESSION_IO: SessionIo = {
  // /session responde 200 também sem sessão (a tela de entrada não gera erro no console) e diz por que a
  // sessão do cookie terminou; aqui vira o mesmo 401 de /me, com o motivo em details.reason
  getMe: async () => {
    const r = await api<SessionResponse>('GET', '/api/auth/session')
    if (r.session) return r.session
    throw new ApiError(401, 'nao_autenticado', 'Faça login para continuar.', r.ended ? { reason: r.ended } : undefined)
  },
  postLogout: () => api<void>('POST', '/api/auth/logout'),
  get storage() {
    return flagStorage()
  },
}

interface RecoveryHold extends RecoveryCodesView {
  userId: string
}

function ApiSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>({ kind: 'loading' })
  const statusRef = useRef<AuthStatus>(status)
  /** cada leitura de /me ganha um número; só a mais recente vale */
  const seq = useRef(0)
  const rechecking = useRef(false)
  const started = useRef(false)
  /** última leitura de /me (de qualquer origem): espaça as conferências ao voltar para a aba */
  const lastCheck = useRef(Date.now())
  const [hold, setHoldState] = useState<RecoveryHold | null>(null)
  const holdRef = useRef<RecoveryHold | null>(null)

  const setHold = useCallback((next: RecoveryHold | null) => {
    holdRef.current = next
    setHoldState(next)
  }, [])

  const apply = useCallback(
    (next: AuthStatus): AuthStatus => {
      const cur = statusRef.current
      // chaves que o cargo não lê nem são pedidas ao servidor (sem 403 no console); vale antes do prefetch
      // sem sessão ativa (saída, sessão caída, etapa do login): nada é lido do servidor
      if (!sameStatus(cur, next)) setReadPermissions(readAccessFor(next))
      // apaga a memória (outra pessoa, nova etapa de login, outro cargo) antes do prefetch e da renderização
      const result = transition(cur, next, SHELL_KEYS, { resetStore: (o) => resetDb(o), prefetch: prefetchKeys })
      if (result === cur) return cur
      // códigos de recuperação são da pessoa que os gerou: somem ao sair ou trocar de pessoa
      const h = holdRef.current
      if (h && (!hasSession(next) || next.me.user.id !== h.userId)) setHold(null)
      statusRef.current = next
      setStatus(next)
      return next
    },
    [setHold],
  )

  const reload = useCallback(async (): Promise<AuthStatus> => {
    const my = ++seq.current
    lastCheck.current = Date.now()
    const r = await resolveSession(() => statusRef.current, SESSION_IO)
    if (my !== seq.current) return statusRef.current
    if (r.loggedOut) toast.clear()
    if (r.expired) {
      // o aviso completo fica na tela de entrada; o toast só diz o motivo
      const notice = LOGIN_NOTICES[(r.next.kind === 'login' && r.next.reason) || 'expired']
      const show = notice.tone === 'danger' ? toast.error : notice.tone === 'success' ? toast.success : notice.tone === 'info' ? toast.info : toast.warning
      show(notice.title, { duration: 6000 })
    }
    return apply(r.next)
  }, [apply])

  const signedIn = useCallback(() => {
    // o login novo encerrou no servidor a sessão anterior deste navegador (inclusive uma saída pendente)
    setLogoutPending(SESSION_IO.storage, false)
    return reload()
  }, [reload])

  const logout = useCallback(async () => {
    const attempt = async (): Promise<void> => {
      seq.current++ // descarta leituras de /me em andamento
      const r = await requestLogout(SESSION_IO)
      if (r.ended) {
        toast.clear()
        // as telas do painel saem ANTES de o endereço mudar: senão o roteador (atualização síncrona) as
        // renderizaria de novo com a sessão já encerrada, e elas buscariam dados com o cookie morto (401)
        flushSync(() => {
          apply({ kind: 'login', reason: 'logout' })
        })
        // a próxima pessoa começa do início (a primeira tela do cargo dela), não na tela de quem saiu
        if (window.location.hash && window.location.hash !== '#/') window.location.hash = '#/'
        return
      }
      // o cookie é httpOnly: só o servidor encerra a sessão. A tela não diz que saiu; a próxima
      // leitura de /me (nesta ou em outra aba, ou ao reabrir o painel) tenta sair de novo.
      toast.error('Não foi possível sair', {
        description: logoutFailureText(r.error),
        action: { label: 'Tentar de novo', onClick: () => void attempt() },
        duration: 12_000,
      })
    }
    await attempt()
  }, [apply])

  const holdRecoveryCodes = useCallback(
    (codes: string[]) => {
      const cur = statusRef.current
      if (!hasSession(cur)) return
      setHold({ userId: cur.me.user.id, email: cur.me.user.email, codes })
    },
    [setHold],
  )

  const releaseRecoveryCodes = useCallback(async () => {
    // relê antes de soltar: a tela dos códigos só sai quando a próxima já está pronta
    const next = await reload()
    setHold(null)
    return next
  }, [reload, setHold])

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

  // inatividade: passou o tempo de Segurança do painel sem nenhuma resposta do servidor. O servidor já encerrou a
  // sessão; o painel confere e sai da tela (os dados não ficam à vista num computador sem ninguém).
  useEffect(() => {
    if (status.kind !== 'active') return
    const id = setInterval(() => {
      if (rechecking.current || holdRef.current) return
      if (!idleExpired({ status: statusRef.current, lastActivity: lastApiResponseAt(), now: Date.now() })) return
      rechecking.current = true
      void reload().finally(() => {
        rechecking.current = false
      })
    }, 15_000)
    return () => clearInterval(id)
  }, [status.kind, reload])

  // voltou para a aba: confere a sessão ativa (pode ter caído, ou o cargo mudou), no máximo a cada 30 s.
  // Nunca durante uma etapa do login nem com os códigos de recuperação na tela.
  useEffect(() => {
    const onVisible = () => {
      const due = focusRecheckDue({
        status: statusRef.current,
        visible: document.visibilityState === 'visible',
        busy: rechecking.current,
        held: holdRef.current !== null,
        lastCheck: lastCheck.current,
        now: Date.now(),
      })
      if (!due) return
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

  const value = useMemo<AuthApi>(
    () => ({
      enabled: true,
      status,
      me: hasSession(status) ? status.me : null,
      reload,
      signedIn,
      logout,
      recoveryCodes: hold ? { email: hold.email, codes: hold.codes } : null,
      holdRecoveryCodes,
      releaseRecoveryCodes,
    }),
    [status, reload, signedIn, logout, hold, holdRecoveryCodes, releaseRecoveryCodes],
  )

  let body: ReactNode
  if (hold || status.kind === 'login' || status.kind === 'step') {
    // códigos de recuperação na tela: ficam até a pessoa confirmar, qualquer que seja a etapa em /me
    body = (
      <Suspense fallback={<SplashScreen />}>
        <AuthFlow />
      </Suspense>
    )
  } else if (status.kind === 'active') {
    body = (
      <Suspense fallback={<SplashScreen label="Carregando seus dados" />}>
        <ApiActiveSession me={status.me}>{children}</ApiActiveSession>
      </Suspense>
    )
  } else if (status.kind === 'offline') {
    body = <OfflineScreen message={status.message} onRetry={reload} />
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
    const candidate = session.viewAsRoleId && session.viewAsRoleId !== realRole.id ? roles.find((r) => r.id === session.viewAsRoleId) : undefined
    // cargo maior que o real (preferência antiga deste navegador): ignora, como no menu
    const view = candidate && canSimulate(realRole, candidate) ? candidate : undefined
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
