import { useState } from 'react'
import { CircleCheck, CircleX, FlaskConical, MousePointerClick, Radar, Server, Trash2, TriangleAlert, Zap } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  FormFieldset,
  Input,
  KpiCard,
  MoneyInput,
  Mono,
  PageHeader,
  SaveBar,
  SecretField,
  Select,
  SettingsSection,
  Switch,
  confirm,
  toast,
  useSettingsForm,
} from '@/components/ui'
import { brl, dateTime, num, relative, time } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useDb } from '@/lib/store'
import { isApiMode } from '@/lib/api'
import { uid } from '@/lib/random'
import { DEFAULT_TRACKING, TRACKING_KEYS, seedTrackingTests } from '@/data/config2-tracking'
import { audit, usePageAccess } from '@/domain/session'
import {
  EVENTS,
  EVENT_BY_ID,
  PAGEVIEW_PAGES,
  PLATFORMS,
  PLATFORM_BY_ID,
  simulateTrackingTest,
  validatePixelId,
  validateTracking,
  type PlatformConfig,
  type TrackingConfig,
  type TrackingEvent,
  type TrackingPlatform,
  type TrackingTestEntry,
} from '@/domain/config2-tracking'
import { PlatformMark } from './_shared-g'

export default function Tracking() {
  const { canEdit } = usePageAccess()
  const form = useSettingsForm<TrackingConfig>(TRACKING_KEYS.config, DEFAULT_TRACKING, {
    entity: 'Pixels e tracking',
    successMessage: 'Pixels salvos',
    validate: validateTracking,
  })
  const v = form.values
  const setPlatform = (id: TrackingPlatform, patch: Partial<PlatformConfig>) => form.set('platforms', { ...v.platforms, [id]: { ...v.platforms[id], ...patch } })
  const setEvent = (id: TrackingPlatform, ev: TrackingEvent, on: boolean) => setPlatform(id, { events: { ...v.platforms[id].events, [ev]: on } })

  const active = PLATFORMS.filter((p) => v.platforms[p.id].active)
  const eventsOn = active.reduce((s, p) => s + EVENTS.filter((e) => v.platforms[p.id].events[e.id]).length, 0)
  const withServer = active.filter((p) => v.platforms[p.id].token && v.serverSide)
  const [tests] = useDb<TrackingTestEntry[]>(TRACKING_KEYS.tests, seedTrackingTests)
  const last = tests[0]

  return (
    <>
      <PageHeader />
      <div className="space-y-5">
        <section aria-label="Resumo" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Pixels ligados" icon={Radar} value={`${active.length} de ${PLATFORMS.length}`} hint={active.map((p) => p.name.split(' ')[0]).join(', ') || 'nenhum'} />
          <KpiCard label="Eventos ligados" icon={MousePointerClick} tone="info" value={num(eventsOn)} hint={`de ${active.length * EVENTS.length} possíveis nos pixels ligados`} />
          <KpiCard
            label="API de conversões"
            icon={Server}
            tone={withServer.length === active.length && active.length ? 'success' : 'warning'}
            value={`${withServer.length} de ${active.length}`}
            hint={withServer.length < active.length ? 'pixels sem envio pelo servidor' : 'todos com envio pelo servidor'}
            formula={<>Pixels ligados que também enviam pelo servidor (token preenchido e envio pelo servidor ligado). Sem isso, bloqueadores de anúncio derrubam parte dos eventos.</>}
          />
          <KpiCard
            label="Último teste"
            icon={FlaskConical}
            tone={!last ? 'neutral' : last.status === 'ok' ? 'success' : last.status === 'aviso' ? 'warning' : 'danger'}
            value={last ? (last.status === 'ok' ? 'Recebido' : last.status === 'aviso' ? 'Parcial' : 'Falhou') : '—'}
            hint={last ? `${PLATFORM_BY_ID[last.platform].name.split(' ')[0]} · ${last.eventName} · ${relative(last.at)}` : 'nenhum teste ainda'}
          />
        </section>

        <FormFieldset readOnly={form.readOnly}>
          <div className="grid gap-4 lg:grid-cols-2">
            {PLATFORMS.map((p) => (
              <PlatformCard key={p.id} id={p.id} cfg={v.platforms[p.id]} serverSide={v.serverSide} onChange={(patch) => setPlatform(p.id, patch)} />
            ))}
          </div>

          <Card className="min-w-0">
            <CardHeader
              icon={Zap}
              title="Eventos por plataforma"
              description="Cada evento usa o nome padrão da plataforma, para as campanhas otimizarem sozinhas."
            />
            <div className="overflow-x-auto border-t border-line">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Matriz de eventos por plataforma</caption>
                <thead>
                  <tr className="border-b border-line bg-surface-2/80">
                    <th scope="col" className="h-11 min-w-[220px] px-4 text-left text-xs font-semibold text-fg-3">
                      Evento no site
                    </th>
                    {PLATFORMS.map((p) => (
                      <th key={p.id} scope="col" className="h-11 min-w-[170px] px-3 text-left text-xs font-semibold text-fg-3">
                        <span className="inline-flex items-center gap-2">
                          <PlatformMark letter={p.short} slot={p.slot} size={20} />
                          {p.id === 'ga4' ? 'GA4' : p.name.split(' ')[0]}
                          {!v.platforms[p.id].active && <Badge>desligado</Badge>}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {EVENTS.map((e) => (
                    <tr key={e.id} className="border-b border-line/70 last:border-0">
                      <th scope="row" className="px-4 py-3 text-left align-top font-normal">
                        <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-fg">
                          {e.label}
                          {e.sendsValue && <Badge tone="success">envia valor em BRL</Badge>}
                        </p>
                        <p className="mt-0.5 text-xs text-fg-3">{e.description}</p>
                      </th>
                      {PLATFORMS.map((p) => {
                        const cfg = v.platforms[p.id]
                        const on = cfg.events[e.id]
                        return (
                          <td key={p.id} className={cn('px-3 py-3 align-top', !cfg.active && 'opacity-50')}>
                            <div className="flex items-start gap-2.5">
                              <Switch size="sm" checked={on} disabled={!cfg.active} onChange={(x) => setEvent(p.id, e.id, x)} ariaLabel={`${e.label} no ${p.name}`} />
                              <Mono className={cn('text-[11.5px]', on && cfg.active ? 'text-fg' : 'text-fg-3 line-through decoration-fg-3/40')}>{breakable(e.names[p.id])}</Mono>
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <SettingsSection title="PageView por página" description="Escolha onde o PageView dispara. Páginas de jogo e depósito ajudam a montar públicos de remarketing.">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Páginas que disparam PageView">
              {PAGEVIEW_PAGES.map((pg) => {
                const on = v.pageViewPages.includes(pg.id)
                return (
                  <button
                    key={pg.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => form.set('pageViewPages', on ? v.pageViewPages.filter((x) => x !== pg.id) : [...v.pageViewPages, pg.id])}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60',
                      on ? 'border-primary bg-primary/10 text-primary-text' : 'border-line bg-surface text-fg-2 hover:border-line-strong',
                    )}
                  >
                    {on ? <CircleCheck size={14} aria-hidden /> : <span className="h-3.5 w-3.5 rounded-full border border-line-strong" aria-hidden />}
                    {pg.label}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-fg-3">
              {v.pageViewPages.length} de {PAGEVIEW_PAGES.length} páginas. {v.pageViewPages.length === 0 && 'Sem páginas, o PageView não dispara.'}
            </p>
          </SettingsSection>

          <SettingsSection title="Envio pelo servidor" description="Além do pixel no navegador, o servidor envia o mesmo evento pela API de conversões. Os dois são deduplicados pelo event_id.">
            <Switch
              label="Enviar também pelo servidor"
              description={v.serverSide ? 'Pixels com token enviam pelo navegador e pelo servidor.' : 'Só o pixel no navegador. Bloqueadores de anúncio derrubam parte dos eventos.'}
              checked={v.serverSide}
              onChange={(on) => form.set('serverSide', on)}
            />
            <Alert tone="info">
              O "Depósito confirmado" só é enviado depois que o gateway confirma o PIX, com o valor real em reais. Assim a campanha não conta PIX gerado e não pago.
            </Alert>
          </SettingsSection>
        </FormFieldset>

        <TestPanel config={v} dirty={form.dirty} canEdit={canEdit} />
      </div>
      <SaveBar form={form} label="Salvar pixels" />
    </>
  )
}

/** Permite quebrar nomes longos em "_" e entre palavras (CompleteRegistration). */
function breakable(name: string) {
  return name.replace(/_/g, '_\u200b').replace(/([a-z])([A-Z])/g, '$1\u200b$2')
}

function PlatformCard({ id, cfg, serverSide, onChange }: { id: TrackingPlatform; cfg: PlatformConfig; serverSide: boolean; onChange: (p: Partial<PlatformConfig>) => void }) {
  const p = PLATFORM_BY_ID[id]
  const idErr = validatePixelId(id, cfg.pixelId, cfg.active)
  const channel = !cfg.active ? 'Desligado' : cfg.token && serverSide ? 'Navegador + servidor' : 'Só navegador'
  return (
    <Card className={cn('min-w-0', !cfg.active && 'bg-surface-2/50')}>
      <div className="flex items-start gap-3 px-5 pb-3 pt-4">
        <PlatformMark letter={p.short} slot={p.slot} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-fg">{p.name}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-3">
            <Badge tone={!cfg.active ? 'neutral' : channel === 'Só navegador' ? 'warning' : 'success'} dot>
              {channel}
            </Badge>
            {cfg.active && <span>{EVENTS.filter((e) => cfg.events[e.id]).length} eventos ligados</span>}
          </p>
        </div>
        <Switch checked={cfg.active} onChange={(on) => onChange({ active: on })} ariaLabel={`Ligar pixel ${p.name}`} />
      </div>
      <CardBody className="space-y-4">
        <Field label={p.idLabel} htmlFor={`px-${id}`} error={idErr} hint={p.idHint}>
          <Input
            id={`px-${id}`}
            value={cfg.pixelId}
            invalid={!!idErr}
            placeholder={p.idPlaceholder}
            autoComplete="off"
            className="font-mono"
            onChange={(e) => onChange({ pixelId: id === 'tiktok' || id === 'ga4' ? e.target.value.toUpperCase() : e.target.value.replace(/\s/g, '') })}
          />
        </Field>
        <SecretField
          label={p.tokenLabel}
          value={cfg.token}
          onChange={(t) => onChange({ token: t })}
          hint={cfg.token ? 'Cifrado no servidor. Só os últimos caracteres aparecem.' : 'Sem token, os eventos vão só pelo navegador.'}
        />
        {p.testCodeLabel && (
          <Field label={p.testCodeLabel} htmlFor={`tc-${id}`} hint="Opcional. Com o código, os testes aparecem na aba de teste da plataforma e não contam nas campanhas.">
            <Input id={`tc-${id}`} value={cfg.testCode} placeholder="TEST12345" className="font-mono" onChange={(e) => onChange({ testCode: e.target.value.trim().toUpperCase() })} />
          </Field>
        )}
      </CardBody>
    </Card>
  )
}

/**
 * Modo API: o servidor ainda não envia eventos às plataformas (nem de teste). Antes a tela simulava o resultado
 * ("Recebido só pelo navegador", "200 OK · events_received: 1"), gravava no servidor e auditava como enviado.
 */
const API = isApiMode()
const NO_PIXEL_TEST = 'O envio de eventos de teste às plataformas ainda não é feito pelo servidor nesta versão: nada sairia daqui. Use a ferramenta de teste de eventos da própria plataforma.'

function TestPanel({ config, dirty, canEdit }: { config: TrackingConfig; dirty: boolean; canEdit: boolean }) {
  const [tests, setTests] = useDb<TrackingTestEntry[]>(TRACKING_KEYS.tests, seedTrackingTests)
  const [platform, setPlatform] = useState<TrackingPlatform>('meta')
  const [event, setEvent] = useState<TrackingEvent>('deposit_paid')
  const [value, setValue] = useState(50)
  const [sending, setSending] = useState(false)
  const ev = EVENT_BY_ID[event]

  const send = () => {
    if (API) {
      toast.info('Teste indisponível nesta versão', { description: NO_PIXEL_TEST })
      return
    }
    if (ev.sendsValue && value <= 0) {
      toast.error('Informe um valor maior que zero')
      return
    }
    setSending(true)
    setTimeout(() => {
      const r = simulateTrackingTest(config, platform, event, { value, eventId: `test_${Math.random().toString(36).slice(2, 8)}` })
      const entry: TrackingTestEntry = { ...r, id: uid('tt'), at: new Date().toISOString() }
      setTests((prev) => [entry, ...prev].slice(0, 30))
      audit('testar', `Pixel ${PLATFORM_BY_ID[platform].name}`, `Evento de teste ${r.eventName}: ${r.status === 'ok' ? 'recebido' : r.status === 'aviso' ? 'recebido só pelo navegador' : 'falhou'}`)
      setSending(false)
      if (r.status === 'ok') toast.success('Evento recebido', { description: `${r.eventName} chegou pelo navegador e pelo servidor.` })
      else if (r.status === 'aviso') toast.warning('Recebido só pelo navegador', { description: r.detail })
      else toast.error('Evento não enviado', { description: r.detail })
    }, 650)
  }

  const clear = async () => {
    const ok = await confirm({ title: 'Limpar o log de testes?', description: 'Só apaga o histórico desta tela. Nada muda nas plataformas.', confirmLabel: 'Limpar', tone: 'warning' })
    if (ok) setTests([])
  }

  return (
    <Card className="min-w-0">
      <CardHeader
        icon={FlaskConical}
        title="Testar evento"
        description={API ? NO_PIXEL_TEST : 'Envia um evento simulado com os dados desta tela, mesmo antes de salvar.'}
        actions={
          tests.length > 0 && (
            <Button size="sm" variant="ghost" icon={Trash2} onClick={clear}>
              Limpar log
            </Button>
          )
        }
      />
      <CardBody className="space-y-4">
        <form
          className="grid gap-3 rounded-xl border border-line bg-surface-2 p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] xl:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <Field label="Plataforma" htmlFor="t-platform">
            <Select id="t-platform" value={platform} onChange={(x) => setPlatform(x as TrackingPlatform)} options={PLATFORMS.map((p) => ({ value: p.id, label: `${p.name}${config.platforms[p.id].active ? '' : ' (desligado)'}` }))} />
          </Field>
          <Field label="Evento" htmlFor="t-event">
            <Select id="t-event" value={event} onChange={(x) => setEvent(x as TrackingEvent)} options={EVENTS.map((e) => ({ value: e.id, label: `${e.label} · ${e.names[platform]}` }))} />
          </Field>
          <Field label="Valor (BRL)" htmlFor="t-value">
            <MoneyInput id="t-value" value={value} onValueChange={setValue} disabled={!ev.sendsValue} />
          </Field>
          <Button type="submit" variant="primary" icon={Zap} loading={sending} disabled={!canEdit || API} title={!canEdit ? 'Seu cargo não envia testes' : API ? NO_PIXEL_TEST : undefined}>
            Enviar teste
          </Button>
        </form>
        {dirty && (
          <p className="flex items-center gap-1.5 text-xs text-warning">
            <TriangleAlert size={13} aria-hidden /> Há alterações não salvas: o teste usa o que está na tela.
          </p>
        )}

        <div aria-live="polite">
          {tests.length ? (
            <ol className="divide-y divide-line rounded-xl border border-line">
              {tests.map((t) => {
                const p = PLATFORM_BY_ID[t.platform]
                const Icon = t.status === 'ok' ? CircleCheck : t.status === 'aviso' ? TriangleAlert : CircleX
                return (
                  <li key={t.id} className="flex items-start gap-3 px-3.5 py-3">
                    <Icon size={17} className={cn('mt-0.5 shrink-0', t.status === 'ok' ? 'text-success' : t.status === 'aviso' ? 'text-warning' : 'text-danger')} aria-label={t.status === 'ok' ? 'recebido' : t.status === 'aviso' ? 'parcial' : 'falhou'} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-[13px]">
                        <PlatformMark letter={p.short} slot={p.slot} size={18} />
                        <span className="font-medium text-fg">{p.name.split(' (')[0]}</span>
                        <Mono className="text-fg">{t.eventName}</Mono>
                        {t.channel !== '—' && <Badge>{t.channel}</Badge>}
                      </p>
                      <p className="mt-0.5 text-xs text-fg-3">{t.detail}</p>
                      <details className="mt-1">
                        <summary className="w-fit text-xs font-medium text-primary-text">Ver dados enviados</summary>
                        <pre className="mt-1 overflow-x-auto rounded-lg bg-surface-2 p-2 font-mono text-[11.5px] text-fg-2">{JSON.stringify(JSON.parse(t.payload), null, 2)}</pre>
                      </details>
                    </div>
                    <time dateTime={t.at} title={dateTime(t.at)} className="shrink-0 text-xs text-fg-3 tnum">
                      {time(t.at)}
                    </time>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="rounded-xl border border-dashed border-line py-8 text-center text-[13px] text-fg-3">
              {API ? 'Nenhum teste: o envio de teste ainda não existe no servidor.' : 'Nenhum teste ainda. Escolha a plataforma e o evento e clique em "Enviar teste".'}
            </p>
          )}
        </div>
        {ev.sendsValue && <p className="text-xs text-fg-3">Valor enviado: {brl(value)} · moeda BRL.</p>}
      </CardBody>
    </Card>
  )
}
