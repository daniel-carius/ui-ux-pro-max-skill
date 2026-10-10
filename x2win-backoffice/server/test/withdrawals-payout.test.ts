// Conferências do pagamento de saque (regressões das revisões de segurança):
//  - r1-logic-3: a aprovação automática não passa do teto de aprovação de quem grava as regras, e cargo que não
//    aprova saques não liga a aprovação automática; regras com casas decimais demais são recusadas;
//  - r2 payout chain (passo 1): a aprovação reconfere, na transação, o banimento do anti-fraude (status bloqueado
//    em geral.jogadores ou rede banida em seguranca.bloqueios) e as regras em vigor (máximo por saque e limite
//    diário de saques aprovados nas últimas 24 h). Jogador autoexcluído continua recebendo o saldo;
//  - r2 payout chain (passo 2): segregação de funções. Quem lançou crédito manual ou estorno para o jogador nos
//    últimos 30 dias não aprova o saque dele (outra pessoa aprova);
//  - r2 identity evidence: o saque decidido traz id e e-mail de quem decidiu (o nome pode repetir).
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_WITHDRAWAL_RULES, checkAutoApproveCeiling, validateWithdrawalRules } from '@shared/withdrawals'
import { newId } from '../src/lib/crypto'
import { RULES_SETTINGS_KEY } from '../src/modules/withdrawals/kv'
import { api, createTestApp, loginAs } from './helpers'

const RULES_KEY = '/api/kv/operacao.saques.regras'
const DAY = 86_400_000

async function insertWithdrawal(app: FastifyInstance, o: { playerId: string; amount: number; status?: string; risk?: string }) {
  const id = newId('SQ')
  await app.db.query(
    `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                              risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
     values ($1, $2, 'Jogador', 'j@x.com', $3, 0, $4, $5, 95, '[]'::jsonb, 'CPF', $6, 'E1', now(), now())`,
    [id, o.playerId, Math.round(o.amount * 100), o.status ?? 'pendente', o.risk ?? 'baixo', app.cipher.encrypt('12345678909')],
  )
  return id
}

/** Grava a chave direto no banco (cifrada), como a plataforma/importação deixaria. */
async function seedKv(app: FastifyInstance, key: string, value: unknown) {
  await app.db.query(
    `insert into kv_store (key, value, value_enc, version) values ($1, null, $2, 1)
     on conflict (key) do update set value = null, value_enc = excluded.value_enc, version = kv_store.version + 1`,
    [key, app.cipher.encrypt(JSON.stringify(value))],
  )
}

const player = (id: string, status = 'ativo') => ({ id, name: `Jogador ${id}`, email: `${id}@x.com`, status, balanceReal: 10_000, balanceBonus: 0, tags: [] })

async function setRules(app: FastifyInstance, rules: Partial<typeof DEFAULT_WITHDRAWAL_RULES>) {
  await app.db.query(
    `insert into settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`,
    [RULES_SETTINGS_KEY, JSON.stringify({ version: 1, rules: { ...DEFAULT_WITHDRAWAL_RULES, ...rules } })],
  )
}

const statusOf = async (app: FastifyInstance, id: string) => (await app.db.one<{ status: string }>('select status from withdrawals where id = $1', [id]))?.status
const paidOf = (app: FastifyInstance, id: string) =>
  app.db.query(`select id from webhook_outbox where event = 'saque.pago' and payload->'data'->>'id' = $1`, [id])
const approvalsOf = (app: FastifyInstance, id: string) => app.db.query(`select id from audit_log where entity = $1 and action = 'aprovar'`, [`Saque #${id}`])

/** SQL de cada transação (app.db.tx) que roda durante `fn`, em ordem, com os parâmetros. */
async function txLog<T>(app: FastifyInstance, fn: () => Promise<T>): Promise<{ result: T; log: { sql: string; params: unknown[] }[] }> {
  const db = app.db as unknown as { tx: <R>(f: (t: unknown) => Promise<R>) => Promise<R> }
  const orig = db.tx
  const log: { sql: string; params: unknown[] }[] = []
  db.tx = <R,>(f: (t: unknown) => Promise<R>) =>
    orig.call(db, async (t: unknown) => {
      const inner = t as { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }
      const wrapped = {
        ...(t as object),
        async query(sql: string, params?: unknown[]) {
          log.push({ sql: sql.replace(/\s+/g, ' ').trim(), params: params ?? [] })
          return inner.query(sql, params)
        },
        async one(sql: string, params?: unknown[]) {
          return ((await wrapped.query(sql, params)) as unknown[])[0] ?? null
        },
      }
      return f(wrapped)
    }) as Promise<R>
  try {
    return { result: await fn(), log }
  } finally {
    db.tx = orig
  }
}

