import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  Gauge,
  Globe,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Webhook,
  XCircle,
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
  FormFieldset,
  IconButton,
  Input,
  KpiCard,
  Menu,
  Modal,
  Mono,
  PageHeader,
  Segmented,
  Select,
  Switch,
  Tooltip,
  confirm,
  toast,
  type Column,
} from '@/components/ui'
import type { WebhookTestResponse } from '@shared/api'
import { cn } from '@/lib/cn'
import { ApiError, api, isApiMode, isVersionConflict } from '@/lib/api'
import { dateTime, maskSecret, num, pct, relative } from '@/lib/format'
import { uid } from '@/lib/random'
import { dbSetAndWait, dbSetAndWaitResult, patchCache, refreshKey } from '@/lib/store'
import { useWebhookDestinations, useWebhookExecutions } from '@/data/hooks'
import { audit, usePageAccess } from '@/domain/session'
import {
  WEBHOOK_EVENT_LABEL,
  WEBHOOK_KEYS,
  WEBHOOK_TEST_EVENT,
  isTestExecution,
  seedWebhookExecutions,
  webhookTestBody,
  type WebhookDestination,
  type WebhookEvent,
  type WebhookExecution,
} from '@/domain/webhooks'
import {
  deliveryStats,
  exampleSignature,
  findTokenSegments,
  generateDemoSecret,
  hasTokenInUrl,
  hostOf,
  isDemoWebhookHost,
  lastExecutionFor,
  maskToken,
  maskUrlTokens,
  MIN_SECRET_LENGTH,
  needsNewSecret,
  simulateDelivery,
  validateWebhookUrl,
  webhookSecretError,
} from '@/domain/campanhas-webhooks'
import { BlockTitle, CodeBlock, MiniStat } from './_shared-c1'

const EVENTS = Object.keys(WEBHOOK_EVENT_LABEL) as WebhookEvent[]

/** Modo API: o teste é enviado de verdade pelo servidor, que grava a execução. */
const API = isApiMode()
/** Cabeçalho da assinatura e tempo limite de resposta (no modo API, os do servidor). */
const SIGNATURE_HEADER = 'X-X2W-Signature'
const TIMEOUT_S = API ? 5 : 10

/** Execução como o servidor devolve no teste (com o motivo da falha, quando houver). */
type ServerExecution = WebhookExecution & { test?: boolean; error?: string }

/**
 * Grava a lista de destinos e espera a resposta. Modo API: o servidor confere a versão
 * (0 numa instalação nova; o store envia), valida endereço e segredo e devolve os segredos
 * mascarados; recusado, a tela volta ao que estava e o aviso mostra a mensagem do servidor.
 * Cada destino vai com o segredo que veio do servidor (a máscara exata, que mantém o
 * segredo) ou com um segredo novo inteiro; nunca outro texto com máscara.
 */
function saveDestinations(next: (prev: WebhookDestination[]) => WebhookDestination[]) {
  return dbSetAndWait<WebhookDestination[]>(WEBHOOK_KEYS.destinations, next)
}

/** 400 do segredo de um destino (details.field 'secret'): a tela mostra no campo do segredo, sem o aviso geral. */
function isSecretFieldError(e: ApiError) {
  return e.status === 400 && (e.details as { field?: unknown } | undefined)?.field === 'secret'
}

function httpLabel(code: number) {
  return code ? `HTTP ${code}` : 'sem resposta'
}

