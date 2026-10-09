// PoC r1-authn-6: a etapa da sessão só é decidida no login. Exigir 2FA (troca de cargo, require_2fa no cargo,
// enforce_2fa_all) não afeta sessões já ativas, e uma sessão ativa sem 2FA liga o 2FA (e leva os códigos de
// recuperação) sem digitar a senha. Comportamento seguro esperado: depois da exigência, a sessão sem 2FA não
// continua em 'active' com acesso à API; e /2fa/setup em sessão ativa pede reautenticação.
// Este teste FALHA enquanto o bug existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { totpCode } from '../src/lib/totp'
import { api, cookieFrom, createTestApp, createUser, loginAs } from './helpers'

let ipSeq = 0
const nextIp = () => `10.66.0.${++ipSeq}`

async function realLogin(app: FastifyInstance, email: string, password: string) {
  const r = await api(app, 'POST', '/api/auth/login', { body: { email, password }, ip: nextIp() })
  expect(r.statusCode).toBe(200)
  return { stage: r.json().stage as string, cookie: cookieFrom(r)! }
}

describe('PoC r1-authn-6: exigência de 2FA não alcança sessões ativas; 2FA ligado sem reautenticar', () => {
  let app: FastifyInstance
  let admin: string
  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app, 'superadmin')).cookie
  })
  afterAll(async () => {
    await app.close()
  })

  it('mudar para cargo com require_2fa deixa a sessão já ativa em active', async () => {
    const v = await createUser(app, { roleId: 'suporte' })
    const s = await realLogin(app, v.email, v.password)
    expect(s.stage).toBe('active')
    const ch = await api(app, 'POST', `/api/team/${v.id}/role`, { cookie: admin, body: { roleId: 'marketing-oficial' } })
    console.log(`role change -> ${ch.statusCode}`)
    expect(ch.statusCode).toBe(200)
    const me = await api(app, 'GET', '/api/auth/me', { cookie: s.cookie })
    const read = await api(app, 'GET', '/api/kv/cargos.lista', { cookie: s.cookie })
    console.log(`after role change (require_2fa=true): /me status=${me.statusCode} stage=${me.statusCode === 200 ? me.json().stage : '-'} kv read=${read.statusCode}`)
    // seguro: a sessão sem 2FA não continua ativa
    expect(me.statusCode === 200 ? me.json().stage : 'revoked').not.toBe('active')
    expect(read.statusCode).not.toBe(200)
  })

  it('ligar require_2fa no cargo da pessoa deixa a sessão já ativa em active', async () => {
    const v = await createUser(app, { roleId: 'financeiro' })
    const s = await realLogin(app, v.email, v.password)
    expect(s.stage).toBe('active')
    const cur = await api(app, 'GET', '/api/kv/cargos.lista', { cookie: admin })
    const roles = cur.json().value as Array<{ id: string; require2fa: boolean }>
    const next = roles.map((r) => (r.id === 'financeiro' ? { ...r, require2fa: true } : r))
    const put = await api(app, 'PUT', '/api/kv/cargos.lista', { cookie: admin, body: { value: next, version: cur.json().version } })
    console.log(`toggle require_2fa on financeiro -> ${put.statusCode}`)
    expect(put.statusCode).toBe(200)
    const me = await api(app, 'GET', '/api/auth/me', { cookie: s.cookie })
    const read = await api(app, 'GET', '/api/kv/operacao.saques', { cookie: s.cookie })
    console.log(`after require_2fa toggle: /me status=${me.statusCode} stage=${me.statusCode === 200 ? me.json().stage : '-'} saques read=${read.statusCode}`)
    expect(me.statusCode === 200 ? me.json().stage : 'revoked').not.toBe('active')
    expect(read.statusCode).not.toBe(200)
  })

  it('enforce_2fa_all deixa a sessão já ativa em active', async () => {
    const v = await createUser(app, { roleId: 'suporte' })
    const s = await realLogin(app, v.email, v.password)
    expect(s.stage).toBe('active')
    const cur = await api(app, 'GET', '/api/kv/config.seguranca-painel', { cookie: admin })
    const val = cur.json().value ?? { allowlist: [], enforce2faForAll: false, sessionTimeoutMinutes: 240 }
    const put = await api(app, 'PUT', '/api/kv/config.seguranca-painel', {
      cookie: admin,
      body: { value: { ...val, enforce2faForAll: true }, version: cur.json().version },
    })
    console.log(`enforce_2fa_all=true -> ${put.statusCode}`)
    expect(put.statusCode).toBe(200)
    // login novo de outra pessoa já cai em enroll (prova que a exigência está valendo)
    const other = await createUser(app, { roleId: 'suporte' })
    const fresh = await realLogin(app, other.email, other.password)
    const me = await api(app, 'GET', '/api/auth/me', { cookie: s.cookie })
    const read = await api(app, 'GET', '/api/kv/operacao.saques', { cookie: s.cookie })
    console.log(`fresh login stage=${fresh.stage}; old session: /me status=${me.statusCode} stage=${me.statusCode === 200 ? me.json().stage : '-'} saques read=${read.statusCode}`)
    // desfaz para não afetar o próximo teste
    const cur2 = await api(app, 'GET', '/api/kv/config.seguranca-painel', { cookie: admin })
    await api(app, 'PUT', '/api/kv/config.seguranca-painel', {
      cookie: admin,
      body: { value: { ...cur2.json().value, enforce2faForAll: false }, version: cur2.json().version },
    })
    expect(fresh.stage).toBe('enroll')
    expect(me.statusCode === 200 ? me.json().stage : 'revoked').not.toBe('active')
    expect(read.statusCode).not.toBe(200)
  })

  it('sessão ativa (cookie roubado) liga o 2FA sem senha, leva os códigos e tranca o dono', async () => {
    const v = await createUser(app, { roleId: 'administrador' })
    const owner = await realLogin(app, v.email, v.password)
    const attacker = await realLogin(app, v.email, v.password) // senha vazada; outra sessão
    expect(attacker.stage).toBe('active')
    const setup = await api(app, 'POST', '/api/auth/2fa/setup', { cookie: attacker.cookie, ip: nextIp() })
    console.log(`attacker /2fa/setup (no password) -> ${setup.statusCode}`)
    let codes: string[] = []
    if (setup.statusCode === 200) {
      const secret = setup.json().secret as string
      const en = await api(app, 'POST', '/api/auth/2fa/enable', { cookie: attacker.cookie, body: { code: totpCode(secret, Date.now()) }, ip: nextIp() })
      codes = en.statusCode === 200 ? en.json().recoveryCodes : []
      console.log(`attacker /2fa/enable -> ${en.statusCode} recoveryCodes=${codes.length}`)
    }
    const ownerMe = await api(app, 'GET', '/api/auth/me', { cookie: owner.cookie })
    const relog = await realLogin(app, v.email, v.password)
    console.log(`owner's other session /me -> ${ownerMe.statusCode}; owner fresh login stage=${relog.stage} (needs a code the attacker holds)`)
    // seguro: ligar o 2FA a partir de sessão ativa exige reautenticação (senha)
    expect(setup.statusCode).not.toBe(200)
    expect(codes.length).toBe(0)
  })
})
