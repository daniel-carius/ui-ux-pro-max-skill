// Verificação independente (impacto) de r1-exposure-1.
// Os testes afirmam o comportamento OBSERVADO hoje (passam enquanto o problema existir)
// e imprimem a evidência. Não altera código de produção.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { seedDemo as seedWithdrawals } from '../src/modules/withdrawals/seed'
import { api, createTestApp, loginAs } from './helpers'

const EMAIL = 'maria.silva@gmail.com'

describe('verify r1-exposure-1 (impacto)', () => {
  let app: FastifyInstance
  let admin: { cookie: string }
  let suporte: { cookie: string }
  let lowest: { cookie: string }
  let wdEmail = ''

  beforeAll(async () => {
    app = await createTestApp()
    admin = await loginAs(app, 'superadmin')
    suporte = await loginAs(app, 'suporte')
    await app.db.query('insert into roles (id, name, permissions) values ($1, $2, $3)', ['so-dashboard', 'Só dashboard', ['dashboard.ver']])
    lowest = await loginAs(app, 'so-dashboard')
    await seedWithdrawals(app)
    const w = await app.db.one<{ player_email: string }>('select player_email from withdrawals order by id limit 1')
    wdEmail = w!.player_email
    const now = new Date().toISOString()
    const writes: [string, unknown][] = [
      ['geral.jogadores', [{ id: 'p1', name: 'Maria Silva', email: EMAIL, cpf: '12345678909', status: 'ativo' }]],
      ['geral.transacoes', [{ id: 't1', at: now, type: 'deposito', amount: 100, wallet: 'real', playerId: 'p1', playerName: 'Maria Silva', playerEmail: EMAIL }]],
      ['campanhas.free-spins.concessoes', [{ id: 'g1', playerId: 'p1', playerName: 'Maria Silva', playerEmail: EMAIL }]],
    ]
    for (const [key, value] of writes) {
      const r = await api(app, 'PUT', `/api/kv/${key}`, { cookie: admin.cookie, body: { value } })
      expect(r.statusCode, r.body).toBe(200)
    }
  })
  afterAll(async () => app.close())

  it('controles explícitos do servidor mascaram o e-mail do jogador para o Suporte', async () => {
    const jog = await api(app, 'GET', '/api/kv/geral.jogadores', { cookie: suporte.cookie })
    const saq = await api(app, 'GET', '/api/kv/operacao.saques', { cookie: suporte.cookie })
    console.log('[suporte] geral.jogadores email =', jog.json().value[0].email)
    console.log('[suporte] operacao.saques playerEmail =', saq.json().value.find((x: { playerEmail: string }) => x.playerEmail.includes('***'))?.playerEmail)
    expect(jog.json().value[0].email).toBe('ma***@gmail.com')
    expect(saq.statusCode).toBe(200)
    expect(saq.body).not.toContain(wdEmail)
  })

  it('o mesmo Suporte recebe o e-mail completo por geral.transacoes', async () => {
    const r = await api(app, 'GET', '/api/kv/geral.transacoes', { cookie: suporte.cookie })
    console.log('[suporte] geral.transacoes ->', r.statusCode, JSON.stringify(r.json().value))
    expect(r.statusCode).toBe(200)
    expect(r.body).toContain(EMAIL)
  })

  it('cargo só com dashboard.ver: transacoes 403, mas concessões de free spins trazem e-mail completo', async () => {
    const tx = await api(app, 'GET', '/api/kv/geral.transacoes', { cookie: lowest.cookie })
    const fs = await api(app, 'GET', '/api/kv/campanhas.free-spins.concessoes', { cookie: lowest.cookie })
    console.log('[so-dashboard] geral.transacoes ->', tx.statusCode)
    console.log('[so-dashboard] campanhas.free-spins.concessoes ->', fs.statusCode, JSON.stringify(fs.json().value))
    expect(tx.statusCode).toBe(403)
    expect(fs.statusCode).toBe(200)
    expect(fs.body).toContain(EMAIL)
  })

  it('em repouso: withdrawals.player_email já é texto puro por projeto (só o PIX é cifrado)', async () => {
    const row = await app.db.one<{ player_email: string; pix_key_enc: string }>('select player_email, pix_key_enc from withdrawals order by id limit 1')
    const kv = await app.db.query<{ key: string; enc: boolean }>(`select key, value_enc is not null as enc from kv_store order by key`)
    console.log('[db] withdrawals.player_email =', row!.player_email, '| pix_key_enc prefix =', row!.pix_key_enc.slice(0, 12))
    console.log('[db] kv_store enc:', JSON.stringify(kv))
    expect(row!.player_email).toContain('@')
  })
})
