// Regras de Configurações › Textos legais: versões, diferença entre versões,
// publicação e um markdown simples (títulos, listas, negrito, itálico, links).

export const LEGAL_KEYS = {
  docs: 'config.textos-legais',
  drafts: 'config.textos-legais.rascunhos',
} as const

export type LegalDocId = 'termos' | 'privacidade' | 'jogo-responsavel' | 'bonus'

export interface LegalVersion {
  version: number
  publishedAt: string
  author: string
  summary: string
  content: string
  /** jogadores precisam aceitar de novo no próximo acesso */
  requireReaccept: boolean
  added: number
  removed: number
}

export interface LegalDoc {
  id: LegalDocId
  title: string
  /** caminho público no site */
  slug: string
  description: string
  /** da mais antiga para a mais nova */
  versions: LegalVersion[]
}

export function currentVersion(doc: LegalDoc): LegalVersion {
  return doc.versions[doc.versions.length - 1]
}

// ---------- Diferença por linhas (LCS) ----------

export type DiffOp = { type: 'eq' | 'add' | 'del'; text: string }

export function diffLines(before: string, after: string): DiffOp[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const n = a.length
  const m = b.length
  // tabela LCS (textos legais têm poucas centenas de linhas)
  const t: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1])
    }
  }
  const out: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'eq', text: a[i] })
      i++
      j++
    } else if (t[i + 1][j] >= t[i][j + 1]) {
      out.push({ type: 'del', text: a[i++] })
    } else {
      out.push({ type: 'add', text: b[j++] })
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}

/** Linhas adicionadas e removidas (linhas em branco não contam). */
export function diffStats(before: string, after: string) {
  let added = 0
  let removed = 0
  for (const op of diffLines(before, after)) {
    if (!op.text.trim()) continue
    if (op.type === 'add') added++
    else if (op.type === 'del') removed++
  }
  return { added, removed }
}

// ---------- Publicação ----------

export const SUMMARY_MIN = 10

export function validatePublish(doc: LegalDoc, content: string, summary: string): string | null {
  const cur = currentVersion(doc)
  if (content.trim() === cur.content.trim()) return 'O texto não mudou desde a versão publicada.'
  if (content.trim().length < 200) return 'O texto ficou curto demais para um documento legal (mínimo de 200 caracteres).'
  if (summary.trim().length < SUMMARY_MIN) return `Descreva a mudança em pelo menos ${SUMMARY_MIN} caracteres.`
  return null
}

export function publishVersion(
  doc: LegalDoc,
  content: string,
  opts: { summary: string; author: string; requireReaccept: boolean; now?: Date },
): LegalDoc {
  const cur = currentVersion(doc)
  const { added, removed } = diffStats(cur.content, content)
  const v: LegalVersion = {
    version: cur.version + 1,
    publishedAt: (opts.now ?? new Date()).toISOString(),
    author: opts.author,
    summary: opts.summary.trim(),
    content,
    requireReaccept: opts.requireReaccept,
    added,
    removed,
  }
  return { ...doc, versions: [...doc.versions, v] }
}

/**
 * Taxa simulada de aceite da versão atual (só faz sentido quando a versão
 * exigiu novo aceite): sobe com os dias desde a publicação.
 */
export function acceptanceRate(v: LegalVersion, now: Date = new Date()): number | null {
  if (!v.requireReaccept) return null
  const days = Math.max(0, (now.getTime() - new Date(v.publishedAt).getTime()) / 86_400_000)
  return Math.min(0.97, 0.06 + 0.91 * (1 - Math.exp(-days / 9)))
}

// ---------- Texto ----------

export function wordCount(text: string) {
  const m = text.trim().match(/\S+/g)
  return m ? m.length : 0
}

export type FormatKind = 'bold' | 'italic' | 'h2' | 'h3' | 'ul' | 'ol' | 'quote' | 'link' | 'hr'

/**
 * Aplica a formatação do botão da barra ao texto selecionado (ou insere um
 * exemplo). Devolve o texto novo e a seleção a manter.
 */
