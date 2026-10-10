// Regressões de segurança da rota /api/kv (achados da revisão adversarial r1):
// jogo responsável no status do jogador, saldo só pelo extrato, extrato com campos
// do servidor, dados pessoais fora de geral.jogadores, leitura da base de jogadores
// e afiliados, máscara de IP/dados bancários/URLs de webhook.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { findKvRule, isPiiField, KV_RULES } from '@shared/kv-registry'
import { isMasked, maskIp, maskPii, maskUrlTokens } from '../src/lib/mask'
import { encryptAtRest, loadRow, saveRow } from '../src/modules/kv/store'
import { api, createTestApp, loginAs } from './helpers'

// ---------- utilitários ----------

const put = (app: FastifyInstance, cookie: string, key: string, value: unknown, version?: number) =>
  api(app, 'PUT', `/api/kv/${key}`, { cookie, body: version === undefined ? { value } : { value, version } })
const get = (app: FastifyInstance, cookie: string, key: string) => api(app, 'GET', `/api/kv/${key}`, { cookie })

type Row = Record<string, unknown>
interface RawRow {
  value: unknown
  value_enc: string | null
  version: number
}
const rawRow = (app: FastifyInstance, key: string) => app.db.one<RawRow>('select value, value_enc, version from kv_store where key = $1', [key])
async function storedPlain<T = Row[]>(app: FastifyInstance, key: string): Promise<T> {
  const r = await rawRow(app, key)
  return (r?.value_enc ? JSON.parse(app.cipher.decrypt(r.value_enc)) : r?.value) as T
}
const byId = (list: Row[], id: string) => list.find((x) => x.id === id)!

/**
 * Grava a chave direto no banco, como a plataforma (jogadores, extrato, depósitos e
 * registros de campanha não são criados pela tela): cifrada conforme a regra.
 */
async function seed(app: FastifyInstance, key: string, value: unknown) {
  const rule = findKvRule(key)!
  await app.db.tx(async (t) => {
    const row = await loadRow(t, key, true)
    await saveRow(t, app.cipher, key, value, encryptAtRest(rule), row, 'plataforma')
  })
}
async function current(app: FastifyInstance, cookie: string, key: string) {
  const r = await get(app, cookie, key)
  expect(r.statusCode, `${key}: ${r.body}`).toBe(200)
  return r.json() as { value: Row[]; version: number }
}
async function customRole(app: FastifyInstance, id: string, permissions: string[]) {
  await app.db.query('insert into roles (id, name, permissions) values ($1, $2, $3)', [id, `Cargo ${id}`, permissions])
  return (await loginAs(app, id)).cookie
}
const lastAudit = async (app: FastifyInstance) =>
  (await app.db.query<{ action: string; summary: string; actor_id: string }>('select action, summary, actor_id from audit_log order by id desc limit 1'))[0]

/** Avança o relógio do servidor (Date.now) mantendo as sessões vivas. */
async function travel(app: FastifyInstance, ms: number) {
  const future = Date.now() + ms
  const spy = vi.spyOn(Date, 'now').mockReturnValue(future)
  await app.db.query('update sessions set last_seen_at = $1, expires_at = $2', [new Date(future).toISOString(), new Date(future + 86_400_000).toISOString()])
  return () => spy.mockRestore()
}

const DAY = 86_400_000
const player = (id: string, status: string, extra: Row = {}) => ({
  id,
  name: `Jogador ${id}`,
  email: `${id}@exemplo.com`,
  cpf: '12345678909',
  status,
  balanceReal: 10,
  balanceBonus: 0,
  coins: 0,
  tags: [],
  ...extra,
})

// ---------- r1-authz-1 / r1-logic-1: autoexclusão e pausa ----------

