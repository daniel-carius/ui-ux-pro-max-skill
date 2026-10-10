// Regressões de segurança do login, 2FA e sessão (achados r1-authn-1..6, r1-authz-5, r1-authz-10,
// r1-exposure-7, r1-exposure-8 e r1-logic-6). Cada bloco afirma o comportamento seguro.
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import type { Role } from '@shared/permissions'
import { SECURITY } from '../src/config'
import { sha256, verifyPassword } from '../src/lib/crypto'
import { totpCode } from '../src/lib/totp'
import {
  RECOVERY_CODE_BITS,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from '../src/modules/auth/service'
import { PASSWORD_GATE_LIMITS } from '../src/modules/auth/password-gate'
import { LoginThrottle, ipBucket, loginThrottleFor } from '../src/modules/auth/throttle'
import { TEST_ENV, api, cookieFrom, createTestApp, createUser, sessionCookie } from './helpers'

// cada chamada usa um IP de uma faixa /24 própria (limite de 10/min por IP e freio por origem)
let ipSeq = 0
const freshIp = () => {
  ipSeq++
  return `10.${150 + Math.floor(ipSeq / 250)}.${ipSeq % 250}.1`
}

/** Código de 6 dígitos fora da janela ±1 do TOTP. */
const wrongCode = (secret: string) => {
  const now = Date.now()
  const valid = new Set([-30_000, 0, 30_000].map((d) => totpCode(secret, now + d)))
  let n = Number(totpCode(secret, now))
  let c: string
  do {
    n = (n + 123_457) % 1_000_000
    c = String(n).padStart(6, '0')
  } while (valid.has(c))
  return c
}

function expectError(r: LightMyRequestResponse, status: number, code: string) {
  expect(r.statusCode, r.body).toBe(status)
  expect(r.json().error.code).toBe(code)
}

const login = (app: FastifyInstance, email: string, password: string, ip = freshIp(), cookie?: string) =>
  api(app, 'POST', '/api/auth/login', { body: { email, password }, ip, cookie })

async function userRow(app: FastifyInstance, id: string) {
  return (await app.db.one<{
    failed_logins: number
    locked_until: string | null
    totp_enabled: boolean
    totp_pending_enc: string | null
    recovery_codes: string[]
    password_hash: string
  }>('select failed_logins, locked_until, totp_enabled, totp_pending_enc, recovery_codes, password_hash from users where id = $1', [id]))!
}

async function auditActions(app: FastifyInstance, userId: string, action?: string) {
  return app.db.query<{ action: string; summary: string }>(
    'select action, summary from audit_log where actor_id = $1 and ($2::text is null or action = $2) order by id',
    [userId, action ?? null],
  )
}

/** Superadmin com 2FA ligado e sessão ativa (a exigência de 2FA do cargo é satisfeita). */
async function adminSession(app: FastifyInstance) {
  const admin = await createUser(app, { roleId: 'superadmin', totp: true })
  return sessionCookie(app, admin.id, 'active')
}

async function setRequire2fa(app: FastifyInstance, admin: string, roleId: string, on: boolean) {
  const cur = await api(app, 'GET', '/api/kv/cargos.lista', { cookie: admin })
  expect(cur.statusCode, cur.body).toBe(200)
  const body = cur.json() as { value: Role[]; version: number }
  const value = body.value.map((r) => (r.id === roleId ? { ...r, require2fa: on } : r))
  const w = await api(app, 'PUT', '/api/kv/cargos.lista', { cookie: admin, body: { value, version: body.version } })
  expect(w.statusCode, w.body).toBe(200)
}

async function setEnforceAll(app: FastifyInstance, admin: string, on: boolean) {
  const cur = await api(app, 'GET', '/api/kv/config.seguranca-painel', { cookie: admin })
  expect(cur.statusCode, cur.body).toBe(200)
  const value = { ...(cur.json().value as Record<string, unknown>), enforce2faForAll: on }
  const w = await api(app, 'PUT', '/api/kv/config.seguranca-painel', { cookie: admin, body: { value, version: cur.json().version } })
  expect(w.statusCode, w.body).toBe(200)
}

describe('segurança do login e do 2FA', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => app.close())

  // ------------------------------------------------------------ r1-authn-1
  describe('erros do código do 2FA não voltam a zero com a senha (r1-authn-1)', () => {
    it('logins com a senha certa intercalados com códigos errados bloqueiam no 5º código errado, com auditoria', async () => {
      const u = await createUser(app, { roleId: 'suporte', totp: true })
      const statuses: number[] = []
      let lock: LightMyRequestResponse | null = null
      for (let round = 0; round < 5 && !lock; round++) {
        const l = await login(app, u.email, u.password)
        expect(l.statusCode, l.body).toBe(200)
        expect(l.json().stage).toBe('2fa')
        const cookie = cookieFrom(l)!
        for (let i = 0; i < 4; i++) {
          const v = await api(app, 'POST', '/api/auth/2fa/verify', { cookie, body: { code: wrongCode(u.totpSecret!) }, ip: freshIp() })
          statuses.push(v.statusCode)
          if (v.statusCode === 423) {
            lock = v
            break
          }
        }
      }
      // 4 erros (401) e o 5º bloqueia, apesar do novo login com senha no meio
      expect(statuses).toEqual([401, 401, 401, 401, 423])
      expectError(lock!, 423, 'conta_bloqueada')
      const row = await userRow(app, u.id)
      expect(row.locked_until).not.toBeNull()
      const audit = await auditActions(app, u.id)
      expect(audit.filter((a) => a.action === 'bloquear')).toHaveLength(1)
      // cada código errado (quem já acertou a senha) fica na auditoria
      expect(audit.filter((a) => a.action === 'recusar')).toHaveLength(4)
      expect(audit.find((a) => a.action === 'recusar')?.summary).toMatch(/Código do 2FA incorreto/)

      // senha certa durante o bloqueio: 423, sem sessão nova
      const during = await login(app, u.email, u.password)
      expectError(during, 423, 'conta_bloqueada')
      expect(cookieFrom(during)).toBeNull()

      // depois do prazo: senha + código certo entram e a contagem zera
      await app.db.query(`update users set locked_until = now() - interval '1 second' where id = $1`, [u.id])
      const after = await login(app, u.email, u.password)
      expect(after.json().stage).toBe('2fa')
      const ok = await api(app, 'POST', '/api/auth/2fa/verify', { cookie: cookieFrom(after)!, body: { code: totpCode(u.totpSecret!, Date.now() + 30_000) }, ip: freshIp() })
      expect(ok.statusCode, ok.body).toBe(200)
      expect((await userRow(app, u.id)).failed_logins).toBe(0)
    })

    it('rajada simultânea de códigos errados: no máximo 5 avaliados e o código certo depois dela não entra', async () => {
      const u = await createUser(app, { roleId: 'suporte', totp: true })
      const cookie = cookieFrom(await login(app, u.email, u.password))!
      const burst = await Promise.all(
        Array.from({ length: 15 }, () => api(app, 'POST', '/api/auth/2fa/verify', { cookie, body: { code: wrongCode(u.totpSecret!) }, ip: freshIp() })),
      )
      const st = burst.map((r) => r.statusCode)
      expect(st.filter((s) => s === 401).length).toBeLessThanOrEqual(SECURITY.maxFailedLogins - 1)
      expect(st.filter((s) => s === 423).length).toBeGreaterThanOrEqual(15 - (SECURITY.maxFailedLogins - 1))
      expectError(await api(app, 'POST', '/api/auth/2fa/verify', { cookie, body: { code: totpCode(u.totpSecret!, Date.now()) }, ip: freshIp() }), 423, 'conta_bloqueada')
      expect((await auditActions(app, u.id, 'bloquear')).length).toBe(1)
    })
  })

  // ------------------------------------------------------------ r1-authn-2
  describe('freio do login sob concorrência (r1-authn-2)', () => {
    it('rajada de senhas erradas: no máximo 5 avaliadas; a senha certa enviada depois da rajada não entra nem limpa o bloqueio', async () => {
      const u = await createUser(app, { roleId: 'suporte' })
      // atacante com muitos IPs da mesma faixa /24 (um por requisição). A rajada cabe inteira na fila do scrypt
      // (password-gate.ts: o que passa dela recebe 503 sem ser avaliado), então todas chegam ao freio ao mesmo tempo.
      const burst = PASSWORD_GATE_LIMITS.maxActive + PASSWORD_GATE_LIMITS.maxQueued - 1
      const ip = (n: number) => `10.77.200.${n + 1}`
      const wrong = Array.from({ length: burst }, (_, i) => api(app, 'POST', '/api/auth/login', { body: { email: u.email, password: 'senha-errada-123' }, ip: ip(i) }))
      // o injetor só despacha no .then: a senha certa vai por último, depois de todas as erradas
      const correct = api(app, 'POST', '/api/auth/login', { body: { email: u.email, password: u.password }, ip: ip(burst + 1) })
      const [results, right] = await Promise.all([Promise.all(wrong), correct])
      const evaluated = results.filter((r) => r.statusCode === 401).length
      const blocked = results.filter((r) => r.statusCode === 423).length
      expect(evaluated).toBeLessThanOrEqual(SECURITY.maxFailedLogins)
      expect(evaluated + blocked).toBe(burst)
      expectError(right, 423, 'conta_bloqueada')
      expect(cookieFrom(right)).toBeNull()

      // a origem segue bloqueada (a senha certa não limpou nada) ...
      expectError(await login(app, u.email, u.password, ip(burst + 2)), 423, 'conta_bloqueada')
      // ... mas a pessoa entra da própria rede
      const own = await login(app, u.email, u.password, '192.0.2.77')
      expect(own.statusCode, own.body).toBe(200)
    })

    it('o freio decide com o estado gravado: depois do limite nem a senha certa é avaliada', () => {
      const t = new LoginThrottle('segredo-de-teste-com-mais-de-trinta-e-dois-caracteres', 5, 60_000)
      let now = 1_000_000
      t.clock = () => now
      const k = t.key('Pessoa@X2win.bet.br ', '10.1.2.3')
      expect(k).toBe(t.key('pessoa@x2win.bet.br', '10.1.2.200'))
      expect(k).not.toBe(t.key('pessoa@x2win.bet.br', '10.1.3.3'))
      expect(k).not.toContain('pessoa')
      const out = Array.from({ length: 5 }, () => t.settle(k, false).kind)
      expect(out).toEqual(['failed', 'failed', 'failed', 'failed', 'locked'])
      expect(t.settle(k, true)).toMatchObject({ kind: 'locked', justLocked: false })
      expect(t.settle(k, false)).toMatchObject({ kind: 'locked', justLocked: false })
      // vence o prazo: recomeça do zero
      now += 61_000
      expect(t.settle(k, false)).toEqual({ kind: 'failed', failures: 1 })
      expect(t.settle(k, true)).toEqual({ kind: 'ok' })
      expect(t.peek(k)).toBeNull()
    })

    it('faixa de origem: /24 no IPv4 e /64 no IPv6', () => {
      expect(ipBucket('189.45.12.207')).toBe('189.45.12.0/24')
      expect(ipBucket('::ffff:189.45.12.9')).toBe('189.45.12.0/24')
      expect(ipBucket('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64')
      expect(ipBucket('2001:db8:1:2::9')).toBe('2001:db8:1:2::/64')
      expect(ipBucket('2001:0db8:0001:0002::')).toBe('2001:db8:1:2::/64')
      expect(ipBucket('2001:db8:1:3::1')).not.toBe(ipBucket('2001:db8:1:2::1'))
      expect(ipBucket('::1')).toBe('0:0:0:0::/64')
    })
  })

  // ------------------------------------------------------------ r1-authn-3 / r1-exposure-7
  describe('o 423 não revela quem é da equipe nem tranca a pessoa certa (r1-authn-3, r1-exposure-7)', () => {
    async function probe(email: string, net: string, n = 7) {
      const statuses: number[] = []
      const codes: string[] = []
      const messages: string[] = []
      for (let i = 0; i < n; i++) {
        // um IP por tentativa, todos da mesma faixa
        const r = await login(app, email, `chute-errado-${i}`, `${net}.${i + 1}`)
        statuses.push(r.statusCode)
        codes.push(r.json().error.code)
        messages.push(r.json().error.message.replace(/\d+ minutos?/, 'N min'))
      }
      return { statuses, codes, messages }
    }

    it('e-mail ativo, inexistente, convidado e desligado recebem a mesma sequência de respostas', async () => {
      const ativo = await createUser(app, { roleId: 'suporte', email: 'ana.souza@x2win.bet.br' })
      const convidado = await createUser(app, { roleId: 'suporte', email: 'bia.lima@x2win.bet.br', status: 'convidado' })
      const desligado = await createUser(app, { roleId: 'suporte', email: 'caio.reis@x2win.bet.br', status: 'desligado' })
      const sa = await createUser(app, { roleId: 'superadmin', email: 'chefe.real@x2win.bet.br' })

      const results = {
        ativo: await probe(ativo.email, '10.31.0'),
        inexistente: await probe('nao.existe@x2win.bet.br', '10.32.0'),
        convidado: await probe(convidado.email, '10.33.0'),
        desligado: await probe(desligado.email, '10.34.0'),
        superadmin: await probe(sa.email, '10.35.0'),
      }
      const expected = [401, 401, 401, 401, 423, 423, 423]
      for (const r of Object.values(results)) {
        expect(r.statuses).toEqual(expected)
        expect(r).toEqual(results.inexistente)
      }
      // a conta de ninguém foi tocada
      for (const id of [ativo.id, convidado.id, desligado.id, sa.id]) {
        const row = await userRow(app, id)
        expect(row.failed_logins).toBe(0)
        expect(row.locked_until).toBeNull()
      }
    })

    it('um cliente anônimo não impede o Superadmin de entrar com a senha certa de outra rede', async () => {
      const boss = await createUser(app, { roleId: 'superadmin', totp: true, email: 'boss@x2win.bet.br', password: 'SenhaDoChefe2026' })
      // atacante numa faixa /24 (troca de IP dentro dela para não esbarrar no limite de 10/min por IP)
      const attackerIp = (round: number) => `203.0.113.${66 + round}`
      const bossIp = '192.0.2.10'
      for (let round = 0; round < 2; round++) {
        const tries: number[] = []
        for (let i = 0; i < SECURITY.maxFailedLogins; i++) tries.push((await login(app, boss.email, 'chute-qualquer', attackerIp(round))).statusCode)
        expect(tries).toEqual(round === 0 ? [401, 401, 401, 401, 423] : [423, 423, 423, 423, 423])
        const legit = await login(app, boss.email, boss.password, bossIp)
        expect(legit.statusCode, legit.body).toBe(200)
        expect(legit.json().stage).toBe('2fa')
      }
      // o atacante não vê se a senha confere enquanto a origem dele estiver bloqueada
      expectError(await login(app, boss.email, boss.password, attackerIp(2)), 423, 'conta_bloqueada')
      expect((await userRow(app, boss.id)).locked_until).toBeNull()
      // aviso na auditoria para a pessoa real: 1 por período, com a faixa da origem
      const bloquear = await auditActions(app, boss.id, 'bloquear')
      expect(bloquear).toHaveLength(1)
      expect(bloquear[0].summary).toContain('203.0.113.0/24')
    })

    it('o freio por origem também vale na instância compartilhada da aplicação', () => {
      expect(loginThrottleFor(app.db, TEST_ENV.APP_SECRET)).toBe(loginThrottleFor(app.db, 'outro-segredo'))
    })
  })

  // ------------------------------------------------------------ r1-authn-4
  describe('senha atual errada em /password conta para o bloqueio (r1-authn-4)', () => {
    it('cookie roubado: o 5º erro bloqueia a conta e derruba a sessão; o palpite certo depois não troca a senha', async () => {
      const victim = await createUser(app, { roleId: 'suporte' })
      const stolen = await sessionCookie(app, victim.id, 'active')
      const owner = await sessionCookie(app, victim.id, 'active')
      const statuses: number[] = []
      for (let i = 0; i < 8; i++) {
        const r = await api(app, 'POST', '/api/auth/password', {
          cookie: stolen,
          body: { currentPassword: `Chute${i}Errado99`, newPassword: 'Atacante2026XYZ' },
          ip: freshIp(),
        })
        statuses.push(r.statusCode)
      }
      expect(statuses).toEqual([401, 401, 401, 401, 423, 401, 401, 401])
      const row = await userRow(app, victim.id)
      expect(row.locked_until).not.toBeNull()
      expect(await auditActions(app, victim.id, 'bloquear')).toHaveLength(1)
      expect((await auditActions(app, victim.id, 'recusar')).map((a) => a.summary)[0]).toMatch(/Senha atual incorreta ao trocar a senha/)

      // sessão roubada encerrada; o acerto não passa
      const hit = await api(app, 'POST', '/api/auth/password', { cookie: stolen, body: { currentPassword: victim.password, newPassword: 'Atacante2026XYZ' }, ip: freshIp() })
      expectError(hit, 401, 'nao_autenticado')
      expect(await verifyPassword(victim.password, (await userRow(app, victim.id)).password_hash)).toBe(true)
      // a outra sessão da pessoa segue; um palpite certo por ela durante o bloqueio também é recusado
      expect((await api(app, 'GET', '/api/auth/me', { cookie: owner })).statusCode).toBe(200)
      expectError(
        await api(app, 'POST', '/api/auth/password', { cookie: owner, body: { currentPassword: victim.password, newPassword: 'NovaSenha2026XYZ' }, ip: freshIp() }),
        423,
        'conta_bloqueada',
      )
    })

    it('rajada simultânea de palpites: a senha certa que chega depois do bloqueio não troca a senha', async () => {
      const victim = await createUser(app, { roleId: 'suporte' })
      const stolen = await sessionCookie(app, victim.id, 'active')
      const wrong = Array.from({ length: 10 }, (_, i) =>
        api(app, 'POST', '/api/auth/password', { cookie: stolen, body: { currentPassword: `Palpite${i}Errado1`, newPassword: 'Atacante2026XYZ' }, ip: freshIp() }),
      )
      const right = api(app, 'POST', '/api/auth/password', { cookie: stolen, body: { currentPassword: victim.password, newPassword: 'Atacante2026XYZ' }, ip: freshIp() })
      const [results, hit] = await Promise.all([Promise.all(wrong), right])
      expect(results.filter((r) => r.statusCode === 401 && r.json().error.code === 'credenciais_invalidas').length).toBeLessThanOrEqual(SECURITY.maxFailedLogins - 1)
      expect(hit.statusCode, hit.body).not.toBe(200)
      expect(await verifyPassword(victim.password, (await userRow(app, victim.id)).password_hash)).toBe(true)
    })
  })

  // ------------------------------------------------------------ r1-authn-5 / r1-exposure-8
  describe('códigos de recuperação (r1-authn-5, r1-exposure-8)', () => {
    it('cada código tem pelo menos 80 bits de entropia e o gerador não repete', () => {
      expect(RECOVERY_CODE_BITS).toBeGreaterThanOrEqual(80)
      const codes = generateRecoveryCodes(2000)
      for (const c of codes.slice(0, 50)) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/)
      expect(new Set(codes).size).toBe(codes.length)
      // todos os 32 símbolos aparecem (sem viés grosseiro do alfabeto)
      expect(new Set(codes.join('').replace(/-/g, '')).size).toBe(32)
    })

    it('o hash guardado não é sha256 puro: depende do segredo do servidor e da pessoa', () => {
      const code = normalizeRecoveryCode('abcde-12345-fghjk-6789z')!
      expect(code).toBe('ABCDE-12345-FGHJK-6789Z')
      const h = hashRecoveryCode(TEST_ENV.APP_SECRET, 'u_alice', code)
      expect(h).not.toBe(createHash('sha256').update(code).digest('hex'))
      expect(h.startsWith('v2$')).toBe(true)
      expect(h).not.toBe(hashRecoveryCode(TEST_ENV.APP_SECRET, 'u_bob', code))
      expect(h).not.toBe(hashRecoveryCode('outro-segredo-do-servidor-com-mais-de-32-caracteres', 'u_alice', code))
      // leitura do papel: minúsculas, sem hífen, espaços, O→0 e I/L→1
      expect(normalizeRecoveryCode(' abcde 12345fghjk-6789z ')).toBe(code)
      expect(normalizeRecoveryCode('O0OOO-IL111-AAAAA-BBBBB')).toBe('00000-11111-AAAAA-BBBBB')
      // formato antigo (10 hex) e símbolos fora do alfabeto não valem
      expect(normalizeRecoveryCode('ABCDE-12345')).toBeNull()
      expect(normalizeRecoveryCode('ABCDE-12345-FGHJK-6789U')).toBeNull()
    })

    it('pelo fluxo real: banco sem sha256(código), código de uma pessoa não serve para outra, uso único', async () => {
      async function enroll() {
        const u = await createUser(app, { roleId: 'marketing-oficial' }) // cargo que exige 2FA
        const l = await login(app, u.email, u.password)
        expect(l.json().stage).toBe('enroll')
        const cookie = cookieFrom(l)!
        const setup = await api(app, 'POST', '/api/auth/2fa/setup', { cookie, ip: freshIp() })
        expect(setup.statusCode, setup.body).toBe(200)
        const en = await api(app, 'POST', '/api/auth/2fa/enable', { cookie, body: { code: totpCode(setup.json().secret, Date.now()) }, ip: freshIp() })
        expect(en.statusCode, en.body).toBe(200)
        return { u, codes: en.json().recoveryCodes as string[], stored: (await userRow(app, u.id)).recovery_codes }
      }
      const a = await enroll()
      const b = await enroll()
      const dump = new Set([...a.stored, ...b.stored])
      for (const c of [...a.codes, ...b.codes]) {
        expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/)
        expect(dump.has(sha256(c))).toBe(false)
      }
      // código da Alice não entra na conta do Bob
      const lb = await login(app, b.u.email, b.u.password)
      expectError(await api(app, 'POST', '/api/auth/2fa/verify', { cookie: cookieFrom(lb)!, body: { code: a.codes[0] }, ip: freshIp() }), 401, 'credenciais_invalidas')
      // o da própria pessoa entra uma vez
      const la = await login(app, a.u.email, a.u.password)
      const ok = await api(app, 'POST', '/api/auth/2fa/verify', { cookie: cookieFrom(la)!, body: { code: a.codes[0].toLowerCase() }, ip: freshIp() })
      expect(ok.statusCode, ok.body).toBe(200)
      const la2 = await login(app, a.u.email, a.u.password)
      const reused = await api(app, 'POST', '/api/auth/2fa/verify', { cookie: cookieFrom(la2)!, body: { code: a.codes[0] }, ip: freshIp() })
      expectError(reused, 401, 'credenciais_invalidas')
      // r1: código de recuperação usado mostrava a mensagem do aplicativo autenticador
      expect(reused.json().error.message).toMatch(/Código de recuperação inválido ou já usado/)
      expect(reused.json().error.details).toEqual({ kind: 'recuperacao' })
      const app6 = await api(app, 'POST', '/api/auth/2fa/verify', { cookie: cookieFrom(la2)!, body: { code: '000000' }, ip: freshIp() })
      expect(app6.json().error.message).toMatch(/aplicativo autenticador/)
    })

    it('hash vazado no formato antigo (sha256 de 40 bits) não vira segundo fator', async () => {
      const u = await createUser(app, { roleId: 'suporte', totp: true })
      const legacy = 'ABCDE-12345'
      await app.db.query('update users set recovery_codes = $2 where id = $1', [u.id, [sha256(legacy)]])
      const l = await login(app, u.email, u.password)
      expect(l.json().stage).toBe('2fa')
      expectError(await api(app, 'POST', '/api/auth/2fa/verify', { cookie: cookieFrom(l)!, body: { code: legacy }, ip: freshIp() }), 401, 'credenciais_invalidas')
      // nem o próprio texto do hash de um código novo serve (é preciso o código, não o hash)
      const code = generateRecoveryCodes(1)[0]
      const stored = hashRecoveryCode(TEST_ENV.APP_SECRET, u.id, code)
      await app.db.query('update users set recovery_codes = $2 where id = $1', [u.id, [stored]])
      expectError(await api(app, 'POST', '/api/auth/2fa/verify', { cookie: cookieFrom(l)!, body: { code: stored.slice(3, 23) }, ip: freshIp() }), 401, 'credenciais_invalidas')
      const ok = await api(app, 'POST', '/api/auth/2fa/verify', { cookie: cookieFrom(l)!, body: { code }, ip: freshIp() })
      expect(ok.statusCode, ok.body).toBe(200)
    })
  })

  // ------------------------------------------------------------ r1-authn-6 / r1-authz-5 / r1-logic-6
  describe('exigência de 2FA vale na hora para sessões já abertas (r1-authn-6, r1-authz-5, r1-logic-6)', () => {
    let admin: string
    beforeAll(async () => {
      admin = await adminSession(app)
    })

    const gone = async (cookie: string, protectedUrl = '/api/kv/operacao.saques') => {
      expectError(await api(app, 'GET', '/api/auth/me', { cookie }), 401, 'nao_autenticado')
      expect((await api(app, 'GET', protectedUrl, { cookie })).statusCode).toBe(401)
    }

    it('troca para cargo que exige 2FA: a sessão sem 2FA cai; o próximo login vai para o cadastro', async () => {
      const v = await createUser(app, { roleId: 'suporte' })
      const s = await login(app, v.email, v.password)
      expect(s.json().stage).toBe('active')
      const cookie = cookieFrom(s)!
      expect((await api(app, 'GET', '/api/kv/campanhas.free-spins', { cookie })).statusCode).not.toBe(401)
      const ch = await api(app, 'POST', `/api/team/${v.id}/role`, { cookie: admin, body: { roleId: 'marketing-oficial' } })
      expect(ch.statusCode, ch.body).toBe(200)
      await gone(cookie, '/api/kv/campanhas.free-spins')
      expect((await login(app, v.email, v.password)).json().stage).toBe('enroll')
    })

    it('promoção a cargo administrativo que exige 2FA: o cookie antigo não cria acessos', async () => {
      const v = await createUser(app, { roleId: 'suporte' })
      const cookie = await sessionCookie(app, v.id, 'active')
      await setRequire2fa(app, admin, 'administrador', true)
      const promo = await api(app, 'POST', `/api/team/${v.id}/role`, { cookie: admin, body: { roleId: 'administrador' } })
      expect(promo.statusCode, promo.body).toBe(200)
      const direct = await api(app, 'POST', '/api/team/direct', {
        cookie,
        body: { name: 'Conta Pelo Cookie', email: `cookie-${Date.now()}@teste.x2win`, roleId: 'suporte' },
      })
      expectError(direct, 401, 'nao_autenticado')
      await gone(cookie, '/api/kv/config.gateways')
    })

    it('"Exigir 2FA" ligado no cargo: as sessões sem 2FA desse cargo caem, quem tem 2FA segue', async () => {
      const semFator = await createUser(app, { roleId: 'financeiro' })
      const comFator = await createUser(app, { roleId: 'financeiro', totp: true })
      const outroCargo = await createUser(app, { roleId: 'suporte' })
      const c1 = cookieFrom(await login(app, semFator.email, semFator.password))!
      const c2 = await sessionCookie(app, comFator.id, 'active')
      const c3 = await sessionCookie(app, outroCargo.id, 'active')
      expect((await api(app, 'GET', '/api/kv/operacao.saques', { cookie: c1 })).statusCode).toBe(200)
      await setRequire2fa(app, admin, 'financeiro', true)
      try {
        await gone(c1)
        expect((await api(app, 'GET', '/api/kv/operacao.saques', { cookie: c2 })).statusCode).toBe(200)
        expect((await api(app, 'GET', '/api/auth/me', { cookie: c3 })).json().stage).toBe('active')
        expect((await login(app, semFator.email, semFator.password)).json().stage).toBe('enroll')
      } finally {
        await setRequire2fa(app, admin, 'financeiro', false)
      }
    })

    it('"2FA para todos": as sessões sem 2FA caem na hora (inclusive a de quem ligou, se não tiver 2FA)', async () => {
      const fin = await createUser(app, { roleId: 'financeiro' })
      const c = cookieFrom(await login(app, fin.email, fin.password))!
      expect((await api(app, 'GET', '/api/kv/operacao.saques', { cookie: c })).statusCode).toBe(200)
      await setEnforceAll(app, admin, true)
      try {
        await gone(c)
        const fresh = await createUser(app, { roleId: 'suporte' })
        expect((await login(app, fresh.email, fresh.password)).json().stage).toBe('enroll')
        // quem tem 2FA segue
        expect((await api(app, 'GET', '/api/auth/me', { cookie: admin })).json().stage).toBe('active')
      } finally {
        await setEnforceAll(app, admin, false)
      }
    })
  })

  // ------------------------------------------------------------ r1-authz-10 / r1-authn-6
  describe('cadastro do 2FA numa sessão ativa exige a senha atual (r1-authz-10, r1-authn-6)', () => {
    it('só com o cookie roubado não dá para ligar o autenticador do atacante nem levar os códigos', async () => {
      const victim = await createUser(app, { roleId: 'suporte', password: 'SenhaDaVitima2026' })
      const stolen = await sessionCookie(app, victim.id, 'active', '10.0.0.5')
      const setup = (body?: unknown) => api(app, 'POST', '/api/auth/2fa/setup', { cookie: stolen, body, ip: freshIp() })

      expectError(await setup(), 400, 'dados_invalidos')
      expectError(await setup({}), 400, 'dados_invalidos')
      expectError(await api(app, 'POST', '/api/auth/2fa/enable', { cookie: stolen, body: { code: '123456' }, ip: freshIp() }), 400, 'dados_invalidos')
      const statuses: number[] = []
      for (let i = 0; i < 6; i++) statuses.push((await setup({ currentPassword: `Chute${i}Errado99` })).statusCode)
      // 4 erros, o 5º bloqueia e derruba a sessão roubada
      expect(statuses).toEqual([401, 401, 401, 401, 423, 401])
      const row = await userRow(app, victim.id)
      expect(row.totp_enabled).toBe(false)
      expect(row.totp_pending_enc).toBeNull()
      expect(row.locked_until).not.toBeNull()
      expect(await auditActions(app, victim.id, 'ligar')).toHaveLength(0)
      // a vítima entra (depois do prazo) sem 2FA de ninguém
      await app.db.query(`update users set locked_until = now() - interval '1 second' where id = $1`, [victim.id])
      expect((await login(app, victim.email, victim.password)).json().stage).toBe('active')
    })

    it('com a senha atual: liga, devolve os códigos e encerra as outras sessões', async () => {
      const u = await createUser(app, { roleId: 'suporte' })
      const cookie = cookieFrom(await login(app, u.email, u.password))!
      const other = await sessionCookie(app, u.id, 'active')
      const pending = await sessionCookie(app, u.id, '2fa')
      const setup = await api(app, 'POST', '/api/auth/2fa/setup', { cookie, body: { currentPassword: u.password }, ip: freshIp() })
      expect(setup.statusCode, setup.body).toBe(200)
      const en = await api(app, 'POST', '/api/auth/2fa/enable', { cookie, body: { code: totpCode(setup.json().secret, Date.now()) }, ip: freshIp() })
      expect(en.statusCode, en.body).toBe(200)
      expect(en.json().stage).toBe('active')
      expect(en.json().recoveryCodes).toHaveLength(8)
      expect((await api(app, 'GET', '/api/auth/me', { cookie })).json().stage).toBe('active')
      expectError(await api(app, 'GET', '/api/auth/me', { cookie: other }), 401, 'nao_autenticado')
      expectError(await api(app, 'GET', '/api/auth/me', { cookie: pending }), 401, 'nao_autenticado')
      const ligar = await auditActions(app, u.id, 'ligar')
      expect(ligar).toHaveLength(1)
      expect(ligar[0].summary).toContain('2 outras sessões encerradas')
    })

    it('na etapa enroll (senha acabou de ser digitada) o cadastro segue sem pedir a senha de novo', async () => {
      const u = await createUser(app, { roleId: 'marketing-oficial' })
      const l = await login(app, u.email, u.password)
      expect(l.json().stage).toBe('enroll')
      const cookie = cookieFrom(l)!
      const setup = await api(app, 'POST', '/api/auth/2fa/setup', { cookie, ip: freshIp() })
      expect(setup.statusCode, setup.body).toBe(200)
    })

    it('código errado no /2fa/enable conta para o bloqueio (não dá para adivinhar o código pendente)', async () => {
      const u = await createUser(app, { roleId: 'marketing-oficial' })
      const cookie = cookieFrom(await login(app, u.email, u.password))!
      const setup = await api(app, 'POST', '/api/auth/2fa/setup', { cookie, ip: freshIp() })
      const secret = setup.json().secret as string
      const st: number[] = []
      for (let i = 0; i < 6; i++) st.push((await api(app, 'POST', '/api/auth/2fa/enable', { cookie, body: { code: wrongCode(secret) }, ip: freshIp() })).statusCode)
      expect(st).toEqual([401, 401, 401, 401, 423, 423])
      expectError(await api(app, 'POST', '/api/auth/2fa/enable', { cookie, body: { code: totpCode(secret, Date.now()) }, ip: freshIp() }), 423, 'conta_bloqueada')
      expect((await userRow(app, u.id)).totp_enabled).toBe(false)
    })
  })
})
