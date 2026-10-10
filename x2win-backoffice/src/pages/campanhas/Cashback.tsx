import { useMemo, useState } from 'react'
import {
  BadgePercent,
  Calculator,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Coins,
  HandCoins,
  Percent,
  Receipt,
  RotateCcw,
  TrendingDown,
  Undo2,
  Users,
  XCircle,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { BarsChart } from '@/components/charts'
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
  MoneyInput,
  NumberInput,
  PageHeader,
  RadioCards,
  SaveBar,
  Segmented,
  Select,
  SettingsSection,
  Switch,
  useSettingsForm,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { brl, brlCompact, dateTime, num, pct } from '@/lib/format'
import { isApiMode } from '@/lib/api'
import { usePlayers } from '@/data/hooks'
import { getDailySeries, sumSeries } from '@/data/metrics'
import { cashbackCycles } from '@/data/campanhas3-seeds'
import {
  CASHBACK_KEY,
  DEFAULT_CASHBACK,
  PERIOD_LABEL,
  PERIOD_IN,
  PERIOD_NOUN,
  nextCreditDate,
  periodWindowLabel,
  projectCycle,
  simulateCashback,
  simulateRakeback,
  validateCashback,
  type CashbackConfig,
  type CashbackRules,
  type RakebackRules,
} from '@/domain/campanhas3-cashback'
import { BET_CATEGORIES, BET_CATEGORY_LABEL, WEEKDAYS, levelIndexForXp, slotColor, useLevelsConfig, type BetCategory, type Level } from '@/domain/campanhas3-niveis'
import { EMPTY_CAMPAIGN_METRICS, refreshPlayerMetrics, usePlayerMetrics, type CashbackProjection } from '@/domain/campanhas-jogadores'

const API = isApiMode()

/** Regras que mudam a projeção do servidor (o período não: ele devolve os três). */
const PROJECTION_RULES = ['enabled', 'mode', 'pct', 'minLoss', 'cap'] as const

/**
 * Projeção do próximo crédito. Demonstração: calculada aqui com a lista de jogadores e o
 * rascunho. Modo API: a tela não lê a base; vem pronta do servidor (geral.jogadores.metricas),
 * calculada com as regras SALVAS de cashback e níveis, para os três períodos.
 */
function useDemoProjection(cb: CashbackRules, levels: Level[]): CashbackProjection {
  const { items: players } = usePlayers()
  return useMemo(() => projectCycle(players, cb, levels, levelIndexForXp), [players, cb, levels])
}
function useServerProjection(cb: CashbackRules): CashbackProjection {
  const metrics = usePlayerMetrics()
  return (metrics ?? EMPTY_CAMPAIGN_METRICS).cashback[cb.period]
}
const useProjection: (cb: CashbackRules, levels: Level[]) => CashbackProjection = API ? useServerProjection : useDemoProjection

export default function Cashback() {
  const form = useSettingsForm<CashbackConfig>(CASHBACK_KEY, DEFAULT_CASHBACK, {
    entity: 'Cashback e Rakeback',
    successMessage: 'Regras de cashback e rakeback salvas',
    validate: validateCashback,
    // modo API: a projeção do servidor usa as regras salvas, mas a versão dela não muda ao salvar: busca de novo
    onSaved: refreshPlayerMetrics,
  })
  const v = form.values
  const cb = v.cashback
  const rb = v.rakeback
  const setCb = (p: Partial<CashbackRules>) => form.set('cashback', { ...cb, ...p })
  const setRb = (p: Partial<RakebackRules>) => form.set('rakeback', { ...rb, ...p })
  const [levelsCfg] = useLevelsConfig()
  const levels = levelsCfg.levels
  const projection = useProjection(cb, levels)
  // modo API: a projeção é das regras salvas; com o rascunho diferente, avisa (só o período vale na hora)
  const savedCb = form.saved.cashback
  const projectionEnabled = API ? savedCb.enabled : cb.enabled
  const unsavedRules = API && PROJECTION_RULES.some((k) => cb[k] !== savedCb[k])

  const cycles = useMemo(() => cashbackCycles(), [])
  const last = cycles[cycles.length - 1]
  const prev = cycles[cycles.length - 2]
  const lastTotal = last.cashback + last.rakeback
  const prevTotal = prev.cashback + prev.rakeback
  const ggrWeek = useMemo(() => sumSeries(getDailySeries().slice(-7)).ggr, [])
  const next = nextCreditDate(cb)
  const bothOff = !cb.enabled && !rb.enabled

  return (
    <>
      <PageHeader
        actions={
          <Link to="/campanhas/niveis" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong/80 bg-surface px-3.5 text-sm font-medium text-fg shadow-sm hover:bg-surface-3/70">
            <BadgePercent size={16} aria-hidden /> Cashback por nível
          </Link>
        }
      />

      <div className="space-y-5">
        <section aria-label="Resumo" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Pago no último ciclo"
            icon={HandCoins}
            tone="success"
            value={brl(lastTotal)}
            delta={prevTotal ? (lastTotal - prevTotal) / prevTotal : null}
            goodWhenUp={false}
            hint={`em ${last.label} · ${num(last.players)} jogadores`}
            formula="Cashback + rakeback creditados no último ciclo semanal. A variação compara com o ciclo anterior."
          />
          <KpiCard
            label="Jogadores elegíveis"
            icon={Users}
            tone="info"
            value={projectionEnabled ? num(projection.eligible) : '—'}
            hint={
              projectionEnabled
                ? `de ${num(projection.active)} ativos ${PERIOD_IN[cb.period]}${unsavedRules ? ' · regras salvas' : ''}`
                : API
                  ? 'cashback desligado nas regras salvas'
                  : 'cashback desligado'
            }
            formula={
              API
                ? `Jogadores ativos ${PERIOD_IN[cb.period]} cuja perda estimada passa do mínimo e cujo percentual é maior que zero. Usa as regras salvas de cashback e de Níveis e XP: mudanças ainda não salvas só entram depois de salvar (a troca de período vale na hora).`
                : `Jogadores ativos ${PERIOD_IN[cb.period]} cuja perda estimada passa do mínimo e cujo percentual é maior que zero. Usa o rascunho.`
            }
          />
          <KpiCard
            label="Projeção do próximo crédito"
            icon={CalendarClock}
            tone="primary"
            value={projectionEnabled ? brl(projection.total) : '—'}
            hint={
              projectionEnabled
                ? `${dateTime(next)}${projection.capped ? ` · ${num(projection.capped)} no teto` : ''}${unsavedRules ? ' · regras salvas' : ''}`
                : API
                  ? 'cashback desligado nas regras salvas'
                  : 'cashback desligado'
            }
            formula={
              API
                ? 'Soma do cashback estimado de cada jogador elegível, já limitado pelo teto, com as regras salvas. Perda estimada = perda média diária × dias do período.'
                : 'Soma do cashback estimado de cada jogador elegível, já limitado pelo teto. Perda estimada = perda média diária × dias do período.'
            }
          />
          <KpiCard
            label="Custo sobre o GGR"
            icon={TrendingDown}
            tone={lastTotal / ggrWeek > 0.12 ? 'danger' : 'warning'}
            value={pct(ggrWeek ? lastTotal / ggrWeek : 0)}
            hint={`GGR da semana: ${brlCompact(ggrWeek)}`}
            formula="(Cashback + rakeback do último ciclo) ÷ GGR dos últimos 7 dias. Acima de 12% merece revisão de percentuais e teto."
          />
        </section>

        {bothOff && (
          <Alert tone="warning" title="Cashback e rakeback desligados">
            Nenhum valor é devolvido aos jogadores. A página de cashback some do site até um dos dois ser ligado.
          </Alert>
        )}

        <Card>
          <CardHeader
            icon={Receipt}
            title="Pago por ciclo"
            description="Últimos 8 créditos semanais"
            actions={<Badge tone="neutral">{`Total: ${brl(cycles.reduce((s, c) => s + c.cashback + c.rakeback, 0))}`}</Badge>}
          />
          <CardBody>
            <BarsChart
              ariaLabel="Cashback e rakeback pagos por ciclo"
              data={cycles.map((c) => ({ label: c.label, cashback: c.cashback, rakeback: c.rakeback }))}
              xKey="label"
              stacked
              format="brl"
              height={220}
              series={[
                { key: 'cashback', label: 'Cashback', slot: 1 },
                { key: 'rakeback', label: 'Rakeback', slot: 3 },
              ]}
            />
          </CardBody>
        </Card>

        <FormFieldset readOnly={form.readOnly}>
          <SettingsSection
            title="Cashback"
            description="Devolve parte da perda líquida (apostado − ganho) do período. Só conta o que o jogador perdeu nas categorias marcadas."
            aside={<StatusPill on={cb.enabled} />}
          >
            <Switch
              label="Cashback ligado"
              description={cb.enabled ? `Crédito ${PERIOD_LABEL[cb.period].toLowerCase()}, próximo em ${dateTime(next)}.` : 'Desligado: nenhum jogador recebe cashback.'}
              checked={cb.enabled}
              onChange={(on) => setCb({ enabled: on })}
            />
            <div className={cn('space-y-5 transition-opacity', !cb.enabled && 'opacity-60')}>
              <Field label="Percentual">
                <RadioCards
                  name="Percentual do cashback"
                  value={cb.mode}
                  onChange={(mode) => setCb({ mode })}
                  options={[
                    { value: 'fixo', label: 'Percentual fixo', description: 'O mesmo percentual para todos os jogadores.', icon: Percent },
                    { value: 'por_nivel', label: 'Por nível', description: 'Cada nível tem o seu percentual, definido em Níveis e XP.', icon: BadgePercent },
                  ]}
                />
              </Field>
              {cb.mode === 'fixo' ? (
                <Field
                  label="Cashback"
                  htmlFor="cb-pct"
                  className="max-w-xs"
                  error={cb.pct <= 0 || cb.pct > 50 ? 'Entre 0,1% e 50%.' : null}
                  hint={`Perda de R$ 1.000,00 devolve ${brl(10 * cb.pct)}.`}
                >
                  <NumberInput id="cb-pct" value={cb.pct} min={0} max={50} step={0.5} suffix="%" onValueChange={(n) => setCb({ pct: n })} invalid={cb.pct <= 0 || cb.pct > 50} />
                </Field>
              ) : (
                <LevelPctTable levels={levels} enabled={levelsCfg.enabled} />
              )}

              <Field label="Período de apuração" hint={`Apura as ${periodWindowLabel(cb.period)}.`}>
                <Segmented
                  ariaLabel="Período de apuração"
                  value={cb.period}
                  onChange={(period) => !form.readOnly && setCb({ period })}
                  options={(['diario', 'semanal', 'mensal'] as const).map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
                />
              </Field>

              <FormGrid columns={3}>
                {cb.period === 'semanal' && (
                  <Field label="Dia do crédito" htmlFor="cb-wd">
                    <Select id="cb-wd" value={String(cb.creditWeekday)} onChange={(x) => setCb({ creditWeekday: Number(x) })} options={WEEKDAYS.map((d) => ({ value: String(d.value), label: d.label }))} />
                  </Field>
                )}
                {cb.period === 'mensal' && (
                  <Field label="Dia do mês" htmlFor="cb-md" error={cb.creditMonthDay < 1 || cb.creditMonthDay > 28 ? 'De 1 a 28.' : null}>
                    <NumberInput id="cb-md" value={cb.creditMonthDay} min={1} max={28} onValueChange={(n) => setCb({ creditMonthDay: Math.round(n) })} />
                  </Field>
                )}
                <Field label="Hora do crédito" htmlFor="cb-hour" hint="Horário de Brasília.">
                  <Input id="cb-hour" type="time" value={cb.creditHour} onChange={(e) => setCb({ creditHour: e.target.value })} />
                </Field>
              </FormGrid>

              <FormGrid>
                <Field label="Perda mínima no período" htmlFor="cb-min" hint="Abaixo disso o jogador não recebe nada.">
                  <MoneyInput id="cb-min" value={cb.minLoss} onValueChange={(n) => setCb({ minLoss: n })} />
                </Field>
                <Field label="Teto por jogador" htmlFor="cb-cap" hint={cb.cap > 0 ? `Ninguém recebe mais que ${brl(cb.cap)} por ${PERIOD_NOUN[cb.period]}.` : 'R$ 0,00 = sem teto (não recomendado).'}>
                  <MoneyInput id="cb-cap" value={cb.cap} onValueChange={(n) => setCb({ cap: n })} />
                </Field>
              </FormGrid>

              <Field label="Jogos que contam" error={!cb.categories.length ? 'Escolha ao menos uma categoria.' : null} hint="Apostas fora destas categorias não entram na perda líquida.">
                <CategoryChips value={cb.categories} onChange={(categories) => setCb({ categories })} />
              </Field>

              <FormGrid>
                <Field
                  label="Rollover do cashback"
                  htmlFor="cb-roll"
                  hint={cb.rollover === 0 ? 'Vai como saldo real e pode ser sacado na hora.' : `Cashback de R$ 100,00 exige ${brl(100 * cb.rollover)} em apostas antes do saque.`}
                  error={cb.rollover < 0 || cb.rollover > 50 ? 'De 0x a 50x.' : null}
                >
                  <NumberInput id="cb-roll" value={cb.rollover} min={0} max={50} step={1} suffix="x" onValueChange={(n) => setCb({ rollover: n })} />
                </Field>
                {cb.claim === 'resgate' && (
                  <Field label="Prazo para resgatar" htmlFor="cb-claim" hint="Depois disso o valor expira." error={cb.claimDays < 1 || cb.claimDays > 30 ? 'De 1 a 30 dias.' : null}>
                    <NumberInput id="cb-claim" value={cb.claimDays} min={1} max={30} suffix="dias" onValueChange={(n) => setCb({ claimDays: Math.round(n) })} />
                  </Field>
                )}
              </FormGrid>
              <Field label="Como o jogador recebe">
                <RadioCards
                  name="Como o jogador recebe"
                  value={cb.claim}
                  onChange={(claim) => setCb({ claim })}
                  options={[
                    { value: 'automatico', label: 'Crédito automático', description: 'Cai na carteira no dia e hora do crédito.', icon: CheckCircle2 },
                    { value: 'resgate', label: 'Resgate no site', description: 'O jogador clica em "Resgatar" dentro do prazo.', icon: Undo2 },
                  ]}
                />
              </Field>
            </div>
          </SettingsSection>

          <SettingsSection
            title="Rakeback"
            description="Devolve uma parte de cada aposta, ganhando ou perdendo. Bom para jogadores de alto volume."
            aside={<StatusPill on={rb.enabled} />}
          >
            <Switch
              label="Rakeback ligado"
              description={rb.enabled ? `Pago ${rb.frequency === 'diario' ? 'todo dia' : 'toda semana'}, a partir de ${brl(rb.minPayout)}.` : 'Desligado: só o cashback devolve valores.'}
              checked={rb.enabled}
              onChange={(on) => setRb({ enabled: on })}
            />
            <div className={cn('space-y-5 transition-opacity', !rb.enabled && 'opacity-60')}>
              <FormGrid columns={3}>
                {BET_CATEGORIES.map((cat) => (
                  <Field key={cat} label={BET_CATEGORY_LABEL[cat]} htmlFor={`rb-${cat}`} error={rb.pct[cat] < 0 || rb.pct[cat] > 5 ? 'De 0% a 5%.' : null}>
                    <NumberInput id={`rb-${cat}`} value={rb.pct[cat]} min={0} max={5} step={0.05} suffix="%" onValueChange={(n) => setRb({ pct: { ...rb.pct, [cat]: n } })} />
                  </Field>
                ))}
              </FormGrid>
              <FormGrid>
                <Field label="Frequência">
                  <Segmented
                    ariaLabel="Frequência do rakeback"
                    value={rb.frequency}
                    onChange={(frequency) => !form.readOnly && setRb({ frequency })}
                    options={[
                      { value: 'diario', label: 'Diário' },
                      { value: 'semanal', label: 'Semanal' },
                    ]}
                  />
                </Field>
                <Field label="Pagamento mínimo" htmlFor="rb-min" hint="Abaixo disso o valor acumula para o próximo ciclo.">
                  <MoneyInput id="rb-min" value={rb.minPayout} onValueChange={(n) => setRb({ minPayout: n })} />
                </Field>
              </FormGrid>
            </div>
          </SettingsSection>
        </FormFieldset>

        <Simulator config={v} />
      </div>

      <SaveBar form={form} label="Salvar regras" />
    </>
  )
}

function StatusPill({ on }: { on: boolean }) {
  return (
    <Badge tone={on ? 'success' : 'neutral'} dot size="md">
      {on ? 'Ligado' : 'Desligado'}
    </Badge>
  )
}

function CategoryChips({ value, onChange }: { value: BetCategory[]; onChange: (v: BetCategory[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Categorias">
      {BET_CATEGORIES.map((cat) => {
        const on = value.includes(cat)
        return (
          <button
            key={cat}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== cat) : [...value, cat])}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60',
              on ? 'border-primary bg-primary/10 text-primary-text' : 'border-line bg-surface text-fg-2 hover:border-line-strong',
            )}
          >
            {on && <Check size={13} aria-hidden />}
            {BET_CATEGORY_LABEL[cat]}
          </button>
        )
      })}
    </div>
  )
}

