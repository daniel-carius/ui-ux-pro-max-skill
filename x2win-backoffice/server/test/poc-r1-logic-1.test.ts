// PoC (verificação): o servidor não aplica as regras de jogo responsável que o
// painel aplica só no navegador. Os testes afirmam o comportamento SEGURO e
// falham enquanto o problema existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { api, createTestApp, loginAs } from './helpers'

const put = (app: FastifyInstance, cookie: string, key: string, value: unknown, version?: number) =>
  api(app, 'PUT', `/api/kv/${key}`, { cookie, body: version === undefined ? { value } : { value, version } })
const get = (app: FastifyInstance, cookie: string, key: string) => api(app, 'GET', `/api/kv/${key}`, { cookie })

describe('poc-r1-logic-1: autoexclusão / pausa pedida pelo jogador só no navegador', () => {
  let app: FastifyInstance
  let admin: string
  let suporte: string
  const players = [
    { id: 'p1', name: 'Joana', email: 'joana@exemplo.com', status: 'autoexcluido', balanceReal: 10, balanceBonus: 0, coins: 0, tags: [] },
    { id: 'p2', name: 'Pedro', email: 'pedro@exemplo.com', status: 'pausa', balanceReal: 0, balanceBonus: 0, coins: 0, tags: [] },
    // p3 fica autoexcluído durante todo o teste (alvo da creditação)
    { id: 'p3', name: 'Ana', email: 'ana@exemplo.com', status: 'autoexcluido', balanceReal: 10, balanceBonus: 0, coins: 0, tags: [] },
  ]
  const pauseUntil = new Date(Date.now() + 30 * 86_400_000).toISOString()
  const history = [
    { id: 'h1', playerId: 'p2', action: 'pausar', reason: 'Pedido do jogador (jogo responsável)', at: new Date().toISOString(), by: 'Jogador', until: pauseUntil, byPlayer: true },
  ]
  const baseTx = [
    { id: 'TX1', at: new Date().toISOString(), playerId: 'p1', playerName: 'Joana', playerEmail: 'j@x.com', type: 'deposito', amount: 10, wallet: 'real', balanceBefore: 0, balanceAfter: 10, gameId: null, gameName: null, providerName: null, reference: 'DEP-1' },
  ]

  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app)).cookie
    suporte = (await loginAs(app, 'suporte')).cookie
    expect((await put(app, admin, 'geral.jogadores', players)).statusCode).toBe(200)
    expect((await put(app, admin, 'geral.transacoes', baseTx)).statusCode).toBe(200)
    expect((await put(app, admin, 'geral.usuarios.status', history)).statusCode).toBe(200)
  })
  afterAll(async () => app.close())

  it('Suporte NÃO pode reverter autoexclusão (autoexcluido → ativo)', async () => {
    const cur = (await get(app, suporte, 'geral.jogadores')).json() as { value: Record<string, unknown>[]; version: number }
    const next = cur.value.map((p) => (p.id === 'p1' ? { ...p, status: 'ativo' } : p))
    const r = await put(app, suporte, 'geral.jogadores', next, cur.version)
    console.log('[autoexcluido->ativo]', r.statusCode, r.body.slice(0, 300))
    expect(r.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('Suporte NÃO pode encerrar pausa pedida pelo jogador antes do prazo (pausa → ativo)', async () => {
    const cur = (await get(app, suporte, 'geral.jogadores')).json() as { value: Record<string, unknown>[]; version: number }
    const next = cur.value.map((p) => (p.id === 'p2' ? { ...p, status: 'ativo' } : p))
    const r = await put(app, suporte, 'geral.jogadores', next, cur.version)
    console.log('[pausa->ativo]', r.statusCode, r.body.slice(0, 300))
    expect(r.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('Suporte NÃO pode creditar jogador autoexcluído', async () => {
    const pl = (await get(app, admin, 'geral.jogadores')).json() as { value: { id: string; status: string }[] }
    expect(pl.value.find((p) => p.id === 'p3')?.status).toBe('autoexcluido')
    const cur = (await get(app, suporte, 'geral.transacoes')).json() as { value: Record<string, unknown>[]; version: number }
    const credit = {
      id: 'TX9000001', at: new Date().toISOString(), playerId: 'p3', playerName: 'Ana', playerEmail: 'j@x.com',
      type: 'credito_manual', amount: 5000, wallet: 'real', balanceBefore: 10, balanceAfter: 5010,
      gameId: null, gameName: null, providerName: null, reference: 'MAN-TX9000001', note: 'Bônus de relacionamento (VIP)', by: 'Suporte',
    }
    const r = await put(app, suporte, 'geral.transacoes', [...cur.value, credit], cur.version)
    console.log('[credito_manual autoexcluido]', r.statusCode, r.body.slice(0, 300))
    expect(r.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('Suporte NÃO pode apagar o registro de pausa pedida pelo jogador do histórico', async () => {
    const cur = (await get(app, suporte, 'geral.usuarios.status')).json() as { value: unknown[]; version: number }
    const r = await put(app, suporte, 'geral.usuarios.status', [], cur.version)
    console.log('[apagar historico]', r.statusCode, r.body.slice(0, 300))
    expect(r.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('estado final: autoexclusão e pausa preservadas', async () => {
    const cur = (await get(app, admin, 'geral.jogadores')).json() as { value: { id: string; status: string }[] }
    console.log('[estado final]', JSON.stringify(cur.value.map((p) => [p.id, p.status])))
    expect(cur.value.find((p) => p.id === 'p1')?.status).toBe('autoexcluido')
    expect(cur.value.find((p) => p.id === 'p2')?.status).toBe('pausa')
  })

  it('Suporte NÃO pode mudar saldo de jogador autoexcluído (balanceReal 10 → 5010)', async () => {
    const cur = (await get(app, suporte, 'geral.jogadores')).json() as { value: Record<string, unknown>[]; version: number }
    const next = cur.value.map((p) => (p.id === 'p3' ? { ...p, balanceReal: 5010 } : p))
    const r = await put(app, suporte, 'geral.jogadores', next, cur.version)
    console.log('[saldo autoexcluido]', r.statusCode, r.body.slice(0, 300))
    expect(r.statusCode).toBeGreaterThanOrEqual(400)
  })
})
