import type { AppEnv } from "@/env/schema";

/**
 * Geolocalização é sempre obrigatória em production (SPEC 3 e 13A),
 * independentemente do valor salvo em settings.
 */
export function effectiveGeoEnforcement(appEnv: AppEnv, settingValue: boolean): boolean {
  return appEnv === "production" ? true : settingValue;
}

export function showStagingBanner(appEnv: AppEnv): boolean {
  return appEnv === "staging";
}
