// Regressões de segurança (revisão adversarial r2) dos registros financeiros e
// regulados guardados por chave: saques e saldos de afiliados, regras de comissão,
// depósitos, apurações de GGR, configuração regulada, histórico de versões,
// campanhas, verificações de domínio, leitura de dados pessoais, base de jogadores
// e extrato e chaves criadas à vontade.
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { findKvRule } from '@shared/kv-registry'
import { manualCreditors, payoutHold } from '../src/modules/kv/payout-guards'
import { encryptAtRest, loadRow, saveRow } from '../src/modules/kv/store'
import { api, createTestApp, loginAs } from './helpers'

// ---------- utilitários ----------

type Row = Record<string, any>

const put = (app: FastifyInstance, cookie: string, key: string, value: unknown, version?: number, ip?: string) =>
  api(app, 'PUT', `/api/kv/${key}`, { cookie, ip, body: version === undefined ? { value } : { value, version } })
const get = (app: FastifyInstance, cookie: string, key: string) => api(app, 'GET', `/api/kv/${key}`, { cookie })
const post = (app: FastifyInstance, cookie: string, url: string, body?: unknown) => api(app, 'POST', url, { cookie, body })

async function current(app: FastifyInstance, cookie: string, key: string) {
  const r = await get(app, cookie, key)
  expect(r.statusCode, `${key}: ${r.body}`).toBe(200)
  return r.json() as { value: any; version: number }
}

async function storedPlain<T = Row[]>(app: FastifyInstance, key: string): Promise<T> {
  const r = await app.db.one<{ value: unknown; value_enc: string | null }>('select value, value_enc from kv_store where key = $1', [key])
  return (r?.value_enc ? JSON.parse(app.cipher.decrypt(r.value_enc)) : r?.value) as T
}

const version = async (app: FastifyInstance, key: string) => (await app.db.one<{ version: number }>('select version from kv_store where key = $1', [key]))?.version

/** Grava direto no banco, como a plataforma (registros que a tela não cria). */
async function seed(app: FastifyInstance, key: string, value: unknown) {
  const rule = findKvRule(key)!
  await app.db.tx(async (t) => {
    const row = await loadRow(t, key, true)
    await saveRow(t, app.cipher, key, value, encryptAtRest(rule), row, 'plataforma')
  })
}

async function role(app: FastifyInstance, id: string, permissions: string[], approvalCeiling: number | null = 0) {
  await app.db.query('insert into roles (id, name, permissions, approval_ceiling_cents) values ($1, $2, $3, $4)', [
    id,
    `Cargo ${id}`,
    permissions,
    approvalCeiling === null ? null : Math.round(approvalCeiling * 100),
  ])
}

async function audits(app: FastifyInstance, like: string) {
  return app.db.query<{ action: string; entity: string; summary: string; source: string; actor_name: string }>(
    'select action, entity, summary, source, actor_name from audit_log where summary like $1 order by id',
    [like],
  )
}

/** Todo o conteúdo do banco em texto (decifrando colunas cifradas). */
async function dumpDatabase(app: FastifyInstance): Promise<string> {
  const tables = await app.db.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  )
  const parts: string[] = []
  for (const { table_name } of tables) {
    for (const row of await app.db.query<Record<string, unknown>>(`select * from "${table_name}"`)) {
      for (const v of Object.values(row)) {
        let text = typeof v === 'string' ? v : JSON.stringify(v)
        if (typeof v === 'string') {
          try {
            text += ` ${app.cipher.decrypt(v)}`
          } catch {
            /* não é cifrado */
          }
        }
        parts.push(text)
      }
    }
  }
  return parts.join('\n')
}

const payout = (id: string, p: Row = {}): Row => ({
  id,
  affiliateId: 'a1',
  affiliateName: 'Afiliado Um',
  affiliateEmail: 'a1@exemplo.com',
  affiliateType: 'Influencer',
  amount: 300,
  method: 'pix',
  pixKeyType: 'CPF',
  pixKey: '12345678909',
  bank: null,
  status: 'pendente',
  createdAt: '2026-09-01T10:00:00.000Z',
  decidedAt: null,
  decidedBy: null,
  reason: null,
  reference: null,
  ...p,
})

const affiliate = (id: string, p: Row = {}): Row => ({
  id,
  playerId: '',
  name: `Afiliado ${id}`,
  email: `${id}@exemplo.com`,
  type: 'Manager',
  level: 1,
  managerId: null,
  code: `COD${id.toUpperCase()}`,
  cpa: 50,
  revShare: 0.2,
  status: 'ativo',
  balance: 100,
  pixKey: `${id}@exemplo.com`,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...p,
})

// ---------- r2-generic-kv-financial-records-1 / r2-audit-forgery-attribution-4: saques de afiliados ----------

