// Armazenamento local que simula o back-end: cada chave guarda uma coleção ou
// um objeto de configuração. Os dados de demonstração (seed) só são gravados
// no localStorage quando alguém altera algo, para não lotar o navegador.

import { useCallback, useSyncExternalStore } from 'react'

const PREFIX = 'x2w.db.v1.'
const cache = new Map<string, unknown>()
const listeners = new Map<string, Set<() => void>>()
const allListeners = new Set<() => void>()

function read<T>(key: string, seed: T | (() => T)): T {
  if (cache.has(key)) return cache.get(key) as T
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

/** Apaga tudo o que foi alterado e volta aos dados de demonstração. */
export function resetDb() {
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
 */
export function useDb<T>(key: string, seed: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
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
