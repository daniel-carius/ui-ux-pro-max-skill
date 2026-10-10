// Regras de Configurações › Suporte e contato.
// A Ouvidoria é canal obrigatório: sem e-mail ou telefone dela, não salva.
import { apiValue } from '@/data/demo'
import { isValidEmail } from './config1-empresa'

export const SUPPORT_KEY = 'config.suporte'

export type ChatProvider = 'nenhum' | 'intercom' | 'zendesk' | 'crisp' | 'tawk'

export const CHAT_PROVIDERS: Record<ChatProvider, { label: string; idLabel: string; placeholder: string; hint: string }> = {
  nenhum: { label: 'Nenhum', idLabel: 'ID do widget', placeholder: '', hint: '' },
  intercom: { label: 'Intercom', idLabel: 'App ID', placeholder: 'DEMO-a1b2c3d4', hint: 'Em Intercom › Settings › Installation › Web.' },
  zendesk: { label: 'Zendesk', idLabel: 'Chave do widget (key)', placeholder: 'DEMO-0f1e2d3c-4b5a-6978', hint: 'Em Zendesk Admin › Canais › Widget da Web › Instalação.' },
  crisp: { label: 'Crisp', idLabel: 'Website ID', placeholder: 'DEMO-7c9e6679-7425-40de', hint: 'Em Crisp › Settings › Website Settings › Setup instructions.' },
  tawk: { label: 'Tawk.to', idLabel: 'Property ID / Widget ID', placeholder: 'DEMO-64f1a2b3c4d5/1h8demo', hint: 'Em Tawk.to › Administration › Chat Widget.' },
}

export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const
export const WEEKDAYS_LONG = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const

export interface SupportConfig {
  chat: { provider: ChatProvider; widgetId: string; position: 'direita' | 'esquerda'; onlyLoggedIn: boolean }
  hours: { always: boolean; days: boolean[]; open: string; close: string }
  email: string
  whatsapp: string
  phone: string
  helpCenterUrl: string
  ombudsman: { email: string; phone: string; hours: string }
}

export const DEFAULT_SUPPORT: SupportConfig = apiValue<SupportConfig>(
  {
    chat: { provider: 'crisp', widgetId: 'DEMO-7c9e6679-7425-40de-944b', position: 'direita', onlyLoggedIn: false },
    hours: { always: false, days: [false, true, true, true, true, true, true], open: '08:00', close: '23:00' },
    email: 'suporte@x2win.bet.br',
    whatsapp: '5511940028922',
    phone: '08000000000',
    helpCenterUrl: 'https://ajuda.x2win.bet.br',
    ombudsman: { email: 'ouvidoria@x2win.bet.br', phone: '08000000001', hours: 'Dias úteis, das 9h às 18h' },
  },
  // modo API, sem nada gravado: sem chat e sem contatos de demonstração (a Ouvidoria precisa ser preenchida)
  (): SupportConfig => ({
    chat: { provider: 'nenhum', widgetId: '', position: 'direita', onlyLoggedIn: false },
    hours: { always: false, days: [false, true, true, true, true, true, true], open: '08:00', close: '23:00' },
    email: '',
    whatsapp: '',
    phone: '',
    helpCenterUrl: '',
    ombudsman: { email: '', phone: '', hours: '' },
  }),
)

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

export type SupportErrors = Partial<Record<'widgetId' | 'days' | 'hours' | 'email' | 'whatsapp' | 'phone' | 'helpCenterUrl' | 'ombudsman' | 'ombudsmanEmail', string>>

