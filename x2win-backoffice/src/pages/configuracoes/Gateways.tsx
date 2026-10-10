import { useMemo, useState } from 'react'
import {
  Activity,
  ArrowUpFromLine,
  CreditCard,
  Gauge,
  HeartPulse,
  KeyRound,
  ListOrdered,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Scale,
  ShieldCheck,
  Split,
  Timer,
  Trash2,
  TriangleAlert,
  Webhook,
} from 'lucide-react'
import { TrendChart } from '@/components/charts'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  Field,
  FormFieldset,
  IconButton,
  Input,
  KpiCard,
  Menu,
  Modal,
  Mono,
  NoDataSource,
  NumberInput,
  PageHeader,
  SaveBar,
  SecretField,
  Segmented,
  Select,
  SettingsSection,
  SortableList,
  Switch,
  Tabs,
  confirm,
  confirmWithInput,
  secretFieldError,
  toast,
  useSettingsForm,
  useTabParam,
  type Tone,
} from '@/components/ui'
import { dateTime, hasMaskChars, maskSecret, num, pct, plural, relative, time } from '@/lib/format'
import { cn } from '@/lib/cn'
import { ApiError, isApiMode } from '@/lib/api'
import { useCollection, useDb } from '@/lib/store'
import { uid } from '@/lib/random'
import { DEFAULT_ROUTING, GATEWAY_KEYS, seedGatewayAccounts, seedGateways } from '@/data/config2-gateways'
import { audit, usePageAccess, useSession } from '@/domain/session'
import {
  CALLBACK_BASE,
  accountLabel,
  callbackUrlFor,
  distributeEvenly,
  isRoutable,
  normalizeFallback,
  routableAccounts,
  routingBlockers,
  routingTotal,
  simulateHealth,
  validateAccount,
  validateRouting,
  type AccountHealth,
  type Gateway,
  type GatewayAccount,
  type HealthStatus,
  type RoutingConfig,
} from '@/domain/config2-gateways'
import { MiniStat, PlatformMark, errorTarget, isDestinationChangedError, saveKeyDirect } from './_shared-g'

type Tab = 'credenciais' | 'roteamento' | 'saude'

/**
 * Modo API: os segredos chegam mascarados e a gravação mantém o segredo salvo quando recebe a máscara. Se o
 * destino da credencial mudar (Client ID, ambiente, callback) com o segredo ainda mascarado, o servidor recusa
 * (400 "O destino desta credencial mudou"): a tela pede os segredos de novo antes de salvar e mostra o erro
 * junto do campo. config.gateways só é lida por quem vê ou edita Gateways.
 */
const API = isApiMode()

/** Troca de Client ID do cadastro esperando os segredos novos (modo API). */
interface PendingCredential {
  clientId: string
  secret: string
  webhookSecret: string
}

const DEST_CHANGED = 'O destino desta credencial mudou: digite o segredo de novo.'

function conflictToast() {
  toast.warning('Outra pessoa alterou estes dados', { description: 'Carregamos a versão mais recente. Confira e faça a sua alteração de novo.', duration: 6000 })
}

const GW_SLOT: Record<string, 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8> = { pagflex: 7, pixnow: 3, brpay: 2 }
const ACCOUNT_SLOTS: (1 | 2 | 3 | 4 | 5 | 6 | 7 | 8)[] = [1, 3, 4, 2, 5, 7, 6, 8]

function useGatewayData() {
  const gateways = useCollection<Gateway>(GATEWAY_KEYS.gateways, seedGateways)
  const accounts = useCollection<GatewayAccount>(GATEWAY_KEYS.accounts, seedGatewayAccounts)
  const [routing, setRouting] = useDb<RoutingConfig>(GATEWAY_KEYS.routing, DEFAULT_ROUTING)
  return { gateways, accounts, routing, setRouting }
}

export default function Gateways() {
  const [tab, setTab] = useTabParam<Tab>('credenciais', ['credenciais', 'roteamento', 'saude'])
  const { gateways, accounts } = useGatewayData()
  const primary = gateways.items.find((g) => g.primary)
  const active = routableAccounts(accounts.items, gateways.items)
  return (
    <>
      <PageHeader
        actions={
          primary && (
            <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] text-fg-2">
              <CreditCard size={15} className="text-fg-3" aria-hidden />
              Principal: <strong className="text-fg">{primary.name}</strong>
              <Badge tone="success">{plural(active.length, 'conta ativa', 'contas ativas')}</Badge>
            </span>
          )
        }
      >
        <Tabs<Tab>
          className="mt-5"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'credenciais', label: 'Credenciais', icon: KeyRound, count: accounts.items.length },
            { value: 'roteamento', label: 'Roteamento', icon: Route },
            { value: 'saude', label: 'Saúde', icon: HeartPulse },
          ]}
        />
      </PageHeader>
      {tab === 'credenciais' ? <Credentials goRouting={() => setTab('roteamento')} /> : tab === 'roteamento' ? <Routing /> : <Health />}
    </>
  )
}

// ---------- Credenciais ----------

