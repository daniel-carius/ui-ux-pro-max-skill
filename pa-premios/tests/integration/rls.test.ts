import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { testDirectUrl, testPooledUrl } from "./env";

/** D-27: RLS habilitado em todas as tabelas de public; só pa_app tem policies. */
describe("RLS (defesa em profundidade da Data API)", () => {
  const owner = new PrismaClient({ datasourceUrl: testDirectUrl() });
  const app = new PrismaClient({ datasourceUrl: testPooledUrl() });
  afterAll(() => Promise.all([owner.$disconnect(), app.$disconnect()]));

  it("toda tabela do schema public tem RLS habilitado", async () => {
    const rows = await owner.$queryRaw<{ table: string }[]>`
      SELECT c.relname AS table
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity`;
    expect(rows.map((r) => r.table)).toEqual([]);
  });

  it("um role sem policy lê vazio mesmo se receber GRANT por engano", async () => {
    await owner.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_probe') THEN CREATE ROLE rls_probe NOLOGIN; END IF;
    END $$`);
    await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO rls_probe`);
    await owner.$executeRawUnsafe(`GRANT SELECT ON settings, audit_log TO rls_probe`);
    await owner.$executeRawUnsafe(`INSERT INTO settings (id, brand_name, primary_color, secondary_color,
        support_whatsapp, support_message, anti_scam_text, updated_at)
      VALUES (1, 'x', '#000', '#fff', '0', 'm', 't', now()) ON CONFLICT (id) DO NOTHING`);

    const counts = await owner.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE rls_probe`);
      return tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM settings`);
    });
    expect(Number(counts[0]?.n)).toBe(0);

    await owner.$executeRawUnsafe(`REVOKE ALL ON settings, audit_log FROM rls_probe`);
    await owner.$executeRawUnsafe(`REVOKE USAGE ON SCHEMA public FROM rls_probe`);
  });

  it("a aplicação (pa_app) continua lendo e escrevendo pelas policies", async () => {
    const settings = await app.settings.findUnique({ where: { id: 1 } });
    expect(settings).not.toBeNull();
    await app.auditLog.create({
      data: { actorType: "SYSTEM", action: "rls.check", entityType: "test", entityId: "1" },
    });
  });
});
