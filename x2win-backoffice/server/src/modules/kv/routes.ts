// Rota genérica de dados por chave: /api/kv/:key (GET e PUT), aplicando o
// registro shared/kv-registry.ts, mascaramento de segredos/dados pessoais e
// controle de versão. Chaves de domínio são delegadas aos módulos.
//
// Também aqui, por serem ações sobre chaves deste módulo:
//  - GET /api/kv/:key/history e /api/kv/:key/history/:entry: versões guardadas das
//    chaves com `history` (quem lê a chave e vê a Auditoria);
//  - POST /api/kv/afiliados.saques/:id/pay|reject (affiliate-withdrawals.ts);
//  - POST /api/kv/operacao.depositos/recheck (deposits.ts);
//  - POST /api/kv/geral.jogadores/import e /api/kv/geral.transacoes/import
//    (Superadmin com 2FA; players.ts e transactions.ts).
// Leitura com dados pessoais em claro (quem tem a permissão de revelar) fica na
// auditoria do servidor ('revelar'), uma vez por sessão e chave a cada 10 minutos.
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { canReadKey, canWriteKey, findKvRule, isLocalOnlyKey, type KvRule } from '@shared/kv-registry'
import type { KvGetResponse } from '@shared/api'
import { AppError, Errors } from '../../errors'
import { requireActive } from '../../http'
import type { KvContext, KvHandler, KvHandlers, KvValue } from '../../kv/types'
import { writeAudit } from '../../services/audit'
import type { AuthContext } from '../../types'
import { registerAffiliateWithdrawalRoutes } from './affiliate-withdrawals'
import { kvHandlers as affiliatesKv } from './affiliates'
import { registerDepositRoutes } from './deposits'
import { auditEntity, genericHandler } from './generic'
import { kvHandlers as ggrKv } from './ggr'
import { assertStorableJson } from './json'
import { kvHandlers as playersKv, registerPlayerImportRoute } from './players'
import { readPolicy, redact } from './redact'
import { kvHandlers as statusHistoryKv } from './status-history'
import { decodeRow, encryptAtRest, encryptPlainRows, HISTORY_ENTRY, historyBaseKey, listHistory, loadHistory } from './store'
import { kvHandlers as transactionsKv, registerTransactionImportRoute } from './transactions'

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

/** Gravações por pessoa por minuto (além do limite por IP da rota). */
export const PUT_PER_USER_PER_MINUTE = 240
/** Intervalo em que a leitura em claro da mesma chave pela mesma sessão gera um só registro. */
export const PII_READ_AUDIT_WINDOW_MS = 10 * 60_000

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

/** Quantos registros o valor tem (lista) — para o resumo da auditoria. */
function countOf(v: unknown) {
  return Array.isArray(v) ? v.length : v && typeof v === 'object' ? 1 : 0
}

