// Dados de demonstração deste módulo (usados por src/seed.ts quando DEMO_DATA=true).
// Cria a equipe de demonstração do painel (exceto e-mails já cadastrados), cada
// pessoa com uma senha temporária aleatória e troca obrigatória no 1º acesso.
// O nome é genérico pelo cargo ("Demonstração ADM 1"), nunca o de alguém da equipe
// real, e o último IP fica na faixa privada 10.x.
import type { FastifyInstance } from 'fastify'
import { seedTeam } from '@/data/team'
import { hashPassword, newId } from '../../lib/crypto'
import { writeAudit } from '../../services/audit'
import { demoIp } from '../kv/demo-seed'
import { memberNameKeys, strongTemporaryPassword, withTeamLock } from './service'

/** Equipe do painel com nome genérico pelo cargo (numerado quando o cargo se repete) e IP fictício. */
function demoTeam(roleNames: Map<string, string>) {
  const team = seedTeam()
  const perRole = new Map<string, number>()
  for (const m of team) perRole.set(m.roleId, (perRole.get(m.roleId) ?? 0) + 1)
  const seen = new Map<string, number>()
  return team.map((m) => {
    const n = (seen.get(m.roleId) ?? 0) + 1
    seen.set(m.roleId, n)
    const role = roleNames.get(m.roleId) ?? m.roleId
    const name = `Demonstração ${role}${(perRole.get(m.roleId) ?? 0) > 1 ? ` ${n}` : ''}`
    return { ...m, name, lastIp: m.lastIp && demoIp(m.lastIp) }
  })
}

export async function seedDemo(app: FastifyInstance): Promise<string> {
  const roleNames = new Map((await app.db.query<{ id: string; name: string }>('select id, name from roles')).map((r) => [r.id, r.name]))
  const demo = demoTeam(roleNames)
  const existing = new Set(
    (await app.db.query<{ email: string }>('select lower(email) as email from users')).map((r) => r.email),
  )
  // nome exibido é único na equipe (a auditoria identifica a pessoa por ele): não cria xará de quem já existe
  const names = new Set((await app.db.query<{ name: string }>('select name from users')).flatMap((r) => memberNameKeys(r.name)))
  const roles = new Set(roleNames.keys())
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
    if (memberNameKeys(m.name).some((k) => names.has(k))) {
      skipped.push(`${email} (nome ${m.name} já usado)`)
      continue
    }
    existing.add(email)
    for (const k of memberNameKeys(m.name)) names.add(k)
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
