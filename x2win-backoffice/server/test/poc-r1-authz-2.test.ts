// PoC: o teto de R$ 5.000 por lançamento manual e a regra "jogador autoexcluído
// não recebe creditação" só valem no extrato (geral.transacoes). Pela lista de
// jogadores (geral.jogadores) quem tem usuarios.editar (ex.: Suporte) grava
// balanceReal com qualquer valor, sem lançamento no extrato, inclusive em
// jogador autoexcluído. Este teste afirma o comportamento SEGURO e, por isso,
// FALHA enquanto o problema existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { api, createTestApp, loginAs } from './helpers'

const put = (app: FastifyInstance, cookie: string, key: string, value: unknown, version?: number) =>
  api(app, 'PUT', `/api/kv/${key}`, { cookie, body: version === undefined ? { value } : { value, version } })
const get = (app: FastifyInstance, cookie: string, key: string) => api(app, 'GET', `/api/kv/${key}`, { cookie })

describe('PoC r1-authz-2: saldo editado direto contorna teto e autoexclusão', () => {
  let app: FastifyInstance
  let admin: string
  let suporte: string
  const PLAYERS = 'geral.jogadores'
  const TXS = 'geral.transacoes'
  const players = [
    { id: 'p1', name: 'Joana Lima', email: 'joana@exemplo.com', cpf: '12345678909', status: 'ativo', balanceReal: 100, balanceBonus: 0, coins: 0, tags: [] },
    { id: 'p2', name: 'Carlos Autoexcluido', email: 'carlos@exemplo.com', cpf: '98765432100', status: 'autoexcluido', balanceReal: 0, balanceBonus: 0, coins: 0, tags: [] },
  ]
  const ledger = [
    { id: 'TX1', at: new Date().toISOString(), playerId: 'p1', playerName: 'Joana', playerEmail: 'j@x.com', type: 'deposito', amount: 100, wallet: 'real', balanceBefore: 0, balanceAfter: 100, gameId: null, gameName: null, providerName: null, reference: 'DEP-1' },
  ]

  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app)).cookie
    suporte = (await loginAs(app, 'suporte')).cookie
    expect((await put(app, admin, PLAYERS, players)).statusCode).toBe(200)
    expect((await put(app, admin, TXS, ledger)).statusCode).toBe(200)
  })
  afterAll(async () => app.close())

  it('controle: Suporte não consegue lançar credito_manual acima do teto no extrato (400)', async () => {
    const cur = (await get(app, suporte, TXS)).json() as { value: unknown[]; version: number }
    const big = {
      id: 'TXBIG', at: new Date().toISOString(), playerId: 'p1', playerName: 'Joana', playerEmail: 'j@x.com',
      type: 'credito_manual', amount: 6000, wallet: 'real', balanceBefore: 100, balanceAfter: 6100,
      gameId: null, gameName: null, providerName: null, reference: 'MAN-BIG', note: 'teste', by: 'Suporte',
    }
    const r = await put(app, suporte, TXS, [...cur.value, big], cur.version)
    console.log('[poc] ledger credito_manual 6000 ->', r.statusCode, r.json().error?.message)
    expect(r.statusCode).toBe(400)
  })

  it('Suporte NÃO deveria conseguir pôr R$ 999.999,99 de saldo real num jogador sem lançamento (teto)', async () => {
    const cur = (await get(app, suporte, PLAYERS)).json() as { value: Record<string, unknown>[]; version: number }
    const next = cur.value.map((p) => (p.id === 'p1' ? { ...p, balanceReal: 999999.99 } : p))
    const r = await put(app, suporte, PLAYERS, next, cur.version)
    const after = (await get(app, admin, PLAYERS)).json() as { value: Record<string, unknown>[] }
    const txs = (await get(app, admin, TXS)).json() as { value: Record<string, unknown>[] }
    console.log('[poc] players PUT p1 balanceReal 999999.99 ->', r.statusCode, 'stored p1.balanceReal =', after.value.find((p) => p.id === 'p1')?.balanceReal, '| ledger entries =', txs.value.length)
    expect(r.statusCode).not.toBe(200)
    expect(after.value.find((p) => p.id === 'p1')?.balanceReal).toBe(100)
  })

  it('Suporte NÃO deveria conseguir creditar saldo a jogador autoexcluído pela lista de jogadores', async () => {
    const cur = (await get(app, suporte, PLAYERS)).json() as { value: Record<string, unknown>[]; version: number }
    const next = cur.value.map((p) => (p.id === 'p2' ? { ...p, balanceReal: 4999.99 } : p))
    const r = await put(app, suporte, PLAYERS, next, cur.version)
    const after = (await get(app, admin, PLAYERS)).json() as { value: Record<string, unknown>[] }
    const p2 = after.value.find((p) => p.id === 'p2')
    console.log('[poc] players PUT p2(autoexcluido) balanceReal 4999.99 ->', r.statusCode, 'stored p2 =', p2?.status, p2?.balanceReal)
    expect(r.statusCode).not.toBe(200)
    expect(p2?.balanceReal).toBe(0)
  })

  it('Suporte NÃO deveria conseguir lançar credito_manual a jogador autoexcluído no extrato', async () => {
    const cur = (await get(app, suporte, TXS)).json() as { value: unknown[]; version: number }
    const credit = {
      id: 'TXAE', at: new Date().toISOString(), playerId: 'p2', playerName: 'Carlos', playerEmail: 'c@x.com',
      type: 'credito_manual', amount: 100, wallet: 'real', balanceBefore: 0, balanceAfter: 100,
      gameId: null, gameName: null, providerName: null, reference: 'MAN-AE', note: 'teste', by: 'Suporte',
    }
    const r = await put(app, suporte, TXS, [...cur.value, credit], cur.version)
    console.log('[poc] ledger credito_manual 100 to autoexcluido ->', r.statusCode)
    expect(r.statusCode).not.toBe(200)
  })
})
