// Registro de todas as chaves de dados usadas pelas telas, com as regras de
// acesso aplicadas pelo servidor. Chave sem registro é recusada (leitura e
// gravação). A regra vale para a chave exata e para as chaves filhas listadas
// em `children` ("cassino.agregadores" com children ['testes'] cobre
// "cassino.agregadores.testes"); qualquer outra chave filha é desconhecida (404),
// para ninguém criar chaves novas à vontade sob um prefixo gravável.

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
  | 'player-status'
  | 'affiliates'
  | 'commission-rules'
  | 'ggr-settlements'
  | 'player-projections'

export interface KvRule {
  prefix: string
  /** tela dona do dado */
  page: string
  /**
   * quem lê:
   *  - 'equipe': qualquer pessoa logada (configuração do site, sem dado sensível). Nunca use
   *    para dado pessoal ou financeiro (chave com `pii` ou domínio players/transactions): há
   *    teste que recusa a combinação.
   *  - 'tela': quem vê a tela dona ou uma das telas em readPages
   */
  read: 'equipe' | 'tela'
  readPages?: string[]
  /**
   * quem grava: lista de permissões (basta uma). Padrão: '<page>.editar'.
   * 'servidor' = só o servidor grava; o painel recebe 403.
   */
  write?: string[] | 'servidor'
  /**
   * contém segredos: cifrado em repouso e mascarado na leitura (só pontos; com 16+
   * caracteres, mais os 4 últimos). Na gravação, só a máscara exata mantém o segredo, e
   * só se o objeto que o guarda não mudou de destino (host, porta, URL, conta…).
   */
  secrets?: boolean
  /**
   * contém dados pessoais: mascarados para quem não tem a permissão indicada.
   * revealByRecord: mascarados para todos na leitura da chave; quem tem a permissão
   * pede o dado em claro de um registro por vez (POST /api/kv/<chave>/:id/reveal),
   * com auditoria 'revelar' do servidor.
   */
  pii?: { revealPermission: string; revealByRecord?: boolean }
  /**
   * nomes de campo tratados como dado pessoal nesta chave, além de PII_FIELD
   * (ex.: dados bancários: agency, account, holder). Só valem com `pii`.
   */
  piiFields?: string[]
  /**
   * endereços com token (campos url/…Url): saem com os trechos de token mascarados
   * para quem não tem a permissão indicada
   */
  urls?: { revealPermission: string }
  /** tratado por um módulo de domínio (não é JSON genérico) */
  domain?: KvDomain
  /**
   * chaves filhas (sufixos depois de "<prefix>.") que seguem esta mesma regra.
   * Outras chaves filhas sem registro próprio são recusadas.
   */
  children?: string[]
  /**
   * guarda cada versão substituída (histórico só de inclusão, recuperável pela
   * rota de histórico). Para configurações pequenas e reguladas; listas grandes de
   * registros usam um domínio que audita os valores de cada mudança.
   */
  history?: boolean
  /** tamanho máximo do valor gravado (bytes do JSON). Padrão: KV_DEFAULT_MAX_BYTES. */
  maxBytes?: number
  /**
   * leitura 'equipe' de uma configuração com dados de conta: quem não vê a tela dona
   * (<page>.ver/.editar) recebe só estes caminhos ("a.b") do valor da chave exata
   * (projeção mínima feita pelo servidor; o resto nem sai mascarado).
   */
  teamView?: string[]
}

/** Tamanho máximo padrão do valor de uma chave (JSON). */
export const KV_DEFAULT_MAX_BYTES = 2 * 1024 * 1024
/**
 * Corpo máximo das rotas que recebem o valor de uma chave (PUT /api/kv/:key e as
 * importações de jogadores e extrato). As demais rotas ficam com o limite global
 * da API (menor).
 */
