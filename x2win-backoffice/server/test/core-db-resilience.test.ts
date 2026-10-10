// Regressão r3-process-resilience-and-restart-1 (e r3-runtime-resilience-pg-crash): o Postgres encerrar uma conexão
// (reinício, failover, pg_terminate_backend, recuperação depois do crash de outro backend) derrubava o processo da API.
// postgresDb() criava o pg.Pool sem pool.on('error') e db.tx() segurava um cliente sem client.on('error'): o pg emitia
// 'error' sem ouvinte e o Node encerrava o processo (exit 1). Com o laço de webhooks consultando a cada 2 s e o pool
// guardando o cliente ocioso por 10 s, sempre havia um cliente para cair.
//
// Agora o processo sobrevive, a operação em curso falha com erro tratado e a próxima consulta abre conexão nova.
// Roda sempre: um servidor falso do protocolo do Postgres (aqui no processo do vitest) aceita a conexão do openDb()
// de verdade e depois a encerra como o Postgres faz (ErrorResponse FATAL 57P01 + fim do socket). O openDb() roda num
// processo filho (node + tsx), porque o defeito mata o processo inteiro. O mesmo cenário com o PostgreSQL 16 de verdade e a
// app completa está em core-pg.test.ts.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DB_MODULE = path.join(SERVER_DIR, 'src/db/index.ts')
const SCRATCH = mkdtempSync(path.join(tmpdir(), 'x2w-core-db-'))
const children: ChildProcess[] = []

function runChild(name: string, source: string, env: Record<string, string>) {
  const file = path.join(SCRATCH, name)
  writeFileSync(file, source)
  // node com o carregador do tsx (um processo só: o SIGKILL do afterAll alcança o processo que roda o script)
  const child = spawn(process.execPath, ['--import', 'tsx', file], { cwd: SERVER_DIR, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let out = ''
  child.stdout!.on('data', (d) => (out += d))
  child.stderr!.on('data', (d) => (out += d))
  const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)))
  return { child, exited, output: () => out }
}

async function until(cond: () => boolean, ms: number) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (cond()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

/** Código de saída do processo, ou 'vivo' se ainda roda depois de `ms`. */
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
      for (const s of sockets) {
        s.write(FATAL_ADMIN)
        s.end()
      }
    },
    connections: () => sockets.size,
    close: () => {
      for (const s of sockets) s.destroy()
      server.close()
    },
  }
}

describe('Postgres encerra a conexão: o processo da API sobrevive', () => {
  it('cliente ocioso no pool (o estado normal com o laço de webhooks): FATAL 57P01 não derruba o processo e a próxima consulta reconecta', async () => {
    const fake = fakePostgres()
    const port = await fake.listen()
    const child = runChild(
      'idle.mts',
      `const { openDb } = await import(${JSON.stringify(DB_MODULE)})
const db = openDb(process.env.URL!)
await db.query('select 1') // o cliente volta ao pool e fica ocioso
console.log('READY')
await new Promise((r) => setTimeout(r, 1500))
// depois da queda, a próxima consulta abre conexão nova
try { await db.query('select 1'); console.log('RECONECTOU') } catch (e) { console.log('consulta falhou:', (e as Error).message) }
console.log('SOBREVIVEU')
process.exit(0)
`,
      { URL: `postgres://x2win@127.0.0.1:${port}/x2win` },
    )
    try {
      expect(await until(() => child.output().includes('READY'), 20_000), child.output()).toBe(true)
      expect(fake.connections()).toBe(1)
      fake.terminateAll()
      const code = await outcome(child.exited, 10_000)
      expect(child.output(), child.output()).toContain('[postgres] conexão ociosa perdida')
      expect(child.output(), child.output()).toContain('RECONECTOU')
      expect(child.output(), child.output()).toContain('SOBREVIVEU')
      expect(code).toBe(0)
    } finally {
      fake.close()
    }
  }, 40_000)

  it('conexão encerrada durante db.tx() (login, 2FA, aprovar saque, dados por chave): a transação falha, o processo não', async () => {
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
    try {
      expect(await until(() => child.output().includes('READY'), 20_000), child.output()).toBe(true)
      await new Promise((r) => setTimeout(r, 200))
      fake.terminateAll()
      const code = await outcome(child.exited, 10_000)
      expect(child.output(), child.output()).toContain('tx rejeitou (tratado)')
      expect(child.output(), child.output()).toContain('SOBREVIVEU')
      expect(child.output()).not.toContain("Unhandled 'error' event")
      expect(code).toBe(0)
    } finally {
      fake.close()
    }
  }, 40_000)
})
