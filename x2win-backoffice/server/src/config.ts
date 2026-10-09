// Configuração lida do ambiente, validada na subida.
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('pglite://./data/pglite'),
  APP_SECRET: z.string().min(32, 'APP_SECRET precisa de pelo menos 32 caracteres'),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY precisa ter 32 bytes em base64 (openssl rand -base64 32)'),
  CORS_ORIGIN: z.string().default(''),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  ADMIN_NAME: z.string().default('Superadmin'),
  ADMIN_EMAIL: z.string().default(''),
  ADMIN_PASSWORD: z.string().default(''),
  DEMO_DATA: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** desliga o disparador de webhooks em segundo plano (testes) */
  WEBHOOK_DISPATCHER: z
    .enum(['on', 'off'])
    .default('on'),
})

export type Config = z.infer<typeof schema>

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Configuração inválida:\n${msg}`)
  }
  return parsed.data
}

/** Constantes de segurança (não configuráveis por ambiente). */
export const SECURITY = {
  sessionCookie: 'x2w_sid',
  /** sessão expira de qualquer jeito após este tempo */
  sessionAbsoluteHours: 12,
  /** etapas de login (2FA, troca de senha) expiram rápido */
  pendingStageMinutes: 10,
  maxFailedLogins: 5,
  lockMinutes: 15,
  passwordMinLength: 10,
  csrfHeader: 'x-requested-with',
  csrfValue: 'x2w',
} as const
