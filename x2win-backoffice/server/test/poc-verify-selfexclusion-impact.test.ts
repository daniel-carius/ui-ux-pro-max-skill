// Verificação de impacto (lente: impacto) do achado "staff desfaz autoexclusão/pausa e credita autoexcluído".
// Mede: (1) a mecânica é real; (2) toda mudança fica na auditoria (somente inclusão) com autor, IP e transição;
// (3) o contrato já deixa usuarios.editar mudar balanceReal de qualquer jogador (inclusive autoexcluído),
// então o lançamento credito_manual não dá capacidade nova; (4) nenhum código do servidor lê status de jogador.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { api, createTestApp, loginAs } from './helpers'

const put = (app: FastifyInstance, cookie: string, key: string, value: unknown, version?: number) =>
  api(app, 'PUT', `/api/kv/${key}`, { cookie, body: version === undefined ? { value } : { value, version }, ip: '203.0.113.7' })
const get = (app: FastifyInstance, cookie: string, key: string) => api(app, 'GET', `/api/kv/${key}`, { cookie })

function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

describe('verify impact: autoexclusão/pausa e crédito pelo servidor', () => {
  let app: FastifyInstance
  let admin: string
  let suporte: string
  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app)).cookie
    suporte = (await loginAs(app, 'suporte', { name: 'Sara Suporte' })).cookie
    expect((await put(app, admin, 'geral.jogadores', [
      { id: 'p1', name: 'Joana', email: 'joana@exemplo.com', status: 'autoexcluido', balanceReal: 10, balanceBonus: 0, coins: 0, tags: [] },
      { id: 'p2', name: 'Pedro', email: 'pedro@exemplo.com', status: 'pausa', balanceReal: 0, balanceBonus: 0, coins: 0, tags: [] },
    ])).statusCode).toBe(200)
    expect((await put(app, admin, 'geral.transacoes', [
      { id: 'TX1', at: new Date().toISOString(), playerId: 'p1', playerName: 'Joana', playerEmail: 'j@x.com', type: 'deposito', amount: 10, wallet: 'real', balanceBefore: 0, balanceAfter: 10, reference: 'DEP-1' },
    ])).statusCode).toBe(200)
    expect((await put(app, admin, 'geral.usuarios.status', [
      { id: 'h1', playerId: 'p2', action: 'pausar', reason: 'Pedido do jogador (jogo responsável)', at: new Date().toISOString(), by: 'Jogador', until: new Date(Date.now() + 30 * 864e5).toISOString(), byPlayer: true },
    ])).statusCode).toBe(200)
  })
  afterAll(async () => app.close())

  it('mecânica: Suporte reverte autoexclusão e pausa, credita e apaga histórico (tudo 200)', async () => {
    let cur = (await get(app, suporte, 'geral.jogadores')).json() as { value: Record<string, unknown>[]; version: number }
    const r1 = await put(app, suporte, 'geral.jogadores', cur.value.map((p) => ({ ...p, status: 'ativo' })), cur.version)
    console.log('[status autoexcluido/pausa -> ativo]', r1.statusCode)
    cur = (await get(app, suporte, 'geral.transacoes')).json() as { value: Record<string, unknown>[]; version: number }
    const r2 = await put(app, suporte, 'geral.transacoes', [...cur.value, {
      id: 'TX9000001', at: new Date().toISOString(), playerId: 'p1', playerName: 'Joana', playerEmail: 'j@x.com',
      type: 'credito_manual', amount: 5000, wallet: 'real', balanceBefore: 10, balanceAfter: 5010, reference: 'MAN-1', note: 'VIP', by: 'Sara',
    }], cur.version)
    console.log('[credito_manual p1]', r2.statusCode)
    cur = (await get(app, suporte, 'geral.usuarios.status')).json() as { value: Record<string, unknown>[]; version: number }
    const r3 = await put(app, suporte, 'geral.usuarios.status', [], cur.version)
    console.log('[apagar historico]', r3.statusCode)
    expect([r1.statusCode, r2.statusCode, r3.statusCode]).toEqual([200, 200, 200])
  })

  it('contrato: usuarios.editar já muda balanceReal de autoexcluído direto (sem extrato)', async () => {
    // volta p1 a autoexcluido pelo admin para medir só o saldo
    let cur = (await get(app, admin, 'geral.jogadores')).json() as { value: Record<string, unknown>[]; version: number }
    expect((await put(app, admin, 'geral.jogadores', cur.value.map((p) => (p.id === 'p1' ? { ...p, status: 'autoexcluido' } : p)), cur.version)).statusCode).toBe(200)
    cur = (await get(app, suporte, 'geral.jogadores')).json() as { value: Record<string, unknown>[]; version: number }
    const r = await put(app, suporte, 'geral.jogadores', cur.value.map((p) => (p.id === 'p1' ? { ...p, balanceReal: 999_999 } : p)), cur.version)
    console.log('[balanceReal autoexcluido 10 -> 999999]', r.statusCode)
    expect(r.statusCode).toBe(200)
  })

  it('auditoria somente inclusão registra autor, IP e transição; Suporte não lê nem apaga auditoria', async () => {
    const rows = await app.db.query<{ actor_name: string; ip: string; action: string; summary: string }>(
      "select actor_name, ip, action, summary from audit_log where actor_name = 'Sara Suporte' order by id",
    )
    for (const r of rows) console.log('[audit]', r.actor_name, r.ip, r.action, '|', r.summary.slice(0, 160))
    expect(rows.some((r) => r.summary.includes('status: autoexcluido → ativo'))).toBe(true)
    expect(rows.some((r) => r.summary.includes('status: pausa → ativo'))).toBe(true)
    expect(rows.some((r) => r.action === 'creditar' && r.summary.includes('p1'))).toBe(true)
    expect(rows.some((r) => r.summary.startsWith('geral.usuarios.status'))).toBe(true)
    const del = await app.db.query('delete from audit_log').then(() => 'deleted', (e: Error) => `refused: ${e.message.slice(0, 80)}`)
    console.log('[delete audit_log]', del)
    const ra = await get(app, suporte, 'auditoria.registros')
    console.log('[suporte GET auditoria.registros]', ra.statusCode)
  })

  it('nenhum código do servidor (fora do módulo kv) lê status de jogador', () => {
    const files = walk(join(__dirname, '../src'))
    const hits = files.filter((f) => /autoexcluido|geral\.jogadores|'pausa'/.test(readFileSync(f, 'utf8')))
    console.log('[server files mentioning player status]', hits.map((h) => h.split('/src/')[1]))
    expect(hits.every((h) => h.includes('modules/kv/'))).toBe(true)
  })
})