describe('kv: status do jogador segue o jogo responsável (r1-authz-1, r1-logic-1)', () => {
  let app: FastifyInstance
  let admin: string
  let suporte: string
  let antifraude: string
  const P = 'geral.jogadores'
  const H = 'geral.usuarios.status'
  const players = [
    player('ae1', 'autoexcluido'),
    player('pz1', 'pausa'), // pausa sem registro: conta como pedida pelo jogador
    player('ae2', 'autoexcluido'),
    player('a1', 'ativo'),
    player('a2', 'ativo'),
    player('a3', 'ativo'),
    player('a4', 'ativo'),
  ]

  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app)).cookie
    suporte = (await loginAs(app, 'suporte', { name: 'Sara Suporte' })).cookie
    antifraude = await customRole(app, 'antifraude-only', ['antifraude.ver', 'antifraude.banir'])
    await seed(app, P, players)
  })
  afterAll(async () => app.close())

  const setStatus = async (cookie: string, id: string, status: string) => {
    const cur = await current(app, cookie, P)
    return put(app, cookie, P, cur.value.map((p) => (p.id === id ? { ...p, status } : p)), cur.version)
  }
  const addHistory = async (cookie: string, entry: Row) => {
    const r = await get(app, cookie, H)
    const cur = r.json() as { value: Row[] | null; version: number }
    return put(app, cookie, H, [entry, ...(cur.value ?? [])], cur.version)
  }
  const statusOf = async (id: string) => byId(await storedPlain(app, P), id).status

  it('ninguém reverte autoexclusão (Suporte, antifraude.banir nem Superadmin)', async () => {
    for (const [who, cookie, id] of [
      ['suporte', suporte, 'ae1'],
      ['antifraude', antifraude, 'ae2'],
      ['superadmin', admin, 'ae1'],
    ] as const) {
      for (const to of ['ativo', 'bloqueado', 'pausa']) {
        const r = await setStatus(cookie, id, to)
        expect(r.statusCode, `${who} ${id} → ${to}`).toBe(403)
        expect(r.json().error.code).toBe('transicao_nao_permitida')
      }
    }
    expect(await statusOf('ae1')).toBe('autoexcluido')
    expect(await statusOf('ae2')).toBe('autoexcluido')
  })

  it('ninguém põe autoexclusão pelo painel', async () => {
    const r = await setStatus(admin, 'a1', 'autoexcluido')
    expect(r.statusCode).toBe(403)
    expect(r.json().error).toMatchObject({ code: 'transicao_nao_permitida', details: { id: 'a1', from: 'ativo', to: 'autoexcluido' } })
  })

  it('pausa sem registro conta como pedida pelo jogador: não termina pelo painel (nem bloqueando e desbloqueando)', async () => {
    const r = await setStatus(suporte, 'pz1', 'ativo')
    expect(r.statusCode).toBe(403)
    expect(r.json().error.code).toBe('transicao_nao_permitida')
    expect(await statusOf('pz1')).toBe('pausa')
    // um registro 'pausar' de equipe incluído depois não afrouxa a pausa sem registro
    expect((await addHistory(suporte, { id: 'hx1', playerId: 'pz1', action: 'pausar', reason: 'Análise de conta em andamento', until: new Date(Date.now() + DAY).toISOString(), byPlayer: false })).statusCode).toBe(200)
    expect((await setStatus(suporte, 'pz1', 'ativo')).statusCode).toBe(403)
    // bloquear e desbloquear não encerra a pausa
    expect((await setStatus(antifraude, 'pz1', 'bloqueado')).statusCode).toBe(200)
    expect((await setStatus(antifraude, 'pz1', 'ativo')).statusCode).toBe(403)
    // desfazer o banimento devolve a pausa
    expect((await setStatus(antifraude, 'pz1', 'pausa')).statusCode).toBe(200)
    expect(await statusOf('pz1')).toBe('pausa')
  })

  it('pausa pedida pelo jogador só termina no prazo; o histórico não pode ser reescrito', async () => {
    // fluxo do painel: status → pausa e registro no histórico (pode chegar antes ou depois)
    const until = new Date(Date.now() + DAY).toISOString()
    expect((await addHistory(suporte, { id: 'h1', playerId: 'a1', action: 'pausar', from: 'ativo', to: 'pausa', reason: 'Pedido do jogador (jogo responsável)', until, byPlayer: false, by: 'Jogador', at: '2020-01-01T00:00:00Z' })).statusCode).toBe(200)
    expect((await setStatus(suporte, 'a1', 'pausa')).statusCode).toBe(200)
    // servidor define data, autor e "pedido do jogador" (o false enviado não vale contra o motivo)
    const h1 = byId(await storedPlain(app, H), 'h1')
    expect(h1).toMatchObject({ byPlayer: true, by: 'Sara Suporte' })
    expect(Math.abs(Date.parse(String(h1.at)) - Date.now())).toBeLessThan(60_000)

    const end = await setStatus(suporte, 'a1', 'ativo')
    expect(end.statusCode).toBe(403)
    expect(end.json().error.code).toBe('transicao_nao_permitida')

    // registro de equipe incluído depois não afrouxa
    expect((await addHistory(suporte, { id: 'h2', playerId: 'a1', action: 'pausar', reason: 'Análise de conta em andamento', until, byPlayer: false })).statusCode).toBe(200)
    expect((await setStatus(suporte, 'a1', 'ativo')).statusCode).toBe(403)

    // apagar ou alterar o registro → 403
    const cur = (await get(app, suporte, H)).json() as { value: Row[]; version: number }
    const wipe = await put(app, suporte, H, [], cur.version)
    expect(wipe.statusCode).toBe(403)
    expect(wipe.json().error.code).toBe('campo_nao_permitido')
    const edited = cur.value.map((e) => (e.id === 'h1' ? { ...e, byPlayer: false, until: new Date(Date.now() - 1000).toISOString() } : e))
    const ed = await put(app, suporte, H, edited, cur.version)
    expect(ed.statusCode).toBe(403)
    expect(ed.json().error.details.changed).toEqual(['h1'])
    // geral.jogadores.pausas é só do servidor
    expect((await put(app, admin, 'geral.jogadores.pausas', {})).statusCode).toBe(403)
    expect(await statusOf('a1')).toBe('pausa')

    // passado o prazo, a pausa pode ser encerrada
    const back = await travel(app, DAY + 60_000)
    try {
      expect((await setStatus(suporte, 'a1', 'ativo')).statusCode).toBe(200)
    } finally {
      back()
    }
    expect(await statusOf('a1')).toBe('ativo')
  })

  it('pausa aplicada pela equipe (não pedida pelo jogador) pode ser encerrada', async () => {
    expect((await setStatus(suporte, 'a2', 'pausa')).statusCode).toBe(200)
    expect((await addHistory(suporte, { id: 'h3', playerId: 'a2', action: 'pausar', reason: 'Análise de conta em andamento', until: new Date(Date.now() + 7 * DAY).toISOString() })).statusCode).toBe(200)
    expect((await setStatus(suporte, 'a2', 'ativo')).statusCode).toBe(200)
    // sem registro do pedido no histórico, a pausa conta como do jogador
    expect((await setStatus(suporte, 'a3', 'pausa')).statusCode).toBe(200)
    expect((await setStatus(suporte, 'a3', 'ativo')).statusCode).toBe(403)
  })

  it('histórico: pausa precisa de prazo no futuro e de no máximo 30 dias', async () => {
    for (const until of [null, new Date(Date.now() - 1000).toISOString(), new Date(Date.now() + 40 * DAY).toISOString()]) {
      const r = await addHistory(suporte, { id: `hu${String(until)}`, playerId: 'a4', action: 'pausar', reason: 'Outro motivo', until })
      expect(r.statusCode, String(until)).toBe(400)
    }
  })

  it('antifraude.banir só bloqueia e desbloqueia', async () => {
    const pause = await setStatus(antifraude, 'a4', 'pausa')
    expect(pause.statusCode).toBe(403)
    expect(pause.json().error.code).toBe('transicao_nao_permitida')
    expect((await setStatus(antifraude, 'a4', 'bloqueado')).statusCode).toBe(200)
    expect((await setStatus(antifraude, 'a4', 'ativo')).statusCode).toBe(200)
  })

  it('chaves filhas dos domínios de jogador/extrato/histórico e as pausas não são graváveis pelo painel', async () => {
    // filhas não registradas nem existem (404); as pausas são só do servidor (403)
    for (const key of ['geral.jogadores.copia', 'geral.transacoes.copia', 'geral.usuarios.status.copia']) {
      const r = await put(app, admin, key, [player('a1', 'ativo')])
      expect(r.statusCode, key).toBe(404)
    }
    expect((await put(app, admin, 'geral.jogadores.pausas', [player('a1', 'ativo')])).statusCode).toBe(403)
  })

  it('jogador autoexcluído não recebe moedas', async () => {
    const cur = await current(app, suporte, P)
    const r = await put(app, suporte, P, cur.value.map((p) => (p.id === 'ae1' ? { ...p, coins: 500 } : p)), cur.version)
    expect(r.statusCode).toBe(403)
    expect(byId(await storedPlain(app, P), 'ae1').coins).toBe(0)
  })
})

