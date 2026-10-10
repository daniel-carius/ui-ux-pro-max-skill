// Regressões das pendências entre áreas da revisão adversarial (área kv):
// auditoria do servidor para Modo de ataque/Manutenção/Empresa, dados de pagamento
// de afiliados em claro só por registro, visões da base de jogadores para telas sem
// a lista inteira, regras de status compartilhadas, limite de corpo das rotas de
// dados, limites das campanhas no servidor e dados de demonstração (DEMO_DATA).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { findKvRule, KV_BODY_LIMIT, KV_DEFAULT_MAX_BYTES } from '@shared/kv-registry'
import { canChangeStatus, isPlayerRequestedReason, STATUS_TRANSITIONS } from '@shared/players'
import { seedAffiliateWithdrawals } from '@/data/afiliados'
import { seedTeam } from '@/data/team'
import { DEMO_KEYS, DEMO_STAFF_LABEL, demoCpf, demoEmail, demoIp, demoize, demoPhone, seedDemo } from '../src/modules/kv/demo-seed'
import { buildMetrics, cashbackRulesOf, DEFAULT_CASHBACK_RULES, DEFAULT_LEVEL_CASHBACK, levelCashbackOf } from '../src/modules/kv/player-projections'
import { STATUS_TRANSITIONS as SERVER_TRANSITIONS, isPlayerRequestedReason as serverIsPlayerRequested } from '../src/modules/kv/player-status'
import kvRoutes from '../src/modules/kv/routes'
import { encryptAtRest, loadRow, saveRow } from '../src/modules/kv/store'
import { api, createTestApp, loginAs } from './helpers'

// ---------- utilitários ----------

type Row = Record<string, unknown>

const put = (app: FastifyInstance, cookie: string, key: string, value: unknown, version?: number) =>
  api(app, 'PUT', `/api/kv/${key}`, { cookie, body: version === undefined ? { value } : { value, version } })
const get = (app: FastifyInstance, cookie: string, key: string) => api(app, 'GET', `/api/kv/${key}`, { cookie })
const post = (app: FastifyInstance, cookie: string, url: string, body?: unknown) => api(app, 'POST', url, { cookie, body })

async function current(app: FastifyInstance, cookie: string, key: string) {
  const r = await get(app, cookie, key)
  expect(r.statusCode, `${key}: ${r.body}`).toBe(200)
  return r.json() as { value: any; version: number; stored: boolean }
}

async function storedPlain<T = Row[]>(app: FastifyInstance, key: string): Promise<T> {
  const r = await app.db.one<{ value: unknown; value_enc: string | null }>('select value, value_enc from kv_store where key = $1', [key])
  return (r?.value_enc ? JSON.parse(app.cipher.decrypt(r.value_enc)) : r?.value) as T
}

/** Grava a chave direto no banco, como a plataforma (cifrada conforme a regra). */
async function seed(app: FastifyInstance, key: string, value: unknown) {
  const rule = findKvRule(key)!
  await app.db.tx(async (t) => {
    const row = await loadRow(t, key, true)
    await saveRow(t, app.cipher, key, value, encryptAtRest(rule), row, 'plataforma')
  })
}

async function customRole(app: FastifyInstance, id: string, permissions: string[]) {
  await app.db.query('insert into roles (id, name, permissions) values ($1, $2, $3)', [id, `Cargo ${id}`, permissions])
  return (await loginAs(app, id)).cookie
}

interface AuditRow {
  id: number
  actor_id: string | null
  actor_name: string
  action: string
  entity: string
  summary: string
  source: string
}
const auditsAfter = (app: FastifyInstance, id: number) =>
  app.db.query<AuditRow>('select id, actor_id, actor_name, action, entity, summary, source from audit_log where id > $1 order by id', [id])
const lastAuditId = async (app: FastifyInstance) => (await app.db.one<{ id: number | null }>('select max(id) as id from audit_log'))?.id ?? 0

const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()

// ---------- 1. auditoria semântica: Modo de ataque, Manutenção e Empresa ----------

describe('kv: Modo de ataque, Manutenção e Empresa ficam na auditoria do servidor com ação e entidade próprias', () => {
  let app: FastifyInstance
  let admin: { cookie: string; user: { id: string } }
  const attack = (p: Row = {}) => ({ active: false, since: null, activatedBy: null, autoOffMinutes: 120, lowerLimits: true, closeSignups: false, captcha: true, ...p })
  const maint = (p: Row = {}) => ({ active: false, message: 'Voltamos em breve.', returnAt: null, bypassToken: 'link-secreto-AAA111', since: null, ...p })

  beforeAll(async () => {
    app = await createTestApp()
    admin = await loginAs(app, 'superadmin', { name: 'Ana Operadora' })
  })
  afterAll(async () => app.close())

  it("modo de ataque: ligar e desligar viram 'ligar'/'desligar' em \"Modo de ataque\"; quem ligou e desde quando vêm do servidor", async () => {
    const mark = await lastAuditId(app)
    const on = await put(app, admin.cookie, 'seguranca.modo-ataque', attack({ active: true, since: '2020-01-01T00:00:00.000Z', activatedBy: 'Daniel Carius' }))
    expect(on.statusCode, on.body).toBe(200)
    const v1 = on.json().value
    expect(v1.activatedBy).toBe('Ana Operadora')
    expect(Math.abs(Date.parse(v1.since) - Date.now())).toBeLessThan(60_000)

    // mudar opções com o modo ligado: 'editar' na mesma entidade; quem ligou e desde quando não mudam
    const edit = await put(app, admin.cookie, 'seguranca.modo-ataque', { ...v1, autoOffMinutes: 60, since: '2020-01-01T00:00:00.000Z', activatedBy: 'Outra Pessoa' }, 1)
    expect(edit.statusCode, edit.body).toBe(200)
    expect(edit.json().value).toMatchObject({ since: v1.since, activatedBy: 'Ana Operadora', autoOffMinutes: 60 })

    const off = await put(app, admin.cookie, 'seguranca.modo-ataque', { ...edit.json().value, active: false }, 2)
    expect(off.statusCode, off.body).toBe(200)
    expect(off.json().value).toMatchObject({ active: false, since: null, activatedBy: null })

    const rows = await auditsAfter(app, mark)
    // uma linha por gravação, nenhuma "Dados · Modo de ataque"
    expect(rows.map((r) => [r.action, r.entity, r.source, r.actor_id])).toEqual([
      ['ligar', 'Modo de ataque', 'servidor', admin.user.id],
      ['editar', 'Modo de ataque', 'servidor', admin.user.id],
      ['desligar', 'Modo de ataque', 'servidor', admin.user.id],
    ])
    expect(rows[0].summary).toBe('seguranca.modo-ataque — Ligado com limites de acesso menores, verificação anti-robô; desliga sozinho após 2 h (v0→v1)')
    expect(rows[1].summary).toBe('seguranca.modo-ataque — Campos alterados: autoOffMinutes (v1→v2)')
    expect(rows[2].summary).toMatch(/^seguranca\.modo-ataque — Desligado após \d+ min \(ligado por Ana Operadora\) \(v2→v3\)$/)
  })

  it("manutenção: 'ligar'/'desligar'/'editar' em \"Manutenção\"; o link de testes nunca vai para a auditoria", async () => {
    const mark = await lastAuditId(app)
    const first = await put(app, admin.cookie, 'config.manutencao', maint())
    expect(first.statusCode, first.body).toBe(200)
    const token = await put(app, admin.cookie, 'config.manutencao', maint({ bypassToken: 'link-secreto-BBB222' }), 1)
    expect(token.statusCode).toBe(200)
    const returnAt = iso(Date.UTC(2099, 0, 2, 15, 30))
    const on = await put(app, admin.cookie, 'config.manutencao', maint({ bypassToken: 'link-secreto-BBB222', active: true, returnAt, since: '2020-01-01T00:00:00.000Z' }), 2)
    expect(on.statusCode, on.body).toBe(200)
    expect(Math.abs(Date.parse(on.json().value.since) - Date.now())).toBeLessThan(60_000)
    const off = await put(app, admin.cookie, 'config.manutencao', { ...on.json().value, active: false }, 3)
    expect(off.statusCode).toBe(200)
    expect(off.json().value.since).toBeNull()

    const rows = await auditsAfter(app, mark)
    expect(rows.map((r) => [r.action, r.entity])).toEqual([
      ['editar', 'Manutenção'],
      ['editar', 'Manutenção'],
      ['ligar', 'Manutenção'],
      ['desligar', 'Manutenção'],
    ])
    expect(rows[1].summary).toBe('config.manutencao — Campos alterados: bypassToken (v1→v2)')
    expect(rows[2].summary).toBe('config.manutencao — Site fechado para manutenção. Previsão de volta: 02/01/2099, 12:30 (v2→v3)')
    expect(rows[3].summary).toMatch(/^config\.manutencao — Site reaberto após \d+ min \(v3→v4\)$/)
    for (const r of rows) expect(r.summary).not.toContain('link-secreto')
  })

  it('a tela de Manutenção acha o "fechado por" na linha do servidor (última ligar)', async () => {
    const lastOn = await app.db.one<AuditRow>(`select * from audit_log where entity = 'Manutenção' and action = 'ligar' and source = 'servidor' order by id desc limit 1`)
    expect(lastOn?.actor_name).toBe('Ana Operadora')
  })

  it('o link de testes da manutenção (bypassToken) só sai para quem vê a tela Manutenção', async () => {
    // a barra do topo de todos mostra o estado; o link abre o site fechado e fica só com a tela
    for (const role of ['marketing', 'suporte', 'financeiro']) {
      const { cookie } = await loginAs(app, role)
      const r = await get(app, cookie, 'config.manutencao')
      expect(r.statusCode, role).toBe(200)
      expect(Object.keys(r.json().value).sort(), role).toEqual(['active', 'message', 'returnAt', 'since'])
      expect(r.json().value, role).toMatchObject({ active: false, message: 'Voltamos em breve.', since: null })
      expect(r.body, role).not.toContain('link-secreto')
    }
    const viewer = await customRole(app, 'so-manutencao', ['manutencao.ver'])
    expect((await current(app, viewer, 'config.manutencao')).value.bypassToken).toBe('link-secreto-BBB222')
    expect((await current(app, admin.cookie, 'config.manutencao')).value.bypassToken).toBe('link-secreto-BBB222')
  })

  it("empresa: 'editar' em \"Empresa e licença\" (uma linha, sem a linha genérica)", async () => {
    const mark = await lastAuditId(app)
    expect((await put(app, admin.cookie, 'config.empresa', { legalName: 'X2Win Ltda.', license: 'SPA/MF 1' })).statusCode).toBe(200)
    expect((await put(app, admin.cookie, 'config.empresa', { legalName: 'X2Win Ltda.', license: 'SPA/MF 2' }, 1)).statusCode).toBe(200)
    const rows = await auditsAfter(app, mark)
    expect(rows.map((r) => [r.action, r.entity, r.summary])).toEqual([
      ['editar', 'Empresa e licença', 'config.empresa — Primeira gravação. Campos: legalName, license (v0→v1)'],
      ['editar', 'Empresa e licença', 'config.empresa — Campos alterados: license (v1→v2)'],
    ])
  })

  it('estado sem "active" booleano → 400; nada gravado nem auditado', async () => {
    const fresh = await createTestApp()
    try {
      const { cookie } = await loginAs(fresh)
      const mark = await lastAuditId(fresh)
      for (const [key, value] of [
        ['seguranca.modo-ataque', { active: 'sim' }],
        ['config.manutencao', 'ligado'],
        ['seguranca.modo-ataque', [true]],
      ] as const) {
        const r = await put(fresh, cookie, key, value)
        expect(r.statusCode, `${key} ${JSON.stringify(value)}`).toBe(400)
      }
      expect(await fresh.db.query(`select key from kv_store where key in ('seguranca.modo-ataque', 'config.manutencao')`)).toEqual([])
      expect(await auditsAfter(fresh, mark)).toEqual([])
    } finally {
      await fresh.close()
    }
  })
})

