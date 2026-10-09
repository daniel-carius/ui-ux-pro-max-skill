// PoC: o servidor deixa Suporte (usuarios.editar) e quem tem antifraude.banir
// reverterem a autoexclusão de um jogador e encerrarem uma pausa pedida pelo
// jogador. A regra ("Autoexclusão é decisão do jogador: o painel não reverte")
// existe só no painel (src/domain/geral.ts statusActions).
// Os testes afirmam o comportamento seguro: falham enquanto o defeito existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { api, createTestApp, loginAs } from './helpers'

const KEY = 'geral.jogadores'
const put = (app: FastifyInstance, cookie: string, value: unknown, version?: number) =>
  api(app, 'PUT', `/api/kv/${KEY}`, { cookie, body: version === undefined ? { value } : { value, version } })
const get = (app: FastifyInstance, cookie: string) => api(app, 'GET', `/api/kv/${KEY}`, { cookie })

async function storedStatuses(app: FastifyInstance): Promise<Record<string, string>> {
  const r = await app.db.one<{ value: unknown; value_enc: string | null }>('select value, value_enc from kv_store where key = $1', [KEY])
  const list = (r!.value_enc ? JSON.parse(app.cipher.decrypt(r!.value_enc)) : r!.value) as { id: string; status: string }[]
  return Object.fromEntries(list.map((p) => [p.id, p.status]))
}

const base = [
  { id: 'p1', name: 'Joana Lima', email: 'joana@exemplo.com', cpf: '12345678909', status: 'autoexcluido', balanceReal: 10, balanceBonus: 0, coins: 0, tags: [] },
  { id: 'p2', name: 'Pedro Alves', email: 'pedro@exemplo.com', cpf: '98765432100', status: 'pausa', balanceReal: 5, balanceBonus: 0, coins: 0, tags: [] },
  { id: 'p3', name: 'Ana Souza', email: 'ana@exemplo.com', cpf: '11122233344', status: 'autoexcluido', balanceReal: 0, balanceBonus: 0, coins: 0, tags: [] },
]

describe('PoC r1-authz-1: autoexclusão/pausa do jogador revertida por cargo baixo', () => {
  let app: FastifyInstance
  let admin: string
  let suporte: string
  let antifraude: string

  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app)).cookie
    suporte = (await loginAs(app, 'suporte')).cookie
    await app.db.query('insert into roles (id, name, permissions) values ($1, $2, $3)', ['antifraude-only', 'Antifraude só', ['antifraude.ver', 'antifraude.banir']])
    antifraude = (await loginAs(app, 'antifraude-only')).cookie
    const w = await put(app, admin, base)
    expect(w.statusCode).toBe(200)
  })
  afterAll(async () => app.close())

  it('Suporte NÃO deve conseguir reverter autoexclusão (autoexcluido → ativo)', async () => {
    const cur = (await get(app, suporte)).json() as { value: { id: string; status: string }[]; version: number }
    const next = structuredClone(cur.value)
    next.find((p) => p.id === 'p1')!.status = 'ativo'
    const w = await put(app, suporte, next, cur.version)
    console.log('[suporte autoexcluido→ativo]', w.statusCode, w.body.slice(0, 200))
    console.log('[stored after suporte]', JSON.stringify(await storedStatuses(app)))
    expect(w.statusCode).toBeGreaterThanOrEqual(400)
    expect((await storedStatuses(app)).p1).toBe('autoexcluido')
  })

  it('Suporte NÃO deve conseguir encerrar pausa sem histórico (conta como pedida pelo jogador)', async () => {
    const cur = (await get(app, suporte)).json() as { value: { id: string; status: string }[]; version: number }
    const next = structuredClone(cur.value)
    next.find((p) => p.id === 'p2')!.status = 'ativo'
    const w = await put(app, suporte, next, cur.version)
    console.log('[suporte pausa→ativo]', w.statusCode, w.body.slice(0, 200))
    console.log('[stored after pausa]', JSON.stringify(await storedStatuses(app)))
    expect(w.statusCode).toBeGreaterThanOrEqual(400)
    expect((await storedStatuses(app)).p2).toBe('pausa')
  })

  it('antifraude.banir NÃO deve conseguir reverter autoexclusão', async () => {
    const cur = (await get(app, antifraude)).json() as { value: { id: string; status: string }[]; version: number }
    const next = structuredClone(cur.value)
    next.find((p) => p.id === 'p3')!.status = 'ativo'
    const w = await put(app, antifraude, next, cur.version)
    console.log('[antifraude autoexcluido→ativo]', w.statusCode, w.body.slice(0, 200))
    console.log('[stored after antifraude]', JSON.stringify(await storedStatuses(app)))
    expect(w.statusCode).toBeGreaterThanOrEqual(400)
    expect((await storedStatuses(app)).p3).toBe('autoexcluido')
  })
})
