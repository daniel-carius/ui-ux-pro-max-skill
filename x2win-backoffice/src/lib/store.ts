// Armazenamento que simula o back-end: cada chave guarda uma coleção ou
// um objeto de configuração.
//
// Modo demonstração (padrão): os dados de demonstração (seed) só são gravados
// no localStorage quando alguém altera algo, para não lotar o navegador.
//
// Modo API (VITE_API_MODE=1): a primeira leitura de uma chave busca
// GET /api/kv/:key (a tela espera com o esqueleto de carregamento via Suspense);
// gravações são otimistas, com PUT + versão, enfileiradas por chave. Chaves
// locais (preferências de tela e rascunhos, ver shared/kv-registry.ts) continuam
// no localStorage, como no modo demonstração.
//
// Sem valor do servidor (chave nunca gravada, leitura que falhou ou cargo sem
// leitura), o modo API nunca mostra os dados de demonstração como se fossem do
// servidor: lista de registros vira [] e objeto de configuração usa o padrão da
// tela (ou o valor registrado pelo gerador, ver apiValue em src/data/demo.ts).
// Chave nunca gravada guarda a versão 0 e a primeira gravação a envia (se outra
// pessoa gravou antes, o servidor responde 409). Se a leitura falhar (rede, 5xx,
// 429), a chave fica só para leitura até carregar de novo (isLoadFailed/useLoadFailed):
// uma gravação é recusada e dispara outra leitura; nada é decidido sobre o padrão.

import { useCallback, useSyncExternalStore } from 'react'
import type { KvGetResponse, KvPutResponse } from '@shared/api'
import { canReadKey, findKvRule, isLocalOnlyKey } from '@shared/kv-registry'
// import direto (e não de '@/components/ui') para não criar ciclo: ui/Page usa este arquivo
import { toast } from '@/components/ui/Feedback'
import { apiValueOf } from '@/data/demo'
import { ApiError, api, isApiMode, isVersionConflict } from './api'

const PREFIX = 'x2w.db.v1.'
const cache = new Map<string, unknown>()
const listeners = new Map<string, Set<() => void>>()
const allListeners = new Set<() => void>()

const API = isApiMode()

function read<T>(key: string, seed: T | (() => T)): T {
  if (import.meta.env.DEV) ((window as unknown as { __X2W_KEYS__?: Set<string> }).__X2W_KEYS__ ??= new Set()).add(key)
  if (cache.has(key)) return cache.get(key) as T
  if (isRemote(key)) return remoteRead(key, seed)
  let value: T | undefined
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw != null) value = JSON.parse(raw) as T
  } catch {
    value = undefined
  }
  if (value === undefined) value = typeof seed === 'function' ? (seed as () => T)() : seed
  cache.set(key, value)
  return value
}

function emit(key: string) {
  listeners.get(key)?.forEach((l) => l())
  allListeners.forEach((l) => l())
}

export function dbGet<T>(key: string, seed: T | (() => T)): T {
  return read(key, seed)
}

export function dbSet<T>(key: string, next: T | ((prev: T) => T), seed?: T | (() => T)) {
  if (isRemote(key)) {
    void remoteSet(key, next, seed)
    return
  }
  const prev = read<T>(key, seed as T)
  const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
  cache.set(key, value)
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Sem espaço ou modo privado: segue só em memória.
  }
  emit(key)
}

function subscribe(key: string, cb: () => void) {
  let set = listeners.get(key)
  if (!set) {
    set = new Set()
    listeners.set(key, set)
  }
  set.add(cb)
  return () => set!.delete(cb)
}

