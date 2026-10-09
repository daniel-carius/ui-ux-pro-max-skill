// Registro de todas as chaves de dados usadas pelas telas, com as regras de
// acesso aplicadas pelo servidor. Chave sem registro é recusada (leitura e
// gravação). A regra vale para a chave exata e para chaves filhas
// ("campanhas.cupons" cobre "campanhas.cupons.resgates").

/** Módulos de domínio no servidor (dados com regra de negócio própria). */
export type KvDomain =
  | 'withdrawals'
  | 'withdrawal-rules'
  | 'team'
  | 'roles'
  | 'audit'
  | 'panel-security'
  | 'webhook-destinations'
  | 'webhook-executions'
  | 'players'
  | 'transactions'

export interface KvRule {
  prefix: string
  /** tela dona do dado */
  page: string
  /**
   * quem lê:
   *  - 'equipe': qualquer pessoa logada (configuração do site, sem dado sensível)
   *  - 'tela': quem vê a tela dona ou uma das telas em readPages
   */
  read: 'equipe' | 'tela'
  readPages?: string[]
  /**
   * quem grava: lista de permissões (basta uma). Padrão: '<page>.editar'.
   * 'servidor' = só o servidor grava; o painel recebe 403.
   */
  write?: string[] | 'servidor'
  /** contém segredos: cifrado em repouso e mascarado na leitura */
  secrets?: boolean
  /** contém dados pessoais: mascarados para quem não tem a permissão indicada */
  pii?: { revealPermission: string }
  /** tratado por um módulo de domínio (não é JSON genérico) */
  domain?: KvDomain
}

/** Chaves que ficam só no navegador (preferências de tela e rascunhos pessoais). */
export const LOCAL_ONLY_PREFIXES = [
  'sessao.atual',
  'campanhas.promocoes.visao',
  'cassino.jogos.visao',
  'personalizacao.banners.mostrar-nao-usadas',
  'campanhas.disparos.rascunho',
  'campanhas.notificacoes.rascunho',
  'config.textos-legais.rascunhos',
] as const

const PII_PLAYERS = { revealPermission: 'usuarios.ver-dados' }
const PII_AFFILIATES = { revealPermission: 'afiliados-saques.ver-pix' }