export function applyFormat(text: string, start: number, end: number, kind: FormatKind): { text: string; start: number; end: number } {
  const sel = text.slice(start, end)
  const wrap = (left: string, right: string, placeholder: string) => {
    const inner = sel || placeholder
    const next = text.slice(0, start) + left + inner + right + text.slice(end)
    return { text: next, start: start + left.length, end: start + left.length + inner.length }
  }
  const linePrefix = (prefix: (i: number) => string, placeholder: string) => {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1
    const lineEndIdx = text.indexOf('\n', end)
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx
    const block = text.slice(lineStart, lineEnd) || placeholder
    const lines = block.split('\n').map((l, i) => prefix(i) + l.replace(/^(#{1,3} |- |\d+\. |> )/, ''))
    const replaced = lines.join('\n')
    return { text: text.slice(0, lineStart) + replaced + text.slice(lineEnd), start: lineStart, end: lineStart + replaced.length }
  }
  switch (kind) {
    case 'bold':
      return wrap('**', '**', 'texto em negrito')
    case 'italic':
      return wrap('_', '_', 'texto em itálico')
    case 'link': {
      const label = sel || 'texto do link'
      const insert = `[${label}](https://x2win.bet.br/)`
      return { text: text.slice(0, start) + insert + text.slice(end), start: start + label.length + 3, end: start + insert.length - 1 }
    }
    case 'h2':
      return linePrefix(() => '## ', 'Título da seção')
    case 'h3':
      return linePrefix(() => '### ', 'Subtítulo')
    case 'ul':
      return linePrefix(() => '- ', 'Item da lista')
    case 'ol':
      return linePrefix((i) => `${i + 1}. `, 'Item da lista')
    case 'quote':
      return linePrefix(() => '> ', 'Destaque')
    case 'hr': {
      const insert = `${start > 0 && text[start - 1] !== '\n' ? '\n' : ''}\n---\n\n`
      return { text: text.slice(0, start) + insert + text.slice(end), start: start + insert.length, end: start + insert.length }
    }
  }
}

// ---------- Markdown simples ----------

export type MdInline = { t: 'text' | 'b' | 'i' | 'a'; v: string; href?: string }
export type MdBlock =
  | { kind: 'h1' | 'h2' | 'h3' | 'p' | 'quote'; inline: MdInline[] }
  | { kind: 'ul' | 'ol'; items: MdInline[][] }
  | { kind: 'hr' }

export function parseInline(s: string): MdInline[] {
  const out: MdInline[] = []
  const re = /\*\*(.+?)\*\*|_(.+?)_|\*(.+?)\*|\[(.+?)\]\((.+?)\)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) })
    if (m[1] != null) out.push({ t: 'b', v: m[1] })
    else if (m[2] != null) out.push({ t: 'i', v: m[2] })
    else if (m[3] != null) out.push({ t: 'i', v: m[3] })
    else out.push({ t: 'a', v: m[4], href: m[5] })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) })
  return out
}

export function parseMarkdown(text: string): MdBlock[] {
  const blocks: MdBlock[] = []
  let para: string[] = []
  let list: { kind: 'ul' | 'ol'; items: MdInline[][] } | null = null
  const flushPara = () => {
    if (para.length) blocks.push({ kind: 'p', inline: parseInline(para.join(' ')) })
    para = []
  }
  const flushList = () => {
    if (list) blocks.push(list)
    list = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flushPara()
      flushList()
      continue
    }
    let m: RegExpMatchArray | null
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flushPara()
      flushList()
      const kind = m[1].length === 1 ? 'h1' : m[1].length === 2 ? 'h2' : 'h3'
      blocks.push({ kind, inline: parseInline(m[2]) })
    } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushPara()
      flushList()
      blocks.push({ kind: 'hr' })
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      flushPara()
      if (!list || list.kind !== 'ul') {
        flushList()
        list = { kind: 'ul', items: [] }
      }
      list.items.push(parseInline(m[1]))
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara()
      if (!list || list.kind !== 'ol') {
        flushList()
        list = { kind: 'ol', items: [] }
      }
      list.items.push(parseInline(m[1]))
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara()
      flushList()
      blocks.push({ kind: 'quote', inline: parseInline(m[1]) })
    } else {
      flushList()
      para.push(line.trim())
    }
  }
  flushPara()
  flushList()
  return blocks
}
