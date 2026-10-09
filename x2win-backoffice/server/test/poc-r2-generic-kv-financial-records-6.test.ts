// PoC (round 2, #6): chaves genéricas (sem `domain`) com registros financeiros/regulados são
// sobrescritas por saveRow (update kv_store set value = …) sem guardar o valor anterior, e a
// auditoria do servidor (summarizeChange) registra só ids/nomes de campo, nunca valores.
// Depois de uma alteração ou exclusão, nenhuma tabela do banco guarda o valor anterior.
// Asserções do comportamento SEGURO (algum registro imutável guarda o estado anterior):
// o teste FALHA enquanto o valor anterior se perder.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, createTestApp, loginAs } from './helpers'

/** Todo o conteúdo do banco (todas as tabelas do schema public), decifrando colunas/valores cifrados. */
async function dumpDatabase(app: FastifyInstance): Promise<string> {
  const tables = await app.db.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  )
  const parts: string[] = []
  for (const { table_name } of tables) {
    const rows = await app.db.query<Record<string, unknown>>(`select * from "${table_name}"`)
    for (const row of rows) {
      for (const [col, v] of Object.entries(row)) {
        let text = typeof v === 'string' ? v : JSON.stringify(v)
        if (typeof v === 'string') {
          try {
            text += ` ${app.cipher.decrypt(v)}`
          } catch {
            /* não é cifrado */
          }
        }
        parts.push(`${table_name}.${col}=${text}`)
      }
    }
  }
  return parts.join('\n')
}

async function auditFor(app: FastifyInstance, key: string) {
  const rows = await app.db.query<{ summary: string; source: string }>(
    `select summary, source from audit_log where summary like $1 order by id`,
    [`${key} —%`],
  )
  return rows
}

