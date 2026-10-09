// PoC (round 2): configuração regulada guardada como JSON genérico (sem validação no servidor).
//  - config.jogo-responsavel (Lei 14.790/2023): validateRg (src/domain/config1-jogo-responsavel.ts:89)
//    roda só no navegador; o servidor aceita zero opções de pausa/autoexclusão, nenhuma mensagem,
//    alerta de sessão fora de 15–120 min e coolingOffHours 0.
//  - config.paises.bloqueados: canBlockCountry (src/domain/config1-paises.ts:20) recusa 'BR' só no navegador.
//  - seguranca.bloqueios: só observado (sem asserção) — antifraude.banir já pode desfazer bloqueios pela tela,
//    e o status dos jogadores é regra do servidor (player-status.ts), então previousStatuses forjado não muda nada.
// Asserções do comportamento SEGURO: os testes de RG e de país FALHAM enquanto o servidor aceitar qualquer conteúdo.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, createTestApp, loginAs } from './helpers'

function role(id: string, permissions: string[]) {
  return { id, name: id, description: 'PoC', system: false, permissions, require2fa: false, approvalCeiling: 0, color: 'amber' }
}

async function audits(app: FastifyInstance, like: string) {
  return app.db.query<{ actor_name: string; action: string; entity: string; summary: string }>(
    `select actor_name, action, entity, summary from audit_log where summary like $1 order by id`,
    [like],
  )
}

const DEFAULT_RG = {
  deposit: { daily: { default: 0, max: 10_000 }, weekly: { default: 0, max: 30_000 }, monthly: { default: 0, max: 100_000 } },
  loss: { daily: { default: 0, max: 5_000 }, weekly: { default: 0, max: 15_000 }, monthly: { default: 0, max: 50_000 } },
  session: { everyMinutes: 60, showSummary: true, requireAck: true },
  pause: { '24h': true, '7d': true, '30d': true },
  exclusion: { '6m': true, '1a': true, '2a': true, '5a': false, permanente: true },
  coolingOffHours: 72,
  messages: { items: ['Aposte com responsabilidade.'], footer: true, deposit: true, session: true },
}

