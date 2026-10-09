// PoC: ensureRoles (roda a cada boot) quebra a subida após uma edição normal de
// cargos e recria cargos personalizados da semente que foram excluídos.
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { Role } from '@shared/permissions'
import { bootstrap, ensureRoles } from '../src/bootstrap'
import { api, createTestApp, loginAs } from './helpers'

let app: FastifyInstance
afterEach(async () => app?.close())

async function readRoles(cookie: string) {
  const r = await api(app, 'GET', '/api/kv/cargos.lista', { cookie })
  expect(r.statusCode).toBe(200)
  const body = r.json() as { value: Role[]; version: number }
  return body
}

describe('poc-r1-logic-4: ensureRoles a cada boot', () => {
  it('(1) excluir "marketing" e criar "Marketing" pela API não pode impedir a próxima subida', async () => {
    app = await createTestApp()
    const { cookie } = await loginAs(app, 'superadmin')
    const cur = await readRoles(cookie)
    const mk = cur.value.find((r) => r.id === 'marketing')!
    const next = cur.value
      .filter((r) => r.id !== 'marketing')
      .concat([{ ...mk, id: 'novo-marketing', name: 'Marketing', description: 'Marketing (recriado)' }])
    const put = await api(app, 'PUT', '/api/kv/cargos.lista', { cookie, body: { value: next, version: cur.version } })
    console.log('PUT status', put.statusCode)
    expect(put.statusCode).toBe(200)
    const after = await app.db.query<{ id: string; name: string }>('select id, name from roles order by id')
    console.log('roles after PUT', JSON.stringify(after))

    // simula o próximo restart/deploy: index.ts chama bootstrap() antes de listen()
    let bootErr: unknown = null
    try {
      await bootstrap(app)
    } catch (e) {
      bootErr = e
    }
    console.log('bootstrap error:', bootErr ? String((bootErr as Error).message) : 'none')
    expect(bootErr).toBeNull()
  })

  it('(2) cargo personalizado "adm" excluído pela API não pode voltar sozinho no próximo boot', async () => {
    app = await createTestApp()
    const { cookie } = await loginAs(app, 'superadmin')
    const cur = await readRoles(cookie)
    const next = cur.value.filter((r) => r.id !== 'adm')
    const put = await api(app, 'PUT', '/api/kv/cargos.lista', { cookie, body: { value: next, version: cur.version } })
    console.log('PUT status', put.statusCode)
    expect(put.statusCode).toBe(200)
    const gone = await app.db.one<{ n: number }>(`select count(*)::int as n from roles where id = 'adm'`)
    console.log('adm rows after delete:', gone?.n)
    expect(gone?.n).toBe(0)

    await ensureRoles(app) // próximo restart

    const back = await app.db.one<{ id: string; name: string; n: number }>(
      `select id, name, cardinality(permissions)::int as n from roles where id = 'adm'`,
    )
    console.log('adm after ensureRoles:', JSON.stringify(back))
    expect(back).toBeNull()
  })
})
