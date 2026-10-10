// Formatação pt-BR: moeda em reais, vírgula decimal, datas dia/mês/ano.

const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brlCompactFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})
const numFmt = new Intl.NumberFormat('pt-BR')
const numCompactFmt = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })
const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const dateShortFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** R$ 1.234,56 */
export function brl(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return brlFmt.format(value).replace(/ /g, ' ')
}

/** R$ 1,2 mi — para indicadores grandes */
export function brlCompact(value: number): string {
  if (Math.abs(value) < 10_000) return brl(value)
  return brlCompactFmt.format(value).replace(/ /g, ' ')
}

/** 1.234 */
export function num(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return numFmt.format(value)
}

/** 12,3 mil */
export function numCompact(value: number): string {
  if (Math.abs(value) < 10_000) return num(value)
  return numCompactFmt.format(value)
}

/** 12,5% — recebe fração (0.125) por padrão, ou valor já em % com isPercent */
export function pct(value: number | null | undefined, digits = 1, isPercent = false): string {
  if (value == null || Number.isNaN(value)) return '—'
  const v = isPercent ? value : value * 100
  return `${v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
}

/** 1,5x */
export function mult(value: number): string {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`
}

type DateInput = Date | string | number

function toDate(d: DateInput): Date {
  return d instanceof Date ? d : new Date(d)
}

/**
 * Data utilizável? Falso para valor vazio, texto que não é data e máscara do servidor
 * (ex.: data de nascimento "•••000Z" para quem não vê dados pessoais). Intl.DateTimeFormat
 * lança RangeError com data inválida: toda formatação abaixo passa por aqui e mostra "—".
 */
export function isValidDate(d: DateInput | null | undefined): boolean {
  if (d == null || d === '') return false
  return !Number.isNaN(toDate(d).getTime())
}

/** 09/10/2026 */
export function date(d: DateInput | null | undefined): string {
  if (!isValidDate(d)) return '—'
  return dateFmt.format(toDate(d!))
}

/** 09/10 */
export function dateShort(d: DateInput): string {
  if (!isValidDate(d)) return '—'
  return dateShortFmt.format(toDate(d))
}

/** 14:32 */
export function time(d: DateInput): string {
  if (!isValidDate(d)) return '—'
  return timeFmt.format(toDate(d))
}

/** 09/10/2026 14:32 */
export function dateTime(d: DateInput | null | undefined): string {
  if (!isValidDate(d)) return '—'
  const dt = toDate(d!)
  return `${dateFmt.format(dt)} ${timeFmt.format(dt)}`
}

