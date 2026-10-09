// PoC r1-exposure-1: e-mails de jogadores em chaves sem regra `pii` saem em claro
// para cargos que deveriam ver mascarado e ficam sem cifra em repouso.
// Os testes afirmam o comportamento SEGURO e falham enquanto o problema existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { api, createTestApp, loginAs } from './helpers'

const EMAIL = 'maria.silva@gmail.com'
const REFERRER = 'carlos.p@hotmail.com'

const put = (app: FastifyInstance, cookie: string, key: string, value: unknown) => api(app, 'PUT', `/api/kv/${key}`, { cookie, body: { value } })
const get = (app: FastifyInstance, cookie: string, key: string) => api(app, 'GET', `/api/kv/${key}`, { cookie })

describe('poc r1-exposure-1: e-mails de jogadores sem máscara', () => {
  let app: FastifyInstance
  let admin: { cookie: string }
  let suporte: { cookie: string }
  let financeiro: { cookie: string }
  let lowest: { cookie: string }

  beforeAll(async () => {
    app = await createTestApp()
    admin = await loginAs(app, 'superadmin')
    suporte = await loginAs(app, 'suporte')
    financeiro = await loginAs(app, 'financeiro')
    await app.db.query('insert into roles (id, name, permissions) values ($1, $2, $3)', ['so-dashboard', 'Só dashboard', ['dashboard.ver']])
    lowest = await loginAs(app, 'so-dashboard')

    const writes: [string, unknown][] = [
      ['geral.jogadores', [{ id: 'p1', name: 'Maria Silva', nickname: 'maria', email: EMAIL, cpf: '123.456.789-09', status: 'ativo' }]],
      ['geral.transacoes', [{ id: 't1', at: new Date().toISOString(), type: 'deposito', amount: 100, wallet: 'real', playerId: 'p1', playerName: 'Maria Silva', playerEmail: EMAIL }]],
      ['operacao.depositos', [{ id: 'd1', playerId: 'p1', playerName: 'Maria Silva', playerEmail: EMAIL, amount: 100, status: 'pago', createdAt: new Date().toISOString() }]],
      ['campanhas.loja.compras', [{ id: 'c1', playerId: 'p1', playerName: 'Maria Silva', playerEmail: EMAIL, itemName: 'Item', cost: 10 }]],
      ['campanhas.cupons.resgates', [{ id: 'r1', playerId: 'p1', playerName: 'Maria Silva', playerEmail: EMAIL, code: 'BEMVINDO' }]],
      ['campanhas.free-spins.concessoes', [{ id: 'g1', playerId: 'p1', playerName: 'Maria Silva', playerEmail: EMAIL, campaignName: 'FS' }]],
      ['campanhas.indicacao', { records: [{ id: 'i1', referrerId: 'p9', referrerName: 'Carlos P', referrerEmail: REFERRER }] }],
    ]
    for (const [key, value] of writes) {
      const r = await put(app, admin.cookie, key, value)
      expect(r.statusCode, `${key}: ${r.body}`).toBe(200)
    }
  })
  afterAll(async () => app.close())

  it('controle: geral.jogadores sai mascarado para o Suporte (sem usuarios.ver-dados)', async () => {
    const r = await get(app, suporte.cookie, 'geral.jogadores')
    expect(r.statusCode).toBe(200)
    console.log('[suporte] geral.jogadores ->', JSON.stringify(r.json().value))
    expect(r.json().value[0].email).toBe('ma***@gmail.com')
    expect(r.body).not.toContain(EMAIL)
  })

  for (const role of ['suporte', 'financeiro'] as const) {
    for (const key of ['geral.transacoes', 'operacao.depositos']) {
      it(`${role}: ${key} não deve trazer o e-mail completo do jogador`, async () => {
        const who = role === 'suporte' ? suporte : financeiro
        const r = await get(app, who.cookie, key)
        console.log(`[${role}] ${key} -> ${r.statusCode} ${JSON.stringify(r.json().value)}`)
        expect(r.statusCode).toBe(200)
        expect(r.body).not.toContain(EMAIL)
      })
    }
  }

  for (const key of ['campanhas.loja.compras', 'campanhas.cupons.resgates', 'campanhas.free-spins.concessoes', 'campanhas.indicacao']) {
    it(`cargo só com dashboard.ver: ${key} não deve trazer e-mail completo`, async () => {
      const r = await get(app, lowest.cookie, key)
      console.log(`[so-dashboard] ${key} -> ${r.statusCode} ${JSON.stringify(r.json().value ?? r.json())}`)
      // seguro = 403 ou e-mail mascarado
      if (r.statusCode === 200) {
        expect(r.body).not.toContain(EMAIL)
        expect(r.body).not.toContain(REFERRER)
      } else {
        expect(r.statusCode).toBe(403)
      }
    })
  }

  it('em repouso: chaves com e-mail de jogador precisam estar cifradas (value_enc)', async () => {
    const rows = await app.db.query<{ key: string; value: unknown; value_enc: string | null }>(
      `select key, value, value_enc from kv_store where key in ('geral.jogadores','geral.transacoes','operacao.depositos','campanhas.loja.compras','campanhas.cupons.resgates','campanhas.free-spins.concessoes','campanhas.indicacao') order by key`,
    )
    for (const row of rows) console.log(`[db] ${row.key}: value_enc=${row.value_enc ? 'cifrado' : 'null'} value=${JSON.stringify(row.value)}`)
    const plain = rows.filter((row) => row.value_enc == null && JSON.stringify(row.value).includes('@'))
    expect(plain.map((r) => r.key)).toEqual([])
  })
})