function Credentials({ goRouting }: { goRouting: () => void }) {
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  const { gateways, accounts, routing, setRouting } = useGatewayData()
  const [editing, setEditing] = useState<{ gateway: Gateway; account: GatewayAccount | null } | null>(null)
  // modo API: Client ID trocado esperando os segredos novos, por gateway; erro do servidor por gateway
  const [pending, setPending] = useState<Record<string, PendingCredential>>({})
  const [credError, setCredError] = useState<Record<string, string>>({})
  const [savingCred, setSavingCred] = useState<string | null>(null)

  const setPend = (id: string, p: PendingCredential | null) =>
    setPending((prev) => {
      const next = { ...prev }
      if (p) next[id] = p
      else delete next[id]
      return next
    })
  /** segredo do cadastro que precisa ser digitado de novo (destino mudou com a máscara salva) */
  const needsNew = (g: Gateway, field: 'secret' | 'webhookSecret') => !!pending[g.id] && hasMaskChars(g[field])
  const pendingErrors = (g: Gateway) => {
    const p = pending[g.id]
    if (!p) return []
    return (['secret', 'webhookSecret'] as const)
      .map((f) => secretFieldError(p[f] || g[f], { requireNew: needsNew(g, f), saved: g[f] }))
      .filter((x): x is string => !!x)
  }

  const saveCredential = async (g: Gateway) => {
    const p = pending[g.id]
    if (!p || savingCred) return
    const errs = pendingErrors(g)
    if (errs.length) {
      toast.error('Digite os segredos de novo', { description: errs[0] })
      return
    }
    setSavingCred(g.id)
    setCredError((e) => ({ ...e, [g.id]: '' }))
    const now = new Date().toISOString()
    const next = gateways.items.map((x) =>
      x.id === g.id ? { ...x, clientId: p.clientId, secret: p.secret || x.secret, webhookSecret: p.webhookSecret || x.webhookSecret, updatedAt: now, updatedBy: user.name } : x,
    )
    const r = await saveKeyDirect<Gateway[]>(GATEWAY_KEYS.gateways, gateways.items, next)
    setSavingCred(null)
    if (r.ok) {
      setPend(g.id, null)
      audit('editar', `Gateway ${g.name}`, 'Client ID do cadastro alterado; segredos substituídos')
      toast.success('Cadastro salvo', { description: 'Client ID e segredos novos já valem para a conta principal.' })
      return
    }
    if (r.conflict) return conflictToast()
    if (isDestinationChangedError(r.error)) setCredError((e) => ({ ...e, [g.id]: r.error!.message }))
    toast.error('Cadastro não salvo', { description: r.error?.message ?? 'Erro inesperado ao falar com o servidor. Tente de novo.', duration: 6000 })
  }

  /** Modo API: grava a conta pela API e devolve o erro para o modal mostrar junto do campo. */
  const saveAccount = async (a: GatewayAccount, isNew: boolean): Promise<{ ok: boolean; error?: ApiError | null }> => {
    if (!API) {
      if (isNew) accounts.add(a, 'end')
      else accounts.update(a.id, a)
      return { ok: true }
    }
    const next = isNew ? [...accounts.items, a] : accounts.items.map((x) => (x.id === a.id ? a : x))
    const r = await saveKeyDirect<GatewayAccount[]>(GATEWAY_KEYS.accounts, accounts.items, next)
    if (r.ok) return { ok: true }
    if (r.conflict) {
      conflictToast()
      return { ok: false, error: null }
    }
    return { ok: false, error: r.error }
  }

  const blockedToast = (what: string, reasons: string[]) =>
    toast.error(`Não dá para ${what} agora`, {
      description: `Ela ${reasons.join(' e ')}. Ajuste o roteamento antes.`,
      action: { label: 'Abrir roteamento', onClick: goRouting },
    })

  const toggleGateway = async (g: Gateway, on: boolean) => {
    if (!on) {
      const ids = accounts.items.filter((a) => a.gatewayId === g.id).map((a) => a.id)
      const reasons = routingBlockers(routing, ids)
      if (reasons.length) {
        toast.error(`Não dá para desligar ${g.name} agora`, {
          description: `Contas dele ${reasons.join(' e ')}. Tire do roteamento antes.`,
          action: { label: 'Abrir roteamento', onClick: goRouting },
        })
        return
      }
      const ok = await confirm({
        title: `Desligar ${g.name}?`,
        description: 'Nenhuma conta deste gateway recebe depósitos ou paga saques enquanto estiver desligado. Callbacks de cobranças antigas continuam sendo aceitos.',
        confirmLabel: 'Desligar gateway',
        tone: 'danger',
      })
      if (!ok) return
    }
    gateways.update(g.id, { active: on, updatedAt: new Date().toISOString(), updatedBy: user.name })
    audit(on ? 'ligar' : 'desligar', `Gateway ${g.name}`, on ? 'Gateway ligado' : 'Gateway desligado')
    toast.success(on ? `${g.name} ligado` : `${g.name} desligado`, { description: on ? 'As contas ativas dele podem entrar no roteamento.' : undefined })
  }

  const replaceSecret = (g: Gateway, field: 'secret' | 'webhookSecret', value: string) => {
    // Client ID trocado esperando os segredos: o segredo novo entra no mesmo salvamento
    if (pending[g.id]) {
      setPend(g.id, { ...pending[g.id], [field]: value })
      setCredError((e) => ({ ...e, [g.id]: '' }))
      return
    }
    gateways.update(g.id, { [field]: value, updatedAt: new Date().toISOString(), updatedBy: user.name })
    audit('editar', `Gateway ${g.name}`, field === 'secret' ? 'Segredo do cadastro substituído' : 'Segredo do webhook substituído')
    toast.success('Segredo substituído', { description: 'O valor novo foi cifrado e já vale para a conta principal.' })
  }

  const editClientId = async (g: Gateway) => {
    const r = await confirmWithInput({
      title: `Client ID do ${g.name}`,
      description: 'Usado pela conta principal. Confira no painel do gateway antes de trocar.',
      confirmLabel: 'Salvar Client ID',
      input: { label: 'Client ID', required: true, defaultValue: g.clientId },
    })
    if (!r.confirmed || r.value === g.clientId) return
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(r.value)) {
      toast.error('Client ID inválido', { description: 'Use de 6 a 64 letras, números, hífen ou sublinhado.' })
      return
    }
    // modo API: com os segredos mascarados, o Client ID novo só é salvo junto com os segredos digitados de novo
    if (API && (hasMaskChars(g.secret) || hasMaskChars(g.webhookSecret))) {
      setPend(g.id, { clientId: r.value, secret: '', webhookSecret: '' })
      toast.info('Digite os segredos de novo', { description: 'O Client ID mudou: o segredo e o segredo do webhook precisam ser informados de novo para salvar.' })
      return
    }
    gateways.update(g.id, { clientId: r.value, updatedAt: new Date().toISOString(), updatedBy: user.name })
    audit('editar', `Gateway ${g.name}`, `Client ID do cadastro alterado`)
    toast.success('Client ID salvo')
  }

  const toggleAccount = async (g: Gateway, a: GatewayAccount, on: boolean) => {
    if (!on) {
      const reasons = routingBlockers(routing, [a.id])
      if (reasons.length) return blockedToast('desativar a conta', reasons)
      const ok = await confirm({ title: `Desativar "${a.name}" do ${g.name}?`, description: 'A conta para de gerar cobranças novas. PIX já gerados continuam sendo confirmados pelo callback.', confirmLabel: 'Desativar conta', tone: 'warning' })
      if (!ok) return
    }
    accounts.update(a.id, { active: on })
    audit(on ? 'ligar' : 'desligar', `Conta ${accountLabel(a, gateways.items)}`, on ? 'Conta de pagamento ativada' : 'Conta de pagamento desativada')
    toast.success(on ? 'Conta ativada' : 'Conta desativada', { description: on ? 'Ela só recebe depósitos depois de ganhar um percentual no roteamento.' : undefined })
  }

  const removeAccount = async (g: Gateway, a: GatewayAccount) => {
    if (a.main) return
    const reasons = routingBlockers(routing, [a.id])
    if (reasons.length) return blockedToast('remover a conta', reasons)
    const ok = await confirm({
      title: `Remover "${a.name}"?`,
      description: 'A credencial cifrada é apagada e o endereço de callback deixa de existir. Cobranças antigas desta conta não serão mais confirmadas automaticamente.',
      confirmLabel: 'Remover conta',
      tone: 'danger',
      icon: Trash2,
      typeToConfirm: 'REMOVER',
    })
    if (!ok) return
    accounts.remove(a.id)
    setRouting((r) => {
      const deposits = { ...r.deposits }
      delete deposits[a.id]
      return { ...r, deposits, fallback: r.fallback.filter((id) => id !== a.id) }
    })
    audit('excluir', `Conta ${g.name} · ${a.name}`, 'Conta de pagamento removida (credencial e callback apagados)')
    toast.success('Conta removida')
  }

  return (
    <div className="space-y-5">
      <Alert tone="info" icon={ShieldCheck} title="Como as credenciais funcionam">
        A <strong>conta principal</strong> de cada gateway usa a credencial do cadastro do gateway. As <strong>contas extras</strong> têm credencial e URL de callback próprias. Os
        segredos são cifrados no servidor e nunca aparecem de novo: só dá para substituir.
      </Alert>

      {gateways.items.map((g) => {
        const list = accounts.items.filter((a) => a.gatewayId === g.id)
        const pend = pending[g.id]
        const shownClientId = pend?.clientId ?? g.clientId
        return (
          <Card key={g.id} className={cn('min-w-0', !g.active && 'bg-surface-2/50')}>
            <div className="flex flex-wrap items-start gap-3 px-5 pb-3 pt-4">
              <PlatformMark letter={g.name[0]} slot={GW_SLOT[g.id] ?? 1} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[15px] font-semibold text-fg">{g.name}</h2>
                  {g.primary && <Badge tone="primary">Principal</Badge>}
                  <Badge tone={g.active ? 'success' : 'neutral'} dot>
                    {g.active ? 'Ligado' : 'Desligado'}
                  </Badge>
                  <Badge>{g.environment === 'producao' ? 'Produção' : 'Sandbox'}</Badge>
                  {!g.clientId && <Badge tone="warning">Não configurado</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-fg-3">
                  {plural(list.length, 'conta', 'contas')}
                  {/* modo API sem nada gravado: cadastro ainda sem autor */}
                  {g.updatedBy && ` · cadastro alterado ${relative(g.updatedAt)} por ${g.updatedBy}`}
                </p>
              </div>
              <Switch checked={g.active} onChange={(on) => toggleGateway(g, on)} disabled={!canEdit} ariaLabel={`Ligar gateway ${g.name}`} />
            </div>

            <CardBody className="space-y-4">
              <div className="grid gap-4 rounded-xl border border-line p-4 md:grid-cols-2">
                <div className="md:col-span-2 flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold text-fg">Cadastro do gateway</p>
                  <span className="text-xs text-fg-3">usado pela conta principal</span>
                </div>
                <Field label="Client ID" hint={pend ? `${g.clientId ? `Antes: ${g.clientId}. ` : ''}Ainda não salvo.` : undefined}>
                  <div className="flex gap-2">
                    <div className={cn('input-base flex min-w-0 items-center bg-surface-2', pend && 'border-warning')}>
                      {shownClientId ? <Mono className="truncate text-fg">{shownClientId}</Mono> : <span className="text-[13px] text-fg-3">Não configurado</span>}
                    </div>
                    <Button icon={Pencil} onClick={() => editClientId({ ...g, clientId: shownClientId })} disabled={!canEdit || !!pend}>
                      Trocar
                    </Button>
                  </div>
                </Field>
                <SecretField
                  label="Segredo (client secret)"
                  value={pend?.secret || g.secret}
                  saved={g.secret}
                  requireNew={needsNew(g, 'secret')}
                  error={credError[g.id] || null}
                  disabled={!canEdit}
                  onChange={(v) => replaceSecret(g, 'secret', v)}
                />
                <SecretField
                  label="Segredo do webhook"
                  value={pend?.webhookSecret || g.webhookSecret}
                  saved={g.webhookSecret}
                  requireNew={needsNew(g, 'webhookSecret')}
                  error={credError[g.id] || null}
                  disabled={!canEdit}
                  onChange={(v) => replaceSecret(g, 'webhookSecret', v)}
                  hint="Valida a assinatura dos callbacks. Cifrado no servidor."
                />
                {pend && (
                  <div className="md:col-span-2 flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[13px] text-fg-2">Client ID trocado. Digite o segredo e o segredo do webhook de novo para salvar o cadastro.</p>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setPend(g.id, null)
                          setCredError((e) => ({ ...e, [g.id]: '' }))
                        }}
                      >
                        Descartar
                      </Button>
                      <Button size="sm" variant="primary" onClick={() => saveCredential(g)} loading={savingCred === g.id} disabled={!canEdit || pendingErrors(g).length > 0}>
                        Salvar cadastro
                      </Button>
                    </div>
                  </div>
                )}
                <Field label="Callback da conta principal" hint="Cadastre este endereço no painel do gateway.">
                  <div className="flex items-center gap-1 rounded-lg border border-line bg-surface-2 py-1 pl-3 pr-1">
                    <Mono className="min-w-0 flex-1 truncate text-left [direction:rtl]">{callbackUrlFor(g.id, '', true)}</Mono>
                    <CopyButton value={callbackUrlFor(g.id, '', true)} label="Copiar callback" />
                  </div>
                </Field>
              </div>

              <ul className="divide-y divide-line rounded-xl border border-line">
                {list.map((a) => {
                  const pctDep = routing.deposits[a.id] ?? 0
                  const pays = routing.withdrawalAccountId === a.id
                  return (
                    <li key={a.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-fg">
                          {a.name}
                          {a.main ? <Badge tone="primary">Conta principal</Badge> : <Badge>Conta extra</Badge>}
                          {!a.active && <Badge tone="neutral" dot>Inativa</Badge>}
                          {isRoutable(a, gateways.items) && pctDep > 0 && <Badge tone="info" icon={Split}>{pctDep}% dos depósitos</Badge>}
                          {pays && <Badge tone="warning" icon={ArrowUpFromLine}>paga saques</Badge>}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-fg-3">
                          {a.main ? (
                            'Usa a credencial do cadastro do gateway'
                          ) : (
                            <>
                              Credencial própria · <span className="font-mono">{a.clientId}</span> · segredo <span className="font-mono">{maskSecret(a.secret)}</span>
                            </>
                          )}
                          {' · '}
                          {a.holder || 'titular não informado'}
                        </p>
                      </div>
                      <div className="flex min-w-0 items-center gap-1 rounded-lg border border-line bg-surface-2 py-0.5 pl-2.5 pr-0.5 lg:w-[260px]">
                        <Webhook size={13} className="shrink-0 text-fg-3" aria-hidden />
                        <Mono className="min-w-0 flex-1 truncate text-[11.5px]">
                          <span title={a.callbackUrl}>…/{a.callbackUrl.replace(CALLBACK_BASE + '/', '')}</span>
                        </Mono>
                        <CopyButton value={a.callbackUrl} label={`Copiar callback de ${a.name}`} />
                      </div>
                      <div className="flex items-center gap-1">
                        <Switch size="sm" checked={a.active} onChange={(on) => toggleAccount(g, a, on)} disabled={!canEdit} ariaLabel={`Conta ${a.name} ativa`} />
                        <Menu
                          trigger={(p) => <IconButton {...p} icon={MoreHorizontal} label={`Ações da conta ${a.name}`} size="sm" />}
                          items={[
                            { label: 'Editar conta', icon: Pencil, disabled: !canEdit, onSelect: () => setEditing({ gateway: g, account: a }) },
                            { divider: true },
                            { label: a.main ? 'Remover (principal não sai)' : 'Remover conta', icon: Trash2, danger: true, disabled: !canEdit || a.main, onSelect: () => removeAccount(g, a) },
                          ]}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
              <Button size="sm" icon={Plus} onClick={() => setEditing({ gateway: g, account: null })} disabled={!canEdit} title={!canEdit ? 'Seu cargo não edita gateways' : undefined}>
                Adicionar conta ao {g.name}
              </Button>
            </CardBody>
          </Card>
        )
      })}

      {editing && <AccountModal gateway={editing.gateway} account={editing.account} siblings={accounts.items.filter((a) => a.gatewayId === editing.gateway.id)} onClose={() => setEditing(null)} onSave={saveAccount} />}
    </div>
  )
}

function AccountModal({
  gateway,
  account,
  siblings,
  onClose,
  onSave,
}: {
  gateway: Gateway
  account: GatewayAccount | null
  siblings: GatewayAccount[]
  onClose: () => void
  onSave: (a: GatewayAccount, isNew: boolean) => Promise<{ ok: boolean; error?: ApiError | null }>
}) {
  const isNew = !account
  const [id] = useState(() => account?.id ?? uid(`ga-${gateway.id.slice(0, 2)}-`))
  const main = !!account?.main
  const [draft, setDraft] = useState({ name: account?.name ?? '', clientId: account?.clientId ?? '', secret: '', holder: account?.holder ?? (isApiMode() ? '' : 'X2Win Entretenimento Digital Ltda.'), active: account?.active ?? true })
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverSecretError, setServerSecretError] = useState<string | null>(null)
  // modo API: Client ID trocado com o segredo salvo mascarado → o segredo precisa ser digitado de novo
  const requireNew = API && !isNew && !main && !!account && hasMaskChars(account.secret) && draft.clientId.trim() !== account.clientId
  const secretRule = !isNew && !main && account ? secretFieldError(draft.secret.trim() || account.secret, { requireNew, saved: account.secret }) : null
  const errors: Record<string, string> = { ...validateAccount(draft, { isNew, main, siblings, ignoreId: account?.id }) }
  if (!errors.secret && secretRule) errors.secret = secretRule
  const callback = account?.callbackUrl ?? callbackUrlFor(gateway.id, id, false)
  const save = async () => {
    setTouched(true)
    if (Object.keys(errors).length || saving) return
    const next: GatewayAccount = {
      id,
      gatewayId: gateway.id,
      name: draft.name.trim(),
      main,
      active: draft.active,
      clientId: main ? '' : draft.clientId.trim(),
      secret: main ? '' : draft.secret.trim() || account?.secret || '',
      callbackUrl: callback,
      createdAt: account?.createdAt ?? new Date().toISOString(),
      holder: draft.holder.trim(),
    }
    setSaving(true)
    setServerSecretError(null)
    const r = await onSave(next, isNew)
    setSaving(false)
    if (!r.ok) {
      // o destino mudou com o segredo mascarado: o erro fica junto do campo do segredo
      if (isDestinationChangedError(r.error ?? null) || errorTarget(r.error ?? null).field === 'secret') setServerSecretError(r.error!.message)
      if (r.error) toast.error(isNew ? 'Conta não adicionada' : 'Conta não salva', { description: r.error.message, duration: 6000 })
      return
    }
    const parts = [isNew ? 'Conta extra criada com credencial própria' : 'Conta editada']
    if (!isNew && draft.secret) parts.push('segredo substituído')
    audit(isNew ? 'criar' : 'editar', `Conta ${gateway.name} · ${next.name}`, parts.join('; '))
    toast.success(isNew ? 'Conta adicionada' : 'Conta salva', { description: isNew ? 'Cadastre o callback no painel do gateway e defina o percentual em Roteamento.' : undefined })
    onClose()
  }
  const e = (k: string) => (touched ? errors[k] ?? null : null)
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={KeyRound}
      title={isNew ? `Nova conta no ${gateway.name}` : `Editar ${account?.name}`}
      description={main ? 'A conta principal usa a credencial do cadastro do gateway.' : 'Contas extras têm credencial e endereço de callback próprios.'}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} loading={saving}>
            {isNew ? 'Adicionar conta' : 'Salvar conta'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(ev) => {
          ev.preventDefault()
          save()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome da conta" htmlFor="acc-name" required error={e('name')}>
            <Input id="acc-name" data-autofocus value={draft.name} invalid={!!e('name')} placeholder="Conta 4 (afiliados)" onChange={(x) => setDraft((d) => ({ ...d, name: x.target.value }))} />
          </Field>
          <Field label="Titular (recebedor)" htmlFor="acc-holder">
            <Input id="acc-holder" value={draft.holder} onChange={(x) => setDraft((d) => ({ ...d, holder: x.target.value }))} />
          </Field>
        </div>
        {main ? (
          <Alert tone="info">A credencial desta conta é a do cadastro do {gateway.name}. Para trocar, use "Trocar" e "Substituir" no cartão do gateway.</Alert>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client ID da conta" htmlFor="acc-client" required error={e('clientId')}>
              <Input
                id="acc-client"
                value={draft.clientId}
                invalid={!!e('clientId')}
                className="font-mono"
                autoComplete="off"
                onChange={(x) => {
                  setServerSecretError(null)
                  setDraft((d) => ({ ...d, clientId: x.target.value }))
                }}
              />
            </Field>
            <Field
              label={isNew ? 'Segredo da conta' : 'Novo segredo'}
              htmlFor="acc-secret"
              required={isNew || requireNew}
              error={serverSecretError ?? (requireNew && !draft.secret.trim() ? DEST_CHANGED : e('secret'))}
              hint={
                isNew
                  ? 'Cifrado ao salvar. Não aparece de novo.'
                  : requireNew
                    ? 'O Client ID mudou: o segredo atual não vale mais para esta conta.'
                    : `Atual: ${API ? account?.secret ?? '' : maskSecret(account?.secret ?? '')}. Deixe em branco para manter.`
              }
            >
              <Input
                id="acc-secret"
                type="password"
                autoComplete="new-password"
                value={draft.secret}
                invalid={!!serverSecretError || !!e('secret') || (requireNew && !draft.secret.trim())}
                placeholder={isApiMode() ? 'Segredo da conta' : 'DEMO-...'}
                onChange={(x) => {
                  setServerSecretError(null)
                  setDraft((d) => ({ ...d, secret: x.target.value }))
                }}
              />
            </Field>
          </div>
        )}
        <Field label="Endereço de callback" hint={main ? 'O mesmo do cadastro do gateway.' : 'Exclusivo desta conta. Cadastre no painel do gateway.'}>
          <div className="flex items-center gap-1 rounded-lg border border-line bg-surface-2 py-1 pl-3 pr-1">
            <Mono className="min-w-0 flex-1 truncate text-left [direction:rtl]">{callback}</Mono>
            <CopyButton value={callback} label="Copiar callback" />
          </div>
        </Field>
        {isNew && <Switch label="Conta ativa" description="Ativa, ela pode receber depósitos assim que tiver um percentual no roteamento." checked={draft.active} onChange={(on) => setDraft((d) => ({ ...d, active: on }))} />}
      </form>
    </Modal>
  )
}

// ---------- Roteamento ----------

function Routing() {
  const { gateways, accounts } = useGatewayData()
  const active = routableAccounts(accounts.items, gateways.items)
  const form = useSettingsForm<RoutingConfig>(GATEWAY_KEYS.routing, DEFAULT_ROUTING, {
    entity: 'Roteamento de gateways',
    successMessage: 'Roteamento salvo',
    validate: (r) => validateRouting(r, accounts.items, gateways.items),
  })
  const v = form.values
  const total = routingTotal(v, active)
  const fallback = normalizeFallback(v.fallback, active)
  const label = (a: GatewayAccount) => accountLabel(a, gateways.items)
  const slotOf = (id: string) => ACCOUNT_SLOTS[Math.max(0, accounts.items.findIndex((a) => a.id === id)) % ACCOUNT_SLOTS.length]
  const orphan = Object.entries(v.deposits).filter(([id, p]) => p > 0 && !active.some((a) => a.id === id))
  const setPct = (id: string, n: number) => form.set('deposits', { ...v.deposits, [id]: Math.max(0, Math.min(100, Math.round(n))) })
  const mainId = active.find((a) => a.main && gateways.items.find((g) => g.id === a.gatewayId)?.primary)?.id ?? active[0]?.id

  return (
    <div className="space-y-5">
      {orphan.length > 0 && (
        <Alert tone="warning" title="Há percentual em contas inativas">
          {orphan.map(([id, p]) => `${accounts.items.find((a) => a.id === id)?.name ?? id}: ${p}%`).join(' · ')}. Essas contas não recebem depósitos; redistribua entre as ativas.
        </Alert>
      )}
      <FormFieldset readOnly={form.readOnly}>
        <SettingsSection
          title="Distribuição dos depósitos"
          description="Cada depósito é sorteado entre as contas ativas conforme o percentual. A soma precisa dar 100%."
          aside={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={Scale} onClick={() => form.set('deposits', distributeEvenly(active.map((a) => a.id)))}>
                Distribuir igualmente
              </Button>
              {mainId && (
                <Button size="sm" variant="ghost" onClick={() => form.set('deposits', { [mainId]: 100 })}>
                  Tudo na principal
                </Button>
              )}
            </div>
          }
        >
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`Distribuição: ${active.map((a) => `${label(a)} ${v.deposits[a.id] ?? 0}%`).join(', ')}`}>
            {active.map((a) => {
              const p = v.deposits[a.id] ?? 0
              return p > 0 ? <div key={a.id} className="h-full border-r-2 border-surface last:border-0" style={{ width: `${Math.min(100, p)}%`, background: `var(--chart-${slotOf(a.id)})` }} /> : null
            })}
          </div>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {active.map((a) => {
              const p = v.deposits[a.id] ?? 0
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: `var(--chart-${slotOf(a.id)})` }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-fg">{label(a)}</p>
                    <p className="text-xs text-fg-3">{p ? `≈ ${num(p * 10)} de cada 1.000 depósitos` : 'não recebe depósitos'}</p>
                  </div>
                  <div className="w-28">
                    <NumberInput id={`pct-${a.id}`} value={p} min={0} max={100} suffix="%" onValueChange={(n) => setPct(a.id, n)} invalid={total !== 100} />
                  </div>
                </li>
              )
            })}
          </ul>
          <div
            className={cn('flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3', total === 100 ? 'bg-success/10' : 'bg-danger/10')}
            aria-live="polite"
          >
            <span className="text-[13px] font-medium text-fg">Soma</span>
            <span className={cn('text-sm font-bold tnum', total === 100 ? 'text-success' : 'text-danger')}>
              {total}% {total === 100 ? '· pronto' : total < 100 ? `· faltam ${100 - total}%` : `· passou ${total - 100}%`}
            </span>
          </div>
          {!active.length && <Alert tone="danger">Nenhuma conta ativa. Ative contas na aba Credenciais.</Alert>}
        </SettingsSection>

        <SettingsSection title="Ordem de fallback" description="Se a conta sorteada falhar ao gerar o PIX, o depósito tenta a próxima da lista, de cima para baixo.">
          {fallback.length ? (
            <SortableList
              items={fallback}
              getKey={(id) => id}
              disabled={form.readOnly}
              onChange={(ids) => form.set('fallback', ids)}
              render={(id) => {
                const a = active.find((x) => x.id === id)!
                return (
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: `var(--chart-${slotOf(id)})` }} aria-hidden />
                    <span className="truncate text-[13px] font-medium text-fg">{label(a)}</span>
                    {a.main && <Badge tone="primary">principal</Badge>}
                  </div>
                )
              }}
            />
          ) : (
            <p className="text-[13px] text-fg-3">Sem contas ativas.</p>
          )}
        </SettingsSection>

        <SettingsSection title="Saques" description="Os saques aprovados saem de uma conta só, para facilitar a conciliação.">
          <Field label="Conta que paga os saques" htmlFor="wd-account" error={v.withdrawalAccountId && !active.some((a) => a.id === v.withdrawalAccountId) ? 'Esta conta não está ativa.' : null}>
            <Select id="wd-account" value={v.withdrawalAccountId} onChange={(id) => form.set('withdrawalAccountId', id)} placeholder="Escolha a conta" options={active.map((a) => ({ value: a.id, label: label(a) }))} className="max-w-md" />
          </Field>
          <Switch
            label="Se o saque falhar, tentar a próxima conta do fallback"
            description="Evita saque parado quando o gateway oscila. Cada tentativa fica no histórico do saque."
            checked={v.withdrawalFallback}
            onChange={(on) => form.set('withdrawalFallback', on)}
          />
        </SettingsSection>
      </FormFieldset>
      <SaveBar form={form} label="Salvar roteamento" />
    </div>
  )
}