/** Segredo de assinatura: forte no modo API (vai para o servidor), ilustrativo na demonstração. */
function newSigningSecret() {
  if (!API) return generateDemoSecret()
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return `whsec_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

const EVENT_META: Record<WebhookEvent, { icon: LucideIcon; tone: string; description: string }> = {
  'saque.solicitado': { icon: ArrowUpFromLine, tone: 'bg-info/10 text-info', description: 'Jogador pediu um saque.' },
  'saque.pago': { icon: CheckCircle2, tone: 'bg-success/10 text-success', description: 'Saque aprovado (aviso para o sistema que paga).' },
  'saque.rejeitado': { icon: XCircle, tone: 'bg-danger/10 text-danger', description: 'Saque recusado pela equipe.' },
  'saque.expirado': { icon: Clock, tone: 'bg-warning/10 text-warning', description: 'Saque não decidido no prazo.' },
  'deposito.primeiro': { icon: ArrowDownToLine, tone: 'bg-primary/10 text-primary-text', description: 'Primeiro depósito pago (FTD).' },
}

interface FormState {
  id: string | null
  event: WebhookEvent
  url: string
  active: boolean
  touched: boolean
  /** destino como estava ao abrir a edição (endereço e evento) */
  original: { event: WebhookEvent; url: string } | null
  /** segredo novo, quando o endereço muda de origem ou o evento muda: gerado aqui ou digitado */
  secretMode: 'gerar' | 'digitar'
  secret: string
  secretTouched: boolean
  /** o servidor pediu segredo novo (400 no segredo), mesmo sem a tela ver a troca de destino */
  forceSecret: boolean
  /** mensagem do servidor para o segredo */
  secretServerError: string | null
}

/** Edição que troca a origem do endereço (esquema, host, porta) ou o evento: o segredo atual não vale mais. */
function formNeedsSecret(f: FormState) {
  return !!f.id && !!f.original && (f.forceSecret || needsNewSecret(f.original, { event: f.event, url: f.url }))
}

/** Problema do segredo digitado (só quando a edição pede segredo novo e a pessoa escolheu digitar). */
function formSecretError(f: FormState) {
  if (!formNeedsSecret(f) || f.secretMode !== 'digitar') return null
  return webhookSecretError(f.secret, { rejectDemo: API })
}

/** Endereço de demonstração em destino novo ou endereço trocado (modo API): o servidor recusa. */
function demoHostError(f: FormState, url: string) {
  if (!API || !isDemoWebhookHost(url)) return null
  if (f.original && f.original.url.trim() === url) return null
  return `${hostOf(url)} é um endereço de demonstração, não um destino da operação.`
}

export default function Webhooks() {
  const { canEdit } = usePageAccess()
  const navigate = useNavigate()
  const dests = useWebhookDestinations()
  const execs = useWebhookExecutions()
  const [form, setForm] = useState<FormState | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [newSecret, setNewSecret] = useState<{ label: string; secret: string } | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const since30 = Date.now() - 30 * 86_400_000
  const stats = useMemo(() => deliveryStats(execs.items, since30), [execs.items, since30])
  const activeCount = dests.items.filter((d) => d.active).length
  const coveredEvents = EVENTS.filter((e) => dests.items.some((d) => d.event === e && d.active)).length
  const tokenDests = dests.items.filter((d) => hasTokenInUrl(d.url))
  const lockedTitle = !canEdit ? 'Seu cargo pode ver, mas não editar webhooks' : undefined

  const blankSecret = { secretMode: 'gerar' as const, secret: '', secretTouched: false, forceSecret: false, secretServerError: null }
  const openNew = (event: WebhookEvent = 'saque.solicitado') => setForm({ id: null, event, url: 'https://', active: true, touched: false, original: null, ...blankSecret })
  // quem edita webhooks recebe do servidor o endereço completo (para poder editá-lo); listas e ficha mostram mascarado
  const openEdit = (d: WebhookDestination) => {
    setDetailId(null)
    setForm({ id: d.id, event: d.event, url: d.url, active: d.active, touched: false, original: { event: d.event, url: d.url }, ...blankSecret })
  }

  const saveForm = async () => {
    if (!form) return
    const url = form.url.trim()
    const err = validateWebhookUrl(url) ?? duplicateError(dests.items, form, url) ?? demoHostError(form, url)
    if (err) {
      setForm({ ...form, touched: true })
      toast.error('Revise o endereço', { description: err })
      return
    }
    const rotateSecret = formNeedsSecret(form)
    const secretErr = formSecretError(form)
    if (secretErr) {
      setForm({ ...form, secretTouched: true })
      toast.error('Revise o segredo', { description: secretErr })
      return
    }
    if (hasTokenInUrl(url)) {
      const ok = await confirm({
        title: 'Salvar com token no endereço?',
        description: 'Tokens no caminho da URL ficam gravados em logs de proxy, histórico do navegador e ferramentas de monitoramento. Prefira a assinatura HMAC (cabeçalho X-X2W-Signature) ou um cabeçalho de autenticação no sistema que recebe.',
        confirmLabel: 'Salvar mesmo assim',
        tone: 'warning',
        icon: ShieldAlert,
      })
      if (!ok) return
    }
    const label = WEBHOOK_EVENT_LABEL[form.event]
    if (form.id) {
      const id = form.id
      const prev = dests.get(id)
      // origem do endereço ou evento trocados: segredo novo (o antigo fica preso ao destino anterior)
      const secret = rotateSecret ? (form.secretMode === 'gerar' ? newSigningSecret() : form.secret.trim()) : null
      const r = await dbSetAndWaitResult<WebhookDestination[]>(
        WEBHOOK_KEYS.destinations,
        (list) => list.map((d) => (d.id === id ? { ...d, event: form.event, url, active: form.active, ...(secret ? { secret } : {}) } : d)),
        undefined,
        { quiet: isSecretFieldError },
      )
      if (!r.ok) {
        // o servidor recusou o segredo ("O destino mudou: digite um novo segredo."): o formulário pede no próprio campo
        if (r.error && isSecretFieldError(r.error)) setForm({ ...form, forceSecret: true, secretMode: 'digitar', secretTouched: true, secretServerError: r.error.message })
        return
      }
      audit(
        'editar',
        `Webhook ${label}`,
        `${prev && prev.url !== url ? `Endereço trocado para ${maskUrlTokens(url)}` : 'Destino atualizado'}${secret ? ' · segredo de assinatura novo' : ''}`,
      )
      toast.success('Destino atualizado', { description: secret ? 'Atualize o segredo no sistema que recebe.' : undefined })
      setForm(null)
      if (secret && form.secretMode === 'gerar') setNewSecret({ label, secret })
    } else {
      const secret = newSigningSecret()
      const d: WebhookDestination = { id: uid('wh'), event: form.event, url, active: form.active, secret, createdAt: new Date().toISOString() }
      if (!(await saveDestinations((list) => [...list, d]))) return
      audit('criar', `Webhook ${label}`, `Destino ${maskUrlTokens(url)} criado${form.active ? '' : ' (inativo)'}`)
      toast.success('Destino criado', { description: 'Copie o segredo de assinatura para o sistema que recebe.' })
      setForm(null)
      setNewSecret({ label, secret })
    }
  }

  /** espera o servidor: recusado, o formulário fica aberto */
  const submitForm = async () => {
    if (saving) return
    setSaving(true)
    try {
      await saveForm()
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (d: WebhookDestination, on: boolean) => {
    if (!(await saveDestinations((list) => list.map((x) => (x.id === d.id ? { ...x, active: on } : x))))) return
    const othersOn = dests.items.some((x) => x.id !== d.id && x.event === d.event && x.active)
    audit(on ? 'ligar' : 'desligar', `Webhook ${WEBHOOK_EVENT_LABEL[d.event]}`, `Destino ${maskUrlTokens(d.url)} ${on ? 'ativado' : 'desativado'}`)
    toast.success(on ? 'Destino ativado' : 'Destino desativado', {
      description: on ? 'Recebe os próximos eventos.' : othersOn ? 'Os outros destinos deste evento continuam recebendo.' : 'Este evento deixa de ser enviado para fora.',
    })
  }

  const remove = async (d: WebhookDestination) => {
    const ok = await confirm({
      title: 'Excluir este destino?',
      description: `${maskUrlTokens(d.url)} deixa de receber "${WEBHOOK_EVENT_LABEL[d.event]}". Entregas ainda na fila para ele não saem mais: ficam como falha ("Destino removido"). O histórico de entregas continua em Estatísticas.`,
      confirmLabel: 'Excluir destino',
      tone: 'danger',
      icon: Trash2,
    })
    if (!ok) return
    if (!(await saveDestinations((list) => list.filter((x) => x.id !== d.id)))) return
    setDetailId(null)
    audit('excluir', `Webhook ${WEBHOOK_EVENT_LABEL[d.event]}`, `Destino ${maskUrlTokens(d.url)} excluído`)
    toast.success('Destino excluído')
  }

  const rotate = async (d: WebhookDestination) => {
    const ok = await confirm({
      title: 'Gerar novo segredo?',
      description: 'O segredo atual para de valer na hora. Atualize o sistema que recebe logo em seguida, ou as próximas entregas serão recusadas por assinatura inválida.',
      confirmLabel: 'Gerar novo segredo',
      tone: 'warning',
      icon: KeyRound,
    })
    if (!ok) return
    const secret = newSigningSecret()
    // só mostra o segredo depois que o servidor gravou (recusado, o antigo continua valendo)
    if (!(await saveDestinations((list) => list.map((x) => (x.id === d.id ? { ...x, secret } : x))))) return
    audit('editar', `Webhook ${WEBHOOK_EVENT_LABEL[d.event]}`, `Segredo de assinatura trocado (${maskUrlTokens(d.url)})`)
    setNewSecret({ label: WEBHOOK_EVENT_LABEL[d.event], secret })
  }

  /** Modo API: POST de teste de verdade; o servidor grava a execução e a auditoria. */
  const testOnServer = async (d: WebhookDestination) => {
    setTesting(d.id)
    try {
      const res = await api<WebhookTestResponse>('POST', `/api/webhooks/destinations/${encodeURIComponent(d.id)}/test`)
      const ex = res.execution as unknown as ServerExecution
      // mostra na hora; a recarga traz a lista como o servidor gravou
      patchCache<WebhookExecution[]>(WEBHOOK_KEYS.executions, (prev) => [ex, ...prev.filter((x) => x.id !== ex.id)], seedWebhookExecutions)
      refreshKey(WEBHOOK_KEYS.executions).catch(() => {})
      const timing = `${httpLabel(ex.httpStatus)} em ${num(ex.durationMs)} ms`
      if (ex.status === 'sucesso') toast.success('Teste entregue', { description: `${timing}. Enviado como ${WEBHOOK_TEST_EVENT}.` })
      else
        toast.error('O teste falhou', {
          description: ex.error ? `${ex.error}${ex.durationMs ? ` Tempo: ${num(ex.durationMs)} ms.` : ''}` : `O destino respondeu ${timing}.`,
          duration: 6000,
        })
    } catch (e) {
      // 409 versao_desatualizada (gravações cruzadas): a mensagem do servidor aparece e as listas são relidas
      if (isVersionConflict(e)) {
        refreshKey(WEBHOOK_KEYS.destinations).catch(() => {})
        refreshKey(WEBHOOK_KEYS.executions).catch(() => {})
      }
      toast.error('Não foi possível testar', { description: e instanceof ApiError ? e.message : 'Erro inesperado ao falar com o servidor. Tente de novo.' })
    } finally {
      setTesting((cur) => (cur === d.id ? null : cur))
    }
  }

  const test = (d: WebhookDestination) => {
    if (API) {
      if (testing) {
        toast.info('Aguarde o teste em andamento terminar')
        return
      }
      void testOnServer(d)
      return
    }
    setTesting(d.id)
    setTimeout(() => {
      const res = simulateDelivery(d.url)
      const now = new Date().toISOString()
      execs.add({
        id: uid('ex'),
        at: now,
        event: d.event,
        destinationId: d.id,
        url: d.url,
        status: res.status,
        httpStatus: res.httpStatus,
        durationMs: res.durationMs,
        // mesmo corpo do servidor: evento webhook.teste; a execução fica no evento do destino
        payload: JSON.stringify(webhookTestBody(d, now)),
        test: true,
      })
      audit('testar', `Webhook ${WEBHOOK_EVENT_LABEL[d.event]}`, `POST de teste para ${maskUrlTokens(d.url)}: HTTP ${res.httpStatus} em ${res.durationMs} ms`)
      if (res.status === 'sucesso') toast.success('Teste entregue', { description: `HTTP ${res.httpStatus} em ${num(res.durationMs)} ms. Enviado como ${WEBHOOK_TEST_EVENT}.` })
      else toast.error('O teste falhou', { description: res.message })
      setTesting(null)
    }, 700)
  }

  const recent = useMemo(() => [...execs.items].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8), [execs.items])
  const detail = detailId ? dests.get(detailId) : undefined

  return (
    <>
      <PageHeader
        actions={
          <Button variant="primary" icon={Plus} onClick={() => openNew()} disabled={!canEdit} title={lockedTitle}>
            Novo destino
          </Button>
        }
      />

      <section aria-label="Resumo dos webhooks" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Destinos ativos" icon={Webhook} value={`${num(activeCount)} de ${num(dests.items.length)}`} hint={`${coveredEvents} de ${EVENTS.length} eventos com destino`} />
        <KpiCard label="Entregas em 30 dias" icon={Activity} tone="info" value={num(stats.total)} hint={`${num(stats.failed)} ${stats.failed === 1 ? 'falha' : 'falhas'}`} onClick={() => navigate('/campanhas/estatisticas')} />
        <KpiCard
          label="Taxa de sucesso"
          icon={CheckCircle2}
          tone={stats.rate === null || stats.rate >= 0.98 ? 'success' : stats.rate >= 0.9 ? 'warning' : 'danger'}
          value={stats.rate === null ? '—' : pct(stats.rate)}
          hint={`respostas 2xx em até ${TIMEOUT_S} s`}
          formula={<>Entregas com resposta HTTP 2xx dividido pelo total de entregas nos últimos 30 dias. Testes entram na conta.</>}
        />
        <KpiCard label="Tempo médio de resposta" icon={Gauge} tone="neutral" value={`${num(stats.avgMs)} ms`} hint="do envio à resposta do destino" />
      </section>

      {tokenDests.length > 0 && (
        <Alert
          tone="warning"
          icon={ShieldAlert}
          className="mb-5"
          title={tokenDests.length === 1 ? '1 destino tem um token no endereço' : `${tokenDests.length} destinos têm token no endereço`}
          action={
            <Button size="sm" onClick={() => setDetailId(tokenDests[0].id)}>
              Ver destino
            </Button>
          }
        >
          Tokens no caminho da URL ficam gravados em logs de proxy, histórico e ferramentas de monitoramento. Prefira autenticar pelo cabeçalho <strong>{SIGNATURE_HEADER}</strong> (HMAC com o segredo do destino) ou por um cabeçalho Authorization no
          sistema que recebe. Nesta tela o trecho sensível aparece mascarado.
        </Alert>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {EVENTS.map((ev) => {
            const meta = EVENT_META[ev]
            const list = dests.items.filter((d) => d.event === ev)
            return (
              <Card key={ev}>
                <div className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', meta.tone)}>
                    <meta.icon size={18} aria-hidden />
                  </span>
                  <div className="min-w-[180px] flex-1">
                    <h2 className="flex flex-wrap items-center gap-x-2 text-[15px] font-semibold text-fg">
                      {WEBHOOK_EVENT_LABEL[ev]}
                      <Mono className="text-[11.5px] font-normal text-fg-3">{ev}</Mono>
                    </h2>
                    <p className="text-[13px] text-fg-3">{meta.description}</p>
                  </div>
                  <Button size="sm" variant="ghost" icon={Plus} onClick={() => openNew(ev)} disabled={!canEdit} title={lockedTitle}>
                    Adicionar destino
                  </Button>
                </div>
                <ul className="divide-y divide-line border-t border-line">
                  {list.map((d) => (
                    <DestinationRow
                      key={d.id}
                      d={d}
                      last={lastExecutionFor(execs.items, d.id)}
                      canEdit={canEdit}
                      testing={testing === d.id}
                      onOpen={() => setDetailId(d.id)}
                      onToggle={(on) => toggle(d, on)}
                      onTest={() => test(d)}
                      onEdit={() => openEdit(d)}
                      onRotate={() => rotate(d)}
                      onRemove={() => remove(d)}
                    />
                  ))}
                  {!list.length && (
                    <li className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 text-[13px] text-fg-3">
                      Nenhum destino: este evento não é enviado para fora.
                      <Button size="xs" variant="soft" icon={Plus} onClick={() => openNew(ev)} disabled={!canEdit}>
                        Adicionar
                      </Button>
                    </li>
                  )}
                </ul>
              </Card>
            )
          })}
        </div>

        <aside className="min-w-0 space-y-4">
          <Card>
            <CardHeader icon={ShieldCheck} title="Como validar a assinatura" description="Todo envio é um POST JSON assinado com o segredo do destino." />
            <CardBody className="space-y-3 text-[13px] leading-5 text-fg-2">
              <CodeBlock label="Cabeçalhos de exemplo" className="text-[11.5px]">
                {`X-X2W-Event: saque.pago\nX-X2W-Delivery: ex_7f3a…\nX-X2W-Timestamp: 1760020320\nX-X2W-Signature:\n  sha256=${exampleSignature('exemplo', 1760020320).slice(7, 33)}…`}
              </CodeBlock>
              <ol className="list-decimal space-y-1.5 pl-4">
                <li>
                  Calcule HMAC-SHA256 de <Mono>timestamp + "." + corpo</Mono> com o segredo.
                </li>
                <li>
                  Compare com o valor depois de <Mono>sha256=</Mono>. Se não bater, recuse com 401.
                </li>
                <li>Recuse envios com timestamp mais velho que 5 minutos.</li>
                <li>Responda 2xx em até {TIMEOUT_S} s. Falhas são tentadas de novo até 5 vezes, com espera crescente.</li>
                <li>
                  Testes chegam com <Mono>X-X2W-Event: {WEBHOOK_TEST_EVENT}</Mono> e <Mono>"test": true</Mono>; o evento do destino vem em <Mono>data.destinationEvent</Mono>. Não trate um teste como evento real.
                </li>
              </ol>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              icon={Activity}
              title="Entregas recentes"
              actions={
                <button type="button" className="link text-[13px]" onClick={() => navigate('/campanhas/estatisticas')}>
                  Estatísticas
                </button>
              }
            />
            <ul className="divide-y divide-line border-t border-line">
              {recent.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-5 py-2.5">
                  {e.status === 'sucesso' ? <CheckCircle2 size={15} className="shrink-0 text-success" aria-label="Sucesso" /> : <XCircle size={15} className="shrink-0 text-danger" aria-label="Falha" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-fg">{WEBHOOK_EVENT_LABEL[e.event]}</p>
                    <p className="truncate font-mono text-[11px] text-fg-3">{hostOf(e.url)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cn('text-xs font-semibold tnum', e.status === 'sucesso' ? 'text-fg-2' : 'text-danger')}>
                      {e.httpStatus || '—'} · {num(e.durationMs)} ms
                    </p>
                    <p className="text-[11px] text-fg-3">{relative(e.at)}</p>
                  </div>
                </li>
              ))}
              {!recent.length && <li className="px-5 py-6 text-center text-[13px] text-fg-3">Nenhuma entrega ainda.</li>}
            </ul>
          </Card>
        </aside>
      </div>

      {form && <DestinationForm form={form} setForm={setForm} all={dests.items} canEdit={canEdit} saving={saving} onSave={submitForm} />}

      {detail && (
        <DestinationDrawer
          key={detail.id}
          d={detail}
          execs={execs.items}
          canEdit={canEdit}
          testing={testing === detail.id}
          onClose={() => setDetailId(null)}
          onEdit={() => openEdit(detail)}
          onTest={() => test(detail)}
          onRotate={() => rotate(detail)}
          onRemove={() => remove(detail)}
          onToggle={(on) => toggle(detail, on)}
        />
      )}

      <Modal
        open={!!newSecret}
        onClose={() => setNewSecret(null)}
        title="Segredo de assinatura"
        description={newSecret ? `Destino de "${newSecret.label}". Configure este valor no sistema que recebe.` : undefined}
        icon={KeyRound}
        size="sm"
        footer={
          <Button variant="primary" onClick={() => setNewSecret(null)}>
            Já copiei
          </Button>
        }
      >
        {newSecret && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 py-1.5 pl-3 pr-1.5">
              <Mono className="min-w-0 flex-1 break-all text-fg">{newSecret.secret}</Mono>
              <CopyButton value={newSecret.secret} label="Copiar segredo" />
            </div>
            <Alert tone="warning">Copie agora. Depois de fechar, só os últimos 4 caracteres aparecem. Para ver outro, gere um novo segredo.</Alert>
          </div>
        )}
      </Modal>
    </>
  )
}

function urlOriginChanged(before: string, after: string) {
  return needsNewSecret({ event: '', url: before }, { event: '', url: after })
}

function duplicateError(all: WebhookDestination[], f: FormState, url: string) {
  return all.some((d) => d.id !== f.id && d.event === f.event && d.url.trim() === url) ? 'Este endereço já recebe este evento.' : null
}

function LastDelivery({ e }: { e: WebhookExecution | undefined }) {
  if (!e) return <span className="text-fg-3">nunca entregue</span>
  return (
    <span className={cn('inline-flex items-center gap-1', e.status === 'sucesso' ? 'text-fg-2' : 'font-medium text-danger')}>
      {e.status === 'sucesso' ? <CheckCircle2 size={12} className="text-success" aria-hidden /> : <XCircle size={12} aria-hidden />}
      {e.status === 'sucesso' ? 'Entregue' : 'Falhou'} · {httpLabel(e.httpStatus)} · {num(e.durationMs)} ms · {relative(e.at)}
    </span>
  )
}

function DestinationRow({
  d,
  last,
  canEdit,
  testing,
  onOpen,
  onToggle,
  onTest,
  onEdit,
  onRotate,
  onRemove,
}: {
  d: WebhookDestination
  last: WebhookExecution | undefined
  canEdit: boolean
  testing: boolean
  onOpen: () => void
  onToggle: (on: boolean) => void
  onTest: () => void
  onEdit: () => void
  onRotate: () => void
  onRemove: () => void
}) {
  const token = hasTokenInUrl(d.url)
  return (
    <li className={cn('flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center', !d.active && 'bg-surface-2/60')}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="pt-0.5">
          <Switch size="sm" checked={d.active} onChange={onToggle} disabled={!canEdit} ariaLabel={`${d.active ? 'Desativar' : 'Ativar'} destino ${hostOf(d.url)}`} />
        </span>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <Mono className={cn('min-w-0 truncate text-[13px]', d.active ? 'text-fg' : 'text-fg-3')}>{maskUrlTokens(d.url)}</Mono>
            {token && (
              <Badge tone="warning" icon={ShieldAlert}>
                Token na URL
              </Badge>
            )}
            {!d.active && <Badge>Inativo</Badge>}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-3">
            <span className="inline-flex items-center gap-1">
              <KeyRound size={12} aria-hidden /> {maskSecret(d.secret)}
            </span>
            <LastDelivery e={last} />
          </span>
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 pl-12 sm:pl-0">
        <Button size="sm" icon={Send} onClick={onTest} loading={testing} disabled={!canEdit} title={!canEdit ? 'Seu cargo não testa webhooks' : `Envia um POST de teste (evento ${WEBHOOK_TEST_EVENT}, assinado com o segredo do destino)`}>
          Testar
        </Button>
        <Menu
          items={[
            { label: 'Ver detalhes', icon: Eye, onSelect: onOpen },
            { label: 'Editar', icon: Pencil, onSelect: onEdit, disabled: !canEdit },
            { label: 'Gerar novo segredo', icon: RefreshCw, onSelect: onRotate, disabled: !canEdit },
            { divider: true },
            { label: 'Excluir', icon: Trash2, danger: true, onSelect: onRemove, disabled: !canEdit },
          ]}
          trigger={(p) => <IconButton {...p} icon={MoreHorizontal} label="Mais ações do destino" size="sm" />}
        />
      </div>
    </li>
  )
}

function DestinationForm({
  form,
  setForm,
  all,
  canEdit,
  saving,
  onSave,
}: {
  form: FormState
  setForm: (f: FormState | null) => void
  all: WebhookDestination[]
  canEdit: boolean
  saving: boolean
  onSave: () => void
}) {
  const url = form.url.trim()
  const error = validateWebhookUrl(url) ?? duplicateError(all, form, url) ?? demoHostError(form, url)
  const showError = form.touched || (url.length > 8 && !!error && url !== 'https://')
  const tokens = !error ? findTokenSegments(url) : []
  const needsSecret = formNeedsSecret(form)
  const secretError = formSecretError(form)
  const showSecretError = form.secretTouched && !!secretError
  // endereço ou evento trocados: o que estava na fila para este destino não segue o endereço novo
  const rerouted = !!form.original && (form.original.url.trim() !== url || form.original.event !== form.event)
  const changed = form.original
    ? [form.original.event !== form.event && 'o evento mudou', urlOriginChanged(form.original.url, url) && 'o endereço mudou de domínio, protocolo ou porta'].filter(Boolean).join(' e ')
    : ''
  return (
    <Modal
      open
      onClose={() => setForm(null)}
      title={form.id ? 'Editar destino' : 'Novo destino'}
      description="O endereço recebe um POST com o JSON do evento a cada ocorrência."
      icon={Webhook}
      size="lg"
      footer={
        <>
          <Button onClick={() => setForm(null)}>Cancelar</Button>
          <Button variant="primary" onClick={onSave} loading={saving} disabled={!canEdit}>
            {form.id ? 'Salvar destino' : 'Criar destino'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSave()
        }}
      >
        <FormFieldset readOnly={!canEdit}>
          <Field label="Evento" htmlFor="wh-event">
            <Select id="wh-event" value={form.event} onChange={(v) => setForm({ ...form, event: v as WebhookEvent })} options={EVENTS.map((e) => ({ value: e, label: `${WEBHOOK_EVENT_LABEL[e]} (${e})` }))} />
          </Field>
          <Field label="Endereço (URL)" htmlFor="wh-url" required error={showError ? error : null} hint="Só https. Use um endereço público do sistema que recebe (CRM, BI, automação).">
            <Input
              id="wh-url"
              icon={Globe}
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              onBlur={() => setForm({ ...form, touched: true })}
              invalid={showError && !!error}
              placeholder="https://"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              data-autofocus
            />
          </Field>
          {tokens.length > 0 && (
            <Alert tone="warning" icon={ShieldAlert} title="Este endereço parece ter um token">
              {tokens.map((t) => (t.where === 'caminho' ? `Trecho do caminho “${maskToken(t.value)}”` : `Parâmetro “${t.name}”`)).join(', ')} parece um segredo. Tokens na URL ficam gravados em logs. Prefira validar a assinatura{' '}
              <strong>{SIGNATURE_HEADER}</strong> ou um cabeçalho de autenticação. Se o sistema exigir o token, você pode salvar mesmo assim: ele fica mascarado nas listas, no histórico de envios e para quem não edita webhooks.
            </Alert>
          )}
          {needsSecret ? (
            <div className="space-y-3 rounded-xl border border-warning/40 bg-warning/5 p-4">
              <div className="flex items-start gap-2.5">
                <KeyRound size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                <div className="text-[13px] leading-5">
                  <p className="font-semibold text-fg">O destino mudou: precisa de um segredo novo</p>
                  <p className="text-fg-3">
                    {changed ? `${changed.charAt(0).toUpperCase()}${changed.slice(1)}. ` : ''}O segredo atual fica com o destino anterior e para de valer ao salvar. Entregas ainda na fila não seguem o endereço novo: ficam como falha (“Destino alterado”).
                  </p>
                </div>
              </div>
              <Segmented
                ariaLabel="Segredo novo"
                value={form.secretMode}
                onChange={(secretMode) => setForm({ ...form, secretMode })}
                options={[
                  { value: 'gerar', label: 'Gerar um segredo', icon: RefreshCw },
                  { value: 'digitar', label: 'Digitar o segredo', icon: KeyRound },
                ]}
              />
              {form.secretMode === 'digitar' ? (
                <Field
                  label="Segredo novo"
                  htmlFor="wh-secret"
                  required
                  error={showSecretError ? secretError : form.secretServerError}
                  hint={`Pelo menos ${MIN_SECRET_LENGTH} caracteres: o mesmo valor configurado no sistema que recebe.`}
                >
                  <Input
                    id="wh-secret"
                    icon={KeyRound}
                    value={form.secret}
                    onChange={(e) => setForm({ ...form, secret: e.target.value, secretServerError: null })}
                    onBlur={() => setForm({ ...form, secretTouched: true })}
                    invalid={showSecretError || !!form.secretServerError}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                  />
                </Field>
              ) : (
                <p className="text-xs text-fg-3">Ao salvar, geramos o segredo novo e mostramos uma única vez para você copiar.</p>
              )}
            </div>
          ) : (
            rerouted && <p className="text-xs text-fg-3">Entregas ainda na fila para este destino não seguem o endereço novo: ficam como falha (“Destino alterado”).</p>
          )}
          <Switch label="Destino ativo" description={form.active ? 'Recebe os eventos a partir de agora.' : 'Fica salvo, mas não recebe nada.'} checked={form.active} onChange={(on) => setForm({ ...form, active: on })} />
          {!form.id && <p className="text-xs text-fg-3">Ao criar, geramos um segredo de assinatura e mostramos uma única vez para você copiar.</p>}
        </FormFieldset>
      </form>
    </Modal>
  )
}

function DestinationDrawer({
  d,
  execs,
  canEdit,
  testing,
  onClose,
  onEdit,
  onTest,
  onRotate,
  onRemove,
  onToggle,
}: {
  d: WebhookDestination
  execs: WebhookExecution[]
  canEdit: boolean
  testing: boolean
  onClose: () => void
  onEdit: () => void
  onTest: () => void
  onRotate: () => void
  onRemove: () => void
  onToggle: (on: boolean) => void
}) {
  /** endereço completo revelado: só nesta tela aberta, nunca guardado */
  const [revealed, setRevealed] = useState<string | null>(null)
  const [revealing, setRevealing] = useState(false)
  const list = useMemo(() => execs.filter((e) => e.destinationId === d.id).sort((a, b) => b.at.localeCompare(a.at)), [execs, d.id])
  const st = deliveryStats(list, Date.now() - 30 * 86_400_000)
  const tokens = findTokenSegments(d.url)
  // endereço editado com a ficha aberta: esconde de novo
  useEffect(() => setRevealed(null), [d.url])
  /**
   * Endereço completo. Modo API: pedido ao servidor (POST .../reveal, quem edita webhooks),
   * que registra na auditoria. Demonstração: o da lista, com o registro local.
   */
  const fullUrl = async (): Promise<string | null> => {
    if (!canEdit) {
      toast.error('Seu cargo não pode ver o endereço completo.')
      return null
    }
    if (!API) {
      audit('revelar', `Webhook ${WEBHOOK_EVENT_LABEL[d.event]}`, 'Endereço completo do destino exibido (token na URL)')
      return d.url
    }
    setRevealing(true)
    try {
      const res = await api<{ url: string }>('POST', `/api/webhooks/destinations/${encodeURIComponent(d.id)}/reveal`)
      return res.url
    } catch (e) {
      toast.error('Não foi possível mostrar o endereço', { description: e instanceof ApiError ? e.message : 'Erro inesperado ao falar com o servidor. Tente de novo.' })
      return null
    } finally {
      setRevealing(false)
    }
  }
  const reveal = async () => {
    const url = await fullUrl()
    if (url) setRevealed(url)
  }
  const copyFull = async () => {
    const url = revealed ?? (await fullUrl())
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Endereço completo copiado')
    } catch {
      setRevealed(url)
      toast.error('Não foi possível copiar', { description: 'O endereço aparece na tela: selecione e copie.' })
    }
  }
  const columns: Column<WebhookExecution>[] = [
    { id: 'at', header: 'Data e hora', sortValue: (e) => e.at, cell: (e) => <span className="text-[13px] text-fg-2 tnum">{dateTime(e.at)}</span> },
    {
      id: 'status',
      header: 'Resultado',
      sortValue: (e) => e.status,
      cell: (e) => (
        <Badge tone={e.status === 'sucesso' ? 'success' : 'danger'} dot>
          {e.status === 'sucesso' ? 'Entregue' : 'Falhou'}
        </Badge>
      ),
    },
    { id: 'http', header: 'HTTP', align: 'right', sortValue: (e) => e.httpStatus, cell: (e) => e.httpStatus || '—' },
    { id: 'ms', header: 'Tempo', align: 'right', sortValue: (e) => e.durationMs, cell: (e) => `${num(e.durationMs)} ms` },
    {
      id: 'test',
      header: 'Origem',
      cell: (e) => (isTestExecution(e) ? <Badge tone="info">Teste</Badge> : <span className="text-xs text-fg-3">Evento real</span>),
    },
  ]
  return (
    <Drawer
      open
      onClose={onClose}
      width="xl"
      title={`Destino · ${WEBHOOK_EVENT_LABEL[d.event]}`}
      description={hostOf(d.url)}
      headerExtra={
        <Badge tone={d.active ? 'success' : 'neutral'} dot size="md">
          {d.active ? 'Ativo' : 'Inativo'}
        </Badge>
      }
      footer={
        <>
          <Button variant="ghost" icon={Trash2} className="mr-auto text-danger" onClick={onRemove} disabled={!canEdit}>
            Excluir
          </Button>
          <Button icon={Pencil} onClick={onEdit} disabled={!canEdit}>
            Editar
          </Button>
          <Button variant="primary" icon={Send} onClick={onTest} loading={testing} disabled={!canEdit}>
            Testar agora
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {tokens.length > 0 && (
          <Alert tone="warning" icon={ShieldAlert} title="Token no endereço (achado #7 da auditoria)">
            O caminho deste destino tem um trecho com cara de token. Peça ao responsável pelo sistema que recebe para trocar por validação da assinatura <strong>{SIGNATURE_HEADER}</strong> ou por um cabeçalho Authorization, e depois edite o
            endereço para tirar o token.
          </Alert>
        )}

        <Switch label="Destino ativo" description={d.active ? 'Recebe cada novo evento.' : 'Não recebe nada até ser ativado.'} checked={d.active} onChange={onToggle} disabled={!canEdit} />

        <DescriptionList
          items={[
            {
              label: 'Endereço',
              full: true,
              value: (
                <span className="flex flex-wrap items-center gap-2">
                  <Mono className="break-all text-fg">{revealed ?? maskUrlTokens(d.url)}</Mono>
                  {tokens.length > 0 && !revealed && (
                    <button type="button" onClick={reveal} disabled={revealing} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-text hover:underline disabled:opacity-60">
                      <Eye size={12} aria-hidden /> Revelar
                    </button>
                  )}
                  {tokens.length > 0 ? (
                    canEdit && (
                      <Button size="xs" variant="soft" icon={Copy} onClick={copyFull} loading={revealing} title="Copia o endereço com o token (fica registrado na auditoria)">
                        Copiar endereço completo
                      </Button>
                    )
                  ) : (
                    <CopyButton value={d.url} label="Copiar endereço" />
                  )}
                </span>
              ),
            },
            { label: 'Evento', value: <span>{WEBHOOK_EVENT_LABEL[d.event]} <Mono className="text-fg-3">({d.event})</Mono></span> },
            { label: 'Criado em', value: dateTime(d.createdAt) },
            {
              label: 'Segredo de assinatura',
              full: true,
              value: (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 font-mono text-[12.5px] text-fg-2">
                    <KeyRound size={13} className="text-fg-3" aria-hidden /> {maskSecret(d.secret)}
                  </span>
                  <Tooltip content="O valor atual nunca é mostrado de novo. Gere um novo para trocar.">
                    <Button size="xs" variant="soft" icon={RefreshCw} onClick={onRotate} disabled={!canEdit}>
                      Gerar novo segredo
                    </Button>
                  </Tooltip>
                </span>
              ),
            },
          ]}
        />

        <div className="grid grid-cols-3 gap-2.5">
          <MiniStat label="Entregas (30 dias)" value={num(st.total)} />
          <MiniStat label="Sucesso" value={st.rate === null ? '—' : pct(st.rate, 0)} sub={st.failed ? `${st.failed} falhas` : undefined} />
          <MiniStat label="Tempo médio" value={`${num(st.avgMs)} ms`} />
        </div>

        <section>
          <BlockTitle icon={Activity}>Últimas entregas</BlockTitle>
          <DataTable
            bare
            className="relative overflow-hidden rounded-xl border border-line"
            caption="Últimas entregas deste destino"
            rows={list}
            columns={columns}
            rowKey={(e) => e.id}
            columnPicker={false}
            pageSize={8}
            pageSizeOptions={[8, 25, 50]}
            initialSort={{ id: 'at', dir: 'desc' }}
            empty={{ title: 'Nenhuma entrega ainda', description: 'Use "Testar agora" para enviar um POST de teste.', icon: Send }}
          />
        </section>
      </div>
    </Drawer>
  )
}
