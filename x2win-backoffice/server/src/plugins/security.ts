// Proteções de toda requisição: cabeçalhos, CORS, limite de taxa, CSRF e
// lista de IPs permitidos do painel.
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance } from 'fastify'
import fp from './fp'
import { SECURITY } from '../config'
import { Errors } from '../errors'
import { ipAllowed, normalizeIp } from '../lib/ip'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

let allowlistCache: { at: number; list: { value: string }[] } | null = null

/** Limpa o cache da lista de IPs (chamar depois de alterar a segurança do painel). */
export function invalidateAllowlistCache() {
  allowlistCache = null
}

async function loadAllowlist(app: FastifyInstance) {
  if (allowlistCache && Date.now() - allowlistCache.at < 5000) return allowlistCache.list
  const row = await app.db.one<{ allowlist: { value: string }[] }>('select allowlist from panel_security where id = 1')
  allowlistCache = { at: Date.now(), list: row?.allowlist ?? [] }
  return allowlistCache.list
}

export default fp(async function security(app: FastifyInstance) {
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } })
  const origins = app.config.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
  if (origins.length) {
    await app.register(cors, { origin: origins, credentials: true, methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['content-type', SECURITY.csrfHeader] })
  }
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute', keyGenerator: (req) => req.clientIp || req.ip })

  app.addHook('onRequest', async (req) => {
    req.clientIp = normalizeIp(req.ip)
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/health')) return
    // CSRF: o cookie é SameSite=Strict e toda escrita exige o cabeçalho do painel
    if (!SAFE_METHODS.has(req.method) && req.headers[SECURITY.csrfHeader] !== SECURITY.csrfValue) throw Errors.csrf()
    const list = await loadAllowlist(app)
    if (!ipAllowed(req.clientIp, list)) throw Errors.ipBlocked()
  })
})
