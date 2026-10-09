// Regras de Configurações › Módulos do site.
// Desligar uma área remove, de uma vez, a entrada no menu, o bloco da home e a página.

export const MODULES_KEY = 'config.modulos'

export type SiteModuleId =
  | 'cassino'
  | 'cassino-ao-vivo'
  | 'esportes'
  | 'promocoes'
  | 'torneios'
  | 'missoes'
  | 'loja'
  | 'roleta'
  | 'indicacao'
  | 'niveis'
  | 'cashback'
  | 'blog'

export type ModulesState = Record<SiteModuleId, boolean>

export type ModuleGroup = 'jogos' | 'engajamento' | 'conteudo'

export const MODULE_GROUP_LABEL: Record<ModuleGroup, string> = {
  jogos: 'Jogos e apostas',
  engajamento: 'Engajamento e recompensas',
  conteudo: 'Conteúdo',
}

export interface SiteModule {
  id: SiteModuleId
  name: string
  group: ModuleGroup
  description: string
  /** rótulo no menu do site */
  menuLabel: string
  /** bloco da página inicial (null = não tem bloco) */
  homeBlock: string | null
  /** página pública */
  path: string
  /** o que continua valendo quando a área é desligada */
  keeps: string
  /** tela do backoffice que configura a área */
  adminPath: string | null
}

export const SITE_MODULES: SiteModule[] = [
  {
    id: 'cassino',
    name: 'Cassino',
    group: 'jogos',
    description: 'Slots, crash e jogos de mesa das provedoras.',
    menuLabel: 'Cassino',
    homeBlock: 'Vitrines de jogos',
    path: '/cassino',
    keeps: 'Rodadas em andamento terminam normalmente. O saldo do jogador não muda.',
    adminPath: '/games/jogos',
  },
  {
    id: 'cassino-ao-vivo',
    name: 'Cassino ao vivo',
    group: 'jogos',
    description: 'Roleta, blackjack e game shows com crupiê ao vivo.',
    menuLabel: 'Ao vivo',
    homeBlock: 'Melhores ao vivo',
    path: '/cassino-ao-vivo',
    keeps: 'Mesas abertas fecham ao fim da rodada em curso.',
    adminPath: '/settings/game-preview',
  },
  {
    id: 'esportes',
    name: 'Esportes',
    group: 'jogos',
    description: 'Apostas esportivas pré-jogo e ao vivo (sportsbook).',
    menuLabel: 'Esportes',
    homeBlock: 'Jogos em destaque',
    path: '/esportes',
    keeps: 'Apostas já feitas continuam abertas e são liquidadas normalmente.',
    adminPath: '/settings/sportsbook',
  },
  {
    id: 'promocoes',
    name: 'Promoções',
    group: 'engajamento',
    description: 'Página de promoções e bônus de depósito.',
    menuLabel: 'Promoções',
    homeBlock: 'Promoções em destaque',
    path: '/promocoes',
    keeps: 'Bônus já concedidos continuam valendo até o prazo de cada um.',
    adminPath: '/campanhas/promocoes',
  },
  {
    id: 'torneios',
    name: 'Torneios',
    group: 'engajamento',
    description: 'Competições por pontuação com ranking e prêmios.',
    menuLabel: 'Torneios',
    homeBlock: 'Torneios',
    path: '/torneios',
    keeps: 'Prêmios de torneios já encerrados continuam sendo pagos.',
    adminPath: '/campanhas/torneios',
  },
  {
    id: 'missoes',
    name: 'Missões',
    group: 'engajamento',
    description: 'Objetivos que dão recompensa ao jogador.',
    menuLabel: 'Missões',
    homeBlock: 'Missões do dia',
    path: '/missoes',
    keeps: 'Recompensas já resgatadas ficam no saldo do jogador.',
    adminPath: '/campanhas/missoes',
  },
  {
    id: 'loja',
    name: 'Loja',
    group: 'engajamento',
    description: 'Itens trocados pela moeda do site (Evox Coins).',
    menuLabel: 'Loja',
    homeBlock: 'Loja de prêmios',
    path: '/loja',
    keeps: 'As moedas do jogador ficam guardadas e voltam a valer quando a Loja for religada.',
    adminPath: '/campanhas/loja',
  },
  {
    id: 'roleta',
    name: 'Roleta',
    group: 'engajamento',
    description: 'Roleta de prêmios por grupo de jogadores.',
    menuLabel: 'Roleta',
    homeBlock: 'Gire a roleta',
    path: '/roleta',
    keeps: 'Giros ganhos e ainda não usados ficam guardados.',
    adminPath: '/campanhas/roleta',
  },
  {
    id: 'indicacao',
    name: 'Indicação',
    group: 'engajamento',
    description: 'Indique um amigo e abra baús por indicados válidos.',
    menuLabel: 'Indique e ganhe',
    homeBlock: 'Indique e ganhe',
    path: '/indique',
    keeps: 'Nenhum baú é aberto enquanto estiver desligada. Indicados já cadastrados continuam ligados a quem indicou.',
    adminPath: '/campanhas/indicacao',
  },
  {
    id: 'niveis',
    name: 'Níveis e VIP',
    group: 'engajamento',
    description: 'Trilha de níveis, XP e clube VIP.',
    menuLabel: 'VIP',
    homeBlock: 'Seu nível',
    path: '/vip',
    keeps: 'O XP continua sendo contado. Recompensas de nível ficam pausadas.',
    adminPath: '/campanhas/niveis',
  },
  {
    id: 'cashback',
    name: 'Cashback',
    group: 'engajamento',
    description: 'Devolução de parte das perdas e rakeback.',
    menuLabel: 'Cashback',
    homeBlock: null,
    path: '/cashback',
    keeps: 'Cashback já apurado no período é creditado normalmente.',
    adminPath: '/campanhas/cashback',
  },
  {
    id: 'blog',
    name: 'Blog',
    group: 'conteudo',
    description: 'Notícias, palpites e guias para os jogadores.',
    menuLabel: 'Blog',
    homeBlock: 'Últimas do blog',
    path: '/blog',
    keeps: 'Os posts ficam guardados e voltam ao ar quando o Blog for religado.',
    adminPath: null,
  },
]

