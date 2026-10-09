import { useEffect, useState } from 'react'
import { CalendarClock, Clock, Construction, KeyRound, Link2, Power, RefreshCw, ShieldCheck, Siren, Wallet, XCircle, CheckCircle2 } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  Field,
  FormFieldset,
  Input,
  PageHeader,
  SaveBar,
  Textarea,
  TextLink,
  confirm,
  toast,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { dateTime, duration, time } from '@/lib/format'
import { useDb } from '@/lib/store'
import { audit, useAudit, usePageAccess } from '@/domain/session'
import { useCompany, useMaintenance, type MaintenanceState } from '@/domain/system'
import { MAINTENANCE_MESSAGE_MAX, bypassUrl, newBypassToken, validateMaintenance } from '@/domain/seguranca'
import { DEFAULT_SOCIAL, P2_KEYS, footerDefaults, type FooterSettings, type SocialSettings } from '@/data/personalizacao2-config'
import { BrowserFrame, CharCount, DeviceToggle, initialDevice, LivePreview, PREVIEW, SiteLogo, SocialRow, useMergedSettingsForm, type Device } from '../personalizacao/_shared-p2'

const KEYS = ['message', 'returnAt'] as const
type Draft = Pick<MaintenanceState, (typeof KEYS)[number]>

/** ISO → valor do campo datetime-local (hora local) */
function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function fromLocalInput(v: string) {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function returnLabel(iso: string | null, now: number) {
  if (!iso) return 'Sem previsão'
  const d = new Date(iso)
  const today = new Date(now)
  const tomorrow = new Date(now + 86_400_000)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, today)) return `hoje às ${time(d)}`
  if (same(d, tomorrow)) return `amanhã às ${time(d)}`
  return dateTime(d)
}

const COMPARISON: { label: string; maint: boolean; attack: boolean | 'opcional' }[] = [
  { label: 'Site aberto para jogadores', maint: false, attack: true },
  { label: 'Depósitos', maint: false, attack: true },
  { label: 'Saques', maint: false, attack: true },
  { label: 'Jogos e apostas', maint: false, attack: true },
  { label: 'Cadastro de contas novas', maint: false, attack: 'opcional' },
  { label: 'Equipe testa pelo link de acesso', maint: true, attack: true },
]

