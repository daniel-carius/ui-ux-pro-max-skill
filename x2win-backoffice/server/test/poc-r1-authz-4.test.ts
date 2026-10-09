// PoC (r1-authz-4): geral.jogadores is read: 'equipe', so any logged-in role,
// even one with no usuarios.* permission, reads the whole player base
// (names, balances, deposit/withdraw/win totals, KYC, self-exclusion status,
// city/UF, referrer, partially masked CPF). Asserts the SECURE behaviour, so it
// FAILS while the issue exists.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, createTestApp, loginAs } from './helpers'

const KEY = 'geral.jogadores'
const players = [
  {
    id: 'p1',
    name: 'Joana Lima',
    nickname: 'joaninha',
    email: 'joana.lima@exemplo.com',
    phone: '11987654321',
    cpf: '12345678909',
    birthDate: '1990-05-01',
    ip: '200.150.10.20',
    status: 'autoexcluido',
    kyc: 'aprovado',
    balanceReal: 15234.77,
    balanceBonus: 0,
    coins: 10,
    totalDeposited: 98000,
    totalWithdrawn: 41000,
    totalWon: 120000,
    referrerId: 'aff-1',
    city: 'Campinas',
    uf: 'SP',
    tags: ['vip'],
  },
]

describe('poc r1-authz-4: player base readable by any role', () => {
  let app: FastifyInstance
  let admin: string
  let marketing: string
  let dashOnly: string
  let noPerms: string

  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app)).cookie
    const w = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: admin, body: { value: players } })
    expect(w.statusCode).toBe(200)
    // seeded custom role 'marketing': dashboard + promotions only, no usuarios.*
    marketing = (await loginAs(app, 'marketing')).cookie
    await app.db.query('insert into roles (id, name, permissions) values ($1, $2, $3)', ['dash-only', 'Só dashboard', ['dashboard.ver']])
    dashOnly = (await loginAs(app, 'dash-only')).cookie
    await app.db.query('insert into roles (id, name, permissions) values ($1, $2, $3)', ['no-perms', 'Sem permissões', []])
    noPerms = (await loginAs(app, 'no-perms')).cookie
  })
  afterAll(async () => app.close())

  for (const [label, cookie] of [
    ['marketing', () => marketing],
    ['dashboard.ver only', () => dashOnly],
    ['no permissions at all', () => noPerms],
  ] as const) {
    it(`role "${label}" (no usuarios.ver) must NOT read ${KEY}`, async () => {
      const r = await api(app, 'GET', `/api/kv/${KEY}`, { cookie: cookie() })
      // evidence of what leaks
      console.log(`[${label}] status=${r.statusCode} body=${r.body}`)
      expect(r.statusCode).toBe(403)
    })
  }
})
