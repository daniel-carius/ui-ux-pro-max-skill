// Garante o mínimo para o primeiro acesso: cargos do sistema e o Superadmin.
import type { FastifyInstance } from 'fastify'
import { INSTALL_REQUIRE_2FA_ROLE_IDS, seedRoles, SUPERADMIN_ROLE_ID } from '@shared/permissions'
import { hashPassword, newId, passwordProblem } from './lib/crypto'
import { SECURITY } from './config'
import { toCents } from './services/roles-repo'
import { writeAudit } from './services/audit'
import { computeStage } from './modules/auth/service'
import { resetAllowlistFromEnv } from './modules/panel-security/kv'

/**
 * Cria os cargos que faltam, sem alterar nem recriar os que a operação mexeu.
 *  - Cargos do sistema (não podem ser excluídos nem renomeados) entram em todo boot: assim um cargo do sistema
 *    novo de uma versão nova aparece nas instalações antigas.
 *  - Cargos personalizados da semente ('adm', 'marketing') só entram na instalação nova (tabela de cargos vazia):
 *    depois disso são da operação, que pode excluí-los e reaproveitar o nome.
 *  - Conflito de id ou de nome (roles_name_uq) é pulado com aviso, nunca derruba a subida.
 */
export async function ensureRoles(app: FastifyInstance) {
  const count = await app.db.one<{ n: number }>('select count(*)::int as n from roles')
  const firstBoot = (count?.n ?? 0) === 0
  for (const r of seedRoles()) {
    if (!r.system && !firstBoot) continue
    // sem alvo no "on conflict": vale para o id e para o nome (lower(name))
    const inserted = await app.db.query<{ id: string }>(
      `insert into roles (id, name, description, system, permissions, require_2fa, approval_ceiling_cents, color)
       values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing returning id`,
      [r.id, r.name, r.description, r.system, r.permissions, r.require2fa, toCents(r.approvalCeiling), r.color],
    )
    if (inserted.length) continue
    const sameId = await app.db.one('select 1 from roles where id = $1', [r.id])
    if (!sameId) {
      const clash = await app.db.one<{ id: string; name: string }>('select id, name from roles where lower(name) = lower($1)', [r.name])
      app.log.warn(
        { role: r.id, conflictsWith: clash?.id ?? null },
        `Cargo do sistema "${r.name}" não foi criado: já existe o cargo "${clash?.name ?? r.name}" com o mesmo nome. Renomeie esse cargo e reinicie.`,
      )
    }
  }
  // o Superadmin sempre tem todas as permissões do catálogo atual (inclusive as novas)
  const all = seedRoles().find((r) => r.id === SUPERADMIN_ROLE_ID)!.permissions
  await app.db.query('update roles set permissions = $1, approval_ceiling_cents = null where id = $2', [all, SUPERADMIN_ROLE_ID])
}

/**
 * O Superadmin (acesso total, concede cargos, lista de IPs, saques) sempre exige 2FA. Aplicado em toda subida,
 * inclusive numa instalação antiga ou numa linha que um backup restaurado ou uma migração deixou sem a exigência.
 * Quem já está com sessão aberta sem 2FA é levado ao cadastro no próximo login.
 */
export async function enforceSuperadmin2fa(app: FastifyInstance): Promise<boolean> {
  const changed = await app.db.query<{ name: string }>('update roles set require_2fa = true where id = $1 and not require_2fa returning name', [SUPERADMIN_ROLE_ID])
  if (!changed.length) return false
  await writeAudit(
    app.db,
    { id: null, name: 'Sistema', ip: '' },
    { action: 'editar', entity: `Cargo ${changed[0].name}`, summary: '2FA passou a ser exigido (o cargo Superadmin sempre exige 2FA).' },
  )
  app.log.warn('O cargo Superadmin estava sem exigência de 2FA: exigência ligada. Quem não tem 2FA cadastra no próximo login.')
  return true
}

/** Cria o Superadmin a partir de ADMIN_EMAIL/ADMIN_PASSWORD se ainda não houver ninguém. */
export async function ensureAdmin(app: FastifyInstance): Promise<'criado' | 'existente' | 'sem-credenciais'> {
  const count = await app.db.one<{ n: number }>('select count(*)::int as n from users')
  if ((count?.n ?? 0) > 0) return 'existente'
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = app.config
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return 'sem-credenciais'
  const problem = passwordProblem(ADMIN_PASSWORD, SECURITY.passwordMinLength)
  if (problem) throw new Error(`ADMIN_PASSWORD fraca: ${problem}`)
  const hash = await hashPassword(ADMIN_PASSWORD)
  await app.db.tx(async (t) => {
    // instalação nova: os cargos de acesso total e de aprovação de saques já nascem exigindo 2FA
    await t.query('update roles set require_2fa = true where id = any($1::text[])', [[...INSTALL_REQUIRE_2FA_ROLE_IDS]])
    await t.query(`insert into users (id, name, email, role_id, status, password_hash) values ($1, $2, lower($3), $5, 'ativo', $4)`, [
      newId('u'),
      ADMIN_NAME,
      ADMIN_EMAIL,
      hash,
      SUPERADMIN_ROLE_ID,
    ])
  })
  return 'criado'
}

/** Avisa no log o que o primeiro login do Superadmin criado vai pedir (calculado, nunca prometido). */
async function logCreatedAdmin(app: FastifyInstance) {
  const row = await app.db.one<{ id: string }>('select id from users where lower(email) = lower($1)', [app.config.ADMIN_EMAIL])
  const stage = row ? await computeStage(app.db, row.id) : null
  if (stage === 'enroll') {
    app.log.info('Superadmin criado a partir de ADMIN_EMAIL. No primeiro login será pedido o 2FA.')
  } else if (stage === 'password') {
    app.log.info('Superadmin criado a partir de ADMIN_EMAIL. No primeiro login será pedida a troca de senha.')
  } else {
    app.log.warn('Superadmin criado a partir de ADMIN_EMAIL SEM exigência de 2FA: ligue o 2FA no cargo ou em Segurança do painel.')
  }
}

export async function bootstrap(app: FastifyInstance, env: NodeJS.ProcessEnv = process.env) {
  await ensureRoles(app)
  const admin = await ensureAdmin(app)
  await enforceSuperadmin2fa(app)
  if (admin === 'criado') await logCreatedAdmin(app)
  if (admin === 'sem-credenciais') app.log.warn('Nenhum usuário cadastrado: defina ADMIN_EMAIL e ADMIN_PASSWORD e reinicie para criar o Superadmin.')
  // recuperação de acesso (lista de IPs que deixou todos de fora), controlada só por quem opera o servidor
  await resetAllowlistFromEnv(app, env.PANEL_ALLOWLIST_RESET)
}
