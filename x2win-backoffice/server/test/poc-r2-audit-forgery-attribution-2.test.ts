// PoC (verificador independente): nome exibido não é único. Um convidado Financeiro aceita o convite com o nome
// exato do Superadmin ("Daniel Carius"), aprova um saque e a evidência (CSV da auditoria, saque no painel)
// fica indistinguível da do Superadmin. Este teste afirma o comportamento SEGURO e FALHA enquanto o problema existir.
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

function tokenOf(url: string) {
  const m = /#\/convite\?token=([^&]+)$/.exec(url)
  if (!m) throw new Error(`link sem token: ${url}`)
  return decodeURIComponent(m[1])
}

beforeAll(async () => {
  app = await createTestApp()
  daniel = await loginAs(app, 'superadmin', { name: 'Daniel Carius', email: 'daniel@x2win.bet.br' })
})
afterAll(async () => app.close())

describe('PoC r2 — nome do Superadmin assumido por convidado de cargo baixo', () => {
  it('convidado Financeiro não deve conseguir se passar pelo Superadmin na evidência', async () => {
    const realId = await insertWithdrawal(app, 300000)
    const fakeId = await insertWithdrawal(app, 490000)

    // 1) Superadmin aprova um saque de verdade
    const realApprove = await api(app, 'POST', `/api/withdrawals/${realId}/approve`, { cookie: daniel.cookie, ip: '127.0.0.1' })
    console.log('[poc] Daniel approve:', realApprove.statusCode, realApprove.json().withdrawal?.decidedBy)

    // 2) Superadmin convida Financeiro com nome "Fernanda"
    const inv = await api(app, 'POST', '/api/team/invite', {
      cookie: daniel.cookie,
      body: { email: 'fin.nova@x2win.bet', roleId: 'financeiro', name: 'Fernanda' },
    })
    console.log('[poc] invite:', inv.statusCode)
    const token = tokenOf(inv.json().inviteUrl)
    const impostorId = inv.json().member.id as string

    // 3) convidado aceita com o nome exato do Superadmin (rota pública)
    const acc = await api(app, 'POST', '/api/team/invites/accept', {
      ip: '198.51.100.9',
      body: { token, name: 'Daniel Carius', password: 'SenhaForte2027x' },
    })
    console.log('[poc] accept with name "Daniel Carius":', acc.statusCode, acc.body)

    // 4) login do convidado e aprovação de R$ 4.900 (abaixo do teto de R$ 5.000)
    const login = await api(app, 'POST', '/api/auth/login', { ip: '198.51.100.9', body: { email: 'fin.nova@x2win.bet', password: 'SenhaForte2027x' } })
    console.log('[poc] impostor login:', login.statusCode, login.body)
    const impCookie = cookieFrom(login)!
    const fakeApprove = await api(app, 'POST', `/api/withdrawals/${fakeId}/approve`, { cookie: impCookie, ip: '198.51.100.9' })
    console.log('[poc] impostor approve:', fakeApprove.statusCode, 'decidedBy =', fakeApprove.json().withdrawal?.decidedBy)

    // 5) o que o painel vê em Saques (operacao.saques)
    const kv = await api(app, 'GET', '/api/kv/operacao.saques', { cookie: daniel.cookie })
    const list = (kv.json().value ?? []) as Record<string, unknown>[]
    const real = list.find((w) => w.id === realId)!
    const fake = list.find((w) => w.id === fakeId)!
    console.log('[poc] kv real:', JSON.stringify({ id: real.id, decidedBy: real.decidedBy, decidedById: real.decidedById }))
    console.log('[poc] kv fake:', JSON.stringify({ id: fake.id, decidedBy: fake.decidedBy, decidedById: fake.decidedById }))
    const dbRows = await app.db.query<{ id: string; decided_by: string; decided_by_id: string }>(
      'select id, decided_by, decided_by_id from withdrawals where id = any($1)',
      [[realId, fakeId]],
    )
    console.log('[poc] db withdrawals:', JSON.stringify(dbRows))

    // 6) CSV da auditoria do servidor
    const csv = await api(app, 'GET', '/api/audit/export.csv', { cookie: daniel.cookie })
    const lines = csv.body.split('\r\n')
    console.log('[poc] csv header:', lines[0])
    for (const l of lines.filter((x) => x.includes('Daniel Carius'))) console.log('[poc] csv:', l)
    const approvalLines = lines.filter((x) => x.includes(';Aprovou;Saque #'))
    const quemFez = approvalLines.map((l) => l.split(';')[1])
    console.log('[poc] "Quem fez" of the two approvals:', JSON.stringify(quemFez))

    // 7) quantas pessoas ativas com o mesmo nome
    const dup = await app.db.query<{ id: string; email: string; role_id: string }>(
      `select id, email, role_id from users where name = 'Daniel Carius' order by created_at`,
    )
    console.log('[poc] users named "Daniel Carius":', JSON.stringify(dup))

    // ---- comportamento seguro esperado ----
    // a) o aceite não deveria aceitar o nome exato de outra pessoa ativa da equipe
    expect.soft(acc.statusCode, 'aceite com nome duplicado do Superadmin foi aceito').not.toBe(200)
    // b) na tela/CSV de Saques, as duas decisões devem ser distinguíveis (nome diferente ou id de quem decidiu)
    expect
      .soft(real.decidedBy !== fake.decidedBy || (real.decidedById !== undefined && real.decidedById !== fake.decidedById), 'saques indistinguíveis no painel')
      .toBe(true)
    // c) o CSV da auditoria (evidência para regulador) deve distinguir as duas pessoas
    expect.soft(new Set(quemFez).size, `"Quem fez" idêntico nas duas aprovações: ${quemFez.join(' | ')}`).toBe(2)
    // sanity: as duas são pessoas diferentes no banco
    expect(dup.map((d) => d.id)).toEqual([daniel.user.id, impostorId])
  })
})