describe('kv: saques de afiliados só pelas rotas do servidor (afiliados.saques)', () => {
  let app: FastifyInstance
  let root: string
  let approver: { cookie: string; user: { id: string } }
  const KEY = 'afiliados.saques'

  beforeAll(async () => {
    app = await createTestApp()
    root = (await loginAs(app, 'superadmin', { name: 'Daniel Carius' })).cookie
    await seed(app, KEY, [
      payout('w1'),
      payout('w2', { amount: 800, status: 'recusado', decidedAt: '2026-09-02T10:00:00.000Z', decidedBy: 'Daniel Carius', reason: 'Fraude' }),
      payout('w3', { amount: 1200, method: 'ted', pixKeyType: null, pixKey: null, bank: { bank: '341 · Itaú', agency: '1234', account: '98765-4', holder: 'Afiliado Um' } }),
      payout('w4', { affiliateId: 'a9', affiliateName: 'Sem cadastro', amount: 50 }),
      payout('w5', { amount: 900 }),
      payout('w6', { amount: 0 }),
    ])
    await seed(app, 'crescimento.afiliados', [affiliate('a1', { balance: 100 })])
    // cargo do PoC: só ver e aprovar saques de afiliado, com "Não aprova saques" (teto 0)
    await role(app, 'aprovador-afil', ['afiliados-saques.ver', 'afiliados-saques.aprovar'], 0)
    approver = await loginAs(app, 'aprovador-afil', { name: 'Paulo Pagador' })
  })
  afterAll(async () => app.close())

  it('PUT da lista (valor, status, decisor, pagamento inventado ou lista vazia) → 403 para qualquer cargo; nada muda', async () => {
    const before = await storedPlain(app, KEY)
    const v = await version(app, KEY)
    const cur = await current(app, approver.cookie, KEY)
    const forged = cur.value.map((w: Row) =>
      w.id === 'w1'
        ? { ...w, amount: 250000, status: 'pago', decidedBy: 'Daniel Carius', decidedAt: '2026-01-01', reference: 'E-FORJADO' }
        : w.id === 'w2'
          ? { ...w, amount: 9999, status: 'pago', reason: null }
          : w,
    )
    forged.push(payout('w9', { affiliateId: 'a9', amount: 1_000_000, status: 'pago', decidedBy: 'Daniel Carius' }))
    for (const [cookie, value] of [
      [approver.cookie, forged],
      [approver.cookie, []],
      [root, []],
    ] as const) {
      const r = await put(app, cookie, KEY, value, cur.version)
      expect(r.statusCode).toBe(403)
      expect(r.json().error.message).toContain('só pelo servidor')
    }
    expect(await storedPlain(app, KEY)).toEqual(before)
    expect(await version(app, KEY)).toBe(v)
  })

  it('pagar: só pendente, valor e dados gravados, decisor/data/referência do servidor, auditoria com valor', async () => {
    const r = await post(app, approver.cookie, `/api/kv/${KEY}/w1/pay`)
    expect(r.statusCode, r.body).toBe(200)
    expect(r.json()).toMatchObject({ ok: true, message: 'R$ 300,00 pagos a Afiliado Um. O PIX foi enviado.' })
    // resposta mascarada para quem não tem afiliados-saques.ver-pix
    expect(r.json().withdrawal.pixKey).toBe('123.***.***-09')
    const w1 = (await storedPlain(app, KEY)).find((w) => w.id === 'w1')!
    expect(w1).toMatchObject({ amount: 300, status: 'pago', decidedBy: 'Paulo Pagador', decidedById: approver.user.id, reason: null, pixKey: '12345678909' })
    expect(w1.reference).toMatch(/^E\d{8}[0-9A-F]{12}$/)
    expect(Date.now() - Date.parse(w1.decidedAt)).toBeLessThan(60_000)
    const a = (await audits(app, `${KEY}%`)).at(-1)!
    expect(a).toMatchObject({ action: 'aprovar', entity: 'Saque de afiliado #w1', source: 'servidor', actor_name: 'Paulo Pagador' })
    expect(a.summary).toContain('Pagamento de R$ 300,00 para Afiliado Um (a1) (PIX) · pendente → pago · ref. E')
    expect(a.summary).toMatch(/\(v\d+→v\d+\)$/)
    // já decidido / inexistente / valor inválido
    expect((await post(app, approver.cookie, `/api/kv/${KEY}/w1/pay`)).json().error.code).toBe('ja_decidido')
    expect((await post(app, approver.cookie, `/api/kv/${KEY}/w2/pay`)).statusCode).toBe(409)
    expect((await post(app, approver.cookie, `/api/kv/${KEY}/nao-existe/pay`)).statusCode).toBe(404)
    expect((await post(app, approver.cookie, `/api/kv/${KEY}/w6/pay`)).statusCode).toBe(409)
  })

  it('recusar: motivo obrigatório; valor volta ao saldo de comissão na mesma transação; auditoria com saldo antes → depois', async () => {
    expect((await post(app, approver.cookie, `/api/kv/${KEY}/w3/reject`, {})).statusCode).toBe(400)
    expect((await post(app, approver.cookie, `/api/kv/${KEY}/w3/reject`, { reason: 'x' })).statusCode).toBe(400)
    const affVersion = await version(app, 'crescimento.afiliados')
    const r = await post(app, approver.cookie, `/api/kv/${KEY}/w3/reject`, { reason: 'Dados bancários divergentes' })
    expect(r.statusCode, r.body).toBe(200)
    expect(r.json().message).toBe('R$ 1.200,00 voltaram para o saldo de comissão de Afiliado Um.')
    expect(r.json().withdrawal.bank).toMatchObject({ agency: '••34' })
    const w3 = (await storedPlain(app, KEY)).find((w) => w.id === 'w3')!
    expect(w3).toMatchObject({ status: 'recusado', reason: 'Dados bancários divergentes', decidedBy: 'Paulo Pagador', reference: null, amount: 1200 })
    // saldo é campo do servidor: a versão da lista de afiliados não muda (o painel não recebe 409)
    expect((await storedPlain(app, 'crescimento.afiliados'))[0].balance).toBe(1300)
    expect(await version(app, 'crescimento.afiliados')).toBe(affVersion)
    const a = (await audits(app, `${KEY}%`)).at(-1)!
    expect(a).toMatchObject({ action: 'recusar', entity: 'Saque de afiliado #w3' })
    expect(a.summary).toContain('Pedido de R$ 1.200,00 de Afiliado Um (a1) recusado: Dados bancários divergentes · pendente → recusado · saldo de comissão R$ 100,00 → R$ 1.300,00')
    // afiliado fora da base: recusa registra que o saldo não foi devolvido
    const r4 = await post(app, approver.cookie, `/api/kv/${KEY}/w4/reject`, { reason: 'Afiliado inexistente' })
    expect(r4.statusCode).toBe(200)
    expect((await audits(app, `${KEY}%`)).at(-1)!.summary).toContain('afiliado não encontrado na base: saldo não devolvido')
    expect((await post(app, approver.cookie, `/api/kv/${KEY}/w3/reject`, { reason: 'De novo' })).statusCode).toBe(409)
  })

  it('cargo sem afiliados-saques.aprovar → 403; cargo com teto de aprovação não paga acima do teto', async () => {
    await role(app, 'so-ver-afil', ['afiliados-saques.ver'])
    const viewer = (await loginAs(app, 'so-ver-afil')).cookie
    expect((await post(app, viewer, `/api/kv/${KEY}/w5/pay`)).statusCode).toBe(403)
    await role(app, 'aprovador-teto', ['afiliados-saques.ver', 'afiliados-saques.aprovar'], 500)
    const capped = (await loginAs(app, 'aprovador-teto')).cookie
    const r = await post(app, capped, `/api/kv/${KEY}/w5/pay`)
    expect(r.statusCode).toBe(403)
    expect(r.json().error).toMatchObject({ code: 'teto_excedido', details: { ceiling: 500, amount: 900 } })
    expect((await storedPlain(app, KEY)).find((w) => w.id === 'w5')!.status).toBe('pendente')
  })

  it('controle: saque de jogador acima do teto do Financeiro continua recusado (teto_excedido)', async () => {
    const fin = await loginAs(app, 'financeiro', { totp: true })
    await app.db.query(
      `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                                risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
       values ('s1', 'p1', 'Jogador', 'j@exemplo.com', 1000000, 0, 'pendente', 'baixo', 1, '[]'::jsonb, 'CPF', $1, 'E1', now(), now())`,
      [app.cipher.encrypt('12345678909')],
    )
    const r = await post(app, fin.cookie, '/api/withdrawals/s1/approve')
    expect(r.statusCode).toBe(403)
    expect(r.json().error.code).toBe('teto_excedido')
  })
})

// ---------- r2-generic-kv-financial-records-2 / r2-audit-forgery-attribution-4: afiliados e comissões ----------

describe('kv: afiliados (saldo do servidor, campos por permissão) e regras de comissão validadas', () => {
  let app: FastifyInstance
  let comissoes: string
  let pagador: string
  let gerente: { cookie: string }
  const AFF = 'crescimento.afiliados'
  const COM = 'crescimento.comissoes'

  beforeAll(async () => {
    app = await createTestApp()
    await seed(app, AFF, [affiliate('a1', { balance: 100, cpa: 50, revShare: 0.2 }), affiliate('a2', { balance: 0, type: 'Influencer', level: 2, managerId: 'a1' })])
    await role(app, 'so-comissoes', ['comissoes.ver', 'comissoes.editar'])
    comissoes = (await loginAs(app, 'so-comissoes', { name: 'Pessoa Comissões' })).cookie
    await role(app, 'so-pagar-afil', ['afiliados-saques.ver', 'afiliados-saques.aprovar'])
    pagador = (await loginAs(app, 'so-pagar-afil', { name: 'Pessoa Pagadora' })).cookie
    await role(app, 'gerente-afil', ['afiliados-gerentes.ver', 'afiliados-gerentes.editar'])
    gerente = await loginAs(app, 'gerente-afil', { name: 'Gina Gerente' })
  })
  afterAll(async () => app.close())

  it('comissoes.editar só troca o código: saldo, CPA e Rev Share → 403 (saldo enviado é ignorado)', async () => {
    const cur = await current(app, comissoes, AFF)
    const forged = cur.value.map((a: Row) => (a.id === 'a1' ? { ...a, balance: 500_000, cpa: 100_000, revShare: 900 } : a))
    const r = await put(app, comissoes, AFF, forged, cur.version)
    expect(r.statusCode).toBe(403)
    expect(r.json().error).toMatchObject({ code: 'campo_nao_permitido', details: { fields: ['cpa', 'revShare'] } })
    expect((await storedPlain(app, AFF))[0]).toMatchObject({ balance: 100, cpa: 50, revShare: 0.2 })
    // código: muda, com formato e unicidade, auditado com antes → depois
    const dup = await put(app, comissoes, AFF, cur.value.map((a: Row) => (a.id === 'a1' ? { ...a, code: 'CODA2' } : a)), cur.version)
    expect(dup.statusCode).toBe(400)
    expect((await put(app, comissoes, AFF, cur.value.map((a: Row) => (a.id === 'a1' ? { ...a, code: 'x y' } : a)), cur.version)).statusCode).toBe(400)
    const ok = await put(app, comissoes, AFF, cur.value.map((a: Row) => (a.id === 'a1' ? { ...a, code: 'NOVO42' } : a)), cur.version)
    expect(ok.statusCode, ok.body).toBe(200)
    expect((await audits(app, `${AFF}%`)).at(-1)!.summary).toContain('a1 (Afiliado a1): code CODA1 → NOVO42')
    // incluir ou remover: só afiliados-gerentes.editar
    const cur2 = await current(app, comissoes, AFF)
    expect((await put(app, comissoes, AFF, [cur2.value[0]], cur2.version)).json().error.code).toBe('campo_nao_permitido')
  })

  it('afiliados-saques.aprovar não grava a base de afiliados nem a lista de saques (credita → paga)', async () => {
    const cur = await current(app, pagador, AFF)
    const r = await put(app, pagador, AFF, cur.value.map((a: Row) => (a.id === 'a1' ? { ...a, balance: 999_999 } : a)), cur.version)
    expect(r.statusCode).toBe(403)
    expect(r.json().error.code).toBe('sem_permissao')
    const wd = await put(app, pagador, 'afiliados.saques', [payout('w9', { amount: 999_999, status: 'pago' })], 0)
    expect(wd.statusCode).toBe(403)
    expect((await storedPlain(app, AFF))[0].balance).toBe(100)
  })

  it('gerente muda contrato e status dentro dos limites, com auditoria antes → depois; saldo enviado é ignorado e auditado', async () => {
    const cur = await current(app, gerente.cookie, AFF)
    for (const [field, value] of [
      ['cpa', 100_000],
      ['cpa', -1],
      ['revShare', 900],
      ['revShare', 0.61],
      ['status', 'sumido'],
      ['managerId', 'nao-existe'],
      ['email', 'invalido'],
    ] as const) {
      const r = await put(app, gerente.cookie, AFF, cur.value.map((a: Row) => (a.id === 'a2' ? { ...a, [field]: value } : a)), cur.version)
      expect(r.statusCode, `${field}=${value}`).toBe(400)
    }
    const next = cur.value.map((a: Row) => (a.id === 'a1' ? { ...a, cpa: 80, revShare: 0.3, balance: 999_999 } : a))
    const r = await put(app, gerente.cookie, AFF, next, cur.version)
    expect(r.statusCode, r.body).toBe(200)
    const a1 = (await storedPlain(app, AFF)).find((a) => a.id === 'a1')!
    expect(a1).toMatchObject({ cpa: 80, revShare: 0.3, balance: 100 })
    const summary = (await audits(app, `${AFF}%`)).at(-1)!.summary
    expect(summary).toContain('cpa R$ 50,00 → R$ 80,00')
    expect(summary).toContain('revShare 20% → 30%')
    expect(summary).toContain('saldo enviado ignorado (o saldo de comissão é do servidor): a1')
    expect(summary).not.toContain('999')
  })

  it('afiliado novo: só gerente, saldo começa em 0 e a data é do servidor; remover fica auditado com o saldo', async () => {
    const cur = await current(app, gerente.cookie, AFF)
    const novo = affiliate('a3', { balance: 50_000, createdAt: '2020-01-01T00:00:00.000Z', code: 'NOVOAF3' })
    const r = await put(app, gerente.cookie, AFF, [...cur.value, novo], cur.version)
    expect(r.statusCode, r.body).toBe(200)
    const a3 = (await storedPlain(app, AFF)).find((a) => a.id === 'a3')!
    expect(a3.balance).toBe(0)
    expect(a3.createdAt).not.toBe('2020-01-01T00:00:00.000Z')
    const cur2 = await current(app, gerente.cookie, AFF)
    const rem = await put(app, gerente.cookie, AFF, cur2.value.filter((a: Row) => a.id !== 'a2'), cur2.version)
    expect(rem.statusCode).toBe(200)
    expect((await audits(app, `${AFF}%`)).at(-1)!.summary).toContain('removido a2 (Afiliado a2) (saldo de comissão R$ 0,00)')
  })

  it('regras de comissão: validateCommissionRule no servidor; autor e data do servidor; auditoria antes → depois', async () => {
    const bad: Row[] = [
      { Manager: { model: 'revshare', value: 900, cap: null } },
      { Manager: { model: 'cpa', value: 0, cap: null } },
      { Manager: { model: 'cpa', value: 50, cap: 10 } },
      { Manager: { model: 'revshare', value: 10, cap: -1 } },
      { Manager: { model: 'outro', value: 10, cap: null } },
      { Hacker: { model: 'cpa', value: 10, cap: null } },
    ]
    for (const value of bad) {
      const r = await put(app, comissoes, COM, value, 0)
      expect(r.statusCode, JSON.stringify(value)).toBe(400)
    }
    const ok = await put(app, comissoes, COM, { Manager: { model: 'revshare', value: 15, cap: null, updatedAt: '2001-01-01', updatedBy: 'Daniel Carius' } }, 0)
    expect(ok.statusCode, ok.body).toBe(200)
    const stored = await storedPlain<Row>(app, COM)
    expect(stored.Manager).toMatchObject({ model: 'revshare', value: 15, cap: null, updatedBy: 'Pessoa Comissões' })
    expect(stored.Manager.updatedAt).not.toBe('2001-01-01')
    const ok2 = await put(app, comissoes, COM, { ...stored, Influencer: { model: 'cpa', value: 50, cap: 5000 } }, 1)
    expect(ok2.statusCode).toBe(200)
    // regra que não mudou mantém autor e data gravados
    expect((await storedPlain<Row>(app, COM)).Manager.updatedAt).toBe(stored.Manager.updatedAt)
    expect((await audits(app, `${COM}%`)).at(-1)!.summary).toBe(`${COM} — Regras: Influencer: — → CPA R$ 50,00, teto R$ 5.000,00 (v1→v2)`)
    // gravação de crescimento.comissoes por quem não tem comissoes.editar
    expect((await put(app, gerente.cookie, COM, stored, 2)).statusCode).toBe(403)
  })
})

