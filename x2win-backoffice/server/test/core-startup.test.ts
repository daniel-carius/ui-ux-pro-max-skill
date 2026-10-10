// Falhas na subida da API (src/index.ts) e no "npm run migrate" (src/migrate.ts): configuração inválida, banco fora
// do ar, porta ocupada. Antes a promessa rejeitada escapava do topo do módulo e o Node imprimia a pilha de chamadas
// (com o motivo perdido no meio dela); o migrate ainda deixava o pool aberto quando a falha vinha depois de conectar.
// Agora: uma linha clara com o motivo, sem pilha, e código de saída 1 (o compose reinicia a API; o migrate falha o
// passo único e a API não sobe).
import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TEST_ENV } from './helpers'

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const children: ChildProcess[] = []

afterAll(() => {
  for (const c of children) c.kill('SIGKILL')
})

interface Run {
  code: number | null
  stdout: string
  stderr: string
  ms: number
}

/**
 * Roda um script do servidor com o ambiente dado; mata o processo (e falha o teste) se não terminar a tempo.
 * Um processo só (node com o carregador do tsx): o SIGKILL no binário tsx não alcançaria o node que ele abre.
 */
function runScript(script: string, env: Record<string, string | undefined>, timeoutMs = 15_000): Promise<Run> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const child = spawn(process.execPath, ['--import', 'tsx', script], { cwd: SERVER_DIR, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${script} não terminou em ${timeoutMs} ms\n${stdout}\n${stderr}`))
    }, timeoutMs)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, ms: Date.now() - t0 })
    })
  })
}

/** Porta onde nada escuta (conexão recusada na hora). */
function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port
      s.close(() => resolve(p))
    })
    s.on('error', reject)
  })
}

const STACK = /^\s+at /m
/** Nunca a porta padrão: se a subida não falhasse, a API ficaria escutando só no loopback, numa porta livre. */
const listenEnv = async () => ({ HOST: '127.0.0.1', PORT: String(await closedPort()) })

describe('subida da API (src/index.ts)', () => {
  it('configuração inválida: motivo claro, sem pilha, saída 1', async () => {
    const r = await runScript('src/index.ts', { ...TEST_ENV, ...(await listenEnv()), APP_SECRET: 'curto' })
    expect(r.code, r.stderr).toBe(1)
    expect(r.stderr).toMatch(/^\[x2win\] A API não subiu: Configuração inválida:\nAPP_SECRET: APP_SECRET precisa de pelo menos 32 caracteres/m)
    expect(r.stderr).not.toMatch(STACK)
  })

  it('produção com a liberação de webhooks locais: recusa subir', async () => {
    const r = await runScript('src/index.ts', { ...TEST_ENV, ...(await listenEnv()), NODE_ENV: 'production', WEBHOOK_ALLOW_LOCAL_TARGETS: 'true' })
    expect(r.code, r.stderr).toBe(1)
    expect(r.stderr).toMatch(/A API não subiu: Configuração inválida:\nWEBHOOK_ALLOW_LOCAL_TARGETS: /)
    expect(r.stderr).not.toMatch(STACK)
  })

  it('banco fora do ar: motivo claro, sem pilha, saída 1', async () => {
    const port = await closedPort()
    const r = await runScript('src/index.ts', { ...TEST_ENV, ...(await listenEnv()), DATABASE_URL: `postgres://x2win:x@127.0.0.1:${port}/x2win` })
    expect(r.code, r.stderr).toBe(1)
    expect(r.stderr).toMatch(new RegExp(`^\\[x2win\\] A API não subiu: connect ECONNREFUSED 127\\.0\\.0\\.1:${port}$`, 'm'))
    expect(r.stderr).not.toMatch(STACK)
  })

  describe('porta ocupada', () => {
    const busy = net.createServer()
    let port = 0
    beforeAll(async () => {
      await new Promise<void>((r) => busy.listen(0, '127.0.0.1', () => r()))
      port = (busy.address() as net.AddressInfo).port
    })
    afterAll(() => new Promise<void>((r) => busy.close(() => r())))

    it('a falha do listen (depois de montar a app e o banco) também sai com o motivo e código 1', async () => {
      const r = await runScript('src/index.ts', { ...TEST_ENV, HOST: '127.0.0.1', PORT: String(port) }, 40_000)
      expect(r.code, r.stdout + r.stderr).toBe(1)
      expect(r.stderr).toMatch(/^\[x2win\] A API não subiu: listen EADDRINUSE: address already in use 127\.0\.0\.1:\d+$/m)
      expect(r.stderr).not.toMatch(STACK)
    }, 60_000)
  })
})

describe('npm run migrate (src/migrate.ts)', () => {
  it('DATABASE_URL desconhecida: só a mensagem, saída 1', async () => {
    const r = await runScript('src/migrate.ts', { ...TEST_ENV, DATABASE_URL: 'mysql://x' })
    expect(r.code).toBe(1)
    expect(r.stderr.trim()).toBe('DATABASE_URL não reconhecida: use postgres://, pglite:// ou memory://')
    expect(r.stdout).toBe('')
  })

  it('banco fora do ar: só a mensagem, saída 1, e o processo termina (o pool é fechado)', async () => {
    const port = await closedPort()
    const r = await runScript('src/migrate.ts', { ...TEST_ENV, DATABASE_URL: `postgres://x2win:x@127.0.0.1:${port}/x2win` })
    expect(r.code).toBe(1)
    expect(r.stderr.trim()).toBe(`connect ECONNREFUSED 127.0.0.1:${port}`)
    expect(r.stdout).toBe('')
  })

  it('configuração inválida: só a mensagem, saída 1', async () => {
    const r = await runScript('src/migrate.ts', { ...TEST_ENV, ENCRYPTION_KEY: 'curta' })
    expect(r.code).toBe(1)
    expect(r.stderr).toMatch(/^Configuração inválida:\nENCRYPTION_KEY: /)
    expect(r.stderr).not.toMatch(STACK)
  })

  it('sucesso: aplica e sai com 0', async () => {
    const r = await runScript('src/migrate.ts', { ...TEST_ENV, DATABASE_URL: 'memory://' })
    expect(r.code, r.stderr).toBe(0)
    expect(r.stdout).toMatch(/^Migrações aplicadas: 001_init, 002_audit_append_only/)
  })
})
