// PoC (r1-exposure-7): o bloqueio por tentativas (423) revela quais e-mails são de pessoas ativas.
// Asserção do comportamento seguro: a resposta a senhas erradas não pode depender de o e-mail
// existir/estar ativo. Enquanto o bug existir, este teste FALHA.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { api, createTestApp, createUser } from './helpers'

let app: FastifyInstance
beforeAll(async () => {
  app = await createTestApp()
})
afterAll(async () => {
  await app.close()
})

async function probe(email: string, ipBase: string, n = 7) {
  const statuses: number[] = []
  const codes: string[] = []
  for (let i = 0; i < n; i++) {
    // um IP por tentativa: o limite de 10/min por IP não atrapalha o atacante
    const res = await api(app, 'POST', '/api/auth/login', {
      body: { email, password: 'chute-errado-' + i },
      ip: `${ipBase}.${i + 1}`,
    })
    statuses.push(res.statusCode)
    codes.push(res.json()?.error?.code)
  }
  return { statuses, codes }
}

describe('poc-r1-exposure-7: enumeração de e-mails via 423', () => {
  it('e-mail ativo, inexistente, convidado e desligado recebem as mesmas respostas', async () => {
    const ativo = await createUser(app, { roleId: 'suporte', email: 'ana.souza@x2win.bet.br' })
    const convidado = await createUser(app, { roleId: 'suporte', email: 'bia.lima@x2win.bet.br', status: 'convidado' })
    const desligado = await createUser(app, { roleId: 'suporte', email: 'caio.reis@x2win.bet.br', status: 'desligado' })

    const rAtivo = await probe(ativo.email, '10.1.0')
    const rInexistente = await probe('nao.existe@x2win.bet.br', '10.2.0')
    const rConvidado = await probe(convidado.email, '10.3.0')
    const rDesligado = await probe(desligado.email, '10.4.0')

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ativo: rAtivo, inexistente: rInexistente, convidado: rConvidado, desligado: rDesligado }))

    // a senha CERTA no estado bloqueado também responde 423 (antes de conferir a senha)
    const certa = await api(app, 'POST', '/api/auth/login', { body: { email: ativo.email, password: ativo.password }, ip: '10.9.9.9' })
    // eslint-disable-next-line no-console
    console.log('senha certa durante bloqueio:', certa.statusCode, certa.json()?.error?.code)

    expect(rAtivo.statuses).toEqual(rInexistente.statuses)
    expect(rAtivo.codes).toEqual(rInexistente.codes)
    expect(rConvidado.statuses).toEqual(rInexistente.statuses)
    expect(rDesligado.statuses).toEqual(rInexistente.statuses)
  })
})
