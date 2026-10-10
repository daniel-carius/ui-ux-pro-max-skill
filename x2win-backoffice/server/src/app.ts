// Monta a aplicação: plugins de segurança e sessão, rotas dos módulos e
// tratamento de erros. Usado pelo servidor (index.ts) e pelos testes.
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import type { Config } from './config'
import { connectedAsOwner, migrate, openDb, pingDb, useRuntimeRole, type Db } from './db'
import { AppError, type ErrorBody } from './errors'
import { createCipher } from './lib/crypto'
import securityPlugin from './plugins/security'
import sessionPlugin from './plugins/session'
import authRoutes from './modules/auth/routes'
import teamRoutes from './modules/team/routes'
import { kvHandlers as teamKv } from './modules/team/kv'
import { kvHandlers as rolesKv } from './modules/roles/kv'
import { kvHandlers as panelKv } from './modules/panel-security/kv'
import withdrawalRoutes from './modules/withdrawals/routes'
import { kvHandlers as withdrawalKv } from './modules/withdrawals/kv'
import auditRoutes from './modules/audit/routes'
import { kvHandlers as auditKv } from './modules/audit/kv'
import webhookRoutes from './modules/webhooks/routes'
import { kvHandlers as webhookKv } from './modules/webhooks/kv'
import { startWebhookDispatcher } from './modules/webhooks/dispatcher'
import kvRoutes from './modules/kv/routes'
import './types'

/** Maior corpo aceito pelas rotas sem limite próprio (o nginx recusa antes, com client_max_body_size 1m). */
export const BODY_LIMIT = 1024 * 1024

/**
 * Erros de concorrência do Postgres: impasse entre transações (40P01) e falha de serialização (40001). A transação
 * inteira foi desfeita e repetir resolve: para a pessoa é o mesmo que outra gravação ao mesmo tempo.
 */
const PG_CONCURRENCY_CODES = new Set(['40P01', '40001'])

export interface BuildOptions {
  config: Config
  db?: Db
  logger?: boolean
}

export async function buildApp({ config, db, logger = false }: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ? { level: config.NODE_ENV === 'production' ? 'info' : 'debug', redact: ['req.headers.cookie', 'req.headers.authorization'] } : false,
    // confia em N proxies à frente (para ler o IP real em X-Forwarded-For)
    trustProxy: config.TRUST_PROXY > 0 ? (_addr: string, hop: number) => hop < config.TRUST_PROXY : false,
    // 1 MiB para as rotas em geral; imagens (data URL no JSON) e importações têm limite próprio nas rotas de /api/kv
    bodyLimit: BODY_LIMIT,
  })

  const database = db ?? openDb(config.DATABASE_URL)
  // sem o papel de execução a API ainda sobe (com o aviso abaixo); "npm run migrate" é quem falha
  await migrate(database, { requireRuntimeRole: false })
  // depois das migrações a API roda sem ser dona das tabelas (auditoria só com SELECT e INSERT)
  await useRuntimeRole(database)
  if (database.kind === 'postgres' && (await connectedAsOwner(database))) {
    app.log.warn(
      'A API está conectada ao Postgres com o dono das tabelas ou um superusuário: quem tiver essa credencial pode apagar a auditoria. Conecte com o papel x2win_app (veja deploy/db-init) e rode as migrações à parte.',
    )
  }
  app.decorate('db', database)
  app.decorate('config', config)
  app.decorate('cipher', createCipher(config.ENCRYPTION_KEY))
  app.decorateRequest('auth', null)
  app.decorateRequest('clientIp', '')

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      const body: ErrorBody = { error: { code: err.code, message: err.message, details: err.details } }
      return reply.status(err.status).send(body)
    }
    if (err instanceof ZodError) {
      const body: ErrorBody = {
        error: { code: 'dados_invalidos', message: 'Revise os dados enviados.', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      }
      return reply.status(400).send(body)
    }
    const e = err as { statusCode?: number; validation?: unknown; message?: string; code?: string }
    if (e.statusCode === 429) {
      return reply.status(429).send({ error: { code: 'muitas_tentativas', message: 'Muitas tentativas. Aguarde um minuto e tente de novo.' } })
    }
    // corpo acima do bodyLimit (da API ou da rota)
    if (e.statusCode === 413) {
      return reply.status(413).send({ error: { code: 'corpo_grande_demais', message: 'Os dados enviados passam do tamanho permitido.' } })
    }
    if (e.code && PG_CONCURRENCY_CODES.has(e.code)) {
      req.log.warn({ err }, 'conflito de concorrência no banco: transação desfeita')
      const body: ErrorBody = {
        error: { code: 'versao_desatualizada', message: 'Outra pessoa alterou estes dados ao mesmo tempo. Recarregue e tente de novo.' },
      }
      return reply.status(409).send(body)
    }
    if (e.validation || (e.statusCode && e.statusCode >= 400 && e.statusCode < 500)) {
      return reply.status(e.statusCode ?? 400).send({ error: { code: 'requisicao_invalida', message: e.message ?? 'Requisição inválida.' } })
    }
    req.log.error(err)
    return reply.status(500).send({ error: { code: 'erro_interno', message: 'Erro inesperado no servidor. A equipe técnica foi avisada.' } })
  })

  await app.register(securityPlugin)
  await app.register(sessionPlugin)

  // HEALTHCHECK do contêiner (Dockerfile.api) e monitoração externa: 200 só com o banco respondendo em até 2 s
  app.get('/api/health', async (_req, reply) => {
    if (await pingDb(database, 2000)) return { ok: true, db: database.kind }
    return reply.status(503).send({ ok: false, db: database.kind, error: { code: 'banco_indisponivel', message: 'Banco de dados indisponível.' } })
  })

  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(teamRoutes, { prefix: '/api/team' })
  await app.register(withdrawalRoutes, { prefix: '/api/withdrawals' })
  await app.register(auditRoutes, { prefix: '/api/audit' })
  await app.register(webhookRoutes, { prefix: '/api/webhooks' })
  await app.register(kvRoutes, {
    prefix: '/api/kv',
    handlers: { ...teamKv, ...rolesKv, ...panelKv, ...withdrawalKv, ...auditKv, ...webhookKv },
  })

  if (config.WEBHOOK_DISPATCHER === 'on') {
    const stop = startWebhookDispatcher(app)
    app.addHook('onClose', async () => stop())
  }
  app.addHook('onClose', async () => {
    if (!db) await database.close()
  })
  return app
}
