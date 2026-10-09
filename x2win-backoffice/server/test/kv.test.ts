import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { findKvRule } from '@shared/kv-registry'
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

const BULLETS = '••••••••••'
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
    const w1 = await put(app, admin.cookie, 'campanhas.cupons', v1, 7)
    expect(w1.statusCode).toBe(200)
    expect(w1.json()).toMatchObject({ key: 'campanhas.cupons', value: v1, version: 1 })
    expect(typeof w1.json().updatedAt).toBe('string')
    expect(w1.headers['cache-control']).toBe('no-store')

    const r1 = await get(app, admin.cookie, 'campanhas.cupons')
    expect(r1.statusCode).toBe(200)
    expect(r1.json()).toEqual({ key: 'campanhas.cupons', value: v1, version: 1, updatedAt: w1.json().updatedAt, stored: true })
    expect(r1.headers['cache-control']).toBe('no-store')

    const row = await rawRow(app, 'campanhas.cupons')
    expect(row).toMatchObject({ value: v1, value_enc: null, version: 1, updated_by: admin.user.id })

    // sem versão ou versão velha → 409 com a versão atual
    const noVersion = await put(app, admin.cookie, 'campanhas.cupons', [])
    expect(noVersion.statusCode).toBe(409)
    expect(noVersion.json().error).toMatchObject({ code: 'versao_desatualizada', details: { version: 1 } })
    const stale = await put(app, admin.cookie, 'campanhas.cupons', [], 0)
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.details.version).toBe(1)
    const ahead = await put(app, admin.cookie, 'campanhas.cupons', [], 2)
    expect(ahead.statusCode).toBe(409)

    const v2 = [...v1, { id: 'c2', code: 'DOBRO', active: false }]
    const w2 = await put(app, admin.cookie, 'campanhas.cupons', v2, 1)
    expect(w2.statusCode).toBe(200)
    expect(w2.json().version).toBe(2)
    expect((await get(app, admin.cookie, 'campanhas.cupons')).json().value).toEqual(v2)
    const again = await put(app, admin.cookie, 'campanhas.cupons', v1, 1)
    expect(again.statusCode).toBe(409)
    expect(again.json().error.details.version).toBe(2)
  })

  it('chave filha é guardada separada e segue a regra da mãe', async () => {
    const w = await put(app, admin.cookie, 'campanhas.cupons.resgates', [{ id: 'r1' }])
    expect(w.statusCode).toBe(200)
    expect(w.json().version).toBe(1)
    expect(await rawRow(app, 'campanhas.cupons.resgates')).toMatchObject({ version: 1 })
    expect((await lastAudit(app)).entity).toBe('Dados · Cupons')
  })

  it('aceita qualquer JSON (objeto, lista, texto, número, null)', async () => {
    for (const [i, value] of [{ a: { b: [1, 2] } }, 'texto', 42, true, null, []].entries()) {
      const key = `campanhas.missoes.teste${i}`
      const w = await put(app, admin.cookie, key, value)
      expect(w.statusCode, key).toBe(200)
      const r = await get(app, admin.cookie, key)
      expect(r.json().value, key).toEqual(value)
    }
  })

  it('valida o corpo', async () => {
    const key = 'campanhas.torneios'
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

  it('aceita alguns MB de dados', async () => {
    const big = Array.from({ length: 3000 }, (_, i) => ({ id: `b${i}`, image: `data:image/png;base64,${'A'.repeat(1000)}` }))
    const w = await put(app, admin.cookie, 'personalizacao.banners', big)
    expect(w.statusCode).toBe(200)
    const r = await get(app, admin.cookie, 'personalizacao.banners')
    expect(r.statusCode).toBe(200)
    expect(r.json().value).toHaveLength(3000)
    expect(r.json().value[2999]).toEqual(big[2999])
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
    const w = await put(app, marketing, 'campanhas.cupons', [{ id: 'c1' }])
    expect(w.statusCode).toBe(200)
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
    // Suporte vê Depósitos (readPages de config.gateways), então lê (mascarado)
    expect((await get(app, suporte, 'config.gateways')).statusCode).toBe(200)
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
    for (const key of ['esportes.apostas', 'operacao.saques', 'auditoria.registros', 'campanhas.webhooks.execucoes']) {
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
      { id: 'g1', name: 'PixPay', apiKey: 'sk_live_ABCDEFGH1234', clientSecret: 'cs_secreto_9999', url: 'https://pixpay.exemplo.com' },
      { id: 'g2', name: 'Outro', apiKey: 'sk_live_ZZZZYYYY4321', clientSecret: 'cs_outro_8888', url: 'https://outro.exemplo.com' },
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
    expect(v.accounts[0]).toEqual({ id: 'g1', name: 'PixPay', apiKey: `${BULLETS}1234`, clientSecret: `${BULLETS}9999`, url: 'https://pixpay.exemplo.com' })
    // dentro de um campo de segredo, tudo é segredo
    expect(v.credentials).toEqual({ user: `${BULLETS}acao`, region: `${BULLETS}st-1` })
    // nome de campo comum fica em claro; lista em campo de segredo é mascarada
    expect(v.pins).toEqual(['1111', '2222'])
    expect(v.tokens).toEqual([`${BULLETS}1111`, `${BULLETS}2222`])

    const row = await rawRow(app, KEY)
    expect(row?.value).toBeNull()
    expect(row?.value_enc).toMatch(/^v1\./)
    const dump = JSON.stringify(row)
    for (const s of ['sk_live_ABCDEFGH1234', 'cs_secreto_9999', 'tok_callback_5678', 'PixPay', 'usuario-integracao']) expect(dump).not.toContain(s)
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
    next.accounts[0].apiKey = 'sk_live_NOVO00009876'
    const w = await put(app, admin.cookie, KEY, next, cur.version)
    expect(w.statusCode).toBe(200)
    expect(w.json().value.accounts[0].apiKey).toBe(`${BULLETS}9876`)
    const stored = (await storedPlain(app, KEY)) as typeof original
    expect(stored.accounts[0].apiKey).toBe('sk_live_NOVO00009876')
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

  it('itens sem id casam pela posição', async () => {
    const w1 = await put(app, admin.cookie, 'config.integracoes', { smtp: [{ host: 'a', password: 'senha-um-1111' }, { host: 'b', password: 'senha-dois-2222' }] })
    expect(w1.statusCode).toBe(200)
    const masked = w1.json().value
    expect(masked.smtp[1].password).toBe(`${BULLETS}2222`)
    masked.smtp[0].host = 'a2'
    masked.smtp.push({ host: 'c', password: 'senha-tres-3333' })
    const w2 = await put(app, admin.cookie, 'config.integracoes', masked, 1)
    expect(w2.statusCode).toBe(200)
    expect(await storedPlain(app, 'config.integracoes')).toEqual({
      smtp: [
        { host: 'a2', password: 'senha-um-1111' },
        { host: 'b', password: 'senha-dois-2222' },
        { host: 'c', password: 'senha-tres-3333' },
      ],
    })
  })
})

// ---------- dados pessoais (chave genérica) ----------

describe('kv: dados pessoais (rule.pii)', () => {
  let app: FastifyInstance
  let admin: string
  let marketing: string
  let gerente: string
  const KEY = 'crescimento.afiliados'
  const list = [
    { id: 'a1', name: 'Ana Silva', email: 'ana.silva@exemplo.com', cpf: '12345678909', phone: '11987654321', pixKey: 'ana@pix.com', city: 'São Paulo' },
    { id: 'a2', name: 'Bruno', email: 'bruno@exemplo.com', cpf: '98765432100', phone: '21912345678', pixKey: '+5521912345678', city: 'Rio' },
  ]
  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app, 'administrador')).cookie
    marketing = (await loginAs(app, 'marketing')).cookie
    await customRole(app, 'gerente-afiliados', ['afiliados-gerentes.ver', 'afiliados-gerentes.editar'])
    gerente = (await loginAs(app, 'gerente-afiliados')).cookie
  })
  afterAll(async () => app.close())

  it('cifra em repouso; quem tem a permissão de revelar vê em claro', async () => {
    const w = await put(app, admin, KEY, list)
    expect(w.statusCode).toBe(200)
    expect(w.json().value).toEqual(list)
    const row = await rawRow(app, KEY)
    expect(row?.value).toBeNull()
    expect(JSON.stringify(row)).not.toContain('12345678909')
    expect(JSON.stringify(row)).not.toContain('ana.silva')
    expect((await get(app, admin, KEY)).json().value).toEqual(list)
  })

  it('quem não tem a permissão recebe mascarado', async () => {
    const r = await get(app, marketing, KEY)
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
    const cur = (await get(app, gerente, KEY)).json()
    expect(cur.value[0].cpf).toBe('123.***.***-09')
    const next = structuredClone(cur.value)
    next[0].name = 'Ana S.'
    const w = await put(app, gerente, KEY, next, cur.version)
    expect(w.statusCode).toBe(200)
    expect(w.json().value[0]).toMatchObject({ name: 'Ana S.', cpf: '123.***.***-09' })
    expect(await storedPlain(app, KEY)).toEqual([{ ...list[0], name: 'Ana S.' }, list[1]])
    expect((await lastAudit(app)).summary).toBe(`${KEY} — Itens: 1 alterado (a1)`)
  })

  it('máscara num item novo é recusada', async () => {
    const cur = (await get(app, gerente, KEY)).json()
    const next = [...cur.value, { id: 'a3', name: 'Novo', cpf: '111.***.***-11' }]
    const w = await put(app, gerente, KEY, next, cur.version)
    expect(w.statusCode).toBe(400)
    expect(w.json().error.details.path).toBe('2.cpf')
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
    const w1 = await put(app, admin.cookie, 'campanhas.cupons', [{ id: 'c1', v: 1 }, { id: 'c2', v: 1 }])
    expect(w1.statusCode).toBe(200)
    const a1 = await lastAudit(app)
    expect(a1).toMatchObject({
      actor_id: admin.user.id,
      action: 'editar',
      entity: 'Dados · Cupons',
      summary: 'campanhas.cupons — Primeira gravação com 2 itens',
      ip: '127.0.0.1',
      source: 'servidor',
    })
    const w2 = await put(app, admin.cookie, 'campanhas.cupons', [{ id: 'c1', v: 2 }, { id: 'c3', v: 1 }], 1)
    expect(w2.statusCode).toBe(200)
    expect((await lastAudit(app)).summary).toBe('campanhas.cupons — Itens: 1 incluído (c3); 1 alterado (c1); 1 removido (c2)')
    await put(app, admin.cookie, 'campanhas.cupons', [{ id: 'c3', v: 1 }, { id: 'c1', v: 2 }], 2)
    expect((await lastAudit(app)).summary).toBe('campanhas.cupons — Itens: ordem alterada')
    await put(app, admin.cookie, 'campanhas.cupons', [{ id: 'c3', v: 1 }, { id: 'c1', v: 2 }], 3)
    expect((await lastAudit(app)).summary).toBe('campanhas.cupons — Salvo sem alterações')
  })

  it('objetos: campos de 1º nível alterados', async () => {
    await put(app, admin.cookie, 'config.empresa', { name: 'X2Win', cnpj: '00.000.000/0001-00', address: { city: 'SP' } })
    expect((await lastAudit(app)).summary).toBe('config.empresa — Primeira gravação. Campos: name, cnpj, address')
    await put(app, admin.cookie, 'config.empresa', { name: 'X2Win', cnpj: '11.111.111/0001-11', address: { city: 'RJ' }, phone: '1' }, 1)
    const a = await lastAudit(app)
    expect(a.entity).toBe('Dados · Empresa e licença')
    expect(a.summary).toBe('config.empresa — Campos alterados: cnpj, address, phone (incluído)')
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

  it('sem permissão de gravação → 403; máscara na base → 400', async () => {
    const m = await put(app, marketing, KEY, players)
    expect(m.statusCode).toBe(403)
    expect(m.json().error.code).toBe('sem_permissao')
    const masked = await put(app, admin, KEY, [{ ...players[0], cpf: '123.***.***-09' }])
    expect(masked.statusCode).toBe(400)
    expect(await rawRow(app, KEY)).toBeNull()
  })

  it('primeira gravação aceita a lista inteira como base, cifrada', async () => {
    const w = await put(app, admin, KEY, players)
    expect(w.statusCode).toBe(200)
    expect(w.json()).toMatchObject({ key: KEY, value: players, version: 1 })
    const row = await rawRow(app, KEY)
    expect(row?.value).toBeNull()
    expect(row?.value_enc).toBeTruthy()
    expect(JSON.stringify(row)).not.toContain('12345678909')
    expect((await lastAudit(app)).summary).toBe(`${KEY} — Base inicial com 2 jogadores`)
  })

  it('leitura mascara dados pessoais para quem não tem usuarios.ver-dados', async () => {
    const m = await current(marketing)
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

  it('usuarios.editar muda status, saldos, moedas e etiquetas; dados pessoais mascarados são preservados', async () => {
    const cur = await current(suporte)
    const next = structuredClone(cur.value)
    Object.assign(next[0], { status: 'bloqueado', balanceReal: 120.5, balanceBonus: 5, coins: 15, tags: ['novo', 'vip'] })
    const w = await put(app, suporte, KEY, next, cur.version)
    expect(w.statusCode).toBe(200)
    expect(w.json().value[0].cpf).toBe('123.***.***-09')
    const stored = (await storedPlain(app, KEY)) as typeof players
    expect(stored[0]).toEqual({ ...players[0], status: 'bloqueado', balanceReal: 120.5, balanceBonus: 5, coins: 15, tags: ['novo', 'vip'] })
    expect(stored[1]).toEqual(players[1])
    const a = await lastAudit(app)
    expect(a.action).toBe('editar')
    expect(a.entity).toBe('Dados · Usuários')
    expect(a.summary).toContain('Jogadores alterados (1): p1 (')
    expect(a.summary).toContain('status: ativo → bloqueado')
    expect(a.summary).toContain('saldo real: R$ 100,00 → R$ 120,50')
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
    expect(t.json().error.details.fields).toEqual(['balanceReal', 'tags'])
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
      ['balanceReal', -1],
      ['balanceBonus', 1.234],
      ['coins', 1.5],
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
})

// ---------- domínio transactions ----------

describe('kv: transações (geral.transacoes)', () => {
  let app: FastifyInstance
  let admin: string
  let suporte: string
  let financeiro: string
  let marketing: string
  let estornos: string
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
  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app)).cookie
    suporte = (await loginAs(app, 'suporte')).cookie
    financeiro = (await loginAs(app, 'financeiro')).cookie
    marketing = (await loginAs(app, 'marketing')).cookie
    await customRole(app, 'estornos', ['transacoes.ver', 'transacoes.editar'])
    estornos = (await loginAs(app, 'estornos')).cookie
  })
  afterAll(async () => app.close())

  const current = async (cookie = admin) => (await get(app, cookie, KEY)).json() as { value: Record<string, unknown>[]; version: number }

  it('leitura conforme a regra; base inicial', async () => {
    expect((await get(app, marketing, KEY)).statusCode).toBe(403)
    expect((await get(app, suporte, KEY)).json().stored).toBe(false)
    // base com item inválido → 400
    expect((await put(app, admin, KEY, [{ id: 'X', type: 'inventado', amount: 1, playerId: 'p' }])).statusCode).toBe(400)
    const w = await put(app, admin, KEY, base)
    expect(w.statusCode).toBe(200)
    expect(w.json()).toMatchObject({ value: base, version: 1 })
    expect((await rawRow(app, KEY))?.value).toEqual(base)
    expect((await lastAudit(app)).summary).toBe(`${KEY} — Base inicial do extrato com 3 transações`)
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
    expect(a.summary).toContain('Creditação de R$ 50,00 na carteira real do jogador p1 · TX10')
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
    // reordenar é aceito (nada mudou nos itens)
    const reordered = [...cur.value].reverse()
    expect((await put(app, admin, KEY, reordered, cur.version)).statusCode).toBe(200)
    expect((await lastAudit(app)).summary).toBe(`${KEY} — Extrato salvo sem lançamentos novos`)
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
      manual('TX35', 'credito_manual', 10, { at: 'ontem' }),
      manual('TX36', 'credito_manual', 10, { reference: '' }),
      manual('TX37', 'credito_manual', 10, { note: 'x'.repeat(501) }),
    ]
    for (const tx of bad) {
      const r = await put(app, admin, KEY, [tx, ...cur.value], cur.version)
      expect(r.statusCode, tx.id).toBe(400)
      expect(r.json().error.code, tx.id).toBe('dados_invalidos')
    }
    expect((await put(app, admin, KEY, [manual('TX38', 'credito_manual', 5000), ...cur.value], cur.version)).statusCode).toBe(200)
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
    const ok = await put(app, estornos, KEY, [reversal('TX47', 'TX2', 20), ...cur.value], cur.version)
    expect(ok.statusCode).toBe(200)
    const a = await lastAudit(app)
    expect(a.action).toBe('estornar')
    expect(a.summary).toContain('Estorno de R$ 20,00 (carteira real) da transação TX2 do jogador p1 · TX47')

    cur = await current(estornos)
    const twice = await put(app, estornos, KEY, [reversal('TX48', 'TX2', 20), ...cur.value], cur.version)
    expect(twice.statusCode).toBe(400)
    expect(twice.json().error.message).toContain('já foi estornada')
    // dois estornos da mesma transação na mesma gravação
    const pair = await put(app, estornos, KEY, [reversal('TX49', 'TX11', 10), reversal('TX50', 'TX11', 10), ...cur.value], cur.version)
    expect(pair.statusCode).toBe(400)
    // subtração manual pode ser estornada
    expect((await put(app, estornos, KEY, [reversal('TX51', 'TX11', 10), ...cur.value], cur.version)).statusCode).toBe(200)
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

  it('máscara é idempotente e não toca números em campos de segredo', () => {
    const v = { apiKey: 'abcdefgh1234', password: 1234, nested: { token: `${BULLETS}9999` } }
    const once = redact(v, { secrets: true, pii: false })
    expect(once).toEqual({ apiKey: `${BULLETS}1234`, password: 1234, nested: { token: `${BULLETS}9999` } })
    expect(redact(once, { secrets: true, pii: false })).toEqual(once)
    // dado pessoal numérico também sai mascarado
    expect(redact({ cpf: 12345678909 }, { secrets: false, pii: true })).toEqual({ cpf: '123.***.***-09' })
    // sem política, devolve o mesmo valor
    expect(redact(v, { secrets: false, pii: false })).toBe(v)
  })

  it('restauração não mexe no protótipo e só restaura campos sensíveis', () => {
    const incoming = JSON.parse('{"__proto__": {"x": 1}, "note": "a *** b", "apiKey": "••••1234"}')
    const out = restoreMasked(incoming, { apiKey: 'real-1234' }, { secrets: true, pii: false }) as Record<string, unknown>
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).x).toBeUndefined()
    expect(out.note).toBe('a *** b')
    expect(out.apiKey).toBe('real-1234')
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
