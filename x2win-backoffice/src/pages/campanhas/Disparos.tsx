import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Ban,
  BadgeCheck,
  CalendarClock,
  Copy,
  Eye,
  Languages,
  Link2,
  Mail,
  MailCheck,
  MailOpen,
  MessageSquare,
  MessageSquareText,
  MousePointerClick,
  Plug,
  RotateCcw,
  Send,
  Smartphone,
  Users,
} from 'lucide-react'
import { FunnelChart } from '@/components/charts'
import { BrandMark } from '@/components/layout/Brand'
import {
  Alert,
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
  ImageUpload,
  Input,
  KpiCard,
  PageHeader,
  RadioCards,
  Switch,
  Textarea,
  Tooltip,
  confirmWithInput,
  toast,
  type Column,
  type Tone,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { brl, dateTime, num, pct, relative } from '@/lib/format'
import { useCollection, useDb } from '@/lib/store'
import { uid } from '@/lib/random'
import { DAY } from '@/data/now'
import type { Player } from '@/data/players'
import { seedDisparos } from '@/data/campanhas3-seeds'
import { audit, usePageAccess, useSession } from '@/domain/session'
import { availableChannels, useIntegrations } from '@/domain/system'
import { type Audience, type AudienceKind, DEFAULT_AUDIENCE, audienceError, describeAudience, hasConsent, isReachable, matchesAudience, supportsRcs } from '@/domain/campanhas3-audience'
import {
  DISPARO_CHANNEL_LABEL,
  PRICE,
  SMS_MAX_SEGMENTS,
  SMS_OPT_OUT,
  TEMPLATE_VARS,
  disparoErrors,
  disparoMetrics,
  effectiveDisparoStatus,
  estimateCost,
  renderVars,
  smsInfo,
  stripAccents,
  type Disparo,
  type DisparoChannel,
  type DisparoDraft,
  type DisparoField,
  type TemplateVarKey,
} from '@/domain/campanhas3-disparos'
import { defaultScheduleAt, scheduleError, scheduleIso, type Schedule } from '@/domain/campanhas3-mensagens'
import { AudiencePicker, CharCounter, EmailFrame, PhoneFrame, RateBar, ScheduleField, SiteLogo, TableFrame, VarChips, useAudienceContext, useAudienceEstimate } from './_shared-c3'

const KEY = 'campanhas.disparos'

interface Draft extends DisparoDraft {
  audience: Audience
  schedule: Schedule
}

const EMPTY: Draft = {
  name: '',
  channel: 'email',
  audience: DEFAULT_AUDIENCE,
  schedule: { mode: 'agora', at: defaultScheduleAt() },
  email: {
    subject: '',
    preheader: '',
    body: 'Olá, {{primeiro_nome}}!\n\n',
    ctaLabel: 'Acessar a X2Win',
    ctaLink: '/promocoes',
  },
  sms: { text: '', optOut: true },
  rcs: { title: '', text: '', image: null, buttonLabel: 'Ver oferta', buttonLink: '/promocoes', smsFallback: true },
}

const KINDS: AudienceKind[] = ['todos', 'depositou', 'inativos', 'vip', 'sem_deposito', 'nivel']

const CHANNEL_ICON = { email: Mail, sms: MessageSquare, rcs: MessageSquareText } as const
const CHANNEL_TONE: Record<DisparoChannel, Tone> = { email: 'primary', sms: 'info', rcs: 'gold' }
const STATUS_LABEL: Record<Disparo['status'], string> = { agendado: 'Agendado', enviado: 'Enviado', cancelado: 'Cancelado' }
const STATUS_TONE: Record<Disparo['status'], Tone> = { agendado: 'info', enviado: 'success', cancelado: 'neutral' }

function sampleVars(p: Player | undefined, levelName: (n: number) => string, levelOf: (p: Player) => number): Record<TemplateVarKey, string> {
  const name = p?.name ?? 'Mariana Costa'
  return {
    nome: name,
    primeiro_nome: name.split(' ')[0],
    saldo: brl(p?.balanceReal ?? 152.4),
    nivel: p ? levelName(levelOf(p)) : 'Ouro',
    link: 'x2win.bet.br',
  }
}

export default function Disparos() {
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  const [integrations] = useIntegrations()
  const channels = availableChannels(integrations)
  const history = useCollection<Disparo>(`${KEY}.historico`, seedDisparos)
  const [draft, setDraft] = useDb<Draft>(`${KEY}.rascunho`, EMPTY)
  const [touched, setTouched] = useState(false)
  const [filter, setFilter] = useState<'todos' | DisparoChannel | 'agendado'>('todos')
  const [openId, setOpenId] = useState<string | null>(null)
  // canal salvo no rascunho pode ter ficado indisponível
  const channel: DisparoChannel = channels[draft.channel] ? draft.channel : 'email'
  const { estimate, sample, levelName, ctx } = useAudienceEstimate(draft.audience, channel)
  const { players } = useAudienceContext()
  const vars = sampleVars(sample, levelName, ctx.levelOf)
  const now = Date.now()

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const setEmail = (p: Partial<Draft['email']>) => setDraft((d) => ({ ...d, email: { ...d.email, ...p } }))
  const setSms = (p: Partial<Draft['sms']>) => setDraft((d) => ({ ...d, sms: { ...d.sms, ...p } }))
  const setRcs = (p: Partial<Draft['rcs']>) => setDraft((d) => ({ ...d, rcs: { ...d.rcs, ...p } }))

  const smsFull = renderVars(draft.sms.text + (draft.sms.optOut ? SMS_OPT_OUT : ''), vars)
  const sms = smsInfo(smsFull)
  const rcsFallbackSms = smsInfo(renderVars(`${draft.rcs.title}: ${draft.rcs.text}`, vars))
  const rcsCapable = useMemo(
    () => (channel === 'rcs' ? players.filter((p) => matchesAudience(p, draft.audience, ctx) && isReachable(p) && hasConsent(p, 'rcs') && supportsRcs(p)).length : 0),
    [players, draft.audience, ctx, channel],
  )
  const recipients = channel === 'rcs' && !draft.rcs.smsFallback ? rcsCapable : estimate.reachable
  const segments = channel === 'sms' ? sms.segments : rcsFallbackSms.segments
  const cost = estimateCost(channel, recipients, segments, channel === 'rcs' ? (recipients ? rcsCapable / recipients : 1) : 1)

  const fieldErrors = disparoErrors({ ...draft, channel }, channels)
  const requiredOnly: DisparoField[] = ['name', 'subject', 'body', 'smsText', 'rcsTitle', 'rcsText', 'rcsButtonLabel']
  const err = (k: DisparoField) => {
    const e = fieldErrors[k]
    if (!e) return null
    if (!touched && requiredOnly.includes(k) && /^(Escreva|Dê|Informe)/.test(e)) return null
    return e
  }
  const audErr = audienceError(draft.audience)
  const schErr = scheduleError(draft.schedule, now)

  // ---------- histórico ----------
  const rows = useMemo(
    () =>
      history.items.map((d) => {
        const status = effectiveDisparoStatus(d, now)
        return { ...d, status, m: disparoMetrics({ ...d, status }, now) }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history.items],
  )
  const last30 = rows.filter((r) => r.status === 'enviado' && now - new Date(r.sendAt).getTime() <= 30 * DAY)
  const sent = last30.reduce((s, r) => s + r.m.sent, 0)
  const delivered = last30.reduce((s, r) => s + r.m.delivered, 0)
  const openable = last30.filter((r) => r.m.opened !== null)
  const opened = openable.reduce((s, r) => s + (r.m.opened ?? 0), 0)
  const openBase = openable.reduce((s, r) => s + r.m.delivered, 0)
  const clicks = last30.reduce((s, r) => s + r.m.clicked, 0)
  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: rows.length }
    for (const r of rows) {
      c[r.channel] = (c[r.channel] ?? 0) + 1
      if (r.status === 'agendado') c.agendado = (c.agendado ?? 0) + 1
    }
    return c
  }, [rows])
  const filtered = filter === 'todos' ? rows : filter === 'agendado' ? rows.filter((r) => r.status === 'agendado') : rows.filter((r) => r.channel === filter)

  const send = async () => {
    setTouched(true)
    const first = Object.values(fieldErrors)[0] ?? audErr ?? schErr
    if (first) {
      toast.error('Revise o disparo', { description: first })
      return
    }
    if (recipients === 0) {
      toast.error('Ninguém recebe este disparo', { description: 'O público não tem jogadores ativos com consentimento para o canal.' })
      return
    }
    const later = draft.schedule.mode === 'agendar'
    const when = scheduleIso(draft.schedule)
    const audienceLabel = describeAudience(draft.audience, levelName)
    const big = !later && recipients > 200
    const res = await confirmWithInput({
      title: `${later ? 'Agendar' : 'Enviar'} ${DISPARO_CHANNEL_LABEL[channel]} para ${num(recipients)} jogadores?`,
      description: later ? `O disparo sai em ${dateTime(when)}. Dá para cancelar até lá.` : 'O envio começa na hora e não pode ser desfeito.',
      confirmLabel: later ? 'Agendar disparo' : 'Enviar agora',
      icon: later ? CalendarClock : Send,
      tone: big ? 'warning' : 'primary',
      typeToConfirm: big ? 'ENVIAR' : undefined,
      details: (
        <DescriptionList
          columns={2}
          items={[
            { label: 'Disparo', value: draft.name, full: true },
            { label: 'Canal', value: DISPARO_CHANNEL_LABEL[channel] },
            { label: 'Público', value: audienceLabel },
            { label: 'Destinatários', value: num(recipients) },
            { label: 'Custo estimado', value: cost ? brl(cost) : 'Incluso no plano' },
          ]}
        />
      ),
    })
    if (!res.confirmed) return
    const headline = channel === 'email' ? draft.email.subject : channel === 'sms' ? draft.sms.text.slice(0, 80) : draft.rcs.title
    const item: Disparo = {
      id: uid('dp'),
      name: draft.name.trim(),
      channel,
      audience: draft.audience,
      audienceLabel,
      recipients,
      headline,
      email: channel === 'email' ? draft.email : undefined,
      sms: channel === 'sms' ? draft.sms : undefined,
      rcs: channel === 'rcs' ? draft.rcs : undefined,
      segments: channel === 'email' ? undefined : segments,
      sendAt: when,
      createdAt: new Date().toISOString(),
      createdBy: user.name,
      status: later ? 'agendado' : 'enviado',
    }
    history.add(item)
    audit('enviar', `Disparo "${item.name}"`, `${DISPARO_CHANNEL_LABEL[channel]} ${later ? `agendado para ${dateTime(when)}` : 'enviado'} · ${audienceLabel} · ${num(recipients)} jogadores${cost ? ` · custo estimado ${brl(cost)}` : ''}`)
    toast.success(later ? 'Disparo agendado' : 'Disparo enviado', { description: later ? `Sai em ${dateTime(when)}.` : `${num(recipients)} mensagens na fila de envio.` })
    setDraft({ ...EMPTY, channel, schedule: { mode: 'agora', at: defaultScheduleAt() } })
    setTouched(false)
  }

  const cancel = async (d: Disparo) => {
    const res = await confirmWithInput({
      title: `Cancelar "${d.name}"?`,
      description: `O disparo agendado para ${dateTime(d.sendAt)} não sai. O registro fica no histórico.`,
      confirmLabel: 'Cancelar disparo',
      cancelLabel: 'Manter agendado',
      tone: 'danger',
      icon: Ban,
    })
    if (!res.confirmed) return
    history.update(d.id, { status: 'cancelado' })
    audit('editar', `Disparo "${d.name}"`, `Agendamento cancelado (${dateTime(d.sendAt)})`)
    toast.success('Disparo cancelado')
    setOpenId(null)
  }

  const duplicate = (d: Disparo) => {
    const ch = channels[d.channel] ? d.channel : 'email'
    setDraft({
      ...EMPTY,
      name: `${d.name} (cópia)`,
      channel: ch,
      audience: d.audience,
      email: d.email ?? EMPTY.email,
      sms: d.sms ?? EMPTY.sms,
      rcs: d.rcs ?? EMPTY.rcs,
      schedule: { mode: 'agora', at: defaultScheduleAt() },
    })
    setOpenId(null)
    setTouched(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    toast.info('Disparo copiado para o editor', { description: ch !== d.channel ? 'O canal original está indisponível; mudamos para e-mail.' : 'Revise o público e o horário antes de enviar.' })
  }

  const columns: Column<(typeof rows)[number]>[] = [
    {
      id: 'name',
      header: 'Disparo',
      pinned: true,
      minWidth: 260,
      sortValue: (r) => r.name,
      csv: (r) => r.name,
      cell: (r) => {
        const Icon = CHANNEL_ICON[r.channel]
        return (
          <div className="flex min-w-0 max-w-[340px] items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-text" aria-hidden>
              <Icon size={15} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">{r.name}</p>
              <p className="truncate text-xs text-fg-3">{renderVars(r.headline, { primeiro_nome: 'Mariana', nome: 'Mariana Costa' })}</p>
            </div>
          </div>
        )
      },
    },
    { id: 'channel', header: 'Canal', sortValue: (r) => r.channel, csv: (r) => DISPARO_CHANNEL_LABEL[r.channel], cell: (r) => <Badge tone={CHANNEL_TONE[r.channel]}>{DISPARO_CHANNEL_LABEL[r.channel]}</Badge> },
    { id: 'audience', header: 'Público', sortValue: (r) => r.audienceLabel, cell: (r) => <span className="text-[13px] text-fg-2">{r.audienceLabel}</span> },
    { id: 'sent', header: 'Enviados', align: 'right', sortValue: (r) => r.m.sent, csv: (r) => r.m.sent, cell: (r) => (r.status === 'enviado' ? <span className="font-medium">{num(r.m.sent)}</span> : r.status === 'agendado' ? <span className="text-xs text-fg-3">{num(r.recipients)} prev.</span> : <Dash />) },
    { id: 'delivered', header: 'Entregues', sortValue: (r) => (r.m.sent ? r.m.delivered / r.m.sent : 0), csv: (r) => r.m.delivered, cell: (r) => (r.status === 'enviado' ? <RateBar value={r.m.delivered} total={r.m.sent} tone="info" /> : <Dash />) },
    {
      id: 'opened',
      header: 'Abertos',
      sortValue: (r) => (r.m.opened !== null && r.m.delivered ? r.m.opened / r.m.delivered : -1),
      csv: (r) => r.m.opened ?? '',
      cell: (r) =>
        r.status !== 'enviado' ? (
          <Dash />
        ) : r.m.opened === null ? (
          <Tooltip content="SMS não informa abertura">
            <span className="text-xs text-fg-3">não medido</span>
          </Tooltip>
        ) : (
          <RateBar value={r.m.opened} total={r.m.delivered} tone="success" />
        ),
    },
    { id: 'clicked', header: 'Cliques', sortValue: (r) => (r.m.delivered ? r.m.clicked / r.m.delivered : 0), csv: (r) => r.m.clicked, cell: (r) => (r.status === 'enviado' ? <RateBar value={r.m.clicked} total={r.m.delivered} tone="primary" /> : <Dash />) },
    {
      id: 'sendAt',
      header: 'Data',
      sortValue: (r) => r.sendAt,
      csv: (r) => dateTime(r.sendAt),
      cell: (r) => (
        <div>
          <p className="whitespace-nowrap text-[13px] text-fg-2">{dateTime(r.sendAt)}</p>
          <p className="text-xs text-fg-3">{r.status === 'agendado' ? 'agendado' : r.status === 'cancelado' ? 'não enviado' : relative(r.sendAt)}</p>
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
    { id: 'createdBy', header: 'Criado por', defaultHidden: true, sortValue: (r) => r.createdBy, cell: (r) => <span className="text-[13px] text-fg-2">{r.createdBy}</span> },
  ]
  const open = openId ? rows.find((r) => r.id === openId) : undefined
  const later = draft.schedule.mode === 'agendar'
  const fromEmail = integrations.emailProvider === 'mailgun' && integrations.mailgun.domain ? `no-reply@${integrations.mailgun.domain}` : integrations.smtp.fromEmail
  const fromName = integrations.smtp.fromName || 'X2Win'
  const emailRef = useRef<HTMLTextAreaElement>(null)
  const subjectRef = useRef<HTMLInputElement>(null)
  const smsRef = useRef<HTMLTextAreaElement>(null)
  const rcsRef = useRef<HTMLTextAreaElement>(null)

  return (
    <>
      <PageHeader
        actions={
          <Link to="/settings/integracoes" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong/80 bg-surface px-3.5 text-sm font-medium text-fg shadow-sm hover:bg-surface-3/70">
            <Plug size={16} aria-hidden /> Integrações
          </Link>
        }
      />
      <div className="space-y-5">
        <section aria-label="Resumo dos disparos" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Enviados em 30 dias" icon={Send} value={num(sent)} hint={`${num(last30.length)} disparos`} />
          <KpiCard label="Taxa de entrega" icon={MailCheck} tone="info" value={pct(sent ? delivered / sent : 0)} hint={`${num(sent - delivered)} não entregues`} formula="Mensagens aceitas pelo provedor do jogador ÷ enviadas. Abaixo de 95% indica lista suja ou bloqueio." />
          <KpiCard label="Taxa de abertura" icon={MailOpen} tone="success" value={pct(openBase ? opened / openBase : 0)} hint={`${num(opened)} aberturas`} formula="Aberturas ÷ entregues, só em e-mail e RCS. SMS não informa abertura." />
          <KpiCard label="Cliques" icon={MousePointerClick} tone="warning" value={pct(delivered ? clicks / delivered : 0)} hint={`${num(clicks)} cliques nos links`} formula="Cliques em links ÷ mensagens entregues." />
        </section>

        {!channels.sms && (
          <Alert
            tone="warning"
            icon={Plug}
            title="SMS e RCS dependem de uma conta SendWork"
            action={
              <Link to="/settings/integracoes" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-surface px-2.5 text-[13px] font-medium text-fg ring-1 ring-inset ring-line-strong hover:bg-surface-3">
                <Plug size={14} aria-hidden /> Conectar SendWork
              </Link>
            }
          >
            Sem essa conta, só o e-mail fica disponível. Conecte a SendWork em Configurações › Integrações para liberar SMS e RCS aqui e nas Jornadas.
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <Card>
            <CardHeader icon={Send} title="Novo disparo" description="Mensagem única para um público. Para envios automáticos por evento, use Jornadas." />
            <fieldset disabled={!canEdit} className="min-w-0">
              <CardBody className="space-y-6">
                <Field label="Nome interno" htmlFor="dp-name" required error={err('name')} hint="Só a equipe vê. Ex.: Reativação 14 dias · outubro">
                  <Input id="dp-name" value={draft.name} onChange={(e) => set('name', e.target.value)} invalid={!!err('name')} maxLength={80} />
                </Field>

                <Field label="Canal" error={err('channel')}>
                  <RadioCards<DisparoChannel>
                    name="Canal"
                    columns={3}
                    value={channel}
                    onChange={(c) => set('channel', c)}
                    options={(['email', 'sms', 'rcs'] as const).map((c) => ({
                      value: c,
                      label: DISPARO_CHANNEL_LABEL[c],
                      icon: CHANNEL_ICON[c],
                      disabled: !channels[c],
                      description: !channels[c] ? 'Requer conta SendWork.' : c === 'email' ? 'Incluso no plano.' : c === 'sms' ? `${brl(PRICE.smsSegment)} por parte.` : `${brl(PRICE.rcs)} por mensagem.`,
                    }))}
                  />
                </Field>

                <div className="border-t border-line pt-5">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
                    <Users size={15} className="text-fg-3" aria-hidden /> Público
                  </h3>
                  <AudiencePicker value={draft.audience} onChange={(a) => set('audience', a)} kinds={KINDS} channel={channel} idPrefix="dp-aud" disabled={!canEdit} error={touched ? audErr : null} />
                  {channel === 'rcs' && (
                    <p className="mt-2 text-xs text-fg-3">
                      {num(rcsCapable)} têm aparelho com RCS. {draft.rcs.smsFallback ? `Os outros ${num(Math.max(0, estimate.reachable - rcsCapable))} recebem por SMS.` : 'Os outros não recebem (fallback desligado).'}
                    </p>
                  )}
                </div>

                <div className="space-y-4 border-t border-line pt-5">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                    {(() => {
                      const Icon = CHANNEL_ICON[channel]
                      return <Icon size={15} className="text-fg-3" aria-hidden />
                    })()}
                    Conteúdo do {DISPARO_CHANNEL_LABEL[channel]}
                  </h3>

                  {channel === 'email' && (
                    <>
                      <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-3">
                        Remetente: <strong className="font-medium text-fg-2">{fromName}</strong> &lt;{fromEmail}&gt; ·{' '}
                        <Link to="/settings/integracoes" className="link">
                          trocar
                        </Link>
                      </p>
                      <Field label="Assunto" htmlFor="dp-subject" required error={err('subject')} labelAside={<CharCounter value={draft.email.subject} max={90} />}>
                        <Input ref={subjectRef} id="dp-subject" value={draft.email.subject} onChange={(e) => setEmail({ subject: e.target.value })} invalid={!!err('subject')} />
                      </Field>
                      <VarChips vars={TEMPLATE_VARS.filter((v) => v.key !== 'link')} targetRef={subjectRef} value={draft.email.subject} onChange={(subject) => setEmail({ subject })} disabled={!canEdit} />
                      <Field label="Pré-cabeçalho" htmlFor="dp-pre" error={err('preheader')} labelAside={<CharCounter value={draft.email.preheader} max={120} />} hint="Texto curto que aparece ao lado do assunto na caixa de entrada.">
                        <Input id="dp-pre" value={draft.email.preheader} onChange={(e) => setEmail({ preheader: e.target.value })} />
                      </Field>
                      <Field label="Corpo" htmlFor="dp-body" required error={err('body')}>
                        <Textarea ref={emailRef} id="dp-body" rows={7} value={draft.email.body} onChange={(e) => setEmail({ body: e.target.value })} invalid={!!err('body')} />
                      </Field>
                      <VarChips vars={TEMPLATE_VARS} targetRef={emailRef} value={draft.email.body} onChange={(body) => setEmail({ body })} disabled={!canEdit} />
                      <FormGrid>
                        <Field label="Texto do botão" htmlFor="dp-cta" error={err('ctaLabel')} hint="Opcional.">
                          <Input id="dp-cta" value={draft.email.ctaLabel} onChange={(e) => setEmail({ ctaLabel: e.target.value })} maxLength={30} />
                        </Field>
                        <Field label="Link do botão" htmlFor="dp-cta-link" error={err('ctaLink')}>
                          <Input id="dp-cta-link" icon={Link2} value={draft.email.ctaLink} onChange={(e) => setEmail({ ctaLink: e.target.value })} invalid={!!err('ctaLink')} />
                        </Field>
                      </FormGrid>
                    </>
                  )}

                  {channel === 'sms' && (
                    <>
                      <p className="text-xs text-fg-3">
                        Remetente: <strong className="font-medium text-fg-2">{integrations.sendwork.smsSender || 'X2WIN'}</strong> (SendWork)
                      </p>
                      <Field
                        label="Mensagem"
                        htmlFor="dp-sms"
                        required
                        error={err('smsText')}
                        labelAside={
                          <span className="flex items-center gap-2">
                            <CharCounter value={sms.length} max={sms.segments <= 1 ? sms.single : Math.min(SMS_MAX_SEGMENTS, sms.segments) * sms.perSegment} />
                            <Badge tone={sms.segments > 1 ? 'warning' : 'neutral'}>{`${sms.segments} ${sms.segments === 1 ? 'parte' : 'partes'}`}</Badge>
                          </span>
                        }
                      >
                        <Textarea ref={smsRef} id="dp-sms" rows={4} value={draft.sms.text} onChange={(e) => setSms({ text: e.target.value })} invalid={!!err('smsText')} />
                      </Field>
                      <VarChips vars={TEMPLATE_VARS} targetRef={smsRef} value={draft.sms.text} onChange={(text) => setSms({ text })} disabled={!canEdit} />
                      <div className="rounded-lg bg-surface-2 px-3 py-2.5 text-xs leading-5 text-fg-2">
                        <p>
                          Codificação <strong className="text-fg">{sms.encoding}</strong>: {sms.single} caracteres numa parte, {sms.encoding === 'GSM-7' ? 153 : 67} por parte quando divide. Variáveis contam pelo tamanho do exemplo. Máximo de {SMS_MAX_SEGMENTS} partes.
                        </p>
                        {sms.encoding === 'UCS-2' && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <span className="text-warning">
                              Acentos ({sms.offenders.slice(0, 6).join(' ')}) reduzem o limite para 70 por parte.
                            </span>
                            <Button size="xs" variant="soft" icon={Languages} onClick={() => setSms({ text: stripAccents(draft.sms.text) })}>
                              Remover acentos
                            </Button>
                          </div>
                        )}
                      </div>
                      <Switch label="Instrução de descadastro" description={`Acrescenta "${SMS_OPT_OUT.trim()}" no fim (recomendado pela LGPD).`} checked={draft.sms.optOut} onChange={(on) => setSms({ optOut: on })} />
                    </>
                  )}

                  {channel === 'rcs' && (
                    <>
                      <p className="flex items-center gap-1.5 text-xs text-fg-3">
                        <BadgeCheck size={13} className="text-info" aria-hidden /> Agente verificado: <strong className="font-medium text-fg-2">{integrations.sendwork.rcsAgent || 'X2Win'}</strong>
                      </p>
                      <Field label="Título do cartão" htmlFor="dp-rcs-title" required error={err('rcsTitle')} labelAside={<CharCounter value={draft.rcs.title} max={200} />}>
                        <Input id="dp-rcs-title" value={draft.rcs.title} onChange={(e) => setRcs({ title: e.target.value })} invalid={!!err('rcsTitle')} />
                      </Field>
                      <Field label="Texto" htmlFor="dp-rcs-text" required error={err('rcsText')}>
                        <Textarea ref={rcsRef} id="dp-rcs-text" rows={4} value={draft.rcs.text} onChange={(e) => setRcs({ text: e.target.value })} invalid={!!err('rcsText')} />
                      </Field>
                      <VarChips vars={TEMPLATE_VARS} targetRef={rcsRef} value={draft.rcs.text} onChange={(text) => setRcs({ text })} disabled={!canEdit} />
                      <ImageUpload label="Imagem do cartão (opcional)" value={draft.rcs.image} onChange={(image) => setRcs({ image })} width={1440} height={720} hint="1440×720 px" disabled={!canEdit} />
                      <FormGrid>
                        <Field label="Texto do botão" htmlFor="dp-rcs-btn" required error={err('rcsButtonLabel')} labelAside={<CharCounter value={draft.rcs.buttonLabel} max={25} />}>
                          <Input id="dp-rcs-btn" value={draft.rcs.buttonLabel} onChange={(e) => setRcs({ buttonLabel: e.target.value })} invalid={!!err('rcsButtonLabel')} />
                        </Field>
                        <Field label="Link do botão" htmlFor="dp-rcs-link" error={err('rcsButtonLink')}>
                          <Input id="dp-rcs-link" icon={Link2} value={draft.rcs.buttonLink} onChange={(e) => setRcs({ buttonLink: e.target.value })} invalid={!!err('rcsButtonLink')} />
                        </Field>
                      </FormGrid>
                      <Switch label="Enviar SMS para quem não tem RCS" description={`Título e texto viram um SMS de ${rcsFallbackSms.segments} ${rcsFallbackSms.segments === 1 ? 'parte' : 'partes'}.`} checked={draft.rcs.smsFallback} onChange={(on) => setRcs({ smsFallback: on })} />
                    </>
                  )}
                </div>

                <div className="border-t border-line pt-5">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
                    <CalendarClock size={15} className="text-fg-3" aria-hidden /> Quando enviar
                  </h3>
                  <ScheduleField value={draft.schedule} onChange={(s) => set('schedule', s)} idPrefix="dp-sch" error={schErr} disabled={!canEdit} />
                </div>
              </CardBody>
            </fieldset>
            <CardFooter className="justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  icon={RotateCcw}
                  disabled={!canEdit}
                  onClick={() => {
                    setDraft({ ...EMPTY, channel, schedule: { mode: 'agora', at: defaultScheduleAt() } })
                    setTouched(false)
                  }}
                >
                  Limpar
                </Button>
                <span className="text-xs text-fg-3">{cost ? `Custo estimado: ${brl(cost)}` : 'Sem custo por mensagem'}</span>
              </div>
              <Button variant="primary" icon={later ? CalendarClock : Send} onClick={send} disabled={!canEdit} title={!canEdit ? 'Seu cargo não faz disparos' : undefined}>
                {later ? 'Agendar' : 'Enviar'} para {num(recipients)} {recipients === 1 ? 'jogador' : 'jogadores'}
              </Button>
            </CardFooter>
          </Card>

          <div className="xl:sticky xl:top-20 xl:self-start">
            <Card>
              <CardHeader
                title="Prévia"
                description={sample ? `Com os dados de ${vars.primeiro_nome} (${vars.nivel})` : 'Com dados de exemplo'}
                actions={<Badge tone={CHANNEL_TONE[channel]}>{DISPARO_CHANNEL_LABEL[channel]}</Badge>}
              />
              <CardBody>
                <ChannelPreview channel={channel} draft={draft} vars={vars} fromName={fromName} fromEmail={fromEmail} smsSender={integrations.sendwork.smsSender || 'X2WIN'} />
              </CardBody>
            </Card>
          </div>
        </div>

        <TableFrame>
          <DataTable
            caption="Histórico de disparos"
            rows={filtered}
            columns={columns}
            rowKey={(r) => r.id}
            searchText={(r) => `${r.name} ${r.headline} ${r.audienceLabel}`}
            searchPlaceholder="Buscar por nome ou assunto"
            initialSort={{ id: 'sendAt', dir: 'desc' }}
            exportName="disparos"
            onExport={(n) => audit('exportar', 'Disparos', `Exportação CSV de ${n} disparos`)}
            onRowClick={(r) => setOpenId(r.id)}
            resetKey={filter}
            toolbar={
              <ChipFilter
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'todos', label: 'Todos', count: counts.todos ?? 0 },
                  { value: 'email', label: 'E-mail', count: counts.email ?? 0 },
                  { value: 'sms', label: 'SMS', count: counts.sms ?? 0 },
                  { value: 'rcs', label: 'RCS', count: counts.rcs ?? 0 },
                  { value: 'agendado', label: 'Agendados', count: counts.agendado ?? 0, tone: 'warning' },
                ]}
              />
            }
            rowActions={(r) => [
              { label: 'Ver detalhes', icon: Eye, onSelect: () => setOpenId(r.id) },
              { label: 'Duplicar no editor', icon: Copy, onSelect: () => duplicate(r), disabled: !canEdit },
              ...(r.status === 'agendado' ? [{ divider: true as const }, { label: 'Cancelar disparo', icon: Ban, danger: true, onSelect: () => cancel(r), disabled: !canEdit }] : []),
            ]}
            empty={{ title: 'Nenhum disparo neste filtro', description: 'Troque o filtro ou faça o primeiro disparo acima.', icon: Send }}
          />
        </TableFrame>
      </div>

      <Drawer
        open={!!open}
        onClose={() => setOpenId(null)}
        width="lg"
        title={open?.name ?? ''}
        description={open ? `${DISPARO_CHANNEL_LABEL[open.channel]} · ${open.status === 'agendado' ? 'agendado para' : 'enviado em'} ${dateTime(open.sendAt)} · por ${open.createdBy}` : undefined}
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
              {open.status === 'agendado' && (
                <Button icon={Ban} className="text-danger" onClick={() => cancel(open)} disabled={!canEdit}>
                  Cancelar disparo
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
            {open.status === 'enviado' ? (
              <section>
                <h3 className="mb-3 text-sm font-semibold text-fg">Funil de entrega</h3>
                <FunnelChart
                  ariaLabel="Funil do disparo"
                  steps={[
                    { label: 'Enviados', value: open.m.sent },
                    { label: 'Entregues', value: open.m.delivered },
                    ...(open.m.opened !== null ? [{ label: 'Abertos', value: open.m.opened }] : []),
                    { label: 'Clicaram', value: open.m.clicked },
                  ]}
                />
              </section>
            ) : (
              <Alert tone={open.status === 'agendado' ? 'info' : 'neutral'}>
                {open.status === 'agendado' ? `Sai em ${dateTime(open.sendAt)} para cerca de ${num(open.recipients)} jogadores.` : 'Este disparo foi cancelado antes do envio.'}
              </Alert>
            )}
            <DescriptionList
              items={[
                { label: 'Público', value: open.audienceLabel },
                { label: 'Destinatários', value: num(open.recipients) },
                { label: 'Criado em', value: dateTime(open.createdAt) },
                { label: 'Custo estimado', value: open.channel === 'email' ? 'Incluso no plano' : brl(estimateCost(open.channel, open.recipients, open.segments ?? 1)) },
              ]}
            />
            <section>
              <h3 className="mb-3 text-sm font-semibold text-fg">Conteúdo</h3>
              <ChannelPreview
                channel={open.channel}
                draft={{ ...EMPTY, email: open.email ?? EMPTY.email, sms: open.sms ?? EMPTY.sms, rcs: open.rcs ?? EMPTY.rcs }}
                vars={sampleVars(undefined, levelName, ctx.levelOf)}
                fromName={fromName}
                fromEmail={fromEmail}
                smsSender={integrations.sendwork.smsSender || 'X2WIN'}
              />
            </section>
          </div>
        )}
      </Drawer>
    </>
  )
}

