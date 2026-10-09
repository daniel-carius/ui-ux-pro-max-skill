// Regras de Configurações › Domínios (somente leitura).
// Compra e ligação de domínio novo são feitas pelo Superadmin da plataforma.

export type HostLevel = 'ok' | 'lento' | 'fora'

export const SLOW_MS = 300

export function hostLevel(r: { dnsOk: boolean; httpStatus: number; latencyMs: number }): HostLevel {
  if (!r.dnsOk || r.httpStatus >= 500 || r.httpStatus === 0) return 'fora'
  return r.latencyMs >= SLOW_MS ? 'lento' : 'ok'
}

export function daysLeft(untilISO: string, now: Date = new Date()) {
  return Math.ceil((new Date(untilISO).getTime() - now.getTime()) / 86_400_000)
}

/** Situação do certificado: renova sozinho quando faltam N dias. */
export function sslState(validUntil: string, autoRenewDaysBefore: number, now: Date = new Date()) {
  const d = daysLeft(validUntil, now)
  if (d < 0) return { tone: 'danger' as const, label: 'Expirado', days: d }
  if (d <= 7) return { tone: 'danger' as const, label: `Expira em ${d} dias`, days: d }
  if (d <= autoRenewDaysBefore) return { tone: 'warning' as const, label: 'Renovação automática em andamento', days: d }
  return { tone: 'success' as const, label: 'Válido', days: d }
}
