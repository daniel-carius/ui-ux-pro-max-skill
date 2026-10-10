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

/** 09/10/2026 */
export function date(d: DateInput | null | undefined): string {
  if (d == null) return '—'
  return dateFmt.format(toDate(d))
}

/** 09/10 */
export function dateShort(d: DateInput): string {
  return dateShortFmt.format(toDate(d))
}

/** 14:32 */
export function time(d: DateInput): string {
  return timeFmt.format(toDate(d))
}

/** 09/10/2026 14:32 */
export function dateTime(d: DateInput | null | undefined): string {
  if (d == null) return '—'
  const dt = toDate(d)
  return `${dateFmt.format(dt)} ${timeFmt.format(dt)}`
}

/** "há 5 min", "há 3 h", "há 2 dias" */
export function relative(d: DateInput | null | undefined, now: Date = new Date()): string {
  if (d == null) return '—'
  const diff = (now.getTime() - toDate(d).getTime()) / 1000
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

/** Iniciais para avatar */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Plural simples: plural(2, 'saque', 'saques') */
export function plural(n: number, one: string, many: string): string {
  return `${num(n)} ${n === 1 ? one : many}`
}
