// Regras da sessão do modo API, sem React e sem navegador: o ApiSessionProvider
// (session.tsx) usa estas funções e os testes rodam no Node
// (server/test/front-security.test.ts).
import type { MeResponse } from '@shared/api'
import { canReadKey, findKvRule } from '@shared/kv-registry'

/** Por que a tela de entrada apareceu (mostra um aviso no topo do formulário). */
export type LoginReason = 'expired' | 'logout' | 'ip'

export type AuthStatus =
  /** modo demonstração: não há login */
  | { kind: 'demo' }
  | { kind: 'loading' }
  /** sem conexão ao abrir o painel (ou saída anterior não concluída no servidor) */
  | { kind: 'offline'; message: string }
  | { kind: 'login'; reason?: LoginReason }
  /** login começou, falta uma etapa (troca de senha, cadastro do 2FA ou código) */
  | { kind: 'step'; me: MeResponse }
  | { kind: 'active'; me: MeResponse }

export type SessionStatus = Extract<AuthStatus, { me: MeResponse }>

export function hasSession(s: AuthStatus): s is SessionStatus {
  return s.kind === 'active' || s.kind === 'step'
}

export function sameStatus(a: AuthStatus, b: AuthStatus) {
  if (a.kind !== b.kind) return false
  if (hasSession(a) && hasSession(b)) return JSON.stringify(a.me) === JSON.stringify(b.me)
  if (a.kind === 'login' && b.kind === 'login') return a.reason === b.reason
  if (a.kind === 'offline' && b.kind === 'offline') return a.message === b.message
  return true
}

function sessionUserId(s: AuthStatus): string | null {
  return hasSession(s) ? s.me.user.id : null
}

/** Mesmo cargo e mesmas permissões (a ordem da lista não importa). */
function sameAccess(a: MeResponse, b: MeResponse) {
  if ((a.role?.id ?? a.user.roleId) !== (b.role?.id ?? b.user.roleId)) return false
  const pa = [...(a.permissions ?? [])].sort()
  const pb = [...(b.permissions ?? [])].sort()
  return pa.length === pb.length && pa.every((p, i) => p === pb[i])
}

/**
 * A troca de estado exige apagar os dados em memória (store.ts)?
 * Os dados foram lidos do servidor com a sessão, o cargo e as máscaras de quem
 * estava logado; nada disso pode passar para a próxima pessoa, nem para a mesma
 * pessoa com outro cargo. Decide pela identidade, qualquer que seja a etapa.
 */
export function mustResetStore(cur: AuthStatus, next: AuthStatus): boolean {
  const curId = sessionUserId(cur)
  // saiu da sessão (logout, expirou, IP) ou é outra pessoa, em qualquer etapa (step ou active)
  if (curId !== null && curId !== sessionUserId(next)) return true
  // voltou para uma etapa do login (re-login em outra aba): é uma sessão nova
  if (cur.kind === 'active' && next.kind === 'step') return true
  // cargo ou permissões mudaram (conferência ao voltar para a aba): o que foi lido com as permissões antigas sai
  if (cur.kind === 'active' && next.kind === 'active' && !sameAccess(cur.me, next.me)) return true
  return false
}

export interface StoreResetOptions {
  /** avisa as telas abertas para relerem (só quando elas continuam montadas, com a sessão nova já ativa) */
  notify: boolean
  /** descarta só os dados do servidor e mantém as preferências locais do navegador */
  serverDataOnly: boolean
}

export interface TransitionEffects {
  /** apaga os dados em memória (resetDb) */
  resetStore: (opts: StoreResetOptions) => void
  /** busca chaves em paralelo (prefetchKeys) */
  prefetch: (keys: string[]) => void
}

/**
 * Aplica a troca de estado: devolve o estado que vale. Apaga a memória ANTES de
 * qualquer leitura nova (prefetch e renderização), para nada da sessão anterior
 * aparecer na tela nem servir de cache para a próxima.
 */
