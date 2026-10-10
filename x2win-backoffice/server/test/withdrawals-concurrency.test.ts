// Saques x gravação concorrente dos destinos de webhook, num PostgreSQL 16 de verdade.
//
// Regressão: aprovar/recusar um saque enquanto uma gravação de campanhas.webhooks.destinos exclui o destino do
// evento (saque.pago / saque.rejeitado) fazia o INSERT na fila falhar com 23503 (chave estrangeira) quando a
// exclusão confirmava: a decisão inteira voltava atrás e quem aprovou recebia 500, com o saque ainda pendente.
// enqueueWebhook agora trava os destinos que lê (FOR KEY SHARE) e enfileira só esses ids; a gravação da lista
// trava os excluídos na mesma ordem (id), sem impasse.
//
// O PGlite (memory://) tem uma conexão só: as duas transações nunca se sobrepõem lá. Este arquivo sobe um cluster
// descartável do PostgreSQL 16 (initdb/pg_ctl), roda as migrações com o dono das tabelas e a API com x2win_app
// (como no docker-compose). Fica de fora (skip) onde os binários do Postgres 16 não existem; X2W_PGBIN aponta
// para outra pasta de binários.
// A ordem é forçada: a gravação dos destinos para logo depois do seu `delete from webhook_destinations ...` (sem
// confirmar); a decisão roda até esperar uma trava (pg_stat_activity); aí a gravação segue e confirma.
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../src/lib/crypto'
import { api, createTestApp, loginAs } from './helpers'

const PGBIN = process.env.X2W_PGBIN ?? '/usr/lib/postgresql/16/bin'
const HAVE_PG = ['initdb', 'pg_ctl', 'postgres'].every((b) => existsSync(join(PGBIN, b)))
const KEY = 'campanhas.webhooks.destinos'

type Dest = { id: string; event: string; url: string; active: boolean; secret?: string }
type DbError = { code?: string; message: string; sql: string }

let dir = ''
let port = 0
let admin: pg.Client
let app: FastifyInstance
let cookie = ''
const dbErrors: DbError[] = []
let gate: { parked: () => void; wait: Promise<void> } | null = null

function asPostgres(cmd: string, args: string[]) {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
  return isRoot
    ? execFileSync('runuser', ['-u', 'postgres', '--', cmd, ...args], { stdio: 'pipe' })
    : execFileSync(cmd, args, { stdio: 'pipe' })
}

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

/** Envolve app.db.tx: anota erros do banco e, com `gate` armado, para a transação logo depois do DELETE dos destinos. */
function installGate(a: FastifyInstance) {
  const db = a.db as unknown as { tx: <T>(fn: (t: unknown) => Promise<T>) => Promise<T> }
  const origTx = db.tx.bind(db)
  db.tx = <T,>(fn: (t: unknown) => Promise<T>) =>
    origTx(async (t: unknown) => {
      const inner = t as { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }
      const wrapped = {
        ...(t as object),
        async query(sql: string, params?: unknown[]) {
          let r: unknown[]
          try {
            r = await inner.query(sql, params)
          } catch (e) {
            const err = e as { code?: string; message: string }
            dbErrors.push({ code: err.code, message: err.message, sql: sql.replace(/\s+/g, ' ').slice(0, 80) })
            throw e
          }
          if (gate && sql.startsWith('delete from webhook_destinations')) {
            const g = gate
            gate = null
            g.parked()
            await g.wait
          }
          return r
        },
      }
      return fn(wrapped)
    })
}

async function insertWithdrawal(a: FastifyInstance) {
  const id = newId('SQ')
  await a.db.query(
    `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                              risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
     values ($1, 'p1', 'Jogador Teste', 'jogador@exemplo.com', 10000, 0, 'pendente', 'baixo', 10, '["motivo"]'::jsonb, 'CPF', $2, 'E123', now(), now())`,
    [id, a.cipher.encrypt('12345678909')],
  )
  return id
}

async function waitFor(check: () => Promise<boolean>, ms = 10_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return false
}

/** Lista atual (segredos mascarados: a gravação mantém os gravados) e versão. */
async function currentDestinations() {
  const res = await api(app, 'GET', `/api/kv/${KEY}`, { cookie })
  expect(res.statusCode).toBe(200)
  return JSON.parse(res.body) as { version: number; value: Dest[] }
}

function saveDestinations(value: Dest[], version: number) {
  return api(app, 'PUT', `/api/kv/${KEY}`, { cookie, body: { value, version } })
}

