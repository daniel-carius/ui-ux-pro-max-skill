// PoC r1-authn-7: o primeiro Superadmin (criado por bootstrap() a partir de ADMIN_EMAIL/ADMIN_PASSWORD) entra
// só com senha, embora o bootstrap registre "No primeiro login será pedido o 2FA.". Os cargos 'superadmin' e
// 'administrador' nascem com require_2fa=false e panel_security.enforce_2fa_all=false.
// Comportamento seguro esperado: o primeiro login do Superadmin cai em 'enroll' (cadastro do 2FA), não em 'active'.
// Este teste FALHA enquanto o bug existir.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { bootstrap } from '../src/bootstrap'
import { api, cookieFrom, createTestApp } from './helpers'

const ADMIN_EMAIL = 'primeiro.admin@poc.x2win'
const ADMIN_PASSWORD = 'SenhaForteDoPoc2026'

describe('PoC r1-authn-7: primeiro Superadmin entra sem 2FA apesar do aviso do bootstrap', () => {
  let app: FastifyInstance
  const infoLogs: string[] = []
  beforeAll(async () => {
    app = await createTestApp({ ADMIN_EMAIL, ADMIN_PASSWORD })
    const spy = vi.spyOn(app.log, 'info').mockImplementation(((...args: unknown[]) => {
      infoLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
    }) as never)
    await bootstrap(app) // o mesmo passo que src/index.ts executa numa instalação nova
    spy.mockRestore()
  })
  afterAll(async () => {
    await app.close()
  })

  it('o bootstrap promete 2FA no primeiro login, mas o login devolve stage active sem cadastro de 2FA', async () => {
    console.log(`bootstrap log: ${JSON.stringify(infoLogs)}`)
    expect(infoLogs.some((m) => m.includes('No primeiro login será pedido o 2FA'))).toBe(true)

    const roles = await app.db.query<{ id: string; require_2fa: boolean }>(
      `select id, require_2fa from roles where id in ('superadmin', 'administrador') order by id`,
    )
    const ps = await app.db.one<{ enforce_2fa_all: boolean }>('select enforce_2fa_all from panel_security where id = 1')
    const u = await app.db.one<{ role_id: string; status: string; totp_enabled: boolean; must_change_password: boolean }>(
      'select role_id, status, totp_enabled, must_change_password from users where email = $1',
      [ADMIN_EMAIL],
    )
    console.log(`roles: ${JSON.stringify(roles)} panel_security: ${JSON.stringify(ps)} user: ${JSON.stringify(u)}`)

    const r = await api(app, 'POST', '/api/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, ip: '10.70.0.1' })
    console.log(`login -> ${r.statusCode} ${r.body}`)
    expect(r.statusCode).toBe(200)
    const cookie = cookieFrom(r)!

    // a sessão com só senha já alcança a API protegida (lista de cargos, que exige stage active)
    const kv = await api(app, 'GET', '/api/kv/cargos.lista', { cookie })
    const me = await api(app, 'GET', '/api/auth/me', { cookie })
    console.log(`password-only session: /api/kv/cargos.lista -> ${kv.statusCode}; /me -> ${me.statusCode} ${me.body.slice(0, 200)}`)

    // comportamento seguro: o 2FA prometido é exigido antes de liberar a conta com todas as permissões
    expect(r.json().stage).toBe('enroll')
    expect(kv.statusCode).toBe(403)
  })
})
