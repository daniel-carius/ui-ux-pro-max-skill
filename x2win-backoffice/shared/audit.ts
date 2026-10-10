// Ações registradas na auditoria. Compartilhado entre painel e servidor.
import { PAGE_INFO, PAGE_INFO_BY_ID } from './pages'
import { PERMISSION_BY_KEY } from './permissions'

export type AuditAction =
  | 'login'
  | 'criar'
  | 'editar'
  | 'excluir'
  | 'aprovar'
  | 'recusar'
  | 'exportar'
  | 'ligar'
  | 'desligar'
  | 'convidar'
  | 'desativar'
  | 'enviar'
  | 'testar'
  | 'sincronizar'
  | 'banir'
  | 'bloquear'
  | 'revelar'
  | 'revogar'
  | 'desbloquear'
  | 'creditar'
  | 'estornar'

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  login: 'Entrou no painel',
  criar: 'Criou',
  editar: 'Editou',
  excluir: 'Excluiu',
  aprovar: 'Aprovou',
  recusar: 'Recusou',
  exportar: 'Exportou',
  ligar: 'Ligou',
  desligar: 'Desligou',
  convidar: 'Convidou',
  desativar: 'Desativou',
  enviar: 'Enviou',
  testar: 'Testou',
  sincronizar: 'Sincronizou',
  banir: 'Baniu',
  bloquear: 'Bloqueou',
  revelar: 'Revelou dado sensível',
  revogar: 'Revogou',
  desbloquear: 'Desbloqueou',
  creditar: 'Ajustou saldo',
  estornar: 'Estornou',
}

export const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_LABEL) as AuditAction[]

export function isAuditAction(v: unknown): v is AuditAction {
  return typeof v === 'string' && v in AUDIT_ACTION_LABEL
}

export interface AuditEntry {
  id: string
  at: string
  actorId: string
  actorName: string
  action: AuditAction
  entity: string
  summary: string
  ip: string
  /** 'servidor' = registrado pela API; 'painel' = relatado pela tela (não verificado) */
  source?: AuditSource
}

// ---------------------------------------------------------------------------
// Origem do registro
// ---------------------------------------------------------------------------

/**
 * 'servidor' = gravado pela API ao executar a ação (verificado).
 * 'painel' = relatado pela tela via POST /api/audit/events: o servidor garante só quem, quando e IP; ação,
 * entidade e resumo são declarados por quem relatou e NÃO foram verificados.
 */
export type AuditSource = 'servidor' | 'painel'

export const AUDIT_SOURCE_LABEL: Record<AuditSource, string> = {
  servidor: 'servidor',
  painel: 'relatado pelo painel (não verificado)',
}

/**
 * Registro relatado pela tela (não verificado). Telas não devem derivar estado ("última mudança por",
 * "site fechado por"), nem contar ações sensíveis, a partir dele: use só registros do servidor.
 */
export function isPanelReported(e: Pick<AuditEntry, 'source'>): boolean {
  return e.source === 'painel'
}

// ---------------------------------------------------------------------------
// Eventos que o painel pode relatar (POST /api/audit/events)
// ---------------------------------------------------------------------------

/**
 * Ações que só o servidor registra (ele grava a linha quando executa a ação de verdade). O painel não pode
 * relatá-las: a linha relatada ficaria igual à real e qualquer cargo poderia "aprovar" ou "revelar" no papel.
 */
export const SERVER_ONLY_AUDIT_ACTIONS = [
  'login',
  'aprovar',
  'recusar',
  'revelar',
  'banir',
  'creditar',
  'estornar',
  'desativar',
  'convidar',
  'revogar',
] as const satisfies readonly AuditAction[]

const SERVER_ONLY = new Set<AuditAction>(SERVER_ONLY_AUDIT_ACTIONS)

export function isServerOnlyAuditAction(a: AuditAction): boolean {
  return SERVER_ONLY.has(a)
}

