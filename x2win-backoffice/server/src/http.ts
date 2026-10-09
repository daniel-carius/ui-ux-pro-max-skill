// Guardas usadas pelas rotas: sessão ativa e permissões do cargo.
import type { FastifyRequest } from 'fastify'
import { Errors } from './errors'
import type { AuthContext } from './types'

/** Exige sessão com login completo (senha + 2FA quando exigido). */
export function requireActive(req: FastifyRequest): AuthContext {
  const a = req.auth
  if (!a) throw Errors.unauthenticated()
  if (a.stage !== 'active') throw Errors.stage(a.stage)
  return a
}

/** Exige uma das permissões (basta uma). */
export function requirePerm(req: FastifyRequest, ...perms: string[]): AuthContext {
  const a = requireActive(req)
  if (!perms.some((p) => a.perms.has(p))) throw Errors.forbidden()
  return a
}

export function hasPerm(a: AuthContext, perm: string) {
  return a.perms.has(perm)
}
