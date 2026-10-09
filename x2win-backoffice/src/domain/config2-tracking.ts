// Pixels e tracking (Configurações › Pixels e tracking).
// Formato do ID por plataforma, nome padrão de cada evento e o teste simulado.

export type TrackingPlatform = 'meta' | 'tiktok' | 'kwai' | 'ga4'
export type TrackingEvent = 'pageview' | 'signup' | 'deposit_amount' | 'pix_start' | 'deposit_paid'

export interface PlatformConfig {
  active: boolean
  pixelId: string
  /** token da API de conversões (servidor) */
  token: string
  /** código de teste do gerenciador de eventos (opcional) */
  testCode: string
  events: Record<TrackingEvent, boolean>
}

export interface TrackingConfig {
  platforms: Record<TrackingPlatform, PlatformConfig>
  /** páginas que disparam PageView */
  pageViewPages: string[]
  /** envia também pelo servidor quando há token (dedup por event_id) */
  serverSide: boolean
}

export interface PlatformDef {
  id: TrackingPlatform
  name: string
  idLabel: string
  idPlaceholder: string
  idHint: string
  tokenLabel: string
  testCodeLabel: string | null
  /** cor da marca para o selo (usa a paleta de gráficos) */
  slot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  short: string
}

export const PLATFORMS: PlatformDef[] = [
  {
    id: 'meta',
    name: 'Meta (Facebook e Instagram)',
    idLabel: 'ID do pixel',
    idPlaceholder: '123456789012345',
    idHint: '15 ou 16 números. Fica no Gerenciador de Eventos.',
    tokenLabel: 'Token da API de Conversões',
    testCodeLabel: 'Código de evento de teste',
    slot: 1,
    short: 'M',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    idLabel: 'ID do pixel',
    idPlaceholder: 'C9ABCDEFGHIJKLMNOPQR',
    idHint: '20 letras maiúsculas e números. Fica em Eventos › Pixel.',
    tokenLabel: 'Access token da Events API',
    testCodeLabel: 'Código de evento de teste',
    slot: 8,
    short: 'T',
  },
  {
    id: 'kwai',
    name: 'Kwai',
    idLabel: 'ID do pixel',
    idPlaceholder: '274859301746553',
    idHint: 'De 12 a 20 números. Fica no Kwai for Business › Ferramentas.',
    tokenLabel: 'Access token da API de eventos',
    testCodeLabel: null,
    slot: 4,
    short: 'K',
  },
  {
    id: 'ga4',
    name: 'Google Analytics (GA4)',
    idLabel: 'ID de métricas',
    idPlaceholder: 'G-AB12CD34EF',
    idHint: 'Começa com G- e tem de 8 a 12 letras e números.',
    tokenLabel: 'API secret do Measurement Protocol',
    testCodeLabel: null,
    slot: 3,
    short: 'G',
  },
]

export const PLATFORM_BY_ID = Object.fromEntries(PLATFORMS.map((p) => [p.id, p])) as Record<TrackingPlatform, PlatformDef>

const ID_RULES: Record<TrackingPlatform, RegExp> = {
  meta: /^\d{15,16}$/,
  tiktok: /^[A-Z0-9]{20}$/,
  kwai: /^\d{12,20}$/,
  ga4: /^G-[A-Z0-9]{8,12}$/,
}

/** Valida o ID no formato de cada plataforma. Vazio só é aceito com o pixel desligado. */
export function validatePixelId(platform: TrackingPlatform, id: string, active: boolean): string | null {
  const v = id.trim()
  if (!v) return active ? 'Informe o ID para ligar o pixel.' : null
  if (/\s/.test(id.trim())) return 'Sem espaços.'
  if (!ID_RULES[platform].test(v)) {
    if (platform === 'ga4' && !v.startsWith('G-')) return 'O ID do GA4 começa com "G-". IDs "UA-" são do Analytics antigo e não funcionam mais.'
    if (platform === 'tiktok' && v !== v.toUpperCase()) return 'Use letras maiúsculas.'
    return `Formato inválido. ${PLATFORM_BY_ID[platform].idHint}`
  }
  return null
}

export interface EventDef {
  id: TrackingEvent
  label: string
  description: string
  /** nome padrão do evento em cada plataforma */
  names: Record<TrackingPlatform, string>
  sendsValue: boolean
}

