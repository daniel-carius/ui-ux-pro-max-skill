import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { findKvRule, KV_DEFAULT_MAX_BYTES } from '@shared/kv-registry'
import type { KvHandler } from '../src/kv/types'
import kvRoutes from '../src/modules/kv/routes'
import { MISSING, summarizeChange } from '../src/modules/kv/json'
import { readPolicy, redact, restoreMasked, writePolicy } from '../src/modules/kv/redact'
import { api, createTestApp, createUser, loginAs, sessionCookie } from './helpers'

// ---------- utilitários ----------

const put = (app: FastifyInstance, cookie: string, key: string, value: unknown, version?: number) =>
  api(app, 'PUT', `/api/kv/${key}`, { cookie, body: version === undefined ? { value } : { value, version } })
const get = (app: FastifyInstance, cookie: string, key: string) => api(app, 'GET', `/api/kv/${key}`, { cookie })

interface RawRow {
  value: unknown
  value_enc: string | null
  version: number
  updated_by: string | null
}
const rawRow = (app: FastifyInstance, key: string) =>
  app.db.one<RawRow>('select value, value_enc, version, updated_by from kv_store where key = $1', [key])
/** Valor em claro gravado (decifra quando preciso). */
async function storedPlain(app: FastifyInstance, key: string): Promise<unknown> {
  const r = await rawRow(app, key)
  if (!r) return undefined
  return r.value_enc ? JSON.parse(app.cipher.decrypt(r.value_enc)) : r.value
}

interface AuditRow {
  actor_id: string | null
  action: string
  entity: string
  summary: string
  ip: string | null
  source: string
}
const audits = (app: FastifyInstance) => app.db.query<AuditRow>('select actor_id, action, entity, summary, ip, source from audit_log order by id desc')
const lastAudit = async (app: FastifyInstance) => (await audits(app))[0]

async function customRole(app: FastifyInstance, id: string, permissions: string[]) {
  await app.db.query('insert into roles (id, name, permissions) values ($1, $2, $3)', [id, `Cargo ${id}`, permissions])
}

/** Superadmin com 2FA ativo (único que importa a base de jogadores e o extrato). */
async function importer(app: FastifyInstance): Promise<{ cookie: string }> {
  return { cookie: (await loginAs(app, 'superadmin', { totp: true, name: 'Importador' })).cookie }
}

const BULLETS = '••••••••••'

/** Cupom que passa nas regras do painel/servidor. */
const validCoupon = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  code: `CUPOM-${id.toUpperCase()}`,
  reward: 'bonus_pct',
  value: 100,
  maxBonus: 500,
  rollover: 10,
  maxUses: 100,
  perPlayer: 1,
  startsAt: '2026-01-01T00:00:00.000Z',
  endsAt: '2099-01-01T00:00:00.000Z',
  audience: 'todos',
  minDeposit: 20,
  paused: false,
  ...extra,
})
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

// ---------- regras gerais da rota ----------

describe('kv: acesso, chaves e versão', () => {
  let app: FastifyInstance
  let admin: { user: { id: string }; cookie: string }
  beforeAll(async () => {
    app = await createTestApp()
    admin = await loginAs(app)
  })
  afterAll(async () => app.close())

  it('exige sessão ativa', async () => {
    const r = await api(app, 'GET', '/api/kv/campanhas.cupons')
    expect(r.statusCode).toBe(401)
    expect(r.json().error.code).toBe('nao_autenticado')
    const w = await api(app, 'PUT', '/api/kv/campanhas.cupons', { body: { value: [] } })
    expect(w.statusCode).toBe(401)

    const u = await createUser(app)
    const pending = await sessionCookie(app, u.id, '2fa')
    const p = await get(app, pending, 'campanhas.cupons')
    expect(p.statusCode).toBe(403)
    expect(p.json().error).toMatchObject({ code: 'etapa_pendente', details: { stage: '2fa' } })
    const pw = await put(app, pending, 'campanhas.cupons', [])
    expect(pw.statusCode).toBe(403)
    expect(pw.json().error.code).toBe('etapa_pendente')
  })

  it('chave sem regra → 404 chave_desconhecida; formato inválido também', async () => {
    for (const key of ['nada.disso', 'campanhas', 'x', 'campanhas..cupons', 'campanhas.cupons.', 'campanhas.cupons%20x', 'a'.repeat(99)]) {
      const r = await get(app, admin.cookie, key)
      expect(r.statusCode, key).toBe(404)
      expect(r.json().error.code, key).toBe('chave_desconhecida')
    }
    const w = await put(app, admin.cookie, 'nada.disso', 1)
    expect(w.statusCode).toBe(404)
    expect(w.json().error.code).toBe('chave_desconhecida')
  })

  it('chave local → 400 chave_local (mesmo quando cairia numa regra)', async () => {
    for (const key of ['sessao.atual', 'campanhas.promocoes.visao', 'config.textos-legais.rascunhos.meu']) {
      const r = await get(app, admin.cookie, key)
      expect(r.statusCode, key).toBe(400)
      expect(r.json().error.code, key).toBe('chave_local')
      const w = await put(app, admin.cookie, key, { a: 1 })
      expect(w.statusCode, key).toBe(400)
      expect(w.json().error.code, key).toBe('chave_local')
    }
    expect(await app.db.query(`select key from kv_store where key like 'campanhas.promocoes.visao%'`)).toEqual([])
  })

  it('nunca gravada → 200 com stored=false', async () => {
    const r = await get(app, admin.cookie, 'campanhas.missoes')
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ key: 'campanhas.missoes', value: null, version: 0, updatedAt: null, stored: false })
  })

  it('grava, lê e controla versão', async () => {
    const v1 = [{ id: 'c1', code: 'BEMVINDO', active: true }]
    // primeira gravação aceita qualquer versão e cria a versão 1
    const w1 = await put(app, admin.cookie, 'campanhas.jornadas', v1, 7)
    expect(w1.statusCode).toBe(200)
    expect(w1.json()).toMatchObject({ key: 'campanhas.jornadas', value: v1, version: 1 })
    expect(typeof w1.json().updatedAt).toBe('string')
    expect(w1.headers['cache-control']).toBe('no-store')

    const r1 = await get(app, admin.cookie, 'campanhas.jornadas')
    expect(r1.statusCode).toBe(200)
    expect(r1.json()).toEqual({ key: 'campanhas.jornadas', value: v1, version: 1, updatedAt: w1.json().updatedAt, stored: true })
    expect(r1.headers['cache-control']).toBe('no-store')

    const row = await rawRow(app, 'campanhas.jornadas')
    expect(row).toMatchObject({ value: v1, value_enc: null, version: 1, updated_by: admin.user.id })

    // sem versão ou versão velha → 409 com a versão atual
    const noVersion = await put(app, admin.cookie, 'campanhas.jornadas', [])
    expect(noVersion.statusCode).toBe(409)
    expect(noVersion.json().error).toMatchObject({ code: 'versao_desatualizada', details: { version: 1 } })
    const stale = await put(app, admin.cookie, 'campanhas.jornadas', [], 0)
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.details.version).toBe(1)
    const ahead = await put(app, admin.cookie, 'campanhas.jornadas', [], 2)
    expect(ahead.statusCode).toBe(409)

    const v2 = [...v1, { id: 'c2', code: 'DOBRO', active: false }]
    const w2 = await put(app, admin.cookie, 'campanhas.jornadas', v2, 1)
    expect(w2.statusCode).toBe(200)
    expect(w2.json().version).toBe(2)
    expect((await get(app, admin.cookie, 'campanhas.jornadas')).json().value).toEqual(v2)
    const again = await put(app, admin.cookie, 'campanhas.jornadas', v1, 1)
    expect(again.statusCode).toBe(409)
    expect(again.json().error.details.version).toBe(2)
  })

  it('só as chaves filhas declaradas (children) seguem a regra da mãe; outras são desconhecidas', async () => {
    // filha declarada: guardada separada, com a regra (e a tela) da mãe
    const w = await put(app, admin.cookie, 'cassino.agregadores.testes', [{ id: 'r1' }])
    expect(w.statusCode).toBe(200)
    expect(w.json().version).toBe(1)
    expect(await rawRow(app, 'cassino.agregadores.testes')).toMatchObject({ version: 1 })
    expect((await lastAudit(app)).entity).toBe('Dados · Agregadores de jogos')
    // filha não declarada: 404, nada gravado
    for (const key of ['campanhas.cupons.qualquer', 'campanhas.promocoes.flood-1', 'cassino.agregadores.testes.x', 'geral.jogadores.extra']) {
      const r = await put(app, admin.cookie, key, { a: 1 })
      expect(r.statusCode, key).toBe(404)
      expect(r.json().error.code, key).toBe('chave_desconhecida')
      expect((await get(app, admin.cookie, key)).statusCode, key).toBe(404)
    }
    expect(await app.db.query(`select key from kv_store where key like 'campanhas.promocoes.%'`)).toEqual([])
  })

  it('aceita qualquer JSON (objeto, lista, texto, número, null)', async () => {
    // chaves sem regra de formato no servidor (missões, roleta e torneios têm validador: rules-campaigns.ts)
    const keys = ['cassino.vitrines', 'campanhas.templates', 'config.suporte', 'campanhas.notificacoes.historico', 'campanhas.popups-inbox.popups', 'campanhas.popups-inbox.inbox']
    for (const [i, value] of [{ a: { b: [1, 2] } }, 'texto', 42, true, null, []].entries()) {
      const key = keys[i]
      const w = await put(app, admin.cookie, key, value)
      expect(w.statusCode, key).toBe(200)
      const r = await get(app, admin.cookie, key)
      expect(r.json().value, key).toEqual(value)
    }
  })

  it('valida o corpo', async () => {
    const key = 'config.modulos'
    const cases: unknown[] = [{}, { version: 1 }, { value: 1, version: 'x' }, { value: 1, version: -1 }, { value: 1, version: 1.5 }, [1], 'texto']
    for (const body of cases) {
      const r = await api(app, 'PUT', `/api/kv/${key}`, { cookie: admin.cookie, body })
      expect(r.statusCode, JSON.stringify(body)).toBe(400)
      expect(r.json().error.code).toBe('dados_invalidos')
    }
    // aninhamento exagerado
    let deep: unknown = 1
    for (let i = 0; i < 100; i++) deep = [deep]
    const d = await put(app, admin.cookie, key, deep)
    expect(d.statusCode).toBe(400)
    expect(d.json().error.code).toBe('dados_invalidos')
    // caractere nulo (o jsonb recusa)
    const nul = await put(app, admin.cookie, key, { nome: 'a\u0000b' })
    expect(nul.statusCode).toBe(400)
    const nulKey = await put(app, admin.cookie, key, { ['a\u0000']: 1 })
    expect(nulKey.statusCode).toBe(400)
    // surrogate solto
    const sur = await put(app, admin.cookie, key, { nome: 'a\ud800b' })
    expect(sur.statusCode).toBe(400)
    // nada foi gravado
    expect(await rawRow(app, key)).toBeNull()
    // 50 níveis ainda passam
    let ok: unknown = 1
    for (let i = 0; i < 50; i++) ok = { n: ok }
    expect((await put(app, admin.cookie, key, ok)).statusCode).toBe(200)
  })

  it('aceita alguns MB de dados nas chaves com imagens; as demais têm limite menor (413)', async () => {
    const big = Array.from({ length: 3000 }, (_, i) => ({ id: `b${i}`, image: `data:image/png;base64,${'A'.repeat(1000)}` }))
    const w = await put(app, admin.cookie, 'personalizacao.banners', big)
    expect(w.statusCode).toBe(200)
    const r = await get(app, admin.cookie, 'personalizacao.banners')
    expect(r.statusCode).toBe(200)
    expect(r.json().value).toHaveLength(3000)
    expect(r.json().value[2999]).toEqual(big[2999])
    // chave sem imagens: acima de KV_DEFAULT_MAX_BYTES → 413, nada gravado
    const blob = { blob: 'B'.repeat(KV_DEFAULT_MAX_BYTES + 10) }
    const t = await put(app, admin.cookie, 'campanhas.promocoes', blob)
    expect(t.statusCode).toBe(413)
    expect(t.json().error.code).toBe('dados_grandes_demais')
    expect(await rawRow(app, 'campanhas.promocoes')).toBeNull()
  })
})

