import { useMemo, useState } from 'react'
import {
  Eye,
  KeyRound,
  LogOut,
  MailPlus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserCog,
  UserPlus,
  UserRoundX,
  Users,
  MonitorSmartphone,
  Send,
} from 'lucide-react'
import {
  Alert,
  Avatar,
  Badge,
  Button,
  ChipFilter,
  DataTable,
  DescriptionList,
  Drawer,
  Field,
  Input,
  KpiCard,
  Modal,
  Mono,
  PageHeader,
  PersonCell,
  Tooltip,
  confirm,
  toast,
  type Column,
  type MenuEntry,
  type Tone,
} from '@/components/ui'
import { dateTime, num, pct, plural, relative } from '@/lib/format'
import { useDb } from '@/lib/store'
import { uid } from '@/lib/random'
import { MODULES } from '@/nav'
import { AUDIT_ACTION_LABEL, type TeamMember } from '@/data/team'
import { MCP_KEYS, seedMcpKeys } from '@/data/config2-mcp'
import { audit, usePageAccess, useAudit, useRoles, useSession, useTeam } from '@/domain/session'
import { moduleAccess, type Role } from '@/domain/roles'
import { usePanelSecurity } from '@/domain/system'
import { allowlistAllows } from '@/domain/config2-network'
import {
  GRANT_PERM,
  canChangeRole,
  canDeactivate,
  generateTempPassword,
  isAdminLevelRole,
  nameFromEmail,
  needs2faSetup,
  riskyMembers,
  validateTeamEmail,
} from '@/domain/config2-access'
import type { McpKey } from '@/domain/config2-mcp'
import { OneTimeSecret, RoleBadge, RoleSelect, TwoFactorBadge } from './_shared-g'

type Status = TeamMember['status']
type Filter = 'todos' | Status

const STATUS_LABEL: Record<Status, string> = { ativo: 'Ativo', convidado: 'Convidado', desligado: 'Desligado' }
const STATUS_TONE: Record<Status, Tone> = { ativo: 'success', convidado: 'info', desligado: 'neutral' }

interface InviteInfo {
  sentAt: string
  count: number
  by: string
}

const INVITES_KEY = 'config.equipe.convites'

