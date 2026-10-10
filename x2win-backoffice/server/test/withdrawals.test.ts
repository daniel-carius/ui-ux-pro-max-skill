import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { findKvRule } from '@shared/kv-registry'
import { effectivePermissions } from '@shared/permissions'
import { DEFAULT_WITHDRAWAL_RULES } from '@shared/withdrawals'
import { newId } from '../src/lib/crypto'
import { getRole } from '../src/services/roles-repo'
import type { KvContext } from '../src/kv/types'
import type { AuthContext } from '../src/types'
import { kvHandlers, RULES_SETTINGS_KEY } from '../src/modules/withdrawals/kv'
import { seedDemo } from '../src/modules/withdrawals/seed'
import { DEMO_STAFF_LABEL, demoCpf, demoPhone } from '../src/modules/kv/demo-seed'
import { api, createTestApp, createUser, loginAs, sessionCookie } from './helpers'

// ---------- utilitários locais ----------

async function insertWithdrawal(
  app: FastifyInstance,
  over: { id?: string; amount?: number; status?: string; pixKeyType?: string; pixKey?: string; createdAt?: string; email?: string } = {},
) {
  const id = over.id ?? newId('SQ')
  await app.db.query(
    `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                              risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
     values ($1, 'p1', 'Jogador Teste', $2, $3, 0, $4, 'baixo', 10, '["motivo"]'::jsonb, $5, $6, 'E123', $7, $7)`,
    [
      id,
      over.email ?? 'jogador@exemplo.com',
      Math.round((over.amount ?? 100) * 100),
      over.status ?? 'pendente',
      over.pixKeyType ?? 'CPF',
      app.cipher.encrypt(over.pixKey ?? '12345678909'),
      over.createdAt ?? new Date().toISOString(),
    ],
  )
  return id
}

async function addDestination(app: FastifyInstance, event: string, active = true) {
  const id = newId('wh')
  await app.db.query(`insert into webhook_destinations (id, event, url, active, secret_enc) values ($1, $2, 'https://exemplo.com/h', $3, $4)`, [
    id,
    event,
    active,
    app.cipher.encrypt('segredo-de-teste'),
  ])
  return id
}

async function authFor(app: FastifyInstance, roleId: string, name = 'Pessoa KV'): Promise<AuthContext> {
  const u = await createUser(app, { roleId, name })
  const role = (await getRole(app.db, roleId))!
  return {
    user: { id: u.id, name, email: u.email, roleId, status: 'ativo', totpEnabled: false, mustChangePassword: false },
    role,
    perms: new Set(effectivePermissions(role)),
    sessionId: 'sessao-teste',
    stage: 'active',
    ip: '10.9.8.7',
  }
}

function kvCtx(app: FastifyInstance, auth: AuthContext, key: string): KvContext {
  return { app, req: { clientIp: auth.ip } as unknown as FastifyRequest, auth, key, rule: findKvRule(key)! }
}

async function createRole(app: FastifyInstance, id: string, permissions: string[], ceilingCents: number | null) {
  await app.db.query(`insert into roles (id, name, permissions, approval_ceiling_cents) values ($1, $2, $3, $4)`, [id, `Cargo ${id}`, permissions, ceilingCents])
}

const auditOf = (app: FastifyInstance, entity: string) =>
  app.db.query<{ action: string; actor_id: string; actor_name: string; ip: string; summary: string; source: string }>(
    'select * from audit_log where entity = $1 order by id',
    [entity],
  )

const outboxOf = (app: FastifyInstance, event: string) =>
  app.db.query<{ destination_id: string; payload: { id: string; data: Record<string, unknown> } }>('select * from webhook_outbox where event = $1 order by id', [event])

// ---------- testes ----------

let app: FastifyInstance
let admin: { cookie: string; user: { id: string; email: string } }

beforeAll(async () => {
  app = await createTestApp()
  admin = await loginAs(app, 'superadmin', { name: 'Ana Admin' })
  // os testes de decisão usam sempre o mesmo jogador e valores acima do padrão: regras folgadas
  // (as conferências das regras na aprovação têm testes próprios em withdrawals-payout.test.ts)
  await app.db.query(`insert into settings (key, value) values ($1, $2::jsonb)`, [
    RULES_SETTINGS_KEY,
    JSON.stringify({ version: 1, rules: { ...DEFAULT_WITHDRAWAL_RULES, maxPerRequest: 100_000, dailyLimit: 1000 } }),
  ])
})
afterAll(async () => app.close())