// ---------- 2. dados de pagamento de afiliados: em claro só por registro ----------

describe('kv: chave PIX, dados bancários e e-mail de afiliados mascarados para todos; em claro só por registro, auditado', () => {
  let app: FastifyInstance
  let admin: { cookie: string; user: { id: string } }
  const base = {
    affiliateId: 'a1',
    affiliateName: 'João Souza',
    affiliateEmail: 'joao.souza@gmail.com',
    affiliateType: 'Influencer',
    amount: 1500,
    status: 'pendente',
    createdAt: '2026-09-01T10:00:00.000Z',
    decidedAt: null,
    decidedBy: null,
    reason: null,
    reference: null,
  }
  const TED = { ...base, id: 'w-ted', method: 'ted', pixKeyType: null, pixKey: null, bank: { bank: '341 · Itaú', agency: '1234', account: '98765-4', holder: 'João Souza' } }
  const PIX = { ...base, id: 'w-pix', method: 'pix', pixKeyType: 'CPF', pixKey: '12345678909', bank: null }
  const AFF = {
    id: 'a1',
    playerId: '',
    name: 'João Souza',
    email: 'joao.souza@gmail.com',
    type: 'Influencer',
    level: 1,
    managerId: null,
    code: 'JOAO1',
    cpa: 50,
    revShare: 0.2,
    status: 'ativo',
    balance: 300,
    pixKey: '98765432100',
    createdAt: '2026-01-01T00:00:00.000Z',
  }

  beforeAll(async () => {
    app = await createTestApp()
    admin = await loginAs(app, 'superadmin', { name: 'Ana Operadora' })
    await seed(app, 'afiliados.saques', [TED, PIX])
    await seed(app, 'crescimento.afiliados', [AFF])
  })
  afterAll(async () => app.close())

  it('lista mascarada até para quem tem ver-pix; POST …/:id/reveal devolve o pedido em claro e audita sem os valores', async () => {
    const [ted, pix] = (await current(app, admin.cookie, 'afiliados.saques')).value as Row[]
    expect(pix.pixKey).toBe('123.***.***-09')
    expect(ted.bank).toEqual({ bank: '341 · Itaú', agency: '••34', account: '•••65-4', holder: 'J*** S***' })
    const before = await lastAuditId(app)

    const r1 = await post(app, admin.cookie, '/api/kv/afiliados.saques/w-pix/reveal')
    expect(r1.statusCode, r1.body).toBe(200)
    expect(r1.headers['cache-control']).toBe('no-store')
    expect(r1.json()).toEqual({ ok: true, id: 'w-pix', affiliateId: 'a1', affiliateEmail: 'joao.souza@gmail.com', method: 'pix', pixKeyType: 'CPF', pixKey: '12345678909', bank: null })
    const r2 = await post(app, admin.cookie, '/api/kv/afiliados.saques/w-ted/reveal')
    expect(r2.json()).toEqual({
      ok: true,
      id: 'w-ted',
      affiliateId: 'a1',
      affiliateEmail: 'joao.souza@gmail.com',
      method: 'ted',
      pixKeyType: null,
      pixKey: null,
      bank: { bank: '341 · Itaú', agency: '1234', account: '98765-4', holder: 'João Souza' },
    })

    const rows = await auditsAfter(app, before)
    expect(rows.map((r) => [r.action, r.entity, r.source, r.actor_id])).toEqual([
      ['revelar', 'Saque de afiliado #w-pix', 'servidor', admin.user.id],
      ['revelar', 'Saque de afiliado #w-ted', 'servidor', admin.user.id],
    ])
    expect(rows[0].summary).toBe('afiliados.saques — dados de pagamento de João Souza (a1) vistos em claro: chave PIX (CPF), e-mail')
    expect(rows[1].summary).toBe('afiliados.saques — dados de pagamento de João Souza (a1) vistos em claro: dados bancários, e-mail')
    for (const r of rows) for (const secret of ['12345678909', '98765', '1234', 'joao.souza@']) expect(r.summary).not.toContain(secret)
  })

  it('sem ver-pix → 403; ver-pix sem ler a chave → 403; pedido inexistente → 404; nada auditado', async () => {
    const before = await lastAuditId(app)
    const viewer = await customRole(app, 'so-ver-saques', ['afiliados-saques.ver', 'afiliados-saques.aprovar'])
    const r1 = await post(app, viewer, '/api/kv/afiliados.saques/w-pix/reveal')
    expect(r1.statusCode).toBe(403)
    expect(r1.body).not.toContain('12345678909')
    const pixOnly = await customRole(app, 'so-ver-pix', ['afiliados-saques.ver-pix'])
    expect((await post(app, pixOnly, '/api/kv/afiliados.saques/w-pix/reveal')).statusCode).toBe(403)
    expect((await post(app, pixOnly, '/api/kv/crescimento.afiliados/a1/reveal')).statusCode).toBe(403)
    const missing = await post(app, admin.cookie, '/api/kv/afiliados.saques/nao-existe/reveal')
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error.code).toBe('nao_encontrado')
    expect((await api(app, 'POST', '/api/kv/afiliados.saques/w-pix/reveal')).statusCode).toBe(401)
    expect(await auditsAfter(app, before)).toEqual([])
  })

  it('aprovador com ver-pix paga pela rota e recebe o pedido mascarado (o claro só pelo reveal)', async () => {
    const cookie = await customRole(app, 'aprova-e-ve', ['afiliados-saques.ver', 'afiliados-saques.aprovar', 'afiliados-saques.ver-pix'])
    const pay = await post(app, cookie, '/api/kv/afiliados.saques/w-pix/pay')
    expect(pay.statusCode, pay.body).toBe(200)
    expect(pay.json().withdrawal.pixKey).toBe('123.***.***-09')
    expect((await storedPlain(app, 'afiliados.saques')).find((w) => w.id === 'w-pix')?.pixKey).toBe('12345678909')
  })

  it('crescimento.afiliados: lista mascarada até para quem tem ver-pix; reveal do afiliado; a máscara volta ao gravado', async () => {
    const cur = await current(app, admin.cookie, 'crescimento.afiliados')
    expect(cur.value[0]).toMatchObject({ email: 'jo***@gmail.com', pixKey: '987.***.***-00' })
    const before = await lastAuditId(app)
    const r = await post(app, admin.cookie, '/api/kv/crescimento.afiliados/a1/reveal')
    expect(r.statusCode, r.body).toBe(200)
    expect(r.json()).toEqual({ ok: true, id: 'a1', email: 'joao.souza@gmail.com', pixKey: '98765432100' })
    const [row] = await auditsAfter(app, before)
    expect(row).toMatchObject({ action: 'revelar', entity: 'Afiliado #a1', source: 'servidor', summary: 'crescimento.afiliados — dados de João Souza (a1) vistos em claro: chave PIX, e-mail' })
    // gerente regrava o contrato com os dados pessoais mascarados: o gravado continua
    const w = await put(app, admin.cookie, 'crescimento.afiliados', cur.value.map((a: Row) => ({ ...a, cpa: 60 })), cur.version)
    expect(w.statusCode, w.body).toBe(200)
    expect((await storedPlain(app, 'crescimento.afiliados'))[0]).toMatchObject({ email: 'joao.souza@gmail.com', pixKey: '98765432100', cpa: 60 })
  })
})

