import { useState, type ReactNode } from 'react'
import {
  BadgeCheck,
  CircleCheck,
  CircleX,
  Gift,
  KeyRound,
  Mail,
  MailCheck,
  MessageSquareText,
  Plug,
  Route,
  Send,
  Server,
  Smartphone,
  Unplug,
  UserPlus,
  Wallet,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  Field,
  FormFieldset,
  FormGrid,
  Input,
  Mono,
  NumberInput,
  PageHeader,
  RadioCards,
  SaveBar,
  SecretField,
  Segmented,
  SettingsSection,
  Switch,
  confirm,
  toast,
  useSettingsForm,
} from '@/components/ui'
import { dateTime, maskSecret, relative } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useDb } from '@/lib/store'
import { EMAIL_KEYS } from '@/data/config2-email'
import { audit, usePageAccess, useSession } from '@/domain/session'
import { DEFAULT_INTEGRATIONS, INTEGRATIONS_KEY, availableChannels, useIntegrations, type IntegrationsState } from '@/domain/system'
import { PROVIDER_LABEL, validateIntegrations, validateMailgun, validateSendwork, type MailgunDraft, type SendworkDraft } from '@/domain/config2-email'
import { useExternalSave } from './_shared-g'

interface LastTest {
  at: string
  to: string
  provider: IntegrationsState['emailProvider']
  ok: boolean
  detail: string
}

const USES: { icon: typeof Mail; label: string; detail: string; href?: string }[] = [
  { icon: KeyRound, label: 'Redefinição de senha', detail: 'Link para criar senha nova', href: '#/settings/templates-email' },
  { icon: UserPlus, label: 'Convites da equipe', detail: 'Acesso ao painel', href: '#/settings/equipe' },
  { icon: Gift, label: 'Boas-vindas', detail: 'Logo depois do cadastro', href: '#/settings/templates-email' },
  { icon: Wallet, label: 'Avisos de depósito e saque', detail: 'Confirmado, pago, recusado', href: '#/settings/templates-email' },
  { icon: Send, label: 'Disparos', detail: 'Campanhas para públicos', href: '#/campanhas/disparos' },
  { icon: Route, label: 'Jornadas', detail: 'Automações por jogador', href: '#/campanhas/jornadas' },
]