// ---------- permissões por cargo ----------

describe('kv: permissões de leitura e gravação', () => {
  let app: FastifyInstance
  let admin: string
  let marketing: string
  let suporte: string
  let financeiro: string
  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app)).cookie
    marketing = (await loginAs(app, 'marketing')).cookie
    suporte = (await loginAs(app, 'suporte')).cookie
    financeiro = (await loginAs(app, 'financeiro')).cookie
    expect((await put(app, admin, 'config.gateways', { accounts: [] })).statusCode).toBe(200)
    expect((await put(app, admin, 'config.mcp', { keys: [] })).statusCode).toBe(200)
    expect((await put(app, admin, 'config.empresa', { name: 'X2Win' })).statusCode).toBe(200)
  })
  afterAll(async () => app.close())

  it('Marketing grava campanhas.cupons mas não config.gateways nem config.empresa', async () => {
    const w = await put(app, marketing, 'campanhas.cupons', [validCoupon('c1')])
    expect(w.statusCode, w.body).toBe(200)
    const g = await put(app, marketing, 'config.gateways', { accounts: [] }, 1)
    expect(g.statusCode).toBe(403)
    expect(g.json().error.code).toBe('sem_permissao')
    const e = await put(app, marketing, 'config.empresa', { name: 'Outra' }, 1)
    expect(e.statusCode).toBe(403)
    expect(e.json().error.code).toBe('sem_permissao')
    expect(await storedPlain(app, 'config.empresa')).toEqual({ name: 'X2Win' })
  })

  it("leitura 'tela': só quem vê a tela dona ou uma de readPages", async () => {
    // Marketing não vê Gateways nem Depósitos
    const m = await get(app, marketing, 'config.gateways')
    expect(m.statusCode).toBe(403)
    expect(m.json().error.code).toBe('sem_permissao')
    // Suporte não vê a tela de MCP
    const s = await get(app, suporte, 'config.mcp')
    expect(s.statusCode).toBe(403)
    // Suporte vê Depósitos, mas a tela de Depósitos não lê a configuração dos gateways: 403 (r3)
    for (const key of ['config.gateways', 'config.gateways.contas', 'config.gateways.roteamento']) {
      expect((await get(app, suporte, key)).statusCode, key).toBe(403)
    }
    // Financeiro tem gateways.ver: lê, mas não grava (sem gateways.editar)
    expect((await get(app, financeiro, 'config.gateways')).statusCode).toBe(200)
    const fw = await put(app, financeiro, 'config.gateways', { accounts: [] }, 1)
    expect(fw.statusCode).toBe(403)
    expect(fw.json().error.code).toBe('sem_permissao')
  })

  it("leitura 'equipe': qualquer pessoa logada", async () => {
    const r = await get(app, marketing, 'config.empresa')
    expect(r.statusCode).toBe(200)
    expect(r.json().value).toEqual({ name: 'X2Win' })
  })

  it("chaves 'servidor' recusam gravação de qualquer cargo (inclusive Superadmin)", async () => {
    for (const key of [
      'esportes.apostas',
      'operacao.saques',
      'auditoria.registros',
      'campanhas.webhooks.execucoes',
      'afiliados.saques',
      'operacao.depositos',
      'campanhas.cupons.resgates',
      'campanhas.roleta.giros',
    ]) {
      const r = await put(app, admin, key, [])
      expect(r.statusCode, key).toBe(403)
      expect(r.json().error.code, key).toBe('sem_permissao')
    }
    expect(await rawRow(app, 'esportes.apostas')).toBeNull()
  })

  it('lista própria de gravação (write) substitui o padrão <tela>.editar', async () => {
    await customRole(app, 'comissoes-only', ['comissoes.ver', 'comissoes.editar'])
    const c = (await loginAs(app, 'comissoes-only')).cookie
    expect((await put(app, c, 'crescimento.links.status', { l1: 'ativo' })).statusCode).toBe(200)
    // links não é editável, mas comissoes.editar grava a chave; e não grava cupons
    expect((await put(app, c, 'campanhas.cupons', [], 1)).statusCode).toBe(403)
  })

  it('domínio: auditoria.registros é delegado ao módulo de auditoria', async () => {
    const r = await get(app, admin, 'auditoria.registros')
    expect(r.statusCode).toBe(200)
    expect(Array.isArray(r.json().value)).toBe(true)
    expect(r.json().key).toBe('auditoria.registros')
    expect(r.json().value.length).toBeGreaterThan(0)
    // Marketing não vê a auditoria
    expect((await get(app, marketing, 'auditoria.registros')).statusCode).toBe(403)
  })
})

