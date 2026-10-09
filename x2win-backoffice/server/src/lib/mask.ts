// Mascaramento de dados pessoais e segredos para leitura pelo painel.
import { isIP } from 'node:net'
import { MASK_CHAR } from '@shared/kv-registry'

const BULLETS = MASK_CHAR.repeat(10)

/** Segredo: só os últimos 4 caracteres. */
export function maskSecret(value: string): string {
  if (!value) return ''
  return `${BULLETS}${value.slice(-4)}`
}

/** ab***@dominio.com */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!domain) return maskGeneric(email)
  return `${user.slice(0, 2)}***@${domain}`
}

/** 123.***.***-09 */
export function maskCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, '')
  if (d.length !== 11) return maskGeneric(cpf)
  return `${d.slice(0, 3)}.***.***-${d.slice(9)}`
}

/** (11) 9****-1234 */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.length < 10) return maskGeneric(phone)
  return `(${d.slice(0, 2)}) ${d.slice(2, 3)}****-${d.slice(-4)}`
}

/** •••1234 */
export function maskGeneric(value: string): string {
  if (!value) return ''
  return `${MASK_CHAR.repeat(3)}${value.slice(-4)}`
}

/** Agência bancária: ••34 (mesma máscara do painel). */
export function maskAgency(value: string): string {
  if (!value) return ''
  return `${MASK_CHAR.repeat(2)}${value.replace(/\D/g, '').slice(-2)}`
}

/** Conta bancária: •••65-4 (mesma máscara do painel). */
export function maskAccount(value: string): string {
  if (!value) return ''
  const [num, dv] = value.split('-')
  return `${MASK_CHAR.repeat(3)}${num.replace(/\D/g, '').slice(-2)}${dv ? `-${dv.slice(0, 2)}` : ''}`
}

/** Nome de titular: só as iniciais (J*** S***). */
export function maskName(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return value ? '***' : ''
  return words.map((w) => `${w.slice(0, 1)}***`).join(' ')
}

function maskIpv4(v: string): string {
  const [a, b] = v.split('.')
  return `${a}.${b}.***.***`
}

/** Dois primeiros grupos de um IPv6 (expandindo "::"). */
function firstHextets(v: string): [string, string] {
  const compressed = v.includes('::')
  const head = compressed ? v.split('::')[0] : v
  const groups = head ? head.split(':') : []
  while (compressed && groups.length < 2) groups.push('0')
  return [groups[0] || '0', groups[1] || '0']
}

function maskOneIp(raw: string): string {
  if (!raw || isMasked(raw)) return raw
  let v = raw
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(v)
  if (bracketed) v = bracketed[1]
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(v)) v = v.replace(/:\d+$/, '')
  v = v.replace(/%.*$/, '') // zona do IPv6 (fe80::1%eth0)
  const kind = isIP(v)
  if (kind === 4) return maskIpv4(v)
  if (kind === 6) {
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(v)
    if (mapped) return `::ffff:${maskIpv4(mapped[1])}`
    const [h0, h1] = firstHextets(v)
    // nunca devolve o /64 nem o identificador da interface
    return `${h0}:${h1}:****:****:****:****:****:****`
  }
  return MASK_CHAR.repeat(3)
}

/**
 * IP: mantém só a parte de rede (IPv4 a.b.***.***; IPv6 os dois primeiros grupos).
 * Aceita listas "a, b" (x-forwarded-for), porta, colchetes e zona. Valor que não é IP sai como "•••".
 */
export function maskIp(value: string): string {
  return value
    .split(',')
    .map((part) => maskOneIp(part.trim()))
    .join(', ')
}

const URL_MASK = '****'

/** Trecho do caminho com cara de token: 16+ caracteres, ou 10+ com letras e números. */
function looksLikeToken(seg: string): boolean {
  let s = seg
  try {
    s = decodeURIComponent(seg)
  } catch {
    /* mantém o trecho cru */
  }
  if (s.length >= 16) return true
  return s.length >= 10 && /[a-z]/i.test(s) && /\d/.test(s)
}

const alreadyMasked = (s: string) => s.includes('*') || s.includes(MASK_CHAR)

/**
 * URL com token (webhooks): mascara trechos do caminho com cara de token, todos os valores
 * da query, usuário/senha e fragmento. Mantém esquema, host e o resto do caminho.
 * Idempotente; URL sem nada a esconder volta igual. Texto que não é URL sai como "•••".
 */
export function maskUrlTokens(value: string): string {
  if (!value) return value
  let u: URL
  try {
    u = new URL(value)
  } catch {
    return isMasked(value) ? value : MASK_CHAR.repeat(3)
  }
  let changed = false
  const path = u.pathname
    .split('/')
    .map((seg) => {
      if (!seg || alreadyMasked(seg) || !looksLikeToken(seg)) return seg
      changed = true
      return `${seg.slice(0, 4)}${URL_MASK}`
    })
    .join('/')
  let query = ''
  if (u.search.length > 1) {
    query = `?${u.search
      .slice(1)
      .split('&')
      .map((pair) => {
        const i = pair.indexOf('=')
        const name = i < 0 ? pair : pair.slice(0, i)
        const val = i < 0 ? '' : pair.slice(i + 1)
        if (!val || alreadyMasked(val)) return pair
        changed = true
        return `${name}=${URL_MASK}`
      })
      .join('&')}`
  }
  let auth = ''
  if (u.username || u.password) {
    auth = `${URL_MASK}@`
    if (u.username !== URL_MASK || u.password) changed = true
  }
  let hash = ''
  if (u.hash.length > 1) {
    hash = alreadyMasked(u.hash) ? u.hash : `#${URL_MASK}`
    if (hash !== u.hash) changed = true
  }
  if (!changed) return value
  return `${u.protocol}//${auth}${u.host}${path}${query}${hash}`
}

/** Escolhe a máscara pelo nome do campo e pelo formato do valor. */
export function maskPii(field: string, value: string): string {
  const f = field.toLowerCase()
  if (f.includes('email') || f.includes('e-mail') || /@/.test(value)) return maskEmail(value)
  if (f.endsWith('cpf') || f.includes('document')) return maskCpf(value)
  if (f.includes('phone') || f.includes('celular') || f.includes('telefone')) return maskPhone(value)
  if (f.endsWith('ip')) return maskIp(value)
  if (f === 'agency' || f === 'agencia' || f === 'agência') return maskAgency(value)
  if (f === 'account' || f === 'conta') return maskAccount(value)
  if (f === 'holder' || f === 'titular') return maskName(value)
  const digits = value.replace(/\D/g, '')
  if (digits.length === 11 && /^[\d.\-\s]+$/.test(value)) return maskCpf(value)
  return maskGeneric(value)
}

/** Valor que saiu mascarado (não deve sobrescrever o gravado). */
export function isMasked(value: unknown): boolean {
  return typeof value === 'string' && (value.includes(MASK_CHAR) || value.includes('***'))
}

/** Máscara da chave PIX conforme o tipo (saques). */
export function maskPixKey(type: string, key: string): string {
  if (type === 'CPF') return maskCpf(key)
  if (type === 'E-mail') return maskEmail(key)
  if (type === 'Celular') return maskPhone(key)
  return key.length > 10 ? `${key.slice(0, 6)}…${key.slice(-4)}` : maskGeneric(key)
}