// ---------- r2-generic-kv-financial-records-3: depósitos ----------

describe('kv: registro de depósitos é do servidor; o painel só reconsulta PIX vencido', () => {
  let app: FastifyInstance
  let fin: string
  let suporte: string
  const KEY = 'operacao.depositos'
  const old = new Date(Date.now() - 3 * 3_600_000).toISOString()
  const deposit = (id: string, p: Row) => ({
    id,
    playerId: 'p1',
    playerName: 'Jogador Um',
    playerEmail: 'jogador1@x.com',
    gateway: 'PixPay',
    reference: `E${id}`,
    isFirst: false,
    bonusCampaign: null,
    createdAt: old,
    updatedAt: old,
    ...p,
  })
  const base = [
    deposit('d1', { amount: 100, status: 'pago', isFirst: true }),
    deposit('d2', { amount: 5000, status: 'pendente' }),
    deposit('d3', { amount: 2000, status: 'pago' }),
    deposit('d4', { amount: 70, status: 'pendente', createdAt: new Date().toISOString() }),
  ]

  beforeAll(async () => {
    app = await createTestApp()
    await seed(app, KEY, base)
    fin = (await loginAs(app, 'financeiro', { name: 'Pessoa Financeiro', totp: true })).cookie
    suporte = (await loginAs(app, 'suporte')).cookie
  })
  afterAll(async () => app.close())

  it('Financeiro (depositos.editar) não reescreve valor/status/FTD nem apaga depósito', async () => {
    const cur = await current(app, fin, KEY)
    const forged = cur.value
      .filter((d: Row) => d.id !== 'd3')
      .map((d: Row) => (d.id === 'd1' ? { ...d, amount: 100_000, status: 'pendente' } : d.id === 'd2' ? { ...d, status: 'pago', isFirst: true } : d))
    const r = await put(app, fin, KEY, forged, cur.version)
    expect(r.statusCode).toBe(403)
    expect((await storedPlain(app, KEY)).map((d) => [d.id, d.amount, d.status])).toEqual([
      ['d1', 100, 'pago'],
      ['d2', 5000, 'pendente'],
      ['d3', 2000, 'pago'],
      ['d4', 70, 'pendente'],
    ])
  })

  it('reconsulta: só pendente com prazo vencido vira expirado; nada mais muda; auditoria sincronizar', async () => {
    expect((await post(app, suporte, `/api/kv/${KEY}/recheck`, { ids: ['d2'] })).statusCode).toBe(403)
    expect((await post(app, fin, `/api/kv/${KEY}/recheck`, { ids: [] })).statusCode).toBe(400)
    const r = await post(app, fin, `/api/kv/${KEY}/recheck`, { ids: ['d1', 'd2', 'd4', 'nao-existe'] })
    expect(r.statusCode, r.body).toBe(200)
    expect(r.json()).toMatchObject({ ok: true, expired: ['d2'], unchanged: ['d1', 'd4'], missing: ['nao-existe'] })
    const stored = await storedPlain(app, KEY)
    expect(stored.map((d) => [d.id, d.amount, d.status, d.isFirst])).toEqual([
      ['d1', 100, 'pago', true],
      ['d2', 5000, 'expirado', false],
      ['d3', 2000, 'pago', false],
      ['d4', 70, 'pendente', false],
    ])
    const a = (await audits(app, `${KEY}%`)).at(-1)!
    expect(a).toMatchObject({ action: 'sincronizar', entity: 'Depósito #d2' })
    expect(a.summary).toContain('PIX de R$ 5.000,00 no PixPay venceu sem pagamento (prazo de 30 min): pendente → expirado')
  })

  it('limites e campanhas da tela de depósito continuam com depositos.editar, validados', async () => {
    const limits = { min: 10, max: 10000, dailyLimit: 20000, quickAmounts: [20, 50], defaultAmount: 50, pixExpirationMin: 30, showBonusSelector: true, mainGateway: 'A', fallbackGateway: 'B', holderOnly: true }
    expect((await put(app, fin, 'operacao.depositos.limites', { ...limits, pixExpirationMin: 1 }, 0)).statusCode).toBe(400)
    expect((await put(app, fin, 'operacao.depositos.limites', { ...limits, max: 5 }, 0)).statusCode).toBe(400)
    expect((await put(app, fin, 'operacao.depositos.limites', limits, 0)).statusCode).toBe(200)
    expect((await put(app, fin, 'operacao.depositos.campanhas', { items: [], maxVisible: 3, preselectFirst: false }, 0)).statusCode).toBe(200)
    expect((await put(app, suporte, 'operacao.depositos.limites', limits, 1)).statusCode).toBe(403)
  })
})

// ---------- r2-generic-kv-financial-records-4: apurações de GGR ----------