export function transition(cur: AuthStatus, next: AuthStatus, shellKeys: readonly string[], fx: TransitionEffects): AuthStatus {
  // mesma etapa e mesmos dados: mantém o estado (não reinicia formulários)
  if (sameStatus(cur, next)) return cur
  if (mustResetStore(cur, next)) {
    // painel → painel (outra pessoa ou outro cargo): as telas continuam montadas e releem com a sessão nova.
    // Indo para a entrada ou uma etapa do login, as telas do painel saem: não releem com a sessão de transição.
    fx.resetStore({ notify: next.kind === 'active', serverDataOnly: false })
  } else if (next.kind === 'active' && cur.kind !== 'active') {
    // toda sessão aberta começa sem dados do servidor em memória: nada lido antes (outra sessão, ou
    // durante a entrada/etapa, com 401/403) serve de cache. As preferências locais ficam.
    fx.resetStore({ notify: false, serverDataOnly: true })
  }
  if (next.kind === 'active') {
    const perms = new Set(next.me.permissions ?? [])
    fx.prefetch(
      shellKeys.filter((k) => {
        const rule = findKvRule(k)
        return !!rule && canReadKey(rule, perms)
      }),
    )
  }
  return next
}

/** Intervalo mínimo entre conferências de /me ao voltar para a aba. */
export const FOCUS_RECHECK_MS = 30_000

/**
 * Conferir /me agora (a aba voltou a ficar visível ou ganhou foco)?
 * Só com a sessão ativa: durante uma etapa do login a tela é da própria etapa,
 * e uma troca por baixo apagaria o que a pessoa está fazendo (ex.: códigos de
 * recuperação na tela). `lastCheck` é a última leitura de /me, de qualquer origem.
 */
export function focusRecheckDue(o: { status: AuthStatus; visible: boolean; busy: boolean; held: boolean; lastCheck: number; now: number }) {
  return o.visible && o.status.kind === 'active' && !o.busy && !o.held && o.now - o.lastCheck >= FOCUS_RECHECK_MS
}

function statusOf(e: unknown): number | null {
  const s = (e as { status?: unknown } | null)?.status
  return typeof s === 'number' ? s : null
}

function codeOf(e: unknown): string | null {
  const c = (e as { code?: unknown } | null)?.code
  return typeof c === 'string' ? c : null
}

export type LogoutResult = { ended: true } | { ended: false; error: unknown }

/**
 * Encerra a sessão no servidor. Só conta como encerrada com a confirmação:
 * 2xx (204) ou 401 (a sessão já não existia). Qualquer outra falha (rede, 5xx,
 * 403 de IP) deixa a sessão valendo no servidor e precisa ser dita à pessoa.
 */
export async function endServerSession(post: () => Promise<unknown>): Promise<LogoutResult> {
  try {
    await post()
    return { ended: true }
  } catch (error) {
    if (statusOf(error) === 401) return { ended: true }
    return { ended: false, error }
  }
}

/** Texto para a pessoa quando a saída não foi confirmada pelo servidor. */
export function logoutFailureText(error: unknown): string {
  if (statusOf(error) === 403 && codeOf(error) === 'ip_nao_autorizado') {
    return 'O servidor recusou o pedido porque o seu IP não tem acesso ao painel. A sessão continua aberta: conecte-se pela rede do escritório ou pela VPN e saia de novo.'
  }
  if (statusOf(error) === 0) return 'Sem conexão com o servidor. A sessão continua aberta: confira a internet e saia de novo.'
  return 'O servidor não confirmou a saída e a sessão continua aberta. Tente sair de novo.'
}

/**
 * Saída pedida e ainda não confirmada pelo servidor. Fica no localStorage (vale
 * para todas as abas e sobrevive a fechar a aba): a próxima leitura de /me
 * tenta encerrar a sessão de novo antes de confiar nela.
 */