export const KV_BODY_LIMIT = 12 * 1024 * 1024
/** Chaves com imagens (data URL de até 3 MB cada): o limite é o do corpo da requisição. */
const IMAGES = KV_BODY_LIMIT
/** Listas de registros que crescem com o uso (concessões, compras, históricos): idem. */
const RECORDS = KV_BODY_LIMIT

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
// chave PIX, dados bancários e e-mail de afiliados: mascarados para todos na lista; o dado em claro
// sai por registro (POST /api/kv/afiliados.saques/:id/reveal e /api/kv/crescimento.afiliados/:id/reveal)
const PII_AFFILIATES = { revealPermission: 'afiliados-saques.ver-pix', revealByRecord: true }
const WEBHOOK_URLS = { revealPermission: 'webhooks.editar' }

/**
 * Telas que trabalham com jogadores individuais e por isso leem a lista inteira
 * (além de Usuários). Telas que só mostram contagens (Dashboard, Cadastro, Jogo
 * responsável, Textos legais) e as de campanha não leem: usam as visões calculadas
 * pelo servidor, geral.jogadores.metricas e geral.jogadores.audiencia (dado pessoal
 * e financeiro, LGPD art. 6º III).
 */
const PLAYER_READ_PAGES = ['transacoes', 'antifraude', 'rankings', 'indicados', 'links', 'ranking-afiliados', 'afiliados-gerentes']
/**
 * Telas que leem o público de marketing (geral.jogadores.audiencia): jogadores que podem
 * receber campanhas, com campos mínimos (sem dado pessoal nem saldo).
 */
const AUDIENCE_READ_PAGES = ['promocoes', 'free-spins', 'cupons', 'torneios', 'niveis', 'disparos', 'notificacoes', 'popups-inbox']
/** Telas que leem as contagens da base (geral.jogadores.metricas): as de público e as que só mostram números. */
const METRICS_READ_PAGES = ['dashboard', 'cadastro', 'jogo-responsavel', 'textos-legais', 'moeda', 'cashback', ...AUDIENCE_READ_PAGES]
/** Telas que leem a base de afiliados (além de Afiliados e gerentes). */
const AFFILIATE_READ_PAGES = ['usuarios', 'comissoes', 'links', 'ranking-afiliados', 'indicados', 'antifraude', 'afiliados-visao-geral', 'afiliados-saques']

