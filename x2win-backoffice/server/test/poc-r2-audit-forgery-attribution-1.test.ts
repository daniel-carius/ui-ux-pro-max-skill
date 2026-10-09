// PoC (verificador independente): qualquer cargo logado grava linhas "sensíveis" arbitrárias na auditoria
// via POST /api/audit/events; o painel (Auditoria, Modo de ataque, Manutenção) as trata como reais.
// Este teste afirma o comportamento SEGURO e por isso FALHA enquanto o problema existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { AuditEntry } from '@shared/audit'
import { newId } from '../src/lib/crypto'
import { api, createTestApp, loginAs } from './helpers'

// cópia literal de src/domain/config2-access.ts:327 (usada pelo KPI "Ações sensíveis" da Auditoria)
const SENSITIVE_ACTIONS = ['revelar', 'banir', 'desativar', 'ligar']

let app: FastifyInstance
let daniel: Awaited<ReturnType<typeof loginAs>>
let mario: Awaited<ReturnType<typeof loginAs>>
let saqueId: string

async function insertWithdrawal(a: FastifyInstance) {
  const id = newId('SQ')
  await a.db.query(
    `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                              risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
     values ($1, 'p1', 'Jogador Teste', 'jogador@exemplo.com', 480000, 0, 'pendente', 'baixo', 10, '["motivo"]'::jsonb, 'CPF', $2, 'E123', now(), now())`,
    [id, a.cipher.encrypt('12345678909')],
  )
  return id
}

beforeAll(async () => {
  app = await createTestApp()
  daniel = await loginAs(app, 'superadmin', { name: 'Daniel Carius' })
  mario = await loginAs(app, 'marketing', { name: 'Mário Marketing' })
  saqueId = await insertWithdrawal(app)
})
afterAll(async () => app.close())

describe('PoC r2 — auditoria forjada por cargo baixo', () => {
  it('marketing não deve conseguir registrar ações sensíveis nem virar o "último a ligar" do modo de ataque/manutenção', async () => {
    // 1) ações reais do Superadmin: aprovação de saque (servidor) e o relato do painel ao ligar modo de ataque / manutenção
    const approve = await api(app, 'POST', `/api/withdrawals/${saqueId}/approve`, { cookie: daniel.cookie, ip: '200.1.1.1' })
    console.log('[poc] Daniel approve status:', approve.statusCode)
    for (const [action, entity, summary] of [
      ['ligar', 'Modo de ataque', 'Ligado com captcha; desligamento manual'],
      ['ligar', 'Manutenção', 'Site fechado para manutenção. Previsão de volta: sem previsão'],
    ]) {
      const r = await api(app, 'POST', '/api/audit/events', { cookie: daniel.cookie, ip: '200.1.1.1', body: { action, entity, summary } })
      console.log(`[poc] Daniel panel-report ${action}/${entity}:`, r.statusCode)
    }

    // 2) marketing (só promoções/cupons/free-spins) forja linhas sensíveis
    const forged: [string, string][] = [
      ['aprovar', `Saque #${saqueId}`],
      ['revelar', `Saque #${saqueId}`],
      ['banir', `Saque #${saqueId}`],
      ['creditar', `Saque #${saqueId}`],
      ['estornar', `Saque #${saqueId}`],
      ['desativar', `Saque #${saqueId}`],
      ['ligar', 'Modo de ataque'],
      ['ligar', 'Manutenção'],
    ]
    const codes: number[] = []
    for (const [action, entity] of forged) {
      const r = await api(app, 'POST', '/api/audit/events', {
        cookie: mario.cookie,
        ip: '177.7.7.7',
        body: { action, entity, summary: 'Saque de R$ 4.800,00 de Jogador Teste aprovado por Daniel Carius' },
      })
      codes.push(r.statusCode)
      console.log(`[poc] marketing POST /api/audit/events ${action} "${entity}" ->`, r.statusCode, r.body)
    }

    // 3) o que a tela Auditoria lê (useAudit -> GET /api/kv/auditoria.registros)
    const kv = await api(app, 'GET', '/api/kv/auditoria.registros', { cookie: daniel.cookie })
    const entries = (kv.json().value ?? []) as AuditEntry[]
    for (const e of entries.filter((x) => x.entity.startsWith('Saque #') || x.entity === 'Modo de ataque' || x.entity === 'Manutenção')) {
      console.log('[poc] kv row:', JSON.stringify({ actorName: e.actorName, action: e.action, entity: e.entity, summary: e.summary, ip: e.ip, source: e.source }))
    }

    // 4) mesma lógica das telas
    const attackHistory = entries.filter((a) => a.entity === 'Modo de ataque') // ModoAtaque.tsx:164
    const lastOn = entries.find((a) => a.entity === 'Manutenção' && a.action === 'ligar') // Manutencao.tsx:95
    const sensitiveByMario = entries.filter((e) => e.actorId === mario.user.id && SENSITIVE_ACTIONS.includes(e.action)) // Auditoria.tsx:97/124
    console.log('[poc] ModoAtaque "Última mudança ... por":', attackHistory[0]?.actorName)
    console.log('[poc] Manutenção "Site fechado ... por":', lastOn?.actorName)
    console.log('[poc] KPI "Ações sensíveis" rows from marketing:', sensitiveByMario.length)

    // 5) CSV do servidor
    const csv = await api(app, 'GET', '/api/audit/export.csv', { cookie: daniel.cookie })
    for (const l of csv.body.split('\r\n').filter((x) => x.includes('Mário Marketing')).slice(0, 3)) console.log('[poc] csv:', l)

    // ---- comportamento seguro esperado ----
    expect(codes.every((c) => c === 403), `marketing gravou ações sensíveis: ${codes.join(',')}`).toBe(true)
    expect(attackHistory[0]?.actorName).toBe('Daniel Carius')
    expect(lastOn?.actorName).toBe('Daniel Carius')
  })
})
