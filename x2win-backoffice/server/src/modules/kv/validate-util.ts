// Utilitários das regras de gravação por chave: contrato dos validadores das
// chaves genéricas, leitura de listas com id, diferença item a item e resumo da
// auditoria com valores (antes → depois) para dados financeiros e regulados.
import type { FastifyInstance } from 'fastify'
import type { z } from 'zod'
import type { AuditAction } from '@shared/audit'
import { brl } from '@shared/money'
import type { Db } from '../../db'
import { AppError, Errors } from '../../errors'
import type { AuthContext } from '../../types'
import { deepEqual, hasOwn, isPlainObject, MISSING, type JsonObject, type Maybe } from './json'

/** O que um validador de chave genérica recebe (dentro da transação da gravação). */
export interface KvWriteCheck {
  t: Db
  app: FastifyInstance
  auth: AuthContext
  key: string
  /** valor gravado (decifrado), ou MISSING */
  stored: Maybe<unknown>
  /** valor enviado, já com os dados mascarados restaurados do gravado */
  next: unknown
  now: number
}

export interface KvCheckResult {
  /** valor a gravar (com os campos definidos pelo servidor) */
  value: unknown
  /** resumo da auditoria (com valores); sem resumo, vale o resumo padrão */
  summary?: string
  /**
   * ação e entidade da linha da auditoria (ex.: 'ligar' em "Modo de ataque"), no
   * lugar de 'editar' em "Dados · <tela>". Continua uma linha só por gravação.
   */
  audit?: { action: AuditAction; entity: string }
}

export type KvValidator = (c: KvWriteCheck) => KvCheckResult | Promise<KvCheckResult>

export const fieldNotAllowed = (message: string, details?: unknown) => new AppError(403, 'campo_nao_permitido', message, details)
export const transitionNotAllowed = (message: string, details?: unknown) => new AppError(403, 'transicao_nao_permitida', message, details)

/** Valida com o zod e responde 400 com a primeira mensagem (e o caminho). */
export function parseOr400<T>(schema: z.ZodType<T>, v: unknown, prefix = ''): T {
  const r = schema.safeParse(v)
  if (r.success) return r.data
  const issue = r.error.issues[0]
  throw Errors.invalid(`${prefix}${issue?.message ?? 'Dados inválidos.'}`, { path: issue?.path.join('.') ?? '' })
}

/** Lista gravada (só objetos), ou [] se não houver. */
export function storedList(stored: Maybe<unknown>): JsonObject[] {
  return stored === MISSING || !Array.isArray(stored) ? [] : stored.filter(isPlainObject)
}

/** Confere a lista enviada: objetos com id texto (até 64), sem repetição. */
export function incomingList(v: unknown, what: string, max: number): JsonObject[] {
  if (!Array.isArray(v)) throw Errors.invalid(`Envie a lista de ${what}.`)
  if (v.length > max) throw Errors.invalid(`No máximo ${max} ${what}.`)
  const seen = new Set<string>()
  for (const item of v) {
    if (!isPlainObject(item) || typeof item.id !== 'string' || !item.id || item.id.length > 64) {
      throw Errors.invalid(`Item sem identificador na lista de ${what}.`)
    }
    if (seen.has(item.id)) throw Errors.invalid(`Item repetido na lista de ${what} (${item.id}).`, { id: item.id })
    seen.add(item.id)
  }
  return v as JsonObject[]
}

export const idOf = (o: JsonObject) => String(o.id)

/** Campos (1º nível) com valor diferente entre dois objetos. */
export function changedFields(before: JsonObject, after: JsonObject): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (f) => !deepEqual(hasOwn(before, f) ? before[f] : undefined, hasOwn(after, f) ? after[f] : undefined),
  )
}

export interface ItemChange {
  id: string
  before: JsonObject
  after: JsonObject
  fields: string[]
}

export interface ItemDiff {
  added: JsonObject[]
  removed: JsonObject[]
  changed: ItemChange[]
}

/** Diferença por id entre a lista gravada e a enviada. */
export function diffItems(before: readonly JsonObject[], after: readonly JsonObject[]): ItemDiff {
  const oldById = new Map(before.filter((o) => typeof o.id === 'string').map((o) => [idOf(o), o]))
  const newIds = new Set(after.map(idOf))
  const added: JsonObject[] = []
  const changed: ItemChange[] = []
  for (const item of after) {
    const old = oldById.get(idOf(item))
    if (!old) added.push(item)
    else {
      const fields = changedFields(old, item)
      if (fields.length) changed.push({ id: idOf(item), before: old, after: item, fields })
    }
  }
  const removed = before.filter((o) => typeof o.id === 'string' && !newIds.has(idOf(o)))
  return { added, removed, changed }
}

/** Texto curto de um valor para a auditoria. */
export function show(v: unknown, money = false): string {
  if (v === undefined || v === null || v === '') return '—'
  if (typeof v === 'number') return money ? brl(v) : String(v)
  if (typeof v === 'boolean') return v ? 'sim' : 'não'
  if (typeof v === 'string') return clip(v, 80)
  return clip(JSON.stringify(v), 80)
}

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** "a: x → y" de cada campo alterado. */
export function describeFields(c: Pick<ItemChange, 'before' | 'after' | 'fields'>, moneyFields: readonly string[] = []): string {
  return c.fields.map((f) => `${f}: ${show(c.before[f], moneyFields.includes(f))} → ${show(c.after[f], moneyFields.includes(f))}`).join(', ')
}

/** Junta partes do resumo (no máximo `max`, com "e mais N"). */
export function joinParts(parts: string[], max = 20): string {
  if (!parts.length) return 'Salvo sem alterações'
  const shown = parts.slice(0, max).join('; ')
  return parts.length > max ? `${shown}; e mais ${parts.length - max}` : shown
}

/**
 * Diferenças folha a folha entre dois objetos de configuração ("a.b: x → y").
 * Listas são comparadas inteiras ("lista com N → M itens").
 */
export function describeObjectChanges(before: unknown, after: unknown, path = ''): string[] {
  if (deepEqual(before, after)) return []
  if (isPlainObject(before) && isPlainObject(after)) {
    const out: string[] = []
    // ordem do valor novo (a do formulário); o que só existia antes vem no fim
    for (const k of [...new Set([...Object.keys(after), ...Object.keys(before)])]) {
      out.push(...describeObjectChanges(hasOwn(before, k) ? before[k] : undefined, hasOwn(after, k) ? after[k] : undefined, path ? `${path}.${k}` : k))
    }
    return out
  }
  const label = path || 'valor'
  if (Array.isArray(before) && Array.isArray(after)) {
    const allPrimitive = [...before, ...after].every((v) => typeof v !== 'object' || v === null)
    if (allPrimitive && before.length + after.length <= 12) return [`${label}: ${show(before)} → ${show(after)}`]
    return [`${label}: lista com ${before.length} → ${after.length} itens`]
  }
  return [`${label}: ${show(before)} → ${show(after)}`]
}

/** Número com no máximo duas casas decimais? */
export const twoDecimals = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6
export const round2 = (v: number) => Math.round(v * 100) / 100