describe('kv: apurações de GGR seguem aberta → fechada → paga no servidor', () => {
  let app: FastifyInstance
  let fin: { cookie: string }
  const KEY = 'crescimento.ggr.apuracoes'
  const settlement = (id: string, p: Row) => ({
    id,
    month: '2026-08',
    providerId: 'prov1',
    providerName: 'Pragmatic Play',
    bets: 1_000_000,
    wins: 900_000,
    ggr: 100_000,
    feePct: 10,
    feeDue: 10_000,
    status: 'aberta',
    dueDate: '2026-09-10T15:00:00.000Z',
    closedAt: null,
    closedBy: null,
    paidAt: null,
    paidBy: null,
    paymentRef: null,
    ...p,
  })
  const base = [
    settlement('ap1', { status: 'paga', closedAt: '2026-09-01T12:00:00.000Z', closedBy: 'Daniel Carius', paidAt: '2026-09-09T12:00:00.000Z', paidBy: 'Daniel Carius', paymentRef: 'TED-1' }),
    settlement('ap2', { providerId: 'prov2', providerName: 'Evolution', status: 'fechada', ggr: 50_000, bets: 500_000, wins: 450_000, feeDue: 5_000, closedAt: '2026-09-01T12:00:00.000Z', closedBy: 'Daniel Carius' }),
    settlement('ap3', { providerId: 'prov3', providerName: 'Spribe', ggr: 20_000, bets: 220_000, wins: 200_000, feeDue: 2_000 }),
    settlement('ap4', { month: '2099-01', providerId: 'prov3', providerName: 'Spribe' }),
  ]

  beforeAll(async () => {
    app = await createTestApp()
    await seed(app, KEY, base)
    fin = await loginAs(app, 'financeiro', { name: 'Pessoa Financeiro' })
  })
  afterAll(async () => app.close())

  it('Financeiro não reabre/altera apuração paga nem apaga apuração fechada; nada muda', async () => {
    const cur = await current(app, fin.cookie, KEY)
    const forged = cur.value
      .filter((s: Row) => s.id !== 'ap2')
      .map((s: Row) => (s.id === 'ap1' ? { ...s, ggr: 1, bets: 1, wins: 0, feeDue: 0.1, paymentRef: 'OUTRO', status: 'aberta' } : s))
    const r = await put(app, fin.cookie, KEY, forged, cur.version)
    expect(r.statusCode).toBe(403)
    const paidRewrite = cur.value.map((s: Row) => (s.id === 'ap1' ? { ...s, feeDue: 1, paidBy: 'Outra', paymentRef: 'XXXXXXX' } : s))
    expect((await put(app, fin.cookie, KEY, paidRewrite, cur.version)).statusCode).toBe(403)
    const reopen = cur.value.map((s: Row) => (s.id === 'ap2' ? { ...s, status: 'aberta' } : s))
    expect((await put(app, fin.cookie, KEY, reopen, cur.version)).json().error.code).toBe('transicao_nao_permitida')
    const openEdit = cur.value.map((s: Row) => (s.id === 'ap3' ? { ...s, ggr: 1 } : s))
    expect((await put(app, fin.cookie, KEY, openEdit, cur.version)).json().error.code).toBe('campo_nao_permitido')
    const skip = cur.value.map((s: Row) => (s.id === 'ap3' ? { ...s, status: 'paga', paymentRef: 'TED-999999' } : s))
    expect((await put(app, fin.cookie, KEY, skip, cur.version)).statusCode).toBe(403)
    const newPaid = [...cur.value, settlement('ap9', { providerId: 'prov9', status: 'paga', paymentRef: 'TED-000001' })]
    expect((await put(app, fin.cookie, KEY, newPaid, cur.version)).statusCode).toBe(400)
    expect((await storedPlain(app, KEY)).map((s) => [s.id, s.status, s.ggr, s.feeDue, s.paymentRef])).toEqual([
      ['ap1', 'paga', 100_000, 10_000, 'TED-1'],
      ['ap2', 'fechada', 50_000, 5_000, null],
      ['ap3', 'aberta', 20_000, 2_000, null],
      ['ap4', 'aberta', 100_000, 10_000, null],
    ])
  })

  it('fechar: só mês encerrado; taxa congelada, valor devido e quem fechou definidos pelo servidor', async () => {
    const cur = await current(app, fin.cookie, KEY)
    const early = cur.value.map((s: Row) => (s.id === 'ap4' ? { ...s, status: 'fechada' } : s))
    expect((await put(app, fin.cookie, KEY, early, cur.version)).json().error.code).toBe('transicao_nao_permitida')
    const close = cur.value.map((s: Row) =>
      s.id === 'ap3' ? { ...s, status: 'fechada', feePct: 12, feeDue: 1, closedAt: '2001-01-01T00:00:00.000Z', closedBy: 'Daniel Carius' } : s,
    )
    const r = await put(app, fin.cookie, KEY, close, cur.version)
    expect(r.statusCode, r.body).toBe(200)
    const ap3 = (await storedPlain(app, KEY)).find((s) => s.id === 'ap3')!
    expect(ap3).toMatchObject({ status: 'fechada', feePct: 12, feeDue: 2400, closedBy: 'Pessoa Financeiro', closedById: expect.any(String) })
    expect(ap3.closedAt).not.toBe('2001-01-01T00:00:00.000Z')
    const a = (await audits(app, `${KEY}%`)).at(-1)!
    expect(a).toMatchObject({ action: 'aprovar', entity: 'Apuração Spribe 2026-08' })
    expect(a.summary).toContain('Apuração fechada: GGR R$ 20.000,00 × 12% = R$ 2.400,00')
  })

  it('pagar: só fechada, com referência válida; quem pagou e quando vêm do servidor; paga não muda mais', async () => {
    const cur = await current(app, fin.cookie, KEY)
    const shortRef = cur.value.map((s: Row) => (s.id === 'ap2' ? { ...s, status: 'paga', paymentRef: 'abc' } : s))
    expect((await put(app, fin.cookie, KEY, shortRef, cur.version)).statusCode).toBe(400)
    const pay = cur.value.map((s: Row) => (s.id === 'ap2' ? { ...s, status: 'paga', paymentRef: 'TED 123456', paidBy: 'Daniel Carius', feeDue: 1 } : s))
    expect((await put(app, fin.cookie, KEY, pay, cur.version)).json().error.code).toBe('campo_nao_permitido')
    const ok = cur.value.map((s: Row) => (s.id === 'ap2' ? { ...s, status: 'paga', paymentRef: 'TED 123456', paidBy: 'Daniel Carius' } : s))
    const r = await put(app, fin.cookie, KEY, ok, cur.version)
    expect(r.statusCode, r.body).toBe(200)
    expect((await storedPlain(app, KEY)).find((s) => s.id === 'ap2')).toMatchObject({ status: 'paga', paymentRef: 'TED 123456', paidBy: 'Pessoa Financeiro', feeDue: 5000 })
    expect((await audits(app, `${KEY}%`)).at(-1)!.summary).toContain('Marcada como paga: R$ 5.000,00 (ref. TED 123456) · fechada → paga')
  })
})

// ---------- r2-generic-kv-financial-records-5: configuração regulada ----------

