// PoC (verificação de impacto, lente "impacto"): afiliados.saques é chave genérica (lista JSON inteira).
// Reproduz a gravação forjada e mede o que ela muda de fato:
//  (A) mecânica: valor/status/decisor forjados, item inventado e lista apagada → 200;
//  (B) efeito colateral no servidor: nenhum webhook, nenhum saque, nenhum saldo muda (nada é pago);
//  (C) auditoria do servidor: autor real (actor_id/actor_name/IP) e ids dos itens, imutável;
//  (D) o mesmo cargo já grava os saldos dos afiliados por desenho (crescimento.afiliados);
//  (E) quem tem a permissão por padrão (Superadmin/Administrador) já aprova saque REAL de jogador sem teto;
//  (F) cargos baixos (Suporte, Financeiro, marketing, ...) recebem 403.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canWriteKey, findKvRule } from '@shared/kv-registry'
import { seedRoles } from '@shared/permissions'
import { api, createTestApp, loginAs } from './helpers'

const KEY = 'afiliados.saques'
type W = Record<string, unknown> & { id: string }

function item(p: Partial<W> & { id: string }): W {
  return {
    affiliateId: 'a1', affiliateName: 'Afiliado Um', affiliateEmail: 'a1@exemplo.com', affiliateType: 'cpa',
    method: 'pix', pixKeyType: 'CPF', pixKey: '12345678909', bank: null, createdAt: '2026-09-01T10:00:00.000Z',
    amount: 100, status: 'pendente', decidedAt: null, decidedBy: null, reason: null, reference: null, ...p,
  }
}

async function counts(app: FastifyInstance) {
  const q = async (sql: string) => Number((await app.db.one<{ n: string }>(sql))!.n)
  return {
    outbox: await q('select count(*)::text as n from webhook_outbox'),
    withdrawalsPaid: await q(`select count(*)::text as n from withdrawals where status = 'pago'`),
  }
}