async function addPaidDestination(app: FastifyInstance) {
  await app.db.query(`insert into webhook_destinations (id, event, url, active, secret_enc) values ($1, 'saque.pago', 'https://exemplo.com/pix', true, $2)`, [
    newId('wh'),
    app.cipher.encrypt('segredo-pix-producao'),
  ])
}

// ---------------------------------------------------------------------------
// r1-logic-3: aprovação automática x teto do cargo
// ---------------------------------------------------------------------------

describe('regras de saque: aprovação automática até o teto de quem grava (r1-logic-3)', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  async function save(cookie: string, patch: Record<string, unknown>) {
    const g = await api(app, 'GET', RULES_KEY, { cookie })
    expect(g.statusCode).toBe(200)
    const { value, version } = g.json() as { value: Record<string, unknown>; version: number }
    const put = await api(app, 'PUT', RULES_KEY, { cookie, body: { value: { ...value, ...patch }, version } })
    const after = (await api(app, 'GET', RULES_KEY, { cookie })).json().value as typeof DEFAULT_WITHDRAWAL_RULES
    return { put, after }
  }

  it('Financeiro (teto R$ 5.000) não liga aprovação automática até R$ 1 bilhão: 403 teto_excedido, nada gravado', async () => {
    const fin = await loginAs(app, 'financeiro')
    const { put, after } = await save(fin.cookie, { maxPerRequest: 1_000_000_000, autoApproveMax: 1_000_000_000 })
    expect(put.statusCode).toBe(403)
    expect(put.json().error.code).toBe('teto_excedido')
    expect(put.json().error.message).toContain('Financeiro')
    expect(put.json().error.details).toMatchObject({ ceiling: 5000, autoApproveMax: 1_000_000_000 })
    expect(after.autoApproveMax).toBe(0)
    expect(after.maxPerRequest).toBe(DEFAULT_WITHDRAWAL_RULES.maxPerRequest)
    expect(await app.db.query(`select id from audit_log where entity = 'Dados · Saques'`)).toHaveLength(0)
  })

  it('cargo com saques.editar e teto 0 (não aprova) não liga a aprovação automática', async () => {
    await app.db.query(`insert into roles (id, name, permissions, approval_ceiling_cents) values ('so-regras', 'Só regras', $1, 0)`, [['saques.ver', 'saques.editar']])
    const ed = await loginAs(app, 'so-regras')
    const { put, after } = await save(ed.cookie, { maxPerRequest: 50_000, autoApproveMax: 50_000 })
    expect(put.statusCode).toBe(403)
    expect(put.json().error.code).toBe('teto_excedido')
    expect(put.json().error.details).toMatchObject({ ceiling: 0 })
    expect(after.autoApproveMax).toBe(0)
    // as outras regras continuam editáveis por esse cargo
    const ok = await save(ed.cookie, { min: 30 })
    expect(ok.put.statusCode, ok.put.body).toBe(200)
    expect(ok.after.min).toBe(30)
  })

  it('cargo sem saques.aprovar (teto nulo) também não liga', async () => {
    await app.db.query(`insert into roles (id, name, permissions, approval_ceiling_cents) values ('regras-sem-aprovar', 'Regras sem aprovar', $1, null)`, [
      ['saques.ver', 'saques.editar'],
    ])
    const ed = await loginAs(app, 'regras-sem-aprovar')
    const { put } = await save(ed.cookie, { autoApproveMax: 100 })
    expect(put.statusCode).toBe(403)
    expect(put.json().error.details).toMatchObject({ ceiling: 0 })
  })

  it('até o próprio teto passa; valor gravado por quem pode é mantido por quem não pode; desligar sempre passa', async () => {
    const fin = await loginAs(app, 'financeiro')
    const atCeiling = await save(fin.cookie, { autoApproveMax: 5000 })
    expect(atCeiling.put.statusCode, atCeiling.put.body).toBe(200)
    expect(atCeiling.after.autoApproveMax).toBe(5000)

    const root = await loginAs(app, 'superadmin')
    const high = await save(root.cookie, { maxPerRequest: 20_000, autoApproveMax: 20_000 })
    expect(high.put.statusCode, high.put.body).toBe(200)

    // Financeiro mexe em outra regra: o teto alto gravado pelo Superadmin volta igual e é aceito
    const other = await save(fin.cookie, { fee: 1.5 })
    expect(other.put.statusCode, other.put.body).toBe(200)
    expect(other.after).toMatchObject({ autoApproveMax: 20_000, fee: 1.5 })
    // mas não muda o teto alto para outro valor acima do dele
    const lower = await save(fin.cookie, { autoApproveMax: 15_000 })
    expect(lower.put.statusCode).toBe(403)
    // e pode desligar
    const off = await save(fin.cookie, { autoApproveMax: 0 })
    expect(off.put.statusCode, off.put.body).toBe(200)
    expect(off.after.autoApproveMax).toBe(0)
  })

  it('checkAutoApproveCeiling e validateWithdrawalRules (shared)', () => {
    const fin = { name: 'Financeiro', permissions: ['saques.aprovar'], approvalCeiling: 5000 }
    const none = { name: 'Só regras', permissions: ['saques.editar'], approvalCeiling: null }
    const zero = { name: 'Zero', permissions: ['saques.aprovar'], approvalCeiling: 0 }
    const free = { name: 'Admin', permissions: ['saques.aprovar'], approvalCeiling: null }
    expect(checkAutoApproveCeiling(fin, 5000, 0).ok).toBe(true)
    expect(checkAutoApproveCeiling(fin, 5000.01, 0).ok).toBe(false)
    expect(checkAutoApproveCeiling(fin, 9000, 9000).ok).toBe(true) // mantém o gravado
    expect(checkAutoApproveCeiling(fin, 0, 9000).ok).toBe(true) // desliga
    expect(checkAutoApproveCeiling(none, 1, 0).ok).toBe(false)
    expect(checkAutoApproveCeiling(zero, 1, 0).ok).toBe(false)
    expect(checkAutoApproveCeiling(free, 1_000_000, 0).ok).toBe(true)

    const base = { ...DEFAULT_WITHDRAWAL_RULES }
    expect(validateWithdrawalRules(base)).toBeNull()
    expect(validateWithdrawalRules({ ...base, fee: 0.1 + 0.2 })).toBeNull() // 0,30 (ponto flutuante)
    expect(validateWithdrawalRules({ ...base, min: 19.99, fee: 19.98 })).toBeNull()
    expect(validateWithdrawalRules({ ...base, fee: 1.005 })).toMatch(/casas decimais/)
    expect(validateWithdrawalRules({ ...base, min: Number.NaN })).toMatch(/positivos/)
    expect(validateWithdrawalRules({ ...base, maxPerRequest: Number.POSITIVE_INFINITY })).toMatch(/positivos/)
    expect(validateWithdrawalRules({ ...base, autoApproveMax: base.maxPerRequest + 0.01 })).toMatch(/aprovação automática/)
    expect(validateWithdrawalRules({ ...base, dailyLimit: 0 })).toMatch(/limite diário/)
    expect(validateWithdrawalRules({ ...base, fee: base.min })).toMatch(/taxa/)
  })
})

