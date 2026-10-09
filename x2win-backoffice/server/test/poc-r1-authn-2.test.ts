// PoC r1-authn-2: o bloqueio por tentativas erradas é checado ANTES do scrypt (~100 ms) e nunca
// rechecado na transação que concede sucesso. Requisições concorrentes passam todas pela guarda de
// `locked` antes que qualquer falha seja registrada, então o limite de 5 só vale para tentativas
// sequenciais. Contrato (docs/API.md:50): "5 erros seguidos bloqueiam por 15 min → 423 conta_bloqueada".
// Este teste afirma o comportamento seguro e FALHA enquanto o bug existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { SECURITY } from '../src/config'
import { api, createTestApp, createUser } from './helpers'

let ipSeq = 0
const nextIp = () => {
  ipSeq++
  return `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`
}

describe('PoC r1-authn-2: a guarda de bloqueio é furada por requisições concorrentes', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => {
    await app.close()
  })

  it('uma rajada concorrente de senhas erradas avalia muito mais que o limite e a senha correta ainda loga', async () => {
    const u = await createUser(app, { roleId: 'suporte' })
    const WRONG = 30

    // Dispara tudo a partir de um estado limpo (conta não bloqueada), cada requisição de um IP distinto
    // (o limite por IP é 10/min). Todas leem locked=false antes do primeiro registerFailure.
    const wrongReqs = Array.from({ length: WRONG }, () =>
      api(app, 'POST', '/api/auth/login', { body: { email: u.email, password: 'senha-errada-123' }, ip: nextIp() }),
    )
    const correctReq = api(app, 'POST', '/api/auth/login', { body: { email: u.email, password: u.password }, ip: nextIp() })

    const [correct, ...wrongs] = await Promise.all([correctReq, ...wrongReqs])
    const wrongStatuses = wrongs.map((r) => r.statusCode)

    // uma senha errada "avaliada" devolve 401 credenciais_invalidas; só devolve 423 quando a guarda
    // ou o registerFailure recusa a tentativa. Sob o comportamento seguro, após 5 erros o resto é 423.
    const evaluated = wrongStatuses.filter((s) => s === 401).length
    const blocked = wrongStatuses.filter((s) => s === 423).length

    const row = await app.db.one<{ failed_logins: number; locked_until: string | null }>(
      'select failed_logins, locked_until from users where id = $1',
      [u.id],
    )
    console.log(
      `correct login status=${correct.statusCode} stage=${correct.statusCode === 200 ? JSON.stringify(correct.json().stage) : '-'}; ` +
        `wrong 401(avaliadas)=${evaluated} 423(bloqueadas)=${blocked}; ` +
        `end failed_logins=${row!.failed_logins} locked_until=${row!.locked_until}`,
    )

    // SEGURO: o limite de 5 tentativas erradas vale também para a rajada concorrente — no máximo
    // SECURITY.maxFailedLogins senhas erradas podem ser avaliadas (401) antes de o 423 passar a valer.
    expect(
      evaluated,
      `${evaluated} senhas erradas foram avaliadas numa única rajada (limite deveria ser ${SECURITY.maxFailedLogins})`,
    ).toBeLessThanOrEqual(SECURITY.maxFailedLogins)

    // SEGURO: assim que a conta deveria estar bloqueada, a senha correta da mesma rajada não pode logar.
    expect(correct.statusCode, 'senha correta logou apesar de a conta dever estar bloqueada').toBe(423)

    // SEGURO: a conta termina bloqueada (a tentativa correta não pode ter limpado o bloqueio).
    expect(row!.locked_until, 'a conta deveria terminar bloqueada').not.toBeNull()
  })
})