export const KV_RULES: KvRule[] = [
  // Geral ---------------------------------------------------------------------
  {
    prefix: 'geral.jogadores',
    page: 'usuarios',
    read: 'tela',
    readPages: PLAYER_READ_PAGES,
    write: ['usuarios.editar', 'antifraude.banir'],
    pii: PII_PLAYERS,
    domain: 'players',
  },
  // pausas em vigor (início de cada pausa), gravadas só pelo servidor ao mudar o status
  { prefix: 'geral.jogadores.pausas', page: 'usuarios', read: 'tela', write: 'servidor' },
  // visões da base calculadas pelo servidor (só leitura): público de marketing com campos mínimos
  // e contagens sem jogador identificado, para as telas que não leem a lista inteira
  { prefix: 'geral.jogadores.audiencia', page: 'usuarios', read: 'tela', readPages: AUDIENCE_READ_PAGES, write: 'servidor', domain: 'player-projections' },
  { prefix: 'geral.jogadores.metricas', page: 'usuarios', read: 'tela', readPages: METRICS_READ_PAGES, write: 'servidor', domain: 'player-projections' },
  {
    prefix: 'geral.transacoes',
    page: 'transacoes',
    read: 'tela',
    readPages: ['usuarios'],
    write: ['usuarios.editar', 'transacoes.editar'],
    pii: PII_PLAYERS,
    domain: 'transactions',
  },
  // histórico de status (bloqueio/pausa): só inclusão; data, autor e "pedido do jogador" vêm do servidor
  { prefix: 'geral.usuarios.status', page: 'usuarios', read: 'tela', domain: 'player-status' },

  // Operação ------------------------------------------------------------------
  { prefix: 'operacao.saques', page: 'saques', read: 'tela', write: 'servidor', domain: 'withdrawals' },
  { prefix: 'operacao.saques.regras', page: 'saques', read: 'tela', readPages: ['rollover'], write: ['saques.editar'], domain: 'withdrawal-rules' },
  // registro de depósitos: vem do gateway; o painel só reconsulta PIX vencido (POST /api/kv/operacao.depositos/recheck)
  { prefix: 'operacao.depositos', page: 'depositos', read: 'tela', write: 'servidor', pii: PII_PLAYERS },
  { prefix: 'operacao.depositos.limites', page: 'depositos', read: 'tela', history: true },
  { prefix: 'operacao.depositos.campanhas', page: 'depositos', read: 'tela', history: true },

  // Esportes (consulta; a liquidação vem do sportsbook) ------------------------
  { prefix: 'esportes.apostas', page: 'apostas-esportivas', read: 'tela', write: 'servidor', pii: PII_PLAYERS },

  // Cassino -------------------------------------------------------------------
  { prefix: 'cassino.jogos', page: 'jogos', read: 'equipe', children: ['selos'], maxBytes: IMAGES },
  { prefix: 'cassino.provedoras', page: 'provedoras', read: 'equipe', children: ['atualizacao'] },
  { prefix: 'cassino.vitrines', page: 'vitrines', read: 'equipe' },
  {
    prefix: 'cassino.agregadores',
    page: 'agregadores',
    read: 'tela',
    readPages: ['provedoras', 'jogos'],
    secrets: true,
    children: ['testes', 'sincronizacoes', 'segredos', 'regras'],
    maxBytes: RECORDS,
  },
  { prefix: 'cassino.sportsbook-credenciais', page: 'agregadores', read: 'tela', secrets: true, children: ['teste'] },

  // Crescimento ---------------------------------------------------------------
  // saldo de comissão é do servidor (recusa de saque devolve o valor); cada permissão muda só os campos dela
  {
    prefix: 'crescimento.afiliados',
    page: 'afiliados-gerentes',
    read: 'tela',
    readPages: AFFILIATE_READ_PAGES,
    write: ['afiliados-gerentes.editar', 'comissoes.editar'],
    pii: PII_AFFILIATES,
    domain: 'affiliates',
  },
  { prefix: 'crescimento.comissoes', page: 'comissoes', read: 'equipe', domain: 'commission-rules', history: true },
  { prefix: 'crescimento.links.status', page: 'links', read: 'equipe', write: ['comissoes.editar'] },
  // ciclo aberta → fechada → paga validado pelo servidor
  { prefix: 'crescimento.ggr.apuracoes', page: 'ggr', read: 'tela', write: ['ggr.apurar'], domain: 'ggr-settlements' },

  // Programa de afiliados -----------------------------------------------------
  { prefix: 'afiliados.configuracao', page: 'afiliados-configuracao', read: 'equipe', history: true },
  // pedidos vêm da plataforma; pagar e recusar só pelas rotas POST /api/kv/afiliados.saques/:id/pay|reject
  {
    prefix: 'afiliados.saques',
    page: 'afiliados-saques',
    read: 'tela',
    readPages: ['afiliados-visao-geral'],
    write: 'servidor',
    pii: PII_AFFILIATES,
    // dados bancários do TED (o nome do banco fica visível)
    piiFields: ['agency', 'account', 'holder'],
  },

  // Campanhas -----------------------------------------------------------------
  { prefix: 'campanhas.promocoes', page: 'promocoes', read: 'equipe' },
  { prefix: 'campanhas.templates', page: 'templates', read: 'equipe' },
  {
    prefix: 'campanhas.webhooks.destinos',
    page: 'webhooks',
    read: 'tela',
    readPages: ['templates', 'estatisticas'],
    secrets: true,
    urls: WEBHOOK_URLS,
    domain: 'webhook-destinations',
  },
  {
    prefix: 'campanhas.webhooks.execucoes',
    page: 'estatisticas',
    read: 'tela',
    readPages: ['webhooks', 'templates'],
    write: 'servidor',
    urls: WEBHOOK_URLS,
    domain: 'webhook-executions',
  },
  { prefix: 'campanhas.free-spins', page: 'free-spins', read: 'equipe', history: true },
  // registros com jogador (nome, e-mail): só quem vê a tela, com dados pessoais mascarados.
  // Concessões: o servidor monta a concessão manual (valor do giro, prazo, autor) e só aceita cancelar.
  { prefix: 'campanhas.free-spins.concessoes', page: 'free-spins', read: 'tela', pii: PII_PLAYERS, maxBytes: RECORDS },
  { prefix: 'campanhas.bonus-deposito', page: 'bonus-deposito', read: 'equipe', history: true },
  { prefix: 'campanhas.saldo-bonus', page: 'saldo-bonus', read: 'equipe', history: true },
  { prefix: 'campanhas.rollover', page: 'rollover', read: 'equipe', history: true },
  { prefix: 'campanhas.moeda', page: 'moeda', read: 'equipe', maxBytes: IMAGES },
  { prefix: 'campanhas.roleta', page: 'roleta', read: 'equipe' },
  // giros e resgates vêm da plataforma do jogador (custo calculado lá): o painel só lê
  { prefix: 'campanhas.roleta.giros', page: 'roleta', read: 'tela', write: 'servidor', pii: PII_PLAYERS },
  { prefix: 'campanhas.loja', page: 'loja', read: 'equipe', maxBytes: IMAGES },
  // compras vêm da plataforma; o painel só confirma a entrega ou estorna
  { prefix: 'campanhas.loja.compras', page: 'loja', read: 'tela', pii: PII_PLAYERS, maxBytes: RECORDS },
  { prefix: 'campanhas.cupons', page: 'cupons', read: 'equipe', history: true },
  { prefix: 'campanhas.cupons.resgates', page: 'cupons', read: 'tela', write: 'servidor', pii: PII_PLAYERS },
  // só a tela de Indicação lê (configuração e registros de indicados com e-mail do indicador)
  { prefix: 'campanhas.indicacao', page: 'indicacao', read: 'tela', pii: PII_PLAYERS, children: ['status'], maxBytes: RECORDS },
  { prefix: 'campanhas.missoes', page: 'missoes', read: 'equipe' },
  { prefix: 'campanhas.torneios', page: 'torneios', read: 'equipe' },
  { prefix: 'campanhas.niveis', page: 'niveis', read: 'equipe', history: true },
  { prefix: 'campanhas.cashback', page: 'cashback', read: 'equipe', history: true },
  { prefix: 'campanhas.notificacoes', page: 'notificacoes', read: 'equipe', children: ['historico'], maxBytes: RECORDS },
  { prefix: 'campanhas.popups-inbox', page: 'popups-inbox', read: 'equipe', children: ['popups', 'inbox'], maxBytes: IMAGES },
  { prefix: 'campanhas.disparos', page: 'disparos', read: 'equipe', children: ['historico'], maxBytes: IMAGES },
  { prefix: 'campanhas.jornadas', page: 'jornadas', read: 'equipe' },

  // Personalização ------------------------------------------------------------
  { prefix: 'personalizacao.tema', page: 'tema', read: 'equipe', maxBytes: IMAGES },
  { prefix: 'personalizacao.sportsbook', page: 'sportsbook', read: 'equipe', maxBytes: IMAGES },
  { prefix: 'personalizacao.home', page: 'home', read: 'equipe', maxBytes: IMAGES },
  { prefix: 'personalizacao.provedores-home', page: 'provedores-home', read: 'equipe', maxBytes: IMAGES },
  { prefix: 'personalizacao.banners', page: 'banners', read: 'equipe', maxBytes: IMAGES },
  { prefix: 'personalizacao.avatares', page: 'avatares', read: 'equipe', maxBytes: IMAGES },
  { prefix: 'personalizacao.menus', page: 'menus', read: 'equipe', maxBytes: IMAGES },
  { prefix: 'personalizacao.carrosseis', page: 'carrosseis', read: 'equipe', maxBytes: IMAGES },
  { prefix: 'personalizacao.rodape', page: 'rodape', read: 'equipe', maxBytes: IMAGES },
  { prefix: 'personalizacao.redes-sociais', page: 'redes-sociais', read: 'equipe', maxBytes: IMAGES },
  { prefix: 'personalizacao.seo', page: 'seo', read: 'equipe', maxBytes: IMAGES },

  // Segurança -----------------------------------------------------------------
  // bloqueios gravados não mudam (desfazer = remover); autor e data vêm do servidor
  { prefix: 'seguranca.bloqueios', page: 'antifraude', read: 'tela', write: ['antifraude.banir'], history: true, maxBytes: RECORDS },
  { prefix: 'seguranca.modo-ataque', page: 'modo-ataque', read: 'equipe' },

  // Configurações -------------------------------------------------------------
  { prefix: 'config.empresa', page: 'empresa', read: 'equipe', maxBytes: IMAGES },
  { prefix: 'config.faturas', page: 'faturas', read: 'tela', maxBytes: RECORDS },
  { prefix: 'config.textos-legais', page: 'textos-legais', read: 'equipe', history: true, maxBytes: RECORDS },
  { prefix: 'config.modulos', page: 'modulos', read: 'equipe' },
  { prefix: 'config.cadastro', page: 'cadastro', read: 'equipe', history: true },
  // ferramentas de jogo responsável (Lei 14.790/2023): validadas pelo servidor
  { prefix: 'config.jogo-responsavel', page: 'jogo-responsavel', read: 'equipe', history: true },
  { prefix: 'config.suporte', page: 'suporte', read: 'equipe' },
  // a barra do topo de todos mostra se o site está fechado; o link de testes (bypassToken) só para quem vê a tela
  { prefix: 'config.manutencao', page: 'manutencao', read: 'equipe', teamView: ['active', 'message', 'returnAt', 'since'] },
  // a tela é só de leitura: quem vê só inclui uma verificação nova (o servidor define id, data e autor)
  { prefix: 'config.dominios.verificacoes', page: 'dominios', read: 'equipe', write: ['dominios.ver'], history: true },
  { prefix: 'config.paises.bloqueados', page: 'paises', read: 'equipe', history: true },
  { prefix: 'config.tracking', page: 'tracking', read: 'tela', secrets: true, children: ['testes'] },
  // só Gateways lê (a tela de Depósitos usa os nomes fixos dos gateways, não esta configuração)
  { prefix: 'config.gateways', page: 'gateways', read: 'tela', secrets: true, children: ['contas', 'roteamento'] },
  // Disparos, Jornadas e Templates de e-mail leem só o remetente e o status das contas (teamView);
  // servidor, usuário, porta, IDs de conta e chaves só para quem vê Integrações (segredos mascarados)
  {
    prefix: 'config.integracoes',
    page: 'integracoes',
    read: 'equipe',
    secrets: true,
    children: ['ultimo-teste'],
    teamView: [
      'emailProvider',
      'smtp.fromName',
      'smtp.fromEmail',
      'mailgun.connected',
      'mailgun.domain',
      'sendwork.connected',
      'sendwork.smsSender',
      'sendwork.rcsAgent',
    ],
  },
  { prefix: 'config.templates-email', page: 'templates-email', read: 'equipe', maxBytes: IMAGES },
  { prefix: 'config.equipe.convites', page: 'equipe', read: 'tela' },
  { prefix: 'equipe.membros', page: 'equipe', read: 'equipe', domain: 'team' },
  { prefix: 'cargos.lista', page: 'cargos', read: 'equipe', write: ['cargos.editar'], domain: 'roles' },
  { prefix: 'config.mcp', page: 'mcp', read: 'tela', secrets: true, children: ['chaves', 'uso'], maxBytes: RECORDS },
  { prefix: 'config.seguranca-painel', page: 'seguranca-painel', read: 'tela', readPages: ['equipe'], domain: 'panel-security' },
  { prefix: 'auditoria.registros', page: 'auditoria', read: 'tela', readPages: ['modo-ataque', 'seguranca-painel', 'equipe'], write: 'servidor', domain: 'audit' },
]

