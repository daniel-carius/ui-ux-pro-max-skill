// Regras da sessão do modo API, sem React e sem navegador: o ApiSessionProvider
// (session.tsx) usa estas funções e os testes rodam no Node
// (server/test/front-security.test.ts).
import { SESSION_END_REASONS, type MeResponse, type SessionEndReason } from '@shared/api'
import { canReadKey, findKvRule } from '@shared/kv-registry'

/**
 * Por que a tela de entrada apareceu (mostra um aviso no topo do formulário). 'expired' = a sessão caiu e o
 * servidor não disse o motivo; os demais motivos de fim de sessão vêm do servidor (SessionEndReason).
 */
export type LoginReason = 'expired' | 'logout' | 'ip' | SessionEndReason

export interface LoginNotice {
  tone: 'info' | 'success' | 'warning' | 'danger'
  title: string
  text: string
}

/** Aviso da tela de entrada (e do toast) para cada motivo: a pessoa sabe por que saiu. */
export const LOGIN_NOTICES: Record<LoginReason, LoginNotice> = {
  expired: { tone: 'info', title: 'Sua sessão expirou', text: 'Entre de novo para continuar de onde parou.' },
  inatividade: {
    tone: 'info',
    title: 'Sua sessão expirou',
    text: 'Por segurança, a sessão cai depois de um tempo sem uso (definido em Segurança do painel). Entre de novo para continuar.',
  },
  expirada: { tone: 'info', title: 'Sua sessão expirou', text: 'A sessão chegou ao tempo máximo de validade (12 horas). Entre de novo para continuar.' },
  logout: { tone: 'success', title: 'Você saiu do painel', text: 'Para voltar, entre com o seu e-mail e a sua senha.' },
  saida: { tone: 'success', title: 'Você saiu do painel', text: 'A sessão foi encerrada (talvez em outra aba). Para voltar, entre com o seu e-mail e a sua senha.' },
  outro_login: { tone: 'info', title: 'Sessão substituída', text: 'Houve uma entrada nova neste navegador, e a sessão anterior foi encerrada.' },
  senha_trocada: {
    tone: 'warning',
    title: 'Sua senha foi trocada em outra sessão',
    text: 'Por segurança, as outras sessões abertas foram encerradas. Entre com a senha nova. Se não foi você, avise um administrador agora.',
  },
  senha_redefinida: {
    tone: 'warning',
    title: 'Um administrador gerou uma senha temporária para você',
    text: 'As sessões abertas foram encerradas. Entre com a senha temporária que recebeu; em seguida você cria uma senha só sua.',
  },
  desativado: { tone: 'danger', title: 'Seu acesso foi desativado', text: 'Um administrador desativou o seu acesso ao painel. Fale com ele se precisar voltar.' },
  '2fa_exigido': {
    tone: 'warning',
    title: 'Seu cargo passou a exigir 2FA',
    text: 'A sessão aberta sem 2FA foi encerrada. Entre de novo com o celular em mãos para cadastrar o aplicativo autenticador.',
  },
  '2fa_exigido_todos': {
    tone: 'warning',
    title: 'O painel passou a exigir 2FA de toda a equipe',
    text: 'Um administrador ligou "Exigir 2FA de todos" em Segurança do painel, e a sessão aberta sem 2FA foi encerrada. Entre de novo com o celular em mãos para cadastrar o aplicativo autenticador.',
  },
  '2fa_redefinido': {
    tone: 'warning',
    title: 'Seu 2FA foi redefinido',
    text: 'Um administrador redefiniu o seu 2FA e as sessões foram encerradas. Entre de novo; se o cargo exigir, você cadastra o aplicativo outra vez.',
  },
  '2fa_ligado': {
    tone: 'info',
    title: 'O 2FA foi ligado na sua conta',
    text: 'Ele foi ativado em outra sessão, e as sessões abertas sem ele foram encerradas. Entre de novo com o código do aplicativo.',
  },
  bloqueio: {
    tone: 'danger',
    title: 'Acesso bloqueado por segurança',
    text: 'Foram muitas tentativas erradas da senha atual ou do código com a sessão aberta. A sessão foi encerrada e o acesso fica bloqueado por 15 minutos.',
  },
  ip: {
    tone: 'danger',
    title: 'Seu IP não tem acesso ao painel',
    text: 'O painel só aceita entradas dos endereços cadastrados em Segurança do painel. Conecte-se pela rede do escritório ou pela VPN, ou peça a um administrador para liberar o seu IP.',
  },
}

/** Motivo do fim da sessão que o servidor mandou no 401 (details.reason); null se ausente ou desconhecido. */
export function endReasonOf(e: unknown): SessionEndReason | null {
  const r = ((e as { details?: unknown } | null)?.details as { reason?: unknown } | undefined)?.reason
  return typeof r === 'string' && (SESSION_END_REASONS as readonly string[]).includes(r) ? (r as SessionEndReason) : null
}

/** Folga depois do tempo de inatividade antes de conferir: o servidor já encerrou a sessão (nunca a renova). */
export const IDLE_MARGIN_MS = 5_000

/**
 * A sessão ativa passou do tempo sem uso? `lastActivity` é a última resposta do servidor: o servidor conta a
 * inatividade pela última requisição (atualizada no máximo a cada minuto), então na hora desta conferência ele já
 * encerrou a sessão e a leitura de /session só confirma (não a renova). Sem isso, o painel ficava aberto, com os
 * dados na tela, até o próximo clique.
 */
export function idleExpired(o: { status: AuthStatus; lastActivity: number; now: number }): boolean {
  if (o.status.kind !== 'active') return false
  const minutes = o.status.me.sessionTimeoutMinutes
  if (!minutes || minutes <= 0) return false
  return o.now - o.lastActivity > minutes * 60_000 + IDLE_MARGIN_MS
}

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

/**
 * O que o store (src/lib/store.ts, setReadPermissions) pode ler do servidor em cada estado: com a sessão ativa,
 * as chaves que o cargo lê; sem ela (saída, sessão caída, etapa do login, sem conexão), nenhuma. Uma tela que
 * ainda renderiza na saída não busca nada com o cookie morto (antes: 401 no console a cada "Sair").
 */
export function readAccessFor(s: AuthStatus): ReadonlySet<string> | 'sem-sessao' {
  return s.kind === 'active' ? new Set(s.me.permissions ?? []) : 'sem-sessao'
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
 * 403) deixa a sessão valendo no servidor e precisa ser dita à pessoa.
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

/**
 * Texto para a pessoa quando a saída não foi confirmada pelo servidor. A saída não depende
 * da lista de IPs do painel (o servidor aceita de qualquer rede): sem conexão ou qualquer
 * outra recusa, a mensagem é uma só.
 */
export function logoutFailureText(error: unknown): string {
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
      // motivo do servidor (inatividade, senha trocada, acesso desativado...): a tela diz por que a sessão caiu
      const ended = endReasonOf(e)
      const reason: LoginReason | undefined = open
        ? (ended ?? 'expired')
        : (ended && ended !== 'outro_login' ? ended : cur.kind === 'login' ? cur.reason : undefined)
      return { next: { kind: 'login', reason }, expired: open }
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