// ---------- r1-authz-2 / r1-logic-2 / r1-authz-8 / r1-logic-5: saldo e extrato ----------

describe('kv: saldo só muda pelo extrato, montado pelo servidor (r1-authz-2, r1-logic-2, r1-authz-8, r1-logic-5)', () => {
  let app: FastifyInstance
  let suporte: string
  let suporteId: string
  let estornos: string
  const P = 'geral.jogadores'
  const T = 'geral.transacoes'
  const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString()
  const players = [
    player('p1', 'ativo', { name: 'Joana Lima', email: 'joana@exemplo.com', balanceReal: 100 }),
    player('p2', 'autoexcluido', { name: 'Carlos Auto', email: 'carlos@exemplo.com', balanceReal: 0 }),
    player('p3', 'ativo', { balanceReal: 80 }),
    player('p4', 'ativo', { balanceReal: 0 }),
  ]
  const ledger = [
    { id: 'TX1', at: daysAgo(1), playerId: 'p1', playerName: 'Joana Lima', playerEmail: 'joana@exemplo.com', type: 'deposito', amount: 100, wallet: 'real', balanceBefore: 0, balanceAfter: 100, gameId: null, gameName: null, providerName: null, reference: 'DEP-1' },
    { id: 'TX2', at: daysAgo(1), playerId: 'p3', playerName: 'Jogador p3', playerEmail: 'p3@exemplo.com', type: 'aposta', amount: -20, wallet: 'real', balanceBefore: 100, balanceAfter: 80, gameId: 'g1', gameName: 'Slot', providerName: 'Prov', reference: 'BET-1' },
    // aposta com data no futuro (base da plataforma): não fica estornável para sempre
    { id: 'TXFUT', at: '2099-01-01T00:00:00Z', playerId: 'p3', playerName: 'Jogador p3', playerEmail: 'p3@exemplo.com', type: 'aposta', amount: -5, wallet: 'real', balanceBefore: 80, balanceAfter: 75, gameId: 'g1', gameName: 'Slot', providerName: 'Prov', reference: 'BET-2' },
  ]
  const manual = (id: string, type: 'credito_manual' | 'debito_manual', amount: number, extra: Row = {}) => ({
    id,
    at: new Date().toISOString(),
    playerId: 'p1',
    playerName: 'Joana Lima',
    playerEmail: 'jo***@exemplo.com',
    type,
    amount,
    wallet: 'real',
    balanceBefore: 100,
    balanceAfter: 100 + amount,
    gameId: null,
    gameName: null,
    providerName: null,
    reference: `MAN-${id}`,
    note: 'Ajuste de teste',
    by: 'Sara Suporte',
    ...extra,
  })

  beforeAll(async () => {
    app = await createTestApp()
    await loginAs(app, 'superadmin', { name: 'Daniel Superadmin' })
    const s = await loginAs(app, 'suporte', { name: 'Sara Suporte' })
    suporte = s.cookie
    suporteId = s.user.id
    estornos = await customRole(app, 'estornos', ['transacoes.ver', 'transacoes.editar'])
    await seed(app, P, players)
    await seed(app, T, ledger)
  })
  afterAll(async () => app.close())

  const balance = async (id: string) => byId(await storedPlain(app, P), id).balanceReal

  it('saldo enviado em geral.jogadores é ignorado (sem teto, sem extrato e inclusive para autoexcluído)', async () => {
    const before = await rawRow(app, T)
    const cur = await current(app, suporte, P)
    const next = cur.value.map((p) => (p.id === 'p1' ? { ...p, balanceReal: 999_999_999 } : p.id === 'p2' ? { ...p, balanceReal: 4999.99, balanceBonus: 50 } : p))
    const r = await put(app, suporte, P, next, cur.version)
    expect(r.statusCode).toBe(200)
    expect(byId(r.json().value, 'p1').balanceReal).toBe(100)
    expect(await balance('p1')).toBe(100)
    expect(byId(await storedPlain(app, P), 'p2')).toMatchObject({ balanceReal: 0, balanceBonus: 0 })
    expect((await rawRow(app, T))?.version).toBe(before?.version)
    expect((await lastAudit(app)).summary).toContain('saldo enviado ignorado')
  })

  it('autoexcluído não recebe creditação pelo extrato', async () => {
    const cur = await current(app, suporte, T)
    const r = await put(app, suporte, T, [manual('TXAE', 'credito_manual', 100, { playerId: 'p2' }), ...cur.value], cur.version)
    expect(r.statusCode).toBe(400)
    expect(r.json().error.message).toContain('autoexcluído')
    expect(await balance('p2')).toBe(0)
  })

  it('lançamento novo: autor, data, saldos, nome/e-mail e ordem vêm do servidor; saldo aplicado na mesma transação', async () => {
    const playersVersion = (await rawRow(app, P))!.version
    const cur = await current(app, suporte, T)
    const forged = manual('TXF', 'credito_manual', 1000, {
      at: '2019-01-01T00:00:00Z',
      by: 'Daniel Superadmin',
      byId: 'u_admin',
      balanceBefore: 1,
      balanceAfter: 123456,
      playerName: 'Fantasma',
      playerEmail: 'fantasma@x.com',
      gameName: 'Inventado',
    })
    // item novo no meio da lista
    const r = await put(app, suporte, T, [cur.value[0], forged, ...cur.value.slice(1)], cur.version)
    expect(r.statusCode).toBe(200)
    const stored = await storedPlain(app, T)
    expect(stored.map((t) => t.id)).toEqual(['TXF', 'TX1', 'TX2', 'TXFUT'])
    const txf = stored[0]
    expect(txf).toMatchObject({
      by: 'Sara Suporte',
      byId: suporteId,
      balanceBefore: 100,
      balanceAfter: 1100,
      playerName: 'Joana Lima',
      playerEmail: 'joana@exemplo.com',
      gameName: null,
      amount: 1000,
    })
    expect(Math.abs(Date.parse(String(txf.at)) - Date.now())).toBeLessThan(60_000)
    // saldo aplicado pelo servidor, sem mudar a versão da lista de jogadores
    expect(await balance('p1')).toBe(1100)
    expect((await rawRow(app, P))!.version).toBe(playersVersion)
    const a = await lastAudit(app)
    expect(a).toMatchObject({ action: 'creditar', actor_id: suporteId })
    expect(a.summary).toContain('(saldo real: R$ 100,00 → R$ 1.100,00)')
  })

  it('fluxo do painel: extrato e depois saldo (versão antiga da lista) não dá 409; saldo antes do extrato é ignorado', async () => {
    const pl = await current(app, suporte, P)
    const tx = await current(app, suporte, T)
    expect((await put(app, suporte, T, [manual('TXP1', 'debito_manual', -100), ...tx.value], tx.version)).statusCode).toBe(200)
    const w = await put(app, suporte, P, pl.value.map((p) => (p.id === 'p1' ? { ...p, balanceReal: 1000 } : p)), pl.version)
    expect(w.statusCode).toBe(200)
    expect(await balance('p1')).toBe(1000)
    // ordem inversa: o PUT do saldo chega primeiro (ignorado) e o extrato aplica depois
    const pl2 = await current(app, suporte, P)
    expect((await put(app, suporte, P, pl2.value.map((p) => (p.id === 'p1' ? { ...p, balanceReal: 900 } : p)), pl2.version)).statusCode).toBe(200)
    expect(await balance('p1')).toBe(1000)
    const tx2 = await current(app, suporte, T)
    expect((await put(app, suporte, T, [manual('TXP2', 'debito_manual', -100), ...tx2.value], tx2.version)).statusCode).toBe(200)
    expect(await balance('p1')).toBe(900)
  })

  it('creditações manuais somam no máximo R$ 5.000 por jogador em 24 h (50 × R$ 5.000 numa gravação → 400)', async () => {
    const cur = await current(app, suporte, T)
    const many = Array.from({ length: 50 }, (_, i) => manual(`TXM${i}`, 'credito_manual', 5000, { playerId: 'p4' }))
    const r = await put(app, suporte, T, [...many, ...cur.value], cur.version)
    expect(r.statusCode).toBe(400)
    expect(await balance('p4')).toBe(0)
    // p1 já recebeu R$ 1.000 hoje (TXF): até R$ 4.000 passa, R$ 0,01 a mais não
    const over = await put(app, suporte, T, [manual('TXM1', 'credito_manual', 4000.01), ...cur.value], cur.version)
    expect(over.statusCode).toBe(400)
    expect((await put(app, suporte, T, [manual('TXM2', 'credito_manual', 4000), ...cur.value], cur.version)).statusCode).toBe(200)
  })

  it('débito maior que o saldo e jogador inexistente → 400', async () => {
    const cur = await current(app, suporte, T)
    expect((await put(app, suporte, T, [manual('TXD', 'debito_manual', -1, { playerId: 'p4' }), ...cur.value], cur.version)).statusCode).toBe(400)
    const ghost = await put(app, suporte, T, [manual('TXG', 'credito_manual', 10, { playerId: 'jogador-que-nao-existe' }), ...cur.value], cur.version)
    expect(ghost.statusCode).toBe(400)
    expect(ghost.json().error.details).toMatchObject({ id: 'TXG', field: 'playerId' })
  })

  it('estorno: prazo conta da data gravada pelo servidor; data no futuro não fica estornável; o jogo vem da original', async () => {
    let cur = await current(app, suporte, T)
    // subtração "datada" em 2099 pelo cliente: o servidor grava a data de agora
    expect((await put(app, suporte, T, [manual('TXOLD', 'debito_manual', -10, { playerId: 'p3', at: '2099-01-01T00:00:00Z' }), ...cur.value], cur.version)).statusCode).toBe(200)
    expect(Date.parse(String(byId(await storedPlain(app, T), 'TXOLD').at))).toBeLessThan(Date.now() + 1000)
    cur = await current(app, estornos, T)
    const rev = (id: string, of: string, amount: number) => ({ ...manual(id, 'credito_manual', amount, { playerId: 'p3', gameName: 'Outro' }), type: 'estorno', reference: `EST-${of}` })
    const fut = await put(app, estornos, T, [rev('TXR0', 'TXFUT', 5), ...cur.value], cur.version)
    expect(fut.statusCode).toBe(400)
    expect(fut.json().error.message).toContain('data da transação original')
    const ok = await put(app, estornos, T, [rev('TXR1', 'TX2', 20), ...cur.value], cur.version)
    expect(ok.statusCode).toBe(200)
    expect(byId(await storedPlain(app, T), 'TXR1')).toMatchObject({ gameName: 'Slot', providerName: 'Prov', balanceBefore: 70, balanceAfter: 90 })

    const back = await travel(app, 400 * DAY)
    try {
      cur = await current(app, estornos, T)
      const late = await put(app, estornos, T, [rev('TXR2', 'TXOLD', 10), ...cur.value], cur.version)
      expect(late.statusCode).toBe(400)
      expect(late.json().error.message).toContain('prazo')
    } finally {
      back()
    }
  })
})

