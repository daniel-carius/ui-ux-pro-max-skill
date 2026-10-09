// PoC (verificação): aprovar saque precisa respeitar o banimento do anti-fraude.
// Afirma o comportamento SEGURO: falha enquanto o servidor pagar saque de jogador bloqueado.
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

async function insertDestination(app: FastifyInstance, event: string) {
  await app.db.query(`insert into webhook_destinations (id, event, url, active, secret_enc) values ($1, $2, $3, true, $4)`, [
    newId('wh'),
    event,
    'http://127.0.0.1:9/pix',
    app.cipher.encrypt('segredo-pix'),
  ])
}

const putKv = (app: FastifyInstance, cookie: string, key: string, value: unknown, version: number) =>
  api(app, 'PUT', `/api/kv/${key}`, { cookie, body: { value, version } })

describe('aprovação de saque x banimento do anti-fraude', () => {
  let app: FastifyInstance
  let root: { cookie: string }
  beforeAll(async () => {
    app = await createTestApp()
    root = await loginAs(app, 'superadmin')
    // base de jogadores como vem da plataforma: todos ativos / autoexcluído
    const base = [
      { id: 'p-ban', name: 'Fraudador', email: 'f@x.com', status: 'ativo', balanceReal: 0, balanceBonus: 0, tags: [] },
      { id: 'p-auto', name: 'Autoexcluido', email: 'a@x.com', status: 'autoexcluido', balanceReal: 0, balanceBonus: 0, tags: [] },
    ]
    const b = await putKv(app, root.cookie, 'geral.jogadores', base, 0)
    expect(b.statusCode).toBe(200)
    await insertDestination(app, 'saque.pago')
  })
  afterAll(async () => app.close())

  it('saque em_analise de jogador banido (rede banida) NÃO pode ser aprovado nem gerar saque.pago', async () => {
    // 1) o saque já está na fila de análise manual (risco calculado na criação)
    const w = await insertWithdrawal(app, { playerId: 'p-ban', amount: 4999, status: 'em_analise', risk: 'alto', score: 95 })

    // 2) depois disso o anti-fraude bane a rede: status do jogador → bloqueado e bloqueio 'rede' com a conta
    const cur = await api(app, 'GET', '/api/kv/geral.jogadores', { cookie: root.cookie })
    const players = (cur.json().value as { id: string; status: string }[]).map((p) => (p.id === 'p-ban' ? { ...p, status: 'bloqueado' } : p))
    const ban = await putKv(app, root.cookie, 'geral.jogadores', players, cur.json().version)
    expect(ban.statusCode).toBe(200)
    const blocks = [
      { id: 'b1', kind: 'rede', value: 'rede-1', reason: 'Multicontas + bônus', accounts: ['p-ban'], previousStatuses: { 'p-ban': 'ativo' }, createdAt: new Date().toISOString(), createdBy: 'Antifraude' },
    ]
    expect((await putKv(app, root.cookie, 'seguranca.bloqueios', blocks, 0)).statusCode).toBe(200)
    const stored = await api(app, 'GET', '/api/kv/geral.jogadores', { cookie: root.cookie })
    expect((stored.json().value as { id: string; status: string }[]).find((p) => p.id === 'p-ban')!.status).toBe('bloqueado')

    // 3) Financeiro (teto R$ 5.000) aprova pela rota do painel
    const fin = await loginAs(app, 'financeiro')
    const r = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: fin.cookie })
    const row = await app.db.one<{ status: string }>('select status from withdrawals where id = $1', [w])
    const paid = await app.db.query<{ id: number }>(`select id from webhook_outbox where event = 'saque.pago' and payload->'data'->>'id' = $1`, [w])
    console.log('[poc] aprovar saque de jogador bloqueado →', r.statusCode, r.json().message ?? r.json().error, '| status no banco:', row?.status, '| saque.pago enfileirados:', paid.length)

    // comportamento seguro esperado
    expect(r.statusCode).not.toBe(200)
    expect(row?.status).toBe('em_analise')
    expect(paid).toHaveLength(0)
  })

  it('controle: autoexcluído continua podendo receber o saldo (não deve ser barrado pela correção)', async () => {
    const w = await insertWithdrawal(app, { playerId: 'p-auto', amount: 100, status: 'pendente', risk: 'baixo', score: 5 })
    const fin = await loginAs(app, 'financeiro')
    const r = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: fin.cookie })
    console.log('[poc] controle autoexcluído →', r.statusCode)
    expect(r.statusCode).toBe(200)
  })
})
