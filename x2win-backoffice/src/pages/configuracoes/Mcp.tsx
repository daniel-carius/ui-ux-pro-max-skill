import { useMemo, useState } from 'react'
import {
  Activity,
  Ban,
  Bot,
  CircleCheck,
  CircleX,
  Clock,
  Eye,
  KeyRound,
  Link2,
  Plus,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
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
  RadioCards,
  Segmented,
  Select,
  Tooltip,
  confirm,
  toast,
  type Column,
  type Tone,
} from '@/components/ui'
import { date, dateTime, num, plural, relative } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useCollection } from '@/lib/store'
import { uid } from '@/lib/random'
import { MODULES } from '@/nav'
import { MCP_KEYS, seedMcpKeys, seedMcpUsage } from '@/data/config2-mcp'
import { audit, usePageAccess, useRoles, useSession, useTeam } from '@/domain/session'
import { moduleAccess, type Role } from '@/domain/roles'
import {
  MCP_EXPIRY_OPTIONS,
  MCP_SCOPE_LABEL,
  MCP_SERVER_URL,
  MCP_STATUS_LABEL,
  canCreateKey,
  clientConfigSnippet,
  effectivePermissions,
  expiryFrom,
  generateMcpToken,
  inheritsWeak2fa,
  keyStatus,
  validateKeyName,
  type McpExpiry,
  type McpKey,
  type McpKeyStatus,
  type McpScope,
  type McpUsage,
} from '@/domain/config2-mcp'
import { CodeBlock, OneTimeSecret, RoleBadge } from './_shared-g'

const STATUS_TONE: Record<McpKeyStatus, Tone> = { ativa: 'success', revogada: 'neutral', expirada: 'neutral', suspensa: 'warning' }
const RESULT_LABEL = { ok: 'Permitido', negado: 'Negado', erro: 'Erro' } as const
const RESULT_TONE: Record<McpUsage['result'], Tone> = { ok: 'success', negado: 'warning', erro: 'danger' }
const CLIENTS = ['Claude Desktop', 'Claude Code', 'Cursor', 'Outra ferramenta'].map((c) => ({ value: c, label: c }))