export default async function routes(app: FastifyInstance, opts: { handlers?: KvHandlers }) {
  // players/transactions/player-status/affiliates/ggr são deste módulo; os demais domínios vêm de app.ts
  const handlers: KvHandlers = { ...playersKv, ...transactionsKv, ...statusHistoryKv, ...affiliatesKv, ...ggrKv, ...(opts.handlers ?? {}) }

  // leitura com dados pessoais em claro: um registro por sessão e chave a cada PII_READ_AUDIT_WINDOW_MS
  const piiReads = new Map<string, number>()
  async function auditPiiRead(auth: AuthContext, key: string, rule: KvRule, value: unknown, what = 'leitura') {
    if (!rule.pii || readPolicy(rule, auth.perms).pii) return
    const now = Date.now()
    const mark = `${auth.sessionId}:${key}:${what}`
    const last = piiReads.get(mark)
    if (last !== undefined && now - last < PII_READ_AUDIT_WINDOW_MS) return
    if (piiReads.size > 10_000) for (const [k, at] of piiReads) if (now - at >= PII_READ_AUDIT_WINDOW_MS) piiReads.delete(k)
    piiReads.set(mark, now)
    const n = countOf(value)
    await writeAudit(app.db, auth, {
      action: 'revelar',
      entity: auditEntity(rule.page),
      summary: `${key} — ${what} com dados pessoais completos (${n} ${n === 1 ? 'registro' : 'registros'})`,
    })
  }

  // gravações por pessoa (contador simples por minuto, em memória)
  const putCounts = new Map<string, { start: number; n: number }>()
  function limitPerUser(auth: AuthContext) {
    const now = Date.now()
    const cur = putCounts.get(auth.user.id)
    if (!cur || now - cur.start >= 60_000) {
      if (putCounts.size > 10_000) for (const [k, v] of putCounts) if (now - v.start >= 60_000) putCounts.delete(k)
      putCounts.set(auth.user.id, { start: now, n: 1 })
      return
    }
    cur.n++
    if (cur.n > PUT_PER_USER_PER_MINUTE) throw new AppError(429, 'muitas_tentativas', 'Muitas gravações em pouco tempo. Aguarde um minuto e tente de novo.')
  }

  // chaves que passaram a exigir cifra (ganharam `pii`/`secrets`) e ainda têm linhas em claro
  // (linhas de histórico seguem a regra da chave de origem)
  app.addHook('onReady', async () => {
    try {
      const n = await encryptPlainRows(app.db, app.cipher, (rowKey) => {
        const rule = findKvRule(historyBaseKey(rowKey) ?? rowKey)
        return !!rule && encryptAtRest(rule)
      })
      if (n) app.log.info({ rows: n }, 'kv: linhas em claro cifradas em repouso')
    } catch (err) {
      app.log.error({ err }, 'kv: falha ao cifrar linhas em claro')
    }
  })

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
    await auditPiiRead(auth, key, rule, out.value)
    return { ...respond(key, out, rule, auth), stored: true }
  })

  // histórico das chaves com `history`: quem lê a chave e vê a Auditoria
  const historyAccess = (req: FastifyRequest) => {
    const r = resolve(req)
    if (!canReadKey(r.rule, r.auth.perms) || !r.auth.perms.has('auditoria.ver')) throw Errors.forbidden('Seu cargo não pode ver o histórico destes dados.')
    if (!r.rule.history) throw new AppError(404, 'sem_historico', 'Esta chave não guarda histórico de versões.')
    return r
  }

  app.get('/:key/history', async (req, reply) => {
    const { key } = historyAccess(req)
    reply.header('cache-control', 'no-store')
    return { key, entries: await listHistory(app.db, key) }
  })

  app.get('/:key/history/:entry', async (req, reply) => {
    const { auth, key, rule } = historyAccess(req)
    const entry = (req.params as { entry?: unknown }).entry
    const row = typeof entry === 'string' && HISTORY_ENTRY.test(entry) ? await loadHistory(app.db, key, entry) : null
    if (!row) throw Errors.notFound('Versão')
    const value = decodeRow(row, app.cipher)
    await auditPiiRead(auth, key, rule, value, `versão ${entry as string} lida`)
    reply.header('cache-control', 'no-store')
    return { key, entry, version: row.version, updatedAt: row.updated_at, value: redact(value, readPolicy(rule, auth.perms)) }
  })

  registerAffiliateWithdrawalRoutes(app)
  registerDepositRoutes(app)
  registerPlayerImportRoute(app)
  registerTransactionImportRoute(app)

  app.put('/:key', { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { auth, key, rule } = resolve(req)
    if (!canWriteKey(rule, auth.perms)) {
      throw Errors.forbidden(rule.write === 'servidor' ? 'Estes dados são gravados só pelo servidor.' : 'Seu cargo não pode alterar estes dados.')
    }
    limitPerUser(auth)
    const handler = handlerFor(rule)
    if (!handler.write) throw Errors.forbidden('Estes dados não podem ser alterados pela tela.')
    const body = putBody.parse(req.body)
    assertStorableJson(body.value)
    const ctx: KvContext = { app, req, auth, key, rule }
    const out = await handler.write(ctx, body.value, body.version ?? undefined)
    // a resposta devolve o valor gravado (em claro para quem revela): conta como leitura
    await auditPiiRead(auth, key, rule, out.value)
    reply.header('cache-control', 'no-store')
    return { ...respond(key, out, rule, auth), stored: true }
  })
}