// ---------------------------------------------------------------------------
// r2 payout chain, passo 1: banimento do anti-fraude e regras em vigor na aprovação
// ---------------------------------------------------------------------------

describe('aprovação reconfere anti-fraude e regras de saque (r2 payout chain, passo 1)', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
    await addPaidDestination(app)
    await seedKv(app, 'geral.jogadores', [player('p-ban', 'bloqueado'), player('p-rede'), player('p-auto', 'autoexcluido'), player('p-ok'), player('p-big')])
    await seedKv(app, 'seguranca.bloqueios', [
      {
        id: 'b1',
        kind: 'rede',
        value: 'rede-1',
        reason: 'Multicontas + bônus',
        accounts: ['p-rede'],
        previousStatuses: { 'p-rede': 'ativo' },
        createdAt: new Date().toISOString(),
        createdBy: 'Antifraude',
      },
    ])
  })
  afterAll(async () => app.close())

  it('jogador bloqueado pelo anti-fraude (em análise, risco alto): 409 jogador_bloqueado, nada pago nem auditado', async () => {
    const fin = await loginAs(app, 'financeiro')
    const w = await insertWithdrawal(app, { playerId: 'p-ban', amount: 4999, status: 'em_analise', risk: 'alto' })
    const r = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: fin.cookie })
    expect(r.statusCode).toBe(409)
    expect(r.json().error.code).toBe('jogador_bloqueado')
    expect(r.json().error.message).toContain('Conta bloqueada pelo anti-fraude')
    expect(await statusOf(app, w)).toBe('em_analise')
    expect(await paidOf(app, w)).toHaveLength(0)
    expect(await approvalsOf(app, w)).toHaveLength(0)
    // recusar continua possível (devolve o saldo; não paga)
    const rej = await api(app, 'POST', `/api/withdrawals/${w}/reject`, { cookie: fin.cookie, body: { reason: 'Conta banida pelo anti-fraude' } })
    expect(rej.statusCode).toBe(200)
  })

  it('conta de uma rede banida em seguranca.bloqueios (status ainda ativo): 409 jogador_bloqueado com a rede no motivo', async () => {
    const adm = await loginAs(app, 'administrador')
    const w = await insertWithdrawal(app, { playerId: 'p-rede', amount: 100 })
    const r = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: adm.cookie })
    expect(r.statusCode).toBe(409)
    expect(r.json().error).toMatchObject({ code: 'jogador_bloqueado', details: { reason: expect.stringContaining('rede-1') } })
    expect(await statusOf(app, w)).toBe('pendente')
    expect(await paidOf(app, w)).toHaveLength(0)
  })

  it('controle: autoexcluído continua recebendo o saldo', async () => {
    const fin = await loginAs(app, 'financeiro')
    const w = await insertWithdrawal(app, { playerId: 'p-auto', amount: 50 })
    const r = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: fin.cookie })
    expect(r.statusCode, r.body).toBe(200)
    expect(await paidOf(app, w)).toHaveLength(1)
  })

  it('máximo por saque e limite diário em vigor: acima do máximo → 409 fora_das_regras; o 2º aprovado em 24 h com limite 1 → 409', async () => {
    await setRules(app, { maxPerRequest: 100, dailyLimit: 1, autoApproveMax: 0, fee: 0, min: 20 })
    const adm = await loginAs(app, 'administrador') // sem teto: só as regras seguram
    const results: number[] = []
    for (const amount of [50_000, 40_000, 30_000]) {
      const w = await insertWithdrawal(app, { playerId: 'p-big', amount })
      const r = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: adm.cookie })
      results.push(r.statusCode)
      expect(r.json().error).toMatchObject({ code: 'fora_das_regras', details: { rule: 'maxPerRequest', limit: 100, amount } })
      expect(r.json().error.message).toContain('R$ 100,00')
      expect(await statusOf(app, w)).toBe('pendente')
    }
    expect(results).toEqual([409, 409, 409])

    const first = await insertWithdrawal(app, { playerId: 'p-ok', amount: 100 })
    expect((await api(app, 'POST', `/api/withdrawals/${first}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    const second = await insertWithdrawal(app, { playerId: 'p-ok', amount: 80 })
    const r = await api(app, 'POST', `/api/withdrawals/${second}/approve`, { cookie: adm.cookie })
    expect(r.statusCode).toBe(409)
    expect(r.json().error).toMatchObject({ code: 'fora_das_regras', details: { rule: 'dailyLimit', limit: 1, count: 1 } })
    expect(await statusOf(app, second)).toBe('pendente')
    expect(await paidOf(app, second)).toHaveLength(0)

    // aprovado há mais de 24 h não conta; recusado também não
    await app.db.query(`update withdrawals set updated_at = now() - interval '25 hours' where id = $1`, [first])
    const rejected = await insertWithdrawal(app, { playerId: 'p-ok', amount: 30, status: 'recusado' })
    expect(rejected).toBeTruthy()
    expect((await api(app, 'POST', `/api/withdrawals/${second}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
    await setRules(app, {})
  })

  // A corrida (duas aprovações de saques diferentes do mesmo jogador ao mesmo tempo, limite diário 1) só é exercitada
  // no PostgreSQL 16, em withdrawals-concurrency.test.ts: o PGlite tem uma conexão só e roda uma transação depois da
  // outra, então lá as duas aprovações "simultâneas" passavam no limite mesmo sem a trava. Aqui fica a ordem: a
  // aprovação pega a trava do jogador antes de travar o saque e antes de contar os aprovados das últimas 24 h.
  it('aprovação trava o jogador (pg_advisory_xact_lock por jogador) antes de travar o saque e de contar os aprovados do dia', async () => {
    const adm = await loginAs(app, 'administrador')
    const a = await insertWithdrawal(app, { playerId: 'p-trava', amount: 60 })
    const b = await insertWithdrawal(app, { playerId: 'p-trava', amount: 70 })
    const c = await insertWithdrawal(app, { playerId: 'p-outro', amount: 80 })
    const locks: unknown[][] = []
    for (const [w, playerId] of [[a, 'p-trava'], [b, 'p-trava'], [c, 'p-outro']]) {
      const { result, log } = await txLog(app, () => api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: adm.cookie }))
      expect(result.statusCode, result.body).toBe(200)
      const at = (prefix: string, param: unknown, i = 0) => log.findIndex((q) => q.sql.startsWith(prefix) && q.params[i] === param)
      const lock = at('select pg_advisory_xact_lock($1::int, hashtext($2::text))', playerId, 1)
      const rowLock = at('select * from withdrawals where id = $1 for update', w)
      const count = at('select count(*)::int as n from withdrawals where player_id = $1', playerId)
      expect(lock, `${w}: trava do jogador`).toBeGreaterThanOrEqual(0)
      expect(rowLock, `${w}: trava do saque`).toBeGreaterThan(lock)
      expect(count, `${w}: contagem do dia`).toBeGreaterThan(lock)
      locks.push(log[lock].params)
    }
    // mesma trava para os saques do mesmo jogador; outra para outro jogador
    expect(locks[0]).toEqual(locks[1])
    expect(locks[2]).not.toEqual(locks[0])
  })
})