export default function Equipe() {
  const { canEdit, can } = usePageAccess()
  const { user } = useSession()
  const [team, setTeam] = useTeam()
  const [roles, setRoles] = useRoles()
  const [panel] = usePanelSecurity()
  const [invites, setInvites] = useDb<Record<string, InviteInfo>>(INVITES_KEY, {})
  const [mcpKeys] = useDb<McpKey[]>(MCP_KEYS.keys, seedMcpKeys)
  const [filter, setFilter] = useState<Filter>('todos')
  const [modal, setModal] = useState<null | 'convite' | 'direto'>(null)
  const [roleEditId, setRoleEditId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const canGrant = can(GRANT_PERM)
  const noEdit = !canEdit ? 'Seu cargo não pode editar a equipe' : undefined

  const roleOf = (m: TeamMember) => roles.find((r) => r.id === m.roleId)
  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: team.length }
    for (const m of team) c[m.status] = (c[m.status] ?? 0) + 1
    return c
  }, [team])
  const rows = filter === 'todos' ? team : team.filter((m) => m.status === filter)
  const active = team.filter((m) => m.status === 'ativo')
  const with2fa = active.filter((m) => m.twoFactor)
  const risky = riskyMembers(team, roles)
  const sessions = active.reduce((s, m) => s + m.activeSessions, 0)

  const updateMember = (id: string, patch: Partial<TeamMember>) => setTeam((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))

  const ask2fa = (m: TeamMember) => {
    audit('enviar', `Equipe · ${m.name}`, 'Pedido de ativação do 2FA enviado por e-mail')
    toast.success('Pedido enviado', { description: `${m.name} recebe um e-mail e só continua no painel depois de ativar o 2FA.` })
  }

  const require2faOnRoles = async () => {
    const targets = [...new Map(risky.map((r) => [r.role.id, r.role])).values()]
    const allowed = targets.filter((r) => canGrant || !isAdminLevelRole(r))
    const skipped = targets.filter((r) => !allowed.includes(r))
    if (!can('cargos.editar') || !allowed.length) {
      toast.error('Seu cargo não pode alterar cargos', { description: 'Peça a um Superadmin para exigir o 2FA.' })
      return
    }
    const ok = await confirm({
      title: `Exigir 2FA em ${plural(allowed.length, 'cargo', 'cargos')}?`,
      description: 'Quem estiver sem 2FA precisa ativar no próximo acesso. Sessões abertas continuam até expirar.',
      confirmLabel: 'Exigir 2FA',
      icon: ShieldCheck,
      details: (
        <ul className="space-y-1.5">
          {allowed.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 text-[13px]">
              <RoleBadge role={r} />
              <span className="text-fg-3">{risky.filter((x) => x.role.id === r.id).map((x) => x.member.name).join(', ')}</span>
            </li>
          ))}
          {skipped.length > 0 && <li className="text-xs text-warning">Sem permissão para: {skipped.map((r) => r.name).join(', ')} (só Superadmin).</li>}
        </ul>
      ),
    })
    if (!ok) return
    setRoles((prev) => prev.map((r) => (allowed.some((a) => a.id === r.id) ? { ...r, require2fa: true } : r)))
    audit('editar', 'Cargos e permissões', `2FA passou a ser exigido em: ${allowed.map((r) => r.name).join(', ')}`)
    toast.success('2FA exigido', { description: `${allowed.map((r) => r.name).join(', ')} agora exigem 2FA.` })
  }

  const deactivate = async (m: TeamMember) => {
    const check = canDeactivate(m, team, user.id)
    if (!check.ok) {
      toast.error('Não foi possível desativar', { description: check.message })
      return
    }
    const keys = mcpKeys.filter((k) => k.createdById === m.id && !k.revokedAt)
    const ok = await confirm({
      title: `Desativar o acesso de ${m.name}?`,
      description: 'As sessões abertas são encerradas na hora e a pessoa não entra mais no painel. O histórico dela continua na auditoria.',
      confirmLabel: 'Desativar acesso',
      tone: 'danger',
      icon: UserRoundX,
      details: (
        <DescriptionList
          columns={2}
          items={[
            { label: 'Sessões encerradas', value: num(m.activeSessions) },
            { label: 'Chaves de IA suspensas', value: num(keys.length) },
            { label: 'Cargo', value: <RoleBadge role={roleOf(m)} /> },
            { label: 'Último acesso', value: relative(m.lastAccess) },
          ]}
        />
      ),
    })
    if (!ok) return
    updateMember(m.id, { status: 'desligado', activeSessions: 0 })
    audit('desativar', `Equipe · ${m.name}`, `Acesso desativado; ${plural(m.activeSessions, 'sessão encerrada', 'sessões encerradas')}${keys.length ? `; ${plural(keys.length, 'chave de IA suspensa', 'chaves de IA suspensas')}` : ''}`)
    toast.success('Acesso desativado', { description: `${m.name} saiu de todas as sessões. O histórico continua na auditoria.` })
  }

  const reactivate = async (m: TeamMember) => {
    const role = roleOf(m)
    if (isAdminLevelRole(role) && !canGrant) {
      toast.error('Só o Superadmin reativa acessos administrativos.')
      return
    }
    const ok = await confirm({
      title: `Reativar o acesso de ${m.name}?`,
      description: `A pessoa volta a entrar com o cargo ${role?.name ?? '—'}. Confira se o cargo ainda faz sentido.`,
      confirmLabel: 'Reativar acesso',
      tone: 'success',
      icon: UserCheck,
    })
    if (!ok) return
    updateMember(m.id, { status: 'ativo' })
    audit('ligar', `Equipe · ${m.name}`, `Acesso reativado com o cargo ${role?.name ?? '—'}`)
    toast.success('Acesso reativado')
  }

  const endSessions = async (m: TeamMember) => {
    const ok = await confirm({
      title: `Encerrar ${plural(m.activeSessions, 'sessão', 'sessões')} de ${m.name}?`,
      description: 'A pessoa precisa entrar de novo. O acesso continua ativo.',
      confirmLabel: 'Encerrar sessões',
      tone: 'warning',
      icon: LogOut,
    })
    if (!ok) return
    updateMember(m.id, { activeSessions: 0 })
    audit('editar', `Equipe · ${m.name}`, `${plural(m.activeSessions, 'sessão encerrada', 'sessões encerradas')} manualmente`)
    toast.success('Sessões encerradas')
  }

  const resendInvite = (m: TeamMember) => {
    const info = invites[m.id]
    if (info && Date.now() - new Date(info.sentAt).getTime() < 60_000) {
      toast.warning('Convite enviado há menos de 1 minuto', { description: 'Aguarde um pouco antes de reenviar.' })
      return
    }
    setInvites((prev) => ({ ...prev, [m.id]: { sentAt: new Date().toISOString(), count: (prev[m.id]?.count ?? 1) + 1, by: user.name } }))
    audit('enviar', `Equipe · ${m.email}`, 'Convite reenviado')
    toast.success('Convite reenviado', { description: `Novo link enviado para ${m.email}. O link anterior deixou de valer.` })
  }

  const cancelInvite = async (m: TeamMember) => {
    const ok = await confirm({
      title: `Cancelar o convite de ${m.email}?`,
      description: 'O link do convite deixa de funcionar. Você pode convidar de novo depois.',
      confirmLabel: 'Cancelar convite',
      cancelLabel: 'Voltar',
      tone: 'danger',
      icon: Trash2,
    })
    if (!ok) return
    setTeam((prev) => prev.filter((x) => x.id !== m.id))
    setInvites((prev) => {
      const next = { ...prev }
      delete next[m.id]
      return next
    })
    audit('excluir', `Equipe · ${m.email}`, 'Convite cancelado')
    toast.success('Convite cancelado')
  }

  const actionsFor = (m: TeamMember): MenuEntry[] => {
    const isMe = m.id === user.id
    const list: MenuEntry[] = [
      { label: 'Ver detalhes', icon: Eye, onSelect: () => setOpenId(m.id) },
      { label: 'Trocar cargo', icon: UserCog, disabled: !canEdit, onSelect: () => setRoleEditId(m.id) },
    ]
    if (m.status === 'convidado') {
      list.push({ label: 'Reenviar convite', icon: Send, disabled: !canEdit, onSelect: () => resendInvite(m) })
      list.push({ divider: true }, { label: 'Cancelar convite', icon: Trash2, danger: true, disabled: !canEdit, onSelect: () => cancelInvite(m) })
    }
    if (m.status === 'ativo') {
      if (!m.twoFactor) list.push({ label: 'Pedir ativação do 2FA', icon: ShieldCheck, disabled: !canEdit, onSelect: () => ask2fa(m) })
      if (m.activeSessions > 0 && !isMe) list.push({ label: 'Encerrar sessões', icon: LogOut, disabled: !canEdit, onSelect: () => endSessions(m) })
      list.push({ divider: true }, { label: isMe ? 'Desativar (é você)' : 'Desativar acesso', icon: UserRoundX, danger: true, disabled: !canEdit || isMe, onSelect: () => deactivate(m) })
    }
    if (m.status === 'desligado') list.push({ divider: true }, { label: 'Reativar acesso', icon: UserCheck, disabled: !canEdit, onSelect: () => reactivate(m) })
    return list
  }

  const columns: Column<TeamMember>[] = [
    {
      id: 'name',
      header: 'Pessoa',
      pinned: true,
      minWidth: 230,
      sortValue: (m) => m.name,
      csv: (m) => `${m.name} <${m.email}>`,
      cell: (m) => (
        <div className="flex items-center gap-2">
          <PersonCell name={m.name} sub={m.email} />
          {m.id === user.id && <Badge tone="primary">Você</Badge>}
        </div>
      ),
    },
    { id: 'role', header: 'Cargo', sortValue: (m) => roleOf(m)?.name ?? '', csv: (m) => roleOf(m)?.name ?? '', cell: (m) => <RoleBadge role={roleOf(m)} /> },
    {
      id: 'status',
      header: 'Status',
      sortValue: (m) => m.status,
      csv: (m) => STATUS_LABEL[m.status],
      cell: (m) => (
        <Badge tone={STATUS_TONE[m.status]} dot>
          {STATUS_LABEL[m.status]}
        </Badge>
      ),
    },
    {
      id: '2fa',
      header: '2FA',
      sortValue: (m) => (m.twoFactor ? 1 : 0),
      csv: (m) => (m.twoFactor ? 'Ligado' : 'Desligado'),
      cell: (m) => (m.status === 'convidado' || (!m.twoFactor && !m.lastAccess) ? <span className="text-xs text-fg-3">no 1º acesso</span> : <TwoFactorBadge on={m.twoFactor} required={needs2faSetup(m, roleOf(m), panel.enforce2faForAll)} />),
    },
    {
      id: 'sessions',
      header: 'Sessões',
      align: 'right',
      sortValue: (m) => m.activeSessions,
      cell: (m) => <span className={m.activeSessions ? 'font-semibold text-fg' : 'text-fg-3'}>{m.activeSessions}</span>,
    },
    {
      id: 'lastAccess',
      header: 'Último acesso',
      sortValue: (m) => m.lastAccess ?? '',
      csv: (m) => dateTime(m.lastAccess),
      cell: (m) =>
        m.lastAccess ? (
          <Tooltip content={dateTime(m.lastAccess)}>
            <span className="text-[13px] text-fg-2">{relative(m.lastAccess)}</span>
          </Tooltip>
        ) : (
          <span className="text-xs text-fg-3">{m.status === 'convidado' ? `convite ${relative(invites[m.id]?.sentAt ?? m.createdAt)}` : 'nunca entrou'}</span>
        ),
    },
    {
      id: 'lastIp',
      header: 'Último IP',
      sortValue: (m) => m.lastIp ?? '',
      csv: (m) => m.lastIp ?? '',
      cell: (m) =>
        m.lastIp ? (
          <span className="inline-flex items-center gap-1.5">
            <Mono>{m.lastIp}</Mono>
            {panel.allowlist.length > 0 && !allowlistAllows(panel.allowlist, m.lastIp) && m.status === 'ativo' && <Badge tone="warning">fora da lista</Badge>}
          </span>
        ) : (
          <span className="text-fg-3">—</span>
        ),
    },
    { id: 'createdAt', header: 'Criado em', defaultHidden: true, sortValue: (m) => m.createdAt, csv: (m) => dateTime(m.createdAt), cell: (m) => <span className="text-[13px] text-fg-2">{dateTime(m.createdAt)}</span> },
  ]

  const open = team.find((m) => m.id === openId)
  const roleEdit = team.find((m) => m.id === roleEditId)

  return (
    <>
      <PageHeader
        actions={
          <>
            <Button icon={MailPlus} onClick={() => setModal('convite')} disabled={!canEdit} title={noEdit}>
              Convidar
            </Button>
            <Button variant="primary" icon={UserPlus} onClick={() => setModal('direto')} disabled={!canEdit} title={noEdit}>
              Criar acesso direto
            </Button>
          </>
        }
      />

      <div className="space-y-5">
        <section aria-label="Resumo da equipe" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Pessoas ativas" icon={Users} value={num(active.length)} hint={`${plural(counts.desligado ?? 0, "desligada", "desligadas")} · ${plural(sessions, "sessão aberta", "sessões abertas")}`} onClick={() => setFilter('ativo')} active={filter === 'ativo'} />
          <KpiCard label="Convites pendentes" icon={MailPlus} tone="info" value={num(counts.convidado ?? 0)} hint="aguardando o primeiro acesso" onClick={() => setFilter('convidado')} active={filter === 'convidado'} />
          <KpiCard
            label="2FA ligado"
            icon={ShieldCheck}
            tone={with2fa.length === active.length ? 'success' : 'warning'}
            value={`${with2fa.length} de ${active.length}`}
            hint={`${pct(active.length ? with2fa.length / active.length : 0, 0)} das pessoas ativas`}
            formula={<>Pessoas ativas com verificação em duas etapas ligada ÷ pessoas ativas. Convidados ativam no primeiro acesso.</>}
          />
          <KpiCard
            label="Acesso amplo sem 2FA"
            icon={ShieldAlert}
            tone={risky.length ? 'danger' : 'success'}
            value={num(risky.length)}
            hint={risky.length ? 'risco alto · veja abaixo' : 'nenhuma pessoa em risco'}
            formula={<>Pessoas ativas, com 2FA desligado, em cargos com 25+ permissões ou com alguma permissão sensível (aprovar saques, ver dados completos, exportar, editar equipe ou cargos).</>}
          />
        </section>

        {risky.length > 0 && (
          <Alert
            tone="danger"
            title={`${plural(risky.length, 'pessoa com acesso amplo está', 'pessoas com acesso amplo estão')} sem 2FA`}
            action={
              <Button size="sm" variant="danger" icon={ShieldCheck} onClick={require2faOnRoles} disabled={!can('cargos.editar')} title={!can('cargos.editar') ? 'Seu cargo não altera cargos' : undefined}>
                Exigir 2FA nos cargos
              </Button>
            }
          >
            <p>Com só a senha, quem roubar o login entra com todas as permissões do cargo. Peça a ativação ou exija 2FA no cargo.</p>
            <ul className="mt-2.5 space-y-2">
              {risky.map(({ member: m, role, reasons }) => (
                <li key={m.id} className="flex flex-col gap-2 rounded-lg border border-danger/15 bg-surface px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={m.name} size={28} />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-fg">
                        {m.name} <RoleBadge role={role} />
                      </p>
                      <p className="truncate text-xs text-fg-3">
                        {reasons.join(' · ')} · último acesso {m.lastAccess ? relative(m.lastAccess) : 'nunca'}
                      </p>
                    </div>
                  </div>
                  <Button size="sm" icon={Send} onClick={() => ask2fa(m)} disabled={!canEdit}>
                    Pedir ativação do 2FA
                  </Button>
                </li>
              ))}
            </ul>
          </Alert>
        )}

        {panel.enforce2faForAll && (
          <Alert tone="success" icon={ShieldCheck} title="2FA exigido de toda a equipe">
            Ligado em <a className="link" href="#/settings/seguranca">Segurança do painel</a>. Quem estiver sem 2FA precisa ativar no próximo acesso.
          </Alert>
        )}

        <DataTable
          caption="Pessoas com acesso ao painel"
          className="relative"
          rows={rows}
          columns={columns}
          rowKey={(m) => m.id}
          searchText={(m) => `${m.name} ${m.email} ${roleOf(m)?.name ?? ''} ${m.lastIp ?? ''}`}
          searchPlaceholder="Buscar por nome, e-mail, cargo ou IP"
          initialSort={{ id: 'lastAccess', dir: 'desc' }}
          onRowClick={(m) => setOpenId(m.id)}
          rowActions={actionsFor}
          resetKey={filter}
          rowClassName={(m) => (m.status === 'desligado' ? 'opacity-70' : risky.some((r) => r.member.id === m.id) ? 'bg-danger/[0.03]' : undefined)}
          exportName="equipe"
          onExport={(n) => audit('exportar', 'Equipe', `Exportação CSV de ${n} pessoas da equipe`)}
          toolbar={
            <ChipFilter<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'todos', label: 'Todos', count: counts.todos ?? 0 },
                { value: 'ativo', label: 'Ativos', count: counts.ativo ?? 0 },
                { value: 'convidado', label: 'Convidados', count: counts.convidado ?? 0, tone: 'warning' },
                { value: 'desligado', label: 'Desligados', count: counts.desligado ?? 0 },
              ]}
            />
          }
          empty={{
            title: filter === 'convidado' ? 'Nenhum convite pendente' : 'Ninguém neste filtro',
            description: filter === 'convidado' ? 'Convide alguém pelo e-mail. A pessoa cria a senha e ativa o 2FA no primeiro acesso.' : 'Troque o filtro de status.',
            action:
              filter === 'convidado' ? (
                <Button size="sm" icon={MailPlus} onClick={() => setModal('convite')} disabled={!canEdit}>
                  Convidar
                </Button>
              ) : undefined,
          }}
        />
      </div>

      <InviteModal open={modal === 'convite'} onClose={() => setModal(null)} roles={roles} team={team} canGrant={canGrant} onCreated={(m) => setInvites((p) => ({ ...p, [m.id]: { sentAt: m.createdAt, count: 1, by: user.name } }))} />
      <DirectAccessModal open={modal === 'direto'} onClose={() => setModal(null)} roles={roles} team={team} canGrant={canGrant} />
      {roleEdit && <ChangeRoleModal member={roleEdit} onClose={() => setRoleEditId(null)} roles={roles} team={team} canGrant={canGrant} />}
      <MemberDrawer
        member={open}
        role={open ? roleOf(open) : undefined}
        invite={open ? invites[open.id] : undefined}
        onClose={() => setOpenId(null)}
        actions={open ? actionsFor(open) : []}
        isMe={open?.id === user.id}
        enforceAll={panel.enforce2faForAll}
      />
    </>
  )
}

