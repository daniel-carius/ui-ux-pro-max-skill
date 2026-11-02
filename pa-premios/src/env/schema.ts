import { z } from "zod";

export const APP_ENVS = ["development", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const postgresUrl = z.string().regex(/^postgres(ql)?:\/\//, "deve ser uma URL postgres:// ou postgresql://");

export const serverEnvSchema = z
  .object({
    APP_ENV: z.enum(APP_ENVS),
    APP_URL: z.url(),
    DATABASE_URL: postgresUrl,
    DIRECT_URL: postgresUrl,
    UPSTASH_REDIS_REST_URL: z.url(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
    CRON_SECRET: z.string().min(32, "CRON_SECRET precisa de 32+ caracteres"),
  })
  .superRefine((env, ctx) => {
    // O pooler em modo transação não suporta prepared statements nomeados.
    if (!/[?&]pgbouncer=true(&|$)/.test(env.DATABASE_URL)) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "DATABASE_URL deve apontar para o pooler e conter pgbouncer=true",
      });
    }
    if (env.APP_ENV === "production" && !env.APP_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "APP_URL deve usar https em production" });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return result.data;
}
