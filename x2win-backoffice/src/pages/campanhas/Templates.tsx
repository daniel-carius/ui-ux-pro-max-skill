import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Braces,
  Check,
  CheckCircle2,
  CircleOff,
  Dices,
  FlaskConical,
  Gift,
  HeartHandshake,
  IdCard,
  Pencil,
  Power,
  RotateCcw,
  Send,
  ShieldCheck,
  Target,
  Webhook,
  WandSparkles,
  XCircle,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  ChipFilter,
  DataTable,
  DescriptionList,
  Drawer,
  Field,
  FormFieldset,
  KpiCard,
  Mono,
  PageHeader,
  Select,
  Switch,
  Textarea,
  Tooltip,
  confirm,
  pathAccessTitle,
  toast,
  usePathAccess,
  type Column,
} from '@/components/ui'
import type { WebhookTestResponse } from '@shared/api'
import { cn } from '@/lib/cn'
import { ApiError, api, isApiMode } from '@/lib/api'
import { dateTime, num, plural, relative } from '@/lib/format'
import { uid } from '@/lib/random'
import { patchCache, refreshKey, useCollection } from '@/lib/store'
import { useWebhookDestinations, useWebhookExecutions } from '@/data/hooks'
import { TEMPLATE_EVENTS, TEMPLATE_EVENT_BY_KEY, TEMPLATE_KEY, seedTemplates } from '@/data/campanhas-templates'
import { audit, usePageAccess, useSession } from '@/domain/session'
import {
  WEBHOOK_EVENT_LABEL,
  WEBHOOK_KEYS,
  WEBHOOK_TEST_EVENT,
  seedWebhookExecutions,
  webhookTestBody,
  type WebhookDestination,
  type WebhookEvent,
  type WebhookExecution,
} from '@/domain/webhooks'
import {
  defaultTemplateBody,
  formatTemplate,
  insertAt,
  renderTemplate,
  sampleValues,
  validateTemplate,
  type TemplateCategory,
  type TemplateEventDef,
  type TemplateTest,
  type WebhookTemplate,
} from '@/domain/campanhas-templates'
import { destinationReceives, exampleSignature, maskUrlTokens, simulateDelivery } from '@/domain/campanhas-webhooks'
import { BlockTitle, CodeBlock } from './_shared-c1'

const CATEGORY_ICON: Record<TemplateCategory, LucideIcon> = {
  Conta: IdCard,
  Depósito: ArrowDownToLine,
  Saque: ArrowUpFromLine,
  Apostas: Dices,
  Bônus: Gift,
  Engajamento: Target,
  Segurança: ShieldCheck,
  'Jogo responsável': HeartHandshake,
}

const CATEGORY_TONE: Record<TemplateCategory, string> = {
  Conta: 'bg-info/10 text-info',
  Depósito: 'bg-success/10 text-success',
  Saque: 'bg-warning/10 text-warning',
  Apostas: 'bg-primary/10 text-primary-text',
  Bônus: 'bg-gold/15 text-warning dark:text-gold',
  Engajamento: 'bg-primary/10 text-primary-text',
  Segurança: 'bg-danger/10 text-danger',
  'Jogo responsável': 'bg-success/10 text-success',
}

/** Eventos que precisam continuar ativos para proteger o jogador. */
const PROTECTED_EVENTS = new Set(['jogador.autoexclusao', 'limite.deposito_atingido'])

type Row = WebhookTemplate & { def: TemplateEventDef }
type StatusFilter = 'todos' | 'ativos' | 'inativos'

const isWebhookEvent = (k: string): k is WebhookEvent => k in WEBHOOK_EVENT_LABEL

/**
 * O que o template faz no envio (modo API). O servidor envia só os eventos de saque e de primeiro depósito, sempre
 * com o envelope padrão { id, event, createdAt, data }; o template desligado faz o servidor não enviar o evento.
 * O corpo editado fica guardado como modelo e ainda não muda o que sai. Demonstração: tudo é simulado na tela.
 */
function activeEffect(event: string, on: boolean): string {
  if (!API) return on ? 'O evento é enviado com este corpo.' : 'O evento acontece, mas nada é enviado.'
  if (!isWebhookEvent(event)) return 'Nesta versão o servidor não envia este evento (só os de saque e primeiro depósito).'
  return on
    ? 'O servidor envia o evento aos destinos HTTP ativos, com o envelope padrão.'
    : 'O evento acontece, mas o servidor não envia nada aos destinos HTTP.'
}

/** Nota do corpo no modo API: o servidor ainda não aplica o template. */
const API_BODY_NOTE = 'Nesta versão o servidor envia o envelope padrão { id, event, createdAt, data }: o corpo editado aqui fica guardado como modelo e ainda não muda o que sai.'

