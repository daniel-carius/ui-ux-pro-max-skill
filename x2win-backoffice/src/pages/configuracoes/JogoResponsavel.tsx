import { useState } from 'react'
import {
  ArrowDownToLine,
  BellRing,
  CalendarClock,
  CirclePause,
  Coffee,
  Gauge,
  Hourglass,
  MessageSquareQuote,
  Plus,
  Scale,
  Timer,
  Trash2,
  TrendingDown,
  UserX,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  FormFieldset,
  IconButton,
  Input,
  KpiCard,
  MoneyInput,
  NumberInput,
  PageHeader,
  RadioCards,
  SaveBar,
  Segmented,
  Switch,
  useSettingsForm,
} from '@/components/ui'
import { brl, dateTime, num, pct } from '@/lib/format'
import { cn } from '@/lib/cn'
import { usePlayerCounts } from '@/domain/config1-metricas'
import {
  DEFAULT_RG,
  EXCLUSION_OPTIONS,
  MESSAGE_MAX,
  PAUSE_OPTIONS,
  PERIODS,
  PERIOD_LABEL,
  RG_KEY,
  SESSION_MAX,
  SESSION_MIN,
  limitChangeEffect,
  limitErrors,
  rgPlayerStats,
  validateRg,
  type LimitPair,
  type Period,
  type RgConfig,
} from '@/domain/config1-jogo-responsavel'
import { BrowserFrame } from './_shared-f'

