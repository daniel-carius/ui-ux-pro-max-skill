// Configuração inicial dos pixels (demonstração) e o log de testes.
import type { TrackingConfig, TrackingTestEntry } from '@/domain/config2-tracking'
import { apiValue, demoRecords } from './demo'
import { MIN, NOW, iso } from './now'

export const TRACKING_KEYS = {
  config: 'config.tracking',
  tests: 'config.tracking.testes',
} as const

const allOn = { pageview: true, signup: true, deposit_amount: true, pix_start: true, deposit_paid: true }

export const DEFAULT_TRACKING: TrackingConfig = apiValue<TrackingConfig>(
  {
    platforms: {
      meta: { active: true, pixelId: '804512379946120', token: 'DEMO-meta-capi-token-7f3k', testCode: '', events: { ...allOn } },
      tiktok: { active: true, pixelId: 'C8QK4RJ0DEMO7TQ2M3VA', token: '', testCode: '', events: { ...allOn, deposit_amount: false } },
      kwai: { active: false, pixelId: '', token: '', testCode: '', events: { pageview: true, signup: true, deposit_amount: false, pix_start: false, deposit_paid: true } },
      ga4: { active: true, pixelId: 'G-X2W1N7DEMO', token: 'DEMO-ga4-secret-91az', testCode: '', events: { ...allOn } },
    },
    pageViewPages: ['home', 'cassino', 'jogo', 'esportes', 'promocoes', 'cadastro', 'deposito'],
    serverSide: true,
  },
  // modo API, sem nada gravado: nenhum pixel configurado (nunca os IDs e tokens DEMO)
  (): TrackingConfig => {
    const off = { active: false, pixelId: '', token: '', testCode: '' }
    return {
      platforms: {
        meta: { ...off, events: { ...allOn } },
        tiktok: { ...off, events: { ...allOn, deposit_amount: false } },
        kwai: { ...off, events: { pageview: true, signup: true, deposit_amount: false, pix_start: false, deposit_paid: true } },
        ga4: { ...off, events: { ...allOn } },
      },
      pageViewPages: ['home', 'cassino', 'jogo', 'esportes', 'promocoes', 'cadastro', 'deposito'],
      serverSide: true,
    }
  },
)

const ago = (m: number) => iso(new Date(NOW.getTime() - m * MIN))

export function seedTrackingTests(): TrackingTestEntry[] {
  return [
    {
      id: 'tt3',
      at: ago(47),
      platform: 'meta',
      event: 'deposit_paid',
      eventName: 'Purchase',
      status: 'ok',
      channel: 'navegador + servidor',
      detail: '200 OK · events_received: 1 · deduplicado por event_id',
      payload: '{"event":"Purchase","event_id":"dep_7731","value":50,"currency":"BRL"}',
    },
    {
      id: 'tt2',
      at: ago(52),
      platform: 'tiktok',
      event: 'signup',
      eventName: 'CompleteRegistration',
      status: 'aviso',
      channel: 'navegador',
      detail: 'Recebido só pelo navegador. Sem a API de conversões, bloqueadores de anúncio perdem parte dos eventos.',
      payload: '{"event":"CompleteRegistration","event_id":"reg_1182"}',
    },
    {
      id: 'tt1',
      at: ago(55),
      platform: 'kwai',
      event: 'pageview',
      eventName: 'EVENT_CONTENT_VIEW',
      status: 'erro',
      channel: '—',
      detail: 'Pixel desligado. Ligue a plataforma para testar.',
      payload: '{"event":"EVENT_CONTENT_VIEW","event_id":"pv_5520"}',
    },
  ]
}

// modo API: registros só do servidor (sem nada gravado, lista vazia; o gerador não roda)
demoRecords(seedTrackingTests)