/**
 * Demonstração: apaga tudo o que foi alterado e volta aos dados de demonstração.
 * Modo API: limpa só o que está em memória e as chaves locais deste navegador
 * (nunca apaga dados do servidor). Usado ao sair ou quando a sessão cai.
 *
 * Opções (modo API):
 *  - `notify: false`: não avisa as telas abertas. Use quando elas vão ser
 *    desmontadas (a sessão foi para a entrada ou para uma etapa do login): se
 *    relessem agora, buscariam as chaves com a sessão de transição (403/401).
 *  - `serverDataOnly: true`: descarta só o que veio do servidor e mantém as
 *    preferências locais deste navegador (ao abrir uma sessão).
 */
export function resetDb(opts: { notify?: boolean; serverDataOnly?: boolean } = {}) {
  if (API) {
    resetRemote(opts.notify ?? true, opts.serverDataOnly ?? false)
    return
  }
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k))
  } catch {
    /* ignore */
  }
  const keys = [...cache.keys()]
  cache.clear()
  keys.forEach(emit)
}

/**
 * Estado persistente compartilhado entre telas.
 *   const [rules, setRules] = useDb('saques.regras', DEFAULT_RULES)
 * No modo API, a primeira leitura suspende a tela até a chave chegar do servidor.
 */
export function useDb<T>(key: string, seed: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
  if (API) suspendUntilReady(key, seed)
  const value = useSyncExternalStore(
    (cb) => subscribe(key, cb),
    () => read(key, seed),
  )
  const set = useCallback((next: T | ((prev: T) => T)) => dbSet(key, next, seed), [key, seed])
  return [value, set]
}

export interface Collection<T extends { id: string }> {
  items: T[]
  add: (item: T, position?: 'start' | 'end') => void
  update: (id: string, patch: Partial<T> | ((item: T) => T)) => void
  remove: (id: string) => void
  replace: (items: T[]) => void
  get: (id: string) => T | undefined
}

/**
 * Coleção de registros com id.
 *   const promos = useCollection('campanhas.promocoes', seedPromos)
 *   promos.add({...}); promos.update(id, { status: 'pausada' })
 */
export function useCollection<T extends { id: string }>(key: string, seed: T[] | (() => T[])): Collection<T> {
  const [items, setItems] = useDb<T[]>(key, seed)
  return {
    items,
    add: (item, position = 'start') =>
      setItems((prev) => (position === 'start' ? [item, ...prev] : [...prev, item])),
    update: (id, patch) =>
      setItems((prev) =>
        prev.map((it) => (it.id === id ? (typeof patch === 'function' ? patch(it) : { ...it, ...patch }) : it)),
      ),
    remove: (id) => setItems((prev) => prev.filter((it) => it.id !== id)),
    replace: (next) => setItems(next),
    get: (id) => items.find((it) => it.id === id),
  }
}

/**
 * Recarrega a chave do servidor (modo API). No modo demonstração não faz nada.
 * Chave ainda não lida: nada a fazer (a primeira leitura já busca do servidor).
 * Com gravações na fila, recarrega depois que elas terminarem.
 */
export async function refreshKey(key: string): Promise<void> {
  if (!isRemote(key)) return
  if (!cache.has(key)) {
    // buscada antes (prefetch) mas ainda não lida: descarta para a leitura buscar de novo
    if (!pending.has(key)) outcomes.delete(key)
    await pending.get(key)
    return
  }
  // sem permissão de leitura: o servidor responderia 403 de novo
  if (forbidden.has(key)) return
  if ((inflight.get(key) ?? 0) > 0) await queues.get(key)
  await refetchNow(key)
}

/**
 * Busca várias chaves em paralelo (modo API), sem esperar. Evita a cascata de
 * carregamentos quando uma tela lê várias chaves em sequência.
 */
export function prefetchKeys(keys: string[]) {
  if (!API) return
  for (const key of keys) if (isRemote(key) && !cache.has(key) && !outcomes.has(key)) void ensureLoad(key)
}

/** Texto para ações bloqueadas porque a chave não carregou do servidor. */
export const LOAD_FAILED_MESSAGE = 'Estes dados não foram carregados do servidor (a tela mostra a lista vazia ou o padrão). Aguarde um instante e tente de novo; se continuar, recarregue a página.'

