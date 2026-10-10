import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { findKvRule } from '@shared/kv-registry'
import { effectivePermissions } from '@shared/permissions'
import { AUDIT_SOURCE_LABEL, isPanelReported, panelAuditDecision, type AuditAction, type AuditEntry } from '@shared/audit'
import { newId } from '../src/lib/crypto'
import { getRole } from '../src/services/roles-repo'
import type { KvContext } from '../src/kv/types'
import type { AuthContext } from '../src/types'
import { AUDIT_KV_LIMIT, AUDIT_KV_PANEL_LIMIT, kvHandlers } from '../src/modules/audit/kv'
import { csvCell } from '../src/modules/audit/format'
import { EVENTS_PER_IP_PER_MINUTE, EVENTS_PER_USER_PER_MINUTE } from '../src/modules/audit/routes'
import { api, cookieFrom, createTestApp, createUser, loginAs, sessionCookie } from './helpers'

async function authFor(app: FastifyInstance, roleId: string): Promise<AuthContext> {
  const u = await createUser(app, { roleId })
  const role = (await getRole(app.db, roleId))!
  return {
    user: { id: u.id, name: 'Pessoa KV', email: u.email, roleId, status: 'ativo', totpEnabled: false, mustChangePassword: false },
    role,
    perms: new Set(effectivePermissions(role)),
    sessionId: 's',
    stage: 'active',
    ip: '10.0.0.1',
  }
}

const kvCtx = (app: FastifyInstance, auth: AuthContext): KvContext => ({
  app,
  req: { clientIp: auth.ip } as unknown as FastifyRequest,
  auth,
  key: 'auditoria.registros',
  rule: findKvRule('auditoria.registros')!,
})

async function insertAudit(app: FastifyInstance, r: { at: string; actorId?: string | null; actorName?: string; action?: string; entity?: string; summary?: string; ip?: string }) {
  await app.db.query(`insert into audit_log (at, actor_id, actor_name, action, entity, summary, ip) values ($1, $2, $3, $4, $5, $6, $7)`, [
    r.at,
    r.actorId ?? null,
    r.actorName ?? 'Fulano',
    r.action ?? 'editar',
    r.entity ?? 'Entidade',
    r.summary ?? 'Resumo',
    r.ip ?? '1.2.3.4',
  ])
}

async function createRole(app: FastifyInstance, id: string, permissions: string[]) {
  await app.db.query(`insert into roles (id, name, permissions, approval_ceiling_cents) values ($1, $2, $3, 0)`, [id, `Cargo ${id}`, permissions])
}

let app: FastifyInstance
let admin: { cookie: string; user: { id: string } }

beforeAll(async () => {
  app = await createTestApp()
  admin = await loginAs(app, 'superadmin', { name: 'Ana Admin' })
})
afterAll(async () => app.close())

