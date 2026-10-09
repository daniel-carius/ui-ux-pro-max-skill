// Catálogo das 73 telas e dos 10 módulos, sem ícones.
// Compartilhado entre o painel (src/nav.ts adiciona os ícones) e o servidor
// (permissões e registro de dados). Editar aqui muda os dois lados.

export type ModuleId =
  | 'geral'
  | 'operacao'
  | 'esportes'
  | 'cassino'
  | 'crescimento'
  | 'afiliados'
  | 'campanhas'
  | 'personalizacao'
  | 'seguranca'
  | 'configuracoes'

export type PageKind = 'relatorio' | 'listagem' | 'configuracao' | 'formulario'

export interface PageInfo {
  id: string
  title: string
  path: string
  module: ModuleId
  description: string
  kind: PageKind
  /** termos extras para a busca de páginas */
  keywords?: string
  /** a tela tem ações de edição (gera a permissão "<id>.editar") */
  editable: boolean
  /** permissões especiais além de ver/editar */
  extraPerms?: { key: string; label: string }[]
}

export interface ModuleInfo {
  id: ModuleId
  title: string
  description: string
}

export const MODULE_INFO: ModuleInfo[] = [
  { id: 'geral', title: 'Geral', description: 'Indicadores, jogadores, rankings e transações' },
  { id: 'operacao', title: 'Operação', description: 'Fila de saques e depósitos' },
  { id: 'esportes', title: 'Esportes', description: 'Apostas esportivas' },
  { id: 'cassino', title: 'Cassino', description: 'Jogos, provedoras, vitrines e agregadores' },
  { id: 'crescimento', title: 'Crescimento', description: 'GGR, afiliados, indicados, links e comissões' },
  { id: 'afiliados', title: 'Programa de afiliados', description: 'Gerentes, comissões e saques de afiliados' },
  { id: 'campanhas', title: 'Campanhas', description: 'Promoções, bônus, missões, disparos e jornadas' },
  { id: 'personalizacao', title: 'Personalização', description: 'Tema, home, banners, menus, rodapé e SEO' },
  { id: 'seguranca', title: 'Segurança', description: 'Anti-fraude e modo de ataque' },
  { id: 'configuracoes', title: 'Configurações', description: 'Empresa, KYC, pagamentos, e-mail, equipe e auditoria' },
]

const p = (def: Omit<PageInfo, 'editable'> & { editable?: boolean }): PageInfo => ({ editable: true, ...def })

