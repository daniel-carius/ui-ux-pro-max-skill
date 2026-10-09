// Disparos de e-mail, SMS e RCS: contagem de SMS, variáveis, custo e métricas.
// SMS e RCS dependem de uma conta SendWork (availableChannels em domain/system).
import { createRng } from '@/lib/random'
import type { Audience } from './campanhas3-audience'

export type DisparoChannel = 'email' | 'sms' | 'rcs'

export const DISPARO_CHANNEL_LABEL: Record<DisparoChannel, string> = { email: 'E-mail', sms: 'SMS', rcs: 'RCS' }

export interface EmailContent {
  subject: string
  preheader: string
  body: string
  ctaLabel: string
  ctaLink: string
}

export interface SmsContent {
  text: string
  /** acrescenta a instrução de descadastro no fim */
  optOut: boolean
}

export interface RcsContent {
  title: string
  text: string
  image: string | null
  buttonLabel: string
  buttonLink: string
  /** quem não tem RCS recebe o texto por SMS */
  smsFallback: boolean
}

export interface Disparo {
  id: string
  name: string
  channel: DisparoChannel
  audience: Audience
  audienceLabel: string
  recipients: number
  /** assunto do e-mail, título do RCS ou início do SMS */
  headline: string
  email?: EmailContent
  sms?: SmsContent
  rcs?: RcsContent
  /** partes de SMS por destinatário */
  segments?: number
  sendAt: string
  createdAt: string
  createdBy: string
  status: 'agendado' | 'enviado' | 'cancelado'
}

export const SMS_OPT_OUT = ' Sair: responda SAIR'

/** Variáveis aceitas no conteúdo, com exemplo para a prévia. */
export const TEMPLATE_VARS = [
  { key: 'nome', label: 'Nome' },
  { key: 'primeiro_nome', label: 'Primeiro nome' },
  { key: 'saldo', label: 'Saldo' },
  { key: 'nivel', label: 'Nível' },
  { key: 'link', label: 'Link do site' },
] as const

export type TemplateVarKey = (typeof TEMPLATE_VARS)[number]['key']

export function renderVars(text: string, vars: Partial<Record<TemplateVarKey, string>>) {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => (k in vars ? (vars[k as TemplateVarKey] ?? m) : m))
}

/** Variáveis escritas errado (ex.: {{nomee}}). */
export function unknownVars(text: string): string[] {
  const keys = TEMPLATE_VARS.map((v) => v.key as string)
  const out: string[] = []
  for (const m of text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) if (!keys.includes(m[1]) && !out.includes(m[1])) out.push(m[1])
  return out
}

// ---------- SMS ----------

const GSM7 =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM7_EXT = '^{}\\[~]|€'

export interface SmsInfo {
  encoding: 'GSM-7' | 'UCS-2'
  length: number
  /** caracteres por parte (160/153 ou 70/67) */
  perSegment: number
  /** limite de uma parte só */
  single: number
  segments: number
  /** caracteres que forçam UCS-2 */
  offenders: string[]
}

/** Conta caracteres e partes de um SMS. Acentos como á, ã, ç e õ mudam para UCS-2 (70 por parte). */
export function smsInfo(text: string): SmsInfo {
  const chars = [...text]
  const offenders: string[] = []
  let gsmLen = 0
  for (const c of chars) {
    if (GSM7.includes(c)) gsmLen += 1
    else if (GSM7_EXT.includes(c)) gsmLen += 2
    else if (!offenders.includes(c)) offenders.push(c)
  }
  if (!offenders.length) {
    const segments = gsmLen === 0 ? 0 : gsmLen <= 160 ? 1 : Math.ceil(gsmLen / 153)
    return { encoding: 'GSM-7', length: gsmLen, perSegment: segments > 1 ? 153 : 160, single: 160, segments, offenders }
  }
  const len = chars.length
  const segments = len <= 70 ? 1 : Math.ceil(len / 67)
  return { encoding: 'UCS-2', length: len, perSegment: segments > 1 ? 67 : 70, single: 70, segments, offenders }
}

export function stripAccents(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export const SMS_MAX_SEGMENTS = 4

/** Preço de referência por mensagem (estimativa da SendWork, demonstração). */
export const PRICE = { smsSegment: 0.06, rcs: 0.09 }

export function estimateCost(channel: DisparoChannel, recipients: number, segments: number, rcsShare = 1) {
  if (channel === 'email') return 0
  if (channel === 'sms') return Math.round(recipients * segments * PRICE.smsSegment * 100) / 100
  const rcs = Math.round(recipients * rcsShare)
  const sms = recipients - rcs
  return Math.round((rcs * PRICE.rcs + sms * segments * PRICE.smsSegment) * 100) / 100
}

// ---------- Métricas simuladas ----------

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h
}

export interface DisparoMetrics {
  sent: number
  delivered: number
  /** null quando o canal não informa abertura (SMS) */
  opened: number | null
  clicked: number
}

/**
 * Métricas de entrega (simuladas e fixas pelo ID). Abertura e clique crescem
 * nas primeiras 24 horas depois do envio.
 */