describe('POST /api/withdrawals/:id/approve', () => {
  it('aprova, devolve o saque no formato do painel, audita e enfileira saque.pago na mesma transação', async () => {
    const dPago = await addDestination(app, 'saque.pago')
    await addDestination(app, 'saque.pago', false) // inativo: não recebe
    await addDestination(app, 'saque.rejeitado') // outro evento: não recebe
    const id = await insertWithdrawal(app, { amount: 1234.56 })
    const r = await api(app, 'POST', `/api/withdrawals/${id}/approve`, { cookie: admin.cookie, ip: '10.0.0.7' })
    expect(r.statusCode).toBe(200)
    const body = r.json()
    expect(body.ok).toBe(true)
    // saque.pago é aviso aos sistemas da operação, não pagamento: a mensagem não diz que o PIX saiu
    expect(body.message).toBe('Saque de R$ 1.234,56 aprovado. Aviso de pagamento na fila para 1 sistema.')
    expect(body.queuedDeliveries).toBe(1)
    expect(body.withdrawal).toMatchObject({
      id,
      status: 'aprovado',
      amount: 1234.56,
      fee: 0,
      decidedBy: 'Ana Admin',
      decidedById: admin.user.id,
      decidedByEmail: admin.user.email,
      decisionNote: null,
      pixKeyType: 'CPF',
      pixKey: '123.***.***-09',
      playerEmail: 'jogador@exemplo.com', // superadmin tem usuarios.ver-dados
      risk: { level: 'baixo', score: 10, reasons: ['motivo'] },
    })
    expect(JSON.stringify(body)).not.toContain('12345678909')

    const row = await app.db.one<{ status: string; decided_by_id: string }>('select status, decided_by_id from withdrawals where id = $1', [id])
    expect(row).toEqual({ status: 'aprovado', decided_by_id: admin.user.id })

    const audit = await auditOf(app, `Saque #${id}`)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: 'aprovar', actor_id: admin.user.id, actor_name: 'Ana Admin', ip: '10.0.0.7', source: 'servidor' })

    const out = (await outboxOf(app, 'saque.pago')).filter((o) => o.payload.data.id === id)
    expect(out).toHaveLength(1)
    expect(out[0].destination_id).toBe(dPago)
    expect(out[0].payload.data).toEqual({ id, amount: 1234.56, playerId: 'p1' })
    expect(out[0].payload.id).toMatch(/^evt_/)
  })

  it('segunda decisão responde 409 ja_decidido (aprovar ou recusar de novo)', async () => {
    const id = await insertWithdrawal(app)
    expect((await api(app, 'POST', `/api/withdrawals/${id}/approve`, { cookie: admin.cookie })).statusCode).toBe(200)
    const again = await api(app, 'POST', `/api/withdrawals/${id}/approve`, { cookie: admin.cookie })
    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe('ja_decidido')
    const rej = await api(app, 'POST', `/api/withdrawals/${id}/reject`, { cookie: admin.cookie, body: { reason: 'Conta duplicada' } })
    expect(rej.statusCode).toBe(409)
    expect(rej.json().error.code).toBe('ja_decidido')
    expect(await auditOf(app, `Saque #${id}`)).toHaveLength(1)
  })

  it('duas aprovações simultâneas: só uma passa', async () => {
    const id = await insertWithdrawal(app)
    const [a, b] = await Promise.all([
      api(app, 'POST', `/api/withdrawals/${id}/approve`, { cookie: admin.cookie }),
      api(app, 'POST', `/api/withdrawals/${id}/approve`, { cookie: admin.cookie }),
    ])
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])
    expect(await auditOf(app, `Saque #${id}`)).toHaveLength(1)
  })

  it.each(['expirado', 'cancelado', 'recusado'])('saque %s não pode ser aprovado', async (status) => {
    const id = await insertWithdrawal(app, { status })
    const r = await api(app, 'POST', `/api/withdrawals/${id}/approve`, { cookie: admin.cookie })
    expect(r.statusCode).toBe(409)
    expect(r.json().error.code).toBe('ja_decidido')
  })

  it.each(['criado', 'em_analise'])('saque %s pode ser aprovado', async (status) => {
    const id = await insertWithdrawal(app, { status })
    expect((await api(app, 'POST', `/api/withdrawals/${id}/approve`, { cookie: admin.cookie })).statusCode).toBe(200)
  })

  it('teto do Financeiro (R$ 5.000): 4.999 e 5.000 passam; 5.000,01 → 403 teto_excedido sem alterar nada', async () => {
    const fin = await loginAs(app, 'financeiro', { name: 'Fábio Financeiro' })
    const ok1 = await insertWithdrawal(app, { amount: 4999 })
    const ok2 = await insertWithdrawal(app, { amount: 5000 })
    const over = await insertWithdrawal(app, { amount: 5000.01 })
    expect((await api(app, 'POST', `/api/withdrawals/${ok1}/approve`, { cookie: fin.cookie })).statusCode).toBe(200)
    expect((await api(app, 'POST', `/api/withdrawals/${ok2}/approve`, { cookie: fin.cookie })).statusCode).toBe(200)
    const r = await api(app, 'POST', `/api/withdrawals/${over}/approve`, { cookie: fin.cookie })
    expect(r.statusCode).toBe(403)
    expect(r.json().error.code).toBe('teto_excedido')
    expect(r.json().error.message).toContain('Financeiro')
    const row = await app.db.one<{ status: string }>('select status from withdrawals where id = $1', [over])
    expect(row?.status).toBe('pendente')
    expect(await auditOf(app, `Saque #${over}`)).toHaveLength(0)
    expect((await outboxOf(app, 'saque.pago')).filter((o) => o.payload.data.id === over)).toHaveLength(0)
    // superadmin (sem teto) aprova o mesmo saque
    expect((await api(app, 'POST', `/api/withdrawals/${over}/approve`, { cookie: admin.cookie })).statusCode).toBe(200)
  })

  it('Financeiro recebe o e-mail do jogador mascarado (sem usuarios.ver-dados)', async () => {
    const fin = await loginAs(app, 'financeiro')
    const id = await insertWithdrawal(app, { amount: 10, pixKeyType: 'E-mail', pixKey: 'chave.pix@banco.com' })
    const r = await api(app, 'POST', `/api/withdrawals/${id}/approve`, { cookie: fin.cookie })
    expect(r.json().withdrawal.playerEmail).toBe('jo***@exemplo.com')
    expect(r.json().withdrawal.pixKey).toBe('ch***@banco.com')
  })

  it('cargos que não aprovam: Suporte, Marketing oficial e cargo com teto 0 → 403 sem_permissao', async () => {
    const id = await insertWithdrawal(app)
    for (const roleId of ['suporte', 'marketing-oficial', 'adm']) {
      // com 2FA ativo: Marketing oficial exige 2FA para ter sessão (sem ele a resposta seria 401, não 403)
      const { cookie } = await loginAs(app, roleId, { totp: true })
      for (const action of ['approve', 'reject']) {
        const r = await api(app, 'POST', `/api/withdrawals/${id}/${action}`, { cookie, body: { reason: 'Motivo qualquer' } })
        expect(r.statusCode, `${roleId} ${action}`).toBe(403)
        expect(r.json().error.code).toBe('sem_permissao')
      }
    }
    await createRole(app, 'aprova-zero', ['saques.ver', 'saques.aprovar'], 0)
    const { cookie } = await loginAs(app, 'aprova-zero')
    const r = await api(app, 'POST', `/api/withdrawals/${id}/approve`, { cookie })
    expect(r.statusCode).toBe(403)
    expect(r.json().error.code).toBe('sem_permissao')
    expect(r.json().error.message).toContain('não aprova saques')
    const rej = await api(app, 'POST', `/api/withdrawals/${id}/reject`, { cookie, body: { reason: 'Motivo qualquer' } })
    expect(rej.statusCode).toBe(403)
    const row = await app.db.one<{ status: string }>('select status from withdrawals where id = $1', [id])
    expect(row?.status).toBe('pendente')
  })

  it('saque inexistente → 404; sem sessão → 401; etapa pendente → 403; sem cabeçalho CSRF → 403', async () => {
    const nf = await api(app, 'POST', '/api/withdrawals/NAO-EXISTE/approve', { cookie: admin.cookie })
    expect(nf.statusCode).toBe(404)
    expect(nf.json().error.code).toBe('nao_encontrado')
    const id = await insertWithdrawal(app)
    const anon = await api(app, 'POST', `/api/withdrawals/${id}/approve`)
    expect(anon.statusCode).toBe(401)
    expect(anon.json().error.code).toBe('nao_autenticado')
    const u = await createUser(app)
    const pending = await api(app, 'POST', `/api/withdrawals/${id}/approve`, { cookie: await sessionCookie(app, u.id, '2fa') })
    expect(pending.statusCode).toBe(403)
    expect(pending.json().error.code).toBe('etapa_pendente')
    const csrf = await api(app, 'POST', `/api/withdrawals/${id}/approve`, { cookie: admin.cookie, csrf: false })
    expect(csrf.statusCode).toBe(403)
    expect(csrf.json().error.code).toBe('requisicao_invalida')
  })
})