export default function Mcp() {
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  const [team] = useTeam()
  const [roles] = useRoles()
  const keys = useCollection<McpKey>(MCP_KEYS.keys, seedMcpKeys)
  const usage = useCollection<McpUsage>(MCP_KEYS.usage, seedMcpUsage)
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const createCheck = canCreateKey(user, canEdit)

  const creatorOf = (k: McpKey) => team.find((m) => m.id === k.createdById)
  const roleOfCreator = (k: McpKey) => {
    const c = creatorOf(k)
    return c ? roles.find((r) => r.id === c.roleId) : undefined
  }
  const statusOf = (k: McpKey) => keyStatus(k, creatorOf(k))
  const live = keys.items.filter((k) => statusOf(k) === 'ativa')
  const weak = live.filter((k) => inheritsWeak2fa(creatorOf(k)))
  const dayAgo = Date.now() - 86_400_000
  const calls24 = usage.items.filter((u) => new Date(u.at).getTime() >= dayAgo)
  const denied7 = usage.items.filter((u) => u.result === 'negado' && new Date(u.at).getTime() >= Date.now() - 7 * 86_400_000)

  const revoke = async (k: McpKey) => {
    const ok = await confirm({
      title: `Revogar a chave "${k.name}"?`,
      description: 'A ferramenta que usa esta chave perde o acesso na hora. Não dá para desfazer: para voltar, crie uma chave nova.',
      confirmLabel: 'Revogar chave',
      tone: 'danger',
      icon: Ban,
      details: (
        <DescriptionList
          columns={2}
          items={[
            { label: 'Criada por', value: k.createdByName },
            { label: 'Último uso', value: relative(k.lastUsedAt) },
            { label: 'Escopo', value: MCP_SCOPE_LABEL[k.scope] },
            { label: 'Ferramenta', value: k.client },
          ]}
        />
      ),
    })
    if (!ok) return
    keys.update(k.id, { revokedAt: new Date().toISOString(), revokedBy: user.name })
    audit('desativar', `Chave MCP "${k.name}"`, `Chave revogada (criada por ${k.createdByName}, ${MCP_SCOPE_LABEL[k.scope].toLowerCase()})`)
    toast.success('Chave revogada', { description: `"${k.name}" não funciona mais.` })
  }

  const revokeWeak = async () => {
    const ok = await confirm({
      title: `Revogar ${plural(weak.length, 'chave', 'chaves')} de quem está sem 2FA?`,
      description: 'As ferramentas perdem o acesso na hora. Quem criou pode gerar uma chave nova depois de ativar o 2FA.',
      confirmLabel: 'Revogar chaves',
      tone: 'danger',
      icon: Ban,
      details: (
        <ul className="space-y-1 text-[13px] text-fg-2">
          {weak.map((k) => (
            <li key={k.id}>
              <strong className="text-fg">{k.name}</strong> · {k.createdByName}
            </li>
          ))}
        </ul>
      ),
    })
    if (!ok) return
    const at = new Date().toISOString()
    weak.forEach((k) => keys.update(k.id, { revokedAt: at, revokedBy: user.name }))
    audit('desativar', 'Chaves MCP', `${plural(weak.length, 'chave revogada', 'chaves revogadas')} por criador sem 2FA: ${weak.map((k) => k.name).join(', ')}`)
    toast.success('Chaves revogadas')
  }

  const columns: Column<McpKey>[] = [
    {
      id: 'name',
      header: 'Nome',
      pinned: true,
      minWidth: 220,
      sortValue: (k) => k.name,
      cell: (k) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{k.name}</p>
          <p className="truncate text-xs text-fg-3">
            <Mono className="text-[11.5px] text-fg-3">DEMO-mcp-••••{k.last4}</Mono> · {k.client}
          </p>
        </div>
      ),
    },
    { id: 'creator', header: 'Criada por', minWidth: 170, sortValue: (k) => k.createdByName, cell: (k) => <PersonCell name={k.createdByName} sub={creatorOf(k)?.email} /> },
    {
      id: 'role',
      header: 'Cargo herdado',
      sortValue: (k) => roleOfCreator(k)?.name ?? '',
      csv: (k) => roleOfCreator(k)?.name ?? '',
      cell: (k) => <RoleBadge role={roleOfCreator(k)} />,
    },
    {
      id: 'scope',
      header: 'Escopo',
      sortValue: (k) => k.scope,
      csv: (k) => MCP_SCOPE_LABEL[k.scope],
      cell: (k) => <Badge tone={k.scope === 'escrita' ? 'warning' : 'info'} icon={k.scope === 'escrita' ? KeyRound : Eye}>{MCP_SCOPE_LABEL[k.scope]}</Badge>,
    },
    { id: 'createdAt', header: 'Criada em', defaultHidden: true, sortValue: (k) => k.createdAt, csv: (k) => date(k.createdAt), cell: (k) => <span className="text-[13px] text-fg-2">{date(k.createdAt)}</span> },
    {
      id: 'lastUsed',
      header: 'Último uso',
      sortValue: (k) => k.lastUsedAt ?? '',
      csv: (k) => dateTime(k.lastUsedAt),
      cell: (k) => (k.lastUsedAt ? <Tooltip content={dateTime(k.lastUsedAt)}><span className="text-[13px] text-fg-2">{relative(k.lastUsedAt)}</span></Tooltip> : <span className="text-xs text-fg-3">nunca usada</span>),
    },
    {
      id: 'expires',
      header: 'Expira em',
      sortValue: (k) => k.expiresAt ?? '9999',
      csv: (k) => (k.expiresAt ? date(k.expiresAt) : 'Sem expiração'),
      cell: (k) =>
        k.expiresAt ? (
          <span className="text-[13px] text-fg-2">{date(k.expiresAt)}</span>
        ) : (
          <Badge tone={statusOf(k) === 'ativa' ? 'warning' : 'neutral'} icon={Clock}>Sem expiração</Badge>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (k) => statusOf(k),
      csv: (k) => MCP_STATUS_LABEL[statusOf(k)],
      cell: (k) => {
        const st = statusOf(k)
        return (
          <span className="inline-flex items-center gap-1.5">
            <Badge tone={STATUS_TONE[st]} dot>{MCP_STATUS_LABEL[st]}</Badge>
            {st === 'ativa' && inheritsWeak2fa(creatorOf(k)) && (
              <Tooltip content="O criador está sem 2FA: quem roubar a senha dele cria e usa chaves com o mesmo poder.">
                <Badge tone="danger" icon={ShieldAlert}>Criador sem 2FA</Badge>
              </Tooltip>
            )}
          </span>
        )
      },
    },
  ]

  const open = keys.items.find((k) => k.id === openId)

  return (
    <>
      <PageHeader
        actions={
          <Button variant="primary" icon={Plus} disabled={!createCheck.ok} title={createCheck.message} onClick={() => setCreating(true)}>
            Nova chave
          </Button>
        }
      />

      <div className="space-y-5">
        <section aria-label="Resumo das chaves" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Chaves ativas" icon={KeyRound} value={num(live.length)} hint={`${num(keys.items.length - live.length)} revogadas, expiradas ou suspensas`} />
          <KpiCard label="Chamadas em 24 h" icon={Activity} tone="info" value={num(calls24.length)} hint={`${num(new Set(calls24.map((u) => u.keyId)).size)} chaves em uso`} />
          <KpiCard label="Negadas em 7 dias" icon={Ban} tone={denied7.length ? 'warning' : 'success'} value={num(denied7.length)} hint="ferramenta pediu algo fora do cargo" formula={<>Chamadas recusadas porque a permissão exigida não está no cargo do criador ou a chave é somente leitura.</>} />
          <KpiCard label="Criador sem 2FA" icon={ShieldAlert} tone={weak.length ? 'danger' : 'success'} value={num(weak.length)} hint={weak.length ? 'chaves ativas em risco' : 'todas protegidas'} />
        </section>

        <Alert tone="info" icon={UserRound} title="A chave age como quem a criou">
          Cada chave usa as permissões do cargo do criador, as mesmas que ele tem no painel. Se o cargo mudar, a chave muda junto; se a pessoa for desligada, a chave é suspensa na
          hora. "Somente leitura" corta tudo o que não for consulta. Toda chamada fica registrada abaixo e na auditoria.
        </Alert>

        {!user.twoFactor && (
          <Alert tone="danger" icon={ShieldAlert} title="Ative o 2FA para criar chaves">
            Como a chave age como você, criar chaves sem 2FA passaria a fragilidade da sua senha para a ferramenta de IA.
          </Alert>
        )}

        {weak.length > 0 && (
          <Alert
            tone="warning"
            icon={TriangleAlert}
            title={`${plural(weak.length, 'chave ativa herda', 'chaves ativas herdam')} a falta de 2FA do criador`}
            action={
              <Button size="sm" variant="danger" icon={Ban} onClick={revokeWeak} disabled={!canEdit}>
                Revogar estas chaves
              </Button>
            }
          >
            {weak.map((k) => `"${k.name}" (${k.createdByName}, ${roleOfCreator(k)?.name ?? '—'})`).join(' · ')}. Hoje só cria chave quem tem 2FA; estas são anteriores à regra. Peça a ativação
            do 2FA em <a className="link" href="#/settings/equipe">Equipe</a> ou revogue.
          </Alert>
        )}

        <DataTable
          caption="Chaves de API para ferramentas de IA"
          className="relative"
          rows={keys.items}
          columns={columns}
          rowKey={(k) => k.id}
          searchText={(k) => `${k.name} ${k.createdByName} ${k.client} ${k.last4}`}
          searchPlaceholder="Buscar por nome, criador ou ferramenta"
          initialSort={{ id: 'createdAt', dir: 'desc' }}
          onRowClick={(k) => setOpenId(k.id)}
          rowClassName={(k) => (statusOf(k) !== 'ativa' ? 'opacity-70' : undefined)}
          rowActions={(k) => [
            { label: 'Ver detalhes', icon: Eye, onSelect: () => setOpenId(k.id) },
            { divider: true },
            { label: 'Revogar', icon: Ban, danger: true, disabled: !canEdit || !!k.revokedAt, onSelect: () => revoke(k) },
          ]}
          empty={{
            title: 'Nenhuma chave criada',
            description: 'Crie uma chave para conectar o Claude ou outra ferramenta de IA ao painel.',
            icon: Bot,
            action: (
              <Button size="sm" icon={Plus} disabled={!createCheck.ok} onClick={() => setCreating(true)}>
                Nova chave
              </Button>
            ),
          }}
        />

        <div className="grid gap-5 xl:grid-cols-5">
          <ConnectCard className="min-w-0 xl:col-span-2" />
          <UsageCard usage={usage.items} keys={keys.items} className="min-w-0 xl:col-span-3" />
        </div>
      </div>

      {creating && <NewKeyModal keys={keys.items} onClose={() => setCreating(false)} onCreate={(k) => keys.add(k)} creatorRole={roles.find((r) => r.id === user.roleId)} />}
      <KeyDrawer
        k={open}
        status={open ? statusOf(open) : 'ativa'}
        role={open ? roleOfCreator(open) : undefined}
        creator2fa={open ? !inheritsWeak2fa(creatorOf(open)) : true}
        usage={usage.items.filter((u) => u.keyId === openId)}
        onClose={() => setOpenId(null)}
        onRevoke={revoke}
        canEdit={canEdit}
      />
    </>
  )
}

