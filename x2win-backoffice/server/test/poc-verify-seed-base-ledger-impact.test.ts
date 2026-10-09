// PoC (verificação de impacto): base inicial de geral.jogadores / geral.transacoes enviada pelo Suporte.
// Mede o alcance real: o que foi gravado é o seed público do bundle (gerador determinístico), o extrato
// forjado não mexe em saldo nem gera auditoria com o nome forjado, e um DELETE no banco volta ao estado inicial.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedPlayers } from '@/data/players'
import { loadRow, storedValue } from '../src/modules/kv/store'
import { api, createTestApp, loginAs } from './helpers'

describe('poc-verify-seed-base-ledger-impact', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('alcance da base inicial forjada', async () => {
    const sup = await loginAs(app, 'suporte', { name: 'Suporte PoC' })
    const root = await loginAs(app, 'superadmin', { name: 'Daniel Carius' })
    const seed = seedPlayers()
    const value = seed.map((p, i) => (i === 0 ? { ...p, tags: [...p.tags, 'Revisar KYC'] } : p))
    const put1 = await api(app, 'PUT', '/api/kv/geral.jogadores', { cookie: sup.cookie, body: { value } })
    console.log(`[impact] PUT geral.jogadores (Suporte, seed) -> ${put1.statusCode}`)
    const stored = storedValue(await loadRow(app.db, 'geral.jogadores'), app.cipher) as Array<Record<string, unknown>>
    const again = seedPlayers()
    const sameAsBundle = stored.every((p, i) => p.cpf === again[i].cpf && p.email === again[i].email && p.phone === again[i].phone)
    console.log(`[impact] PII gravada = saída do gerador determinístico do bundle (createRng(2026)): ${sameAsBundle}`)

    const target = stored.find((p) => p.id === '100231')!
    const before = target.balanceReal
    const forged = [{ id: 'TX900001', type: 'credito_manual', amount: 250000, playerId: '100231', by: 'Daniel Carius', at: '2025-12-01T10:00:00Z', balanceAfter: 250000 }]
    const putTx = await api(app, 'PUT', '/api/kv/geral.transacoes', { cookie: sup.cookie, body: { value: forged } })
    console.log(`[impact] PUT geral.transacoes (Suporte, extrato forjado) -> ${putTx.statusCode}`)
    const after = (storedValue(await loadRow(app.db, 'geral.jogadores'), app.cipher) as Array<Record<string, unknown>>).find((p) => p.id === '100231')!
    console.log(`[impact] saldo real 100231: antes=${before} depois=${after.balanceReal}`)
    const audits = await app.db.query<{ action: string; actor_name: string; summary: string }>(
      `select action, actor_name, summary from audit_log where summary like 'geral.%' or action = 'creditar' order by id`,
    )
    console.log(`[impact] auditoria: ${JSON.stringify(audits)}`)
    const daniel = audits.filter((a) => a.actor_name === 'Daniel Carius')
    console.log(`[impact] registros de auditoria em nome de Daniel: ${daniel.length}`)

    // recuperação pelo operador do banco
    await app.db.query(`delete from kv_store where key in ('geral.jogadores', 'geral.transacoes')`)
    const g = (await api(app, 'GET', '/api/kv/geral.jogadores', { cookie: root.cookie })).json() as { stored: boolean }
    const gt = (await api(app, 'GET', '/api/kv/geral.transacoes', { cookie: root.cookie })).json() as { stored: boolean }
    console.log(`[impact] depois de DELETE no kv_store: jogadores stored=${g.stored}, transacoes stored=${gt.stored}`)

    expect(put1.statusCode).toBe(200)
    expect(putTx.statusCode).toBe(200)
    expect(sameAsBundle).toBe(true)
    expect(after.balanceReal).toBe(before)
    expect(daniel.length).toBe(0)
    expect(g.stored).toBe(false)
    expect(gt.stored).toBe(false)
  })
})
