import { useMemo, useState } from 'react'
import { Crown, Eye, HandCoins, Network, Pause, Pencil, Play, Plus, Save, UserPlus, Users, Wallet, X } from 'lucide-react'
import {
  Alert,
  Avatar,
  Badge,
  Button,
  ChipFilter,
  CopyButton,
  DataTable,
  Drawer,
  EmptyState,
  Field,
  FormGrid,
  Input,
  KpiCard,
  MoneyInput,
  Mono,
  NumberInput,
  PageHeader,
  PageLink,
  PersonCell,
  RadioCards,
  confirm,
  toast,
  type Column,
} from '@/components/ui'
import { brl, brlCompact, date, maskEmail, num, relative } from '@/lib/format'
import { useAffiliates, usePlayers } from '@/data/hooks'
import type { Affiliate } from '@/data/players'
import { audit, usePageAccess, useSession } from '@/domain/session'
import {
  MAX_REVSHARE_PCT,
  REVEAL_PAYOUT_PERMISSION,
  buildManager,
  contractLabel,
  makeAffiliateCode,
  pctLabel,
  referralLink,
  round2,
  validateContract,
  validateManagerDraft,
  type ManagerDraft,
  type ManagerErrors,
} from '@/domain/afiliados'
import { AffiliateContact, AffiliateTypeBadge, StatTile } from './_shared'

interface ManagerRow {
  id: string
  manager: Affiliate
  subs: Affiliate[]
  referred: number
  depositors: number
}

type StatusFilter = 'todos' | 'ativo' | 'pausado'

const EMPTY_DRAFT: ManagerDraft = { name: '', email: '', cpa: 0, revSharePct: 10, status: 'ativo' }

