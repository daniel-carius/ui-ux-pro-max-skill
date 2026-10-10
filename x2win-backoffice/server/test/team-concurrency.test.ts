// Regressão r3-real-postgres-concurrency-and-grants-1 (equipe, cargos e segurança do painel): a leitura de uma chave
// de domínio devolve a versão e os dados do mesmo instante (readSnapshot). Antes, dados e versão saíam de duas
// instruções soltas: uma gravação que terminava entre elas fazia o GET devolver o conteúdo velho com a versão nova, e
// o painel, ao salvar a lista inteira com essa versão, desfazia em silêncio a alteração de outra pessoa (sem 409).
//
// O intervalo é forçado de forma determinística: o GET de quem lê fica parado logo depois da primeira instrução de
// leitura (dados ou versão, na ordem em que o código rodar) e a outra pessoa grava nesse meio-tempo. No PGlite as
// transações são exclusivas: com a leitura numa transação, a gravação espera a leitura terminar (ela é liberada
// depois de uma espera curta). Também vale a regressão de r3-...-grants-2 que dá para ver sem Postgres de verdade:
// a exclusão de cargo que muda pessoas de cargo avança a versão da equipe.
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/db'
import { api, createTestApp, createUser, loginAs } from './helpers'

type Match = (sql: string, params: unknown[]) => boolean
let app: FastifyInstance
let armed: { match: Match; parked: () => void; gate: Promise<void> } | null = null

/** Intercepta query/one do banco e das transações abertas a partir dele (para parar a instrução escolhida). */
function hook(db: Db) {
  const query = db.query.bind(db)
  const one = db.one.bind(db)
  const tx = db.tx.bind(db)
  const around = async <T>(sql: string, params: unknown[], run: () => Promise<T>): Promise<T> => {
    const g = armed
    if (!g || !g.match(sql, params)) return run()
    armed = null
    const out = await run()
    g.parked()
    await g.gate
    return out
  }
  db.query = ((sql: string, params: unknown[] = []) => around(sql, params, () => query(sql, params))) as Db['query']
  db.one = ((sql: string, params: unknown[] = []) => around(sql, params, () => one(sql, params))) as Db['one']
  db.tx = ((fn: (t: Db) => Promise<unknown>) =>
    tx((t) => {
      hook(t)
      return fn(t)
    })) as Db['tx']
}

const versionRead = (key: string): Match => (sql, p) => sql.startsWith('select value, updated_at from settings where key = $1') && p[0] === key

/** GET parado logo depois da primeira instrução de leitura que casar com `match`. */
async function parkedGet(key: string, cookie: string, match: Match) {
  let release!: () => void
  let parked!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const isParked = new Promise<void>((r) => (parked = r))
  armed = { match, parked, gate }
  const res = api(app, 'GET', `/api/kv/${key}`, { cookie })
  await isParked
  return { res, release }
}

/** Deixa a gravação rodar enquanto a leitura está parada (ou esperar por ela, se a leitura trava) e solta a leitura. */
async function whileParked<T>(write: Promise<T>, release: () => void): Promise<T> {
  await Promise.race([write, new Promise((r) => setTimeout(r, 1000))])
  release()
  return write
}

async function storedVersion(key: string) {
  const row = await app.db.one<{ value: { version?: number } }>('select value from settings where key = $1', [key])
  return Number(row?.value?.version ?? 0)
}

beforeEach(async () => {
  app = await createTestApp()
  hook(app.db)
})
afterEach(async () => {
  armed = null
  await app.close()
})