// ---------- Convidar ----------

function InviteModal({
  open,
  onClose,
  roles,
  team,
  canGrant,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  roles: Role[]
  team: TeamMember[]
  canGrant: boolean
  onCreated: (m: TeamMember) => void
}) {
  const [, setTeam] = useTeam()
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState('')
  const [touched, setTouched] = useState(false)
  const emailErr = validateTeamEmail(email, team)
  const role = roles.find((r) => r.id === roleId)
  const roleErr = !role ? 'Escolha um cargo.' : isAdminLevelRole(role) && !canGrant ? 'Só o Superadmin concede este cargo.' : null
  const close = () => {
    setEmail('')
    setRoleId('')
    setTouched(false)
    onClose()
  }
  const submit = () => {
    setTouched(true)
    if (emailErr || roleErr || !role) return
    const m: TeamMember = {
      id: uid('u'),
      name: nameFromEmail(email.trim()),
      email: email.trim().toLowerCase(),
      roleId: role.id,
      status: 'convidado',
      twoFactor: false,
      lastAccess: null,
      lastIp: null,
      createdAt: new Date().toISOString(),
      activeSessions: 0,
    }
    setTeam((prev) => [...prev, m])
    onCreated(m)
    audit('convidar', `Equipe · ${m.email}`, `Convite enviado com o cargo ${role.name}`)
    toast.success('Convite enviado', { description: `${m.email} recebe o link por e-mail. Ele vale por 72 horas.` })
    close()
  }
  return (
    <Modal
      open={open}
      onClose={close}
      title="Convidar para a equipe"
      description="A pessoa recebe um link por e-mail, cria a própria senha e ativa o 2FA no primeiro acesso."
      icon={MailPlus}
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" icon={Send} onClick={submit}>
            Enviar convite
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
        <Field label="E-mail" htmlFor="inv-email" required error={touched ? emailErr : null}>
          <Input id="inv-email" data-autofocus type="email" autoComplete="off" value={email} invalid={touched && !!emailErr} placeholder="nome@x2win.bet" onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <RoleSelect id="inv-role" roles={roles} value={roleId} onChange={setRoleId} canGrant={canGrant} error={touched ? roleErr : null} />
      </form>
    </Modal>
  )
}

