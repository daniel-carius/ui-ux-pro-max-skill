// Leitura de cargos no formato usado pelo painel (valores em reais).
import type { Role } from '@shared/permissions'
import type { Db } from '../db'

export interface RoleRow {
  id: string
  name: string
  description: string
  system: boolean
  permissions: string[]
  require_2fa: boolean
  approval_ceiling_cents: number | null
  color: string
  updated_at: string
}

export function rowToRole(r: RoleRow): Role {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    system: r.system,
    permissions: r.permissions ?? [],
    require2fa: r.require_2fa,
    approvalCeiling: r.approval_ceiling_cents === null ? null : r.approval_ceiling_cents / 100,
    color: r.color,
  }
}

export async function listRoles(db: Db): Promise<Role[]> {
  const rows = await db.query<RoleRow>('select * from roles order by system desc, name asc')
  return rows.map(rowToRole)
}

export async function getRole(db: Db, id: string): Promise<Role | null> {
  const r = await db.one<RoleRow>('select * from roles where id = $1', [id])
  return r ? rowToRole(r) : null
}

/** Converte reais (número) para centavos inteiros, preservando null. */
export function toCents(v: number | null): number | null {
  return v === null ? null : Math.round(v * 100)
}