/**
 * Modo API: o teste para destinos ativos é enviado de verdade pelo servidor
 * (POST /api/webhooks/destinations/:id/test), que grava as execuções. O painel nunca grava execuções.
 */
const API = isApiMode()

/** Eventos de jogo responsável pedem confirmação forte para desligar. */
async function confirmProtectedOff(r: Row) {
  if (!PROTECTED_EVENTS.has(r.event)) return true
  return confirm({
    title: `Desativar "${r.def.label}"?`,
    description:
      r.event === 'jogador.autoexclusao'
        ? 'Este aviso faz o CRM e as ferramentas de marketing pararem de falar com quem pediu autoexclusão. Sem ele, o jogador pode continuar recebendo ofertas (Lei 14.790/2023).'
        : 'Este aviso ajuda a equipe e o CRM a respeitarem o limite que o jogador definiu.',
    confirmLabel: 'Desativar mesmo assim',
    tone: 'danger',
    typeToConfirm: 'DESATIVAR',
  })
}

export default function Templates() {
  const { canEdit, can } = usePageAccess()
  // modo API: o teste com destino ativo sai pela rota de teste dos webhooks, que exige editar webhooks
  const canTestServer = !API || can('webhooks.editar')
  const { user } = useSession()
  const navigate = useNavigate()
  const webhooksPage = usePathAccess()('/campanhas/webhooks')
  const templates = useCollection<WebhookTemplate>(TEMPLATE_KEY, seedTemplates)
  const { items: destinations } = useWebhookDestinations()
  const executions = useWebhookExecutions()
  const [filter, setFilter] = useState<StatusFilter>('todos')
  const [category, setCategory] = useState<'todas' | TemplateCategory>('todas')
  const [editingId, setEditingId] = useState<string | null>(null)

  const rows: Row[] = useMemo(
    () => templates.items.flatMap((t) => {
      const def = TEMPLATE_EVENT_BY_KEY.get(t.event)
      return def ? [{ ...t, def }] : []
    }),
    [templates.items],
  )
  const destFor = (event: string) => (isWebhookEvent(event) ? destinations.filter((d) => d.event === event) : [])
  // destinos que recebem: ativos e (modo API) fora dos hosts de demonstração, como em Webhooks
  const receivingFor = (event: string) => destFor(event).filter((d) => destinationReceives(d, API))

  const active = rows.filter((r) => r.active).length
  const inactive = rows.length - active
  const weekAgo = Date.now() - 7 * 86_400_000
  const testedWeek = rows.filter((r) => r.lastTest && new Date(r.lastTest.at).getTime() >= weekAgo).length
  const failedTests = rows.filter((r) => r.lastTest && !r.lastTest.ok)
  const withHttp = rows.filter((r) => receivingFor(r.event).length > 0).length

  const filtered = rows
    .filter((r) => filter === 'todos' || (filter === 'ativos' ? r.active : !r.active))
    .filter((r) => category === 'todas' || r.def.category === category)

  const setActive = async (r: Row, on: boolean) => {
    if (!on && !(await confirmProtectedOff(r))) return
    templates.update(r.id, { active: on, updatedAt: new Date().toISOString(), updatedBy: user.name })
    audit(on ? 'ligar' : 'desligar', `Template ${r.def.label}`, on ? 'Template ativado' : 'Template desativado: o evento deixa de ser enviado')
    toast.success(on ? 'Template ativado' : 'Template desativado', {
      description: API ? activeEffect(r.event, on) : on ? 'O evento volta a ser enviado.' : 'O evento acontece, mas nada é enviado.',
      action: { label: 'Desfazer', onClick: () => templates.update(r.id, { active: !on }) },
    })
  }

  const restore = async (r: Row) => {
    const ok = await confirm({
      title: 'Restaurar o corpo padrão?',
      description: `O JSON de "${r.def.label}" volta ao modelo da plataforma. As suas mudanças neste template serão perdidas.`,
      confirmLabel: 'Restaurar padrão',
      tone: 'warning',
      icon: RotateCcw,
    })
    if (!ok) return
    templates.update(r.id, { body: defaultTemplateBody(r.def), updatedAt: new Date().toISOString(), updatedBy: user.name })
    audit('editar', `Template ${r.def.label}`, 'Corpo restaurado para o padrão')
    toast.success('Template restaurado')
  }

  /** Modo API: um POST de teste de verdade por destino ativo; o servidor grava execução e auditoria. */
  const runServerTest = async (r: Row, dests: WebhookDestination[]): Promise<TestRun | null> => {
    const done: WebhookExecution[] = []
    const targets: TestTarget[] = []
    let denied: string | null = null
    // um por vez: o servidor limita os testes por minuto
    for (const d of dests) {
      try {
        const res = await api<WebhookTestResponse>('POST', `/api/webhooks/destinations/${encodeURIComponent(d.id)}/test`)
        const ex = res.execution as unknown as WebhookExecution & { error?: string }
        done.push(ex)
        const ok = ex.status === 'sucesso'
        targets.push({
          url: d.url,
          ok,
          httpStatus: ex.httpStatus,
          durationMs: ex.durationMs,
          message: ex.error ?? (ok ? 'Recebido com sucesso.' : `O destino respondeu HTTP ${ex.httpStatus}.`),
        })
      } catch (e) {
        const message = e instanceof ApiError ? e.message : 'Erro inesperado ao falar com o servidor.'
        // sem permissão (403): nada foi enviado; não é falha de entrega
        if (e instanceof ApiError && e.status === 403) {
          denied = message
          break
        }
        targets.push({ url: d.url, ok: false, httpStatus: 0, durationMs: 0, message })
      }
    }
    if (done.length) {
      const ids = new Set(done.map((x) => x.id))
      patchCache<WebhookExecution[]>(WEBHOOK_KEYS.executions, (prev) => [...done, ...prev.filter((x) => !ids.has(x.id))], seedWebhookExecutions)
      refreshKey(WEBHOOK_KEYS.executions).catch(() => {})
    }
    // recusado por permissão: avisa sem gravar o último teste nem registrar 'testar'
    if (denied !== null) {
      toast.error('Teste não enviado', { description: denied })
      return null
    }
    const allOk = targets.every((t) => t.ok)
    const worst = targets.find((t) => !t.ok) ?? targets[0]
    const result: TemplateTest = {
      at: new Date().toISOString(),
      ok: allOk,
      httpStatus: worst.httpStatus,
      durationMs: Math.round(targets.reduce((s, t) => s + t.durationMs, 0) / targets.length),
      destinations: dests.length,
    }
    templates.update(r.id, { lastTest: result })
    audit('testar', `Template ${r.def.label}`, `Envio de teste para ${dests.length} destino(s): ${allOk ? 'sucesso' : worst.httpStatus ? `falha (HTTP ${worst.httpStatus})` : 'falha (sem resposta)'}`)
    if (allOk) toast.success('Teste enviado', { description: `${targets.length} ${targets.length === 1 ? 'envio recebido' : 'envios recebidos'} · ${result.durationMs} ms em média` })
    else toast.error('O teste falhou', { description: worst.message })
    return { result, targets }
  }

  /** Teste simulado: envia o corpo com dados de exemplo aos destinos ativos (ou à caixa de teste). */
  const runTest = (r: Row, body: string): Promise<TestRun | null> => {
    // modo API: destino de demonstração não recebe teste (o servidor recusa); só os que recebem
    const active = API ? receivingFor(r.event) : destFor(r.event).filter((d) => d.active)
    if (API && active.length) return runServerTest(r, active)
    // modo API sem destino ativo: nada é enviado (não há caixa de teste no servidor); antes o painel simulava uma
    // entrega "HTTP 200", gravava como teste bem-sucedido e auditava como enviado
    if (API) {
      toast.warning('Nada foi enviado', {
        description: `O evento ${r.def.label} não tem destino ativo em Webhooks. Cadastre ou ative um destino para este evento e teste de novo.`,
        duration: 7000,
      })
      return Promise.resolve(null)
    }
    // demonstração sem destino ativo: o teste vai para a caixa de inspeção (simulada, não grava execução)
    return new Promise((resolve) => {
      setTimeout(() => {
        const rendered = renderTemplate(body, sampleValues(r.def)) ?? '{}'
        const dests = destFor(r.event).filter((d) => d.active)
        const targets = (dests.length ? dests : [{ id: 'sandbox', url: 'https://teste.x2win.bet.br/webhooks/inspecao' } as Pick<WebhookDestination, 'id' | 'url'>]).map((d) => {
          const res = simulateDelivery(d.url)
          if (d.id !== 'sandbox' && isWebhookEvent(r.event)) {
            executions.add({
              id: uid('ex'),
              at: new Date().toISOString(),
              event: r.event,
              destinationId: d.id,
              url: d.url,
              status: res.status,
              httpStatus: res.httpStatus,
              durationMs: res.durationMs,
              payload: JSON.stringify({ test: true, ...JSON.parse(rendered) }),
              // teste marcado como no envio de teste de Webhooks: Estatísticas não conta como execução real
              test: true,
            })
          }
          return { url: d.url, ok: res.status === 'sucesso', httpStatus: res.httpStatus, durationMs: res.durationMs, message: res.message }
        })
        const allOk = targets.every((t) => t.ok)
        const worst = targets.find((t) => !t.ok) ?? targets[0]
        const result: TemplateTest = {
          at: new Date().toISOString(),
          ok: allOk,
          httpStatus: worst.httpStatus,
          durationMs: Math.round(targets.reduce((s, t) => s + t.durationMs, 0) / targets.length),
          destinations: dests.length,
        }
        templates.update(r.id, { lastTest: result })
        audit('testar', `Template ${r.def.label}`, `Envio de teste para ${dests.length ? `${dests.length} destino(s)` : 'a caixa de teste'}: ${allOk ? 'sucesso' : worst.httpStatus ? `falha (HTTP ${worst.httpStatus})` : 'falha (sem resposta)'}`)
        if (allOk) toast.success('Teste enviado', { description: `${targets.length} ${targets.length === 1 ? 'envio recebido' : 'envios recebidos'} · ${result.durationMs} ms em média` })
        else toast.error('O teste falhou', { description: worst.message })
        resolve({ result, targets })
      }, 650)
    })
  }

  const columns: Column<Row>[] = [
    {
      id: 'event',
      header: 'Evento',
      pinned: true,
      minWidth: 260,
      sortValue: (r) => r.def.label,
      csv: (r) => `${r.def.label} (${r.event})`,
      cell: (r) => {
        const Icon = CATEGORY_ICON[r.def.category]
        return (
          <div className="flex min-w-0 items-center gap-3">
            <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', CATEGORY_TONE[r.def.category])}>
              <Icon size={16} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium text-fg">{r.def.label}</p>
              <Mono className="text-[11.5px] text-fg-3">{r.event}</Mono>
            </div>
          </div>
        )
      },
    },
    { id: 'category', header: 'Categoria', sortValue: (r) => r.def.category, cell: (r) => <Badge>{r.def.category}</Badge> },
    {
      id: 'fields',
      header: 'Campos',
      minWidth: 260,
      sortValue: (r) => r.def.fields.length,
      csv: (r) => r.def.fields.map((f) => f.key).join(', '),
      cell: (r) => {
        const own = r.def.fields.filter((f) => !f.key.startsWith('event.') && !f.key.startsWith('player.'))
        const shown = own.slice(0, 2)
        return (
          <Tooltip content={r.def.fields.map((f) => f.key).join(', ')}>
            <span className="flex items-center gap-1">
              {shown.map((f) => (
                <span key={f.key} className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-fg-2">
                  {f.key}
                </span>
              ))}
              <span className="text-xs text-fg-3">+{r.def.fields.length - shown.length}</span>
            </span>
          </Tooltip>
        )
      },
    },
    {
      id: 'destinations',
      header: 'Destinos HTTP',
      sortValue: (r) => receivingFor(r.event).length,
      csv: (r) => receivingFor(r.event).length,
      cell: (r) => {
        if (!isWebhookEvent(r.event)) return <span className="text-xs text-fg-3">Só por Jornadas</span>
        const on = receivingFor(r.event).length
        return <Badge tone={on ? 'info' : 'neutral'} icon={Webhook}>{on ? `${on} ${on === 1 ? 'destino' : 'destinos'}` : 'Nenhum'}</Badge>
      },
    },
    {
      id: 'lastTest',
      header: 'Último teste',
      sortValue: (r) => r.lastTest?.at ?? '',
      csv: (r) => (r.lastTest ? `${dateTime(r.lastTest.at)} ${r.lastTest.ok ? 'ok' : 'falha'}` : ''),
      cell: (r) =>
        r.lastTest ? (
          <span className="flex items-center gap-1.5 text-[13px]">
            {r.lastTest.ok ? <CheckCircle2 size={14} className="text-success" aria-label="Sucesso" /> : <XCircle size={14} className="text-danger" aria-label="Falha" />}
            <span className={r.lastTest.ok ? 'text-fg-2' : 'font-medium text-danger'}>{r.lastTest.ok ? relative(r.lastTest.at) : r.lastTest.httpStatus ? `HTTP ${r.lastTest.httpStatus}` : 'sem resposta'}</span>
          </span>
        ) : (
          <span className="text-xs text-fg-3">Nunca testado</span>
        ),
    },
    {
      id: 'updated',
      header: 'Atualizado',
      defaultHidden: true,
      sortValue: (r) => r.updatedAt,
      csv: (r) => `${dateTime(r.updatedAt)} · ${r.updatedBy}`,
      cell: (r) => (
        <div className="text-[13px]">
          <p className="text-fg-2">{relative(r.updatedAt)}</p>
          <p className="text-xs text-fg-3">{r.updatedBy}</p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      pinned: true,
      sortValue: (r) => (r.active ? 1 : 0),
      csv: (r) => (r.active ? 'Ativo' : 'Inativo'),
      cell: (r) => (
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Switch size="sm" checked={r.active} onChange={(on) => setActive(r, on)} disabled={!canEdit} ariaLabel={`${r.active ? 'Desativar' : 'Ativar'} ${r.def.label}`} />
          <span className={cn('text-xs font-medium', r.active ? 'text-success' : 'text-fg-3')}>{r.active ? 'Ativo' : 'Inativo'}</span>
        </div>
      ),
    },
  ]

  const editing = editingId ? rows.find((r) => r.id === editingId) : undefined
  const categories = [...new Set(TEMPLATE_EVENTS.map((e) => e.category))]

  return (
    <>
      <PageHeader
        actions={
          <Button icon={Webhook} onClick={() => navigate('/campanhas/webhooks')} disabled={!webhooksPage.ok} title={pathAccessTitle(webhooksPage)}>
            Destinos HTTP
          </Button>
        }
      />

      <section aria-label="Resumo dos templates" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Templates" icon={Braces} value={num(rows.length)} hint="um por tipo de evento" />
        <KpiCard label="Ativos" icon={Power} tone="success" value={num(active)} hint={plural(inactive, 'inativo', 'inativos')} onClick={() => setFilter(filter === 'ativos' ? 'todos' : 'ativos')} active={filter === 'ativos'} />
        <KpiCard
          label="Com destino HTTP"
          icon={Webhook}
          tone="info"
          value={num(withHttp)}
          hint="eventos de saque e primeiro depósito"
          formula={<>Templates cujo evento tem pelo menos um destino ativo em Campanhas › Webhooks (destinos de demonstração não contam: não recebem eventos). Os demais eventos alimentam Jornadas e integrações internas.</>}
        />
        <KpiCard
          label="Testes"
          icon={FlaskConical}
          tone={failedTests.length ? 'danger' : 'neutral'}
          value={`${num(testedWeek)} na semana`}
          hint={failedTests.length ? `${failedTests.length} com falha no último teste` : 'nenhuma falha no último teste'}
        />
      </section>

      {failedTests.length > 0 && (
        <Alert
          tone="warning"
          className="mb-5"
          title={`${failedTests.length} ${failedTests.length === 1 ? 'template falhou' : 'templates falharam'} no último teste`}
          action={
            <Button size="sm" onClick={() => setEditingId(failedTests[0].id)}>
              Abrir {failedTests[0].def.label}
            </Button>
          }
        >
          Teste de novo depois de conferir o destino. Falhas seguidas costumam indicar endereço errado ou serviço fora do ar.
        </Alert>
      )}

      <DataTable
        className="relative"
        caption="Templates de webhook"
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.def.label} ${r.event} ${r.def.category} ${r.def.fields.map((f) => f.key).join(' ')}`}
        searchPlaceholder="Buscar evento ou campo"
        initialSort={{ id: 'event', dir: 'asc' }}
        pageSize={10}
        exportName="templates-webhook"
        onExport={(n) => audit('exportar', 'Templates de webhook', `Exportação CSV de ${n} templates`)}
        onRowClick={(r) => setEditingId(r.id)}
        resetKey={`${filter}-${category}`}
        rowClassName={(r) => (!r.active ? 'opacity-75' : undefined)}
        toolbar={
          <>
            <ChipFilter<StatusFilter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'todos', label: 'Todos', count: rows.length },
                { value: 'ativos', label: 'Ativos', count: active },
                { value: 'inativos', label: 'Inativos', count: rows.length - active },
              ]}
            />
            <Select
              aria-label="Filtrar por categoria"
              className="w-full sm:w-48"
              value={category}
              onChange={(v) => setCategory(v as 'todas' | TemplateCategory)}
              options={[{ value: 'todas', label: 'Todas as categorias' }, ...categories.map((c) => ({ value: c, label: c }))]}
            />
          </>
        }
        rowActions={(r) => [
          { label: 'Editar template', icon: Pencil, onSelect: () => setEditingId(r.id) },
          { label: r.active ? 'Desativar' : 'Ativar', icon: r.active ? CircleOff : Power, onSelect: () => setActive(r, !r.active), disabled: !canEdit },
          { label: 'Restaurar padrão', icon: RotateCcw, onSelect: () => restore(r), disabled: !canEdit || r.body === defaultTemplateBody(r.def) },
        ]}
        empty={{ title: 'Nenhum template neste filtro', description: 'Troque o status ou a categoria.', icon: Braces }}
      />

      {API && (
        <Alert tone="info" className="mb-5" title="O que o servidor faz com os templates">
          Desligar um template faz o servidor não enviar o evento aos destinos HTTP. {API_BODY_NOTE} Só os eventos de saque e de primeiro depósito
          saem do servidor nesta versão.
        </Alert>
      )}

      {editing && (
        <TemplateEditor
          key={editing.id}
          row={editing}
          destinations={API ? destFor(editing.event).filter((d) => destinationReceives(d, API)) : destFor(editing.event)}
          canEdit={canEdit}
          canTestServer={canTestServer}
          onClose={() => setEditingId(null)}
          onTest={(body) => runTest(editing, body)}
          onSave={(body, on) => {
            const changedActive = on !== editing.active
            templates.update(editing.id, { body, active: on, updatedAt: new Date().toISOString(), updatedBy: user.name })
            audit('editar', `Template ${editing.def.label}`, changedActive ? `Corpo atualizado e template ${on ? 'ativado' : 'desativado'}` : 'Corpo do template atualizado')
            // modo API: o servidor só usa o liga/desliga; o corpo fica guardado como modelo
            // evento que o servidor não envia: diz só isso (o "ainda envia o envelope padrão" contradizia a frase)
            toast.success('Template salvo', {
              description: API
                ? isWebhookEvent(editing.event)
                  ? `${activeEffect(editing.event, on)} O corpo fica guardado como modelo (o servidor ainda envia o envelope padrão).`
                  : `${activeEffect(editing.event, on)} O corpo fica guardado como modelo.`
                : 'Os próximos envios já usam o corpo novo.',
              duration: API ? 7000 : undefined,
            })
            setEditingId(null)
          }}
        />
      )}
    </>
  )
}

type TestTarget = { url: string; ok: boolean; httpStatus: number; durationMs: number; message: string }
/** Resultado de um envio de teste (null: nada foi enviado). */
type TestRun = { result: TemplateTest; targets: TestTarget[] }

function TemplateEditor({
  row,
  destinations,
  canEdit,
  canTestServer,
  onClose,
  onSave,
  onTest,
}: {
  row: Row
  destinations: WebhookDestination[]
  canEdit: boolean
  /** modo API: pode usar a rota de teste dos webhooks (editar webhooks) */
  canTestServer: boolean
  onClose: () => void
  onSave: (body: string, active: boolean) => void
  onTest: (body: string) => Promise<TestRun | null>
}) {
  const [body, setBody] = useState(row.body)
  const [active, setActive] = useState(row.active)
  const [testing, setTesting] = useState(false)
  const [lastRun, setLastRun] = useState<{ result: TemplateTest; targets: TestTarget[] } | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const allowed = useMemo(() => row.def.fields.map((f) => f.key), [row.def])
  const check = useMemo(() => validateTemplate(body, allowed), [body, allowed])
  const preview = useMemo(() => (check.ok ? renderTemplate(body, sampleValues(row.def)) : null), [check.ok, body, row.def])
  const dirty = body !== row.body || active !== row.active
  const unused = allowed.filter((k) => !check.vars.includes(k))
  const activeDests = destinations.filter((d) => d.active)
  // modo API: com destino ativo, o teste usa a rota de teste dos webhooks (exige editar webhooks)
  const testBlocked = API && activeDests.length > 0 && !canTestServer
  // modo API sem destino ativo: não há para onde enviar (o servidor não tem caixa de teste)
  const noDestApi = API && activeDests.length === 0
  const signature = useMemo(() => exampleSignature(activeDests[0]?.secret ?? 'DEMO-hmac-exemplo', 1760020320), [activeDests])
  // modo API: o teste do servidor não usa este template; sai como webhook.teste, com o evento do destino em data
  const serverTestBody = useMemo(() => (API && activeDests[0] ? JSON.stringify(webhookTestBody(activeDests[0], new Date().toISOString(), 'evt_…'), null, 2) : null), [activeDests])

  const insertVar = (key: string) => {
    const el = ref.current
    const token = `{{${key}}}`
    const start = el?.selectionStart ?? body.length
    const end = el?.selectionEnd ?? body.length
    const { text, cursor } = insertAt(body, start, end, token)
    setBody(text)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(cursor, cursor)
    })
  }

  const format = () => {
    const f = formatTemplate(body)
    if (f) {
      setBody(f)
      toast.success('JSON formatado')
    } else toast.error('Corrija o JSON antes de formatar')
  }

  const close = async () => {
    if (dirty) {
      const ok = await confirm({ title: 'Descartar alterações?', description: 'As mudanças neste template não foram salvas.', confirmLabel: 'Descartar', tone: 'danger' })
      if (!ok) return
    }
    onClose()
  }

  const test = async () => {
    setTesting(true)
    const r = await onTest(body)
    if (r) setLastRun(r)
    setTesting(false)
  }

  const Icon = CATEGORY_ICON[row.def.category]
  const caret = check.column && check.lineText !== null ? ' '.repeat(Math.max(0, check.column - 1)) + '^' : null

  return (
    <Drawer
      open
      onClose={close}
      width="xl"
      title={row.def.label}
      description={row.def.description}
      headerExtra={
        <Badge tone={active ? 'success' : 'neutral'} dot size="md">
          {active ? 'Ativo' : 'Inativo'}
        </Badge>
      }
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" icon={Check} onClick={() => onSave(body, active)} disabled={!canEdit || !dirty || !check.ok} title={!check.ok ? 'Corrija o JSON para salvar' : !canEdit ? 'Seu cargo não edita templates' : undefined}>
            Salvar template
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="flex items-start gap-3 rounded-xl bg-surface-2 p-3.5">
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', CATEGORY_TONE[row.def.category])}>
            <Icon size={20} aria-hidden />
          </span>
          <DescriptionList
            className="flex-1"
            columns={3}
            items={[
              { label: 'Evento', value: <Mono>{row.event}</Mono> },
              { label: 'Categoria', value: row.def.category },
              {
                label: 'Destinos HTTP',
                value: isWebhookEvent(row.event) ? (activeDests.length ? plural(activeDests.length, 'ativo', 'ativos') : 'Nenhum ativo') : 'Usado por Jornadas',
              },
            ]}
          />
        </div>

        <FormFieldset readOnly={!canEdit}>
          <Switch
            label="Template ativo"
            description={activeEffect(row.event, active)}
            checked={active}
            onChange={async (on) => {
              if (!on && !(await confirmProtectedOff(row))) return
              setActive(on)
            }}
          />

          <section>
            <BlockTitle icon={Braces} aside={<span className="text-xs text-fg-3">Clique para inserir no cursor</span>}>
              Variáveis do evento
            </BlockTitle>
            <div className="flex flex-wrap gap-1.5">
              {row.def.fields.map((f) => {
                const used = check.vars.includes(f.key)
                return (
                  <Tooltip key={f.key} content={`${f.label} · ex.: ${String(f.sample)}`}>
                    <button
                      type="button"
                      onClick={() => insertVar(f.key)}
                      className={cn(
                        'inline-flex h-7 items-center gap-1 rounded-md border px-2 font-mono text-[11.5px] transition-colors',
                        used ? 'border-primary/30 bg-primary/10 text-primary-text hover:bg-primary/15' : 'border-line bg-surface text-fg-2 hover:border-line-strong hover:text-fg',
                      )}
                    >
                      {used && <Check size={11} aria-hidden />}
                      {`{{${f.key}}}`}
                    </button>
                  </Tooltip>
                )
              })}
            </div>
            {unused.length > 0 && check.ok && <p className="mt-2 text-xs text-fg-3">{unused.length} {unused.length === 1 ? 'variável disponível não está' : 'variáveis disponíveis não estão'} no corpo. Tudo bem: só vai o que você usar.</p>}
          </section>

          {API && <Alert tone="info">{API_BODY_NOTE}</Alert>}
          <Field
            label={API ? 'Corpo do template (JSON, guardado como modelo)' : 'Corpo do envio (JSON)'}
            htmlFor="tp-body"
            labelAside={
              <span className="flex gap-1">
                <Button size="xs" variant="ghost" icon={WandSparkles} onClick={format} disabled={!check.ok}>
                  Formatar
                </Button>
                <Button size="xs" variant="ghost" icon={RotateCcw} onClick={() => setBody(defaultTemplateBody(row.def))} disabled={body === defaultTemplateBody(row.def)}>
                  Padrão
                </Button>
              </span>
            }
          >
            <Textarea
              id="tp-body"
              ref={ref}
              rows={12}
              value={body}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              invalid={!check.ok}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Tab' && !e.shiftKey) {
                  e.preventDefault()
                  const el = e.currentTarget
                  const { text, cursor } = insertAt(body, el.selectionStart, el.selectionEnd, '  ')
                  setBody(text)
                  requestAnimationFrame(() => el.setSelectionRange(cursor, cursor))
                }
              }}
              className="font-mono text-[12.5px] leading-5"
              aria-describedby="tp-check"
            />
          </Field>
          <div id="tp-check" aria-live="polite" className="-mt-3">
            {check.ok ? (
              <p className="flex items-center gap-1.5 text-xs font-medium text-success">
                <CheckCircle2 size={14} aria-hidden /> JSON válido · {check.vars.length} {check.vars.length === 1 ? 'variável' : 'variáveis'}
              </p>
            ) : (
              <Alert tone="danger" title={check.line ? `JSON inválido na linha ${check.line}, coluna ${check.column}` : 'JSON inválido'}>
                <p>{check.error}</p>
                {check.lineText !== null && (
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-surface px-2.5 py-1.5 font-mono text-[12px] leading-5 text-fg">
                    {check.lineText || ' '}
                    {caret && `\n${caret}`}
                  </pre>
                )}
              </Alert>
            )}
          </div>
        </FormFieldset>

        <section>
          <BlockTitle icon={Send}>{API ? 'Prévia do modelo com dados de exemplo' : 'Prévia com dados de exemplo'}</BlockTitle>
          <p className="mb-2 font-mono text-[11.5px] leading-5 text-fg-3">
            POST · Content-Type: application/json
            <br />
            X-X2W-Event: {row.event}
            <br />
            X-X2W-Timestamp: 1760020320
            <br />
            X-X2W-Signature: {signature.slice(0, 46)}…
          </p>
          {preview ? <CodeBlock label="Prévia do corpo enviado">{preview}</CodeBlock> : <p className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center text-[13px] text-fg-3">Corrija o JSON para ver a prévia.</p>}
        </section>

        <section className="rounded-xl border border-line p-4">
          <BlockTitle
            icon={FlaskConical}
            aside={
              <Button
                size="sm"
                variant="primary"
                icon={Send}
                onClick={test}
                loading={testing}
                disabled={!check.ok || !canEdit || testBlocked || noDestApi}
                title={
                  !check.ok
                    ? 'Corrija o JSON para testar'
                    : !canEdit
                      ? 'Seu cargo não edita templates'
                      : testBlocked
                        ? 'O teste sai pelos destinos de webhook: exige editar webhooks'
                        : noDestApi
                          ? 'Este evento não tem destino ativo em Webhooks: não há para onde enviar'
                          : undefined
                }
              >
                Enviar teste
              </Button>
            }
          >
            Envio de teste
          </BlockTitle>
          <p className="text-[13px] text-fg-3">
            {activeDests.length
              ? testBlocked
                ? // o motivo fica visível (o title do botão não aparece no toque nem numa olhada rápida)
                  `O teste sai pelos destinos de webhook (${activeDests.length} ${activeDests.length === 1 ? 'ativo' : 'ativos'} para este evento): só quem edita webhooks pode enviar. Peça a quem tem essa permissão ou use "Testar agora" em Webhooks.`
                : API
                ? `Envia um POST de teste assinado, pelo servidor, para ${activeDests.length} ${activeDests.length === 1 ? 'destino ativo' : 'destinos ativos'}. O corpo não é a prévia acima: é o evento ${WEBHOOK_TEST_EVENT} (com "test": true e o evento do destino em data.destinationEvent).`
                : `Envia a prévia acima (com "test": true) para ${activeDests.length} ${activeDests.length === 1 ? 'destino ativo' : 'destinos ativos'}. Usa o corpo da tela, mesmo sem salvar.`
              : API
                ? 'Este evento não tem destino ativo em Webhooks: não há para onde enviar o teste. Cadastre ou ative um destino para este evento.'
                : 'Este evento não tem destino ativo: o teste vai para a caixa de inspeção da X2Win e não sai para fora (demonstração).'}
          </p>
          {serverTestBody && (
            <>
              <p className="mb-1.5 mt-3 font-mono text-[11.5px] text-fg-3">X-X2W-Event: {WEBHOOK_TEST_EVENT}</p>
              <CodeBlock label="Corpo do envio de teste" className="text-[11.5px]">
                {serverTestBody}
              </CodeBlock>
            </>
          )}
          {lastRun ? (
            <ul className="mt-3 space-y-2" aria-live="polite">
              {lastRun.targets.map((t, i) => (
                <li key={i} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-[13px]', t.ok ? 'bg-success/5' : 'bg-danger/5')}>
                  {t.ok ? <CheckCircle2 size={15} className="text-success" aria-hidden /> : <XCircle size={15} className="text-danger" aria-hidden />}
                  <Mono className="min-w-0 flex-1 truncate">{maskUrlTokens(t.url)}</Mono>
                  <Badge tone={t.ok ? 'success' : 'danger'}>{t.httpStatus ? `HTTP ${t.httpStatus}` : 'Sem resposta'}</Badge>
                  <span className="text-xs text-fg-3 tnum">{num(t.durationMs)} ms</span>
                  {!t.ok && <span className="w-full text-xs text-danger">{t.message}</span>}
                </li>
              ))}
            </ul>
          ) : row.lastTest ? (
            <p className="mt-3 text-xs text-fg-3">
              Último teste {relative(row.lastTest.at)}: {row.lastTest.ok ? 'sucesso' : row.lastTest.httpStatus ? `falha (HTTP ${row.lastTest.httpStatus})` : 'falha (sem resposta)'} · {num(row.lastTest.durationMs)} ms
            </p>
          ) : null}
        </section>
      </div>
    </Drawer>
  )
}
