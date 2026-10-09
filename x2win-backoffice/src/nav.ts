// Mapa do painel: 10 módulos e 73 telas. Fonte única para a barra lateral,
// a busca de páginas, as rotas, o breadcrumb e o catálogo de permissões.
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  AtSign,
  Award,
  BadgePercent,
  Bell,
  Blocks,
  Bot,
  Braces,
  Building2,
  ChartColumnIncreasing,
  CircleUserRound,
  Coins,
  Construction,
  CreditCard,
  Earth,
  FileText,
  Gamepad2,
  GalleryHorizontalEnd,
  Gift,
  Globe,
  HandCoins,
  Headset,
  HeartHandshake,
  House,
  IdCard,
  Image,
  Inbox,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  LayoutList,
  Link2,
  LoaderPinwheel,
  Lock,
  Mail,
  Medal,
  Megaphone,
  Network,
  Palette,
  PanelBottom,
  PanelTop,
  Percent,
  PieChart,
  PiggyBank,
  Plug,
  Radar,
  Receipt,
  Repeat,
  Route,
  ScrollText,
  SearchCode,
  Send,
  Settings,
  ShieldAlert,
  Siren,
  SlidersHorizontal,
  Sparkles,
  Store,
  Swords,
  Target,
  TicketPercent,
  Trophy,
  TrendingUp,
  UserCog,
  UserPlus,
  Users,
  UsersRound,
  Volleyball,
  Wallet,
  Webhook,
  Shield,
} from 'lucide-react'

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

export interface PageDef {
  id: string
  title: string
  path: string
  module: ModuleId
  icon: LucideIcon
  description: string
  kind: PageKind
  /** termos extras para a busca de páginas */
  keywords?: string
  /** a tela tem ações de edição (gera a permissão "<id>.editar") */
  editable: boolean
  /** permissões especiais além de ver/editar */
  extraPerms?: { key: string; label: string }[]
}

export interface ModuleDef {
  id: ModuleId
  title: string
  icon: LucideIcon
  description: string
}

export const MODULES: ModuleDef[] = [
  { id: 'geral', title: 'Geral', icon: LayoutDashboard, description: 'Indicadores, jogadores, rankings e transações' },
  { id: 'operacao', title: 'Operação', icon: Wallet, description: 'Fila de saques e depósitos' },
  { id: 'esportes', title: 'Esportes', icon: Volleyball, description: 'Apostas esportivas' },
  { id: 'cassino', title: 'Cassino', icon: Gamepad2, description: 'Jogos, provedoras, vitrines e agregadores' },
  { id: 'crescimento', title: 'Crescimento', icon: TrendingUp, description: 'GGR, afiliados, indicados, links e comissões' },
  { id: 'afiliados', title: 'Programa de afiliados', icon: HandCoins, description: 'Gerentes, comissões e saques de afiliados' },
  { id: 'campanhas', title: 'Campanhas', icon: Megaphone, description: 'Promoções, bônus, missões, disparos e jornadas' },
  { id: 'personalizacao', title: 'Personalização', icon: Palette, description: 'Tema, home, banners, menus, rodapé e SEO' },
  { id: 'seguranca', title: 'Segurança', icon: Shield, description: 'Anti-fraude e modo de ataque' },
  { id: 'configuracoes', title: 'Configurações', icon: Settings, description: 'Empresa, KYC, pagamentos, e-mail, equipe e auditoria' },
]

const p = (def: Omit<PageDef, 'editable'> & { editable?: boolean }): PageDef => ({ editable: true, ...def })

