// Carrega a sessão do cookie em cada requisição e monta req.auth
// (pessoa, cargo, permissões, etapa do login). Também barra, antes de o corpo ser lido, as escritas sem sessão.
import cookie from '@fastify/cookie'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { effectivePermissions } from '@shared/permissions'
import { SECURITY } from '../config'
import { AppError, Errors } from '../errors'
import { sha256 } from '../lib/crypto'
import { rowToRole, type RoleRow } from '../services/roles-repo'
import { revokeSession, sessionEndReason } from '../services/sessions'
import type { AuthContext, SessionStage } from '../types'
import fp from './fp'

interface SessionJoin {
  session_id: string
  stage: SessionStage
  last_seen_at: string
  expires_at: string
  user_id: string
  name: string
  email: string
  status: 'ativo' | 'desligado' | 'convidado'
  totp_enabled: boolean
  must_change_password: boolean
  role: RoleRow
  timeout: number
  enforce_all: boolean
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Escritas aceitas sem sessão: login, saída (um cookie vencido também precisa sair) e aceite de convite.
 * Qualquer outra escrita sem sessão (inclusive para rota inexistente) recebe 401 antes de o corpo ser lido.
 * Rota pública nova que recebe corpo entra aqui (o padrão registrado, com o prefixo).
 */
export const PUBLIC_WRITE_ROUTES: ReadonlySet<string> = new Set(['/api/auth/login', '/api/auth/logout', '/api/team/invites/accept'])

/**
 * Maior corpo aceito antes do login completo (sem sessão ou em etapa pendente). Login, aceite de convite e as
 * etapas do 2FA e da troca de senha mandam menos de 1 KB; o bodyLimit da API vale só para sessão ativa.
 */
export const PRE_AUTH_BODY_LIMIT = 16 * 1024

const preAuthErrors = {
  tooLarge: () => new AppError(413, 'corpo_grande_demais', 'Os dados enviados passam do tamanho permitido.'),
  lengthRequired: () => new AppError(411, 'requisicao_invalida', 'Envie o corpo da requisição com o tamanho (Content-Length).'),
}

/** Tamanho que o cliente declarou para o corpo; 'desconhecido' quando vem em partes (Transfer-Encoding). */
function declaredBodyLength(req: FastifyRequest): number | 'desconhecido' {
  // o Node recusa Transfer-Encoding junto com Content-Length (400), então só um dos dois chega aqui
  if (req.headers['transfer-encoding'] !== undefined) return 'desconhecido'
  const cl = req.headers['content-length']
  return cl === undefined ? 0 : Number(cl)
}

/**
 * Recusa sem ler o corpo. Corpo que nunca seria aceito (em partes ou acima do limite) também fecha a conexão,
 * para o cliente não continuar despejando bytes nela (o Fastify faz o mesmo no 413 do bodyLimit). Corpo dentro
 * do limite é descartado pelo Node sem parse, e a conexão continua (proxy na frente recebe a resposta inteira).
 */
function refuseUnread(reply: FastifyReply, declared: number | 'desconhecido', limit: number, err: AppError): never {
  if (declared === 'desconhecido' || declared > limit) reply.header('connection', 'close')
  throw err
}

export default fp(async function session(app: FastifyInstance) {
  await app.register(cookie, { secret: app.config.APP_SECRET })

  app.addHook('onRequest', async (req) => {
    req.auth = null
    req.sessionEnded = null
    const token = req.cookies[SECURITY.sessionCookie]
    if (!token || token.length > 200) return
    const id = sha256(token)
    const row = await app.db.one<SessionJoin>(
      `select s.id as session_id, s.stage, s.last_seen_at, s.expires_at,
              u.id as user_id, u.name, u.email, u.status, u.totp_enabled, u.must_change_password,
              to_jsonb(r.*) as role,
              (select session_timeout_minutes from panel_security where id = 1) as timeout,
              coalesce((select enforce_2fa_all from panel_security where id = 1), false) as enforce_all
         from sessions s
         join users u on u.id = s.user_id
         join roles r on r.id = u.role_id
        where s.id = $1 and s.revoked_at is null and s.expires_at > now()`,
      [id],
    )
    if (!row || row.status !== 'ativo') {
      // cookie de uma sessão que já não vale: o motivo vai no 401 (details.reason) e em GET /api/auth/session
      req.sessionEnded = await sessionEndReason(app.db, id)
      return
    }
    // inatividade: sessão ativa parada além do tempo configurado cai
    if (row.stage === 'active' && Date.now() - new Date(row.last_seen_at).getTime() > row.timeout * 60_000) {
      await revokeSession(app.db, id, 'inatividade')
      req.sessionEnded = 'inatividade'
      return
    }
    const role = rowToRole(row.role)
    // exigência de 2FA conferida a cada requisição, não só no login: se ela passou a valer depois que a
    // sessão ficou ativa (troca de cargo, "Exigir 2FA" no cargo, "2FA para todos", cargo forçado na
    // subida) e a pessoa não tem 2FA, a sessão cai. Encerrar, e não rebaixar para 'enroll': uma sessão
    // rebaixada cadastraria o autenticador sem a senha, então um cookie roubado ficaria com o fator.
    // No próximo login (senha conferida de novo) a pessoa cai no cadastro do 2FA.
    if (row.stage === 'active' && !row.totp_enabled && (role.require2fa || row.enforce_all)) {
      // o motivo diz de onde veio a exigência: o cargo, ou "2FA de todos" em Segurança do painel
      const reason = role.require2fa ? '2fa_exigido' : '2fa_exigido_todos'
      await revokeSession(app.db, id, reason)
      req.sessionEnded = reason
      return
    }
    const ctx: AuthContext = {
      user: {
        id: row.user_id,
        name: row.name,
        email: row.email,
        roleId: role.id,
        status: row.status,
        totpEnabled: row.totp_enabled,
        mustChangePassword: row.must_change_password,
      },
      role,
      perms: new Set(effectivePermissions(role)),
      sessionId: row.session_id,
      stage: row.stage,
      ip: req.clientIp,
    }
    req.auth = ctx
    // atualiza o "visto por último" no máximo 1 vez por minuto
    if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) {
      await app.db.query('update sessions set last_seen_at = now() where id = $1', [id])
    }
  })

  // Antes de ler o corpo. O preParsing roda depois de todos os onRequest (CSRF, lista de IPs, sessão acima e o
  // limite de taxa da rota, que assim também conta estas recusas) e antes do parser: um corpo grande de quem não
  // tem sessão nunca é lido nem passa pelo JSON.parse, que travaria a única thread do Node. As guardas das rotas
  // (requireActive/requirePerm) só rodam depois do parse, então não servem para isto.
  app.addHook('preParsing', async (req, reply, payload) => {
    if (SAFE_METHODS.has(req.method) || req.auth?.stage === 'active') return payload
    const declared = declaredBodyLength(req)
    if (!req.auth && !PUBLIC_WRITE_ROUTES.has(req.routeOptions.url ?? '')) {
      refuseUnread(reply, declared, req.routeOptions.bodyLimit ?? app.initialConfig.bodyLimit ?? 0, Errors.unauthenticated())
    }
    // rota pública ou etapa pendente do login: só corpo pequeno e de tamanho declarado
    if (declared === 'desconhecido') refuseUnread(reply, declared, PRE_AUTH_BODY_LIMIT, preAuthErrors.lengthRequired())
    if (declared > PRE_AUTH_BODY_LIMIT) refuseUnread(reply, declared, PRE_AUTH_BODY_LIMIT, preAuthErrors.tooLarge())
    return payload
  })
})