// ---------- r1-authz-3 / r1-exposure-1 / r1-frontend-2: dados pessoais fora de geral.jogadores ----------

describe('kv: e-mail de jogador mascarado e cifrado em extrato, depósitos e registros de campanha (r1-authz-3, r1-exposure-1)', () => {
  let app: FastifyInstance
  let admin: string
  let suporte: string
  let financeiro: string
  let marketing: string
  let soDashboard: string
  const EMAIL = 'maria.silva@gmail.com'
  const REFERRER = 'carlos.p@hotmail.com'
  const who = { playerId: 'p1', playerName: 'Maria Silva', playerEmail: EMAIL }
  const writes: [string, unknown][] = [
    ['geral.jogadores', [player('p1', 'ativo', { name: 'Maria Silva', email: EMAIL, balanceReal: 100 })]],
    ['geral.transacoes', [{ id: 't1', at: new Date().toISOString(), type: 'deposito', amount: 100, wallet: 'real', ...who }]],
    ['operacao.depositos', [{ id: 'd1', amount: 100, status: 'pago', ...who }]],
    ['esportes.apostas', [{ id: 'b1', amount: 10, ...who }]],
    ['campanhas.loja.compras', [{ id: 'c1', itemName: 'Item', ...who }]],
    ['campanhas.cupons.resgates', [{ id: 'r1', code: 'BEMVINDO', ...who }]],
    ['campanhas.free-spins.concessoes', [{ id: 'g1', campaignName: 'FS', ...who }]],
    ['campanhas.roleta.giros', [{ id: 's1', wheelName: 'Roda', ...who }]],
    ['campanhas.indicacao', { records: [{ id: 'i1', referrerId: 'p9', referrerName: 'Carlos P', referrerEmail: REFERRER }] }],
  ]

  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app)).cookie
    suporte = (await loginAs(app, 'suporte')).cookie
    financeiro = (await loginAs(app, 'financeiro')).cookie
    marketing = (await loginAs(app, 'marketing')).cookie
    soDashboard = await customRole(app, 'so-dashboard', ['dashboard.ver'])
    for (const [key, value] of writes) {
      // esportes.apostas fica em claro (como a plataforma gravava antes de a regra ganhar `pii`)
      if (key === 'esportes.apostas') {
        await app.db.query(`insert into kv_store (key, value, version) values ($1, $2::jsonb, 1)`, [key, JSON.stringify(value)])
        continue
      }
      await seed(app, key, value)
    }
  })
  afterAll(async () => app.close())

  it('Suporte e Financeiro (sem usuarios.ver-dados) recebem e-mail mascarado em extrato, depósitos e apostas', async () => {
    for (const [label, cookie] of [
      ['suporte', suporte],
      ['financeiro', financeiro],
    ] as const) {
      for (const key of ['geral.jogadores', 'geral.transacoes', 'operacao.depositos', 'esportes.apostas']) {
        const r = await get(app, cookie, key)
        if (r.statusCode === 403) continue // a tela não é do cargo
        expect(r.statusCode, `${label} ${key}`).toBe(200)
        expect(r.body, `${label} ${key}`).not.toContain(EMAIL)
        expect(r.body, `${label} ${key}`).toContain('ma***@gmail.com')
      }
    }
    // quem tem usuarios.ver-dados vê em claro
    expect((await get(app, admin, 'geral.transacoes')).body).toContain(EMAIL)
  })

  it('registros de campanha: só quem vê a tela lê, com e-mail mascarado', async () => {
    const fs = await get(app, marketing, 'campanhas.free-spins.concessoes')
    expect(fs.statusCode).toBe(200)
    expect(fs.body).not.toContain(EMAIL)
    expect(fs.json().value[0].playerEmail).toBe('ma***@gmail.com')
    for (const key of ['campanhas.loja.compras', 'campanhas.cupons.resgates', 'campanhas.free-spins.concessoes', 'campanhas.roleta.giros', 'campanhas.indicacao']) {
      const r = await get(app, soDashboard, key)
      expect(r.statusCode, key).toBe(403)
    }
    // a configuração da campanha continua legível por qualquer pessoa logada
    expect((await get(app, soDashboard, 'campanhas.free-spins')).statusCode).toBe(200)
    const ind = await get(app, admin, 'campanhas.indicacao')
    expect(ind.body).toContain(REFERRER)
  })

  it('em repouso: chaves com e-mail de jogador ficam cifradas', async () => {
    for (const [key] of writes) {
      if (key === 'esportes.apostas') continue
      const row = await rawRow(app, key)
      expect(row?.value, key).toBeNull()
      expect(row?.value_enc, key).toBeTruthy()
    }
  })

  it('Suporte devolve o extrato mascarado e lança creditação: e-mail gravado preservado', async () => {
    const cur = await current(app, suporte, 'geral.transacoes')
    expect(cur.value[0].playerEmail).toBe('ma***@gmail.com')
    const credit = { id: 't2', playerId: 'p1', playerName: 'Maria Silva', playerEmail: 'ma***@gmail.com', type: 'credito_manual', amount: 10, wallet: 'real', reference: 'MAN-1', note: 'ajuste' }
    const r = await put(app, suporte, 'geral.transacoes', [credit, ...cur.value], cur.version)
    expect(r.statusCode, r.body).toBe(200)
    const stored = await storedPlain(app, 'geral.transacoes')
    expect(stored.map((t) => t.playerEmail)).toEqual([EMAIL, EMAIL])
  })

  it('linhas antigas em claro são cifradas na subida', async () => {
    const fresh = await createTestApp()
    try {
      await fresh.db.query(`insert into kv_store (key, value, version) values ('operacao.depositos', $1::jsonb, 3)`, [JSON.stringify([{ id: 'd1', ...who }])])
      await fresh.db.query(`insert into kv_store (key, value, version) values ('config.empresa', $1::jsonb, 1)`, [JSON.stringify({ name: 'X2Win' })])
      await fresh.ready()
      const dep = await rawRow(fresh, 'operacao.depositos')
      expect(dep).toMatchObject({ value: null, version: 3 })
      expect(JSON.parse(fresh.cipher.decrypt(dep!.value_enc!))).toEqual([{ id: 'd1', ...who }])
      // chave sem dado sensível continua em claro
      expect((await rawRow(fresh, 'config.empresa'))?.value).toEqual({ name: 'X2Win' })
    } finally {
      await fresh.close()
    }
  })
})

