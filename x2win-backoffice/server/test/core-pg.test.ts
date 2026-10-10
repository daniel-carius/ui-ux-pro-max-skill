// Regressão r3-real-postgres-concurrency-and-grants-4 no PostgreSQL 16 de verdade, pelo CLI (npm run migrate).
// Com o dono das tabelas sem CREATEROLE (Postgres gerenciado, ou instalação em que deploy/db-init não rodou antes),
// a migração 002 só avisava (NOTICE descartado pelo pg), pulava os GRANTs e ficava marcada como aplicada: o CLI dizia
// "Migrações aplicadas" sem aviso, e "crie o papel e rode as migrações de novo" não concedia nada (a API com x2win_app
// caía com 42501 em schema_migrations). Agora:
//  - sem o papel, o CLI grava as migrações, mostra o NOTICE e sai com erro dizendo o que fazer;
//  - criado o papel, rodar o CLI de novo concede os privilégios e a API sobe com x2win_app (auditoria só inclusão).
// Junto: conexões encerradas pelo servidor (reinício do Postgres, failover, pg_terminate_backend) não derrubam mais o
// processo da API (pool e transação com ouvinte de 'error'), e /api/health volta a 200 assim que o banco responde.
// Sobe um cluster descartável (initdb); sem os binários do PG16, sem root ou sem runuser, o arquivo é pulado.
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectedAsOwner } from '../src/db'
import { api, createTestApp, TEST_ENV } from './helpers'

const PGBIN = '/usr/lib/postgresql/16/bin'
const SERVER_DIR = join(__dirname, '..')

function pgAvailable(): boolean {
  if (process.env.X2WIN_PG_TESTS === '0') return false
  if (process.platform !== 'linux' || process.getuid?.() !== 0) return false
  if (!existsSync(join(PGBIN, 'initdb')) || !existsSync(join(PGBIN, 'pg_ctl'))) return false
  try {
    execFileSync('id', ['-u', 'postgres'], { stdio: 'pipe' })
    execFileSync('runuser', ['--help'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}
const PG = pgAvailable()

let dir = ''
let port = 0
let admin: pg.Client

const asPostgres = (cmd: string, args: string[]) => execFileSync('runuser', ['-u', 'postgres', '--', join(PGBIN, cmd), ...args], { stdio: 'pipe' })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port
      s.close(() => resolve(p))
    })
    s.on('error', reject)
  })
}

/** O mesmo que "npm run migrate" (tsx src/migrate.ts): código de saída e tudo o que imprimiu. */
function migrateCli(databaseUrl: string) {
  const r = spawnSync('npx', ['tsx', 'src/migrate.ts'], {
    cwd: SERVER_DIR,
    env: { ...process.env, ...TEST_ENV, NODE_ENV: 'production', DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    timeout: 60_000,
  })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

async function asDba<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: `postgres://postgres@127.0.0.1:${port}/x2win` })
  await c.connect()
  try {
    return (await c.query<T>(sql, params)).rows
  } finally {
    await c.end()
  }
}