/**
 * Modo API: true quando a leitura da chave falhou e a tela mostra a lista vazia ou o padrão
 * no lugar do servidor. Gravações ficam bloqueadas (cada recusa tenta ler de novo); telas de
 * dinheiro mostram erro em vez do padrão. Uma recarga que dê certo (refreshKey) libera a chave.
 * Modo demonstração: sempre false.
 */
export function isLoadFailed(key: string): boolean {
  return isRemote(key) && loadFailed.has(key)
}

/** isLoadFailed como estado da tela (atualiza quando a chave recarrega). */
export function useLoadFailed(key: string): boolean {
  return useSyncExternalStore(
    (cb) => subscribe(key, cb),
    () => isLoadFailed(key),
  )
}

/**
 * Atualiza o valor em memória sem gravar no servidor (ex.: depois de uma ação
 * de domínio como aprovar saque, que o servidor já gravou).
 */
export function patchCache<T>(key: string, next: T | ((prev: T) => T), seed?: T | (() => T)) {
  // modo API: chave ainda não carregada vem do servidor já com a mudança
  if (isRemote(key) && !cache.has(key) && !materialize(key, seed ?? seeds.get(key))) return
  // a leitura falhou e a tela mostra o padrão: aplicar a mudança sobre ele inventaria dados; busca o valor real
  if (isRemote(key) && loadFailed.has(key)) {
    void refetchNow(key)
    return
  }
  const prev = read<T>(key, seed as T)
  const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
  cache.set(key, value)
  // o servidor já tem este valor: um erro em outra gravação não deve desfazê-lo
  if (isRemote(key)) confirmed.set(key, value)
  emit(key)
}

// ---------------------------------------------------------------------------
// Adaptador do modo API
// ---------------------------------------------------------------------------

/**
 * Resultado da leitura no servidor, guardado até a tela informar o valor padrão.
 * missing: nunca gravada (stored:false, com a versão 0 do servidor) ou chave desconhecida (404, versão null).
 */
type Outcome =
  | { kind: 'ok'; value: unknown; version: number }
  | { kind: 'missing'; version: number | null }
  | { kind: 'forbidden' }
  | { kind: 'failed' }

/** Muda a cada resetDb: respostas antigas (de outra sessão) são descartadas. */
let generation = 0
/** versão gravada no servidor (ausente = nunca gravada ou desconhecida) */
const versions = new Map<string, number>()
/** último valor confirmado pelo servidor (para desfazer gravações recusadas) */
const confirmed = new Map<string, unknown>()
/** leituras em andamento (a mesma promessa serve para StrictMode e várias telas) */
const pending = new Map<string, Promise<void>>()
/** leituras concluídas cujo valor padrão ainda não é conhecido (prefetch) */
const outcomes = new Map<string, Outcome>()
/** valor padrão informado pela tela, para 404/403/erro */
const seeds = new Map<string, unknown>()
/** valor estável devolvido enquanto a chave carrega fora da renderização */
const placeholders = new Map<string, unknown>()
/** chaves que o cargo não pode ler: valor vazio, nunca gravado */
const forbidden = new Set<string>()
/**
 * chaves cuja leitura falhou (rede, 5xx, 429) e que mostram o valor padrão no lugar do servidor:
 * gravações bloqueadas até uma leitura dar certo (o padrão nunca vira dado nem base de decisão)
 */
const loadFailed = new Set<string>()
/** fila de gravações por chave (mantém as versões em ordem) */
const queues = new Map<string, Promise<void>>()
const inflight = new Map<string, number>()
/** sobe quando uma gravação falha: as que estavam na fila (feitas sobre o valor antigo) são descartadas */
const epochs = new Map<string, number>()

function isRemote(key: string) {
  return API && !isLocalOnlyKey(key)
}

function kvPath(key: string) {
  return `/api/kv/${encodeURIComponent(key)}`
}

