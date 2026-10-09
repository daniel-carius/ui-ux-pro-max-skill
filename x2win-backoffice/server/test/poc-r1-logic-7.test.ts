// PoC: a imutabilidade do audit_log depende de um gatilho por linha (BEFORE UPDATE OR DELETE
// FOR EACH ROW). Gatilhos por linha não disparam em TRUNCATE, e o papel com que a API conecta
// é dono da tabela (pode TRUNCATE, DISABLE TRIGGER, DROP TRIGGER). Os testes afirmam o
// comportamento seguro e FALHAM enquanto o problema existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestApp } from './helpers'

let app: FastifyInstance

async function seed(n: number) {
  for (let i = 0; i < n; i++) {
    await app.db.query(`insert into audit_log (actor_name, action, entity, summary, ip) values ($1, $2, $3, $4, $5)`, [
      'Fulano',
      'aprovar',
      'Saque',
      `Saque aprovado #${i}`,
      '1.2.3.4',
    ])
  }
}

const count = async () => (await app.db.one<{ n: number }>('select count(*)::int as n from audit_log'))!.n

beforeAll(async () => {
  app = await createTestApp()
})
afterAll(async () => app.close())

describe('PoC r1-logic-7: audit_log só aceita inclusão também contra TRUNCATE / papel da API', () => {
  it('controle: DELETE é bloqueado pelo gatilho', async () => {
    await seed(3)
    await expect(app.db.query('delete from audit_log')).rejects.toThrow(/apenas inclusão/)
    await expect(app.db.query(`update audit_log set summary = 'x'`)).rejects.toThrow(/apenas inclusão/)
    expect(await count()).toBeGreaterThanOrEqual(3)
  })

  it('TRUNCATE com a credencial da API não pode esvaziar a auditoria', async () => {
    await seed(5)
    const before = await count()
    console.log('[poc] linhas antes do truncate:', before)
    let err: unknown = null
    try {
      await app.db.query('truncate audit_log')
    } catch (e) {
      err = e
    }
    const after = await count()
    console.log('[poc] truncate erro:', err ? String(err) : 'nenhum', '| linhas depois:', after)
    expect(err, 'truncate audit_log deveria ser recusado').not.toBeNull()
    expect(after).toBe(before)
  })

  it('a credencial da API não pode desligar o gatilho de imutabilidade', async () => {
    await seed(2)
    const who = await app.db.one<{ cu: string; owner: string; su: boolean }>(
      `select current_user as cu, (select tableowner from pg_tables where tablename = 'audit_log') as owner,
              (select rolsuper from pg_roles where rolname = current_user) as su`,
    )
    console.log('[poc] current_user/owner/superuser:', JSON.stringify(who))
    let err: unknown = null
    try {
      await app.db.tx(async (t) => {
        await t.query('alter table audit_log disable trigger audit_log_no_change')
        const r = await t.query<{ n: number }>('with d as (delete from audit_log returning 1) select count(*)::int as n from d')
        console.log('[poc] linhas apagadas com o gatilho desligado:', r[0]!.n)
        await t.query('alter table audit_log enable trigger audit_log_no_change')
      })
    } catch (e) {
      err = e
    }
    console.log('[poc] disable trigger erro:', err ? String(err) : 'nenhum', '| linhas depois:', await count())
    expect(err, 'alter table ... disable trigger deveria ser recusado ao papel da API').not.toBeNull()
  })
})