describe('POST /api/audit/events', () => {
  it('registra o evento do painel com quem/IP do servidor e devolve 201 { id }', async () => {
    const r = await api(app, 'POST', '/api/audit/events', {
      cookie: admin.cookie,
      ip: '10.20.30.40',
      body: { action: 'exportar', entity: 'Saques', summary: 'Exportação CSV de 12 saques', actorName: 'Outra Pessoa', actorId: 'x', ip: '9.9.9.9' },
    })
    expect(r.statusCode).toBe(201)
    const { id } = r.json()
    expect(typeof id).toBe('string')
    const row = await app.db.one<Record<string, unknown>>('select * from audit_log where id = $1', [Number(id)])
    expect(row).toMatchObject({
      actor_id: admin.user.id,
      actor_name: 'Ana Admin',
      action: 'exportar',
      entity: 'Saques',
      summary: 'Exportação CSV de 12 saques',
      ip: '10.20.30.40',
      source: 'painel',
    })
  })

  it('cargo relata só o que pode fazer na tela (Suporte edita jogador; não "revela" nem "credita")', async () => {
    const { cookie } = await loginAs(app, 'suporte')
    const ok = await api(app, 'POST', '/api/audit/events', { cookie, body: { action: 'editar', entity: 'Jogador #1', summary: 'Etiqueta incluída' } })
    expect(ok.statusCode).toBe(201)
    for (const action of ['revelar', 'creditar']) {
      const r = await api(app, 'POST', '/api/audit/events', { cookie, body: { action, entity: 'Jogador #1', summary: 'CPF exibido' } })
      expect(r.statusCode, action).toBe(403)
      expect(r.json().error.code).toBe('evento_nao_relatavel')
    }
    // tela que o Suporte não edita
    const other = await api(app, 'POST', '/api/audit/events', { cookie, body: { action: 'ligar', entity: 'Promoção Boas-vindas', summary: 'x' } })
    expect(other.statusCode).toBe(403)
    expect(other.json().error.code).toBe('sem_permissao')
  })

  it.each([
    ['ação login (só o servidor registra)', { action: 'login', entity: 'Painel', summary: 'Entrou' }],
    ['ação desconhecida', { action: 'apagar-tudo', entity: 'Painel', summary: 'x' }],
    ['ação não texto', { action: 1, entity: 'Painel', summary: 'x' }],
    ['sem ação', { entity: 'Painel', summary: 'x' }],
    ['sem entidade', { action: 'editar', summary: 'x' }],
    ['entidade vazia', { action: 'editar', entity: '   ', summary: 'x' }],
    ['sem resumo', { action: 'editar', entity: 'Painel' }],
    ['entidade com 201 caracteres', { action: 'editar', entity: 'e'.repeat(201), summary: 'x' }],
    ['resumo com 1001 caracteres', { action: 'editar', entity: 'Painel', summary: 's'.repeat(1001) }],
    ['corpo vazio', undefined],
  ])('recusa %s → 400 dados_invalidos', async (_label, body) => {
    const before = await app.db.one<{ n: number }>('select count(*)::int as n from audit_log')
    const r = await api(app, 'POST', '/api/audit/events', { cookie: admin.cookie, body })
    expect(r.statusCode).toBe(400)
    expect(r.json().error.code).toBe('dados_invalidos')
    const after = await app.db.one<{ n: number }>('select count(*)::int as n from audit_log')
    expect(after?.n).toBe(before?.n)
  })

  it('aceita os limites exatos (entidade 200, resumo 1000) sem cortar', async () => {
    const entity = `Promoção ${'E'.repeat(191)}`
    expect(entity).toHaveLength(200)
    const summary = 'S'.repeat(1000)
    const r = await api(app, 'POST', '/api/audit/events', { cookie: admin.cookie, body: { action: 'editar', entity, summary } })
    expect(r.statusCode).toBe(201)
    const row = await app.db.one<{ entity: string; summary: string }>('select entity, summary from audit_log where id = $1', [Number(r.json().id)])
    expect(row).toEqual({ entity, summary })
  })

  it('sem sessão → 401; etapa pendente → 403; sem CSRF → 403', async () => {
    const body = { action: 'editar', entity: 'X', summary: 'Y' }
    expect((await api(app, 'POST', '/api/audit/events', { body })).statusCode).toBe(401)
    const u = await createUser(app)
    const pending = await api(app, 'POST', '/api/audit/events', { cookie: await sessionCookie(app, u.id, 'password'), body })
    expect(pending.statusCode).toBe(403)
    expect(pending.json().error.code).toBe('etapa_pendente')
    const csrf = await api(app, 'POST', '/api/audit/events', { cookie: admin.cookie, body, csrf: false })
    expect(csrf.statusCode).toBe(403)
  })

  it(`limite de ${EVENTS_PER_USER_PER_MINUTE} por minuto por pessoa: sessão nova da mesma pessoa não ganha cota; outra pessoa não é afetada`, async () => {
    const probe = await createTestApp()
    const a = await createUser(probe, { roleId: 'superadmin' })
    const a1 = await sessionCookie(probe, a.id)
    const a2 = await sessionCookie(probe, a.id)
    const b = await loginAs(probe, 'superadmin')
    const body = { action: 'editar', entity: 'Promoção Carga', summary: 'teste de limite' }
    const codes: number[] = []
    for (let i = 0; i < EVENTS_PER_USER_PER_MINUTE; i++) {
      codes.push((await api(probe, 'POST', '/api/audit/events', { cookie: i % 2 ? a1 : a2, body, ip: '10.9.0.1' })).statusCode)
    }
    expect(codes.every((c) => c === 201)).toBe(true)
    expect((await api(probe, 'POST', '/api/audit/events', { cookie: a1, body, ip: '10.9.0.1' })).statusCode).toBe(429)
    // sessão nova (outro login da mesma pessoa) e outro IP: mesma cota
    const a3 = await sessionCookie(probe, a.id)
    expect((await api(probe, 'POST', '/api/audit/events', { cookie: a3, body, ip: '10.9.0.2' })).statusCode).toBe(429)
    const other = await api(probe, 'POST', '/api/audit/events', { cookie: b.cookie, body, ip: '10.9.0.1' })
    expect(other.statusCode).toBe(201)
    await probe.close()
  })

  it(`limite de ${EVENTS_PER_IP_PER_MINUTE} gravações por minuto por IP, somando as pessoas`, async () => {
    const probe = await createTestApp()
    const IP = '198.51.100.20'
    const people = await Promise.all(Array.from({ length: 5 }, () => loginAs(probe, 'superadmin')))
    const body = { action: 'exportar', entity: 'Promoções', summary: 'teste de limite por IP' }
    const codes: number[] = []
    for (const p of people) {
      for (let i = 0; i < 25; i++) codes.push((await api(probe, 'POST', '/api/audit/events', { cookie: p.cookie, body, ip: IP })).statusCode)
    }
    expect(codes.filter((c) => c === 201)).toHaveLength(EVENTS_PER_IP_PER_MINUTE)
    expect(codes.slice(EVENTS_PER_IP_PER_MINUTE).every((c) => c === 429)).toBe(true)
    // outro IP segue com a própria cota
    const fresh = await loginAs(probe, 'superadmin')
    expect((await api(probe, 'POST', '/api/audit/events', { cookie: fresh.cookie, body, ip: '198.51.100.21' })).statusCode).toBe(201)
    const n = await probe.db.one<{ n: number }>(`select count(*)::int as n from audit_log where source = 'painel' and ip = $1`, [IP])
    expect(n?.n).toBe(EVENTS_PER_IP_PER_MINUTE)
    await probe.close()
  })
})