function resolveSeed<T>(seed: T | (() => T) | undefined): T {
  return (typeof seed === 'function' ? (seed as () => T)() : seed) as T
}

/**
 * Valor sem dado do servidor (nunca gravada, leitura que falhou, cargo sem leitura):
 * o valor registrado pelo gerador (apiValue); senão lista vazia para listas de registros
 * e o padrão da tela para objetos de configuração. Nunca registros de demonstração.
 */
function fallbackValue(seed: unknown): unknown {
  const registered = apiValueOf(seed)
  if (registered.found) return resolveSeed(registered.value)
  const base = resolveSeed(seed)
  return Array.isArray(base) ? [] : base
}

function rememberSeed(key: string, seed: unknown) {
  if (seed !== undefined && !seeds.has(key)) seeds.set(key, seed)
}

let lastLoadErrorToast = 0
function notifyLoadError(e: unknown) {
  // uma vez por rajada: com o servidor fora do ar, todas as chaves falham juntas
  const now = Date.now()
  if (now - lastLoadErrorToast < 15_000) return
  lastLoadErrorToast = now
  const message = e instanceof ApiError ? e.message : 'Erro inesperado ao falar com o servidor.'
  toast.error('Não foi possível carregar alguns dados', {
    description: `${message} Essas telas ficam só para leitura até os dados carregarem. Recarregue a página para tentar de novo.`,
    duration: 6000,
  })
}

/** A sessão terminou (saída, sessão caída) ou ainda está numa etapa do login: nenhuma chave do servidor é lida. */
export const NO_SESSION = 'sem-sessao' as const

/**
 * Permissões da sessão aberta (modo API). Com elas, uma chave que o cargo não lê (mesma regra do servidor,
 * canReadKey) nem sai do navegador: o servidor responderia 403, que aparece como erro no console a cada tela.
 * A tela recebe o mesmo valor de "sem leitura" (lista vazia ou padrão, nunca gravado).
 *  - NO_SESSION: sem sessão ativa (saiu, caiu, etapa do login): nenhuma leitura vai ao servidor. Uma tela que
 *    ainda renderiza antes de sair (ex.: o roteador muda o endereço junto com a saída) não busca nada com o
 *    cookie morto (antes: GET /api/kv/... → 401 no console a cada saída).
 *  - null: sem filtro (antes de a sessão ser conhecida; o servidor decide).
 */
let readPerms: ReadonlySet<string> | typeof NO_SESSION | null = null

/** A sessão (session.tsx) informa as permissões do servidor ao abrir e a cada mudança de cargo; NO_SESSION ao sair. */
export function setReadPermissions(perms: ReadonlySet<string> | typeof NO_SESSION | null) {
  readPerms = perms
}

/** O cargo pode ler a chave? Chave sem regra conhecida vai ao servidor (que responde 404). */
export function mayReadKey(key: string): boolean {
  if (readPerms === NO_SESSION) return false
  if (!readPerms) return true
  const rule = findKvRule(key)
  return !rule || canReadKey(rule, readPerms)
}

async function fetchKey(key: string): Promise<Outcome> {
  if (!mayReadKey(key)) return { kind: 'forbidden' }
  try {
    const res = await api<KvGetResponse>('GET', kvPath(key))
    // nunca gravada: a versão (0) vai na primeira gravação
    if (res.stored === false) return { kind: 'missing', version: typeof res.version === 'number' ? res.version : 0 }
    return { kind: 'ok', value: res.value, version: res.version }
  } catch (e) {
    const err = e instanceof ApiError ? e : null
    if (err?.status === 404) {
      if (import.meta.env.DEV && err.code !== 'nao_encontrado') console.warn(`[store] chave sem regra no servidor: ${key} (${err.code})`)
      return { kind: 'missing', version: null }
    }
    if (err?.status === 403) return { kind: 'forbidden' }
    // 401: o portão de login cuida (sessão caiu)
    if (err?.status !== 401) notifyLoadError(e)
    return { kind: 'failed' }
  }
}

