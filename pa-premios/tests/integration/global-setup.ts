import { execSync } from "node:child_process";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

/**
 * Cada execução cria um banco DESCARTÁVEL e novo (pa_premios_it_<timestamp>), aplica as
 * migrations reais com `prisma migrate deploy` e o remove no final. Nada pré-existente é apagado.
 * TEST_DIRECT_URL e TEST_DATABASE_URL só fornecem servidor e credenciais; o nome do banco é trocado.
 */
function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Teste de integração exige ${name} (ver .env.example)`);
  return value;
}

export default async function setup(project: TestProject) {
  const baseDirect = required("TEST_DIRECT_URL");
  const basePooled = required("TEST_DATABASE_URL");
  const database = `pa_premios_it_${Date.now()}_${process.pid}`;

  const admin = new Client({ connectionString: withDatabase(baseDirect, "postgres") });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  await admin.end();

  const direct = withDatabase(baseDirect, database);
  execSync("pnpm exec prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: direct, DIRECT_URL: direct },
  });

  project.provide("testDb", { direct, pooled: withDatabase(basePooled, database) });

  return async () => {
    const cleanup = new Client({ connectionString: withDatabase(baseDirect, "postgres") });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await cleanup.end();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    testDb: { direct: string; pooled: string };
  }
}
