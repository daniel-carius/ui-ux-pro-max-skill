// PoC (r1-authn-3): o bloqueio por tentativas erradas (423 conta_bloqueada)
//  (a) revela quais e-mails são de pessoas ativas da equipe, e
//  (b) deixa qualquer cliente anônimo manter a conta de outra pessoa (inclusive Superadmin) bloqueada.
// Os testes afirmam o comportamento SEGURO e por isso FALHAM enquanto o problema existir.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SECURITY } from '../src/config'
import { api, createTestApp, createUser } from './helpers'

let app: FastifyInstance
beforeAll(async () => {
  app = await createTestApp()
})
afterAll(async () => {
  await app.close()
})

const login = (email: string, password: string, ip: string) =>
  api(app, 'POST', '/api/auth/login', { body: { email, password }, ip })

describe('PoC r1-authn-3: lockout como oráculo de e-mails e como negação de acesso', () => {
  it('(a) e-mail de pessoa ativa e e-mail inexistente devem receber a mesma sequência de respostas', async () => {
    const staff = await createUser(app, { roleId: 'superadmin', email: 'staff-real@x2win.bet.br' })

    const realStatuses: number[] = []
    const realCodes: string[] = []
    for (let i = 0; i < 6; i++) {
      const r = await login(staff.email, 'SenhaErrada999', '198.51.100.10')
      realStatuses.push(r.statusCode)
      realCodes.push(r.json().error.code)
    }
    const ghostStatuses: number[] = []
    const ghostCodes: string[] = []
    for (let i = 0; i < 6; i++) {
      const r = await login('ninguem-aqui@x2win.bet.br', 'SenhaErrada999', '198.51.100.11')
      ghostStatuses.push(r.statusCode)
      ghostCodes.push(r.json().error.code)
    }
    console.log('existing active e-mail :', JSON.stringify(realStatuses), JSON.stringify(realCodes))
    console.log('nonexistent e-mail     :', JSON.stringify(ghostStatuses), JSON.stringify(ghostCodes))
    // seguro: um atacante não deve conseguir distinguir uma pessoa real de um e-mail inexistente
    expect(realStatuses).toEqual(ghostStatuses)
  })

  it('(b) um cliente anônimo não deve conseguir impedir o Superadmin de entrar com a senha certa', async () => {
    const boss = await createUser(app, { roleId: 'superadmin', email: 'boss@x2win.bet.br', password: 'SenhaDoChefe2026' })
    const attackerIp = '203.0.113.66'
    const bossIp = '192.0.2.10'

    // rodada 1: 5 requisições anônimas (cabem com folga em 10/min por IP)
    const round1: number[] = []
    for (let i = 0; i < SECURITY.maxFailedLogins; i++) round1.push((await login(boss.email, 'chute-qualquer', attackerIp)).statusCode)
    const legit1 = await login(boss.email, boss.password, bossIp)
    console.log('round 1 attacker:', JSON.stringify(round1), '| superadmin with CORRECT password from own IP ->', legit1.statusCode, legit1.json().error?.code, legit1.json().error?.details?.until)

    // o prazo de 15 min passa; o atacante repete 5 requisições e o bloqueio volta
    await app.db.query(`update users set locked_until = now() - interval '1 second' where id = $1`, [boss.id])
    const round2: number[] = []
    for (let i = 0; i < SECURITY.maxFailedLogins; i++) round2.push((await login(boss.email, 'chute-qualquer', attackerIp)).statusCode)
    const legit2 = await login(boss.email, boss.password, bossIp)
    console.log('round 2 attacker:', JSON.stringify(round2), '| superadmin with CORRECT password from own IP ->', legit2.statusCode, legit2.json().error?.code)

    // seguro: a pessoa certa, com a senha certa e de outro IP, entra
    expect(legit1.statusCode).toBe(200)
    expect(legit2.statusCode).toBe(200)
  })
})