// ---------- r1-exposure-2 / r1-frontend-2: dados bancários de saques de afiliados ----------

describe('kv: afiliados.saques mascara e-mail e dados bancários sem afiliados-saques.ver-pix (r1-exposure-2, r1-frontend-2)', () => {
  let app: FastifyInstance
  let admin: string
  const base = {
    affiliateId: 'a1',
    affiliateName: 'João Souza',
    affiliateEmail: 'joao.souza@gmail.com',
    affiliateType: 'Influencer',
    amount: 1500,
    status: 'pendente',
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null,
    reason: null,
    reference: null,
  }
  const ITEMS = [
    { ...base, id: 'w-ted', method: 'ted', pixKeyType: null, pixKey: null, bank: { bank: '341 · Itaú', agency: '1234', account: '98765-4', holder: 'João Souza' } },
    { ...base, id: 'w-pix', method: 'pix', pixKeyType: 'CPF', pixKey: '12345678909', bank: null },
  ]

  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app)).cookie
    await seed(app, 'afiliados.saques', ITEMS)
  })
  afterAll(async () => app.close())

  it('a lista sai mascarada para todos, inclusive quem tem ver-pix (o dado em claro sai por registro: kv-followups.test.ts)', async () => {
    const [aTed, aPix] = (await current(app, admin, 'afiliados.saques')).value as typeof ITEMS
    expect(aPix.pixKey).toBe('123.***.***-09')
    expect(aTed.affiliateEmail).toBe('jo***@gmail.com')
    expect(aTed.bank).toEqual({ bank: '341 · Itaú', agency: '••34', account: '•••65-4', holder: 'J*** S***' })
    for (const perms of [['afiliados-visao-geral.ver'], ['afiliados-saques.ver'], ['afiliados-saques.ver', 'afiliados-saques.ver-pix']]) {
      const cookie = await customRole(app, `r-${perms.join('+')}`, perms)
      const [ted, pix] = (await current(app, cookie, 'afiliados.saques')).value as typeof ITEMS
      expect(pix.pixKey).toBe('123.***.***-09')
      expect(ted.affiliateEmail).toBe('jo***@gmail.com')
      expect(ted.bank).toEqual({ bank: '341 · Itaú', agency: '••34', account: '•••65-4', holder: 'J*** S***' })
    }
  })

  it('aprovador sem ver-pix paga pela rota do servidor: dados reais preservados e resposta mascarada', async () => {
    const cookie = await customRole(app, 'aprovador', ['afiliados-saques.ver', 'afiliados-saques.aprovar'])
    const cur = await current(app, cookie, 'afiliados.saques')
    // a lista não é gravada pela tela
    const next = cur.value.map((w) => (w.id === 'w-ted' ? { ...w, status: 'pago' } : w))
    expect((await put(app, cookie, 'afiliados.saques', next, cur.version)).statusCode).toBe(403)
    const pay = await api(app, 'POST', '/api/kv/afiliados.saques/w-ted/pay', { cookie })
    expect(pay.statusCode, pay.body).toBe(200)
    expect(pay.json().withdrawal.bank).toEqual({ bank: '341 · Itaú', agency: '••34', account: '•••65-4', holder: 'J*** S***' })
    const stored = await storedPlain(app, 'afiliados.saques')
    expect(byId(stored, 'w-ted')).toMatchObject({ ...ITEMS[0], status: 'pago', decidedBy: 'Pessoa Teste', decidedAt: expect.any(String), reference: expect.stringMatching(/^TED-/) })
    expect(byId(stored, 'w-pix')).toEqual(ITEMS[1])
  })
})