/** Entidades que só o servidor grava (dados por chave, login, 2FA, senha e saques). */
const SERVER_ONLY_ENTITY = /^(Dados · |Acesso ao painel$|2FA($| · )|Senha$|Saque #)/

interface PanelEventRule {
  /** tela (id em shared/pages.ts) cuja permissão o evento exige */
  page: string
  exact?: readonly string[]
  prefix?: readonly string[]
  pattern?: RegExp
  /** ações aceitas para estas entidades (padrão: qualquer ação que não seja só do servidor) */
  actions?: readonly AuditAction[]
  /** permissões (basta uma) para ações que não sejam 'exportar' (padrão: "<tela>.editar") */
  perms?: readonly string[]
}

/**
 * Eventos que as telas relatam (src/**: chamadas a audit()). Entidade fora desta lista (e que não seja o título
 * exato de uma tela) é recusada. Ao incluir um audit() novo no painel, inclua a entidade aqui.
 */
const PANEL_EVENT_RULES: readonly PanelEventRule[] = [
  // telas cujo estado é mostrado a partir da auditoria: ações fechadas e permissão de edição da tela
  { page: 'modo-ataque', exact: ['Modo de ataque'], actions: ['ligar', 'desligar'] },
  { page: 'manutencao', exact: ['Manutenção'], actions: ['ligar', 'desligar', 'editar'] },
  { page: 'empresa', exact: ['Empresa e licença'], actions: ['editar'] },
  { page: 'seguranca-painel', exact: ['Segurança do painel'], actions: ['criar', 'excluir'] },
  { page: 'cargos', exact: ['Cargos e permissões'], actions: ['ligar', 'editar'] },
  // geral / operação
  { page: 'usuarios', prefix: ['Jogador #'] },
  { page: 'saques', exact: ['Regras de saque'] },
  { page: 'depositos', exact: ['Campanhas na tela de depósito', 'Limites de depósito'], prefix: ['Depósito #'] },
  // cassino
  { page: 'agregadores', exact: ['Sportsbook Betby', 'Regras de sincronização dos agregadores'], prefix: ['Agregador '] },
  { page: 'jogos', prefix: ['Jogo '] },
  { page: 'provedoras', prefix: ['Provedora '] },
  { page: 'vitrines', prefix: ['Vitrine '] },
  // crescimento / afiliados
  { page: 'ggr', exact: ['Apurações de GGR'], prefix: ['Apuração ', 'Apurações ', 'GGR por '], perms: ['ggr.apurar'] },
  { page: 'links', prefix: ['Link '] },
  { page: 'comissoes', prefix: ['Comissão '] },
  { page: 'afiliados-gerentes', exact: ['Gerentes de afiliados'], prefix: ['Gerente ', 'Contrato de '] },
  { page: 'afiliados-saques', exact: ['Saques de afiliados'] },
  { page: 'afiliados-visao-geral', exact: ['Afiliados · Visão geral'] },
  { page: 'afiliados-configuracao', exact: ['Programa de afiliados'] },
  // campanhas
  { page: 'promocoes', prefix: ['Promoção '] },
  { page: 'bonus-deposito', prefix: ['Bônus de depósito '] },
  { page: 'cupons', exact: ['Cupons · resgates'], prefix: ['Cupom '] },
  { page: 'disparos', prefix: ['Disparo "'] },
  { page: 'estatisticas', exact: ['Estatísticas de webhooks'] },
  { page: 'free-spins', exact: ['Free spins'], prefix: ['Free spins '] },
  { page: 'indicacao', exact: ['Indicação · indicadores', 'Programa de indicação'] },
  { page: 'jornadas', prefix: ['Jornada "'] },
  { page: 'loja', prefix: ['Loja · '] },
  { page: 'missoes', prefix: ['Missão '] },
  { page: 'notificacoes', exact: ['Notificação'] },
  { page: 'popups-inbox', exact: ['Inbox', 'Popups'], prefix: ['Popup "', 'Inbox "'] },
  { page: 'roleta', pattern: /^roleta\b/i },
  { page: 'templates', exact: ['Templates de webhook'], prefix: ['Template '] },
  { page: 'torneios', prefix: ['Torneio '] },
  { page: 'webhooks', prefix: ['Webhook '] },
  { page: 'moeda', exact: ['Moeda do site'] },
  // personalização
  { page: 'banners', prefix: ['Banner "', 'Banners · '] },
  // segurança
  { page: 'antifraude', prefix: ['IP ', 'Bloqueio da rede ', 'Bloqueio do IP '], perms: ['antifraude.banir'] },
  // configurações
  { page: 'cadastro', prefix: ['Cadastro · '] },
  { page: 'cargos', prefix: ['Cargo '] },
  { page: 'equipe', prefix: ['Equipe · '] },
  { page: 'faturas', prefix: ['Fatura '] },
  { page: 'gateways', exact: ['Roteamento de gateways'], prefix: ['Gateway ', 'Conta '] },
  { page: 'integracoes', prefix: ['Integração ', 'Integrações · '] },
  { page: 'mcp', exact: ['Chaves MCP'], prefix: ['Chave MCP "'] },
  { page: 'modulos', prefix: ['Módulo '] },
  { page: 'paises', prefix: ['País '] },
  { page: 'suporte', prefix: ['Suporte · '] },
  { page: 'templates-email', prefix: ['E-mail "'] },
  { page: 'textos-legais', pattern: /^(Termos de uso|Política de privacidade|Jogo responsável|Política de bônus) v\d+$/, actions: ['criar'] },
  { page: 'tracking', prefix: ['Pixel '] },
]

/** Título exato de uma tela (formulários de configuração e exportações usam o título como entidade). */
const PAGE_BY_TITLE = new Map<string, string>()
for (const pg of PAGE_INFO) if (!PAGE_BY_TITLE.has(pg.title)) PAGE_BY_TITLE.set(pg.title, pg.id)

function matches(rule: PanelEventRule, entity: string) {
  return (
    !!rule.exact?.includes(entity) || !!rule.prefix?.some((p) => entity.startsWith(p) && entity.length > p.length) || !!rule.pattern?.test(entity)
  )
}

const existing = (keys: string[]) => keys.filter((k) => PERMISSION_BY_KEY.has(k))

/** Exportar: permissão própria de exportação da tela, se houver; senão, ver a tela. */
function exportPerms(page: string) {
  const own = existing([`${page}.exportar`])
  return own.length ? own : existing([`${page}.ver`, `${page}.editar`])
}

/** Demais ações: editar a tela (ou ver, se a tela não tem edição). */
function actionPerms(page: string) {
  const edit = existing([`${page}.editar`])
  return edit.length ? edit : existing([`${page}.ver`])
}

export type PanelAuditDecision =
  | { ok: true; page: string; perms: string[] }
  | { ok: false; reason: 'acao_do_servidor' | 'entidade_do_servidor' | 'evento_desconhecido' }

/**
 * Decide se o painel pode relatar o evento e com qual permissão (basta uma). Regra: a linha relatada só pode
 * descrever uma ação que a própria pessoa pode fazer naquela tela; o que o servidor já registra (aprovar,
 * revelar, banir, login, dados por chave...) nunca é aceito do painel.
 */
export function panelAuditDecision(action: AuditAction, entity: string): PanelAuditDecision {
  if (isServerOnlyAuditAction(action)) return { ok: false, reason: 'acao_do_servidor' }
  if (SERVER_ONLY_ENTITY.test(entity)) return { ok: false, reason: 'entidade_do_servidor' }
  const rule: PanelEventRule | undefined =
    PANEL_EVENT_RULES.find((r) => matches(r, entity)) ?? (PAGE_BY_TITLE.has(entity) ? { page: PAGE_BY_TITLE.get(entity)! } : undefined)
  if (!rule || !PAGE_INFO_BY_ID.has(rule.page)) return { ok: false, reason: 'evento_desconhecido' }
  if (rule.actions && !rule.actions.includes(action)) return { ok: false, reason: 'evento_desconhecido' }
  const perms = action === 'exportar' ? exportPerms(rule.page) : existing([...(rule.perms ?? actionPerms(rule.page))])
  if (!perms.length) return { ok: false, reason: 'evento_desconhecido' }
  return { ok: true, page: rule.page, perms }
}
