import { useMemo, useState } from 'react'
import { Ban, Bell, BellRing, CalendarClock, Copy, Eye, Link2, MousePointerClick, RotateCcw, Send, Users } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  ChipFilter,
  DataTable,
  DescriptionList,
  Drawer,
  Field,
  FormGrid,
  Input,
  KpiCard,
  NO_SOURCE_HINT,
  PageHeader,
  Switch,
  Textarea,
  confirm,
  toast,
  type Column,
  type Tone,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { isApiMode } from '@/lib/api'
import { dateTime, num, pct, relative } from '@/lib/format'
import { useCollection, useDb } from '@/lib/store'
import { createRng, uid } from '@/lib/random'
import { DAY, HOUR } from '@/data/now'
import { seedBellNotifications } from '@/data/campanhas3-seeds'
import { audit, usePageAccess, useSession } from '@/domain/session'
import { type Audience, DEFAULT_AUDIENCE, audienceError, describeAudience } from '@/domain/campanhas3-audience'
import {
  NOTIF_LIMITS,
  defaultScheduleAt,
  effectiveStatus,
  scheduleError,
  scheduleIso,
  validateLink,
  type BellNotification,
  type NotifIcon,
  type Schedule,
} from '@/domain/campanhas3-mensagens'
import { AudiencePicker, CharCounter, IconBubble, LinkChip, NOTIF_ICONS, NOTIF_ICON_MAP, RateBar, ScheduleField, SiteHeaderMock, TableFrame, useAudienceEstimate } from './_shared-c3'

const KEY = 'campanhas.notificacoes'
/**
 * Modo API: leituras e cliques só existem quando o site os informa; nesta versão nada informa. Antes a tela
 * inventava leituras (crescendo em 6 horas) para as enviadas, com o servidor guardando reads 0 e clicks 0.
 */
const API = isApiMode()
const NO_READS_HINT = `leituras e cliques: ${NO_SOURCE_HINT}`

interface Draft {
  title: string
  message: string
  icon: NotifIcon
  withCta: boolean
  ctaLabel: string
  ctaLink: string
  audience: Audience
  schedule: Schedule
}

const EMPTY: Draft = {
  title: '',
  message: '',
  icon: 'gift',
  withCta: true,
  ctaLabel: 'Ver promoção',
  ctaLink: '/promocoes',
  audience: DEFAULT_AUDIENCE,
  schedule: { mode: 'agora', at: defaultScheduleAt() },
}

type Status = BellNotification['status']
const STATUS_LABEL: Record<Status, string> = { agendada: 'Agendada', enviada: 'Enviada', cancelada: 'Cancelada' }
const STATUS_TONE: Record<Status, Tone> = { agendada: 'info', enviada: 'success', cancelada: 'neutral' }