describe('poc-verify-affiliate-payouts-impact-2', () => {
  let app: FastifyInstance
  let root: Awaited<ReturnType<typeof loginAs>>
  let approver: Awaited<ReturnType<typeof loginAs>>

  beforeAll(async () => {
    app = await createTestApp()
    root = await loginAs(app, 'superadmin', { name: 'Daniel Carius' })
    // destino de webhook ativo para saque.pago (para ver se algo é enfileirado)
    await app.db.query(
      `insert into webhook_destinations (id, event, url, active, secret_enc) values ('d1', 'saque.pago', 'https://pix.exemplo/hook', true, $1)`,
      [app.cipher.encrypt('segredo')],
    )
    const seed = [
      item({ id: 'w1', amount: 300, status: 'pendente' }),
      item({ id: 'w2', amount: 800, status: 'recusado', decidedAt: '2026-09-02T10:00:00.000Z', decidedBy: 'Daniel Carius', reason: 'Fraude' }),
    ]
    expect((await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: root.cookie, body: { value: seed, version: 0 } })).statusCode).toBe(200)
    // saldo de afiliado (crescimento.afiliados)
    expect((await api(app, 'PUT', '/api/kv/crescimento.afiliados', { cookie: root.cookie, body: { value: [{ id: 'a1', name: 'Afiliado Um', balance: 1000 }], version: 0 } })).statusCode).toBe(200)

    const roles = (await api(app, 'GET', '/api/kv/cargos.lista', { cookie: root.cookie })).json() as { value: any[]; version: number }
    const add = await api(app, 'PUT', '/api/kv/cargos.lista', {
      cookie: root.cookie,
      body: { version: roles.version, value: [...roles.value, { id: 'aprov-afil', name: 'AprovadorAfil', description: '', permissions: ['afiliados-saques.ver', 'afiliados-saques.aprovar'], require2fa: false, approvalCeiling: 0 }] },
    })
    expect(add.statusCode, add.body).toBe(200)
    const role = (add.json().value as any[]).find((r) => r.name === 'AprovadorAfil')
    approver = await loginAs(app, role.id, { name: 'Aprovador Afil' })
  })
  afterAll(async () => app.close())

  it('(A)+(B)+(C) gravação forjada: aceita, sem efeito financeiro, auditada com o autor real', async () => {
    const before = await counts(app)
    const cur = (await api(app, 'GET', `/api/kv/${KEY}`, { cookie: approver.cookie })).json() as { value: W[]; version: number }
    const forged = cur.value.map((w) =>
      w.id === 'w1' ? { ...w, amount: 250000, status: 'pago', decidedBy: 'Daniel Carius', decidedAt: '2026-01-01', reference: 'E-FORJADO' }
        : w.id === 'w2' ? { ...w, amount: 9999, status: 'pago', reason: null } : w,
    )
    forged.push(item({ id: 'w3', affiliateId: 'a9', amount: 1000000, status: 'pago', decidedBy: 'Daniel Carius', reference: 'E-INVENTADO' }))
    const put = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: approver.cookie, body: { value: forged, version: cur.version }, ip: '203.0.113.9' })
    const stored = (await api(app, 'GET', `/api/kv/${KEY}`, { cookie: root.cookie })).json().value as W[]
    console.log('[A] PUT forjado ->', put.statusCode, '|', JSON.stringify(stored.map((w) => [w.id, w.amount, w.status, w.decidedBy])))
    expect(put.statusCode).toBe(200)

    const wipe = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: approver.cookie, body: { value: [], version: put.json().version }, ip: '203.0.113.9' })
    console.log('[A] PUT [] ->', wipe.statusCode, '| valor:', JSON.stringify(wipe.json().value))
    expect(wipe.statusCode).toBe(200)

    const after = await counts(app)
    const bal = (await api(app, 'GET', '/api/kv/crescimento.afiliados', { cookie: root.cookie })).json().value
    console.log('[B] efeitos: outbox', before.outbox, '->', after.outbox, '| saques pagos', before.withdrawalsPaid, '->', after.withdrawalsPaid, '| saldo a1:', JSON.stringify(bal))
    expect(after).toEqual(before)

    const audit = await app.db.query<{ actor_id: string; actor_name: string; ip: string; source: string; summary: string }>(
      `select actor_id, actor_name, ip, source, summary from audit_log where summary like 'afiliados.saques%' order by id`,
    )
    console.log('[C] auditoria do servidor:', JSON.stringify(audit), '| id real do aprovador:', approver.user.id)
    expect(audit.slice(-2).every((a) => a.actor_id === approver.user.id && a.source === 'servidor')).toBe(true)
    let blocked = ''
    try { await app.db.query(`delete from audit_log`) } catch (e) { blocked = (e as Error).message }
    console.log('[C] apagar auditoria ->', blocked)
    expect(blocked).toMatch(/inclus|permission denied/)
  })

  it('(D) o mesmo cargo já grava o saldo dos afiliados por desenho', async () => {
    const cur = (await api(app, 'GET', '/api/kv/crescimento.afiliados', { cookie: approver.cookie })).json() as { value: any[]; version: number }
    const r = await api(app, 'PUT', '/api/kv/crescimento.afiliados', { cookie: approver.cookie, body: { value: cur.value.map((a) => ({ ...a, balance: 999999 })), version: cur.version } })
    console.log('[D] aprovador grava crescimento.afiliados (saldo) ->', r.statusCode, JSON.stringify(r.json().value))
    expect(r.statusCode).toBe(200)
  })

  it('(E)+(F) quem tem a permissão por padrão e quem não tem', async () => {
    const holders = seedRoles().filter((r) => r.permissions.includes('afiliados-saques.aprovar')).map((r) => `${r.id}(teto=${r.approvalCeiling})`)
    console.log('[E] cargos padrão com afiliados-saques.aprovar:', holders.join(', '))
    const admin = await loginAs(app, 'administrador', { name: 'Admin', totp: true })
    await app.db.query(
      `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                                risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
       values ('s1', 'p1', 'Jogador', 'j@exemplo.com', 100000000, 0, 'pendente', 'baixo', 1, '[]'::jsonb, 'CPF', $1, 'E1', now(), now())`,
      [app.cipher.encrypt('12345678909')],
    )
    const r = await api(app, 'POST', '/api/withdrawals/s1/approve', { cookie: admin.cookie })
    const outbox = await app.db.query<{ event: string }>(`select event from webhook_outbox`)
    console.log('[E] Administrador aprova saque REAL de jogador de R$ 1.000.000 ->', r.statusCode, '| outbox:', JSON.stringify(outbox))

    const rule = findKvRule(KEY)!
    const low = seedRoles().filter((x) => !['superadmin', 'administrador'].includes(x.id))
    const res = low.map((x) => `${x.id}:${canWriteKey(rule, new Set(x.permissions))}`)
    console.log('[F] canWriteKey(afiliados.saques) cargos padrão não-admin:', res.join(', '))
    for (const id of ['financeiro', 'suporte', 'marketing']) {
      const u = await loginAs(app, id, { totp: true })
      const p = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: u.cookie, body: { value: [], version: 999 } })
      console.log(`[F] PUT ${KEY} como ${id} ->`, p.statusCode)
      expect(p.statusCode).toBe(403)
    }
  })
})
