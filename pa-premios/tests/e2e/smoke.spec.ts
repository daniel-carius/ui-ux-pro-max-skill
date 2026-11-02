import { expect, test } from "@playwright/test";

test.describe("F0 smoke (mobile 390x844)", () => {
  test("home carrega a marca de settings e o rodapé legal", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
    await expect(page.getByRole("contentinfo")).toContainText(
      "Proibido para menores de 18 anos. Participe com responsabilidade.",
    );
  });

  test("sem rolagem horizontal no mobile", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("health check responde ok", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", database: "ok", cache: "ok" });
  });
});