// ---------- Saúde ----------

const HEALTH_LABEL: Record<HealthStatus, string> = { operacional: 'Operacional', degradado: 'Degradado', fora: 'Fora do ar' }
const HEALTH_TONE: Record<HealthStatus, Tone> = { operacional: 'success', degradado: 'warning', fora: 'neutral' }
type Metric = 'approval' | 'latency' | 'volume'

/**
 * Modo API: o servidor guarda gateways e contas, mas não consulta os gateways. A aba mostrava aprovação, latência,
 * uptime e erros gerados no navegador (inclusive "assinatura inválida" e "timeout" inventados) como se fossem reais.
 */
function Health() {
  if (API) return <HealthNoSource />
  return <HealthDemo />
}

function HealthNoSource() {
  const { gateways, accounts } = useGatewayData()
  const activeAccounts = accounts.items.filter((a) => a.active && gateways.items.find((g) => g.id === a.gatewayId)?.active)
  return (
    <NoDataSource title="Saúde dos gateways ainda sem fonte de dados">
      Nesta versão o servidor guarda as credenciais e as contas, mas não consulta os gateways: taxa de aprovação, latência, disponibilidade e
      erros dependem de dados do gateway que ainda não chegam ao painel.{' '}
      {activeAccounts.length
        ? `${plural(activeAccounts.length, 'conta ativa', 'contas ativas')} em gateway ligado; acompanhe a saúde no painel do próprio gateway.`
        : 'Nenhuma conta ativa em gateway ligado.'}
    </NoDataSource>
  )
}