export function disparoMetrics(d: Disparo, now: number = Date.now()): DisparoMetrics {
  const sendAt = new Date(d.sendAt).getTime()
  if (d.status === 'cancelado' || sendAt > now) return { sent: 0, delivered: 0, opened: d.channel === 'sms' ? null : 0, clicked: 0 }
  const rng = createRng(hash(d.id))
  const ramp = Math.max(0.2, Math.min(1, (now - sendAt) / 86_400_000))
  const sent = d.recipients
  const deliveredRate = d.channel === 'email' ? rng.float(0.93, 0.985, 3) : rng.float(0.955, 0.99, 3)
  const delivered = Math.round(sent * deliveredRate)
  if (d.channel === 'sms') return { sent, delivered, opened: null, clicked: Math.round(delivered * rng.float(0.018, 0.06, 3) * ramp) }
  const openRate = d.channel === 'email' ? rng.float(0.17, 0.34, 3) : rng.float(0.52, 0.74, 3)
  const opened = Math.round(delivered * openRate * ramp)
  const ctr = d.channel === 'email' ? rng.float(0.08, 0.22, 3) : rng.float(0.12, 0.28, 3)
  return { sent, delivered, opened, clicked: Math.round(opened * ctr) }
}

export function effectiveDisparoStatus(d: Disparo, now: number = Date.now()): Disparo['status'] {
  if (d.status === 'agendado' && new Date(d.sendAt).getTime() <= now) return 'enviado'
  return d.status
}

// ---------- Validação ----------

export interface DisparoDraft {
  name: string
  channel: DisparoChannel
  email: EmailContent
  sms: SmsContent
  rcs: RcsContent
}

export type DisparoField =
  | 'name'
  | 'channel'
  | 'subject'
  | 'preheader'
  | 'body'
  | 'ctaLabel'
  | 'ctaLink'
  | 'smsText'
  | 'rcsTitle'
  | 'rcsText'
  | 'rcsButtonLabel'
  | 'rcsButtonLink'

export function disparoErrors(d: DisparoDraft, channels: { email: boolean; sms: boolean; rcs: boolean }): Partial<Record<DisparoField, string>> {
  const e: Partial<Record<DisparoField, string>> = {}
  const link = (v: string) => (/^(\/\S*|https:\/\/\S+\.\S+)$/.test(v.trim()) ? null : 'Use um caminho do site (/promocoes) ou https://.')
  const vars = (v: string) => {
    const u = unknownVars(v)
    return u.length ? `Variável desconhecida: {{${u[0]}}}.` : null
  }
  if (!d.name.trim()) e.name = 'Dê um nome interno ao disparo.'
  if (!channels[d.channel]) e.channel = 'Canal indisponível: conecte a SendWork em Integrações.'
  if (d.channel === 'email') {
    if (!d.email.subject.trim()) e.subject = 'Escreva o assunto.'
    else if (d.email.subject.length > 90) e.subject = 'Assunto longo demais (máximo 90).'
    else e.subject = vars(d.email.subject) ?? undefined
    if (d.email.preheader.length > 120) e.preheader = 'Máximo de 120 caracteres.'
    if (!d.email.body.trim()) e.body = 'Escreva o corpo do e-mail.'
    else e.body = vars(d.email.body) ?? undefined
    if (d.email.ctaLabel.trim() || d.email.ctaLink.trim()) {
      if (!d.email.ctaLabel.trim()) e.ctaLabel = 'Informe o texto do botão.'
      e.ctaLink = link(d.email.ctaLink) ?? undefined
    }
  }
  if (d.channel === 'sms') {
    const full = d.sms.text + (d.sms.optOut ? SMS_OPT_OUT : '')
    const info = smsInfo(full)
    if (!d.sms.text.trim()) e.smsText = 'Escreva a mensagem.'
    else if (info.segments > SMS_MAX_SEGMENTS) e.smsText = `Mensagem longa demais: ${info.segments} partes (máximo ${SMS_MAX_SEGMENTS}).`
    else e.smsText = vars(d.sms.text) ?? undefined
  }
  if (d.channel === 'rcs') {
    if (!d.rcs.title.trim()) e.rcsTitle = 'Escreva o título do cartão.'
    else if (d.rcs.title.length > 200) e.rcsTitle = 'Máximo de 200 caracteres.'
    if (!d.rcs.text.trim()) e.rcsText = 'Escreva o texto do cartão.'
    else if (d.rcs.text.length > 2000) e.rcsText = 'Máximo de 2.000 caracteres.'
    else e.rcsText = vars(d.rcs.text) ?? undefined
    if (!d.rcs.buttonLabel.trim()) e.rcsButtonLabel = 'Informe o texto do botão.'
    else if (d.rcs.buttonLabel.length > 25) e.rcsButtonLabel = 'Máximo de 25 caracteres.'
    e.rcsButtonLink = link(d.rcs.buttonLink) ?? undefined
  }
  for (const k of Object.keys(e) as DisparoField[]) if (!e[k]) delete e[k]
  return e
}