export default function Integracoes() {
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  const [, setIntegrations] = useIntegrations()
  const form = useSettingsForm<IntegrationsState>(INTEGRATIONS_KEY, DEFAULT_INTEGRATIONS, {
    entity: 'Integrações',
    successMessage: 'Integrações salvas',
    validate: validateIntegrations,
  })
  const applyNow = useExternalSave(form, setIntegrations)
  const v = form.values
  const saved = form.saved
  const channels = availableChannels(saved)
  const [lastTest, setLastTest] = useDb<LastTest | null>(EMAIL_KEYS.lastTest, null)
  const [testing, setTesting] = useState(false)
  const setSmtp = (patch: Partial<IntegrationsState['smtp']>) => form.set('smtp', { ...v.smtp, ...patch })

  const connected = (p: IntegrationsState['emailProvider']) => p === 'smtp' || (p === 'mailgun' ? saved.mailgun.connected : saved.sendwork.connected)

  const sendTest = () => {
    setTesting(true)
    setTimeout(() => {
      const p = saved.emailProvider
      const ok = connected(p)
      const r: LastTest = {
        at: new Date().toISOString(),
        to: user.email,
        provider: p,
        ok,
        detail: ok ? `Aceito por ${PROVIDER_LABEL[p]} em ${Math.round(300 + Math.random() * 500)} ms. Confira a caixa de entrada (e o spam).` : `${PROVIDER_LABEL[p]} está sem conta conectada.`,
      }
      setLastTest(r)
      audit('testar', 'Integrações · e-mail', `E-mail de teste para ${user.email} via ${PROVIDER_LABEL[p]}: ${ok ? 'enviado' : 'falhou'}`)
      setTesting(false)
      if (ok) toast.success('E-mail de teste enviado', { description: `Para ${user.email}, via ${PROVIDER_LABEL[p]}.` })
      else toast.error('Falha no envio', { description: r.detail })
    }, 800)
  }

  const connectMailgun = (d: MailgunDraft) => {
    applyNow((prev) => ({ ...prev, mailgun: { connected: true, domain: d.domain.trim().toLowerCase(), apiKey: d.apiKey.trim(), region: d.region } }))
    audit('ligar', 'Integração Mailgun', `Conta conectada (domínio ${d.domain.trim().toLowerCase()}, região ${d.region === 'us' ? 'EUA' : 'Europa'})`)
    toast.success('Mailgun conectado', { description: 'Agora você pode escolher o Mailgun como provedor de e-mail.' })
  }
  const connectSendwork = (d: SendworkDraft) => {
    applyNow((prev) => ({ ...prev, sendwork: { connected: true, accountId: d.accountId.trim(), apiKey: d.apiKey.trim(), smsSender: d.smsSender.trim(), rcsAgent: d.rcsAgent.trim() } }))
    audit('ligar', 'Integração SendWork', `Conta ${d.accountId.trim()} conectada; SMS e RCS liberados em Disparos e Jornadas`)
    toast.success('SendWork conectada', { description: 'SMS e RCS já aparecem em Disparos e Jornadas.' })
  }

  const disconnect = async (which: 'mailgun' | 'sendwork') => {
    const inUse = saved.emailProvider === which
    const name = which === 'mailgun' ? 'Mailgun' : 'SendWork'
    const ok = await confirm({
      title: `Desconectar ${name}?`,
      description: (
        <>
          A chave de API é apagada do servidor.
          {inUse && ' Os e-mails voltam a sair pelo SMTP da plataforma.'}
          {which === 'sendwork' && ' SMS e RCS deixam de aparecer em Disparos e Jornadas, e jornadas com etapas de SMS/RCS pulam essas etapas.'}
        </>
      ),
      confirmLabel: 'Desconectar',
      tone: 'danger',
      icon: Unplug,
    })
    if (!ok) return
    applyNow((prev) => ({
      ...prev,
      emailProvider: prev.emailProvider === which ? 'smtp' : prev.emailProvider,
      [which]: which === 'mailgun' ? { ...DEFAULT_INTEGRATIONS.mailgun } : { ...DEFAULT_INTEGRATIONS.sendwork },
    }))
    audit('desligar', `Integração ${name}`, `Conta desconectada${inUse ? '; e-mail voltou para o SMTP da plataforma' : ''}`)
    toast.success(`${name} desconectado`)
  }

  return (
    <>
      <PageHeader
        actions={
          <Button icon={MailCheck} loading={testing} onClick={sendTest} disabled={!canEdit} title={!canEdit ? 'Seu cargo não envia testes' : `Envia para ${user.email}`}>
            Enviar e-mail de teste
          </Button>
        }
      />

      <div className="space-y-5">
        <section aria-label="Canais disponíveis" className="grid gap-4 md:grid-cols-3">
          <ChannelCard icon={Mail} title="E-mail" on={channels.email} detail={`Pelo ${PROVIDER_LABEL[saved.emailProvider]}`} />
          <ChannelCard icon={Smartphone} title="SMS" on={channels.sms} detail={channels.sms ? `Remetente ${saved.sendwork.smsSender}` : 'Requer conta SendWork'} />
          <ChannelCard icon={MessageSquareText} title="RCS" on={channels.rcs} detail={channels.rcs ? `Agente ${saved.sendwork.rcsAgent}` : 'Requer conta SendWork'} />
        </section>

        <Alert tone={channels.sms ? 'success' : 'info'} icon={Send}>
          {channels.sms ? (
            <>
              SendWork conectada: <a className="link" href="#/campanhas/disparos">Disparos</a> e <a className="link" href="#/campanhas/jornadas">Jornadas</a> oferecem e-mail, SMS e RCS.
            </>
          ) : (
            <>
              <a className="link" href="#/campanhas/disparos">Disparos</a> e <a className="link" href="#/campanhas/jornadas">Jornadas</a> só oferecem SMS e RCS quando a SendWork está conectada. Hoje,
              só o e-mail está disponível.
            </>
          )}
        </Alert>

        {lastTest && (
          <div className={cn('flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3', lastTest.ok ? 'border-success/25 bg-success/5' : 'border-danger/25 bg-danger/5')} aria-live="polite">
            {lastTest.ok ? <CircleCheck size={18} className="mt-px text-success" aria-hidden /> : <CircleX size={18} className="mt-px text-danger" aria-hidden />}
            <div className="min-w-0 flex-1 text-[13px]">
              <p className="font-semibold text-fg">
                Último teste: {lastTest.ok ? 'enviado' : 'falhou'} para {lastTest.to}
              </p>
              <p className="text-fg-2">{lastTest.detail}</p>
            </div>
            <span className="text-xs text-fg-3" title={dateTime(lastTest.at)}>
              {relative(lastTest.at)}
            </span>
          </div>
        )}
        {form.dirty && <p className="text-xs text-warning">O teste usa a configuração salva. Salve antes para testar as mudanças.</p>}

        <FormFieldset readOnly={form.readOnly}>
          <SettingsSection title="Provedor de e-mail" description="Quem envia os e-mails do site e do painel. Só um provedor fica ativo por vez.">
            <RadioCards<IntegrationsState['emailProvider']>
              name="Provedor de e-mail"
              columns={3}
              value={v.emailProvider}
              onChange={(p) => form.set('emailProvider', p)}
              options={[
                { value: 'smtp', label: 'Padrão da plataforma', icon: Server, description: <ProviderDesc text="SMTP da Evox. Funciona sem configurar nada." badge={<Badge tone="success">Pronto</Badge>} /> },
                { value: 'mailgun', label: 'Mailgun', icon: Mail, description: <ProviderDesc text="Envio em volume, com domínio próprio." badge={saved.mailgun.connected ? <Badge tone="success">Conectado</Badge> : <Badge>Sem conta</Badge>} /> },
                { value: 'sendwork', label: 'SendWork', icon: MessageSquareText, description: <ProviderDesc text="E-mail, SMS e RCS na mesma conta." badge={saved.sendwork.connected ? <Badge tone="success">Conectada</Badge> : <Badge>Sem conta</Badge>} /> },
              ]}
            />
            {!connected(v.emailProvider) && (
              <Alert tone="warning">Conecte a conta {PROVIDER_LABEL[v.emailProvider]} abaixo antes de salvar. Sem conta, nenhum e-mail sairia.</Alert>
            )}
          </SettingsSection>

          <SettingsSection
            title="Mailgun"
            description="Conta própria de envio de e-mail."
            aside={saved.mailgun.connected ? <Badge tone="success" icon={Plug}>Conectado</Badge> : <Badge icon={Unplug}>Sem conta</Badge>}
          >
            {saved.mailgun.connected ? (
              <ConnectedBox
                items={[
                  { label: 'Domínio de envio', value: <Mono>{saved.mailgun.domain}</Mono> },
                  { label: 'Região', value: saved.mailgun.region === 'us' ? 'EUA' : 'Europa' },
                  { label: 'Chave de API', value: <Mono>{maskSecret(saved.mailgun.apiKey)}</Mono> },
                  { label: 'Em uso', value: saved.emailProvider === 'mailgun' ? 'Sim, envia os e-mails' : 'Não' },
                ]}
                onDisconnect={() => disconnect('mailgun')}
                disabled={!canEdit}
              />
            ) : (
              <MailgunConnect onConnect={connectMailgun} disabled={!canEdit} />
            )}
          </SettingsSection>

          <SettingsSection
            title="SendWork"
            description="E-mail, SMS e RCS. É o único canal de SMS e RCS para Disparos e Jornadas."
            aside={saved.sendwork.connected ? <Badge tone="success" icon={Plug}>Conectada</Badge> : <Badge icon={Unplug}>Sem conta</Badge>}
          >
            {saved.sendwork.connected ? (
              <ConnectedBox
                items={[
                  { label: 'Conta', value: <Mono>{saved.sendwork.accountId}</Mono> },
                  { label: 'Chave de API', value: <Mono>{maskSecret(saved.sendwork.apiKey)}</Mono> },
                  { label: 'Remetente do SMS', value: saved.sendwork.smsSender },
                  { label: 'Agente RCS', value: <Mono>{saved.sendwork.rcsAgent}</Mono> },
                ]}
                onDisconnect={() => disconnect('sendwork')}
                disabled={!canEdit}
              />
            ) : (
              <SendworkConnect onConnect={connectSendwork} disabled={!canEdit} />
            )}
          </SettingsSection>

          <SettingsSection title="SMTP da plataforma" description="Usado quando o provedor é o padrão da plataforma. Já vem configurado pela Evox.">
            <FormGrid>
              <Field label="Servidor" htmlFor="smtp-host" error={!v.smtp.host.trim() ? 'Informe o servidor.' : null}>
                <Input id="smtp-host" value={v.smtp.host} className="font-mono" onChange={(e) => setSmtp({ host: e.target.value })} />
              </Field>
              <Field label="Porta" htmlFor="smtp-port" hint="587 (STARTTLS) ou 465 (SSL)" error={v.smtp.port < 1 || v.smtp.port > 65535 ? 'Porta de 1 a 65535.' : null}>
                <NumberInput id="smtp-port" value={v.smtp.port} min={1} max={65535} onValueChange={(n) => setSmtp({ port: Math.round(n) })} />
              </Field>
              <Field label="Usuário" htmlFor="smtp-user">
                <Input id="smtp-user" value={v.smtp.user} autoComplete="off" onChange={(e) => setSmtp({ user: e.target.value })} />
              </Field>
              <SecretField label="Senha" value={v.smtp.password} onChange={(pw) => setSmtp({ password: pw })} />
            </FormGrid>
            <Switch label="Conexão segura (TLS)" description={v.smtp.secure ? 'Senha e conteúdo trafegam cifrados.' : 'Sem TLS, a senha trafega aberta. Não recomendado.'} checked={v.smtp.secure} onChange={(on) => setSmtp({ secure: on })} />
          </SettingsSection>

          <SettingsSection title="Remetente" description="Nome e endereço que o jogador vê. Vale para qualquer provedor.">
            <FormGrid>
              <Field label="Nome do remetente" htmlFor="from-name" error={!v.smtp.fromName.trim() ? 'Informe o nome.' : null}>
                <Input id="from-name" value={v.smtp.fromName} onChange={(e) => setSmtp({ fromName: e.target.value })} />
              </Field>
              <Field label="E-mail do remetente" htmlFor="from-email" hint="Use um endereço do seu domínio, com SPF e DKIM configurados.">
                <Input id="from-email" type="email" value={v.smtp.fromEmail} onChange={(e) => setSmtp({ fromEmail: e.target.value })} />
              </Field>
            </FormGrid>
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
              Os jogadores veem: <strong className="text-fg">{v.smtp.fromName || '—'}</strong> &lt;{v.smtp.fromEmail || '—'}&gt;
            </p>
          </SettingsSection>
        </FormFieldset>

        <Card>
          <CardHeader icon={BadgeCheck} title="O que depende do e-mail" description="Se o envio parar, tudo isto para junto." />
          <CardBody>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {USES.map((u) => (
                <li key={u.label}>
                  <a href={u.href} className="flex items-center gap-3 rounded-xl border border-line p-3 transition-colors duration-150 hover:border-line-strong hover:bg-surface-2">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-text">
                      <u.icon size={17} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-fg">{u.label}</span>
                      <span className="block truncate text-xs text-fg-3">{u.detail}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
      <SaveBar form={form} />
    </>
  )
}

function ProviderDesc({ text, badge }: { text: string; badge: ReactNode }) {
  return (
    <>
      <span className="block">{text}</span>
      <span className="mt-1.5 block">{badge}</span>
    </>
  )
}

function ChannelCard({ icon: Icon, title, on, detail }: { icon: typeof Mail; title: string; on: boolean; detail: string }) {
  return (
    <div className={cn('card flex items-center gap-3 p-4', !on && 'bg-surface-2/60')}>
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', on ? 'bg-success/10 text-success' : 'bg-surface-3 text-fg-3')}>
        <Icon size={20} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold text-fg">
          {title}
          <Badge tone={on ? 'success' : 'neutral'} icon={on ? CircleCheck : CircleX}>
            {on ? 'Disponível' : 'Indisponível'}
          </Badge>
        </p>
        <p className="mt-0.5 truncate text-xs text-fg-3">{detail}</p>
      </div>
    </div>
  )
}

function ConnectedBox({ items, onDisconnect, disabled }: { items: { label: string; value: ReactNode }[]; onDisconnect: () => void; disabled: boolean }) {
  return (
    <div className="rounded-xl border border-success/25 bg-success/5 p-4">
      <DescriptionList items={items} />
      <div className="mt-4 flex justify-end">
        <Button size="sm" icon={Unplug} className="text-danger" onClick={onDisconnect} disabled={disabled}>
          Desconectar
        </Button>
      </div>
    </div>
  )
}

function useConnect<T extends object>(initial: T, validate: (d: T) => Record<string, string>, onConnect: (d: T) => void) {
  const [draft, setDraft] = useState(initial)
  const [touched, setTouched] = useState(false)
  const [loading, setLoading] = useState(false)
  const errors = validate(draft)
  const err = (k: keyof T & string) => (touched ? errors[k] ?? null : null)
  const submit = () => {
    setTouched(true)
    if (Object.keys(errors).length) return
    setLoading(true)
    setTimeout(() => {
      setLoading(false)
      onConnect(draft)
    }, 700)
  }
  return { draft, set: (p: Partial<T>) => setDraft((d) => ({ ...d, ...p })), err, submit, loading }
}

function MailgunConnect({ onConnect, disabled }: { onConnect: (d: MailgunDraft) => void; disabled: boolean }) {
  const c = useConnect<MailgunDraft>({ domain: '', apiKey: '', region: 'us' }, validateMailgun, onConnect)
  return (
    <form
      className="space-y-4 rounded-xl border border-dashed border-line-strong p-4"
      onSubmit={(e) => {
        e.preventDefault()
        c.submit()
      }}
    >
      <p className="text-[13px] text-fg-2">Sem conta conectada. Preencha com os dados do painel da Mailgun.</p>
      <FormGrid>
        <Field label="Domínio de envio" htmlFor="mg-domain" error={c.err('domain')} hint="O domínio verificado na Mailgun.">
          <Input id="mg-domain" value={c.draft.domain} invalid={!!c.err('domain')} placeholder="mg.x2win.bet.br" className="font-mono" onChange={(e) => c.set({ domain: e.target.value })} />
        </Field>
        <Field label="Chave de API" htmlFor="mg-key" error={c.err('apiKey')} hint="Cifrada ao salvar.">
          <Input id="mg-key" type="password" autoComplete="new-password" value={c.draft.apiKey} invalid={!!c.err('apiKey')} placeholder="DEMO-mailgun-..." onChange={(e) => c.set({ apiKey: e.target.value })} />
        </Field>
      </FormGrid>
      <Field label="Região da conta">
        <Segmented<'us' | 'eu'>
          ariaLabel="Região da conta Mailgun"
          value={c.draft.region}
          onChange={(r) => c.set({ region: r })}
          options={[
            { value: 'us', label: 'EUA' },
            { value: 'eu', label: 'Europa' },
          ]}
        />
      </Field>
      <Button type="submit" variant="primary" icon={Plug} loading={c.loading} disabled={disabled}>
        Conectar conta
      </Button>
    </form>
  )
}

function SendworkConnect({ onConnect, disabled }: { onConnect: (d: SendworkDraft) => void; disabled: boolean }) {
  const c = useConnect<SendworkDraft>({ accountId: '', apiKey: '', smsSender: '', rcsAgent: '' }, validateSendwork, onConnect)
  return (
    <form
      className="space-y-4 rounded-xl border border-dashed border-line-strong p-4"
      onSubmit={(e) => {
        e.preventDefault()
        c.submit()
      }}
    >
      <p className="text-[13px] text-fg-2">Sem conta conectada. Conecte para liberar SMS e RCS em Disparos e Jornadas.</p>
      <FormGrid>
        <Field label="ID da conta" htmlFor="sw-account" error={c.err('accountId')}>
          <Input id="sw-account" value={c.draft.accountId} invalid={!!c.err('accountId')} placeholder="SW-10482" className="font-mono" onChange={(e) => c.set({ accountId: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Chave de API" htmlFor="sw-key" error={c.err('apiKey')} hint="Cifrada ao salvar.">
          <Input id="sw-key" type="password" autoComplete="new-password" value={c.draft.apiKey} invalid={!!c.err('apiKey')} placeholder="DEMO-sendwork-..." onChange={(e) => c.set({ apiKey: e.target.value })} />
        </Field>
        <Field label="Remetente do SMS" htmlFor="sw-sender" error={c.err('smsSender')} hint="Short code (ex.: 29012) ou nome curto (ex.: X2Win).">
          <Input id="sw-sender" value={c.draft.smsSender} invalid={!!c.err('smsSender')} placeholder="X2Win" onChange={(e) => c.set({ smsSender: e.target.value })} />
        </Field>
        <Field label="Agente RCS" htmlFor="sw-rcs" error={c.err('rcsAgent')} hint="ID do agente aprovado pelo Google.">
          <Input id="sw-rcs" value={c.draft.rcsAgent} invalid={!!c.err('rcsAgent')} placeholder="x2win-oficial" className="font-mono" onChange={(e) => c.set({ rcsAgent: e.target.value.toLowerCase() })} />
        </Field>
      </FormGrid>
      <Button type="submit" variant="primary" icon={Plug} loading={c.loading} disabled={disabled}>
        Conectar conta
      </Button>
    </form>
  )
}
