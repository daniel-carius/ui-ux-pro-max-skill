// PoC (rodada 3, resiliência do processo): perder a conexão com o Postgres derruba o processo da API.
//
// postgresDb() (src/db/index.ts:92) cria `new pg.Pool(...)` sem pool.on('error'), e db.tx() (linhas 110-121) segura um
// cliente com pool.connect() sem client.on('error'). Quando o backend de uma conexão cai (reinício/failover do
// Postgres, pg_terminate_backend, recuperação após crash de outro backend), o pg emite 'error' num EventEmitter sem
// ouvinte; o Node trata como exceção não capturada e o processo sai com código 1.
//
// Comportamento seguro esperado (o que estes testes afirmam): o processo SOBREVIVE, a operação em curso falha com erro
// tratado, e a próxima consulta abre uma conexão nova.
//
// Partes 1 e 2 rodam sempre: um servidor falso do protocolo do Postgres (no processo do vitest) aceita a conexão do
// openDb() real e depois a encerra como o Postgres faz (ErrorResponse FATAL 57P01 + fim do socket). O openDb() roda num
// processo filho (tsx) porque o crash mata o processo inteiro.
// Parte 3 (opcional) usa um Postgres real com a app completa (createTestApp de test/helpers.ts, laço de webhooks ligado):
//   X2W_PG_URL=postgres://<superusuário>@127.0.0.1:<porta>/postgres npx vitest run test/poc-r3-process-resilience-and-restart-1.test.ts
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TSX = path.join(SERVER_DIR, 'node_modules', '.bin', 'tsx')
const DB_MODULE = path.join(SERVER_DIR, 'src/db/index.ts')
const HELPERS = path.join(SERVER_DIR, 'test/helpers.ts')
const SCRATCH = mkdtempSync(path.join(tmpdir(), 'x2w-poc-r3-proc-'))
const children: ChildProcess[] = []

function runChild(name: string, source: string, env: Record<string, string>) {
  const file = path.join(SCRATCH, name)
  writeFileSync(file, source)
  const child = spawn(TSX, [file], { cwd: SERVER_DIR, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
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

const outcome = (p: Promise<number | null>, ms: number) => Promise.race([p, new Promise<'vivo'>((r) => setTimeout(() => r('vivo'), ms))])

afterAll(() => {
  for (const c of children) c.kill('SIGKILL')
  rmSync(SCRATCH, { recursive: true, force: true })
})

// ---------- servidor falso do protocolo do Postgres (v3), só o necessário para o pg ----------
function msg(type: string, body: Buffer) {
  const head = Buffer.alloc(5)
  head.write(type, 0, 'latin1')
  head.writeInt32BE(body.length + 4, 1)
  return Buffer.concat([head, body])
}
const int32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeInt32BE(n)
  return b
}
const cstr = (s: string) => Buffer.from(s + '\0', 'utf8')
const READY = msg('Z', Buffer.from('I'))
const FATAL_ADMIN = msg(
  'E',
  Buffer.concat([
    Buffer.from('S'),
    cstr('FATAL'),
    Buffer.from('V'),
    cstr('FATAL'),
    Buffer.from('C'),
    cstr('57P01'),
    Buffer.from('M'),
    cstr('terminating connection due to administrator command'),
    Buffer.from([0]),
  ]),
)

/** Responde a qualquer consulta simples com "SELECT 0"; consultas com "pg_sleep" ficam penduradas (em andamento). */
function fakePostgres() {
  const sockets = new Set<net.Socket>()
  const server = net.createServer((sock) => {
    sockets.add(sock)
    sock.on('close', () => sockets.delete(sock))
    sock.on('error', () => undefined)
    let buf = Buffer.alloc(0)
    let started = false
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      for (;;) {
        if (!started) {
          if (buf.length < 4) return
          const len = buf.readInt32BE(0)
          if (buf.length < len) return
          buf = buf.subarray(len)
          started = true
          sock.write(Buffer.concat([msg('R', int32(0)), msg('K', Buffer.concat([int32(4242), int32(1)])), READY]))
          continue
        }
        if (buf.length < 5) return
        const type = String.fromCharCode(buf[0])
        const len = buf.readInt32BE(1)
        if (buf.length < len + 1) return
        const body = buf.subarray(5, len + 1)
        buf = buf.subarray(len + 1)
        if (type === 'X') return sock.end()
        if (type === 'Q') {
          const sql = body.toString('utf8')
          if (/pg_sleep/.test(sql)) continue // consulta em andamento: nunca responde
          const tag = /^\s*(begin|commit|rollback)/i.exec(sql)?.[1]?.toUpperCase() ?? 'SELECT 0'
          sock.write(Buffer.concat([msg('C', cstr(tag)), READY]))
        }
      }
    })
  })
  return {
    listen: () => new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as net.AddressInfo).port))),
    /** o que pg_terminate_backend / reinício "fast" do Postgres faz com cada conexão */
    terminateAll: () => {
      const n = sockets.size
      for (const s of sockets) {
        s.write(FATAL_ADMIN)
        s.end()
      }
      return n
    },
    connections: () => sockets.size,
    close: () => {
      for (const s of sockets) s.destroy()
      server.close()
    },
  }
}

