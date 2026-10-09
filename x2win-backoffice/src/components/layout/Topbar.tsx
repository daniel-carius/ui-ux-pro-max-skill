import { Suspense, lazy, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bell,
  Check,
  Clock,
  KeyRound,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Receipt,
  RotateCcw,
  Search,
  ShieldAlert,
  Siren,
  Sun,
  UserRound,
  Construction,
  Globe2,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { brl, date, relative } from '@/lib/format'
import { useTheme } from '@/lib/theme'
import { resetDb } from '@/lib/store'
import { useAuthApi, useRoles, useSession, useTeam } from '@/domain/session'
import { useAttackMode, useMaintenance, usePanelSecurity } from '@/domain/system'
import { INVOICES_KEY, type Invoice } from '@/domain/config1-faturas'
import { seedInvoices } from '@/data/config1-faturas'
import { useCollection } from '@/lib/store'
import { useWithdrawals } from '@/data/hooks'
import { Avatar, IconButton, Menu, Popover, confirm, toast, type MenuEntry } from '@/components/ui'

// só no modo API (carregado ao abrir)
const ChangePasswordModal = lazy(() => import('@/pages/auth/ChangePasswordPage').then((m) => ({ default: m.ChangePasswordModal })))

interface Notice {
  id: string
  icon: typeof Bell
  tone: 'danger' | 'warning' | 'info'
  title: string
  detail: string
  to: string
}

function useNotices(): Notice[] {
  const { items: withdrawals } = useWithdrawals()
  const [team] = useTeam()
  const [panel] = usePanelSecurity()
  const { can } = useSession()
  const { items: invoices } = useCollection<Invoice>(INVOICES_KEY, seedInvoices)
  return useMemo(() => {
    const out: Notice[] = []
    const late = withdrawals.filter((w) => w.status === 'em_analise' || (w.status === 'pendente' && Date.now() - new Date(w.createdAt).getTime() > 24 * 3600_000))
    if (late.length && can('saques.ver'))
      out.push({ id: 'late', icon: Clock, tone: 'warning', title: `${late.length} saques em análise há mais de 24 h`, detail: 'Decida para não estourar o prazo do jogador.', to: '/system/saques' })
    const admins = team.filter((m) => m.status === 'ativo' && !m.twoFactor && ['superadmin', 'administrador', 'adm', 'financeiro'].includes(m.roleId))
    if (admins.length && can('equipe.ver'))
      out.push({ id: '2fa', icon: KeyRound, tone: 'danger', title: `${admins.length} ${admins.length === 1 ? 'pessoa' : 'pessoas'} com acesso amplo sem 2FA`, detail: admins.map((a) => a.name).join(', '), to: '/settings/equipe' })
    if (!panel.allowlist.length && can('seguranca-painel.ver'))
      out.push({ id: 'ip', icon: ShieldAlert, tone: 'warning', title: 'Painel aceita login de qualquer IP', detail: 'Cadastre os IPs da equipe em Segurança do painel.', to: '/settings/seguranca' })
    const open = invoices.filter((i) => !i.paid).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    if (open.length && can('faturas.ver')) {
      const total = open.reduce((s, i) => s + i.total, 0)
      const overdue = new Date(open[0].dueDate).getTime() < Date.now()
      out.push({
        id: 'fatura',
        icon: Receipt,
        tone: overdue ? 'danger' : 'info',
        title: `${open.length === 1 ? 'Fatura' : `${open.length} faturas`} de ${brl(total)} em aberto`,
        detail: `${overdue ? 'Venceu' : 'Vence'} em ${date(open[0].dueDate)}.`,
        to: '/faturas',
      })
    }
    return out
  }, [withdrawals, team, panel, can, invoices])
}

function StatusPill() {
  const [attack] = useAttackMode()
  const [maint] = useMaintenance()
  if (attack.active)
    return (
      <Link to="/settings/modo-ataque" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-danger/10 px-3 text-xs font-semibold text-danger ring-1 ring-inset ring-danger/25 hover:bg-danger/15">
        <Siren size={14} className="animate-pulse" aria-hidden /> Modo de ataque ligado
      </Link>
    )
  if (maint.active)
    return (
      <Link to="/settings/manutencao" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-warning/10 px-3 text-xs font-semibold text-warning ring-1 ring-inset ring-warning/25 hover:bg-warning/15">
        <Construction size={14} aria-hidden /> Site em manutenção
      </Link>
    )
  return (
    <span className="hidden h-8 items-center gap-1.5 rounded-full bg-success/10 px-3 text-xs font-semibold text-success ring-1 ring-inset ring-success/20 sm:inline-flex">
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      Operação normal
    </span>
  )
}

export function Topbar({ onOpenMenu, onOpenSearch }: { onOpenMenu: () => void; onOpenSearch: () => void }) {
  const { mode, resolved, setMode } = useTheme()
  const { user, role, realRole, isSimulating, setViewAs } = useSession()
  const [roles] = useRoles()
  const notices = useNotices()
  const navigate = useNavigate()
  const auth = useAuthApi()
  const [passwordOpen, setPasswordOpen] = useState(false)

  // modo API: conta real (trocar senha, sair de verdade); sem dados de demonstração para restaurar
  const accountMenu: MenuEntry[] = auth.enabled
    ? [
        { heading: 'Sua conta' },
        { label: 'Trocar senha', icon: KeyRound, onSelect: () => setPasswordOpen(true) },
        { label: 'Sair', icon: LogOut, danger: true, onSelect: () => void auth.logout() },
      ]
    : [
        {
          label: 'Restaurar dados de demonstração',
          icon: RotateCcw,
          onSelect: async () => {
            const ok = await confirm({
              title: 'Restaurar dados de demonstração?',
              description: 'Todas as alterações feitas neste navegador serão apagadas e o painel volta ao estado inicial.',
              confirmLabel: 'Restaurar',
              tone: 'warning',
            })
            if (ok) {
              resetDb()
              toast.success('Dados restaurados')
            }
          },
        },
        { label: 'Sair', icon: LogOut, danger: true, onSelect: () => toast.info('Sessão encerrada (demonstração)') },
      ]

  const viewAsMenu: MenuEntry[] = [
    { heading: 'Ver painel como cargo' },
    ...roles.map((r) => ({
      label: (
        <span className="flex items-center justify-between gap-2">
          {r.name}
          {r.id === realRole.id && <span className="text-[11px] text-fg-3">seu cargo</span>}
        </span>
      ),
      icon: r.id === role.id ? Check : UserRound,
      onSelect: () => {
        setViewAs(r.id === realRole.id ? null : r.id)
        toast.info(r.id === realRole.id ? 'Voltou ao seu cargo' : `Vendo o painel como ${r.name}`, {
          description: auth.enabled
            ? 'Menu, telas e botões seguem o cargo escolhido, sem passar das suas permissões.'
            : 'Menu, telas e botões seguem as permissões do cargo.',
        })
      },
    })),
    { divider: true },
  ]

  // sem a lista de cargos (modo API, falha ao carregar), o menu mostra só a conta
  const userMenu: MenuEntry[] = [...(roles.length ? viewAsMenu : []), ...accountMenu]

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      {isSimulating && (
        <div className="flex items-center justify-center gap-3 bg-primary px-4 py-1.5 text-center text-xs font-medium text-primary-fg">
          <span>
            Você está vendo o painel como <strong>{role.name}</strong>. As ações seguem as permissões desse cargo.
          </span>
          <button type="button" onClick={() => setViewAs(null)} className="rounded-md bg-white/20 px-2 py-0.5 font-semibold hover:bg-white/30">
            Voltar ao meu cargo
          </button>
        </div>
      )}
      <div className="flex h-16 items-center gap-2 px-4 sm:px-6">
        <IconButton icon={MenuIcon} label="Abrir menu" onClick={onOpenMenu} className="lg:hidden" />
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-line bg-surface px-3 text-sm text-fg-3 shadow-sm transition-colors hover:border-line-strong sm:max-w-md lg:hidden"
        >
          <Search size={16} aria-hidden />
          <span className="truncate">Buscar páginas</span>
        </button>
        <div className="hidden min-w-0 flex-1 items-center gap-2 text-sm text-fg-3 lg:flex">
          <Globe2 size={15} aria-hidden />
          <span className="truncate">x2win.bet.br</span>
          <span className="text-line-strong">·</span>
          <span className="truncate">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <StatusPill />
          <Popover
            align="end"
            width={360}
            trigger={(p) => (
              <button
                {...p}
                type="button"
                aria-label={`Avisos (${notices.length})`}
                title="Avisos"
                className="relative flex h-10 w-10 items-center justify-center rounded-lg text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg"
              >
                <Bell size={18} aria-hidden />
                {notices.length > 0 && (
                  <span className="absolute right-1.5 top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white ring-2 ring-bg">
                    {notices.length}
                  </span>
                )}
              </button>
            )}
          >
            {(close) => (
              <div>
                <p className="mb-2 text-sm font-semibold text-fg">Avisos da operação</p>
                {notices.length === 0 ? (
                  <p className="py-6 text-center text-[13px] text-fg-3">Tudo em dia.</p>
                ) : (
                  <ul className="-mx-2 space-y-0.5">
                    {notices.map((n) => (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => {
                            close()
                            navigate(n.to)
                          }}
                          className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-3"
                        >
                          <span
                            className={cn(
                              'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                              n.tone === 'danger' ? 'bg-danger/10 text-danger' : n.tone === 'warning' ? 'bg-warning/10 text-warning' : 'bg-info/10 text-info',
                            )}
                          >
                            <n.icon size={15} aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13px] font-medium text-fg">{n.title}</span>
                            <span className="block text-xs leading-5 text-fg-3">{n.detail}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Popover>
          <Menu
            width={200}
            items={[
              { label: 'Claro', icon: mode === 'light' ? Check : Sun, onSelect: () => setMode('light') },
              { label: 'Escuro', icon: mode === 'dark' ? Check : Moon, onSelect: () => setMode('dark') },
              { label: 'Seguir o sistema', icon: mode === 'system' ? Check : Monitor, onSelect: () => setMode('system') },
            ]}
            trigger={(p) => <IconButton {...p} icon={resolved === 'dark' ? Moon : Sun} label="Tema: claro ou escuro" />}
          />
          <Menu
            width={260}
            items={userMenu}
            trigger={(p) => (
              <button
                {...p}
                type="button"
                className="ml-1 flex h-10 items-center gap-2.5 rounded-xl py-1 pl-1 pr-1 transition-colors hover:bg-surface-3 sm:pr-3"
                aria-label="Menu do usuário"
              >
                <Avatar name={user.name} size={32} />
                <span className="hidden min-w-0 text-left leading-tight sm:block">
                  <span className="block max-w-[140px] truncate text-[13px] font-semibold text-fg">{user.name}</span>
                  <span className={cn('block max-w-[140px] truncate text-[11px]', isSimulating ? 'font-semibold text-primary-text' : 'text-fg-3')}>
                    {role.name}
                    {!isSimulating && user.lastAccess ? ` · ${relative(user.lastAccess)}` : ''}
                  </span>
                </span>
              </button>
            )}
          />
        </div>
      </div>
      {auth.enabled && passwordOpen && (
        <Suspense fallback={null}>
          <ChangePasswordModal open onClose={() => setPasswordOpen(false)} />
        </Suspense>
      )}
    </header>
  )
}
