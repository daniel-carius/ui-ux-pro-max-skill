// Regressões (r3, secret-config-exposure-and-rebinding): segredos das chaves de
// configuração (integrações, agregadores, gateways, sportsbook).
//  1. segredo mantido pela máscara não muda de destino (host, baseUrl, gateway/clientId)
//     e um id repetido não clona o segredo;
//  2. Suporte (depositos.ver) não lê config.gateways (+contas, +roteamento);
//  3. config.integracoes: quem não vê Integrações recebe só remetente e status das
//     contas; segredo curto sai sem trecho; número sob campo de segredo sai mascarado;
//     a chave aceita só o formato do painel (senha curta ou numérica → 400);
//  4. só a máscara exata emitida pelo servidor vale como "não mudou" (rotação para um
//     valor com *** ou • não mantém o segredo vazado em silêncio).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { maskSecret } from '../src/lib/mask'
import { isDestinationField } from '../src/modules/kv/redact'
import { api, createTestApp, loginAs } from './helpers'

const BULLETS = '••••••••••'

const put = (app: FastifyInstance, cookie: string, key: string, value: unknown, version?: number) =>
  api(app, 'PUT', `/api/kv/${key}`, { cookie, body: version === undefined ? { value } : { value, version } })
const get = (app: FastifyInstance, cookie: string, key: string) => api(app, 'GET', `/api/kv/${key}`, { cookie })

async function storedPlain<T = any>(app: FastifyInstance, key: string): Promise<T> {
  const row = await app.db.one<{ value: unknown; value_enc: string | null }>('select value, value_enc from kv_store where key = $1', [key])
  return (row?.value_enc ? JSON.parse(app.cipher.decrypt(row.value_enc)) : row?.value) as T
}
const lastAudit = async (app: FastifyInstance, prefix: string) =>
  (await app.db.one<{ summary: string }>(`select summary from audit_log where summary like $1 order by id desc limit 1`, [`${prefix}%`]))?.summary

const integrations = (over: { password?: unknown; smtp?: Record<string, unknown>; mailgunKey?: string; sendworkKey?: string } = {}) => ({
  emailProvider: 'smtp',
  smtp: { host: 'smtp.relay-x2win.com.br', port: 587, user: 'mailer@x2win.bet.br', password: over.password ?? 'Smtp-Real-Password-2026!', fromName: 'X2Win', fromEmail: 'no-reply@x2win.bet.br', secure: true, ...over.smtp },
  mailgun: { connected: true, domain: 'mg.x2win.bet.br', apiKey: over.mailgunKey ?? 'key-8bx2kq7mn41zp0d7r3t9vj5Wq', region: 'us' },
  sendwork: { connected: true, accountId: 'SW-901277', apiKey: over.sendworkKey ?? 'sk_live_5d1c0e9b77a2Hn4V', smsSender: 'X2WIN', rcsAgent: 'x2win-br' },
})

describe('kv: máscara de segredo (unidades)', () => {
  it('segredo com menos de 16 caracteres sai sem nenhum trecho; maior mostra só os 4 últimos', () => {
    expect(maskSecret('')).toBe('')
    expect(maskSecret('a9Z!')).toBe(BULLETS)
    expect(maskSecret('Qz7#kP2w')).toBe(BULLETS)
    expect(maskSecret('Ab3dEf6hJ8kZ')).toBe(BULLETS)
    expect(maskSecret('0123456789abcdef')).toBe(`${BULLETS}cdef`)
  })

  it('campos que decidem o destino do segredo', () => {
    for (const f of ['host', 'smtpHost', 'port', 'secure', 'baseUrl', 'callbackUrl', 'environments', 'currentEnv', 'environment', 'gatewayId', 'clientId', 'accountId', 'user', 'domain', 'region', 'platformId', 'endpoint']) {
      expect(isDestinationField(f), f).toBe(true)
    }
    for (const f of ['name', 'label', 'active', 'primary', 'holder', 'support', 'updatedBy', 'createdAt', 'apiSecret', 'password', 'smsSender', 'status']) {
      expect(isDestinationField(f), f).toBe(false)
    }
  })
})