export default function JogoResponsavel() {
  const form = useSettingsForm<RgConfig>(RG_KEY, DEFAULT_RG, {
    entity: 'Jogo responsável',
    successMessage: 'Regras de jogo responsável salvas',
    // nomes que a auditoria mostra no lugar das chaves técnicas
    fieldLabels: {
      deposit: 'Limites de depósito',
      loss: 'Limites de perda',
      session: 'Alerta de sessão',
      pause: 'Opções de pausa',
      exclusion: 'Opções de autoexclusão',
      coolingOffHours: 'Espera para aumentar limite',
      messages: 'Mensagens',
    },
    validate: validateRg,
  })
  const v = form.values
  const st = rgPlayerStats(usePlayerCounts())
  const setLimit = (kind: 'deposit' | 'loss', p: Period, key: keyof LimitPair, n: number) =>
    form.setValues((prev) => ({ ...prev, [kind]: { ...prev[kind], [p]: { ...prev[kind][p], [key]: n } } }))
  const setMsg = (i: number, text: string) => form.setValues((p) => ({ ...p, messages: { ...p.messages, items: p.messages.items.map((m, j) => (j === i ? text : m)) } }))

  return (
    <>
      <PageHeader />

      <Alert tone="info" icon={Scale} title="Base legal: Lei 14.790/2023 e portarias da SPA/MF" className="mb-5">
        A lei e as portarias da Secretaria de Prêmios e Apostas (entre elas a Portaria SPA/MF nº 1.231/2024, de jogo responsável) exigem ferramentas de controle para o
        apostador. Por isso, limites, pausa e autoexclusão ficam <strong className="text-fg">sempre disponíveis</strong> em Minha conta › Jogo responsável. Aqui você ajusta
        só os parâmetros.
      </Alert>

      <section aria-label="Uso das ferramentas" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Em pausa agora" icon={CirclePause} tone="warning" value={num(st.paused)} hint="sem depósito e sem apostas" />
        <KpiCard label="Autoexcluídos" icon={UserX} tone="danger" value={num(st.excluded)} hint="conta bloqueada até o fim do prazo" />
        <KpiCard
          label="Com limite ativo"
          icon={Gauge}
          tone="success"
          value={st.withLimit === null ? 'Indisponível' : num(st.withLimit)}
          hint={st.withLimit === null ? 'o servidor ainda não informa os limites' : `${pct(st.depositors ? st.withLimit / st.depositors : 0, 0)} de quem já depositou`}
          formula={
            st.withLimit === null
              ? 'Jogadores ativos com ao menos um limite de depósito, perda ou tempo definido por eles. O servidor ainda não envia esta contagem.'
              : 'Jogadores ativos com ao menos um limite de depósito, perda ou tempo definido por eles. Simulado nesta demonstração.'
          }
        />
        <KpiCard
          label="Aumentos em espera"
          icon={Hourglass}
          tone="info"
          value={st.waitingIncrease === null ? 'Indisponível' : num(st.waitingIncrease)}
          hint={st.waitingIncrease === null ? 'o servidor ainda não informa os pedidos' : `prazo de ${form.saved.coolingOffHours} h antes de valer`}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <FormFieldset readOnly={form.readOnly}>
          <LimitCard
            icon={ArrowDownToLine}
            title="Limite de depósito"
            description="Quanto o jogador pode depositar por período. Ele escolhe o próprio limite até o máximo abaixo."
            pairs={v.deposit}
            onChange={(p, k, n) => setLimit('deposit', p, k, n)}
            error={limitErrors(v.deposit, 'Limite de depósito')}
          />
          <LimitCard
            icon={TrendingDown}
            title="Limite de perda"
            description="Quanto o jogador aceita perder (apostas menos prêmios) por período. Ao atingir, as apostas ficam bloqueadas até o período virar."
            pairs={v.loss}
            onChange={(p, k, n) => setLimit('loss', p, k, n)}
            error={limitErrors(v.loss, 'Limite de perda')}
          />

          <Card>
            <CardHeader icon={Timer} title="Alerta de tempo de sessão" description="Um aviso aparece a cada intervalo de jogo contínuo, no cassino e nas apostas esportivas." />
            <CardBody className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <Field
                  label="Avisar a cada"
                  htmlFor="rg-session"
                  error={v.session.everyMinutes < SESSION_MIN || v.session.everyMinutes > SESSION_MAX ? `Entre ${SESSION_MIN} e ${SESSION_MAX} minutos.` : null}
                  className="w-40"
                >
                  <NumberInput
                    id="rg-session"
                    value={v.session.everyMinutes}
                    min={SESSION_MIN}
                    max={SESSION_MAX}
                    onValueChange={(n) => form.set('session', { ...v.session, everyMinutes: Math.round(n) })}
                    suffix="min"
                    invalid={v.session.everyMinutes < SESSION_MIN || v.session.everyMinutes > SESSION_MAX}
                  />
                </Field>
                <Segmented
                  ariaLabel="Atalhos de intervalo"
                  value={String(v.session.everyMinutes)}
                  onChange={(x) => form.set('session', { ...v.session, everyMinutes: Number(x) })}
                  options={['30', '60', '90'].map((m) => ({ value: m, label: `${m} min` }))}
                  className="mb-0.5"
                />
              </div>
              <Switch
                label="Mostrar o resumo da sessão"
                description="Quanto tempo jogou, quanto apostou e o resultado desde que entrou."
                checked={v.session.showSummary}
                onChange={(x) => form.set('session', { ...v.session, showSummary: x })}
              />
              <Switch
                label="Pausar o jogo até o jogador responder"
                description="O jogo só continua depois que ele toca em “Continuar” ou escolhe uma pausa."
                checked={v.session.requireAck}
                onChange={(x) => form.set('session', { ...v.session, requireAck: x })}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon={Coffee} title="Pausa e autoexclusão" description="Prazos que o jogador pode escolher. Na pausa e na autoexclusão, ele não deposita nem aposta; o saldo real pode ser sacado." />
            <CardBody className="space-y-5">
              <Field label="Pausa" error={!Object.values(v.pause).some(Boolean) ? 'Ofereça ao menos uma duração.' : null} hint="A conta volta sozinha ao fim do prazo.">
                <ToggleChips
                  options={PAUSE_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
                  value={v.pause}
                  onChange={(id, on) => form.set('pause', { ...v.pause, [id]: on })}
                  disabled={form.readOnly}
                />
              </Field>
              <Field
                label="Autoexclusão"
                error={!Object.values(v.exclusion).some(Boolean) ? 'Ofereça ao menos um prazo.' : null}
                hint="Não pode ser desfeita antes do prazo. A permanente não pode ser revertida."
              >
                <ToggleChips
                  options={EXCLUSION_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
                  value={v.exclusion}
                  onChange={(id, on) => form.set('exclusion', { ...v.exclusion, [id]: on })}
                  disabled={form.readOnly}
                />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon={CalendarClock} title="Prazo para aumentar limite" description="Diminuir um limite vale na hora. Aumentar ou remover só vale depois do prazo, para o jogador ter tempo de pensar." />
            <CardBody>
              <RadioCards
                name="Prazo para aumentar limite"
                value={String(v.coolingOffHours) as '24' | '72'}
                onChange={(x) => form.set('coolingOffHours', Number(x) as 24 | 72)}
                options={[
                  { value: '24', label: '24 horas', description: 'O aumento vale no dia seguinte.' },
                  { value: '72', label: '72 horas', description: 'Mais proteção para quem está perdendo o controle.', badge: <Badge tone="success">Recomendado</Badge> },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              icon={MessageSquareQuote}
              title="Mensagens de jogo responsável"
              description="Frases curtas que aparecem em rodízio no site."
              actions={
                <Button
                  size="sm"
                  icon={Plus}
                  disabled={form.readOnly || v.messages.items.length >= 8}
                  onClick={() => form.set('messages', { ...v.messages, items: [...v.messages.items, ''] })}
                >
                  Adicionar
                </Button>
              }
            />
            <CardBody className="space-y-4">
              <ol className="space-y-2">
                {v.messages.items.map((m, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-2.5 w-5 shrink-0 text-center text-xs font-semibold text-fg-3 tnum">{i + 1}</span>
                    <Field
                      className="flex-1"
                      error={!m.trim() ? 'Escreva a mensagem ou remova a linha.' : m.length > MESSAGE_MAX ? `Máximo de ${MESSAGE_MAX} caracteres.` : null}
                    >
                      <Input
                        aria-label={`Mensagem ${i + 1}`}
                        value={m}
                        onChange={(e) => setMsg(i, e.target.value)}
                        invalid={!m.trim() || m.length > MESSAGE_MAX}
                        suffix={<span className={cn('text-[11px] tnum', m.length > MESSAGE_MAX ? 'text-danger' : 'text-fg-3')}>{m.length}</span>}
                      />
                    </Field>
                    <IconButton
                      icon={Trash2}
                      label={`Remover mensagem ${i + 1}`}
                      variant="danger"
                      disabled={form.readOnly || v.messages.items.length <= 1}
                      onClick={() => form.set('messages', { ...v.messages, items: v.messages.items.filter((_, j) => j !== i) })}
                    />
                  </li>
                ))}
              </ol>
              <div>
                <p className="mb-2 text-[13px] font-medium text-fg">Onde aparecem</p>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <Checkbox label="Rodapé do site" checked={v.messages.footer} onChange={(x) => form.set('messages', { ...v.messages, footer: x })} disabled={form.readOnly} />
                  <Checkbox label="Tela de depósito" checked={v.messages.deposit} onChange={(x) => form.set('messages', { ...v.messages, deposit: x })} disabled={form.readOnly} />
                  <Checkbox label="Alerta de sessão" checked={v.messages.session} onChange={(x) => form.set('messages', { ...v.messages, session: x })} disabled={form.readOnly} />
                </div>
              </div>
            </CardBody>
          </Card>
        </FormFieldset>

        <div className="min-w-0 space-y-5 xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardHeader icon={BellRing} title="Prévia do alerta de sessão" description="Como o jogador vê ao completar o intervalo." />
            <CardBody>
              <SessionAlertPreview c={v} />
            </CardBody>
          </Card>
          <LimitSimulator c={v} />
        </div>
      </div>

      <SaveBar form={form} label="Salvar regras" />
    </>
  )
}

function LimitCard({
  icon,
  title,
  description,
  pairs,
  onChange,
  error,
}: {
  icon: typeof ArrowDownToLine
  title: string
  description: string
  pairs: Record<Period, LimitPair>
  onChange: (p: Period, k: keyof LimitPair, n: number) => void
  error: string | null
}) {
  const id = title.replace(/\W+/g, '-').toLowerCase()
  return (
    <Card>
      <CardHeader icon={icon} title={title} description={description} />
      <CardBody>
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="hidden grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)] gap-4 border-b border-line bg-surface-2 px-4 py-2 text-xs font-medium text-fg-3 sm:grid">
            <span>Período</span>
            <span>Padrão em contas novas</span>
            <span>Máximo que o jogador escolhe</span>
          </div>
          {PERIODS.map((p) => {
            const pr = pairs[p]
            const bad = pr.default > pr.max
            return (
              <div key={p} className="grid gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)] sm:items-start sm:gap-4">
                <span className="pt-2 text-sm font-medium text-fg">{PERIOD_LABEL[p]}</span>
                <Field
                  label={<span className="sm:sr-only">Padrão em contas novas</span>}
                  htmlFor={`${id}-${p}-def`}
                  error={bad ? 'Acima do máximo' : null}
                >
                  <MoneyInput id={`${id}-${p}-def`} value={pr.default} onValueChange={(n) => onChange(p, 'default', n)} invalid={bad} />
                </Field>
                <Field label={<span className="sm:sr-only">Máximo que o jogador escolhe</span>} htmlFor={`${id}-${p}-max`} error={!(pr.max > 0) ? 'Precisa ser maior que zero' : null}>
                  <MoneyInput id={`${id}-${p}-max`} value={pr.max} onValueChange={(n) => onChange(p, 'max', n)} invalid={!(pr.max > 0)} />
                </Field>
              </div>
            )
          })}
        </div>
        {error ? (
          <p className="mt-2 text-xs font-medium text-danger" role="alert">
            {error}
          </p>
        ) : (
          <p className="mt-2 text-xs text-fg-3">R$ 0,00 no padrão: a conta nova começa sem limite e o jogador define o dele.</p>
        )}
      </CardBody>
    </Card>
  )
}

function ToggleChips<K extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { id: K; label: string }[]
  value: Record<K, boolean>
  onChange: (id: K, on: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value[o.id]
        return (
          <button
            key={o.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.id, !on)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60',
              on ? 'border-primary bg-primary/10 text-primary-text' : 'border-line bg-surface text-fg-3 hover:border-line-strong hover:text-fg',
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', on ? 'bg-primary' : 'bg-line-strong')} aria-hidden />
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function SessionAlertPreview({ c }: { c: RgConfig }) {
  const msg = c.messages.session ? c.messages.items.find((m) => m.trim()) : null
  const options = PAUSE_OPTIONS.filter((o) => c.pause[o.id])
  return (
    <BrowserFrame url="x2win.bet.br/cassino/fortune-tiger">
      <div className="relative bg-surface-3 p-4">
        <div className="absolute inset-0 grid grid-cols-3 gap-2 p-3 opacity-40" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="rounded-lg bg-surface-2" />
          ))}
        </div>
        <div className="relative mx-auto max-w-[280px] rounded-xl border border-line bg-surface p-4 shadow-pop">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10 text-warning">
              <Timer size={16} aria-hidden />
            </span>
            <p className="text-[13px] font-semibold leading-5 text-fg">Você está jogando há {c.session.everyMinutes} minutos</p>
          </div>
          {c.session.showSummary && (
            <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-surface-2 p-2 text-center">
              <div>
                <dt className="text-[10px] text-fg-3">Apostou</dt>
                <dd className="text-[12px] font-semibold text-fg tnum">{brl(240)}</dd>
              </div>
              <div>
                <dt className="text-[10px] text-fg-3">Ganhou</dt>
                <dd className="text-[12px] font-semibold text-fg tnum">{brl(182.5)}</dd>
              </div>
              <div>
                <dt className="text-[10px] text-fg-3">Resultado</dt>
                <dd className="text-[12px] font-semibold text-danger tnum">−{brl(57.5)}</dd>
              </div>
            </dl>
          )}
          {msg && <p className="mt-3 text-[11.5px] italic leading-4 text-fg-2">“{msg}”</p>}
          <div className="mt-3 grid gap-1.5" aria-hidden>
            <span className="flex h-8 items-center justify-center rounded-lg bg-primary text-[12px] font-semibold text-primary-fg">Continuar jogando</span>
            <span className="flex h-8 items-center justify-center rounded-lg border border-line text-[12px] font-medium text-fg">Fazer uma pausa</span>
          </div>
          {options.length > 0 && <p className="mt-1.5 text-center text-[10.5px] text-fg-3">Pausas: {options.map((o) => o.label).join(' · ')}</p>}
          {c.session.requireAck && <p className="mt-2 text-center text-[10.5px] text-fg-3">O jogo fica pausado até você escolher.</p>}
        </div>
      </div>
    </BrowserFrame>
  )
}

function LimitSimulator({ c }: { c: RgConfig }) {
  const [period, setPeriod] = useState<Period>('daily')
  const [current, setCurrent] = useState(200)
  const [next, setNext] = useState(500)
  const max = c.deposit[period].max
  const r = limitChangeEffect(current, next, c.coolingOffHours)
  const overMax = next > max
  return (
    <Card>
      <CardHeader icon={CalendarClock} title="Simular troca de limite" description="Quando um pedido do jogador passa a valer, com as regras do rascunho." />
      <CardBody className="space-y-3">
        <Segmented
          size="sm"
          ariaLabel="Período do limite"
          value={period}
          onChange={setPeriod}
          options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Limite atual" htmlFor="sim-cur" hint={current === 0 ? 'Sem limite' : undefined}>
            <MoneyInput id="sim-cur" value={current} onValueChange={setCurrent} />
          </Field>
          <Field label="Novo limite" htmlFor="sim-next" hint={next === 0 ? 'Remover limite' : undefined}>
            <MoneyInput id="sim-next" value={next} onValueChange={setNext} invalid={overMax} />
          </Field>
        </div>
        <div aria-live="polite">
          {overMax ? (
            <Alert tone="danger" title="Pedido recusado">
              Acima do máximo de depósito {PERIOD_LABEL[period].toLowerCase()} ({brl(max)}).
            </Alert>
          ) : r.kind === 'igual' ? (
            <Alert tone="neutral">O limite não muda.</Alert>
          ) : r.immediate ? (
            <Alert tone="success" title="Vale na hora">
              Reduzir o limite protege o jogador e não tem espera.
            </Alert>
          ) : (
            <Alert tone="warning" title={`Vale em ${dateTime(r.effectiveAt)}`} icon={Hourglass}>
              {next === 0 ? 'Remover o limite' : `Subir de ${current ? brl(current) : 'sem limite'} para ${brl(next)}`} espera {c.coolingOffHours} horas. Até lá, vale o limite atual.
            </Alert>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