describe('GET de chave de domínio: versão e dados do mesmo instante', () => {
  it('segurança do painel: salvar a partir da leitura não desliga o 2FA para todos que outra pessoa acabou de ligar', async () => {
    const ana = await loginAs(app, 'superadmin', { totp: true, name: 'Admin Ana' })
    const bruno = await loginAs(app, 'superadmin', { totp: true, name: 'Admin Bruno' })
    const KEY = 'config.seguranca-painel'
    const g0 = (await api(app, 'GET', `/api/kv/${KEY}`, { cookie: ana.cookie })).json()
    expect(g0.value.enforce2faForAll).toBe(false)

    const { res, release } = await parkedGet(
      KEY,
      bruno.cookie,
      (sql, p) => versionRead(KEY)(sql, p) || sql.startsWith('select allowlist, enforce_2fa_all, session_timeout_minutes, updated_at from panel_security'),
    )
    const on = await whileParked(
      api(app, 'PUT', `/api/kv/${KEY}`, { cookie: ana.cookie, body: { value: { ...g0.value, enforce2faForAll: true }, version: g0.version } }),
      release,
    )
    expect(on.statusCode, on.body).toBe(200)
    const view = (await res).json()
    // conteúdo velho só viaja com a versão velha
    const fresh = view.version === on.json().version
    expect(fresh ? view.value.enforce2faForAll === true : view.version === g0.version && view.value.enforce2faForAll === false, JSON.stringify(view)).toBe(true)

    // Bruno só muda o tempo de inatividade
    const save = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: bruno.cookie, body: { value: { ...view.value, sessionTimeoutMinutes: 45 }, version: view.version } })
    expect(save.statusCode, save.body).toBe(409)
    expect(save.json().error.code).toBe('versao_desatualizada')
    const row = await app.db.one<{ enforce_2fa_all: boolean; session_timeout_minutes: number }>('select enforce_2fa_all, session_timeout_minutes from panel_security where id = 1')
    expect(row).toMatchObject({ enforce_2fa_all: true })
    expect(row?.session_timeout_minutes).not.toBe(45)
  })

  it('cargos: salvar a partir da leitura não devolve a permissão que outra pessoa acabou de retirar', async () => {
    const ana = await loginAs(app, 'superadmin', { totp: true, name: 'Admin Ana' })
    const bruno = await loginAs(app, 'superadmin', { totp: true, name: 'Admin Bruno' })
    const KEY = 'cargos.lista'
    type R = { id: string; permissions: string[]; description: string }
    const g0 = (await api(app, 'GET', `/api/kv/${KEY}`, { cookie: ana.cookie })).json() as { value: R[]; version: number }
    const removedPerm = g0.value.find((r) => r.id === 'financeiro')!.permissions[0]
    expect(removedPerm).toBeTruthy()

    const { res, release } = await parkedGet(KEY, bruno.cookie, (sql, p) => versionRead(KEY)(sql, p) || sql.startsWith('select * from roles order by system desc'))
    const cut = await whileParked(
      api(app, 'PUT', `/api/kv/${KEY}`, {
        cookie: ana.cookie,
        body: { value: g0.value.map((r) => (r.id === 'financeiro' ? { ...r, permissions: r.permissions.filter((p) => p !== removedPerm) } : r)), version: g0.version },
      }),
      release,
    )
    expect(cut.statusCode, cut.body).toBe(200)
    const view = (await res).json() as { value: R[]; version: number }
    const stillThere = view.value.find((r) => r.id === 'financeiro')!.permissions.includes(removedPerm)
    // conteúdo velho só viaja com a versão velha
    expect(stillThere ? view.version === g0.version : view.version === cut.json().version, `versão ${view.version}`).toBe(true)

    // Bruno só muda a descrição do Suporte
    const save = await api(app, 'PUT', `/api/kv/${KEY}`, {
      cookie: bruno.cookie,
      body: { value: view.value.map((r) => (r.id === 'suporte' ? { ...r, description: `${r.description} (rev)` } : r)), version: view.version },
    })
    expect(save.statusCode, save.body).toBe(409)
    expect(save.json().error.code).toBe('versao_desatualizada')
    const row = await app.db.one<{ permissions: string[] }>('select permissions from roles where id = $1', ['financeiro'])
    expect(row!.permissions).not.toContain(removedPerm)
  })

  it('equipe: salvar a partir da leitura não reativa quem outra pessoa acabou de desativar', async () => {
    const ana = await loginAs(app, 'superadmin', { totp: true, name: 'Admin Ana' })
    const bruno = await loginAs(app, 'superadmin', { totp: true, name: 'Admin Bruno' })
    const mallory = await createUser(app, { roleId: 'suporte', name: 'Mallory Suporte', totp: true })
    const KEY = 'equipe.membros'
    const v0 = await storedVersion(KEY)

    const { res, release } = await parkedGet(KEY, bruno.cookie, (sql, p) => versionRead(KEY)(sql, p) || sql.includes('order by u.created_at asc, u.id asc'))
    const off = await whileParked(api(app, 'POST', `/api/team/${mallory.id}/deactivate`, { cookie: ana.cookie, body: {} }), release)
    expect(off.statusCode, off.body).toBe(200)
    const view = (await res).json() as { value: { id: string; name: string; status: string }[]; version: number }
    const seen = view.value.find((m) => m.id === mallory.id)!.status
    // conteúdo velho só viaja com a versão velha
    expect(seen === 'ativo' ? view.version === v0 : view.version === (await storedVersion(KEY)), `${seen} na versão ${view.version}`).toBe(true)

    // Bruno só muda o próprio nome
    const save = await api(app, 'PUT', `/api/kv/${KEY}`, {
      cookie: bruno.cookie,
      body: { value: view.value.map((m) => (m.id === bruno.user.id ? { ...m, name: 'Admin Bruno Silva' } : m)), version: view.version },
    })
    expect(save.statusCode, save.body).toBe(409)
    expect(save.json().error.code).toBe('versao_desatualizada')
    expect(await app.db.one('select status from users where id = $1', [mallory.id])).toEqual({ status: 'desligado' })
  })
})