// ---------- 3. visões da base de jogadores ----------

describe('kv: público de marketing e métricas da base calculados pelo servidor (sem dado pessoal)', () => {
  let app: FastifyInstance
  const now = Date.now()
  const player = (id: string, status: string, p: Row = {}) => ({
    id,
    name: `Jogador ${id}`,
    nickname: `nick${id}`,
    email: `${id}@exemplo.com`,
    phone: '11987654321',
    cpf: '12345678909',
    birthDate: '1990-01-01T00:00:00.000Z',
    city: 'Campinas',
    uf: 'SP',
    ip: '177.10.20.30',
    status,
    kyc: 'nao_enviado',
    balanceReal: 15234.77,
    balanceBonus: 10,
    coins: 0,
    level: 1,
    xp: 0,
    totalDeposited: 0,
    depositsCount: 0,
    totalBet: 0,
    totalWon: 0,
    referrerId: null,
    tags: [],
    createdAt: iso(now - 100 * DAY),
    lastAccess: iso(now - 2 * DAY),
    ...p,
  })
  const PLAYERS = [
    player('p1', 'ativo', {
      tags: ['VIP', 'Bônus abuser', 'Revisar KYC'],
      kyc: 'verificado',
      xp: 1200,
      level: 5,
      coins: 100,
      depositsCount: 3,
      totalDeposited: 500,
      totalBet: 1000,
      totalWon: 400,
      referrerId: 'af1',
      createdAt: iso(now - 60_000),
      lastAccess: iso(now - 60_000),
    }),
    player('p2', 'autoexcluido', { kyc: 'pendente', coins: 50, depositsCount: 1, totalDeposited: 100, referrerId: 'af1' }),
    player('p3', 'pausa', { createdAt: iso(now - 5 * DAY) }),
    player('p4', 'bloqueado', { kyc: 'reprovado' }),
    player('p5', 'ativo', { createdAt: iso(now - 20 * DAY), lastAccess: iso(now - 40 * DAY) }),
    player('p6', 'status-antigo'),
  ]
  const cookies: Record<string, string> = {}

  beforeAll(async () => {
    app = await createTestApp()
    await seed(app, 'geral.jogadores', PLAYERS)
    await seed(app, 'operacao.depositos', [
      { id: 'd1', playerId: 'p1', playerEmail: 'p1@exemplo.com', amount: 100, status: 'pago', createdAt: iso(now - 3 * DAY) },
      { id: 'd2', playerId: 'p1', playerEmail: 'p1@exemplo.com', amount: 100, status: 'pendente', createdAt: iso(now - DAY) },
      { id: 'd3', playerId: 'p5', playerEmail: 'p5@exemplo.com', amount: 50, status: 'expirado', createdAt: iso(now - DAY) },
    ])
    await seed(app, 'crescimento.afiliados', [{ id: 'af1', name: 'Afiliado Um', email: 'af1@exemplo.com', code: 'CODIGO1', balance: 98000 }])
    cookies.admin = (await loginAs(app)).cookie
    cookies.promocoes = await customRole(app, 'so-promocoes', ['promocoes.ver'])
    cookies.dashboard = await customRole(app, 'so-dashboard', ['dashboard.ver'])
    cookies.tema = await customRole(app, 'so-tema', ['tema.ver'])
  })
  afterAll(async () => app.close())

  it('público: só quem pode receber marketing (ativo), com campos mínimos; sem dado pessoal, saldo, KYC nem etiqueta interna', async () => {
    expect((await get(app, cookies.promocoes, 'geral.jogadores')).statusCode).toBe(403)
    const r = await get(app, cookies.promocoes, 'geral.jogadores.audiencia')
    expect(r.statusCode, r.body).toBe(200)
    const list = r.json().value as Row[]
    expect(list.map((p) => p.id)).toEqual(['p1', 'p5'])
    expect(list[0]).toEqual({
      id: 'p1',
      nickname: 'nickp1',
      level: 5,
      xp: 1200,
      tags: ['VIP', 'Bônus abuser'],
      createdAt: PLAYERS[0].createdAt,
      lastAccess: PLAYERS[0].lastAccess,
      depositsCount: 3,
      lastDepositAt: iso(now - 3 * DAY),
    })
    expect(list[1]).toMatchObject({ id: 'p5', tags: [], depositsCount: 0, lastDepositAt: null })
    for (const leak of ['exemplo.com', '12345678909', '11987654321', '15234', 'Campinas', '177.10', 'Jogador p', 'Revisar KYC', 'verificado', '1990-01-01']) {
      expect(r.body, leak).not.toContain(leak)
    }
  })

  it('métricas: status, KYC, novos, depositantes, moedas, indicações e base do cashback, sem jogador identificado', async () => {
    expect((await get(app, cookies.dashboard, 'geral.jogadores.audiencia')).statusCode).toBe(403)
    const r = await get(app, cookies.dashboard, 'geral.jogadores.metricas')
    expect(r.statusCode, r.body).toBe(200)
    const m = r.json().value
    expect(m).toMatchObject({
      total: 6,
      byStatus: { ativo: 2, bloqueado: 1, autoexcluido: 1, pausa: 1, outros: 1 },
      kyc: { verificado: 1, pendente: 1, nao_enviado: 3, reprovado: 1 },
      newPlayers: { today: 1, last7Days: 2, last30Days: 3 },
      depositors: 2,
      coins: { circulation: 150, holders: 2 },
      referrals: [{ affiliateId: 'af1', code: 'CODIGO1', signups: 2, depositors: 2, deposited: 600 }],
      referralsDeposited: 600,
    })
    // p1 (ativo, entrou hoje): perda 600 desde o cadastro (< 1 dia conta como o período inteiro), 1.200 XP = nível de 4%
    // nas regras padrão (nada gravado) → R$ 24; p5 sem acesso em 30 dias
    expect(m.cashback).toEqual({
      diario: { active: 1, eligible: 1, total: 24, capped: 0 },
      semanal: { active: 1, eligible: 1, total: 24, capped: 0 },
      mensal: { active: 1, eligible: 1, total: 24, capped: 0 },
    })
    for (const id of ['p1', 'p2', 'p5', 'Jogador', 'exemplo.com', '98000']) expect(r.body, id).not.toContain(id)
  })

  it('leitura conforme as telas: quem não vê nenhuma das telas → 403; dono da base (Usuários) lê as duas', async () => {
    for (const key of ['geral.jogadores.audiencia', 'geral.jogadores.metricas']) {
      expect((await get(app, cookies.tema, key)).statusCode, key).toBe(403)
      expect((await get(app, cookies.admin, key)).statusCode, key).toBe(200)
    }
    expect(findKvRule('geral.jogadores.audiencia')?.readPages).toEqual(['promocoes', 'free-spins', 'cupons', 'torneios', 'niveis', 'disparos', 'notificacoes', 'popups-inbox'])
    expect(findKvRule('geral.jogadores.metricas')?.readPages).toEqual([
      'dashboard',
      'cadastro',
      'jogo-responsavel',
      'textos-legais',
      'moeda',
      'cashback',
      'promocoes',
      'free-spins',
      'cupons',
      'torneios',
      'niveis',
      'disparos',
      'notificacoes',
      'popups-inbox',
    ])
  })

  it('só leitura (PUT → 403 para qualquer cargo); a versão é a da base de jogadores', async () => {
    for (const key of ['geral.jogadores.audiencia', 'geral.jogadores.metricas']) {
      const r = await put(app, cookies.admin, key, [])
      expect(r.statusCode).toBe(403)
      expect(r.json().error.message).toContain('só pelo servidor')
      expect(await app.db.one('select 1 from kv_store where key = $1', [key])).toBeNull()
    }
    const base = await app.db.one<{ version: number }>(`select version from kv_store where key = 'geral.jogadores'`)
    expect((await current(app, cookies.promocoes, 'geral.jogadores.audiencia')).version).toBe(base!.version)
  })

  it('sem base gravada: visões vazias', async () => {
    const fresh = await createTestApp()
    try {
      const { cookie } = await loginAs(fresh)
      expect((await current(fresh, cookie, 'geral.jogadores.audiencia')).value).toEqual([])
      expect((await current(fresh, cookie, 'geral.jogadores.metricas')).value).toMatchObject({ total: 0, depositors: 0, referrals: [] })
    } finally {
      await fresh.close()
    }
  })
})