// ---------------------------------------------------------------------------
// r2 payout chain, passo 2: segregação de funções (crédito manual + aprovação)
// ---------------------------------------------------------------------------

describe('segregação de funções: quem creditou o jogador não aprova o saque dele (r2 payout chain, passo 2)', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
    await seedKv(app, 'geral.jogadores', [player('p-a'), player('p-b'), player('p-c'), player('p-d')])
  })
  afterAll(async () => app.close())

  async function credit(cookie: string, playerId: string, amount: number, type = 'credito_manual') {
    const cur = await api(app, 'GET', '/api/kv/geral.transacoes', { cookie })
    expect(cur.statusCode).toBe(200)
    const list = (cur.json().value as unknown[] | null) ?? []
    const item = { id: newId('tx'), playerId, type, amount, wallet: 'real', reference: 'AJUSTE', note: 'ajuste' }
    return api(app, 'PUT', '/api/kv/geral.transacoes', { cookie, body: { value: [item, ...list], version: cur.json().version } })
  }

  it('Administrador que creditou o jogador recebe 403 segregacao_funcoes; outra pessoa aprova o mesmo saque', async () => {
    const adm = await loginAs(app, 'administrador', { name: 'Adm Credita' })
    const c = await credit(adm.cookie, 'p-a', 5000)
    expect(c.statusCode, c.body).toBe(200)
    const ledger = (await app.db.one<{ value_enc: string }>(`select value_enc from kv_store where key = 'geral.transacoes'`))!
    const tx = (JSON.parse(app.cipher.decrypt(ledger.value_enc)) as { playerId: string; byId: string }[]).find((t) => t.playerId === 'p-a')!
    expect(tx.byId).toBe(adm.user.id) // autor gravado pelo servidor

    const w = await insertWithdrawal(app, { playerId: 'p-a', amount: 5000 })
    const ap = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: adm.cookie })
    expect(ap.statusCode).toBe(403)
    expect(ap.json().error).toMatchObject({
      code: 'segregacao_funcoes',
      message: 'Você lançou crédito manual para este jogador nos últimos 30 dias; outra pessoa precisa aprovar.',
    })
    expect(await statusOf(app, w)).toBe('pendente')
    expect(await approvalsOf(app, w)).toHaveLength(0)

    const other = await loginAs(app, 'administrador', { name: 'Adm Confere' })
    const ok = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: other.cookie })
    expect(ok.statusCode, ok.body).toBe(200)
    expect(ok.json().withdrawal).toMatchObject({ decidedBy: 'Adm Confere', decidedById: other.user.id, decidedByEmail: other.user.email })
  })

  it('estorno lançado pela pessoa também conta; débito manual não', async () => {
    const adm = await loginAs(app, 'administrador')
    await seedKv(app, 'geral.transacoes', [
      { id: 'tx-est', playerId: 'p-b', type: 'estorno', amount: 300, byId: adm.user.id, by: 'Adm', at: new Date(Date.now() - 2 * DAY).toISOString() },
      { id: 'tx-deb', playerId: 'p-c', type: 'debito_manual', amount: -1, byId: adm.user.id, by: 'Adm', at: new Date().toISOString() },
    ])
    const wb = await insertWithdrawal(app, { playerId: 'p-b', amount: 300 })
    expect((await api(app, 'POST', `/api/withdrawals/${wb}/approve`, { cookie: adm.cookie })).json().error.code).toBe('segregacao_funcoes')
    const wc = await insertWithdrawal(app, { playerId: 'p-c', amount: 300 })
    expect((await api(app, 'POST', `/api/withdrawals/${wc}/approve`, { cookie: adm.cookie })).statusCode).toBe(200)
  })

  it('crédito com mais de 30 dias não bloqueia; o de 29 dias bloqueia', async () => {
    const fin = await loginAs(app, 'financeiro')
    await seedKv(app, 'geral.transacoes', [
      { id: 'tx-velho', playerId: 'p-d', type: 'credito_manual', amount: 100, byId: fin.user.id, by: 'Fin', at: new Date(Date.now() - 31 * DAY).toISOString() },
    ])
    const w1 = await insertWithdrawal(app, { playerId: 'p-d', amount: 100 })
    expect((await api(app, 'POST', `/api/withdrawals/${w1}/approve`, { cookie: fin.cookie })).statusCode).toBe(200)
    await seedKv(app, 'geral.transacoes', [
      { id: 'tx-recente', playerId: 'p-d', type: 'credito_manual', amount: 100, byId: fin.user.id, by: 'Fin', at: new Date(Date.now() - 29 * DAY).toISOString() },
    ])
    const w2 = await insertWithdrawal(app, { playerId: 'p-d', amount: 100 })
    const r = await api(app, 'POST', `/api/withdrawals/${w2}/approve`, { cookie: fin.cookie })
    expect(r.statusCode).toBe(403)
    expect(r.json().error.code).toBe('segregacao_funcoes')
  })
})