// ---------- segredos ----------

describe('kv: segredos (rule.secrets)', () => {
  let app: FastifyInstance
  let admin: { user: { id: string }; cookie: string }
  const KEY = 'config.gateways'
  const original = {
    callbackToken: 'tok_callback_5678',
    accounts: [
      { id: 'g1', name: 'PixPay', apiKey: 'tst_key_ABCDEFGH1234', clientSecret: 'cs_secreto_9999', url: 'https://pixpay.exemplo.com' },
      { id: 'g2', name: 'Outro', apiKey: 'tst_key_ZZZZYYYY4321', clientSecret: 'cs_outro_8888', url: 'https://outro.exemplo.com' },
    ],
    credentials: { user: 'usuario-integracao', region: 'sa-east-1' },
    pins: ['1111', '2222'],
    tokens: ['tk_um_1111', 'tk_dois_2222'],
  }
  beforeAll(async () => {
    app = await createTestApp()
    admin = await loginAs(app)
  })
  afterAll(async () => app.close())

  it('cifra em repouso e mascara na resposta', async () => {
    const w = await put(app, admin.cookie, KEY, original)
    expect(w.statusCode).toBe(200)
    const v = w.json().value
    expect(v.callbackToken).toBe(`${BULLETS}5678`)
    // segredo com menos de 16 caracteres sai sem nenhum trecho (cs_secreto_9999 tem 15)
    expect(v.accounts[0]).toEqual({ id: 'g1', name: 'PixPay', apiKey: `${BULLETS}1234`, clientSecret: BULLETS, url: 'https://pixpay.exemplo.com' })
    // dentro de um campo de segredo, tudo é segredo
    expect(v.credentials).toEqual({ user: `${BULLETS}acao`, region: BULLETS })
    // nome de campo comum fica em claro; lista em campo de segredo é mascarada
    expect(v.pins).toEqual(['1111', '2222'])
    expect(v.tokens).toEqual([BULLETS, BULLETS])

    const row = await rawRow(app, KEY)
    expect(row?.value).toBeNull()
    expect(row?.value_enc).toMatch(/^v1\./)
    const dump = JSON.stringify(row)
    for (const s of ['tst_key_ABCDEFGH1234', 'cs_secreto_9999', 'tok_callback_5678', 'PixPay', 'usuario-integracao']) expect(dump).not.toContain(s)
    expect(await storedPlain(app, KEY)).toEqual(original)

    const r = await get(app, admin.cookie, KEY)
    expect(r.json().value).toEqual(v)
    // a auditoria não leva valores
    const a = await lastAudit(app)
    expect(a.entity).toBe('Dados · Gateways')
    expect(a.summary).not.toContain('sk_live')
    expect(a.summary).toContain('callbackToken')
  })

  it('valor mascarado na gravação preserva o segredo (por id, mesmo fora de ordem)', async () => {
    const masked = (await get(app, admin.cookie, KEY)).json()
    const next = structuredClone(masked.value)
    next.accounts.reverse()
    next.accounts.find((a: { id: string }) => a.id === 'g1').name = 'PixPay 2'
    const w = await put(app, admin.cookie, KEY, next, masked.version)
    expect(w.statusCode).toBe(200)
    const stored = (await storedPlain(app, KEY)) as typeof original
    expect(stored.callbackToken).toBe('tok_callback_5678')
    expect(stored.credentials).toEqual(original.credentials)
    expect(stored.tokens).toEqual(original.tokens)
    const g1 = stored.accounts.find((a) => a.id === 'g1')!
    const g2 = stored.accounts.find((a) => a.id === 'g2')!
    expect(g1).toEqual({ ...original.accounts[0], name: 'PixPay 2' })
    expect(g2).toEqual(original.accounts[1])
    expect(stored.accounts[0].id).toBe('g2')
    expect((await lastAudit(app)).summary).toContain('accounts (1 alterado (g1))')
  })

  it('segredo novo em claro substitui o gravado', async () => {
    const cur = (await get(app, admin.cookie, KEY)).json()
    const next = structuredClone(cur.value)
    next.accounts[0].apiKey = 'tst_key_NOVO00009876'
    const w = await put(app, admin.cookie, KEY, next, cur.version)
    expect(w.statusCode).toBe(200)
    expect(w.json().value.accounts[0].apiKey).toBe(`${BULLETS}9876`)
    const stored = (await storedPlain(app, KEY)) as typeof original
    expect(stored.accounts[0].apiKey).toBe('tst_key_NOVO00009876')
  })

  it('máscara sem valor gravado correspondente → 400 (não vira dado real)', async () => {
    const cur = (await get(app, admin.cookie, KEY)).json()
    const next = structuredClone(cur.value)
    next.accounts.push({ id: 'g3', name: 'Novo', apiKey: `${BULLETS}1234` })
    const w = await put(app, admin.cookie, KEY, next, cur.version)
    expect(w.statusCode).toBe(400)
    expect(w.json().error.code).toBe('dados_invalidos')
    expect(w.json().error.details.path).toBe('accounts.2.apiKey')
    // nada mudou
    expect((await rawRow(app, KEY))?.version).toBe(cur.version)

    // primeira gravação de outra chave com máscara também é recusada
    const first = await put(app, admin.cookie, 'config.tracking', { metaToken: '•••abcd' })
    expect(first.statusCode).toBe(400)
    expect(await rawRow(app, 'config.tracking')).toBeNull()
  })

  it('itens sem id casam pela posição (e o segredo mantido fica preso ao destino do item)', async () => {
    const KEY2 = 'config.tracking'
    const w1 = await put(app, admin.cookie, KEY2, { servers: [{ label: 'A', host: 'a.exemplo.com', password: 'senha-um-1111' }, { label: 'B', host: 'b.exemplo.com', password: 'senha-dois-2222' }] })
    expect(w1.statusCode).toBe(200)
    const masked = w1.json().value
    expect(masked.servers[1].password).toBe(BULLETS)
    // campo que não muda o destino: a senha mascarada continua valendo
    masked.servers[0].label = 'A2'
    masked.servers.push({ label: 'C', host: 'c.exemplo.com', password: 'senha-tres-3333' })
    const w2 = await put(app, admin.cookie, KEY2, masked, 1)
    expect(w2.statusCode).toBe(200)
    expect(await storedPlain(app, KEY2)).toEqual({
      servers: [
        { label: 'A2', host: 'a.exemplo.com', password: 'senha-um-1111' },
        { label: 'B', host: 'b.exemplo.com', password: 'senha-dois-2222' },
        { label: 'C', host: 'c.exemplo.com', password: 'senha-tres-3333' },
      ],
    })
    // servidor trocado com a senha mascarada → 400; digitando a senha de novo → 200
    const next = structuredClone(w2.json().value)
    next.servers[0].host = 'outro.exemplo.com'
    const w3 = await put(app, admin.cookie, KEY2, next, 2)
    expect(w3.statusCode).toBe(400)
    expect(w3.json().error.details).toEqual({ path: 'servers.0', field: 'host', reason: 'destino_mudou' })
    next.servers[0].password = 'senha-nova-0000'
    expect((await put(app, admin.cookie, KEY2, next, 2)).statusCode).toBe(200)
    expect(((await storedPlain(app, KEY2)) as { servers: unknown[] }).servers[0]).toEqual({ label: 'A2', host: 'outro.exemplo.com', password: 'senha-nova-0000' })
  })
})

