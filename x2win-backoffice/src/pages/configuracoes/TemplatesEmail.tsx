import { useMemo, useRef, useState } from 'react'
import {
  Braces,
  CircleCheck,
  IdCard,
  Lock,
  Mail,
  MailCheck,
  MailX,
  Monitor,
  Pencil,
  RotateCcw,
  Search,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  ChipFilter,
  Drawer,
  EmptyState,
  Field,
  Input,
  KpiCard,
  PageHeader,
  Segmented,
  Switch,
  Textarea,
  Tooltip,
  confirm,
  toast,
} from '@/components/ui'
import { num, relative } from '@/lib/format'
import { cn } from '@/lib/cn'
import { isApiMode } from '@/lib/api'
import { useCollection } from '@/lib/store'
import { EMAIL_KEYS, defaultTemplate, seedEmailTemplates } from '@/data/config2-email'
import { audit, usePageAccess, useSession } from '@/domain/session'
import { useCompany, useIntegrations } from '@/domain/system'
import {
  CATEGORY_LABEL,
  NO_MESSAGE_SENDING,
  PROVIDER_LABEL,
  VARIABLE_SAMPLES,
  fillVariables,
  renderEmailBlocks,
  usedVariables,
  validateTemplate,
  type EmailTemplate,
  type TemplateCategory,
} from '@/domain/config2-email'

const CATEGORY_ICON: Record<TemplateCategory, LucideIcon> = { conta: ShieldCheck, financeiro: Wallet, kyc: IdCard, equipe: Users }
const CATEGORY_ORDER: TemplateCategory[] = ['conta', 'financeiro', 'kyc', 'equipe']
type Filter = 'todos' | TemplateCategory | 'desligados'

/**
 * Modo API: o servidor ainda não envia e-mails. Ligado/desligado e os textos ficam guardados para quando o envio
 * for ligado; a tela não diz "Enviado" nem "Sendo enviados" e o teste fica desligado (antes inventava um envio).
 */
const API = isApiMode()
const SENT_LABEL = API ? 'Ligado' : 'Enviado'
const NOT_SENT_LABEL = API ? 'Desligado' : 'Não enviado'
const ALWAYS_LABEL = API ? 'Sempre ligado' : 'Sempre enviado'

function isCustom(t: EmailTemplate) {
  const d = defaultTemplate(t.id)
  return !!d && (d.subject !== t.subject || d.body !== t.body)
}

