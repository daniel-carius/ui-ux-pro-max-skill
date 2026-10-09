// Exportação CSV no padrão brasileiro (separador ";" e BOM para o Excel abrir acentos).
// A formatação (e a neutralização de fórmulas) fica em csv-format.ts.
import { toCsv, type CsvColumn } from './csv-format'

export { csvCell, toCsv, type CsvColumn } from './csv-format'

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