export const EVENTS: EventDef[] = [
  {
    id: 'pageview',
    label: 'PageView por página',
    description: 'A cada página aberta, nas páginas escolhidas abaixo.',
    names: { meta: 'PageView', tiktok: 'Pageview', kwai: 'EVENT_CONTENT_VIEW', ga4: 'page_view' },
    sendsValue: false,
  },
  {
    id: 'signup',
    label: 'Cadastro concluído',
    description: 'Quando a conta é criada e o e-mail confirmado.',
    names: { meta: 'CompleteRegistration', tiktok: 'CompleteRegistration', kwai: 'EVENT_COMPLETE_REGISTRATION', ga4: 'sign_up' },
    sendsValue: false,
  },
  {
    id: 'deposit_amount',
    label: 'Escolha do valor do depósito',
    description: 'Quando o jogador escolhe o valor e avança.',
    names: { meta: 'InitiateCheckout', tiktok: 'InitiateCheckout', kwai: 'EVENT_INITIATED_CHECKOUT', ga4: 'begin_checkout' },
    sendsValue: true,
  },
  {
    id: 'pix_start',
    label: 'Início do PIX',
    description: 'Quando o QR Code do PIX é gerado.',
    names: { meta: 'AddPaymentInfo', tiktok: 'AddPaymentInfo', kwai: 'EVENT_ADD_PAYMENT_INFO', ga4: 'add_payment_info' },
    sendsValue: true,
  },
  {
    id: 'deposit_paid',
    label: 'Depósito confirmado',
    description: 'Quando o gateway confirma o PIX. Envia o valor em reais (BRL).',
    names: { meta: 'Purchase', tiktok: 'CompletePayment', kwai: 'EVENT_PURCHASE', ga4: 'purchase' },
    sendsValue: true,
  },
]

export const EVENT_BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e])) as Record<TrackingEvent, EventDef>

export const PAGEVIEW_PAGES = [
  { id: 'home', label: 'Página inicial' },
  { id: 'cassino', label: 'Cassino' },
  { id: 'jogo', label: 'Página do jogo' },
  { id: 'esportes', label: 'Esportes' },
  { id: 'promocoes', label: 'Promoções' },
  { id: 'cadastro', label: 'Cadastro' },
  { id: 'deposito', label: 'Depósito' },
  { id: 'perfil', label: 'Perfil do jogador' },
]

export function validateTracking(c: TrackingConfig): string | null {
  for (const p of PLATFORMS) {
    const cfg = c.platforms[p.id]
    const err = validatePixelId(p.id, cfg.pixelId, cfg.active)
    if (err) return `${p.name}: ${err}`
  }
  if (c.platforms && Object.values(c.platforms).some((p) => p.active && p.events.pageview) && c.pageViewPages.length === 0)
    return 'Escolha ao menos uma página para o PageView, ou desligue o evento.'
  return null
}

export type TestStatus = 'ok' | 'aviso' | 'erro'

export interface TrackingTestEntry {
  id: string
  at: string
  platform: TrackingPlatform
  event: TrackingEvent
  eventName: string
  status: TestStatus
  channel: 'navegador' | 'navegador + servidor' | '—'
  detail: string
  payload: string
}

/** Simula o envio de um evento de teste com a configuração atual. */
export function simulateTrackingTest(
  c: TrackingConfig,
  platform: TrackingPlatform,
  event: TrackingEvent,
  sample: { value: number; eventId: string },
): Omit<TrackingTestEntry, 'id' | 'at'> {
  const cfg = c.platforms[platform]
  const ev = EVENT_BY_ID[event]
  const eventName = ev.names[platform]
  const payload: Record<string, unknown> = { event: eventName, event_id: sample.eventId }
  if (ev.sendsValue) Object.assign(payload, { value: sample.value, currency: 'BRL' })
  if (cfg.testCode) payload.test_event_code = cfg.testCode
  const base = { platform, event, eventName, payload: JSON.stringify(payload) }

  if (!cfg.active) return { ...base, status: 'erro', channel: '—', detail: 'Pixel desligado. Ligue a plataforma para testar.' }
  const idErr = validatePixelId(platform, cfg.pixelId, true)
  if (idErr) return { ...base, status: 'erro', channel: '—', detail: idErr }
  if (!cfg.events[event]) return { ...base, status: 'erro', channel: '—', detail: 'Evento desligado para esta plataforma na matriz.' }
  if (!cfg.token || !c.serverSide)
    return {
      ...base,
      status: 'aviso',
      channel: 'navegador',
      detail: 'Recebido só pelo navegador. Sem a API de conversões, bloqueadores de anúncio perdem parte dos eventos.',
    }
  return { ...base, status: 'ok', channel: 'navegador + servidor', detail: '200 OK · events_received: 1 · deduplicado por event_id' }
}