export default function TemplatesEmail() {
  const { canEdit } = usePageAccess()
  const templates = useCollection<EmailTemplate>(EMAIL_KEYS.templates, seedEmailTemplates)
  const [integrations] = useIntegrations()
  const [filter, setFilter] = useState<Filter>('todos')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const all = templates.items
  const enabled = all.filter((t) => t.enabled)
  const custom = all.filter(isCustom)
  const off = all.filter((t) => !t.enabled)
  const q = query.trim().toLowerCase()
  const rows = all.filter(
    (t) =>
      (filter === 'todos' || (filter === 'desligados' ? !t.enabled : t.category === filter)) &&
      (!q || `${t.name} ${t.subject} ${t.trigger}`.toLowerCase().includes(q)),
  )

  const toggle = async (t: EmailTemplate, on: boolean) => {
    if (t.locked) return
    if (!on) {
      const ok = await confirm({
        title: `Parar de enviar "${t.name}"?`,
        description: `O jogador não recebe mais este e-mail (${t.trigger.toLowerCase()}). O evento continua acontecendo normalmente.`,
        confirmLabel: 'Parar de enviar',
        tone: 'warning',
        icon: MailX,
      })
      if (!ok) return
    }
    templates.update(t.id, { enabled: on })
    audit(on ? 'ligar' : 'desligar', `E-mail "${t.name}"`, on ? 'Envio ligado' : 'Envio desligado')
    toast.success(on ? 'E-mail ligado' : 'E-mail desligado', { description: t.name })
  }

  const open = all.find((t) => t.id === openId)
  const counts = (c: TemplateCategory) => all.filter((t) => t.category === c).length

  return (
    <>
      <PageHeader />
      <div className="space-y-5">
        <section aria-label="Resumo" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="E-mails transacionais" icon={Mail} value={num(all.length)} hint={`${all.filter((t) => t.locked).length} de segurança, ${API ? 'sempre ligados' : 'sempre enviados'}`} />
          {API ? (
            <KpiCard label="Ligados" icon={MailCheck} tone="info" value={`${enabled.length} de ${all.length}`} hint="envio de e-mail ainda não ligado no servidor" />
          ) : (
            <KpiCard label="Sendo enviados" icon={MailCheck} tone="success" value={`${enabled.length} de ${all.length}`} hint={`pelo ${PROVIDER_LABEL[integrations.emailProvider]}`} />
          )}
          <KpiCard label="Personalizados" icon={Pencil} tone="info" value={num(custom.length)} hint="texto diferente do padrão" />
          <KpiCard label="Desligados" icon={MailX} tone={off.length ? 'warning' : 'neutral'} value={num(off.length)} hint={off.map((t) => t.name).join(', ') || 'todos ligados'} onClick={() => setFilter(filter === 'desligados' ? 'todos' : 'desligados')} active={filter === 'desligados'} />
        </section>

        {API && (
          <Alert tone="warning" icon={MailX} title="Nenhum destes e-mails sai do servidor nesta versão">
            {NO_MESSAGE_SENDING} Os textos e o liga/desliga ficam guardados aqui.
          </Alert>
        )}
        <Alert tone="info" icon={Lock}>
          E-mails de segurança (redefinição de senha, verificação de e-mail, código 2FA e convite) {API ? 'ficam sempre ligados' : 'são sempre enviados'}: desligar deixaria pessoas sem acesso.{' '}
          {integrations.smtp.fromEmail.trim() ? (
            <>
              O remetente é{' '}
              <strong>
                {integrations.smtp.fromName.trim() ? `${integrations.smtp.fromName} ` : ''}&lt;{integrations.smtp.fromEmail}&gt;
              </strong>
              , definido em <a className="link" href="#/settings/integracoes">Integrações</a>.
            </>
          ) : (
            <>
              O remetente ainda não foi definido: informe-o em <a className="link" href="#/settings/integracoes">Integrações</a>.
            </>
          )}
        </Alert>
        {off.some((t) => t.id === 'kyc-reprovado') && (
          <Alert tone="warning" icon={TriangleAlert} title="KYC reprovado está desligado">
            Quem tem os documentos recusados não fica sabendo e não reenvia, e o saque fica travado. Considere ligar.
          </Alert>
        )}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <ChipFilter<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'todos', label: 'Todos', count: all.length },
              ...CATEGORY_ORDER.map((c) => ({ value: c as Filter, label: CATEGORY_LABEL[c], count: counts(c) })),
              { value: 'desligados', label: 'Desligados', count: off.length, tone: 'warning' as const },
            ]}
          />
          <Input icon={Search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome ou assunto" aria-label="Buscar template" className="lg:w-72" />
        </div>

        {rows.length ? (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {rows.map((t) => {
              const Icon = CATEGORY_ICON[t.category]
              return (
                <article key={t.id} className={cn('card flex flex-col', !t.enabled && 'bg-surface-2/60')}>
                  <div className="flex items-start gap-3 p-4 pb-3">
                    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', t.enabled ? 'bg-primary/10 text-primary-text' : 'bg-surface-3 text-fg-3')}>
                      <Icon size={17} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-[14px] font-semibold text-fg">{t.name}</h2>
                      <p className="truncate text-xs text-fg-3">{t.trigger}</p>
                    </div>
                    {t.locked ? (
                      <span title={API ? 'E-mail de segurança: não pode ser desligado' : 'E-mail de segurança: sempre enviado'}>
                        <Badge tone={API ? 'info' : 'success'} icon={Lock}>{ALWAYS_LABEL}</Badge>
                      </span>
                    ) : (
                      <Switch size="sm" checked={t.enabled} disabled={!canEdit} onChange={(on) => toggle(t, on)} ariaLabel={`Enviar o e-mail ${t.name}`} />
                    )}
                  </div>
                  <div className="mx-4 rounded-lg bg-surface-2 px-3 py-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-fg-3">Assunto</p>
                    <p className="mt-0.5 truncate text-[13px] text-fg">{fillVariables(t.subject)}</p>
                  </div>
                  <div className="flex flex-1 flex-wrap items-center gap-1.5 px-4 py-3">
                    <Badge tone={t.enabled ? (API ? 'info' : 'success') : 'neutral'} dot>
                      {t.enabled ? SENT_LABEL : NOT_SENT_LABEL}
                    </Badge>
                    {isCustom(t) ? <Badge tone="info">Personalizado</Badge> : <Badge>Texto padrão</Badge>}
                    <Badge icon={Braces}>{usedVariables(`${t.subject} ${t.body}`).length} variáveis</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
                    <span className="truncate text-xs text-fg-3">{t.updatedAt ? `Editado ${relative(t.updatedAt)} por ${t.updatedBy}` : 'Nunca editado'}</span>
                    <Button size="sm" icon={canEdit ? Pencil : Mail} onClick={() => setOpenId(t.id)}>
                      {canEdit ? 'Editar' : 'Ver'}
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="card">
            <EmptyState icon={Search} title="Nenhum template encontrado" description="Troque o filtro ou a busca." action={<Button size="sm" onClick={() => { setFilter('todos'); setQuery('') }}>Limpar filtros</Button>} />
          </div>
        )}
      </div>

      {open && <TemplateDrawer key={open.id} t={open} canEdit={canEdit} onClose={() => setOpenId(null)} onSave={(patch) => templates.update(open.id, patch)} />}
    </>
  )
}

function TemplateDrawer({ t, canEdit, onClose, onSave }: { t: EmailTemplate; canEdit: boolean; onClose: () => void; onSave: (p: Partial<EmailTemplate>) => void }) {
  const { user } = useSession()
  const [company] = useCompany()
  const [integrations] = useIntegrations()
  const [subject, setSubject] = useState(t.subject)
  const [body, setBody] = useState(t.body)
  const [enabled, setEnabled] = useState(t.enabled)
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [sending, setSending] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const subjectRef = useRef<HTMLInputElement>(null)
  const lastFocus = useRef<'subject' | 'body'>('body')
  const check = validateTemplate({ subject, body, variables: t.variables, required: t.required })
  const dirty = subject !== t.subject || body !== t.body || enabled !== t.enabled
  const def = defaultTemplate(t.id)
  const isDefault = def?.subject === subject && def?.body === body
  const used = usedVariables(`${subject}\n${body}`)
  const blocks = useMemo(() => renderEmailBlocks(body), [body])
  const readOnly = !canEdit

  const insert = (name: string) => {
    const token = `{{${name}}}`
    if (lastFocus.current === 'subject' && subjectRef.current) {
      const el = subjectRef.current
      const s = el.selectionStart ?? subject.length
      const e = el.selectionEnd ?? subject.length
      setSubject(subject.slice(0, s) + token + subject.slice(e))
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(s + token.length, s + token.length)
      })
      return
    }
    const el = bodyRef.current
    const s = el?.selectionStart ?? body.length
    const e = el?.selectionEnd ?? body.length
    setBody(body.slice(0, s) + token + body.slice(e))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(s + token.length, s + token.length)
    })
  }

  const close = async () => {
    if (dirty && !readOnly) {
      const ok = await confirm({ title: 'Descartar alterações?', description: 'O texto editado ainda não foi salvo.', confirmLabel: 'Descartar', tone: 'warning' })
      if (!ok) return
    }
    onClose()
  }

  const save = () => {
    if (check.errors.length) {
      toast.error('Revise o template', { description: check.errors[0] })
      return
    }
    onSave({ subject, body, enabled, updatedAt: new Date().toISOString(), updatedBy: user.name })
    const parts: string[] = []
    if (subject !== t.subject) parts.push('assunto')
    if (body !== t.body) parts.push('corpo')
    if (enabled !== t.enabled) parts.push(enabled ? 'envio ligado' : 'envio desligado')
    audit('editar', `E-mail "${t.name}"`, `Alterado: ${parts.join(', ')}`)
    toast.success('Template salvo', { description: API ? 'O texto fica guardado para quando o envio de e-mails for ligado.' : 'Os próximos e-mails já saem com o texto novo.' })
    onClose()
  }

  const restore = async () => {
    if (!def) return
    const ok = await confirm({
      title: `Restaurar o texto padrão de "${t.name}"?`,
      description: 'O assunto e o corpo voltam ao texto da plataforma. O que foi personalizado se perde.',
      confirmLabel: 'Restaurar padrão',
      tone: 'warning',
      icon: RotateCcw,
    })
    if (!ok) return
    setSubject(def.subject)
    setBody(def.body)
    onSave({ subject: def.subject, body: def.body, updatedAt: new Date().toISOString(), updatedBy: user.name })
    audit('editar', `E-mail "${t.name}"`, 'Texto padrão restaurado')
    toast.success('Texto padrão restaurado')
  }

  const sendTest = () => {
    // modo API: o servidor não envia e-mails; um "teste enviado" seria inventado (e iria para a auditoria)
    if (API) {
      toast.info('Envio de teste indisponível nesta versão', { description: NO_MESSAGE_SENDING })
      return
    }
    if (check.errors.length) {
      toast.error('Corrija o template antes de testar', { description: check.errors[0] })
      return
    }
    setSending(true)
    setTimeout(() => {
      setSending(false)
      audit('testar', `E-mail "${t.name}"`, `Teste enviado para ${user.email} via ${PROVIDER_LABEL[integrations.emailProvider]}`)
      toast.success('E-mail de teste enviado', { description: `Para ${user.email}, com os dados de exemplo.` })
    }, 700)
  }

  return (
    <Drawer
      open
      onClose={close}
      width="xl"
      title={t.name}
      description={t.trigger}
      headerExtra={
        t.locked ? (
          <Badge tone={API ? 'info' : 'success'} icon={Lock} size="md">
            {ALWAYS_LABEL}
          </Badge>
        ) : (
          <Badge tone={enabled ? (API ? 'info' : 'success') : 'neutral'} dot size="md">
            {enabled ? SENT_LABEL : NOT_SENT_LABEL}
          </Badge>
        )
      }
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={restore} disabled={readOnly || isDefault}>
              Restaurar padrão
            </Button>
            <Button size="sm" icon={MailCheck} onClick={sendTest} loading={sending} disabled={readOnly || API} title={API ? NO_MESSAGE_SENDING : undefined}>
              Enviar teste
            </Button>
          </div>
          <div className="flex gap-2">
            <Button onClick={close}>{readOnly ? 'Fechar' : 'Cancelar'}</Button>
            {!readOnly && (
              <Button variant="primary" onClick={save} disabled={!dirty || check.errors.length > 0}>
                Salvar template
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <fieldset disabled={readOnly} className="min-w-0 space-y-4">
          <Field label="Assunto" htmlFor="tpl-subject" hint={`${subject.length} de 120 caracteres`}>
            <Input id="tpl-subject" ref={subjectRef} value={subject} maxLength={120} onFocus={() => (lastFocus.current = 'subject')} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-fg">Variáveis</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Inserir variável">
              {t.variables.map((name) => {
                const isUsed = used.includes(name)
                const req = t.required.includes(name)
                return (
                  <Tooltip key={name} content={`${VARIABLE_SAMPLES[name]?.label ?? name} · ex.: ${VARIABLE_SAMPLES[name]?.sample ?? '—'}`}>
                    <button
                      type="button"
                      onClick={() => insert(name)}
                      className={cn(
                        'inline-flex h-7 items-center gap-1 rounded-md border px-2 font-mono text-[11.5px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60',
                        isUsed ? 'border-primary/30 bg-primary/10 text-primary-text' : req ? 'border-danger/40 bg-danger/5 text-danger' : 'border-line bg-surface-2 text-fg-2 hover:border-line-strong',
                      )}
                    >
                      {`{{${name}}}`}
                      {req && <span className="font-sans text-[10px] font-semibold">obrigatória</span>}
                    </button>
                  </Tooltip>
                )
              })}
            </div>
            <p className="mt-1.5 text-xs text-fg-3">Clique para inserir onde está o cursor.</p>
          </div>
          <Field label="Corpo" htmlFor="tpl-body" hint="Linha em branco separa parágrafos. **texto** deixa em negrito. [Texto](link) sozinho na linha vira botão.">
            <Textarea id="tpl-body" ref={bodyRef} rows={13} value={body} onFocus={() => (lastFocus.current = 'body')} onChange={(e) => setBody(e.target.value)} invalid={check.errors.length > 0} />
          </Field>
          {(check.errors.length > 0 || check.warnings.length > 0) && (
            <ul className="space-y-1.5" aria-live="polite">
              {check.errors.map((m) => (
                <li key={m} className="flex items-start gap-1.5 text-xs font-medium text-danger">
                  <TriangleAlert size={13} className="mt-px shrink-0" aria-hidden /> {m}
                </li>
              ))}
              {check.warnings.map((m) => (
                <li key={m} className="flex items-start gap-1.5 text-xs text-warning">
                  <TriangleAlert size={13} className="mt-px shrink-0" aria-hidden /> {m}
                </li>
              ))}
            </ul>
          )}
          {check.errors.length === 0 && (
            <p className="flex items-center gap-1.5 text-xs text-success">
              <CircleCheck size={13} aria-hidden /> Template válido{isDefault ? ' · texto padrão' : ' · personalizado'}
            </p>
          )}
          {t.locked ? (
            <Alert tone="info" icon={Lock}>
              E-mail de segurança: {API ? 'fica sempre ligado' : 'sempre enviado'}. Dá para mudar o texto, mas não desligar.
            </Alert>
          ) : (
            <Switch
              label="Enviar este e-mail"
              description={
                API
                  ? enabled
                    ? 'Ligado: quando o envio de e-mails for ligado no servidor, o jogador recebe quando o evento acontece.'
                    : 'Desligado: mesmo com o envio ligado no servidor, nenhum e-mail sai.'
                  : enabled
                    ? 'O jogador recebe quando o evento acontece.'
                    : 'Desligado: o evento acontece, mas nenhum e-mail sai.'
              }
              checked={enabled}
              onChange={setEnabled}
            />
          )}
        </fieldset>

        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-fg">Prévia com dados de exemplo</p>
            <Segmented<'desktop' | 'mobile'>
              size="sm"
              ariaLabel="Tamanho da prévia"
              value={device}
              onChange={setDevice}
              options={[
                { value: 'desktop', label: 'Computador', icon: Monitor },
                { value: 'mobile', label: 'Celular', icon: Smartphone },
              ]}
            />
          </div>
          <div className="rounded-xl border border-line bg-surface-3/60 p-3">
            <div className={cn('mx-auto overflow-hidden rounded-lg border border-line bg-surface shadow-card transition-[max-width] duration-200', device === 'mobile' ? 'max-w-[300px]' : 'max-w-full')}>
              <div className="space-y-0.5 border-b border-line px-3.5 py-2.5 text-xs">
                <p className="truncate text-fg-3">
                  De:{' '}
                  {integrations.smtp.fromEmail.trim() ? (
                    <span className="text-fg-2">
                      {integrations.smtp.fromName.trim() ? `${integrations.smtp.fromName.trim()} ` : ''}&lt;{integrations.smtp.fromEmail.trim()}&gt;
                    </span>
                  ) : (
                    <span className="text-warning">remetente não definido (Integrações)</span>
                  )}
                </p>
                <p className="truncate text-fg-3">
                  Para: <span className="text-fg-2">{VARIABLE_SAMPLES.email.sample}</span>
                </p>
                <p className="truncate text-[13px] font-semibold text-fg">{fillVariables(subject) || 'Sem assunto'}</p>
              </div>
              <div className="flex items-center gap-2 bg-primary px-4 py-3.5 text-primary-fg">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-fg/20 font-display text-sm font-bold" aria-hidden>
                  X
                </span>
                <span className="font-display text-base font-bold tracking-tight">{company.tradeName}</span>
              </div>
              <div className="space-y-3 px-5 py-5 text-[13.5px] leading-6 text-fg-2">
                {blocks.length ? (
                  blocks.map((b, i) =>
                    b.type === 'button' ? (
                      <div key={i} className="py-1 text-center">
                        <span className="inline-block rounded-lg bg-primary px-5 py-2.5 text-[13px] font-semibold text-primary-fg" title={b.href}>
                          {b.label}
                        </span>
                      </div>
                    ) : b.type === 'code' ? (
                      <p key={i} className="rounded-lg bg-surface-2 py-3 text-center font-mono text-2xl font-bold tracking-[0.3em] text-fg">
                        {b.text}
                      </p>
                    ) : (
                      <p key={i} className="whitespace-pre-line">
                        {b.parts.map((part, j) =>
                          part.bold ? (
                            <strong key={j} className="text-fg">
                              {part.text}
                            </strong>
                          ) : (
                            <span key={j}>{part.text}</span>
                          ),
                        )}
                      </p>
                    ),
                  )
                ) : (
                  <p className="text-fg-3">Corpo vazio.</p>
                )}
              </div>
              <div className="border-t border-line bg-surface-2 px-5 py-3 text-[11px] leading-4 text-fg-3">
                {[company.legalName, company.license].map((x) => x.trim()).filter(Boolean).join(' · ') || 'Razão social e licença: preencha em Empresa'}
                <br />
                Jogue com responsabilidade. Proibido para menores de 18 anos.
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-fg-3">As variáveis aparecem com dados de exemplo. No envio, vêm os dados reais do jogador.</p>
        </div>
      </div>
    </Drawer>
  )
}
