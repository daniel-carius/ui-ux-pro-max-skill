// Âncora de tempo dos dados de demonstração: tudo é gerado em relação a "agora",
// então o painel parece vivo em qualquer dia em que for aberto.
export const NOW = new Date()
export const DAY = 86_400_000
export const HOUR = 3_600_000
export const MIN = 60_000

export function daysAgo(n: number, base: Date = NOW) {
  return new Date(base.getTime() - n * DAY)
}

export function iso(d: Date) {
  return d.toISOString()
}

export function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function endOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}

/** chave "AAAA-MM-DD" no fuso local */
export function dayKey(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