function ConnectCard({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader icon={Link2} title="Conectar uma ferramenta de IA" description="Funciona com qualquer cliente compatível com MCP por HTTP." />
      <CardBody className="space-y-4">
        <Field label="Endereço do servidor MCP">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
            <Mono className="min-w-0 flex-1 truncate text-fg">{MCP_SERVER_URL}</Mono>
            <CopyButton value={MCP_SERVER_URL} label="Copiar endereço" />
          </div>
        </Field>
        <CodeBlock label="Configuração do cliente (JSON)" code={clientConfigSnippet()} />
        <ol className="space-y-1.5 text-[13px] text-fg-2">
          <li>1. Crie uma chave com o menor escopo que resolve o caso.</li>
          <li>2. Cole o JSON nas configurações de MCP da ferramenta e troque a chave.</li>
          <li>3. Reinicie a ferramenta. As chamadas aparecem em "Uso recente".</li>
        </ol>
      </CardBody>
    </Card>
  )
}

type ResultFilter = 'todos' | McpUsage['result']

function UsageCard({ usage, keys, className }: { usage: McpUsage[]; keys: McpKey[]; className?: string }) {
  const [keyId, setKeyId] = useState('')
  const [result, setResult] = useState<ResultFilter>('todos')
  const [limit, setLimit] = useState(10)
  const rows = useMemo(() => usage.filter((u) => (!keyId || u.keyId === keyId) && (result === 'todos' || u.result === result)), [usage, keyId, result])
  return (
    <Card className={className}>
      <CardHeader
        icon={Activity}
        title="Uso recente"
        description="Cada chamada das ferramentas, com a permissão exigida."
      />
      <CardBody>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select
            aria-label="Filtrar por chave"
            value={keyId}
            onChange={setKeyId}
            className="w-full sm:w-56"
            options={[{ value: '', label: 'Todas as chaves' }, ...keys.map((k) => ({ value: k.id, label: k.name }))]}
          />
          <Segmented<ResultFilter>
            size="sm"
            ariaLabel="Resultado"
            value={result}
            onChange={setResult}
            options={[
              { value: 'todos', label: 'Todas' },
              { value: 'negado', label: 'Negadas' },
              { value: 'erro', label: 'Erros' },
            ]}
          />
        </div>
        {rows.length ? (
          <>
            <ol className="divide-y divide-line">
              {rows.slice(0, limit).map((u) => {
                const Icon = u.result === 'ok' ? CircleCheck : u.result === 'negado' ? Ban : CircleX
                return (
                  <li key={u.id} className="flex items-start gap-3 py-2.5 first:pt-0">
                    <Icon size={16} className={cn('mt-0.5 shrink-0', u.result === 'ok' ? 'text-success' : u.result === 'negado' ? 'text-warning' : 'text-danger')} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
                        <Mono className="font-medium text-fg">{u.tool}</Mono>
                        <Badge tone={RESULT_TONE[u.result]}>{RESULT_LABEL[u.result]}</Badge>
                      </p>
                      <p className="truncate text-xs text-fg-3">
                        {u.keyName} · exige <span className="font-mono">{u.permission}</span> · {u.ip} · {num(u.ms)} ms
                      </p>
                    </div>
                    <time dateTime={u.at} title={dateTime(u.at)} className="shrink-0 whitespace-nowrap text-xs text-fg-3">
                      {relative(u.at)}
                    </time>
                  </li>
                )
              })}
            </ol>
            {rows.length > limit && (
              <Button size="sm" variant="ghost" block className="mt-2" onClick={() => setLimit((l) => l + 10)}>
                Mostrar mais ({rows.length - limit})
              </Button>
            )}
          </>
        ) : (
          <p className="py-8 text-center text-[13px] text-fg-3">Nenhuma chamada neste filtro.</p>
        )}
      </CardBody>
    </Card>
  )
}