export function supportErrors(c: SupportConfig): SupportErrors {
  const e: SupportErrors = {}
  if (c.chat.provider !== 'nenhum' && c.chat.widgetId.trim().length < 6) e.widgetId = `Informe o ${CHAT_PROVIDERS[c.chat.provider].idLabel} do ${CHAT_PROVIDERS[c.chat.provider].label}.`
  if (!c.hours.always) {
    if (!c.hours.days.some(Boolean)) e.days = 'Escolha ao menos um dia de atendimento.'
    if (toMin(c.hours.close) <= toMin(c.hours.open)) e.hours = 'O horário de fim precisa ser depois do início.'
  }
  if (c.email && !isValidEmail(c.email)) e.email = 'E-mail inválido.'
  const wa = c.whatsapp.replace(/\D/g, '')
  if (wa && (wa.length < 12 || wa.length > 13)) e.whatsapp = 'Use o número com país e DDD: 55 + DDD + número.'
  const ph = c.phone.replace(/\D/g, '')
  if (ph && ph.length < 10) e.phone = 'Telefone com DDD ou 0800 completo.'
  if (c.helpCenterUrl && !/^https:\/\/[^\s.]+\.[^\s]+$/.test(c.helpCenterUrl)) e.helpCenterUrl = 'Use um endereço completo começando com https://'
  if (!c.ombudsman.email.trim() && !c.ombudsman.phone.replace(/\D/g, '')) e.ombudsman = 'A Ouvidoria é canal obrigatório: informe e-mail ou telefone.'
  if (c.ombudsman.email && !isValidEmail(c.ombudsman.email)) e.ombudsmanEmail = 'E-mail da Ouvidoria inválido.'
  return e
}

export function validateSupport(c: SupportConfig): string | null {
  return Object.values(supportErrors(c))[0] ?? null
}

/** Se o atendimento está aberto agora e quando abre/fecha. */
export function supportStatus(c: SupportConfig, now: Date = new Date()): { open: boolean; label: string } {
  if (c.hours.always) return { open: true, label: 'Atendimento 24 horas, todos os dias' }
  const days = c.hours.days
  if (!days.some(Boolean)) return { open: false, label: 'Sem dias de atendimento' }
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const o = toMin(c.hours.open)
  const cl = toMin(c.hours.close)
  const today = now.getDay()
  if (days[today] && nowMin >= o && nowMin < cl) return { open: true, label: `Aberto agora · fecha às ${c.hours.close}` }
  // próximo dia/horário de abertura
  for (let k = 0; k <= 7; k++) {
    const d = (today + k) % 7
    if (!days[d]) continue
    if (k === 0 && nowMin < o) return { open: false, label: `Fechado agora · abre hoje às ${c.hours.open}` }
    if (k === 0) continue
    return { open: false, label: `Fechado agora · abre ${k === 1 ? 'amanhã' : WEEKDAYS_LONG[d]} às ${c.hours.open}` }
  }
  return { open: false, label: 'Fechado agora' }
}

/** "Seg a Sáb, 08:00 às 23:00" */
export function hoursLabel(c: SupportConfig): string {
  if (c.hours.always) return '24 horas, todos os dias'
  const idx = c.hours.days.map((on, i) => (on ? i : -1)).filter((i) => i >= 0)
  if (!idx.length) return 'Sem atendimento'
  // agrupa sequências (seg..sáb)
  const order = [1, 2, 3, 4, 5, 6, 0].filter((i) => c.hours.days[i])
  const groups: number[][] = []
  for (const d of order) {
    const g = groups[groups.length - 1]
    const prev = g?.[g.length - 1]
    const isNext = prev !== undefined && (prev === 6 ? d === 0 : d === prev + 1)
    if (g && isNext) g.push(d)
    else groups.push([d])
  }
  const days = groups.map((g) => (g.length >= 3 ? `${WEEKDAYS[g[0]]} a ${WEEKDAYS[g[g.length - 1]]}` : g.map((d) => WEEKDAYS[d]).join(', '))).join(', ')
  return `${idx.length === 7 ? 'Todos os dias' : days}, ${c.hours.open} às ${c.hours.close}`
}

export function formatWhatsapp(v: string) {
  const d = v.replace(/\D/g, '')
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`
  if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`
  return v
}

export function formatPhoneOr0800(v: string) {
  const d = v.replace(/\D/g, '')
  if (d.startsWith('0800') && d.length === 11) return `0800 ${d.slice(4, 7)} ${d.slice(7)}`
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return v
}

export function channelCount(c: SupportConfig) {
  const list = [c.chat.provider !== 'nenhum', !!c.email, !!c.whatsapp.replace(/\D/g, ''), !!c.phone.replace(/\D/g, ''), !!c.helpCenterUrl, !!(c.ombudsman.email || c.ombudsman.phone)]
  return { on: list.filter(Boolean).length, total: list.length }
}
