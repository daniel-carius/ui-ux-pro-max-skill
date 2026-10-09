// PoC r1-authz-9: um Administrador (sem cargos.conceder) restringe a lista de IPs ao próprio IP
// e tranca todos os Superadmins fora do painel (inclusive o login), sem caminho de volta pelo painel.
// O teste afirma o comportamento seguro; ele FALHA enquanto o problema existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { api, createTestApp, createUser, sessionCookie } from './helpers'

const KEY = '/api/kv/config.seguranca-painel'
const ADMIN_IP = '10.0.0.5'
const SA_IP = '10.0.0.9'

describe('poc r1-authz-9: Administrador tranca os Superadmins com a lista de IPs', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  it('Administrador não deveria conseguir deixar todos os Superadmins fora da lista', async () => {
    const sa = await createUser(app, { roleId: 'superadmin', name: 'Superadmin' })
    const saCookie = await sessionCookie(app, sa.id, 'active', SA_IP)
    const adm = await createUser(app, { roleId: 'administrador', name: 'Administrador' })
    const admCookie = await sessionCookie(app, adm.id, 'active', ADMIN_IP)

    // antes: o Superadmin entra normalmente
    const before = await api(app, 'GET', '/api/auth/me', { cookie: saCookie, ip: SA_IP })
    console.log(`[before] superadmin GET /api/auth/me from ${SA_IP} -> ${before.statusCode}`)
    expect(before.statusCode).toBe(200)

    // Administrador confirma que não tem cargos.conceder
    const meAdm = await api(app, 'GET', '/api/auth/me', { cookie: admCookie, ip: ADMIN_IP })
    const admPerms: string[] = meAdm.json().permissions ?? meAdm.json().user?.permissions ?? []
    console.log(`[admin] has cargos.conceder=${admPerms.includes('cargos.conceder')} seguranca-painel.editar=${admPerms.includes('seguranca-painel.editar')}`)

    const cur = await api(app, 'GET', KEY, { cookie: admCookie, ip: ADMIN_IP })
    const val = cur.json().value ?? { allowlist: [], enforce2faForAll: false, sessionTimeoutMinutes: 240 }
    const put = await api(app, 'PUT', KEY, {
      cookie: admCookie,
      ip: ADMIN_IP,
      body: { value: { ...val, allowlist: [{ value: ADMIN_IP, label: 'só eu' }] }, version: cur.json().version ?? 0 },
    })
    console.log(`[admin] PUT config.seguranca-painel allowlist=[${ADMIN_IP}] -> ${put.statusCode} ${put.statusCode !== 200 ? put.body : ''}`)

    const me = await api(app, 'GET', '/api/auth/me', { cookie: saCookie, ip: SA_IP })
    console.log(`[after] superadmin GET /api/auth/me from ${SA_IP} -> ${me.statusCode} ${me.body}`)
    const login = await api(app, 'POST', '/api/auth/login', { ip: SA_IP, body: { email: sa.email, password: sa.password } })
    console.log(`[after] superadmin POST /api/auth/login from ${SA_IP} -> ${login.statusCode} ${login.body}`)
    // e o Superadmin não consegue desfazer pelo painel
    const fix = await api(app, 'PUT', KEY, { cookie: saCookie, ip: SA_IP, body: { value: { ...val, allowlist: [] }, version: 1 } })
    console.log(`[after] superadmin PUT allowlist=[] from ${SA_IP} -> ${fix.statusCode}`)

    // comportamento seguro: ou a gravação é recusada, ou o Superadmin continua entrando
    const lockedOut = put.statusCode === 200 && me.statusCode === 403 && login.statusCode === 403
    expect(lockedOut, 'Administrador sem cargos.conceder trancou todos os Superadmins fora do painel').toBe(false)
  })
})