describe('kv: segredo mantido pela máscara não muda de destino (r3-secret-config-1)', () => {
  let app: FastifyInstance
  let superadmin: string
  beforeAll(async () => {
    app = await createTestApp()
    superadmin = (await loginAs(app, 'superadmin', { totp: true })).cookie
  })
  afterAll(async () => app.close())

  it('(a) Integrações: smtp.host/port/secure trocados com a senha mascarada → 400; a senha não vai para o servidor novo', async () => {
    const SMTP = 'Evox-Smtp-RealPass-9931'
    expect((await put(app, superadmin, 'config.integracoes', integrations({ password: SMTP }), 0)).statusCode).toBe(200)
    const { cookie } = await loginAs(app, 'administrador', { totp: true })
    const cur = (await get(app, cookie, 'config.integracoes')).json()
    expect(cur.value.smtp.password).toBe(`${BULLETS}9931`)
    for (const change of [{ host: 'mx.attacker.invalid' }, { port: 25 }, { secure: false }, { user: 'outro@x2win.bet.br' }, { host: 'mx.attacker.invalid', port: 25, secure: false }]) {
      const evil = { ...cur.value, smtp: { ...cur.value.smtp, ...change } }
      const r = await put(app, cookie, 'config.integracoes', evil, cur.version)
      expect(r.statusCode, JSON.stringify(change)).toBe(400)
      expect(r.json().error.message).toContain('digite o segredo novamente')
    }
    const now = await storedPlain(app, 'config.integracoes')
    expect(now.smtp).toMatchObject({ host: 'smtp.relay-x2win.com.br', port: 587, secure: true, password: SMTP })
    // mudar o remetente (não é destino) com a senha mascarada continua valendo
    const ok = await put(app, cookie, 'config.integracoes', { ...cur.value, smtp: { ...cur.value.smtp, fromName: 'X2Win Bet' } }, cur.version)
    expect(ok.statusCode).toBe(200)
    expect((await storedPlain(app, 'config.integracoes')).smtp).toMatchObject({ fromName: 'X2Win Bet', password: SMTP })
    // servidor novo com a senha digitada de novo → 200
    const typed = { ...ok.json().value, smtp: { ...ok.json().value.smtp, host: 'smtp.novo-x2win.com.br', password: 'Nova-Senha-Smtp-2026' } }
    expect((await put(app, cookie, 'config.integracoes', typed, ok.json().version)).statusCode).toBe(200)
    expect((await storedPlain(app, 'config.integracoes')).smtp).toMatchObject({ host: 'smtp.novo-x2win.com.br', password: 'Nova-Senha-Smtp-2026' })
  })

  it('(b) Agregadores: cargo ADM troca environments[].baseUrl mantendo apiSecret/webhookSecret → 400', async () => {
    const API_SECRET = 'skr-live-api-6f0a2c9d1e77'
    const list = [
      {
        id: 'skravion',
        name: 'Skravion',
        contracted: true,
        environments: [
          { id: 'producao', label: 'Produção', baseUrl: 'https://api.skravion.io/v1' },
          { id: 'staging', label: 'Staging', baseUrl: 'https://staging.skravion.io/v1' },
        ],
        currentEnv: 'producao',
        platformId: 'x2win-br',
        apiSecret: API_SECRET,
        webhookSecret: 'skr-live-wh-3b8e5a1f',
        lastSyncAt: null,
        lastSyncGames: 0,
        status: 'conectado',
      },
    ]
    expect((await put(app, superadmin, 'cassino.agregadores', list, 0)).statusCode).toBe(200)
    const { cookie } = await loginAs(app, 'adm')
    const cur = (await get(app, cookie, 'cassino.agregadores')).json()
    expect(cur.value[0].apiSecret).not.toBe(API_SECRET)
    const moved = cur.value.map((a: (typeof list)[number]) => ({ ...a, environments: a.environments.map((e) => ({ ...e, baseUrl: 'https://skravion.attacker.invalid/v1' })) }))
    expect((await put(app, cookie, 'cassino.agregadores', moved, cur.version)).statusCode).toBe(400)
    const onlyProd = cur.value.map((a: (typeof list)[number]) => ({ ...a, environments: [{ id: 'producao', label: 'Produção', baseUrl: 'https://metagrator.attacker.example/v2' }] }))
    expect((await put(app, cookie, 'cassino.agregadores', onlyProd, cur.version)).statusCode).toBe(400)
    for (const change of [{ currentEnv: 'staging' }, { platformId: 'attacker' }]) {
      expect((await put(app, cookie, 'cassino.agregadores', cur.value.map((a: object) => ({ ...a, ...change })), cur.version)).statusCode, JSON.stringify(change)).toBe(400)
    }
    const now = await storedPlain(app, 'cassino.agregadores')
    expect(now[0].environments[0].baseUrl).toBe('https://api.skravion.io/v1')
    expect(now[0].apiSecret).toBe(API_SECRET)
    // rótulo do ambiente e status não mudam o destino: continuam salváveis com o segredo mascarado
    const relabeled = cur.value.map((a: (typeof list)[number]) => ({ ...a, status: 'erro', environments: a.environments.map((e) => ({ ...e, label: `${e.label}!` })) }))
    expect((await put(app, cookie, 'cassino.agregadores', relabeled, cur.version)).statusCode).toBe(200)
    expect((await storedPlain(app, 'cassino.agregadores'))[0].apiSecret).toBe(API_SECRET)
  })

  it('(c) Gateways: id reaproveitado com outro gateway/clientId → 400; id repetido não clona o segredo', async () => {
    const ACC = 'pagflex-live-acc-Qw7Er9Ty2Ui4'
    const accounts = [
      {
        id: 'ga-pf-2',
        gatewayId: 'pagflex',
        name: 'Conta 2 (alto volume)',
        main: false,
        active: true,
        clientId: 'pf_acc_x2win_hv02',
        secret: ACC,
        callbackUrl: 'https://api.x2win.bet.br/callbacks/pagflex/ga-pf-2',
        createdAt: '2026-01-01T00:00:00Z',
        holder: 'X2Win Entretenimento Digital Ltda.',
      },
    ]
    expect((await put(app, superadmin, 'config.gateways.contas', accounts, 0)).statusCode).toBe(200)
    const { cookie } = await loginAs(app, 'administrador', { totp: true })
    const cur = (await get(app, cookie, 'config.gateways.contas')).json()
    const [orig] = cur.value
    expect(orig.secret).not.toBe(ACC)
    const tries = [
      [{ ...orig, gatewayId: 'brpay', clientId: 'brp_attacker_0001' }],
      [{ ...orig, callbackUrl: 'https://cb.attacker.example/brpay' }],
      [orig, { ...orig, name: 'Clone' }],
      [
        { ...orig, gatewayId: 'brpay', clientId: 'brp_attacker_0001' },
        { ...orig, name: 'Clone', gatewayId: 'pixnow', clientId: 'pn_attacker_0002' },
      ],
    ]
    for (const evil of tries) {
      const r = await put(app, cookie, 'config.gateways.contas', evil, cur.version)
      expect(r.statusCode, JSON.stringify(evil).slice(0, 160)).toBe(400)
    }
    const now = await storedPlain<typeof accounts>(app, 'config.gateways.contas')
    expect(now).toEqual(accounts)
    // renomear a conta mantém o segredo
    expect((await put(app, cookie, 'config.gateways.contas', [{ ...orig, name: 'Conta 2' }], cur.version)).statusCode).toBe(200)
    expect((await storedPlain<typeof accounts>(app, 'config.gateways.contas'))[0]).toEqual({ ...accounts[0], name: 'Conta 2' })
  })
})