// ---------- Acesso direto ----------

function DirectAccessModal({ open, onClose, roles, team, canGrant }: { open: boolean; onClose: () => void; roles: Role[]; team: TeamMember[]; canGrant: boolean }) {
  const [, setTeam] = useTeam()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState('')
  const [touched, setTouched] = useState(false)
  const [created, setCreated] = useState<{ member: TeamMember; password: string } | null>(null)
  const nameErr = name.trim().length < 3 ? 'Informe o nome completo.' : null
  const emailErr = validateTeamEmail(email, team)
  const role = roles.find((r) => r.id === roleId)
  const roleErr = !role ? 'Escolha um cargo.' : isAdminLevelRole(role) && !canGrant ? 'Só o Superadmin concede este cargo.' : null
  const close = () => {
    setName('')
    setEmail('')
    setRoleId('')
    setTouched(false)
    setCreated(null)
    onClose()
  }
  const submit = () => {
    setTouched(true)
    if (nameErr || emailErr || roleErr || !role) return
    const m: TeamMember = {
      id: uid('u'),
      name: name.trim(),
      email: email.trim().toLowerCase(),
      roleId: role.id,
      status: 'ativo',
      twoFactor: false,
      lastAccess: null,
      lastIp: null,
      createdAt: new Date().toISOString(),
      activeSessions: 0,
    }
    const password = generateTempPassword()
    setTeam((prev) => [...prev, m])
    audit('criar', `Equipe · ${m.name}`, `Acesso direto criado com o cargo ${role.name}; senha temporária com troca no primeiro acesso`)
    setCreated({ member: m, password })
  }
  return (
    <Modal
      open={open}
      onClose={close}
      title={created ? 'Acesso criado' : 'Criar acesso direto'}
      description={created ? `Entregue a senha a ${created.member.name} por um canal seguro.` : 'Para quem precisa entrar agora. A senha é temporária e precisa ser trocada no primeiro acesso.'}
      icon={created ? KeyRound : UserPlus}
      iconTone={created ? 'success' : 'primary'}
      footer={
        created ? (
          <Button variant="primary" onClick={close}>
            Já copiei a senha
          </Button>
        ) : (
          <>
            <Button onClick={close}>Cancelar</Button>
            <Button variant="primary" icon={UserPlus} onClick={submit}>
              Criar acesso
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-4">
          <DescriptionList
            items={[
              { label: 'Pessoa', value: created.member.name },
              { label: 'E-mail de acesso', value: created.member.email },
              { label: 'Cargo', value: <RoleBadge role={role} /> },
              { label: '2FA', value: 'Ativação no primeiro acesso' },
            ]}
          />
          <OneTimeSecret
            label="Senha temporária"
            value={created.password}
            warning="Esta senha aparece só agora. Ela vale por 24 horas e precisa ser trocada no primeiro acesso. Não envie por e-mail junto com o login."
          />
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Field label="Nome completo" htmlFor="da-name" required error={touched ? nameErr : null}>
            <Input id="da-name" data-autofocus value={name} invalid={touched && !!nameErr} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="E-mail de acesso" htmlFor="da-email" required error={touched ? emailErr : null}>
            <Input id="da-email" type="email" autoComplete="off" value={email} invalid={touched && !!emailErr} placeholder="nome@x2win.bet" onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <RoleSelect id="da-role" roles={roles} value={roleId} onChange={setRoleId} canGrant={canGrant} error={touched ? roleErr : null} />
        </form>
      )}
    </Modal>
  )
}

