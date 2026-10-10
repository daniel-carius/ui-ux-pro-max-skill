import { useMemo, useState } from 'react'
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
  PageLink,
  Select,
  inRange,
  presetRange,
  previousRange,
  rangeLabel,
  type Column,
  type DateRange,
} from '@/components/ui'
import { WEBHOOK_MAX_ATTEMPTS } from '@shared/api'
import { cn } from '@/lib/cn'
import { isApiMode } from '@/lib/api'
import { date, dateShort, dateTime, num, pct, plural, relative, time } from '@/lib/format'
import { useWebhookDestinations, useWebhookExecutions } from '@/data/hooks'
import { NOW } from '@/data/now'
import { audit } from '@/domain/session'
import { WEBHOOK_EVENT_LABEL, WEBHOOK_TEST_EVENT, isTestExecution, type WebhookEvent, type WebhookExecution } from '@/domain/webhooks'
import { daysBetween, hasTokenLikeSegment, latencyTone, maskTokenUrl, prettyJson, rollingRange, webhookStats } from '@/domain/campanhas3-webhooks'
import { attemptLabel, destinationReceives, isDemoExecution, isRealDelivery, retryingAttempts } from '@/domain/campanhas-webhooks'
import { RateBar, TableFrame } from './_shared-c3'

const EVENT_SLOT: Record<WebhookEvent, SeriesSlot> = {
  'saque.solicitado': 1,
  'saque.pago': 3,
  'saque.rejeitado': 8,
  'saque.expirado': 4,
  'deposito.primeiro': 7,
}

const EVENTS = Object.keys(WEBHOOK_EVENT_LABEL) as WebhookEvent[]

const API = isApiMode()

type StatusFilter = 'todas' | 'sucesso' | 'falha' | 'teste'

/** Linha da lista no filtro de status: sucesso e falha são entregas de verdade; testes ficam no próprio filtro. */
function matchesStatus(e: WebhookExecution, status: StatusFilter) {
  if (status === 'todas') return true
  if (status === 'teste') return isTestExecution(e)
  return !isTestExecution(e) && e.status === status
}

function delta(cur: number, prev: number) {
  return prev ? (cur - prev) / prev : null
}

