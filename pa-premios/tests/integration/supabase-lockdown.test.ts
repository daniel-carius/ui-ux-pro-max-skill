import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { testDirectUrl } from "./env";

/**
 * Simula os roles da Data API do Supabase (anon/authenticated) e confirma que, após a
 * migration de lockdown, eles não leem nenhuma tabela do schema public.
 */
describe("lockdown da Data API do Supabase", () => {
  const owner = new PrismaClient({ datasourceUrl: testDirectUrl() });
  afterAll(() => owner.$disconnect());

  it("anon não lê settings nem audit_log", async () => {
    await owner.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    END $$`);
    // Reaplica a lógica da migration (o role não existia quando ela rodou neste banco).
    const sql = await import("node:fs").then((fs) =>
      fs.readFileSync("prisma/migrations/20261102000300_supabase_api_lockdown/migration.sql", "utf8"),
    );
    await owner.$executeRawUnsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon`); // pior caso
    await owner.$executeRawUnsafe(sql);

    for (const table of ["settings", "audit_log"]) {
      await expect(
        owner.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL ROLE anon`);
          return tx.$queryRawUnsafe(`SELECT * FROM ${table} LIMIT 1`);
        }),
      ).rejects.toThrow(/permission denied/);
    }
  });
});