// ---------- Trocar cargo ----------

function ChangeRoleModal({ member, onClose, roles, team, canGrant }: { member: TeamMember; onClose: () => void; roles: Role[]; team: TeamMember[]; canGrant: boolean }) {
  const { user } = useSession()
  const [, setTeam] = useTeam()
  const [roleId, setRoleId] = useState(member.roleId)
  const from = roles.find((r) => r.id === member.roleId)
  const to = roles.find((r) => r.id === roleId)
  const check = canChangeRole(member, from, to, team, user.id, canGrant)
  const changed = roleId !== member.roleId
  const save = async () => {
    if (!check.ok || !to) return
    if (isAdminLevelRole(to)) {
      const ok = await confirm({
        title: `Dar o cargo ${to.name} a ${member.name}?`,
        description: 'É um cargo administrativo: a pessoa passa a controlar acessos e configurações sensíveis.',
        confirmLabel: 'Conceder cargo',
        tone: 'warning',
      })
      if (!ok) return
    }
    setTeam((prev) => prev.map((m) => (m.id === member.id ? { ...m, roleId: to.id } : m)))
    audit('editar', `Equipe · ${member.name}`, `Cargo alterado de ${from?.name ?? '—'} para ${to.name}`)
    toast.success('Cargo alterado', { description: `${member.name} agora é ${to.name}. Vale na próxima ação da pessoa no painel.` })
    onClose()
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={`Trocar cargo de ${member.name}`}
      description={`Cargo atual: ${from?.name ?? '—'}`}
      icon={UserCog}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={!changed || !check.ok}>
            Salvar cargo
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <RoleSelect id="cr-role" roles={roles} value={roleId} onChange={setRoleId} canGrant={canGrant} label="Novo cargo" error={changed && !check.ok ? check.message : null} />
        {!canGrant && (
          <Alert tone="info">Cargos administrativos (Superadmin, Administrador e cargos com controle de acesso) só podem ser dados ou retirados pelo Superadmin.</Alert>
        )}
      </div>
    </Modal>
  )
}