export default function Estatisticas() {
  const { items: executions } = useWebhookExecutions()
  const { items: destinations } = useWebhookDestinations()
  // a base de demonstração ancora as execuções em NOW (carga da página)
  const [range, setRangeRaw] = useState<DateRange>(() => rollingRange(presetRange('30d'), NOW.getTime()))
  const setRange = (r: DateRange) => setRangeRaw(rollingRange(r, NOW.getTime()))
  const [status, setStatus] = useState<StatusFilter>('todas')
  const [event, setEvent] = useState<'todos' | WebhookEvent>('todos')
  const [openId, setOpenId] = useState<string | null>(null)

  // modo API: registros semeados com DEMO_DATA para destinos de demonstração (o servidor nunca envia para eles)
  // ficam fora da tela inteira; o aviso abaixo diz quantos
  const listed = useMemo(() => executions.filter((e) => !isDemoExecution(e, API)), [executions])
  const demoHidden = executions.length - listed.length
  const inPeriod = useMemo(() => listed.filter((e) => inRange(e.at, range)), [listed, range])
  const prevPeriod = useMemo(() => {
    const pr = previousRange(range)
    return listed.filter((e) => inRange(e.at, pr))
  }, [listed, range])
  const days = useMemo(() => daysBetween(range.from, range.to), [range])
  // envios de teste (botão "Testar" e teste de template) não são execuções reais: ficam na lista, no filtro "Testes",
  // mas fora das contagens, da taxa de sucesso e da "Última execução" (mesma definição de Webhooks: isRealDelivery)
  const stats = useMemo(() => webhookStats(inPeriod.filter((e) => isRealDelivery(e, API)), days), [inPeriod, days])
  const prev = useMemo(() => webhookStats(prevPeriod.filter((e) => isRealDelivery(e, API)), []), [prevPeriod])
  const tokenDests = destinations.filter((d) => hasTokenLikeSegment(d.url))
  const destById = new Map(destinations.map((d) => [d.id, d]))

  const byEvent = inPeriod.filter((e) => event === 'todos' || e.event === event)
  const rows = byEvent.filter((e) => matchesStatus(e, status))
  // cada chip conta exatamente as linhas que mostra: Todas = Sucesso + Falha + Testes
  const statusCounts: Record<StatusFilter, number> = {
    todas: byEvent.length,
    sucesso: byEvent.filter((e) => matchesStatus(e, 'sucesso')).length,
    falha: byEvent.filter((e) => matchesStatus(e, 'falha')).length,
    teste: byEvent.filter((e) => matchesStatus(e, 'teste')).length,
  }
  const open = openId ? inPeriod.find((e) => e.id === openId) ?? executions.find((e) => e.id === openId) : undefined
  // tabela por evento vazia: diz por quê. Sem nenhuma execução real, um período maior não ajuda; com execuções
  // fora do período, aponta a mais antiga (o seletor também aceita datas livres)
  const realListed = listed.filter((e) => isRealDelivery(e, API))
  // entregas que o servidor ainda vai tentar de novo (tentativa mais recente → horário previsto da próxima)
  const retrying = useMemo(() => retryingAttempts(listed), [listed])
  const oldest = realListed.reduce<string | null>((min, e) => (min === null || e.at < min ? e.at : min), null)
  const realDests = destinations.filter((d) => destinationReceives(d, API)).length
  const eventsEmpty = !realListed.length
    ? {
        title: 'Nenhuma execução ainda',
        description: realDests
          ? 'Os destinos ativos recebem os eventos quando eles acontecem (saques e depósitos). Testes não contam aqui.'
          : 'Nenhum destino ativo fora da demonstração. Cadastre um em Webhooks para receber eventos.',
        icon: Webhook,
      }
    : oldest && new Date(oldest).getTime() < range.from.getTime()
      ? { title: 'Sem execuções no período', description: `Escolha um período maior: a execução mais antiga é de ${date(oldest)}.`, icon: Webhook }
      : { title: 'Sem execuções no período', description: 'Nenhuma execução entre estas datas.', icon: Webhook }
  // lista de execuções vazia: mesmo raciocínio, mas aqui os testes contam. Só sugere trocar status ou evento
  // quando um deles está aplicado e o período tem execuções
  const oldestListed = listed.reduce<string | null>((min, e) => (min === null || e.at < min ? e.at : min), null)
  const execsEmpty = !listed.length
    ? {
        title: 'Nenhuma execução ainda',
        description: realDests
          ? 'Os destinos ativos recebem os eventos quando eles acontecem (saques e depósitos).'
          : 'Nenhum destino ativo fora da demonstração. Cadastre um em Webhooks para receber eventos.',
        icon: Webhook,
      }
    : !inPeriod.length
      ? oldestListed && new Date(oldestListed).getTime() < range.from.getTime()
        ? { title: 'Sem execuções no período', description: `Escolha um período maior: a execução mais antiga é de ${date(oldestListed)}.`, icon: Webhook }
        : { title: 'Sem execuções no período', description: 'Nenhuma execução entre estas datas.', icon: Webhook }
      : { title: 'Nenhuma execução neste filtro', description: event === 'todos' ? 'Troque o status.' : status === 'todas' ? 'Troque o evento.' : 'Troque o status ou o evento.', icon: Webhook }

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
      csv: (e) => `${e.status === 'sucesso' ? 'Sucesso' : 'Falha'}${isTestExecution(e) ? ' (teste)' : ''}${attemptLabel(e) ? ` (${attemptLabel(e)})` : ''}`,
      cell: (e) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Badge tone={e.status === 'sucesso' ? 'success' : 'danger'} dot>
            {e.status === 'sucesso' ? 'Sucesso' : 'Falha'}
          </Badge>
          {isTestExecution(e) && <Badge tone="info">Teste</Badge>}
          {attemptLabel(e) && <span className="whitespace-nowrap text-xs text-fg-3">{attemptLabel(e)}</span>}
        </span>
      ),
    },
    {
      id: 'http',
      header: 'HTTP',
      align: 'center',
      sortValue: (e) => e.httpStatus,
      cell: (e) => <Mono className={cn('font-semibold', httpTone(e.httpStatus))}>{httpLabel(e.httpStatus)}</Mono>,
    },
    {
      id: 'duration',
      header: 'Duração',
      label: 'Duração (ms)',
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
    {
      id: 'share',
      header: 'Participação',
      sortValue: (r) => r.total,
      // CSV no padrão brasileiro: "40,3%" (antes "40.3", com ponto e sem %)
      csv: (r) => `${(stats.total ? (r.total / stats.total) * 100 : 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`,
      cell: (r) => <RateBar value={r.total} total={stats.total} tone="primary" showCount={false} />,
    },
    { id: 'success', header: 'Sucesso', sortValue: (r) => (r.total ? r.success / r.total : 0), csv: (r) => r.success, cell: (r) => <RateBar value={r.success} total={r.total} tone="success" /> },
    { id: 'failures', header: 'Falhas', align: 'right', sortValue: (r) => r.failures, cell: (r) => <span className={r.failures ? 'font-semibold text-danger' : 'text-fg-3'}>{num(r.failures)}</span> },
    {
      id: 'avg',
      header: 'Tempo médio',
      label: 'Tempo médio (ms)',
      align: 'right',
      sortValue: (r) => r.avgMs ?? -1,
      csv: (r) => r.avgMs,
      // sem nenhuma resposta do destino não há tempo para medir
      cell: (r) => (r.avgMs === null ? <span className="text-xs text-fg-3" title="Nenhuma resposta do destino">—</span> : <Badge tone={latencyTone(r.avgMs)}>{`${num(r.avgMs)} ms`}</Badge>),
    },
    { id: 'last', header: 'Última execução', sortValue: (r) => r.lastAt ?? '', csv: (r) => (r.lastAt ? dateTime(r.lastAt) : ''), cell: (r) => <span className="whitespace-nowrap text-[13px] text-fg-2">{r.lastAt ? relative(r.lastAt) : '—'}</span> },
  ]

  return (
    <>
      <PageHeader actions={<DateRangePicker value={range} onChange={setRange} />} />

      <div className="space-y-5">
        {demoHidden > 0 && (
          <Alert tone="info" title={`${plural(demoHidden, 'registro de demonstração fica', 'registros de demonstração ficam')} fora desta tela`}>
            São entregas fictícias gravadas com os dados de demonstração para destinos de terceiros (hooks.x2win-crm.com, api.leadflow.app), que o
            servidor nunca chama. Não entram nas contagens nem na lista.
          </Alert>
        )}
        {tokenDests.length > 0 && (
          <Alert
            tone="warning"
            icon={AlertTriangle}
            title={`${tokenDests.length} ${tokenDests.length === 1 ? 'destino tem' : 'destinos têm'} trecho com cara de token na URL`}
            action={
              <PageLink to="/campanhas/webhooks" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-surface px-2.5 text-[13px] font-medium text-fg ring-1 ring-inset ring-line-strong hover:bg-surface-3">
                <Webhook size={14} aria-hidden /> Revisar webhooks
              </PageLink>
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
            formula={`Chamadas HTTP feitas aos destinos de webhook no período. Cada tentativa conta: quando o destino falha, a mesma entrega é tentada de novo, até ${WEBHOOK_MAX_ATTEMPTS} vezes. Envios de teste ficam de fora.`}
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
            tone={stats.avgMs === null ? 'neutral' : latencyTone(stats.avgMs) === 'success' ? 'info' : latencyTone(stats.avgMs)}
            value={stats.avgMs === null ? '—' : `${num(stats.avgMs)} ms`}
            delta={stats.avgMs !== null && prev.avgMs !== null ? delta(stats.avgMs, prev.avgMs) : undefined}
            goodWhenUp={false}
            hint={stats.p95Ms === null ? (stats.total ? 'nenhum destino respondeu' : 'nenhuma execução no período') : `p95: ${num(stats.p95Ms)} ms`}
            formula="Média do tempo entre o envio e a resposta do destino, só das execuções com resposta HTTP: sem resposta (endereço que não resolve, conexão recusada, tempo esgotado) não há o que medir. p95 = 95% das chamadas responderam abaixo desse tempo."
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
            empty={eventsEmpty}
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
                    { value: 'teste', label: 'Testes', count: statusCounts.teste },
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
            empty={execsEmpty}
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
        {open && <ExecutionDetail e={open} destActive={destById.get(open.destinationId)?.active ?? null} nextAt={retrying.get(open.id) ?? null} />}
      </Drawer>
    </>
  )
}

/** Status HTTP 0 = sem resposta (conexão, DNS, tempo esgotado): falha, nunca verde. */
function httpLabel(status: number) {
  return status > 0 ? String(status) : 'sem resposta'
}
function httpTone(status: number) {
  if (status <= 0) return 'text-danger'
  return status < 300 ? 'text-success' : status < 500 ? 'text-warning' : 'text-danger'
}

function ExecutionDetail({ e, destActive, nextAt }: { e: WebhookExecution; destActive: boolean | null; nextAt: number | null }) {
  const body = prettyJson(e.payload)
  const tone = latencyTone(e.durationMs)
  // teste: sai como webhook.teste; a execução fica no evento do destino
  const test = isTestExecution(e)
  // o que o destino recebeu: id da entrega (o mesmo em todas as tentativas) e o timestamp assinado. Demonstração:
  // o envio é simulado e usa o id da execução
  const deliveryId = e.deliveryId ?? (API ? 'não registrado' : e.id)
  const timestamp = e.timestamp != null ? String(e.timestamp) : API ? (e.httpStatus > 0 ? 'não registrado' : 'não enviado') : String(Math.floor(new Date(e.at).getTime() / 1000))
  // modo API: sem X-X2W-Timestamp e sem resposta, o envio parou antes de conectar (endereço recusado ou que não
  // resolve): o servidor nem assina, então nada saiu (antes a tela listava os cabeçalhos, com assinatura, como enviados)
  const notSent = API && e.timestamp == null && e.httpStatus <= 0
  // entrega real que falhou antes da última tentativa: o servidor tenta de novo, salvo se o destino mudou ou saiu
  const moreAttempts = !test && e.status === 'falha' && !!e.attempt && e.attempt < WEBHOOK_MAX_ATTEMPTS
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-surface-2 px-3 py-2.5">
          <p className="text-xs text-fg-3">HTTP</p>
          <p className={cn('mt-0.5 font-mono font-bold', e.httpStatus > 0 ? 'text-xl' : 'text-base leading-7', httpTone(e.httpStatus))}>{httpLabel(e.httpStatus)}</p>
        </div>
        <div className="rounded-xl bg-surface-2 px-3 py-2.5">
          <p className="text-xs text-fg-3">Duração</p>
          <p className={cn('mt-0.5 font-display text-xl font-bold tnum', tone === 'success' ? 'text-fg' : tone === 'warning' ? 'text-warning' : 'text-danger')}>{num(e.durationMs)} ms</p>
        </div>
        <div className="rounded-xl bg-surface-2 px-3 py-2.5">
          <p className="text-xs text-fg-3">Tentativa</p>
          {/* teste: envio único, nunca repetido. Modo API: número gravado pelo servidor; registro antigo não tem.
              Demonstração: uma tentativa simulada */}
          <p className={cn('mt-0.5 font-display font-bold text-fg tnum', test || e.attempt || !API ? 'text-xl' : 'text-base leading-7 text-fg-3')}>
            {test ? 'Única' : e.attempt ? `${e.attempt} de ${WEBHOOK_MAX_ATTEMPTS}` : API ? 'não registrada' : '1'}
          </p>
        </div>
      </div>
      <DescriptionList
        items={[
          // e.url vem com os trechos sensíveis mascarados: só para exibir (o destino é o destinationId)
          { label: 'Destino', value: <Mono className="break-all">{`POST https://${maskTokenUrl(e.url)}`}</Mono>, full: true },
          { label: 'ID da execução', value: <Mono>{e.id}</Mono> },
          { label: 'ID da entrega (X-X2W-Delivery)', value: <Mono>{deliveryId}</Mono> },
          ...(test ? [{ label: 'Origem', value: `Envio de teste (${WEBHOOK_TEST_EVENT})` }] : []),
          { label: 'Destino hoje', value: destActive === null ? 'Removido' : destActive ? 'Ativo' : 'Pausado' },
        ]}
      />
      {moreAttempts && (
        <p className="text-xs text-fg-3">
          {destActive === null
            ? 'O destino foi removido depois desta tentativa: as tentativas que faltavam foram canceladas.'
            : `${nextAt !== null ? `Entrega em nova tentativa: a próxima está prevista para as ${time(nextAt)}. ` : ''}O servidor tenta de novo até ${WEBHOOK_MAX_ATTEMPTS} vezes, com intervalos crescentes. Se o endereço ou o evento do destino mudou, ou ele foi removido, as tentativas que faltavam são canceladas (a Auditoria registra quantas).`}
        </p>
      )}
      {notSent ? (
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
            <CircleX size={14} className="text-danger" aria-hidden /> Nada foi enviado
          </h3>
          <p className="rounded-xl border border-line bg-surface-2 p-3 text-[13px] leading-5 text-fg-2">
            {`O envio parou antes de conectar ao destino${e.error ? ` (${e.error.replace(/\.$/, '')})` : ''}: nenhum cabeçalho, assinatura ou corpo saiu do servidor.`}
          </p>
        </section>
      ) : (
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
            <Clock size={14} className="text-fg-3" aria-hidden /> Cabeçalhos enviados
          </h3>
          <pre className="overflow-x-auto rounded-xl border border-line bg-surface-2 p-3 font-mono text-[12px] leading-5 text-fg-2">
            {`Content-Type: application/json\nUser-Agent: X2Win-Webhooks/1.0\nX-X2W-Event: ${test ? WEBHOOK_TEST_EVENT : e.event}\nX-X2W-Delivery: ${deliveryId}\nX-X2W-Timestamp: ${timestamp}\nX-X2W-Signature: sha256=••••••••••••`}
          </pre>
          <p className="mt-1.5 text-xs text-fg-3">
            {test
              ? 'Envio de teste: sai uma vez só, sem novas tentativas. '
              : 'X-X2W-Delivery é o mesmo em todas as tentativas da entrega: quem recebe usa para não processar duas vezes. '}
            A assinatura HMAC usa o segredo do destino, que nunca é exibido.
          </p>
        </section>
      )}
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-fg">{notSent ? 'Corpo (JSON) preparado, não enviado' : 'Corpo (JSON)'}</h3>
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
          {e.httpStatus > 0 ? `HTTP/1.1 ${e.httpStatus}\n\n(o corpo da resposta não é guardado)` : 'Sem resposta do destino.'}
        </pre>
        {e.httpStatus === 0 && (
          <p className="mt-1.5 text-xs text-danger">
            {e.error || 'O destino não respondeu: falha de conexão, endereço que não resolve ou tempo esgotado.'}
          </p>
        )}
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