describe('kv: métricas da base sem valor por jogador; projeção do cashback feita no servidor com as regras gravadas', () => {
  let app: FastifyInstance
  const now = Date.now()
  // perdas líquidas distintas; cadastro há 1 minuto: em todo período a perda estimada é a perda inteira (sem depender
  // do relógio entre montar os dados e ler as métricas)
  const player = (id: string, nickname: string, xp: number, loss: number) => ({
    id,
    nickname,
    status: 'ativo',
    xp,
    level: 1,
    totalBet: loss + 500,
    totalWon: 500,
    createdAt: iso(now - 60_000),
    lastAccess: iso(now - 60_000),
    tags: [],
  })
  const PLAYERS = [player('p1', 'ana', 3000, 30000), player('p2', 'bru', 500, 1000), player('p3', 'cai', 100, 700)]
  const PER_PLAYER = [30000, 1000, 700, 1500, 30, 7] // perda e cashback de cada um (níveis padrão: 5%, 3%, 1%)
  let promocoes = ''
  let admin = ''

  beforeAll(async () => {
    app = await createTestApp()
    await seed(app, 'geral.jogadores', PLAYERS)
    promocoes = await customRole(app, 'so-promocoes-2', ['promocoes.ver'])
    admin = (await loginAs(app)).cookie
  })
  afterAll(async () => app.close())

  it('quem só vê Promoções lê o público e as métricas, mas nenhum valor das métricas se liga a um jogador', async () => {
    expect((await get(app, promocoes, 'geral.jogadores')).statusCode).toBe(403)
    const audience = (await current(app, promocoes, 'geral.jogadores.audiencia')).value as Row[]
    expect(audience.map((p) => [p.id, p.xp])).toEqual([['p1', 3000], ['p2', 500], ['p3', 100]])
    const r = await get(app, promocoes, 'geral.jogadores.metricas')
    expect(r.statusCode, r.body).toBe(200)
    const cashback = r.json().value.cashback as Record<string, Row>
    expect(JSON.stringify(cashback)).not.toContain('[')
    for (const [period, proj] of Object.entries(cashback)) {
      expect(Object.keys(proj).sort(), period).toEqual(['active', 'capped', 'eligible', 'total'])
      for (const v of Object.values(proj)) {
        expect(typeof v, period).toBe('number')
        expect(PER_PLAYER, `${period}: ${String(v)}`).not.toContain(v)
      }
    }
    for (const period of ['diario', 'semanal', 'mensal']) expect(cashback[period], period).toEqual({ active: 3, eligible: 3, total: 1537, capped: 0 })
  })

  it('a projeção usa as regras gravadas (campanhas.cashback e campanhas.niveis) e não depende da ordem da base', async () => {
    // só os campos que a projeção usa (o resto da configuração não muda nada aqui)
    const rules = (p: Row) => ({ cashback: { enabled: true, mode: 'por_nivel', pct: 5, period: 'semanal', minLoss: 50, cap: 2000, ...p } })
    await seed(app, 'campanhas.cashback', rules({ mode: 'fixo', pct: 10, minLoss: 800, cap: 80 }))
    let m = (await current(app, promocoes, 'geral.jogadores.metricas')).value
    // 10% fixo: p1 3.000 e p2 100 limitados a 80; p3 (perda 700) abaixo do mínimo de 800
    expect(m.cashback.mensal).toEqual({ active: 3, eligible: 2, total: 160, capped: 2 })
    await seed(app, 'campanhas.cashback', rules({}))
    await seed(app, 'campanhas.niveis', {
      levels: [
        { id: 'n1', name: 'Base', xp: 0, cashbackPct: 2 },
        { id: 'n2', name: 'Topo', xp: 1000, cashbackPct: 20 },
      ],
    })
    m = (await current(app, admin, 'geral.jogadores.metricas')).value
    // p1: 20% de 30.000 = 6.000 → teto 2.000; p2: 2% de 1.000 = 20; p3: 2% de 700 = 14
    expect(m.cashback.mensal).toEqual({ active: 3, eligible: 3, total: 2034, capped: 1 })
    await seed(app, 'campanhas.cashback', rules({ enabled: false }))
    m = (await current(app, admin, 'geral.jogadores.metricas')).value
    expect(m.cashback.mensal).toEqual({ active: 3, eligible: 0, total: 0, capped: 0 })

    const forward = buildMetrics(PLAYERS, [], now).cashback
    expect(buildMetrics([...PLAYERS].reverse(), [], now).cashback).toEqual(forward)
  })

  it('mesma projeção do painel (projectCycle): só ativos com acesso no período, nível pelo XP; regras fora do formato ficam com o padrão do painel', () => {
    expect(cashbackRulesOf(undefined)).toEqual(DEFAULT_CASHBACK_RULES)
    expect(cashbackRulesOf({ cashback: { enabled: 'sim', mode: 'outro', pct: '5', minLoss: null } })).toEqual(DEFAULT_CASHBACK_RULES)
    expect(cashbackRulesOf({ cashback: { enabled: false, mode: 'fixo', pct: 3, minLoss: 0, cap: 0 } })).toEqual({ enabled: false, mode: 'fixo', pct: 3, minLoss: 0, cap: 0 })
    expect(levelCashbackOf(undefined)).toEqual(DEFAULT_LEVEL_CASHBACK)
    expect(levelCashbackOf({ levels: [] })).toEqual(DEFAULT_LEVEL_CASHBACK)
    expect(levelCashbackOf({ levels: [{ xp: 0, cashbackPct: 1 }, { xp: 'x', cashbackPct: 9 }] })).toEqual([{ xp: 0, cashbackPct: 1 }])
    const players = [
      { ...player('p4', 'dan', 26000, 90000), createdAt: iso(now - 400 * DAY) }, // 90.000 em 400 dias: 6.750 no mês, nível de 12%
      { ...player('p5', 'eva', 7000, 3000), createdAt: iso(now - 30 * DAY), lastAccess: iso(now - 5 * DAY) }, // fora do dia
      player('p6', 'fia', 1200, 0), // sem perda
      { ...player('p7', 'gil', 7000, 4000), status: 'pausa' }, // não é ativo
      player('p8', 'hel', 0, 9000), // nível de 0%
    ]
    expect(buildMetrics(players, [], now).cashback).toEqual({
      diario: { active: 3, eligible: 1, total: 27, capped: 0 }, // p4: 225 no dia × 12%
      semanal: { active: 4, eligible: 2, total: 245, capped: 0 }, // p4: 1.575 × 12% = 189; p5: 700 × 8% = 56
      mensal: { active: 4, eligible: 2, total: 1050, capped: 0 }, // p4: 6.750 × 12% = 810; p5: 3.000 × 8% = 240
    })
  })
})