function hash(s: string) {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/**
 * Leituras: as do histórico, ou simuladas (crescem nas primeiras 6 horas) para as enviadas agora. Modo API: só as
 * gravadas no servidor, nunca simuladas (a tela mostra "—" enquanto o site não informa).
 */
function readsOf(n: BellNotification, now: number) {
  const st = effectiveStatus(n.status, n.sendAt, now)
  if (st !== 'enviada') return { reads: 0, clicks: 0 }
  if (n.reads > 0 || API) return { reads: n.reads, clicks: n.clicks }
  const rng = createRng(hash(n.id))
  const ramp = Math.max(0, Math.min(1, (now - new Date(n.sendAt).getTime()) / (6 * HOUR)))
  const reads = Math.round(n.recipients * rng.float(0.3, 0.6, 3) * ramp)
  return { reads, clicks: n.cta ? Math.round(reads * rng.float(0.12, 0.3, 3)) : 0 }
}

export default function Notificacoes() {
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  const history = useCollection<BellNotification>(`${KEY}.historico`, seedBellNotifications)
  const [draft, setDraft] = useDb<Draft>(`${KEY}.rascunho`, EMPTY)
  const [touched, setTouched] = useState(false)
  const [filter, setFilter] = useState<'todas' | Status>('todas')
  const [openId, setOpenId] = useState<string | null>(null)
  const { estimate, levelName } = useAudienceEstimate(draft.audience, 'sino')
  const now = Date.now()

  const set = <K extends keyof Draft>(k: K, val: Draft[K]) => setDraft((d) => ({ ...d, [k]: val }))

  const errors = {
    title: !draft.title.trim() ? (touched ? 'Escreva o título.' : null) : draft.title.length > NOTIF_LIMITS.title ? `Máximo de ${NOTIF_LIMITS.title} caracteres.` : null,
    message: !draft.message.trim() ? (touched ? 'Escreva a mensagem.' : null) : draft.message.length > NOTIF_LIMITS.message ? `Máximo de ${NOTIF_LIMITS.message} caracteres.` : null,
    ctaLabel: draft.withCta && (touched || draft.ctaLabel) ? (!draft.ctaLabel.trim() ? 'Informe o texto do botão.' : draft.ctaLabel.length > NOTIF_LIMITS.ctaLabel ? `Máximo de ${NOTIF_LIMITS.ctaLabel}.` : null) : null,
    ctaLink: draft.withCta && (touched || draft.ctaLink) ? validateLink(draft.ctaLink) : null,
    audience: audienceError(draft.audience) ?? (estimate.invalidIds.length ? 'Remova os IDs que não existem.' : null),
    schedule: scheduleError(draft.schedule, now),
  }

  const rows = useMemo(
    () =>
      history.items.map((n) => ({ ...n, status: effectiveStatus(n.status, n.sendAt, now) as Status, ...readsOf(n, now) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history.items],
  )
  const counts = useMemo(() => {
    const c: Record<string, number> = { todas: rows.length }
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [rows])
  const last30 = rows.filter((r) => r.status === 'enviada' && now - new Date(r.sendAt).getTime() <= 30 * DAY)
  const sentTotal = last30.reduce((s, r) => s + r.recipients, 0)
  const readTotal = last30.reduce((s, r) => s + r.reads, 0)
  const withCta = last30.filter((r) => r.cta)
  const ctaReads = withCta.reduce((s, r) => s + r.reads, 0)
  const ctaClicks = withCta.reduce((s, r) => s + r.clicks, 0)
  const scheduled = rows.filter((r) => r.status === 'agendada').sort((a, b) => a.sendAt.localeCompare(b.sendAt))

  const send = async () => {
    setTouched(true)
    const errs = {
      ...errors,
      title: !draft.title.trim() ? 'Escreva o título.' : errors.title,
      message: !draft.message.trim() ? 'Escreva a mensagem.' : errors.message,
      ctaLabel: draft.withCta && !draft.ctaLabel.trim() ? 'Informe o texto do botão.' : errors.ctaLabel,
      ctaLink: draft.withCta ? validateLink(draft.ctaLink) : null,
    }
    const first = Object.values(errs).find(Boolean)
    if (first) {
      toast.error('Revise a notificação', { description: first })
      return
    }
    if (estimate.reachable === 0) {
      toast.error('Ninguém recebe esta notificação', { description: 'O público escolhido não tem jogadores ativos.' })
      return
    }
    const isLater = draft.schedule.mode === 'agendar'
    const when = scheduleIso(draft.schedule)
    const audienceLabel = describeAudience(draft.audience, levelName)
    const ok = await confirm({
      title: isLater ? `Agendar para ${num(estimate.reachable)} jogadores?` : `Enviar para ${num(estimate.reachable)} jogadores?`,
      description: isLater ? `A notificação aparece no sino em ${dateTime(when)}. Dá para cancelar até lá.` : 'A notificação aparece no sino na hora. Depois de enviada, não dá para desfazer.',
      confirmLabel: isLater ? 'Agendar notificação' : 'Enviar agora',
      icon: isLater ? CalendarClock : Send,
      details: (
        <DescriptionList
          columns={2}
          items={[
            { label: 'Título', value: draft.title, full: true },
            { label: 'Público', value: audienceLabel },
            { label: 'Destinatários', value: num(estimate.reachable) },
          ]}
        />
      ),
    })
    if (!ok) return
    const item: BellNotification = {
      id: uid('nt'),
      title: draft.title.trim(),
      message: draft.message.trim(),
      icon: draft.icon,
      cta: draft.withCta ? { label: draft.ctaLabel.trim(), link: draft.ctaLink.trim() } : null,
      audience: draft.audience,
      audienceLabel,
      recipients: estimate.reachable,
      reads: 0,
      clicks: 0,
      createdAt: new Date().toISOString(),
      sendAt: when,
      status: isLater ? 'agendada' : 'enviada',
      createdBy: user.name,
    }
    history.add(item)
    audit('enviar', 'Notificação', `"${item.title}" ${isLater ? `agendada para ${dateTime(when)}` : 'enviada'} · ${audienceLabel} · ${num(item.recipients)} jogadores`)
    toast.success(isLater ? 'Notificação agendada' : 'Notificação enviada', {
      description: isLater
        ? `Sai em ${dateTime(when)} para ${num(item.recipients)} jogadores.`
        : API
          ? `Gravada para ${num(item.recipients)} jogadores. Leituras e cliques aparecem aqui quando o site informar (ainda não nesta versão).`
          : `${num(item.recipients)} jogadores já veem no sino.`,
    })
    setDraft({ ...EMPTY, schedule: { mode: 'agora', at: defaultScheduleAt() } })
    setTouched(false)
  }

  const cancel = async (n: BellNotification) => {
    const ok = await confirm({
      title: 'Cancelar notificação agendada?',
      description: `"${n.title}" não será enviada em ${dateTime(n.sendAt)}. O registro fica no histórico como cancelada.`,
      confirmLabel: 'Cancelar envio',
      cancelLabel: 'Manter agendada',
      tone: 'danger',
      icon: Ban,
    })
    if (!ok) return
    history.update(n.id, { status: 'cancelada' })
    audit('editar', 'Notificação', `Agendamento cancelado: "${n.title}" (${dateTime(n.sendAt)})`)
    toast.success('Agendamento cancelado')
    setOpenId(null)
  }

  const duplicate = (n: BellNotification) => {
    setDraft({
      title: n.title,
      message: n.message,
      icon: n.icon,
      withCta: !!n.cta,
      ctaLabel: n.cta?.label ?? '',
      ctaLink: n.cta?.link ?? '',
      audience: n.audience,
      schedule: { mode: 'agora', at: defaultScheduleAt() },
    })
    setOpenId(null)
    setTouched(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    document.getElementById('conteudo')?.scrollTo?.({ top: 0, behavior: 'smooth' })
    toast.info('Notificação copiada para o editor', { description: 'Revise o público e o horário antes de enviar.' })
  }

  const columns: Column<(typeof rows)[number]>[] = [
    {
      id: 'title',
      header: 'Notificação',
      pinned: true,
      minWidth: 260,
      sortValue: (r) => r.title,
      csv: (r) => r.title,
      cell: (r) => {
        const ic = NOTIF_ICON_MAP[r.icon]
        return (
          <div className="flex min-w-0 max-w-[340px] items-center gap-2.5">
            <IconBubble icon={ic.icon} slot={ic.slot} size={30} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">{r.title}</p>
              <p className="truncate text-xs text-fg-3">{r.message}</p>
            </div>
          </div>
        )
      },
    },
    { id: 'audience', header: 'Público', sortValue: (r) => r.audienceLabel, csv: (r) => r.audienceLabel, cell: (r) => <span className="text-[13px] text-fg-2">{r.audienceLabel}</span> },
    { id: 'recipients', header: 'Enviados', align: 'right', sortValue: (r) => r.recipients, cell: (r) => <span className="font-medium">{num(r.recipients)}</span> },
    {
      id: 'reads',
      header: 'Lidos',
      sortValue: (r) => (r.recipients ? r.reads / r.recipients : 0),
      csv: (r) => (API ? '' : r.reads),
      cell: (r) =>
        r.status === 'enviada' && !API ? (
          <RateBar value={r.reads} total={r.recipients} tone="success" />
        ) : (
          <span className="text-xs text-fg-3" title={API && r.status === 'enviada' ? NO_READS_HINT : undefined}>
            —
          </span>
        ),
    },
    {
      id: 'clicks',
      header: 'Cliques',
      align: 'right',
      defaultHidden: false,
      sortValue: (r) => r.clicks,
      csv: (r) => (API || !r.cta ? '' : r.clicks),
      cell: (r) => (r.cta && r.status === 'enviada' && !API ? <span className="text-[13px] tnum">{num(r.clicks)}</span> : <span className="text-xs text-fg-3">—</span>),
    },
    {
      id: 'sendAt',
      header: 'Data',
      sortValue: (r) => r.sendAt,
      csv: (r) => dateTime(r.sendAt),
      cell: (r) => (
        <div>
          <p className="whitespace-nowrap text-[13px] text-fg-2">{dateTime(r.sendAt)}</p>
          <p className="text-xs text-fg-3">{r.status === 'agendada' ? 'agendada' : r.status === 'cancelada' ? 'não enviada' : relative(r.sendAt)}</p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (r) => r.status,
      csv: (r) => STATUS_LABEL[r.status],
      cell: (r) => (
        <Badge tone={STATUS_TONE[r.status]} dot>
          {STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    { id: 'createdBy', header: 'Criada por', defaultHidden: true, sortValue: (r) => r.createdBy, cell: (r) => <span className="text-[13px] text-fg-2">{r.createdBy}</span> },
  ]

  const open = openId ? rows.find((r) => r.id === openId) : undefined
  const filtered = filter === 'todas' ? rows : rows.filter((r) => r.status === filter)
  const recentForPreview = rows.filter((r) => r.status === 'enviada').slice(0, 2)
  const isLater = draft.schedule.mode === 'agendar'

  return (
    <>
      <PageHeader />
      <div className="space-y-5">
        <section aria-label="Resumo" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Enviadas em 30 dias" icon={BellRing} value={num(last30.length)} hint={`${num(sentTotal)} entregas no sino`} />
          <KpiCard
            label="Taxa de leitura"
            icon={Eye}
            tone={API ? 'neutral' : 'success'}
            value={API ? '—' : pct(sentTotal ? readTotal / sentTotal : 0)}
            hint={API ? NO_SOURCE_HINT : `${num(readTotal)} lidas`}
            formula="Notificações abertas no sino ÷ notificações entregues, nos últimos 30 dias."
          />
          <KpiCard
            label="Cliques no botão"
            icon={MousePointerClick}
            tone={API ? 'neutral' : 'info'}
            value={API ? '—' : pct(ctaReads ? ctaClicks / ctaReads : 0)}
            hint={API ? NO_SOURCE_HINT : `${num(ctaClicks)} cliques de quem leu`}
            formula="Cliques no botão ÷ leituras, só nas notificações com botão."
          />
          <KpiCard
            label="Agendadas"
            icon={CalendarClock}
            tone="warning"
            value={num(scheduled.length)}
            hint={scheduled[0] ? `próxima ${dateTime(scheduled[0].sendAt)}` : 'nenhuma na fila'}
            onClick={() => setFilter('agendada')}
            active={filter === 'agendada'}
          />
        </section>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
          <Card>
            <CardHeader icon={Bell} title="Nova notificação" description="Aparece no sino do jogador, no site e no app. Não precisa de consentimento de marketing." />
            <fieldset disabled={!canEdit} className="min-w-0">
              <CardBody className="space-y-6">
                <div className="space-y-4">
                  <Field label="Título" htmlFor="nt-title" required error={errors.title} labelAside={<CharCounter value={draft.title} max={NOTIF_LIMITS.title} />}>
                    <Input id="nt-title" value={draft.title} placeholder="Ex.: Sexta de giros: 30 grátis" onChange={(e) => set('title', e.target.value)} invalid={!!errors.title} />
                  </Field>
                  <Field label="Mensagem" htmlFor="nt-msg" required error={errors.message} labelAside={<CharCounter value={draft.message} max={NOTIF_LIMITS.message} />} hint="Curta e direta. O sino mostra até 2 linhas antes de abrir.">
                    <Textarea id="nt-msg" rows={3} value={draft.message} placeholder="Deposite a partir de R$ 30 hoje e ganhe 30 giros no Fortune Tiger." onChange={(e) => set('message', e.target.value)} invalid={!!errors.message} />
                  </Field>
                  <Field label="Ícone">
                    <div role="radiogroup" aria-label="Ícone" className="flex flex-wrap gap-2">
                      {NOTIF_ICONS.map((ic) => {
                        const active = draft.icon === ic.value
                        return (
                          <button
                            key={ic.value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            aria-label={ic.label}
                            title={ic.label}
                            onClick={() => set('icon', ic.value)}
                            className={cn(
                              'flex h-11 w-11 items-center justify-center rounded-xl border transition-[border-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-60',
                              active ? 'border-primary shadow-ring' : 'border-line hover:border-line-strong',
                            )}
                          >
                            <IconBubble icon={ic.icon} slot={ic.slot} size={30} />
                          </button>
                        )
                      })}
                    </div>
                  </Field>
                  <Switch label="Botão de ação" description="Leva o jogador a uma página do site ao tocar." checked={draft.withCta} onChange={(on) => set('withCta', on)} />
                  {draft.withCta && (
                    <FormGrid>
                      <Field label="Texto do botão" htmlFor="nt-cta" error={errors.ctaLabel} labelAside={<CharCounter value={draft.ctaLabel} max={NOTIF_LIMITS.ctaLabel} />}>
                        <Input id="nt-cta" value={draft.ctaLabel} onChange={(e) => set('ctaLabel', e.target.value)} invalid={!!errors.ctaLabel} />
                      </Field>
                      <Field label="Link" htmlFor="nt-link" error={errors.ctaLink} hint="Caminho do site (/promocoes) ou https://">
                        <Input id="nt-link" icon={Link2} value={draft.ctaLink} onChange={(e) => set('ctaLink', e.target.value)} invalid={!!errors.ctaLink} />
                      </Field>
                    </FormGrid>
                  )}
                </div>

                <div className="border-t border-line pt-5">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
                    <Users size={15} className="text-fg-3" aria-hidden /> Público
                  </h3>
                  <AudiencePicker
                    value={draft.audience}
                    onChange={(a) => set('audience', a)}
                    kinds={['todos', 'depositou', 'inativos', 'vip', 'novos', 'ids']}
                    fixedDays={{ depositou: 7, inativos: 14 }}
                    channel="sino"
                    idPrefix="nt-aud"
                    disabled={!canEdit}
                    error={touched ? errors.audience : null}
                  />
                </div>

                <div className="border-t border-line pt-5">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
                    <CalendarClock size={15} className="text-fg-3" aria-hidden /> Quando enviar
                  </h3>
                  <ScheduleField value={draft.schedule} onChange={(s) => set('schedule', s)} idPrefix="nt-sch" error={errors.schedule} disabled={!canEdit} />
                </div>
              </CardBody>
            </fieldset>
            <CardFooter className="justify-between">
              <Button
                variant="ghost"
                icon={RotateCcw}
                disabled={!canEdit}
                onClick={() => {
                  setDraft({ ...EMPTY, schedule: { mode: 'agora', at: defaultScheduleAt() } })
                  setTouched(false)
                }}
              >
                Limpar
              </Button>
              <Button variant="primary" icon={isLater ? CalendarClock : Send} onClick={send} disabled={!canEdit} title={!canEdit ? 'Seu cargo não envia notificações' : undefined}>
                {isLater ? 'Agendar' : 'Enviar'} para {num(estimate.reachable)} {estimate.reachable === 1 ? 'jogador' : 'jogadores'}
              </Button>
            </CardFooter>
          </Card>

          <div className="xl:sticky xl:top-20 xl:self-start">
            <Card>
              <CardHeader title="Prévia no sino" description="Como o jogador vê ao tocar no sino" />
              <CardBody>
                <BellPreview draft={draft} recent={recentForPreview} />
              </CardBody>
            </Card>
          </div>
        </div>

        <TableFrame>
        <DataTable
          caption="Histórico de notificações"
          rows={filtered}
          columns={columns}
          rowKey={(r) => r.id}
          searchText={(r) => `${r.title} ${r.message} ${r.audienceLabel}`}
          searchPlaceholder="Buscar por título ou público"
          initialSort={{ id: 'sendAt', dir: 'desc' }}
          exportName="notificacoes"
          onExport={(n) => audit('exportar', 'Notificações', `Exportação CSV de ${n} notificações`)}
          onRowClick={(r) => setOpenId(r.id)}
          resetKey={filter}
          toolbar={
            <ChipFilter
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'todas', label: 'Todas', count: counts.todas ?? 0 },
                { value: 'enviada', label: 'Enviadas', count: counts.enviada ?? 0 },
                { value: 'agendada', label: 'Agendadas', count: counts.agendada ?? 0, tone: 'warning' },
                { value: 'cancelada', label: 'Canceladas', count: counts.cancelada ?? 0 },
              ]}
            />
          }
          rowActions={(r) => [
            { label: 'Ver detalhes', icon: Eye, onSelect: () => setOpenId(r.id) },
            { label: 'Duplicar no editor', icon: Copy, onSelect: () => duplicate(r), disabled: !canEdit },
            ...(r.status === 'agendada' ? [{ divider: true as const }, { label: 'Cancelar agendamento', icon: Ban, danger: true, onSelect: () => cancel(r), disabled: !canEdit }] : []),
          ]}
          empty={{ title: 'Nenhuma notificação neste filtro', description: 'Troque o filtro ou envie a primeira notificação acima.', icon: Bell }}
        />
        </TableFrame>
      </div>

      <Drawer
        open={!!open}
        onClose={() => setOpenId(null)}
        title={open?.title ?? ''}
        description={open ? `${open.status === 'agendada' ? 'Agendada para' : 'Enviada em'} ${dateTime(open.sendAt)} · por ${open.createdBy}` : undefined}
        headerExtra={
          open && (
            <Badge tone={STATUS_TONE[open.status]} dot size="md">
              {STATUS_LABEL[open.status]}
            </Badge>
          )
        }
        footer={
          open && (
            <>
              {open.status === 'agendada' && (
                <Button icon={Ban} className="text-danger" onClick={() => cancel(open)} disabled={!canEdit}>
                  Cancelar agendamento
                </Button>
              )}
              <Button variant="primary" icon={Copy} onClick={() => duplicate(open)} disabled={!canEdit}>
                Duplicar no editor
              </Button>
            </>
          )
        }
      >
        {open && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Enviados" value={num(open.recipients)} />
              <Stat
                label="Lidos"
                value={open.status === 'enviada' && !API ? pct(open.recipients ? open.reads / open.recipients : 0, 0) : '—'}
                sub={open.status === 'enviada' ? (API ? NO_SOURCE_HINT : num(open.reads)) : undefined}
              />
              <Stat
                label="Cliques"
                value={open.cta && open.status === 'enviada' && !API ? num(open.clicks) : '—'}
                sub={open.cta && open.reads && !API ? `${pct(open.clicks / open.reads, 0)} de quem leu` : undefined}
              />
            </div>
            <section>
              <h3 className="mb-3 text-sm font-semibold text-fg">Conteúdo</h3>
              <NotificationItem title={open.title} message={open.message} icon={open.icon} cta={open.cta} when={open.status === 'agendada' ? 'agendada' : relative(open.sendAt)} highlight />
            </section>
            <DescriptionList
              items={[
                { label: 'Público', value: open.audienceLabel },
                { label: 'Criada em', value: dateTime(open.createdAt) },
                { label: 'Link do botão', value: open.cta ? <LinkChip link={open.cta.link} /> : 'Sem botão' },
                { label: 'Criada por', value: open.createdBy },
              ]}
            />
          </div>
        )}
      </Drawer>
    </>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2.5">
      <p className="text-xs text-fg-3">{label}</p>
      <p className="mt-0.5 font-display text-xl font-bold text-fg tnum">{value}</p>
      {sub && <p className="truncate text-[11.5px] text-fg-3">{sub}</p>}
    </div>
  )
}

function NotificationItem({
  title,
  message,
  icon,
  cta,
  when,
  highlight,
}: {
  title: string
  message: string
  icon: NotifIcon
  cta: { label: string; link: string } | null
  when: string
  highlight?: boolean
}) {
  const ic = NOTIF_ICON_MAP[icon]
  return (
    <div className={cn('flex gap-2.5 rounded-lg px-2.5 py-2.5', highlight ? 'bg-primary/[0.06]' : '')}>
      <IconBubble icon={ic.icon} slot={ic.slot} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={cn('break-words text-[13px] leading-5 text-fg', highlight ? 'font-semibold' : 'font-medium')}>{title || 'Título da notificação'}</p>
          {highlight && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="não lida" />}
        </div>
        <p className="mt-0.5 line-clamp-2 break-words text-xs leading-[18px] text-fg-3">{message || 'A mensagem aparece aqui, com até duas linhas.'}</p>
        <div className="mt-1.5 flex items-center gap-2">
          {cta && cta.label && <span className="inline-flex h-6 items-center rounded-md bg-primary px-2 text-[11px] font-semibold text-primary-fg">{cta.label}</span>}
          <span className="text-[11px] text-fg-3">{when}</span>
        </div>
      </div>
    </div>
  )
}

function BellPreview({ draft, recent }: { draft: Draft; recent: BellNotification[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-bg">
      <SiteHeaderMock
        right={
          <>
            <span className="whitespace-nowrap rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg tnum">R$ 152,40</span>
            <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary-text">
              <Bell size={16} aria-hidden />
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-primary-fg ring-2 ring-surface">
                {1 + recent.length}
              </span>
            </span>
          </>
        }
      />
      <div className="relative px-3 pb-4 pt-3">
        <div className="relative ml-auto w-full max-w-[340px] rounded-xl border border-line bg-surface shadow-pop">
          <span className="absolute -top-1.5 right-4 h-3 w-3 rotate-45 border-l border-t border-line bg-surface" aria-hidden />
          <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
            <p className="text-[13px] font-semibold text-fg">Notificações</p>
            <span className="text-[11px] font-medium text-primary-text">Marcar todas como lidas</span>
          </div>
          <div className="space-y-0.5 p-1.5">
            <NotificationItem
              title={draft.title}
              message={draft.message}
              icon={draft.icon}
              cta={draft.withCta ? { label: draft.ctaLabel, link: draft.ctaLink } : null}
              when={draft.schedule.mode === 'agendar' && draft.schedule.at ? dateTime(new Date(draft.schedule.at)) : 'agora'}
              highlight
            />
            {recent.map((r) => (
              <div key={r.id} className="opacity-80">
                <NotificationItem title={r.title} message={r.message} icon={r.icon} cta={null} when={relative(r.sendAt)} />
              </div>
            ))}
          </div>
          <div className="border-t border-line py-2 text-center text-[11.5px] font-medium text-primary-text">Ver todas</div>
        </div>
      </div>
    </div>
  )
}
