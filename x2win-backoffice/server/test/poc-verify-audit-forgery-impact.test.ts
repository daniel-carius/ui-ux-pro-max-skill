// PoC (verificação de impacto): cargo marketing relata eventos "sensíveis" via POST /api/audit/events.
// Confere o que o leitor da auditoria realmente vê: quem/IP/cargo vêm do servidor.
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

describe('impacto: eventos de auditoria relatados por cargo baixo', () => {
  it('marketing grava aprovar/revelar/banir/creditar/estornar/desativar/ligar; linhas saem com o nome, id e IP do marketing', async () => {
    const daniel = await loginAs(app, 'superadmin', { name: 'Daniel Carius' })
    const mkt = await loginAs(app, 'marketing', { name: 'Mário Marketing' })

    const actions = ['aprovar', 'revelar', 'banir', 'creditar', 'estornar', 'desativar', 'ligar']
    for (const action of actions) {
      const entity = action === 'ligar' ? 'Modo de ataque' : 'Saque #SQ_9_rb39MAgqXh'
      const r = await api(app, 'POST', '/api/audit/events', {
        cookie: mkt.cookie,
        ip: '203.0.113.7',
        body: { action, entity, summary: 'Saque de R$ 4.800,00 de Jogador Teste aprovado por Daniel Carius', actorName: 'Daniel Carius', actorId: daniel.user.id },
      })
      console.log('POST', action, '->', r.statusCode)
      expect(r.statusCode).toBe(201)
    }

    // marketing não lê a auditoria
    const mktRead = await api(app, 'GET', '/api/kv/auditoria.registros', { cookie: mkt.cookie })
    console.log('marketing GET auditoria.registros ->', mktRead.statusCode)

    // o superadmin lê: o que aparece como "Quem fez"
    const r = await api(app, 'GET', '/api/kv/auditoria.registros', { cookie: daniel.cookie })
    expect(r.statusCode).toBe(200)
    const rows = (r.json().value as Array<Record<string, string>>).filter((e) => e.source === 'painel')
    for (const e of rows) console.log(JSON.stringify({ actorId: e.actorId, actorName: e.actorName, action: e.action, entity: e.entity, ip: e.ip, source: e.source }))
    expect(rows).toHaveLength(7)
    for (const e of rows) {
      expect(e.actorId).toBe(mkt.user.id)
      expect(e.actorName).toBe('Mário Marketing')
      expect(e.actorId).not.toBe(daniel.user.id)
    }

    // estado real do modo de ataque não muda (a linha só altera o texto "por <nome>")
    const atk = await api(app, 'GET', '/api/kv/seguranca.modo-ataque', { cookie: daniel.cookie })
    console.log('modo-ataque GET ->', atk.statusCode, atk.body.slice(0, 200))
  })
})
