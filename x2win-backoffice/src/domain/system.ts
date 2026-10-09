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