// ---------- r1-authz-4 / r1-exposure-5: leitura das bases de jogadores e afiliados ----------

describe("kv: bases de jogadores e afiliados não são 'equipe' (r1-authz-4, r1-exposure-5)", () => {
  let app: FastifyInstance
  const cookies: Record<string, string> = {}

  beforeAll(async () => {
    app = await createTestApp()
    cookies.admin = (await loginAs(app)).cookie
    cookies.suporte = (await loginAs(app, 'suporte')).cookie
    cookies.marketing = (await loginAs(app, 'marketing')).cookie
    cookies.dash = await customRole(app, 'dash-only', ['dashboard.ver'])
    cookies.tema = await customRole(app, 'tema-only', ['tema.ver'])
    cookies.none = await customRole(app, 'no-perms', [])
    cookies.comissoes = await customRole(app, 'comissoes-only', ['comissoes.ver'])
    await seed(app, 'geral.jogadores', [player('p1', 'autoexcluido', { balanceReal: 15234.77, city: 'Campinas' })])
    await seed(app, 'crescimento.afiliados', [{ id: 'a1', name: 'Afiliado', balance: 98000, cpa: 150, revShare: 35 }])
  })
  afterAll(async () => app.close())

  it('cargos sem as telas donas recebem 403', async () => {
    for (const role of ['marketing', 'dash', 'tema', 'none']) {
      for (const key of ['geral.jogadores', 'crescimento.afiliados']) {
        const r = await get(app, cookies[role], key)
        expect(r.statusCode, `${role} ${key}`).toBe(403)
        expect(r.body).not.toContain('15234')
        expect(r.body).not.toContain('98000')
      }
    }
  })

  it('cargos com as telas donas leem', async () => {
    expect((await get(app, cookies.suporte, 'geral.jogadores')).statusCode).toBe(200)
    expect((await get(app, cookies.suporte, 'crescimento.afiliados')).statusCode).toBe(200)
    expect((await get(app, cookies.comissoes, 'crescimento.afiliados')).statusCode).toBe(200)
    expect((await get(app, cookies.comissoes, 'geral.jogadores')).statusCode).toBe(403)
  })

  it("registro: 'equipe' nunca guarda dado pessoal ou financeiro", () => {
    const bad = KV_RULES.filter((r) => r.read === 'equipe' && (r.pii || r.domain === 'players' || r.domain === 'transactions' || r.domain === 'player-status'))
    expect(bad.map((r) => r.prefix)).toEqual([])
    for (const key of ['geral.jogadores', 'crescimento.afiliados', 'geral.transacoes', 'operacao.depositos', 'campanhas.loja.compras', 'campanhas.indicacao']) {
      expect(findKvRule(key)?.read, key).toBe('tela')
    }
  })
})

