// Garante o mínimo para o primeiro acesso: cargos do sistema e o Superadmin.
import type { FastifyInstance } from 'fastify'
import { seedRoles } from '@shared/permissions'
import { hashPassword, newId, passwordProblem } from './lib/crypto'
import { SECURITY } from './config'
import { toCents } from './services/roles-repo'

/** Insere os cargos que ainda não existem (não altera os existentes). */
export async function ensureRoles(app: FastifyInstance) {
  for (const r of seedRoles()) {
    await app.db.query(
      `insert into roles (id, name, description, system, permissions, require_2fa, approval_ceiling_cents, color)
       values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do nothing`,
      [r.id, r.name, r.description, r.system, r.permissions, r.require2fa, toCents(r.approvalCeiling), r.color],
    )
  }
  // o Superadmin sempre tem todas as permissões do catálogo atual (inclusive as novas)
  const all = seedRoles().find((r) => r.id === 'superadmin')!.permissions
  await app.db.query('update roles set permissions = $1, approval_ceiling_cents = null where id = $2', [all, 'superadmin'])
}

/** Cria o Superadmin a partir de ADMIN_EMAIL/ADMIN_PASSWORD se ainda não houver ninguém. */
export async function ensureAdmin(app: FastifyInstance): Promise<'criado' | 'existente' | 'sem-credenciais'> {
  const count = await app.db.one<{ n: number }>('select count(*)::int as n from users')
  if ((count?.n ?? 0) > 0) return 'existente'
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = app.config
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return 'sem-credenciais'
  const problem = passwordProblem(ADMIN_PASSWORD, SECURITY.passwordMinLength)
  if (problem) throw new Error(`ADMIN_PASSWORD fraca: ${problem}`)
  await app.db.query(
    `insert into users (id, name, email, role_id, status, password_hash) values ($1, $2, lower($3), 'superadmin', 'ativo', $4)`,
    [newId('u'), ADMIN_NAME, ADMIN_EMAIL, await hashPassword(ADMIN_PASSWORD)],
  )
  return 'criado'
}

export async function bootstrap(app: FastifyInstance) {
  await ensureRoles(app)
  const admin = await ensureAdmin(app)
  if (admin === 'criado') app.log.info('Superadmin criado a partir de ADMIN_EMAIL. No primeiro login será pedido o 2FA.')
  if (admin === 'sem-credenciais') app.log.warn('Nenhum usuário cadastrado: defina ADMIN_EMAIL e ADMIN_PASSWORD e reinicie para criar o Superadmin.')
}
