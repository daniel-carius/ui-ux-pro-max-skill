// Dados de demonstração deste módulo (usados por src/seed.ts quando DEMO_DATA=true).
// Cria a equipe de demonstração do painel (exceto e-mails já cadastrados), cada
// pessoa com uma senha temporária aleatória e troca obrigatória no 1º acesso.
import type { FastifyInstance } from 'fastify'
import { seedTeam } from '@/data/team'
import { hashPassword, newId } from '../../lib/crypto'
import { writeAudit } from '../../services/audit'
import { strongTemporaryPassword, withTeamLock } from './service'

export async function seedDemo(app: FastifyInstance): Promise<string> {
  const demo = seedTeam()
  const existing = new Set(
    (await app.db.query<{ email: string }>('select lower(email) as email from users')).map((r) => r.email),
  )
  const roles = new Set((await app.db.query<{ id: string }>('select id from roles')).map((r) => r.id))
  // o Superadmin real vem de ADMIN_EMAIL: não cria um segundo de demonstração
  const hasSuperadmin = !!(await app.db.one(`select 1 from users where role_id = 'superadmin' and status = 'ativo'`))
  const skipped: string[] = []
  const prepared: { m: (typeof demo)[number]; password: string; hash: string }[] = []
  for (const m of demo) {
    const email = m.email.toLowerCase()
    if (existing.has(email)) {
      skipped.push(`${email} (já cadastrado)`)
      continue
    }
    if (m.roleId === 'superadmin' && hasSuperadmin) {
      skipped.push(`${email} (já existe um Superadmin)`)
      continue
    }
    if (!roles.has(m.roleId)) {
      skipped.push(`${email} (cargo ${m.roleId} não existe)`)
      continue
    }
    existing.add(email)
    const password = strongTemporaryPassword()
    prepared.push({ m: { ...m, email }, password, hash: await hashPassword(password) })
  }
  if (!prepared.length) return skipped.length ? `nada a semear; ignorados: ${skipped.join(', ')}` : 'nada a semear'

  await withTeamLock(app.db, null, async (t) => {
    for (const { m, hash } of prepared) {
      // mantém o id do painel quando livre (a auditoria de demonstração usa esses ids)
      const taken = await t.one('select id from users where id = $1', [m.id])
      const id = taken ? newId('u') : m.id
      // 2FA começa desligado: quem tiver cargo que exige cadastra no 1º acesso
      await t.query(
        `insert into users (id, name, email, role_id, status, password_hash, must_change_password, last_access_at, last_ip, created_at)
         values ($1, $2, $3, $4, $5, $6, true, $7, $8, $9)`,
        [id, m.name, m.email, m.roleId, m.status === 'desligado' ? 'desligado' : 'ativo', hash, m.lastAccess, m.lastIp, m.createdAt],
      )
    }
    await writeAudit(
      t,
      { id: null, name: 'Sistema', ip: '' },
      { action: 'criar', entity: 'Equipe', summary: `Equipe de demonstração criada: ${prepared.map((p) => p.m.email).join(', ')}.` },
    )
  })

  const lines = prepared.map(({ m, password }) => `  - ${m.email}: ${password}${m.status === 'desligado' ? ' (desligado)' : ''}`)
  return [
    `${prepared.length} ${prepared.length === 1 ? 'pessoa criada' : 'pessoas criadas'} na equipe. Senhas temporárias (mostradas só agora; troca obrigatória no 1º acesso):`,
    ...lines,
    ...(skipped.length ? [`  Ignorados: ${skipped.join(', ')}`] : []),
  ].join('\n')
}
