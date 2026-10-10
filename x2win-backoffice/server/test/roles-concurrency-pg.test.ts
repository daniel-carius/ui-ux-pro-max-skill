// Regressões r3-real-postgres-concurrency-and-grants-1 e -2 no PostgreSQL 16 de verdade (READ COMMITTED, API com o
// papel x2win_app, como no docker-compose). O PGlite serializa as transações e não mostra estas corridas.
//  - cargos.lista x equipe: a gravação de cargos usa a mesma trava das alterações da equipe (equipe.membros, sempre
//    antes de cargos.lista). Uma troca de cargo no meio da exclusão do cargo não leva mais uma pessoa ativa para o
//    Suporte (com auditoria falsa), e as sobreposições não terminam em 500 (FK 23503 ou impasse 40P01).
//  - GET de chave de domínio: versão e dados saem da mesma foto (REPEATABLE READ), mesmo com uma gravação
//    terminando entre as duas leituras em outra conexão.
// Sobe um cluster descartável (initdb) em /var/lib/postgresql; sem os binários do PG16 ou sem root, o arquivo é pulado.
// Os intervalos são forçados parando instruções escolhidas (pg.Client.prototype.query é interceptado só aqui).
import { execFileSync } from 'node:child_process'
import { chownSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { migrate, openDb } from '../src/db'
import { api, createTestApp, createUser, loginAs } from './helpers'

const BIN = '/usr/lib/postgresql/16/bin'

function pgAvailable(): boolean {
  if (process.env.X2WIN_PG_TESTS === '0') return false
  if (process.platform !== 'linux' || process.getuid?.() !== 0) return false
  if (!existsSync(`${BIN}/initdb`) || !existsSync(`${BIN}/pg_ctl`) || !existsSync(`${BIN}/psql`) || !existsSync('/var/lib/postgresql')) return false
  try {
    execFileSync('id', ['-u', 'postgres'], { stdio: 'pipe' })
    execFileSync('runuser', ['--help'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

const PG = pgAvailable()
const PORT = 44000 + Math.floor(Math.random() * 2000)
let base = ''
let dbSeq = 0

function asPostgres(cmd: string, args: string[]) {
  return execFileSync('runuser', ['-u', 'postgres', '--', `${BIN}/${cmd}`, ...args], { stdio: 'pipe' }).toString()
}
function psql(db: string, sql: string) {
  return execFileSync(`${BIN}/psql`, ['-h', '127.0.0.1', '-p', String(PORT), '-U', 'x2win', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atc', sql], {
    stdio: 'pipe',
  }).toString()
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------- instruções paradas ----------
type Gate = { match: (sql: string, params: unknown[]) => boolean; when: 'before' | 'after'; parked: () => void; gate: Promise<void> }
let gates: Gate[] = []
const origQuery = pg.Client.prototype.query
type AnyFn = (...a: unknown[]) => unknown

function gatedQuery(this: pg.Client, ...args: unknown[]) {
  const [text, params] = args
  const sql = typeof text === 'string' ? text : typeof (text as { text?: unknown })?.text === 'string' ? (text as { text: string }).text : ''
  const i = sql ? gates.findIndex((g) => g.match(sql, Array.isArray(params) ? params : [])) : -1
  if (i < 0) return (origQuery as unknown as AnyFn).apply(this, args)
  const g = gates.splice(i, 1)[0]!
  const last = args[args.length - 1]
  if (typeof last === 'function') {
    // forma com callback (pg.Pool.query, fora de transação)
    if (g.when === 'before') {
      g.parked()
      void g.gate.then(() => (origQuery as unknown as AnyFn).apply(this, args))
      return undefined
    }
    args[args.length - 1] = (err: unknown, res: unknown) => {
      g.parked()
      void g.gate.then(() => (last as AnyFn)(err, res))
    }
    return (origQuery as unknown as AnyFn).apply(this, args)
  }
  return (async () => {
    if (g.when === 'before') {
      g.parked()
      await g.gate
      return (origQuery as unknown as AnyFn).apply(this, args)
    }
    const r = await (origQuery as unknown as AnyFn).apply(this, args)
    g.parked()
    await g.gate
    return r
  })()
}

function arm(match: Gate['match'], when: Gate['when'] = 'before') {
  let release!: () => void
  let parked!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const isParked = new Promise<void>((r) => (parked = r))
  gates.push({ match, when, parked, gate })
  return { isParked, release }
}

const lockWaiters = (dbName: string) =>
  Number(psql(dbName, `select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`).trim())

/** Espera a requisição terminar ou ficar esperando uma trava no banco. */
async function doneOrBlocked(dbName: string, p: Promise<unknown>) {
  let done = false
  p.then(
    () => (done = true),
    () => (done = true),
  )
  for (let i = 0; i < 400 && !done; i++) {
    if (lockWaiters(dbName) >= 1) return 'bloqueada'
    await sleep(25)
  }
  return done ? 'terminou' : 'tempo esgotado'
}

describe.skipIf(!PG)('PostgreSQL 16: cargos x equipe e leitura numa foto só', () => {
  let app: FastifyInstance
  let dbName = ''

  beforeAll(() => {
    ;(pg.Client.prototype as unknown as { query: unknown }).query = gatedQuery
    base = mkdtempSync('/var/lib/postgresql/x2win-test-roles-team-')
    const pw = Number(execFileSync('id', ['-u', 'postgres']).toString().trim())
    const gw = Number(execFileSync('id', ['-g', 'postgres']).toString().trim())
    chownSync(base, pw, gw)
    asPostgres('initdb', ['-D', `${base}/data`, '-U', 'x2win', '-A', 'trust', '--no-sync', '-E', 'UTF8', '--locale=C'])
    asPostgres('pg_ctl', [
      '-D',
      `${base}/data`,
      '-l',
      `${base}/pg.log`,
      '-w',
      'start',
      '-o',
      `-c port=${PORT} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${base} -c fsync=off -c deadlock_timeout=300ms`,
    ])
    psql('postgres', `create role x2win_app login password 'app' nosuperuser nocreatedb nocreaterole noreplication nobypassrls`)
  }, 60_000)

  afterAll(() => {
    pg.Client.prototype.query = origQuery
    try {
      asPostgres('pg_ctl', ['-D', `${base}/data`, '-m', 'immediate', 'stop'])
    } catch {
      /* já parado */
    }
    if (base) rmSync(base, { recursive: true, force: true })
  })

  beforeEach(async () => {
    gates = []
    dbName = `x2win_t${++dbSeq}`
    psql('postgres', `create database ${dbName} owner x2win`)
    // migrações com o dono das tabelas (como o serviço "migrate" do compose) e a API com x2win_app
    const owner = openDb(`postgres://x2win@127.0.0.1:${PORT}/${dbName}`)
    await migrate(owner)
    await owner.close()
    app = await createTestApp({ DATABASE_URL: `postgres://x2win_app:app@127.0.0.1:${PORT}/${dbName}` })
    expect(app.db.kind).toBe('postgres')
    expect(await app.db.one<{ u: string }>('select current_user as u')).toEqual({ u: 'x2win_app' })
  })
  afterEach(async () => {
    gates = []
    await app?.close()
  })

  async function setupRole() {
    const ana = await loginAs(app, 'superadmin', { name: 'Admin Ana' })
    await app.db.query(
      `insert into roles (id, name, description, system, permissions, require_2fa, approval_ceiling_cents, color)
       values ('cargo_aud', 'Auditoria interna', '', false, '{dashboard.ver,promocoes.ver}', false, 0, 'violet')`,
    )
    const cur = (await api(app, 'GET', '/api/kv/cargos.lista', { cookie: ana.cookie })).json() as { value: { id: string }[]; version: number }
    const withoutR = { value: cur.value.filter((r) => r.id !== 'cargo_aud'), version: cur.version }
    return { ana, withoutR }
  }

  const user = (id: string) => app.db.one<{ status: string; role_id: string }>('select status, role_id from users where id = $1', [id])

  describe('exclusão de cargo x alterações da equipe', () => {
    it('troca de cargo no meio da exclusão: a pessoa ativa não vai para o Suporte e a auditoria não mente', async () => {
      const { ana, withoutR } = await setupRole()
      const davi = await createUser(app, { roleId: 'cargo_aud', status: 'desligado', name: 'Davi Desligado' })
      const carla = await createUser(app, { roleId: 'marketing', name: 'Carla Ativa' })

      // exclusão parada logo depois de ler quem usa o cargo
      const g = arm((sql, p) => /from users where role_id = \$1/.test(sql) && p[0] === 'cargo_aud', 'after')
      const rolesPut = api(app, 'PUT', '/api/kv/cargos.lista', { cookie: ana.cookie, body: withoutR })
      await g.isParked
      // Carla (ativa, marketing) → Auditoria interna enquanto a exclusão está no meio
      const teamP = api(app, 'POST', `/api/team/${carla.id}/role`, { cookie: ana.cookie, body: { roleId: 'cargo_aud' } })
      const meanwhile = await doneOrBlocked(dbName, teamP)
      g.release()
      const [roles, team] = await Promise.all([rolesPut, teamP])

      expect(roles.statusCode, roles.body).toBe(200)
      expect(team.statusCode, team.body).toBe(400)
      expect(team.json().error.message).toContain('Cargo não encontrado')
      expect(await user(carla.id)).toEqual({ status: 'ativo', role_id: 'marketing' })
      expect(await user(davi.id)).toEqual({ status: 'desligado', role_id: 'suporte' })
      const audit = await app.db.query<{ entity: string; summary: string }>(
        `select entity, summary from audit_log where entity in ('Equipe · Carla Ativa', 'Cargo Auditoria interna') order by id`,
      )
      expect(audit).toEqual([
        { entity: 'Cargo Auditoria interna', summary: 'Cargo personalizado excluído (2 permissões); 1 pessoa desligada passou para Suporte.' },
      ])
      // a troca de cargo esperou a exclusão terminar (mesma trava da equipe)
      expect(meanwhile).toBe('bloqueada')
    })

    it('troca de cargo enquanto o cargo é excluído: 400 "Cargo não encontrado", não 500 (FK)', async () => {
      const { ana, withoutR } = await setupRole()
      const carla = await createUser(app, { roleId: 'marketing', name: 'Carla Ativa' })

      // exclusão parada logo DEPOIS de `delete from roles` (linha travada, sem commit)
      const g = arm((sql, p) => sql.startsWith('delete from roles where id = $1') && p[0] === 'cargo_aud', 'after')
      const rolesPut = api(app, 'PUT', '/api/kv/cargos.lista', { cookie: ana.cookie, body: withoutR })
      await g.isParked
      const teamP = api(app, 'POST', `/api/team/${carla.id}/role`, { cookie: ana.cookie, body: { roleId: 'cargo_aud' } })
      const meanwhile = await doneOrBlocked(dbName, teamP)
      g.release()
      const [roles, team] = await Promise.all([rolesPut, teamP])
      expect(roles.statusCode, roles.body).toBe(200)
      expect(team.statusCode, team.body).toBe(400)
      expect(team.json().error.message).toContain('Cargo não encontrado')
      expect(await user(carla.id)).toEqual({ status: 'ativo', role_id: 'marketing' })
      expect(meanwhile).toBe('bloqueada')
    })

    it('equipe.membros (renomeia B, reativa A) x exclusão do cargo: sem impasse nem 500', async () => {
      const { ana, withoutR } = await setupRole()
      const a = await createUser(app, { roleId: 'cargo_aud', status: 'desligado', name: 'Alice Desligada' })
      const b = await createUser(app, { roleId: 'cargo_aud', status: 'desligado', name: 'Bruno Desligado' })
      const team0 = (await api(app, 'GET', '/api/kv/equipe.membros', { cookie: ana.cookie })).json() as {
        value: { id: string; name: string; status: string }[]
        version: number
      }
      const body = {
        version: team0.version,
        value: team0.value.map((m) => (m.id === b.id ? { ...m, name: 'Bruno Desligado Souza' } : m.id === a.id ? { ...m, status: 'ativo' } : m)),
      }
      // equipe parada logo antes de reativar A (B já travado pela troca de nome)
      const g = arm((sql, p) => sql.startsWith('update users set status = $2, failed_logins = 0') && p[0] === a.id)
      const teamP = api(app, 'PUT', '/api/kv/equipe.membros', { cookie: ana.cookie, body })
      await g.isParked
      const rolesP = api(app, 'PUT', '/api/kv/cargos.lista', { cookie: ana.cookie, body: withoutR })
      const meanwhile = await doneOrBlocked(dbName, rolesP)
      g.release()
      const [team, roles] = await Promise.all([teamP, rolesP])
      expect(team.statusCode, team.body).toBe(200)
      // a exclusão roda depois e vê Alice ativa: recusa com a explicação, sem mexer em ninguém
      expect(roles.statusCode, roles.body).toBe(400)
      expect(roles.json().error.message).toContain('Alice Desligada (ativo)')
      expect(await user(a.id)).toEqual({ status: 'ativo', role_id: 'cargo_aud' })
      expect(await user(b.id)).toEqual({ status: 'desligado', role_id: 'cargo_aud' })
      expect(meanwhile).toBe('bloqueada')
    })
  })

  describe('GET de chave de domínio numa foto só', () => {
    const versionRead = (key: string) => (sql: string, p: unknown[]) => sql.startsWith('select value, updated_at from settings where key = $1') && p[0] === key

    it('equipe: a leitura que cruza uma desativação não volta com o status velho e a versão nova', async () => {
      const ana = await loginAs(app, 'superadmin', { name: 'Admin Ana' })
      const bruno = await loginAs(app, 'superadmin', { name: 'Admin Bruno' })
      const mallory = await createUser(app, { roleId: 'suporte', name: 'Mallory Suporte' })
      const KEY = 'equipe.membros'
      const g = arm((sql, p) => versionRead(KEY)(sql, p) || sql.includes('order by u.created_at asc, u.id asc'), 'after')
      const res = api(app, 'GET', `/api/kv/${KEY}`, { cookie: bruno.cookie })
      await g.isParked
      // a leitura não trava ninguém: a desativação termina enquanto ela está parada
      const off = await api(app, 'POST', `/api/team/${mallory.id}/deactivate`, { cookie: ana.cookie, body: {} })
      expect(off.statusCode, off.body).toBe(200)
      g.release()
      const view = (await res).json() as { value: { id: string; name: string; status: string }[]; version: number }
      expect(view.value.find((m) => m.id === mallory.id)?.status).toBe('ativo')

      const save = await api(app, 'PUT', `/api/kv/${KEY}`, {
        cookie: bruno.cookie,
        body: { value: view.value.map((m) => (m.id === bruno.user.id ? { ...m, name: 'Admin Bruno Silva' } : m)), version: view.version },
      })
      expect(save.statusCode, save.body).toBe(409)
      expect(await user(mallory.id)).toMatchObject({ status: 'desligado' })
    })

    it('cargos e segurança do painel: leitura cruzando uma gravação devolve a versão da mesma foto', async () => {
      // com 2FA: ligar o 2FA para todos não derruba a sessão de quem salva depois
      const ana = await loginAs(app, 'superadmin', { totp: true, name: 'Admin Ana' })
      const bruno = await loginAs(app, 'superadmin', { totp: true, name: 'Admin Bruno' })

      type R = { id: string; permissions: string[]; description: string }
      const r0 = (await api(app, 'GET', '/api/kv/cargos.lista', { cookie: ana.cookie })).json() as { value: R[]; version: number }
      const perm = r0.value.find((r) => r.id === 'financeiro')!.permissions[0]
      let g = arm((sql, p) => versionRead('cargos.lista')(sql, p) || sql.startsWith('select * from roles order by system desc'), 'after')
      let res = api(app, 'GET', '/api/kv/cargos.lista', { cookie: bruno.cookie })
      await g.isParked
      const cut = await api(app, 'PUT', '/api/kv/cargos.lista', {
        cookie: ana.cookie,
        body: { value: r0.value.map((r) => (r.id === 'financeiro' ? { ...r, permissions: r.permissions.filter((x) => x !== perm) } : r)), version: r0.version },
      })
      expect(cut.statusCode, cut.body).toBe(200)
      g.release()
      const rv = (await res).json() as { value: R[]; version: number }
      expect(rv.version).toBe(r0.version)
      expect(rv.value.find((r) => r.id === 'financeiro')!.permissions).toContain(perm)
      const rsave = await api(app, 'PUT', '/api/kv/cargos.lista', {
        cookie: bruno.cookie,
        body: { value: rv.value.map((r) => (r.id === 'suporte' ? { ...r, description: `${r.description} (rev)` } : r)), version: rv.version },
      })
      expect(rsave.statusCode, rsave.body).toBe(409)

      const KEY = 'config.seguranca-painel'
      const p0 = (await api(app, 'GET', `/api/kv/${KEY}`, { cookie: ana.cookie })).json()
      g = arm((sql, p) => versionRead(KEY)(sql, p) || sql.startsWith('select allowlist, enforce_2fa_all, session_timeout_minutes, updated_at from panel_security'), 'after')
      res = api(app, 'GET', `/api/kv/${KEY}`, { cookie: bruno.cookie })
      await g.isParked
      const on = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: ana.cookie, body: { value: { ...p0.value, enforce2faForAll: true }, version: p0.version } })
      expect(on.statusCode, on.body).toBe(200)
      g.release()
      const pv = (await res).json()
      expect({ version: pv.version, enforce2faForAll: pv.value.enforce2faForAll }).toEqual({ version: p0.version, enforce2faForAll: false })
      const psave = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: bruno.cookie, body: { value: { ...pv.value, sessionTimeoutMinutes: 45 }, version: pv.version } })
      expect(psave.statusCode, psave.body).toBe(409)
      expect(await app.db.one('select enforce_2fa_all from panel_security where id = 1')).toEqual({ enforce_2fa_all: true })
    })
  })
})
