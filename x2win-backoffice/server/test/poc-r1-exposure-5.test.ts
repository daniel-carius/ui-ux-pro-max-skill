// PoC r1-exposure-5: geral.jogadores e crescimento.afiliados têm read: 'equipe',
// então qualquer sessão ativa (qualquer cargo) lê a base inteira de jogadores
// (nome, status de autoexclusão/pausa, KYC, saldos, cidade/UF, etiquetas) e de
// afiliados (nome, saldo, termos de CPA/RevShare). Só email/cpf/phone/birthDate/ip
// são mascarados. Os testes afirmam o comportamento SEGURO (403 para quem não tem
// a tela dona) e falham enquanto o problema existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { api, createTestApp, loginAs } from './helpers'

const put = (app: FastifyInstance, cookie: string, key: string, value: unknown) => api(app, 'PUT', `/api/kv/${key}`, { cookie, body: { value } })
const get = (app: FastifyInstance, cookie: string, key: string) => api(app, 'GET', `/api/kv/${key}`, { cookie })

const PLAYERS = [
  {
    id: 'p1',
    name: 'Maria Silva',
    nickname: 'maria',
    email: 'maria.silva@gmail.com',
    cpf: '123.456.789-09',
    status: 'autoexcluido',
    kycStatus: 'aprovado',
    balanceReal: 1500,
    balanceBonus: 50,
    totalDeposited: 20000,
    totalWithdrawn: 3000,
    city: 'São Paulo',
    uf: 'SP',
    tags: ['VIP', 'Bônus abuser'],
    refCode: 'MARIA10',
    referrerId: 'p9',
  },
  { id: 'p2', name: 'João Souza', status: 'pausa', balanceReal: 320.5, city: 'Recife', uf: 'PE', tags: [] },
]

const AFFILIATES = [{ id: 'a1', name: 'Afiliado Grande', balance: 98000, cpa: 150, revShare: 35, pixKey: 'afiliado@pix.com' }]

describe('poc r1-exposure-5: lista completa de jogadores/afiliados para qualquer cargo logado', () => {
  let app: FastifyInstance
  let admin: { cookie: string }
  let suporte: { cookie: string }
  let marketing: { cookie: string }
  let soDashboard: { cookie: string }
  let soTema: { cookie: string }

  beforeAll(async () => {
    app = await createTestApp()
    admin = await loginAs(app, 'superadmin')
    suporte = await loginAs(app, 'suporte')
    marketing = await loginAs(app, 'marketing')
    await app.db.query('insert into roles (id, name, permissions) values ($1, $2, $3)', ['so-dashboard', 'Só dashboard', ['dashboard.ver']])
    await app.db.query('insert into roles (id, name, permissions) values ($1, $2, $3)', ['so-tema', 'Só tema', ['tema.ver']])
    soDashboard = await loginAs(app, 'so-dashboard')
    soTema = await loginAs(app, 'so-tema')

    for (const [key, value] of [
      ['geral.jogadores', PLAYERS],
      ['crescimento.afiliados', AFFILIATES],
    ] as const) {
      const r = await put(app, admin.cookie, key, value)
      expect(r.statusCode, `${key}: ${r.body}`).toBe(200)
    }
  })
  afterAll(async () => app.close())

  it('controle: Suporte (usuarios.ver) lê geral.jogadores', async () => {
    const r = await get(app, suporte.cookie, 'geral.jogadores')
    expect(r.statusCode).toBe(200)
    expect(r.json().value).toHaveLength(2)
  })

  for (const [label, who] of [
    ['marketing (cargo seed, sem usuarios.*)', () => marketing],
    ['só dashboard.ver', () => soDashboard],
    ['só tema.ver', () => soTema],
  ] as const) {
    it(`${label}: não deve ler a base de jogadores`, async () => {
      const r = await get(app, who().cookie, 'geral.jogadores')
      console.log(`[${label}] GET geral.jogadores -> ${r.statusCode} ${r.body}`)
      expect(r.statusCode).toBe(403)
    })

    it(`${label}: não deve ler a base de afiliados`, async () => {
      const r = await get(app, who().cookie, 'crescimento.afiliados')
      console.log(`[${label}] GET crescimento.afiliados -> ${r.statusCode} ${r.body}`)
      expect(r.statusCode).toBe(403)
    })
  }
})
