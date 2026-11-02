import { describe, expect, it } from "vitest";
import { effectiveGeoEnforcement, showStagingBanner } from "@/domain/app-env";

describe("effectiveGeoEnforcement (SPEC 3 / 13A)", () => {
  it("é sempre ligado em production, mesmo com a setting desligada", () => {
    expect(effectiveGeoEnforcement("production", false)).toBe(true);
  });

  it("respeita a setting fora de production", () => {
    expect(effectiveGeoEnforcement("staging", false)).toBe(false);
    expect(effectiveGeoEnforcement("development", true)).toBe(true);
  });
});

describe("showStagingBanner", () => {
  it("aparece só em staging", () => {
    expect(showStagingBanner("staging")).toBe(true);
    expect(showStagingBanner("development")).toBe(false);
    expect(showStagingBanner("production")).toBe(false);
  });
});
