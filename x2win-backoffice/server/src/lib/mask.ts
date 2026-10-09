// Mascaramento de dados pessoais e segredos para leitura pelo painel.
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

/** Escolhe a máscara pelo nome do campo e pelo formato do valor. */
export function maskPii(field: string, value: string): string {
  const f = field.toLowerCase()
  if (f.includes('email') || /@/.test(value)) return maskEmail(value)
  if (f === 'cpf' || f.includes('document')) return maskCpf(value)
  if (f.includes('phone') || f.includes('celular') || f.includes('telefone')) return maskPhone(value)
  if (f === 'ip' || f === 'lastip') return value.replace(/\.\d+\.\d+$/, '.***.***')
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