function NewKeyModal({ keys, onClose, onCreate, creatorRole }: { keys: McpKey[]; onClose: () => void; onCreate: (k: McpKey) => void; creatorRole: Role | undefined }) {
  const { user } = useSession()
  const [name, setName] = useState('')
  const [scope, setScope] = useState<McpScope>('leitura')
  const [expiry, setExpiry] = useState<McpExpiry>(90)
  const [client, setClient] = useState('Claude Desktop')
  const [touched, setTouched] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const nameErr = validateKeyName(name, keys)
  const perms = effectivePermissions({ scope }, creatorRole)
  const submit = () => {
    setTouched(true)
    const check = canCreateKey(user, true)
    if (!check.ok) {
      toast.error('Não foi possível criar', { description: check.message })
      return
    }
    if (nameErr) return
    const t = generateMcpToken()
    const now = new Date()
    const k: McpKey = {
      id: uid('mk'),
      name: name.trim(),
      last4: t.slice(-4),
      createdById: user.id,
      createdByName: user.name,
      scope,
      createdAt: now.toISOString(),
      lastUsedAt: null,
      expiresAt: expiryFrom(now, expiry),
      revokedAt: null,
      revokedBy: null,
      client,
    }
    onCreate(k)
    audit('criar', `Chave MCP "${k.name}"`, `${MCP_SCOPE_LABEL[scope]}; ${expiry ? `expira em ${expiry} dias` : 'sem expiração'}; age como ${user.name} (${creatorRole?.name ?? '—'})`)
    setToken(t)
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={token ? 'Chave criada' : 'Nova chave de IA'}
      description={token ? 'Copie a chave agora. Depois de fechar, ela não aparece de novo.' : `A chave vai agir como você (${user.name}), com as permissões do cargo ${creatorRole?.name ?? '—'}.`}
      icon={token ? ShieldCheck : Bot}
      iconTone={token ? 'success' : 'primary'}
      footer={
        token ? (
          <Button variant="primary" onClick={onClose}>
            Já copiei a chave
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" icon={KeyRound} onClick={submit}>
              Criar chave
            </Button>
          </>
        )
      }
    >
      {token ? (
        <div className="space-y-4">
          <OneTimeSecret label="Chave de API" value={token} warning="Guarde num cofre de senhas. Quem tiver esta chave age como você no painel. Se vazar, revogue na lista." />
          <CodeBlock label="Configuração do cliente (JSON)" code={clientConfigSnippet(token)} />
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" htmlFor="nk-name" required error={touched ? nameErr : null} hint="Diga para que serve. Ex.: Relatório diário de GGR">
              <Input id="nk-name" data-autofocus value={name} invalid={touched && !!nameErr} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Ferramenta" htmlFor="nk-client">
              <Select id="nk-client" value={client} onChange={setClient} options={CLIENTS} />
            </Field>
          </div>
          <Field label="Escopo">
            <RadioCards<McpScope>
              name="Escopo"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'leitura', label: 'Somente leitura', icon: Eye, description: 'Consulta dados. Não cria, edita nem aprova nada.', badge: <Badge tone="success">Recomendado</Badge> },
                { value: 'escrita', label: 'Leitura e escrita', icon: KeyRound, description: 'Pode alterar o que o seu cargo altera, inclusive aprovar se o cargo aprova.' },
              ]}
            />
          </Field>
          <Field label="Expira em" htmlFor="nk-exp" hint={expiry ? `Para de funcionar em ${date(expiryFrom(new Date(), expiry))}.` : undefined}>
            <Select id="nk-exp" value={String(expiry)} onChange={(v) => setExpiry(Number(v) as McpExpiry)} options={MCP_EXPIRY_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))} />
          </Field>
          {!expiry && (
            <Alert tone="warning">Chave sem expiração continua valendo até alguém revogar. Prefira 90 dias e renove.</Alert>
          )}
          <div className="rounded-xl border border-line bg-surface-2 p-3.5">
            <p className="text-[13px] font-semibold text-fg">O que a chave vai poder fazer</p>
            <p className="mt-0.5 text-xs text-fg-3">
              {plural(perms.length, 'permissão', 'permissões')} herdadas de {creatorRole?.name ?? '—'}
              {scope === 'leitura' ? ' (só as de consulta)' : ''}.
            </p>
            {creatorRole && (
              <ul className="mt-2 flex flex-wrap gap-1">
                {MODULES.map((m) => {
                  const a = moduleAccess({ ...creatorRole, permissions: perms }, m.id)
                  if (a === 'nenhum') return null
                  return (
                    <li key={m.id}>
                      <Badge tone={a === 'edicao' ? 'warning' : 'info'}>
                        {m.title} · {a === 'edicao' ? 'Edição' : 'Leitura'}
                      </Badge>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </form>
      )}
    </Modal>
  )
}

function KeyDrawer({
  k,
  status,
  role,
  creator2fa,
  usage,
  onClose,
  onRevoke,
  canEdit,
}: {
  k: McpKey | undefined
  status: McpKeyStatus
  role: Role | undefined
  creator2fa: boolean
  usage: McpUsage[]
  onClose: () => void
  onRevoke: (k: McpKey) => void
  canEdit: boolean
}) {
  if (!k) return null
  const perms = effectivePermissions(k, role)
  return (
    <Drawer
      open
      onClose={onClose}
      title={k.name}
      description={`DEMO-mcp-••••${k.last4} · ${k.client}`}
      headerExtra={<Badge tone={STATUS_TONE[status]} dot size="md">{MCP_STATUS_LABEL[status]}</Badge>}
      footer={
        !k.revokedAt ? (
          <Button
            icon={Ban}
            className="text-danger"
            disabled={!canEdit}
            onClick={() => {
              onClose()
              onRevoke(k)
            }}
          >
            Revogar chave
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-6">
        {status === 'suspensa' && <Alert tone="warning">Suspensa porque {k.createdByName} está desligado(a). A chave não funciona enquanto a pessoa estiver sem acesso.</Alert>}
        {status === 'ativa' && !creator2fa && (
          <Alert tone="danger" icon={ShieldAlert}>
            {k.createdByName} está sem 2FA. Quem roubar a senha dele(a) tem o mesmo poder desta chave.
          </Alert>
        )}
        <DescriptionList
          items={[
            { label: 'Criada por', value: k.createdByName },
            { label: 'Cargo herdado', value: <RoleBadge role={role} /> },
            { label: 'Escopo', value: MCP_SCOPE_LABEL[k.scope] },
            { label: 'Permissões efetivas', value: num(perms.length) },
            { label: 'Criada em', value: dateTime(k.createdAt) },
            { label: 'Último uso', value: k.lastUsedAt ? `${dateTime(k.lastUsedAt)} · ${relative(k.lastUsedAt)}` : 'Nunca usada' },
            { label: 'Expira em', value: k.expiresAt ? dateTime(k.expiresAt) : 'Sem expiração' },
            ...(k.revokedAt ? [{ label: 'Revogada', value: `${dateTime(k.revokedAt)} por ${k.revokedBy}` }] : []),
          ]}
        />
        {role && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-fg">Acesso efetivo por módulo</h3>
            <ul className="flex flex-wrap gap-1.5">
              {MODULES.map((m) => {
                const a = moduleAccess({ ...role, permissions: perms }, m.id)
                return (
                  <li key={m.id}>
                    <Badge tone={a === 'edicao' ? 'warning' : a === 'leitura' ? 'info' : 'neutral'} className={a === 'nenhum' ? 'opacity-60' : undefined}>
                      {m.title} · {a === 'edicao' ? 'Edição' : a === 'leitura' ? 'Leitura' : 'Nenhum'}
                    </Badge>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-fg">Chamadas recentes</h3>
          {usage.length ? (
            <ul className="space-y-2">
              {usage.slice(0, 8).map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge tone={RESULT_TONE[u.result]}>{RESULT_LABEL[u.result]}</Badge>
                    <Mono className="truncate">{u.tool}</Mono>
                  </span>
                  <span className="shrink-0 text-xs text-fg-3">{relative(u.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-fg-3">Nenhuma chamada registrada.</p>
          )}
        </section>
      </div>
    </Drawer>
  )
}