describe('kv: leitura das chaves com segredos (r3-secret-config-2, r3-secret-config-3)', () => {
  let app: FastifyInstance
  let admin: string
  const GW_SECRET = 'Qm7vT2xR9pLs'
  const GW_WEBHOOK = 'whk-pagflex-Z81q'
  const ACC_SECRET = 'Ab3dEf6hJ8kZ'
  beforeAll(async () => {
    app = await createTestApp()
    admin = (await loginAs(app, 'superadmin', { totp: true })).cookie
    const w = async (key: string, value: unknown) => expect((await put(app, admin, key, value, 0)).statusCode, key).toBe(200)
    await w('config.gateways', [
      { id: 'pagflex', name: 'PagFlex', primary: true, active: true, environment: 'producao', clientId: 'pf_prod_x2win_8812', secret: GW_SECRET, webhookSecret: GW_WEBHOOK, updatedAt: '2026-10-01T00:00:00Z', updatedBy: 'Daniel' },
    ])
    await w('config.gateways.contas', [
      { id: 'ga-pf-2', gatewayId: 'pagflex', name: 'Conta 2', main: false, active: true, clientId: 'pf_acc_x2win_hv02', secret: ACC_SECRET, callbackUrl: 'https://api.x2win.bet.br/callbacks/pagflex/ga-pf-2', createdAt: '2026-01-01T00:00:00Z', holder: 'X2Win Entretenimento Digital Ltda. 12.345.678/0001-90' },
    ])
    await w('config.gateways.roteamento', { deposits: { 'ga-pf-2': 100 }, fallback: ['ga-pf-2'], withdrawalAccountId: 'ga-pf-2', withdrawalFallback: true })
    await w('config.integracoes', integrations({ password: 'Qz7#kP2w' }))
  })
  afterAll(async () => app.close())

  it('Suporte (depositos.ver) não lê config.gateways, contas nem roteamento', async () => {
    const { cookie } = await loginAs(app, 'suporte', { totp: true })
    let body = ''
    for (const key of ['config.gateways', 'config.gateways.contas', 'config.gateways.roteamento']) {
      const r = await get(app, cookie, key)
      expect(r.statusCode, key).toBe(403)
      body += r.body
    }
    for (const s of [GW_SECRET.slice(-4), GW_WEBHOOK.slice(-4), ACC_SECRET.slice(-4), 'pf_prod_x2win_8812', 'pf_acc_x2win_hv02', '12.345.678/0001-90']) expect(body).not.toContain(s)
  })

  it('Financeiro (gateways.ver) lê, mas segredo de 12 caracteres sai sem nenhum trecho', async () => {
    const { cookie } = await loginAs(app, 'financeiro', { totp: true })
    const r = await get(app, cookie, 'config.gateways.contas')
    expect(r.statusCode).toBe(200)
    expect(r.json().value[0].secret).toBe(BULLETS)
    expect(r.body).not.toContain(ACC_SECRET.slice(-4))
    const g = await get(app, cookie, 'config.gateways')
    expect(g.json().value[0]).toMatchObject({ secret: BULLETS, webhookSecret: `${BULLETS}Z81q` })
    // nenhuma chave com segredo guarda versões
    expect((await api(app, 'GET', '/api/kv/config.gateways/history', { cookie: admin })).statusCode).toBe(404)
  })

  it('config.integracoes: quem não vê Integrações recebe só remetente e status das contas', async () => {
    for (const role of ['suporte', 'financeiro', 'marketing', 'marketing-oficial']) {
      const { cookie } = await loginAs(app, role, { totp: true })
      const r = await get(app, cookie, 'config.integracoes')
      expect(r.statusCode, role).toBe(200)
      expect(r.json().value, role).toEqual({
        emailProvider: 'smtp',
        smtp: { fromName: 'X2Win', fromEmail: 'no-reply@x2win.bet.br' },
        mailgun: { connected: true, domain: 'mg.x2win.bet.br' },
        sendwork: { connected: true, smsSender: 'X2WIN', rcsAgent: 'x2win-br' },
      })
      for (const s of ['smtp.relay-x2win.com.br', 'mailer@x2win.bet.br', 'SW-901277', 'kP2w', 'j5Wq', 'Hn4V', '••']) expect(r.body, `${role}: ${s}`).not.toContain(s)
    }
    // quem vê Integrações recebe tudo, com os segredos mascarados (senha de 8 sem trecho)
    const r = await get(app, admin, 'config.integracoes')
    expect(r.json().value.smtp).toMatchObject({ host: 'smtp.relay-x2win.com.br', user: 'mailer@x2win.bet.br', password: BULLETS })
    expect(r.json().value.mailgun.apiKey).toBe(`${BULLETS}j5Wq`)
  })

  it('config.integracoes: senha curta, numérica, porta inválida e campo desconhecido → 400', async () => {
    const version = (await get(app, admin, 'config.integracoes')).json().version
    const cases: [string, unknown][] = [
      ['senha de 4', integrations({ password: 'a9Z!' })],
      ['senha numérica', integrations({ password: 482913 })],
      ['porta', integrations({ smtp: { port: 70000 } })],
      ['porta texto', integrations({ smtp: { port: '587' } })],
      ['quebra de linha no remetente', integrations({ smtp: { fromName: 'X2Win\r\nBcc: a@b.com' } })],
      ['campo desconhecido', { ...integrations(), extra: 1 }],
      ['campo desconhecido no smtp', integrations({ smtp: { proxy: 'socks5://x' } })],
      ['chave curta', integrations({ sendworkKey: 'abc' })],
    ]
    for (const [what, value] of cases) {
      const w = await put(app, admin, 'config.integracoes', value, version)
      expect(w.statusCode, what).toBe(400)
      expect(w.json().error.code).toBe('dados_invalidos')
    }
    expect((await storedPlain(app, 'config.integracoes')).smtp.password).toBe('Qz7#kP2w')
    // conta sem chave (desconectada) continua valendo
    const off = integrations()
    off.mailgun = { connected: false, domain: '', apiKey: '', region: 'us' }
    expect((await put(app, admin, 'config.integracoes', off, version)).statusCode).toBe(200)
  })
})

