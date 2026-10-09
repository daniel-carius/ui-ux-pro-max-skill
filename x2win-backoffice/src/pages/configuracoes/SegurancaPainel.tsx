import { useMemo, useState } from 'react'
import {
  Globe,
  LogIn,
  MapPin,
  Network,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Trash2,
  Wifi,
  LockKeyhole,
  UserRoundX,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Field,
  FormFieldset,
  IconButton,
  Input,
  KpiCard,
  Mono,
  PageHeader,
  PersonCell,
  SaveBar,
  Select,
  SettingsSection,
  Switch,
  Tooltip,
  confirm,
  toast,
  useSettingsForm,
  type Column,
} from '@/components/ui'
import { dateTime, num, plural, relative } from '@/lib/format'
import { uid } from '@/lib/random'
import type { AuditEntry } from '@/data/team'
import { SESSION_IP, audit, useAudit, usePageAccess, useRoles, useSession, useTeam } from '@/domain/session'
import { DEFAULT_PANEL_SECURITY, PANEL_SECURITY_KEY, usePanelSecurity, type PanelSecurityState } from '@/domain/system'
import { allowlistAllows, coveredBy, ipMatchesEntry, parseAllowEntry, rangeOf24, wouldLockOut } from '@/domain/config2-network'
import { needs2faSetup } from '@/domain/config2-access'
import { useExternalSave } from './_shared-g'

type Entry = PanelSecurityState['allowlist'][number]

const TIMEOUTS = [
  { value: '15', label: '15 minutos' },
  { value: '30', label: '30 minutos' },
  { value: '60', label: '1 hora' },
  { value: '120', label: '2 horas' },
  { value: '240', label: '4 horas' },
  { value: '480', label: '8 horas' },
  { value: '720', label: '12 horas' },
]