/**
 * Converte o resultado da leitura em valor no cache, usando o padrão da tela
 * quando preciso. `keepOnFail`: numa recarga que falhou, mantém o que já está na tela.
 */
function materialize(key: string, seed: unknown, keepOnFail = false): boolean {
  const o = outcomes.get(key)
  if (!o) return false
  outcomes.delete(key)
  placeholders.delete(key)
  if (o.kind === 'ok') {
    cache.set(key, o.value)
    confirmed.set(key, o.value)
    versions.set(key, o.version)
    forbidden.delete(key)
    loadFailed.delete(key)
    return true
  }
  // recarga que falhou: o que está na tela continua (valor do servidor, ou o padrão ainda bloqueado)
  if (o.kind === 'failed' && keepOnFail && cache.has(key)) return true
  // sem dado do servidor: lista vazia ou o padrão de configuração (nunca registros de demonstração)
  const value = fallbackValue(seed)
  cache.set(key, value)
  confirmed.set(key, value)
  if (o.kind === 'forbidden') forbidden.add(key)
  else forbidden.delete(key)
  // erro: o valor padrão só ocupa a tela; não é dado do servidor e não pode ser gravado
  if (o.kind === 'failed') loadFailed.add(key)
  else loadFailed.delete(key)
  // nunca gravada: a primeira gravação envia a versão 0 (se alguém gravou antes, 409 e recarga).
  // 404/erro/sem leitura: versão desconhecida (a gravação é recusada antes ou pelo servidor).
  if (o.kind === 'missing' && o.version !== null) versions.set(key, o.version)
  else versions.delete(key)
  return true
}

function ensureLoad(key: string): Promise<void> {
  const existing = pending.get(key)
  if (existing) return existing
  const gen = generation
  const p: Promise<void> = fetchKey(key)
    .then((o) => {
      if (gen !== generation) return
      outcomes.set(key, o)
      if (seeds.has(key)) {
        materialize(key, seeds.get(key))
        emit(key)
      }
    })
    .finally(() => {
      if (pending.get(key) === p) pending.delete(key)
    })
  pending.set(key, p)
  return p
}

/** Leitura fora da renderização (dbGet, getSnapshot): nunca suspende. */
function remoteRead<T>(key: string, seed: T | (() => T)): T {
  rememberSeed(key, seed)
  if (materialize(key, seeds.get(key) ?? seed)) return cache.get(key) as T
  void ensureLoad(key)
  // enquanto carrega: o mesmo valor que a chave teria sem dado do servidor (nunca a demonstração)
  if (!placeholders.has(key)) placeholders.set(key, fallbackValue(seed))
  return placeholders.get(key) as T
}

/** Leitura na renderização (useDb): lança a promessa para o <Suspense> mostrar o esqueleto. */
function suspendUntilReady<T>(key: string, seed: T | (() => T)) {
  if (cache.has(key) || !isRemote(key)) return
  rememberSeed(key, seed)
  if (materialize(key, seeds.get(key) ?? seed)) return
  throw ensureLoad(key)
}

/** Opções de uma gravação no modo API. */
export interface WriteOptions {
  /**
   * Erros que a tela mostra no próprio campo (ex.: 400 com details.field): sem o aviso
   * "Alteração não salva". O valor volta ao confirmado do mesmo jeito.
   */
  quiet?: (e: ApiError) => boolean
}

/** Resultado de uma gravação: error é o erro do servidor (null = recusada antes de enviar, ou descartada). */
export type WriteResult = { ok: true } | { ok: false; error: ApiError | null }

const WRITE_OK: WriteResult = { ok: true }
const WRITE_REFUSED: WriteResult = { ok: false, error: null }