export const LOGOUT_PENDING_KEY = 'x2w.auth.saida-pendente'

export interface FlagStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export function isLogoutPending(storage: FlagStorage | null): boolean {
  try {
    return storage?.getItem(LOGOUT_PENDING_KEY) === '1'
  } catch {
    return false
  }
}

export function setLogoutPending(storage: FlagStorage | null, on: boolean) {
  try {
    if (on) storage?.setItem(LOGOUT_PENDING_KEY, '1')
    else storage?.removeItem(LOGOUT_PENDING_KEY)
  } catch {
    /* sem armazenamento (modo privado): a saída falhada já foi avisada na tela */
  }
}

/** Entrada e saída da sessão no servidor (no painel: api() e o localStorage). */
export interface SessionIo {
  getMe: () => Promise<MeResponse>
  postLogout: () => Promise<unknown>
  storage: FlagStorage | null
}

/**
 * Sair: marca a saída como pendente, pede ao servidor e só desmarca com a
 * confirmação. Sem confirmação, a tela NÃO pode dizer que saiu.
 */
export async function requestLogout(io: Pick<SessionIo, 'postLogout' | 'storage'>): Promise<LogoutResult> {
  setLogoutPending(io.storage, true)
  const r = await endServerSession(io.postLogout)
  if (r.ended) setLogoutPending(io.storage, false)
  return r
}

export const PENDING_LOGOUT_MESSAGE =
  'A sua última saída não foi confirmada pelo servidor e a sessão pode continuar aberta. Tente de novo para encerrá-la antes de entrar.'

export interface ResolvedSession {
  next: AuthStatus
  /** a sessão que estava aberta caiu (avisar) */
  expired?: boolean
  /** uma saída pendente foi concluída agora */
  loggedOut?: boolean
}

/**
 * Lê a sessão do servidor e decide o próximo estado. `current` devolve o estado
 * na tela no momento da resposta. Com uma saída pendente, tenta sair de novo
 * antes e nunca abre o painel com a sessão que a pessoa pediu para encerrar.
 */
export async function resolveSession(current: () => AuthStatus, io: SessionIo): Promise<ResolvedSession> {
  const pendingLogout = isLogoutPending(io.storage)
  if (pendingLogout) {
    const r = await endServerSession(io.postLogout)
    if (r.ended) {
      setLogoutPending(io.storage, false)
      return { next: { kind: 'login', reason: 'logout' }, loggedOut: true }
    }
  }
  try {
    const me = await io.getMe()
    if (pendingLogout) {
      // a sessão segue valendo no servidor: mantém a tela como está, ou não abre o painel com ela
      const cur = current()
      return { next: hasSession(cur) ? cur : { kind: 'offline', message: PENDING_LOGOUT_MESSAGE } }
    }
    return { next: me.stage === 'active' ? { kind: 'active', me } : { kind: 'step', me } }
  } catch (e) {
    const cur = current()
    const status = statusOf(e)
    if (status === 401) {
      // a sessão já não existe: a saída pendente está concluída
      if (pendingLogout) {
        setLogoutPending(io.storage, false)
        return { next: { kind: 'login', reason: 'logout' }, loggedOut: true }
      }
      const open = hasSession(cur)
      return { next: { kind: 'login', reason: open ? 'expired' : cur.kind === 'login' ? cur.reason : undefined }, expired: open }
    }
    if (status === 403 && codeOf(e) === 'ip_nao_autorizado') return { next: { kind: 'login', reason: 'ip' } }
    // falha de rede com a sessão aberta: segue como está (a próxima chamada tenta de novo)
    if (hasSession(cur)) return { next: cur }
    const message = status !== null ? (e as { message?: unknown }).message : null
    return {
      next: {
        kind: 'offline',
        message: pendingLogout ? PENDING_LOGOUT_MESSAGE : typeof message === 'string' && message ? message : 'Não foi possível falar com o servidor.',
      },
    }
  }
}
