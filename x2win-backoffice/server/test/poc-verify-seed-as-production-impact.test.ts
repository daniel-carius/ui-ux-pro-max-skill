// PoC (verificação de impacto): chave genérica nunca gravada devolve stored:false, o painel mostra o
// seed de demonstração e a primeira gravação sem versão vira o registro do servidor.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedAffiliateWithdrawals } from '@/data/afiliados'
import { api, createTestApp, loginAs } from './helpers'

const KEYS = [
  'afiliados.saques',
  'crescimento.afiliados',
  'operacao.depositos',
  'esportes.apostas',
  'geral.jogadores',
  'geral.transacoes',
  'crescimento.ggr.apuracoes',
]

describe('poc-verify-seed-as-production-impact', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('chaves nunca gravadas: stored:false; primeira gravação sem versão aceita o seed inteiro', async () => {
    const root = await loginAs(app, 'superadmin', { name: 'Daniel Carius' })
    for (const k of KEYS) {
      const r = await api(app, 'GET', `/api/kv/${k}`, { cookie: root.cookie })
      const b = r.json() as { stored: boolean; version: number }
      console.log(`[impact] GET ${k} -> ${r.statusCode} stored=${b.stored} version=${b.version}`)
      expect(b.stored).toBe(false)
    }
    const seed = seedAffiliateWithdrawals()
    const phones = seed.filter((w) => w.pixKeyType === 'Celular').map((w) => `${w.id}:${w.pixKey}:${w.status}`)
    const deciders = [...new Set(seed.map((w) => w.decidedBy).filter(Boolean))]
    console.log(`[impact] seed: ${seed.length} itens, ${seed.filter((w) => w.status === 'pendente').length} pendentes; celulares=${JSON.stringify(phones)}; decidedBy=${JSON.stringify(deciders)}`)
    // o que o painel envia ao clicar "Pagar" no primeiro item pendente (sem versão)
    const firstPending = seed.find((w) => w.status === 'pendente')!
    const value = seed.map((w) => (w.id === firstPending.id ? { ...w, status: 'pago', decidedBy: 'Daniel Carius', decidedAt: new Date().toISOString() } : w))
    const put = await api(app, 'PUT', '/api/kv/afiliados.saques', { cookie: root.cookie, body: { value } })
    console.log(`[impact] PUT afiliados.saques sem versão -> ${put.statusCode} version=${(put.json() as { version: number }).version}`)
    expect(put.statusCode).toBe(200)
    const row = await app.db.one<{ version: number; updated_by: string }>(`select version, updated_by from kv_store where key = 'afiliados.saques'`)
    const audit = await app.db.one<{ summary: string; actor_name: string }>(
      `select summary, actor_name from audit_log where summary like 'afiliados.saques%' order by id desc limit 1`,
    )
    console.log(`[impact] kv_store row: ${JSON.stringify(row)} | audit: ${JSON.stringify(audit)}`)
    const stored = (await api(app, 'GET', '/api/kv/afiliados.saques', { cookie: root.cookie })).json() as { value: any[]; stored: boolean }
    console.log(`[impact] depois: stored=${stored.stored} itens=${stored.value.length} decidedBy=${JSON.stringify([...new Set(stored.value.map((w) => w.decidedBy).filter(Boolean))])}`)
    expect(row!.version).toBe(1)
  })
})
