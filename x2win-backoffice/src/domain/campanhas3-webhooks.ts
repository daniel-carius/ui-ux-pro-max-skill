// Estatísticas de webhooks: agregações puras sobre as execuções.
import { dayKey } from '@/data/now'
import type { WebhookEvent, WebhookExecution } from './webhooks'

export interface WebhookStats {
  total: number
  success: number
  failures: number
  /** fração 0..1 (null sem execuções) */
  successRate: number | null
  avgMs: number
  p95Ms: number
  byDay: { date: string; sucesso: number; falha: number }[]
  byEvent: { event: WebhookEvent; total: number; success: number; failures: number; avgMs: number; lastAt: string | null }[]
}

export function webhookStats(execs: WebhookExecution[], days: string[]): WebhookStats {
  const total = execs.length
  const success = execs.filter((e) => e.status === 'sucesso').length
  const durations = execs.map((e) => e.durationMs).sort((a, b) => a - b)
  const avgMs = total ? Math.round(durations.reduce((s, d) => s + d, 0) / total) : 0
  const p95Ms = total ? durations[Math.min(total - 1, Math.floor(total * 0.95))] : 0
  const dayMap = new Map(days.map((d) => [d, { date: d, sucesso: 0, falha: 0 }]))
  const evMap = new Map<WebhookEvent, { event: WebhookEvent; total: number; success: number; failures: number; sumMs: number; lastAt: string | null }>()
  for (const e of execs) {
    const k = dayKey(new Date(e.at))
    const row = dayMap.get(k)
    if (row) {
      if (e.status === 'sucesso') row.sucesso++
      else row.falha++
    }
    const ev = evMap.get(e.event) ?? { event: e.event, total: 0, success: 0, failures: 0, sumMs: 0, lastAt: null }
    ev.total++
    if (e.status === 'sucesso') ev.success++
    else ev.failures++
    ev.sumMs += e.durationMs
    if (!ev.lastAt || e.at > ev.lastAt) ev.lastAt = e.at
    evMap.set(e.event, ev)
  }
  return {
    total,
    success,
    failures: total - success,
    successRate: total ? success / total : null,
    avgMs,
    p95Ms,
    byDay: [...dayMap.values()],
    byEvent: [...evMap.values()]
      .map(({ sumMs, ...r }) => ({ ...r, avgMs: r.total ? Math.round(sumMs / r.total) : 0 }))
      .sort((a, b) => b.total - a.total),
  }
}

/** Lista de chaves AAAA-MM-DD entre duas datas (inclusive). */
export function daysBetween(from: Date, to: Date): string[] {
  const out: string[] = []
  const d = new Date(from)
  d.setHours(12, 0, 0, 0)
  const end = new Date(to)
  end.setHours(12, 0, 0, 0)
  while (d.getTime() <= end.getTime()) {
    out.push(dayKey(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** Trecho do caminho com cara de token (letras e números, 10+ caracteres). */
function looksLikeToken(seg: string) {
  return seg.length >= 10 && /[a-z]/i.test(seg) && /\d/.test(seg)
}

export function hasTokenLikeSegment(url: string) {
  try {
    return new URL(url).pathname.split('/').some(looksLikeToken)
  } catch {
    return false
  }
}

/** Mascara segmentos com cara de token no caminho da URL (achado de auditoria nº 7). */
export function maskTokenUrl(url: string) {
  try {
    const u = new URL(url)
    const path = u.pathname
      .split('/')
      .map((s) => (looksLikeToken(s) ? `${s.slice(0, 4)}••••` : s))
      .join('/')
    return `${u.host}${path}`
  } catch {
    return url
  }
}

export function prettyJson(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

/** Faixa de tempo de resposta. */
export function latencyTone(ms: number): 'success' | 'warning' | 'danger' {
  if (ms < 800) return 'success'
  if (ms < 2000) return 'warning'
  return 'danger'
}

const PRESET_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }

/**
 * Atalhos "7/30/90 dias" como janela móvel (N × 24 h até agora), igual à
 * contagem do serviço de webhooks ("134 execuções nos últimos 30 dias").
 */
export function rollingRange<R extends { from: Date; to: Date; preset: string }>(r: R, now: number = Date.now()): R {
  const days = PRESET_DAYS[r.preset]
  if (!days) return r
  return { ...r, from: new Date(now - days * 86_400_000) }
}
