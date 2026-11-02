import type { AppEnv } from "@/env/schema";

/**
 * Turnstile (Q4): ligado por padrão em production (reserva e "Meus números"),
 * desligado por padrão em dev/staging. Uma escolha explícita do admin prevalece.
 */
export function effectiveTurnstileEnabled(appEnv: AppEnv, setting: boolean | null): boolean {
  return setting ?? appEnv === "production";
}

export function showStagingBanner(appEnv: AppEnv): boolean {
  return appEnv === "staging";
}
