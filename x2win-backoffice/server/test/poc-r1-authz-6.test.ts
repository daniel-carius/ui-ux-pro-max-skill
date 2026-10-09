// PoC: ensureRoles() (rodado em todo boot por index.ts -> bootstrap) reinsere os cargos
// personalizados semeados ('adm', 'marketing') com `on conflict (id) do nothing`.
// (1) cargo excluído volta após reiniciar; (2) excluir 'marketing' e criar outro cargo com
// o mesmo nome faz o boot falhar em roles_name_uq (lower(name)).
// Os testes afirmam o comportamento seguro: falham enquanto o bug existir.
import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { Role } from '@shared/permissions'
import { ensureRoles } from '../src/bootstrap'
import { api, createTestApp, loginAs } from './helpers'

async function getRoles(app: FastifyInstance, cookie: string) {
  const res = await api(app, 'GET', '/api/kv/cargos.lista', { cookie })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { value: Role[]; version: number }
  return body
}

describe('PoC r1-authz-6: cargos semeados x reinício', () => {
  let app: FastifyInstance
  afterEach(async () => app?.close())

  it('cargo personalizado semeado excluído não volta após reiniciar', async () => {
    app = await createTestApp()
    const { cookie } = await loginAs(app, 'administrador')
    const cur = await getRoles(app, cookie)
    const res = await api(app, 'PUT', '/api/kv/cargos.lista', {
      cookie,
      body: { value: cur.value.filter((r) => r.id !== 'adm'), version: cur.version },
    })
    console.log('PUT sem adm ->', res.statusCode)
    expect(res.statusCode).toBe(200)
    const before = await app.db.query<{ id: string }>(`select id from roles where id = 'adm'`)
    console.log('adm após exclusão:', before.length)
    expect(before.length).toBe(0)

    // reinício: index.ts -> bootstrap -> ensureRoles
    await ensureRoles(app)
    const after = await app.db.query<{ id: string; name: string; permissions: string[] }>(
      `select id, name, permissions from roles where id = 'adm'`,
    )
    console.log('adm após ensureRoles (reinício):', JSON.stringify(after.map((r) => ({ id: r.id, name: r.name, perms: r.permissions.length }))))
    expect(after.length).toBe(0)
  })

  it('excluir "marketing" e criar outro cargo "Marketing" não impede o próximo boot', async () => {
    app = await createTestApp()
    const { cookie } = await loginAs(app, 'administrador')
    let cur = await getRoles(app, cookie)
    let res = await api(app, 'PUT', '/api/kv/cargos.lista', {
      cookie,
      body: { value: cur.value.filter((r) => r.id !== 'marketing'), version: cur.version },
    })
    console.log('PUT sem marketing ->', res.statusCode)
    expect(res.statusCode).toBe(200)

    cur = await getRoles(app, cookie)
    res = await api(app, 'PUT', '/api/kv/cargos.lista', {
      cookie,
      body: {
        value: [
          ...cur.value,
          { id: 'novo', name: 'Marketing', description: 'novo', permissions: ['dashboard.ver'], require2fa: false, approvalCeiling: 0, color: 'rose' },
        ],
        version: cur.version,
      },
    })
    console.log('PUT com novo "Marketing" ->', res.statusCode)
    expect(res.statusCode).toBe(200)

    // reinício: index.ts faz `await bootstrap(app)` antes de listen -> exceção derruba o processo
    let bootError: unknown = null
    try {
      await ensureRoles(app)
    } catch (e) {
      bootError = e
    }
    console.log('ensureRoles (reinício) ->', bootError ? `THROW: ${(bootError as Error).message}` : 'ok')
    expect(bootError).toBeNull()
  })
})
