// PoC (r1-exposure-9): respostas sensíveis sem `cache-control: no-store`.
// Asserção do comportamento seguro: GET /api/audit (IPs, e-mails e nomes de jogadores nos resumos)
// precisa sair com `no-store`, como /api/kv/* e /api/auth/*. Sem isso o Chrome grava o corpo no
// cache em disco do perfil e ele continua lá depois do logout. (As rotas POST de saques/webhooks
// não entram aqui: navegadores não gravam respostas de fetch POST no cache.)
// Enquanto o bug existir, o segundo teste FALHA.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { api, createTestApp, loginAs } from './helpers'

let app: FastifyInstance
beforeAll(async () => {
  app = await createTestApp()
})
afterAll(async () => {
  await app.close()
})

describe('poc-r1-exposure-9: cache-control em respostas sensíveis', () => {
  it('controle: GET /api/kv/auditoria.registros já sai com no-store', async () => {
    const { cookie } = await loginAs(app, 'superadmin', { email: 'ctrl@x2win.bet.br' })
    const res = await api(app, 'GET', '/api/kv/auditoria.registros', { cookie })
    expect(res.statusCode).toBe(200)
    expect(String(res.headers['cache-control'] ?? '')).toContain('no-store')
  })

  it('GET /api/audit (mesmos dados da auditoria, com IP e e-mails) sai com no-store', async () => {
    const { cookie } = await loginAs(app, 'superadmin', { email: 'super@x2win.bet.br' })
    // gera um registro com e-mail no resumo
    const ev = await api(app, 'POST', '/api/audit/events', {
      cookie,
      body: { action: 'editar', entity: 'Jogador #42', summary: 'E-mail do jogador alterado para maria.silva@gmail.com' },
    })
    expect(ev.statusCode).toBe(201)

    const res = await api(app, 'GET', '/api/audit', { cookie, ip: '203.0.113.7' })
    console.log('GET /api/audit status', res.statusCode, 'headers', JSON.stringify(res.headers))
    expect(res.statusCode).toBe(200)
    const body = res.json() as { items: { ip?: string; summary: string }[] }
    expect(JSON.stringify(body)).toContain('maria.silva@gmail.com')
    expect(JSON.stringify(body)).toContain('127.0.0.1') // IP de quem gravou o evento
    expect(String(res.headers['cache-control'] ?? '')).toContain('no-store')
  })
})