export default function AfiliadosGerentes() {
  const { canEdit } = usePageAccess()
  const { items: affiliates, add, update } = useAffiliates()
  const { items: players } = usePlayers()
  const [status, setStatus] = useState<StatusFilter>('todos')
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const lockedTitle = canEdit ? undefined : 'Seu cargo pode ver, mas não editar gerentes'

  const rows = useMemo<ManagerRow[]>(() => {
    const refs = new Map<string, { n: number; dep: number }>()
    for (const p of players) {
      if (!p.referrerId) continue
      const cur = refs.get(p.referrerId) ?? { n: 0, dep: 0 }
      cur.n++
      if (p.depositsCount > 0) cur.dep++
      refs.set(p.referrerId, cur)
    }
    return affiliates
      .filter((a) => a.type === 'Manager')
      .map((m) => {
        const subs = affiliates.filter((a) => a.managerId === m.id)
        const ids = [m.id, ...subs.map((s) => s.id)]
        const n = ids.reduce((s, id) => s + (refs.get(id)?.n ?? 0), 0)
        const dep = ids.reduce((s, id) => s + (refs.get(id)?.dep ?? 0), 0)
        return { id: m.id, manager: m, subs, referred: n, depositors: dep }
      })
  }, [affiliates, players])

  const counts = {
    todos: rows.length,
    ativo: rows.filter((r) => r.manager.status === 'ativo').length,
    pausado: rows.filter((r) => r.manager.status === 'pausado').length,
  }
  const visible = status === 'todos' ? rows : rows.filter((r) => r.manager.status === status)
  const allSubs = rows.flatMap((r) => r.subs)

  const toggleStatus = async (m: Affiliate) => {
    if (!canEdit) return toast.error('Seu cargo não pode pausar gerentes.')
    const pausing = m.status === 'ativo'
    const ok = await confirm({
      title: pausing ? `Pausar ${m.name}?` : `Reativar ${m.name}?`,
      description: pausing
        ? 'A comissão de rede do gerente deixa de ser apurada a partir de agora e o link dele para de atribuir cadastros. Os subafiliados continuam ativos e recebendo.'
        : 'A comissão de rede volta a ser apurada a partir de agora e o link volta a atribuir cadastros.',
      confirmLabel: pausing ? 'Pausar gerente' : 'Reativar gerente',
      tone: pausing ? 'warning' : 'success',
      icon: pausing ? Pause : Play,
    })
    if (!ok) return
    update(m.id, { status: pausing ? 'pausado' : 'ativo' })
    audit(
      pausing ? 'desligar' : 'ligar',
      `Gerente ${m.name}`,
      pausing ? 'Gerente pausado no programa de afiliados' : 'Gerente reativado no programa de afiliados',
    )
    toast.success(pausing ? 'Gerente pausado' : 'Gerente reativado', { description: m.name })
  }

  const columns: Column<ManagerRow>[] = [
    {
      id: 'manager',
      header: 'Gerente',
      pinned: true,
      minWidth: 220,
      sortValue: (r) => r.manager.name,
      csv: (r) => r.manager.name,
      cell: (r) => <PersonCell name={r.manager.name} sub={maskEmail(r.manager.email)} />,
    },
    {
      id: 'contract',
      header: 'Contrato',
      minWidth: 170,
      sortValue: (r) => r.manager.revShare * 1000 + r.manager.cpa,
      csv: (r) => contractLabel(r.manager),
      cell: (r) => <ContractBadges a={r.manager} />,
    },
    {
      id: 'subs',
      header: 'Subafiliados',
      sortValue: (r) => r.subs.length,
      csv: (r) => r.subs.length,
      cell: (r) =>
        r.subs.length ? (
          <div className="flex items-center gap-2">
            <div className="flex -space-x-1" aria-hidden>
              {r.subs.slice(0, 3).map((s) => (
                <span key={s.id} className="rounded-full bg-surface ring-2 ring-surface">
                  <Avatar name={s.name} size={24} />
                </span>
              ))}
            </div>
            <span className="text-[13px] text-fg tnum">{num(r.subs.length)}</span>
          </div>
        ) : (
          <span className="text-xs text-fg-3">nenhum</span>
        ),
    },
    {
      id: 'referred',
      header: 'Indicados da rede',
      align: 'right',
      sortValue: (r) => r.referred,
      csv: (r) => r.referred,
      cell: (r) => (
        <div>
          <p>{num(r.referred)}</p>
          <p className="text-xs text-fg-3">{num(r.depositors)} depositaram</p>
        </div>
      ),
    },
    {
      id: 'balance', money: true,
      header: 'Saldo',
      align: 'right',
      sortValue: (r) => r.manager.balance,
      csv: (r) => r.manager.balance,
      cell: (r) => <span className="font-semibold">{brl(r.manager.balance)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (r) => r.manager.status,
      csv: (r) => (r.manager.status === 'ativo' ? 'Ativo' : 'Pausado'),
      cell: (r) => (
        <Badge tone={r.manager.status === 'ativo' ? 'success' : 'warning'} dot>
          {r.manager.status === 'ativo' ? 'Ativo' : 'Pausado'}
        </Badge>
      ),
    },
    {
      id: 'createdAt',
      header: 'Desde',
      defaultHidden: true,
      sortValue: (r) => r.manager.createdAt,
      csv: (r) => date(r.manager.createdAt),
      cell: (r) => <span className="text-[13px] text-fg-2">{date(r.manager.createdAt)}</span>,
    },
  ]

  const open = openId ? rows.find((r) => r.id === openId) : undefined
  const managerBalance = rows.reduce((s, r) => s + r.manager.balance, 0)

  return (
    <>
      <PageHeader
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)} disabled={!canEdit} title={lockedTitle}>
            Novo gerente
          </Button>
        }
      />

      <div className="space-y-5">
        <section aria-label="Resumo dos gerentes" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Gerentes ativos"
            icon={Crown}
            value={`${num(counts.ativo)} de ${num(counts.todos)}`}
            hint={counts.pausado ? `${num(counts.pausado)} pausados` : 'nenhum pausado'}
          />
          <KpiCard
            label="Subafiliados"
            icon={Network}
            tone="info"
            value={num(allSubs.length)}
            hint={`${num(allSubs.filter((a) => a.type === 'Influencer').length)} influencers · ${num(allSubs.filter((a) => a.type === 'Organic').length)} organic`}
          />
          <KpiCard
            label="Indicados pelas redes"
            icon={UserPlus}
            tone="success"
            value={num(rows.reduce((s, r) => s + r.referred, 0))}
            hint={`${num(rows.reduce((s, r) => s + r.depositors, 0))} depositaram`}
            formula={<>Jogadores cadastrados pelo link do gerente ou de qualquer subafiliado da rede dele.</>}
          />
          <KpiCard
            label="Saldo dos gerentes"
            icon={Wallet}
            tone="warning"
            value={brlCompact(managerBalance)}
            hint="comissão disponível para saque"
            formula={<>Soma do saldo de comissão dos gerentes. Vira pedido em Saques de afiliados quando o gerente solicita.</>}
          />
        </section>

        <DataTable
          caption="Gerentes de afiliados"
          className="relative"
          rows={visible}
          columns={columns}
          rowKey={(r) => r.id}
          searchText={(r) => `${r.manager.name} ${r.manager.email} ${r.manager.code}`}
          searchPlaceholder="Buscar por nome ou e-mail"
          initialSort={{ id: 'referred', dir: 'desc' }}
          exportName="gerentes-afiliados"
          onExport={(n) => audit('exportar', 'Gerentes de afiliados', `Exportação CSV de ${n} gerentes`)}
          onRowClick={(r) => setOpenId(r.id)}
          resetKey={status}
          rowActions={(r) => [
            { label: 'Ver rede e contrato', icon: Eye, onSelect: () => setOpenId(r.id) },
            { divider: true },
            r.manager.status === 'ativo'
              ? { label: 'Pausar gerente', icon: Pause, onSelect: () => toggleStatus(r.manager), disabled: !canEdit }
              : { label: 'Reativar gerente', icon: Play, onSelect: () => toggleStatus(r.manager), disabled: !canEdit },
          ]}
          toolbar={
            <ChipFilter<StatusFilter>
              value={status}
              onChange={setStatus}
              options={[
                { value: 'todos', label: 'Todos', count: counts.todos },
                { value: 'ativo', label: 'Ativos', count: counts.ativo },
                { value: 'pausado', label: 'Pausados', count: counts.pausado, tone: 'warning' },
              ]}
            />
          }
          empty={{
            icon: Crown,
            title: status === 'todos' ? 'Nenhum gerente cadastrado' : 'Nenhum gerente neste filtro',
            description: 'Gerentes recrutam subafiliados e recebem comissão sobre a rede.',
            action: canEdit ? (
              <Button size="sm" variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                Novo gerente
              </Button>
            ) : undefined,
          }}
        />
      </div>

      {creating && (
        <NewManagerDrawer
          affiliates={affiliates}
          onClose={() => setCreating(false)}
          onCreate={(d) => {
            const m = buildManager(d, affiliates)
            add(m)
            audit('criar', `Gerente ${m.name}`, `Contrato ${contractLabel(m)} · link ?ref=${m.code} · ${m.status === 'ativo' ? 'ativo' : 'pausado'}`)
            toast.success('Gerente criado', { description: `${m.name} já pode divulgar x2win.bet.br/?ref=${m.code}` })
            setCreating(false)
            setOpenId(m.id)
          }}
        />
      )}

      {open && (
        <ManagerDrawer
          row={open}
          canEdit={canEdit}
          onClose={() => setOpenId(null)}
          onToggle={() => toggleStatus(open.manager)}
          onSaveContract={(cpa, revSharePct) => {
            const before = contractLabel(open.manager)
            const next = { cpa: round2(cpa), revShare: round2(revSharePct) / 100 }
            update(open.id, next)
            audit('editar', `Contrato de ${open.manager.name}`, `${before} → ${contractLabel(next)}`)
            toast.success('Contrato atualizado', { description: `${contractLabel(next)}. Vale para o próximo fechamento.` })
          }}
        />
      )}
    </>
  )
}

