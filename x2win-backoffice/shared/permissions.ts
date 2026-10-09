// Cargos e catálogo de permissões, compartilhados entre painel e servidor.
// O catálogo nasce do mapa de telas: cada tela gera "<id>.ver" e, se editável,
// "<id>.editar", além das permissões especiais (extraPerms).
import { PAGE_INFO as PAGES, type ModuleId } from './pages'

export interface Permission {
  key: string
  label: string
  module: ModuleId
  pageId: string
  kind: 'ver' | 'editar' | 'especial'
}

export const PERMISSIONS: Permission[] = PAGES.flatMap((pg) => {
  const list: Permission[] = [{ key: `${pg.id}.ver`, label: `Ver ${pg.title}`, module: pg.module, pageId: pg.id, kind: 'ver' }]
  if (pg.editable) list.push({ key: `${pg.id}.editar`, label: `Editar ${pg.title}`, module: pg.module, pageId: pg.id, kind: 'editar' })
  for (const x of pg.extraPerms ?? []) list.push({ key: x.key, label: x.label, module: pg.module, pageId: pg.id, kind: 'especial' })
  return list
})

export const PERMISSION_BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]))

export interface Role {
  id: string
  name: string
  description: string
  /** cargo do sistema: não pode ser excluído nem renomeado */
  system: boolean
  permissions: string[]
  require2fa: boolean
  /** null = sem teto; 0 = não aprova saques; >0 = teto em R$ */
  approvalCeiling: number | null
  color: string
}

const all = PERMISSIONS.map((p) => p.key)
const ofModules = (mods: ModuleId[], kinds: Permission['kind'][] = ['ver', 'editar', 'especial']) =>
  PERMISSIONS.filter((p) => mods.includes(p.module) && kinds.includes(p.kind)).map((p) => p.key)
const keys = (...k: string[]) => k

/** Cargo com acesso total. O 2FA dele é sempre exigido (o servidor não deixa desligar). */
export const SUPERADMIN_ROLE_ID = 'superadmin'

/**
 * A exigência de 2FA deste cargo está travada: a subida da API (bootstrap) liga em toda instalação e o editor de
 * cargos não deixa desligar. O painel mostra como "Exigido" e sem o botão de desligar.
 */
export function isRequire2faLocked(role: Pick<Role, 'id'>) {
  return role.id === SUPERADMIN_ROLE_ID
}

/**
 * Cargos que uma instalação nova (primeiro Superadmin criado pela subida) já entrega exigindo 2FA: acesso total e
 * aprovação de saques. Depois disso só o Superadmin fica travado; os outros seguem a decisão da operação.
 */
export const INSTALL_REQUIRE_2FA_ROLE_IDS = [SUPERADMIN_ROLE_ID, 'administrador', 'financeiro'] as const

// Catálogo base dos cargos (painel em demonstração e semente do banco). A exigência de 2FA de produção é aplicada
// pela subida da API: veja isRequire2faLocked e INSTALL_REQUIRE_2FA_ROLE_IDS.
export function seedRoles(): Role[] {
  return [
    {
      id: SUPERADMIN_ROLE_ID,
      name: 'Superadmin',
      description: 'Acesso total, inclui conceder e retirar cargos',
      system: true,
      permissions: all,
      require2fa: false,
      approvalCeiling: null,
      color: 'violet',
    },
    {
      id: 'administrador',
      name: 'Administrador',
      description: 'Acesso total à operação',
      system: true,
      permissions: all.filter((k) => k !== 'cargos.conceder'),
      require2fa: false,
      approvalCeiling: null,
      color: 'blue',
    },
    {
      id: 'financeiro',
      name: 'Financeiro',
      description: 'Depósitos, saques e gateways em leitura',
      system: true,
      permissions: keys(
        'dashboard.ver',
        'transacoes.ver',
        'transacoes.exportar',
        'usuarios.ver',
        'saques.ver',
        'saques.editar',
        'saques.aprovar',
        'depositos.ver',
        'depositos.editar',
        'gateways.ver',
        'faturas.ver',
        'ggr.ver',
        'ggr.apurar',
      ),
      require2fa: false,
      approvalCeiling: 5000,
      color: 'emerald',
    },
    {
      id: 'marketing-oficial',
      name: 'Marketing oficial',
      description: 'Campanhas, disparos, jornadas, torneios e personalização',
      system: true,
      permissions: [
        'dashboard.ver',
        ...ofModules(['campanhas']).filter((k) => !k.startsWith('webhooks.') && !k.startsWith('templates.')),
        ...ofModules(['personalizacao']),
      ],
      require2fa: true,
      approvalCeiling: 0,
      color: 'pink',
    },
    {
      id: 'suporte',
      name: 'Suporte',
      description: 'Ficha do jogador, etiquetas e consulta de depósitos e saques',
      system: true,
      permissions: keys('usuarios.ver', 'usuarios.editar', 'saques.ver', 'depositos.ver', 'transacoes.ver', 'apostas-esportivas.ver'),
      require2fa: false,
      approvalCeiling: 0,
      color: 'sky',
    },
    {
      id: 'adm',
      name: 'ADM',
      description: 'Cargo personalizado da operação',
      system: false,
      permissions: [
        ...ofModules(['geral', 'cassino'], ['ver', 'editar']),
        ...ofModules(['operacao', 'esportes', 'crescimento'], ['ver']),
        ...ofModules(['campanhas'], ['ver']),
      ],
      require2fa: false,
      approvalCeiling: 0,
      color: 'amber',
    },
    {
      id: 'marketing',
      name: 'marketing',
      description: 'Cargo personalizado de marketing',
      system: false,
      permissions: keys(
        'dashboard.ver',
        'promocoes.ver',
        'promocoes.editar',
        'free-spins.ver',
        'free-spins.editar',
        'bonus-deposito.ver',
        'cupons.ver',
        'cupons.editar',
        'notificacoes.ver',
        'disparos.ver',
      ),
      require2fa: false,
      approvalCeiling: 0,
      color: 'rose',
    },
  ]
}

/** Resumo por módulo: nenhum, leitura ou edição */
export function moduleAccess(role: Role, module: ModuleId): 'nenhum' | 'leitura' | 'edicao' {
  const perms = PERMISSIONS.filter((p) => p.module === module && role.permissions.includes(p.key))
  if (perms.some((p) => p.kind !== 'ver')) return 'edicao'
  if (perms.length) return 'leitura'
  return 'nenhum'
}

export function ceilingLabel(role: Role) {
  if (role.approvalCeiling === null) return 'Sem teto'
  if (role.approvalCeiling === 0) return 'Não aprova saques'
  return role.approvalCeiling.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Permissões que dão poder administrativo sobre pessoas e acessos. */
export const ADMIN_LEVEL_PERMISSIONS = ['cargos.conceder', 'cargos.editar', 'equipe.editar', 'seguranca-painel.editar', 'mcp.editar'] as const

/** Cargos com poder de conceder/retirar cargos administrativos ou de mexer em acessos. */
export function isAdminLevelRole(role: Pick<Role, 'permissions'>) {
  return ADMIN_LEVEL_PERMISSIONS.some((p) => role.permissions.includes(p))
}

/** Permissões que o cargo tem e que existem no catálogo (ignora chaves desconhecidas). */
export function effectivePermissions(role: Pick<Role, 'permissions'>): string[] {
  return role.permissions.filter((p) => PERMISSION_BY_KEY.has(p))
}

export function canViewPage(perms: ReadonlySet<string>, pageId: string) {
  return perms.has(`${pageId}.ver`) || perms.has(`${pageId}.editar`)
}