describe('POST /api/withdrawals/:id/approve: a mensagem diz só o que aconteceu', () => {
  // banco próprio: os outros testes deste arquivo deixam destinos de saque.pago ativos
  let own: FastifyInstance
  let cookie: string
  beforeAll(async () => {
    own = await createTestApp()
    cookie = (await loginAs(own, 'superadmin')).cookie
    await own.db.query(`insert into settings (key, value) values ($1, $2::jsonb)`, [
      RULES_SETTINGS_KEY,
      JSON.stringify({ version: 1, rules: { ...DEFAULT_WITHDRAWAL_RULES, maxPerRequest: 100_000, dailyLimit: 1000 } }),
    ])
  })
  afterAll(async () => own.close())

  const approve = async (amount: number) => {
    const id = await insertWithdrawal(own, { amount })
    const r = await api(own, 'POST', `/api/withdrawals/${id}/approve`, { cookie })
    expect(r.statusCode).toBe(200)
    return { id, body: r.json() as { ok: boolean; message: string; queuedDeliveries: number; withdrawal: { status: string } } }
  }

  it('sem destino saque.pago ativo: aprova, nada na fila e avisa que o pagamento é manual (nunca "PIX enviado")', async () => {
    await addDestination(own, 'saque.pago', false) // inativo
    await addDestination(own, 'saque.rejeitado') // outro evento
    // destino de demonstração (terceiro) gravado e ativo nunca recebe evento real: não conta
    await own.db.query(`insert into webhook_destinations (id, event, url, active, secret_enc) values ($1, 'saque.pago', $2, true, $3)`, [
      newId('wh'),
      'https://hooks.x2win-crm.com/pix',
      own.cipher.encrypt('segredo-de-teste'),
    ])
    const { id, body } = await approve(250)
    expect(body.ok).toBe(true)
    expect(body.withdrawal.status).toBe('aprovado')
    expect(body.queuedDeliveries).toBe(0)
    expect(body.message).toBe(
      'Saque de R$ 250,00 aprovado. Nenhum destino "saque.pago" ativo: o pagamento precisa ser feito pelo financeiro no gateway.',
    )
    expect(body.message).not.toMatch(/PIX (foi )?enviado/i)
    expect((await outboxOf(own, 'saque.pago')).filter((o) => o.payload.data.id === id)).toHaveLength(0)
  })

  it('com destinos ativos: conta os avisos enfileirados (singular e plural)', async () => {
    await addDestination(own, 'saque.pago')
    const one = await approve(10)
    expect(one.body.queuedDeliveries).toBe(1)
    expect(one.body.message).toBe('Saque de R$ 10,00 aprovado. Aviso de pagamento na fila para 1 sistema.')

    await addDestination(own, 'saque.pago')
    const two = await approve(20)
    expect(two.body.queuedDeliveries).toBe(2)
    expect(two.body.message).toBe('Saque de R$ 20,00 aprovado. Aviso de pagamento na fila para 2 sistemas.')
    // o número da resposta é o da fila, na mesma transação
    expect((await outboxOf(own, 'saque.pago')).filter((o) => o.payload.data.id === two.id)).toHaveLength(2)
  })
})

