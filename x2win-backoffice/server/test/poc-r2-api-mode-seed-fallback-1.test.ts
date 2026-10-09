// PoC (reprodução): instalação nova (DEMO_DATA desligado). GET /api/kv/afiliados.saques devolve
// stored:false; o painel em modo API (src/lib/store.ts materialize) usa seedAffiliateWithdrawals()
// como se fosse o registro real e, no primeiro "Pagar", envia o seed inteiro num PUT sem versão,
// que o servidor aceita (assertVersion sem linha aceita qualquer versão).
// Afirma o comportamento seguro: deve FALHAR enquanto o problema existir.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedAffiliateWithdrawals } from '@/data/afiliados'
import { loadRow, storedValue } from '../src/modules/kv/store'
import { api, createTestApp, loginAs } from './helpers'

type W = { id: string; status: string; pixKey: string | null; pixKeyType: string | null; decidedBy: string | null; decidedAt: string | null }

describe('poc-r2-api-mode-seed-fallback-1', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('primeiro "Pagar" num banco vazio não pode gravar o seed de demonstração como registro de produção', async () => {
    const root = await loginAs(app, 'superadmin', { name: 'Admin PoC' })

    // 1) instalação nova: nada gravado nas chaves financeiras sem módulo de domínio
    for (const k of ['afiliados.saques', 'crescimento.afiliados', 'operacao.depositos', 'esportes.apostas', 'crescimento.ggr.apuracoes']) {
      const r = await api(app, 'GET', `/api/kv/${k}`, { cookie: root.cookie })
      const b = r.json() as { stored: boolean; version: number }
      console.log(`[poc] GET ${k} -> ${r.statusCode} stored=${b.stored} version=${b.version}`)
    }

    // 2) o painel mostra o seed (materialize com kind 'missing') e "Pagar" no primeiro pendente faz
    //    dbSet(prev => prev.map(...)) sobre o seed: PUT { value } sem versão
    const seed = seedAffiliateWithdrawals() as unknown as W[]
    const target = seed.find((w) => w.status === 'pendente')!
    const value = seed.map((w) =>
      w.id === target.id ? { ...w, status: 'pago', decidedAt: new Date().toISOString(), decidedBy: 'Admin PoC', reason: null, reference: 'TED-123456789' } : w,
    )
    const put = await api(app, 'PUT', '/api/kv/afiliados.saques', { cookie: root.cookie, body: { value } })
    console.log(`[poc] PUT afiliados.saques (sem versão, ${value.length} itens, ${JSON.stringify({ value }).length} bytes) -> ${put.statusCode}`)

    const row = await loadRow(app.db, 'afiliados.saques')
    const stored = (row ? storedValue(row, app.cipher) : []) as W[]
    const meta = await app.db.one<{ version: number; updated_by: string }>(`select version, updated_by from kv_store where key = 'afiliados.saques'`)
    const audit = await app.db.one<{ summary: string }>(`select summary from audit_log where summary like 'afiliados.saques%' order by id desc limit 1`)
    const deciders = [...new Set(stored.map((w) => w.decidedBy).filter(Boolean))]
    const pendingPhone = stored.find((w) => w.pixKeyType === 'Celular')
    console.log(
      `[poc] kv_store: version=${meta?.version} updated_by=${meta?.updated_by === root.user.id ? 'superadmin' : meta?.updated_by} itens=${stored.length} ` +
        `pendentes=${stored.filter((w) => w.status === 'pendente').length} decidedBy=${JSON.stringify(deciders)} ` +
        `celular=${pendingPhone?.id}:${pendingPhone?.pixKey}:${pendingPhone?.status} | audit="${audit?.summary}"`,
    )

    // comportamento seguro: nenhum registro inventado (além do que a pessoa decidiu) vira dado de produção
    const fabricated = stored.filter((w) => w.id !== target.id)
    expect(fabricated.length, 'registros do seed de demonstração gravados como dado real').toBe(0)
    expect(deciders.filter((d) => d !== 'Admin PoC'), 'decisões atribuídas a pessoas que não decidiram nada').toEqual([])
  })
})