// ---------- dados pessoais (chave genérica) ----------

describe('kv: dados pessoais (rule.pii)', () => {
  let app: FastifyInstance
  let admin: { user: { id: string }; cookie: string }
  let marketing: string
  let leitor: string
  let editor: string
  const KEY = 'campanhas.indicacao'
  const list = [
    { id: 'a1', name: 'Ana Silva', email: 'ana.silva@exemplo.com', cpf: '12345678909', phone: '11987654321', pixKey: 'ana@pix.com', city: 'São Paulo' },
    { id: 'a2', name: 'Bruno', email: 'bruno@exemplo.com', cpf: '98765432100', phone: '21912345678', pixKey: '+5521912345678', city: 'Rio' },
  ]
  beforeAll(async () => {
    app = await createTestApp()
    admin = await loginAs(app, 'administrador')
    marketing = (await loginAs(app, 'marketing')).cookie
    await customRole(app, 'indicacao-leitura', ['indicacao.ver'])
    leitor = (await loginAs(app, 'indicacao-leitura')).cookie
    await customRole(app, 'indicacao-editor', ['indicacao.ver', 'indicacao.editar'])
    editor = (await loginAs(app, 'indicacao-editor')).cookie
  })
  afterAll(async () => app.close())

  it('cifra em repouso; quem tem a permissão de revelar vê em claro', async () => {
    const w = await put(app, admin.cookie, KEY, list)
    expect(w.statusCode).toBe(200)
    expect(w.json().value).toEqual(list)
    const row = await rawRow(app, KEY)
    expect(row?.value).toBeNull()
    expect(JSON.stringify(row)).not.toContain('12345678909')
    expect(JSON.stringify(row)).not.toContain('ana.silva')
    expect((await get(app, admin.cookie, KEY)).json().value).toEqual(list)
  })

  it('quem não tem a permissão recebe mascarado; quem não vê a tela não lê', async () => {
    expect((await get(app, marketing, KEY)).statusCode).toBe(403)
    const r = await get(app, leitor, KEY)
    expect(r.statusCode).toBe(200)
    const [a1, a2] = r.json().value
    expect(a1).toEqual({
      id: 'a1',
      name: 'Ana Silva',
      email: 'an***@exemplo.com',
      cpf: '123.***.***-09',
      phone: '(11) 9****-4321',
      pixKey: 'an***@pix.com',
      city: 'São Paulo',
    })
    expect(a2.cpf).toBe('987.***.***-00')
    expect(a2.pixKey).toBe('•••5678')
    expect(JSON.stringify(r.json())).not.toContain('12345678909')
  })

  it('gravação com dado pessoal mascarado preserva o gravado', async () => {
    const cur = (await get(app, editor, KEY)).json()
    expect(cur.value[0].cpf).toBe('123.***.***-09')
    const next = structuredClone(cur.value)
    next[0].name = 'Ana S.'
    const w = await put(app, editor, KEY, next, cur.version)
    expect(w.statusCode).toBe(200)
    expect(w.json().value[0]).toMatchObject({ name: 'Ana S.', cpf: '123.***.***-09' })
    expect(await storedPlain(app, KEY)).toEqual([{ ...list[0], name: 'Ana S.' }, list[1]])
    expect((await lastAudit(app)).summary).toBe(`${KEY} — Itens: 1 alterado (a1) (v1→v2)`)
  })

  it('máscara num item novo é recusada', async () => {
    const cur = (await get(app, editor, KEY)).json()
    const next = [...cur.value, { id: 'a3', name: 'Novo', cpf: '111.***.***-11' }]
    const w = await put(app, editor, KEY, next, cur.version)
    expect(w.statusCode).toBe(400)
    expect(w.json().error.details.path).toBe('2.cpf')
  })

  it('leitura com dados pessoais em claro fica na auditoria do servidor (uma vez por sessão e chave no intervalo)', async () => {
    const reveals = async () =>
      (await app.db.query<{ n: number }>(`select count(*)::int as n from audit_log where actor_id = $1 and action = 'revelar' and source = 'servidor'`, [admin.user.id]))[0].n
    const other = await sessionCookie(app, admin.user.id)
    const before = await reveals()
    for (let i = 0; i < 4; i++) expect((await get(app, other, KEY)).statusCode).toBe(200)
    expect(await reveals()).toBe(before + 1)
    const a = (await audits(app)).find((x) => x.action === 'revelar')!
    expect(a).toMatchObject({ entity: 'Dados · Indicação', source: 'servidor' })
    expect(a.summary).toBe(`${KEY} — leitura com dados pessoais completos (2 registros)`)
    // leitura mascarada não gera registro
    const n = (await audits(app)).length
    await get(app, leitor, KEY)
    expect((await audits(app)).length).toBe(n)
  })
})

// ---------- auditoria ----------

describe('kv: auditoria das gravações', () => {
  let app: FastifyInstance
  let admin: { user: { id: string }; cookie: string }
  beforeAll(async () => {
    app = await createTestApp()
    admin = await loginAs(app, 'superadmin', { name: 'Clara Admin' })
  })
  afterAll(async () => app.close())

  it('registra quem, IP, entidade e resumo (listas com id)', async () => {
    const w1 = await put(app, admin.cookie, 'campanhas.jornadas', [{ id: 'c1', v: 1 }, { id: 'c2', v: 1 }])
    expect(w1.statusCode).toBe(200)
    const a1 = await lastAudit(app)
    expect(a1).toMatchObject({
      actor_id: admin.user.id,
      action: 'editar',
      entity: 'Dados · Jornadas',
      summary: 'campanhas.jornadas — Primeira gravação com 2 itens (v0→v1)',
      ip: '127.0.0.1',
      source: 'servidor',
    })
    const w2 = await put(app, admin.cookie, 'campanhas.jornadas', [{ id: 'c1', v: 2 }, { id: 'c3', v: 1 }], 1)
    expect(w2.statusCode).toBe(200)
    expect((await lastAudit(app)).summary).toBe('campanhas.jornadas — Itens: 1 incluído (c3); 1 alterado (c1); 1 removido (c2) (v1→v2)')
    await put(app, admin.cookie, 'campanhas.jornadas', [{ id: 'c3', v: 1 }, { id: 'c1', v: 2 }], 2)
    expect((await lastAudit(app)).summary).toBe('campanhas.jornadas — Itens: ordem alterada (v2→v3)')
    await put(app, admin.cookie, 'campanhas.jornadas', [{ id: 'c3', v: 1 }, { id: 'c1', v: 2 }], 3)
    expect((await lastAudit(app)).summary).toBe('campanhas.jornadas — Salvo sem alterações (v3→v4)')
  })

  it('objetos: campos de 1º nível alterados', async () => {
    await put(app, admin.cookie, 'config.empresa', { name: 'X2Win', cnpj: '00.000.000/0001-00', address: { city: 'SP' } })
    expect((await lastAudit(app)).summary).toBe('config.empresa — Primeira gravação. Campos: name, cnpj, address (v0→v1)')
    await put(app, admin.cookie, 'config.empresa', { name: 'X2Win', cnpj: '11.111.111/0001-11', address: { city: 'RJ' }, phone: '1' }, 1)
    const a = await lastAudit(app)
    // config.empresa tem entidade própria na auditoria (rules-system.ts)
    expect(a.entity).toBe('Empresa e licença')
    expect(a.summary).toBe('config.empresa — Campos alterados: cnpj, address, phone (incluído) (v1→v2)')
  })

  it('gravação recusada não audita', async () => {
    const before = (await audits(app)).length
    await put(app, admin.cookie, 'config.empresa', {}, 0)
    await put(app, admin.cookie, 'esportes.apostas', [])
    expect((await audits(app)).length).toBe(before)
  })
})

// ---------- delegação a domínios ----------

