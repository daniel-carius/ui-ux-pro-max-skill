// Formatação CSV no padrão brasileiro (separador ";"), sem dependência do navegador:
// usada por src/lib/csv.ts (download) e testada no Node (server/test/front-security.test.ts).

export interface CsvColumn<T> {
  header: string
  value: (row: T) => string | number | null | undefined
}

/**
 * Começo de célula que o Excel/LibreOffice avaliam como fórmula (CSV/formula injection):
 * = + - @, tabulação e CR, inclusive as versões de largura total (＝ ＋ － ＠) e depois de espaços.
 */
const FORMULA_START = /^(?:[\t\r]|[\s 　]*[=+\-@＝＋－＠])/
/** número escrito como texto (ex.: "-10,50", "+5", "-3.5%"): não é fórmula, fica como está */
const PLAIN_NUMBER = /^[-+]?\d[\d.,]*%?$/

/**
 * Uma célula do CSV. Texto que começa como fórmula recebe um apóstrofo na
 * frente (vira texto na planilha), como o csvCell da auditoria no servidor.
 * Números (tipo number) nunca são alterados.
 */
export function csvCell(v: unknown): string {
  if (v == null) return ''
  let s: string
  if (typeof v === 'number') {
    // fração com duas casas (valores em reais: "827,10", não "827,1"; "189.496,67", não "189.496,666"); inteiro como está
    s = Number.isInteger(v) ? v.toLocaleString('pt-BR') : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  } else {
    s = String(v)
    if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`
  }
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** Valor em reais no CSV sempre com duas casas, também quando é inteiro ("-5,00"). */
export function csvMoney(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return ''
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => csvCell(c.header)).join(';')
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(';'))
  return [head, ...body].join('\r\n')
}
