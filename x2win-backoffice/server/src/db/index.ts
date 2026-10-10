// Acesso ao banco: PostgreSQL (produção) ou PGlite (Postgres embutido, para
// desenvolvimento e testes). SQL explícito e sempre parametrizado ($1, $2...).
import { mkdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import { MIGRATIONS, RUNTIME_GRANTS_SQL, RUNTIME_ROLE } from './migrations'

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

/** Texto do Postgres ("2026-10-09 17:52:10.856+00") para ISO. O V8 exige o fuso como "+00:00". */
export function toIso(v: string): string {
  const s = v.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? v : d.toISOString()
}

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
  // NOTICE do Postgres (ex.: "crie o papel x2win_app" das migrações) vai para o log: o pg o descarta por padrão
  pool.on('connect', (c) => c.on('notice', (n) => console.warn(`[postgres] ${n.message}`)))
  // conexão ociosa encerrada pelo servidor (reinício, failover, pg_terminate_backend): só registra, e a próxima
  // consulta abre outra. Sem ouvinte, o 'error' derrubaria o processo da API.
  pool.on('error', (e) => console.error(`[postgres] conexão ociosa perdida: ${e.message}`))
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
      // conexão perdida no meio da transação: a consulta em andamento falha (e a requisição com ela), o processo não
      let broken: Error | undefined
      const onError = (e: Error) => {
        broken = e
        console.error(`[postgres] conexão perdida durante uma transação: ${e.message}`)
      }
      client.on('error', onError)
      try {
        await client.query('BEGIN')
        const out = await fn(fromClient(client))
        await client.query('COMMIT')
        return out
      } catch (e) {
        await client.query('ROLLBACK').catch((rollbackError: Error) => {
          broken ??= rollbackError
        })
        throw e
      } finally {
        client.removeListener('error', onError)
        // cliente quebrado é descartado, não volta para o pool
        client.release(broken)
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

export interface MigrateOptions {
  /**
   * Com o dono das tabelas: depois de aplicar as migrações e conceder os privilégios, falha se o papel de execução
   * (RUNTIME_ROLE) não existir ou ficar sem acesso. Padrão: true ("npm run migrate" sai com erro em vez de dizer que
   * está tudo certo). A API passa false: sobe e só avisa.
   */
  requireRuntimeRole?: boolean
}

/** Quem conecta é dono da auditoria (ou superusuário) e, portanto, quem concede os privilégios do papel de execução? */
async function ownsTables(db: Db): Promise<boolean> {
  const r = await db.one<{ owner: boolean | null }>(
    `select pg_has_role((select relowner from pg_class where oid = to_regclass('audit_log')), 'USAGE') as owner`,
  )
  return !!r?.owner
}

/** O papel de execução existe e alcança o controle de migrações (o primeiro SELECT da API ao subir)? */
export async function runtimeRoleStatus(db: Db): Promise<{ exists: boolean; granted: boolean }> {
  const exists = !!(await db.one('select 1 from pg_roles where rolname = $1', [RUNTIME_ROLE]))
  if (!exists) return { exists, granted: false }
  const r = await db.one<{ granted: boolean }>(
    `select has_schema_privilege($1, 'public', 'USAGE') and has_table_privilege($1, 'schema_migrations', 'SELECT') as granted`,
    [RUNTIME_ROLE],
  )
  return { exists, granted: !!r?.granted }
}

/**
 * Aplica as migrações pendentes, em ordem, cada uma numa transação. Com o banco em dia não roda nenhum DDL:
 * assim a API pode conectar com o papel de execução (sem permissão de DDL) e as migrações rodam antes, com o dono
 * das tabelas (npm run migrate).
 * Em seguida, se quem conecta é o dono das tabelas, (re)concede os privilégios do papel de execução
 * (RUNTIME_GRANTS_SQL) em TODA execução: papel criado depois das migrações passa a funcionar com um novo
 * "npm run migrate". Sem o papel, falha (requireRuntimeRole) depois de gravar as migrações.
 */
export async function migrate(db: Db, { requireRuntimeRole = true }: MigrateOptions = {}): Promise<string[]> {
  let done: Set<string>
  try {
    const table = await db.one<{ t: string | null }>(`select to_regclass('schema_migrations')::text as t`)
    if (!table?.t) await db.exec(`create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())`)
    done = new Set((await db.query<{ id: string }>('select id from schema_migrations')).map((r) => r.id))
  } catch (e) {
    if ((e as { code?: string }).code === '42501') {
      throw new Error(
        `O usuário do banco não tem acesso ao controle de migrações (schema_migrations). Rode "npm run migrate" com o usuário dono das tabelas: ele aplica as migrações e concede os privilégios do papel ${RUNTIME_ROLE}. Depois suba a API de novo.`,
        { cause: e },
      )
    }
    throw e
  }
  const applied: string[] = []
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue
    try {
      await db.tx(async (t) => {
        await t.exec(m.sql)
        await t.query('insert into schema_migrations (id) values ($1)', [m.id])
      })
    } catch (e) {
      if ((e as { code?: string }).code === '42501') {
        throw new Error(
          `Migração ${m.id} pendente e o usuário do banco não pode aplicá-la. Rode "npm run migrate" com o usuário dono das tabelas e suba a API de novo.`,
          { cause: e },
        )
      }
      throw e
    }
    applied.push(m.id)
  }

  if (await ownsTables(db)) {
    await db.exec(RUNTIME_GRANTS_SQL)
    const role = await runtimeRoleStatus(db)
    if (requireRuntimeRole && !role.granted) {
      const head = applied.length ? `Migrações aplicadas: ${applied.join(', ')}. ` : 'Migrações em dia. '
      throw new Error(
        role.exists
          ? `${head}Mas o papel ${RUNTIME_ROLE} continua sem acesso ao banco (schema public e schema_migrations): confira se as tabelas são deste usuário e rode "npm run migrate" de novo.`
          : `${head}Mas o papel ${RUNTIME_ROLE}, com que a API conecta, não existe neste banco e este usuário não pode criá-lo. Crie-o com login e senha (deploy/db-init/10-x2win-app-role.sh, com um administrador do banco) e rode "npm run migrate" de novo: os privilégios dele são concedidos a cada execução. Não suba a API com o dono das tabelas: com essa credencial a auditoria pode ser apagada.`,
      )
    }
  }
  return applied
}

/**
 * Passa a conexão para o papel de execução (RUNTIME_ROLE) depois das migrações.
 *  - PGlite (desenvolvimento e testes): um só usuário, superusuário; SET ROLE faz o resto da execução rodar com os
 *    mesmos privilégios da produção (auditoria só com SELECT e INSERT, sem DDL).
 *  - Postgres: a separação vem da credencial (DATABASE_URL com um usuário do papel, veja deploy/db-init). Nada a fazer.
 * Devolve se a troca aconteceu.
 */
export async function useRuntimeRole(db: Db): Promise<boolean> {
  if (db.kind !== 'pglite') return false
  const role = await db.one('select 1 from pg_roles where rolname = $1', [RUNTIME_ROLE])
  if (!role) return false
  await db.exec(`set role ${RUNTIME_ROLE}`)
  return true
}

/** O usuário da conexão é superusuário ou dono da auditoria (pode apagá-la ou desligar o gatilho)? */
export async function connectedAsOwner(db: Db): Promise<boolean> {
  const r = await db.one<{ owner: boolean }>(
    `select coalesce((select rolsuper from pg_roles where rolname = current_user), false)
            or pg_has_role(current_user, (select relowner from pg_class where oid = to_regclass('audit_log')), 'USAGE') as owner`,
  )
  return !!r?.owner
}

/** O banco responde a um "select 1" em até `ms`? Nunca lança (sonda de saúde do HEALTHCHECK e da monitoração). */
export async function pingDb(db: Db, ms = 2000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  try {
    const answered = db.one('select 1 as ok').then(
      () => true,
      () => false,
    )
    return await Promise.race([answered, timeout])
  } finally {
    clearTimeout(timer)
  }
}