describe('POST /api/withdrawals/:id/reject', () => {
  it('recusa com motivo, audita e enfileira saque.rejeitado', async () => {
    await addDestination(app, 'saque.rejeitado')
    const id = await insertWithdrawal(app, { amount: 80 })
    const r = await api(app, 'POST', `/api/withdrawals/${id}/reject`, { cookie: admin.cookie, body: { reason: '  Rollover não cumprido  ' } })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ ok: true, withdrawal: { id, status: 'recusado', decisionNote: 'Rollover não cumprido', decidedBy: 'Ana Admin' } })
    expect(r.json().message).toContain('R$')
    const audit = await auditOf(app, `Saque #${id}`)
    expect(audit).toHaveLength(1)
    expect(audit[0].action).toBe('recusar')
    expect(audit[0].summary).toContain('Rollover não cumprido')
    const out = (await outboxOf(app, 'saque.rejeitado')).filter((o) => o.payload.data.id === id)
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(out[0].payload.data).toMatchObject({ id, amount: 80, reason: 'Rollover não cumprido' })
  })

  it('Financeiro recusa mesmo acima do teto (recusar não paga)', async () => {
    const fin = await loginAs(app, 'financeiro')
    const id = await insertWithdrawal(app, { amount: 9000 })
    const r = await api(app, 'POST', `/api/withdrawals/${id}/reject`, { cookie: fin.cookie, body: { reason: 'Conta duplicada' } })
    expect(r.statusCode).toBe(200)
  })

  it.each([
    ['sem corpo', undefined],
    ['sem motivo', {}],
    ['motivo não texto', { reason: 123 }],
    ['motivo curto', { reason: 'ab' }],
    ['motivo só com espaços', { reason: '   ab   ' }],
    ['motivo longo (301)', { reason: 'x'.repeat(301) }],
  ])('valida o motivo: %s → 400', async (_label, body) => {
    const id = await insertWithdrawal(app)
    const r = await api(app, 'POST', `/api/withdrawals/${id}/reject`, { cookie: admin.cookie, body })
    expect(r.statusCode).toBe(400)
    expect(r.json().error.code).toBe('dados_invalidos')
    const row = await app.db.one<{ status: string }>('select status from withdrawals where id = $1', [id])
    expect(row?.status).toBe('pendente')
  })

  it('aceita motivo com 3 e com 300 caracteres', async () => {
    for (const reason of ['abc', 'y'.repeat(300)]) {
      const id = await insertWithdrawal(app)
      const r = await api(app, 'POST', `/api/withdrawals/${id}/reject`, { cookie: admin.cookie, body: { reason } })
      expect(r.statusCode).toBe(200)
      expect(r.json().withdrawal.decisionNote).toBe(reason)
    }
  })
})