// ---------- r1-exposure-6: máscara de IP ----------

describe('kv: máscara de IP cobre IPv6, porta e listas (r1-exposure-6)', () => {
  const IPV6 = '2804:14c:65a1:4321:abcd:1234:5678:9abc'
  const IPV6_SHORT = '2804:7f4:3b80:10::1f'

  it('unidade', () => {
    expect(maskIp('200.150.10.20')).toBe('200.150.***.***')
    expect(maskIp(IPV6)).toBe('2804:14c:****:****:****:****:****:****')
    expect(maskIp(IPV6_SHORT)).toBe('2804:7f4:****:****:****:****:****:****')
    expect(maskIp('::1')).toBe('0:0:****:****:****:****:****:****')
    expect(maskIp('2804::1')).toBe('2804:0:****:****:****:****:****:****')
    expect(maskIp('[2804:14c::1]:443')).toBe('2804:14c:****:****:****:****:****:****')
    expect(maskIp('fe80::1%eth0')).toBe('fe80:0:****:****:****:****:****:****')
    expect(maskIp('::ffff:189.45.12.207')).toBe('::ffff:189.45.***.***')
    expect(maskIp('189.45.12.207:51234')).toBe('189.45.***.***')
    expect(maskIp('189.45.12.207, 10.0.0.1')).toBe('189.45.***.***, 10.0.***.***')
    expect(maskIp('não é ip')).toBe('•••')
    for (const v of [IPV6, IPV6_SHORT, '189.45.12.207:51234', 'lixo']) {
      expect(isMasked(maskPii('ip', v)), v).toBe(true)
      expect(isMasked(maskPii('lastIp', v)), v).toBe(true)
      expect(maskPii('ip', maskPii('ip', v))).toBe(maskPii('ip', v))
    }
  })

  it('ponta a ponta: leitor sem usuarios.ver-dados não recebe o IP completo; a máscara volta ao gravado', async () => {
    const app = await createTestApp()
    try {
      const suporte = (await loginAs(app, 'suporte')).cookie
      const list = [
        player('p1', 'ativo', { ip: IPV6, lastIp: IPV6_SHORT }),
        player('p2', 'ativo', { ip: '189.45.12.207, 10.0.0.1', lastIp: '189.45.12.207:51234' }),
      ]
      await seed(app, 'geral.jogadores', list)
      const cur = await current(app, suporte, 'geral.jogadores')
      expect(cur.value[0]).toMatchObject({ ip: '2804:14c:****:****:****:****:****:****', lastIp: '2804:7f4:****:****:****:****:****:****' })
      expect(JSON.stringify(cur.value)).not.toContain('189.45.12.207')
      const w = await put(app, suporte, 'geral.jogadores', cur.value.map((p) => (p.id === 'p1' ? { ...p, tags: ['vip'] } : p)), cur.version)
      expect(w.statusCode).toBe(200)
      const stored = await storedPlain(app, 'geral.jogadores')
      expect(stored[0]).toMatchObject({ ip: IPV6, lastIp: IPV6_SHORT, tags: ['vip'] })
      expect(stored[1]).toMatchObject({ ip: '189.45.12.207, 10.0.0.1' })
    } finally {
      await app.close()
    }
  })
})

