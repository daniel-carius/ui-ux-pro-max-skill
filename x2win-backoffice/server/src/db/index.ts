// Acesso ao banco: PostgreSQL (produção) ou PGlite (Postgres embutido, para
// desenvolvimento e testes). SQL explícito e sempre parametrizado ($1, $2...).
import { mkdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import { MIGRATIONS } from './migrations'

export interface Db {
  kind: 'pglite' | 'postgres'
  /** executa e devolve as linhas */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  /** primeira linha ou null */
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>
  /** executa várias instruções sem parâmetros (migrações) */
  exec(sql: string): Promise<void>
  /** transação: tudo ou nada */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>
  close(): Promise<void>
}

const INT8 = 20
const TIMESTAMPTZ = 1184
const TIMESTAMP = 1114

const toIso = (v: string) => new Date(v.includes('T') || v.endsWith('Z') ? v : v.replace(' ', 'T')).toISOString()

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }

/** Normaliza tipos: datas viram texto ISO e bigint vira number (centavos cabem com folga). */
function normalizeRow(row: unknown): unknown {
  if (!row || typeof row !== 'object') return row
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    out[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v
  }
  return out
}

function wrap(kind: Db['kind'], q: Queryable, exec: (sql: string) => Promise<void>, tx: Db['tx'], close: () => Promise<void>): Db {
  return {
    kind,
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await q.query(sql, params)
      return r.rows.map(normalizeRow) as T[]
    },
    async one<T>(sql: string, params: unknown[] = []) {
      const r = await q.query(sql, params)
      return (normalizeRow(r.rows[0]) as T) ?? null
    },
    exec,
    tx,
    close,
  }
}

function pgliteDb(dataDir?: string): Db {
  if (dataDir) mkdirSync(dataDir, { recursive: true })
  const client = new PGlite(dataDir, {
    parsers: {
      [INT8]: (v: string) => Number(v),
      [TIMESTAMPTZ]: (v: string) => toIso(v),
      [TIMESTAMP]: (v: string) => toIso(v),
    },
  })
  const asDb = (q: Queryable, inTx: boolean): Db =>
    wrap(
      'pglite',
      q,
      async (sql) => {
        await (q as unknown as { exec: (s: string) => Promise<unknown> }).exec(sql)
      },
      async (fn) => {
        if (inTx) return fn(asDb(q, true))
        return client.transaction(async (t) => fn(asDb(t as unknown as Queryable, true)))
      },
      async () => {
        if (!inTx) await client.close()
      },
    )
  return asDb(client as unknown as Queryable, false)
}

function postgresDb(url: string): Db {
  pg.types.setTypeParser(INT8, (v) => Number(v))
  pg.types.setTypeParser(TIMESTAMPTZ, (v) => toIso(v))
  pg.types.setTypeParser(TIMESTAMP, (v) => toIso(v))
  const pool = new pg.Pool({ connectionString: url, max: 10 })
  const fromClient = (c: pg.PoolClient): Db =>
    wrap(
      'postgres',
      c,
      async (sql) => {
        await c.query(sql)
      },
      async (fn) => fn(fromClient(c)),
      async () => undefined,
    )
  return wrap(
    'postgres',
    pool,
    async (sql) => {
      await pool.query(sql)
    },
    async (fn) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const out = await fn(fromClient(client))
        await client.query('COMMIT')
        return out
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    },
    async () => {
      await pool.end()
    },
  )
}

/** Abre o banco conforme a URL: postgres://, pglite://<pasta> ou memory:// */
export function openDb(url: string): Db {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return postgresDb(url)
  if (url.startsWith('pglite://')) return pgliteDb(url.slice('pglite://'.length))
  if (url === 'memory://') return pgliteDb()
  throw new Error(`DATABASE_URL não reconhecida: use postgres://, pglite:// ou memory://`)
}

/** Aplica as migrações pendentes, em ordem, cada uma numa transação. */
export async function migrate(db: Db): Promise<string[]> {
  await db.exec(`create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())`)
  const done = new Set((await db.query<{ id: string }>('select id from schema_migrations')).map((r) => r.id))
  const applied: string[] = []
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue
    await db.tx(async (t) => {
      await t.exec(m.sql)
      await t.query('insert into schema_migrations (id) values ($1)', [m.id])
    })
    applied.push(m.id)
  }
  return applied
}
