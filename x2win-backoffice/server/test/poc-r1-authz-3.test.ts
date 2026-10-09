// PoC: e-mail do jogador sai em claro (e é gravado sem cifra) em chaves sem regra `pii`,
// contornando usuarios.ver-dados. Os asserts descrevem o comportamento SEGURO; falham enquanto o bug existir.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, createTestApp, loginAs } from './helpers'

const EMAIL = 'joao.silva@gmail.com'
const player = { playerId: 'p-001', playerName: 'João Silva', playerEmail: EMAIL }

let app: FastifyInstance
let admin: string
let suporte: string
let marketing: string

beforeAll(async () => {
  app = await createTestApp()
  admin = (await loginAs(app, 'superadmin')).cookie
  suporte = (await loginAs(app, 'suporte')).cookie
  marketing = (await loginAs(app, 'marketing')).cookie

  const puts: [string, unknown][] = [
    ['geral.jogadores', [{ id: 'p-001', name: 'João Silva', email: EMAIL, cpf: '12345678909', status: 'ativo', tags: [] }]],
    ['geral.transacoes', [{ id: 'tx-1', at: new Date().toISOString(), type: 'deposito', amount: 100, wallet: 'real', ...player }]],
    ['operacao.depositos', [{ id: 'dep-1', amount: 100, status: 'pago', ...player }]],
    ['campanhas.free-spins.concessoes', [{ id: 'fs-1', campaignName: 'Boas-vindas', ...player }]],
  ]
  for (const [key, value] of puts) {
    const r = await api(app, 'PUT', `/api/kv/${key}`, { cookie: admin, body: { value } })
    expect(r.statusCode, `${key}: ${r.body}`).toBe(200)
  }
})

afterAll(async () => {
  await app?.close()
})

describe('PII de jogador fora de geral.jogadores', () => {
  it('controle: Suporte (sem usuarios.ver-dados) recebe e-mail mascarado em geral.jogadores', async () => {
    const r = await api(app, 'GET', '/api/kv/geral.jogadores', { cookie: suporte })
    console.log('[suporte] geral.jogadores ->', r.statusCode, r.body)
    expect(r.statusCode).toBe(200)
    expect(r.body).not.toContain(EMAIL)
  })

  it('Suporte não deve receber o e-mail completo em geral.transacoes', async () => {
    const r = await api(app, 'GET', '/api/kv/geral.transacoes', { cookie: suporte })
    console.log('[suporte] geral.transacoes ->', r.statusCode, r.body)
    expect(r.statusCode).toBe(200)
    expect(r.body).not.toContain(EMAIL)
  })

  it('Suporte não deve receber o e-mail completo em operacao.depositos', async () => {
    const r = await api(app, 'GET', '/api/kv/operacao.depositos', { cookie: suporte })
    console.log('[suporte] operacao.depositos ->', r.statusCode, r.body)
    expect(r.statusCode).toBe(200)
    expect(r.body).not.toContain(EMAIL)
  })

  it('cargo "marketing" (sem usuarios.ver) não deve receber o e-mail completo em campanhas.free-spins.concessoes', async () => {
    const r = await api(app, 'GET', '/api/kv/campanhas.free-spins.concessoes', { cookie: marketing })
    console.log('[marketing] campanhas.free-spins.concessoes ->', r.statusCode, r.body)
    expect(r.body).not.toContain(EMAIL)
  })

  it('e-mail do jogador não deve ficar em claro no banco (kv_store.value)', async () => {
    const rows = await app.db.query<{ key: string; value: unknown; value_enc: string | null }>(
      `select key, value, value_enc from kv_store where key in ('geral.jogadores','geral.transacoes','operacao.depositos','campanhas.free-spins.concessoes') order by key`,
    )
    const list = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows) as { key: string; value: unknown; value_enc: string | null }[]
    for (const row of list) console.log('[db]', row.key, 'plain=', JSON.stringify(row.value), 'enc=', row.value_enc ? '<cifrado>' : null)
    const plainLeaks = list.filter((row) => JSON.stringify(row.value ?? null).includes(EMAIL)).map((row) => row.key)
    expect(plainLeaks).toEqual([])
  })
})
