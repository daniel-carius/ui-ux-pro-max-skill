// E-mail (Configurações › Integrações e Templates de e-mail).
// Validação das contas de envio e renderização dos templates com {{variáveis}}.
import type { IntegrationsState } from './system'

// ---------- Integrações ----------

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validateDomain(d: string): string | null {
  if (!d.trim()) return 'Informe o domínio de envio.'
  if (!DOMAIN_RE.test(d.trim())) return 'Domínio inválido. Ex.: mg.x2win.bet.br'
  return null
}

export function validateApiKey(k: string): string | null {
  if (!k.trim()) return 'Informe a chave de API.'
  if (k.trim().length < 16) return 'A chave tem pelo menos 16 caracteres.'
  if (/\s/.test(k.trim())) return 'A chave não tem espaços.'
  return null
}

export interface MailgunDraft {
  domain: string
  apiKey: string
  region: 'us' | 'eu'
}

export interface SendworkDraft {
  accountId: string
  apiKey: string
  smsSender: string
  rcsAgent: string
}

export function validateMailgun(d: MailgunDraft): Record<string, string> {
  const e: Record<string, string> = {}
  const dom = validateDomain(d.domain)
  if (dom) e.domain = dom
  const key = validateApiKey(d.apiKey)
  if (key) e.apiKey = key
  return e
}

export function validateSendwork(d: SendworkDraft): Record<string, string> {
  const e: Record<string, string> = {}
  if (!/^SW-\d{5,10}$/.test(d.accountId.trim())) e.accountId = 'Use o ID da conta no formato SW-12345.'
  const key = validateApiKey(d.apiKey)
  if (key) e.apiKey = key
  const s = d.smsSender.trim()
  if (!s) e.smsSender = 'Informe o remetente do SMS.'
  else if (!/^(\d{5,6}|[A-Za-z0-9]{3,11})$/.test(s)) e.smsSender = 'Use um short code (5 ou 6 números) ou um nome de 3 a 11 letras, sem espaço.'
  if (!d.rcsAgent.trim()) e.rcsAgent = 'Informe o agente RCS aprovado.'
  else if (!/^[a-z0-9][a-z0-9_-]{2,40}$/.test(d.rcsAgent.trim())) e.rcsAgent = 'Use letras minúsculas, números, hífen ou sublinhado.'
  return e
}

export function validateIntegrations(s: IntegrationsState): string | null {
  if (s.emailProvider === 'mailgun' && !s.mailgun.connected) return 'Conecte a conta Mailgun antes de usá-la para enviar e-mails.'
  if (s.emailProvider === 'sendwork' && !s.sendwork.connected) return 'Conecte a conta SendWork antes de usá-la para enviar e-mails.'
  const m = s.smtp
  if (s.emailProvider === 'smtp') {
    if (!m.host.trim()) return 'Informe o servidor SMTP.'
    if (!Number.isInteger(m.port) || m.port < 1 || m.port > 65535) return 'A porta SMTP vai de 1 a 65535.'
    if (!m.user.trim()) return 'Informe o usuário do SMTP.'
  }
  if (!m.fromName.trim()) return 'Informe o nome do remetente.'
  if (!EMAIL_RE.test(m.fromEmail.trim())) return 'O e-mail do remetente é inválido.'
  return null
}

export const PROVIDER_LABEL: Record<IntegrationsState['emailProvider'], string> = {
  smtp: 'Padrão da plataforma (SMTP)',
  mailgun: 'Mailgun',
  sendwork: 'SendWork',
}

// ---------- Templates ----------

export type TemplateCategory = 'conta' | 'financeiro' | 'kyc' | 'equipe'

export const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  conta: 'Conta e segurança',
  financeiro: 'Depósitos e saques',
  kyc: 'Verificação (KYC)',
  equipe: 'Equipe do painel',
}

export interface EmailTemplate {
  id: string
  name: string
  category: TemplateCategory
  /** quando é enviado */
  trigger: string
  subject: string
  body: string
  enabled: boolean
  /** e-mails de segurança não podem ser desligados */
  locked: boolean
  variables: string[]
  /** variáveis que precisam aparecer no texto */
  required: string[]
  updatedAt: string | null
  updatedBy: string | null
}