describe('configuração regulada sem validação no servidor', () => {
  let app: FastifyInstance
  let root: { cookie: string }
  let rg: { cookie: string }
  let paises: { cookie: string }
  let banir: { cookie: string }

  beforeAll(async () => {
    app = await createTestApp()
    root = await loginAs(app, 'superadmin', { name: 'Daniel Carius' })
    const cur = await api(app, 'GET', '/api/kv/cargos.lista', { cookie: root.cookie })
    expect(cur.statusCode, cur.body).toBe(200)
    const { value, version } = cur.json() as { value: unknown[]; version: number }
    const put = await api(app, 'PUT', '/api/kv/cargos.lista', {
      cookie: root.cookie,
      body: {
        value: [
          ...value,
          role('SoRG', ['jogo-responsavel.ver', 'jogo-responsavel.editar']),
          role('SoPaises', ['paises.ver', 'paises.editar']),
          role('SoBanir', ['antifraude.ver', 'antifraude.banir']),
        ],
        version,
      },
    })
    expect(put.statusCode, put.body).toBe(200)
    // o servidor dá ids novos aos cargos incluídos: busca pelo nome
    const idOf = new Map((put.json() as { value: { id: string; name: string }[] }).value.map((r) => [r.name, r.id]))
    rg = await loginAs(app, idOf.get('SoRG')!, { name: 'Pessoa RG' })
    paises = await loginAs(app, idOf.get('SoPaises')!, { name: 'Pessoa Paises' })
    banir = await loginAs(app, idOf.get('SoBanir')!, { name: 'Pessoa Banir' })

    // estado inicial gravado pelo Superadmin
    const s1 = await api(app, 'PUT', '/api/kv/config.jogo-responsavel', { cookie: root.cookie, body: { value: DEFAULT_RG, version: 0 } })
    expect(s1.statusCode, s1.body).toBe(200)
    const s2 = await api(app, 'PUT', '/api/kv/seguranca.bloqueios', {
      cookie: root.cookie,
      body: {
        value: [
          { id: 'b1', kind: 'rede', value: 'rede-7', reason: 'Multicontas com bônus', accounts: ['p1', 'p2'], previousStatuses: { p1: 'pausa', p2: 'ativo' }, createdAt: '2026-10-01T12:00:00.000Z', createdBy: 'Daniel Carius' },
        ],
        version: 0,
      },
    })
    expect(s2.statusCode, s2.body).toBe(200)
  })
  afterAll(async () => app?.close())

  it('jogo-responsavel.editar não pode tirar todas as pausas/autoexclusões, mensagens e o prazo de reflexão', async () => {
    const cur = await api(app, 'GET', '/api/kv/config.jogo-responsavel', { cookie: rg.cookie })
    const { version } = cur.json() as { version: number }
    const big = { default: 0, max: 1e12 }
    const evil = {
      deposit: { daily: big, weekly: big, monthly: big },
      loss: { daily: big, weekly: big, monthly: big },
      session: { everyMinutes: 100_000, showSummary: false, requireAck: false },
      pause: { '24h': false, '7d': false, '30d': false },
      exclusion: { '6m': false, '1a': false, '2a': false, '5a': false, permanente: false },
      coolingOffHours: 0,
      messages: { items: [], footer: false, deposit: false, session: false },
    }
    const put = await api(app, 'PUT', '/api/kv/config.jogo-responsavel', { cookie: rg.cookie, body: { value: evil, version } })
    const after = await api(app, 'GET', '/api/kv/config.jogo-responsavel', { cookie: root.cookie })
    console.log('[poc] SoRG PUT config.jogo-responsavel →', put.statusCode)
    console.log('[poc] gravado:', JSON.stringify((after.json() as { value: unknown }).value))
    console.log('[poc] auditoria:', JSON.stringify(await audits(app, 'config.jogo-responsavel%')))
    expect(put.statusCode).toBe(400)
  })

  it("paises.editar não pode bloquear o Brasil (mercado da licença)", async () => {
    const put = await api(app, 'PUT', '/api/kv/config.paises.bloqueados', {
      cookie: paises.cookie,
      body: { value: [{ id: 'BR', code: 'BR', reason: 'teste', createdAt: '2026-10-09T00:00:00.000Z', createdBy: 'Daniel Carius' }], version: 0 },
    })
    console.log('[poc] SoPaises PUT config.paises.bloqueados [BR] →', put.statusCode, put.body.slice(0, 200))
    console.log('[poc] auditoria:', JSON.stringify(await audits(app, 'config.paises.bloqueados%')))
    expect(put.statusCode).toBe(400)
  })

  it('observação (sem asserção): antifraude.banir reescreve/remove registros de bloqueio', async () => {
    const cur = await api(app, 'GET', '/api/kv/seguranca.bloqueios', { cookie: banir.cookie })
    const { value, version } = cur.json() as { value: any[]; version: number }
    const forged = value.map((b) => (b.id === 'b1' ? { ...b, previousStatuses: { p1: 'ativo' }, createdBy: 'Outra pessoa' } : b))
    const put1 = await api(app, 'PUT', '/api/kv/seguranca.bloqueios', { cookie: banir.cookie, body: { value: forged, version } })
    const put2 = await api(app, 'PUT', '/api/kv/seguranca.bloqueios', { cookie: banir.cookie, body: { value: [], version: version + 1 } })
    console.log('[poc] SoBanir reescreve b1 →', put1.statusCode, '; apaga tudo →', put2.statusCode)
    console.log('[poc] auditoria:', JSON.stringify(await audits(app, 'seguranca.bloqueios%')))
  })
})
