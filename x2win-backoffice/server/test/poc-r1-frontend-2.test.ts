// PoC r1-frontend-2: o mascaramento de dados de pagamento de afiliados (agência, conta,
// titular, e-mail) e do e-mail do jogador no extrato só acontece no painel; o GET
// /api/kv devolve tudo em claro para cargos sem a permissão de revelar.
// Os testes afirmam o comportamento SEGURO e falham enquanto o problema existir.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, createTestApp, loginAs } from './helpers'

const now = new Date().toISOString()

const withdrawals = [
  {
    id: 'AS1',
    affiliateId: 'af1',
    affiliateName: 'Joana Afiliada',
    affiliateEmail: 'af@x.com',
    affiliateType: 'influencer',
    amount: 1500,
    method: 'ted',
    pixKeyType: null,
    pixKey: null,
    bank: { bank: '341 · Itaú', agency: '4321', account: '123456-7', holder: 'Joana Afiliada' },
    status: 'pendente',
    createdAt: now,
    decidedAt: null,
    decidedBy: null,
    reason: null,
    reference: null,
  },
  {
    id: 'AS2',
    affiliateId: 'af2',
    affiliateName: 'Carlos Afiliado',
    affiliateEmail: 'carlos.af@x.com',
    affiliateType: 'influencer',
    amount: 900,
    method: 'pix',
    pixKeyType: 'CPF',
    pixKey: '12345678909',
    bank: null,
    status: 'pendente',
    createdAt: now,
    decidedAt: null,
    decidedBy: null,
    reason: null,
    reference: null,
  },
]

const affiliates = [
  { id: 'af1', playerId: 'p9', name: 'Joana Afiliada', email: 'af@x.com', type: 'influencer', level: 1, managerId: null, code: 'JOANA', cpa: 50, revShare: 30, status: 'ativo', balance: 0, pixKey: '12345678909', createdAt: now },
]

const tx = [
  { id: 'TX1', at: now, playerId: 'p1', playerName: 'Jogador Real', playerEmail: 'jogador.real@gmail.com', type: 'credito_manual', amount: 50, wallet: 'real', balanceBefore: 0, balanceAfter: 50, gameId: null, gameName: null, providerName: null, reference: 'MAN-1' },
]

const players = [
  { id: 'p1', name: 'Jogador Real', email: 'jogador.real@gmail.com', cpf: '12345678909', phone: '11987654321', status: 'ativo', tags: [], balanceReal: 50, balanceBonus: 0, coins: 0 },
]

describe('poc r1-frontend-2: PII mascarada só no painel', () => {
  let app: FastifyInstance
  let admin: string
  let leitura: string
  let suporte: string

  const get = async (cookie: string, key: string) => {
    const r = await api(app, 'GET', `/api/kv/${key}`, { cookie })
    expect(r.statusCode).toBe(200)
    return (r.json() as { value: any }).value
  }

  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app, 'superadmin')).cookie
    await app.db.query('insert into roles (id, name, permissions) values ($1, $2, $3)', ['afiliados-leitura', 'Afiliados leitura', ['afiliados-saques.ver']])
    leitura = (await loginAs(app, 'afiliados-leitura')).cookie
    suporte = (await loginAs(app, 'suporte')).cookie
    for (const [key, value] of [
      ['afiliados.saques', withdrawals],
      ['crescimento.afiliados', affiliates],
      ['geral.transacoes', tx],
      ['geral.jogadores', players],
    ] as const) {
      const r = await api(app, 'PUT', `/api/kv/${key}`, { cookie: admin, body: { value } })
      expect(r.statusCode, `${key}: ${r.body}`).toBe(200)
    }
  })
  afterAll(async () => app.close())

  it('cargo sem afiliados-saques.ver-pix não recebe agência, conta, titular nem e-mail do afiliado em claro', async () => {
    const v = (await get(leitura, 'afiliados.saques')) as typeof withdrawals
    const ted = v.find((w) => w.id === 'AS1')!
    const pix = v.find((w) => w.id === 'AS2')!
    console.log('[poc] afiliados.saques AS1 (afiliados-leitura):', JSON.stringify({ bank: ted.bank, affiliateEmail: ted.affiliateEmail }))
    console.log('[poc] afiliados.saques AS2 pixKey (afiliados-leitura):', pix.pixKey, '| affiliateEmail:', pix.affiliateEmail)
    const aff = (await get(leitura, 'crescimento.afiliados')) as typeof affiliates
    console.log('[poc] crescimento.afiliados email (mesmo cargo):', aff[0].email, '| pixKey:', aff[0].pixKey)
    // controle: o servidor mascara pixKey e o e-mail do afiliado em crescimento.afiliados
    expect(pix.pixKey).not.toBe('12345678909')
    expect(aff[0].email).not.toBe('af@x.com')
    // comportamento seguro esperado
    expect(ted.bank!.agency).not.toBe('4321')
    expect(ted.bank!.account).not.toBe('123456-7')
    expect(ted.bank!.holder).not.toBe('Joana Afiliada')
    expect(ted.affiliateEmail).not.toBe('af@x.com')
  })

  it('Suporte (sem usuarios.ver-dados) não recebe o e-mail do jogador em claro pelo extrato', async () => {
    const pl = (await get(suporte, 'geral.jogadores')) as typeof players
    const v = (await get(suporte, 'geral.transacoes')) as typeof tx
    console.log('[poc] geral.jogadores email (suporte):', pl[0].email, '| cpf:', pl[0].cpf)
    console.log('[poc] geral.transacoes playerEmail (suporte):', v[0].playerEmail)
    // controle: o mesmo e-mail sai mascarado em geral.jogadores
    expect(pl[0].email).not.toBe('jogador.real@gmail.com')
    // comportamento seguro esperado
    expect(v[0].playerEmail).not.toBe('jogador.real@gmail.com')
  })
})
