// Verificador (lente: impacto): o nome duplicado engana só a camada de exibição. Mostra o que continua distinguível.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { newId } from '../src/lib/crypto'
import { api, cookieFrom, createTestApp, loginAs } from './helpers'

let app: FastifyInstance
let daniel: Awaited<ReturnType<typeof loginAs>>

async function insertWithdrawal(a: FastifyInstance, cents: number) {
  const id = newId('SQ')
  await a.db.query(
    `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                              risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
     values ($1, 'p1', 'Jogador Teste', 'jogador@exemplo.com', $2, 0, 'pendente', 'baixo', 10, '["motivo"]'::jsonb, 'CPF', $3, 'E123', now(), now())`,
    [id, cents, a.cipher.encrypt('12345678909')],
  )
  return id
}

beforeAll(async () => {
  app = await createTestApp()
  daniel = await loginAs(app, 'superadmin', { name: 'Daniel Carius', email: 'daniel@x2win.bet.br' })
})
afterAll(async () => app.close())

describe('verify — impacto do nome duplicado', () => {
  it('registros autoritativos e a tela Auditoria continuam separando as duas pessoas', async () => {
    const fakeId = await insertWithdrawal(app, 490000)
    const inv = await api(app, 'POST', '/api/team/invite', { cookie: daniel.cookie, body: { email: 'fin.nova@x2win.bet', roleId: 'financeiro', name: 'Fernanda' } })
    const token = decodeURIComponent(/token=([^&]+)$/.exec(inv.json().inviteUrl)![1])
    const impostorId = inv.json().member.id as string
    const acc = await api(app, 'POST', '/api/team/invites/accept', { ip: '198.51.100.9', body: { token, name: 'Daniel Carius', password: 'SenhaForte2027x' } })
    expect(acc.statusCode).toBe(200)
    const login = await api(app, 'POST', '/api/auth/login', { ip: '198.51.100.9', body: { email: 'fin.nova@x2win.bet', password: 'SenhaForte2027x' } })
    const imp = cookieFrom(login)!
    const ap = await api(app, 'POST', `/api/withdrawals/${fakeId}/approve`, { cookie: imp, ip: '198.51.100.9' })
    expect(ap.statusCode).toBe(200)

    // 1) impostor continua limitado ao próprio cargo
    const big = await insertWithdrawal(app, 900000)
    const apBig = await api(app, 'POST', `/api/withdrawals/${big}/approve`, { cookie: imp, ip: '198.51.100.9' })
    console.log('[verify] impostor approve R$ 9.000 (above Financeiro ceiling):', apBig.statusCode, apBig.json().error?.code ?? '')
    const team = await api(app, 'POST', '/api/team/direct', { cookie: imp, body: { name: 'X', email: 'x@x2win.bet', roleId: 'superadmin' } })
    console.log('[verify] impostor POST /api/team/direct:', team.statusCode)
    const csvImp = await api(app, 'GET', '/api/audit/export.csv', { cookie: imp })
    const listImp = await api(app, 'GET', '/api/audit', { cookie: imp })
    console.log('[verify] impostor GET audit export / list:', csvImp.statusCode, listImp.statusCode)

    // 2) dados autoritativos: actor_id e decided_by_id distintos
    const rows = await app.db.query<{ actor_id: string; actor_name: string; action: string; entity: string; summary: string }>(
      `select actor_id, actor_name, action, entity, summary from audit_log where actor_name = 'Daniel Carius' order by id`,
    )
    for (const r of rows) console.log('[verify] audit_log:', JSON.stringify(r))
    const w = await app.db.one<{ decided_by: string; decided_by_id: string }>('select decided_by, decided_by_id from withdrawals where id = $1', [fakeId])
    console.log('[verify] withdrawal decided_by / decided_by_id:', w!.decided_by, w!.decided_by_id, 'impostorId=', impostorId, 'danielId=', daniel.user.id)

    // 3) API JSON da auditoria (fonte da tela Auditoria) traz actorId; filtro por actorId isola o impostor
    const all = await api(app, 'GET', '/api/audit?pageSize=200', { cookie: daniel.cookie })
    const items = (all.json().items ?? all.json().entries ?? all.json()) as { actorId: string; actorName: string; action: string; entity: string }[]
    const approvals = (Array.isArray(items) ? items : []).filter((e) => e.action === 'aprovar')
    console.log('[verify] /api/audit approvals:', JSON.stringify(approvals.map((e) => ({ actorId: e.actorId, actorName: e.actorName, entity: e.entity }))))
    const onlyImp = await api(app, 'GET', `/api/audit?actorId=${impostorId}`, { cookie: daniel.cookie })
    const oi = onlyImp.json()
    console.log('[verify] /api/audit?actorId=<impostor> keys:', Object.keys(oi), 'count:', (oi.items ?? oi.entries ?? []).length)

    // 4) Equipe (equipe.membros) mostra os dois "Daniel Carius" com e-mail e cargo
    const kv = await api(app, 'GET', '/api/kv/equipe.membros', { cookie: daniel.cookie })
    const members = (kv.json().value ?? []) as { name: string; email: string; roleId: string }[]
    console.log('[verify] equipe.membros named Daniel Carius:', JSON.stringify(members.filter((m) => m.name === 'Daniel Carius').map((m) => ({ email: m.email, roleId: m.roleId }))))
    expect(apBig.statusCode).not.toBe(200)
  })
})