const terminateApp = () => admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where usename = 'x2win_app'`)

describe.skipIf(!PG)('PostgreSQL 16: papel de execução criado depois das migrações (dono sem CREATEROLE)', () => {
  const ownerUrl = () => `postgres://x2win@127.0.0.1:${port}/x2win`
  const appUrl = () => `postgres://x2win_app:app@127.0.0.1:${port}/x2win`
  let app: FastifyInstance | undefined

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'x2win-core-pg-'))
    chmodSync(dir, 0o777)
    port = await freePort()
    asPostgres('initdb', ['-D', join(dir, 'data'), '-A', 'trust', '-U', 'postgres', '-N'])
    asPostgres('pg_ctl', ['-D', join(dir, 'data'), '-l', join(dir, 'pg.log'), '-w', '-o', `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off`, 'start'])
    admin = new pg.Client({ connectionString: `postgres://postgres@127.0.0.1:${port}/postgres` })
    await admin.connect()
    // dono das tabelas como num Postgres gerenciado: dono do banco, sem criar papéis
    await admin.query('create role x2win login nosuperuser nocreatedb nocreaterole noreplication nobypassrls')
    await admin.query('create database x2win owner x2win')
  }, 60_000)

  afterAll(async () => {
    await app?.close().catch(() => undefined)
    await admin?.end().catch(() => undefined)
    if (dir) {
      try {
        asPostgres('pg_ctl', ['-D', join(dir, 'data'), '-m', 'immediate', 'stop'])
      } catch {
        /* já parado */
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('sem o papel: o CLI grava as migrações, mostra o aviso do Postgres e sai com erro', () => {
    const r = migrateCli(ownerUrl())
    expect(r.status, r.stdout + r.stderr).not.toBe(0)
    expect(r.stdout).not.toContain('Migrações aplicadas: 001_init, 002_audit_append_only\n')
    // o NOTICE da 002 não é mais descartado
    expect(r.stderr).toContain('[postgres] sem permissão para criar o papel x2win_app')
    expect(r.stderr).toMatch(/Migrações aplicadas: 001_init, 002_audit_append_only\. Mas o papel x2win_app, com que a API conecta, não existe/)
  }, 90_000)

  it('criado o papel (deploy/db-init), rodar o CLI de novo concede os privilégios', async () => {
    expect((await asDba<{ id: string }>('select id from schema_migrations order by id')).map((r) => r.id)).toEqual(['001_init', '002_audit_append_only'])
    await admin.query(`create role x2win_app login password 'app' nosuperuser nocreatedb nocreaterole noreplication nobypassrls`)
    const r = migrateCli(ownerUrl())
    expect(r.status, r.stdout + r.stderr).toBe(0)
    expect(r.stdout.trim()).toBe('Banco já está atualizado.')

    const grants = await asDba<{ table_name: string; p: string }>(
      `select table_name, string_agg(privilege_type, ',' order by privilege_type) as p from information_schema.role_table_grants
        where grantee = 'x2win_app' group by 1 order by 1`,
    )
    const by = Object.fromEntries(grants.map((g) => [g.table_name, g.p]))
    expect(by.users).toBe('DELETE,INSERT,SELECT,UPDATE')
    expect(by.withdrawals).toBe('DELETE,INSERT,SELECT,UPDATE')
    expect(by.audit_log).toBe('INSERT,SELECT')
    expect(by.schema_migrations).toBe('SELECT')
    expect((await asDba<{ ok: boolean }>(`select has_schema_privilege('x2win_app', 'public', 'USAGE') as ok`))[0].ok).toBe(true)
    const defAcl = await asDba<{ n: number }>(
      `select count(*)::int as n from pg_default_acl d, aclexplode(d.defaclacl) a where a.grantee = (select oid from pg_roles where rolname = 'x2win_app')`,
    )
    expect(defAcl[0].n).toBeGreaterThan(0)
  }, 90_000)

  it('a API sobe com x2win_app, não é dona da auditoria e não consegue apagá-la', async () => {
    app = await createTestApp({ DATABASE_URL: appUrl() })
    expect(app.db.kind).toBe('postgres')
    expect(await connectedAsOwner(app.db)).toBe(false)
    const h = await api(app, 'GET', '/api/health')
    expect(h.statusCode).toBe(200)
    expect(h.json()).toEqual({ ok: true, db: 'postgres' })
    await app.db.query(`insert into audit_log (actor_name, action, entity, summary) values ('a', 'b', 'c', 'd')`)
    for (const sql of ['delete from audit_log', `update audit_log set summary = 'x'`, 'truncate audit_log', 'drop trigger audit_log_no_truncate on audit_log']) {
      await expect(app.db.query(sql), sql).rejects.toThrow()
    }
  }, 30_000)

  it('conexões encerradas pelo servidor não derrubam o processo: ociosa no pool e no meio de uma transação', async () => {
    expect(app).toBeDefined()
    // cliente ocioso no pool (a sonda acabou de usar) -> pg_terminate_backend: sem ouvinte, 'error' derrubaria o processo
    expect((await api(app!, 'GET', '/api/health')).statusCode).toBe(200)
    await terminateApp()
    await sleep(300)
    expect((await api(app!, 'GET', '/api/health')).statusCode).toBe(200)

    // conexão encerrada com uma consulta em andamento dentro de db.tx(): a transação falha, o processo segue
    const tx = app!.db.tx(async (t) => {
      await t.query('select pg_sleep(10)')
    })
    const settled = tx.then(
      () => 'ok',
      (e: Error) => `falhou: ${e.message}`,
    )
    for (let i = 0; i < 50; i++) {
      const busy = await admin.query(`select 1 from pg_stat_activity where usename = 'x2win_app' and query like '%pg_sleep%' and state = 'active'`)
      if (busy.rowCount) break
      await sleep(50)
    }
    await terminateApp()
    expect(await settled).toMatch(/^falhou: /)
    await sleep(300)
    // e a próxima requisição usa uma conexão nova
    expect((await api(app!, 'GET', '/api/health')).statusCode).toBe(200)
    expect(await app!.db.tx(async (t) => (await t.one<{ n: number }>('select 1 as n'))?.n)).toBe(1)
  }, 30_000)
})