async function setDestinations(value: Dest[]) {
  const cur = await currentDestinations()
  const res = await saveDestinations(value, cur.version)
  expect(res.statusCode, res.body).toBe(200)
}

const dest = (id: string, event: string): Dest => ({
  id,
  event,
  url: `https://destino-${id}.example.com/hook`,
  active: true,
  secret: `segredo-forte-${id}-`.padEnd(40, 'x'),
})

/**
 * Corrida forçada: a gravação que exclui `removeIds` para depois do DELETE (trava das linhas sem confirmar); a
 * decisão roda até esperar uma trava; então a gravação confirma.
 */
async function raceWithRemoval(removeIds: string[], decide: () => Promise<LightMyRequestResponse>) {
  const cur = await currentDestinations()
  let parked!: () => void
  let release!: () => void
  const isParked = new Promise<void>((r) => (parked = r))
  gate = { parked, wait: new Promise<void>((r) => (release = r)) }
  const save = saveDestinations(cur.value.filter((d) => !removeIds.includes(d.id)), cur.version)
  await isParked

  const decision = decide()
  const blocked = await waitFor(async () => {
    const r = await admin.query(`select count(*)::int as n from pg_stat_activity where datname = 'x2win' and wait_event_type = 'Lock'`)
    return r.rows[0].n >= 1
  })
  release()
  const [saveRes, decisionRes] = await Promise.all([save, decision])
  return { blocked, saveRes, decisionRes }
}

const outboxFor = (wid: string) =>
  app.db.query<{ destination_id: string; event: string }>(
    `select destination_id, event from webhook_outbox where payload->'data'->>'id' = $1 order by destination_id`,
    [wid],
  )