function HealthDemo() {
  const { gateways, accounts } = useGatewayData()
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [at, setAt] = useState(() => new Date())
  const [selected, setSelected] = useState<string | null>(null)
  const [metric, setMetric] = useState<Metric>('approval')

  const health = useMemo(
    () =>
      accounts.items.map((a) => ({
        account: a,
        h: simulateHealth(a, !!gateways.items.find((g) => g.id === a.gatewayId)?.active, at, refresh),
      })),
    [accounts.items, gateways.items, at, refresh],
  )
  const live = health.filter((x) => x.h.status !== 'fora')
  const vol = (h: AccountHealth) => h.series.reduce((s, x) => s + x.volume, 0)
  const totalVol = live.reduce((s, x) => s + vol(x.h), 0)
  const approval = totalVol ? live.reduce((s, x) => s + x.h.approvalRate * vol(x.h), 0) / totalVol : 0
  const worstP95 = Math.max(0, ...live.map((x) => x.h.latencyP95))
  const errors24 = live.reduce((s, x) => s + x.h.errors.length, 0)
  const degraded = live.filter((x) => x.h.status === 'degradado')
  const current = health.find((x) => x.account.id === selected) ?? live[0] ?? health[0]

  const doRefresh = () => {
    setLoading(true)
    setTimeout(() => {
      setRefresh((r) => r + 1)
      setAt(new Date())
      setLoading(false)
    }, 500)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-fg-3">Simulação das últimas 24 horas · atualizado às {time(at)}</p>
        <Button icon={RefreshCw} loading={loading} onClick={doRefresh}>
          Atualizar
        </Button>
      </div>

      <section aria-label="Resumo da saúde" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Taxa de aprovação" icon={ShieldCheck} tone={approval >= 0.88 ? 'success' : 'warning'} value={pct(approval)} hint="PIX pagos ÷ PIX gerados, 24 h" formula={<>Média das contas ativas, ponderada pelo volume de cobranças de cada uma.</>} />
        <KpiCard label="Pior latência p95" icon={Timer} tone={worstP95 > 2000 ? 'danger' : worstP95 > 1000 ? 'warning' : 'success'} value={`${num(worstP95)} ms`} hint="tempo para gerar o PIX" formula={<>95% das cobranças são geradas em até este tempo. Acima de 2 s o jogador desiste.</>} />
        <KpiCard label="Erros em 24 h" icon={TriangleAlert} tone={errors24 > 8 ? 'danger' : errors24 ? 'warning' : 'success'} value={num(errors24)} hint={`${plural(live.length, 'conta ativa', 'contas ativas')}`} />
        <KpiCard label="Contas degradadas" icon={Activity} tone={degraded.length ? 'warning' : 'success'} value={num(degraded.length)} hint={degraded.length ? degraded.map((x) => x.account.name).join(', ') : 'todas operando bem'} />
      </section>

      {degraded.length > 0 && (
        <Alert tone="warning" title="Conta com aprovação baixa ou lenta">
          {degraded.map((x) => `${accountLabel(x.account, gateways.items)} (${pct(x.h.approvalRate)} de aprovação, p95 ${num(x.h.latencyP95)} ms)`).join(' · ')}. Considere reduzir o percentual dela no Roteamento.
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {health.map(({ account: a, h }) => {
          const isSel = current?.account.id === a.id
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setSelected(a.id)}
              aria-pressed={isSel}
              className={cn('card p-4 text-left transition-[border-color,box-shadow] duration-150 hover:border-line-strong', isSel && 'border-primary shadow-ring', h.status === 'fora' && 'opacity-70')}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <PlatformMark letter={(gateways.items.find((g) => g.id === a.gatewayId)?.name ?? '?')[0]} slot={GW_SLOT[a.gatewayId] ?? 1} size={28} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-fg">{a.name}</p>
                    <p className="truncate text-xs text-fg-3">{gateways.items.find((g) => g.id === a.gatewayId)?.name}</p>
                  </div>
                </div>
                <Badge tone={HEALTH_TONE[h.status]} dot>
                  {h.status === 'fora' && !a.active ? 'Conta inativa' : h.status === 'fora' ? 'Gateway desligado' : HEALTH_LABEL[h.status]}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <MiniStat label="Uptime 30d" value={h.status === 'fora' ? '—' : pct(h.uptime, 2)} />
                <MiniStat label="p95" value={h.status === 'fora' ? '—' : `${num(h.latencyP95)} ms`} tone={h.latencyP95 > 2000 ? 'danger' : undefined} />
                <MiniStat label="Aprovação" value={h.status === 'fora' ? '—' : pct(h.approvalRate, 0)} tone={h.status !== 'fora' && h.approvalRate < 0.85 ? 'warning' : undefined} />
              </div>
            </button>
          )
        })}
      </div>

      {current && (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card className="min-w-0 xl:col-span-2">
            <CardHeader
              icon={Gauge}
              title={accountLabel(current.account, gateways.items)}
              description="Últimas 24 horas, por hora"
              actions={
                <Segmented<Metric>
                  size="sm"
                  ariaLabel="Métrica do gráfico"
                  value={metric}
                  onChange={setMetric}
                  options={[
                    { value: 'approval', label: 'Aprovação' },
                    { value: 'latency', label: 'Latência' },
                    { value: 'volume', label: 'Volume' },
                  ]}
                />
              }
            />
            <CardBody>
              {current.h.status === 'fora' ? (
                <p className="py-16 text-center text-[13px] text-fg-3">Sem tráfego: {current.account.active ? 'o gateway está desligado' : 'a conta está inativa'}.</p>
              ) : (
                <TrendChart
                  ariaLabel={`Métrica ${metric} da conta ${current.account.name}`}
                  data={current.h.series}
                  xKey="hour"
                  height={240}
                  type={metric === 'latency' ? 'line' : 'area'}
                  format={metric === 'approval' ? 'pct' : metric === 'latency' ? (n) => `${num(Math.round(n))} ms` : 'num'}
                  series={[{ key: metric, label: metric === 'approval' ? 'Aprovação' : metric === 'latency' ? 'Latência' : 'Cobranças', slot: metric === 'approval' ? 3 : metric === 'latency' ? 2 : 1 }]}
                />
              )}
            </CardBody>
          </Card>
          <Card className="min-w-0">
            <CardHeader icon={ListOrdered} title="Últimos erros" description={current.account.name} />
            <CardBody>
              {current.h.errors.length ? (
                <ol className="space-y-3">
                  {current.h.errors.map((e, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-[13px]">
                          <Mono className="font-semibold text-fg">{e.code}</Mono>
                          <span className="text-xs text-fg-3" title={dateTime(e.at)}>
                            {relative(e.at)}
                          </span>
                        </p>
                        <p className="text-xs text-fg-2">{e.message}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="py-10 text-center text-[13px] text-fg-3">{current.h.status === 'fora' ? 'Sem tráfego.' : 'Nenhum erro nas últimas 24 horas.'}</p>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  )
}