export const VARIABLE_SAMPLES: Record<string, { label: string; sample: string }> = {
  nome: { label: 'Nome do jogador', sample: 'Ana Paula' },
  email: { label: 'E-mail', sample: 'ana.paula@email.com' },
  site: { label: 'Nome do site', sample: 'X2Win' },
  link_redefinicao: { label: 'Link para redefinir', sample: 'https://x2win.bet.br/redefinir?t=DEMO' },
  link_verificacao: { label: 'Link de verificação', sample: 'https://x2win.bet.br/verificar?t=DEMO' },
  link_convite: { label: 'Link do convite', sample: 'https://painel.x2win.bet.br/convite?t=DEMO' },
  link_site: { label: 'Endereço do site', sample: 'https://x2win.bet.br' },
  codigo: { label: 'Código de 6 dígitos', sample: '482 915' },
  validade: { label: 'Validade do link/código', sample: '30 minutos' },
  valor: { label: 'Valor', sample: 'R$ 150,00' },
  saldo: { label: 'Saldo atual', sample: 'R$ 312,40' },
  id_transacao: { label: 'ID da transação', sample: 'SQ73418' },
  motivo: { label: 'Motivo', sample: 'Dados do PIX divergentes do titular' },
  cargo: { label: 'Cargo', sample: 'Financeiro' },
  convidado_por: { label: 'Quem convidou', sample: 'Daniel Carius' },
  data: { label: 'Data e hora', sample: '09/10/2026 14:32' },
  bonus: { label: 'Bônus de boas-vindas', sample: '100% até R$ 500,00' },
}

const VAR_RE = /\{\{\s*([a-z_]+)\s*\}\}/g

export function usedVariables(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(VAR_RE)) out.add(m[1])
  return [...out]
}

export interface TemplateCheck {
  errors: string[]
  warnings: string[]
}

export function validateTemplate(t: Pick<EmailTemplate, 'subject' | 'body' | 'variables' | 'required'>): TemplateCheck {
  const errors: string[] = []
  const warnings: string[] = []
  if (!t.subject.trim()) errors.push('O assunto não pode ficar vazio.')
  if (t.subject.length > 120) errors.push('O assunto tem no máximo 120 caracteres.')
  if (!t.body.trim()) errors.push('O corpo não pode ficar vazio.')
  const used = usedVariables(`${t.subject}\n${t.body}`)
  const unknown = used.filter((v) => !t.variables.includes(v))
  if (unknown.length) errors.push(`Variáveis que não existem neste e-mail: ${unknown.map((v) => `{{${v}}}`).join(', ')}.`)
  const missing = t.required.filter((v) => !used.includes(v))
  if (missing.length) errors.push(`Falta ${missing.map((v) => `{{${v}}}`).join(', ')}: sem isso o e-mail não funciona.`)
  const broken = (t.body.match(/\{\{/g)?.length ?? 0) !== (t.body.match(/\}\}/g)?.length ?? 0)
  if (broken) errors.push('Há uma variável sem fechar. Use {{nome}}.')
  if (t.subject.length > 70) warnings.push('Assuntos com mais de 70 caracteres costumam ser cortados no celular.')
  return { errors, warnings }
}

export function fillVariables(text: string, values: Record<string, string> = {}): string {
  return text.replace(VAR_RE, (all, name: string) => values[name] ?? VARIABLE_SAMPLES[name]?.sample ?? all)
}

export type EmailBlock =
  | { type: 'p'; parts: { text: string; bold: boolean }[] }
  | { type: 'button'; label: string; href: string }
  | { type: 'code'; text: string }

/**
 * Converte o corpo em blocos para a prévia:
 * parágrafos separados por linha em branco, **negrito**,
 * [Texto do botão](link) sozinho na linha vira botão e
 * uma linha só com {{codigo}} vira um código em destaque.
 */
export function renderEmailBlocks(body: string, values?: Record<string, string>): EmailBlock[] {
  const blocks: EmailBlock[] = []
  for (const para of body.split(/\n\s*\n/)) {
    const raw = para.trim()
    if (!raw) continue
    const btn = raw.match(/^\[(.+?)\]\((.+?)\)$/)
    if (btn) {
      blocks.push({ type: 'button', label: fillVariables(btn[1], values), href: fillVariables(btn[2], values) })
      continue
    }
    if (/^\{\{\s*codigo\s*\}\}$/.test(raw)) {
      blocks.push({ type: 'code', text: fillVariables(raw, values) })
      continue
    }
    const text = fillVariables(raw, values)
    const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((s) => (s.startsWith('**') && s.endsWith('**') ? { text: s.slice(2, -2), bold: true } : { text: s, bold: false }))
    blocks.push({ type: 'p', parts })
  }
  return blocks
}
