// Auditoria: conversão para AuditEntry (shared/audit.ts), filtros de consulta e CSV.
import { z } from 'zod'
import { AUDIT_ACTION_LABEL, AUDIT_SOURCE_LABEL, isAuditAction, SYSTEM_ACTOR_FILTER, type AuditAction, type AuditEntry } from '@shared/audit'

export interface AuditRow {
  id: number | string
  at: string
  actor_id: string | null
  actor_name: string
  action: string
  entity: string
  summary: string
  ip: string | null
  source: 'servidor' | 'painel'
  /** e-mail atual de quem fez (users), na exportação */
  actor_email?: string | null
}

export function toAuditEntry(r: AuditRow): AuditEntry {
  return {
    id: String(r.id),
    at: r.at,
    actorId: r.actor_id ?? '',
    actorName: r.actor_name,
    action: r.action as AuditAction,
    entity: r.entity,
    summary: r.summary,
    ip: r.ip ?? '',
    source: r.source,
  }
}

// ---------- filtros (?from&to&actorId&action) ----------

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?)?$/

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)

const dateParam = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .regex(ISO_DATE, 'Data inválida. Use AAAA-MM-DD ou data e hora ISO.')
    .refine((v) => !Number.isNaN(Date.parse(DATE_ONLY.test(v) ? `${v}T00:00:00Z` : v)), 'Data inválida.')
    .optional(),
)

export const auditFilterSchema = z.object({
  from: dateParam,
  to: dateParam,
  actorId: z.preprocess(blankToUndefined, z.string().trim().max(100).optional()),
  action: z.preprocess(
    blankToUndefined,
    z
      .string()
      .refine((v) => isAuditAction(v), 'Ação desconhecida.')
      .optional(),
  ),
})

export const auditListSchema = auditFilterSchema.extend({
  page: z.preprocess(blankToUndefined, z.coerce.number().int().min(1, 'Página inválida.').max(1_000_000).default(1)),
  pageSize: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1, 'Tamanho de página inválido.').max(200, 'Tamanho de página máximo: 200.').default(50),
  ),
})

export type AuditFilter = z.infer<typeof auditFilterSchema>

/**
 * WHERE parametrizado. `from`/`to` aceitam data (AAAA-MM-DD, dia inteiro em UTC:
 * `to` inclui o dia todo) ou data e hora ISO.
 */
export function buildAuditWhere(f: AuditFilter): { where: string; params: unknown[] } {
  const parts: string[] = []
  const params: unknown[] = []
  if (f.from) {
    params.push(new Date(DATE_ONLY.test(f.from) ? `${f.from}T00:00:00Z` : f.from).toISOString())
    parts.push(`at >= $${params.length}::timestamptz`)
  }
  if (f.to) {
    if (DATE_ONLY.test(f.to)) {
      const next = new Date(`${f.to}T00:00:00Z`)
      next.setUTCDate(next.getUTCDate() + 1)
      params.push(next.toISOString())
      parts.push(`at < $${params.length}::timestamptz`)
    } else {
      params.push(new Date(f.to).toISOString())
      parts.push(`at <= $${params.length}::timestamptz`)
    }
  }
  if (f.actorId === SYSTEM_ACTOR_FILTER) {
    // ações automáticas do servidor (sem pessoa)
    parts.push('actor_id is null')
  } else if (f.actorId) {
    params.push(f.actorId)
    parts.push(`actor_id = $${params.length}`)
  }
  if (f.action) {
    params.push(f.action)
    parts.push(`action = $${params.length}`)
  }
  return { where: parts.length ? `where ${parts.join(' and ')}` : '', params }
}

/** Descrição curta dos filtros, para o resumo da auditoria de exportação. */
/** Data do filtro como a pessoa lê: 11/09/2026 (dia inteiro) ou 11/09/2026 14:32, no horário de Brasília. */
function filterDate(v: string): string {
  if (DATE_ONLY.test(v)) {
    const [y, m, d] = v.split('-')
    return `${d}/${m}/${y}`
  }
  const dt = new Date(v)
  if (Number.isNaN(dt.getTime())) return v
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(dt)
    .replace(',', '')
}

/**
 * Descrição curta dos filtros, para o resumo da auditoria de exportação. `actorLabel` é "nome (e-mail)" de quem
 * foi filtrado (a rota busca na equipe); sem ele, o id. Antes saíam as datas ISO e o id interno da pessoa.
 */
export function describeFilter(f: AuditFilter, actorLabel?: string | null): string {
  const out: string[] = []
  if (f.from) out.push(`de ${filterDate(f.from)}`)
  if (f.to) out.push(`até ${filterDate(f.to)}`)
  if (f.actorId === SYSTEM_ACTOR_FILTER) out.push('pessoa: Sistema (ações automáticas)')
  else if (f.actorId) out.push(`pessoa: ${actorLabel || f.actorId}`)
  if (f.action) out.push(`ação: ${AUDIT_ACTION_LABEL[f.action as AuditAction]}`)
  return out.join(', ')
}

// ---------- CSV (padrão brasileiro: ';' e BOM) ----------

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

export function csvDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return dateFmt.format(d).replace(',', '')
}

/** Escapa a célula; neutraliza fórmulas (=, +, -, @) para a planilha não executá-las. */
export function csvCell(v: unknown): string {
  if (v == null) return ''
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export const CSV_HEADER = ['Data e hora', 'Quem fez', 'ID de quem fez', 'E-mail de quem fez', 'Ação', 'Entidade', 'Resumo', 'IP', 'Origem']

/** Linha da exportação: o nome sozinho pode repetir ou mudar; id e e-mail identificam a pessoa. */
export type AuditExportEntry = AuditEntry & { actorEmail: string }

export function toAuditExportEntry(r: AuditRow): AuditExportEntry {
  return { ...toAuditEntry(r), actorEmail: r.actor_email ?? '' }
}

export function auditCsv(entries: AuditExportEntry[]): string {
  const lines = [CSV_HEADER.map(csvCell).join(';')]
  for (const e of entries) {
    lines.push(
      // Origem: deixa explícito que o relatado pelo painel não foi verificado pelo servidor
      [
        csvDate(e.at),
        e.actorName,
        e.actorId,
        e.actorEmail,
        AUDIT_ACTION_LABEL[e.action] ?? e.action,
        e.entity,
        e.summary,
        e.ip,
        AUDIT_SOURCE_LABEL[e.source ?? 'servidor'],
      ]
        .map(csvCell)
        .join(';'),
    )
  }
  return `﻿${lines.join('\r\n')}\r\n`
}
