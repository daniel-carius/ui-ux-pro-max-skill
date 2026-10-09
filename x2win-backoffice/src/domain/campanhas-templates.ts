// Templates de webhook: um corpo JSON por tipo de evento, com variáveis {{campo}}.
// Validação, prévia e formatação são funções puras (o servidor deve repetir a validação).

export type TemplateCategory = 'Conta' | 'Depósito' | 'Saque' | 'Apostas' | 'Bônus' | 'Engajamento' | 'Segurança' | 'Jogo responsável'
export type FieldType = 'texto' | 'numero' | 'data' | 'booleano'

export interface TemplateField {
  key: string
  label: string
  type: FieldType
  sample: string | number | boolean
}

export interface TemplateEventDef {
  key: string
  label: string
  category: TemplateCategory
  description: string
  fields: TemplateField[]
}

export interface TemplateTest {
  at: string
  ok: boolean
  httpStatus: number
  durationMs: number
  /** quantos destinos receberam (0 = caixa de teste) */
  destinations: number
}

export interface WebhookTemplate {
  id: string
  event: string
  active: boolean
  body: string
  updatedAt: string
  updatedBy: string
  lastTest: TemplateTest | null
}

export interface VarHit {
  start: number
  end: number
  name: string
  inString: boolean
}

const VAR_RE = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/y

/** Acha as variáveis {{x}} e diz se cada uma está dentro de um texto entre aspas. */
export function scanTemplate(body: string): VarHit[] {
  const out: VarHit[] = []
  let inStr = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '{' && body[i + 1] === '{') {
      VAR_RE.lastIndex = i
      const m = VAR_RE.exec(body)
      if (m) {
        out.push({ start: i, end: i + m[0].length, name: m[1], inString: inStr })
        i += m[0].length - 1
        continue
      }
    }
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
  }
  return out
}

/** Troca cada variável por um valor de mesmo tamanho (mantém as posições para apontar erros). */
function fillVars(body: string, hits: VarHit[]) {
  let out = ''
  let last = 0
  for (const h of hits) {
    out += body.slice(last, h.start)
    const len = h.end - h.start
    out += h.inString ? 'x'.repeat(len) : '0' + ' '.repeat(len - 1)
    last = h.end
  }
  return out + body.slice(last)
}

interface JsonProblem {
  pos: number
  message: string
}

/** Verificador de JSON com mensagens em português e posição do erro. */
export function checkJson(s: string): JsonProblem | null {
  let i = 0
  const ws = () => {
    while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r')) i++
  }
  const fail = (message: string): never => {
    throw { pos: i, message } as JsonProblem
  }
  const str = () => {
    i++
    while (i < s.length) {
      const c = s[i]
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === '"') {
        i++
        return
      }
      if (c === '\n') fail('As aspas deste texto não foram fechadas na mesma linha.')
      i++
    }
    fail('Faltam as aspas de fechamento de um texto.')
  }
  const numb = () => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(s.slice(i))
    if (!m) fail('Número inválido.')
    i += m![0].length
    if (s[i] === ',' && /\d/.test(s[i + 1] ?? '')) fail('Use ponto como separador decimal (ex.: 10.5), não vírgula.')
  }
  const value = (): void => {
    ws()
    const c = s[i]
    if (i >= s.length) fail('O texto terminou antes da hora. Falta fechar alguma chave ou colchete.')
    if (c === '{') return obj()
    if (c === '[') return arr()
    if (c === '"') return str()
    if (c === '-' || (c >= '0' && c <= '9')) return numb()
    if (s.startsWith('true', i)) {
      i += 4
      return
    }
    if (s.startsWith('false', i)) {
      i += 5
      return
    }
    if (s.startsWith('null', i)) {
      i += 4
      return
    }
    if (c === "'") fail('Use aspas duplas ("), não aspas simples.')
    if (c === '}' || c === ',' || c === ']') fail('Falta o valor deste campo.')
    fail(`Valor inesperado “${c}”. Textos precisam estar entre aspas duplas.`)
  }
  const obj = () => {
    i++
    ws()
    if (s[i] === '}') {
      i++
      return
    }
    for (;;) {
      ws()
      if (s[i] === '}') fail('Vírgula sobrando antes de fechar a chave.')
      if (i >= s.length) fail('Falta fechar a chave (}).')
      if (s[i] !== '"') fail(s[i] === "'" ? 'Use aspas duplas (") no nome do campo.' : 'O nome do campo precisa estar entre aspas duplas.')
      str()
      ws()
      if (s[i] !== ':') fail('Faltam os dois-pontos (:) depois do nome do campo.')
      i++
      value()
      ws()
      if (s[i] === ',') {
        i++
        continue
      }
      if (s[i] === '}') {
        i++
        return
      }
      if (i >= s.length) fail('Falta fechar a chave (}).')
      fail('Falta uma vírgula entre os campos.')
    }
  }
  const arr = () => {
    i++
    ws()
    if (s[i] === ']') {
      i++
      return
    }
    for (;;) {
      ws()
      if (s[i] === ']') fail('Vírgula sobrando antes de fechar o colchete.')
      value()
      ws()
      if (s[i] === ',') {
        i++
        continue
      }
      if (s[i] === ']') {
        i++
        return
      }
      if (i >= s.length) fail('Falta fechar o colchete (]).')
      fail('Falta uma vírgula entre os itens da lista.')
    }
  }
  try {
    value()
    ws()
    if (i < s.length) fail('Há texto depois do fim do JSON.')
    return null
  } catch (e) {
    if (e && typeof e === 'object' && 'pos' in e) return e as JsonProblem
    throw e
  }
}

