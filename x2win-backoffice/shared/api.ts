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

/**
 * Por que a sessão deste cookie terminou (GET /api/auth/session e details.reason do 401 nao_autenticado):
 *  - inatividade: passou do tempo sem uso de Segurança do painel;
 *  - expirada: passou da validade máxima (12 h) ou da etapa pendente do login;
 *  - saida: a pessoa saiu (em outra aba);
 *  - outro_login: um login novo neste navegador encerrou a sessão anterior;
 *  - senha_trocada: a senha foi trocada em outra sessão;
 *  - senha_redefinida: um administrador gerou uma senha temporária;
 *  - desativado: o acesso foi desativado em Equipe;
 *  - 2fa_exigido: o cargo passou a exigir 2FA e a pessoa ainda não tem;
 *  - 2fa_exigido_todos: "2FA de todos" (Segurança do painel) foi ligado e a pessoa ainda não tem 2FA;
 *  - 2fa_redefinido: um administrador redefiniu o 2FA;
 *  - 2fa_ligado: a pessoa ligou o 2FA em outra sessão;
 *  - bloqueio: senha atual ou código errados demais com a sessão aberta (acesso bloqueado por um tempo).
 */
export type SessionEndReason =
  | 'inatividade'
  | 'expirada'
  | 'saida'
  | 'outro_login'
  | 'senha_trocada'
  | 'senha_redefinida'
  | 'desativado'
  | '2fa_exigido'
  | '2fa_exigido_todos'
  | '2fa_redefinido'
  | '2fa_ligado'
  | 'bloqueio'

export const SESSION_END_REASONS: readonly SessionEndReason[] = [
  'inatividade',
  'expirada',
  'saida',
  'outro_login',
  'senha_trocada',
  'senha_redefinida',
  'desativado',
  '2fa_exigido',
  '2fa_exigido_todos',
  '2fa_redefinido',
  '2fa_ligado',
  'bloqueio',
]

/**
 * GET /api/auth/session: "há sessão?" sem erro. 200 sempre (fora a lista de IPs): `session` é o mesmo corpo de
 * /me, ou null sem sessão; `ended` diz por que a sessão deste cookie terminou (ausente sem cookie ou sem motivo).
 */
export interface SessionResponse {
  session: MeResponse | null
  ended?: SessionEndReason
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  stage: LoginStage
}

export interface TwoFactorVerifyRequest {
  /**
   * 6 dígitos do aplicativo OU um código de recuperação: 20 caracteres Crockford base32 em
   * 4 grupos de 5 (XXXXX-XXXXX-XXXXX-XXXXX). O servidor aceita minúsculas, espaços e sem hífens.
   */
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
  /** mostrados uma única vez, no formato XXXXX-XXXXX-XXXXX-XXXXX */
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
  /** false = nunca gravada (value vem null; o painel usa o valor padrão dele) */
  stored?: boolean
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
  /** aprovação: avisos saque.pago enfileirados (0 = pagamento manual no gateway); a recusa não traz */
  queuedDeliveries?: number
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

/** POST /api/team/:id/reset-password: senha temporária nova (mostrada uma vez), troca obrigatória e sessões encerradas. */
export interface ResetPasswordResponse {
  member: Record<string, unknown>
  temporaryPassword: string
  /** sessões da pessoa encerradas agora */
  sessionsEnded: number
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
  /** ignorado pelo servidor: o nome é o que quem convidou cadastrou */
  name?: string
  password: string
}

export interface ChangeMemberRoleRequest {
  roleId: string
}

// ---------- Webhooks ----------

export interface WebhookTestResponse {
  execution: Record<string, unknown>
}

/** Tentativas de uma entrega da fila (a primeira e mais 5, com espera crescente). Mesmo valor no painel e no servidor. */
export const WEBHOOK_MAX_ATTEMPTS = 6