describe('kv: delegação a módulos de domínio', () => {
  let app: FastifyInstance
  let admin: string
  const calls: { value: unknown; version: number | undefined; key: string }[] = []
  const fakeDest: KvHandler = {
    async read() {
      return { value: [{ id: 'd1', url: 'https://x.exemplo.com', secret: 'segredo-em-claro-1234' }], version: 3, updatedAt: null }
    },
    async write(ctx, value, version) {
      calls.push({ value, version, key: ctx.key })
      return { value: [{ id: 'd1', secret: 'outro-segredo-5678' }], version: 4, updatedAt: '2026-01-01T00:00:00.000Z' }
    },
  }
  const readOnly: KvHandler = { read: async () => null }
  beforeAll(async () => {
    app = await createTestApp()
    await app.register(kvRoutes, { prefix: '/api/kv-teste', handlers: { 'webhook-destinations': fakeDest, roles: readOnly } })
    admin = (await loginAs(app)).cookie
  })
  afterAll(async () => app.close())

  it('passa chave, valor e versão ao manipulador e mascara a resposta', async () => {
    const r = await api(app, 'GET', '/api/kv-teste/campanhas.webhooks.destinos', { cookie: admin })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({
      key: 'campanhas.webhooks.destinos',
      value: [{ id: 'd1', url: 'https://x.exemplo.com', secret: `${BULLETS}1234` }],
      version: 3,
      updatedAt: null,
      stored: true,
    })
    const w = await api(app, 'PUT', '/api/kv-teste/campanhas.webhooks.destinos', { cookie: admin, body: { value: [{ id: 'd1' }], version: 3 } })
    expect(w.statusCode).toBe(200)
    expect(w.json()).toEqual({ key: 'campanhas.webhooks.destinos', value: [{ id: 'd1', secret: `${BULLETS}5678` }], version: 4, updatedAt: '2026-01-01T00:00:00.000Z', stored: true })
    expect(calls).toEqual([{ value: [{ id: 'd1' }], version: 3, key: 'campanhas.webhooks.destinos' }])
  })

  it('manipulador ausente → 501 nao_implementado; sem write → 403; leitura null → 404', async () => {
    const r = await api(app, 'GET', '/api/kv-teste/equipe.membros', { cookie: admin })
    expect(r.statusCode).toBe(501)
    expect(r.json().error.code).toBe('nao_implementado')
    const w = await api(app, 'PUT', '/api/kv-teste/cargos.lista', { cookie: admin, body: { value: [] } })
    expect(w.statusCode).toBe(403)
    expect(w.json().error.code).toBe('sem_permissao')
    const n = await api(app, 'GET', '/api/kv-teste/cargos.lista', { cookie: admin })
    expect(n.statusCode).toBe(200)
    expect(n.json().stored).toBe(false)
  })

  it('players e transactions são deste módulo (presentes mesmo sem handlers)', async () => {
    const r = await api(app, 'GET', '/api/kv-teste/geral.jogadores', { cookie: admin })
    expect(r.statusCode).toBe(200)
    expect(r.json().stored).toBe(false)
  })

  it('a rota real delega a chave de domínio ao módulo (equipe.membros)', async () => {
    const r = await get(app, admin, 'equipe.membros')
    expect(r.statusCode).toBe(200)
    expect(Array.isArray(r.json().value)).toBe(true)
  })
})

// ---------- domínio players ----------