// ---------- 4. regras de status compartilhadas ----------

describe('shared/players: regras de status do jogador usadas pelo painel e pelo servidor', () => {
  it('o servidor usa a mesma tabela e a mesma regra do motivo', () => {
    expect(SERVER_TRANSITIONS).toBe(STATUS_TRANSITIONS)
    expect(serverIsPlayerRequested).toBe(isPlayerRequestedReason)
    expect(isPlayerRequestedReason('  Pedido do jogador (jogo responsável)')).toBe(true)
    expect(isPlayerRequestedReason('Pedido da equipe')).toBe(false)
  })

  it('canChangeStatus: autoexclusão nunca pelo painel; antifraude.banir só bloqueia e desbloqueia', () => {
    const edit = new Set(['usuarios.editar'])
    const ban = new Set(['antifraude.banir'])
    expect(canChangeStatus('autoexcluido', 'ativo', edit)).toBe(false)
    expect(canChangeStatus('ativo', 'autoexcluido', new Set([...edit, ...ban]))).toBe(false)
    expect(canChangeStatus('ativo', 'pausa', edit)).toBe(true)
    expect(canChangeStatus('ativo', 'pausa', ban)).toBe(false)
    expect(canChangeStatus('ativo', 'bloqueado', ban)).toBe(true)
    expect(canChangeStatus('bloqueado', 'pausa', ban)).toBe(true)
    expect(canChangeStatus('pausa', 'ativo', ban)).toBe(false)
    expect(canChangeStatus('status-antigo', 'bloqueado', ban)).toBe(true)
  })
})

// ---------- 5. limite de corpo das rotas de dados ----------

describe('kv: PUT /api/kv/:key e as importações aceitam até 12 MiB; as demais rotas ficam com o limite global', () => {
  let app: FastifyInstance
  let root: string
  const MIB = 1024 * 1024
  const PREFIX = '/api/kv-limite'

  beforeAll(async () => {
    app = await createTestApp()
    // escopo com o limite global de 1 MiB da API: rota sem limite próprio fica com o do parser
    await app.register(async (scope) => {
      scope.removeContentTypeParser('application/json')
      scope.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: MIB }, (_req, body, done) => {
        try {
          done(null, JSON.parse(body as string))
        } catch (err) {
          done(err as Error, undefined)
        }
      })
      await scope.register(kvRoutes, { prefix: PREFIX })
    })
    root = (await loginAs(app, 'superadmin', { totp: true })).cookie
  })
  afterAll(async () => app.close())

  it('limite das rotas de dados', () => {
    expect(KV_BODY_LIMIT).toBe(12 * MIB)
  })

  it('imagem de 2 MiB numa chave com imagens → 200 (acima do limite global)', async () => {
    const value = [{ id: 'b1', image: `data:image/png;base64,${'A'.repeat(2 * MIB)}` }]
    const r = await api(app, 'PUT', `${PREFIX}/personalizacao.banners`, { cookie: root, body: { value } })
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200)
    expect((await storedPlain<Row[]>(app, 'personalizacao.banners'))[0].image).toHaveLength(2 * MIB + 22)
  })

  it('importação de jogadores e de extrato com mais de 1 MiB → 200', async () => {
    const players = Array.from({ length: 1200 }, (_, i) => ({ id: `imp${i}`, name: `Jogador ${i}`, status: 'ativo', tags: Array.from({ length: 30 }, (_, k) => `etiqueta-${k}-${'x'.repeat(20)}`) }))
    expect(JSON.stringify({ players }).length).toBeGreaterThan(MIB)
    const p = await api(app, 'POST', `${PREFIX}/geral.jogadores/import`, { cookie: root, body: { players } })
    expect(p.statusCode, p.body.slice(0, 300)).toBe(200)
    expect(p.json().imported).toBe(1200)
    const transactions = Array.from({ length: 2000 }, (_, i) => ({ id: `TXI${i}`, type: 'deposito', amount: 10, playerId: 'imp1', at: '2026-01-01T00:00:00.000Z', note: 'n'.repeat(600) }))
    expect(JSON.stringify({ transactions }).length).toBeGreaterThan(MIB)
    const t = await api(app, 'POST', `${PREFIX}/geral.transacoes/import`, { cookie: root, body: { transactions } })
    expect(t.statusCode, t.body.slice(0, 300)).toBe(200)
  })

  it('outras rotas POST de dados continuam com o limite global (413)', async () => {
    const r = await api(app, 'POST', `${PREFIX}/afiliados.saques/w1/reject`, { cookie: root, body: { reason: 'x'.repeat(2 * MIB) } })
    expect(r.statusCode).toBe(413)
  })

  it('limite de cada chave continua: 2 MB padrão (413 dados_grandes_demais) e 12 MiB nas chaves com imagens (413)', async () => {
    const t = await api(app, 'PUT', `${PREFIX}/campanhas.promocoes`, { cookie: root, body: { value: { blob: 'B'.repeat(KV_DEFAULT_MAX_BYTES + 512 * 1024) } } })
    expect(t.statusCode).toBe(413)
    expect(t.json().error.code).toBe('dados_grandes_demais')
    const big = [{ id: 'b2', image: `data:image/png;base64,${'A'.repeat(12 * MIB)}` }]
    const i = await api(app, 'PUT', `/api/kv/personalizacao.avatares`, { cookie: root, body: { value: big } })
    expect(i.statusCode).toBe(413)
    expect(await app.db.query(`select key from kv_store where key in ('campanhas.promocoes', 'personalizacao.avatares')`)).toEqual([])
  })
})

// ---------- 6. limites das campanhas no servidor ----------