describe('POST /api/withdrawals/:id/reveal-pix', () => {
  it('quem tem saques.ver + usuarios.ver-dados vê a chave completa e fica auditado', async () => {
    const id = await insertWithdrawal(app, { pixKeyType: 'Celular', pixKey: '(11) 98765-4321' })
    const r = await api(app, 'POST', `/api/withdrawals/${id}/reveal-pix`, { cookie: admin.cookie, ip: '10.2.2.2' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ pixKey: '(11) 98765-4321' })
    const audit = await auditOf(app, `Saque #${id}`)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: 'revelar', actor_id: admin.user.id, ip: '10.2.2.2' })
  })

  it('sem usuarios.ver-dados (Financeiro, Suporte) ou sem saques.ver → 403 e nada auditado', async () => {
    const id = await insertWithdrawal(app)
    await createRole(app, 'so-dados', ['usuarios.ver', 'usuarios.ver-dados'], 0)
    for (const roleId of ['financeiro', 'suporte', 'so-dados']) {
      const { cookie } = await loginAs(app, roleId)
      const r = await api(app, 'POST', `/api/withdrawals/${id}/reveal-pix`, { cookie })
      expect(r.statusCode, roleId).toBe(403)
      expect(r.json().error.code).toBe('sem_permissao')
    }
    await createRole(app, 've-pix', ['saques.ver', 'usuarios.ver-dados'], 0)
    const { cookie } = await loginAs(app, 've-pix')
    expect((await api(app, 'POST', `/api/withdrawals/${id}/reveal-pix`, { cookie })).statusCode).toBe(200)
    const audit = await auditOf(app, `Saque #${id}`)
    expect(audit.map((a) => a.action)).toEqual(['revelar'])
  })

  it('inexistente → 404; sem sessão → 401', async () => {
    expect((await api(app, 'POST', '/api/withdrawals/NADA/reveal-pix', { cookie: admin.cookie })).statusCode).toBe(404)
    expect((await api(app, 'POST', '/api/withdrawals/NADA/reveal-pix')).statusCode).toBe(401)
  })
})