describe('kv: jogadores (geral.jogadores)', () => {
  let app: FastifyInstance
  let admin: string
  let suporte: string
  let antifraude: string
  let marketing: string
  const KEY = 'geral.jogadores'
  const players = [
    {
      id: 'p1',
      name: 'Joana Lima',
      email: 'joana.lima@exemplo.com',
      phone: '11987654321',
      cpf: '12345678909',
      birthDate: '1990-05-01',
      ip: '200.150.10.20',
      status: 'ativo',
      balanceReal: 100,
      balanceBonus: 0,
      coins: 10,
      tags: ['novo'],
      level: 3,
    },
    {
      id: 'p2',
      name: 'Pedro Alves',
      email: 'pedro@exemplo.com',
      phone: '21912345678',
      cpf: '98765432100',
      birthDate: '1985-12-24',
      ip: '189.1.2.3',
      status: 'ativo',
      balanceReal: 50.5,
      balanceBonus: 10,
      coins: 0,
      tags: [],
      level: 1,
    },
  ]
  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app)).cookie
    suporte = (await loginAs(app, 'suporte')).cookie
    marketing = (await loginAs(app, 'marketing')).cookie
    await customRole(app, 'antifraude-only', ['antifraude.ver', 'antifraude.banir'])
    antifraude = (await loginAs(app, 'antifraude-only')).cookie
  })
  afterAll(async () => app.close())

  const current = async (cookie: string) => (await get(app, cookie, KEY)).json() as { value: typeof players; version: number }

  it('sem permissão de gravação → 403; a tela nunca cria a base (nada gravado = lista vazia)', async () => {
    const m = await put(app, marketing, KEY, players)
    expect(m.statusCode).toBe(403)
    expect(m.json().error.code).toBe('sem_permissao')
    // Superadmin, Suporte: a lista enviada pela tela não vira base (cada jogador seria uma inclusão)
    for (const cookie of [admin, suporte]) {
      const w = await put(app, cookie, KEY, players)
      expect(w.statusCode).toBe(403)
      expect(w.json().error).toMatchObject({ code: 'campo_nao_permitido', details: { added: ['p1', 'p2'] } })
    }
    const masked = await put(app, admin, KEY, [{ ...players[0], cpf: '123.***.***-09' }])
    expect(masked.statusCode).toBe(403)
    expect(await rawRow(app, KEY)).toBeNull()
  })

  it('importação: só Superadmin com 2FA; valida, recusa máscara e ids repetidos; cifrada e auditada', async () => {
    const url = `/api/kv/${KEY}/import`
    // Suporte e Superadmin sem 2FA não importam
    for (const cookie of [suporte, admin]) {
      const r = await api(app, 'POST', url, { cookie, body: { players } })
      expect(r.statusCode).toBe(403)
      expect(r.json().error.code).toBe('sem_permissao')
    }
    const imp = (await importer(app)).cookie
    expect((await api(app, 'POST', url, { cookie: imp, body: { players: [{ ...players[0], cpf: '123.***.***-09' }] } })).statusCode).toBe(400)
    expect((await api(app, 'POST', url, { cookie: imp, body: { players: [{ ...players[0], status: 'sumido' }] } })).statusCode).toBe(400)
    expect((await api(app, 'POST', url, { cookie: imp, body: { players: [{ ...players[0], balanceReal: -1 }] } })).statusCode).toBe(400)
    expect(await rawRow(app, KEY)).toBeNull()
    const w = await api(app, 'POST', url, { cookie: imp, body: { players } })
    expect(w.statusCode, w.body).toBe(200)
    expect(w.json()).toMatchObject({ ok: true, imported: 2, version: 1 })
    const row = await rawRow(app, KEY)
    expect(row?.value).toBeNull()
    expect(row?.value_enc).toBeTruthy()
    expect(JSON.stringify(row)).not.toContain('12345678909')
    expect(await storedPlain(app, KEY)).toEqual(players)
    const a = await lastAudit(app)
    expect(a).toMatchObject({ action: 'criar', entity: 'Dados · Usuários' })
    expect(a.summary).toBe(`${KEY} — Importação de 2 jogadores da plataforma (saldo real R$ 150,50, bônus R$ 10,00): p1, p2 (v0→v1)`)
    // id já gravado → 400
    expect((await api(app, 'POST', url, { cookie: imp, body: { players: [players[0]] } })).statusCode).toBe(400)
  })

  it('leitura mascara dados pessoais para quem não tem usuarios.ver-dados; quem não vê as telas de jogadores não lê', async () => {
    expect((await get(app, marketing, KEY)).statusCode).toBe(403)
    const m = await current(suporte)
    expect(m.value[0]).toMatchObject({
      name: 'Joana Lima',
      email: 'jo***@exemplo.com',
      phone: '(11) 9****-4321',
      cpf: '123.***.***-09',
      ip: '200.150.***.***',
      balanceReal: 100,
    })
    expect(m.value[0].birthDate).toBe('•••5-01')
    const a = await current(admin)
    expect(a.value).toEqual(players)
  })

  it('usuarios.editar muda status, moedas e etiquetas; saldo enviado é ignorado; dados pessoais mascarados são preservados', async () => {
    const cur = await current(suporte)
    const next = structuredClone(cur.value)
    Object.assign(next[0], { status: 'bloqueado', balanceReal: 120.5, balanceBonus: 5, coins: 15, tags: ['novo', 'vip'] })
    const w = await put(app, suporte, KEY, next, cur.version)
    expect(w.statusCode).toBe(200)
    expect(w.json().value[0].cpf).toBe('123.***.***-09')
    // o saldo é do servidor (muda só pelo extrato): a resposta e o gravado mantêm o saldo anterior
    expect(w.json().value[0]).toMatchObject({ balanceReal: 100, balanceBonus: 0 })
    const stored = (await storedPlain(app, KEY)) as typeof players
    expect(stored[0]).toEqual({ ...players[0], status: 'bloqueado', coins: 15, tags: ['novo', 'vip'] })
    expect(stored[1]).toEqual(players[1])
    const a = await lastAudit(app)
    expect(a.action).toBe('editar')
    expect(a.entity).toBe('Dados · Usuários')
    expect(a.summary).toContain('Jogadores alterados (1): p1 (')
    expect(a.summary).toContain('status: ativo → bloqueado')
    expect(a.summary).not.toContain('saldo real: R$ 100,00')
    expect(a.summary).toContain('saldo enviado ignorado (o saldo só muda por lançamento no extrato): p1')
    expect(a.summary).toContain('etiquetas: +vip')
    expect(a.summary).not.toContain('12345678909')
  })

  it('campo fora da política → 403 campo_nao_permitido com details.fields', async () => {
    const cur = await current(suporte)
    const next = structuredClone(cur.value)
    next[0].name = 'Outro Nome'
    next[1].level = 99
    const w = await put(app, suporte, KEY, next, cur.version)
    expect(w.statusCode).toBe(403)
    expect(w.json().error.code).toBe('campo_nao_permitido')
    expect(w.json().error.details.fields).toEqual(['level', 'name'])

    // trocar um dado pessoal (em claro) também é campo não permitido
    const pii = structuredClone(cur.value)
    pii[1].email = 'novo@exemplo.com'
    const p = await put(app, suporte, KEY, pii, cur.version)
    expect(p.statusCode).toBe(403)
    expect(p.json().error.details.fields).toEqual(['email'])

    // remover um campo também é alteração
    const gone = structuredClone(cur.value) as Partial<(typeof players)[number]>[]
    delete gone[0].level
    expect((await put(app, suporte, KEY, gone, cur.version)).json().error.details.fields).toEqual(['level'])
    expect((await rawRow(app, KEY))?.version).toBe(cur.version)
  })

  it('antifraude.banir só muda status', async () => {
    const cur = await current(antifraude)
    const ban = structuredClone(cur.value)
    ban[1].status = 'bloqueado'
    const w = await put(app, antifraude, KEY, ban, cur.version)
    expect(w.statusCode).toBe(200)
    expect(((await storedPlain(app, KEY)) as typeof players)[1].status).toBe('bloqueado')

    const cur2 = await current(antifraude)
    const tags = structuredClone(cur2.value)
    tags[1].tags = ['fraude']
    tags[1].balanceReal = 0
    const t = await put(app, antifraude, KEY, tags, cur2.version)
    expect(t.statusCode).toBe(403)
    expect(t.json().error.code).toBe('campo_nao_permitido')
    // saldo é do servidor: não conta como campo alterado (é ignorado)
    expect(t.json().error.details.fields).toEqual(['tags'])
  })

  it('incluir ou remover jogador → 403', async () => {
    const cur = await current(admin)
    const add = await put(app, admin, KEY, [...cur.value, { ...players[0], id: 'p3' }], cur.version)
    expect(add.statusCode).toBe(403)
    expect(add.json().error).toMatchObject({ code: 'campo_nao_permitido', details: { added: ['p3'] } })
    const rem = await put(app, admin, KEY, [cur.value[0]], cur.version)
    expect(rem.statusCode).toBe(403)
    expect(rem.json().error).toMatchObject({ code: 'campo_nao_permitido', details: { removed: ['p2'] } })
  })

  it('valida os valores dos campos permitidos', async () => {
    const cur = await current(admin)
    const cases: [string, unknown][] = [
      ['status', 'sumido'],
      ['coins', 1.5],
      ['coins', -1],
      ['tags', ['ok', '']],
      ['tags', 'vip'],
    ]
    for (const [field, value] of cases) {
      const next = structuredClone(cur.value) as Record<string, unknown>[]
      next[0][field] = value
      const r = await put(app, admin, KEY, next, cur.version)
      expect(r.statusCode, `${field}=${JSON.stringify(value)}`).toBe(400)
      expect(r.json().error).toMatchObject({ code: 'dados_invalidos', details: { id: 'p1', field } })
    }
  })

  it('lista inválida, id repetido e versão desatualizada', async () => {
    const cur = await current(admin)
    expect((await put(app, admin, KEY, { p1: {} }, cur.version)).statusCode).toBe(400)
    expect((await put(app, admin, KEY, [{ name: 'sem id' }], cur.version)).statusCode).toBe(400)
    const dup = await put(app, admin, KEY, [cur.value[0], cur.value[0]], cur.version)
    expect(dup.statusCode).toBe(400)
    expect(dup.json().error.details.id).toBe('p1')
    const stale = await put(app, admin, KEY, cur.value, cur.version - 1)
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.details.version).toBe(cur.version)
  })
  it('correção de base (remover jogador): só Superadmin com 2FA, com motivo; auditada', async () => {
    const url = `/api/kv/${KEY}/remove`
    expect((await api(app, 'POST', url, { cookie: admin, body: { ids: ['p2'], reason: 'Dado de demonstração' } })).statusCode).toBe(403)
    expect((await api(app, 'POST', url, { cookie: suporte, body: { ids: ['p2'], reason: 'Dado de demonstração' } })).statusCode).toBe(403)
    const imp = (await importer(app)).cookie
    expect((await api(app, 'POST', url, { cookie: imp, body: { ids: ['p2'] } })).statusCode).toBe(400)
    expect((await api(app, 'POST', url, { cookie: imp, body: { ids: ['nao-existe'], reason: 'Dado de demonstração' } })).statusCode).toBe(400)
    const r = await api(app, 'POST', url, { cookie: imp, body: { ids: ['p2'], reason: 'Dado de demonstração' } })
    expect(r.statusCode, r.body).toBe(200)
    expect(r.json()).toMatchObject({ ok: true, removed: 1 })
    expect(((await storedPlain(app, KEY)) as { id: string }[]).map((p) => p.id)).toEqual(['p1'])
    const a = await lastAudit(app)
    expect(a).toMatchObject({ action: 'excluir', entity: 'Dados · Usuários' })
    expect(a.summary).toMatch(/^geral\.jogadores — 1 jogador removido da base \(Dado de demonstração\): p2 \(v\d+→v\d+\)$/)
  })
})

// ---------- domínio transactions ----------

