// PoC (verificador independente): leitura de dados pessoais completos sem rastro no servidor.
// Quem tem a permissão de revelar (usuarios.ver-dados; o cargo de sistema "Administrador" tem) recebe CPF,
// e-mail e celular em claro em todo GET /api/kv/geral.jogadores, e a rota GET não grava auditoria. A linha
// 'revelar' que o painel mostra ("CPF, celular e e-mail completos exibidos na ficha") é postada pelo navegador
// via POST /api/audit/events só depois de um clique; chamando a chave direto, nada fica registrado.
// Este teste afirma o comportamento SEGURO (leitura de PII em claro gera auditoria no servidor) e FALHA
// enquanto o problema existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { newId } from '../src/lib/crypto'
import { api, createTestApp, loginAs } from './helpers'

let app: FastifyInstance
let daniel: Awaited<ReturnType<typeof loginAs>>

const PLAYERS = [0, 1, 2].map((i) => ({
  id: `p${i}`,
  name: `Jogador ${i}`,
  cpf: `123.456.789-0${i}`,
  email: `j${i}@exemplo.com`,
  phone: `(11) 98888-000${i}`,
  status: 'ativo',
  tags: [],
  coins: 0,
}))

async function auditCount(where: string, params: unknown[]) {
  const r = await app.db.one<{ n: number }>(`select count(*)::int as n from audit_log where ${where}`, params)
  return r?.n ?? 0
}

beforeAll(async () => {
  app = await createTestApp()
  daniel = await loginAs(app, 'superadmin', { name: 'Daniel Carius' })
  const seed = await api(app, 'PUT', '/api/kv/geral.jogadores', { cookie: daniel.cookie, body: { value: PLAYERS, version: null } })
  expect(seed.statusCode).toBe(200)
})
afterAll(async () => app.close())

describe('PoC r2 — PII completa lida pela chave sem auditoria no servidor', () => {
  it('Suporte (sem usuarios.ver-dados) recebe mascarado — controle de máscara funciona', async () => {
    const sup = await loginAs(app, 'suporte', { name: 'Sara Suporte' })
    const res = await api(app, 'GET', '/api/kv/geral.jogadores', { cookie: sup.cookie })
    expect(res.statusCode).toBe(200)
    const v = res.json().value as typeof PLAYERS
    console.log('[poc] suporte sees:', JSON.stringify(v.map((p) => [p.cpf, p.email, p.phone])))
    expect(v[0].cpf).not.toBe(PLAYERS[0].cpf)
  })

  it('Administrador lê CPF/e-mail/celular em claro e o servidor registra a leitura (FALHA enquanto o bug existir)', async () => {
    const adm = await loginAs(app, 'administrador', { name: 'Ana Administradora' })
    const beforeActor = await auditCount('actor_id = $1', [adm.user.id])
    const beforeReveal = await auditCount(`action = 'revelar'`, [])

    const res = await api(app, 'GET', '/api/kv/geral.jogadores', { cookie: adm.cookie })
    expect(res.statusCode).toBe(200)
    const v = res.json().value as typeof PLAYERS
    console.log('[poc] administrador sees:', JSON.stringify(v.map((p) => [p.cpf, p.email, p.phone])))
    // os valores chegam em claro (autorizado pela permissão)
    expect(v.map((p) => p.cpf)).toEqual(PLAYERS.map((p) => p.cpf))
    expect(v.map((p) => p.email)).toEqual(PLAYERS.map((p) => p.email))
    expect(v.map((p) => p.phone)).toEqual(PLAYERS.map((p) => p.phone))

    // repete várias vezes (cópia da base inteira)
    for (let i = 0; i < 5; i++) await api(app, 'GET', '/api/kv/geral.jogadores', { cookie: adm.cookie })

    const afterActor = await auditCount('actor_id = $1', [adm.user.id])
    const afterReveal = await auditCount(`action = 'revelar'`, [])
    console.log(`[poc] audit rows for administrador: before=${beforeActor} after=${afterActor}; 'revelar' rows: before=${beforeReveal} after=${afterReveal}`)

    // contraste: a rota de domínio de PIX de saque audita no servidor
    const wid = newId('SQ')
    await app.db.query(
      `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                                risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
       values ($1, 'p1', 'Jogador 1', 'j1@exemplo.com', 10000, 0, 'pendente', 'baixo', 10, '["x"]'::jsonb, 'CPF', $2, 'E1', now(), now())`,
      [wid, app.cipher.encrypt('12345678909')],
    )
    const pix = await api(app, 'POST', `/api/withdrawals/${wid}/reveal-pix`, { cookie: adm.cookie })
    const pixAudit = await auditCount(`actor_id = $1 and action = 'revelar' and source = 'servidor'`, [adm.user.id])
    console.log(`[poc] reveal-pix status=${pix.statusCode} server 'revelar' rows for administrador after reveal-pix=${pixAudit}`)

    // comportamento seguro esperado: as 6 leituras de PII em claro (medidas antes do reveal-pix) deixam rastro no servidor
    expect(afterActor).toBeGreaterThan(beforeActor)
  })
})
