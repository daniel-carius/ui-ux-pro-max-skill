// PoC (verificação independente): segregação de funções no caminho crédito manual → aprovação de saque.
// Os testes afirmam o comportamento SEGURO; falham enquanto o servidor não tiver regra de maker/checker
// nem tratar o poder de aprovar saque como sensível na governança de cargos.
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../src/lib/crypto'
import { api, createTestApp, loginAs } from './helpers'

async function insertWithdrawal(app: FastifyInstance, playerId: string, amount: number) {
  const id = newId('SQ')
  await app.db.query(
    `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                              risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at)
     values ($1, $2, 'Cumplice', 'c@x.com', $3, 0, 'pendente', 'baixo', 5, '[]'::jsonb, 'CPF', $4, 'E1', now(), now())`,
    [id, playerId, Math.round(amount * 100), app.cipher.encrypt('12345678909')],
  )
  return id
}

async function getKv(app: FastifyInstance, cookie: string, key: string) {
  const r = await api(app, 'GET', `/api/kv/${key}`, { cookie })
  expect(r.statusCode).toBe(200)
  return r.json() as { value: any; version: number }
}

const putKv = (app: FastifyInstance, cookie: string, key: string, value: unknown, version: number) =>
  api(app, 'PUT', `/api/kv/${key}`, { cookie, body: { value, version } })

async function seedPlayers(app: FastifyInstance, ids: string[]) {
  const root = await loginAs(app, 'superadmin')
  const players = ids.map((id) => ({ id, name: `J ${id}`, email: `${id}@x.com`, status: 'ativo', balanceReal: 0, balanceBonus: 0, tags: [] }))
  expect((await putKv(app, root.cookie, 'geral.jogadores', players, 0)).statusCode).toBe(200)
  const base = [{ id: 't0', type: 'deposito', amount: 10, playerId: ids[0], at: new Date(Date.now() - 3 * 86_400_000).toISOString() }]
  expect((await putKv(app, root.cookie, 'geral.transacoes', base, 0)).statusCode).toBe(200)
}

async function credit(app: FastifyInstance, cookie: string, playerId: string, amount: number) {
  const tx = await getKv(app, cookie, 'geral.transacoes')
  const item = { id: newId('tx'), playerId, type: 'credito_manual', amount, wallet: 'real', reference: 'AJUSTE', note: 'ajuste' }
  return putKv(app, cookie, 'geral.transacoes', [item, ...tx.value], tx.version)
}