export default function Manutencao() {
  const [maint, setMaint] = useMaintenance()
  const [company] = useCompany()
  const [footer] = useDb<FooterSettings>(P2_KEYS.footer, () => footerDefaults(company))
  const [social] = useDb<SocialSettings>(P2_KEYS.social, DEFAULT_SOCIAL)
  const [auditLog] = useAudit()
  const { canEdit } = usePageAccess()
  const [now, setNow] = useState(() => Date.now())
  const [device, setDevice] = useState<Device>(initialDevice)
  const form = useMergedSettingsForm(maint, setMaint, KEYS, {
    entity: 'Manutenção',
    successMessage: 'Aviso de manutenção salvo',
    validate: (v) => Object.values(validateMaintenance(v, Date.now()))[0] ?? null,
    describe: (v) => `Aviso e previsão de volta atualizados (previsão: ${v.returnAt ? dateTime(v.returnAt) : 'sem previsão'})`,
  })
  const v = form.values
  const errors = validateMaintenance(v, now)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), maint.active ? 1000 : 30_000)
    return () => clearInterval(id)
  }, [maint.active])

  const since = maint.since ? new Date(maint.since).getTime() : null
  const elapsed = since ? Math.max(0, now - since) : 0
  const returnAt = maint.returnAt ? new Date(maint.returnAt).getTime() : null
  const overdue = maint.active && returnAt !== null && returnAt < now
  const lastOn = auditLog.find((a) => a.entity === 'Manutenção' && a.action === 'ligar')
  const url = bypassUrl(maint.bypassToken)

  const turnOn = async () => {
    if (!canEdit) {
      toast.error('Seu cargo não pode colocar o site em manutenção.')
      return
    }
    const errs = validateMaintenance(v, Date.now())
    const first = Object.values(errs)[0]
    if (first) {
      toast.error('Revise o aviso antes de fechar o site', { description: first })
      return
    }
    const ok = await confirm({
      title: 'Fechar o site para manutenção?',
      description: 'Todos os jogadores passam a ver a página de manutenção na hora.',
      confirmLabel: 'Fechar o site',
      tone: 'danger',
      icon: Construction,
      typeToConfirm: 'FECHAR',
      details: (
        <div className="space-y-3 text-[13px]">
          <div className="rounded-xl border border-danger/25 bg-danger/5 p-3">
            <p className="mb-1 font-semibold text-fg">Para até você reabrir</p>
            <p className="text-fg-2">Login, cadastro, depósitos, saques, jogos e apostas esportivas. Apostas em aberto ficam pendentes.</p>
          </div>
          <div className="rounded-xl border border-line bg-surface-2 p-3 text-fg-2">
            <p>
              <strong className="text-fg">Previsão de volta:</strong> {returnLabel(v.returnAt, Date.now())}
            </p>
            <p className="mt-1">
              <strong className="text-fg">Equipe:</strong> entra pelo link de acesso para testes.
            </p>
          </div>
          <p className="text-fg-3">É um ataque de robôs? Prefira o Modo de ataque: ele mantém depósitos, saques e jogos funcionando.</p>
        </div>
      ),
    })
    if (!ok) return
    const at = new Date().toISOString()
    setMaint((prev) => ({ ...prev, ...v, active: true, since: at }))
    audit('ligar', 'Manutenção', `Site fechado para manutenção. Previsão de volta: ${v.returnAt ? dateTime(v.returnAt) : 'sem previsão'}`)
    toast.warning('Site em manutenção', { description: 'Os jogadores veem o aviso. A equipe vê o alerta amarelo no topo do painel.' })
  }

  const turnOff = async () => {
    if (!canEdit) {
      toast.error('Seu cargo não pode reabrir o site.')
      return
    }
    const ok = await confirm({
      title: 'Reabrir o site?',
      description: `O site está fechado há ${since ? duration(Date.now() - since) : '—'}. Login, depósitos, saques e jogos voltam na hora para todos.`,
      confirmLabel: 'Reabrir o site',
      tone: 'success',
      icon: Power,
    })
    if (!ok) return
    setMaint((prev) => ({ ...prev, active: false, since: null }))
    audit('desligar', 'Manutenção', `Site reaberto após ${since ? duration(Date.now() - since) : 'manutenção'}`)
    toast.success('Site reaberto', { description: 'Os jogadores já podem entrar de novo.' })
  }

  const regenerate = async () => {
    if (!canEdit) {
      toast.error('Seu cargo não pode trocar o link de testes.')
      return
    }
    const ok = await confirm({
      title: 'Gerar um novo link de acesso?',
      description: 'O link atual deixa de funcionar na hora. Quem estiver testando com ele precisa do link novo.',
      confirmLabel: 'Gerar novo link',
      tone: 'warning',
      icon: RefreshCw,
    })
    if (!ok) return
    setMaint((prev) => ({ ...prev, bypassToken: newBypassToken() }))
    audit('editar', 'Manutenção', 'Link de acesso para testes trocado; o anterior deixou de valer')
    toast.success('Novo link gerado', { description: 'Copie e envie só para a equipe.' })
  }

  const quick = (label: string, at: () => Date) => (
    <button
      key={label}
      type="button"
      disabled={form.readOnly}
      onClick={() => form.set('returnAt', at().toISOString())}
      className="rounded-full border border-line px-2.5 py-1 text-xs text-fg-2 transition-colors hover:border-line-strong hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  )
  const plus = (min: number) => () => {
    const d = new Date(Date.now() + min * 60_000)
    d.setSeconds(0, 0)
    d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5)
    return d
  }

  const frame = (d: Device) => (
    <BrowserFrame device={d} url="x2win.bet.br" label="Prévia da página de manutenção">
      <MaintenancePage draft={v} footer={footer} social={social} mobile={d === 'mobile'} now={now} />
    </BrowserFrame>
  )

  return (
    <>
      <PageHeader
        actions={
          maint.active ? (
            <Button variant="success" icon={Power} onClick={turnOff} disabled={!canEdit} title={!canEdit ? 'Seu cargo não altera a manutenção' : undefined}>
              Reabrir o site
            </Button>
          ) : (
            <Button variant="danger" icon={Construction} onClick={turnOn} disabled={!canEdit} title={!canEdit ? 'Seu cargo não altera a manutenção' : undefined}>
              Fechar o site para manutenção
            </Button>
          )
        }
      />

      {/* Estado atual */}
      {maint.active ? (
        <section aria-label="Estado atual" role="status" className="mb-5 rounded-2xl border border-warning/35 bg-warning/[0.07] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-warning text-surface">
              <Construction size={22} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-warning">Estado atual</p>
              <h2 className="text-xl font-bold text-fg">Site fechado para manutenção</h2>
              <p className="mt-1 text-[13px] text-fg-2">
                Desde {since ? time(since) : '—'}
                {lastOn ? ` por ${lastOn.actorName}` : ''} · há {since ? duration(elapsed) : '—'}. Depósitos, saques e jogos estão parados.
              </p>
            </div>
            <div className="rounded-xl bg-surface/70 p-3 ring-1 ring-inset ring-warning/25 lg:min-w-[220px]">
              <p className="flex items-center gap-1.5 text-xs text-fg-3">
                <CalendarClock size={13} aria-hidden /> Previsão de volta
              </p>
              <p className={cn('mt-0.5 font-display text-lg font-bold tnum', overdue ? 'text-danger' : 'text-fg')}>{returnLabel(maint.returnAt, now)}</p>
              {returnAt !== null && <p className="text-xs text-fg-3">{overdue ? `passou há ${duration(now - returnAt)}` : `em ${duration(returnAt - now)}`}</p>}
            </div>
            <Button variant="success" size="lg" icon={Power} onClick={turnOff} disabled={!canEdit}>
              Reabrir o site
            </Button>
          </div>
          {overdue && (
            <Alert tone="danger" className="mt-4" title="A previsão de volta já passou">
              Os jogadores continuam vendo o horário antigo. Atualize a previsão abaixo e salve, ou reabra o site.
            </Alert>
          )}
        </section>
      ) : (
        <section aria-label="Estado atual" className="mb-5 flex flex-col gap-4 rounded-2xl border border-success/25 bg-success/5 p-5 sm:flex-row sm:items-center">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-success/15 text-success">
            <ShieldCheck size={22} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-success">Estado atual</p>
            <h2 className="text-xl font-bold text-fg">Site aberto</h2>
            <p className="mt-1 text-[13px] text-fg-2">
              Jogadores entram, depositam, sacam e jogam normalmente.
              {lastOn ? ` Última manutenção: ${dateTime(lastOn.at)} por ${lastOn.actorName}.` : ''} Prepare o aviso abaixo antes de fechar.
            </p>
          </div>
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,500px)]">
        <div className="min-w-0 space-y-5">
          <FormFieldset readOnly={form.readOnly}>
            <Card>
              <CardHeader
                icon={Construction}
                title="Aviso para os jogadores"
                description={maint.active ? 'O site está fechado: ao salvar, o aviso muda na hora.' : 'Fica pronto para quando o site for fechado.'}
              />
              <CardBody className="space-y-4">
                <Field label="Mensagem" htmlFor="mt-msg" required error={errors.message} labelAside={<CharCount count={v.message.length} max={MAINTENANCE_MESSAGE_MAX} />} hint="Diga o motivo em uma frase e que o saldo está seguro.">
                  <Textarea id="mt-msg" rows={3} value={v.message} onChange={(e) => form.set('message', e.target.value)} invalid={!!errors.message} />
                </Field>
                <Field label="Previsão de volta" htmlFor="mt-return" error={errors.returnAt} hint={v.returnAt && !errors.returnAt ? `Os jogadores veem: ${returnLabel(v.returnAt, now)}.` : 'Opcional. Em branco, a página mostra "Voltamos em breve".'}>
                  <Input
                    id="mt-return"
                    type="datetime-local"
                    value={toLocalInput(v.returnAt)}
                    min={toLocalInput(new Date(now).toISOString())}
                    onChange={(e) => form.set('returnAt', fromLocalInput(e.target.value))}
                    invalid={!!errors.returnAt}
                  />
                </Field>
                <div className="flex flex-wrap gap-1.5" aria-label="Atalhos de previsão">
                  {quick('+30 min', plus(30))}
                  {quick('+1 h', plus(60))}
                  {quick('+2 h', plus(120))}
                  {quick('+4 h', plus(240))}
                  {quick('Amanhã 08:00', () => {
                    const d = new Date(Date.now() + 86_400_000)
                    d.setHours(8, 0, 0, 0)
                    return d
                  })}
                  <button
                    type="button"
                    disabled={form.readOnly}
                    onClick={() => form.set('returnAt', null)}
                    className="rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs text-fg-3 transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Sem previsão
                  </button>
                </div>
              </CardBody>
            </Card>
          </FormFieldset>

          <Card>
            <CardHeader
              icon={KeyRound}
              title="Link de acesso para testes"
              description="Quem abre este link entra no site mesmo em manutenção. Envie só para a equipe."
              actions={
                <Button size="sm" icon={RefreshCw} onClick={regenerate} disabled={!canEdit}>
                  Gerar novo link
                </Button>
              }
            />
            <CardBody className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="input-base flex min-w-0 items-center gap-2 bg-surface-2 font-mono text-[13px] text-fg-2" aria-label="Link de acesso para testes">
                  <Link2 size={14} className="shrink-0 text-fg-3" aria-hidden />
                  <span className="truncate">{url}</span>
                </div>
                <CopyButton value={url} label="Copiar link de testes" />
              </div>
              <p className="text-xs leading-5 text-fg-3">
                O acesso vale por 24 horas no navegador de quem abriu. Gerar um novo link derruba o anterior. A equipe também entra pelo painel normalmente.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon={Siren} title="Manutenção ou modo de ataque?" description="A manutenção fecha tudo. O modo de ataque só endurece a entrada e mantém o dinheiro circulando." />
            <CardBody>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-[13px]">
                  <caption className="sr-only">Comparação entre manutenção e modo de ataque</caption>
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-fg-3">
                      <th scope="col" className="pb-2 font-semibold">
                        O que acontece
                      </th>
                      <th scope="col" className="pb-2 font-semibold">
                        Manutenção
                      </th>
                      <th scope="col" className="pb-2 font-semibold">
                        Modo de ataque
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {COMPARISON.map((r) => (
                      <tr key={r.label}>
                        <th scope="row" className="py-2.5 pr-3 text-left font-medium text-fg">
                          {r.label}
                        </th>
                        <td className="py-2.5 pr-3">
                          <YesNo value={r.maint} />
                        </td>
                        <td className="py-2.5">
                          <YesNo value={r.attack} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-fg-3">
                Ataque de robôs ou tráfego anormal? Use <TextLink to="/settings/modo-ataque">Modo de ataque</TextLink>.
              </p>
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0">
          <LivePreview
            dirty={form.dirty}
            title="Página que o jogador vê"
            description={maint.active ? 'No ar agora para todos os jogadores.' : 'Aparece quando o site for fechado.'}
            actions={<DeviceToggle value={device} onChange={setDevice} />}
            expand={frame('desktop')}
            footnote={
              <>
                Contato e redes vêm de <TextLink to="/settings/footer">Rodapé e contato</TextLink> e <TextLink to="/settings/social">Redes sociais</TextLink>.
              </>
            }
          >
            {frame(device)}
          </LivePreview>
        </div>
      </div>

      <SaveBar form={form} label="Salvar aviso" />
    </>
  )
}

function YesNo({ value }: { value: boolean | 'opcional' }) {
  if (value === 'opcional') return <Badge tone="warning">Pode fechar</Badge>
  return value ? (
    <Badge tone="success" icon={CheckCircle2}>
      Funciona
    </Badge>
  ) : (
    <Badge tone="danger" icon={XCircle}>
      Para
    </Badge>
  )
}

// ---------- Página de manutenção (site do jogador) ----------

function MaintenancePage({ draft, footer, social, mobile, now }: { draft: Draft; footer: FooterSettings; social: SocialSettings; mobile: boolean; now: number }) {
  const ret = draft.returnAt ? new Date(draft.returnAt).getTime() : null
  const left = ret && ret > now ? ret - now : null
  const h = left ? Math.floor(left / 3_600_000) : 0
  const m = left ? Math.floor((left % 3_600_000) / 60_000) : 0
  return (
    <div
      className="flex flex-col items-center text-center"
      style={{
        minHeight: mobile ? 700 : 620,
        padding: mobile ? '36px 22px' : '56px 48px',
        background: `radial-gradient(80% 60% at 50% 0%, rgba(124,77,255,0.28), transparent 70%), ${PREVIEW.bg}`,
        color: PREVIEW.text,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <SiteLogo size={mobile ? 30 : 36} name={footer.companyName || 'X2Win'} />
      <span
        className="relative mt-10 inline-flex items-center justify-center"
        style={{ width: mobile ? 104 : 124, height: mobile ? 104 : 124, borderRadius: 999, background: 'rgba(250,204,21,0.1)', border: '1px solid rgba(250,204,21,0.3)' }}
      >
        <span className="absolute inset-3 rounded-full" style={{ border: '2px dashed rgba(250,204,21,0.35)' }} aria-hidden />
        <Construction size={mobile ? 44 : 54} style={{ color: PREVIEW.gold }} aria-hidden />
      </span>
      <h1 style={{ marginTop: 28, fontSize: mobile ? 26 : 34, fontWeight: 800, letterSpacing: '-0.02em', fontFamily: '"Plus Jakarta Sans", Inter, sans-serif' }}>Estamos em manutenção</h1>
      <p style={{ marginTop: 12, maxWidth: 520, fontSize: mobile ? 15 : 16, lineHeight: 1.6, color: PREVIEW.muted, whiteSpace: 'pre-line' }}>
        {draft.message.trim() || 'Estamos fazendo melhorias. Voltamos em breve.'}
      </p>

      <div style={{ marginTop: 28, padding: '16px 22px', borderRadius: 16, background: PREVIEW.surface, border: `1px solid ${PREVIEW.line}`, minWidth: mobile ? '100%' : 360 }}>
        <p className="flex items-center justify-center" style={{ gap: 6, fontSize: 12, color: PREVIEW.muted, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
          <Clock size={13} aria-hidden /> Previsão de volta
        </p>
        {ret ? (
          <>
            <p style={{ marginTop: 6, fontSize: mobile ? 20 : 24, fontWeight: 800 }}>{returnLabel(draft.returnAt, now)}</p>
            {left !== null && (
              <div className="flex justify-center" style={{ gap: 10, marginTop: 12 }}>
                {[
                  [h, h === 1 ? 'hora' : 'horas'],
                  [m, 'min'],
                ].map(([n, l]) => (
                  <span key={String(l)} style={{ minWidth: 72, padding: '8px 10px', borderRadius: 12, background: PREVIEW.surface2 }}>
                    <span style={{ display: 'block', fontSize: 22, fontWeight: 800, color: PREVIEW.accentText }} className="tnum">
                      {String(n).padStart(2, '0')}
                    </span>
                    <span style={{ fontSize: 11, color: PREVIEW.muted }}>{l}</span>
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <p style={{ marginTop: 6, fontSize: 18, fontWeight: 700 }}>Voltamos em breve</p>
        )}
      </div>

      <p className="flex items-center justify-center" style={{ marginTop: 22, gap: 8, fontSize: 13, color: PREVIEW.text }}>
        <Wallet size={15} style={{ color: PREVIEW.green }} aria-hidden /> Seu saldo e suas apostas estão seguros.
      </p>
      {footer.email.trim() && (
        <p style={{ marginTop: 6, fontSize: 13, color: PREVIEW.muted }}>
          Dúvidas? Escreva para <span style={{ color: PREVIEW.accentText, fontWeight: 600 }}>{footer.email}</span>
        </p>
      )}
      {social.links.some((l) => l.visible) && (
        <div style={{ marginTop: 20 }}>
          <SocialRow links={social.links} mobile />
        </div>
      )}
      <p style={{ marginTop: 'auto', paddingTop: 32, fontSize: 11.5, color: PREVIEW.faint }}>Proibido para menores de 18 anos · Jogue com responsabilidade</p>
    </div>
  )
}
