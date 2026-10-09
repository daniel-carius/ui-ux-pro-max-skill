// PoC r1-logic-6: a exigência de 2FA (cargo require_2fa ou "2FA para todos") só é
// avaliada no login (computeStage). Sessões já abertas sem 2FA continuam 'active'
// depois de: troca de cargo para um cargo que exige 2FA, ligar require2fa no cargo
// (cargos.lista) e ligar enforce2faForAll (config.seguranca-painel).
// Os testes afirmam o comportamento SEGURO e falham enquanto o problema existir.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, createTestApp, loginAs } from './helpers'

describe('poc r1-logic-6: exigir 2FA não alcança sessões já abertas', () => {
  let app: FastifyInstance
  let admin: string

  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app, 'superadmin', { name: 'Daniel Superadmin' })).cookie
  })
  afterAll(async () => app.close())

  const me = async (cookie: string) => {
    const r = await api(app, 'GET', '/api/auth/me', { cookie })
    return { status: r.statusCode, body: r.statusCode === 200 ? r.json() : null }
  }
  const protectedRead = (cookie: string) => api(app, 'GET', '/api/kv/operacao.saques', { cookie })

  it('trocar o cargo para um que exige 2FA tira a sessão sem 2FA de "active"', async () => {
    const sup = await loginAs(app, 'suporte', { name: 'Sara Suporte' })
    const before = await me(sup.cookie)
    expect(before.status).toBe(200)
    expect(before.body.stage).toBe('active')

    const r = await api(app, 'POST', `/api/team/${sup.user.id}/role`, { cookie: admin, body: { roleId: 'marketing-oficial' } })
    expect(r.statusCode).toBe(200)

    const after = await me(sup.cookie)
    // eslint-disable-next-line no-console
    console.log('[role change] /me after:', after.status, JSON.stringify({ stage: after.body?.stage, roleId: after.body?.role?.id, require2fa: after.body?.role?.require2fa, totp: after.body?.user?.totpEnabled }))
    const camp = await api(app, 'GET', '/api/kv/campanhas.free-spins', { cookie: sup.cookie })
    // eslint-disable-next-line no-console
    console.log('[role change] GET campanhas.free-spins:', camp.statusCode)
    // seguro: sessão revogada (401) ou rebaixada para 'enroll'
    expect(after.status === 401 || after.body?.stage === 'enroll').toBe(true)
    expect(camp.statusCode).not.toBe(200)
  })

  it('ligar require2fa no cargo (cargos.lista) tira a sessão sem 2FA de "active"', async () => {
    const sup = await loginAs(app, 'suporte', { name: 'Silvio Suporte' })
    expect((await me(sup.cookie)).body.stage).toBe('active')
    expect((await protectedRead(sup.cookie)).statusCode).toBe(200)

    const cur = (await api(app, 'GET', '/api/kv/cargos.lista', { cookie: admin })).json() as { value: { id: string; require2fa: boolean }[]; version: number }
    const next = cur.value.map((r) => (r.id === 'suporte' ? { ...r, require2fa: true } : r))
    const w = await api(app, 'PUT', '/api/kv/cargos.lista', { cookie: admin, body: { value: next, version: cur.version } })
    expect(w.statusCode).toBe(200)

    const after = await me(sup.cookie)
    const read = await protectedRead(sup.cookie)
    // eslint-disable-next-line no-console
    console.log('[require2fa on role] /me after:', after.status, JSON.stringify({ stage: after.body?.stage, require2fa: after.body?.role?.require2fa }), 'GET operacao.saques:', read.statusCode)
    expect(after.status === 401 || after.body?.stage === 'enroll').toBe(true)
    expect(read.statusCode).not.toBe(200)
  })

  it('ligar "2FA para todos" tira a sessão sem 2FA de "active"', async () => {
    const fin = await loginAs(app, 'financeiro', { name: 'Fabio Financeiro' })
    expect((await me(fin.cookie)).body.stage).toBe('active')
    expect((await protectedRead(fin.cookie)).statusCode).toBe(200)

    const cur = (await api(app, 'GET', '/api/kv/config.seguranca-painel', { cookie: admin })).json() as { value: Record<string, unknown>; version: number }
    const w = await api(app, 'PUT', '/api/kv/config.seguranca-painel', {
      cookie: admin,
      body: { value: { ...cur.value, enforce2faForAll: true }, version: cur.version },
    })
    expect(w.statusCode).toBe(200)

    const after = await me(fin.cookie)
    const read = await protectedRead(fin.cookie)
    // eslint-disable-next-line no-console
    console.log('[enforce2faForAll] /me after:', after.status, JSON.stringify({ stage: after.body?.stage }), 'GET operacao.saques:', read.statusCode)
    expect(after.status === 401 || after.body?.stage === 'enroll').toBe(true)
    expect(read.statusCode).not.toBe(200)
  })
})