function remoteSet<T>(key: string, next: T | ((prev: T) => T), seed?: T | (() => T), opts?: WriteOptions): Promise<WriteResult> {
  rememberSeed(key, seed)
  if (!cache.has(key) && !materialize(key, seeds.get(key))) {
    // ainda carregando: aplica a mudança sobre o valor do servidor, não sobre o padrão
    const gen = generation
    return ensureLoad(key).then(() => (gen === generation ? remoteSet(key, next, seed, opts) : WRITE_REFUSED))
  }
  if (forbidden.has(key)) {
    toast.error('Alteração não salva', { description: 'Seu cargo não tem acesso a estes dados.' })
    return Promise.resolve(WRITE_REFUSED)
  }
  if (loadFailed.has(key)) {
    // o que está na tela é o padrão, não o valor do servidor: nada é gravado sobre ele; busca de novo
    toast.error('Alteração não salva', { description: LOAD_FAILED_MESSAGE })
    retryLoad(key)
    return Promise.resolve(WRITE_REFUSED)
  }
  const prev = cache.get(key) as T
  const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
  if (Object.is(value, prev)) return Promise.resolve(WRITE_OK)
  cache.set(key, value)
  emit(key)
  return enqueueWrite(key, value, opts)
}

/** Grava em fila por chave. A promessa diz se o servidor confirmou e, se não, o erro dele. */
function enqueueWrite(key: string, value: unknown, opts?: WriteOptions): Promise<WriteResult> {
  let ok = false
  let error: ApiError | null = null
  const gen = generation
  const epoch = epochs.get(key) ?? 0
  inflight.set(key, (inflight.get(key) ?? 0) + 1)
  const run = (queues.get(key) ?? Promise.resolve()).then(async () => {
    try {
      // descartada: sessão nova ou uma gravação anterior falhou (valor base ficou velho)
      if (gen !== generation || epoch !== (epochs.get(key) ?? 0)) return
      const version = versions.get(key)
      const res = await api<KvPutResponse>('PUT', kvPath(key), version === undefined ? { value } : { value, version })
      if (gen !== generation) return
      versions.set(key, res.version)
      confirmed.set(key, res.value)
      ok = true
      // o servidor devolve o valor já mascarado; só troca se nada mudou depois
      if (cache.get(key) === value) {
        cache.set(key, res.value)
        emit(key)
      }
    } catch (e) {
      if (gen !== generation) return
      epochs.set(key, epoch + 1)
      const err = e instanceof ApiError ? e : null
      error = err
      if (err?.status === 409 && err.code === 'versao_desatualizada') {
        toast.warning('Outra pessoa alterou estes dados', {
          description: 'Carregamos a versão mais recente. Confira e faça a sua alteração de novo.',
          duration: 6000,
        })
        await refetchNow(key)
        // gravações feitas enquanto recarregava partiam do valor velho
        if (gen === generation) epochs.set(key, (epochs.get(key) ?? 0) + 1)
        return
      }
      cache.set(key, confirmed.get(key))
      emit(key)
      // 401: a sessão caiu e o portão de login já avisa; erro que a tela mostra no campo também não
      if (err?.status !== 401 && !(err && opts?.quiet?.(err))) {
        // "não salva": o servidor recusou ou a gravação falhou; a tela volta ao valor gravado (não é um "desfazer")
        toast.error('Alteração não salva', {
          description: err?.message ?? 'Não foi possível salvar. Tente de novo.',
          duration: 6000,
        })
      }
    } finally {
      if (gen === generation) inflight.set(key, Math.max(0, (inflight.get(key) ?? 1) - 1))
    }
  })
  queues.set(key, run)
  return run.then((): WriteResult => (ok ? WRITE_OK : { ok: false, error }))
}

async function refetchNow(key: string) {
  const gen = generation
  const o = await fetchKey(key)
  if (gen !== generation) return
  outcomes.set(key, o)
  materialize(key, seeds.get(key), true)
  emit(key)
}

/** recargas de chaves que falharam, pedidas por gravações recusadas (uma por vez por chave) */
const retrying = new Set<string>()

