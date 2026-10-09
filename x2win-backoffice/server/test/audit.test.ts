import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { findKvRule } from '@shared/kv-registry'
import { effectivePermissions } from '@shared/permissions'
import type { AuditEntry } from '@shared/audit'
import { getRole } from '../src/services/roles-repo'
import type { KvContext } from '../src/kv/types'
import type { AuthContext } from '../src/types'
import { kvHandlers } from '../src/modules/audit/kv'
import { csvCell } from '../src/modules/audit/format'
import { api, createTestApp, createUser, loginAs, sessionCookie } from './helpers'

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

  it('qualquer cargo com sessão ativa pode relatar (ex.: Suporte)', async () => {
    const { cookie } = await loginAs(app, 'suporte')
    const r = await api(app, 'POST', '/api/audit/events', { cookie, body: { action: 'revelar', entity: 'Jogador #1', summary: 'CPF exibido' } })
    expect(r.statusCode).toBe(201)
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
    const entity = 'E'.repeat(200)
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

  it('limite de 120 por minuto por sessão (outra sessão não é afetada)', async () => {
    const probe = await createTestApp()
    const a = await loginAs(probe, 'superadmin')
    const b = await loginAs(probe, 'superadmin')
    const body = { action: 'editar', entity: 'Carga', summary: 'teste de limite' }
    const codes: number[] = []
    for (let i = 0; i < 121; i++) codes.push((await api(probe, 'POST', '/api/audit/events', { cookie: a.cookie, body })).statusCode)
    expect(codes.slice(0, 120).every((c) => c === 201)).toBe(true)
    expect(codes[120]).toBe(429)
    const other = await api(probe, 'POST', '/api/audit/events', { cookie: b.cookie, body })
    expect(other.statusCode).toBe(201)
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