export function lineCol(text: string, pos: number) {
  const before = text.slice(0, pos)
  const line = before.split('\n').length
  const column = pos - before.lastIndexOf('\n')
  const lineText = text.split('\n')[line - 1] ?? ''
  return { line, column, lineText }
}

export interface TemplateCheck {
  ok: boolean
  error: string | null
  line: number | null
  column: number | null
  lineText: string | null
  /** variáveis usadas (sem repetição) */
  vars: string[]
  unknown: string[]
}

/** Valida o corpo: JSON válido, objeto na raiz e só variáveis conhecidas do evento. */
export function validateTemplate(body: string, allowed: string[]): TemplateCheck {
  const base = { line: null, column: null, lineText: null }
  if (!body.trim()) return { ok: false, error: 'O corpo está vazio. Escreva um objeto JSON.', vars: [], unknown: [], ...base }
  const hits = scanTemplate(body)
  const vars = [...new Set(hits.map((h) => h.name))]
  const unknown = vars.filter((v) => !allowed.includes(v))
  const filled = fillVars(body, hits)
  const open = filled.indexOf('{{')
  if (open >= 0) {
    const lc = lineCol(body, open)
    return { ok: false, error: 'Variável mal escrita. Use o formato {{nome.do.campo}}.', vars, unknown, ...lc }
  }
  const problem = checkJson(filled)
  if (problem) {
    const lc = lineCol(body, Math.min(problem.pos, body.length))
    return { ok: false, error: problem.message, vars, unknown, ...lc }
  }
  if (filled.trim()[0] !== '{') return { ok: false, error: 'O corpo precisa ser um objeto JSON: comece com { e termine com }.', vars, unknown, ...base }
  if (unknown.length) {
    const at = hits.find((h) => h.name === unknown[0])!
    return { ok: false, error: `Variável desconhecida: {{${unknown[0]}}}. Use só as variáveis deste evento.`, vars, unknown, ...lineCol(body, at.start) }
  }
  return { ok: true, error: null, vars, unknown, ...base }
}

/** Substitui as variáveis por valores (dados de exemplo) e devolve o JSON formatado. */
export function renderTemplate(body: string, values: Record<string, unknown>): string | null {
  const hits = scanTemplate(body)
  let out = ''
  let last = 0
  for (const h of hits) {
    out += body.slice(last, h.start)
    const v = values[h.name]
    out += h.inString ? JSON.stringify(String(v ?? '')).slice(1, -1) : JSON.stringify(v ?? null)
    last = h.end
  }
  out += body.slice(last)
  try {
    return JSON.stringify(JSON.parse(out), null, 2)
  } catch {
    return null
  }
}

/** Reindenta o corpo mantendo as variáveis. Retorna null se o JSON estiver inválido. */
export function formatTemplate(body: string): string | null {
  const hits = scanTemplate(body)
  let out = ''
  let last = 0
  hits.forEach((h, n) => {
    out += body.slice(last, h.start)
    out += h.inString ? `__VAR_${n}__` : `"__RAW_${n}__"`
    last = h.end
  })
  out += body.slice(last)
  try {
    let pretty = JSON.stringify(JSON.parse(out), null, 2)
    hits.forEach((h, n) => {
      pretty = pretty.split(`"__RAW_${n}__"`).join(`{{${h.name}}}`).split(`__VAR_${n}__`).join(`{{${h.name}}}`)
    })
    return pretty
  } catch {
    return null
  }
}

/** Corpo padrão: um bloco por grupo de campos (event, player, deposit...). */
export function defaultTemplateBody(def: TemplateEventDef): string {
  const groups = new Map<string, TemplateField[]>()
  for (const f of def.fields) {
    const g = f.key.split('.')[0]
    groups.set(g, [...(groups.get(g) ?? []), f])
  }
  const blocks: string[] = []
  for (const [g, fields] of groups) {
    const lines = fields.map((f) => {
      const sub = f.key.split('.').slice(1).join('_')
      const ph = f.type === 'numero' || f.type === 'booleano' ? `{{${f.key}}}` : `"{{${f.key}}}"`
      return `    "${sub}": ${ph}`
    })
    if (g === 'event') lines.unshift(`    "type": "${def.key}"`)
    blocks.push(`  "${g}": {\n${lines.join(',\n')}\n  }`)
  }
  return `{\n${blocks.join(',\n')}\n}`
}

export function sampleValues(def: TemplateEventDef): Record<string, unknown> {
  return Object.fromEntries(def.fields.map((f) => [f.key, f.sample]))
}

/** Insere texto na posição do cursor. */
export function insertAt(text: string, start: number, end: number, insert: string) {
  return { text: text.slice(0, start) + insert + text.slice(end), cursor: start + insert.length }
}
