// Regras de Configurações › Cadastro e KYC.
// Achado de auditoria nº 8 (regulatório): sem a data de nascimento, a idade
// mínima de 18 anos não é verificada no cadastro (Lei 14.790/2023). Por isso o
// padrão é exigir a data, e desligar pede confirmação explícita.

export const SIGNUP_KEY = 'config.cadastro'

export const MIN_AGE = 18

export type IdentityMode = 'nome' | 'nick'
export type KycMoment = 'cadastro' | 'primeiro_saque' | 'valor_depositado'

export type SignupField = 'cpf' | 'birthDate' | 'phone' | 'address' | 'emailConfirm' | 'marketingOptIn'
export type KycDocument = 'photoId' | 'selfie' | 'proofOfAddress'

export interface SignupConfig {
  identity: IdentityMode
  /** true = obrigatório; false = opcional (o jogador pode completar depois no perfil) */
  required: Record<SignupField, boolean>
  kycMoment: KycMoment
  /** usado quando kycMoment = valor_depositado */
  kycThreshold: number
  documents: Record<KycDocument, boolean>
}

export const DEFAULT_SIGNUP: SignupConfig = {
  identity: 'nome',
  required: { cpf: true, birthDate: true, phone: true, address: false, emailConfirm: true, marketingOptIn: false },
  kycMoment: 'primeiro_saque',
  kycThreshold: 2000,
  documents: { photoId: true, selfie: true, proofOfAddress: false },
}

export const FIELD_META: Record<SignupField, { label: string; description: string }> = {
  cpf: { label: 'CPF', description: 'Identifica o apostador e bloqueia contas duplicadas.' },
  birthDate: { label: 'Data de nascimento', description: `Confere a idade mínima de ${MIN_AGE} anos já no cadastro.` },
  phone: { label: 'Celular', description: 'Recuperação de conta e avisos por SMS.' },
  address: { label: 'Endereço', description: 'Cidade e UF entram nos relatórios regulatórios.' },
  emailConfirm: { label: 'Confirmação de e-mail', description: 'O jogador clica no link enviado antes de depositar.' },
  marketingOptIn: { label: 'Aceite de comunicações', description: 'Consentimento para receber ofertas por e-mail, SMS e push.' },
}

export const DOC_META: Record<KycDocument, { label: string; description: string }> = {
  photoId: { label: 'Documento com foto', description: 'RG, CNH ou passaporte, frente e verso.' },
  selfie: { label: 'Selfie (prova de vida)', description: 'Compara o rosto com a foto do documento.' },
  proofOfAddress: { label: 'Comprovante de endereço', description: 'Conta de consumo dos últimos 90 dias.' },
}

/** Idade completa na data `now`. */
export function ageOn(birthISO: string, now: Date = new Date()): number | null {
  const b = new Date(birthISO.length === 10 ? `${birthISO}T12:00:00` : birthISO)
  if (Number.isNaN(b.getTime())) return null
  let age = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--
  return age
}

export type AgeCheck = { status: 'ok'; age: number } | { status: 'minor'; age: number } | { status: 'invalid' } | { status: 'not_checked' }

/** O que acontece no cadastro com a data informada (ou sem ela). */
export function checkSignupAge(cfg: SignupConfig, birthISO: string, now: Date = new Date()): AgeCheck {
  if (!birthISO) return cfg.required.birthDate ? { status: 'invalid' } : { status: 'not_checked' }
  const age = ageOn(birthISO, now)
  if (age == null || age > 120 || age < 0) return { status: 'invalid' }
  return age >= MIN_AGE ? { status: 'ok', age } : { status: 'minor', age }
}

export interface SignupRisk {
  tone: 'danger' | 'warning' | 'info'
  title: string
  text: string
}

export function signupRisks(c: SignupConfig): SignupRisk[] {
  const out: SignupRisk[] = []
  if (!c.required.birthDate)
    out.push({
      tone: 'danger',
      title: 'Idade mínima não verificada no cadastro',
      text: `Sem a data de nascimento, a idade mínima de ${MIN_AGE} anos não é verificada no cadastro (Lei 14.790/2023). Um menor de idade pode criar conta e depositar antes do KYC.`,
    })
  if (c.required.marketingOptIn)
    out.push({
      tone: 'warning',
      title: 'Consentimento forçado (LGPD)',
      text: 'Pela LGPD, o consentimento para marketing precisa ser livre. Tornar o aceite obrigatório para criar a conta pode invalidar esse consentimento. Recomendado: deixar opcional.',
    })
  if (!c.required.cpf)
    out.push({ tone: 'warning', title: 'Contas duplicadas', text: 'Sem CPF no cadastro, a mesma pessoa pode abrir várias contas para repetir bônus de boas-vindas.' })
  if (!c.documents.selfie)
    out.push({ tone: 'warning', title: 'Sem prova de vida', text: 'Sem a selfie, não há como confirmar que o documento é de quem está jogando.' })
  if (c.kycMoment === 'valor_depositado' && c.kycThreshold > 5000)
    out.push({ tone: 'warning', title: 'KYC tardio', text: 'Acima de R$ 5.000,00 depositados sem verificação, cresce o risco de lavagem de dinheiro e de conta de terceiros.' })
  return out
}

export function validateSignup(c: SignupConfig): string | null {
  if (!c.documents.photoId && !c.documents.selfie && !c.documents.proofOfAddress) return 'Escolha ao menos um documento para o KYC.'
  if (c.kycMoment === 'valor_depositado' && !(c.kycThreshold > 0)) return 'Informe a partir de quanto depositado o KYC é pedido.'
  return null
}
