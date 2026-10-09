import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  KeyRound,
  Lock,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Type,
  Users,
} from 'lucide-react'
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  DescriptionList,
  Drawer,
  Field,
  FormFieldset,
  FormGrid,
  IconButton,
  Input,
  KpiCard,
  Menu,
  Modal,
  MoneyInput,
  PageHeader,
  Segmented,
  Select,
  Switch,
  Textarea,
  confirm,
  toast,
} from '@/components/ui'
import { num, plural } from '@/lib/format'
import { cn } from '@/lib/cn'
import { uid } from '@/lib/random'
import { MODULES, PAGES, type ModuleId } from '@/nav'
import type { TeamMember } from '@/data/team'
import { audit, usePageAccess, useRoles, useSession, useTeam } from '@/domain/session'
import { PERMISSIONS, ceilingLabel, moduleAccess, type Permission, type Role } from '@/domain/roles'
import {
  GRANT_PERM,
  ROLE_COLORS,
  accessSummary,
  broadAccess,
  broadRolesWithout2fa,
  checkRoleName,
  diffPermissions,
  isAdminLevelRole,
  isAdminPerm,
  permsOfModule,
  permsOfPage,
  roleColorVar,
  setManyPermissions,
  similarRolePairs,
  suggestDistinctName,
  togglePermission,
} from '@/domain/config2-access'
import { RoleBadge, RoleDot } from './_shared-g'

const ACCESS_LABEL = { nenhum: 'Nenhum', leitura: 'Leitura', edicao: 'Edição' } as const