describe('GET /api/audit', () => {
  let probe: FastifyInstance
  let cookie: string
  beforeAll(async () => {
    probe = await createTestApp()
    cookie = (await loginAs(probe, 'superadmin')).cookie
    const base = Date.parse('2026-03-10T12:00:00Z')
    for (let i = 0; i < 30; i++) {
      await insertAudit(probe, {
        at: new Date(base + i * 3_600_000 * 24).toISOString(), // um por dia: 10/03 .. 08/04
        actorId: i % 3 === 0 ? 'u_alvo' : 'u_outro',
        actorName: i % 3 === 0 ? 'Alvo' : 'Outro',
        action: i % 2 === 0 ? 'aprovar' : 'editar',
        entity: `Item ${i}`,
      })
    }
  })
  afterAll(async () => probe.close())

  it('pagina do mais recente para o mais antigo com total', async () => {
    const r = await api(probe, 'GET', '/api/audit?pageSize=10&page=1', { cookie })
    expect(r.statusCode).toBe(200)
    const body = r.json()
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(10)
    expect(body.total).toBe(30)
    expect(body.items).toHaveLength(10)
    expect(body.items[0].entity).toBe('Item 29')
    expect(typeof body.items[0].id).toBe('string')
    const p3 = (await api(probe, 'GET', '/api/audit?pageSize=10&page=3', { cookie })).json()
    expect(p3.items.map((e: AuditEntry) => e.entity)[9]).toBe('Item 0')
    const p4 = (await api(probe, 'GET', '/api/audit?pageSize=10&page=4', { cookie })).json()
    expect(p4.items).toEqual([])
    expect(p4.total).toBe(30)
  })

  it('padrão pageSize 50 e página 1', async () => {
    const body = (await api(probe, 'GET', '/api/audit', { cookie })).json()
    expect(body.pageSize).toBe(50)
    expect(body.page).toBe(1)
    expect(body.items).toHaveLength(30)
  })

  it('filtra por ação, pessoa e período (data inclui o dia inteiro; data e hora ISO exata)', async () => {
    const byAction = (await api(probe, 'GET', '/api/audit?action=aprovar', { cookie })).json()
    expect(byAction.total).toBe(15)
    expect(byAction.items.every((e: AuditEntry) => e.action === 'aprovar')).toBe(true)
    const byActor = (await api(probe, 'GET', '/api/audit?actorId=u_alvo', { cookie })).json()
    expect(byActor.total).toBe(10)
    expect(byActor.items.every((e: AuditEntry) => e.actorId === 'u_alvo')).toBe(true)
    const range = (await api(probe, 'GET', '/api/audit?from=2026-03-12&to=2026-03-14', { cookie })).json()
    expect(range.items.map((e: AuditEntry) => e.entity)).toEqual(['Item 4', 'Item 3', 'Item 2'])
    const iso = (await api(probe, 'GET', `/api/audit?from=${encodeURIComponent('2026-03-12T12:00:01Z')}&to=${encodeURIComponent('2026-03-14T12:00:00Z')}`, { cookie })).json()
    expect(iso.items.map((e: AuditEntry) => e.entity)).toEqual(['Item 4', 'Item 3'])
    const combined = (await api(probe, 'GET', '/api/audit?action=aprovar&actorId=u_alvo&from=2026-03-10&to=2026-04-30', { cookie })).json()
    expect(combined.total).toBe(5)
    const blanks = (await api(probe, 'GET', '/api/audit?action=&actorId=&from=&to=', { cookie })).json()
    expect(blanks.total).toBe(30)
  })

  it.each([
    'pageSize=201',
    'pageSize=0',
    'page=0',
    'page=abc',
    'action=apagar',
    'from=ontem',
    'to=2026-13-45',
    `actorId=${'x'.repeat(101)}`,
  ])('consulta inválida (%s) → 400', async (qs) => {
    const r = await api(probe, 'GET', `/api/audit?${qs}`, { cookie })
    expect(r.statusCode).toBe(400)
    expect(r.json().error.code).toBe('dados_invalidos')
  })

  it('pageSize 200 é aceito', async () => {
    expect((await api(probe, 'GET', '/api/audit?pageSize=200', { cookie })).statusCode).toBe(200)
  })

  it('exige auditoria.ver: Financeiro → 403; sem sessão → 401; injeção na consulta não passa', async () => {
    const fin = await loginAs(probe, 'financeiro')
    const r = await api(probe, 'GET', '/api/audit', { cookie: fin.cookie })
    expect(r.statusCode).toBe(403)
    expect(r.json().error.code).toBe('sem_permissao')
    expect((await api(probe, 'GET', '/api/audit')).statusCode).toBe(401)
    const inj = await api(probe, 'GET', `/api/audit?actorId=${encodeURIComponent("' or 1=1 --")}`, { cookie })
    expect(inj.statusCode).toBe(200)
    expect(inj.json().total).toBe(0)
  })
})

describe('GET /api/audit/export.csv', () => {
  it('gera CSV com ; e BOM, nome auditoria-AAAA-MM-DD.csv, aplica filtros e audita a exportação', async () => {
    const probe = await createTestApp()
    const { cookie, user } = await loginAs(probe, 'superadmin', { name: 'Exportadora' })
    await insertAudit(probe, { at: '2026-05-01T10:00:00Z', action: 'aprovar', entity: 'Saque #1', summary: 'Valor; com "aspas"', actorName: 'Bia' })
    await insertAudit(probe, { at: '2026-05-02T10:00:00Z', action: 'editar', entity: 'Cupom', summary: '=HYPERLINK("http://mal")', actorName: 'Caio' })
    await insertAudit(probe, { at: '2026-05-03T10:00:00Z', action: 'aprovar', entity: 'Saque #2', summary: 'ok', actorName: 'Duda' })

    const r = await api(probe, 'GET', '/api/audit/export.csv?action=aprovar', { cookie, ip: '10.1.1.1' })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/)
    const today = new Date().toISOString().slice(0, 10)
    expect(r.headers['content-disposition']).toBe(`attachment; filename="auditoria-${today}.csv"`)
    const raw = r.rawPayload
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = raw.toString('utf8').replace(/^﻿/, '')
    const lines = text.trim().split('\r\n')
    expect(lines[0]).toBe('Data e hora;Quem fez;Ação;Entidade;Resumo;IP;Origem')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('Saque #2')
    expect(lines[1]).toContain('Aprovou')
    expect(lines[1]).toMatch(/^03\/05\/2026 07:00:00;Duda;/)
    expect(lines[2]).toContain('"Valor; com ""aspas"""')
    expect(text).not.toContain('Cupom')

    const all = await api(probe, 'GET', '/api/audit/export.csv', { cookie })
    const allText = all.rawPayload.toString('utf8')
    expect(allText).toContain(`"'=HYPERLINK(""http://mal"")"`)
    expect(allText).toMatch(/;Duda;Aprovou;Saque #2;ok;1\.2\.3\.4;servidor\r\n/)

    const exports = await probe.db.query<{ action: string; actor_id: string; entity: string; summary: string; ip: string }>(
      `select * from audit_log where action = 'exportar' order by id`,
    )
    expect(exports).toHaveLength(2)
    expect(exports[0]).toMatchObject({ actor_id: user.id, entity: 'Auditoria', ip: '10.1.1.1' })
    expect(exports[0].summary).toContain('2 registros')
    expect(exports[0].summary).toContain('Aprovou')
    await probe.close()
  })

  it('exige auditoria.exportar (ver não basta); filtros inválidos → 400', async () => {
    await createRole(app, 'so-ve-auditoria', ['auditoria.ver'])
    const viewer = await loginAs(app, 'so-ve-auditoria')
    expect((await api(app, 'GET', '/api/audit', { cookie: viewer.cookie })).statusCode).toBe(200)
    const r = await api(app, 'GET', '/api/audit/export.csv', { cookie: viewer.cookie })
    expect(r.statusCode).toBe(403)
    expect(r.json().error.code).toBe('sem_permissao')
    const fin = await loginAs(app, 'financeiro')
    expect((await api(app, 'GET', '/api/audit/export.csv', { cookie: fin.cookie })).statusCode).toBe(403)
    expect((await api(app, 'GET', '/api/audit/export.csv')).statusCode).toBe(401)
    const bad = await api(app, 'GET', '/api/audit/export.csv?action=zzz', { cookie: admin.cookie })
    expect(bad.statusCode).toBe(400)
  })

  it('células perigosas para planilha são neutralizadas', () => {
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('+55 11')).toBe("'+55 11")
    expect(csvCell('-2')).toBe("'-2")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('linha\nnova')).toBe('"linha\nnova"')
    expect(csvCell(null)).toBe('')
    expect(csvCell('normal')).toBe('normal')
  })
})

