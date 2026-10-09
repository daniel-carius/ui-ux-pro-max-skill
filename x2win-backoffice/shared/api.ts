// Tipos trocados entre painel e servidor. Fonte de verdade do contrato da API
// (descrição completa em docs/API.md). Valores em reais (number) e datas ISO.
import type { AuditAction, AuditEntry } from './audit'
import type { Role } from './permissions'

/** Corpo de erro de toda resposta não-2xx. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
}

// ---------- Autenticação ----------

/**
 * Etapas do login:
 *  - 'password': precisa trocar a senha (senha temporária ou expirada)
 *  - 'enroll':   precisa cadastrar o 2FA (cargo exige ou "2FA para todos")
 *  - '2fa':      precisa digitar o código do aplicativo
 *  - 'active':   login completo
 */
export type LoginStage = 'password' | 'enroll' | '2fa' | 'active'

export interface MeUser {
  id: string
  name: string
  email: string
  roleId: string
  twoFactor: boolean
  mustChangePassword: boolean
  lastAccess: string | null
}

export interface MeResponse {
  stage: LoginStage
  user: MeUser
  /** presentes só com stage 'active' */
  role?: Role
  permissions?: string[]
  /** minutos de inatividade até a sessão cair */
  sessionTimeoutMinutes?: number
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  stage: LoginStage
}

export interface TwoFactorVerifyRequest {
  /** 6 dígitos do aplicativo OU um código de recuperação (XXXXX-XXXXX) */
  code: string
}

export interface TwoFactorSetupResponse {
  /** segredo base32 (mostrar também como texto para digitação manual) */
  secret: string
  otpauthUrl: string
}

export interface TwoFactorEnableRequest {
  code: string
}

export interface TwoFactorEnableResponse {
  stage: LoginStage
  /** mostrados uma única vez */
  recoveryCodes: string[]
}

export interface ChangePasswordRequest {
  /** obrigatório quando a sessão já está ativa; dispensado na etapa 'password' */
  currentPassword?: string
  newPassword: string
}

// ---------- Dados por chave (/api/kv/:key) ----------

export interface KvGetResponse<T = unknown> {
  key: string
  value: T
  version: number
  updatedAt: string | null
}

export interface KvPutRequest<T = unknown> {
  value: T
  /** versão lida antes; se outra pessoa gravou depois, a API responde 409 */
  version?: number
}

export type KvPutResponse<T = unknown> = KvGetResponse<T>

// ---------- Saques ----------

export interface WithdrawalDecisionResponse {
  ok: true
  message: string
  /** saque já atualizado, no mesmo formato da lista (operacao.saques) */
  withdrawal: Record<string, unknown>
}

export interface RejectWithdrawalRequest {
  reason: string
}

export interface RevealPixResponse {
  pixKey: string
}

// ---------- Auditoria ----------

export interface AuditEventRequest {
  action: AuditAction
  entity: string
  summary: string
}

export interface AuditListResponse {
  items: AuditEntry[]
  total: number
  page: number
  pageSize: number
}

// ---------- Equipe ----------

export interface CreateMemberRequest {
  name: string
  email: string
  roleId: string
}

export interface CreateMemberResponse {
  member: Record<string, unknown>
  /** senha temporária, mostrada uma única vez (troca obrigatória no 1º acesso) */
  temporaryPassword: string
}

export interface InviteMemberRequest {
  email: string
  roleId: string
  name?: string
}

export interface InviteMemberResponse {
  member: Record<string, unknown>
  /** link de aceite (em produção iria por e-mail); válido por 72 h */
  inviteUrl: string
}

export interface AcceptInviteRequest {
  token: string
  name: string
  password: string
}

export interface ChangeMemberRoleRequest {
  roleId: string
}

// ---------- Webhooks ----------

export interface WebhookTestResponse {
  execution: Record<string, unknown>
}
