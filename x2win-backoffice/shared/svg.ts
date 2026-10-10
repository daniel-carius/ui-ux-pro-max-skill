// Regra do SVG aceito como imagem (logotipo, banners, ícones): só desenho estático, nada que execute ou carregue
// algo de fora. A mesma função roda no servidor (ao gravar, server/src/modules/kv/rules-content.ts) e no painel
// (ao escolher o arquivo, components/ui/Inputs.tsx), para a recusa aparecer no envio e não só ao salvar.

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** Elementos aceitos num SVG estático (desenho, gradiente, texto, recorte, filtro sem imagem). */
const SVG_ELEMENTS = new Set(
  [
    'svg',
    'g',
    'defs',
    'title',
    'desc',
    'metadata',
    'linearGradient',
    'radialGradient',
    'stop',
    'rect',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'path',
    'text',
    'tspan',
    'textPath',
    'clipPath',
    'mask',
    'pattern',
    'symbol',
    'use',
    'marker',
    'filter',
    'feGaussianBlur',
    'feOffset',
    'feBlend',
    'feColorMatrix',
    'feComponentTransfer',
    'feFuncR',
    'feFuncG',
    'feFuncB',
    'feFuncA',
    'feMerge',
    'feMergeNode',
    'feFlood',
    'feComposite',
    'feDropShadow',
    'feMorphology',
  ].map((e) => e.toLowerCase()),
)

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Decodifica as entidades XML de um atributo; entidade desconhecida → null. */
function decodeXmlEntities(v: string): string | null {
  let bad = false
  const out = v.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);?/gi, (_m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      if (!Number.isFinite(n) || n > 0x10ffff) {
        bad = true
        return ''
      }
      return String.fromCodePoint(n)
    }
    const named = hasOwn(XML_ENTITIES, e) ? XML_ENTITIES[e] : undefined
    if (named === undefined) bad = true
    return named ?? ''
  })
  return bad ? null : out
}

/** Problema de um valor de atributo do SVG (já decodificado), ou null. */
function svgAttrValueProblem(value: string): string | null {
  const compact = value.replace(/[\s\u0000-\u001F\u007F]+/g, '').toLowerCase()
  if (/(javascript|vbscript|data|livescript):/.test(compact)) return 'endereço ativo (javascript:/data:) no SVG'
  if (compact.includes('@import') || compact.includes('expression(')) return 'CSS ativo no SVG'
  for (const m of compact.matchAll(/url\(([^)]*)\)?/g)) {
    const inner = m[1].replace(/^['"]/, '')
    if (!m[0].endsWith(')') || !inner.startsWith('#')) return 'url() externo no SVG'
  }
  return null
}

/** SVG estático (sem nada que execute ou carregue algo de fora)? Devolve o problema ou null. */
export function svgProblem(source: string): string | null {
  const s = source
    .replace(/^﻿/, '')
    .replace(/^\s*<\?xml\s[^>]*\?>/i, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  if (/<[!?]/.test(s)) return 'DOCTYPE, entidades, CDATA e instruções não são aceitos no SVG'
  if (!/^\s*<svg[\s>/]/i.test(s)) return 'o arquivo não é um SVG'
  const tag = /<\/?([A-Za-z][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>/g
  let tags = 0
  for (const m of s.matchAll(tag)) {
    tags++
    const name = m[1]
    if (!SVG_ELEMENTS.has(name.toLowerCase())) return `elemento <${name}> não é aceito no SVG`
    for (const a of m[2].matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const attr = a[1].toLowerCase()
      const value = decodeXmlEntities(a[2] ?? a[3] ?? '')
      if (value === null) return 'entidade desconhecida no SVG'
      if (attr.startsWith('on')) return `atributo de evento (${a[1]}) no SVG`
      if (attr === 'href' || attr.endsWith(':href')) {
        if (!/^#[\w.:-]*$/.test(value.trim())) return 'link externo (href) no SVG'
        continue
      }
      if (attr === 'xmlns' || attr.startsWith('xmlns:')) continue
      const p = svgAttrValueProblem(value)
      if (p) return p
    }
  }
  // todo "<" precisa ser o início de uma marcação reconhecida acima
  if ((s.match(/</g) ?? []).length !== tags) return 'marcação inválida no SVG'
  return null
}