describe('kv: jogo responsável, países bloqueados e bloqueios do anti-fraude validados no servidor', () => {
  let app: FastifyInstance
  let root: string
  let rg: string
  let paises: { cookie: string }
  let banir: { cookie: string }
  const GOOD_RG = {
    deposit: { daily: { default: 0, max: 10_000 }, weekly: { default: 0, max: 30_000 }, monthly: { default: 0, max: 100_000 } },
    loss: { daily: { default: 0, max: 5_000 }, weekly: { default: 0, max: 15_000 }, monthly: { default: 0, max: 50_000 } },
    session: { everyMinutes: 60, showSummary: true, requireAck: true },
    pause: { '24h': true, '7d': true, '30d': true },
    exclusion: { '6m': true, '1a': true, '2a': true, '5a': false, permanente: true },
    coolingOffHours: 72,
    messages: { items: ['Aposte com responsabilidade.'], footer: true, deposit: true, session: true },
  }
  const big = { default: 0, max: 1e12 }
  const EVIL_RG = {
    deposit: { daily: big, weekly: big, monthly: big },
    loss: { daily: big, weekly: big, monthly: big },
    session: { everyMinutes: 100_000, showSummary: false, requireAck: false },
    pause: { '24h': false, '7d': false, '30d': false },
    exclusion: { '6m': false, '1a': false, '2a': false, '5a': false, permanente: false },
    coolingOffHours: 0,
    messages: { items: [] as string[], footer: false, deposit: false, session: false },
  }

  beforeAll(async () => {
    app = await createTestApp()
    root = (await loginAs(app, 'superadmin', { name: 'Daniel Carius' })).cookie
    await role(app, 'so-rg', ['jogo-responsavel.ver', 'jogo-responsavel.editar'])
    rg = (await loginAs(app, 'so-rg', { name: 'Pessoa RG' })).cookie
    await role(app, 'so-paises', ['paises.ver', 'paises.editar'])
    paises = await loginAs(app, 'so-paises', { name: 'Pessoa Países' })
    await role(app, 'so-banir', ['antifraude.ver', 'antifraude.banir'])
    banir = await loginAs(app, 'so-banir', { name: 'Pessoa Banir' })
    expect((await put(app, root, 'config.jogo-responsavel', GOOD_RG, 0)).statusCode).toBe(200)
    await seed(app, 'seguranca.bloqueios', [
      {
        id: 'b1',
        kind: 'rede',
        value: 'rede-7',
        reason: 'Multicontas com bônus',
        accounts: ['p1', 'p2'],
        previousStatuses: { p1: 'pausa', p2: 'ativo' },
        createdAt: '2026-10-01T12:00:00.000Z',
        createdBy: 'Daniel Carius',
      },
    ])
  })
  afterAll(async () => app.close())

  it('jogo responsável: o que o validador do painel recusa o servidor também recusa (400); nada muda', async () => {
    const cases: [string, unknown][] = [
      ['tudo de uma vez', EVIL_RG],
      ['sem pausas', { ...GOOD_RG, pause: { '24h': false, '7d': false, '30d': false } }],
      ['sem autoexclusão', { ...GOOD_RG, exclusion: { '6m': false, '1a': false, '2a': false, '5a': false, permanente: false } }],
      ['sessão fora de 15–120', { ...GOOD_RG, session: { ...GOOD_RG.session, everyMinutes: 121 } }],
      ['cooling-off 0', { ...GOOD_RG, coolingOffHours: 0 }],
      ['sem mensagens', { ...GOOD_RG, messages: { ...GOOD_RG.messages, items: [] } }],
      ['mensagem em branco', { ...GOOD_RG, messages: { ...GOOD_RG.messages, items: ['  '] } }],
      ['limite acima do teto', { ...GOOD_RG, deposit: { ...GOOD_RG.deposit, monthly: { default: 0, max: 1e12 } } }],
      ['diário acima do semanal', { ...GOOD_RG, loss: { ...GOOD_RG.loss, daily: { default: 0, max: 20_000 } } }],
      ['padrão acima do máximo', { ...GOOD_RG, deposit: { ...GOOD_RG.deposit, daily: { default: 20_000, max: 10_000 } } }],
      ['campo desconhecido', { ...GOOD_RG, extra: true }],
      ['campo faltando', { ...GOOD_RG, messages: undefined }],
    ]
    const cur = await current(app, rg, 'config.jogo-responsavel')
    for (const [label, value] of cases) {
      const r = await put(app, rg, 'config.jogo-responsavel', value, cur.version)
      expect(r.statusCode, label).toBe(400)
      expect(r.json().error.code, label).toBe('dados_invalidos')
    }
    expect(await storedPlain(app, 'config.jogo-responsavel')).toEqual(GOOD_RG)
  })

  it('jogo responsável: alteração válida fica na auditoria com os valores antes → depois', async () => {
    const cur = await current(app, rg, 'config.jogo-responsavel')
    const next = { ...GOOD_RG, session: { ...GOOD_RG.session, everyMinutes: 30 }, pause: { ...GOOD_RG.pause, '7d': false } }
    const r = await put(app, rg, 'config.jogo-responsavel', next, cur.version)
    expect(r.statusCode, r.body).toBe(200)
    expect((await audits(app, 'config.jogo-responsavel%')).at(-1)!.summary).toBe(
      'config.jogo-responsavel — Alterações: session.everyMinutes: 60 → 30; pause.7d: sim → não (v1→v2)',
    )
  })

  it('países: nunca o Brasil, código válido e único; data e autor do servidor', async () => {
    for (const value of [
      [{ id: 'BR', code: 'BR', reason: 'teste' }],
      [{ id: 'br', code: ' br ', reason: 'teste' }],
      [{ id: 'X', code: 'XYZ', reason: 'teste' }],
      [
        { id: 'AR', code: 'AR', reason: 'a' },
        { id: 'AR2', code: 'ar', reason: 'b' },
      ],
    ]) {
      const r = await put(app, paises.cookie, 'config.paises.bloqueados', value, 0)
      expect(r.statusCode, JSON.stringify(value)).toBe(400)
    }
    const ok = await put(app, paises.cookie, 'config.paises.bloqueados', [{ id: 'AR', code: 'ar', reason: 'Fraude', createdAt: '2001-01-01', createdBy: 'Daniel Carius' }], 0)
    expect(ok.statusCode, ok.body).toBe(200)
    const [ar] = await storedPlain(app, 'config.paises.bloqueados')
    expect(ar).toMatchObject({ id: 'AR', code: 'AR', reason: 'Fraude', createdBy: 'Pessoa Países' })
    expect(ar.createdAt).not.toBe('2001-01-01')
    // reenviar com outro autor não troca o gravado; remover fica auditado com o contexto
    const keep = await put(app, paises.cookie, 'config.paises.bloqueados', [{ ...ar, createdBy: 'Outra pessoa' }], 1)
    expect(keep.statusCode).toBe(200)
    expect((await storedPlain(app, 'config.paises.bloqueados'))[0].createdBy).toBe('Pessoa Países')
    expect((await put(app, paises.cookie, 'config.paises.bloqueados', [], 2)).statusCode).toBe(200)
    expect((await audits(app, 'config.paises.bloqueados%')).at(-1)!.summary).toContain('desbloqueado AR (motivo era: Fraude; bloqueado por Pessoa Países em')
  })

  it('bloqueios do anti-fraude: gravados não mudam; novos com autor e data do servidor; remoção auditada com o contexto', async () => {
    const cur = await current(app, banir.cookie, 'seguranca.bloqueios')
    const forged = cur.value.map((b: Row) => (b.id === 'b1' ? { ...b, previousStatuses: { p1: 'ativo' }, createdBy: 'Outra pessoa' } : b))
    const r = await put(app, banir.cookie, 'seguranca.bloqueios', forged, cur.version)
    expect(r.statusCode).toBe(403)
    expect(r.json().error.code).toBe('campo_nao_permitido')
    const novo = { id: 'b2', kind: 'ip', value: '203.0.113.9', reason: 'Bot', accounts: ['p3'], previousStatuses: {}, createdAt: '2001-01-01', createdBy: 'Daniel Carius' }
    expect((await put(app, banir.cookie, 'seguranca.bloqueios', [...cur.value, { ...novo, kind: 'outro' }], cur.version)).statusCode).toBe(400)
    expect((await put(app, banir.cookie, 'seguranca.bloqueios', [...cur.value, { ...novo, previousStatuses: { p9: 'ativo' } }], cur.version)).statusCode).toBe(400)
    const ok = await put(app, banir.cookie, 'seguranca.bloqueios', [...cur.value, novo], cur.version)
    expect(ok.statusCode, ok.body).toBe(200)
    const b2 = (await storedPlain(app, 'seguranca.bloqueios')).find((b) => b.id === 'b2')!
    expect(b2).toMatchObject({ createdBy: 'Pessoa Banir' })
    expect(b2.createdAt).not.toBe('2001-01-01')
    const cur2 = await current(app, banir.cookie, 'seguranca.bloqueios')
    expect((await put(app, banir.cookie, 'seguranca.bloqueios', cur2.value.filter((b: Row) => b.id !== 'b1'), cur2.version)).statusCode).toBe(200)
    expect((await audits(app, 'seguranca.bloqueios%')).at(-1)!.summary).toContain(
      'removido b1 (rede rede-7, 2 contas, motivo: Multicontas com bônus; criado por Daniel Carius em 2026-10-01T12:00:00.000Z)',
    )
  })
})

// ---------- r2-generic-kv-financial-records-6: histórico de versões ----------

