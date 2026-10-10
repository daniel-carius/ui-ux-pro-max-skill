import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Activity, Download, FilterX, Fingerprint, History, Lock, MessageSquareWarning, ScrollText, ShieldAlert, Users } from 'lucide-react'
import { BarsChart } from '@/components/charts'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  DateRangePicker,
  DescriptionList,
  Drawer,
  KpiCard,
  Mono,
  PageHeader,
  PersonCell,
  Select,
  Tooltip,
  inRange,
  presetRange,
  rangeLabel,
  toast,
  type Column,
  type DateRange,
  type Tone,
} from '@/components/ui'
import { dateShort, dateTime, num, pct, relative, time } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ApiError, apiDownload, isApiMode } from '@/lib/api'
import { refreshKey } from '@/lib/store'
import { DAY, dayKey, startOfDay } from '@/data/now'
import { AUDIT_ACTION_LABEL, type AuditAction, type AuditEntry } from '@/data/team'
import { AUDIT_SOURCE_LABEL, isPanelReported } from '@shared/audit'
import { KEYS, SESSION_IP, audit, useAudit, usePageAccess, useRoles, useTeam } from '@/domain/session'
import { SENSITIVE_ACTIONS } from '@/domain/config2-access'
import { RoleBadge } from './_shared-g'

const ACTION_TONE: Partial<Record<AuditAction, Tone>> = {
  login: 'neutral',
  criar: 'primary',
  editar: 'info',
  excluir: 'danger',
  aprovar: 'success',
  recusar: 'warning',
  exportar: 'gold',
  ligar: 'danger',
  desligar: 'warning',
  convidar: 'primary',
  desativar: 'danger',
  enviar: 'info',
  testar: 'neutral',
  sincronizar: 'neutral',
  banir: 'danger',
  bloquear: 'warning',
  revelar: 'danger',
}

const ACTIONS = Object.keys(AUDIT_ACTION_LABEL) as AuditAction[]

/** Modo API: o CSV é gerado pelo servidor (com os filtros de período, pessoa e ação) e a exportação é auditada lá. */
const API = isApiMode()

/**
 * Ação sensível verificada: registros relatados pelo painel (não verificados) não contam nos resumos
 * (ações sensíveis, atividade por dia e quem mais agiu), só aparecem na lista com o selo.
 */
const isSensitive = (e: AuditEntry) => !isPanelReported(e) && SENSITIVE_ACTIONS.includes(e.action)

function exportQuery(range: DateRange, person: string, action: string) {
  const q = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString() })
  if (person) q.set('actorId', person)
  if (action) q.set('action', action)
  return q.toString()
}

