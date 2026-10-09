// Mascaramento de segredos e dados pessoais nas respostas de /api/kv e a
// operação inversa na gravação: valor mascarado que volta do painel é trocado
// pelo valor gravado no mesmo caminho (o painel nunca recebe nem apaga o dado).
//
// Regra de campo: o nome do campo decide (SECRET_FIELD / PII_FIELD). O que está
// dentro de um campo sensível também é sensível (ex.: credentials: { user, key }
// ou phones: ['...']), para não vazar por um nome de campo filho genérico.
import { PII_FIELD, SECRET_FIELD, type KvRule } from '@shared/kv-registry'
import { Errors } from '../../errors'
import { isMasked, maskPii, maskSecret } from '../../lib/mask'
import { hasOwn, isPlainObject, itemId, MISSING, setOwn, type JsonObject, type Maybe } from './json'

export interface MaskPolicy {
  /** mascara campos de segredo */
  secrets: boolean
  /** mascara campos de dados pessoais */
  pii: boolean
}

/** O que sai mascarado para esta pessoa. */
export function readPolicy(rule: KvRule, perms: ReadonlySet<string>): MaskPolicy {
  return { secrets: !!rule.secrets, pii: !!rule.pii && !perms.has(rule.pii.revealPermission) }
}

/** O que é tratado como sensível na gravação (restauração de máscaras), para qualquer pessoa. */
export function writePolicy(rule: KvRule): MaskPolicy {
  return { secrets: !!rule.secrets, pii: !!rule.pii }
}

interface Ctx {
  secret: boolean
  /** nome do campo pessoal mais próximo (decide a máscara), ou null */
  pii: string | null
}

const ROOT: Ctx = { secret: false, pii: null }

function childCtx(ctx: Ctx, field: string, policy: MaskPolicy): Ctx {
  return {
    secret: ctx.secret || (policy.secrets && SECRET_FIELD.test(field)),
    pii: policy.pii && PII_FIELD.test(field) ? field : ctx.pii,
  }
}

const sensitive = (ctx: Ctx) => ctx.secret || ctx.pii !== null

function maskLeaf(v: string | number, ctx: Ctx): unknown {
  if (ctx.secret) {
    if (typeof v !== 'string') return v
    return isMasked(v) ? v : maskSecret(v)
  }
  if (ctx.pii !== null) {
    const s = String(v)
    if (s === '') return s
    return isMasked(s) ? s : maskPii(ctx.pii, s)
  }
  return v
}

function redactNode(v: unknown, ctx: Ctx, policy: MaskPolicy): unknown {
  if (typeof v === 'string' || typeof v === 'number') return sensitive(ctx) ? maskLeaf(v, ctx) : v
  if (Array.isArray(v)) return v.map((item) => redactNode(item, ctx, policy))
  if (isPlainObject(v)) {
    const out: JsonObject = {}
    for (const [k, child] of Object.entries(v)) setOwn(out, k, redactNode(child, childCtx(ctx, k, policy), policy))
    return out
  }
  return v
}

/** Cópia do valor com segredos e (se for o caso) dados pessoais mascarados. */
export function redact(value: unknown, policy: MaskPolicy): unknown {
  if (!policy.secrets && !policy.pii) return value
  return redactNode(value, ROOT, policy)
}

/** Contraparte gravada de cada item de uma lista: por id quando houver, senão pela posição. */
function counterparts(incoming: unknown[], stored: Maybe<unknown>): Maybe<unknown>[] {
  const storedList = Array.isArray(stored) ? stored : null
  const byId = new Map<string, unknown>()
  if (storedList) {
    for (const s of storedList) {
      const id = itemId(s)
      if (id !== null && !byId.has(id)) byId.set(id, s)
    }
  }
  return incoming.map((item, i) => {
    if (!storedList) return MISSING
    const id = itemId(item)
    if (id !== null) return byId.has(id) ? byId.get(id) : MISSING
    return i < storedList.length ? storedList[i] : MISSING
  })
}

function restoreNode(v: unknown, stored: Maybe<unknown>, ctx: Ctx, policy: MaskPolicy, path: (string | number)[]): unknown {
  if (typeof v === 'string') {
    if (!sensitive(ctx) || !isMasked(v)) return v
    if (stored === MISSING) {
      throw Errors.invalid('Um valor mascarado não pode ser salvo como dado real. Digite o valor completo.', { path: path.join('.') })
    }
    return stored
  }
  if (Array.isArray(v)) {
    const cps = counterparts(v, stored)
    return v.map((item, i) => restoreNode(item, cps[i], ctx, policy, [...path, i]))
  }
  if (isPlainObject(v)) {
    const out: JsonObject = {}
    for (const [k, child] of Object.entries(v)) {
      const cp = isPlainObject(stored) && hasOwn(stored, k) ? stored[k] : MISSING
      setOwn(out, k, restoreNode(child, cp, childCtx(ctx, k, policy), policy, [...path, k]))
    }
    return out
  }
  return v
}

/**
 * Troca valores mascarados (campos sensíveis) pelo valor gravado no mesmo caminho.
 * Sem valor gravado correspondente → 400 (uma máscara nunca vira dado real).
 */
export function restoreMasked(incoming: unknown, stored: Maybe<unknown>, policy: MaskPolicy): unknown {
  if (!policy.secrets && !policy.pii) return incoming
  return restoreNode(incoming, stored, ROOT, policy, [])
}
