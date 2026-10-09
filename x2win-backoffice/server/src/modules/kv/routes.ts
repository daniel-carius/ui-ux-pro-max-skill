// Rota genérica de dados por chave: /api/kv/:key (GET e PUT), aplicando o
// registro shared/kv-registry.ts, mascaramento de segredos/dados pessoais e
// controle de versão. Chaves de domínio são delegadas aos módulos.
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { canReadKey, canWriteKey, findKvRule, isLocalOnlyKey, type KvRule } from '@shared/kv-registry'
import type { KvGetResponse } from '@shared/api'
import { AppError, Errors } from '../../errors'
import { requireActive } from '../../http'
import type { KvContext, KvHandler, KvHandlers, KvValue } from '../../kv/types'
import type { AuthContext } from '../../types'
import { genericHandler } from './generic'
import { assertStorableJson } from './json'
import { kvHandlers as playersKv } from './players'
import { readPolicy, redact } from './redact'
import { kvHandlers as transactionsKv } from './transactions'

/** Formato aceito de chave: segmentos [A-Za-z0-9_-] separados por ponto. */
const KEY_FORMAT = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/
export const MAX_KEY_LENGTH = 120

const putBody = z.object(
  {
    value: z.unknown().refine((v) => v !== undefined, { message: 'Envie o valor (value).' }),
    version: z.number('Versão inválida.').int('Versão inválida.').min(0, 'Versão inválida.').nullish(),
  },
  'Envie { value, version }.',
)

const unknownKey = () => new AppError(404, 'chave_desconhecida', 'Chave de dados desconhecida.')
const localKey = () => new AppError(400, 'chave_local', 'Esta chave fica só no navegador e não é guardada no servidor.')
const notImplemented = () => new AppError(501, 'nao_implementado', 'Esta área ainda não está disponível no servidor.')

interface Resolved {
  auth: AuthContext
  key: string
  rule: KvRule
}

/** Sessão ativa + chave válida, não local e com regra no registro. */
function resolve(req: FastifyRequest): Resolved {
  const auth = requireActive(req)
  const key = (req.params as { key?: unknown }).key
  if (typeof key !== 'string' || key.length > MAX_KEY_LENGTH || !KEY_FORMAT.test(key)) throw unknownKey()
  if (isLocalOnlyKey(key)) throw localKey()
  const rule = findKvRule(key)
  if (!rule) throw unknownKey()
  return { auth, key, rule }
}

function respond(key: string, out: KvValue, rule: KvRule, auth: AuthContext): KvGetResponse {
  return { key, value: redact(out.value, readPolicy(rule, auth.perms)), version: out.version, updatedAt: out.updatedAt }
}

export default async function routes(app: FastifyInstance, opts: { handlers?: KvHandlers }) {
  // players/transactions são deste módulo; os demais domínios vêm de app.ts
  const handlers: KvHandlers = { ...playersKv, ...transactionsKv, ...(opts.handlers ?? {}) }

  const handlerFor = (rule: KvRule): KvHandler => {
    if (!rule.domain) return genericHandler
    const h = handlers[rule.domain]
    if (!h) throw notImplemented()
    return h
  }

  app.get('/:key', async (req, reply) => {
    const { auth, key, rule } = resolve(req)
    if (!canReadKey(rule, auth.perms)) throw Errors.forbidden('Seu cargo não pode ver estes dados.')
    const ctx: KvContext = { app, req, auth, key, rule }
    const out = await handlerFor(rule).read(ctx)
    reply.header('cache-control', 'no-store')
    // nunca gravada: 200 com stored=false (o painel usa o valor padrão dele)
    if (!out) return { key, value: null, version: 0, updatedAt: null, stored: false } satisfies KvGetResponse
    return { ...respond(key, out, rule, auth), stored: true }
  })

  app.put('/:key', { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { auth, key, rule } = resolve(req)
    if (!canWriteKey(rule, auth.perms)) {
      throw Errors.forbidden(rule.write === 'servidor' ? 'Estes dados são gravados só pelo servidor.' : 'Seu cargo não pode alterar estes dados.')
    }
    const handler = handlerFor(rule)
    if (!handler.write) throw Errors.forbidden('Estes dados não podem ser alterados pela tela.')
    const body = putBody.parse(req.body)
    assertStorableJson(body.value)
    const ctx: KvContext = { app, req, auth, key, rule }
    const out = await handler.write(ctx, body.value, body.version ?? undefined)
    reply.header('cache-control', 'no-store')
    return { ...respond(key, out, rule, auth), stored: true }
  })
}
