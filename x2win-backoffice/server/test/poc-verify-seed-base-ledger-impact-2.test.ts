// PoC (verificação independente de impacto): base inicial de geral.jogadores / geral.transacoes
// gravada pelo Suporte numa instalação nova. Mede: a mecânica descrita, se o extrato forjado
// mexe em saldo/dinheiro, quem aparece na auditoria e se um estorno sobre a base forjada
// (cargo com transacoes.editar) chega ao saldo.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedPlayers } from '@/data/players'
import { seedTransactions } from '@/data/finance'
import { loadRow, storedValue } from '../src/modules/kv/store'
import { api, createTestApp, loginAs } from './helpers'

type P = Record<string, unknown>

describe('poc-verify-seed-base-ledger-impact-2', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('mecânica e alcance', async () => {
    const sup = await loginAs(app, 'suporte', { name: 'Suporte PoC' })
    const root = await loginAs(app, 'superadmin', { name: 'Daniel Carius' })
    const players = seedPlayers()
    const p0 = players.find((p) => p.id === '100231')!
    console.log(`[v2] seed: ${players.length} jogadores; 100231 status=${p0.status} balanceReal=${p0.balanceReal}`)
    console.log(`[v2] seedTransactions: ${seedTransactions().length} itens`)

    // 1) primeira edição pelo Suporte (o que o painel manda: seed inteiro sem versão)
    const value = players.map((p, i) => (i === 0 ? { ...p, tags: [...p.tags, 'Revisar KYC'] } : p))
    const body = JSON.stringify({ value })
    const put1 = await api(app, 'PUT', '/api/kv/geral.jogadores', { cookie: sup.cookie, body: { value } })
    console.log(`[v2] PUT geral.jogadores (Suporte, ${body.length} bytes, sem versão) -> ${put1.statusCode} v=${put1.json().version}`)

    // 2) superadmin tenta esvaziar / remover um
    const v = put1.json().version
    const empty = await api(app, 'PUT', '/api/kv/geral.jogadores', { cookie: root.cookie, body: { value: [], version: v } })
    const cur = (await api(app, 'GET', '/api/kv/geral.jogadores', { cookie: root.cookie })).json() as { value: P[]; version: number }
    const minusOne = await api(app, 'PUT', '/api/kv/geral.jogadores', { cookie: root.cookie, body: { value: cur.value.slice(1), version: cur.version } })
    console.log(`[v2] superadmin PUT [] -> ${empty.statusCode} ${empty.json().error?.code}; sem 1 -> ${minusOne.statusCode} ${minusOne.json().error?.code}`)

    // 3) Suporte grava extrato forjado como base
    const forged = [
      { id: 'TX900001', type: 'credito_manual', amount: 250000, playerId: '100231', by: 'Daniel Carius', at: '2025-12-01T10:00:00Z', balanceAfter: 250000 },
      // aposta forjada recente, para medir se um estorno depois leva a saldo
      { id: 'TX900002', type: 'aposta', amount: -1000000, playerId: '100238', wallet: 'real', at: new Date().toISOString(), by: 'Daniel Carius' },
    ]
    const putTx = await api(app, 'PUT', '/api/kv/geral.transacoes', { cookie: sup.cookie, body: { value: forged } })
    console.log(`[v2] PUT geral.transacoes (Suporte, extrato forjado, sem versão) -> ${putTx.statusCode} v=${putTx.json().version}`)

    const after = storedValue(await loadRow(app.db, 'geral.jogadores'), app.cipher) as P[]
    const t231 = after.find((p) => p.id === '100231')!
    console.log(`[v2] saldo real 100231 depois do extrato forjado: ${t231.balanceReal} (seed ${p0.balanceReal})`)

    const audits = await app.db.query<{ action: string; actor_name: string; summary: string }>(
      `select action, actor_name, summary from audit_log where summary like 'geral.%' or action in ('creditar','estornar') order by id`,
    )
    console.log(`[v2] auditoria: ${JSON.stringify(audits.map((a) => `${a.action}|${a.actor_name}|${a.summary.slice(0, 80)}`))}`)

    // 4) depois da base, tentativa legítima de lançar acima do teto ou para autoexcluído segue barrada
    const txCur = (await api(app, 'GET', '/api/kv/geral.transacoes', { cookie: root.cookie })).json() as { value: P[]; version: number }
    const big = await api(app, 'PUT', '/api/kv/geral.transacoes', {
      cookie: sup.cookie,
      body: { value: [{ id: 'TX1', playerId: '100238', type: 'credito_manual', amount: 6000, wallet: 'real', reference: 'AJ-1' }, ...txCur.value], version: txCur.version },
    })
    console.log(`[v2] crédito 6000 depois da base -> ${big.statusCode} ${big.json().error?.message}`)

    // 5) cadeia: estorno (Superadmin, transacoes.editar) da aposta forjada → saldo
    const p238before = (after.find((p) => p.id === '100238')!.balanceReal as number) ?? 0
    const est = await api(app, 'PUT', '/api/kv/geral.transacoes', {
      cookie: root.cookie,
      body: { value: [{ id: 'TX2', playerId: '100238', type: 'estorno', amount: 1000000, wallet: 'real', reference: 'EST-TX900002' }, ...txCur.value], version: txCur.version },
    })
    const after2 = storedValue(await loadRow(app.db, 'geral.jogadores'), app.cipher) as P[]
    console.log(`[v2] estorno da aposta forjada (Superadmin) -> ${est.statusCode}; saldo 100238 ${p238before} -> ${after2.find((p) => p.id === '100238')!.balanceReal}`)

    // 6) dinheiro: saques vêm de tabela própria, sem relação com o saldo da lista
    const wd = await app.db.query<{ n: number }>(`select count(*)::int as n from withdrawals`)
    console.log(`[v2] saques na tabela withdrawals: ${wd[0].n}`)

    expect(put1.statusCode).toBe(200)
    expect(empty.statusCode).toBe(403)
    expect(minusOne.statusCode).toBe(403)
    expect(putTx.statusCode).toBe(200)
    expect(t231.balanceReal).toBe(p0.balanceReal)
    expect(audits.some((a) => a.actor_name === 'Daniel Carius' && a.summary.startsWith('geral.transacoes — Base'))).toBe(false)
  })
})
