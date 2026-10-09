// Kit de testes: app com banco em memória, criação de pessoas e sessões, chamadas.
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { buildApp } from '../src/app'
import { ensureRoles } from '../src/bootstrap'
import { loadConfig, SECURITY, type Config } from '../src/config'
import { hashPassword, newId } from '../src/lib/crypto'
import { newTotpSecret } from '../src/lib/totp'
import { createSession } from '../src/services/sessions'
import type { SessionStage } from '../src/types'

export const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'memory://',
  APP_SECRET: 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres',
  ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  WEBHOOK_DISPATCHER: 'off',
  CORS_ORIGIN: '',
}

export async function createTestApp(env: Partial<Record<string, string>> = {}): Promise<FastifyInstance> {
  const config: Config = loadConfig({ ...TEST_ENV, ...env })
  const app = await buildApp({ config })
  await ensureRoles(app)
  return app
}

export interface TestUser {
  id: string
  email: string
  password: string
  totpSecret: string | null
}

/** Cria uma pessoa na equipe direto no banco. */
export async function createUser(
  app: FastifyInstance,
  opts: { roleId?: string; name?: string; email?: string; password?: string; totp?: boolean; status?: 'ativo' | 'desligado' | 'convidado'; mustChangePassword?: boolean } = {},
): Promise<TestUser> {
  const id = newId('u')
  const email = (opts.email ?? `${id}@teste.x2win`).toLowerCase()
  const password = opts.password ?? 'SenhaForte123'
  const totpSecret = opts.totp ? newTotpSecret() : null
  await app.db.query(
    `insert into users (id, name, email, role_id, status, password_hash, totp_secret_enc, totp_enabled, must_change_password)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      opts.name ?? 'Pessoa Teste',
      email,
      opts.roleId ?? 'superadmin',
      opts.status ?? 'ativo',
      await hashPassword(password),
      totpSecret ? app.cipher.encrypt(totpSecret) : null,
      !!totpSecret,
      opts.mustChangePassword ?? false,
    ],
  )
  return { id, email, password, totpSecret }
}

/** Abre uma sessão direto no banco e devolve o cabeçalho Cookie. */
export async function sessionCookie(app: FastifyInstance, userId: string, stage: SessionStage = 'active', ip = '127.0.0.1') {
  const { token } = await createSession(app.db, userId, stage, { ip })
  return `${SECURITY.sessionCookie}=${token}`
}

/** Pessoa + sessão ativa num passo. */
export async function loginAs(app: FastifyInstance, roleId = 'superadmin', extra: Parameters<typeof createUser>[1] = {}) {
  const user = await createUser(app, { roleId, ...extra })
  return { user, cookie: await sessionCookie(app, user.id) }
}

/** Chamada à API com o cabeçalho de segurança do painel. */
export function api(
  app: FastifyInstance,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  opts: { cookie?: string; body?: unknown; csrf?: boolean; ip?: string; headers?: Record<string, string> } = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    remoteAddress: opts.ip ?? '127.0.0.1',
    headers: {
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.csrf === false ? {} : { [SECURITY.csrfHeader]: SECURITY.csrfValue }),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.headers ?? {}),
    },
    payload: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
}

/** Lê o cookie de sessão definido numa resposta (para seguir o fluxo de login). */
export function cookieFrom(res: LightMyRequestResponse): string | null {
  const c = res.cookies.find((k) => k.name === SECURITY.sessionCookie)
  return c && c.value ? `${c.name}=${c.value}` : null
}