/** Tenta ler de novo uma chave que falhou. Dando certo, a chave volta a aceitar gravações. */
function retryLoad(key: string) {
  if (retrying.has(key)) return
  retrying.add(key)
  void refetchNow(key).finally(() => retrying.delete(key))
}

function resetRemote(notify: boolean, serverDataOnly: boolean) {
  generation++
  if (!serverDataOnly) {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(PREFIX) && isLocalOnlyKey(k.slice(PREFIX.length)))
        .forEach((k) => localStorage.removeItem(k))
    } catch {
      /* ignore */
    }
  }
  // preferências locais (só com serverDataOnly) continuam no cache: espelham o localStorage
  const keys = [...new Set([...cache.keys(), ...placeholders.keys()])].filter((k) => !serverDataOnly || isRemote(k))
  for (const m of [versions, confirmed, pending, outcomes, seeds, placeholders, queues, inflight, epochs]) m.clear()
  if (serverDataOnly) keys.forEach((k) => cache.delete(k))
  else cache.clear()
  forbidden.clear()
  loadFailed.clear()
  if (notify) keys.forEach(emit)
}

/**
 * Grava e espera a confirmação. Modo API: resolve true quando o servidor
 * aceitou (false se recusou; a tela já mostrou o motivo). Modo demonstração: true.
 */
export function dbSetAndWait<T>(key: string, next: T | ((prev: T) => T), seed?: T | (() => T)): Promise<boolean> {
  if (isRemote(key)) return remoteSet(key, next, seed).then((r) => r.ok)
  dbSet(key, next, seed)
  return Promise.resolve(true)
}

/**
 * dbSetAndWait com o erro do servidor, para a tela mostrar um 400/403 junto do campo
 * (details.field). Com `quiet`, esses erros não viram o aviso "Alteração não salva".
 *   const r = await dbSetAndWaitResult(key, next, seed, { quiet: (e) => e.status === 400 })
 *   if (!r.ok && r.error) setFieldError(r.error.message)
 * Modo demonstração: sempre { ok: true }.
 */
export function dbSetAndWaitResult<T>(key: string, next: T | ((prev: T) => T), seed?: T | (() => T), opts?: WriteOptions): Promise<WriteResult> {
  if (isRemote(key)) return remoteSet(key, next, seed, opts)
  dbSet(key, next, seed)
  return Promise.resolve(WRITE_OK)
}

export type DirectSaveResult<T> = { ok: true; value: T } | { ok: false; conflict: boolean; error: ApiError | null }

/**
 * Modo API: grava a chave direto na API (fora da fila do adaptador) e devolve o erro do servidor, sem
 * aviso nem gravação otimista, para a tela mostrar um 400 junto do campo (ex.: "O destino desta credencial
 * mudou", com details.path/field). Antes confere se o valor no servidor ainda é o que a tela mostra
 * (`base`); se outra pessoa mudou, recarrega e não grava (conflict). Use só no modo API.
 */
export async function dbSaveDirect<T>(key: string, base: T, next: T): Promise<DirectSaveResult<T>> {
  const path = kvPath(key)
  try {
    const cur = await api<KvGetResponse<T>>('GET', path)
    if (cur.stored !== false && JSON.stringify(cur.value) !== JSON.stringify(base)) {
      await refreshKey(key).catch(() => {})
      return { ok: false, conflict: true, error: null }
    }
    const res = await api<KvPutResponse<T>>('PUT', path, { value: next, version: cur.version })
    patchCache<T>(key, res.value)
    // traz a versão nova para as próximas gravações pelo adaptador
    await refreshKey(key).catch(() => {})
    return { ok: true, value: res.value }
  } catch (e) {
    if (isVersionConflict(e)) refreshKey(key).catch(() => {})
    return { ok: false, conflict: isVersionConflict(e), error: e instanceof ApiError ? e : null }
  }
}