describe('segregação de funções no pagamento (comportamento seguro esperado)', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
    await seedPlayers(app, ['p-a', 'p-b', 'p-c'])
  })
  afterAll(async () => app.close())

  it('Administrador que creditou o jogador NÃO deveria aprovar sozinho o saque desse jogador', async () => {
    const adm = await loginAs(app, 'administrador')
    const c = await credit(app, adm.cookie, 'p-a', 5000)
    expect(c.statusCode).toBe(200)
    const w = await insertWithdrawal(app, 'p-a', 5000)
    const ap = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: adm.cookie })
    const row = await app.db.one<{ status: string; decided_by_id: string | null }>('select status, decided_by_id from withdrawals where id = $1', [w])
    console.log('[SoD-1] Administrador credita R$ 5.000 e aprova o saque do mesmo jogador →', ap.statusCode, row?.status, 'decided_by_id == creditor:', row?.decided_by_id === adm.user.id)
    expect(ap.statusCode).toBe(403)
  })

  it('Administrador sem cargos.conceder NÃO deveria criar cargo não administrativo com saques.aprovar sem teto', async () => {
    const adm = await loginAs(app, 'administrador')
    const roles = await getKv(app, adm.cookie, 'cargos.lista')
    const caixa = {
      id: 'novo-caixa',
      name: 'Caixa',
      description: '',
      permissions: ['usuarios.ver', 'usuarios.editar', 'transacoes.ver', 'transacoes.editar', 'saques.ver', 'saques.aprovar'],
      require2fa: false,
      approvalCeiling: null,
    }
    const pr = await putKv(app, adm.cookie, 'cargos.lista', [...roles.value, caixa], roles.version)
    console.log('[SoD-2] Administrador cria cargo Caixa (sem teto, sem 2FA) →', pr.statusCode)
    if (pr.statusCode === 200) {
      const roleId = (pr.json().value as { id: string; name: string }[]).find((r) => r.name === 'Caixa')!.id
      const p = await loginAs(app, roleId, { name: 'Pessoa Caixa' })
      const c = await credit(app, p.cookie, 'p-b', 5000)
      const w = await insertWithdrawal(app, 'p-b', 5000)
      const ap = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: p.cookie })
      console.log('[SoD-2] Caixa credita →', c.statusCode, '| Caixa aprova saque do mesmo jogador →', ap.statusCode)
    }
    expect(pr.statusCode).toBe(403)
  })

  it('Administrador NÃO deveria transformar Suporte (2FA opcional) em aprovador sem teto', async () => {
    const adm = await loginAs(app, 'administrador')
    const roles = await getKv(app, adm.cookie, 'cargos.lista')
    const sup = (roles.value as any[]).find((r) => r.id === 'suporte')
    console.log('[SoD-3] Suporte antes: require2fa =', sup.require2fa, '| teto =', sup.approvalCeiling)
    const next = (roles.value as any[]).map((r) => (r.id === 'suporte' ? { ...r, permissions: [...r.permissions, 'saques.aprovar'], approvalCeiling: null } : r))
    const pr = await putKv(app, adm.cookie, 'cargos.lista', next, roles.version)
    console.log('[SoD-3] Administrador dá saques.aprovar sem teto ao Suporte →', pr.statusCode)
    if (pr.statusCode === 200) {
      const s = await loginAs(app, 'suporte')
      const c = await credit(app, s.cookie, 'p-c', 5000)
      const w = await insertWithdrawal(app, 'p-c', 250_000)
      const ap = await api(app, 'POST', `/api/withdrawals/${w}/approve`, { cookie: s.cookie })
      console.log('[SoD-3] Suporte credita →', c.statusCode, '| Suporte aprova R$ 250.000 →', ap.statusCode)
    }
    expect(pr.statusCode).toBe(403)
  })

  it('quem tem cargos.editar + equipe.editar mas NÃO tem saques.aprovar não deveria conseguir criar um aprovador sem teto', async () => {
    // cargo administrativo criado pelo Superadmin (único que pode): gestor de cargos/equipe, sem poder financeiro
    const root = await loginAs(app, 'superadmin')
    const roles = await getKv(app, root.cookie, 'cargos.lista')
    const gestor = { id: 'novo-gestor', name: 'Gestor RH', description: '', permissions: ['cargos.ver', 'cargos.editar', 'equipe.ver', 'equipe.editar'], require2fa: false, approvalCeiling: 0 }
    const pr = await putKv(app, root.cookie, 'cargos.lista', [...roles.value, gestor], roles.version)
    expect(pr.statusCode).toBe(200)
    const gestorId = (pr.json().value as { id: string; name: string }[]).find((r) => r.name === 'Gestor RH')!.id
    const g = await loginAs(app, gestorId, { name: 'Gestor' })
    const cur = await getKv(app, g.cookie, 'cargos.lista')
    const approver = { id: 'novo-aprov', name: 'Aprovador Livre', description: '', permissions: ['saques.ver', 'saques.aprovar'], require2fa: false, approvalCeiling: null }
    const pr2 = await putKv(app, g.cookie, 'cargos.lista', [...cur.value, approver], cur.version)
    console.log('[SoD-4] Gestor (sem saques.aprovar) cria cargo aprovador sem teto →', pr2.statusCode)
    if (pr2.statusCode === 200) {
      const aprovId = (pr2.json().value as { id: string; name: string }[]).find((r) => r.name === 'Aprovador Livre')!.id
      const d = await api(app, 'POST', '/api/team/direct', { cookie: g.cookie, body: { name: 'Conta Laranja', email: 'laranja@teste.x2win', roleId: aprovId } })
      console.log('[SoD-4] Gestor cria pessoa com o cargo aprovador →', d.statusCode)
    }
    expect(pr2.statusCode).toBe(403)
  })
})
