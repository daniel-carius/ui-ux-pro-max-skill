// Tipos de contexto compartilhados pelos módulos do servidor.
import type { SessionEndReason } from '@shared/api'
import type { Role } from '@shared/permissions'
import type { Config } from './config'
import type { Db } from './db'
import type { Cipher } from './lib/crypto'

export type SessionStage = 'password' | 'enroll' | '2fa' | 'active'

export interface AuthUser {
  id: string
  name: string
  email: string
  roleId: string
  status: 'ativo' | 'desligado' | 'convidado'
  totpEnabled: boolean
  mustChangePassword: boolean
}

export interface AuthContext {
  user: AuthUser
  role: Role
  perms: Set<string>
  sessionId: string
  stage: SessionStage
  ip: string
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Db
    config: Config
    cipher: Cipher
  }
  interface FastifyRequest {
    /** preenchido pelo plugin de sessão quando há cookie válido (qualquer etapa) */
    auth: AuthContext | null
    /** IP real do cliente (considera TRUST_PROXY) */
    clientIp: string
    /** cookie de uma sessão que terminou: o motivo (null sem cookie, com sessão válida ou sem motivo) */
    sessionEnded: SessionEndReason | null
  }
}