function Dash() {
  return <span className="text-xs text-fg-3">—</span>
}

function ChannelPreview({
  channel,
  draft,
  vars,
  fromName,
  fromEmail,
  smsSender,
}: {
  channel: DisparoChannel
  draft: Pick<Draft, 'email' | 'sms' | 'rcs'>
  vars: Record<TemplateVarKey, string>
  fromName: string
  fromEmail: string
  smsSender: string
}) {
  if (channel === 'email') {
    const body = renderVars(draft.email.body, vars)
    return (
      <EmailFrame fromName={fromName} fromEmail={fromEmail} subject={renderVars(draft.email.subject, vars)} preheader={renderVars(draft.email.preheader, vars)}>
        <div className="space-y-3 whitespace-pre-line break-words text-[13px] leading-6 text-fg-2">{body.trim() || 'O corpo do e-mail aparece aqui.'}</div>
        {draft.email.ctaLabel.trim() && (
          <div className="mt-5 text-center">
            <span className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-[13px] font-semibold text-primary-fg">{draft.email.ctaLabel}</span>
          </div>
        )}
      </EmailFrame>
    )
  }
  if (channel === 'sms') {
    const text = renderVars(draft.sms.text + (draft.sms.optOut ? SMS_OPT_OUT : ''), vars)
    return (
      <PhoneFrame title={smsSender} subtitle="SMS" avatar={<span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-3 text-fg-2"><Smartphone size={14} aria-hidden /></span>}>
        <p className="mb-2 text-center text-[10.5px] text-fg-3">Hoje 9:41</p>
        <div className="max-w-[86%] whitespace-pre-line break-words rounded-2xl rounded-bl-md bg-surface-3 px-3 py-2 text-[13px] leading-5 text-fg">{text.trim() || 'Sua mensagem aparece aqui.'}</div>
      </PhoneFrame>
    )
  }
  return (
    <PhoneFrame
      title={
        <span className="inline-flex items-center gap-1">
          X2Win <BadgeCheck size={13} className="text-info" aria-label="verificado" />
        </span>
      }
      subtitle="Mensagem RCS · empresa verificada"
      avatar={<BrandMark size={26} />}
    >
      <p className="mb-2 text-center text-[10.5px] text-fg-3">Hoje 9:41</p>
      <div className="max-w-[92%] overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        {draft.rcs.image ? (
          <img src={draft.rcs.image} alt="" className="aspect-[2/1] w-full object-cover" />
        ) : (
          <div className="flex aspect-[2/1] w-full items-center justify-center bg-gradient-to-br from-primary/35 via-primary/15 to-transparent">
            <SiteLogo size={26} />
          </div>
        )}
        <div className="p-3">
          <p className={cn('break-words text-[13px] font-semibold leading-5 text-fg', !draft.rcs.title && 'text-fg-3')}>{renderVars(draft.rcs.title, vars) || 'Título do cartão'}</p>
          <p className="mt-1 whitespace-pre-line break-words text-[12px] leading-[18px] text-fg-2">{renderVars(draft.rcs.text, vars) || 'Texto do cartão.'}</p>
        </div>
        <div className="border-t border-line px-3 py-2 text-center text-[13px] font-semibold text-primary-text">{draft.rcs.buttonLabel || 'Botão'}</div>
      </div>
    </PhoneFrame>
  )
}
