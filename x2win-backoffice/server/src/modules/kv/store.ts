// Linhas da tabela kv_store: leitura (decifrando quando preciso), controle de
// versão e gravação (cifrada para chaves com segredos ou dados pessoais).
import type { KvRule } from '@shared/kv-registry'
import type { Db } from '../../db'
import { AppError } from '../../errors'
import type { Cipher } from '../../lib/crypto'
import { MISSING, type Maybe } from './json'

export interface KvRow {
  key: string
  value: unknown
  value_enc: string | null
  version: number
  updated_at: string
}

/** Chaves com segredos ou dados pessoais ficam cifradas em repouso (AES-256-GCM). */
export function encryptAtRest(rule: KvRule) {
  return !!(rule.secrets || rule.pii)
}

export function versionConflict(current: number) {
  return new AppError(409, 'versao_desatualizada', 'Outra pessoa salvou estes dados antes de você. Recarregue a tela e tente de novo.', {
    version: current,
  })
}

export function notStored() {
  return new AppError(404, 'nao_encontrado', 'Nenhum dado gravado nesta chave.')
}

/** Linha da chave (com "for update" dentro de transação, para travar até o fim). */
export async function loadRow(db: Db, key: string, lock = false): Promise<KvRow | null> {
  return db.one<KvRow>(`select key, value, value_enc, version, updated_at from kv_store where key = $1${lock ? ' for update' : ''}`, [key])
}

/** Valor em claro da linha. */
export function decodeRow(row: KvRow, cipher: Cipher): unknown {
  if (row.value_enc != null) return JSON.parse(cipher.decrypt(row.value_enc)) as unknown
  return row.value
}

export function storedValue(row: KvRow | null, cipher: Cipher): Maybe<unknown> {
  return row ? decodeRow(row, cipher) : MISSING
}

/**
 * Confere a versão enviada pelo painel: sem valor gravado aceita qualquer uma
 * (a primeira gravação cria a versão 1); com valor gravado precisa bater.
 */
export function assertVersion(row: KvRow | null, expected: number | undefined) {
  if (row && expected !== row.version) throw versionConflict(row.version)
}

/**
 * Grava a chave com a próxima versão. Chame dentro de db.tx depois de loadRow(…, true).
 * Se outra gravação passou na frente (corrida na primeira gravação), responde 409.
 */
export async function saveRow(
  t: Db,
  cipher: Cipher,
  key: string,
  value: unknown,
  encrypt: boolean,
  row: KvRow | null,
  userId: string,
): Promise<{ version: number; updatedAt: string }> {
  const json = JSON.stringify(value)
  const plain = encrypt ? null : json
  const enc = encrypt ? cipher.encrypt(json) : null
  type Out = { version: number; updated_at: string }
  let out: Out | null
  if (row) {
    out = await t.one<Out>(
      `update kv_store set value = $2::jsonb, value_enc = $3, version = version + 1, updated_at = now(), updated_by = $4
        where key = $1 and version = $5 returning version, updated_at`,
      [key, plain, enc, userId, row.version],
    )
  } else {
    out = await t.one<Out>(
      `insert into kv_store (key, value, value_enc, version, updated_by) values ($1, $2::jsonb, $3, 1, $4)
       on conflict (key) do nothing returning version, updated_at`,
      [key, plain, enc, userId],
    )
  }
  if (!out) {
    const cur = await t.one<{ version: number }>('select version from kv_store where key = $1', [key])
    throw versionConflict(cur?.version ?? 0)
  }
  return { version: out.version, updatedAt: out.updated_at }
}