describe.skipIf(!HAVE_PG)('saque x exclusão concorrente do destino de webhook (PostgreSQL 16 real, papel x2win_app)', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'x2win-wd-race-'))
    chmodSync(dir, 0o777)
    port = await freePort()
    asPostgres(join(PGBIN, 'initdb'), ['-D', join(dir, 'data'), '-A', 'trust', '-U', 'postgres', '-N'])
    asPostgres(join(PGBIN, 'pg_ctl'), [
      '-D', join(dir, 'data'), '-l', join(dir, 'pg.log'), '-w',
      '-o', `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off`,
      'start',
    ])
    admin = new pg.Client({ connectionString: `postgres://postgres@127.0.0.1:${port}/postgres` })
    await admin.connect()
    await admin.query('create database x2win')
    await admin.query('create role x2win_app login nosuperuser nocreatedb nocreaterole noreplication nobypassrls')
    // migrações com o dono das tabelas (o serviço "migrate"), depois a API com o papel de execução
    const owner = await createTestApp({ DATABASE_URL: `postgres://postgres@127.0.0.1:${port}/x2win` })
    await owner.close()
    app = await createTestApp({ DATABASE_URL: `postgres://x2win_app@127.0.0.1:${port}/x2win` })
    installGate(app)
    const who = await app.db.one<{ u: string; su: boolean }>(`select current_user as u, (select rolsuper from pg_roles where rolname = current_user) as su`)
    expect(who).toEqual({ u: 'x2win_app', su: false })
    cookie = (await loginAs(app, 'superadmin', { totp: true, name: 'Admin Ana' })).cookie
  }, 60_000)

  afterAll(async () => {
    await app?.close().catch(() => undefined)
    await admin?.end().catch(() => undefined)
    if (dir) {
      try {
        asPostgres(join(PGBIN, 'pg_ctl'), ['-D', join(dir, 'data'), '-m', 'immediate', 'stop'])
      } catch {
        /* já parado */
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('aprovar enquanto o destino de saque.pago é excluído: 200, saque aprovado, evento só para o destino que ficou', async () => {
    dbErrors.length = 0
    await setDestinations([dest('pa1', 'saque.pago'), dest('pa2', 'saque.pago'), dest('rj1', 'saque.rejeitado')])
    const wid = await insertWithdrawal(app)

    const { blocked, saveRes, decisionRes } = await raceWithRemoval(['pa1'], () => api(app, 'POST', `/api/withdrawals/${wid}/approve`, { cookie }))

    expect(blocked).toBe(true) // a aprovação esperou a gravação (sem isso o teste não exercita a corrida)
    expect(saveRes.statusCode, saveRes.body).toBe(200)
    expect(decisionRes.statusCode, decisionRes.body).toBe(200)
    expect((await app.db.one<{ status: string }>('select status from withdrawals where id = $1', [wid]))?.status).toBe('aprovado')
    expect(await app.db.query('select 1 from audit_log where entity = $1 and action = $2', [`Saque #${wid}`, 'aprovar'])).toHaveLength(1)
    expect(await outboxFor(wid)).toEqual([{ destination_id: 'pa2', event: 'saque.pago' }])
    expect(dbErrors).toEqual([])
  })

  it('recusar enquanto o destino de saque.rejeitado é excluído: 200, saque recusado, evento só para o destino que ficou', async () => {
    dbErrors.length = 0
    await setDestinations([dest('pa1', 'saque.pago'), dest('rj1', 'saque.rejeitado'), dest('rj2', 'saque.rejeitado')])
    const wid = await insertWithdrawal(app)

    const { blocked, saveRes, decisionRes } = await raceWithRemoval(['rj1'], () =>
      api(app, 'POST', `/api/withdrawals/${wid}/reject`, { cookie, body: { reason: 'Documento divergente' } }),
    )

    expect(blocked).toBe(true)
    expect(saveRes.statusCode, saveRes.body).toBe(200)
    expect(decisionRes.statusCode, decisionRes.body).toBe(200)
    expect((await app.db.one<{ status: string }>('select status from withdrawals where id = $1', [wid]))?.status).toBe('recusado')
    expect(await app.db.query('select 1 from audit_log where entity = $1 and action = $2', [`Saque #${wid}`, 'recusar'])).toHaveLength(1)
    expect(await outboxFor(wid)).toEqual([{ destination_id: 'rj2', event: 'saque.rejeitado' }])
    expect(dbErrors).toEqual([])
  })

  it('aprovar quando o único destino de saque.pago é excluído: 200 e nada na fila (o destino não existe mais)', async () => {
    dbErrors.length = 0
    await setDestinations([dest('solo', 'saque.pago')])
    const wid = await insertWithdrawal(app)

    const { blocked, saveRes, decisionRes } = await raceWithRemoval(['solo'], () => api(app, 'POST', `/api/withdrawals/${wid}/approve`, { cookie }))

    expect(blocked).toBe(true)
    expect(saveRes.statusCode, saveRes.body).toBe(200)
    expect(decisionRes.statusCode, decisionRes.body).toBe(200)
    expect((await app.db.one<{ status: string }>('select status from withdrawals where id = $1', [wid]))?.status).toBe('aprovado')
    expect(await outboxFor(wid)).toEqual([])
    expect(dbErrors).toEqual([])
  })

  it('sem ordem forçada: 60 decisões em paralelo + gravação que exclui vários destinos -> nenhum 500, 23503 ou impasse', async () => {
    for (let round = 0; round < 3; round++) {
      dbErrors.length = 0
      // "zz" gravado antes de "aa": a ordem física da tabela é a inversa da ordem do id (é o caso que daria impasse
      // se a exclusão travasse na ordem da varredura e a fila na ordem do id)
      await setDestinations([dest(`zz${round}`, 'saque.pago'), dest(`rjz${round}`, 'saque.rejeitado')])
      const cur = await currentDestinations()
      await setDestinations([...cur.value, dest(`aa${round}`, 'saque.pago'), dest(`rja${round}`, 'saque.rejeitado'), dest(`keep${round}`, 'saque.pago')])
      const v = await currentDestinations()
      const ids: string[] = []
      for (let i = 0; i < 60; i++) ids.push(await insertWithdrawal(app))

      const decisions = ids.map((id, i) =>
        new Promise((r) => setTimeout(r, i % 10)).then(() =>
          i % 3 === 2
            ? api(app, 'POST', `/api/withdrawals/${id}/reject`, { cookie, body: { reason: 'Documento divergente' } })
            : api(app, 'POST', `/api/withdrawals/${id}/approve`, { cookie }),
        ),
      )
      const drop = new Promise((r) => setTimeout(r, 3)).then(() =>
        saveDestinations(v.value.filter((d) => d.id.startsWith('keep')), v.version),
      )
      const [dropRes, ...res] = await Promise.all([drop, ...decisions])
      const codes = res.reduce<Record<number, number>>((m, r) => ((m[r.statusCode] = (m[r.statusCode] ?? 0) + 1), m), {})
      const open = await app.db.one<{ n: number }>(`select count(*)::int as n from withdrawals where id = any($1::text[]) and status = 'pendente'`, [ids])

      expect(dropRes.statusCode, dropRes.body).toBe(200)
      expect(codes).toEqual({ 200: 60 })
      expect(open?.n).toBe(0)
      expect([...new Set(dbErrors.map((e) => e.code))]).toEqual([])
    }
  }, 60_000)
})