export default function Cargos() {
  const { canEdit, can } = usePageAccess()
  const { setViewAs, realRole } = useSession()
  const [roles, setRoles] = useRoles()
  const [team] = useTeam()
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<{ role: Role; suggestion?: string } | null>(null)
  const canGrant = can(GRANT_PERM)

  const lockReason = (r: Role): string | null => {
    if (!canEdit) return 'Seu cargo pode ver, mas não editar cargos.'
    if (r.id === 'superadmin') return 'O Superadmin tem acesso total e não pode ser alterado.'
    if (isAdminLevelRole(r) && !canGrant) return 'Só o Superadmin altera cargos administrativos.'
    return null
  }

  const membersOf = (r: Role) => team.filter((m) => m.roleId === r.id)
  const activeOf = (r: Role) => membersOf(r).filter((m) => m.status === 'ativo')
  const weakRoles = broadRolesWithout2fa(roles)
  const pairs = similarRolePairs(roles)
  const required = roles.filter((r) => r.require2fa)
  const approvers = roles.filter((r) => r.approvalCeiling !== 0 && r.permissions.includes('saques.aprovar'))

  const viewAs = (r: Role) => {
    setViewAs(r.id === realRole.id ? null : r.id)
    toast.info(r.id === realRole.id ? 'Voltou ao seu cargo' : `Vendo o painel como ${r.name}`, { description: 'Menu, telas e botões seguem as permissões do cargo.' })
  }

  const set2fa = async (r: Role, on: boolean) => {
    if (!canEdit) return
    if (isAdminLevelRole(r) && !canGrant) {
      toast.error('Só o Superadmin altera cargos administrativos.')
      return
    }
    const without = activeOf(r).filter((m) => !m.twoFactor)
    if (!on) {
      const b = broadAccess(r)
      const ok = await confirm({
        title: `Deixar o 2FA opcional em ${r.name}?`,
        description: b.broad
          ? `Este cargo tem acesso amplo (${b.reasons.join(' · ')}). Sem 2FA, uma senha vazada basta para entrar.`
          : 'Quem não ativou o 2FA passa a entrar só com a senha.',
        confirmLabel: 'Deixar opcional',
        tone: 'danger',
        icon: ShieldAlert,
      })
      if (!ok) return
    }
    setRoles((prev) => prev.map((x) => (x.id === r.id ? { ...x, require2fa: on } : x)))
    audit(on ? 'ligar' : 'desligar', `Cargo ${r.name}`, on ? '2FA passou a ser exigido' : '2FA passou a ser opcional')
    toast.success(on ? `2FA exigido em ${r.name}` : `2FA opcional em ${r.name}`, {
      description: on && without.length ? `${without.map((m) => m.name).join(', ')} precisa${without.length > 1 ? 'm' : ''} ativar no próximo acesso.` : 'Vale na hora.',
    })
  }

  const requireOnBroad = async () => {
    const allowed = weakRoles.filter((r) => canGrant || !isAdminLevelRole(r))
    const skipped = weakRoles.filter((r) => !allowed.includes(r))
    if (!canEdit || !allowed.length) {
      toast.error('Sem permissão', { description: 'Só o Superadmin altera cargos administrativos.' })
      return
    }
    const affected = team.filter((m) => m.status === 'ativo' && !m.twoFactor && allowed.some((r) => r.id === m.roleId))
    const ok = await confirm({
      title: `Exigir 2FA em ${plural(allowed.length, 'cargo', 'cargos')} com acesso amplo?`,
      description: affected.length
        ? `${affected.map((m) => m.name).join(', ')} precisa${affected.length > 1 ? 'm' : ''} ativar o 2FA no próximo acesso.`
        : 'Todas as pessoas desses cargos já usam 2FA.',
      confirmLabel: 'Exigir 2FA',
      icon: ShieldCheck,
      details: (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {allowed.map((r) => (
              <RoleBadge key={r.id} role={r} />
            ))}
          </div>
          {skipped.length > 0 && <p className="text-xs text-warning">Fica de fora (só Superadmin altera): {skipped.map((r) => r.name).join(', ')}.</p>}
        </div>
      ),
    })
    if (!ok) return
    setRoles((prev) => prev.map((x) => (allowed.some((a) => a.id === x.id) ? { ...x, require2fa: true } : x)))
    audit('ligar', 'Cargos e permissões', `2FA exigido em cargos com acesso amplo: ${allowed.map((r) => r.name).join(', ')}`)
    toast.success('2FA exigido nos cargos com acesso amplo')
  }

  const duplicate = (r: Role) => {
    if (!canEdit) return
    if (isAdminLevelRole(r) && !canGrant) {
      toast.error('Só o Superadmin duplica cargos administrativos.')
      return
    }
    let name = `Cópia de ${r.name}`
    let i = 2
    while (roles.some((x) => x.name.toLowerCase() === name.toLowerCase())) name = `Cópia de ${r.name} ${i++}`
    const copy: Role = {
      ...r,
      id: uid('cargo-'),
      name,
      description: r.description,
      system: false,
      permissions: [...r.permissions],
      color: ROLE_COLORS[roles.length % ROLE_COLORS.length],
    }
    setRoles((prev) => [...prev, copy])
    audit('criar', `Cargo ${name}`, `Cargo duplicado de ${r.name} (${r.permissions.length} permissões)`)
    toast.success('Cargo duplicado', { description: 'Ajuste o nome e as permissões antes de atribuir.' })
    setOpenId(copy.id)
  }

  const remove = async (r: Role) => {
    if (r.system) return
    const members = membersOf(r)
    if (members.length) {
      toast.error('Cargo em uso', {
        description: `${members.map((m) => `${m.name} (${m.status})`).join(', ')} usa${members.length > 1 ? 'm' : ''} este cargo. Troque em Equipe antes de excluir.`,
      })
      return
    }
    const ok = await confirm({
      title: `Excluir o cargo ${r.name}?`,
      description: 'O cargo some da lista e não pode ser recuperado. Ninguém usa este cargo hoje.',
      confirmLabel: 'Excluir cargo',
      tone: 'danger',
      icon: Trash2,
    })
    if (!ok) return
    setRoles((prev) => prev.filter((x) => x.id !== r.id))
    audit('excluir', `Cargo ${r.name}`, `Cargo personalizado excluído (${r.permissions.length} permissões)`)
    toast.success('Cargo excluído')
  }

  const open = roles.find((r) => r.id === openId)

  return (
    <>
      <PageHeader
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)} disabled={!canEdit} title={!canEdit ? 'Seu cargo não cria cargos' : undefined}>
            Novo cargo
          </Button>
        }
      />

      <div className="space-y-5">
        <section aria-label="Resumo dos cargos" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Cargos" icon={KeyRound} value={num(roles.length)} hint={`${roles.filter((r) => r.system).length} do sistema · ${roles.filter((r) => !r.system).length} personalizados`} />
          <KpiCard
            label="2FA exigido"
            icon={ShieldCheck}
            tone={required.length === roles.length ? 'success' : 'warning'}
            value={`${required.length} de ${roles.length}`}
            hint={required.length ? required.map((r) => r.name).join(', ') : 'nenhum cargo exige'}
          />
          <KpiCard
            label="Acesso amplo com 2FA opcional"
            icon={ShieldAlert}
            tone={weakRoles.length ? 'danger' : 'success'}
            value={num(weakRoles.length)}
            hint={weakRoles.length ? 'risco alto' : 'todos protegidos'}
            formula={<>Cargos com 25+ permissões ou com alguma permissão sensível (aprovar saques, ver dados completos, exportar, editar equipe ou cargos) e 2FA opcional.</>}
          />
          <KpiCard label="Aprovam saques" icon={Scale} tone="info" value={num(approvers.length)} hint={approvers.map((r) => `${r.name}: ${ceilingLabel(r).toLowerCase()}`).join(' · ')} />
        </section>

        {weakRoles.length > 0 && (
          <Alert
            tone="danger"
            title="2FA opcional em cargos com acesso amplo"
            action={
              <Button size="sm" variant="danger" icon={ShieldCheck} onClick={requireOnBroad} disabled={!canEdit}>
                Exigir 2FA em cargos com acesso amplo
              </Button>
            }
          >
            <p>Nestes cargos, quem tiver a senha roubada entra com tudo o que o cargo permite. Exigir 2FA obriga a ativação no próximo acesso.</p>
            <ul className="mt-2 space-y-1">
              {weakRoles.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-1.5">
                  <RoleBadge role={r} />
                  <span className="text-xs text-fg-3">
                    {accessSummary(r)} · {plural(activeOf(r).filter((m) => !m.twoFactor).length, 'pessoa sem 2FA', 'pessoas sem 2FA')}
                  </span>
                </li>
              ))}
            </ul>
          </Alert>
        )}

        {pairs.length > 0 && (
          <Alert tone="warning" icon={Type} title="Nomes parecidos podem levar a cargo errado">
            <p>Na hora de convidar alguém, é fácil escolher um cargo no lugar do outro. Renomeie o cargo personalizado para deixar a diferença clara.</p>
            <ul className="mt-2 space-y-2">
              {pairs.map(([a, b]) => {
                const custom = !a.system ? a : !b.system ? b : null
                return (
                  <li key={`${a.id}-${b.id}`} className="flex flex-wrap items-center gap-2">
                    <RoleBadge role={a} />
                    <span className="text-xs text-fg-3">×</span>
                    <RoleBadge role={b} />
                    {custom && (
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={Pencil}
                        disabled={!!lockReason(custom)}
                        onClick={() => setRenaming({ role: custom, suggestion: suggestDistinctName(custom, roles) })}
                      >
                        Renomear "{custom.name}"
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </Alert>
        )}

        <section aria-label="Cargos" className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {roles.map((r) => (
            <RoleCard
              key={r.id}
              role={r}
              members={activeOf(r)}
              allMembers={membersOf(r)}
              lock={lockReason(r)}
              canToggle2fa={canEdit && (!isAdminLevelRole(r) || canGrant)}
              onOpen={() => setOpenId(r.id)}
              onToggle2fa={(on) => set2fa(r, on)}
              onDuplicate={() => duplicate(r)}
              onRename={() => setRenaming({ role: r })}
              onDelete={() => remove(r)}
              onViewAs={() => viewAs(r)}
              canCreate={canEdit}
            />
          ))}
        </section>

        <ModuleMatrix roles={roles} onOpen={(id) => setOpenId(id)} />
      </div>

      {open && <RoleDrawer key={open.id} role={open} roles={roles} members={membersOf(open)} lock={lockReason(open)} canGrant={canGrant} onClose={() => setOpenId(null)} onViewAs={() => viewAs(open)} />}
      {creating && (
        <NewRoleModal
          roles={roles}
          canGrant={canGrant}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            setOpenId(id)
          }}
        />
      )}
      {renaming && <RenameModal role={renaming.role} suggestion={renaming.suggestion} roles={roles} onClose={() => setRenaming(null)} />}
    </>
  )
}

// ---------- Cartão do cargo ----------

function RoleCard({
  role: r,
  members,
  allMembers,
  lock,
  canToggle2fa,
  onOpen,
  onToggle2fa,
  onDuplicate,
  onRename,
  onDelete,
  onViewAs,
  canCreate,
}: {
  role: Role
  members: TeamMember[]
  allMembers: TeamMember[]
  lock: string | null
  canToggle2fa: boolean
  onOpen: () => void
  onToggle2fa: (on: boolean) => void
  onDuplicate: () => void
  onRename: () => void
  onDelete: () => void
  onViewAs: () => void
  canCreate: boolean
}) {
  const b = broadAccess(r)
  const weak = b.broad && !r.require2fa
  const withAccess = MODULES.map((m) => ({ m, a: moduleAccess(r, m.id) })).filter((x) => x.a !== 'nenhum')
  return (
    <article className={cn('card flex flex-col', weak && 'border-danger/30')}>
      <div className="flex items-start gap-3 p-4 pb-3">
        <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${roleColorVar(r.color)} 16%, transparent)` }}>
          <RoleDot color={r.color} className="h-3 w-3" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h2 className="truncate text-[15px] font-semibold text-fg">{r.name}</h2>
            {r.system ? <Badge icon={Lock}>Sistema</Badge> : <Badge tone="info">Personalizado</Badge>}
            {isAdminLevelRole(r) && <Badge tone="warning">Administrativo</Badge>}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-fg-3">{r.description || 'Sem descrição.'}</p>
        </div>
        <Menu
          trigger={(p) => <IconButton {...p} icon={MoreHorizontal} label={`Ações do cargo ${r.name}`} size="sm" />}
          items={[
            { label: lock ? 'Ver permissões' : 'Editar permissões', icon: lock ? Eye : Pencil, onSelect: onOpen },
            { label: 'Ver painel como este cargo', icon: Eye, onSelect: onViewAs },
            { divider: true },
            { label: 'Duplicar', icon: Copy, disabled: !canCreate, onSelect: onDuplicate },
            { label: 'Renomear', icon: Type, disabled: r.system || !!lock, hint: r.system ? 'sistema' : undefined, onSelect: onRename },
            { label: 'Excluir', icon: Trash2, danger: true, disabled: r.system || !!lock || allMembers.length > 0, hint: allMembers.length ? 'em uso' : undefined, onSelect: onDelete },
          ]}
        />
      </div>

      <dl className="grid grid-cols-2 gap-px border-y border-line bg-line">
        <div className="bg-surface px-4 py-2.5">
          <dt className="text-xs text-fg-3">Membros ativos</dt>
          <dd className="mt-1 flex items-center gap-2">
            {members.length ? (
              <span className="flex -space-x-1.5">
                {members.slice(0, 4).map((m) => (
                  <span key={m.id} title={m.name} className="rounded-full ring-2 ring-surface">
                    <Avatar name={m.name} size={22} />
                  </span>
                ))}
              </span>
            ) : null}
            <span className="text-[13px] font-semibold text-fg">{members.length ? num(members.length) : 'Nenhum'}</span>
            {allMembers.length > members.length && <span className="text-xs text-fg-3">+{allMembers.length - members.length} inativos</span>}
          </dd>
        </div>
        <div className="bg-surface px-4 py-2.5">
          <dt className="text-xs text-fg-3">Teto de saque</dt>
          <dd className="mt-1 text-[13px] font-semibold text-fg">{ceilingLabel(r)}</dd>
        </div>
      </dl>

      <div className="flex-1 space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
              2FA {r.require2fa ? <Badge tone="success">Exigido</Badge> : <Badge tone={weak ? 'danger' : 'neutral'}>Opcional</Badge>}
            </p>
            {weak && <p className="mt-0.5 text-xs text-danger">Acesso amplo sem 2FA obrigatório</p>}
          </div>
          <span title={canToggle2fa ? (r.require2fa ? 'Deixar opcional' : 'Exigir 2FA') : 'Só o Superadmin altera este cargo'}>
            <Switch checked={r.require2fa} onChange={onToggle2fa} disabled={!canToggle2fa} ariaLabel={`Exigir 2FA no cargo ${r.name}`} size="sm" />
          </span>
        </div>
        <div>
          <p className="mb-1.5 text-xs text-fg-3">
            {r.permissions.length} permissões em {withAccess.length} de {MODULES.length} módulos
          </p>
          {withAccess.length ? (
            <ul className="flex flex-wrap gap-1">
              {withAccess.map(({ m, a }) => (
                <li key={m.id}>
                  <Badge tone={a === 'edicao' ? 'primary' : 'info'}>
                    {m.title} · {ACCESS_LABEL[a]}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <Badge>Nenhum acesso</Badge>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
        <Button size="sm" variant="ghost" icon={Eye} onClick={onViewAs}>
          Ver como
        </Button>
        <Button size="sm" icon={lock ? Lock : Pencil} onClick={onOpen} title={lock ?? undefined}>
          {lock ? 'Ver permissões' : 'Editar permissões'}
        </Button>
      </div>
    </article>
  )
}

// ---------- Matriz por módulo ----------

function ModuleMatrix({ roles, onOpen }: { roles: Role[]; onOpen: (id: string) => void }) {
  return (
    <Card>
      <CardHeader
        title="Acesso por módulo"
        description="O que cada cargo pode ver e editar. Mudanças valem na hora para todas as pessoas do cargo."
        icon={KeyRound}
      />
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Acesso de cada cargo por módulo do painel</caption>
          <thead>
            <tr className="border-b border-line bg-surface-2/80">
              <th scope="col" className="sticky left-0 z-[1] h-10 min-w-[180px] bg-surface-2 px-4 text-left text-xs font-semibold text-fg-3">
                Módulo
              </th>
              {roles.map((r) => (
                <th key={r.id} scope="col" className="h-10 min-w-[110px] px-2 text-center text-xs font-semibold text-fg-3">
                  <button type="button" onClick={() => onOpen(r.id)} className="inline-flex items-center gap-1.5 rounded px-1 hover:text-fg">
                    <RoleDot color={r.color} className="h-2 w-2" />
                    {r.name}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULES.map((m) => (
              <tr key={m.id} className="border-b border-line/70 last:border-0">
                <th scope="row" className="sticky left-0 z-[1] h-11 bg-surface px-4 text-left font-medium text-fg">
                  <span className="inline-flex items-center gap-2 text-[13px]">
                    <m.icon size={15} className="text-fg-3" aria-hidden />
                    {m.title}
                  </span>
                </th>
                {roles.map((r) => {
                  const a = moduleAccess(r, m.id)
                  return (
                    <td key={r.id} className="h-11 px-2 text-center">
                      <AccessCell access={a} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-4 border-t border-line px-5 py-3 text-xs text-fg-3">
        <span className="inline-flex items-center gap-1.5">
          <AccessCell access="edicao" /> Edição (inclui ver)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <AccessCell access="leitura" /> Só leitura
        </span>
        <span className="inline-flex items-center gap-1.5">
          <AccessCell access="nenhum" /> Sem acesso
        </span>
      </div>
    </Card>
  )
}

function AccessCell({ access }: { access: 'nenhum' | 'leitura' | 'edicao' }) {
  const Icon = access === 'edicao' ? Pencil : access === 'leitura' ? Eye : Minus
  return (
    <span
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-md',
        access === 'edicao' ? 'bg-primary/10 text-primary-text' : access === 'leitura' ? 'bg-info/10 text-info' : 'text-fg-3/60',
      )}
      title={ACCESS_LABEL[access]}
    >
      <Icon size={13} aria-label={ACCESS_LABEL[access]} />
    </span>
  )
}

// ---------- Editor do cargo ----------

type CeilingMode = 'sem_teto' | 'nao_aprova' | 'valor'

function ceilingMode(v: number | null): CeilingMode {
  return v === null ? 'sem_teto' : v === 0 ? 'nao_aprova' : 'valor'
}

function RoleDrawer({
  role,
  roles,
  members,
  lock,
  canGrant,
  onClose,
  onViewAs,
}: {
  role: Role
  roles: Role[]
  members: TeamMember[]
  lock: string | null
  canGrant: boolean
  onClose: () => void
  onViewAs: () => void
}) {
  const [, setRoles] = useRoles()
  const [draft, setDraft] = useState<Role>(role)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<ModuleId>>(() => new Set(MODULES.filter((m) => moduleAccess(role, m.id) !== 'nenhum').map((m) => m.id)))
  const readOnly = !!lock
  const dirty = JSON.stringify(draft) !== JSON.stringify(role)
  const nameCheck = role.system ? { error: null, similar: [] as Role[] } : checkRoleName(draft.name, roles, role.id)
  const diff = diffPermissions(role.permissions, draft.permissions)
  const ceilingErr = draft.approvalCeiling !== null && draft.approvalCeiling < 0 ? 'Valor inválido.' : null
  const canApprove = draft.permissions.includes('saques.aprovar')
  const activeMembers = members.filter((m) => m.status === 'ativo')

  const permLocked = (p: Permission) => readOnly || (isAdminPerm(p.key) && !canGrant)
  const setPerms = (fn: (prev: string[]) => string[]) => setDraft((d) => ({ ...d, permissions: fn(d.permissions) }))

  const q = query.trim().toLowerCase()
  const pagesByModule = useMemo(
    () =>
      MODULES.map((m) => ({
        module: m,
        pages: PAGES.filter((pg) => pg.module === m.id && (!q || pg.title.toLowerCase().includes(q) || m.title.toLowerCase().includes(q) || permsOfPage(pg.id).some((p) => p.label.toLowerCase().includes(q)))),
      })).filter((x) => x.pages.length),
    [q],
  )

  const close = async () => {
    if (dirty && !readOnly) {
      const ok = await confirm({ title: 'Descartar alterações?', description: 'As mudanças neste cargo ainda não foram salvas.', confirmLabel: 'Descartar', tone: 'warning' })
      if (!ok) return
    }
    onClose()
  }

  const save = () => {
    if (readOnly) return
    if (nameCheck.error) {
      toast.error('Revise o nome', { description: nameCheck.error })
      return
    }
    if (ceilingErr) return
    const addedAdmin = diff.added.filter(isAdminPerm)
    if (addedAdmin.length && !canGrant) {
      toast.error('Só o Superadmin concede permissões administrativas.')
      return
    }
    const next = { ...draft, name: draft.name.trim(), description: draft.description.trim() }
    setRoles((prev) => prev.map((r) => (r.id === role.id ? next : r)))
    const parts: string[] = []
    if (diff.added.length || diff.removed.length) parts.push(`+${diff.added.length} / −${diff.removed.length} permissões`)
    if (next.name !== role.name) parts.push(`nome: ${role.name} → ${next.name}`)
    if (next.require2fa !== role.require2fa) parts.push(`2FA ${next.require2fa ? 'exigido' : 'opcional'}`)
    if (next.approvalCeiling !== role.approvalCeiling) parts.push(`teto: ${ceilingLabel(role)} → ${ceilingLabel(next)}`)
    if (next.description !== role.description) parts.push('descrição')
    audit('editar', `Cargo ${next.name}`, parts.join('; ') || 'Cargo salvo')
    toast.success('Cargo salvo', { description: `Vale na hora para ${plural(activeMembers.length, 'pessoa', 'pessoas')}. Teste com "Ver como".` })
    onClose()
  }

  const toggleExpand = (id: ModuleId) =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <Drawer
      open
      onClose={close}
      width="xl"
      title={readOnly ? `Permissões de ${role.name}` : `Editar ${role.name}`}
      description={`${plural(draft.permissions.length, 'permissão', 'permissões')} de ${PERMISSIONS.length} · ${plural(activeMembers.length, 'pessoa ativa', 'pessoas ativas')}`}
      headerExtra={role.system ? <Badge icon={Lock} size="md">Sistema</Badge> : <Badge tone="info" size="md">Personalizado</Badge>}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" icon={Eye} onClick={onViewAs}>
            Ver painel como este cargo
          </Button>
          <div className="flex gap-2">
            <Button onClick={close}>{readOnly ? 'Fechar' : 'Cancelar'}</Button>
            {!readOnly && (
              <Button variant="primary" onClick={save} disabled={!dirty || !!nameCheck.error || !!ceilingErr}>
                Salvar cargo
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {lock && (
          <Alert tone={role.id === 'superadmin' ? 'info' : 'warning'} icon={Lock}>
            {lock}
          </Alert>
        )}

        <FormFieldset readOnly={readOnly}>
        <section className="space-y-4">
          <FormGrid>
            <Field
              label="Nome do cargo"
              htmlFor="rd-name"
              hint={role.system ? 'Cargos do sistema não mudam de nome.' : undefined}
              error={nameCheck.error}
            >
              <Input id="rd-name" value={draft.name} disabled={readOnly || role.system} invalid={!!nameCheck.error} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </Field>
            <Field label="Cor" hint="Ajuda a diferenciar cargos na equipe.">
              <div className="flex flex-wrap gap-1.5 pt-1.5" role="radiogroup" aria-label="Cor do cargo">
                {ROLE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={draft.color === c}
                    aria-label={c}
                    disabled={readOnly}
                    onClick={() => setDraft((d) => ({ ...d, color: c }))}
                    className={cn('flex h-7 w-7 items-center justify-center rounded-full border-2 disabled:cursor-not-allowed disabled:opacity-60', draft.color === c ? 'border-fg' : 'border-transparent')}
                  >
                    <RoleDot color={c} className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </Field>
          </FormGrid>
          {nameCheck.similar.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs font-medium text-warning">
              <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden />
              Parecido com {nameCheck.similar.map((r) => `"${r.name}"`).join(', ')}. Prefira um nome que deixe a diferença clara.
            </p>
          )}
          <Field label="Descrição" htmlFor="rd-desc" hint="Aparece ao escolher o cargo em Equipe, para ninguém confundir cargos.">
            <Textarea id="rd-desc" rows={2} value={draft.description} disabled={readOnly || role.system} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
          </Field>
        </section>

        <section className="grid gap-4 rounded-xl border border-line p-4 sm:grid-cols-2">
          <Switch
            label="Exigir 2FA"
            description={draft.require2fa ? 'Quem não tiver 2FA ativa no próximo acesso.' : broadAccess(draft).broad ? 'Opcional em cargo com acesso amplo: risco alto.' : 'Opcional.'}
            checked={draft.require2fa}
            disabled={readOnly}
            onChange={(on) => setDraft((d) => ({ ...d, require2fa: on }))}
          />
          <div>
            <p className="text-sm font-medium text-fg">Teto de aprovação de saque</p>
            {role.id === 'superadmin' ? (
              <p className="mt-1 text-[13px] text-fg-3">Sem teto (fixo para o Superadmin).</p>
            ) : (
              <div className="mt-2 space-y-2">
                <Segmented<CeilingMode>
                  size="sm"
                  ariaLabel="Teto de aprovação"
                  value={ceilingMode(draft.approvalCeiling)}
                  onChange={(m) => !readOnly && setDraft((d) => ({ ...d, approvalCeiling: m === 'sem_teto' ? null : m === 'nao_aprova' ? 0 : d.approvalCeiling && d.approvalCeiling > 0 ? d.approvalCeiling : 5000 }))}
                  options={[
                    { value: 'nao_aprova', label: 'Não aprova' },
                    { value: 'valor', label: 'Até um valor' },
                    { value: 'sem_teto', label: 'Sem teto' },
                  ]}
                />
                {ceilingMode(draft.approvalCeiling) === 'valor' && (
                  <MoneyInput id="rd-ceiling" value={draft.approvalCeiling ?? 0} disabled={readOnly} onValueChange={(v) => setDraft((d) => ({ ...d, approvalCeiling: Math.max(1, v) }))} />
                )}
                {!canApprove && draft.approvalCeiling !== 0 && <p className="text-xs text-warning">Sem a permissão "Aprovar e recusar saques", o teto não vale.</p>}
              </div>
            )}
          </div>
        </section>
        </FormFieldset>

        {members.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-fg">Quem tem este cargo</h3>
            <ul className="flex flex-wrap gap-2">
              {members.map((m) => (
                <li key={m.id} className="inline-flex items-center gap-1.5 rounded-full border border-line py-0.5 pl-0.5 pr-2.5 text-[13px] text-fg">
                  <Avatar name={m.name} size={22} />
                  {m.name}
                  {m.status !== 'ativo' && <span className="text-xs text-fg-3">({m.status})</span>}
                  {m.status === 'ativo' && !m.twoFactor && <ShieldAlert size={13} className="text-warning" aria-label="sem 2FA" />}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-fg">Permissões por tela</h3>
              <p className="text-xs text-fg-3">
                Editar inclui ver. Tirar "Ver" tira o resto da tela.
                {(diff.added.length > 0 || diff.removed.length > 0) && (
                  <span className="ml-1 font-semibold text-primary-text">
                    +{diff.added.length} / −{diff.removed.length} não salvas
                  </span>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="xs" variant="ghost" onClick={() => setExpanded(new Set(MODULES.map((m) => m.id)))}>
                Expandir tudo
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setExpanded(new Set())}>
                Recolher
              </Button>
            </div>
          </div>
          <Input icon={Search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrar telas e permissões" aria-label="Filtrar telas e permissões" className="mb-3" />

          <div className="space-y-2">
            {pagesByModule.map(({ module: m, pages }) => {
              const all = permsOfModule(m.id)
              const editable = all.filter((p) => !permLocked(p))
              const granted = all.filter((p) => draft.permissions.includes(p.key))
              const allOn = editable.length > 0 && editable.every((p) => draft.permissions.includes(p.key))
              const someOn = granted.length > 0
              const isOpen = expanded.has(m.id) || !!q
              const access = moduleAccess(draft, m.id)
              return (
                <div key={m.id} className="overflow-hidden rounded-xl border border-line">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-surface-2 px-3 py-2.5">
                    <button type="button" onClick={() => toggleExpand(m.id)} aria-expanded={isOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      {isOpen ? <ChevronDown size={16} className="shrink-0 text-fg-3" aria-hidden /> : <ChevronRight size={16} className="shrink-0 text-fg-3" aria-hidden />}
                      <m.icon size={16} className="shrink-0 text-fg-2" aria-hidden />
                      <span className="truncate text-[13px] font-semibold text-fg">{m.title}</span>
                      <span className="shrink-0 text-xs text-fg-3 tnum">
                        {granted.length}/{all.length}
                      </span>
                      <Badge tone={access === 'edicao' ? 'primary' : access === 'leitura' ? 'info' : 'neutral'}>{ACCESS_LABEL[access]}</Badge>
                    </button>
                    <div className="flex items-center gap-2">
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={readOnly}
                        onClick={() => setPerms((prev) => setManyPermissions(setManyPermissions(prev, all.filter((p) => !permLocked(p)).map((p) => p.key), false), all.filter((p) => p.kind === 'ver').map((p) => p.key), true))}
                      >
                        Só leitura
                      </Button>
                      <Checkbox
                        checked={allOn ? true : someOn ? 'indeterminate' : false}
                        disabled={readOnly || !editable.length}
                        label={<span className="text-xs font-medium text-fg-2">Tudo</span>}
                        onChange={(on) => setPerms((prev) => setManyPermissions(prev, editable.map((p) => p.key), on))}
                      />
                    </div>
                  </div>
                  {isOpen && (
                    <ul className="divide-y divide-line/70">
                      {pages.map((pg) => {
                        const perms = permsOfPage(pg.id)
                        const ver = perms.find((p) => p.kind === 'ver')!
                        const edit = perms.find((p) => p.kind === 'editar')
                        const specials = perms.filter((p) => p.kind === 'especial')
                        return (
                          <li key={pg.id} className="px-3 py-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-2 text-[13px] text-fg">
                                <pg.icon size={14} className="shrink-0 text-fg-3" aria-hidden />
                                <span className="truncate">{pg.title}</span>
                              </span>
                              <div className="flex items-center gap-4">
                                <Checkbox
                                  checked={draft.permissions.includes(ver.key)}
                                  disabled={permLocked(ver)}
                                  label={<span className="text-xs text-fg-2">Ver</span>}
                                  onChange={(on) => setPerms((prev) => togglePermission(prev, ver.key, on))}
                                />
                                {edit ? (
                                  <Checkbox
                                    checked={draft.permissions.includes(edit.key)}
                                    disabled={permLocked(edit)}
                                    label={<span className="text-xs text-fg-2">Editar</span>}
                                    onChange={(on) => setPerms((prev) => togglePermission(prev, edit.key, on))}
                                  />
                                ) : (
                                  <span className="w-[66px] whitespace-nowrap text-xs text-fg-3">só consulta</span>
                                )}
                              </div>
                            </div>
                            {specials.length > 0 && (
                              <div className="mt-2 space-y-1.5 rounded-lg bg-surface-2 px-3 py-2">
                                {specials.map((sp) => (
                                  <Checkbox
                                    key={sp.key}
                                    checked={draft.permissions.includes(sp.key)}
                                    disabled={permLocked(sp)}
                                    onChange={(on) => setPerms((prev) => togglePermission(prev, sp.key, on))}
                                    label={
                                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-fg-2">
                                        {sp.label}
                                        {isAdminPerm(sp.key) && <Badge tone="warning" icon={Lock}>só Superadmin concede</Badge>}
                                        {!isAdminPerm(sp.key) && (sp.key.includes('aprovar') || sp.key.includes('exportar') || sp.key.includes('ver-') || sp.key.includes('banir')) && <Badge tone="danger">sensível</Badge>}
                                      </span>
                                    }
                                  />
                                ))}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
            {!pagesByModule.length && <p className="py-6 text-center text-[13px] text-fg-3">Nenhuma tela com "{query}".</p>}
          </div>
        </section>

        {(diff.added.length > 0 || diff.removed.length > 0) && !readOnly && (
          <section className="rounded-xl border border-primary/25 bg-primary/5 p-4">
            <h3 className="mb-2 text-sm font-semibold text-fg">Resumo das mudanças</h3>
            <DescriptionList
              items={[
                { label: `Ganha (${diff.added.length})`, value: diff.added.length ? <PermList keys={diff.added} /> : '—' },
                { label: `Perde (${diff.removed.length})`, value: diff.removed.length ? <PermList keys={diff.removed} /> : '—' },
              ]}
            />
          </section>
        )}
      </div>
    </Drawer>
  )
}

function PermList({ keys }: { keys: string[] }) {
  const labels = keys.map((k) => PERMISSIONS.find((p) => p.key === k)?.label ?? k)
  return (
    <span className="text-[13px] text-fg-2">
      {labels.slice(0, 6).join(', ')}
      {labels.length > 6 && ` e mais ${labels.length - 6}`}
    </span>
  )
}

// ---------- Novo cargo ----------

function NewRoleModal({ roles, canGrant, onClose, onCreated }: { roles: Role[]; canGrant: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [, setRoles] = useRoles()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [base, setBase] = useState('')
  const [touched, setTouched] = useState(false)
  const check = checkRoleName(name, roles)
  const baseRole = roles.find((r) => r.id === base)
  const baseErr = baseRole && isAdminLevelRole(baseRole) && !canGrant ? 'Só o Superadmin parte de um cargo administrativo.' : null
  const descErr = description.trim().length < 10 ? 'Descreva em uma frase o que o cargo faz (mínimo 10 letras).' : null
  const submit = () => {
    setTouched(true)
    if (check.error || baseErr || descErr) return
    const role: Role = {
      id: uid('cargo-'),
      name: name.trim(),
      description: description.trim(),
      system: false,
      permissions: baseRole ? [...baseRole.permissions] : ['dashboard.ver'],
      require2fa: true,
      approvalCeiling: 0,
      color: ROLE_COLORS[roles.length % ROLE_COLORS.length],
    }
    setRoles((prev) => [...prev, role])
    audit('criar', `Cargo ${role.name}`, baseRole ? `Cargo criado a partir de ${baseRole.name}` : 'Cargo criado só com acesso ao Dashboard')
    toast.success('Cargo criado', { description: '2FA já vem exigido. Agora escolha as permissões.' })
    onCreated(role.id)
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Novo cargo"
      description="Comece do zero ou a partir de um cargo existente. Novos cargos já exigem 2FA."
      icon={KeyRound}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={submit}>
            Criar e escolher permissões
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label="Nome" htmlFor="nr-name" required error={touched || name.trim().length >= 3 ? check.error : null}>
          <Input id="nr-name" data-autofocus value={name} invalid={(touched || name.trim().length >= 3) && !!check.error} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Analista de risco" />
        </Field>
        {check.similar.length > 0 && (
          <Alert tone="warning" icon={AlertTriangle}>
            Parecido com {check.similar.map((r) => `"${r.name}"`).join(', ')}. Nomes parecidos levam a atribuir o cargo errado.
          </Alert>
        )}
        <Field label="Descrição" htmlFor="nr-desc" required error={touched ? descErr : null} hint="Aparece ao escolher o cargo em Equipe.">
          <Textarea id="nr-desc" rows={2} value={description} invalid={touched && !!descErr} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Começar com" htmlFor="nr-base" error={baseErr}>
          <Select
            id="nr-base"
            value={base}
            onChange={setBase}
            options={[{ value: '', label: 'Só o Dashboard (vazio)' }, ...roles.map((r) => ({ value: r.id, label: `Permissões de ${r.name} (${r.permissions.length})` }))]}
          />
        </Field>
      </form>
    </Modal>
  )
}

// ---------- Renomear ----------

function RenameModal({ role, suggestion, roles, onClose }: { role: Role; suggestion?: string; roles: Role[]; onClose: () => void }) {
  const [, setRoles] = useRoles()
  const [team] = useTeam()
  const [name, setName] = useState(suggestion ?? role.name)
  const check = checkRoleName(name, roles, role.id)
  const changed = name.trim() !== role.name
  const save = () => {
    if (check.error || !changed) return
    setRoles((prev) => prev.map((r) => (r.id === role.id ? { ...r, name: name.trim() } : r)))
    audit('editar', `Cargo ${name.trim()}`, `Cargo renomeado de "${role.name}" para "${name.trim()}"`)
    toast.success('Cargo renomeado', { description: `${plural(team.filter((m) => m.roleId === role.id).length, 'pessoa vê', 'pessoas veem')} o nome novo na hora.` })
    onClose()
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={`Renomear "${role.name}"`}
      description="As pessoas do cargo continuam com as mesmas permissões."
      icon={Type}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={!!check.error || !changed}>
            Renomear
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Field label="Novo nome" htmlFor="rn-name" error={check.error}>
          <Input id="rn-name" data-autofocus value={name} invalid={!!check.error} onChange={(e) => setName(e.target.value)} />
        </Field>
        {check.similar.length > 0 ? (
          <p className="flex items-start gap-1.5 text-xs font-medium text-warning">
            <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden />
            Ainda parecido com {check.similar.map((r) => `"${r.name}"`).join(', ')}.
          </p>
        ) : (
          name.trim() && !check.error && <p className="flex items-center gap-1.5 text-xs text-success"><ShieldCheck size={13} aria-hidden /> Nome sem conflito com outros cargos.</p>
        )}
        <p className="flex items-center gap-1.5 text-xs text-fg-3">
          <Users size={13} aria-hidden /> {plural(team.filter((m) => m.roleId === role.id).length, 'pessoa usa', 'pessoas usam')} este cargo · teto de saque: {ceilingLabel(role).toLowerCase()}
        </p>
      </form>
    </Modal>
  )
}
