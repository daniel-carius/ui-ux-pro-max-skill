// PoC (verificação independente): aprovar saque ignora o banimento do anti-fraude
// (geral.jogadores status 'bloqueado' + seguranca.bloqueios 'rede') e as regras de
// saque em vigor (maxPerRequest / dailyLimit).
// Afirma o comportamento SEGURO: os testes 1 e 2 falham enquanto o servidor pagar.
// O teste 3 é controle (autoexcluído precisa continuar recebendo o saldo).
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../src/lib/crypto'
import { api, createTestApp, loginAs } from './helpers'

async function insertWithdrawal(app: FastifyInstance, o: { playerId: string; amount: number; status: string; risk: string; score: number }) {
  const id = newId('SQ')
  await app.db.query(
    `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                              risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
     values ($1, $2, 'Jogador', 'j@x.com', $3, 0, $4, $5, $6, '[]'::jsonb, 'CPF', $7, 'E1', now(), now())`,
    [id, o.playerId, Math.round(o.amount * 100), o.status, o.risk, o.score, app.cipher.encrypt('12345678909')],
  )
  return id
}

async function paidEvents(app: FastifyInstance, withdrawalId: string) {
  return app.db.query<{ id: number; payload: unknown }>(
    `select id, payload from webhook_outbox where event = 'saque.pago' and payload->'data'->>'id' = $1`,
    [withdrawalId],
  )
}

const putKv = (app: FastifyInstance, cookie: string, key: string, value: unknown, version: number) =>
  api(app, 'PUT', `/api/kv/${key}`, { cookie, body: { value, version } })

describe('aprovação de saque x anti-fraude e regras de saque', () => {
  let app: FastifyInstance
  let root: { cookie: string }

  beforeAll(async () => {
    app = await createTestApp()
    root = await loginAs(app, 'superadmin')
    // base de jogadores (primeira gravação aceita a lista inteira)
    const base = [
      { id: 'p-ban', name: 'Fraudador', email: 'f@x.com', status: 'ativo', balanceReal: 0, balanceBonus: 0, tags: [] },
      { id: 'p-big', name: 'Grande', email: 'g@x.com', status: 'ativo', balanceReal: 0, balanceBonus: 0, tags: [] },
      { id: 'p-auto', name: 'Autoexcluido', email: 'a@x.com', status: 'autoexcluido', balanceReal: 0, balanceBonus: 0, tags: [] },
    ]
    const b = await putKv(app, root.cookie, 'geral.jogadores', base, 0)
    expect(b.statusCode).toBe(200)
    // destino do processador PIX para saque.pago
    await app.db.query(`insert into webhook_destinations (id, event, url, active, secret_enc) values ($1, 'saque.pago', $2, true, $3)`, [
      newId('wh'),
      'http://127.0.0.1:9/pix',
      app.cipher.encrypt('segredo-pix'),
    ])
  })
  afterAll(async () => app.close())

  it('1) saque em_analise de jogador banido (rede banida) não pode ser pago', async () => {
    const w = await insertWithdrawal(app, { playerId: 'p-ban', amount: 4999, status: 'em_analise', risk: 'alto', score: 95 })

    // anti-fraude bane a rede pelo fluxo normal de KV: status → bloqueado e bloqueio 'rede'
    const cur = await api(app, 'GET', '/api/kv/geral.jogadores', { cookie: root.cookie })
    const players = (cur.json().value as { id: string; status: string }[]).map((p) => (p.id === 'p-ban' ? { ...p, status: 'bloqueado' } : p))
    expect((await putKv(app, root.cookie, 'geral.jogadores', players, cur.json().version)).statusCode).toBe(200)
    const blocks = [
      {
        id: 'b1', kind: 'rede', value: 'rede-1', reason: 'Multicontas + bônus', accounts: ['p-ban'],
        previousStatuses: { 'p-ban': 'ativo' }, createdAt: new Date().toISOString(), createdBy: 'Antifraude',
      },
    ]
    expect((await putKv(app, root.cookie, 'seguranca.bloqueios', blocks, 0)).statusCode).toBe(200)
    const stored = await api(app, 'GET', '/api/kv/geral.jogadores', { cookie: root.cookie })
    expect((stored.json().value as { id: string; status: string }[]).find((p) => p.id === 'p-ban')!.status).toBe('bloqueado')

    const fin = await loginAs(app, 'financeiro')
    const r = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: fin.cookie })
    const row = await app.db.one<{ status: string }>('select status from withdrawals where id = $1', [w])
    const paid = await paidEvents(app, w)
    console.log('[poc-1] Financeiro aprova saque de jogador banido ->', r.statusCode, JSON.stringify(r.json().message ?? r.json().error),
      '| status:', row?.status, '| saque.pago:', paid.length, JSON.stringify(paid[0]?.payload ?? null))

    expect(r.statusCode).not.toBe(200)
    expect(row?.status).toBe('em_analise')
    expect(paid).toHaveLength(0)
  })

  it('2) aprovação respeita maxPerRequest e dailyLimit em vigor', async () => {
    const rules = { min: 20, maxPerRequest: 100, rolloverPct: 0, fee: 0, dailyLimit: 1, autoApproveMax: 0, rolloverMode: 'acumulado', rolloverBets: 'todas' }
    const put = await putKv(app, root.cookie, 'operacao.saques.regras', rules, 0)
    expect(put.statusCode).toBe(200)

    const adm = await loginAs(app, 'administrador')
    const results: { amount: number; code: number }[] = []
    for (const amount of [50000, 40000, 30000]) {
      const w = await insertWithdrawal(app, { playerId: 'p-big', amount, status: 'pendente', risk: 'baixo', score: 10 })
      const r = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: adm.cookie })
      results.push({ amount, code: r.statusCode })
    }
    console.log('[poc-2] regras maxPerRequest=100 dailyLimit=1; aprovações do mesmo jogador no mesmo dia ->', JSON.stringify(results))
    // seguro: no máximo 1 por dia e nenhum acima de R$ 100
    expect(results.filter((x) => x.code === 200)).toHaveLength(0)
  })

  it('3) controle: autoexcluído continua podendo receber o saldo', async () => {
    const w = await insertWithdrawal(app, { playerId: 'p-auto', amount: 50, status: 'pendente', risk: 'baixo', score: 5 })
    const fin = await loginAs(app, 'financeiro')
    const r = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: fin.cookie })
    console.log('[poc-3] controle autoexcluído ->', r.statusCode)
    expect(r.statusCode).toBe(200)
  })
})
