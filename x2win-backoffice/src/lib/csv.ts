// Exportação CSV no padrão brasileiro (separador ";" e BOM para o Excel abrir acentos).

export interface CsvColumn<T> {
  header: string
  value: (row: T) => string | number | null | undefined
}

function escape(v: unknown): string {
  if (v == null) return ''
  const s = typeof v === 'number' ? v.toLocaleString('pt-BR') : String(v)
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => escape(c.header)).join(';')
  const body = rows.map((r) => columns.map((c) => escape(c.value(r))).join(';'))
  return [head, ...body].join('\r\n')
}

export function downloadFile(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]) {
  const stamp = new Date().toISOString().slice(0, 10)
  downloadFile(`${filename}-${stamp}.csv`, toCsv(rows, columns))
}