describe('kv: versões substituídas ficam guardadas e cada auditoria aponta a versão', () => {
  let app: FastifyInstance
  let root: string
  const KEY = 'config.paises.bloqueados'

  beforeAll(async () => {
    app = await createTestApp()
    root = (await loginAs(app, 'superadmin')).cookie
  })
  afterAll(async () => app.close())

  it('cada gravação guarda a versão anterior (inclusive a removida) e a rota de histórico a devolve', async () => {
    const v1 = [{ id: 'GB', code: 'GB', reason: 'MARCADOR-ORIGINAL' }]
    expect((await put(app, root, KEY, v1, 0)).statusCode).toBe(200)
    expect((await put(app, root, KEY, [{ id: 'GB', code: 'GB', reason: 'outro' }], 1)).statusCode).toBe(200)
    expect((await put(app, root, KEY, [], 2)).statusCode).toBe(200)
    expect(await storedPlain(app, KEY)).toEqual([])
    // o valor anterior continua no banco
    expect(await dumpDatabase(app)).toContain('MARCADOR-ORIGINAL')
    const h = await get(app, root, `${KEY}/history`)
    expect(h.statusCode, h.body).toBe(200)
    expect(h.json().entries.map((e: Row) => e.version)).toEqual([2, 1])
    const e1 = await get(app, root, `${KEY}/history/1`)
    expect(e1.statusCode).toBe(200)
    expect(e1.json()).toMatchObject({ key: KEY, version: 1, value: [{ id: 'GB', code: 'GB', reason: 'MARCADOR-ORIGINAL' }] })
    expect((await get(app, root, `${KEY}/history/99`)).statusCode).toBe(404)
    expect((await get(app, root, `${KEY}/history/1;drop`)).statusCode).toBe(404)
    // as auditorias apontam a versão
    expect((await audits(app, `${KEY}%`)).map((a) => a.summary.match(/\(v\d+→v\d+\)$/)?.[0])).toEqual(['(v0→v1)', '(v1→v2)', '(v2→v3)'])
  })

  it('histórico: só quem lê a chave e vê a Auditoria; chave sem histórico → 404; linhas de histórico fora da rota de dados', async () => {
    await role(app, 'so-paises-ver', ['paises.ver'])
    const viewer = (await loginAs(app, 'so-paises-ver')).cookie
    expect((await get(app, viewer, `${KEY}/history`)).statusCode).toBe(403)
    expect((await get(app, root, 'campanhas.missoes/history')).statusCode).toBe(404)
    // a linha guardada não é endereçável pela rota de dados
    const [hk] = await app.db.query<{ key: string }>(`select key from kv_store where key like '~hist:%' limit 1`)
    expect(hk.key).toMatch(/^~hist:config\.paises\.bloqueados@\d+$/)
    expect((await get(app, root, encodeURIComponent(hk.key))).statusCode).toBe(404)
  })

  it('registros financeiros: alterar ou apagar é recusado, então os valores continuam no banco', async () => {
    const adm = (await loginAs(app, 'administrador')).cookie
    await seed(app, 'afiliados.saques', [payout('w1', { amount: 4321.87, status: 'pago', decidedBy: 'DECISOR-MARCADOR', bank: { bank: 'X', agency: '0001', account: '1-1', holder: 'TITULAR-MARCADOR' } })])
    const cur = await current(app, adm, 'afiliados.saques')
    expect((await put(app, adm, 'afiliados.saques', [{ ...cur.value[0], amount: 1, decidedBy: 'OUTRA' }], cur.version)).statusCode).toBe(403)
    expect((await put(app, adm, 'afiliados.saques', [], cur.version)).statusCode).toBe(403)
    const dump = await dumpDatabase(app)
    for (const marker of ['4321.87', 'DECISOR-MARCADOR', 'TITULAR-MARCADOR']) expect(dump, marker).toContain(marker)
  })
})

// ---------- r2-generic-kv-financial-records-7: campanhas ----------

describe('kv: valores de recompensa das campanhas validados no servidor; registros de concessão protegidos', () => {
  let app: FastifyInstance
  let mk: { cookie: string }
  let mo: { cookie: string }
  const coupon = (p: Row = {}) => ({
    id: 'c1',
    code: 'VIP-POC7',
    reward: 'bonus_pct',
    value: 100,
    maxBonus: 500,
    rollover: 10,
    maxUses: 100,
    perPlayer: 1,
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2099-01-01T00:00:00.000Z',
    audience: 'todos',
    minDeposit: 20,
    paused: false,
    uses: 0,
    createdAt: '2001-01-01T00:00:00.000Z',
    createdBy: 'Daniel Carius',
    ...p,
  })
  const cashback = () => ({
    cashback: { enabled: true, mode: 'fixo', pct: 5, period: 'semanal', minLoss: 50, cap: 2000, categories: ['slots'], rollover: 1, creditWeekday: 1, creditMonthDay: 1, creditHour: '10:00', claim: 'automatico', claimDays: 7 },
    rakeback: { enabled: true, pct: { slots: 0.5, ao_vivo: 0.2, crash: 0.3, mesa: 0.2, instantaneo: 0.3, bingo: 0.3, esportes: 0.4 }, frequency: 'diario', minPayout: 1 },
  })
  const bonus = (p: Row = {}) => ({
    id: 'b1',
    name: 'Boas-vindas',
    active: true,
    bonusPct: 100,
    minDeposit: 10,
    maxBonus: 500,
    rollover: 10,
    rolloverBase: 'bonus',
    usage: 'uma_vez',
    depositTrigger: 'primeiro',
    validityDays: 30,
    ...p,
  })

  beforeAll(async () => {
    app = await createTestApp()
    mk = await loginAs(app, 'marketing', { name: 'Marta Marketing' })
    mo = await loginAs(app, 'marketing-oficial', { totp: true, name: 'Otávio Oficial' })
  })
  afterAll(async () => app.close())

  it("cupons: 'marketing' não grava cupom fora das regras; o válido entra com usos, data e autor do servidor", async () => {
    for (const p of [
      { value: 100_000, maxBonus: 0, rollover: 0, perPlayer: 1_000_000 },
      { value: 600 },
      { rollover: 101 },
      { reward: 'free_spins', value: 1.5 },
      { code: '-AB' },
      { minDeposit: 0 },
      { endsAt: '2025-01-01T00:00:00.000Z' },
      { maxUses: 10, perPlayer: 20 },
    ]) {
      const r = await put(app, mk.cookie, 'campanhas.cupons', [coupon(p)], 0)
      expect(r.statusCode, JSON.stringify(p)).toBe(400)
    }
    const ok = await put(app, mk.cookie, 'campanhas.cupons', [coupon({ uses: 50 })], 0)
    expect(ok.statusCode, ok.body).toBe(200)
    const [c] = await storedPlain(app, 'campanhas.cupons')
    expect(c).toMatchObject({ uses: 0, createdBy: 'Marta Marketing' })
    expect(c.createdAt).not.toBe('2001-01-01T00:00:00.000Z')
    // código repetido (sem diferenciar maiúsculas) → 400
    expect((await put(app, mk.cookie, 'campanhas.cupons', [c, coupon({ id: 'c2', code: 'vip-poc7' })], 1)).statusCode).toBe(400)
    // alteração de valor auditada com antes → depois
    expect((await put(app, mk.cookie, 'campanhas.cupons', [{ ...c, value: 200, maxBonus: 800 }], 1)).statusCode).toBe(200)
    expect((await audits(app, 'campanhas.cupons%')).at(-1)!.summary).toBe('campanhas.cupons — VIP-POC7 (c1): value: 100 → 200, maxBonus: R$ 500,00 → R$ 800,00 (v1→v2)')
  })

  it("cashback e bônus de depósito: 'marketing-oficial' não grava fora dos limites", async () => {
    const evil = cashback()
    Object.assign(evil.cashback, { pct: 5000, cap: 0, rollover: 0 })
    evil.rakeback.pct.slots = 400
    expect((await put(app, mo.cookie, 'campanhas.cashback', evil, 0)).statusCode).toBe(400)
    const rake = cashback()
    rake.rakeback.pct.slots = 6
    expect((await put(app, mo.cookie, 'campanhas.cashback', rake, 0)).statusCode).toBe(400)
    expect((await put(app, mo.cookie, 'campanhas.cashback', cashback(), 0)).statusCode).toBe(200)

    for (const p of [{ bonusPct: 100_000, maxBonus: 0, rollover: 0 }, { maxBonus: 0 }, { bonusPct: 0 }, { rollover: 200 }, { validityDays: 0 }, { maxBonus: 5 }]) {
      const r = await put(app, mo.cookie, 'campanhas.bonus-deposito', [bonus(p)], 0)
      expect(r.statusCode, JSON.stringify(p)).toBe(400)
    }
    const ok = await put(app, mo.cookie, 'campanhas.bonus-deposito', [bonus({ redemptions: 999, bonusGranted: 1e6, updatedBy: 'Daniel Carius' })], 0)
    expect(ok.statusCode, ok.body).toBe(200)
    expect((await storedPlain(app, 'campanhas.bonus-deposito'))[0]).toMatchObject({ redemptions: 0, bonusGranted: 0, updatedBy: 'Otávio Oficial' })
  })

  it('resgates e giros são só do servidor; compras só mudam de status; concessão de free spins montada pelo servidor', async () => {
    const fake = [{ id: 'r1', couponId: 'c1', playerId: 'p-1', cost: 0.01, at: '2026-10-01T00:00:00.000Z' }]
    for (const key of ['campanhas.cupons.resgates', 'campanhas.roleta.giros']) {
      expect((await put(app, mk.cookie, key, fake, 0)).statusCode, key).toBe(403)
      expect((await put(app, mk.cookie, key, [], 0)).statusCode, key).toBe(403)
    }
    // compras da loja (vêm da plataforma)
    await seed(app, 'campanhas.loja.compras', [{ id: 'k1', itemName: 'Item', playerId: 'p1', playerEmail: 'p1@x.com', price: 500, valueBrl: 10, status: 'pendente' }])
    let cur = await current(app, mo.cookie, 'campanhas.loja.compras')
    expect((await put(app, mo.cookie, 'campanhas.loja.compras', [], cur.version)).statusCode).toBe(403)
    expect((await put(app, mo.cookie, 'campanhas.loja.compras', [{ ...cur.value[0], price: 1 }], cur.version)).statusCode).toBe(403)
    expect((await put(app, mo.cookie, 'campanhas.loja.compras', [{ ...cur.value[0], status: 'estornada' }], cur.version)).statusCode).toBe(200)
    cur = await current(app, mo.cookie, 'campanhas.loja.compras')
    expect((await put(app, mo.cookie, 'campanhas.loja.compras', [{ ...cur.value[0], status: 'entregue' }], cur.version)).json().error.code).toBe('transicao_nao_permitida')
    // concessão manual de free spins
    await seed(app, 'geral.jogadores', [
      { id: 'p1', name: 'Jogador Um', email: 'p1@x.com', status: 'ativo' },
      { id: 'p2', name: 'Autoexcluído', email: 'p2@x.com', status: 'autoexcluido' },
    ])
    expect((await put(app, mo.cookie, 'campanhas.free-spins', [{ id: 'fs1', name: 'Giros', gameId: 'g1', spinValue: 0.2, validityDays: 7 }], 0)).statusCode).toBe(200)
    const grant = (p: Row) => ({ id: 'FS1', campaignId: 'fs1', playerId: 'p1', spins: 50, note: 'Compensação', spinValue: 100, used: 0, winnings: 9999, grantedBy: 'Daniel Carius', ...p })
    for (const p of [{ playerId: 'p2' }, { playerId: 'p9' }, { campaignId: 'nao' }, { spins: 5000 }, { note: '' }]) {
      const r = await put(app, mo.cookie, 'campanhas.free-spins.concessoes', [grant(p)], 0)
      expect(r.statusCode, JSON.stringify(p)).toBe(400)
    }
    const g = await put(app, mo.cookie, 'campanhas.free-spins.concessoes', [grant({})], 0)
    expect(g.statusCode, g.body).toBe(200)
    const [fs] = await storedPlain(app, 'campanhas.free-spins.concessoes')
    expect(fs).toMatchObject({ spins: 50, spinValue: 0.2, used: 0, winnings: 0, status: 'ativa', origin: 'manual', grantedBy: 'Otávio Oficial', playerName: 'Jogador Um' })
    expect((await put(app, mo.cookie, 'campanhas.free-spins.concessoes', [{ ...fs, spins: 500 }], 1)).statusCode).toBe(403)
    expect((await put(app, mo.cookie, 'campanhas.free-spins.concessoes', [], 1)).statusCode).toBe(403)
    expect((await put(app, mo.cookie, 'campanhas.free-spins.concessoes', [{ ...fs, status: 'cancelada', note: 'Cancelado: erro' }], 1)).statusCode).toBe(200)
  })
})