describe('kv auditoria.registros', () => {
  it('devolve os 1000 mais recentes como AuditEntry (id em texto)', async () => {
    const probe = await createTestApp()
    await probe.db.query(
      `insert into audit_log (at, actor_id, actor_name, action, entity, summary, ip)
       select now() - (g || ' seconds')::interval, 'u1', 'Pessoa', 'editar', 'E' || g, 'S', '1.1.1.1' from generate_series(1, 1005) g`,
    )
    const auth = await authFor(probe, 'superadmin')
    const v = await kvHandlers.audit!.read(kvCtx(probe, auth))
    const list = v!.value as AuditEntry[]
    expect(list).toHaveLength(1000)
    expect(list[0]).toEqual({
      id: expect.any(String),
      at: expect.any(String),
      actorId: 'u1',
      actorName: 'Pessoa',
      action: 'editar',
      entity: 'E1',
      summary: 'S',
      ip: '1.1.1.1',
      source: 'servidor',
    })
    expect(list[999].entity).toBe('E1000')
    expect(v!.version).toBeGreaterThanOrEqual(1005)
    expect(v!.updatedAt).toBe(list[0].at)
    expect(kvHandlers.audit!.write).toBeUndefined()
    await probe.close()
  })

  it(`relatados pelo painel têm janela própria (${AUDIT_KV_PANEL_LIMIT}): uma rajada deles não tira da chave os registros do servidor`, async () => {
    const probe = await createTestApp()
    await probe.db.query(
      `insert into audit_log (at, actor_id, actor_name, action, entity, summary, ip, source)
       select now() - interval '1 hour' - (g || ' seconds')::interval, 'u_real', 'Real', 'aprovar', 'Saque #' || g, 'S', '1.1.1.1', 'servidor'
       from generate_series(1, 5) g`,
    )
    await probe.db.query(
      `insert into audit_log (at, actor_id, actor_name, action, entity, summary, ip, source)
       select now() - (g || ' milliseconds')::interval, 'u_flood', 'Flood', 'editar', 'Promoção x', 'x', '2.2.2.2', 'painel'
       from generate_series(1, ${AUDIT_KV_LIMIT + 300}) g`,
    )
    const auth = await authFor(probe, 'superadmin')
    const v = (await kvHandlers.audit!.read(kvCtx(probe, auth)))!
    const list = v.value as AuditEntry[]
    expect(list.filter((e) => e.actorId === 'u_real')).toHaveLength(5)
    expect(list.filter((e) => e.source === 'painel')).toHaveLength(AUDIT_KV_PANEL_LIMIT)
    expect(list).toHaveLength(5 + AUDIT_KV_PANEL_LIMIT)
    // continua do mais recente para o mais antigo, misturando as duas origens
    const times = list.map((e) => Date.parse(e.at))
    expect(times.every((t, i) => i === 0 || times[i - 1] >= t)).toBe(true)
    expect(list[0].source).toBe('painel')
    expect(list[list.length - 1].actorId).toBe('u_real')
    expect(v.version).toBeGreaterThanOrEqual(5 + AUDIT_KV_LIMIT + 300)
    await probe.close()
  })

  it('registro sem pessoa (sistema) sai com actorId vazio; lista vazia é []', async () => {
    const probe = await createTestApp()
    const auth = await authFor(probe, 'superadmin')
    expect((await kvHandlers.audit!.read(kvCtx(probe, auth)))?.value).toEqual([])
    await insertAudit(probe, { at: new Date().toISOString(), actorId: null, actorName: 'Sistema' })
    const list = (await kvHandlers.audit!.read(kvCtx(probe, auth)))!.value as AuditEntry[]
    expect(list[0].actorId).toBe('')
    await probe.close()
  })

  it('leitura conforme a regra: Equipe/Segurança do painel leem; Financeiro não', async () => {
    await createRole(app, 'so-equipe', ['equipe.ver'])
    expect(await kvHandlers.audit!.read(kvCtx(app, await authFor(app, 'so-equipe')))).toBeTruthy()
    await expect(kvHandlers.audit!.read(kvCtx(app, await authFor(app, 'financeiro')))).rejects.toMatchObject({ status: 403 })
  })
})

