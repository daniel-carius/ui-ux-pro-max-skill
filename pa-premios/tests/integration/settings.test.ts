import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { testPooledUrl } from "./env";

describe("settings", () => {
  const app = new PrismaClient({ datasourceUrl: testPooledUrl() });
  afterAll(() => app.$disconnect());

  const base = {
    brandName: "Marca",
    primaryColor: "#000000",
    secondaryColor: "#ffffff",
    supportWhatsapp: "550000000000",
    supportMessage: "msg",
    antiScamText: "texto",
  };

  it("aceita somente uma linha (id = 1)", async () => {
    await app.settings.upsert({ where: { id: 1 }, create: { id: 1, ...base }, update: {} });
    await expect(app.settings.create({ data: { id: 2, ...base } })).rejects.toThrow();
  });

  it("usa os defaults conservadores da SPEC", async () => {
    const s = await app.settings.findUniqueOrThrow({ where: { id: 1 } });
    expect(s.showAuthorizationBadge).toBe(false);
    expect(s.authorizationScope).toBe("NATIONAL");
    expect(s.turnstileEnabled).toBeNull();
    expect(s.antiScamEnabled).toBe(true);
    expect(s.timezone).toBe("America/Fortaleza");
  });
});