describe('PoC: conexão com o Postgres encerrada -> o processo da API deve sobreviver (servidor falso)', () => {
  it('cliente OCIOSO no pool (o estado normal com o laço de webhooks a cada 2 s): FATAL 57P01 não pode derrubar o processo', async () => {
    const fake = fakePostgres()
    const port = await fake.listen()
    const child = runChild(
      'idle.mts',
      `const { openDb } = await import(${JSON.stringify(DB_MODULE)})
const db = openDb(process.env.URL!)
await db.query('select 1') // o cliente volta ao pool e fica ocioso (idleTimeoutMillis = 10 s)
console.log('READY')
await new Promise((r) => setTimeout(r, 1500))
// depois da queda, a próxima consulta deve abrir conexão nova
try { await db.query('select 1'); console.log('RECONECTOU') } catch (e) { console.log('consulta falhou:', (e as Error).message) }
console.log('SOBREVIVEU')
process.exit(0)
`,
      { URL: `postgres://x2win@127.0.0.1:${port}/x2win` },
    )
    expect(await until(() => child.output().includes('READY'), 20_000), child.output()).toBe(true)
    expect(fake.connections()).toBe(1)
    fake.terminateAll()
    const code = await outcome(child.exited, 10_000)
    fake.close()
    // comportamento seguro: o processo segue vivo e reconecta
    expect(child.output(), child.output()).toContain('SOBREVIVEU')
    expect(code).toBe(0)
  }, 40_000)

  it('conexão encerrada DURANTE db.tx() (login, 2FA, aprovar saque, KV): a transação falha, o processo não', async () => {
    const fake = fakePostgres()
    const port = await fake.listen()
    const child = runChild(
      'tx.mts',
      `const { openDb } = await import(${JSON.stringify(DB_MODULE)})
const db = openDb(process.env.URL!)
try {
  await db.tx(async (t: any) => {
    await t.query('select 1')
    console.log('READY')
    await t.query('select pg_sleep(10)') // consulta em andamento dentro da transação
  })
} catch (e) {
  console.log('tx rejeitou (tratado):', (e as Error).message)
}
await new Promise((r) => setTimeout(r, 1500))
console.log('SOBREVIVEU')
process.exit(0)
`,
      { URL: `postgres://x2win@127.0.0.1:${port}/x2win` },
    )
    expect(await until(() => child.output().includes('READY'), 20_000), child.output()).toBe(true)
    await new Promise((r) => setTimeout(r, 200))
    fake.terminateAll()
    const code = await outcome(child.exited, 10_000)
    fake.close()
    expect(child.output(), child.output()).toContain('tx rejeitou (tratado)')
    expect(child.output(), child.output()).toContain('SOBREVIVEU')
    expect(code).toBe(0)
  }, 40_000)

  it('só pool.on("error") não basta: com o ouvinte no Pool, a queda dentro de db.tx() ainda não pode derrubar o processo', async () => {
    const fake = fakePostgres()
    const port = await fake.listen()
    const child = runChild(
      'tx-pool-listener.mts',
      `import { createRequire } from 'node:module'
const pg = createRequire(${JSON.stringify(SERVER_DIR + '/')})('pg')
const Base = pg.Pool
;(pg as any).Pool = class extends Base { constructor(o: any) { super(o); this.on('error', (e: Error) => console.log('pool error tratado:', e.message)) } }
const { openDb } = await import(${JSON.stringify(DB_MODULE)})
const db = openDb(process.env.URL!)
try {
  await db.tx(async (t: any) => {
    await t.query('select 1')
    console.log('READY')
    await t.query('select pg_sleep(10)')
  })
} catch (e) {
  console.log('tx rejeitou (tratado):', (e as Error).message)
}
await new Promise((r) => setTimeout(r, 1500))
console.log('SOBREVIVEU')
process.exit(0)
`,
      { URL: `postgres://x2win@127.0.0.1:${port}/x2win` },
    )
    expect(await until(() => child.output().includes('READY'), 20_000), child.output()).toBe(true)
    await new Promise((r) => setTimeout(r, 200))
    fake.terminateAll()
    const code = await outcome(child.exited, 10_000)
    fake.close()
    expect(child.output(), child.output()).toContain('SOBREVIVEU')
    expect(code).toBe(0)
  }, 40_000)
})