export const PAGES: PageDef[] = [
  // Geral (4)
  p({ id: 'dashboard', title: 'Dashboard', path: '/dashboard', module: 'geral', icon: LayoutDashboard, kind: 'relatorio', editable: false, description: 'Indicadores da operação no período', keywords: 'ggr ngr ftd painel indicadores métricas kpi' }),
  p({ id: 'usuarios', title: 'Usuários', path: '/dashboard/usuarios', module: 'geral', icon: Users, kind: 'listagem', description: 'Lista de jogadores e ficha do jogador', keywords: 'jogadores clientes cpf ficha', extraPerms: [{ key: 'usuarios.exportar', label: 'Exportar jogadores' }, { key: 'usuarios.ver-dados', label: 'Ver CPF e celular completos' }] }),
  p({ id: 'rankings', title: 'Rankings', path: '/dashboard/rankings', module: 'geral', icon: Trophy, kind: 'relatorio', editable: false, description: 'Ranking de jogadores por seis critérios', keywords: 'top maiores apostadores ganhadores' }),
  p({ id: 'transacoes', title: 'Transações', path: '/dashboard/transacoes', module: 'geral', icon: ArrowLeftRight, kind: 'listagem', description: 'Extrato de movimentações das carteiras', keywords: 'extrato saldo movimentação', extraPerms: [{ key: 'transacoes.exportar', label: 'Exportar transações' }] }),
  // Operação (2)
  p({ id: 'saques', title: 'Saques', path: '/system/saques', module: 'operacao', icon: ArrowUpFromLine, kind: 'listagem', description: 'Fila operacional e regras de saque', keywords: 'pix retirada aprovar recusar fila rollover', extraPerms: [{ key: 'saques.aprovar', label: 'Aprovar e recusar saques' }] }),
  p({ id: 'depositos', title: 'Depósitos', path: '/system/deposits', module: 'operacao', icon: ArrowDownToLine, kind: 'listagem', description: 'Depósitos, campanhas e limites', keywords: 'pix entrada ftd' }),
  // Esportes (1)
  p({ id: 'apostas-esportivas', title: 'Apostas esportivas', path: '/esportes/apostas', module: 'esportes', icon: Volleyball, kind: 'listagem', editable: false, description: 'Consulta de apostas do sportsbook', keywords: 'sportsbook betby odd futebol bilhete' }),
  // Cassino (4)
  p({ id: 'jogos', title: 'Jogos', path: '/games/jogos', module: 'cassino', icon: Gamepad2, kind: 'listagem', description: 'Catálogo de jogos e capas', keywords: 'slots capa catálogo' }),
  p({ id: 'provedoras', title: 'Provedoras', path: '/games/provedoras', module: 'cassino', icon: Building2, kind: 'listagem', description: 'Provedoras de jogos ativas e pausadas', keywords: 'providers fornecedores' }),
  p({ id: 'vitrines', title: 'Vitrines de jogos', path: '/settings/game-preview', module: 'cassino', icon: LayoutGrid, kind: 'listagem', description: 'Vitrines da home e ordem de exibição', keywords: 'top 10 ao vivo seção' }),
  p({ id: 'agregadores', title: 'Agregadores de jogos', path: '/games/agregadores', module: 'cassino', icon: Network, kind: 'configuracao', description: 'Credenciais e sincronização dos agregadores', keywords: 'metagrator skravion api secret webhook sincronizar' }),
  // Crescimento (5)
  p({ id: 'ggr', title: 'GGR', path: '/dashboard/ggr', module: 'crescimento', icon: ChartColumnIncreasing, kind: 'relatorio', editable: false, description: 'Resultado da casa por provedora e jogo', keywords: 'receita rtp apuração provedor', extraPerms: [{ key: 'ggr.apurar', label: 'Fechar e pagar apurações de provedoras' }] }),
  p({ id: 'ranking-afiliados', title: 'Ranking de afiliados', path: '/dashboard/afiliados', module: 'crescimento', icon: Medal, kind: 'relatorio', editable: false, description: 'Desempenho dos afiliados no período', keywords: 'cpa rev share afiliado' }),
  p({ id: 'indicados', title: 'Indicados', path: '/analysis/leads', module: 'crescimento', icon: UserPlus, kind: 'listagem', editable: false, description: 'Jogadores indicados por afiliados', keywords: 'leads indicação' }),
  p({ id: 'links', title: 'Links', path: '/analysis/links', module: 'crescimento', icon: Link2, kind: 'listagem', editable: false, description: 'Links de indicação e conversão', keywords: 'ref código referência' }),
  p({ id: 'comissoes', title: 'Comissões', path: '/system/affiliates', module: 'crescimento', icon: Percent, kind: 'configuracao', description: 'Comissão por tipo de afiliado', keywords: 'manager influencer organic cpa revshare teto' }),
  // Programa de afiliados (4)
  p({ id: 'afiliados-visao-geral', title: 'Visão geral', path: '/system/programa-afiliados/visao-geral', module: 'afiliados', icon: PieChart, kind: 'relatorio', editable: false, description: 'Resultado por gerente de afiliados', keywords: 'gerentes resultado a pagar' }),
  p({ id: 'afiliados-gerentes', title: 'Gerentes', path: '/system/programa-afiliados/gerentes', module: 'afiliados', icon: UserCog, kind: 'listagem', description: 'Gerentes, contratos e subafiliados', keywords: 'manager contrato' }),
  p({ id: 'afiliados-saques', title: 'Saques de afiliados', path: '/system/programa-afiliados/saques', module: 'afiliados', icon: HandCoins, kind: 'listagem', description: 'Pedidos de saque de comissão', keywords: 'pix comissão pagamento', extraPerms: [{ key: 'afiliados-saques.aprovar', label: 'Pagar e recusar saques de afiliados' }, { key: 'afiliados-saques.ver-pix', label: 'Ver dados do PIX completos' }] }),
  p({ id: 'afiliados-configuracao', title: 'Configuração', path: '/system/programa-afiliados/configuracao', module: 'afiliados', icon: SlidersHorizontal, kind: 'configuracao', description: 'Regras do programa de afiliados', keywords: 'saque mínimo rollover carteira' }),
  // Campanhas (21)
  p({ id: 'promocoes', title: 'Promoções', path: '/campanhas/promocoes', module: 'campanhas', icon: Megaphone, kind: 'listagem', description: 'Cria e lista promoções', keywords: 'campanha oferta' }),
  p({ id: 'templates', title: 'Templates', path: '/campanhas/templates', module: 'campanhas', icon: Braces, kind: 'listagem', description: 'Templates de webhook por tipo de evento', keywords: 'evento payload json' }),
  p({ id: 'webhooks', title: 'Webhooks', path: '/campanhas/webhooks', module: 'campanhas', icon: Webhook, kind: 'configuracao', description: 'Destinos HTTP por evento de saque e depósito', keywords: 'http endpoint url integração' }),
  p({ id: 'free-spins', title: 'Free Spins', path: '/campanhas/free-spins', module: 'campanhas', icon: Sparkles, kind: 'listagem', description: 'Campanhas de giros e concessões', keywords: 'giros grátis rodadas' }),
  p({ id: 'bonus-deposito', title: 'Bônus de depósito', path: '/campanhas/bonus-deposito', module: 'campanhas', icon: Gift, kind: 'listagem', description: 'Campanhas de bônus sobre depósito', keywords: 'dobro match bonus' }),
  p({ id: 'saldo-bonus', title: 'Saldo bônus', path: '/campanhas/saldo-bonus', module: 'campanhas', icon: PiggyBank, kind: 'configuracao', description: 'Onde o saldo bônus vale e a ordem de uso', keywords: 'carteira bônus ordem' }),
  p({ id: 'rollover', title: 'Rollover', path: '/campanhas/rollover', module: 'campanhas', icon: Repeat, kind: 'configuracao', description: 'Peso de cada tipo de aposta no rollover', keywords: 'wagering peso aposta crash' }),
  p({ id: 'moeda', title: 'Moeda', path: '/campanhas/moeda', module: 'campanhas', icon: Coins, kind: 'configuracao', description: 'Moeda do site (Evox Coins) e como se ganha', keywords: 'evc evox coins pontos' }),
  p({ id: 'roleta', title: 'Roleta', path: '/campanhas/roleta', module: 'campanhas', icon: LoaderPinwheel, kind: 'listagem', description: 'Roletas de prêmios por grupo de jogadores', keywords: 'wheel prêmio giro' }),
  p({ id: 'loja', title: 'Loja', path: '/campanhas/loja', module: 'campanhas', icon: Store, kind: 'listagem', description: 'Itens comprados com moedas', keywords: 'shop itens moedas' }),
  p({ id: 'cupons', title: 'Cupons', path: '/campanhas/cupons', module: 'campanhas', icon: TicketPercent, kind: 'listagem', description: 'Cupons e resgates', keywords: 'código promocional voucher' }),
  p({ id: 'indicacao', title: 'Indicação', path: '/campanhas/indicacao', module: 'campanhas', icon: UsersRound, kind: 'configuracao', description: 'Baús por número de indicados válidos', keywords: 'baú indique amigo referral' }),
  p({ id: 'missoes', title: 'Missões', path: '/campanhas/missoes', module: 'campanhas', icon: Target, kind: 'listagem', description: 'Objetivos que dão recompensa', keywords: 'desafios metas' }),
  p({ id: 'torneios', title: 'Torneios', path: '/campanhas/torneios', module: 'campanhas', icon: Swords, kind: 'listagem', description: 'Competições por pontuação com ranking', keywords: 'competição ranking leaderboard' }),
  p({ id: 'niveis', title: 'Níveis e XP', path: '/campanhas/niveis', module: 'campanhas', icon: Award, kind: 'configuracao', description: 'Trilha de níveis e regras de XP', keywords: 'vip level experiência' }),
  p({ id: 'cashback', title: 'Cashback e Rakeback', path: '/campanhas/cashback', module: 'campanhas', icon: BadgePercent, kind: 'configuracao', description: 'Devolução de perda e de aposta', keywords: 'devolução perda rakeback' }),
  p({ id: 'notificacoes', title: 'Notificações', path: '/campanhas/notificacoes', module: 'campanhas', icon: Bell, kind: 'formulario', description: 'Mensagens no sino do jogador', keywords: 'aviso sino push' }),
  p({ id: 'popups-inbox', title: 'Popups e Inbox', path: '/campanhas/popups-inbox', module: 'campanhas', icon: Inbox, kind: 'listagem', description: 'Modais no site e caixa de mensagens', keywords: 'modal mensagem' }),
  p({ id: 'disparos', title: 'Disparos', path: '/campanhas/disparos', module: 'campanhas', icon: Send, kind: 'formulario', description: 'E-mail, SMS e RCS para públicos', keywords: 'email sms rcs campanha envio sendwork' }),
  p({ id: 'jornadas', title: 'Jornadas', path: '/campanhas/jornadas', module: 'campanhas', icon: Route, kind: 'listagem', description: 'Automações por jogador com gatilho e etapas', keywords: 'automação fluxo crm gatilho' }),
  p({ id: 'estatisticas', title: 'Estatísticas', path: '/campanhas/estatisticas', module: 'campanhas', icon: Activity, kind: 'relatorio', editable: false, description: 'Execuções e falhas de webhooks', keywords: 'taxa sucesso falhas execuções' }),
  // Personalização (11)
  p({ id: 'tema', title: 'Identidade e tema', path: '/settings/theme', module: 'personalizacao', icon: Palette, kind: 'configuracao', description: 'Logotipo, ícone, cores e imagem de compartilhamento', keywords: 'logo marca cores favicon' }),
  p({ id: 'sportsbook', title: 'Sportsbook', path: '/settings/sportsbook', module: 'personalizacao', icon: Trophy, kind: 'configuracao', description: 'Visual das apostas esportivas', keywords: 'betby tema claro escuro fonte' }),
  p({ id: 'home', title: 'Página inicial', path: '/settings/home', module: 'personalizacao', icon: House, kind: 'configuracao', description: 'Blocos e ordem da home', keywords: 'blocos seções arrastar' }),
  p({ id: 'provedores-home', title: 'Provedores na home', path: '/settings/provedores-home', module: 'personalizacao', icon: LayoutList, kind: 'configuracao', description: 'Faixa de provedores da home', keywords: 'logos faixa ordem' }),
  p({ id: 'banners', title: 'Banners', path: '/settings/banners', module: 'personalizacao', icon: Image, kind: 'configuracao', description: 'Banners por posição e tamanho', keywords: 'hero imagem login cadastro' }),
  p({ id: 'avatares', title: 'Perfil e avatares', path: '/settings/avatar', module: 'personalizacao', icon: CircleUserRound, kind: 'configuracao', description: 'Avatares dos jogadores no site', keywords: 'avatar perfil conquista' }),
  p({ id: 'menus', title: 'Menus do site', path: '/settings/navigation', module: 'personalizacao', icon: PanelTop, kind: 'configuracao', description: 'Cabeçalho e barra do celular', keywords: 'navegação menu cabeçalho' }),
  p({ id: 'carrosseis', title: 'Carrosséis do jogo', path: '/settings/game-showcase', module: 'personalizacao', icon: GalleryHorizontalEnd, kind: 'configuracao', description: 'Carrosséis na página de cada jogo', keywords: 'maiores vitórias relacionados' }),
  p({ id: 'rodape', title: 'Rodapé e contato', path: '/settings/footer', module: 'personalizacao', icon: PanelBottom, kind: 'configuracao', description: 'Dados da empresa e canais de contato', keywords: 'footer whatsapp telefone' }),
  p({ id: 'redes-sociais', title: 'Redes sociais', path: '/settings/social', module: 'personalizacao', icon: AtSign, kind: 'configuracao', description: 'Links das redes sociais', keywords: 'instagram telegram x youtube' }),
  p({ id: 'seo', title: 'SEO avançado', path: '/settings/seo', module: 'personalizacao', icon: SearchCode, kind: 'configuracao', description: 'Título, descrição e prévia do link', keywords: 'google meta tags canonical' }),
  // Segurança (2)
  p({ id: 'antifraude', title: 'Anti-fraude', path: '/seguranca/antifraude', module: 'seguranca', icon: ShieldAlert, kind: 'listagem', description: 'Contas ligadas e bloqueios', keywords: 'fraude multicontas ip banir rede', extraPerms: [{ key: 'antifraude.banir', label: 'Banir redes e bloquear IPs' }] }),
  p({ id: 'modo-ataque', title: 'Modo de ataque', path: '/settings/modo-ataque', module: 'seguranca', icon: Siren, kind: 'configuracao', description: 'Defesa rápida durante um ataque', keywords: 'ddos bot captcha defesa' }),
  // Configurações (19)
  p({ id: 'empresa', title: 'Empresa e licença', path: '/settings/empresa', module: 'configuracoes', icon: Landmark, kind: 'configuracao', description: 'Razão social, CNPJ e autorização', keywords: 'cnpj licença spa portaria' }),
  p({ id: 'faturas', title: 'Faturas', path: '/faturas', module: 'configuracoes', icon: Receipt, kind: 'listagem', description: 'Cobranças da plataforma', keywords: 'boleto pagamento vencimento' }),
  p({ id: 'textos-legais', title: 'Textos legais', path: '/settings/textos-legais', module: 'configuracoes', icon: FileText, kind: 'configuracao', description: 'Termos, privacidade e jogo responsável', keywords: 'termos de uso política lgpd' }),
  p({ id: 'modulos', title: 'Módulos do site', path: '/settings/modulos', module: 'configuracoes', icon: Blocks, kind: 'configuracao', description: 'Liga e desliga áreas do site', keywords: 'ativar desativar área' }),
  p({ id: 'cadastro', title: 'Cadastro e KYC', path: '/settings/cadastro', module: 'configuracoes', icon: IdCard, kind: 'configuracao', description: 'Tipo de cadastro e campos obrigatórios', keywords: 'kyc idade 18 nascimento cpf' }),
  p({ id: 'jogo-responsavel', title: 'Jogo responsável', path: '/settings/jogo-responsavel', module: 'configuracoes', icon: HeartHandshake, kind: 'configuracao', description: 'Limites de depósito e pausa', keywords: 'lei 14.790 autoexclusão limite' }),
  p({ id: 'suporte', title: 'Suporte e contato', path: '/settings/suporte', module: 'configuracoes', icon: Headset, kind: 'configuracao', description: 'Canais de atendimento e chat ao vivo', keywords: 'chat atendimento' }),
  p({ id: 'manutencao', title: 'Manutenção', path: '/settings/manutencao', module: 'configuracoes', icon: Construction, kind: 'configuracao', description: 'Fecha o site com aviso', keywords: 'fechar site aviso' }),
  p({ id: 'dominios', title: 'Domínios', path: '/settings/dominios', module: 'configuracoes', icon: Globe, kind: 'relatorio', editable: false, description: 'Domínio principal e endereços', keywords: 'dns url endereço' }),
  p({ id: 'paises', title: 'Países bloqueados', path: '/settings/paises', module: 'configuracoes', icon: Earth, kind: 'configuracao', description: 'Bloqueio de países', keywords: 'geo bloqueio país' }),
  p({ id: 'tracking', title: 'Pixels e tracking', path: '/settings/tracking', module: 'configuracoes', icon: Radar, kind: 'configuracao', description: 'Pixels de Meta, TikTok, Kwai e Analytics', keywords: 'pixel meta tiktok kwai ga4 eventos' }),
  p({ id: 'gateways', title: 'Gateways', path: '/settings/gateways', module: 'configuracoes', icon: CreditCard, kind: 'configuracao', description: 'Contas de pagamento', keywords: 'pix pagamento credencial callback' }),
  p({ id: 'integracoes', title: 'Integrações', path: '/settings/integracoes', module: 'configuracoes', icon: Plug, kind: 'configuracao', description: 'E-mail, SMS e RCS', keywords: 'smtp mailgun sendwork' }),
  p({ id: 'templates-email', title: 'Templates de e-mail', path: '/settings/templates-email', module: 'configuracoes', icon: Mail, kind: 'configuracao', description: 'Textos dos e-mails transacionais', keywords: 'senha boas-vindas e-mail' }),
  p({ id: 'equipe', title: 'Equipe', path: '/settings/equipe', module: 'configuracoes', icon: UsersRound, kind: 'listagem', description: 'Pessoas com acesso ao painel', keywords: 'usuários admin convite 2fa' }),
  p({ id: 'cargos', title: 'Cargos e permissões', path: '/settings/cargos', module: 'configuracoes', icon: KeyRound, kind: 'configuracao', description: 'Permissões, 2FA e teto de saque', keywords: 'roles acesso permissão', extraPerms: [{ key: 'cargos.conceder', label: 'Conceder e retirar cargos administrativos' }] }),
  p({ id: 'mcp', title: 'IA no painel (MCP)', path: '/settings/mcp', module: 'configuracoes', icon: Bot, kind: 'configuracao', description: 'Chaves de API para ferramentas de IA', keywords: 'api key claude mcp ia' }),
  p({ id: 'seguranca-painel', title: 'Segurança do painel', path: '/settings/seguranca', module: 'configuracoes', icon: Lock, kind: 'configuracao', description: 'IPs permitidos para a equipe', keywords: 'ip allowlist whitelist' }),
  p({ id: 'auditoria', title: 'Auditoria', path: '/settings/auditoria', module: 'configuracoes', icon: ScrollText, kind: 'listagem', editable: false, description: 'Registro de ações no painel', keywords: 'log histórico quem fez', extraPerms: [{ key: 'auditoria.exportar', label: 'Exportar auditoria' }] }),
]

export const PAGE_BY_ID = new Map(PAGES.map((pg) => [pg.id, pg]))
export const MODULE_BY_ID = new Map(MODULES.map((m) => [m.id, m]))

export function pagesOf(module: ModuleId) {
  return PAGES.filter((pg) => pg.module === module)
}

export function pageByPath(path: string) {
  return PAGES.find((pg) => pg.path === path)
}