// ---------- Detalhes ----------

function MemberDrawer({
  member,
  role,
  invite,
  onClose,
  actions,
  isMe,
  enforceAll,
}: {
  member: TeamMember | undefined
  role: Role | undefined
  invite: InviteInfo | undefined
  onClose: () => void
  actions: MenuEntry[]
  isMe: boolean
  enforceAll: boolean
}) {
  const [entries] = useAudit()
  if (!member) return null
  const recent = entries.filter((e) => e.actorId === member.id).slice(0, 8)
  const quick = actions.filter((a): a is Extract<MenuEntry, { label: unknown }> => 'label' in a && !!a.onSelect && a.label !== 'Ver detalhes')
  return (
    <Drawer
      open
      onClose={onClose}
      title={member.name}
      description={member.email}
      headerExtra={
        <Badge tone={STATUS_TONE[member.status]} dot size="md">
          {STATUS_LABEL[member.status]}
        </Badge>
      }
      footer={quick.slice(0, 3).map((a, i) => (
        <Button key={i} size="sm" icon={a.icon} disabled={a.disabled}
          onClick={() => {
            onClose()
            a.onSelect?.()
          }}
          className={a.danger ? 'text-danger' : undefined}>
          {a.label}
        </Button>
      ))}
    >
      <div className="space-y-6">
        <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-4">
          <Avatar name={member.name} size={48} />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-fg">
              {member.name} {isMe && <Badge tone="primary">Você</Badge>}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <RoleBadge role={role} />
              {member.status !== 'convidado' && <TwoFactorBadge on={member.twoFactor} required={needs2faSetup(member, role, enforceAll)} />}
            </div>
          </div>
        </div>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Acesso</h3>
          <DescriptionList
            items={[
              { label: 'Último acesso', value: member.lastAccess ? `${dateTime(member.lastAccess)} · ${relative(member.lastAccess)}` : 'Nunca entrou' },
              { label: 'Último IP', value: member.lastIp ? <Mono>{member.lastIp}</Mono> : '—' },
              { label: 'Sessões abertas', value: <span className="inline-flex items-center gap-1.5"><MonitorSmartphone size={14} className="text-fg-3" aria-hidden />{num(member.activeSessions)}</span> },
              { label: 'Na equipe desde', value: dateTime(member.createdAt) },
              ...(member.status === 'convidado' && invite
                ? [{ label: 'Convite', value: `enviado ${relative(invite.sentAt)} por ${invite.by} · ${plural(invite.count, 'envio', 'envios')}`, full: true }]
                : []),
            ]}
          />
        </section>

        <section>
          <h3 className="mb-1 text-sm font-semibold text-fg">O que o cargo libera</h3>
          <p className="mb-3 text-[13px] text-fg-3">{role?.description}</p>
          {role && (
            <ul className="flex flex-wrap gap-1.5">
              {MODULES.map((mod) => {
                const a = moduleAccess(role, mod.id)
                return (
                  <li key={mod.id}>
                    <Badge tone={a === 'edicao' ? 'primary' : a === 'leitura' ? 'info' : 'neutral'} icon={mod.icon} className={a === 'nenhum' ? 'opacity-60' : undefined}>
                      {mod.title} · {a === 'edicao' ? 'Edição' : a === 'leitura' ? 'Leitura' : 'Nenhum'}
                    </Badge>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg">Últimas ações</h3>
            <a className="link text-[13px]" href={`#/settings/auditoria?pessoa=${member.id}`}>
              Ver na auditoria
            </a>
          </div>
          {recent.length ? (
            <ol className="space-y-2.5">
              {recent.map((e) => (
                <li key={e.id} className="flex items-start gap-2.5 text-[13px]">
                  <RefreshCw size={13} className="mt-1 shrink-0 text-fg-3" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-fg">
                      <span className="font-medium">{AUDIT_ACTION_LABEL[e.action]}</span> · {e.entity}
                    </p>
                    <p className="truncate text-xs text-fg-3">
                      {e.summary} · {relative(e.at)} · {e.ip}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-fg-3">Nenhuma ação registrada.</p>
          )}
        </section>
      </div>
    </Drawer>
  )
}