// Regressão r1-exposure-9: chave PIX completa, dados do jogador e decisões nunca ficam em cache.
describe('Cache-Control: no-store nas rotas /api/withdrawals', () => {
  it('aprovar, recusar, revelar PIX e respostas de erro saem com no-store', async () => {
    const noStore = (r: { headers: Record<string, unknown> }) => String(r.headers['cache-control'] ?? '')
    const a = await insertWithdrawal(app)
    const approve = await api(app, 'POST', `/api/withdrawals/${a}/approve`, { cookie: admin.cookie })
    expect(approve.statusCode).toBe(200)
    expect(noStore(approve)).toContain('no-store')

    const b = await insertWithdrawal(app)
    const reject = await api(app, 'POST', `/api/withdrawals/${b}/reject`, { cookie: admin.cookie, body: { reason: 'Documento divergente' } })
    expect(reject.statusCode).toBe(200)
    expect(noStore(reject)).toContain('no-store')

    const c = await insertWithdrawal(app, { pixKeyType: 'E-mail', pixKey: 'jogador.pix@banco.com' })
    const reveal = await api(app, 'POST', `/api/withdrawals/${c}/reveal-pix`, { cookie: admin.cookie })
    expect(reveal.statusCode).toBe(200)
    expect(reveal.json()).toEqual({ pixKey: 'jogador.pix@banco.com' })
    expect(noStore(reveal)).toContain('no-store')

    const notFound = await api(app, 'POST', '/api/withdrawals/NADA/reveal-pix', { cookie: admin.cookie })
    expect(notFound.statusCode).toBe(404)
    expect(noStore(notFound)).toContain('no-store')
    const again = await api(app, 'POST', `/api/withdrawals/${a}/approve`, { cookie: admin.cookie })
    expect(again.statusCode).toBe(409)
    expect(noStore(again)).toContain('no-store')
  })
})

describe('kv operacao.saques', () => {
  it('lista do mais recente para o mais antigo, PIX sempre mascarado, e-mail conforme permissão', async () => {
    const probe = await createTestApp()
    const now = Date.now()
    const old = await insertWithdrawal(probe, { createdAt: new Date(now - 3_600_000).toISOString(), pixKeyType: 'Aleatória', pixKey: 'a1b2c3d4e5f6a7b8c9d0' })
    const recent = await insertWithdrawal(probe, { createdAt: new Date(now).toISOString(), pixKeyType: 'CPF', pixKey: '98765432100' })
    const handler = kvHandlers.withdrawals!
    const adminAuth = await authFor(probe, 'superadmin')
    const v = await handler.read(kvCtx(probe, adminAuth, 'operacao.saques'))
    const list = v!.value as { id: string; pixKey: string; playerEmail: string; amount: number }[]
    expect(list.map((w) => w.id)).toEqual([recent, old])
    expect(list[0].pixKey).toBe('987.***.***-00')
    expect(list[1].pixKey).toBe('a1b2c3…c9d0')
    expect(list[0].playerEmail).toBe('jogador@exemplo.com')
    expect(list[0].amount).toBe(100)
    expect(v!.version).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(v)).not.toContain('98765432100')

    const sup = await authFor(probe, 'suporte')
    const vs = await handler.read(kvCtx(probe, sup, 'operacao.saques'))
    expect((vs!.value as { playerEmail: string }[])[0].playerEmail).toBe('jo***@exemplo.com')

    const mkt = await authFor(probe, 'marketing')
    await expect(handler.read(kvCtx(probe, mkt, 'operacao.saques'))).rejects.toMatchObject({ status: 403, code: 'sem_permissao' })
    expect(handler.write).toBeUndefined()
    await probe.close()
  })

  it('lista vazia é devolvida como [] (o servidor é a fonte, não o padrão do painel)', async () => {
    const probe = await createTestApp()
    const v = await kvHandlers.withdrawals!.read(kvCtx(probe, await authFor(probe, 'superadmin'), 'operacao.saques'))
    expect(v?.value).toEqual([])
    await probe.close()
  })
})