// ---------- r2-generic-kv-financial-records-8: verificações de domínio ----------

describe('kv: quem só vê Domínios inclui uma verificação nova, sem reescrever o histórico', () => {
  let app: FastifyInstance
  let root: string
  let viewer: string
  const KEY = 'config.dominios.verificacoes'
  const outage = [{ id: 'chk-1', at: '2026-10-09T10:00:00.000Z', by: 'Verificação automática', results: [{ host: 'x2win.bet.br', dnsOk: false, httpStatus: 503, latencyMs: 0 }] }]
  const fake = { id: 'chk-x', at: '2026-10-09T10:00:00.000Z', by: 'Daniel Carius', results: [{ host: 'x2win.bet.br', dnsOk: true, httpStatus: 200, latencyMs: 1 }] }

  beforeAll(async () => {
    app = await createTestApp()
    root = (await loginAs(app, 'superadmin', { name: 'Daniel Carius' })).cookie
    await role(app, 'so-ver-dominios', ['dominios.ver'])
    viewer = (await loginAs(app, 'so-ver-dominios', { name: 'Visualizador' })).cookie
    // verificação automática (gravada pelo servidor) com uma queda
    await seed(app, KEY, outage)
    expect(root).toBeTruthy()
  })
  afterAll(async () => app.close())

  it('substituir o histórico ou alterar uma verificação gravada → 403; a queda registrada continua', async () => {
    const cur = await current(app, viewer, KEY)
    const r = await put(app, viewer, KEY, [fake], cur.version)
    expect(r.statusCode, 'cargo só com dominios.ver conseguiu substituir o histórico de verificações').toBe(403)
    expect(r.json().error.code).toBe('campo_nao_permitido')
    expect((await put(app, viewer, KEY, [{ ...cur.value[0], results: fake.results }], cur.version)).statusCode).toBe(403)
    expect((await put(app, viewer, KEY, [fake, { ...cur.value[0], results: fake.results }], cur.version)).statusCode).toBe(403)
    expect((await put(app, viewer, KEY, [], cur.version)).statusCode).toBe(400)
    expect((await storedPlain(app, KEY)).map((c) => c.id)).toEqual([outage[0].id])
  })

  it('a verificação nova entra no início com id, data e autor do servidor; as anteriores ficam', async () => {
    const cur = await current(app, viewer, KEY)
    const r = await put(app, viewer, KEY, [fake, ...cur.value], cur.version)
    expect(r.statusCode, r.body).toBe(200)
    const stored = await storedPlain(app, KEY)
    expect(stored.map((c) => c.id)).toEqual([expect.stringMatching(/^chk-\d+$/), 'chk-1'])
    expect(stored[0]).toMatchObject({ by: 'Visualizador', results: fake.results })
    expect(stored[0].at).not.toBe(fake.at)
    expect((await audits(app, `${KEY}%`)).at(-1)!.summary).toContain('Verificação incluída: 1 de 1 endereços no ar (x2win.bet.br 200)')
  })

  it('instalação nova: só a verificação nova vira registro (o resto da lista do navegador é descartado)', async () => {
    const fresh = await createTestApp()
    try {
      const cookie = (await loginAs(fresh, 'superadmin', { name: 'Daniel Carius' })).cookie
      const r = await put(fresh, cookie, KEY, [fake, ...outage, { ...outage[0], id: 'chk-2' }])
      expect(r.statusCode, r.body).toBe(200)
      const stored = await storedPlain(fresh, KEY)
      expect(stored).toHaveLength(1)
      expect(stored[0]).toMatchObject({ by: 'Daniel Carius', results: fake.results })
    } finally {
      await fresh.close()
    }
  })
})

// ---------- r2-audit-forgery-attribution-5: leitura de dados pessoais em claro ----------

describe('kv: leitura da base com dados pessoais em claro fica na auditoria do servidor', () => {
  let app: FastifyInstance
  const PLAYERS = [0, 1, 2].map((i) => ({ id: `p${i}`, name: `Jogador ${i}`, cpf: `123.456.789-0${i}`, email: `j${i}@exemplo.com`, phone: `(11) 98888-000${i}`, status: 'ativo', tags: [], coins: 0 }))

  beforeAll(async () => {
    app = await createTestApp()
    await seed(app, 'geral.jogadores', PLAYERS)
  })
  afterAll(async () => app.close())

  const count = async (where: string, params: unknown[]) => (await app.db.one<{ n: number }>(`select count(*)::int as n from audit_log where ${where}`, params))?.n ?? 0

  it('Suporte (sem usuarios.ver-dados) recebe mascarado e não gera registro', async () => {
    const sup = await loginAs(app, 'suporte')
    const r = await get(app, sup.cookie, 'geral.jogadores')
    expect(r.json().value[0].cpf).not.toBe(PLAYERS[0].cpf)
    expect(await count('actor_id = $1', [sup.user.id])).toBe(0)
  })

  it("Administrador lê em claro e o servidor registra 'revelar' (uma vez por sessão no intervalo)", async () => {
    const adm = await loginAs(app, 'administrador', { name: 'Ana Administradora' })
    for (let i = 0; i < 6; i++) {
      const r = await get(app, adm.cookie, 'geral.jogadores')
      expect(r.json().value.map((p: Row) => p.cpf)).toEqual(PLAYERS.map((p) => p.cpf))
    }
    expect(await count(`actor_id = $1 and action = 'revelar' and source = 'servidor'`, [adm.user.id])).toBe(1)
    const [a] = await app.db.query<{ summary: string; entity: string }>(`select summary, entity from audit_log where actor_id = $1`, [adm.user.id])
    expect(a).toEqual({ entity: 'Dados · Usuários', summary: 'geral.jogadores — leitura com dados pessoais completos (3 registros)' })
  })
})

// ---------- r2-api-mode-seed-fallback-1 / -2: dados de demonstração não viram registro de produção ----------