// ---------- r1-exposure-3: URLs de webhook com token ----------

describe('kv: URL de webhook com token mascarada para quem não edita webhooks (r1-exposure-3)', () => {
  const PATH_TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWx'
  const QUERY_TOKEN = 's3cr3tT0k3nValue'
  const URL = `https://hooks.example.com/services/T000/B000/${PATH_TOKEN}?token=${QUERY_TOKEN}`
  let app: FastifyInstance
  let admin: string

  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app)).cookie
    const w = await put(app, admin, 'campanhas.webhooks.destinos', [{ id: 'w1', event: 'saque.pago', url: URL, active: true, secret: 'segredo-forte-123' }], 0)
    expect(w.statusCode).toBe(200)
    await app.db.query(
      `insert into webhook_executions (id, event, destination_id, url, status, http_status, duration_ms, payload)
       values ('ex1', 'saque.pago', 'w1', $1, 'sucesso', 200, 100, '{}')`,
      [URL],
    )
  })
  afterAll(async () => app.close())

  it('unidade: maskUrlTokens', () => {
    const masked = maskUrlTokens(URL)
    expect(masked).toBe('https://hooks.example.com/services/T000/B000/AbCd****?token=****')
    expect(isMasked(masked)).toBe(true)
    expect(maskUrlTokens(masked)).toBe(masked)
    expect(maskUrlTokens('https://api.leadflow.app/v1/ftd/a8c3f1d92e7b')).toBe('https://api.leadflow.app/v1/ftd/a8c3****')
    expect(maskUrlTokens('https://a.com/in')).toBe('https://a.com/in')
    expect(maskUrlTokens('https://u:p@a.com/x#frag')).toBe('https://****@a.com/x#****')
    expect(maskUrlTokens('não é url')).toBe('•••')
  })

  for (const roleId of ['marketing-oficial', 'adm']) {
    it(`${roleId}: destinos e execuções sem o token da URL`, async () => {
      const { cookie } = await loginAs(app, roleId, { totp: true })
      for (const key of ['campanhas.webhooks.destinos', 'campanhas.webhooks.execucoes']) {
        const r = await get(app, cookie, key)
        expect(r.statusCode, key).toBe(200)
        expect(r.body).not.toContain(PATH_TOKEN)
        expect(r.body).not.toContain(QUERY_TOKEN)
        expect(r.body).not.toContain('segredo-forte-123')
        expect(r.json().value[0].url).toContain('hooks.example.com')
      }
    })
  }

  it('quem edita webhooks vê a URL completa (e a regrava sem perder nada)', async () => {
    const cur = await current(app, admin, 'campanhas.webhooks.destinos')
    expect(cur.value[0].url).toBe(URL)
  })
})

// ---------- r1-exposure-4 (parte do registro): auditoria.registros ----------

describe('kv: auditoria.registros não é lida por mcp.ver (r1-exposure-4)', () => {
  it('cargo só com mcp.ver recebe 403', async () => {
    const app = await createTestApp()
    try {
      const cookie = await customRole(app, 'so-mcp', ['mcp.ver'])
      expect((await get(app, cookie, 'auditoria.registros')).statusCode).toBe(403)
      expect(findKvRule('auditoria.registros')?.readPages).not.toContain('mcp')
    } finally {
      await app.close()
    }
  })
})

// ---------- campo pessoal com prefixo ----------

describe('kv: nomes de campo pessoal com prefixo', () => {
  it('isPiiField', () => {
    for (const f of ['email', 'playerEmail', 'referrerEmail', 'affiliateEmail', 'player_email', 'cpf', 'holderCpf', 'lastIp', 'loginIp', 'last_ip', 'whatsappPhone', 'dataNascimento']) {
      expect(isPiiField(f), f).toBe(true)
    }
    for (const f of ['vip', 'isVip', 'tooltip', 'ship', 'zip', 'pixKeyType', 'playerName', 'name', 'id']) {
      expect(isPiiField(f), f).toBe(false)
    }
    expect(isPiiField('agency')).toBe(false)
    expect(isPiiField('agency', ['agency'])).toBe(true)
  })
})