export const PAGE_INFO: PageInfo[] = [
  p({ id: 'dashboard', title: 'Dashboard', path: '/dashboard', module: 'geral', kind: 'relatorio', editable: false, description: 'Indicadores da operação no período', keywords: 'ggr ngr ftd painel indicadores métricas kpi' }),
  p({ id: 'usuarios', title: 'Usuários', path: '/dashboard/usuarios', module: 'geral', kind: 'listagem', description: 'Lista de jogadores e ficha do jogador', keywords: 'jogadores clientes cpf ficha', extraPerms: [{ key: 'usuarios.exportar', label: 'Exportar jogadores' }, { key: 'usuarios.ver-dados', label: 'Ver CPF e celular completos' }] }),
  p({ id: 'rankings', title: 'Rankings', path: '/dashboard/rankings', module: 'geral', kind: 'relatorio', editable: false, description: 'Ranking de jogadores por seis critérios', keywords: 'top maiores apostadores ganhadores' }),
  p({ id: 'transacoes', title: 'Transações', path: '/dashboard/transacoes', module: 'geral', kind: 'listagem', description: 'Extrato de movimentações das carteiras', keywords: 'extrato saldo movimentação', extraPerms: [{ key: 'transacoes.exportar', label: 'Exportar transações' }] }),
  p({ id: 'saques', title: 'Saques', path: '/system/saques', module: 'operacao', kind: 'listagem', description: 'Fila operacional e regras de saque', keywords: 'pix retirada aprovar recusar fila rollover', extraPerms: [{ key: 'saques.aprovar', label: 'Aprovar e recusar saques' }] }),
  p({ id: 'depositos', title: 'Depósitos', path: '/system/deposits', module: 'operacao', kind: 'listagem', description: 'Depósitos, campanhas e limites', keywords: 'pix entrada ftd' }),
  p({ id: 'apostas-esportivas', title: 'Apostas esportivas', path: '/esportes/apostas', module: 'esportes', kind: 'listagem', editable: false, description: 'Consulta de apostas do sportsbook', keywords: 'sportsbook betby odd futebol bilhete' }),
  p({ id: 'jogos', title: 'Jogos', path: '/games/jogos', module: 'cassino', kind: 'listagem', description: 'Catálogo de jogos e capas', keywords: 'slots capa catálogo' }),
  p({ id: 'provedoras', title: 'Provedoras', path: '/games/provedoras', module: 'cassino', kind: 'listagem', description: 'Provedoras de jogos ativas e pausadas', keywords: 'providers fornecedores' }),
  p({ id: 'vitrines', title: 'Vitrines de jogos', path: '/settings/game-preview', module: 'cassino', kind: 'listagem', description: 'Vitrines da home e ordem de exibição', keywords: 'top 10 ao vivo seção' }),
  p({ id: 'agregadores', title: 'Agregadores de jogos', path: '/games/agregadores', module: 'cassino', kind: 'configuracao', description: 'Credenciais e sincronização dos agregadores', keywords: 'metagrator skravion api secret webhook sincronizar' }),
  p({ id: 'ggr', title: 'GGR', path: '/dashboard/ggr', module: 'crescimento', kind: 'relatorio', editable: false, description: 'Resultado da casa por provedora e jogo', keywords: 'receita rtp apuração provedor', extraPerms: [{ key: 'ggr.apurar', label: 'Fechar e pagar apurações de provedoras' }] }),
  p({ id: 'ranking-afiliados', title: 'Ranking de afiliados', path: '/dashboard/afiliados', module: 'crescimento', kind: 'relatorio', editable: false, description: 'Desempenho dos afiliados no período', keywords: 'cpa rev share afiliado' }),
  p({ id: 'indicados', title: 'Indicados', path: '/analysis/leads', module: 'crescimento', kind: 'listagem', editable: false, description: 'Jogadores indicados por afiliados', keywords: 'leads indicação' }),
  p({ id: 'links', title: 'Links', path: '/analysis/links', module: 'crescimento', kind: 'listagem', editable: false, description: 'Links de indicação e conversão', keywords: 'ref código referência' }),
  p({ id: 'comissoes', title: 'Comissões', path: '/system/affiliates', module: 'crescimento', kind: 'configuracao', description: 'Comissão por tipo de afiliado', keywords: 'manager influencer organic cpa revshare teto' }),
  p({ id: 'afiliados-visao-geral', title: 'Visão geral', path: '/system/programa-afiliados/visao-geral', module: 'afiliados', kind: 'relatorio', editable: false, description: 'Resultado por gerente de afiliados', keywords: 'gerentes resultado a pagar' }),
  p({ id: 'afiliados-gerentes', title: 'Gerentes', path: '/system/programa-afiliados/gerentes', module: 'afiliados', kind: 'listagem', description: 'Gerentes, contratos e subafiliados', keywords: 'manager contrato' }),
  p({ id: 'afiliados-saques', title: 'Saques de afiliados', path: '/system/programa-afiliados/saques', module: 'afiliados', kind: 'listagem', description: 'Pedidos de saque de comissão', keywords: 'pix comissão pagamento', extraPerms: [{ key: 'afiliados-saques.aprovar', label: 'Pagar e recusar saques de afiliados' }, { key: 'afiliados-saques.ver-pix', label: 'Ver dados do PIX completos' }] }),
  p({ id: 'afiliados-configuracao', title: 'Configuração', path: '/system/programa-afiliados/configuracao', module: 'afiliados', kind: 'configuracao', description: 'Regras do programa de afiliados', keywords: 'saque mínimo rollover carteira' }),
  p({ id: 'promocoes', title: 'Promoções', path: '/campanhas/promocoes', module: 'campanhas', kind: 'listagem', description: 'Cria e lista promoções', keywords: 'campanha oferta' }),
  p({ id: 'templates', title: 'Templates', path: '/campanhas/templates', module: 'campanhas', kind: 'listagem', description: 'Templates de webhook por tipo de evento', keywords: 'evento payload json' }),
  p({ id: 'webhooks', title: 'Webhooks', path: '/campanhas/webhooks', module: 'campanhas', kind: 'configuracao', description: 'Destinos HTTP por evento de saque e depósito', keywords: 'http endpoint url integração' }),
  p({ id: 'free-spins', title: 'Free Spins', path: '/campanhas/free-spins', module: 'campanhas', kind: 'listagem', description: 'Campanhas de giros e concessões', keywords: 'giros grátis rodadas' }),
  p({ id: 'bonus-deposito', title: 'Bônus de depósito', path: '/campanhas/bonus-deposito', module: 'campanhas', kind: 'listagem', description: 'Campanhas de bônus sobre depósito', keywords: 'dobro match bonus' }),
  p({ id: 'saldo-bonus', title: 'Saldo bônus', path: '/campanhas/saldo-bonus', module: 'campanhas', kind: 'configuracao', description: 'Onde o saldo bônus vale e a ordem de uso', keywords: 'carteira bônus ordem' }),
  p({ id: 'rollover', title: 'Rollover', path: '/campanhas/rollover', module: 'campanhas', kind: 'configuracao', description: 'Peso de cada tipo de aposta no rollover', keywords: 'wagering peso aposta crash' }),
  p({ id: 'moeda', title: 'Moeda', path: '/campanhas/moeda', module: 'campanhas', kind: 'configuracao', description: 'Moeda do site (Evox Coins) e como se ganha', keywords: 'evc evox coins pontos' }),
  p({ id: 'roleta', title: 'Roleta', path: '/campanhas/roleta', module: 'campanhas', kind: 'listagem', description: 'Roletas de prêmios por grupo de jogadores', keywords: 'wheel prêmio giro' }),
  p({ id: 'loja', title: 'Loja', path: '/campanhas/loja', module: 'campanhas', kind: 'listagem', description: 'Itens comprados com moedas', keywords: 'shop itens moedas' }),
  p({ id: 'cupons', title: 'Cupons', path: '/campanhas/cupons', module: 'campanhas', kind: 'listagem', description: 'Cupons e resgates', keywords: 'código promocional voucher' }),
  p({ id: 'indicacao', title: 'Indicação', path: '/campanhas/indicacao', module: 'campanhas', kind: 'configuracao', description: 'Baús por número de indicados válidos', keywords: 'baú indique amigo referral' }),
  p({ id: 'missoes', title: 'Missões', path: '/campanhas/missoes', module: 'campanhas', kind: 'listagem', description: 'Objetivos que dão recompensa', keywords: 'desafios metas' }),
  p({ id: 'torneios', title: 'Torneios', path: '/campanhas/torneios', module: 'campanhas', kind: 'listagem', description: 'Competições por pontuação com ranking', keywords: 'competição ranking leaderboard' }),
  p({ id: 'niveis', title: 'Níveis e XP', path: '/campanhas/niveis', module: 'campanhas', kind: 'configuracao', description: 'Trilha de níveis e regras de XP', keywords: 'vip level experiência' }),
  p({ id: 'cashback', title: 'Cashback e Rakeback', path: '/campanhas/cashback', module: 'campanhas', kind: 'configuracao', description: 'Devolução de perda e de aposta', keywords: 'devolução perda rakeback' }),
  p({ id: 'notificacoes', title: 'Notificações', path: '/campanhas/notificacoes', module: 'campanhas', kind: 'formulario', description: 'Mensagens no sino do jogador', keywords: 'aviso sino push' }),
  p({ id: 'popups-inbox', title: 'Popups e Inbox', path: '/campanhas/popups-inbox', module: 'campanhas', kind: 'listagem', description: 'Modais no site e caixa de mensagens', keywords: 'modal mensagem' }),
  p({ id: 'disparos', title: 'Disparos', path: '/campanhas/disparos', module: 'campanhas', kind: 'formulario', description: 'E-mail, SMS e RCS para públicos', keywords: 'email sms rcs campanha envio sendwork' }),
  p({ id: 'jornadas', title: 'Jornadas', path: '/campanhas/jornadas', module: 'campanhas', kind: 'listagem', description: 'Automações por jogador com gatilho e etapas', keywords: 'automação fluxo crm gatilho' }),
  p({ id: 'estatisticas', title: 'Estatísticas', path: '/campanhas/estatisticas', module: 'campanhas', kind: 'relatorio', editable: false, description: 'Execuções e falhas de webhooks', keywords: 'taxa sucesso falhas execuções' }),
  p({ id: 'tema', title: 'Identidade e tema', path: '/settings/theme', module: 'personalizacao', kind: 'configuracao', description: 'Logotipo, ícone, cores e imagem de compartilhamento', keywords: 'logo marca cores favicon' }),
  p({ id: 'sportsbook', title: 'Sportsbook', path: '/settings/sportsbook', module: 'personalizacao', kind: 'configuracao', description: 'Visual das apostas esportivas', keywords: 'betby tema claro escuro fonte' }),
  p({ id: 'home', title: 'Página inicial', path: '/settings/home', module: 'personalizacao', kind: 'configuracao', description: 'Blocos e ordem da home', keywords: 'blocos seções arrastar' }),
  p({ id: 'provedores-home', title: 'Provedores na home', path: '/settings/provedores-home', module: 'personalizacao', kind: 'configuracao', description: 'Faixa de provedores da home', keywords: 'logos faixa ordem' }),
  p({ id: 'banners', title: 'Banners', path: '/settings/banners', module: 'personalizacao', kind: 'configuracao', description: 'Banners por posição e tamanho', keywords: 'hero imagem login cadastro' }),
  p({ id: 'avatares', title: 'Perfil e avatares', path: '/settings/avatar', module: 'personalizacao', kind: 'configuracao', description: 'Avatares dos jogadores no site', keywords: 'avatar perfil conquista' }),
  p({ id: 'menus', title: 'Menus do site', path: '/settings/navigation', module: 'personalizacao', kind: 'configuracao', description: 'Cabeçalho e barra do celular', keywords: 'navegação menu cabeçalho' }),
  p({ id: 'carrosseis', title: 'Carrosséis do jogo', path: '/settings/game-showcase', module: 'personalizacao', kind: 'configuracao', description: 'Carrosséis na página de cada jogo', keywords: 'maiores vitórias relacionados' }),
  p({ id: 'rodape', title: 'Rodapé e contato', path: '/settings/footer', module: 'personalizacao', kind: 'configuracao', description: 'Dados da empresa e canais de contato', keywords: 'footer whatsapp telefone' }),
  p({ id: 'redes-sociais', title: 'Redes sociais', path: '/settings/social', module: 'personalizacao', kind: 'configuracao', description: 'Links das redes sociais', keywords: 'instagram telegram x youtube' }),
  p({ id: 'seo', title: 'SEO avançado', path: '/settings/seo', module: 'personalizacao', kind: 'configuracao', description: 'Título, descrição e prévia do link', keywords: 'google meta tags canonical' }),
  p({ id: 'antifraude', title: 'Anti-fraude', path: '/seguranca/antifraude', module: 'seguranca', kind: 'listagem', description: 'Contas ligadas e bloqueios', keywords: 'fraude multicontas ip banir rede', extraPerms: [{ key: 'antifraude.banir', label: 'Banir redes e bloquear IPs' }] }),
  p({ id: 'modo-ataque', title: 'Modo de ataque', path: '/settings/modo-ataque', module: 'seguranca', kind: 'configuracao', description: 'Defesa rápida durante um ataque', keywords: 'ddos bot captcha defesa' }),
  p({ id: 'empresa', title: 'Empresa e licença', path: '/settings/empresa', module: 'configuracoes', kind: 'configuracao', description: 'Razão social, CNPJ e autorização', keywords: 'cnpj licença spa portaria' }),
  p({ id: 'faturas', title: 'Faturas', path: '/faturas', module: 'configuracoes', kind: 'listagem', description: 'Cobranças da plataforma', keywords: 'boleto pagamento vencimento' }),
  p({ id: 'textos-legais', title: 'Textos legais', path: '/settings/textos-legais', module: 'configuracoes', kind: 'configuracao', description: 'Termos, privacidade e jogo responsável', keywords: 'termos de uso política lgpd' }),
  p({ id: 'modulos', title: 'Módulos do site', path: '/settings/modulos', module: 'configuracoes', kind: 'configuracao', description: 'Liga e desliga áreas do site', keywords: 'ativar desativar área' }),
  p({ id: 'cadastro', title: 'Cadastro e KYC', path: '/settings/cadastro', module: 'configuracoes', kind: 'configuracao', description: 'Tipo de cadastro e campos obrigatórios', keywords: 'kyc idade 18 nascimento cpf' }),
  p({ id: 'jogo-responsavel', title: 'Jogo responsável', path: '/settings/jogo-responsavel', module: 'configuracoes', kind: 'configuracao', description: 'Limites de depósito e pausa', keywords: 'lei 14.790 autoexclusão limite' }),
  p({ id: 'suporte', title: 'Suporte e contato', path: '/settings/suporte', module: 'configuracoes', kind: 'configuracao', description: 'Canais de atendimento e chat ao vivo', keywords: 'chat atendimento' }),
  p({ id: 'manutencao', title: 'Manutenção', path: '/settings/manutencao', module: 'configuracoes', kind: 'configuracao', description: 'Fecha o site com aviso', keywords: 'fechar site aviso' }),
  p({ id: 'dominios', title: 'Domínios', path: '/settings/dominios', module: 'configuracoes', kind: 'relatorio', editable: false, description: 'Domínio principal e endereços', keywords: 'dns url endereço' }),
  p({ id: 'paises', title: 'Países bloqueados', path: '/settings/paises', module: 'configuracoes', kind: 'configuracao', description: 'Bloqueio de países', keywords: 'geo bloqueio país' }),
  p({ id: 'tracking', title: 'Pixels e tracking', path: '/settings/tracking', module: 'configuracoes', kind: 'configuracao', description: 'Pixels de Meta, TikTok, Kwai e Analytics', keywords: 'pixel meta tiktok kwai ga4 eventos' }),
  p({ id: 'gateways', title: 'Gateways', path: '/settings/gateways', module: 'configuracoes', kind: 'configuracao', description: 'Contas de pagamento', keywords: 'pix pagamento credencial callback' }),
  p({ id: 'integracoes', title: 'Integrações', path: '/settings/integracoes', module: 'configuracoes', kind: 'configuracao', description: 'E-mail, SMS e RCS', keywords: 'smtp mailgun sendwork' }),
  p({ id: 'templates-email', title: 'Templates de e-mail', path: '/settings/templates-email', module: 'configuracoes', kind: 'configuracao', description: 'Textos dos e-mails transacionais', keywords: 'senha boas-vindas e-mail' }),
  p({ id: 'equipe', title: 'Equipe', path: '/settings/equipe', module: 'configuracoes', kind: 'listagem', description: 'Pessoas com acesso ao painel', keywords: 'usuários admin convite 2fa' }),
  p({ id: 'cargos', title: 'Cargos e permissões', path: '/settings/cargos', module: 'configuracoes', kind: 'configuracao', description: 'Permissões, 2FA e teto de saque', keywords: 'roles acesso permissão', extraPerms: [{ key: 'cargos.conceder', label: 'Conceder e retirar cargos administrativos' }] }),
  p({ id: 'mcp', title: 'IA no painel (MCP)', path: '/settings/mcp', module: 'configuracoes', kind: 'configuracao', description: 'Chaves de API para ferramentas de IA', keywords: 'api key claude mcp ia' }),
  p({ id: 'seguranca-painel', title: 'Segurança do painel', path: '/settings/seguranca', module: 'configuracoes', kind: 'configuracao', description: 'IPs permitidos para a equipe', keywords: 'ip allowlist whitelist' }),
  p({ id: 'auditoria', title: 'Auditoria', path: '/settings/auditoria', module: 'configuracoes', kind: 'listagem', editable: false, description: 'Registro de ações no painel', keywords: 'log histórico quem fez', extraPerms: [{ key: 'auditoria.exportar', label: 'Exportar auditoria' }] }),
]

export const PAGE_INFO_BY_ID = new Map(PAGE_INFO.map((pg) => [pg.id, pg]))