export default function Auditoria() {
  const { can } = usePageAccess()
  const [entries] = useAudit()
  const [team] = useTeam()
  const [roles] = useRoles()
  const [params, setParams] = useSearchParams()
  const [range, setRange] = useState<DateRange>(() => presetRange('30d'))
  const [openId, setOpenId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const person = params.get('pessoa') ?? ''
  const action = (params.get('acao') ?? '') as AuditAction | ''
  const canExport = can('auditoria.exportar')

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  const inPeriod = useMemo(() => entries.filter((e) => inRange(e.at, range)), [entries, range])
  const rows = useMemo(() => inPeriod.filter((e) => (!person || e.actorId === person) && (!action || e.action === action)), [inPeriod, person, action])

  const actors = new Set(inPeriod.map((e) => e.actorId))
  const exports = inPeriod.filter((e) => e.action === 'exportar')
  const sensitive = inPeriod.filter(isSensitive)
  // resumos só com registros do servidor (ou da demonstração): os relatados pelo painel não foram verificados
  const verifiedRows = useMemo(() => rows.filter((e) => !isPanelReported(e)), [rows])

  /** Pessoa pelo id: "nome (e-mail)" com a equipe (se o cargo puder ler); senão, o nome gravado no registro. */
  const personLabel = (actorId: string, fallbackName: string) => {
    const m = team.find((x) => x.id === actorId)
    return m ? `${m.name} (${m.email})` : fallbackName
  }
  const personOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const m of team) byId.set(m.id, `${m.name} (${m.email})`)
    // quem agiu e não está na lista da equipe (ou a equipe não é legível): nome do registro
    for (const e of entries) if (e.actorId && !byId.has(e.actorId)) byId.set(e.actorId, e.actorName)
    return [...byId.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  }, [team, entries])

  const chart = useMemo(() => {
    const days: { date: string; sensiveis: number; outras: number }[] = []
    const start = startOfDay(range.from).getTime()
    const end = startOfDay(range.to).getTime()
    const byDay = new Map<string, { s: number; o: number }>()
    for (const e of verifiedRows) {
      const k = dayKey(new Date(e.at))
      const cur = byDay.get(k) ?? { s: 0, o: 0 }
      if (isSensitive(e)) cur.s++
      else cur.o++
      byDay.set(k, cur)
    }
    for (let t = start; t <= end; t += DAY) {
      const k = dayKey(new Date(t))
      const v = byDay.get(k)
      days.push({ date: k, sensiveis: v?.s ?? 0, outras: v?.o ?? 0 })
    }
    return days
  }, [verifiedRows, range])

  // agrupado pelo id de quem agiu (duas pessoas com o mesmo nome não se misturam)
  const byPerson = useMemo(() => {
    const m = new Map<string, { name: string; n: number; sensitive: number }>()
    for (const e of verifiedRows) {
      const cur = m.get(e.actorId) ?? { name: e.actorName, n: 0, sensitive: 0 }
      cur.n++
      if (isSensitive(e)) cur.sensitive++
      m.set(e.actorId, cur)
    }
    return [...m.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.n - a.n)
  }, [verifiedRows])
  const maxN = Math.max(1, ...byPerson.map((p) => p.n))

  const roleOf = (actorId: string) => {
    const m = team.find((x) => x.id === actorId)
    return m ? roles.find((r) => r.id === m.roleId) : undefined
  }
  const knownIp = (e: AuditEntry) => {
    // modo API: sem auditoria.ver o IP das ações de outras pessoas vem vazio
    if (!e.ip) return true
    const m = team.find((x) => x.id === e.actorId)
    return e.ip === SESSION_IP || !m || m.lastIp === e.ip
  }

  const exportFromServer = async () => {
    if (exporting) return
    setExporting(true)
    try {
      await apiDownload(`/api/audit/export.csv?${exportQuery(range, person, action)}`, `auditoria-${new Date().toISOString().slice(0, 10)}.csv`)
      toast.success('Exportação concluída', { description: 'O arquivo foi baixado e a exportação ficou registrada na auditoria.' })
      // a própria exportação entra no registro
      refreshKey(KEYS.audit).catch(() => {})
    } catch (e) {
      toast.error('Não foi possível exportar', { description: e instanceof ApiError ? e.message : 'Tente de novo em instantes.' })
    } finally {
      setExporting(false)
    }
  }

  const filterLabel = [person && `pessoa: ${personOptions.find((o) => o.value === person)?.label ?? person}`, action && `ação: ${AUDIT_ACTION_LABEL[action]}`]
    .filter(Boolean)
    .join(', ')
  const emailOf = (actorId: string) => team.find((m) => m.id === actorId)?.email ?? ''

  const columns: Column<AuditEntry>[] = [
    {
      id: 'at',
      header: 'Data e hora',
      pinned: true,
      sortValue: (e) => e.at,
      csv: (e) => dateTime(e.at),
      cell: (e) => (
        <div>
          <p className="text-[13px] font-medium text-fg tnum">{dateTime(e.at)}</p>
          <p className="text-xs text-fg-3">{relative(e.at)}</p>
        </div>
      ),
    },
    {
      id: 'who',
      header: 'Quem fez',
      minWidth: 180,
      sortValue: (e) => e.actorName,
      csv: (e) => e.actorName,
      cell: (e) => <PersonCell name={e.actorName} sub={roleOf(e.actorId)?.name ?? '—'} />,
    },
    // mesmas colunas do CSV do servidor (escondidas por padrão): identificam quem fez sem depender do nome
    { id: 'actorId', header: 'ID de quem fez', defaultHidden: true, sortValue: (e) => e.actorId, csv: (e) => e.actorId, cell: (e) => <Mono>{e.actorId || '—'}</Mono> },
    {
      id: 'actorEmail',
      header: 'E-mail de quem fez',
      defaultHidden: true,
      sortValue: (e) => emailOf(e.actorId),
      csv: (e) => emailOf(e.actorId),
      cell: (e) => <span className="text-[13px] text-fg-2">{emailOf(e.actorId) || '—'}</span>,
    },
    {
      id: 'action',
      header: 'Ação',
      sortValue: (e) => AUDIT_ACTION_LABEL[e.action],
      csv: (e) => AUDIT_ACTION_LABEL[e.action],
      cell: (e) => (
        <Badge tone={ACTION_TONE[e.action] ?? 'neutral'} icon={isSensitive(e) ? ShieldAlert : undefined}>
          {AUDIT_ACTION_LABEL[e.action]}
        </Badge>
      ),
    },
    {
      id: 'entity',
      header: 'Entidade',
      sortValue: (e) => e.entity,
      csv: (e) => e.entity,
      cell: (e) => (
        <div className="max-w-[220px]">
          <span className="block truncate text-[13px] font-medium text-fg">{e.entity}</span>
          {isPanelReported(e) && (
            <Badge tone="warning" icon={MessageSquareWarning} className="mt-1">
              {AUDIT_SOURCE_LABEL.painel}
            </Badge>
          )}
        </div>
      ),
    },
    { id: 'summary', header: 'Resumo', csv: (e) => e.summary, cell: (e) => <span className="block max-w-[340px] truncate text-[13px] text-fg-2">{e.summary}</span> },
    {
      id: 'ip',
      header: 'IP',
      sortValue: (e) => e.ip,
      csv: (e) => e.ip,
      cell: (e) => (
        <span className="inline-flex items-center gap-1.5">
          {e.ip ? <Mono>{e.ip}</Mono> : <span className="text-fg-3">—</span>}
          {!knownIp(e) && (
            <Tooltip content="Diferente do último IP conhecido da pessoa">
              <Badge tone="info">outro IP</Badge>
            </Tooltip>
          )}
        </span>
      ),
    },
    // origem (servidor × relatado pelo painel): só no modo API; na demonstração todo registro é do navegador
    ...(API
      ? [
          {
            id: 'source',
            header: 'Origem',
            defaultHidden: true,
            sortValue: (e: AuditEntry) => (isPanelReported(e) ? 1 : 0),
            csv: (e: AuditEntry) => (isPanelReported(e) ? AUDIT_SOURCE_LABEL.painel : AUDIT_SOURCE_LABEL.servidor),
            cell: (e: AuditEntry) => <span className="text-[13px] text-fg-2">{isPanelReported(e) ? AUDIT_SOURCE_LABEL.painel : AUDIT_SOURCE_LABEL.servidor}</span>,
          },
        ]
      : []),
  ]

  const open = entries.find((e) => e.id === openId)

  return (
    <>
      <PageHeader actions={<DateRangePicker value={range} onChange={setRange} presets={['hoje', '7d', '30d', '90d']} />} />

      <div className="space-y-5">
        <section aria-label="Resumo do período" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Ações no período" icon={Activity} value={num(inPeriod.length)} hint={rangeLabel(range)} />
          <KpiCard
            label="Pessoas ativas"
            icon={Users}
            tone="info"
            value={num(actors.size)}
            hint={`de ${num(team.filter((m) => m.status !== 'convidado').length)} na equipe`}
            formula={<>Pessoas com pelo menos uma ação registrada no período.</>}
          />
          <KpiCard
            label="Exportações"
            icon={Download}
            tone={exports.length ? 'warning' : 'neutral'}
            value={num(exports.length)}
            hint="arquivos com dados baixados"
            onClick={() => setParam('acao', action === 'exportar' ? '' : 'exportar')}
            active={action === 'exportar'}
          />
          <KpiCard
            label="Ações sensíveis"
            icon={ShieldAlert}
            tone={sensitive.length ? 'danger' : 'success'}
            value={num(sensitive.length)}
            hint={`${pct(inPeriod.length ? sensitive.length / inPeriod.length : 0)} do total`}
            formula={<>Revelar dado sensível, banir, desativar acesso e ligar recursos (modo de ataque, 2FA, reativações).{API ? ' Registros relatados pelo painel (não verificados) não contam.' : ''}</>}
          />
        </section>

        <div className="grid gap-5 xl:grid-cols-3">
          <Card className="min-w-0 xl:col-span-2">
            <CardHeader title="Atividade por dia" description={`${filterLabel ? `Com filtro (${filterLabel})` : rangeLabel(range)}${API ? ' · sem os relatados pelo painel' : ''}`} icon={History} />
            <CardBody>
              <BarsChart
                ariaLabel="Ações registradas por dia"
                data={chart}
                xKey="date"
                xFormat={(k) => dateShort(`${k}T12:00:00`)}
                height={220}
                stacked
                series={[
                  { key: 'outras', label: 'Outras ações', slot: 1 },
                  { key: 'sensiveis', label: 'Sensíveis', slot: 8 },
                ]}
              />
            </CardBody>
          </Card>
          <Card className="min-w-0">
            <CardHeader title="Quem mais agiu" description={API ? 'No período e filtros atuais, sem os relatados pelo painel' : 'No período e filtros atuais'} icon={Users} />
            <CardBody>
              {byPerson.length ? (
                <ul className="space-y-3">
                  {byPerson.slice(0, 6).map((p) => (
                    <li key={p.id}>
                      <button type="button" className="w-full text-left" onClick={() => setParam('pessoa', person === p.id ? '' : p.id)} aria-pressed={person === p.id}>
                        <div className="flex items-baseline justify-between gap-2 text-[13px]">
                          <span className={cn('truncate font-medium', person === p.id ? 'text-primary-text' : 'text-fg')}>{personLabel(p.id, p.name)}</span>
                          <span className="shrink-0 text-fg-2 tnum">
                            {num(p.n)}
                            {p.sensitive > 0 && <span className="ml-1.5 text-xs text-danger">{p.sensitive} sensíveis</span>}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
                          <div className="h-full rounded-full" style={{ width: `${(p.n / maxN) * 100}%`, background: 'var(--chart-1)' }} />
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-[13px] text-fg-3">Nenhuma ação no período.</p>
              )}
            </CardBody>
          </Card>
        </div>

        <Alert tone="neutral" icon={Lock}>
          O registro é imutável: ninguém edita nem apaga entradas, nem o Superadmin. Exportar a auditoria também fica registrado
          {canExport ? '.' : '. Seu cargo não tem a permissão "Exportar auditoria".'} O arquivo pode ter nomes, e-mails e IPs da equipe (LGPD): guarde em local restrito.
        </Alert>

        <DataTable
          caption="Registro de auditoria"
          className="relative"
          rows={rows}
          columns={columns}
          rowKey={(e) => e.id}
          pageSize={50}
          pageSizeOptions={[50, 100]}
          searchText={(e) => `${e.entity} ${e.summary} ${e.ip} ${e.actorName}`}
          searchPlaceholder="Buscar em entidade, resumo ou IP"
          initialSort={{ id: 'at', dir: 'desc' }}
          onRowClick={(e) => setOpenId(e.id)}
          resetKey={`${person}|${action}|${range.from.getTime()}|${range.to.getTime()}`}
          rowClassName={(e) => (isSensitive(e) ? 'bg-danger/[0.03]' : undefined)}
          exportName={API ? undefined : 'auditoria'}
          canExport={canExport}
          onExport={(n) => audit('exportar', 'Auditoria', `Exportação CSV de ${num(n)} registros (${rangeLabel(range)}${filterLabel ? `; ${filterLabel}` : ''})`)}
          toolbarRight={
            API ? (
              <Button
                size="sm"
                icon={Download}
                onClick={exportFromServer}
                loading={exporting}
                disabled={!canExport}
                title={
                  canExport
                    ? 'Baixa o CSV do período e dos filtros de pessoa e ação (a busca não entra), com ID e e-mail de quem fez'
                    : 'Seu cargo não exporta estes dados'
                }
              >
                Exportar
              </Button>
            ) : undefined
          }
          toolbar={
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                aria-label="Filtrar por pessoa"
                value={person}
                onChange={(v) => setParam('pessoa', v)}
                className="sm:w-64"
                options={[{ value: '', label: 'Todas as pessoas' }, ...personOptions]}
              />
              <Select
                aria-label="Filtrar por ação"
                value={action}
                onChange={(v) => setParam('acao', v)}
                className="sm:w-52"
                options={[{ value: '', label: 'Todas as ações' }, ...ACTIONS.map((a) => ({ value: a, label: AUDIT_ACTION_LABEL[a] }))]}
              />
              {(person || action) && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={FilterX}
                  onClick={() => {
                    const next = new URLSearchParams(params)
                    next.delete('pessoa')
                    next.delete('acao')
                    setParams(next, { replace: true })
                  }}
                >
                  Limpar filtros
                </Button>
              )}
            </div>
          }
          empty={{ title: 'Nenhuma ação neste filtro', description: 'Troque o período, a pessoa ou a ação.', icon: ScrollText }}
        />
      </div>

      {open && (
        <EntryDrawer
          e={open}
          role={roleOf(open.actorId)}
          email={emailOf(open.actorId)}
          knownIp={knownIp(open)}
          nearby={entries.filter((x) => x.actorId === open.actorId && x.id !== open.id && Math.abs(new Date(x.at).getTime() - new Date(open.at).getTime()) < 6 * 3_600_000).slice(0, 8)}
          onClose={() => setOpenId(null)}
          onFilterPerson={() => {
            setParam('pessoa', open.actorId)
            setOpenId(null)
          }}
          onFilterAction={() => {
            setParam('acao', open.action)
            setOpenId(null)
          }}
          onOpen={setOpenId}
        />
      )}
    </>
  )
}

function EntryDrawer({
  e,
  role,
  email,
  knownIp,
  nearby,
  onClose,
  onFilterPerson,
  onFilterAction,
  onOpen,
}: {
  e: AuditEntry
  role: ReturnType<typeof useRoles>[0][number] | undefined
  email: string
  knownIp: boolean
  nearby: AuditEntry[]
  onClose: () => void
  onFilterPerson: () => void
  onFilterAction: () => void
  onOpen: (id: string) => void
}) {
  const sensitive = isSensitive(e)
  const reported = isPanelReported(e)
  return (
    <Drawer
      open
      onClose={onClose}
      title={AUDIT_ACTION_LABEL[e.action]}
      description={`${e.entity} · ${dateTime(e.at)}`}
      headerExtra={
        reported ? (
          <Badge tone="warning" icon={MessageSquareWarning} size="md">
            {AUDIT_SOURCE_LABEL.painel}
          </Badge>
        ) : (
          <Badge tone={ACTION_TONE[e.action] ?? 'neutral'} size="md">
            {sensitive ? 'Sensível' : 'Registro'}
          </Badge>
        )
      }
      footer={
        <>
          <Button size="sm" onClick={onFilterPerson}>
            Ver só {e.actorName.split(' ')[0]}
          </Button>
          <Button size="sm" onClick={onFilterAction}>
            Ver só "{AUDIT_ACTION_LABEL[e.action]}"
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="rounded-xl bg-surface-2 p-4">
          <p className="text-xs text-fg-3">Resumo</p>
          <p className="mt-1 text-[15px] font-medium leading-6 text-fg">{e.summary}</p>
        </div>
        {reported && (
          <Alert tone="warning" icon={MessageSquareWarning}>
            Relatado pela tela do painel: o servidor garante quem, quando e o IP. Ação, entidade e resumo foram informados por quem relatou e não foram verificados.
          </Alert>
        )}
        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Quem e onde</h3>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <PersonCell name={e.actorName} sub={email || undefined} />
            <RoleBadge role={role} />
          </div>
          <DescriptionList
            items={[
              { label: 'Data e hora', value: `${dateTime(e.at)} (${relative(e.at)})` },
              {
                label: 'IP',
                value: e.ip ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Mono>{e.ip}</Mono>
                    {!knownIp && <Badge tone="info">outro IP</Badge>}
                  </span>
                ) : (
                  '—'
                ),
              },
              { label: 'Ação', value: <Badge tone={ACTION_TONE[e.action] ?? 'neutral'}>{AUDIT_ACTION_LABEL[e.action]}</Badge> },
              { label: 'Entidade', value: e.entity },
              ...(API ? [{ label: 'Origem', value: reported ? AUDIT_SOURCE_LABEL.painel : AUDIT_SOURCE_LABEL.servidor }] : []),
              { label: 'ID de quem fez', value: e.actorId ? <Mono>{e.actorId}</Mono> : '—' },
              { label: 'ID do registro', value: <Mono>{e.id}</Mono>, full: true },
            ]}
          />
        </section>
        {sensitive && (
          <Alert tone="warning" icon={Fingerprint}>
            Ação sensível. Confira se a pessoa tinha motivo e se o IP é conhecido.
          </Alert>
        )}
        <section>
          <h3 className="mb-3 text-sm font-semibold text-fg">Outras ações de {e.actorName.split(' ')[0]} (até 6 h antes ou depois)</h3>
          {nearby.length ? (
            <ol className="space-y-2">
              {nearby.map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={() => onOpen(x.id)} className="flex w-full items-start gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
                    <span className="w-11 shrink-0 pt-0.5 text-xs text-fg-3 tnum">{time(x.at)}</span>
                    <span className="min-w-0">
                      <span className="block text-[13px] text-fg">
                        <span className="font-medium">{AUDIT_ACTION_LABEL[x.action]}</span> · {x.entity}
                      </span>
                      <span className="block truncate text-xs text-fg-3">{x.summary}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-fg-3">Nenhuma outra ação nesse intervalo.</p>
          )}
        </section>
      </div>
    </Drawer>
  )
}