// Regressão r1-exposure-9: a resposta da auditoria (e-mails, IPs, nomes de jogadores) não pode ficar
// no cache em disco do navegador da pessoa da equipe depois do logout.
describe('Cache-Control: no-store nas rotas /api/audit', () => {
  it('GET /api/audit (com e-mail e IP nos dados) sai com no-store', async () => {
    const probe = await createTestApp()
    const { cookie } = await loginAs(probe, 'superadmin')
    const ev = await api(probe, 'POST', '/api/audit/events', {
      cookie,
      body: { action: 'editar', entity: 'Jogador #42', summary: 'E-mail do jogador alterado para maria.silva@gmail.com' },
    })
    expect(ev.statusCode).toBe(201)
    expect(String(ev.headers['cache-control'] ?? '')).toContain('no-store')

    const res = await api(probe, 'GET', '/api/audit', { cookie, ip: '203.0.113.7' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('maria.silva@gmail.com')
    expect(res.body).toContain('127.0.0.1') // IP de quem gravou o evento
    expect(String(res.headers['cache-control'] ?? '')).toContain('no-store')

    // respostas de erro da mesma rota também
    const fin = await loginAs(probe, 'financeiro')
    const denied = await api(probe, 'GET', '/api/audit', { cookie: fin.cookie })
    expect(denied.statusCode).toBe(403)
    expect(String(denied.headers['cache-control'] ?? '')).toContain('no-store')
    const bad = await api(probe, 'GET', '/api/audit?pageSize=999', { cookie })
    expect(bad.statusCode).toBe(400)
    expect(String(bad.headers['cache-control'] ?? '')).toContain('no-store')

    // a exportação mantém o próprio cabeçalho
    const csv = await api(probe, 'GET', '/api/audit/export.csv', { cookie })
    expect(csv.statusCode).toBe(200)
    expect(csv.headers['cache-control']).toBe('no-store')
    await probe.close()
  })
})

// ---------------------------------------------------------------------------
// Política dos eventos relatados pelo painel (shared/audit.ts › panelAuditDecision)
// ---------------------------------------------------------------------------

describe('panelAuditDecision: eventos que as telas relatam', () => {
  // amostra de cada audit() do painel (src/**), com nomes de exemplo
  const reported: [AuditAction, string][] = [
    ['editar', 'Promoção Boas-vindas'], ['criar', 'Promoção Cópia'], ['ligar', 'Promoção X'], ['desligar', 'Promoção X'], ['excluir', 'Promoção X'], ['exportar', 'Promoções'],
    ['criar', 'Bônus de depósito Dobro'], ['exportar', 'Bônus de depósito'],
    ['criar', 'Cupom BEMVINDO'], ['excluir', 'Cupom BEMVINDO'], ['exportar', 'Cupons · resgates'], ['exportar', 'Cupons'],
    ['editar', 'Disparo "Black Friday"'], ['enviar', 'Disparo "Black Friday"'], ['exportar', 'Disparos'],
    ['exportar', 'Estatísticas de webhooks'],
    ['criar', 'Free spins Sexta'], ['ligar', 'Free spins Sexta'], ['exportar', 'Free spins'],
    ['exportar', 'Indicação · indicadores'],
    ['ligar', 'Jornada "Reativação"'], ['excluir', 'Jornada "Reativação"'], ['exportar', 'Jornadas'],
    ['editar', 'Loja · compra lc1'], ['criar', 'Loja · Camiseta'], ['exportar', 'Loja · compras'],
    ['criar', 'Missão Diária'], ['exportar', 'Missões'],
    ['editar', 'Notificação'], ['enviar', 'Notificação'], ['exportar', 'Notificações'],
    ['criar', 'Popup "Promo"'], ['enviar', 'Inbox'], ['excluir', 'Inbox "Oi"'], ['exportar', 'Inbox'], ['exportar', 'Popups'],
    ['criar', 'Roleta VIP'], ['desligar', 'roleta do dia'], ['exportar', 'Roleta · giros'],
    ['editar', 'Rollover'],
    ['editar', 'Template Saque pago'], ['testar', 'Template Saque pago'], ['exportar', 'Templates de webhook'],
    ['desligar', 'Torneio Semanal'], ['exportar', 'Torneios'],
    ['criar', 'Webhook Saque pago'], ['testar', 'Webhook Saque pago'], ['excluir', 'Webhook Saque pago'],
    ['editar', 'Sportsbook Betby'], ['testar', 'Sportsbook Betby'], ['editar', 'Agregador Metagrator'], ['testar', 'Agregador Metagrator'],
    ['editar', 'Jogo Gates of Olympus'], ['exportar', 'Jogos'],
    ['editar', 'Provedora Pragmatic'], ['exportar', 'Provedoras'], ['sincronizar', 'Provedoras'],
    ['criar', 'Vitrine Top 10'], ['editar', 'Vitrines de jogos'],
    ['exportar', 'Auditoria'],
    ['desligar', 'Cadastro · data de nascimento'],
    ['criar', 'Cargo Analista'], ['excluir', 'Cargo Analista'], ['ligar', 'Cargos e permissões'], ['editar', 'Cargos e permissões'],
    ['testar', 'Domínios'],
    ['criar', 'Equipe · Ana'], ['editar', 'Equipe · Ana'], ['enviar', 'Equipe · ana@x.com'], ['excluir', 'Equipe · ana@x.com'], ['ligar', 'Equipe · Ana'], ['exportar', 'Equipe'],
    ['editar', 'Fatura 2026-001'], ['exportar', 'Faturas'], ['exportar', 'Fatura 2026-001'],
    ['editar', 'Gateway PixPay'], ['excluir', 'Conta PixPay · Principal'],
    ['desligar', 'Integração Mailgun'], ['ligar', 'Integração SendWork'], ['testar', 'Integrações · e-mail'],
    ['ligar', 'Manutenção'], ['desligar', 'Manutenção'], ['editar', 'Manutenção'],
    ['criar', 'Chave MCP "Claude"'],
    ['desligar', 'Módulo Cassino'],
    ['bloquear', 'País AR · Argentina'], ['excluir', 'País AR · Argentina'],
    ['criar', 'Segurança do painel'], ['excluir', 'Segurança do painel'],
    ['testar', 'Suporte · chat ao vivo'],
    ['editar', 'E-mail "Boas-vindas"'], ['testar', 'E-mail "Boas-vindas"'],
    ['criar', 'Termos de uso v3'], ['criar', 'Política de bônus v2'],
    ['testar', 'Pixel Meta'],
    ['editar', 'Comissão CPA'],
    ['editar', 'Apuração Pragmatic mar/2026'], ['exportar', 'Apurações de GGR'], ['exportar', 'GGR por jogo'], ['exportar', 'GGR por provedor'],
    ['exportar', 'Indicados'],
    ['ligar', 'Link ?ref=ABC'], ['editar', 'Link de João'], ['exportar', 'Links'],
    ['exportar', 'Ranking de afiliados'], ['exportar', 'Rankings'],
    ['exportar', 'Transações'], ['exportar', 'Usuários'], ['editar', 'Jogador #p1'],
    ['exportar', 'Depósitos'], ['sincronizar', 'Depósito #d1'], ['exportar', 'Saques'],
    ['criar', 'Banner "Hero"'], ['editar', 'Banners · Topo'],
    ['editar', 'Identidade e tema'], ['editar', 'Página inicial'], ['editar', 'SEO avançado'], ['editar', 'Sportsbook'],
    ['bloquear', 'IP 1.2.3.4'], ['desbloquear', 'Bloqueio do IP 1.2.3.4'], ['desbloquear', 'Bloqueio da rede n1'], ['exportar', 'Anti-fraude'],
    ['ligar', 'Modo de ataque'], ['desligar', 'Modo de ataque'],
    ['criar', 'Gerente Maria'], ['editar', 'Contrato de Maria'], ['exportar', 'Gerentes de afiliados'], ['exportar', 'Saques de afiliados'], ['exportar', 'Afiliados · Visão geral'],
    ['editar', 'Empresa e licença'],
  ]

  it.each(reported)('aceita %s "%s" (com a permissão da tela)', (action, entity) => {
    const d = panelAuditDecision(action, entity)
    expect(d.ok, JSON.stringify(d)).toBe(true)
    if (d.ok) expect(d.perms.length).toBeGreaterThan(0)
  })

  it.each([
    // ações que só o servidor registra
    ['aprovar', 'Saque #SQ1', 'acao_do_servidor'],
    ['recusar', 'Saque de afiliado #A1', 'acao_do_servidor'],
    ['revelar', 'Saque #SQ1', 'acao_do_servidor'],
    ['revelar', 'Jogador #p1', 'acao_do_servidor'],
    ['revelar', 'Webhook Saque pago', 'acao_do_servidor'],
    ['banir', 'Rede n1', 'acao_do_servidor'],
    ['creditar', 'Jogador #p1', 'acao_do_servidor'],
    ['estornar', 'Transação #t1', 'acao_do_servidor'],
    ['desativar', 'Equipe · Ana', 'acao_do_servidor'],
    ['convidar', 'Equipe · ana@x.com', 'acao_do_servidor'],
    ['revogar', 'Chave MCP "Claude"', 'acao_do_servidor'],
    ['aprovar', 'Loja · compra lc1', 'acao_do_servidor'],
    ['login', 'Acesso ao painel', 'acao_do_servidor'],
    // entidades que só o servidor grava
    ['editar', 'Dados · Promoções', 'entidade_do_servidor'],
    ['exportar', 'Saque #SQ1', 'entidade_do_servidor'],
    ['ligar', '2FA', 'entidade_do_servidor'],
    ['editar', '2FA · Ana', 'entidade_do_servidor'],
    ['editar', 'Senha', 'entidade_do_servidor'],
    ['criar', 'Acesso ao painel', 'entidade_do_servidor'],
    // fora da lista / ação que a tela não relata
    ['editar', 'Qualquer coisa', 'evento_desconhecido'],
    ['ligar', 'Modo  de ataque', 'evento_desconhecido'],
    ['ligar', 'modo de ataque', 'evento_desconhecido'],
    ['editar', 'Modo de ataque', 'evento_desconhecido'],
    ['excluir', 'Manutenção', 'evento_desconhecido'],
    ['ligar', 'Empresa e licença', 'evento_desconhecido'],
    ['editar', 'Segurança do painel', 'evento_desconhecido'],
    ['editar', 'Promoção ', 'evento_desconhecido'],
    ['editar', 'Termos de uso', 'evento_desconhecido'],
  ] as [AuditAction, string, string][])('recusa %s "%s" (%s)', (action, entity, reason) => {
    expect(panelAuditDecision(action, entity)).toEqual({ ok: false, reason })
  })

  it('permissão exigida: editar a tela; exportar = permissão de exportação, se houver, ou ver a tela', () => {
    expect(panelAuditDecision('ligar', 'Modo de ataque')).toMatchObject({ ok: true, perms: ['modo-ataque.editar'] })
    expect(panelAuditDecision('ligar', 'Manutenção')).toMatchObject({ ok: true, perms: ['manutencao.editar'] })
    expect(panelAuditDecision('editar', 'Empresa e licença')).toMatchObject({ ok: true, perms: ['empresa.editar'] })
    expect(panelAuditDecision('exportar', 'Usuários')).toMatchObject({ ok: true, perms: ['usuarios.exportar'] })
    expect(panelAuditDecision('exportar', 'Auditoria')).toMatchObject({ ok: true, perms: ['auditoria.exportar'] })
    expect(panelAuditDecision('exportar', 'Promoções')).toMatchObject({ ok: true, perms: ['promocoes.ver', 'promocoes.editar'] })
    expect(panelAuditDecision('bloquear', 'IP 1.2.3.4')).toMatchObject({ ok: true, perms: ['antifraude.banir'] })
    expect(panelAuditDecision('testar', 'Domínios')).toMatchObject({ ok: true, perms: ['dominios.ver'] })
  })

  it('isPanelReported / rótulo da origem', () => {
    expect(isPanelReported({ source: 'painel' })).toBe(true)
    expect(isPanelReported({ source: 'servidor' })).toBe(false)
    expect(isPanelReported({})).toBe(false)
    expect(AUDIT_SOURCE_LABEL.painel).toContain('não verificado')
  })
})

// ---------------------------------------------------------------------------
// Regressão r2-audit-forgery-attribution-1: qualquer cargo logado gravava, via POST /api/audit/events, linhas
// com ações sensíveis (aprovar/revelar/banir/creditar/estornar/desativar/ligar) sobre entidades que não pode
// tocar, e as telas (Modo de ataque, Manutenção, Auditoria) as tratavam como reais.
// ---------------------------------------------------------------------------

describe('regressão r2-audit-forgery-attribution-1: auditoria forjada por qualquer cargo logado', () => {
  // cópias literais da lógica das telas
  const SENSITIVE_ACTIONS = ['revelar', 'banir', 'desativar', 'ligar'] // KPI "Ações sensíveis"
  const modoAtaqueHistory = (log: AuditEntry[]) => log.filter((a) => a.entity === 'Modo de ataque').slice(0, 6) // ModoAtaque.tsx
  const manutencaoLastOn = (log: AuditEntry[]) => log.find((a) => a.entity === 'Manutenção' && a.action === 'ligar') // Manutencao.tsx

  let probe: FastifyInstance
  let daniel: Awaited<ReturnType<typeof loginAs>>
  let mkt: Awaited<ReturnType<typeof createUser>>

  async function insertWithdrawal(a: FastifyInstance) {
    const id = newId('SQ')
    await a.db.query(
      `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                                risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
       values ($1, 'p1', 'Jogador Teste', 'jogador@exemplo.com', 480000, 0, 'pendente', 'baixo', 10, '["motivo"]'::jsonb, 'CPF', $2, 'E123', now(), now())`,
      [id, a.cipher.encrypt('12345678909')],
    )
    return id
  }

  /** Login real (POST /api/auth/login) — o mesmo que a pessoa de marketing faz no navegador. */
  async function realLogin(email: string, password: string, ip: string) {
    const r = await api(probe, 'POST', '/api/auth/login', { body: { email, password }, ip })
    expect(r.statusCode, r.body).toBe(200)
    expect(r.json().stage).toBe('active')
    const c = cookieFrom(r)
    expect(c).toBeTruthy()
    return c as string
  }

  async function kvAudit(): Promise<AuditEntry[]> {
    const kv = await api(probe, 'GET', '/api/kv/auditoria.registros', { cookie: daniel.cookie })
    expect(kv.statusCode, kv.body).toBe(200)
    return (kv.json().value ?? []) as AuditEntry[]
  }

  beforeAll(async () => {
    probe = await createTestApp()
    daniel = await loginAs(probe, 'superadmin', { name: 'Daniel Carius' })
    mkt = await createUser(probe, { roleId: 'marketing', name: 'Mário Marketing', email: 'mario@x2win.test' })
  })
  afterAll(async () => probe.close())

  it('marketing não grava ações sensíveis nem vira o "último a ligar" do Modo de ataque / Manutenção', async () => {
    const saqueId = await insertWithdrawal(probe)
    const mktCookie = await realLogin(mkt.email, mkt.password, '177.7.7.7')

    // controle: marketing NÃO pode aprovar o saque de verdade
    expect((await api(probe, 'POST', `/api/withdrawals/${saqueId}/approve`, { cookie: mktCookie, ip: '177.7.7.7' })).statusCode).toBe(403)

    // ações reais do Superadmin: aprova o saque (linha do servidor) e liga Modo de ataque / Manutenção (relato do painel)
    expect((await api(probe, 'POST', `/api/withdrawals/${saqueId}/approve`, { cookie: daniel.cookie, ip: '200.1.1.1' })).statusCode).toBe(200)
    const on1 = await api(probe, 'POST', '/api/audit/events', { cookie: daniel.cookie, ip: '200.1.1.1', body: { action: 'ligar', entity: 'Modo de ataque', summary: 'Ligado com captcha; desligamento manual' } })
    const on2 = await api(probe, 'POST', '/api/audit/events', { cookie: daniel.cookie, ip: '200.1.1.1', body: { action: 'ligar', entity: 'Manutenção', summary: 'Site fechado para manutenção. Previsão de volta: sem previsão' } })
    expect([on1.statusCode, on2.statusCode]).toEqual([201, 201])

    // marketing tenta forjar linhas sensíveis
    const forged: [string, string][] = [
      ['aprovar', `Saque #${saqueId}`],
      ['revelar', `Saque #${saqueId}`],
      ['banir', `Saque #${saqueId}`],
      ['creditar', `Saque #${saqueId}`],
      ['estornar', `Saque #${saqueId}`],
      ['desativar', `Saque #${saqueId}`],
      ['ligar', 'Modo de ataque'],
      ['ligar', 'Manutenção'],
      ['editar', `Saque #${saqueId}`],
      ['editar', 'Dados · Saques'],
    ]
    const codes: number[] = []
    for (const [action, entity] of forged) {
      const r = await api(probe, 'POST', '/api/audit/events', {
        cookie: mktCookie,
        ip: '177.7.7.7',
        body: { action, entity, summary: 'Saque de R$ 4.800,00 de Jogador Teste aprovado por Daniel Carius' },
      })
      codes.push(r.statusCode)
    }
    expect(codes, 'marketing gravou ações sensíveis que não pode executar').toEqual(forged.map(() => 403))

    const log = await kvAudit()
    expect(log.some((e) => e.actorId === mkt.id && e.action !== 'login')).toBe(false)
    expect(log.filter((e) => e.actorId === mkt.id && SENSITIVE_ACTIONS.includes(e.action))).toEqual([])
    expect(modoAtaqueHistory(log)[0]?.actorName).toBe('Daniel Carius')
    expect(manutencaoLastOn(log)?.actorName).toBe('Daniel Carius')
    // a aprovação real é do servidor; os relatos do Daniel saem marcados como do painel (não verificados)
    const real = log.find((e) => e.entity === `Saque #${saqueId}` && e.action === 'aprovar')
    expect(real).toMatchObject({ actorId: daniel.user.id, source: 'servidor' })
    expect(modoAtaqueHistory(log)[0]).toMatchObject({ source: 'painel' })

    // o que marketing PODE fazer continua relatável (e sai marcado como relatado)
    const own = await api(probe, 'POST', '/api/audit/events', { cookie: mktCookie, ip: '177.7.7.7', body: { action: 'ligar', entity: 'Promoção Boas-vindas', summary: 'Promoção ligada' } })
    expect(own.statusCode).toBe(201)

    // CSV: a coluna Origem diz que o relato não foi verificado
    const csv = (await api(probe, 'GET', '/api/audit/export.csv', { cookie: daniel.cookie })).rawPayload.toString('utf8')
    expect(csv).toContain(';Mário Marketing;Ligou;Promoção Boas-vindas;Promoção ligada;177.7.7.7;relatado pelo painel (não verificado)\r\n')
    expect(csv).toMatch(new RegExp(`;Daniel Carius;Aprovou;Saque #${saqueId};[^\\r\\n]*;servidor\\r\\n`))
  })

  it('inundar /api/audit/events não tira a aprovação real de saque da chave auditoria.registros', async () => {
    const saqueId = await insertWithdrawal(probe)
    expect((await api(probe, 'POST', `/api/withdrawals/${saqueId}/approve`, { cookie: daniel.cookie, ip: '200.1.1.1' })).statusCode).toBe(200)
    expect((await kvAudit()).some((e) => e.entity === `Saque #${saqueId}` && e.action === 'aprovar')).toBe(true)

    // 9 logins reais (limite de login 10/min por IP); antes eram 9 cotas de 120/min
    const cookies: string[] = []
    for (let i = 0; i < 9; i++) cookies.push(await realLogin(mkt.email, mkt.password, '177.7.7.8'))
    let ok = 0
    for (const c of cookies) {
      for (let i = 0; i < 115; i++) {
        const r = await api(probe, 'POST', '/api/audit/events', { cookie: c, ip: '177.7.7.8', body: { action: 'editar', entity: 'Promoção Boas-vindas', summary: `ajuste ${i}` } })
        if (r.statusCode === 201) ok++
      }
    }
    // a pessoa tem uma cota só (o teste anterior já gastou 1 dela)
    expect(ok).toBeLessThanOrEqual(EVENTS_PER_USER_PER_MINUTE)
    const after = await kvAudit()
    expect(after.some((e) => e.entity === `Saque #${saqueId}` && e.action === 'aprovar'), 'a aprovação real sumiu da tela Auditoria').toBe(true)
  }, 120_000)
})

// ---------------------------------------------------------------------------
// Regressão r2-audit-forgery-attribution-3: um IP abria várias sessões pelo login e cada uma tinha a sua cota
// de 120/min (o limite da rota substitui o global de 600/min por IP); em segundos as linhas lixo empurravam
// para fora de auditoria.registros todas as linhas reais do Superadmin.
// ---------------------------------------------------------------------------

describe('regressão r2-audit-forgery-attribution-3: inundação da auditoria', () => {
  it('um IP/pessoa de cargo baixo não tira do painel as linhas reais da auditoria', async () => {
    const probe = await createTestApp()
    try {
      const daniel = await loginAs(probe, 'superadmin', { name: 'Daniel Carius', email: 'daniel@x2win.test', password: 'SenhaForte2026' })
      const dLogin = await api(probe, 'POST', '/api/auth/login', { ip: '200.10.10.10', body: { email: 'daniel@x2win.test', password: 'SenhaForte2026' } })
      expect(dLogin.statusCode).toBe(200)
      const saqueId = newId('SQ')
      await probe.db.query(
        `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                                  risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
         values ($1, 'p1', 'Jogador Teste', 'jogador@exemplo.com', 300000, 0, 'pendente', 'baixo', 10, '["motivo"]'::jsonb, 'CPF', $2, 'E123', now(), now())`,
        [saqueId, probe.cipher.encrypt('12345678909')],
      )
      expect((await api(probe, 'POST', `/api/withdrawals/${saqueId}/approve`, { cookie: daniel.cookie, ip: '200.10.10.10' })).statusCode).toBe(200)
      const read = async () => (await api(probe, 'GET', '/api/kv/auditoria.registros', { cookie: daniel.cookie, ip: '200.10.10.10' })).json().value as AuditEntry[]
      const danielBefore = (await read()).filter((e) => e.actorId === daniel.user.id)
      expect(danielBefore.map((e) => e.action).sort()).toEqual(['aprovar', 'login'])

      // marketing loga 10 vezes do mesmo IP sem mandar cookie: 10 sessões ativas separadas
      const mkt = await createUser(probe, { roleId: 'marketing', name: 'Mario Marketing', password: 'SenhaForte123' })
      const IP = '203.0.113.7'
      const cookies: string[] = []
      for (let i = 0; i < 10; i++) {
        const r = await api(probe, 'POST', '/api/auth/login', { ip: IP, body: { email: mkt.email, password: mkt.password } })
        const c = cookieFrom(r)
        if (r.statusCode === 200 && c) cookies.push(c)
      }
      expect(cookies.length).toBeGreaterThan(1)

      // cada sessão manda 125 eventos (que a pessoa pode relatar), todos ao mesmo tempo, do mesmo IP
      const reqs: Promise<{ statusCode: number }>[] = []
      for (const c of cookies) {
        for (let i = 0; i < 125; i++) {
          reqs.push(api(probe, 'POST', '/api/audit/events', { cookie: c, ip: IP, body: { action: 'editar', entity: 'Promoção x', summary: 'x' } }))
        }
      }
      const results = await Promise.all(reqs)
      const accepted = results.filter((r) => r.statusCode === 201).length
      expect(accepted, 'eventos aceitos de uma pessoa num minuto').toBeLessThanOrEqual(EVENTS_PER_USER_PER_MINUTE)
      expect(accepted).toBeGreaterThan(0)

      // mesmo com a janela inteira de relatados ocupada, as linhas do servidor continuam visíveis
      await probe.db.query(
        `insert into audit_log (actor_id, actor_name, action, entity, summary, ip, source)
         select $1, 'Mario Marketing', 'editar', 'Promoção x', 'x', $2, 'painel' from generate_series(1, ${AUDIT_KV_LIMIT + 200})`,
        [mkt.id, IP],
      )
      const after = await read()
      expect(after.filter((e) => e.actorId === daniel.user.id).length, 'linhas do Superadmin visíveis depois da inundação').toBe(danielBefore.length)
    } finally {
      await probe.close()
    }
  }, 120_000)
})
