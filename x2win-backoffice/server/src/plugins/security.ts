// Proteções de toda requisição: cabeçalhos (inclusive Cache-Control), CORS, limite de taxa, CSRF e
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
/** Rotas públicas, fora das checagens abaixo (o HEALTHCHECK do contêiner chama a API direto, sem proxy). */
const PUBLIC_ROUTES = new Set(['/api/health'])
/**
 * Fora da lista de IPs (CSRF e HTTPS continuam valendo): a saída só encerra a sessão do próprio cookie, e quem
 * ficou de fora da lista (IP trocado, lista alterada) precisa conseguir sair. Método + padrão registrado da rota.
 */
const ALLOWLIST_EXEMPT = new Set(['POST /api/auth/logout'])

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
  // X-Frame-Options DENY: igual ao do nginx (a API nunca é exibida em frame)
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' }, frameguard: { action: 'deny' } })
  const origins = app.config.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
  if (origins.length) {
    await app.register(cors, { origin: origins, credentials: true, methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['content-type', SECURITY.csrfHeader] })
  }
  await app.register(rateLimit, { global: true, max: app.config.API_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute', keyGenerator: (req) => req.clientIp || req.ip })

  // Atrás do proxy (TRUST_PROXY) e com cookie Secure, só atende o que chegou ao proxy por HTTPS: sem isso a
  // senha, o código do 2FA e o token de sessão emitido no login trafegariam em texto claro.
  const requireHttps = app.config.TRUST_PROXY > 0 && app.config.COOKIE_SECURE

  app.addHook('onRequest', async (req) => {
    req.clientIp = normalizeIp(req.ip)
    // Decide pela rota que o roteador escolheu (o padrão registrado, já com o caminho decodificado), nunca pelo
    // texto cru de req.url: "/%61pi/auth/me" chega na rota /api/auth/me e não pode pular as checagens.
    // Pedido sem rota (404) também passa por elas.
    if (PUBLIC_ROUTES.has(req.routeOptions.url ?? '')) return
    if (requireHttps && req.protocol !== 'https') throw Errors.httpsRequired()
    // CSRF: o cookie é SameSite=Strict e toda escrita exige o cabeçalho do painel
    if (!SAFE_METHODS.has(req.method) && req.headers[SECURITY.csrfHeader] !== SECURITY.csrfValue) throw Errors.csrf()
    if (ALLOWLIST_EXEMPT.has(`${req.method} ${req.routeOptions.url ?? ''}`)) return
    const list = await loadAllowlist(app)
    if (!ipAllowed(req.clientIp, list)) throw Errors.ipBlocked()
  })

  // Nenhuma resposta da API fica em cache do navegador ou de proxy: dados, saúde, 404, erros e rotas futuras.
  // Rota que já definiu o próprio Cache-Control (ex.: exportação da auditoria) fica com o dela.
  app.addHook('onSend', async (_req, reply, payload) => {
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store')
    return payload
  })
})
