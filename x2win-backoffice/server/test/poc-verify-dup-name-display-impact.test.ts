// Verificador (lente: impacto): nome de exibição duplicado. Mede o que o impostor ganha e o que segue distinguível.
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

describe('verify — nome duplicado: impacto real', () => {
  it('impostor aparece como "Daniel Carius" na exibição, mas id/e-mail/cargo/IP seguem separando', async () => {
    const realW = await insertWithdrawal(app, 100000)
    const realAp = await api(app, 'POST', `/api/withdrawals/${realW}/approve`, { cookie: daniel.cookie })
    expect(realAp.statusCode).toBe(200)

    const inv = await api(app, 'POST', '/api/team/invite', { cookie: daniel.cookie, body: { email: 'fin.nova@x2win.bet', roleId: 'financeiro', name: 'Fernanda' } })
    const token = decodeURIComponent(/token=([^&]+)$/.exec(inv.json().inviteUrl)![1])
    const impostorId = inv.json().member.id as string
    const acc = await api(app, 'POST', '/api/team/invites/accept', { ip: '198.51.100.9', body: { token, name: 'Daniel Carius', password: 'SenhaForte2027x' } })
    console.log('[poc] accept with name "Daniel Carius":', acc.statusCode)
    expect(acc.statusCode).toBe(200)

    // homóglifo/zero-width também passa (o schema só faz trim + tamanho)
    const inv2 = await api(app, 'POST', '/api/team/invite', { cookie: daniel.cookie, body: { email: 'sup.nova@x2win.bet', roleId: 'suporte', name: 'Sofia' } })
    const token2 = decodeURIComponent(/token=([^&]+)$/.exec(inv2.json().inviteUrl)![1])
    const acc2 = await api(app, 'POST', '/api/team/invites/accept', { ip: '198.51.100.10', body: { token: token2, name: 'Daniel​ Carius', password: 'SenhaForte2027y' } })
    console.log('[poc] accept with zero-width name:', acc2.statusCode)

    const login = await api(app, 'POST', '/api/auth/login', { ip: '198.51.100.9', body: { email: 'fin.nova@x2win.bet', password: 'SenhaForte2027x' } })
    const imp = cookieFrom(login)!
    const me = await api(app, 'GET', '/api/auth/me', { cookie: imp, ip: '198.51.100.9' })
    console.log('[poc] impostor /api/auth/me:', me.statusCode, JSON.stringify(me.json()?.user ?? me.json()).slice(0, 200))

    const fakeW = await insertWithdrawal(app, 490000)
    const ap = await api(app, 'POST', `/api/withdrawals/${fakeW}/approve`, { cookie: imp, ip: '198.51.100.9' })
    console.log('[poc] impostor approve R$ 4.900:', ap.statusCode, 'decidedBy=', ap.json().withdrawal?.decidedBy, 'keys has decidedById?', 'decidedById' in (ap.json().withdrawal ?? {}))

    // impostor não consegue renomear a si mesmo de novo depois (precisa equipe.editar)
    const kvTeam = await api(app, 'GET', '/api/kv/equipe.membros', { cookie: imp, ip: '198.51.100.9' })
    const v = kvTeam.json()
    const members = (v.value ?? []) as { id: string; name: string; email: string; roleId: string }[]
    const renamed = members.map((m) => (m.id === impostorId ? { ...m, name: 'Outro Nome' } : m))
    const put = await api(app, 'PUT', '/api/kv/equipe.membros', { cookie: imp, ip: '198.51.100.9', body: { value: renamed, version: v.version } })
    console.log('[poc] impostor self-rename via kv:', put.statusCode)

    // painel Saques (kv operacao.saques)
    const saques = await api(app, 'GET', '/api/kv/operacao.saques', { cookie: daniel.cookie })
    const ws = (saques.json().value ?? []) as { id: string; decidedBy: string | null }[]
    console.log('[poc] kv operacao.saques decided:', JSON.stringify(ws.filter((w) => w.decidedBy).map((w) => ({ id: w.id, decidedBy: w.decidedBy, keys: Object.keys(w).filter((k) => /decid/i.test(k)) }))))
    const db = await app.db.query<{ id: string; decided_by: string; decided_by_id: string }>(`select id, decided_by, decided_by_id from withdrawals where decided_by is not null`)
    console.log('[poc] DB withdrawals decided_by_id:', JSON.stringify(db))

    // CSV do servidor
    const csv = await api(app, 'GET', '/api/audit/export.csv', { cookie: daniel.cookie })
    console.log('[poc] CSV export status', csv.statusCode)
    for (const line of csv.body.split('\r\n').filter((l) => /Daniel/.test(l) || /Data e hora/.test(l))) console.log('[poc] CSV:', JSON.stringify(line))

    // CSV filtrado por pessoa (id) isola o impostor
    const csvImp = await api(app, 'GET', `/api/audit/export.csv?actorId=${impostorId}`, { cookie: daniel.cookie })
    console.log('[poc] CSV filtered by impostor actorId lines:', csvImp.body.split('\r\n').filter(Boolean).length - 1)

    // lista de equipe vista pelo superadmin
    const kv2 = await api(app, 'GET', '/api/kv/equipe.membros', { cookie: daniel.cookie })
    console.log('[poc] equipe.membros:', JSON.stringify((kv2.json().value as { name: string; email: string; roleId: string }[]).map((m) => ({ name: m.name, email: m.email, roleId: m.roleId }))))
    expect(ap.statusCode).toBe(200)
  })
})
