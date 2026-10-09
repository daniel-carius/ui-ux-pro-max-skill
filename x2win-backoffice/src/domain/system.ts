// Estado global do site que aparece em várias telas (barra superior, alertas):
// modo de ataque, manutenção e faturas. As telas de Segurança e Configurações
// editam estas chaves; o topo do painel lê para mostrar o status da operação.
import { useDb } from '@/lib/store'

export const SYSTEM_KEYS = {
  attackMode: 'seguranca.modo-ataque',
  maintenance: 'config.manutencao',
} as const

export interface AttackModeState {
  active: boolean
  since: string | null
  activatedBy: string | null
  /** desliga sozinho depois de N minutos (0 = só manual) */
  autoOffMinutes: number
  lowerLimits: boolean
  closeSignups: boolean
  captcha: boolean
}

export const DEFAULT_ATTACK_MODE: AttackModeState = {
  active: false,
  since: null,
  activatedBy: null,
  autoOffMinutes: 120,
  lowerLimits: true,
  closeSignups: true,
  captcha: true,
}

export interface MaintenanceState {
  active: boolean
  message: string
  /** previsão de volta (ISO) */
  returnAt: string | null
  /** link secreto para a equipe testar com o site fechado */
  bypassToken: string
  since: string | null
}

export const DEFAULT_MAINTENANCE: MaintenanceState = {
  active: false,
  message: 'Estamos fazendo melhorias. Voltamos em breve.',
  returnAt: null,
  bypassToken: 'teste-9f3a1c',
  since: null,
}

export function useAttackMode() {
  return useDb<AttackModeState>(SYSTEM_KEYS.attackMode, DEFAULT_ATTACK_MODE)
}

export function useMaintenance() {
  return useDb<MaintenanceState>(SYSTEM_KEYS.maintenance, DEFAULT_MAINTENANCE)
}

export interface PanelSecurityState {
  /** IPs ou faixas CIDR permitidos para a equipe; vazio = qualquer IP */
  allowlist: { id: string; value: string; label: string; createdAt: string; createdBy: string }[]
  /** exigir 2FA de todos, independente do cargo */
  enforce2faForAll: boolean
  /** encerra sessões paradas depois de N minutos */
  sessionTimeoutMinutes: number
}

export const PANEL_SECURITY_KEY = 'config.seguranca-painel'

export const DEFAULT_PANEL_SECURITY: PanelSecurityState = {
  allowlist: [],
  enforce2faForAll: false,
  sessionTimeoutMinutes: 240,
}

export function usePanelSecurity() {
  return useDb<PanelSecurityState>(PANEL_SECURITY_KEY, DEFAULT_PANEL_SECURITY)
}

export interface InvoiceSummary {
  openAmount: number
  openCount: number
  dueDate: string
}

/** Fatura em aberto da plataforma (usada no aviso do topo e na tela Faturas). */
export const OPEN_INVOICE: InvoiceSummary = { openAmount: 6498.68, openCount: 1, dueDate: '2026-10-12T12:00:00' }

// ---------- Empresa (Configurações › Empresa e licença; lida também pelo Rodapé) ----------

export interface CompanyState {
  legalName: string
  tradeName: string
  cnpj: string
  /** número da autorização de funcionamento (SPA/MF) */
  license: string
  licenseValidUntil: string
  address: string
  email: string
  phone: string
  description: string
}

export const COMPANY_KEY = 'config.empresa'

export const DEFAULT_COMPANY: CompanyState = {
  legalName: 'X2Win Entretenimento Digital Ltda.',
  tradeName: 'X2Win',
  cnpj: '48123456000175',
  license: 'SPA/MF nº 0000/2025 (demonstração)',
  licenseValidUntil: '2030-01-01T12:00:00',
  address: 'Av. Paulista, 1000, 10º andar · São Paulo/SP · 01310-100',
  email: 'contato@x2win.bet.br',
  phone: '1140028922',
  description: 'Plataforma de apostas de quota fixa e jogos on-line autorizada pela Secretaria de Prêmios e Apostas do Ministério da Fazenda.',
}

export function useCompany() {
  return useDb<CompanyState>(COMPANY_KEY, DEFAULT_COMPANY)
}

// ---------- Integrações de e-mail, SMS e RCS (Configurações › Integrações; lida por Disparos e Jornadas) ----------

export type EmailProvider = 'smtp' | 'mailgun' | 'sendwork'

export interface IntegrationsState {
  /** provedor que envia os e-mails */
  emailProvider: EmailProvider
  smtp: { host: string; port: number; user: string; password: string; fromName: string; fromEmail: string; secure: boolean }
  mailgun: { connected: boolean; domain: string; apiKey: string; region: 'us' | 'eu' }
  /** SendWork também é o canal de SMS e RCS */
  sendwork: { connected: boolean; accountId: string; apiKey: string; smsSender: string; rcsAgent: string }
}

export const INTEGRATIONS_KEY = 'config.integracoes'

export const DEFAULT_INTEGRATIONS: IntegrationsState = {
  emailProvider: 'smtp',
  smtp: { host: 'smtp.plataforma-evox.com', port: 587, user: 'no-reply@x2win.bet.br', password: 'DEMO-smtp-password', fromName: 'X2Win', fromEmail: 'no-reply@x2win.bet.br', secure: true },
  mailgun: { connected: false, domain: '', apiKey: '', region: 'us' },
  sendwork: { connected: false, accountId: '', apiKey: '', smsSender: '', rcsAgent: '' },
}

export function useIntegrations() {
  return useDb<IntegrationsState>(INTEGRATIONS_KEY, DEFAULT_INTEGRATIONS)
}

/** Canais disponíveis para Disparos e Jornadas conforme as integrações. */
export function availableChannels(s: IntegrationsState) {
  return { email: true, sms: s.sendwork.connected, rcs: s.sendwork.connected }
}

/** Gateways de pagamento usados nos dados de demonstração (Depósitos e Gateways usam os mesmos nomes). */
export const GATEWAY_NAMES = ['PagFlex', 'PixNow', 'BRPay'] as const
