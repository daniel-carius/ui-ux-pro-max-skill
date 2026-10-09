import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Building2, ChevronRight, CircleHelp, Clock4, Headset, LifeBuoy, Mail, MessageCircle, MessagesSquare, Phone, PlugZap } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  FormFieldset,
  FormGrid,
  Input,
  KpiCard,
  PageHeader,
  SaveBar,
  Segmented,
  Select,
  Switch,
  toast,
  useSettingsForm,
} from '@/components/ui'
import { BrandMark } from '@/components/layout/Brand'
import { cn } from '@/lib/cn'
import { audit } from '@/domain/session'
import {
  CHAT_PROVIDERS,
  DEFAULT_SUPPORT,
  SUPPORT_KEY,
  WEEKDAYS,
  channelCount,
  formatPhoneOr0800,
  formatWhatsapp,
  hoursLabel,
  supportErrors,
  supportStatus,
  validateSupport,
  type ChatProvider,
  type SupportConfig,
} from '@/domain/config1-suporte'
import { BrowserFrame } from './_shared-f'

const digits = (v: string, max = 13) => v.replace(/\D/g, '').slice(0, max)

export default function Suporte() {
  const form = useSettingsForm<SupportConfig>(SUPPORT_KEY, DEFAULT_SUPPORT, {
    entity: 'Suporte e contato',
    successMessage: 'Canais de atendimento salvos',
    validate: validateSupport,
  })
  const v = form.values
  const e = supportErrors(v)
  const status = supportStatus(v)
  const ch = channelCount(v)
  const [testing, setTesting] = useState(false)
  const provider = CHAT_PROVIDERS[v.chat.provider]

  const setChat = (p: Partial<SupportConfig['chat']>) => form.set('chat', { ...v.chat, ...p })
  const setHours = (p: Partial<SupportConfig['hours']>) => form.set('hours', { ...v.hours, ...p })
  const setOmb = (p: Partial<SupportConfig['ombudsman']>) => form.set('ombudsman', { ...v.ombudsman, ...p })

  const testWidget = () => {
    if (e.widgetId) {
      toast.error('Não foi possível testar', { description: e.widgetId })
      return
    }
    setTesting(true)
    setTimeout(() => {
      setTesting(false)
      audit('testar', 'Suporte · chat ao vivo', `Teste do widget ${provider.label} (${v.chat.widgetId})`)
      toast.success(`${provider.label} respondeu`, { description: 'Widget de demonstração carregado em 412 ms. Nenhuma conversa foi aberta.' })
    }, 900)
  }

  return (
    <>
      <PageHeader />

      <section aria-label="Situação do atendimento" className="mb-5 grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Atendimento"
          icon={Clock4}
          tone={status.open ? 'success' : 'neutral'}
          value={status.open ? 'Aberto agora' : 'Fechado agora'}
          hint={status.label.replace(/^(Aberto|Fechado) agora · /, '')}
        />
        <KpiCard label="Canais no site" icon={Headset} tone="primary" value={`${ch.on} de ${ch.total}`} hint="canal em branco não aparece" />
        <KpiCard
          label="Chat ao vivo"
          icon={MessagesSquare}
          tone={v.chat.provider === 'nenhum' ? 'warning' : 'info'}
          value={v.chat.provider === 'nenhum' ? 'Desligado' : provider.label}
          hint={v.chat.provider === 'nenhum' ? 'jogador só tem e-mail e telefone' : v.chat.onlyLoggedIn ? 'só para jogadores logados' : 'para todos os visitantes'}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <FormFieldset readOnly={form.readOnly}>
          <Card>
            <CardHeader
              icon={MessagesSquare}
              title="Chat ao vivo"
              description="Widget do provedor de atendimento, carregado em todas as páginas do site."
              actions={
                v.chat.provider !== 'nenhum' && (
                  <Button size="sm" icon={PlugZap} onClick={testWidget} loading={testing}>
                    Testar widget
                  </Button>
                )
              }
            />
            <CardBody className="space-y-4">
              <FormGrid>
                <Field label="Provedor" htmlFor="s-prov">
                  <Select
                    id="s-prov"
                    value={v.chat.provider}
                    onChange={(x) => setChat({ provider: x as ChatProvider, widgetId: x === 'nenhum' ? '' : v.chat.provider === x ? v.chat.widgetId : '' })}
                    options={(Object.keys(CHAT_PROVIDERS) as ChatProvider[]).map((k) => ({ value: k, label: CHAT_PROVIDERS[k].label }))}
                  />
                </Field>
                {v.chat.provider !== 'nenhum' && (
                  <Field label={provider.idLabel} htmlFor="s-wid" required error={e.widgetId} hint={provider.hint}>
                    <Input
                      id="s-wid"
                      value={v.chat.widgetId}
                      onChange={(ev) => setChat({ widgetId: ev.target.value.trim() })}
                      placeholder={provider.placeholder}
                      className="font-mono"
                      invalid={!!e.widgetId}
                      autoComplete="off"
                    />
                  </Field>
                )}
              </FormGrid>
              {v.chat.provider === 'nenhum' ? (
                <Alert tone="neutral">Sem chat ao vivo, o botão de ajuda do site abre a central de ajuda e os canais de contato abaixo.</Alert>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Posição do botão">
                    <Segmented
                      ariaLabel="Posição do botão do chat"
                      value={v.chat.position}
                      onChange={(x) => setChat({ position: x })}
                      options={[
                        { value: 'esquerda', label: 'Esquerda' },
                        { value: 'direita', label: 'Direita' },
                      ]}
                    />
                  </Field>
                  <Switch
                    label="Só para jogadores logados"
                    description="Visitantes sem conta veem só a central de ajuda."
                    checked={v.chat.onlyLoggedIn}
                    onChange={(x) => setChat({ onlyLoggedIn: x })}
                  />
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon={Clock4} title="Horário de atendimento" description="Aparece no site e define quando o chat mostra “online”. Fora do horário, o jogador deixa mensagem." />
            <CardBody className="space-y-4">
              <Switch label="Atendimento 24 horas" description="Todos os dias, a qualquer hora." checked={v.hours.always} onChange={(x) => setHours({ always: x })} />
              {!v.hours.always && (
                <>
                  <Field label="Dias" error={e.days}>
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias de atendimento">
                      {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                        const on = v.hours.days[d]
                        return (
                          <button
                            key={d}
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            disabled={form.readOnly}
                            onClick={() => setHours({ days: v.hours.days.map((x, i) => (i === d ? !x : x)) })}
                            className={cn(
                              'h-9 w-12 rounded-lg border text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60',
                              on ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface text-fg-3 hover:border-line-strong hover:text-fg',
                            )}
                          >
                            {WEEKDAYS[d]}
                          </button>
                        )
                      })}
                    </div>
                  </Field>
                  <div className="grid max-w-md grid-cols-2 gap-4">
                    <Field label="Das" htmlFor="s-open">
                      <Input id="s-open" type="time" value={v.hours.open} onChange={(ev) => setHours({ open: ev.target.value })} invalid={!!e.hours} />
                    </Field>
                    <Field label="Até" htmlFor="s-close" error={e.hours}>
                      <Input id="s-close" type="time" value={v.hours.close} onChange={(ev) => setHours({ close: ev.target.value })} invalid={!!e.hours} />
                    </Field>
                  </div>
                </>
              )}
              <p className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
                No site: <strong className="text-fg">{hoursLabel(v)}</strong>
                <Badge tone={status.open ? 'success' : 'neutral'} dot>
                  {status.label}
                </Badge>
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon={Headset} title="Canais de contato" description="Canal em branco não aparece no site." />
            <CardBody>
              <FormGrid>
                <Field label="E-mail de suporte" htmlFor="s-email" error={e.email}>
                  <Input id="s-email" type="email" icon={Mail} value={v.email} onChange={(ev) => form.set('email', ev.target.value.trim())} invalid={!!e.email} placeholder="suporte@seusite.bet.br" />
                </Field>
                <Field label="WhatsApp" htmlFor="s-wa" error={e.whatsapp} hint={v.whatsapp && !e.whatsapp ? `Aparece como ${formatWhatsapp(v.whatsapp)}` : 'País + DDD + número, só dígitos.'}>
                  <Input id="s-wa" inputMode="tel" prefix="+" value={v.whatsapp} onChange={(ev) => form.set('whatsapp', digits(ev.target.value))} invalid={!!e.whatsapp} placeholder="5511900000000" />
                </Field>
                <Field label="Telefone" htmlFor="s-phone" error={e.phone} hint={v.phone && !e.phone ? `Aparece como ${formatPhoneOr0800(v.phone)}` : 'Com DDD ou 0800.'}>
                  <Input id="s-phone" inputMode="tel" icon={Phone} value={v.phone} onChange={(ev) => form.set('phone', digits(ev.target.value, 11))} invalid={!!e.phone} placeholder="08000000000" />
                </Field>
                <Field label="Central de ajuda" htmlFor="s-help" error={e.helpCenterUrl} hint="Artigos e perguntas frequentes.">
                  <Input id="s-help" type="url" icon={CircleHelp} value={v.helpCenterUrl} onChange={(ev) => form.set('helpCenterUrl', ev.target.value.trim())} invalid={!!e.helpCenterUrl} placeholder="https://ajuda.seusite.bet.br" />
                </Field>
              </FormGrid>
            </CardBody>
          </Card>

          <Card className={cn(e.ombudsman && 'border-danger/40')}>
            <CardHeader
              icon={Building2}
              title={
                <span className="inline-flex items-center gap-2">
                  Ouvidoria <Badge tone="danger">Canal obrigatório</Badge>
                </span>
              }
              description="Para reclamações que o suporte não resolveu. Precisa de ao menos um canal (e-mail ou telefone) e aparece no rodapé e na central de ajuda."
            />
            <CardBody className="space-y-4">
              {e.ombudsman && <Alert tone="danger">{e.ombudsman} Sem isso, as alterações não são salvas.</Alert>}
              <FormGrid columns={3}>
                <Field label="E-mail da Ouvidoria" htmlFor="s-omb-mail" error={e.ombudsmanEmail}>
                  <Input id="s-omb-mail" type="email" value={v.ombudsman.email} onChange={(ev) => setOmb({ email: ev.target.value.trim() })} invalid={!!e.ombudsmanEmail || !!e.ombudsman} />
                </Field>
                <Field label="Telefone da Ouvidoria" htmlFor="s-omb-phone" hint={v.ombudsman.phone ? formatPhoneOr0800(v.ombudsman.phone) : undefined}>
                  <Input id="s-omb-phone" inputMode="tel" value={v.ombudsman.phone} onChange={(ev) => setOmb({ phone: digits(ev.target.value, 11) })} invalid={!!e.ombudsman} />
                </Field>
                <Field label="Horário" htmlFor="s-omb-hours">
                  <Input id="s-omb-hours" value={v.ombudsman.hours} onChange={(ev) => setOmb({ hours: ev.target.value })} placeholder="Dias úteis, das 9h às 18h" />
                </Field>
              </FormGrid>
            </CardBody>
          </Card>
        </FormFieldset>

        <div className="min-w-0 xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardHeader title="Prévia no site" description="Página de ajuda e botão do chat, como o jogador vê." />
            <CardBody>
              <SupportPreview c={v} statusLabel={status.label} open={status.open} />
            </CardBody>
          </Card>
        </div>
      </div>

      <SaveBar form={form} />
    </>
  )
}