// ---------------------------------------------------------------------------
// r2 identity evidence: id e e-mail de quem decidiu
// ---------------------------------------------------------------------------

describe('saque decidido traz id e e-mail de quem decidiu', () => {
  it('aprovar/recusar e a lista operacao.saques: decidedBy, decidedById e decidedByEmail (homônimos distinguíveis)', async () => {
    const app = await createTestApp()
    const a = await loginAs(app, 'administrador', { name: 'Maria Silva' })
    const b = await loginAs(app, 'administrador', { name: 'Maria Silva' })
    const w1 = await insertWithdrawal(app, { playerId: 'p1', amount: 10 })
    const w2 = await insertWithdrawal(app, { playerId: 'p2', amount: 20 })
    const open = await insertWithdrawal(app, { playerId: 'p3', amount: 30 })
    const r1 = await api(app, 'POST', `/api/withdrawals/${w1}/approve`, { cookie: a.cookie })
    expect(r1.json().withdrawal).toMatchObject({ decidedBy: 'Maria Silva', decidedById: a.user.id, decidedByEmail: a.user.email })
    const r2 = await api(app, 'POST', `/api/withdrawals/${w2}/reject`, { cookie: b.cookie, body: { reason: 'Documento divergente' } })
    expect(r2.json().withdrawal).toMatchObject({ decidedBy: 'Maria Silva', decidedById: b.user.id, decidedByEmail: b.user.email })

    const list = (await api(app, 'GET', '/api/kv/operacao.saques', { cookie: a.cookie })).json().value as Record<string, unknown>[]
    expect(list.find((w) => w.id === w1)).toMatchObject({ decidedById: a.user.id, decidedByEmail: a.user.email })
    expect(list.find((w) => w.id === w2)).toMatchObject({ decidedById: b.user.id, decidedByEmail: b.user.email })
    expect(list.find((w) => w.id === open)).toMatchObject({ decidedBy: null, decidedById: null, decidedByEmail: null })
    await app.close()
  })
})