function ContractBadges({ a }: { a: Pick<Affiliate, 'cpa' | 'revShare'> }) {
  if (a.cpa <= 0 && a.revShare <= 0) return <span className="text-xs text-fg-3">Sem comissão</span>
  return (
    <div className="flex flex-wrap gap-1">
      {a.cpa > 0 && <Badge tone="info">CPA {brl(a.cpa)}</Badge>}
      {a.revShare > 0 && <Badge tone="primary">Rev Share {pctLabel(round2(a.revShare * 100))}</Badge>}
    </div>
  )
}

function NewManagerDrawer({ affiliates, onClose, onCreate }: { affiliates: Affiliate[]; onClose: () => void; onCreate: (d: ManagerDraft) => void }) {
  const [d, setD] = useState<ManagerDraft>(EMPTY_DRAFT)
  const [touched, setTouched] = useState<Partial<Record<keyof ManagerErrors, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  const errors = validateManagerDraft(d, affiliates)
  const show = (k: keyof ManagerErrors) => ((submitted || touched[k]) && errors[k]) || null
  const set = <K extends keyof ManagerDraft>(k: K, v: ManagerDraft[K]) => setD((x) => ({ ...x, [k]: v }))
  const blur = (k: keyof ManagerErrors) => () => setTouched((t) => ({ ...t, [k]: true }))
  const code = d.name.trim()
    ? makeAffiliateCode(
        d.name,
        affiliates.map((a) => a.code),
      )
    : 'CODIGO'
  const exampleFtd = 20
  const exampleGgr = 10000
  const example = round2(exampleFtd * Math.max(0, d.cpa) + exampleGgr * (Math.max(0, d.revSharePct) / 100))

  const submit = () => {
    setSubmitted(true)
    if (Object.values(errors).some(Boolean)) {
      toast.error('Revise os campos', { description: Object.values(errors).find(Boolean) })
      return
    }
    onCreate(d)
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Novo gerente"
      description="O gerente recebe um link próprio e comissão sobre a rede de subafiliados."
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" icon={Plus} onClick={submit}>
            Criar gerente
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <FormGrid>
          <Field label="Nome completo" htmlFor="ng-name" required error={show('name')} className="sm:col-span-2">
            <Input
              id="ng-name"
              data-autofocus
              value={d.name}
              onChange={(e) => set('name', e.target.value)}
              onBlur={blur('name')}
              invalid={!!show('name')}
              placeholder="Ex.: Marina Costa"
              autoComplete="off"
            />
          </Field>
          <Field label="E-mail" htmlFor="ng-email" required error={show('email')} hint="Recebe o convite para o portal do afiliado." className="sm:col-span-2">
            <Input
              id="ng-email"
              type="email"
              value={d.email}
              onChange={(e) => set('email', e.target.value)}
              onBlur={blur('email')}
              invalid={!!show('email')}
              placeholder="nome@exemplo.com"
              autoComplete="off"
            />
          </Field>
          <Field label="CPA por FTD" htmlFor="ng-cpa" error={show('cpa')} hint="Valor fixo por jogador da rede que faz o primeiro depósito. R$ 0,00 = sem CPA.">
            <MoneyInput id="ng-cpa" value={d.cpa} onValueChange={(n) => set('cpa', n)} invalid={!!show('cpa')} />
          </Field>
          <Field label="Rev Share da rede" htmlFor="ng-rs" error={show('revSharePct')} hint={`Sobre o GGR positivo da rede. Até ${MAX_REVSHARE_PCT}%.`}>
            <NumberInput
              id="ng-rs"
              value={d.revSharePct}
              onValueChange={(n) => set('revSharePct', n)}
              min={0}
              max={MAX_REVSHARE_PCT}
              step={0.5}
              suffix="%"
              invalid={!!show('revSharePct')}
            />
          </Field>
        </FormGrid>
        <Field label="Status inicial">
          <RadioCards<'ativo' | 'pausado'>
            name="Status inicial"
            value={d.status}
            onChange={(v) => set('status', v)}
            options={[
              { value: 'ativo', label: 'Ativo', icon: Play, description: 'O link já atribui cadastros e a comissão começa hoje.' },
              { value: 'pausado', label: 'Pausado', icon: Pause, description: 'Cadastra agora e ativa depois, quando o contrato for assinado.' },
            ]}
          />
        </Field>

        <section className="rounded-xl border border-line bg-surface-2 p-4" aria-live="polite">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">Prévia</p>
          <div className="mt-2 flex items-center gap-3">
            <Avatar name={d.name.trim() || 'Novo gerente'} size={36} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-fg">{d.name.trim() || 'Novo gerente'}</p>
              <p className="truncate font-mono text-xs text-fg-3">x2win.bet.br/?ref={code}</p>
            </div>
            <Badge tone={d.status === 'ativo' ? 'success' : 'warning'} dot className="ml-auto">
              {d.status === 'ativo' ? 'Ativo' : 'Pausado'}
            </Badge>
          </div>
          <div className="mt-3 border-t border-line pt-3 text-[13px] text-fg-2">
            <p>
              Contrato: <strong className="text-fg">{contractLabel({ cpa: Math.max(0, d.cpa), revShare: Math.max(0, d.revSharePct) / 100 })}</strong>
            </p>
            <p className="mt-1 text-fg-3">
              Com {exampleFtd} FTD e {brl(exampleGgr)} de GGR na rede no mês, recebe <strong className="text-fg tnum">{brl(example)}</strong>.
            </p>
          </div>
        </section>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Drawer>
  )
}

