// Regras de Configurações › Empresa e licença.
// CNPJ com dígitos verificadores (numérico e alfanumérico, formato novo da
// Receita Federal a partir de jul/2026), validade da autorização da SPA/MF e
// máscaras de contato. Funções puras: o servidor deve aplicar as mesmas regras.
import type { CompanyState } from './system'

const DAY_MS = 86_400_000

/** Mantém só 0-9 e A-Z (maiúsculas), no máximo 14 caracteres. */
export function cnpjClean(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 14)
}

/** Máscara progressiva: 00.000.000/0000-00 */
export function formatCnpj(value: string): string {
  const v = cnpjClean(value)
  let out = v.slice(0, 2)
  if (v.length > 2) out += `.${v.slice(2, 5)}`
  if (v.length > 5) out += `.${v.slice(5, 8)}`
  if (v.length > 8) out += `/${v.slice(8, 12)}`
  if (v.length > 12) out += `-${v.slice(12, 14)}`
  return out
}

// valor de cada caractere = código ASCII − 48 (regra do CNPJ alfanumérico; para dígitos é o próprio número)
const charValue = (c: string) => c.charCodeAt(0) - 48

function dv(base: string): number {
  const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const sum = [...base].reduce((s, c, i) => s + charValue(c) * weights[i], 0)
  const r = sum % 11
  return r < 2 ? 0 : 11 - r
}

/** Dígitos verificadores esperados para os 12 primeiros caracteres. */
export function cnpjCheckDigits(base12: string): string {
  const d1 = dv(base12)
  const d2 = dv(base12 + d1)
  return `${d1}${d2}`
}

export type CnpjCheck = { ok: true; alphanumeric: boolean } | { ok: false; reason: string; expected?: string }

export function validateCnpj(value: string): CnpjCheck {
  const v = cnpjClean(value)
  if (!v) return { ok: false, reason: 'Informe o CNPJ.' }
  if (v.length < 14) return { ok: false, reason: `CNPJ incompleto: faltam ${14 - v.length} caracteres.` }
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(v)) return { ok: false, reason: 'Os dois últimos caracteres (dígitos verificadores) são sempre números.' }
  if (/^(\d)\1{13}$/.test(v)) return { ok: false, reason: 'CNPJ inválido: todos os dígitos iguais.' }
  const expected = cnpjCheckDigits(v.slice(0, 12))
  if (expected !== v.slice(12)) {
    return { ok: false, reason: 'CNPJ inválido: os dígitos verificadores não conferem.', expected }
  }
  return { ok: true, alphanumeric: /[A-Z]/.test(v) }
}

export type LicenseLevel = 'ok' | 'warning' | 'expired' | 'missing'

export interface LicenseStatus {
  level: LicenseLevel
  daysLeft: number | null
  label: string
}

/** Aviso quando faltam menos de 90 dias para a autorização vencer. */
export const LICENSE_WARNING_DAYS = 90

export function licenseStatus(validUntil: string, now: Date = new Date()): LicenseStatus {
  if (!validUntil) return { level: 'missing', daysLeft: null, label: 'Sem data de validade' }
  const t = new Date(validUntil).getTime()
  if (Number.isNaN(t)) return { level: 'missing', daysLeft: null, label: 'Data inválida' }
  const days = Math.ceil((t - now.getTime()) / DAY_MS)
  if (days < 0) return { level: 'expired', daysLeft: days, label: `Vencida há ${Math.abs(days)} ${Math.abs(days) === 1 ? 'dia' : 'dias'}` }
  if (days < LICENSE_WARNING_DAYS) return { level: 'warning', daysLeft: days, label: days === 0 ? 'Vence hoje' : `Vence em ${days} ${days === 1 ? 'dia' : 'dias'}` }
  return { level: 'ok', daysLeft: days, label: `Válida por mais ${days.toLocaleString('pt-BR')} dias` }
}

/** Telefone fixo ou celular com DDD: (11) 4002-8922 / (11) 94002-8922 */
export function formatPhoneBr(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d.length ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())
}

export interface CompanyErrors {
  legalName?: string
  tradeName?: string
  cnpj?: string
  license?: string
  licenseValidUntil?: string
  address?: string
  email?: string
  phone?: string
  description?: string
}

export const DESCRIPTION_MAX = 280

export function companyErrors(c: CompanyState): CompanyErrors {
  const e: CompanyErrors = {}
  if (c.legalName.trim().length < 3) e.legalName = 'Informe a razão social como está no cartão CNPJ.'
  if (!c.tradeName.trim()) e.tradeName = 'Informe o nome fantasia (é o nome que o jogador vê).'
  const cnpj = validateCnpj(c.cnpj)
  if (!cnpj.ok) e.cnpj = cnpj.reason
  if (!c.license.trim()) e.license = 'Informe o número da autorização de funcionamento.'
  if (!c.licenseValidUntil || Number.isNaN(new Date(c.licenseValidUntil).getTime())) e.licenseValidUntil = 'Informe a data de validade.'
  if (c.address.trim().length < 10) e.address = 'Informe o endereço completo da sede.'
  if (!isValidEmail(c.email)) e.email = 'E-mail inválido.'
  const phoneDigits = c.phone.replace(/\D/g, '')
  if (phoneDigits.length < 10) e.phone = 'Telefone com DDD: 10 ou 11 dígitos.'
  if (c.description.length > DESCRIPTION_MAX) e.description = `Máximo de ${DESCRIPTION_MAX} caracteres.`
  return e
}

export function firstCompanyError(c: CompanyState): string | null {
  const e = companyErrors(c)
  const first = Object.values(e)[0]
  return first ?? null
}

/** Linha legal do rodapé do site (mesma usada no cabeçalho dos textos legais). */
export function legalFooterLine(c: CompanyState): string {
  return [c.legalName, `CNPJ ${formatCnpj(c.cnpj)}`, c.address].filter((x) => x && x.trim()).join(' · ')
}
