// Regras das chaves de IA (Configurações › IA no painel (MCP)).
// A chave age como quem a criou, com as permissões do cargo dessa pessoa
// (achado 4). Escopo "somente leitura" corta tudo o que não for "ver".
import type { TeamMember } from '@/data/team'
import { PERMISSION_BY_KEY, type Role } from './roles'
import { randomChars } from './config2-access'

export type McpScope = 'leitura' | 'escrita'
export type McpExpiry = 30 | 90 | 180 | 0

export interface McpKey {
  id: string
  name: string
  /** últimos 4 caracteres do token (o token inteiro nunca é guardado) */
  last4: string
  createdById: string
  createdByName: string
  scope: McpScope
  createdAt: string
  lastUsedAt: string | null
  /** null = sem expiração */
  expiresAt: string | null
  revokedAt: string | null
  revokedBy: string | null
  /** ferramenta que usa a chave (informativo) */
  client: string
}

export type McpKeyStatus = 'ativa' | 'revogada' | 'expirada' | 'suspensa'

export const MCP_STATUS_LABEL: Record<McpKeyStatus, string> = {
  ativa: 'Ativa',
  revogada: 'Revogada',
  expirada: 'Expirada',
  suspensa: 'Suspensa',
}

export const MCP_SCOPE_LABEL: Record<McpScope, string> = {
  leitura: 'Somente leitura',
  escrita: 'Leitura e escrita',
}

export const MCP_EXPIRY_OPTIONS: { value: McpExpiry; label: string }[] = [
  { value: 30, label: '30 dias' },
  { value: 90, label: '90 dias' },
  { value: 180, label: '180 dias' },
  { value: 0, label: 'Sem expiração' },
]

export const MCP_SERVER_URL = 'https://painel.x2win.bet.br/mcp'

/**
 * Status efetivo: revogada > expirada > suspensa (criador desligado) > ativa.
 * Desligar a pessoa suspende as chaves dela na hora.
 */
export function keyStatus(key: McpKey, creator: TeamMember | undefined, now = Date.now()): McpKeyStatus {
  if (key.revokedAt) return 'revogada'
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= now) return 'expirada'
  if (!creator || creator.status !== 'ativo') return 'suspensa'
  return 'ativa'
}

/** Permissões que a chave consegue usar hoje. */
export function effectivePermissions(key: Pick<McpKey, 'scope'>, role: Role | undefined): string[] {
  if (!role) return []
  if (key.scope === 'escrita') return role.permissions
  return role.permissions.filter((p) => PERMISSION_BY_KEY.get(p)?.kind === 'ver')
}

/** A chave herda a fragilidade de um criador sem 2FA (achado 4). */
export function inheritsWeak2fa(creator: TeamMember | undefined) {
  return !!creator && !creator.twoFactor
}

export interface CreateKeyCheck {
  ok: boolean
  message?: string
}

/** Só cria chave quem tem 2FA ligado (comportamento seguro do achado 4). */
export function canCreateKey(user: TeamMember, canEdit: boolean): CreateKeyCheck {
  if (!canEdit) return { ok: false, message: 'Seu cargo não pode criar chaves.' }
  if (!user.twoFactor) return { ok: false, message: 'Ative o 2FA na sua conta para criar chaves. A chave age como você.' }
  return { ok: true }
}

export function validateKeyName(name: string, keys: McpKey[]): string | null {
  const n = name.trim()
  if (!n) return 'Dê um nome que diga para que serve a chave.'
  if (n.length < 3) return 'Use pelo menos 3 letras.'
  if (n.length > 50) return 'Use no máximo 50 caracteres.'
  if (keys.some((k) => !k.revokedAt && k.name.trim().toLowerCase() === n.toLowerCase())) return 'Já existe uma chave ativa com este nome.'
  return null
}

export function expiryFrom(createdAt: Date, days: McpExpiry): string | null {
  if (!days) return null
  return new Date(createdAt.getTime() + days * 86_400_000).toISOString()
}

/** Token de demonstração (claramente falso). */
export function generateMcpToken() {
  return `DEMO-mcp-${randomChars(32, 'abcdefghijklmnopqrstuvwxyz0123456789')}`
}

export function clientConfigSnippet(token = 'DEMO-mcp-COLE-SUA-CHAVE-AQUI') {
  return JSON.stringify(
    {
      mcpServers: {
        'x2win-painel': {
          type: 'http',
          url: MCP_SERVER_URL,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  )
}

export type McpCallResult = 'ok' | 'negado' | 'erro'

export interface McpUsage {
  id: string
  at: string
  keyId: string
  keyName: string
  tool: string
  /** permissão que a ferramenta exige */
  permission: string
  result: McpCallResult
  ip: string
  ms: number
}
