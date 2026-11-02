import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgCronDirectUrl, testDirectUrl } from "./env";

/**
 * SPEC 2 e 17 (F0): pg_cron habilitado. Prova que o agendador executa jobs no banco de testes
 * via cron.schedule_in_database (o mesmo mecanismo que a geração do pool usará na F1).
 */
describe("pg_cron", () => {
  const cron = new PrismaClient({ datasourceUrl: pgCronDirectUrl() });
  const testDb = new PrismaClient({ datasourceUrl: testDirectUrl() });
  const jobName = `f0-smoke-${process.pid}`;
  let testDbName = "";

  beforeAll(async () => {
    const [row] = await testDb.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    testDbName = row!.db;
    await testDb.$executeRawUnsafe(`DROP TABLE IF EXISTS cron_probe`);
    await testDb.$executeRawUnsafe(`CREATE TABLE cron_probe (ran_at timestamptz NOT NULL DEFAULT now())`);
  });

  afterAll(async () => {
    await cron.$executeRaw`SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ${jobName}`;
    await testDb.$executeRawUnsafe(`DROP TABLE IF EXISTS cron_probe`);
    await Promise.all([cron.$disconnect(), testDb.$disconnect()]);
  });

  it("a extensão está instalada", async () => {
    const rows = await cron.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'pg_cron'`;
    expect(rows).toHaveLength(1);
  });

  it("executa um job agendado em outro banco do mesmo servidor", async () => {
    await cron.$queryRaw`
      SELECT cron.schedule_in_database(${jobName}, '1 seconds', 'INSERT INTO cron_probe DEFAULT VALUES', ${testDbName})`;

    const deadline = Date.now() + 15_000;
    let runs = 0;
    while (Date.now() < deadline && runs === 0) {
      await new Promise((r) => setTimeout(r, 500));
      const [row] = await testDb.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM cron_probe`;
      runs = Number(row?.n ?? 0);
    }
    expect(runs).toBeGreaterThan(0);
  });
});