function Row({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-text">
        <Icon size={15} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-fg-3">{label}</span>
        <span className="block truncate text-[12.5px] font-medium text-fg">{value}</span>
      </span>
      <ChevronRight size={14} className="shrink-0 text-fg-3" aria-hidden />
    </li>
  )
}

function SupportPreview({ c, statusLabel, open }: { c: SupportConfig; statusLabel: string; open: boolean }) {
  const hasChat = c.chat.provider !== 'nenhum'
  const omb = [c.ombudsman.email, c.ombudsman.phone ? formatPhoneOr0800(c.ombudsman.phone) : ''].filter(Boolean).join(' · ')
  return (
    <BrowserFrame url="x2win.bet.br/ajuda">
      <div className="relative bg-surface px-4 pb-16 pt-4">
        <div className="mb-3 flex items-center gap-2">
          <BrandMark size={20} />
          <span className="font-display text-[12px] font-bold text-fg">X2Win</span>
          <span className="ml-auto text-[11px] text-fg-3">Ajuda</span>
        </div>
        <p className="font-display text-[15px] font-bold text-fg">Precisa de ajuda?</p>
        <p className="mt-0.5 flex items-start gap-1.5 text-[11px] leading-4 text-fg-3">
          <span className={cn('mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full', open ? 'bg-success' : 'bg-fg-3')} aria-hidden />
          {statusLabel} · {hoursLabel(c)}
        </p>
        <ul className="mt-3 space-y-1.5">
          {hasChat && <Row icon={MessagesSquare} label={`Chat ao vivo${c.chat.onlyLoggedIn ? ' (logado)' : ''}`} value={open ? 'Falar agora' : 'Deixar mensagem'} />}
          {c.whatsapp && <Row icon={MessageCircle} label="WhatsApp" value={formatWhatsapp(c.whatsapp)} />}
          {c.email && <Row icon={Mail} label="E-mail" value={c.email} />}
          {c.phone && <Row icon={Phone} label="Telefone" value={formatPhoneOr0800(c.phone)} />}
          {c.helpCenterUrl && <Row icon={LifeBuoy} label="Central de ajuda" value={c.helpCenterUrl.replace(/^https:\/\//, '')} />}
        </ul>
        <div className={cn('mt-3 rounded-lg px-3 py-2 text-[11px] leading-4', omb ? 'bg-surface-2 text-fg-2' : 'bg-danger/10 text-danger')}>
          <span className="font-semibold">Ouvidoria: </span>
          {omb ? `${omb}${c.ombudsman.hours ? ` · ${c.ombudsman.hours}` : ''}` : 'sem canal cadastrado'}
        </div>
        {hasChat && (
          <span
            className={cn(
              'absolute bottom-3 flex items-center gap-1.5 rounded-full bg-primary py-2 pl-2.5 pr-3 text-[11px] font-semibold text-primary-fg shadow-pop',
              c.chat.position === 'direita' ? 'right-3' : 'left-3',
            )}
            aria-hidden
          >
            <MessagesSquare size={14} /> Fale conosco
          </span>
        )}
      </div>
    </BrowserFrame>
  )
}
