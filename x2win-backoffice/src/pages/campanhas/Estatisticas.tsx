import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, AlertTriangle, CheckCircle2, CircleX, Clock, Gauge, Send, ShieldCheck, Timer, Webhook } from 'lucide-react'
import { BarsChart, DonutChart, type SeriesSlot } from '@/components/charts'
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  ChipFilter,
  CopyButton,
  DataTable,
  DateRangePicker,
  DescriptionList,
  Drawer,
  KpiCard,
  Mono,
  PageHeader,
  Select,
  inRange,
  presetRange,
  previousRange,
  rangeLabel,
  type Column,
  type DateRange,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { dateShort, dateTime, num, pct, relative } from '@/lib/format'
import { useWebhookDestinations, useWebhookExecutions } from '@/data/hooks'
import { NOW } from '@/data/now'
import { audit } from '@/domain/session'
import { WEBHOOK_EVENT_LABEL, type WebhookEvent, type WebhookExecution } from '@/domain/webhooks'
import { daysBetween, hasTokenLikeSegment, latencyTone, maskTokenUrl, prettyJson, rollingRange, webhookStats } from '@/domain/campanhas3-webhooks'
import { RateBar, TableFrame } from './_shared-c3'

const EVENT_SLOT: Record<WebhookEvent, SeriesSlot> = {
  'saque.solicitado': 1,
  'saque.pago': 3,
  'saque.rejeitado': 8,
  'saque.expirado': 4,
  'deposito.primeiro': 7,
}

const EVENTS = Object.keys(WEBHOOK_EVENT_LABEL) as WebhookEvent[]

function delta(cur: number, prev: number) {
  return prev ? (cur - prev) / prev : null
}

