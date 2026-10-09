// PoC (reprodução): geral.jogadores / geral.transacoes nunca são gravadas pelo servidor; o painel em modo
// API mostra o seed e a primeira edição manda o seed inteiro sem versão. O caminho "base inicial" de
// players.ts / transactions.ts aceita qualquer lista de quem tem usuarios.editar (Suporte), sem as regras
// do domínio, e depois as regras de inclusão/remoção/só-inclusão tornam o conteúdo permanente.
// Afirma o comportamento seguro: deve FALHAR enquanto o problema existir.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedPlayers } from '@/data/players'
import { seedTransactions } from '@/data/finance'
import { storedValue, loadRow } from '../src/modules/kv/store'
import { api, createTestApp, loginAs } from './helpers'

describe('poc-r2-api-mode-seed-fallback-2', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('Suporte instala o seed como base de jogadores e um extrato arbitrário como base do extrato', async () => {
    const sup = await loginAs(app, 'suporte', { name: 'Suporte PoC' })
    const root = await loginAs(app, 'superadmin', { name: 'Daniel Carius' })

    // 1) instalação nova: nada gravado
    for (const k of ['geral.jogadores', 'geral.transacoes']) {
      const r = await api(app, 'GET', `/api/kv/${k}`, { cookie: sup.cookie })
      console.log(`[poc] GET ${k} (Suporte) -> ${r.statusCode} stored=${(r.json() as { stored: boolean }).stored}`)
    }

    // 2) o que o painel manda ao adicionar a etiqueta "Revisar KYC" no primeiro jogador (sem versão)
    const seed = seedPlayers()
    const first = seed[0]
    const value = seed.map((p) => (p.id === first.id ? { ...p, tags: [...p.tags, 'Revisar KYC'] } : p))
    const body = JSON.stringify({ value })
    const put1 = await api(app, 'PUT', '/api/kv/geral.jogadores', { cookie: sup.cookie, body: { value } })
    const put1Body = put1.json() as { version?: number; message?: string }
    console.log(`[poc] PUT geral.jogadores (Suporte, sem versão, ${value.length} itens, ${body.length} bytes) -> ${put1.statusCode} version=${put1Body.version}`)

    const row = await loadRow(app.db, 'geral.jogadores')
    const stored = row ? (storedValue(row, app.cipher) as Array<Record<string, unknown>>) : []
    const s0 = stored.find((p) => p.id === first.id)
    console.log(`[poc] gravado: ${stored.length} jogadores; ${first.id}: cpf=${s0?.cpf} phone=${s0?.phone} email=${s0?.email} birthDate=${s0?.birthDate}`)
    const sumBalance = stored.reduce((a, p) => a + (Number(p.balanceReal) || 0) + (Number(p.balanceBonus) || 0), 0)
    console.log(`[poc] soma dos saldos (real+bônus) agora do servidor: ${sumBalance.toFixed(2)}`)
    const audit1 = await app.db.one<{ summary: string; actor_name: string }>(
      `select summary, actor_name from audit_log where summary like 'geral.jogadores%' order by id desc limit 1`,
    )
    console.log(`[poc] auditoria: ${JSON.stringify(audit1)}`)

    // 3) superadmin tenta apagar / remover um jogador inventado
    const v = row?.version ?? 0
    const del = await api(app, 'PUT', '/api/kv/geral.jogadores', { cookie: root.cookie, body: { value: [], version: v } })
    console.log(`[poc] PUT geral.jogadores (superadmin, value=[], version=${v}) -> ${del.statusCode} ${del.body}`)
    const minusOne = value.slice(1)
    const rm = await api(app, 'PUT', '/api/kv/geral.jogadores', { cookie: root.cookie, body: { value: minusOne, version: v } })
    console.log(`[poc] PUT geral.jogadores (superadmin, sem ${first.id}, version=${v}) -> ${rm.statusCode} ${rm.body}`)

    // 4) extrato: Suporte manda uma "base" de 1 lançamento forjado
    const excluded = stored.find((p) => p.status === 'autoexcluido')!
    const target = stored.find((p) => p.id === '100231')!
    console.log(`[poc] jogador 100231 status=${target?.status}; autoexcluído usado=${excluded.id} saldoReal=${excluded.balanceReal}`)
    const forged = [
      {
        id: 'TX900001',
        type: 'credito_manual',
        amount: 250000,
        playerId: excluded.id,
        by: 'Daniel Carius',
        byId: root.user.id,
        at: '2025-12-01T10:00:00Z',
        balanceAfter: 250000,
        wallet: 'real',
        reference: 'AJUSTE',
      },
    ]
    const putTx = await api(app, 'PUT', '/api/kv/geral.transacoes', { cookie: sup.cookie, body: { value: forged } })
    const putTxBody = putTx.json() as { version?: number; value?: Array<Record<string, unknown>> }
    console.log(`[poc] PUT geral.transacoes (Suporte, sem versão, crédito R$ 250.000 p/ autoexcluído ${excluded.id}, by=Daniel Carius) -> ${putTx.statusCode} version=${putTxBody.version}`)
    if (putTx.statusCode === 200) console.log(`[poc] gravado: ${JSON.stringify(putTxBody.value?.[0])}`)
    const auditTx = await app.db.query<{ summary: string; actor_name: string; action: string }>(
      `select action, summary, actor_name from audit_log where summary like 'geral.transacoes%' or action = 'creditar' order by id`,
    )
    console.log(`[poc] auditoria do extrato: ${JSON.stringify(auditTx.rows ?? auditTx)}`)
    const rowAfter = await loadRow(app.db, 'geral.jogadores')
    const ex2 = (storedValue(rowAfter, app.cipher) as Array<Record<string, unknown>>).find((p) => p.id === excluded.id)
    console.log(`[poc] saldo real do ${excluded.id} depois: ${ex2?.balanceReal} (base do extrato não mexe no saldo)`)

    // 5) depois disso, o lançamento forjado não pode ser removido (só inclusão)
    const txRow = await loadRow(app.db, 'geral.transacoes')
    if (txRow) {
      const rmTx = await api(app, 'PUT', '/api/kv/geral.transacoes', { cookie: root.cookie, body: { value: [], version: txRow.version } })
      console.log(`[poc] PUT geral.transacoes (superadmin, value=[]) -> ${rmTx.statusCode} ${rmTx.body}`)
    }

    // 6) mesmo caminho com o seed do painel (~1000 transações) na primeira creditação manual
    const app2 = await createTestApp()
    try {
      const sup2 = await loginAs(app2, 'suporte', { name: 'Suporte PoC' })
      const txSeed = seedTransactions()
      const manual = { id: 'TXNEW1', type: 'credito_manual', amount: 50, playerId: seed[0].id, wallet: 'real', reference: 'AJ-1', by: 'Suporte PoC', at: new Date().toISOString() }
      const r = await api(app2, 'PUT', '/api/kv/geral.transacoes', { cookie: sup2.cookie, body: { value: [manual, ...txSeed] } })
      console.log(`[poc] app2: PUT geral.transacoes (Suporte, seed ${txSeed.length} + 1 manual, sem versão) -> ${r.statusCode} version=${(r.json() as { version?: number }).version}`)
    } finally {
      await app2.close()
    }

    // comportamento seguro esperado: a lista de jogadores (vinda da plataforma) e o extrato não aceitam
    // uma "base" inteira enviada pelo painel por um cargo baixo, sem as regras do domínio
    expect(put1.statusCode, 'Suporte não deveria instalar uma base de jogadores enviada pelo painel').not.toBe(200)
    expect(putTx.statusCode, 'extrato forjado (R$ 250.000, autoexcluído, autor/data do cliente) não deveria ser aceito').not.toBe(200)
  })
})
