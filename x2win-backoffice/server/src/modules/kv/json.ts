// Utilitários de JSON para a rota de dados por chave: validação de formato
// (profundidade, números finitos, textos aceitos pelo jsonb), comparação
// profunda e resumo pt-BR do que mudou (para a auditoria).
import { Errors } from '../../errors'

/** Profundidade máxima aceita (objetos/listas aninhados). */
export const MAX_JSON_DEPTH = 64

/** Marca "não existe valor gravado neste caminho". */
export const MISSING: unique symbol = Symbol('kv.missing')
export type Maybe<T> = T | typeof MISSING

export type JsonObject = Record<string, unknown>

export function isPlainObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function hasOwn(obj: object, key: string) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

/** Define uma propriedade própria (nunca mexe no protótipo, mesmo com "__proto__"). */
export function setOwn(obj: JsonObject, key: string, value: unknown) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true })
}

// eslint-disable-next-line no-control-regex
const BAD_STRING = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/**
 * Confere que o valor é JSON gravável: sem aninhamento exagerado, sem números
 * infinitos e sem textos que o PostgreSQL recusa (caractere nulo, surrogates soltos).
 * Iterativo, para não estourar a pilha com listas muito aninhadas.
 */
export function assertStorableJson(value: unknown, maxDepth = MAX_JSON_DEPTH) {
  const stack: { v: unknown; depth: number }[] = [{ v: value, depth: 0 }]
  while (stack.length) {
    const { v, depth } = stack.pop()!
    if (typeof v === 'string') {
      if (BAD_STRING.test(v)) throw Errors.invalid('O texto enviado tem caracteres inválidos.')
      continue
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw Errors.invalid('Número inválido nos dados enviados.')
      continue
    }
    if (v === null || typeof v === 'boolean') continue
    if (typeof v !== 'object') throw Errors.invalid('Os dados precisam ser JSON.')
    if (depth >= maxDepth) throw Errors.invalid(`Os dados têm mais de ${maxDepth} níveis de aninhamento.`)
    if (Array.isArray(v)) {
      for (const item of v) stack.push({ v: item, depth: depth + 1 })
    } else {
      for (const [k, item] of Object.entries(v as JsonObject)) {
        if (BAD_STRING.test(k)) throw Errors.invalid('O texto enviado tem caracteres inválidos.')
        stack.push({ v: item, depth: depth + 1 })
      }
    }
  }
}

/** Igualdade profunda de valores JSON (ordem das chaves de objeto não importa). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  const ka = Object.keys(a as JsonObject)
  const kb = Object.keys(b as JsonObject)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!hasOwn(b as JsonObject, k)) return false
    if (!deepEqual((a as JsonObject)[k], (b as JsonObject)[k])) return false
  }
  return true
}

/** Id de um item de lista ("id" texto ou número), ou null. */
export function itemId(v: unknown): string | null {
  if (!isPlainObject(v)) return null
  const id = v.id
  if (typeof id === 'string' && id !== '') return `s:${id}`
  if (typeof id === 'number' && Number.isFinite(id)) return `n:${id}`
  return null
}

const showId = (k: string) => {
  const raw = k.slice(2)
  return raw.length > 40 ? `${raw.slice(0, 39)}…` : raw
}

/** Todos os itens são objetos com id (e sem ids repetidos)? */
function idList(list: unknown[]): string[] | null {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const id = itemId(item)
    if (id === null || seen.has(id)) return null
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function plural(n: number, singular: string, pluralForm: string) {
  return `${n} ${n === 1 ? singular : pluralForm}`
}

function listIds(ids: string[], max = 5) {
  const shown = ids.slice(0, max).map(showId).join(', ')
  return ids.length > max ? `${shown}, … +${ids.length - max}` : shown
}

function listNames(names: string[], max = 15) {
  const shown = names.slice(0, max).join(', ')
  return names.length > max ? `${shown} e mais ${names.length - max}` : shown
}

/** Diferença entre duas listas de itens com id: incluídos, alterados, removidos. */
export function diffById(before: unknown[], after: unknown[]) {
  const bIds = idList(before)
  const aIds = idList(after)
  if (!bIds || !aIds) return null
  const oldById = new Map(before.map((item, i) => [bIds[i], item]))
  const newSet = new Set(aIds)
  const added: string[] = []
  const changed: string[] = []
  after.forEach((item, i) => {
    const id = aIds[i]
    if (!oldById.has(id)) added.push(id)
    else if (!deepEqual(oldById.get(id), item)) changed.push(id)
  })
  const removed = bIds.filter((id) => !newSet.has(id))
  const reordered = !added.length && !removed.length && bIds.some((id, i) => aIds[i] !== id)
  return { added, changed, removed, reordered }
}

function describeIdDiff(d: NonNullable<ReturnType<typeof diffById>>): string | null {
  const parts: string[] = []
  if (d.added.length) parts.push(`${plural(d.added.length, 'incluído', 'incluídos')} (${listIds(d.added)})`)
  if (d.changed.length) parts.push(`${plural(d.changed.length, 'alterado', 'alterados')} (${listIds(d.changed)})`)
  if (d.removed.length) parts.push(`${plural(d.removed.length, 'removido', 'removidos')} (${listIds(d.removed)})`)
  if (parts.length) return parts.join('; ')
  if (d.reordered) return 'ordem alterada'
  return null
}

function describeList(before: unknown[], after: unknown[]): string | null {
  const d = diffById(before, after)
  if (d) return describeIdDiff(d)
  if (deepEqual(before, after)) return null
  return `lista alterada (${plural(before.length, 'item', 'itens')} → ${plural(after.length, 'item', 'itens')})`
}

/**
 * Resumo curto do que mudou, sem valores (podem ser segredos ou dados pessoais):
 * campos de 1º nível alterados, ou itens incluídos/alterados/removidos em listas.
 */
export function summarizeChange(before: Maybe<unknown>, after: unknown): string {
  if (before === MISSING) {
    if (Array.isArray(after)) return `Primeira gravação com ${plural(after.length, 'item', 'itens')}`
    if (isPlainObject(after)) {
      const keys = Object.keys(after)
      return keys.length ? `Primeira gravação. Campos: ${listNames(keys)}` : 'Primeira gravação (vazio)'
    }
    return 'Primeira gravação'
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const d = describeList(before, after)
    return d ? `Itens: ${d}` : 'Salvo sem alterações'
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    const changed: string[] = []
    for (const k of keys) {
      const b = hasOwn(before, k) ? before[k] : MISSING
      const a = hasOwn(after, k) ? after[k] : MISSING
      if (b === MISSING) changed.push(`${k} (incluído)`)
      else if (a === MISSING) changed.push(`${k} (removido)`)
      else if (!deepEqual(b, a)) {
        const detail = Array.isArray(b) && Array.isArray(a) ? describeList(b, a) : null
        changed.push(detail ? `${k} (${detail})` : k)
      }
    }
    return changed.length ? `Campos alterados: ${listNames(changed)}` : 'Salvo sem alterações'
  }
  return deepEqual(before, after) ? 'Salvo sem alterações' : 'Valor substituído'
}
