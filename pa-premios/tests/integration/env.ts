import { inject } from "vitest";

/** Conexão da aplicação: pooler em modo transação, role pa_app (banco descartável da execução). */
export const testPooledUrl = () => inject("testDb").pooled;
/** Conexão direta como dono do schema (fixtures). */
export const testDirectUrl = () => inject("testDb").direct;
/** Banco onde o pg_cron está instalado (cron.database_name). */
export function pgCronDirectUrl(): string {
  const value = process.env.PG_CRON_DIRECT_URL;
  if (!value) throw new Error("Teste de integração exige PG_CRON_DIRECT_URL (ver .env.example)");
  return value;
}
