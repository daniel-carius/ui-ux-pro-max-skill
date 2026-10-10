// Mascaramento de segredos e dados pessoais nas respostas de /api/kv e a
// operação inversa na gravação: valor mascarado que volta do painel é trocado
// pelo valor gravado no mesmo caminho (o painel nunca recebe nem apaga o dado).
//
// Regra de campo: o nome do campo decide (SECRET_FIELD / isPiiField, mais os
// nomes extras da regra em rule.piiFields / URL_FIELD). O que está dentro de um
// campo sensível também é sensível (ex.: credentials: { user, key } ou
// phones: ['...']), para não vazar por um nome de campo filho genérico.
//
// Restauração (gravação):
//  - só a máscara EXATA que o servidor emite para o valor gravado vale como "não mudou";
//    outro texto com "***" ou "•" é recusado (400), para uma troca de segredo nunca
//    manter o antigo em silêncio;
//  - segredo mantido pela máscara fica preso ao destino: se o objeto que guarda o
//    segredo mudou um campo de destino (host, porta, TLS, URL, domínio, região,
//    ambiente, gateway, cliente, conta, usuário, plataforma), a gravação é recusada
//    e o segredo precisa ser digitado de novo;
//  - cada item gravado serve de contraparte para um só item enviado (id repetido não
//    clona o segredo).
import { isPiiField, SECRET_FIELD, URL_FIELD, type KvRule } from '@shared/kv-registry'
import { Errors } from '../../errors'
import { isMasked, maskPii, maskSecret, maskUrlTokens, SECRET_BULLETS, SECRET_MASK_RE } from '../../lib/mask'
import { deepEqual, hasOwn, isPlainObject, itemId, MISSING, setOwn, type JsonObject, type Maybe } from './json'

export interface MaskPolicy {
  /** mascara campos de segredo */
  secrets: boolean
  /** mascara campos de dados pessoais */
  pii: boolean
  /** nomes extras tratados como dado pessoal (KvRule.piiFields) */
  piiFields?: readonly string[]
  /** mascara tokens em campos de URL (KvRule.urls) */
  urls?: boolean
}

function withExtras(base: MaskPolicy, rule: KvRule, urls: boolean): MaskPolicy {
  const out: MaskPolicy = { ...base }
  if (base.pii && rule.piiFields?.length) out.piiFields = rule.piiFields
  if (urls) out.urls = true
  return out
}

/**
 * O que sai mascarado para esta pessoa. Chave com pii.revealByRecord: dados pessoais
 * mascarados para todos (o dado em claro sai só pela rota de revelar, por registro).
 */
export function readPolicy(rule: KvRule, perms: ReadonlySet<string>): MaskPolicy {
  const base = { secrets: !!rule.secrets, pii: !!rule.pii && (!!rule.pii.revealByRecord || !perms.has(rule.pii.revealPermission)) }
  return withExtras(base, rule, !!rule.urls && !perms.has(rule.urls.revealPermission))
}

/** O que é tratado como sensível na gravação (restauração de máscaras), para qualquer pessoa. */
export function writePolicy(rule: KvRule): MaskPolicy {
  return withExtras({ secrets: !!rule.secrets, pii: !!rule.pii }, rule, !!rule.urls)
}

interface Ctx {
  secret: boolean
  /** nome do campo pessoal mais próximo (decide a máscara), ou null */
  pii: string | null
  /** dentro de um campo de URL */
  url: boolean
}

const ROOT: Ctx = { secret: false, pii: null, url: false }

function childCtx(ctx: Ctx, field: string, policy: MaskPolicy): Ctx {
  return {
    secret: ctx.secret || (policy.secrets && SECRET_FIELD.test(field)),
    pii: policy.pii && isPiiField(field, policy.piiFields) ? field : ctx.pii,
    url: ctx.url || (!!policy.urls && URL_FIELD.test(field)),
  }
}

const sensitive = (ctx: Ctx) => ctx.secret || ctx.pii !== null || ctx.url

