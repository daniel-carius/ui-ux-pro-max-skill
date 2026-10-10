// PoC (rodada 3, resiliência): um evento normal do Postgres derruba o processo da API.
//
// postgresDb() (src/db/index.ts) cria um pg.Pool sem pool.on('error') e db.tx() segura um cliente sem
// client.on('error'). Quando o backend de uma conexão é encerrado (reinício do Postgres, failover,
// pg_terminate_backend, crash de qualquer backend -> recuperação do postmaster), o pg emite 'error' num
// EventEmitter sem ouvinte e o Node 22 encerra o processo (exit 1). O laço de webhooks consulta o banco a cada
// 2 s e o pool só fecha cliente ocioso após 10 s, então sempre há um cliente ocioso: o crash é garantido.
//
// Precisa de um Postgres real (superusuário). Exemplo com os binários do sistema:
//   X2W_PG_URL=postgres://x2win@127.0.0.1:55433/postgres npx vitest run test/poc-r3-runtime-resilience-pg-crash.test.ts
import { spawn, type ChildProcess } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ADMIN_URL = process.env.X2W_PG_URL
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TSX = path.join(SERVER_DIR, 'node_modules', '.bin', 'tsx')
const DB_NAME = `x2w_poc_r3_${process.pid}`

function urlFor(db: string) {
  const u = new URL(ADMIN_URL!)
  u.pathname = `/${db}`
  return u.toString()
}

async function admin<T = unknown>(sql: string, params: unknown[] = [], db = 'postgres'): Promise<T[]> {
  const c = new pg.Client({ connectionString: urlFor(db) })
  await c.connect()
  try {
    return (await c.query(sql, params)).rows as T[]
  } finally {
    await c.end()
  }
}

function run(args: string[], env: Record<string, string>) {
  const child = spawn(TSX, args, { cwd: SERVER_DIR, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout!.on('data', (d) => (out += d))
  child.stderr!.on('data', (d) => (out += d))
  const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)))
  return { child, exited, output: () => out }
}

async function until(cond: () => boolean | Promise<boolean>, ms: number) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await cond()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

const killAll = () =>
  admin(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [DB_NAME])

describe.skipIf(!ADMIN_URL)('PoC: Postgres encerra conexões -> processo da API morre', () => {
  const children: ChildProcess[] = []
  beforeAll(async () => {
    await admin(`drop database if exists ${DB_NAME}`)
    await admin(`create database ${DB_NAME}`)
  })
  afterAll(async () => {
    for (const c of children) c.kill('SIGKILL')
    await killAll().catch(() => undefined)
    await admin(`drop database if exists ${DB_NAME}`)
  })

  it('API real (src/index.ts, laço de webhooks ligado): pg_terminate_backend nos clientes ociosos -> exit 1', async () => {
    const port = String(34000 + (process.pid % 1000))
    const api = run(['src/index.ts'], {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: port,
      DATABASE_URL: urlFor(DB_NAME),
      APP_SECRET: 'x'.repeat(48),
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      COOKIE_SECURE: 'true',
      TRUST_PROXY: '1',
      ADMIN_EMAIL: '',
      ADMIN_PASSWORD: '',
    })
    children.push(api.child)
    const up = await until(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${port}/api/health`)).ok
      } catch {
        return false
      }
    }, 30_000)
    expect(up, api.output()).toBe(true)
    // um tique do laço de webhooks (2 s): um cliente fica ocioso no pool
    await new Promise((r) => setTimeout(r, 2500))
    const idle = await admin<{ n: number }>(`select count(*)::int as n from pg_stat_activity where datname = $1 and state = 'idle'`, [DB_NAME])
    expect(idle[0].n).toBeGreaterThan(0)

    await killAll() // o mesmo que um reinício do Postgres / failover / backend que caiu

    const code = await Promise.race([api.exited, new Promise<'vivo'>((r) => setTimeout(() => r('vivo'), 8000))])
    expect(code).toBe(1)
    expect(api.output()).toContain("Unhandled 'error' event")
    expect(api.output()).toContain('BoundPool')
    // e nada volta: /api/health recusa a conexão
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow()
  }, 60_000)

  it('mesmo com pool.on("error"): conexão encerrada no meio de db.tx() derruba o processo (cliente sem ouvinte)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'x2w-poc-r3-'))
    const script = path.join(dir, 'tx-child.mts')
    writeFileSync(
      script,
      `import { createRequire } from 'node:module'
const pg = createRequire(${JSON.stringify(SERVER_DIR + '/')})('pg')
// a correção "óbvia" (só pool.on('error')) aplicada ao Pool que openDb() vai criar
const Base = pg.Pool
;(pg as any).Pool = class extends Base { constructor(o: any) { super(o); this.on('error', (e: Error) => console.log('pool error tratado:', e.message)) } }
const { openDb } = await import(${JSON.stringify(path.join(SERVER_DIR, 'src/db/index.ts'))})
const db = openDb(process.env.URL!)
try {
  await db.tx(async (t: any) => {
    const r = await t.one('select pg_backend_pid() as pid')
    console.log('READY', r.pid)
    await t.query('select pg_sleep(10)') // consulta em andamento dentro da transação
  })
} catch (e) {
  console.log('tx rejeitou (tratado):', (e as Error).message)
}
await new Promise((r) => setTimeout(r, 2000))
console.log('SOBREVIVEU')
process.exit(0)
`,
    )
    const child = run([script], { URL: urlFor(DB_NAME) })
    children.push(child.child)
    expect(await until(() => child.output().includes('READY'), 15_000), child.output()).toBe(true)
    await new Promise((r) => setTimeout(r, 300))
    await killAll()
    const code = await Promise.race([child.exited, new Promise<'vivo'>((r) => setTimeout(() => r('vivo'), 8000))])
    expect(child.output()).not.toContain('SOBREVIVEU')
    expect(code).toBe(1)
    expect(child.output()).toContain("Unhandled 'error' event")
    expect(child.output()).toContain("Emitted 'error' event on Client instance")
    if (process.env.X2W_POC_VERBOSE) console.log(child.output())
  }, 40_000)
})