/** "há 5 min", "há 3 h", "há 2 dias" */
export function relative(d: DateInput | null | undefined, now: Date = new Date()): string {
  if (!isValidDate(d)) return '—'
  const diff = (now.getTime() - toDate(d!).getTime()) / 1000
  if (diff < 0) return 'agora'
  if (diff < 60) return 'agora'
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`
  const days = Math.floor(diff / 86400)
  if (days === 1) return 'ontem'
  if (days < 30) return `há ${days} dias`
  const months = Math.floor(days / 30)
  if (months < 12) return `há ${months} ${months === 1 ? 'mês' : 'meses'}`
  return `há ${Math.floor(months / 12)} ano(s)`
}

/** Duração curta: 3h 12min, 2d 4h */
export function duration(ms: number): string {
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ${min % 60}min`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

/** Converte "1.234,56" ou "1234.56" em número */
export function parseBRNumber(input: string): number {
  const clean = input.replace(/[^\d,.-]/g, '')
  if (clean.includes(',')) return Number(clean.replace(/\./g, '').replace(',', '.'))
  return Number(clean)
}

export interface DecimalTextOptions {
  /** aceita "-" na frente (padrão: não) */
  allowNegative?: boolean
  /** casas decimais aceitas (padrão: 2, como centavos) */
  maxDecimals?: number
}

/**
 * Resultado da leitura do texto de um campo numérico:
 *  - ok: `value` é o número; `text` é o texto limpo (sem "R$" e espaços, para o campo mostrar ao colar);
 *    `pending` marca pontos fora do lugar do milhar ("1.000.0" enquanto se digita 1.000.000, "1.00,50" ao
 *    apagar um dígito): todo ponto conta como milhar e, ao sair do campo, ele mostra o número lido com um aviso;
 *  - recusado: o texto não forma número; `message` diz por quê (o campo fica como estava e mostra o aviso).
 */
export type DecimalText =
  | { ok: true; value: number; text: string; pending: boolean }
  | { ok: false; message: string }

export const DECIMAL_TEXT_MESSAGES = {
  chars: 'Digite só números (ex.: 1.500,50).',
  charsInteger: 'Digite só números inteiros (ex.: 1.500).',
  negative: 'O valor não pode ser negativo.',
  format: 'Use ponto só no milhar e vírgula nos decimais (ex.: 1.000.000 ou 1.500,50).',
  decimals: (n: number) => (n === 0 ? 'Use um número inteiro.' : `Use no máximo ${n} ${n === 1 ? 'casa decimal' : 'casas decimais'}.`),
  pending: (shown: string) => `Ponto conta como milhar: ficou ${shown}. Confira o valor.`,
}

/** Grupos de milhar: "1.000", "12.500.000" (o primeiro grupo não começa com zero). */
const GROUPED = /^[1-9]\d{0,2}(\.\d{3})+$/

/**
 * Lê o texto de um campo numérico do jeito brasileiro (o campo é texto: o <input type="number"> do navegador
 * descarta a vírgula sem aviso e "12,5" virava 125).
 *  - vírgula é o separador decimal e ponto é o milhar: "12,5" → 12.5; "1.500,50" e "1500,50" → 1500.5;
 *    "1.000.000" e "1.000.000,00" → 1000000;
 *  - sem vírgula, ponto seguido de grupos de 3 dígitos é milhar ("1.500" → 1500); um ponto seguido de 1 ou 2
 *    dígitos é decimal ("12.5" → 12.5, como um número colado de outro sistema);
 *  - "R$" e espaços são ignorados (colar "R$ 1.500,50" funciona);
 *  - vazio, "-" e "," valem 0 (a pessoa ainda está digitando); "1.000." vale 1000 (o próximo grupo vem aí);
 *  - com `maxDecimals: 0` (contagens), "2,5" é recusado com "Use um número inteiro." (o campo fica em 2); o ponto
 *    é sempre milhar ("2.5" fica pendente como 25, com o aviso ao sair do campo).
 * Nada é reinterpretado em silêncio: "1.0000" (milhar ou decimal?) e "12,345" com 2 casas são recusados com a
 * mensagem, em vez de virar 1 ou 12,34; pontos fora do lugar ficam pendentes (aviso ao sair do campo).
 */
export function readDecimalText(raw: string, { allowNegative = false, maxDecimals = 2 }: DecimalTextOptions = {}): DecimalText {
  let t = raw.replace(/\s/g, '').replace(/r\$/gi, '')
  let sign = 1
  if (t.startsWith('-')) {
    if (!allowNegative) return { ok: false, message: DECIMAL_TEXT_MESSAGES.negative }
    sign = -1
    t = t.slice(1)
  }
  if (!/^[\d.,]*$/.test(t)) return { ok: false, message: maxDecimals === 0 ? DECIMAL_TEXT_MESSAGES.charsInteger : DECIMAL_TEXT_MESSAGES.chars }
  const text = `${sign < 0 ? '-' : ''}${t}`
  const done = (digits: string, pending = false): DecimalText => {
    const n = digits === '' || digits === '.' ? 0 : Number(digits)
    if (!Number.isFinite(n)) return { ok: false, message: DECIMAL_TEXT_MESSAGES.format }
    return { ok: true, value: n === 0 ? 0 : sign * n, text, pending }
  }
  // pontos fora do lugar do milhar ("1.000.0" a caminho de 1.000.000, "1.00,50" ao apagar um dígito):
  // com mais de um ponto, ou com vírgula, todo ponto é milhar; o número vale os dígitos e fica pendente
  const misgrouped = (int: string) => /^\d+(\.\d+)*$/.test(int) && !GROUPED.test(int)
  if (t.includes(',')) {
    const [int, frac, ...rest] = t.split(',')
    if (rest.length || frac.includes('.')) return { ok: false, message: DECIMAL_TEXT_MESSAGES.format }
    if (frac.length > maxDecimals) return { ok: false, message: DECIMAL_TEXT_MESSAGES.decimals(maxDecimals) }
    if (int === '' || /^\d+$/.test(int) || GROUPED.test(int)) return done(`${int.replace(/\./g, '')}.${frac}`)
    if (misgrouped(int)) return done(`${int.replace(/\./g, '')}.${frac}`, true)
    return { ok: false, message: DECIMAL_TEXT_MESSAGES.format }
  }
  if (/^\d*$/.test(t)) return done(t)
  if (GROUPED.test(t)) return done(t.replace(/\./g, ''))
  // ponto no fim: o próximo grupo (ou a casa decimal) ainda vem
  if (/^\d+\.$/.test(t) || /^[1-9]\d{0,2}(\.\d{3})+\.$/.test(t)) return done(t.slice(0, -1).replace(/\./g, ''))
  // um só ponto: decimal ("12.5", "0.005") até maxDecimals casas ("1.500" já foi lido como milhar acima);
  // "1.0000" e "0.500" são ambíguos (milhar ou decimal?) e são recusados
  const dot = /^\d+\.(\d+)$/.exec(t)
  if (dot) {
    if (dot[1].length <= maxDecimals) return done(t)
    // número inteiro: o ponto só pode ser milhar ("1.0" a caminho de 1.000); fica pendente (aviso ao sair)
    if (maxDecimals === 0 && dot[1].length < 3) return done(t.replace('.', ''), true)
    return { ok: false, message: dot[1].length < 3 ? DECIMAL_TEXT_MESSAGES.decimals(maxDecimals) : DECIMAL_TEXT_MESSAGES.format }
  }
  const body = t.endsWith('.') ? t.slice(0, -1) : t
  if (misgrouped(body)) return done(body.replace(/\./g, ''), true)
  return { ok: false, message: DECIMAL_TEXT_MESSAGES.format }
}

/**
 * Atalho de readDecimalText: o número, ou null quando o texto é recusado. Texto pendente ("1.000.0") também é
 * null aqui: quem chama não tem como mostrar o aviso.
 */
export function parseDecimalInput(raw: string, allowNegative = false, maxDecimals = 2): number | null {
  const r = readDecimalText(raw, { allowNegative, maxDecimals })
  return r.ok && !r.pending ? r.value : null
}

/**
 * Número no campo de texto, como o painel mostra: milhar com ponto e vírgula decimal ("1.500,5").
 * `minDecimals: 2` para reais ("1.500,50", "5.000,00"). O texto volta ao mesmo número em readDecimalText.
 */
export function formatDecimalInput(n: number, { minDecimals = 0, maxDecimals = 2 }: { minDecimals?: number; maxDecimals?: number } = {}): string {
  if (!Number.isFinite(n)) return ''
  const max = Math.max(minDecimals, maxDecimals)
  return n.toLocaleString('pt-BR', { minimumFractionDigits: minDecimals, maximumFractionDigits: max, useGrouping: true })
}

/** Casas decimais de um passo ("0.001" → 3), para o campo aceitar o que as setas produzem. */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || Number.isInteger(step)) return 0
  const s = String(step)
  const e = /e-(\d+)$/.exec(s)
  if (e) return Number(e[1])
  return s.split('.')[1]?.length ?? 0
}