function LevelPctTable({ levels, enabled }: { levels: { id: string; name: string; cashbackPct: number; slot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 }[]; enabled: boolean }) {
  const max = Math.max(1, ...levels.map((l) => l.cashbackPct))
  return (
    <div className="rounded-xl border border-line">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
        <p className="text-[13px] font-medium text-fg">Percentual por nível</p>
        <Link to="/campanhas/niveis" className="link text-[13px]">
          Editar em Níveis e XP
        </Link>
      </div>
      {!enabled && (
        <p className="border-b border-line bg-warning/5 px-3.5 py-2 text-xs text-warning">O programa de níveis está desligado: com ele desligado, ninguém recebe cashback por nível.</p>
      )}
      <ul className="grid grid-cols-1 gap-x-6 gap-y-2 p-3.5 sm:grid-cols-2">
        {levels.map((l) => (
          <li key={l.id} className="grid grid-cols-[minmax(0,96px)_minmax(0,1fr)_44px] items-center gap-2.5 text-[13px]">
            <span className="flex min-w-0 items-center gap-1.5 text-fg-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: slotColor(l.slot) }} aria-hidden />
              <span className="truncate">{l.name}</span>
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <span className="block h-full rounded-full" style={{ width: `${(l.cashbackPct / max) * 100}%`, background: slotColor(l.slot) }} />
            </span>
            <span className="text-right font-semibold text-fg tnum">{l.cashbackPct.toLocaleString('pt-BR')}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Simulator({ config }: { config: CashbackConfig }) {
  const [levelsCfg] = useLevelsConfig()
  const levels = levelsCfg.levels
  const INITIAL = { bets: 2400, wins: 1650, category: 'slots' as BetCategory, level: 3 }
  const [s, setS] = useState(INITIAL)
  const level = levels[Math.min(s.level, levels.length - 1)]
  const effectiveLevel = levelsCfg.enabled ? level : undefined
  const cbr = simulateCashback(config.cashback, { bets: s.bets, wins: s.wins, category: s.category, level: effectiveLevel })
  const rbr = simulateRakeback(config.rakeback, s.bets, s.category)
  const next = nextCreditDate(config.cashback)
  const total = cbr.credited + rbr.credited

  return (
    <Card>
      <CardHeader
        icon={Calculator}
        title="Simular um jogador"
        description="Perdas e apostas do período → quanto volta. Usa o rascunho, nada é creditado."
        actions={
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setS(INITIAL)}>
            Limpar
          </Button>
        }
      />
      <CardBody className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <FormGrid>
            <Field label={`Apostado ${PERIOD_IN[config.cashback.period]}`} htmlFor="sim-bets">
              <MoneyInput id="sim-bets" value={s.bets} onValueChange={(n) => setS((x) => ({ ...x, bets: n }))} />
            </Field>
            <Field label={`Ganho ${PERIOD_IN[config.cashback.period]}`} htmlFor="sim-wins">
              <MoneyInput id="sim-wins" value={s.wins} onValueChange={(n) => setS((x) => ({ ...x, wins: n }))} />
            </Field>
            <Field label="Categoria das apostas" htmlFor="sim-cat">
              <Select id="sim-cat" value={s.category} onChange={(c) => setS((x) => ({ ...x, category: c as BetCategory }))} options={BET_CATEGORIES.map((c) => ({ value: c, label: BET_CATEGORY_LABEL[c] }))} />
            </Field>
            <Field label="Nível do jogador" htmlFor="sim-level" hint={config.cashback.mode === 'fixo' ? 'Não muda o cashback fixo.' : `${level?.cashbackPct ?? 0}% neste nível.`}>
              <Select id="sim-level" value={String(Math.min(s.level, levels.length - 1))} onChange={(i) => setS((x) => ({ ...x, level: Number(i) }))} options={levels.map((l, i) => ({ value: String(i), label: l.name }))} />
            </Field>
          </FormGrid>
          <div className="rounded-xl bg-surface-2 px-4 py-3">
            <p className="text-xs text-fg-3">Perda líquida</p>
            <p className={cn('mt-0.5 font-display text-2xl font-bold tnum', cbr.netLoss > 0 ? 'text-danger' : 'text-success')}>{brl(cbr.netLoss)}</p>
            <p className="text-xs text-fg-3">{s.wins > s.bets ? `Lucro de ${brl(s.wins - s.bets)}: sem cashback, mas o rakeback vale.` : 'Apostado − ganho no período.'}</p>
          </div>
        </div>

        <div className="space-y-4" aria-live="polite">
          <div className="rounded-xl border border-line p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-fg">
                <Coins size={16} className="text-fg-3" aria-hidden /> Cashback
              </p>
              <Badge tone={cbr.status === 'creditado' ? 'success' : cbr.status === 'desligado' ? 'neutral' : 'danger'} size="md">
                {cbr.status === 'creditado' ? brl(cbr.credited) : cbr.status === 'desligado' ? 'Desligado' : 'Sem direito'}
              </Badge>
            </div>
            <ul className="space-y-2">
              {cbr.checks.map((c) => (
                <li key={c.label} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="flex min-w-0 items-center gap-2 text-fg-2">
                    {c.ok ? <CheckCircle2 size={15} className="shrink-0 text-success" aria-label="ok" /> : <XCircle size={15} className="shrink-0 text-danger" aria-label="bloqueia" />}
                    <span className="truncate">{c.label}</span>
                  </span>
                  <span className="shrink-0 text-fg-3 tnum">{c.detail}</span>
                </li>
              ))}
            </ul>
            {cbr.status === 'creditado' && (
              <div className="mt-3 space-y-1 border-t border-line pt-3 text-[13px] text-fg-2">
                <p>
                  {brl(cbr.netLoss)} × {cbr.pct.toLocaleString('pt-BR')}% = <strong className="text-fg">{brl(cbr.gross)}</strong>
                  {cbr.capped && <span className="text-warning"> → teto de {brl(config.cashback.cap)}</span>}
                </p>
                <p className="text-xs text-fg-3">
                  {config.cashback.rollover > 0 ? `Precisa apostar ${brl(cbr.wagerRequired)} (${config.cashback.rollover}x) antes de sacar.` : 'Sem rollover: pode sacar na hora.'}{' '}
                  {config.cashback.claim === 'resgate' ? `Resgate no site em até ${config.cashback.claimDays} dias.` : `Crédito automático em ${dateTime(next)}.`}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-line p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-fg">
                <CircleDollarSign size={16} className="text-fg-3" aria-hidden /> Rakeback
              </p>
              <Badge tone={!config.rakeback.enabled ? 'neutral' : rbr.credited > 0 ? 'success' : 'warning'} size="md">
                {!config.rakeback.enabled ? 'Desligado' : rbr.belowMin ? 'Acumula' : brl(rbr.credited)}
              </Badge>
            </div>
            {config.rakeback.enabled && (
              <p className="mt-2 text-[13px] text-fg-2">
                {brl(s.bets)} × {rbr.pct.toLocaleString('pt-BR')}% ({BET_CATEGORY_LABEL[s.category]}) = <strong className="text-fg">{brl(rbr.amount)}</strong>
                {rbr.belowMin && <span className="block text-xs text-warning">Abaixo do mínimo de {brl(config.rakeback.minPayout)}: soma no próximo ciclo.</span>}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between rounded-xl bg-primary/5 px-4 py-3 ring-1 ring-inset ring-primary/15">
            <span className="text-[13px] font-medium text-fg-2">Volta para o jogador</span>
            <span className="font-display text-2xl font-bold text-primary-text tnum">{brl(total)}</span>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
