// PoC r1-exposure-2: afiliados.saques tem pii { revealPermission: 'afiliados-saques.ver-pix' },
// mas só pixKey sai mascarado. affiliateEmail e bank { agency, account, holder } saem em claro
// para quem lê a chave sem 'afiliados-saques.ver-pix'.
// Os testes afirmam o comportamento SEGURO e falham enquanto o problema existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { api, createTestApp, loginAs } from './helpers'

const EMAIL = 'joao.souza@gmail.com'
const AGENCY = '1234'
const ACCOUNT = '98765-4'
const HOLDER = 'João Souza'
const PIX = '12345678909'

const base = {
  affiliateId: 'a1',
  affiliateName: 'João Souza',
  affiliateEmail: EMAIL,
  affiliateType: 'Influencer',
  amount: 1500,
  status: 'pendente',
  createdAt: new Date().toISOString(),
  decidedAt: null,
  decidedBy: null,
  reason: null,
  reference: null,
}
const ITEMS = [
  { ...base, id: 'w-ted', method: 'ted', pixKeyType: null, pixKey: null, bank: { bank: '341 · Itaú', agency: AGENCY, account: ACCOUNT, holder: HOLDER } },
  { ...base, id: 'w-pix', method: 'pix', pixKeyType: 'CPF', pixKey: PIX, bank: null },
]

describe('poc r1-exposure-2: afiliados.saques sem máscara de e-mail e dados bancários', () => {
  let app: FastifyInstance
  let admin: { cookie: string }
  let visao: { cookie: string }
  let saquesVer: { cookie: string }

  beforeAll(async () => {
    app = await createTestApp()
    admin = await loginAs(app, 'superadmin')
    await app.db.query('insert into roles (id, name, permissions) values ($1, $2, $3)', ['so-visao', 'Só visão geral', ['afiliados-visao-geral.ver']])
    await app.db.query('insert into roles (id, name, permissions) values ($1, $2, $3)', ['saques-ver', 'Saques afiliados (ver)', ['afiliados-saques.ver']])
    visao = await loginAs(app, 'so-visao')
    saquesVer = await loginAs(app, 'saques-ver')
    const w = await api(app, 'PUT', '/api/kv/afiliados.saques', { cookie: admin.cookie, body: { value: ITEMS } })
    expect(w.statusCode, w.body).toBe(200)
  })
  afterAll(async () => app.close())

  it('controle: superadmin (com ver-pix) recebe tudo em claro', async () => {
    const r = await api(app, 'GET', '/api/kv/afiliados.saques', { cookie: admin.cookie })
    expect(r.statusCode).toBe(200)
    expect(r.body).toContain(EMAIL)
    expect(r.body).toContain(PIX)
  })

  for (const [label, who] of [
    ['afiliados-visao-geral.ver', () => visao],
    ['afiliados-saques.ver', () => saquesVer],
  ] as const) {
    it(`${label} (sem ver-pix): pixKey mascarado (controle) e e-mail/banco também mascarados`, async () => {
      const r = await api(app, 'GET', '/api/kv/afiliados.saques', { cookie: who().cookie })
      console.log(`[${label}] ${r.statusCode} ${JSON.stringify(r.json().value)}`)
      expect(r.statusCode).toBe(200)
      const [ted, pix] = r.json().value
      // controle: a chave PIX já sai mascarada
      expect(pix.pixKey).not.toBe(PIX)
      // comportamento seguro esperado
      expect(ted.affiliateEmail).not.toBe(EMAIL)
      expect(ted.bank.account).not.toBe(ACCOUNT)
      expect(ted.bank.agency).not.toBe(AGENCY)
      expect(ted.bank.holder).not.toBe(HOLDER)
    })
  }
})