describe('kv: instalação nova — a lista mandada pela tela não vira base de produção', () => {
  let app: FastifyInstance
  let sup: string
  let root: string

  beforeAll(async () => {
    app = await createTestApp()
    sup = (await loginAs(app, 'suporte', { name: 'Suporte PoC' })).cookie
    root = (await loginAs(app, 'superadmin', { name: 'Daniel Carius' })).cookie
  })
  afterAll(async () => app.close())

  it('jogadores: Suporte e Superadmin não instalam uma base enviada pela tela (sem versão)', async () => {
    const fakeBase = Array.from({ length: 340 }, (_, i) => ({ id: String(100000 + i), name: `Jogador ${i}`, cpf: '45775693010', email: `j${i}@yahoo.com.br`, status: i === 231 ? 'autoexcluido' : 'ativo', balanceReal: 500, tags: [] }))
    for (const cookie of [sup, root]) {
      const r = await api(app, 'PUT', '/api/kv/geral.jogadores', { cookie, body: { value: fakeBase } })
      expect(r.statusCode).toBe(403)
      expect(r.json().error.code).toBe('campo_nao_permitido')
    }
    expect(await app.db.one('select 1 from kv_store where key = $1', ['geral.jogadores'])).toBeNull()
  })

  it('extrato: "base" forjada (crédito de R$ 250.000 de outro autor) e seed + crédito acima do teto são recusados', async () => {
    const forged = [{ id: 'TX900001', type: 'credito_manual', amount: 250000, playerId: '100231', by: 'Daniel Carius', at: '2025-12-01T10:00:00Z', balanceAfter: 250000 }]
    const r = await api(app, 'PUT', '/api/kv/geral.transacoes', { cookie: sup, body: { value: forged } })
    expect(r.statusCode).toBeGreaterThanOrEqual(400)
    const seedTx = Array.from({ length: 20 }, (_, i) => ({ id: `T${i}`, type: 'deposito', amount: 10, playerId: '100001', at: '2026-01-01T00:00:00Z' }))
    const manual = { id: 'TXNEW1', type: 'credito_manual', amount: 9000, playerId: '100001', wallet: 'real', reference: 'MAN-1' }
    const s = await api(app, 'PUT', '/api/kv/geral.transacoes', { cookie: sup, body: { value: [manual, ...seedTx] } })
    expect(s.statusCode).toBeGreaterThanOrEqual(400)
    expect(await app.db.one('select 1 from kv_store where key = $1', ['geral.transacoes'])).toBeNull()
  })

  it('saques de afiliados, depósitos e apurações de demonstração não são gravados pela tela', async () => {
    const seedPayouts = [payout('SA48210', { decidedBy: 'Daniel Carius', status: 'pago' }), payout('SA48211')]
    expect((await api(app, 'PUT', '/api/kv/afiliados.saques', { cookie: root, body: { value: seedPayouts } })).statusCode).toBe(403)
    // pagar um pedido que só existe no navegador → 404
    expect((await post(app, root, '/api/kv/afiliados.saques/SA48211/pay')).statusCode).toBe(404)
    expect((await api(app, 'PUT', '/api/kv/operacao.depositos', { cookie: root, body: { value: [{ id: 'd1', amount: 1, status: 'pago' }] } })).statusCode).toBe(403)
    const paidSeed = [{ id: 'g1', month: '2026-01', providerId: 'p', providerName: 'P', bets: 1, wins: 0, ggr: 1, feePct: 10, status: 'paga', dueDate: '2026-02-10T12:00:00Z', paidBy: 'Daniel Carius', paymentRef: 'TED-123456' }]
    expect((await api(app, 'PUT', '/api/kv/crescimento.ggr.apuracoes', { cookie: root, body: { value: paidSeed } })).statusCode).toBe(400)
    // afiliados da demonstração: saldo de comissão nunca vem da tela
    const gerente = (await loginAs(app, 'administrador')).cookie
    const w = await api(app, 'PUT', '/api/kv/crescimento.afiliados', { cookie: gerente, body: { value: [affiliate('a1', { balance: 13900 })] } })
    expect(w.statusCode, w.body).toBe(200)
    expect((await storedPlain(app, 'crescimento.afiliados'))[0].balance).toBe(0)
    expect(await app.db.query(`select key from kv_store where key in ('afiliados.saques', 'operacao.depositos', 'crescimento.ggr.apuracoes')`)).toEqual([])
  })
})

// ---------- r2-resource-exhaustion-3: chaves criadas à vontade ----------

describe('kv: cargo baixo não cria chaves novas nem grava valores enormes', () => {
  let app: FastifyInstance
  let mkt: { user: { id: string }; cookie: string }
  let sup: { cookie: string }

  beforeAll(async () => {
    app = await createTestApp()
    mkt = await loginAs(app, 'marketing')
    sup = await loginAs(app, 'suporte')
  })
  afterAll(async () => app.close())

  it('chave filha não registrada → 404 (nada gravado, nada na auditoria, nada para a equipe ler)', async () => {
    const before = (await app.db.one<{ n: number }>('select count(*)::int as n from audit_log where actor_id = $1', [mkt.user.id]))!.n
    for (let i = 0; i < 20; i++) {
      const r = await put(app, mkt.cookie, `campanhas.promocoes.v-${i}-${'z'.repeat(40)}`, { i }, undefined, '198.51.100.77')
      expect(r.statusCode).toBe(404)
    }
    expect((await app.db.one<{ n: number }>(`select count(*)::int as n from kv_store where key like 'campanhas.promocoes.%'`))!.n).toBe(0)
    expect((await app.db.one<{ n: number }>('select count(*)::int as n from audit_log where actor_id = $1', [mkt.user.id]))!.n).toBe(before)
    expect((await get(app, sup.cookie, `campanhas.promocoes.v-3-${'z'.repeat(40)}`)).statusCode).toBe(404)
    // a chave legítima continua gravável
    expect((await put(app, mkt.cookie, 'campanhas.promocoes', [{ id: 'p1', name: 'x' }], 0, '198.51.100.77')).statusCode).toBe(200)
  })

  it('valor acima do limite da chave → 413', async () => {
    const blob = randomBytes(3 * 1024 * 1024).toString('base64')
    const r = await put(app, mkt.cookie, 'campanhas.promocoes', { blob }, 1, '198.51.100.88')
    expect(r.statusCode).toBe(413)
    const s = await app.db.one<{ bytes: string }>(`select pg_column_size(value)::text as bytes from kv_store where key = 'campanhas.promocoes'`)
    expect(Number(s?.bytes)).toBeLessThan(10_000)
  })

  it('limite de gravações por pessoa, mesmo trocando de IP', async () => {
    let v = (await current(app, mkt.cookie, 'campanhas.promocoes')).version
    const codes: number[] = []
    for (let i = 0; i < 245; i++) {
      const r = await put(app, mkt.cookie, 'campanhas.promocoes', [{ id: 'p1', n: i }], v, `203.0.113.${i % 200}`)
      codes.push(r.statusCode)
      if (r.statusCode === 200) v = r.json().version
    }
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0)
  }, 60_000)
})

// ---------- apoio ao módulo de saques (r2-payout-flow-cross-module-3/-4) ----------

describe('kv: consultas para a decisão de pagamento (banimento e quem creditou)', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await createTestApp()
    await seed(app, 'geral.jogadores', [
      { id: 'p-ban', status: 'bloqueado' },
      { id: 'p-net', status: 'ativo' },
      { id: 'p-auto', status: 'autoexcluido' },
      { id: 'p-ok', status: 'ativo' },
    ])
    await seed(app, 'seguranca.bloqueios', [{ id: 'b1', kind: 'rede', value: 'rede-1', accounts: ['p-net'] }])
    await seed(app, 'geral.transacoes', [
      { id: 't1', type: 'credito_manual', playerId: 'p-ok', byId: 'u-1', at: new Date().toISOString() },
      { id: 't2', type: 'estorno', playerId: 'p-ok', byId: 'u-2', at: new Date().toISOString() },
      { id: 't3', type: 'credito_manual', playerId: 'p-ok', byId: 'u-3', at: '2020-01-01T00:00:00Z' },
      { id: 't4', type: 'aposta', playerId: 'p-ok', byId: 'u-4', at: new Date().toISOString() },
    ])
  })
  afterAll(async () => app.close())

  it('payoutHold segura banido e rede banida; autoexcluído e ativo seguem', async () => {
    await app.db.tx(async (t) => {
      expect(await payoutHold(t, app.cipher, 'p-ban')).toContain('bloqueada')
      expect(await payoutHold(t, app.cipher, 'p-net')).toContain('rede banida')
      expect(await payoutHold(t, app.cipher, 'p-auto')).toBeNull()
      expect(await payoutHold(t, app.cipher, 'p-ok')).toBeNull()
    })
  })

  it('manualCreditors devolve quem creditou ou estornou no período', async () => {
    const ids = await app.db.tx((t) => manualCreditors(t, app.cipher, 'p-ok', Date.now() - 30 * 86_400_000))
    expect([...ids].sort()).toEqual(['u-1', 'u-2'])
  })
})