/**
 * Máscara de uma folha sensível. Segredo: sempre mascarado, inclusive número e
 * booleano (só a máscara já emitida pelo servidor passa igual, para a máscara ser
 * idempotente quando um módulo de domínio já devolve o valor mascarado).
 */
function maskLeaf(v: string | number | boolean, ctx: Ctx): unknown {
  if (ctx.secret) {
    if (typeof v !== 'string') return SECRET_BULLETS
    return SECRET_MASK_RE.test(v) ? v : maskSecret(v)
  }
  if (typeof v === 'boolean') return v
  if (ctx.url && typeof v === 'string') {
    return isMasked(v) ? v : maskUrlTokens(v)
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
  if (typeof v === 'boolean') return ctx.secret ? maskLeaf(v, ctx) : v
  if (Array.isArray(v)) return v.map((item) => redactNode(item, ctx, policy))
  if (isPlainObject(v)) {
    const out: JsonObject = {}
    for (const [k, child] of Object.entries(v)) setOwn(out, k, redactNode(child, childCtx(ctx, k, policy), policy))
    return out
  }
  return v
}

/**
 * Projeção mínima (KvRule.teamView): só os caminhos listados ("a.b") do valor, para
 * quem lê uma configuração 'equipe' sem ver a tela dona. O resto não sai nem mascarado.
 */
export function project(value: unknown, paths: readonly string[]): unknown {
  if (!isPlainObject(value)) return null
  const out: JsonObject = {}
  for (const path of paths) {
    const parts = path.split('.')
    let src: unknown = value
    for (const p of parts) src = isPlainObject(src) && hasOwn(src, p) ? src[p] : MISSING
    if (src === MISSING || (typeof src === 'object' && src !== null)) continue
    let dst = out
    for (const p of parts.slice(0, -1)) {
      if (!isPlainObject(dst[p])) setOwn(dst, p, {})
      dst = dst[p] as JsonObject
    }
    setOwn(dst, parts[parts.length - 1], src)
  }
  return out
}

/** Cópia do valor com segredos e (se for o caso) dados pessoais mascarados. */
export function redact(value: unknown, policy: MaskPolicy): unknown {
  if (!policy.secrets && !policy.pii && !policy.urls) return value
  return redactNode(value, ROOT, policy)
}

/**
 * Contraparte gravada de cada item de uma lista: por id quando houver, senão pela posição.
 * Cada item gravado serve a um só item enviado (o segundo item com o mesmo id fica sem
 * contraparte: uma máscara nele é recusada, em vez de clonar o segredo).
 */
function counterparts(incoming: unknown[], stored: Maybe<unknown>): Maybe<unknown>[] {
  const storedList = Array.isArray(stored) ? stored : null
  const byId = new Map<string, unknown[]>()
  if (storedList) {
    for (const s of storedList) {
      const id = itemId(s)
      if (id === null) continue
      const queue = byId.get(id)
      if (queue) queue.push(s)
      else byId.set(id, [s])
    }
  }
  return incoming.map((item, i) => {
    if (!storedList) return MISSING
    const id = itemId(item)
    if (id !== null) {
      const queue = byId.get(id)
      return queue?.length ? queue.shift() : MISSING
    }
    return i < storedList.length ? storedList[i] : MISSING
  })
}

// ---------- destino do segredo ----------

/**
 * Palavras de nome de campo que decidem para onde um segredo vai (camelCase,
 * snake_case ou kebab-case: smtpHost, base_url, currentEnv, gatewayId, clientId).
 */
const DESTINATION_WORDS = new Set([
  'host',
  'hostname',
  'server',
  'port',
  'secure',
  'tls',
  'ssl',
  'starttls',
  'url',
  'uri',
  'endpoint',
  'domain',
  'region',
  'env',
  'environment',
  'environments',
  'gateway',
  'client',
  'account',
  'merchant',
  'tenant',
  'user',
  'username',
  'login',
  'platform',
])

/** O campo decide o destino de um segredo irmão? (o próprio segredo não conta) */
export function isDestinationField(field: string): boolean {
  if (SECRET_FIELD.test(field)) return false
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((w) => DESTINATION_WORDS.has(w))
}

/** Só o que decide o destino: em objetos aninhados, os campos de destino e o id. */
function destinationView(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(destinationView)
  if (isPlainObject(v)) {
    const out: JsonObject = {}
    for (const [k, child] of Object.entries(v)) if (k === 'id' || isDestinationField(k)) setOwn(out, k, destinationView(child))
    return out
  }
  return v
}

/** Segredo mantido pela máscara: o objeto que o guarda não pode ter mudado de destino. */
function assertSameDestination(incoming: JsonObject, stored: JsonObject, path: (string | number)[]) {
  const fields = new Set([...Object.keys(incoming), ...Object.keys(stored)])
  for (const f of fields) {
    if (!isDestinationField(f)) continue
    const a = hasOwn(incoming, f) ? destinationView(incoming[f]) : undefined
    const b = hasOwn(stored, f) ? destinationView(stored[f]) : undefined
    if (!deepEqual(a, b)) {
      throw Errors.invalid(`O destino desta credencial mudou (${f}): digite o segredo novamente.`, {
        path: path.join('.'),
        field: f,
      })
    }
  }
}

// ---------- restauração ----------

interface RestoreState {
  /** segredos mantidos pela máscara até aqui */
  keptSecrets: number
}

/** Máscara exata que a leitura emite para o valor gravado (null = a leitura não mascara). */
function expectedMask(stored: unknown, ctx: Ctx): string | null {
  if (typeof stored !== 'string' && typeof stored !== 'number' && typeof stored !== 'boolean') return null
  const m = maskLeaf(stored, ctx)
  return typeof m === 'string' ? m : null
}

function restoreLeaf(v: string, stored: Maybe<unknown>, ctx: Ctx, path: (string | number)[], state: RestoreState): unknown {
  if (!sensitive(ctx) || !isMasked(v)) return v
  if (stored === MISSING) {
    throw Errors.invalid('Um valor mascarado não pode ser salvo como dado real. Digite o valor completo.', { path: path.join('.') })
  }
  // só a máscara atual do valor gravado vale como "não mudou"
  if (v !== expectedMask(stored, ctx)) {
    throw Errors.invalid('O valor contém caracteres de máscara (*** ou •) e não é a máscara atual. Digite o valor completo sem esses caracteres.', {
      path: path.join('.'),
    })
  }
  if (ctx.secret) state.keptSecrets++
  return stored
}

function restoreNode(v: unknown, stored: Maybe<unknown>, ctx: Ctx, policy: MaskPolicy, path: (string | number)[], state: RestoreState): unknown {
  if (typeof v === 'string') return restoreLeaf(v, stored, ctx, path, state)
  if (Array.isArray(v)) {
    const cps = counterparts(v, stored)
    return v.map((item, i) => restoreNode(item, cps[i], ctx, policy, [...path, i], state))
  }
  if (isPlainObject(v)) {
    const out: JsonObject = {}
    let keepsSecret = false
    for (const [k, child] of Object.entries(v)) {
      const cp = isPlainObject(stored) && hasOwn(stored, k) ? stored[k] : MISSING
      const cctx = childCtx(ctx, k, policy)
      const before = state.keptSecrets
      setOwn(out, k, restoreNode(child, cp, cctx, policy, [...path, k], state))
      // este objeto guarda o segredo (o campo k entra no contexto de segredo) e ele foi mantido
      if (!ctx.secret && cctx.secret && state.keptSecrets > before) keepsSecret = true
    }
    if (keepsSecret && isPlainObject(stored)) assertSameDestination(out, stored, path)
    return out
  }
  return v
}

/**
 * Troca valores mascarados (campos sensíveis) pelo valor gravado no mesmo caminho.
 * Sem valor gravado correspondente, máscara que não é a atual ou segredo mantido com
 * destino trocado → 400 (uma máscara nunca vira dado real nem muda de destino).
 */
export function restoreMasked(incoming: unknown, stored: Maybe<unknown>, policy: MaskPolicy): unknown {
  if (!policy.secrets && !policy.pii && !policy.urls) return incoming
  return restoreNode(incoming, stored, ROOT, policy, [], { keptSecrets: 0 })
}