describe('kv: níveis, missões, torneios, roletas e itens da loja validados no servidor (mesmos limites do painel)', () => {
  let app: FastifyInstance
  let mkt: { cookie: string; user: { id: string } }

  const lvl = (id: string, name: string, xp: number, p: Row = {}) => ({ id, name, xp, slot: 1, cashbackPct: 1, priorityWithdrawal: false, levelUpGift: 5, freeSpins: 10, ...p })
  const levels = (p: Row = {}, xp: Row = {}) => ({
    enabled: true,
    keepLevel: true,
    levels: [lvl('lv1', 'Novato', 0, { cashbackPct: 0 }), lvl('lv2', 'Bronze', 50), lvl('lv3', 'Prata', 150, { cashbackPct: 2 })],
    xp: {
      perTen: { slots: 1, ao_vivo: 0.5, crash: 0.5, mesa: 0.5, instantaneo: 0.5, bingo: 0.5, esportes: 1 },
      depositXp: 5,
      depositMin: 20,
      bonusBetsCount: false,
      event: { enabled: true, name: 'Fim de semana em dobro', multiplier: 2, weekdays: [6, 0] },
      ...xp,
    },
    ...p,
  })
  const mission = (id: string, p: Row = {}) => ({
    id,
    name: `Missão ${id}`,
    objective: { kind: 'apostar', target: 50, scope: 'qualquer', category: 'slots', gameId: null },
    reward: { kind: 'moedas', value: 100 },
    recurrence: 'diaria',
    audience: 'todos',
    status: 'ativa',
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: null,
    started: 0,
    completions: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...p,
  })
  const tournament = (id: string, p: Row = {}) => ({
    id,
    name: `Torneio ${id}`,
    description: '',
    gameIds: ['g001'],
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-01-02T00:00:00.000Z',
    scoring: 'maior_ganho',
    minBet: 1,
    prizes: [
      { id: 'a', kind: 'dinheiro', value: 100 },
      { id: 'b', kind: 'bonus_brl', value: 50 },
    ],
    audience: 'todos',
    participants: 0,
    closedAt: null,
    closedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...p,
  })
  const prize = (id: string, probability: number, p: Row = {}) => ({ id, label: `Prêmio ${id}`, kind: 'bonus_brl', value: 5, probability, slot: 1, ...p })
  const wheel = (id: string, p: Row = {}) => ({
    id,
    name: `Roleta ${id}`,
    group: 'todos',
    prizes: [prize('a', 50), prize('b', 50, { kind: 'nada', value: 0 })],
    spinsPerDay: 1,
    costCoins: 0,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...p,
  })
  const item = (id: string, p: Row = {}) => ({
    id,
    name: `Item ${id}`,
    description: '',
    kind: 'bonus',
    value: 10,
    extra: 0,
    gameId: null,
    rollover: 10,
    icon: 'gift',
    image: null,
    price: 500,
    stock: null,
    sold: 0,
    limitPerPlayer: 1,
    limitPeriod: 'dia',
    active: true,
    featured: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...p,
  })

  async function refused(key: string, value: unknown, message: RegExp) {
    const before = await app.db.one<{ version: number }>('select version from kv_store where key = $1', [key])
    const r = await put(app, mkt.cookie, key, value, before?.version ?? 0)
    expect(r.statusCode, `${key}: ${r.body}`).toBe(400)
    expect(r.json().error.message).toMatch(message)
    const after = await app.db.one<{ version: number }>('select version from kv_store where key = $1', [key])
    expect(after?.version).toBe(before?.version)
  }

  beforeAll(async () => {
    app = await createTestApp()
    mkt = await loginAs(app, 'superadmin', { name: 'Marta Marketing' })
  })
  afterAll(async () => app.close())

  it('níveis: cashback 0–30%, XP crescente a partir de 0, nomes, giros inteiros, XP por categoria 0–20, evento 1x–5x', async () => {
    const lv = (i: number, p: Row) => {
      const c = levels()
      c.levels[i] = { ...c.levels[i], ...p }
      return c
    }
    await refused('campanhas.niveis', lv(1, { cashbackPct: 31 }), /Bronze: De 0% a 30%\./)
    await refused('campanhas.niveis', lv(1, { cashbackPct: -1 }), /Bronze: De 0% a 30%\./)
    await refused('campanhas.niveis', lv(0, { xp: 10 }), /O primeiro nível começa em 0 XP/)
    await refused('campanhas.niveis', lv(2, { xp: 50 }), /Prata: Precisa ser maior que 50 XP/)
    await refused('campanhas.niveis', lv(1, { freeSpins: 1.5 }), /Número inteiro/)
    await refused('campanhas.niveis', lv(1, { levelUpGift: -5 }), /Valor inválido/)
    await refused('campanhas.niveis', lv(1, { name: 'Novato' }), /Nome repetido/)
    await refused('campanhas.niveis', lv(1, { name: 'B'.repeat(25) }), /Use até 24 caracteres/)
    await refused('campanhas.niveis', lv(1, { slot: 9 }), /Cor do nível inválida/)
    await refused('campanhas.niveis', levels({ levels: [lvl('lv1', 'Novato', 0)] }), /pelo menos 2 níveis/)
    await refused('campanhas.niveis', levels({ levels: Array.from({ length: 21 }, (_, i) => lvl(`l${i}`, `N${i}`, i * 10)) }), /no máximo 20 níveis/)
    await refused('campanhas.niveis', levels({}, { perTen: { slots: 21, ao_vivo: 0.5, crash: 0.5, mesa: 0.5, instantaneo: 0.5, bingo: 0.5, esportes: 1 } }), /entre 0 e 20/)
    await refused('campanhas.niveis', levels({}, { perTen: { slots: 1 } }), /entre 0 e 20/)
    await refused('campanhas.niveis', levels({}, { depositXp: -1 }), /XP por depósito não pode ser negativo/)
    await refused('campanhas.niveis', levels({}, { event: { enabled: true, name: 'Dobro', multiplier: 6, weekdays: [6] } }), /1x a 5x/)
    await refused('campanhas.niveis', levels({}, { event: { enabled: true, name: 'Dobro', multiplier: 2, weekdays: [] } }), /ao menos um dia/)
    await refused('campanhas.niveis', levels({}, { event: { enabled: true, name: ' ', multiplier: 2, weekdays: [6] } }), /nome ao evento/)
    await refused('campanhas.niveis', { levels: 'x' }, /./)

    const ok = await put(app, mkt.cookie, 'campanhas.niveis', levels())
    expect(ok.statusCode, ok.body).toBe(200)
    const up = await put(app, mkt.cookie, 'campanhas.niveis', lv(2, { cashbackPct: 30 }), 1)
    expect(up.statusCode, up.body).toBe(200)
    const a = await app.db.one<AuditRow>(`select * from audit_log where summary like 'campanhas.niveis%' order by id desc limit 1`)
    expect(a!.summary).toBe('campanhas.niveis — Alterações: levels: lista com 3 → 3 itens (v1→v2)')
  })

  it('missões: regras de missionErrors; quem começou e concluiu (contadores da plataforma) são do servidor', async () => {
    const bad: [Row, RegExp][] = [
      [{ name: 'M'.repeat(61) }, /Use até 60 caracteres/],
      [{ name: '  ' }, /Dê um nome para a missão/],
      [{ objective: { kind: 'apostar', target: 0, scope: 'qualquer', category: 'slots', gameId: null } }, /meta precisa ser maior que zero/],
      [{ objective: { kind: 'multiplicador', target: 1, scope: 'qualquer', category: 'slots', gameId: null } }, /a partir de 1,01x/],
      [{ objective: { kind: 'rodadas', target: 10.5, scope: 'qualquer', category: 'slots', gameId: null } }, /número inteiro/],
      [{ objective: { kind: 'login', target: 3, scope: 'qualquer', category: 'slots', gameId: null } }, /não combina com missão diária/],
      [{ recurrence: 'semanal', objective: { kind: 'login', target: 8, scope: 'qualquer', category: 'slots', gameId: null } }, /no máximo 7 dias/],
      [{ objective: { kind: 'apostar', target: 10, scope: 'jogo', category: 'slots', gameId: null } }, /Escolha o jogo/],
      [{ reward: { kind: 'bonus_brl', value: 0 } }, /recompensa precisa ser maior que zero/],
      [{ reward: { kind: 'cashback', value: 101 } }, /no máximo 100%/],
      [{ endsAt: '2025-12-31T00:00:00.000Z' }, /fim precisa ser depois do início/],
      [{ startsAt: '' }, /Informe o início/],
      [{ reward: { kind: 'dinheiro', value: 10 } }, /Tipo de recompensa inválido/],
    ]
    for (const [p, msg] of bad) await refused('campanhas.missoes', [mission('m1', p)], msg)

    const created = await put(app, mkt.cookie, 'campanhas.missoes', [mission('m1', { started: 99999, completions: 88888 })])
    expect(created.statusCode, created.body).toBe(200)
    expect(created.json().value[0]).toMatchObject({ started: 0, completions: 0 })
    // a plataforma conta quem começou e concluiu; a gravação do painel não muda os contadores
    const stored = await storedPlain(app, 'campanhas.missoes')
    await seed(app, 'campanhas.missoes', stored.map((m) => ({ ...m, started: 40, completions: 12 })))
    const v = (await app.db.one<{ version: number }>(`select version from kv_store where key = 'campanhas.missoes'`))!.version
    const edit = await put(app, mkt.cookie, 'campanhas.missoes', [mission('m1', { name: 'Missão nova', started: 0, completions: 0 })], v)
    expect(edit.statusCode, edit.body).toBe(200)
    expect(edit.json().value[0]).toMatchObject({ name: 'Missão nova', started: 40, completions: 12 })
  })

  it('torneios: jogos, duração ≥ 1 h, aposta mínima, prêmios (inteiros, sem posição valendo mais que a anterior); inscritos e encerramento do servidor', async () => {
    const bad: [Row, RegExp][] = [
      [{ name: ' ' }, /Dê um nome para o torneio/],
      [{ gameIds: [] }, /pelo menos um jogo/],
      [{ endsAt: '2026-01-01T00:30:00.000Z' }, /pelo menos 1 hora/],
      [{ endsAt: '2025-12-31T00:00:00.000Z' }, /fim precisa ser depois do início/],
      [{ minBet: -1 }, /Aposta mínima inválida/],
      [{ prizes: [] }, /pelo menos uma posição/],
      [{ prizes: [{ id: 'a', kind: 'dinheiro', value: 0 }] }, /valor maior que zero/],
      [{ prizes: [{ id: 'a', kind: 'free_spins', value: 1.5 }] }, /número inteiro/],
      [{ prizes: [{ id: 'a', kind: 'dinheiro', value: 10 }, { id: 'b', kind: 'dinheiro', value: 20 }] }, /2º lugar vale mais que o prêmio do 1º lugar/],
      // 2.000 moedas × R$ 0,01 (moeda padrão) = R$ 20 > R$ 10
      [{ prizes: [{ id: 'a', kind: 'dinheiro', value: 10 }, { id: 'b', kind: 'moedas', value: 2000 }] }, /2º lugar vale mais/],
    ]
    for (const [p, msg] of bad) await refused('campanhas.torneios', [tournament('t1', p)], msg)

    // com a moeda configurada a R$ 0,001, 2.000 moedas valem R$ 2: passa
    await seed(app, 'campanhas.moeda', { name: 'Coins', symbol: 'EVC', refValue: 0.001 })
    const ok = await put(app, mkt.cookie, 'campanhas.torneios', [tournament('t1', { participants: 5000, prizes: [{ id: 'a', kind: 'dinheiro', value: 10 }, { id: 'b', kind: 'moedas', value: 2000 }] })])
    expect(ok.statusCode, ok.body).toBe(200)
    expect(ok.json().value[0].participants).toBe(0)

    // torneio antigo fora das regras atuais (gravado pela plataforma) ainda pode ser encerrado; quem e quando: do servidor
    await seed(app, 'campanhas.torneios', [...ok.json().value, tournament('t-velho', { endsAt: '2026-01-01T00:10:00.000Z', participants: 77 })])
    const cur = await current(app, mkt.cookie, 'campanhas.torneios')
    const close = cur.value.map((t: Row) => (t.id === 't-velho' ? { ...t, closedAt: '2020-01-01T00:00:00.000Z', closedBy: 'Daniel Carius', participants: 0 } : t))
    const closed = await put(app, mkt.cookie, 'campanhas.torneios', close, cur.version)
    expect(closed.statusCode, closed.body).toBe(200)
    const t = (closed.json().value as Row[]).find((x) => x.id === 't-velho')!
    expect(t).toMatchObject({ closedBy: 'Marta Marketing', participants: 77 })
    expect(Math.abs(Date.parse(t.closedAt as string) - Date.now())).toBeLessThan(60_000)
    // encerrado não reabre nem muda de autor
    const reopen = (closed.json().value as Row[]).map((x) => (x.id === 't-velho' ? { ...x, closedAt: null, closedBy: null } : x))
    const again = await put(app, mkt.cookie, 'campanhas.torneios', reopen, closed.json().version)
    expect((again.json().value as Row[]).find((x) => x.id === 't-velho')).toMatchObject({ closedBy: 'Marta Marketing', closedAt: t.closedAt })
  })

  it('roletas: 2–12 prêmios, chances 0–100% somando 100%, 1–50 giros por dia, custo inteiro ≥ 0', async () => {
    const bad: [Row, RegExp][] = [
      [{ name: '' }, /Dê um nome para a roleta/],
      [{ prizes: [prize('a', 50), prize('b', 49)] }, /somam 99%/],
      [{ prizes: [prize('a', 100)] }, /pelo menos 2 prêmios/],
      [{ prizes: Array.from({ length: 13 }, (_, i) => prize(`p${i}`, i === 0 ? 4 : 8)) }, /No máximo 12 prêmios/],
      [{ prizes: [prize('a', 101), prize('b', -1)] }, /chance entre 0% e 100%/],
      [{ prizes: [prize('a', 50, { label: ' ' }), prize('b', 50)] }, /Informe o rótulo/],
      [{ prizes: [prize('a', 50, { value: 0 }), prize('b', 50)] }, /valor precisa ser maior que zero/],
      [{ spinsPerDay: 51 }, /Entre 1 e 50 giros por dia/],
      [{ spinsPerDay: 0 }, /Entre 1 e 50 giros por dia/],
      [{ costCoins: -1 }, /número inteiro/],
      [{ costCoins: 1.5 }, /número inteiro/],
      [{ prizes: [prize('a', 50, { kind: 'dinheiro' }), prize('b', 50)] }, /Tipo de prêmio inválido/],
    ]
    for (const [p, msg] of bad) await refused('campanhas.roleta', [wheel('w1', p)], msg)
    const ok = await put(app, mkt.cookie, 'campanhas.roleta', [wheel('w1', { prizes: [prize('a', 33.33), prize('b', 33.33), prize('c', 33.34, { kind: 'nada', value: 0 })] })])
    expect(ok.statusCode, ok.body).toBe(200)
  })

  it('itens da loja: regras de shopItemErrors; vendidos são da plataforma (estoque não fica abaixo do vendido)', async () => {
    const bad: [Row[], RegExp][] = [
      [[item('i1', { name: ' ' })], /Informe o nome do item/],
      [[item('i1'), item('i2', { name: 'ITEM i1' })], /Já existe um item com este nome/],
      [[item('i1', { value: 0 })], /valor precisa ser maior que zero/],
      [[item('i1', { kind: 'cashback', value: 101, extra: 10 })], /no máximo 100%/],
      [[item('i1', { kind: 'cashback', value: 10, extra: 0 })], /teto do cashback/],
      [[item('i1', { kind: 'free_spins', value: 10.5, extra: 0.4, gameId: 'g1' })], /número inteiro de giros/],
      [[item('i1', { kind: 'free_spins', value: 10, extra: 0, gameId: 'g1' })], /valor de cada giro/],
      [[item('i1', { kind: 'free_spins', value: 10, extra: 0.4, gameId: null })], /jogo dos giros/],
      [[item('i1', { rollover: 101 })], /Rollover entre 0x e 100x/],
      [[item('i1', { price: 0 })], /pelo menos 1 moeda/],
      [[item('i1', { price: 1.5 })], /pelo menos 1 moeda/],
      [[item('i1', { stock: 0 })], /pelo menos 1 unidade/],
      [[item('i1', { limitPerPlayer: -1 })], /Limite por jogador/],
    ]
    for (const [list, msg] of bad) await refused('campanhas.loja', list, msg)

    const ok = await put(app, mkt.cookie, 'campanhas.loja', [item('i1', { stock: 10, sold: 999 })])
    expect(ok.statusCode, ok.body).toBe(200)
    expect(ok.json().value[0].sold).toBe(0)
    // a plataforma vendeu 8: o painel não baixa o estoque para menos que isso, nem zerando "sold"
    await seed(app, 'campanhas.loja', [{ ...ok.json().value[0], sold: 8 }])
    const v = (await app.db.one<{ version: number }>(`select version from kv_store where key = 'campanhas.loja'`))!.version
    const r = await put(app, mkt.cookie, 'campanhas.loja', [item('i1', { stock: 5, sold: 0 })], v)
    expect(r.statusCode).toBe(400)
    expect(r.json().error.message).toMatch(/Já foram vendidas 8 unidades/)
  })
})

