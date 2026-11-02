import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/env/schema";

const valid = {
  APP_ENV: "development",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://pa_app:x@localhost:6432/db?pgbouncer=true&connection_limit=10",
  DIRECT_URL: "postgresql://postgres:x@localhost:5432/db",
  UPSTASH_REDIS_REST_URL: "http://localhost:8079",
  UPSTASH_REDIS_REST_TOKEN: "t",
  CRON_SECRET: "x".repeat(32),
};

describe("parseServerEnv", () => {
  it("aceita um ambiente válido", () => {
    expect(parseServerEnv(valid).APP_ENV).toBe("development");
  });

  it("rejeita APP_ENV desconhecido", () => {
    expect(() => parseServerEnv({ ...valid, APP_ENV: "prod" })).toThrow(/APP_ENV/);
  });

  it("exige pgbouncer=true na DATABASE_URL (pooler em modo transação)", () => {
    expect(() => parseServerEnv({ ...valid, DATABASE_URL: "postgresql://u:p@h:6543/db" })).toThrow(
      /pgbouncer=true/,
    );
  });

  it("exige https em production", () => {
    expect(() => parseServerEnv({ ...valid, APP_ENV: "production" })).toThrow(/https/);
    expect(parseServerEnv({ ...valid, APP_ENV: "production", APP_URL: "https://x.com.br" }).APP_ENV).toBe(
      "production",
    );
  });

  it("exige CRON_SECRET com 32+ caracteres", () => {
    expect(() => parseServerEnv({ ...valid, CRON_SECRET: "curto" })).toThrow(/CRON_SECRET/);
  });

  it("falha listando todas as variáveis ausentes", () => {
    expect(() => parseServerEnv({})).toThrow(/DATABASE_URL[\s\S]*DIRECT_URL/);
  });
});
