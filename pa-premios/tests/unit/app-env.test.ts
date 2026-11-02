import { describe, expect, it } from "vitest";
import { effectiveTurnstileEnabled, showStagingBanner } from "@/domain/app-env";

describe("effectiveTurnstileEnabled (Q4)", () => {
  it("sem escolha do admin: ligado só em production", () => {
    expect(effectiveTurnstileEnabled("production", null)).toBe(true);
    expect(effectiveTurnstileEnabled("staging", null)).toBe(false);
    expect(effectiveTurnstileEnabled("development", null)).toBe(false);
  });

  it("a escolha explícita do admin prevalece", () => {
    expect(effectiveTurnstileEnabled("production", false)).toBe(false);
    expect(effectiveTurnstileEnabled("staging", true)).toBe(true);
  });
});

describe("showStagingBanner", () => {
  it("aparece só em staging", () => {
    expect(showStagingBanner("staging")).toBe(true);
    expect(showStagingBanner("development")).toBe(false);
    expect(showStagingBanner("production")).toBe(false);
  });
});