describe('kv: transações (geral.transacoes)', () => {
  let app: FastifyInstance
  let admin: string
  let suporte: string
  let financeiro: string
  let marketing: string
  let estornos: string
  let imp: string
  const KEY = 'geral.transacoes'
  const base = [
    { id: 'TX1', at: daysAgo(1), playerId: 'p1', playerName: 'Joana', playerEmail: 'j@x.com', type: 'deposito', amount: 100, wallet: 'real', balanceBefore: 0, balanceAfter: 100, gameId: null, gameName: null, providerName: null, reference: 'DEP-1' },
    { id: 'TX2', at: daysAgo(1), playerId: 'p1', playerName: 'Joana', playerEmail: 'j@x.com', type: 'aposta', amount: -20, wallet: 'real', balanceBefore: 100, balanceAfter: 80, gameId: 'g1', gameName: 'Slot', providerName: 'Prov', reference: 'BET-1' },
    { id: 'TX3', at: daysAgo(30), playerId: 'p1', playerName: 'Joana', playerEmail: 'j@x.com', type: 'aposta', amount: -5, wallet: 'real', balanceBefore: 80, balanceAfter: 75, gameId: 'g1', gameName: 'Slot', providerName: 'Prov', reference: 'BET-2' },
  ]
  const manual = (id: string, type: 'credito_manual' | 'debito_manual', amount: number, extra: Record<string, unknown> = {}) => ({
    id,
    at: new Date().toISOString(),
    playerId: 'p1',
    playerName: 'Joana',
    playerEmail: 'j@x.com',
    type,
    amount,
    wallet: 'real',
    balanceBefore: 75,
    balanceAfter: 75 + amount,
    gameId: null,
    gameName: null,
    providerName: null,
    reference: `MAN-${id}`,
    note: 'Ajuste de teste',
    by: 'Pessoa Teste',
    ...extra,
  })
  const reversal = (id: string, of: string, amount: number, extra: Record<string, unknown> = {}) => ({
    ...manual(id, 'credito_manual', amount),
    type: 'estorno',
    reference: `EST-${of}`,
    ...extra,
  })
  const playerBase = [
    { id: 'p1', name: 'Joana', email: 'joana@exemplo.com', status: 'ativo', balanceReal: 75, balanceBonus: 0, coins: 0, tags: [], totalBet: 25, betsCount: 2 },
    { id: 'p9', name: 'Outro', email: 'outro@exemplo.com', status: 'ativo', balanceReal: 0, balanceBonus: 0, coins: 0, tags: [] },
  ]
  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app)).cookie
    imp = (await importer(app)).cookie
    expect((await api(app, 'POST', '/api/kv/geral.jogadores/import', { cookie: imp, body: { players: playerBase } })).statusCode).toBe(200)
    suporte = (await loginAs(app, 'suporte')).cookie
    financeiro = (await loginAs(app, 'financeiro')).cookie
    marketing = (await loginAs(app, 'marketing')).cookie
    await customRole(app, 'estornos', ['transacoes.ver', 'transacoes.editar'])
    estornos = (await loginAs(app, 'estornos')).cookie
  })
  afterAll(async () => app.close())

  const current = async (cookie = admin) => (await get(app, cookie, KEY)).json() as { value: Record<string, unknown>[]; version: number }

  it('leitura conforme a regra; nada gravado = extrato vazio (a tela não cria base); histórico só pela importação', async () => {
    expect((await get(app, marketing, KEY)).statusCode).toBe(403)
    expect((await get(app, suporte, KEY)).json().stored).toBe(false)
    // pela tela, todo item é lançamento novo: tipo fora da lista → 403, nada gravado
    expect((await put(app, admin, KEY, [{ id: 'X', type: 'inventado', amount: 1, playerId: 'p' }])).statusCode).toBe(403)
    const viaTela = await put(app, admin, KEY, base)
    expect(viaTela.statusCode).toBe(403)
    expect(viaTela.json().error).toMatchObject({ code: 'campo_nao_permitido', details: { fields: ['type'] } })
    expect(await rawRow(app, KEY)).toBeNull()
    // importação do histórico: Superadmin com 2FA; item inválido → 400; não mexe em saldo
    const url = `/api/kv/${KEY}/import`
    expect((await api(app, 'POST', url, { cookie: admin, body: { transactions: base } })).statusCode).toBe(403)
    expect((await api(app, 'POST', url, { cookie: imp, body: { transactions: [{ id: 'X', type: 'inventado', amount: 1, playerId: 'p', at: daysAgo(1) }] } })).statusCode).toBe(400)
    const w = await api(app, 'POST', url, { cookie: imp, body: { transactions: base } })
    expect(w.statusCode, w.body).toBe(200)
    expect(w.json()).toMatchObject({ imported: 3, version: 1 })
    // tem e-mail de jogador: cifrado em repouso
    const row = await rawRow(app, KEY)
    expect(row?.value).toBeNull()
    expect(JSON.stringify(row)).not.toContain('j@x.com')
    expect(await storedPlain(app, KEY)).toEqual(base)
    const a = await lastAudit(app)
    expect(a.action).toBe('criar')
    expect(a.summary).toBe(`${KEY} — Importação de 3 transações da plataforma (saldos não mudam) — deposito: 1 (R$ 100,00), aposta: 2 (-R$ 25,00) (v0→v1)`)
    expect(((await storedPlain(app, 'geral.jogadores')) as { balanceReal: number }[])[0].balanceReal).toBe(75)
    expect((await get(app, financeiro, KEY)).statusCode).toBe(200)
  })

  it('sem permissão de gravação → 403', async () => {
    const cur = await current()
    const r = await put(app, financeiro, KEY, [manual('TX9', 'credito_manual', 10), ...cur.value], cur.version)
    expect(r.statusCode).toBe(403)
    expect(r.json().error.code).toBe('sem_permissao')
  })

  it('usuarios.editar lança creditação e subtração (auditoria creditar)', async () => {
    const cur = await current(suporte)
    const w = await put(app, suporte, KEY, [manual('TX10', 'credito_manual', 50), ...cur.value], cur.version)
    expect(w.statusCode).toBe(200)
    expect(w.json().value).toHaveLength(4)
    const a = await lastAudit(app)
    expect(a.action).toBe('creditar')
    expect(a.entity).toBe('Dados · Transações')
    expect(a.summary).toContain('Creditação de R$ 50,00 na carteira real do jogador p1 · TX10 (saldo real: R$ 75,00 → R$ 125,00)')
    // saldo do jogador aplicado pelo servidor
    expect(((await storedPlain(app, 'geral.jogadores')) as { balanceReal: number }[])[0].balanceReal).toBe(125)
    const cur2 = await current(suporte)
    const w2 = await put(app, suporte, KEY, [...cur2.value, manual('TX11', 'debito_manual', -10)], cur2.version)
    expect(w2.statusCode).toBe(200)
    expect((await lastAudit(app)).summary).toContain('Subtração de R$ 10,00')
  })

  it('item gravado precisa voltar igual (alterar ou remover → 403)', async () => {
    const cur = await current()
    const changed = structuredClone(cur.value)
    changed.find((t) => t.id === 'TX1')!.amount = 1000
    const c = await put(app, admin, KEY, changed, cur.version)
    expect(c.statusCode).toBe(403)
    expect(c.json().error).toMatchObject({ code: 'campo_nao_permitido', details: { changed: ['TX1'] } })
    const removed = cur.value.filter((t) => t.id !== 'TX2')
    const r = await put(app, admin, KEY, removed, cur.version)
    expect(r.statusCode).toBe(403)
    expect(r.json().error).toMatchObject({ code: 'campo_nao_permitido', details: { removed: ['TX2'] } })
    // reordenar é aceito (nada mudou nos itens), mas a ordem gravada não muda
    const reordered = [...cur.value].reverse()
    const ro = await put(app, admin, KEY, reordered, cur.version)
    expect(ro.statusCode).toBe(200)
    expect((ro.json().value as { id: string }[]).map((t) => t.id)).toEqual(cur.value.map((t) => t.id))
    expect((await lastAudit(app)).summary).toMatch(/^geral\.transacoes — Extrato salvo sem lançamentos novos \(v\d+→v\d+\)$/)
  })

  it('tipos novos fora da lista → 403 campo_nao_permitido; estorno sem transacoes.editar → 403', async () => {
    const cur = await current()
    const dep = { ...manual('TX20', 'credito_manual', 10), type: 'deposito' }
    const d = await put(app, admin, KEY, [dep, ...cur.value], cur.version)
    expect(d.statusCode).toBe(403)
    expect(d.json().error).toMatchObject({ code: 'campo_nao_permitido', details: { fields: ['type'], ids: ['TX20'] } })
    const s = await put(app, suporte, KEY, [reversal('TX21', 'TX2', 20), ...cur.value], cur.version)
    expect(s.statusCode).toBe(403)
    expect(s.json().error.code).toBe('sem_permissao')
    // quem só tem transacoes.editar não lança creditação
    const e = await put(app, estornos, KEY, [manual('TX22', 'credito_manual', 10), ...cur.value], cur.version)
    expect(e.statusCode).toBe(403)
    expect(e.json().error.code).toBe('sem_permissao')
  })

  it('valida lançamentos manuais', async () => {
    const cur = await current()
    const bad = [
      manual('TX30', 'credito_manual', -10),
      manual('TX31', 'debito_manual', 10),
      manual('TX32', 'credito_manual', 5000.01),
      manual('TX33', 'credito_manual', 10.123),
      manual('TX34', 'credito_manual', 10, { wallet: 'cripto' }),
      manual('TX35', 'credito_manual', 10, { playerId: 'nao-existe' }),
      manual('TX36', 'credito_manual', 10, { reference: '' }),
      manual('TX37', 'credito_manual', 10, { note: 'x'.repeat(501) }),
      // débito maior que o saldo
      manual('TX39', 'debito_manual', -5000, { playerId: 'p9' }),
      // TX10 (R$ 50) já lançado hoje para p1: R$ 4.950,01 passa do limite de 24 h
      manual('TX40', 'credito_manual', 4950.01),
    ]
    for (const tx of bad) {
      const r = await put(app, admin, KEY, [tx, ...cur.value], cur.version)
      expect(r.statusCode, tx.id).toBe(400)
      expect(r.json().error.code, tx.id).toBe('dados_invalidos')
    }
    expect((await put(app, admin, KEY, [manual('TX38', 'credito_manual', 4950), ...cur.value], cur.version)).statusCode).toBe(200)
  })

  it('estorno: só de aposta/subtração existente, valor igual, uma vez, no prazo', async () => {
    let cur = await current(estornos)
    const cases: [string, ReturnType<typeof reversal>][] = [
      ['original inexistente', reversal('TX40', 'NAOEXISTE', 20)],
      ['referência sem EST-', reversal('TX41', 'TX2', 20, { reference: 'TX2' })],
      ['depósito não estorna', reversal('TX42', 'TX1', 100)],
      ['valor diferente', reversal('TX43', 'TX2', 19)],
      ['outro jogador', reversal('TX44', 'TX2', 20, { playerId: 'p9' })],
      ['fora do prazo', reversal('TX45', 'TX3', 5)],
      ['creditação não estorna', reversal('TX46', 'TX10', 50)],
    ]
    for (const [label, tx] of cases) {
      const r = await put(app, estornos, KEY, [tx, ...cur.value], cur.version)
      expect(r.statusCode, label).toBe(400)
      expect(r.json().error.code, label).toBe('dados_invalidos')
    }
    const before = ((await storedPlain(app, 'geral.jogadores')) as { id: string; balanceReal: number }[]).find((p) => p.id === 'p1')!
    const ok = await put(app, estornos, KEY, [reversal('TX47', 'TX2', 20), ...cur.value], cur.version)
    expect(ok.statusCode).toBe(200)
    const a = await lastAudit(app)
    expect(a.action).toBe('estornar')
    expect(a.summary).toContain('Estorno de R$ 20,00 (carteira real) da transação TX2 do jogador p1 · TX47')
    // aposta estornada: o saldo volta e ela sai do apostado e do nº de apostas da ficha
    const after = ((await storedPlain(app, 'geral.jogadores')) as { id: string; balanceReal: number; totalBet: number; betsCount: number }[]).find((p) => p.id === 'p1')!
    expect(after).toMatchObject({ balanceReal: before.balanceReal + 20, totalBet: 5, betsCount: 1 })

    cur = await current(estornos)
    const twice = await put(app, estornos, KEY, [reversal('TX48', 'TX2', 20), ...cur.value], cur.version)
    expect(twice.statusCode).toBe(400)
    expect(twice.json().error.message).toContain('já foi estornada')
    // dois estornos da mesma transação na mesma gravação
    const pair = await put(app, estornos, KEY, [reversal('TX49', 'TX11', 10), reversal('TX50', 'TX11', 10), ...cur.value], cur.version)
    expect(pair.statusCode).toBe(400)
    // subtração manual pode ser estornada (não mexe no apostado)
    expect((await put(app, estornos, KEY, [reversal('TX51', 'TX11', 10), ...cur.value], cur.version)).statusCode).toBe(200)
    expect(((await storedPlain(app, 'geral.jogadores')) as { id: string; totalBet: number; betsCount: number }[]).find((p) => p.id === 'p1')).toMatchObject({ totalBet: 5, betsCount: 1 })
  })

  it('id repetido, versão desatualizada e limite de lançamentos por vez', async () => {
    const cur = await current()
    expect((await put(app, admin, KEY, [...cur.value, cur.value[0]], cur.version)).statusCode).toBe(400)
    const stale = await put(app, admin, KEY, cur.value, cur.version - 1)
    expect(stale.statusCode).toBe(409)
    const many = Array.from({ length: 51 }, (_, i) => manual(`M${i}`, 'credito_manual', 1))
    expect((await put(app, admin, KEY, [...many, ...cur.value], cur.version)).statusCode).toBe(400)
  })
})