describe('kv: só a máscara exata vale como "não mudou" (r3-secret-config-4)', () => {
  let app: FastifyInstance
  let cookie: string
  const KEY = 'cassino.sportsbook-credenciais'
  const LEAKED = 'betby-private-key-LEAKED-0001'
  const base = { platformId: 'x2win-sb-br', publicKey: 'pub-key-T4m2xx', privateKey: LEAKED, webhookSecret: 'sb-webhook-secret-Q9w4', status: 'conectado' }

  beforeAll(async () => {
    app = await createTestApp()
    cookie = (await loginAs(app, 'superadmin', { totp: true })).cookie
    expect((await put(app, cookie, KEY, base, 0)).statusCode).toBe(200)
  })
  afterAll(async () => app.close())

  it('controle: a máscara exata emitida pelo servidor mantém o segredo gravado', async () => {
    const cur = (await get(app, cookie, KEY)).json()
    expect(cur.value.privateKey).toBe(`${BULLETS}0001`)
    const r = await put(app, cookie, KEY, { ...base, privateKey: cur.value.privateKey, webhookSecret: cur.value.webhookSecret }, cur.version)
    expect(r.statusCode).toBe(200)
    expect((await storedPlain(app, KEY)).privateKey).toBe(LEAKED)
  })

  for (const rotated of ['Bt9***Zq-new-private-key-2026', 'new-key-with-bullet•-2026-ABCD', 'x***', '••••0001', `${BULLETS}0002`]) {
    it(`rotação para "${rotated}" → 400 e nada muda`, async () => {
      const cur = (await get(app, cookie, KEY)).json()
      const r = await put(app, cookie, KEY, { ...cur.value, privateKey: rotated }, cur.version)
      expect(r.statusCode).toBe(400)
      expect(r.json().error.details.path).toBe('privateKey')
      expect((await storedPlain(app, KEY)).privateKey).toBe(LEAKED)
      expect(await lastAudit(app, KEY)).not.toMatch(new RegExp(`v${cur.version}→v${cur.version + 1}`))
    })
  }

  it('rotação para um valor novo sem caracteres de máscara grava o valor novo', async () => {
    const cur = (await get(app, cookie, KEY)).json()
    const r = await put(app, cookie, KEY, { ...cur.value, privateKey: 'betby-private-key-ROTATED-0002' }, cur.version)
    expect(r.statusCode).toBe(200)
    expect(r.json().value.privateKey).toBe(`${BULLETS}0002`)
    expect((await storedPlain(app, KEY)).privateKey).toBe('betby-private-key-ROTATED-0002')
  })
})