// ---------- Postgres real, app completa (createTestApp + laço de webhooks) ----------
const ADMIN_URL = process.env.X2W_PG_URL
const DB_NAME = `x2w_poc_r3_proc_${process.pid}`
function urlFor(db: string) {
  const u = new URL(ADMIN_URL!)
  u.pathname = `/${db}`
  return u.toString()
}
async function admin<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: urlFor('postgres') })
  await c.connect()
  try {
    return (await c.query(sql, params)).rows as T[]
  } finally {
    await c.end()
  }
}
const terminateAppConnections = () =>
  admin<{ pg_terminate_backend: boolean }>(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [DB_NAME])

describe.skipIf(!ADMIN_URL)('PoC: Postgres real -> pg_terminate_backend não pode derrubar a API', () => {
  afterAll(async () => {
    for (const c of children) c.kill('SIGKILL')
    await terminateAppConnections().catch(() => undefined)
    await admin(`drop database if exists ${DB_NAME}`).catch(() => undefined)
  })

  it('app completa (createTestApp, laço de webhooks ligado, ouvindo HTTP): segue respondendo depois que o Postgres derruba as conexões', async () => {
    await admin(`drop database if exists ${DB_NAME}`)
    await admin(`create database ${DB_NAME}`)
    const httpPort = String(35000 + (process.pid % 1000))
    const child = runChild(
      'app.mts',
      `const { createTestApp } = await import(${JSON.stringify(HELPERS)})
const app = await createTestApp({ DATABASE_URL: process.env.URL!, WEBHOOK_DISPATCHER: 'on' })
await app.listen({ port: Number(process.env.HTTP_PORT), host: '127.0.0.1' })
console.log('READY')
`,
      { URL: urlFor(DB_NAME), HTTP_PORT: httpPort },
    )
    expect(await until(() => child.output().includes('READY'), 30_000), child.output()).toBe(true)
    // um tique do laço (2 s) deixa um cliente ocioso no pool
    await new Promise((r) => setTimeout(r, 2500))
    const idle = await admin<{ n: number }>(`select count(*)::int as n from pg_stat_activity where datname = $1 and state = 'idle'`, [DB_NAME])
    expect(idle[0].n).toBeGreaterThan(0)

    const killed = await terminateAppConnections()
    expect(killed.length).toBeGreaterThan(0)

    const code = await outcome(child.exited, 6000)
    expect(code, child.output()).toBe('vivo')
    // e a API continua servindo, inclusive rotas que consultam o banco (pool reconecta)
    const health = await fetch(`http://127.0.0.1:${httpPort}/api/health`).then((r) => r.status)
    expect(health).toBe(200)
    const login = await fetch(`http://127.0.0.1:${httpPort}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'x2w' },
      body: JSON.stringify({ email: 'ninguem@x2win.bet.br', password: 'SenhaErrada123' }),
    }).then((r) => r.status)
    expect([400, 401, 403]).toContain(login)
  }, 60_000)
})
