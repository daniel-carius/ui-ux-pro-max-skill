// PoC r1-logic-5: o extrato "só de inclusão" (geral.transacoes) grava o lançamento
// novo exatamente como o cliente mandou: autor (`by`), data (`at`), saldos e jogador.
// Os testes afirmam o comportamento SEGURO e falham enquanto o problema existir.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { api, createTestApp, loginAs } from './helpers'

const KEY = 'geral.transacoes'
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

const base = [
  { id: 'TX1', at: daysAgo(1), playerId: 'p1', playerName: 'Joana', playerEmail: 'j@x.com', type: 'deposito', amount: 100, wallet: 'real', balanceBefore: 0, balanceAfter: 100, gameId: null, gameName: null, providerName: null, reference: 'DEP-1' },
  { id: 'TX2', at: daysAgo(1), playerId: 'p1', playerName: 'Joana', playerEmail: 'j@x.com', type: 'aposta', amount: -20, wallet: 'real', balanceBefore: 100, balanceAfter: 80, gameId: 'g1', gameName: 'Slot', providerName: 'Prov', reference: 'BET-1' },
]

const manual = (id: string, type: 'credito_manual' | 'debito_manual', amount: number, extra: Record<string, unknown> = {}) => ({
  id,
  at: new Date().toISOString(),
  playerId: 'p1',
  playerName: 'Joana',
  playerEmail: 'j@x.com',
  type,
  amount,
  wallet: 'real',
  balanceBefore: 80,
  balanceAfter: 80 + amount,
  gameId: null,
  gameName: null,
  providerName: null,
  reference: `MAN-${id}`,
  note: 'Ajuste de teste',
  ...extra,
})

describe('poc r1-logic-5: lançamentos do extrato confiam no cliente', () => {
  let app: FastifyInstance
  let admin: string
  let suporte: string
  let estornos: string

  const current = async (cookie = admin) => {
    const r = await api(app, 'GET', `/api/kv/${KEY}`, { cookie })
    return r.json() as { value: Record<string, unknown>[]; version: number }
  }
  const put = (cookie: string, value: unknown, version?: number) =>
    api(app, 'PUT', `/api/kv/${KEY}`, { cookie, body: { value, ...(version !== undefined ? { version } : {}) } })

  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app, 'superadmin', { name: 'Daniel Superadmin' })).cookie
    suporte = (await loginAs(app, 'suporte', { name: 'Sara Suporte' })).cookie
    await app.db.query('insert into roles (id, name, permissions) values ($1, $2, $3)', ['estornos', 'Cargo estornos', ['transacoes.ver', 'transacoes.editar']])
    estornos = (await loginAs(app, 'estornos', { name: 'Ester Estornos' })).cookie
    const w = await put(admin, base)
    expect(w.statusCode).toBe(200)
  })
  afterAll(async () => app.close())

  it('Suporte não consegue forjar autor, data, saldos nem jogador de um lançamento novo', async () => {
    const cur = await current(suporte)
    const forged = manual('TXF', 'credito_manual', 5000, {
      at: '2019-01-01T00:00:00Z',
      by: 'Daniel Superadmin',
      balanceBefore: 1,
      balanceAfter: 123456,
      playerId: 'jogador-que-nao-existe',
      playerName: 'Fantasma',
    })
    // item novo colocado ANTES dos já gravados
    const r = await put(suporte, [forged, ...cur.value], cur.version)
    console.log('[poc] PUT status', r.statusCode)
    const after = await current(admin)
    const stored = after.value.find((t) => t.id === 'TXF')
    console.log('[poc] stored order', after.value.map((t) => t.id).join(','))
    console.log('[poc] stored TXF', JSON.stringify(stored))
    const audit = await app.db.query<{ actor_name: string; action: string; summary: string }>(
      'select actor_name, action, summary from audit_log order by id desc limit 1',
    )
    console.log('[poc] last audit', JSON.stringify(audit[0]))

    // comportamento seguro: ou a gravação é recusada, ou o servidor impõe autor/data reais
    if (r.statusCode === 200) {
      expect(stored?.by, 'autor exibido em "Lançado por" veio do cliente').not.toBe('Daniel Superadmin')
      expect(Math.abs(Date.parse(String(stored?.at)) - Date.now()), '"at" retrodatado aceito').toBeLessThan(5 * 60_000)
    } else {
      expect(r.statusCode).toBeGreaterThanOrEqual(400)
    }
  })

  it('subtração com data futura fica estornável para sempre (prazo de 15 dias ignorado)', async () => {
    // controle: subtração retrodatada a 30 dias não pode ser estornada (prazo usa o "at" do cliente)
    let cur = await current(suporte)
    const old = await put(suporte, [...cur.value, manual('TXOLD', 'debito_manual', -10, { at: daysAgo(30) })], cur.version)
    expect(old.statusCode).toBe(200)
    cur = await current(estornos)
    const revOld = await put(estornos, [...cur.value, { ...manual('TXR0', 'credito_manual', 10), type: 'estorno', reference: 'EST-TXOLD' }], cur.version)
    console.log('[poc] estorno de subtração retrodatada 30d:', revOld.statusCode, revOld.json().error?.message)

    // ataque: subtração com "at" em 2099 (+ uma subtração honesta, de agora, como controle)
    cur = await current(suporte)
    const fut = await put(suporte, [...cur.value, manual('TXFUT', 'debito_manual', -10, { at: '2099-01-01T00:00:00Z' }), manual('TXHON', 'debito_manual', -10)], cur.version)
    console.log('[poc] subtração com at=2099:', fut.statusCode)
    expect(fut.statusCode).toBe(200)

    // 400 dias depois, o estorno ainda passa
    const realNow = Date.now()
    const future = realNow + 400 * 86_400_000
    const spy = vi.spyOn(Date, 'now').mockReturnValue(future)
    try {
      // mantém as sessões vivas no "futuro" (só para o teste)
      await app.db.query('update sessions set last_seen_at = $1, expires_at = $2', [new Date(future).toISOString(), new Date(future + 86_400_000).toISOString()])
      cur = await current(estornos)
      const ctl = await put(estornos, [...cur.value, { ...manual('TXR2', 'credito_manual', 10), type: 'estorno', reference: 'EST-TXHON' }], cur.version)
      console.log('[poc] controle: estorno 400 dias depois de subtração honesta:', ctl.statusCode, ctl.json().error?.message ?? '')
      expect(ctl.statusCode, 'controle: o relógio simulado precisa acionar o prazo').toBe(400)
      const rev = await put(estornos, [...cur.value, { ...manual('TXR1', 'credito_manual', 10), type: 'estorno', reference: 'EST-TXFUT' }], cur.version)
      console.log('[poc] estorno 400 dias depois de uma subtração com at=2099:', rev.statusCode, rev.json().error?.message ?? '')
      expect(rev.statusCode, 'estorno aceito fora do prazo real de 15 dias').toBe(400)
    } finally {
      spy.mockRestore()
    }
  })
})