export default function SegurancaPainel() {
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  const [team] = useTeam()
  const [roles] = useRoles()
  const [, setPanel] = usePanelSecurity()
  const form = useSettingsForm<PanelSecurityState>(PANEL_SECURITY_KEY, DEFAULT_PANEL_SECURITY, {
    entity: 'Segurança do painel',
    successMessage: 'Segurança do painel salva',
    validate: (v) => (v.sessionTimeoutMinutes < 5 ? 'O tempo de sessão precisa ser de pelo menos 5 minutos.' : null),
  })
  const applyNow = useExternalSave(form, setPanel)
  const list = form.saved.allowlist
  const v = form.values
  const myAllowed = allowlistAllows(list, SESSION_IP)

  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [touched, setTouched] = useState(false)
  const parsed = parseAllowEntry(value)
  const dup = parsed.ok ? coveredBy(parsed.normalized, list) : null
  const addError = !value.trim() ? (touched ? 'Informe um IP ou uma faixa.' : null) : !parsed.ok ? parsed.error : dup ? `Já coberto por ${dup}.` : null
  const labelError = touched && !label.trim() ? 'Diga de onde é (ex.: Escritório SP).' : null

  const activeTeam = team.filter((m) => m.status === 'ativo')
  const blockedTeam = list.length ? activeTeam.filter((m) => m.lastIp && !allowlistAllows(list, m.lastIp)) : []

  const add = async (raw: string, lbl: string) => {
    const p = parseAllowEntry(raw)
    if (!p.ok) {
      toast.error('Endereço inválido', { description: p.error })
      return false
    }
    const cover = coveredBy(p.normalized, list)
    if (cover) {
      toast.warning('Já está liberado', { description: `${p.normalized} já é coberto por ${cover}.` })
      return false
    }
    const entry: Entry = { id: uid('ip'), value: p.normalized, label: lbl.trim(), createdAt: new Date().toISOString(), createdBy: user.name }
    const next = [...list, entry]
    if (wouldLockOut(next, SESSION_IP)) {
      const ok = await confirm({
        title: 'Você vai perder o acesso',
        description: `Com a lista ativa, só entram os IPs dela. Seu IP atual (${SESSION_IP}) não está em ${p.normalized}: sua sessão cai e você não entra de novo daqui.`,
        confirmLabel: 'Adicionar mesmo assim',
        tone: 'danger',
        icon: ShieldAlert,
        typeToConfirm: 'BLOQUEAR',
      })
      if (!ok) return false
    } else if (!list.length) {
      const outside = activeTeam.filter((m) => m.lastIp && !ipMatchesEntry(m.lastIp, p.normalized))
      const ok = await confirm({
        title: 'Ligar a restrição por IP?',
        description: `A partir de agora, só entra no painel quem estiver em ${p.normalized}. ${
          outside.length ? `${outside.map((m) => m.name).join(', ')} acessou de outro IP e ficará bloqueado(a) até ser liberado(a).` : 'Toda a equipe ativa acessou deste endereço.'
        }`,
        confirmLabel: 'Ligar restrição',
        tone: 'warning',
        icon: LockKeyhole,
      })
      if (!ok) return false
    }
    applyNow((prev) => ({ ...prev, allowlist: [...prev.allowlist, entry] }))
    audit('criar', 'Segurança do painel', `IP permitido adicionado: ${entry.value} (${entry.label})`)
    toast.success(p.kind === 'ip' ? 'IP adicionado' : 'Faixa adicionada', { description: `${entry.value} · ${p.size === 1 ? '1 endereço' : `${num(p.size)} endereços`}` })
    return true
  }

  const submit = async () => {
    setTouched(true)
    if (addError || !label.trim() || !parsed.ok) return
    if (await add(value, label)) {
      setValue('')
      setLabel('')
      setTouched(false)
    }
  }

  const remove = async (e: Entry) => {
    const next = list.filter((x) => x.id !== e.id)
    const lockOut = wouldLockOut(next, SESSION_IP)
    const opens = next.length === 0
    const ok = await confirm({
      title: lockOut ? 'Remover vai bloquear você' : `Remover ${e.value}?`,
      description: lockOut
        ? `Seu IP atual (${SESSION_IP}) só é liberado por este item. Sem ele, sua sessão cai e você não entra de novo daqui.`
        : opens
          ? 'É o último item. Com a lista vazia, a equipe volta a entrar de qualquer IP.'
          : `Quem acessa de "${e.label}" deixa de entrar no painel.`,
      confirmLabel: 'Remover',
      tone: 'danger',
      icon: lockOut ? ShieldAlert : Trash2,
      typeToConfirm: lockOut ? 'BLOQUEAR' : undefined,
    })
    if (!ok) return
    applyNow((prev) => ({ ...prev, allowlist: prev.allowlist.filter((x) => x.id !== e.id) }))
    audit('excluir', 'Segurança do painel', `IP permitido removido: ${e.value} (${e.label})${opens ? '; lista vazia, qualquer IP entra' : ''}`)
    toast.success('Removido da lista', { description: opens ? 'Nenhuma restrição: a equipe entra de qualquer IP.' : undefined })
  }

  const addMyIp = () => add(SESSION_IP, `IP de ${user.name.split(' ')[0]}`)

  const without2fa = activeTeam.filter((m) => !m.twoFactor)
  const pending = activeTeam.filter((m) => needs2faSetup(m, roles.find((r) => r.id === m.roleId), v.enforce2faForAll))

  return (
    <>
      <PageHeader
        actions={
          <Tooltip content={`IP da sua sessão: ${SESSION_IP}`}>
            <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] text-fg-2">
              <MapPin size={15} className="text-fg-3" aria-hidden />
              Seu IP: <Mono className="text-fg">{SESSION_IP}</Mono>
              <Badge tone={!list.length ? 'neutral' : myAllowed ? 'success' : 'danger'}>{!list.length ? 'sem restrição' : myAllowed ? 'liberado' : 'fora da lista'}</Badge>
            </span>
          </Tooltip>
        }
      />

      <div className="space-y-5">
        <section aria-label="Resumo" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="IPs e faixas permitidos" icon={Network} tone={list.length ? 'success' : 'danger'} value={list.length ? num(list.length) : 'Nenhum'} hint={list.length ? 'só eles entram no painel' : 'qualquer IP entra'} />
          <KpiCard label="Equipe fora da lista" icon={UserRoundX} tone={blockedTeam.length ? 'warning' : 'neutral'} value={num(blockedTeam.length)} hint={list.length ? 'pelo último IP de acesso' : 'lista vazia'} />
          <KpiCard label="2FA para todos" icon={ShieldCheck} tone={form.saved.enforce2faForAll ? 'success' : 'warning'} value={form.saved.enforce2faForAll ? 'Exigido' : 'Por cargo'} hint={`${plural(without2fa.length, 'pessoa ativa', 'pessoas ativas')} sem 2FA`} />
          <KpiCard label="Sessão parada encerra em" icon={Timer} tone="info" value={TIMEOUTS.find((t) => Number(t.value) === form.saved.sessionTimeoutMinutes)?.label ?? `${form.saved.sessionTimeoutMinutes} min`} hint="sem uso do painel" />
        </section>

        {!list.length && (
          <Alert
            tone="danger"
            icon={Globe}
            title="Nenhuma restrição: a equipe entra de qualquer IP"
            action={
              <Button variant="danger" size="sm" icon={Plus} onClick={addMyIp} disabled={!canEdit}>
                Adicionar meu IP
              </Button>
            }
          >
            Uma senha vazada basta para entrar de qualquer lugar do mundo. Libere só os IPs do escritório e da VPN. Comece pelo seu IP ({SESSION_IP}) para não se trancar fora.
          </Alert>
        )}
        {list.length > 0 && !myAllowed && (
          <Alert tone="danger" icon={ShieldAlert} title="Seu IP atual está fora da lista">
            Esta sessão continua até expirar, mas um novo login daqui será recusado. Adicione seu IP se este é um local de trabalho.
          </Alert>
        )}

        <Card>
          <CardHeader
            icon={LockKeyhole}
            title="IPs e faixas permitidos"
            description="Com a lista preenchida, só estes endereços entram no painel. Vale para login, sessões abertas e chaves de IA."
            actions={
              <Button size="sm" icon={MapPin} onClick={addMyIp} disabled={!canEdit || (list.length > 0 && myAllowed)} title={list.length > 0 && myAllowed ? 'Seu IP já está liberado' : undefined}>
                Adicionar meu IP
              </Button>
            }
          />
          <CardBody className="space-y-4">
            <FormFieldset readOnly={!canEdit}>
              <form
                className="grid gap-3 rounded-xl border border-line bg-surface-2 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start"
                onSubmit={(e) => {
                  e.preventDefault()
                  submit()
                }}
              >
                <Field label="IP ou faixa (CIDR)" htmlFor="ip-value" error={addError}
                  hint={
                    parsed.ok && !dup
                      ? `${parsed.kind === 'ip' ? 'IP único' : `Faixa de ${num(parsed.size)} endereços: ${parsed.first} a ${parsed.last}`}${ipMatchesEntry(SESSION_IP, parsed.normalized) ? ' · inclui seu IP' : ''}`
                      : 'Ex.: 189.45.12.207 ou 189.45.12.0/24'
                  }
                >
                  <Input id="ip-value" value={value} invalid={!!addError} placeholder="189.45.12.0/24" autoComplete="off" className="font-mono" onChange={(e) => setValue(e.target.value)} />
                </Field>
                <Field label="De onde é" htmlFor="ip-label" error={labelError}>
                  <Input id="ip-label" value={label} invalid={!!labelError} placeholder="Escritório São Paulo" onChange={(e) => setLabel(e.target.value)} />
                </Field>
                <Button type="submit" variant="primary" icon={Plus} className="sm:mt-[26px]">
                  Adicionar
                </Button>
              </form>
              {parsed.ok && parsed.warnings.map((w) => (
                <Alert key={w} tone="warning" className="mt-3">
                  {w}
                </Alert>
              ))}
              {!parsed.ok && parsed.suggestion && (
                <div className="mt-2">
                  <Button size="xs" variant="soft" onClick={() => setValue(parsed.suggestion!)}>
                    Usar {parsed.suggestion}
                  </Button>
                </div>
              )}
            </FormFieldset>

            {list.length ? (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {list.map((e) => {
                  const p = parseAllowEntry(e.value)
                  const mine = ipMatchesEntry(SESSION_IP, e.value)
                  const people = activeTeam.filter((m) => m.lastIp && ipMatchesEntry(m.lastIp, e.value))
                  return (
                    <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
                        {p.ok && p.kind === 'cidr' ? <Network size={16} aria-hidden /> : <Wifi size={16} aria-hidden />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2">
                          <Mono className="text-[13.5px] font-semibold text-fg">{e.value}</Mono>
                          <Badge>{p.ok ? (p.kind === 'ip' ? 'IP único' : `Faixa /${p.prefix} · ${num(p.size)} IPs`) : 'inválido'}</Badge>
                          {mine && <Badge tone="primary" icon={MapPin}>Seu IP</Badge>}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-fg-3">
                          {e.label} · por {e.createdBy} {relative(e.createdAt)}
                          {people.length > 0 && ` · usado por ${people.map((m) => m.name.split(' ')[0]).join(', ')}`}
                        </p>
                      </div>
                      <IconButton icon={Trash2} variant="danger" label={`Remover ${e.value}`} disabled={!canEdit} onClick={() => remove(e)} />
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-danger/30 bg-danger/[0.03] px-6 py-8 text-center">
                <Globe size={22} className="text-danger" aria-hidden />
                <p className="text-sm font-semibold text-fg">Lista vazia: qualquer IP entra</p>
                <p className="max-w-md text-[13px] text-fg-3">Adicione o IP do escritório, da VPN ou o seu. Sugestão de faixa para a sua rede: <Mono>{rangeOf24(SESSION_IP)}</Mono></p>
              </div>
            )}

            {blockedTeam.length > 0 && (
              <Alert tone="warning" icon={UserRoundX} title={`${plural(blockedTeam.length, 'pessoa ativa acessou', 'pessoas ativas acessaram')} de fora da lista`}>
                {blockedTeam.map((m) => `${m.name} (${m.lastIp})`).join(' · ')}. No próximo login, serão recusadas. Libere o IP delas ou confirme que é esperado.
              </Alert>
            )}
          </CardBody>
        </Card>

        <FormFieldset readOnly={form.readOnly}>
          <SettingsSection title="Verificação em duas etapas" description="Exige 2FA de toda a equipe, além do que cada cargo já exige em Cargos e permissões.">
            <Switch
              label="Exigir 2FA de todos"
              description={v.enforce2faForAll ? 'Ninguém entra só com a senha.' : 'Cada cargo decide se o 2FA é exigido.'}
              checked={v.enforce2faForAll}
              onChange={(on) => form.set('enforce2faForAll', on)}
            />
            {v.enforce2faForAll !== form.saved.enforce2faForAll && v.enforce2faForAll && (
              <Alert tone="info">
                {pending.length
                  ? `${pending.map((m) => m.name).join(', ')} precisa${pending.length > 1 ? 'm' : ''} ativar o 2FA no próximo acesso depois de salvar.`
                  : 'Toda a equipe ativa já usa 2FA.'}
              </Alert>
            )}
          </SettingsSection>
          <SettingsSection title="Sessão" description="Sessões paradas são encerradas para evitar painel aberto em computador sem ninguém.">
            <Field label="Encerrar sessão parada depois de" htmlFor="sess-timeout" hint="Recomendado: até 2 horas para cargos que aprovam saques.">
              <Select id="sess-timeout" value={String(v.sessionTimeoutMinutes)} onChange={(x) => form.set('sessionTimeoutMinutes', Number(x))} options={TIMEOUTS} className="max-w-xs" />
            </Field>
          </SettingsSection>
        </FormFieldset>

        <RecentLogins list={list} />
      </div>

      <SaveBar form={form} />
    </>
  )
}

function RecentLogins({ list }: { list: Entry[] }) {
  const [entries] = useAudit()
  const [team] = useTeam()
  const logins = useMemo(() => entries.filter((e) => e.action === 'login').slice(0, 50), [entries])
  const known = (e: AuditEntry) => {
    const m = team.find((x) => x.id === e.actorId)
    return !m || m.lastIp === e.ip
  }
  const columns: Column<AuditEntry>[] = [
    { id: 'at', header: 'Quando', sortValue: (e) => e.at, cell: (e) => <Tooltip content={dateTime(e.at)}><span className="text-[13px] text-fg-2">{relative(e.at)}</span></Tooltip> },
    { id: 'who', header: 'Pessoa', sortValue: (e) => e.actorName, cell: (e) => <PersonCell name={e.actorName} sub={team.find((m) => m.id === e.actorId)?.email} /> },
    { id: 'ip', header: 'IP', sortValue: (e) => e.ip, cell: (e) => <span className="inline-flex items-center gap-1.5"><Mono>{e.ip}</Mono>{!known(e) && <Badge tone="info">IP diferente do último</Badge>}</span> },
    {
      id: 'allowed',
      header: 'Na lista atual',
      cell: (e) =>
        !list.length ? <Badge>Sem restrição</Badge> : allowlistAllows(list, e.ip) ? <Badge tone="success" dot>Liberado</Badge> : <Badge tone="danger" dot>Seria recusado</Badge>,
    },
    { id: 'summary', header: 'Como', cell: (e) => <span className="text-[13px] text-fg-3">{e.summary}</span> },
  ]
  return (
    <Card>
      <CardHeader
        icon={LogIn}
        title="Logins recentes"
        description="Entradas no painel registradas na auditoria, comparadas com a lista atual."
        actions={
          <a className="link text-[13px]" href="#/settings/auditoria?acao=login">
            Ver todos na auditoria
          </a>
        }
      />
      <DataTable
        bare
        caption="Logins recentes no painel"
        rows={logins}
        columns={columns}
        rowKey={(e) => e.id}
        columnPicker={false}
        initialSort={{ id: 'at', dir: 'desc' }}
        pageSizeOptions={[10, 25, 50]}
        empty={{ title: 'Nenhum login registrado', icon: LogIn }}
        className="relative overflow-hidden border-t border-line"
      />
    </Card>
  )
}