describe('kv operacao.saques.regras', () => {
  const key = 'operacao.saques.regras'
  const handler = () => kvHandlers['withdrawal-rules']!

  it('padrão com versão 0 quando nunca gravadas; grava com versão; 409 com versão velha ou ausente', async () => {
    const probe = await createTestApp()
    const fin = await authFor(probe, 'financeiro', 'Fábio Financeiro')
    const first = await handler().read(kvCtx(probe, fin, key))
    expect(first).toEqual({ value: DEFAULT_WITHDRAWAL_RULES, version: 0, updatedAt: null })

    const next = { ...DEFAULT_WITHDRAWAL_RULES, min: 30, fee: 2.5 }
    const saved = await handler().write!(kvCtx(probe, fin, key), next, 0)
    expect(saved.version).toBe(1)
    expect(saved.value).toEqual(next)
    expect(typeof saved.updatedAt).toBe('string')
    const again = await handler().read(kvCtx(probe, fin, key))
    expect(again?.value).toEqual(next)
    expect(again?.version).toBe(1)

    await expect(handler().write!(kvCtx(probe, fin, key), next, 0)).rejects.toMatchObject({
      status: 409,
      code: 'versao_desatualizada',
      details: { version: 1 },
    })
    await expect(handler().write!(kvCtx(probe, fin, key), next, undefined)).rejects.toMatchObject({ status: 409, details: { version: 1 } })
    const v2 = await handler().write!(kvCtx(probe, fin, key), { ...next, dailyLimit: 3 }, 1)
    expect(v2.version).toBe(2)

    const audit = await probe.db.query<{ action: string; entity: string; summary: string; actor_name: string; ip: string }>(
      `select * from audit_log where entity = 'Dados · Saques' order by id`,
    )
    expect(audit).toHaveLength(2)
    expect(audit[0]).toMatchObject({ action: 'editar', actor_name: 'Fábio Financeiro', ip: '10.9.8.7' })
    expect(audit[0].summary).toContain('Valor mínimo')
    expect(audit[0].summary).toContain('Taxa fixa')
    expect(audit[0].summary).not.toContain('Limite diário')
    expect(audit[1].summary).toContain('Limite diário')
    await probe.close()
  })

  it('primeira gravação aceita qualquer versão (nada gravado ainda)', async () => {
    const probe = await createTestApp()
    const a = await authFor(probe, 'superadmin')
    const saved = await handler().write!(kvCtx(probe, a, key), DEFAULT_WITHDRAWAL_RULES, undefined)
    expect(saved.version).toBe(1)
    await probe.close()
  })

  it.each([
    [{ min: 0 }, 'mínimo'],
    [{ maxPerRequest: 10, min: 20 }, 'máximo'],
    [{ dailyLimit: 0 }, 'limite diário'],
    [{ dailyLimit: 1.5 }, 'limite diário'],
    [{ fee: 25 }, 'taxa'],
    [{ autoApproveMax: 9000 }, 'aprovação automática'],
    [{ rolloverPct: 6000 }, 'Rollover'],
    [{ fee: -1 }, 'positivos'],
    [{ fee: 1.234 }, 'casas decimais'],
    [{ maxPerRequest: 1000.001 }, 'casas decimais'],
    [{ rolloverPct: 33.333 }, 'casas decimais'],
  ])('regra inválida %o → 400 com a mensagem do validador', async (patch, msg) => {
    const a = await authFor(app, 'superadmin')
    const err = await handler()
      .write!(kvCtx(app, a, key), { ...DEFAULT_WITHDRAWAL_RULES, ...patch }, undefined)
      .catch((e) => e)
    expect(err).toMatchObject({ status: 400, code: 'dados_invalidos' })
    expect(String(err.message).toLowerCase()).toContain(msg.toLowerCase())
  })

  it('formato inválido (campo faltando, texto, enum desconhecido) → ZodError', async () => {
    const a = await authFor(app, 'superadmin')
    const { min: _min, ...missing } = DEFAULT_WITHDRAWAL_RULES
    for (const bad of [missing, { ...DEFAULT_WITHDRAWAL_RULES, min: '20' }, { ...DEFAULT_WITHDRAWAL_RULES, rolloverMode: 'outro' }, null, []]) {
      await expect(handler().write!(kvCtx(app, a, key), bad, undefined)).rejects.toMatchObject({ name: 'ZodError' })
    }
  })

  it('permissões: Suporte lê (saques.ver) mas não grava; quem só vê Rollover lê; Marketing não lê', async () => {
    const sup = await authFor(app, 'suporte')
    expect((await handler().read(kvCtx(app, sup, key)))?.value).toBeTruthy()
    await expect(handler().write!(kvCtx(app, sup, key), DEFAULT_WITHDRAWAL_RULES, undefined)).rejects.toMatchObject({ status: 403 })
    await createRole(app, 'so-rollover', ['rollover.ver'], 0)
    const ro = await authFor(app, 'so-rollover')
    expect(await handler().read(kvCtx(app, ro, key))).toBeTruthy()
    const mkt = await authFor(app, 'marketing')
    await expect(handler().read(kvCtx(app, mkt, key))).rejects.toMatchObject({ status: 403 })
  })
})