export const KV_RULES: KvRule[] = [
  // Geral ---------------------------------------------------------------------
  { prefix: 'geral.jogadores', page: 'usuarios', read: 'equipe', write: ['usuarios.editar', 'antifraude.banir'], pii: PII_PLAYERS, domain: 'players' },
  { prefix: 'geral.transacoes', page: 'transacoes', read: 'tela', readPages: ['usuarios'], write: ['usuarios.editar', 'transacoes.editar'], domain: 'transactions' },
  { prefix: 'geral.usuarios.status', page: 'usuarios', read: 'tela' },

  // Operação ------------------------------------------------------------------
  { prefix: 'operacao.saques', page: 'saques', read: 'tela', write: 'servidor', domain: 'withdrawals' },
  { prefix: 'operacao.saques.regras', page: 'saques', read: 'tela', readPages: ['rollover'], write: ['saques.editar'], domain: 'withdrawal-rules' },
  { prefix: 'operacao.depositos', page: 'depositos', read: 'tela' },

  // Esportes (consulta; a liquidação vem do sportsbook) ------------------------
  { prefix: 'esportes.apostas', page: 'apostas-esportivas', read: 'tela', write: 'servidor' },

  // Cassino -------------------------------------------------------------------
  { prefix: 'cassino.jogos', page: 'jogos', read: 'equipe' },
  { prefix: 'cassino.provedoras', page: 'provedoras', read: 'equipe' },
  { prefix: 'cassino.vitrines', page: 'vitrines', read: 'equipe' },
  { prefix: 'cassino.agregadores', page: 'agregadores', read: 'tela', readPages: ['provedoras', 'jogos'], secrets: true },
  { prefix: 'cassino.sportsbook-credenciais', page: 'agregadores', read: 'tela', secrets: true },

  // Crescimento ---------------------------------------------------------------
  {
    prefix: 'crescimento.afiliados',
    page: 'afiliados-gerentes',
    read: 'equipe',
    write: ['afiliados-gerentes.editar', 'comissoes.editar', 'afiliados-saques.aprovar'],
    pii: PII_AFFILIATES,
  },
  { prefix: 'crescimento.comissoes', page: 'comissoes', read: 'equipe' },
  { prefix: 'crescimento.links.status', page: 'links', read: 'equipe', write: ['comissoes.editar'] },
  { prefix: 'crescimento.ggr.apuracoes', page: 'ggr', read: 'tela', write: ['ggr.apurar'] },

  // Programa de afiliados -----------------------------------------------------
  { prefix: 'afiliados.configuracao', page: 'afiliados-configuracao', read: 'equipe' },
  { prefix: 'afiliados.saques', page: 'afiliados-saques', read: 'tela', readPages: ['afiliados-visao-geral'], write: ['afiliados-saques.aprovar'], pii: PII_AFFILIATES },

  // Campanhas -----------------------------------------------------------------
  { prefix: 'campanhas.promocoes', page: 'promocoes', read: 'equipe' },
  { prefix: 'campanhas.templates', page: 'templates', read: 'equipe' },
  { prefix: 'campanhas.webhooks.destinos', page: 'webhooks', read: 'tela', readPages: ['templates', 'estatisticas'], secrets: true, domain: 'webhook-destinations' },
  { prefix: 'campanhas.webhooks.execucoes', page: 'estatisticas', read: 'tela', readPages: ['webhooks', 'templates'], write: 'servidor', domain: 'webhook-executions' },
  { prefix: 'campanhas.free-spins', page: 'free-spins', read: 'equipe' },
  { prefix: 'campanhas.bonus-deposito', page: 'bonus-deposito', read: 'equipe' },
  { prefix: 'campanhas.saldo-bonus', page: 'saldo-bonus', read: 'equipe' },
  { prefix: 'campanhas.rollover', page: 'rollover', read: 'equipe' },
  { prefix: 'campanhas.moeda', page: 'moeda', read: 'equipe' },
  { prefix: 'campanhas.roleta', page: 'roleta', read: 'equipe' },
  { prefix: 'campanhas.loja', page: 'loja', read: 'equipe' },
  { prefix: 'campanhas.cupons', page: 'cupons', read: 'equipe' },
  { prefix: 'campanhas.indicacao', page: 'indicacao', read: 'equipe' },
  { prefix: 'campanhas.missoes', page: 'missoes', read: 'equipe' },
  { prefix: 'campanhas.torneios', page: 'torneios', read: 'equipe' },
  { prefix: 'campanhas.niveis', page: 'niveis', read: 'equipe' },
  { prefix: 'campanhas.cashback', page: 'cashback', read: 'equipe' },
  { prefix: 'campanhas.notificacoes', page: 'notificacoes', read: 'equipe' },
  { prefix: 'campanhas.popups-inbox', page: 'popups-inbox', read: 'equipe' },
  { prefix: 'campanhas.disparos', page: 'disparos', read: 'equipe' },
  { prefix: 'campanhas.jornadas', page: 'jornadas', read: 'equipe' },

  // Personalização ------------------------------------------------------------
  { prefix: 'personalizacao.tema', page: 'tema', read: 'equipe' },
  { prefix: 'personalizacao.sportsbook', page: 'sportsbook', read: 'equipe' },
  { prefix: 'personalizacao.home', page: 'home', read: 'equipe' },
  { prefix: 'personalizacao.provedores-home', page: 'provedores-home', read: 'equipe' },
  { prefix: 'personalizacao.banners', page: 'banners', read: 'equipe' },
  { prefix: 'personalizacao.avatares', page: 'avatares', read: 'equipe' },
  { prefix: 'personalizacao.menus', page: 'menus', read: 'equipe' },
  { prefix: 'personalizacao.carrosseis', page: 'carrosseis', read: 'equipe' },
  { prefix: 'personalizacao.rodape', page: 'rodape', read: 'equipe' },
  { prefix: 'personalizacao.redes-sociais', page: 'redes-sociais', read: 'equipe' },
  { prefix: 'personalizacao.seo', page: 'seo', read: 'equipe' },

  // Segurança -----------------------------------------------------------------
  { prefix: 'seguranca.bloqueios', page: 'antifraude', read: 'tela', write: ['antifraude.banir'] },
  { prefix: 'seguranca.modo-ataque', page: 'modo-ataque', read: 'equipe' },

  // Configurações -------------------------------------------------------------
  { prefix: 'config.empresa', page: 'empresa', read: 'equipe' },
  { prefix: 'config.faturas', page: 'faturas', read: 'tela' },
  { prefix: 'config.textos-legais', page: 'textos-legais', read: 'equipe' },
  { prefix: 'config.modulos', page: 'modulos', read: 'equipe' },
  { prefix: 'config.cadastro', page: 'cadastro', read: 'equipe' },
  { prefix: 'config.jogo-responsavel', page: 'jogo-responsavel', read: 'equipe' },
  { prefix: 'config.suporte', page: 'suporte', read: 'equipe' },
  { prefix: 'config.manutencao', page: 'manutencao', read: 'equipe' },
  { prefix: 'config.dominios.verificacoes', page: 'dominios', read: 'equipe', write: ['dominios.ver'] },
  { prefix: 'config.paises.bloqueados', page: 'paises', read: 'equipe' },
  { prefix: 'config.tracking', page: 'tracking', read: 'tela', secrets: true },
  { prefix: 'config.gateways', page: 'gateways', read: 'tela', readPages: ['depositos'], secrets: true },
  // status das contas (conectada ou não) é lido por Disparos e Jornadas; segredos saem mascarados
  { prefix: 'config.integracoes', page: 'integracoes', read: 'equipe', secrets: true },
  { prefix: 'config.templates-email', page: 'templates-email', read: 'equipe' },
  { prefix: 'config.equipe.convites', page: 'equipe', read: 'tela' },
  { prefix: 'equipe.membros', page: 'equipe', read: 'equipe', domain: 'team' },
  { prefix: 'cargos.lista', page: 'cargos', read: 'equipe', write: ['cargos.editar'], domain: 'roles' },
  { prefix: 'config.mcp', page: 'mcp', read: 'tela', secrets: true },
  { prefix: 'config.seguranca-painel', page: 'seguranca-painel', read: 'tela', readPages: ['equipe'], domain: 'panel-security' },
  { prefix: 'auditoria.registros', page: 'auditoria', read: 'tela', readPages: ['modo-ataque', 'seguranca-painel', 'equipe', 'mcp'], write: 'servidor', domain: 'audit' },
]

