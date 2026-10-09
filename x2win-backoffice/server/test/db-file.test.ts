import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrate, openDb, toIso } from '../src/db'

describe('datas do Postgres', () => {
  it('converte os formatos de texto do Postgres para ISO', () => {
    expect(toIso('2026-10-09 17:52:10.856+00')).toBe('2026-10-09T17:52:10.856Z')
    expect(toIso('2026-10-09 14:52:10-03')).toBe('2026-10-09T17:52:10.000Z')
    expect(toIso('2026-10-09 14:52:10.1+0530')).toBe('2026-10-09T09:22:10.100Z')
    expect(toIso('2026-10-09T17:52:10Z')).toBe('2026-10-09T17:52:10.000Z')
  })

  it('banco em arquivo (pglite://) devolve datas válidas', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'x2w-db-'))
    const db = openDb(`pglite://${dir}`)
    await migrate(db)
    const r = await db.one<{ now: string }>('select now() as now')
    expect(Number.isNaN(new Date(r!.now).getTime())).toBe(false)
    expect(r!.now).toMatch(/Z$/)
    await db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
