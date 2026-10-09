// Cargos e permissões: as regras vivem em shared/permissions.ts (usado também
// pelo servidor). Aqui ficam só os auxiliares que dependem dos ícones do painel.
import { MODULES } from '@/nav'
import { moduleAccess, type Role } from '@shared/permissions'

export * from '@shared/permissions'

export function moduleSummary(role: Role) {
  return MODULES.map((m) => ({ module: m, access: moduleAccess(role, m.id) }))
}