// ---------- funções puras ----------

describe('kv: máscara, restauração e resumo (unidades)', () => {
  const gw = findKvRule('config.gateways')!
  const players = findKvRule('geral.jogadores')!

  it('políticas de leitura e gravação', () => {
    expect(readPolicy(gw, new Set())).toEqual({ secrets: true, pii: false })
    expect(readPolicy(players, new Set())).toEqual({ secrets: false, pii: true })
    expect(readPolicy(players, new Set(['usuarios.ver-dados']))).toEqual({ secrets: false, pii: false })
    expect(writePolicy(players)).toEqual({ secrets: false, pii: true })
  })

  it('máscara é idempotente e cobre número e booleano em campos de segredo', () => {
    const v = { apiKey: 'abcdefgh-ijkl-1234', password: 1234, secretFlags: { on: true }, nested: { token: `${BULLETS}9999` } }
    const once = redact(v, { secrets: true, pii: false })
    expect(once).toEqual({ apiKey: `${BULLETS}1234`, password: BULLETS, secretFlags: { on: BULLETS }, nested: { token: `${BULLETS}9999` } })
    expect(redact(once, { secrets: true, pii: false })).toEqual(once)
    // dado pessoal numérico também sai mascarado
    expect(redact({ cpf: 12345678909 }, { secrets: false, pii: true })).toEqual({ cpf: '123.***.***-09' })
    // sem política, devolve o mesmo valor
    expect(redact(v, { secrets: false, pii: false })).toBe(v)
  })

  it('restauração não mexe no protótipo e só restaura campos sensíveis', () => {
    const incoming = JSON.parse(`{"__proto__": {"x": 1}, "note": "a *** b", "apiKey": "${BULLETS}1234"}`)
    const out = restoreMasked(incoming, { apiKey: 'real-secret-value-1234' }, { secrets: true, pii: false }) as Record<string, unknown>
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).x).toBeUndefined()
    expect(out.note).toBe('a *** b')
    expect(out.apiKey).toBe('real-secret-value-1234')
    // texto com máscara que não é a máscara atual do gravado → 400
    expect(() => restoreMasked({ apiKey: '••••1234' }, { apiKey: 'real-secret-value-1234' }, { secrets: true, pii: false })).toThrow(/máscara/)
  })

  it('resumos', () => {
    expect(summarizeChange(MISSING, { a: 1 })).toBe('Primeira gravação. Campos: a')
    expect(summarizeChange(MISSING, [1])).toBe('Primeira gravação com 1 item')
    expect(summarizeChange(MISSING, 3)).toBe('Primeira gravação')
    expect(summarizeChange([1, 2], [1, 2, 3])).toBe('Itens: lista alterada (2 itens → 3 itens)')
    expect(summarizeChange({ a: 1 }, [1])).toBe('Valor substituído')
    expect(summarizeChange('x', 'x')).toBe('Salvo sem alterações')
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}` }))
    expect(summarizeChange([], many)).toBe('Itens: 8 incluídos (n0, n1, n2, n3, n4, … +3)')
  })
})
