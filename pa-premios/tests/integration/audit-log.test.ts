import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDirectUrl, testPooledUrl } from "./env";

/** SPEC 12.13 e 15: audit log append-only, sem bypass por SQL da aplicação. */
describe("audit_log append-only", () => {
  const app = new PrismaClient({ datasourceUrl: testPooledUrl() }); // role pa_app
  const owner = new PrismaClient({ datasourceUrl: testDirectUrl() }); // dono do schema
  let id: bigint;

  beforeAll(async () => {
    const row = await app.auditLog.create({
      data: { actorType: "SYSTEM", action: "test.insert", entityType: "test", entityId: "1" },
    });
    id = row.id;
  });

  afterAll(async () => {
    await Promise.all([app.$disconnect(), owner.$disconnect()]);
  });

  it("a aplicação consegue inserir e ler", async () => {
    expect(await app.auditLog.findUnique({ where: { id } })).not.toBeNull();
  });

  it("a aplicação não consegue alterar nem apagar", async () => {
    await expect(app.auditLog.update({ where: { id }, data: { action: "x" } })).rejects.toThrow();
    await expect(app.auditLog.delete({ where: { id } })).rejects.toThrow();
    await expect(app.$executeRawUnsafe(`TRUNCATE audit_log`)).rejects.toThrow();
  });

  it("a aplicação não consegue desabilitar o trigger", async () => {
    await expect(app.$executeRawUnsafe(`ALTER TABLE audit_log DISABLE TRIGGER ALL`)).rejects.toThrow(
      /owner|dono|permission|must be/i,
    );
  });

  it("nem o dono do schema altera ou apaga (trigger)", async () => {
    await expect(owner.$executeRaw`UPDATE audit_log SET action = 'x' WHERE id = ${id}`).rejects.toThrow(
      /append-only/,
    );
    await expect(owner.$executeRaw`DELETE FROM audit_log WHERE id = ${id}`).rejects.toThrow(/append-only/);
    await expect(owner.$executeRawUnsafe(`TRUNCATE audit_log`)).rejects.toThrow(/append-only/);
  });
});