/** Esconde o meio de um CPF: 123.***.***-09 */
export function maskCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, '')
  if (d.length !== 11) return cpf
  return `${d.slice(0, 3)}.***.***-${d.slice(9)}`
}

/** Esconde e-mail: da***@gmail.com */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!domain) return email
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(3, user.length - 2))}@${domain}`
}

/** Tamanho mínimo para a máscara mostrar o fim do segredo (mesma regra do servidor). */
const SECRET_TAIL_MIN_LENGTH = 16

/** Texto com caracteres de máscara (• ou ***): máscara vinda do servidor, nunca um segredo digitado. */
export function hasMaskChars(value: string): boolean {
  return value.includes('•') || value.includes('***')
}

/**
 * Esconde segredo como o servidor: ••••••••••a9F2 (só pontos se tiver menos de 16 caracteres).
 * Valor que já é máscara (modo API) aparece como veio.
 */
export function maskSecret(secret: string, visible = 4): string {
  if (!secret) return ''
  if (hasMaskChars(secret)) return secret
  if (secret.length < SECRET_TAIL_MIN_LENGTH) return '•'.repeat(10)
  return `${'•'.repeat(10)}${secret.slice(-visible)}`
}

/** Esconde telefone: (11) 9****-1234 */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.length < 10) return phone
  return `(${d.slice(0, 2)}) ${d.slice(2, 3)}****-${d.slice(-4)}`
}

/** Formata CPF completo */
export function cpf(value: string): string {
  const d = value.replace(/\D/g, '')
  if (d.length !== 11) return value
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

/** Formata celular */
export function phone(value: string): string {
  const d = value.replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return value
}

/** Chave PIX revelada no formato do tipo: CPF 123.456.789-09, celular (11) 90724-3561; e-mail e aleatória como vieram. */
export function pixKey(type: string, key: string): string {
  if (type === 'CPF') return cpf(key)
  if (type === 'Celular') return phone(key.replace(/^\+?55(?=\d{10,11}$)/, ''))
  return key
}

/** Iniciais para avatar */
export function initials(name: string): string {
  // só palavras (sem parênteses e pontuação na frente): "Equipe (demonstração)" vira "ED", não "E("
  const parts = name
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Plural simples: plural(2, 'saque', 'saques') */
export function plural(n: number, one: string, many: string): string {
  return `${num(n)} ${n === 1 ? one : many}`
}