// ---------- 7. dados de demonstração (DEMO_DATA) ----------

/** CPF com dígitos verificadores corretos? */
function validCpf(raw: string): boolean {
  const d = raw.replace(/\D/g, '')
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const dv = (n: number) => {
    const sum = [...d.slice(0, n)].reduce((s, c, i) => s + Number(c) * (n + 1 - i), 0)
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}

function collect(v: unknown, field: RegExp, out: [string, string][] = [], key = ''): [string, string][] {
  if (Array.isArray(v)) v.forEach((x) => collect(x, field, out, key))
  else if (v && typeof v === 'object') for (const [k, c] of Object.entries(v)) collect(c, field, out, k)
  else if (typeof v === 'string' && field.test(key)) out.push([key, v])
  return out
}

describe('kv: dados de demonstração gravados pelo servidor nas chaves das telas (DEMO_DATA)', () => {
  let app: FastifyInstance
  let lines: string[]
  const KEYS = DEMO_KEYS.map((k) => k.key)

  beforeAll(async () => {
    app = await createTestApp()
    lines = await seedDemo(app)
  }, 60_000)
  afterAll(async () => app.close())

  it('cobre as bases que as telas leem, uma linha por chave', () => {
    expect(KEYS).toEqual([
      'geral.jogadores',
      'crescimento.afiliados',
      'geral.transacoes',
      'operacao.depositos',
      'afiliados.saques',
      'crescimento.ggr.apuracoes',
      'esportes.apostas',
      'cassino.jogos',
      'cassino.provedoras',
      'cassino.agregadores',
    ])
    expect(lines).toHaveLength(KEYS.length)
    lines.forEach((l, i) => expect(l).toMatch(new RegExp(`^${KEYS[i].replace(/\./g, '\\.')}: \\d+ registros de demonstração`)))
  })

  it('rodar de novo não muda nada; chave já gravada fica como está', async () => {
    const again = await seedDemo(app)
    expect(again).toEqual(KEYS.map((k) => `${k}: já gravado (v1); nada a semear`))
    const fresh = await createTestApp()
    try {
      await seed(fresh, 'operacao.depositos', [{ id: 'real-1', playerId: 'x', amount: 10, status: 'pago' }])
      const out = await seedDemo(fresh)
      expect(out[KEYS.indexOf('operacao.depositos')]).toBe('operacao.depositos: já gravado (v1); nada a semear')
      expect(await storedPlain(fresh, 'operacao.depositos')).toEqual([{ id: 'real-1', playerId: 'x', amount: 10, status: 'pago' }])
      expect(out.filter((l) => l.includes('registros de demonstração'))).toHaveLength(KEYS.length - 1)
    } finally {
      await fresh.close()
    }
  }, 60_000)

  it('cifrado em repouso conforme a regra; auditoria do Sistema apontando a versão', async () => {
    for (const key of KEYS) {
      const row = await app.db.one<{ value_enc: string | null; version: number; updated_by: string }>('select value_enc, version, updated_by from kv_store where key = $1', [key])
      expect(row?.version, key).toBe(1)
      expect(row?.updated_by, key).toBe('sistema')
      expect(row?.value_enc != null, key).toBe(encryptAtRest(findKvRule(key)!))
    }
    const rows = await app.db.query<AuditRow>(`select * from audit_log where actor_name = 'Sistema' and action = 'criar' order by id`)
    expect(rows.map((r) => r.summary.split(' — ')[0])).toEqual(KEYS)
    for (const r of rows) {
      expect(r.actor_id).toBeNull()
      expect(r.summary).toMatch(/Dados de demonstração \(DEMO_DATA\): \d+ registros \(v0→v1\)$/)
    }
  })

  it('dados pessoais obviamente fictícios e nenhum nome da equipe nos registros', async () => {
    const all: Record<string, unknown> = {}
    for (const key of KEYS) all[key] = await storedPlain(app, key)
    // nomes de jogadores e afiliados são do gerador (podem coincidir com nomes comuns); fora deles, nenhum nome da equipe
    const text = JSON.stringify(all, (k, v) => (/^(name|playerName|affiliateName|holder)$/.test(k) ? undefined : v))
    for (const name of [...seedTeam().map((m) => m.name), 'Pedro Santos']) expect(text, name).not.toContain(name)
    expect(JSON.stringify(all)).not.toContain('Carius')

    const emails = collect(all, /^e-?mail$|Email$/i)
    expect(emails.length).toBeGreaterThan(500)
    for (const [, e] of emails) expect(e).toMatch(/@.+\.invalid$/)
    const cpfs = collect(all, /^cpf$/)
    expect(cpfs.length).toBe(340)
    for (const [, c] of cpfs) expect(validCpf(c), c).toBe(false)
    for (const [, p] of collect(all, /^phone$/)) expect(p).toMatch(/^\d{2}90000\d{4}$/)
    for (const [, ip] of collect(all, /^ip$/)) expect(ip).toMatch(/^10\./)
    // chaves PIX: e-mail .invalid, CPF inválido, celular (DD) 90000-XXXX
    const pix = [...(all['afiliados.saques'] as Row[]), ...(all['crescimento.afiliados'] as Row[])].filter((x) => typeof x.pixKey === 'string')
    expect(pix.length).toBeGreaterThan(10)
    for (const x of pix) {
      const k = x.pixKey as string
      if (k.includes('@')) expect(k).toMatch(/\.invalid$/)
      else if (x.pixKeyType === 'Celular') expect(k).toMatch(/^\d{2}90000\d{4}$/)
      else if (x.pixKeyType === 'CPF' || /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(k)) expect(validCpf(k), k).toBe(false)
    }
    // autor das decisões: rótulo genérico
    const deciders = collect(all, /^(decidedBy|closedBy|paidBy|by)$/).map(([, v]) => v)
    expect(deciders.length).toBeGreaterThan(10)
    expect(new Set(deciders)).toEqual(new Set([DEMO_STAFF_LABEL]))
    // bases continuam ligadas: o e-mail do jogador no extrato é o da base de jogadores
    const byId = new Map((all['geral.jogadores'] as Row[]).map((p) => [p.id, p.email]))
    for (const tx of (all['geral.transacoes'] as Row[]).slice(0, 200)) expect(tx.playerEmail).toBe(byId.get(tx.playerId))
  })

  it('as telas leem as bases semeadas pela rota (com a máscara de quem não revela)', async () => {
    const sup = (await loginAs(app, 'suporte')).cookie
    const players = await current(app, sup, 'geral.jogadores')
    expect(players.value).toHaveLength(340)
    expect(players.value[0].email).toMatch(/^.{2}\*\*\*@/)
    const audience = await current(app, (await loginAs(app)).cookie, 'geral.jogadores.audiencia')
    expect(audience.value.length).toBeGreaterThan(200)
  })

  it('dados que não passam nas regras do servidor não são gravados (a linha diz o motivo)', async () => {
    const fresh = await createTestApp()
    try {
      const out = await seedDemo(fresh, [
        { key: 'crescimento.ggr.apuracoes', build: () => [{ id: 'x', month: '2026-13' }] },
        { key: 'geral.jogadores', build: () => [{ id: 'p1', name: 'Fulano', status: 'banido' }] },
      ])
      expect(out[0]).toMatch(/^crescimento\.ggr\.apuracoes: não semeado \(Apuração x: /)
      expect(out[1]).toMatch(/^geral\.jogadores: não semeado \(Jogadores: Status de jogador inválido\.\)$/)
      expect(await fresh.db.query(`select key from kv_store`)).toEqual([])
    } finally {
      await fresh.close()
    }
  })

  it('demoize: unidades', () => {
    expect(validCpf(demoCpf('529.982.247-25'))).toBe(false)
    expect(demoCpf('529.982.247-25')).toMatch(/^529\.982\.247-\d5$/)
    expect(demoCpf(demoCpf('52998224725'))).toBe(demoCpf('52998224725'))
    expect(demoPhone('11987654321')).toBe('11900004321')
    expect(demoPhone('(11) 98765-4321')).toBe('(11) 90000-4321')
    expect(demoEmail('ana@gmail.com')).toBe('ana@gmail.com.invalid')
    expect(demoEmail(demoEmail('ana@gmail.com'))).toBe('ana@gmail.com.invalid')
    expect(demoIp('189.45.12.207')).toBe('10.45.12.207')
    expect(
      demoize([{ decidedBy: 'Daniel Carius', decidedById: 'u1', by: 'Rafael Lima', closedBy: null, pixKeyType: 'E-mail', pixKey: 'a@b.com', playerEmail: 'c@d.com', holder: 'Ana', name: 'Ana' }]),
    ).toEqual([{ decidedBy: DEMO_STAFF_LABEL, decidedById: null, by: DEMO_STAFF_LABEL, closedBy: null, pixKeyType: 'E-mail', pixKey: 'a@b.com.invalid', playerEmail: 'c@d.com.invalid', holder: 'Ana', name: 'Ana' }])
  })
})

// ---------- PoC r2-api-mode-seed-fallback-1: instalação nova sem DEMO_DATA ----------

describe('kv: instalação nova sem dados de demonstração — "Pagar" sobre a demonstração do painel não grava nada', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('afiliados.saques: o seed inteiro mandado pela tela (sem versão) é recusado; nenhum registro nem decisor inventado', async () => {
    const root = await loginAs(app, 'superadmin', { name: 'Admin PoC' })
    for (const k of ['afiliados.saques', 'crescimento.afiliados', 'operacao.depositos', 'esportes.apostas', 'crescimento.ggr.apuracoes']) {
      expect((await current(app, root.cookie, k)).stored, k).toBe(false)
    }
    const demo = seedAffiliateWithdrawals() as unknown as Row[]
    const target = demo.find((w) => w.status === 'pendente')!
    const value = demo.map((w) => (w.id === target.id ? { ...w, status: 'pago', decidedAt: new Date().toISOString(), decidedBy: 'Admin PoC', reason: null, reference: 'TED-123456789' } : w))
    const r = await put(app, root.cookie, 'afiliados.saques', value)
    expect(r.statusCode).toBe(403)
    // o pedido só existe no navegador: pagar pela rota do servidor também não cria nada
    expect((await post(app, root.cookie, `/api/kv/afiliados.saques/${String(target.id)}/pay`)).statusCode).toBe(404)
    expect(await loadRow(app.db, 'afiliados.saques')).toBeNull()
  })
})
