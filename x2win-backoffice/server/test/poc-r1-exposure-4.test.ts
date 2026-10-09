// PoC r1-exposure-4: a chave auditoria.registros devolve a trilha de auditoria inteira
// (IPs de login da equipe, e-mails da equipe, nomes de jogadores e valores de saque)
// para cargos sem auditoria.ver que só têm modo-ataque.ver / mcp.ver / seguranca-painel.ver.
// Os testes afirmam o comportamento SEGURO e falham enquanto o problema existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { newId } from '../src/lib/crypto'
import { api, cookieFrom, createTestApp, createUser, loginAs } from './helpers'

const ADMIN_IP = '203.0.113.77'
const NEW_EMAIL = 'nova.pessoa.poc@x2win.bet.br'
const PLAYER = 'Joana Pereira Poc'

describe('poc r1-exposure-4: auditoria.registros sem filtro para leitores secundários', () => {
  let app: FastifyInstance
  let adminCookie: string
  let adminId: string
  const viewers: Record<string, string> = {}

  beforeAll(async () => {
    app = await createTestApp()

    // Superadmin faz login de verdade a partir de um IP público (grava last_ip e auditoria 'login')
    const admin = await createUser(app, { roleId: 'superadmin', name: 'Admin Real', password: 'SenhaForte2026x' })
    adminId = admin.id
    const login = await api(app, 'POST', '/api/auth/login', { ip: ADMIN_IP, body: { email: admin.email, password: admin.password } })
    expect(login.statusCode, login.body).toBe(200)
    expect(login.json().stage).toBe('active')
    adminCookie = cookieFrom(login)!

    // Ação de Equipe: cria acesso direto (resumo traz o e-mail)
    const direct = await api(app, 'POST', '/api/team/direct', {
      cookie: adminCookie,
      ip: ADMIN_IP,
      body: { name: 'Nova Pessoa', email: NEW_EMAIL, roleId: 'suporte' },
    })
    expect(direct.statusCode, direct.body).toBe(200)

    // Ação de Saques: aprovação real (resumo traz nome do jogador e valor)
    const wid = newId('SQ')
    await app.db.query(
      `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                                risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
       values ($1, 'p1', $2, 'joana@exemplo.com', 123456, 0, 'pendente', 'baixo', 10, '["x"]'::jsonb, 'CPF', $3, 'E1', now(), now())`,
      [wid, PLAYER, app.cipher.encrypt('12345678909')],
    )
    const appr = await api(app, 'POST', `/api/withdrawals/${wid}/approve`, { cookie: adminCookie, ip: ADMIN_IP })
    expect(appr.statusCode, appr.body).toBe(200)

    // Cargos personalizados de leitura (sem auditoria.ver e sem equipe.ver)
    for (const perm of ['modo-ataque.ver', 'mcp.ver', 'seguranca-painel.ver']) {
      const roleId = `so-${perm.replace('.ver', '')}`
      await app.db.query('insert into roles (id, name, permissions) values ($1, $2, $3)', [roleId, roleId, [perm]])
      viewers[perm] = (await loginAs(app, roleId)).cookie
    }
  })
  afterAll(async () => app.close())

  for (const perm of ['modo-ataque.ver', 'mcp.ver', 'seguranca-painel.ver']) {
    describe(`cargo só com ${perm}`, () => {
      it('controle: GET /api/audit é 403 (sem auditoria.ver)', async () => {
        const r = await api(app, 'GET', '/api/audit', { cookie: viewers[perm] })
        console.log(`[${perm}] GET /api/audit -> ${r.statusCode}`)
        expect(r.statusCode).toBe(403)
      })

      it('controle: equipe.membros esconde o lastIp (sem equipe.ver)', async () => {
        const r = await api(app, 'GET', '/api/kv/equipe.membros', { cookie: viewers[perm] })
        expect(r.statusCode).toBe(200)
        const me = (r.json().value as { id: string; lastIp: string | null }[]).find((m) => m.id === adminId)
        console.log(`[${perm}] equipe.membros admin.lastIp -> ${JSON.stringify(me?.lastIp)}`)
        expect(me?.lastIp).toBeNull()
        expect(r.body).not.toContain(ADMIN_IP)
      })

      it('auditoria.registros não deve expor IP de login, e-mail da equipe nem dados de saques', async () => {
        const r = await api(app, 'GET', '/api/kv/auditoria.registros', { cookie: viewers[perm] })
        const list = r.statusCode === 200 ? (r.json().value as { action: string; entity: string; summary: string; ip: string }[]) : []
        console.log(`[${perm}] GET /api/kv/auditoria.registros -> ${r.statusCode}, ${list.length} registros`)
        for (const e of list) console.log(`   ${e.action} | ${e.entity} | ${e.summary} | ip=${e.ip}`)
        // comportamento seguro: ou 403, ou só a fatia da tela (sem IPs/PII de outras áreas)
        expect(r.body).not.toContain(ADMIN_IP)
        expect(r.body).not.toContain(NEW_EMAIL)
        expect(r.body).not.toContain(PLAYER)
      })
    })
  }
})