export default function Estatisticas() {
  const { items: executions } = useWebhookExecutions()
  const { items: destinations } = useWebhookDestinations()
  // a base de demonstração ancora as execuções em NOW (carga da página)
  const [range, setRangeRaw] = useState<DateRange>(() => rollingRange(presetRange('30d'), NOW.getTime()))
  const setRange = (r: DateRange) => setRangeRaw(rollingRange(r, NOW.getTime()))
  const [status, setStatus] = useState<'todas' | 'sucesso' | 'falha'>('todas')
  const [event, setEvent] = useState<'todos' | WebhookEvent>('todos')
  const [openId, setOpenId] = useState<string | null>(null)

  const inPeriod = useMemo(() => executions.filter((e) => inRange(e.at, range)), [executions, range])
  const prevPeriod = useMemo(() => {
    const pr = previousRange(range)
    return executions.filter((e) => inRange(e.at, pr))
  }, [executions, range])
  const days = useMemo(() => daysBetween(range.from, range.to), [range])
  const stats = useMemo(() => webhookStats(inPeriod, days), [inPeriod, days])
  const prev = useMemo(() => webhookStats(prevPeriod, []), [prevPeriod])
  const tokenDests = destinations.filter((d) => hasTokenLikeSegment(d.url))
  const destById = new Map(destinations.map((d) => [d.id, d]))

  const rows = inPeriod.filter((e) => (status === 'todas' || e.status === status) && (event === 'todos' || e.event === event))
  const statusCounts = { todas: inPeriod.length, sucesso: stats.success, falha: stats.failures }
  const open = openId ? inPeriod.find((e) => e.id === openId) ?? executions.find((e) => e.id === openId) : undefined

  const execColumns: Column<WebhookExecution>[] = [
    {
      id: 'at',
      header: 'Data e hora',
      pinned: true,
      sortValue: (e) => e.at,
      csv: (e) => dateTime(e.at),
      cell: (e) => (
        <div>
          <p className="whitespace-nowrap text-[13px] font-medium text-fg">{dateTime(e.at)}</p>
          <p className="text-xs text-fg-3">{relative(e.at)}</p>
        </div>
      ),
    },
    {
      id: 'event',
      header: 'Evento',
      sortValue: (e) => WEBHOOK_EVENT_LABEL[e.event],
      csv: (e) => WEBHOOK_EVENT_LABEL[e.event],
      cell: (e) => (
        <span className="inline-flex items-center gap-2 text-[13px] text-fg">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--chart-${EVENT_SLOT[e.event]})` }} aria-hidden />
          {WEBHOOK_EVENT_LABEL[e.event]}
        </span>
      ),
    },
    {
      id: 'url',
      header: 'Destino',
      csv: (e) => maskTokenUrl(e.url),
      cell: (e) => <Mono className="block max-w-[280px] truncate">{maskTokenUrl(e.url)}</Mono>,
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (e) => e.status,
      csv: (e) => (e.status === 'sucesso' ? 'Sucesso' : 'Falha'),
      cell: (e) => (
        <Badge tone={e.status === 'sucesso' ? 'success' : 'danger'} dot>
          {e.status === 'sucesso' ? 'Sucesso' : 'Falha'}
        </Badge>
      ),
    },
    {
      id: 'http',
      header: 'HTTP',
      align: 'center',
      sortValue: (e) => e.httpStatus,
      cell: (e) => <Mono className={cn('font-semibold', e.httpStatus < 300 ? 'text-success' : e.httpStatus < 500 ? 'text-warning' : 'text-danger')}>{e.httpStatus}</Mono>,
    },
    {
      id: 'duration',
      header: 'Duração',
      align: 'right',
      sortValue: (e) => e.durationMs,
      csv: (e) => e.durationMs,
      cell: (e) => <span className={cn('text-[13px] tnum', latencyTone(e.durationMs) === 'success' ? 'text-fg' : latencyTone(e.durationMs) === 'warning' ? 'text-warning' : 'text-danger')}>{num(e.durationMs)} ms</span>,
    },
  ]

  type EventRow = (typeof stats.byEvent)[number]
  const eventColumns: Column<EventRow>[] = [
    {
      id: 'event',
      header: 'Evento',
      pinned: true,
      sortValue: (r) => WEBHOOK_EVENT_LABEL[r.event],
      csv: (r) => WEBHOOK_EVENT_LABEL[r.event],
      cell: (r) => (
        <button type="button" onClick={() => setEvent(r.event)} className="inline-flex items-center gap-2 text-[13px] font-medium text-fg hover:text-primary-text">
          <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: `var(--chart-${EVENT_SLOT[r.event]})` }} aria-hidden />
          {WEBHOOK_EVENT_LABEL[r.event]}
        </button>
      ),
    },
    { id: 'total', header: 'Execuções', align: 'right', sortValue: (r) => r.total, cell: (r) => <span className="font-semibold">{num(r.total)}</span> },
    { id: 'share', header: 'Participação', sortValue: (r) => r.total, csv: (r) => (stats.total ? ((r.total / stats.total) * 100).toFixed(1) : 0), cell: (r) => <RateBar value={r.total} total={stats.total} tone="primary" showCount={false} /> },
    { id: 'success', header: 'Sucesso', sortValue: (r) => (r.total ? r.success / r.total : 0), csv: (r) => r.success, cell: (r) => <RateBar value={r.success} total={r.total} tone="success" /> },
    { id: 'failures', header: 'Falhas', align: 'right', sortValue: (r) => r.failures, cell: (r) => <span className={r.failures ? 'font-semibold text-danger' : 'text-fg-3'}>{num(r.failures)}</span> },
    { id: 'avg', header: 'Tempo médio', align: 'right', sortValue: (r) => r.avgMs, csv: (r) => r.avgMs, cell: (r) => <Badge tone={latencyTone(r.avgMs)}>{`${num(r.avgMs)} ms`}</Badge> },
    { id: 'last', header: 'Última execução', sortValue: (r) => r.lastAt ?? '', csv: (r) => (r.lastAt ? dateTime(r.lastAt) : ''), cell: (r) => <span className="whitespace-nowrap text-[13px] text-fg-2">{r.lastAt ? relative(r.lastAt) : '—'}</span> },
  ]

  return (
    <>
      <PageHeader actions={<DateRangePicker value={range} onChange={setRange} />} />

      <div className="space-y-5">
        {tokenDests.length > 0 && (
          <Alert
            tone="warning"
            icon={AlertTriangle}
            title={`${tokenDests.length} ${tokenDests.length === 1 ? 'destino tem' : 'destinos têm'} trecho com cara de token na URL`}
            action={
              <Link to="/campanhas/webhooks" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-surface px-2.5 text-[13px] font-medium text-fg ring-1 ring-inset ring-line-strong hover:bg-surface-3">
                <Webhook size={14} aria-hidden /> Revisar webhooks
              </Link>
            }
          >
            Tokens no caminho da URL aparecem em logs de servidores e proxies. Aqui o trecho fica mascarado ({tokenDests.map((d) => maskTokenUrl(d.url)).join(', ')}). Prefira mandar o token no cabeçalho ou usar a assinatura HMAC.
          </Alert>
        )}

        <section aria-label="Resumo das execuções" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Execuções"
            icon={Send}
            value={num(stats.total)}
            delta={prev.total ? delta(stats.total, prev.total) : undefined}
            hint={prev.total ? 'vs período anterior' : 'sem dados do período anterior'}
            formula="Chamadas HTTP feitas aos destinos de webhook no período, uma por evento e destino ativo."
          />
          <KpiCard
            label="Taxa de sucesso"
            icon={ShieldCheck}
            tone={stats.successRate === null || stats.successRate >= 0.99 ? 'success' : stats.successRate >= 0.95 ? 'warning' : 'danger'}
            value={stats.successRate === null ? '—' : pct(stats.successRate)}
            hint={`${num(stats.success)} respostas 2xx`}
            formula="Execuções com resposta HTTP 2xx ÷ total de execuções."
            onClick={() => setStatus('sucesso')}
            active={status === 'sucesso'}
          />
          <KpiCard
            label="Falhas"
            icon={CircleX}
            tone={stats.failures ? 'danger' : 'neutral'}
            value={num(stats.failures)}
            hint={stats.failures ? 'timeout ou resposta fora de 2xx' : 'nenhuma no período'}
            onClick={() => setStatus('falha')}
            active={status === 'falha'}
          />
          <KpiCard
            label="Tempo médio de resposta"
            icon={Timer}
            tone={latencyTone(stats.avgMs) === 'success' ? 'info' : latencyTone(stats.avgMs)}
            value={`${num(stats.avgMs)} ms`}
            delta={prev.total ? delta(stats.avgMs, prev.avgMs) : undefined}
            goodWhenUp={false}
            hint={`p95: ${num(stats.p95Ms)} ms`}
            formula="Média do tempo entre o envio e a resposta do destino. p95 = 95% das chamadas responderam abaixo desse tempo."
          />
        </section>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
          <Card className="xl:col-span-3">
            <CardHeader icon={Activity} title="Execuções por dia" description={`${rangeLabel(range)}${range.preset !== 'custom' ? ' · janela móvel' : ''}`} />
            <CardBody>
              <BarsChart
                ariaLabel="Execuções de webhook por dia"
                data={stats.byDay}
                xKey="date"
                xFormat={(k) => dateShort(`${k}T12:00:00`)}
                stacked
                height={260}
                showLegend
                series={[
                  { key: 'sucesso', label: 'Sucesso', slot: 3 },
                  { key: 'falha', label: 'Falha', slot: 8 },
                ]}
              />
            </CardBody>
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader icon={Gauge} title="Participação por evento" description="Execuções no período" />
            <CardBody>
              {stats.total ? (
                <DonutChart
                  ariaLabel="Execuções por evento"
                  height={170}
                  centerValue={num(stats.total)}
                  centerLabel="execuções"
                  data={stats.byEvent.map((r) => ({ label: WEBHOOK_EVENT_LABEL[r.event], value: r.total, slot: EVENT_SLOT[r.event] }))}
                />
              ) : (
                <p className="py-12 text-center text-[13px] text-fg-3">Sem execuções no período.</p>
              )}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader icon={Webhook} title="Resumo por evento" description="Clique no evento para filtrar as execuções abaixo" />
          <DataTable
            bare
            caption="Execuções por evento"
            rows={stats.byEvent}
            columns={eventColumns}
            rowKey={(r) => r.event}
            columnPicker={false}
            initialSort={{ id: 'total', dir: 'desc' }}
            exportName="webhooks-por-evento"
            onExport={(n) => audit('exportar', 'Estatísticas de webhooks', `Exportação CSV de ${n} eventos (${rangeLabel(range)})`)}
            pageSize={10}
            empty={{ title: 'Sem execuções no período', description: 'Escolha um período maior.', icon: Webhook }}
          />
        </Card>

        <TableFrame>
          <DataTable
            caption="Execuções recentes"
            rows={rows}
            columns={execColumns}
            rowKey={(e) => e.id}
            searchText={(e) => `${e.id} ${e.url} ${WEBHOOK_EVENT_LABEL[e.event]} ${e.httpStatus}`}
            searchPlaceholder="Buscar por destino ou código"
            initialSort={{ id: 'at', dir: 'desc' }}
            exportName="webhooks-execucoes"
            onExport={(n) => audit('exportar', 'Estatísticas de webhooks', `Exportação CSV de ${n} execuções (${rangeLabel(range)})`)}
            onRowClick={(e) => setOpenId(e.id)}
            resetKey={`${status}-${event}-${range.from.getTime()}`}
            toolbar={
              <>
                <ChipFilter
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: 'todas', label: 'Todas', count: statusCounts.todas },
                    { value: 'sucesso', label: 'Sucesso', count: statusCounts.sucesso },
                    { value: 'falha', label: 'Falha', count: statusCounts.falha, tone: 'danger' },
                  ]}
                />
                <div className="w-full sm:w-52">
                  <label htmlFor="ex-event" className="sr-only">
                    Filtrar por evento
                  </label>
                  <Select
                    id="ex-event"
                    value={event}
                    onChange={(v) => setEvent(v as typeof event)}
                    className="[&_select]:h-9"
                    options={[{ value: 'todos', label: 'Todos os eventos' }, ...EVENTS.map((e) => ({ value: e, label: WEBHOOK_EVENT_LABEL[e] }))]}
                  />
                </div>
              </>
            }
            empty={{ title: 'Nenhuma execução neste filtro', description: 'Troque o status, o evento ou o período.', icon: Webhook }}
          />
        </TableFrame>
      </div>

      <Drawer
        open={!!open}
        onClose={() => setOpenId(null)}
        title={open ? WEBHOOK_EVENT_LABEL[open.event] : ''}
        description={open ? `${dateTime(open.at)} · ${relative(open.at)}` : undefined}
        headerExtra={
          open && (
            <Badge tone={open.status === 'sucesso' ? 'success' : 'danger'} dot size="md">
              {open.status === 'sucesso' ? 'Sucesso' : 'Falha'}
            </Badge>
          )
        }
      >
        {open && <ExecutionDetail e={open} destActive={destById.get(open.destinationId)?.active ?? null} />}
      </Drawer>
    </>
  )
}

function ExecutionDetail({ e, destActive }: { e: WebhookExecution; destActive: boolean | null }) {
  const body = prettyJson(e.payload)
  const tone = latencyTone(e.durationMs)
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-surface-2 px-3 py-2.5">
          <p className="text-xs text-fg-3">HTTP</p>
          <p className={cn('mt-0.5 font-mono text-xl font-bold', e.httpStatus < 300 ? 'text-success' : 'text-danger')}>{e.httpStatus}</p>
        </div>
        <div className="rounded-xl bg-surface-2 px-3 py-2.5">
          <p className="text-xs text-fg-3">Duração</p>
          <p className={cn('mt-0.5 font-display text-xl font-bold tnum', tone === 'success' ? 'text-fg' : tone === 'warning' ? 'text-warning' : 'text-danger')}>{num(e.durationMs)} ms</p>
        </div>
        <div className="rounded-xl bg-surface-2 px-3 py-2.5">
          <p className="text-xs text-fg-3">Tentativas</p>
          <p className="mt-0.5 font-display text-xl font-bold text-fg tnum">1</p>
        </div>
      </div>
      <DescriptionList
        items={[
          { label: 'Destino', value: <Mono className="break-all">{`POST https://${maskTokenUrl(e.url)}`}</Mono>, full: true },
          { label: 'ID da execução', value: <Mono>{e.id}</Mono> },
          { label: 'Destino hoje', value: destActive === null ? 'Removido' : destActive ? 'Ativo' : 'Pausado' },
        ]}
      />
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
          <Clock size={14} className="text-fg-3" aria-hidden /> Cabeçalhos enviados
        </h3>
        <pre className="overflow-x-auto rounded-xl border border-line bg-surface-2 p-3 font-mono text-[12px] leading-5 text-fg-2">
          {`Content-Type: application/json\nUser-Agent: X2Win-Webhooks/1.0\nX-X2Win-Event: ${e.event}\nX-X2Win-Delivery: ${e.id}\nX-X2Win-Signature: sha256=••••••••••••`}
        </pre>
        <p className="mt-1.5 text-xs text-fg-3">A assinatura HMAC usa o segredo do destino, que nunca é exibido.</p>
      </section>
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-fg">Corpo (JSON)</h3>
          <CopyButton value={body} label="Copiar JSON" />
        </div>
        <pre className="max-h-80 overflow-auto rounded-xl border border-line bg-surface-2 p-3 font-mono text-[12.5px] leading-5 text-fg" aria-label="Corpo da requisição">
          <JsonHighlight json={body} />
        </pre>
      </section>
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
          {e.status === 'sucesso' ? <CheckCircle2 size={14} className="text-success" aria-hidden /> : <CircleX size={14} className="text-danger" aria-hidden />} Resposta do destino
        </h3>
        <pre className="overflow-x-auto rounded-xl border border-line bg-surface-2 p-3 font-mono text-[12px] leading-5 text-fg-2">
          {e.status === 'sucesso' ? `HTTP/1.1 ${e.httpStatus} OK\n\n{"received": true}` : `HTTP/1.1 ${e.httpStatus}\n\n(sem corpo)`}
        </pre>
      </section>
    </div>
  )
}

/** Realce simples de JSON com cores do tema. */
function JsonHighlight({ json }: { json: string }) {
  const parts = json.split(/("(?:[^"\\]|\\.)*"\s*:|"(?:[^"\\]|\\.)*"|\b-?\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b|\bnull\b)/g)
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null
        if (/^".*":$/.test(p.replace(/\s+/g, ''))) return <span key={i} className="text-primary-text">{p}</span>
        if (p.startsWith('"')) return <span key={i} className="text-success">{p}</span>
        if (/^(-?\d|true|false|null)/.test(p)) return <span key={i} className="text-warning">{p}</span>
        return <span key={i}>{p}</span>
      })}
    </>
  )
}