function matches(key: string, prefix: string) {
  return key === prefix || key.startsWith(`${prefix}.`)
}

/** Regra mais específica para a chave (prefixo mais longo), ou undefined. */
export function findKvRule(key: string): KvRule | undefined {
  let best: KvRule | undefined
  for (const r of KV_RULES) {
    if (matches(key, r.prefix) && (!best || r.prefix.length > best.prefix.length)) best = r
  }
  return best
}

export function isLocalOnlyKey(key: string): boolean {
  return LOCAL_ONLY_PREFIXES.some((p) => matches(key, p))
}

/** Permissões que autorizam gravar a chave (vazio = ninguém pelo painel). */
export function writePermissions(rule: KvRule): string[] {
  if (rule.write === 'servidor') return []
  return rule.write ?? [`${rule.page}.editar`]
}

/** Pode ler? 'equipe' = qualquer pessoa logada; 'tela' = vê a tela dona ou uma de readPages. */
export function canReadKey(rule: KvRule, perms: ReadonlySet<string>): boolean {
  if (rule.read === 'equipe') return true
  return [rule.page, ...(rule.readPages ?? [])].some((p) => perms.has(`${p}.ver`) || perms.has(`${p}.editar`))
}

export function canWriteKey(rule: KvRule, perms: ReadonlySet<string>): boolean {
  return writePermissions(rule).some((p) => perms.has(p))
}

/** Nomes de campo tratados como segredo (mascarados e preservados na gravação). */
export const SECRET_FIELD = /(secret|senha|password|passwd|apikey|api_key|privatekey|private_key|token|credential|credencial|hmac)/i

/** Nomes de campo tratados como dado pessoal. */
export const PII_FIELD = /^(cpf|document|documento|phone|celular|telefone|email|e-mail|pixKey|pix|chavePix|birthDate|nascimento|ip|lastIp)$/i

/** Prefixo dos valores mascarados enviados ao painel. */
export const MASK_CHAR = '•'
