// PoC (round 2, #8): config.dominios.verificacoes tem write: ['dominios.ver'] (a tela Domínios é editable:false,
// então dominios.editar não existe). Quem só VÊ a tela pode substituir todo o histórico de verificações de DNS/SSL,
// apagando quedas registradas e gravando resultados "tudo no ar" com `by` de outra pessoa.
// Asserções do comportamento SEGURO: o teste FALHA enquanto o visualizador conseguir reescrever o histórico.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, createTestApp, loginAs, sessionCookie, createUser } from './helpers'

const KEY = 'config.dominios.verificacoes'

describe('config.dominios.verificacoes: quem só vê Domínios reescreve o histórico de verificações', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => {
    await app.close()
  })

  it('cargo só com dominios.ver apaga a queda registrada e grava um "tudo no ar" assinado por outra pessoa', async () => {
    const sa = await loginAs(app, 'superadmin', { name: 'Daniel Carius' })

    // superadmin cria, pela API, um cargo com só dominios.ver
    const cur = await api(app, 'GET', '/api/kv/cargos.lista', { cookie: sa.cookie })
    expect(cur.statusCode, cur.body).toBe(200)
    const list = cur.json() as { value: Array<Record<string, unknown>>; version: number }
    const viewerRole = {
      id: 'so-ver-dominios',
      name: 'Só ver Domínios',
      description: 'Visualizador',
      system: false,
      permissions: ['dominios.ver'],
      require2fa: false,
      approvalCeiling: 0,
      color: 'sky',
    }
    const putRoles = await api(app, 'PUT', '/api/kv/cargos.lista', {
      cookie: sa.cookie,
      body: { value: [...list.value, viewerRole], version: list.version },
    })
    expect(putRoles.statusCode, putRoles.body).toBe(200)

    const roleRow = await app.db.one<{ id: string; permissions: string[] }>(`select id, permissions from roles where name = $1`, ['Só ver Domínios'])
    console.log('[poc] role created:', JSON.stringify(roleRow))
    const viewer = await createUser(app, { roleId: roleRow.id, name: 'Visualizador' })
    const viewerCookie = await sessionCookie(app, viewer.id)

    // controle: o visualizador não tem nenhuma permissão de edição
    const me = await api(app, 'GET', '/api/auth/me', { cookie: viewerCookie })
    console.log('[poc] /api/auth/me', me.statusCode, me.body.slice(0, 400))

    // superadmin grava o histórico com uma queda registrada
    const outage = [
      { id: 'chk-1', at: '2026-10-09T10:00:00.000Z', by: 'Verificação automática', results: [{ host: 'x2win.bet.br', dnsOk: false, httpStatus: 503, latencyMs: 0 }] },
    ]
    const s = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: sa.cookie, body: { value: outage, version: 0 } })
    expect(s.statusCode, s.body).toBe(200)
    const v1 = (s.json() as { version: number }).version

    // visualizador substitui o histórico inteiro
    const fake = [
      { id: 'chk-x', at: '2026-10-09T10:00:00.000Z', by: 'Daniel Carius', results: [{ host: 'x2win.bet.br', dnsOk: true, httpStatus: 200, latencyMs: 1 }] },
    ]
    const w = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: viewerCookie, body: { value: fake, version: v1 } })
    console.log('[poc] viewer PUT', KEY, '->', w.statusCode, w.body)

    const after = await api(app, 'GET', `/api/kv/${KEY}`, { cookie: sa.cookie })
    console.log('[poc] stored after viewer PUT:', after.body)
    const audits = await app.db.query<{ summary: string; actor_id?: string }>(
      `select * from audit_log where summary like $1 order by id`,
      [`${KEY} —%`],
    )
    console.log('[poc] audit_log for key:', JSON.stringify(audits))

    // comportamento seguro: quem só vê a tela não reescreve o histórico
    expect(w.statusCode, 'cargo só com dominios.ver conseguiu substituir o histórico de verificações').toBe(403)
    const stored = (after.json() as { value: Array<{ id: string }> }).value
    expect(stored.map((c) => c.id)).toContain('chk-1')
  })
})
