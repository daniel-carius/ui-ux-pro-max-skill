// Mensagens dentro do site: notificações do sino, popups e inbox.
// Regra-chave dos popups: no máximo UM popup por carregamento de página,
// o de maior prioridade entre os elegíveis (pickPopup).
import { type Audience, type PlayerTraits, audienceMatchesTraits, describeAudience } from './campanhas3-audience'

// ---------- Sino ----------

export type NotifIcon = 'bell' | 'gift' | 'trophy' | 'flame' | 'zap' | 'star' | 'megaphone' | 'party' | 'coins' | 'crown'

export interface Schedule {
  mode: 'agora' | 'agendar'
  /** "AAAA-MM-DDTHH:MM" no fuso local */
  at: string
}

export interface BellNotification {
  id: string
  title: string
  message: string
  icon: NotifIcon
  cta: { label: string; link: string } | null
  audience: Audience
  audienceLabel: string
  recipients: number
  reads: number
  clicks: number
  createdAt: string
  sendAt: string
  status: 'agendada' | 'enviada' | 'cancelada'
  createdBy: string
}

export const NOTIF_LIMITS = { title: 50, message: 160, ctaLabel: 20 }

export function validateLink(link: string): string | null {
  const v = link.trim()
  if (!v) return 'Informe o link.'
  if (v.startsWith('/')) return /\s/.test(v) ? 'O link não pode ter espaços.' : null
  if (/^https:\/\/[^\s/]+\.[^\s]+$/.test(v)) return null
  return 'Use um caminho do site (/promocoes) ou um endereço https://.'
}

export function scheduleError(s: Schedule, now: number = Date.now()): string | null {
  if (s.mode === 'agora') return null
  const t = new Date(s.at).getTime()
  if (!s.at || Number.isNaN(t)) return 'Escolha data e hora.'
  if (t <= now + 60_000) return 'O horário precisa estar no futuro.'
  if (t > now + 180 * 86_400_000) return 'Agende no máximo 180 dias à frente.'
  return null
}

export function scheduleIso(s: Schedule, now: number = Date.now()) {
  return s.mode === 'agora' ? new Date(now).toISOString() : new Date(s.at).toISOString()
}