describe('KV genérico: alteração/remoção de registro financeiro não deixa o valor anterior em lugar nenhum', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => {
    await app.close()
  })

  it('afiliados.saques: PUT [] apaga pagamentos (valor, dados bancários, quem decidiu) sem rastro', async () => {
    const KEY = 'afiliados.saques'
    const approver = await loginAs(app, 'administrador') // tem afiliados-saques.aprovar
    const payout = (id: string, amount: number, extra: Record<string, unknown> = {}) => ({
      id,
      affiliateId: 'a1',
      affiliateName: 'Afiliado Um',
      affiliateEmail: 'afiliado1@x.com',
      affiliateType: 'cpa',
      amount,
      status: 'pago',
      method: 'ted',
      pixKeyType: null,
      pixKey: null,
      bank: { name: 'Banco X', agency: '0001', account: '99887-6', holder: 'TITULAR-MARCADOR-ORIGINAL' },
      createdAt: '2026-09-01T10:00:00.000Z',
      decidedAt: '2026-09-02T10:00:00.000Z',
      decidedBy: 'DECISOR-MARCADOR-ORIGINAL',
      reason: null,
      reference: `REF-MARCADOR-${id}`,
      ...extra,
    })
    const seed = [payout('w1', 4321.87), payout('w2', 1234.56), payout('w3', 7777.77)]
    const s = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: approver.cookie, body: { value: seed, version: 0 } })
    expect(s.statusCode, s.body).toBe(200)
    // controle positivo: com o valor gravado (cifrado em repouso), a varredura do banco encontra os marcadores
    const before = await dumpDatabase(app)
    expect(before.includes('4321.87') && before.includes('TITULAR-MARCADOR-ORIGINAL') && before.includes('DECISOR-MARCADOR-ORIGINAL')).toBe(true)

    // alteração: valor e quem decidiu do w1 são reescritos
    const changed = [payout('w1', 1, { decidedBy: 'OUTRA PESSOA' }), seed[1], seed[2]]
    const c = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: approver.cookie, body: { value: changed, version: 1 } })
    expect(c.statusCode, c.body).toBe(200)

    // remoção: chamada direta à API, sem nenhum POST /api/audit/events
    const d = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: approver.cookie, body: { value: [], version: 2 } })
    expect(d.statusCode, d.body).toBe(200)

    const kvRows = await app.db.query<{ version: number; value_enc: string | null }>(
      `select version, value_enc from kv_store where key = $1`,
      [KEY],
    )
    const audits = await auditFor(app, KEY)
    console.log('[poc] kv_store rows:', kvRows.length, 'version:', kvRows[0]?.version, 'value:', app.cipher.decrypt(kvRows[0]!.value_enc!))
    console.log('[poc] audit_log for key:', JSON.stringify(audits))

    const dump = await dumpDatabase(app)
    const has = (needle: string) => dump.includes(needle)
    console.log(
      '[poc] DB contains old amount 4321.87:',
      has('4321.87'),
      '| 1234.56:',
      has('1234.56'),
      '| 7777.77:',
      has('7777.77'),
      '| holder:',
      has('TITULAR-MARCADOR-ORIGINAL'),
      '| decidedBy:',
      has('DECISOR-MARCADOR-ORIGINAL'),
      '| reference:',
      has('REF-MARCADOR-w2'),
    )

    // comportamento seguro: o estado anterior (valores, dados bancários e quem decidiu) continua recuperável
    expect(has('4321.87'), 'valor original do w1 (alterado para 1) não existe mais em nenhuma tabela').toBe(true)
    expect(has('7777.77'), 'valor do w3 apagado não existe mais em nenhuma tabela').toBe(true)
    expect(has('TITULAR-MARCADOR-ORIGINAL'), 'dados bancários dos pagamentos apagados não existem mais').toBe(true)
    expect(has('DECISOR-MARCADOR-ORIGINAL'), 'quem decidiu os pagamentos apagados não existe mais').toBe(true)
  })

  it('crescimento.ggr.apuracoes: Financeiro reescreve apuração paga (GGR, taxa, quem pagou) sem rastro do valor anterior', async () => {
    const KEY = 'crescimento.ggr.apuracoes'
    const fin = await loginAs(app, 'financeiro') // cargo de sistema com ggr.apurar
    const row = {
      id: 'g1',
      month: '2026-08',
      providerId: 'prov1',
      providerName: 'Pragmatic Play',
      bets: 1_000_000,
      wins: 900_000,
      ggr: 100_000,
      feePct: 10,
      feeDue: 98765.43,
      closedAt: '2026-09-01T12:00:00.000Z',
      closedBy: 'FECHOU-MARCADOR',
      paidAt: '2026-09-05T12:00:00.000Z',
      paidBy: 'PAGOU-MARCADOR',
      paymentRef: 'PAGREF-MARCADOR',
    }
    const s = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: fin.cookie, body: { value: [row], version: 0 } })
    expect(s.statusCode, s.body).toBe(200)
    const tampered = { ...row, feeDue: 1, paidBy: 'Outra', paymentRef: 'X', closedBy: 'Outra' }
    const t = await api(app, 'PUT', `/api/kv/${KEY}`, { cookie: fin.cookie, body: { value: [tampered], version: 1 } })
    expect(t.statusCode, t.body).toBe(200)

    const kv = await app.db.one<{ version: number; value: unknown }>(`select version, value from kv_store where key = $1`, [KEY])
    const audits = await auditFor(app, KEY)
    console.log('[poc] ggr kv_store:', JSON.stringify(kv))
    console.log('[poc] ggr audit_log:', JSON.stringify(audits))

    // o resumo da auditoria do servidor não traz nenhum valor
    expect(audits.map((a) => a.summary)).toEqual([`${KEY} — Primeira gravação com 1 item`, `${KEY} — Itens: 1 alterado (g1)`])

    const dump = await dumpDatabase(app)
    // controle positivo: o valor atual é encontrado pela varredura
    expect(dump.includes('Pragmatic Play')).toBe(true)
    console.log(
      '[poc] DB contains old feeDue 98765.43:',
      dump.includes('98765.43'),
      '| PAGOU-MARCADOR:',
      dump.includes('PAGOU-MARCADOR'),
      '| PAGREF-MARCADOR:',
      dump.includes('PAGREF-MARCADOR'),
      '| FECHOU-MARCADOR:',
      dump.includes('FECHOU-MARCADOR'),
    )
    // comportamento seguro: o valor anterior da apuração paga continua recuperável
    expect(dump.includes('98765.43'), 'valor devido original não existe mais em nenhuma tabela').toBe(true)
    expect(dump.includes('PAGOU-MARCADOR'), 'quem pagou originalmente não existe mais em nenhuma tabela').toBe(true)
  })
})