describe('seed de demonstração', () => {
  it('insere os saques do painel (centavos, PIX cifrado) e não repete', async () => {
    const probe = await createTestApp()
    const msg = await seedDemo(probe)
    expect(msg).toMatch(/96 saques/)
    const rows = await probe.db.query<{ amount_cents: number; pix_key_enc: string; pix_key_type: string; status: string }>('select * from withdrawals')
    expect(rows).toHaveLength(96)
    expect(rows.every((r) => Number.isInteger(r.amount_cents) && r.amount_cents > 0)).toBe(true)
    expect(rows.every((r) => r.pix_key_enc.startsWith('v1.'))).toBe(true)
    expect(rows.filter((r) => ['criado', 'pendente', 'em_analise'].includes(r.status)).length).toBeGreaterThanOrEqual(12)
    expect(probe.cipher.decrypt(rows[0].pix_key_enc).length).toBeGreaterThan(5)
    expect(await seedDemo(probe)).toMatch(/nada a semear/)
    expect((await probe.db.query('select id from withdrawals')).length).toBe(96)
    await probe.close()
  })

  it('dados obviamente fictícios: quem decidiu é o rótulo genérico, e-mail .invalid e chave PIX fictícia', async () => {
    const probe = await createTestApp()
    try {
      await seedDemo(probe)
      const rows = await probe.db.query<{ player_email: string; pix_key_type: string; pix_key_enc: string; decided_by: string | null; status: string }>(
        'select player_email, pix_key_type, pix_key_enc, decided_by, status from withdrawals',
      )
      const decided = rows.filter((r) => ['aprovado', 'recusado'].includes(r.status))
      expect(decided.length).toBeGreaterThan(0)
      // antes: nomes da equipe real ('Daniel Carius', 'Rafael Lima', 'Beatriz Souza')
      expect(new Set(decided.map((r) => r.decided_by))).toEqual(new Set([DEMO_STAFF_LABEL]))
      expect(rows.every((r) => r.player_email.endsWith('.invalid'))).toBe(true)
      for (const r of rows) {
        const key = probe.cipher.decrypt(r.pix_key_enc)
        if (r.pix_key_type === 'E-mail') expect(key.endsWith('.invalid')).toBe(true)
        if (r.pix_key_type === 'CPF') expect(demoCpf(key)).toBe(key)
        if (r.pix_key_type === 'Celular') expect(demoPhone(key)).toBe(key)
      }
    } finally {
      await probe.close()
    }
  })
})