function ManagerDrawer({
  row,
  canEdit,
  onClose,
  onToggle,
  onSaveContract,
}: {
  row: ManagerRow
  canEdit: boolean
  onClose: () => void
  onToggle: () => void
  onSaveContract: (cpa: number, revSharePct: number) => void
}) {
  const m = row.manager
  const { can } = useSession()
  const [editing, setEditing] = useState(false)
  const [c, setC] = useState({ cpa: m.cpa, revSharePct: round2(m.revShare * 100) })
  const errors = validateContract(c)
  const changed = c.cpa !== m.cpa || c.revSharePct !== round2(m.revShare * 100)
  const url = referralLink(m.code)

  const startEdit = () => {
    setC({ cpa: m.cpa, revSharePct: round2(m.revShare * 100) })
    setEditing(true)
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={m.name}
      description={`Gerente desde ${date(m.createdAt)} · ${maskEmail(m.email)}`}
      headerExtra={
        <Badge tone={m.status === 'ativo' ? 'success' : 'warning'} dot size="md">
          {m.status === 'ativo' ? 'Ativo' : 'Pausado'}
        </Badge>
      }
      footer={
        <>
          <PageLink to="/system/programa-afiliados/visao-geral" className="link mr-auto self-center text-[13px]">
            Ver resultado da rede
          </PageLink>
          {m.status === 'ativo' ? (
            <Button icon={Pause} onClick={onToggle} disabled={!canEdit} title={canEdit ? undefined : 'Seu cargo não pode pausar gerentes'}>
              Pausar gerente
            </Button>
          ) : (
            <Button variant="success" icon={Play} onClick={onToggle} disabled={!canEdit}>
              Reativar gerente
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Saldo de comissão" value={brl(m.balance)} />
          <StatTile label="Subafiliados" value={num(row.subs.length)} />
          <StatTile label="Indicados da rede" value={num(row.referred)} />
          <StatTile label="Depositaram" value={num(row.depositors)} />
        </div>

        {m.status === 'pausado' && (
          <Alert tone="warning" title="Gerente pausado">
            A comissão de rede não está sendo apurada e o link dele não atribui novos cadastros.
          </Alert>
        )}

        <section>
          <h3 className="mb-2 text-sm font-semibold text-fg">Link do gerente</h3>
          <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
            <Mono className="min-w-0 flex-1 break-all text-fg">{url}</Mono>
            <CopyButton value={url} label="Copiar link do gerente" />
          </div>
        </section>

        <AffiliateContact key={m.id} affiliate={m} canReveal={can(REVEAL_PAYOUT_PERMISSION)} />

        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <HandCoins size={15} className="text-fg-3" aria-hidden /> Contrato
            </h3>
            {!editing && (
              <Button size="sm" icon={Pencil} onClick={startEdit} disabled={!canEdit} title={canEdit ? undefined : 'Seu cargo não pode editar contratos'}>
                Editar contrato
              </Button>
            )}
          </div>
          {editing ? (
            <div className="space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <FormGrid>
                <Field label="CPA por FTD" htmlFor="mc-cpa" error={errors.cpa ?? null}>
                  <MoneyInput id="mc-cpa" value={c.cpa} onValueChange={(n) => setC((x) => ({ ...x, cpa: n }))} invalid={!!errors.cpa} />
                </Field>
                <Field label="Rev Share da rede" htmlFor="mc-rs" error={errors.revSharePct ?? null} hint={`Até ${MAX_REVSHARE_PCT}%.`}>
                  <NumberInput
                    id="mc-rs"
                    value={c.revSharePct}
                    onValueChange={(n) => setC((x) => ({ ...x, revSharePct: n }))}
                    min={0}
                    max={MAX_REVSHARE_PCT}
                    step={0.5}
                    suffix="%"
                    invalid={!!errors.revSharePct}
                  />
                </Field>
              </FormGrid>
              <p className="text-[13px] text-fg-3">
                De <strong className="text-fg-2">{contractLabel(m)}</strong> para{' '}
                <strong className="text-fg">{contractLabel({ cpa: Math.max(0, c.cpa), revShare: Math.max(0, c.revSharePct) / 100 })}</strong>. Vale a partir do
                próximo fechamento.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" icon={X} onClick={() => setEditing(false)}>
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  icon={Save}
                  disabled={!changed || !!errors.cpa || !!errors.revSharePct}
                  onClick={() => {
                    onSaveContract(c.cpa, c.revSharePct)
                    setEditing(false)
                  }}
                >
                  Salvar contrato
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-3">
              <ContractBadges a={m} />
              <span className="text-xs text-fg-3">sobre FTD e GGR de toda a rede</span>
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
            <Users size={15} className="text-fg-3" aria-hidden /> Subafiliados <Badge tone="neutral">{row.subs.length}</Badge>
          </h3>
          {row.subs.length ? (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {[...row.subs]
                .sort((a, b) => b.balance - a.balance)
                .map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                    <Avatar name={s.name} size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-fg">
                        <span className="truncate">{s.name}</span>
                        <AffiliateTypeBadge type={s.type} />
                        {s.status === 'pausado' && <Badge tone="warning">pausado</Badge>}
                      </p>
                      <p className="truncate font-mono text-[11.5px] text-fg-3">?ref={s.code}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[13px] font-semibold text-fg tnum">{brl(s.balance)}</p>
                      <p className="text-[11px] text-fg-3">desde {relative(s.createdAt)}</p>
                    </div>
                  </li>
                ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-line-strong">
              <EmptyState
                icon={Network}
                title="Nenhum subafiliado ainda"
                description="Quando o gerente convidar afiliados pelo portal, eles aparecem aqui ligados à rede dele."
                className="py-8"
              />
            </div>
          )}
        </section>
      </div>
    </Drawer>
  )
}