function matches(key: string, prefix: string) {
  return key === prefix || key.startsWith(`${prefix}.`)
}

const RULE_BY_KEY = new Map<string, KvRule>()
for (const r of KV_RULES) {
  RULE_BY_KEY.set(r.prefix, r)
  for (const c of r.children ?? []) if (!RULE_BY_KEY.has(`${r.prefix}.${c}`)) RULE_BY_KEY.set(`${r.prefix}.${c}`, r)
}

/**
 * Regra da chave: a chave exata de uma regra ou uma das chaves filhas que a
 * regra lista em `children`. Qualquer outra chave → undefined (desconhecida).
 */
export function findKvRule(key: string): KvRule | undefined {
  return RULE_BY_KEY.get(key)
}

export function isLocalOnlyKey(key: string): boolean {
  return LOCAL_ONLY_PREFIXES.some((p) => matches(key, p))
}

/** Permissões que autorizam gravar a chave (vazio = ninguém pelo painel). */
export function writePermissions(rule: KvRule): string[] {
  if (rule.write === 'servidor') return []
  return rule.write ?? [`${rule.page}.editar`]
}

/** Vê a tela dona da chave (sem contar readPages)? */
export function seesOwnerPage(rule: KvRule, perms: ReadonlySet<string>): boolean {
  return perms.has(`${rule.page}.ver`) || perms.has(`${rule.page}.editar`)
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

/** Nomes de campo tratados como dado pessoal (nome exato, sem prefixo). */
export const PII_FIELD = /^(cpf|document|documento|phone|celular|telefone|email|e-mail|pixKey|pix|chavePix|birthDate|nascimento|ip|lastIp)$/i
/** Mesmos nomes com prefixo em camelCase (playerEmail, referrerEmail, holderCpf, loginIp). Sensível a maiúsculas: "vip" não casa. */
const PII_FIELD_CAMEL = /^[a-z][a-zA-Z0-9]*(Cpf|CPF|Document|Documento|Phone|Celular|Telefone|Email|EMail|PixKey|Pix|ChavePix|BirthDate|Nascimento|Ip|IP)$/
/** Mesmos nomes com prefixo em snake/kebab case (player_email, last_ip). */
const PII_FIELD_SNAKE = /^[a-z0-9]+(?:[_-][a-z0-9]+)*[_-](cpf|document|documento|phone|celular|telefone|email|pix_key|pix|chave_pix|birth_date|nascimento|ip)$/i

/**
 * O campo é dado pessoal? Nome exato de PII_FIELD, o mesmo nome com prefixo
 * (playerEmail, player_email) ou um dos nomes extras da regra (KvRule.piiFields).
 */
export function isPiiField(field: string, extra?: readonly string[]): boolean {
  return PII_FIELD.test(field) || PII_FIELD_CAMEL.test(field) || PII_FIELD_SNAKE.test(field) || (!!extra && extra.includes(field))
}

/** Campos de endereço (URL) mascarados quando a regra tem `urls`. */
export const URL_FIELD = /^(url|uri|endpoint)$|(Url|Uri|URL)$/

/** Prefixo dos valores mascarados enviados ao painel. */
export const MASK_CHAR = '•'