/** Valor padrão do campo de agendamento: amanhã às 10:00. */
export function defaultScheduleAt(now: number = Date.now()) {
  const d = new Date(now + 86_400_000)
  d.setHours(10, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Status efetivo: agendada que já passou do horário vira enviada. */
export function effectiveStatus<S extends string>(status: S, sendAt: string, now: number = Date.now()): S | 'enviada' {
  if (status === ('agendada' as S) && new Date(sendAt).getTime() <= now) return 'enviada'
  return status
}

// ---------- Popups ----------

export type SitePage = 'home' | 'cassino' | 'esportes' | 'promocoes' | 'deposito' | 'perfil'

export const SITE_PAGES: SitePage[] = ['home', 'cassino', 'esportes', 'promocoes', 'deposito', 'perfil']

export const SITE_PAGE_LABEL: Record<SitePage, string> = {
  home: 'Página inicial',
  cassino: 'Cassino',
  esportes: 'Esportes',
  promocoes: 'Promoções',
  deposito: 'Depósito',
  perfil: 'Perfil',
}

export type PopupFrequency = 'uma_vez' | 'por_sessao' | 'sempre'

export const FREQUENCY_LABEL: Record<PopupFrequency, string> = {
  uma_vez: 'Uma vez',
  por_sessao: 'Por sessão',
  sempre: 'Sempre',
}

export interface Popup {
  id: string
  title: string
  image: string | null
  text: string
  button: { label: string; link: string }
  pages: SitePage[]
  audience: Audience
  /** 1 a 100: o maior vence */
  priority: number
  startAt: string
  endAt: string | null
  frequency: PopupFrequency
  active: boolean
  views: number
  clicks: number
  createdAt: string
  updatedAt: string
}

export type PopupState = 'ativo' | 'pausado' | 'agendado' | 'encerrado'

export function popupState(p: Popup, now: number = Date.now()): PopupState {
  if (p.endAt && new Date(p.endAt).getTime() < now) return 'encerrado'
  if (!p.active) return 'pausado'
  if (new Date(p.startAt).getTime() > now) return 'agendado'
  return 'ativo'
}

export const POPUP_LIMITS = { title: 60, text: 280, buttonLabel: 24 }

export type PopupDraft = Omit<Popup, 'id' | 'views' | 'clicks' | 'createdAt' | 'updatedAt'>

export function popupErrors(p: PopupDraft): Partial<Record<'title' | 'text' | 'buttonLabel' | 'buttonLink' | 'pages' | 'priority' | 'startAt' | 'endAt' | 'audience', string>> {
  const e: ReturnType<typeof popupErrors> = {}
  if (!p.title.trim()) e.title = 'Dê um título ao popup.'
  else if (p.title.length > POPUP_LIMITS.title) e.title = `Use até ${POPUP_LIMITS.title} caracteres.`
  if (!p.text.trim()) e.text = 'Escreva o texto do popup.'
  else if (p.text.length > POPUP_LIMITS.text) e.text = `Use até ${POPUP_LIMITS.text} caracteres.`
  if (!p.button.label.trim()) e.buttonLabel = 'Informe o rótulo do botão.'
  else if (p.button.label.length > POPUP_LIMITS.buttonLabel) e.buttonLabel = `Use até ${POPUP_LIMITS.buttonLabel} caracteres.`
  const le = validateLink(p.button.link)
  if (le) e.buttonLink = le
  if (!p.pages.length) e.pages = 'Escolha ao menos uma página.'
  if (!Number.isInteger(p.priority) || p.priority < 1 || p.priority > 100) e.priority = 'Prioridade de 1 a 100.'
  if (!p.startAt || Number.isNaN(new Date(p.startAt).getTime())) e.startAt = 'Informe o início.'
  if (p.endAt && new Date(p.endAt).getTime() <= new Date(p.startAt).getTime()) e.endAt = 'O fim precisa ser depois do início.'
  if (p.audience.kind === 'ids') e.audience = 'Popups usam segmentos. Para uma lista de IDs, use a Inbox.'
  return e
}

/** Visita simulada: o que o jogador já viu antes desta página. */
export type VisitKind = 'primeira' | 'nova_sessao' | 'mesma_sessao'

export const VISIT_LABEL: Record<VisitKind, string> = {
  primeira: 'Primeira visita',
  nova_sessao: 'Volta em outra sessão',
  mesma_sessao: 'Mesma sessão',
}

export interface PopupPickEntry {
  popup: Popup
  eligible: boolean
  won: boolean
  reason: string
}

export interface PopupPickResult {
  winner: Popup | null
  entries: PopupPickEntry[]
}

/**
 * Escolhe o popup de um carregamento de página: filtra os elegíveis (ativo,
 * no período, na página, no público e dentro da frequência) e mostra o de
 * maior prioridade. Empate: vence o editado mais recentemente.
 */
export function pickPopup(
  popups: Popup[],
  ctx: { page: SitePage; traits: PlayerTraits; visit: VisitKind; now?: number; levelName?: (n: number) => string },
): PopupPickResult {
  const now = ctx.now ?? Date.now()
  const checked = popups.map((p) => {
    const state = popupState(p, now)
    let reason = ''
    if (state === 'pausado') reason = 'Está pausado.'
    else if (state === 'encerrado') reason = 'O período já terminou.'
    else if (state === 'agendado') reason = `Só começa em ${new Date(p.startAt).toLocaleDateString('pt-BR')}.`
    else if (!p.pages.includes(ctx.page)) reason = `Não aparece em ${SITE_PAGE_LABEL[ctx.page]}.`
    else if (!audienceMatchesTraits(p.audience, ctx.traits)) reason = `Público é "${describeAudience(p.audience, ctx.levelName)}".`
    else if (p.frequency === 'uma_vez' && ctx.visit !== 'primeira') reason = 'Frequência "uma vez": o jogador já viu.'
    else if (p.frequency === 'por_sessao' && ctx.visit === 'mesma_sessao') reason = 'Frequência "uma vez por sessão": já apareceu nesta sessão.'
    return { popup: p, eligible: !reason, won: false, reason }
  })
  const eligible = checked
    .filter((c) => c.eligible)
    .sort((a, b) => b.popup.priority - a.popup.priority || b.popup.updatedAt.localeCompare(a.popup.updatedAt))
  const winner = eligible[0]?.popup ?? null
  for (const c of eligible) {
    if (c.popup === winner) {
      c.won = true
      c.reason = eligible.length > 1 ? `Maior prioridade entre ${eligible.length} elegíveis.` : 'Único elegível.'
    } else if (winner && c.popup.priority === winner.priority) {
      c.reason = `Empate na prioridade ${winner.priority}: vence o editado mais recentemente.`
    } else if (winner) {
      c.reason = `Prioridade ${c.popup.priority}, menor que ${winner.priority}.`
    }
  }
  const ineligible = checked.filter((c) => !c.eligible).sort((a, b) => b.popup.priority - a.popup.priority)
  return { winner, entries: [...eligible, ...ineligible] }
}

/** Páginas onde dois popups ativos têm a mesma prioridade (empate confuso). */
export function priorityTies(popups: Popup[], now: number = Date.now()) {
  const out: { page: SitePage; priority: number; titles: string[] }[] = []
  for (const page of SITE_PAGES) {
    const active = popups.filter((p) => popupState(p, now) === 'ativo' && p.pages.includes(page))
    const byPrio = new Map<number, string[]>()
    for (const p of active) byPrio.set(p.priority, [...(byPrio.get(p.priority) ?? []), p.title])
    for (const [priority, titles] of byPrio) if (titles.length > 1) out.push({ page, priority, titles })
  }
  return out
}

// ---------- Inbox ----------

export interface InboxMessage {
  id: string
  subject: string
  body: string
  audience: Audience
  audienceLabel: string
  recipients: number
  reads: number
  sendAt: string
  status: 'agendada' | 'enviada'
  createdAt: string
  createdBy: string
  /** some da inbox do jogador depois desta data */
  expiresAt: string | null
}

export const INBOX_LIMITS = { subject: 80, body: 2000 }