describe('exclusão de cargo com pessoas desligadas', () => {
  it('avança a versão da equipe: a lista velha da equipe não é gravada por cima (409)', async () => {
    const ana = await loginAs(app, 'superadmin', { totp: true, name: 'Admin Ana' })
    await app.db.query(
      `insert into roles (id, name, description, system, permissions, require_2fa, approval_ceiling_cents, color)
       values ('cargo_aud', 'Auditoria interna', '', false, '{dashboard.ver,promocoes.ver}', false, 0, 'violet')`,
    )
    const davi = await createUser(app, { roleId: 'cargo_aud', status: 'desligado', name: 'Davi Desligado' })
    const team0 = (await api(app, 'GET', '/api/kv/equipe.membros', { cookie: ana.cookie })).json() as { value: { id: string }[]; version: number }
    const roles0 = (await api(app, 'GET', '/api/kv/cargos.lista', { cookie: ana.cookie })).json() as { value: { id: string }[]; version: number }

    const del = await api(app, 'PUT', '/api/kv/cargos.lista', {
      cookie: ana.cookie,
      body: { value: roles0.value.filter((r) => r.id !== 'cargo_aud'), version: roles0.version },
    })
    expect(del.statusCode, del.body).toBe(200)
    expect(await app.db.one('select status, role_id from users where id = $1', [davi.id])).toEqual({ status: 'desligado', role_id: 'suporte' })
    expect(await storedVersion('equipe.membros')).toBe(team0.version + 1)
    const audit = await app.db.one<{ summary: string }>(`select summary from audit_log where entity = 'Cargo Auditoria interna' order by id desc limit 1`)
    expect(audit?.summary).toContain('1 pessoa desligada passou para Suporte')

    // a lista da equipe lida antes da exclusão (Davi ainda em cargo_aud) não é mais aceita
    const stale = await api(app, 'PUT', '/api/kv/equipe.membros', { cookie: ana.cookie, body: { value: team0.value, version: team0.version } })
    expect(stale.statusCode, stale.body).toBe(409)
    expect(stale.json().error.code).toBe('versao_desatualizada')
  })

  it('pessoa ativa ou convidada no cargo impede a exclusão (nada muda)', async () => {
    const ana = await loginAs(app, 'superadmin', { totp: true, name: 'Admin Ana' })
    await app.db.query(
      `insert into roles (id, name, description, system, permissions, require_2fa, approval_ceiling_cents, color)
       values ('cargo_aud', 'Auditoria interna', '', false, '{dashboard.ver}', false, 0, 'violet')`,
    )
    const davi = await createUser(app, { roleId: 'cargo_aud', status: 'desligado', name: 'Davi Desligado' })
    await createUser(app, { roleId: 'cargo_aud', status: 'convidado', name: 'Carla Convidada' })
    const team0 = await storedVersion('equipe.membros')
    const roles0 = (await api(app, 'GET', '/api/kv/cargos.lista', { cookie: ana.cookie })).json() as { value: { id: string }[]; version: number }
    const del = await api(app, 'PUT', '/api/kv/cargos.lista', {
      cookie: ana.cookie,
      body: { value: roles0.value.filter((r) => r.id !== 'cargo_aud'), version: roles0.version },
    })
    expect(del.statusCode, del.body).toBe(400)
    expect(del.json().error.message).toContain('Carla Convidada (convidado)')
    expect(await app.db.one('select role_id from users where id = $1', [davi.id])).toEqual({ role_id: 'cargo_aud' })
    expect(await app.db.one('select id from roles where id = $1', ['cargo_aud'])).toEqual({ id: 'cargo_aud' })
    expect(await storedVersion('equipe.membros')).toBe(team0)
  })
})
