// PoC (verificação de impacto, lente: impacto real): o fallback do painel para o seed em chaves
// genéricas nunca gravadas (afiliados.saques) existe, mas mede-se aqui o que ele muda de fato:
//  - quem pode disparar (cargos com afiliados-saques.aprovar) e quem não pode;
//  - o que a auditoria (registro regulatório) atribui: a pessoa real, não "Daniel Carius"/"Pedro Santos";
//  - efeitos colaterais no servidor (webhook_outbox, withdrawals): nenhum, "Pagar" não move dinheiro;
//  - capacidade nova? A mesma pessoa já pode gravar qualquer decidedBy/pixKey sem o seed.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedAffiliateWithdrawals } from '@/data/afiliados'
import { loadRow, storedValue } from '../src/modules/kv/store'
import { api, createTestApp, loginAs } from './helpers'

type W = Record<string, unknown> & { id: string; status: string; decidedBy: string | null; pixKey: string | null }

describe('poc-verify-seed-fallback-real-impact', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('mede o alcance do seed gravado como primeira versão', async () => {
    const root = await loginAs(app, 'superadmin', { name: 'Ana Operadora' })
    const seed = seedAffiliateWithdrawals() as unknown as W[]
    const target = seed.find((w) => w.status === 'pendente')!
    const value = seed.map((w) => (w.id === target.id ? { ...w, status: 'pago', decidedBy: 'Ana Operadora', decidedAt: new Date().toISOString() } : w))

    const before = await app.db.one<{ n: number }>(`select count(*)::int as n from audit_log`)
    const put = await api(app, 'PUT', '/api/kv/afiliados.saques', { cookie: root.cookie, body: { value } })
    console.log(`[impact] PUT seed sem versao -> ${put.statusCode}`)
    expect(put.statusCode).toBe(200)

    const audits = await app.db.query<{ actor_name: string; summary: string; source: string }>(
      `select actor_name, summary, source from audit_log order by id desc limit $1`,
      [(await app.db.one<{ n: number }>(`select count(*)::int as n from audit_log`))!.n - before!.n],
    )
    console.log(`[impact] auditoria nova: ${JSON.stringify(audits)}`)
    expect(audits.every((a) => a.actor_name === 'Ana Operadora')).toBe(true)
    expect(audits.some((a) => /Daniel Carius|Pedro Santos/.test(a.actor_name + a.summary))).toBe(false)

    const outbox = await app.db.one<{ n: number }>(`select count(*)::int as n from webhook_outbox`)
    const wds = await app.db.one<{ n: number }>(`select count(*)::int as n from withdrawals`)
    console.log(`[impact] efeitos colaterais: webhook_outbox=${outbox!.n} withdrawals=${wds!.n}`)

    const stored = storedValue(await loadRow(app.db, 'afiliados.saques'), app.cipher) as W[]
    const again = seedAffiliateWithdrawals() as unknown as W[]
    const identicalToBundle = stored.filter((w) => w.id !== target.id).every((w) => JSON.stringify(w) === JSON.stringify(again.find((x) => x.id === w.id)))
    console.log(`[impact] itens gravados (exceto o decidido) = saida deterministica do bundle (createRng(7171)): ${identicalToBundle}`)

    // quem consegue disparar a gravação inicial
    for (const role of ['suporte', 'marketing', 'marketing-oficial', 'adm', 'financeiro', 'administrador']) {
      const u = await loginAs(app, role, { name: `PoC ${role}` })
      const g = await api(app, 'GET', '/api/kv/afiliados.saques', { cookie: u.cookie })
      const p = await api(app, 'PUT', '/api/kv/afiliados.saques', { cookie: u.cookie, body: { value: [] , version: 999 } })
      console.log(`[impact] role=${role} GET=${g.statusCode} PUT(versao 999 apos a 1a gravacao: 409=tem permissao, 403=nao)=${p.statusCode}`)
    }

    // controle: sem seed nenhum, a mesma pessoa grava qualquer decidedBy/pixKey (a chave é do painel por desenho)
    const row = await loadRow(app.db, 'afiliados.saques')
    const forged = [{ ...target, id: 'X1', status: 'pago', decidedBy: 'Daniel Carius', pixKey: '11999999999', pixKeyType: 'Celular' }]
    const ctl = await api(app, 'PUT', '/api/kv/afiliados.saques', { cookie: root.cookie, body: { value: forged, version: row!.version } })
    const ctlStored = storedValue(await loadRow(app.db, 'afiliados.saques'), app.cipher) as W[]
    console.log(`[impact] controle (sem seed): PUT decidedBy='Daniel Carius' pixKey arbitraria -> ${ctl.statusCode}; gravado decidedBy=${ctlStored[0]?.decidedBy}`)
  })
})