export const SITE_MODULE_BY_ID = new Map(SITE_MODULES.map((m) => [m.id, m]))

export const DEFAULT_MODULES: ModulesState = {
  cassino: true,
  'cassino-ao-vivo': true,
  esportes: true,
  promocoes: true,
  torneios: true,
  missoes: true,
  loja: true,
  roleta: false,
  indicacao: true,
  niveis: true,
  cashback: true,
  blog: false,
}

/** O que sai do site ao desligar a área (menu, bloco da home e página). */
export function moduleImpact(m: SiteModule): { kind: 'menu' | 'home' | 'page'; label: string }[] {
  const out: { kind: 'menu' | 'home' | 'page'; label: string }[] = [{ kind: 'menu', label: `Sai do menu: ${m.menuLabel}` }]
  if (m.homeBlock) out.push({ kind: 'home', label: `Sai da home: bloco ${m.homeBlock}` })
  out.push({ kind: 'page', label: `Página ${m.path} fica indisponível` })
  return out
}

export function moduleImpactLine(m: SiteModule) {
  return moduleImpact(m)
    .map((i) => i.label)
    .join(' · ')
}

/** Ao menos uma área de jogo precisa ficar ligada: sem ela, o site não tem o que oferecer. */
export function validateModules(s: ModulesState): string | null {
  if (!s.cassino && !s['cassino-ao-vivo'] && !s.esportes) return 'Deixe ao menos uma área de jogo ligada (Cassino, Cassino ao vivo ou Esportes).'
  return null
}

export function modulesDiff(prev: ModulesState, next: ModulesState) {
  const turnedOff = SITE_MODULES.filter((m) => prev[m.id] && !next[m.id])
  const turnedOn = SITE_MODULES.filter((m) => !prev[m.id] && next[m.id])
  return { turnedOff, turnedOn }
}

export function moduleCounts(s: ModulesState) {
  const on = SITE_MODULES.filter((m) => s[m.id])
  return {
    on: on.length,
    total: SITE_MODULES.length,
    menu: on.length,
    home: on.filter((m) => m.homeBlock).length,
    pages: on.length,
  }
}
