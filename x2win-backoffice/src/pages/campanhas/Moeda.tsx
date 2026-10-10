import { useMemo, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Calculator,
  CalendarCheck,
  Cherry,
  ChevronsUp,
  Coins,
  Dice5,
  Flame,
  Grid3x3,
  Info,
  Rocket,
  RotateCcw,
  Spade,
  Target,
  Tv,
  Volleyball,
  Wallet,
  Zap,
} from 'lucide-react'
import { BarsChart, ChartLegend, DonutChart, Sparkline } from '@/components/charts'
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
  FormGrid,
  ImageUpload,
  Input,
  KpiCard,
  NO_SOURCE_HINT,
  NoDataSource,
  MoneyInput,
  NumberInput,
  PageHeader,
  SaveBar,
  SettingsSection,
  Switch,
  TextLink,
  Tooltip,
  useSettingsForm,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { isApiMode } from '@/lib/api'
import { brl, brlCompact, dateShort, num, numCompact, pct } from '@/lib/format'
import { NOW, dayKey } from '@/data/now'
import { useCoinStats } from '@/domain/campanhas-jogadores'
import { seedCoinFlow, type CoinFlowDay } from '@/data/campanhas2-seeds'
import { C2_KEYS } from '@/domain/campanhas2-common'
import {
  DEFAULT_COIN_CONFIG,
  EARN_BASE,
  EARN_CATEGORIES,
  EARN_CATEGORY_LABEL,
  activeEarnRules,
  coinConfigErrors,
  coinReturnRate,
  simulateEarnings,
  validateCoinConfig,
  type CoinConfig,
  type EarnCategory,
  type EarnSimInput,
  type EarnToggle,
} from '@/domain/campanhas2-moeda'
import { CoinGlyph, PlayerPreview, slotColor } from './_shared-c2'

const CATEGORY_ICON: Record<EarnCategory, LucideIcon> = {
  slots: Cherry,
  ao_vivo: Tv,
  crash: Rocket,
  mesa: Spade,
  instantaneo: Zap,
  bingo: Grid3x3,
  esportes: Volleyball,
}

const SIM_DEFAULT: EarnSimInput = { bets: { slots: 200, ao_vivo: 0, crash: 50, esportes: 100 }, deposit: 100, login: true, streakDay: false, missions: 1, levels: 0 }

function delta(cur: number, prev: number) {
  return prev ? (cur - prev) / prev : null
}

/** Soma dos dias do mês corrente e do mesmo trecho do mês anterior. */
/** Modo API: emissão e resgate vêm do extrato de moedas da plataforma, ainda não conectado. */
const HAS_FLOW = !isApiMode()

function monthTotals(flow: CoinFlowDay[]) {
  const first = dayKey(new Date(NOW.getFullYear(), NOW.getMonth(), 1))
  const prevFirst = dayKey(new Date(NOW.getFullYear(), NOW.getMonth() - 1, 1))
  const prevSame = dayKey(new Date(NOW.getFullYear(), NOW.getMonth() - 1, NOW.getDate()))
  const cur = flow.filter((d) => d.date >= first)
  const prev = flow.filter((d) => d.date >= prevFirst && d.date <= prevSame)
  const sum = (rows: CoinFlowDay[], k: keyof Omit<CoinFlowDay, 'date'>) => rows.reduce((s, r) => s + r[k], 0)
  return { cur, prev, sum }
}

export default function Moeda() {
  const form = useSettingsForm<CoinConfig>(C2_KEYS.moeda, DEFAULT_COIN_CONFIG, {
    entity: 'Moeda do site',
    validate: validateCoinConfig,
    successMessage: 'Moeda salva',
  })
  const v = form.values
  const saved = form.saved
  const errs = coinConfigErrors(v)
  // demonstração: somado da lista de jogadores; modo API: contagem pronta do servidor (geral.jogadores.metricas)
  const { circulation, holders } = useCoinStats()
  // emissão e resgate por dia: só na demonstração (no modo API não há extrato de moedas conectado)
  const flow = useMemo(() => (HAS_FLOW ? seedCoinFlow() : []), [])
  const { cur, prev, sum } = useMemo(() => monthTotals(flow), [flow])
  const emitted = sum(cur, 'emitted')
  const redeemed = sum(cur, 'redeemed')
  const last30 = flow.slice(-30)

  const setRate = (k: EarnCategory, patch: Partial<EarnToggle>) =>
    form.set('bets', { ...v.bets, rates: { ...v.bets.rates, [k]: { ...v.bets.rates[k], ...patch } } })

  const monthLabel = NOW.toLocaleDateString('pt-BR', { month: 'long' })

  return (
    <>
      <PageHeader
        actions={
          <Tooltip content="Valor de referência salvo. Usado na loja, na roleta e no custo das campanhas.">
            <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] text-fg-2">
              <CoinGlyph size={16} src={saved.icon} />
              1 {saved.symbol} = <strong className="text-fg">{brl(saved.refValue)}</strong>
            </span>
          </Tooltip>
        }
      />

      <div className="space-y-6">
        <section aria-label="Resumo da moeda" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Moedas em circulação"
            icon={Wallet}
            tone="warning"
            value={`${numCompact(circulation)} ${saved.symbol}`}
            hint={`≈ ${brlCompact(circulation * saved.refValue)} · ${num(holders)} com saldo`}
            formula={<>Soma do saldo de moedas de todos os jogadores. É um passivo: cada moeda pode virar prêmio na loja ou na roleta, ao valor de referência.</>}
          />
          <KpiCard
            label={`Emitidas em ${monthLabel}`}
            icon={ArrowDownToLine}
            tone="success"
            value={HAS_FLOW ? numCompact(emitted) : '—'}
            delta={HAS_FLOW ? delta(emitted, sum(prev, 'emitted')) : undefined}
            hint={HAS_FLOW ? 'vs mesmo período do mês anterior' : NO_SOURCE_HINT}
            formula={<>Moedas creditadas aos jogadores no mês até hoje, somando apostas, depósitos, login, missões e níveis.</>}
            chart={HAS_FLOW ? <Sparkline data={last30.map((d) => d.emitted)} slot={4} ariaLabel="Emissão diária nos últimos 30 dias" /> : undefined}
          />
          <KpiCard
            label={`Resgatadas em ${monthLabel}`}
            icon={ArrowUpFromLine}
            tone="info"
            value={HAS_FLOW ? numCompact(redeemed) : '—'}
            delta={HAS_FLOW ? delta(redeemed, sum(prev, 'redeemed')) : undefined}
            hint={HAS_FLOW ? `≈ ${brlCompact(redeemed * saved.refValue)} em prêmios` : NO_SOURCE_HINT}
            formula={<>Moedas gastas pelos jogadores na loja e na roleta no mês até hoje.</>}
            chart={HAS_FLOW ? <Sparkline data={last30.map((d) => d.redeemed)} slot={1} ariaLabel="Resgate diário nos últimos 30 dias" /> : undefined}
          />
          <KpiCard
            label="Taxa de resgate"
            icon={Flame}
            tone="primary"
            value={HAS_FLOW ? pct(emitted ? redeemed / emitted : 0, 0) : '—'}
            hint={`${num(activeEarnRules(saved))} regras de ganho ligadas`}
            formula={<>Resgatadas ÷ emitidas no mês. Abaixo de 50% indica moedas paradas: vale revisar a loja ou a validade.</>}
          />
        </section>

        <FormFieldset readOnly={form.readOnly}>
          <SettingsSection
            title="Identidade"
            description="Nome, sigla e ícone aparecem no topo do site, na loja, na roleta e nas missões."
            aside={<CoinPreview cfg={v} />}
          >
            <FormGrid>
              <Field label="Nome da moeda" htmlFor="m-name" required error={errs.name}>
                <Input id="m-name" value={v.name} maxLength={30} invalid={!!errs.name} onChange={(e) => form.set('name', e.target.value)} />
              </Field>
              <Field label="Sigla" htmlFor="m-symbol" required error={errs.symbol} hint="Aparece ao lado do saldo: 1.250 EVC.">
                <Input
                  id="m-symbol"
                  value={v.symbol}
                  maxLength={5}
                  invalid={!!errs.symbol}
                  className="font-mono uppercase"
                  onChange={(e) => form.set('symbol', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                />
              </Field>
              <Field
                label={`Valor de referência (1 ${v.symbol || 'moeda'})`}
                htmlFor="m-ref"
                required
                error={errs.refValue}
                hint={`1.000 ${v.symbol} valem ${brl(1000 * (v.refValue || 0))}. Base de custo da loja e da roleta.`}
              >
                <MoneyInput id="m-ref" value={v.refValue} step={0.001} invalid={!!errs.refValue} onValueChange={(n) => form.set('refValue', n)} />
              </Field>
              <div className="flex items-end">
                <Switch
                  className="w-full rounded-xl border border-line p-3"
                  label="Mostrar saldo no topo do site"
                  description="Ao lado do saldo em reais."
                  checked={v.showInHeader}
                  onChange={(on) => form.set('showInHeader', on)}
                />
              </div>
            </FormGrid>
            <ImageUpload
              label="Ícone da moeda"
              value={v.icon}
              onChange={(url) => form.set('icon', url)}
              hint="PNG quadrado com fundo transparente, 128×128 px. Sem imagem, usamos a moeda padrão."
              previewClassName="h-28 w-full max-w-[220px]"
              disabled={form.readOnly}
            />
          </SettingsSection>

          <SettingsSection title="Validade e limites" description="Moedas paradas viram passivo. A validade tira do saldo as moedas antigas.">
            <Switch
              label="Moedas expiram"
              description={v.expires ? `Moedas ganhas há mais de ${num(v.expiryDays)} dias saem do saldo. O jogador recebe aviso 7 dias antes.` : 'Moedas nunca expiram.'}
              checked={v.expires}
              onChange={(on) => form.set('expires', on)}
            />
            <FormGrid>
              {v.expires && (
                <Field label="Validade" htmlFor="m-exp" error={errs.expiryDays}>
                  <NumberInput integer id="m-exp" value={v.expiryDays} min={1} suffix="dias" invalid={!!errs.expiryDays} onValueChange={(n) => form.set('expiryDays', Math.round(n))} />
                </Field>
              )}
              <Field
                label="Teto diário por jogador"
                htmlFor="m-cap"
                error={errs.dailyCap}
                hint={v.dailyCap > 0 ? `Acima de ${num(v.dailyCap)} ${v.symbol} no dia, o jogador para de ganhar até 00:00.` : 'Sem teto: o jogador ganha sem limite.'}
              >
                <NumberInput integer id="m-cap" value={v.dailyCap} min={0} suffix={v.symbol} invalid={!!errs.dailyCap} onValueChange={(n) => form.set('dailyCap', Math.round(n))} />
              </Field>
            </FormGrid>
          </SettingsSection>

          <SettingsSection
            title="Como se ganha"
            description={`Ligue as formas de ganhar ${v.name || 'moedas'} e quanto vale cada uma. O retorno mostra quanto do valor apostado volta em moedas.`}
            aside={
              errs.amounts ? (
                <Alert tone="danger">{errs.amounts}</Alert>
              ) : (
                <p className="flex items-start gap-1.5 text-xs leading-5 text-fg-3">
                  <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
                  Retorno de 1% significa que, a cada R$ 100 apostados, o jogador recebe R$ 1,00 em moedas.
                </p>
              )
            }
          >
            <div className="rounded-xl border border-line">
              <div className="flex items-start gap-3 p-3.5">
                <RuleIcon icon={Dice5} on={v.bets.enabled} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">Por valor apostado</p>
                  <p className="text-[13px] leading-5 text-fg-3">Moedas a cada R$ {EARN_BASE} apostados, por categoria. Apostas com saldo bônus também contam.</p>
                </div>
                <Switch ariaLabel="Ganhar moedas por aposta" checked={v.bets.enabled} onChange={(on) => form.set('bets', { ...v.bets, enabled: on })} />
              </div>
              <div className={cn('border-t border-line transition-opacity', !v.bets.enabled && 'opacity-50')}>
                <div className="hidden grid-cols-[minmax(0,1fr)_120px_96px_44px] gap-3 border-b border-line bg-surface-2/70 px-3.5 py-2 text-xs font-semibold text-fg-3 sm:grid">
                  <span>Categoria</span>
                  <span>{v.symbol} a cada R$ {EARN_BASE}</span>
                  <span className="text-right">Retorno</span>
                  <span className="sr-only">Ligada</span>
                </div>
                <ul className="divide-y divide-line/70">
                  {EARN_CATEGORIES.map((k) => {
                    const r = v.bets.rates[k]
                    const Icon = CATEGORY_ICON[k]
                    const ret = coinReturnRate(r.amount, v.refValue)
                    const on = v.bets.enabled && r.enabled
                    return (
                      <li key={k} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_120px_96px_44px] sm:items-start">
                        <label htmlFor={`m-rate-${k}`} className={cn('flex min-w-0 items-center gap-2.5 text-sm sm:h-10', on ? 'text-fg' : 'text-fg-3')}>
                          <Icon size={16} className="shrink-0 text-fg-3" aria-hidden />
                          <span className="truncate">{EARN_CATEGORY_LABEL[k]}</span>
                        </label>
                        <div className="order-3 col-span-2 sm:order-none sm:col-span-1">
                          <NumberInput
                            integer
                            id={`m-rate-${k}`}
                            value={r.amount}
                            min={0}
                            suffix={v.symbol}
                            disabled={!v.bets.enabled || !r.enabled}
                            onValueChange={(n) => setRate(k, { amount: Math.round(n) })}
                          />
                        </div>
                        <span className={cn('order-4 hidden text-right text-[13px] tnum sm:order-none sm:block sm:leading-10', on ? 'font-semibold text-fg' : 'text-fg-3')}>{on ? pct(ret, 2) : '—'}</span>
                        <div className="flex items-center justify-end sm:h-10">
                          <Switch size="sm" ariaLabel={`Ganhar moedas em ${EARN_CATEGORY_LABEL[k]}`} checked={r.enabled} disabled={!v.bets.enabled} onChange={(x) => setRate(k, { enabled: x })} />
                        </div>
                        <span className="order-5 col-span-2 -mt-1 text-xs text-fg-3 sm:hidden">{on ? `Retorno de ${pct(ret, 2)} do apostado` : 'Desligada'}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>

            <EarnRule
              icon={ArrowDownToLine}
              title="Por depósito"
              description={`Moedas a cada R$ ${EARN_BASE} depositados (PIX confirmado).`}
              enabled={v.deposit.enabled}
              onToggle={(on) => form.set('deposit', { ...v.deposit, enabled: on })}
            >
              <Field label={`${v.symbol} a cada R$ ${EARN_BASE}`} htmlFor="m-dep" hint={`Depósito de R$ 100 rende ${num(10 * v.deposit.amount)} ${v.symbol}.`}>
                <NumberInput integer id="m-dep" value={v.deposit.amount} min={0} suffix={v.symbol} disabled={!v.deposit.enabled} onValueChange={(n) => form.set('deposit', { ...v.deposit, amount: Math.round(n) })} />
              </Field>
            </EarnRule>

            <EarnRule
              icon={CalendarCheck}
              title="Login diário"
              description="Uma vez por dia, ao entrar no site. A sequência premia quem volta 7 dias seguidos."
              enabled={v.dailyLogin.enabled}
              onToggle={(on) => form.set('dailyLogin', { ...v.dailyLogin, enabled: on })}
            >
              <FormGrid>
                <Field label="Por dia" htmlFor="m-login">
                  <NumberInput integer id="m-login" value={v.dailyLogin.amount} min={0} suffix={v.symbol} disabled={!v.dailyLogin.enabled} onValueChange={(n) => form.set('dailyLogin', { ...v.dailyLogin, amount: Math.round(n) })} />
                </Field>
                <Field label="Extra no 7º dia seguido" htmlFor="m-streak" hint="0 = sem prêmio de sequência.">
                  <NumberInput integer id="m-streak" value={v.dailyLogin.streakBonus} min={0} suffix={v.symbol} disabled={!v.dailyLogin.enabled} onValueChange={(n) => form.set('dailyLogin', { ...v.dailyLogin, streakBonus: Math.round(n) })} />
                </Field>
              </FormGrid>
            </EarnRule>

            <EarnRule
              icon={Target}
              title="Missão concluída"
              description={
                <>
                  Extra por missão, além da recompensa de cada uma. As missões ficam em <TextLink to="/campanhas/missoes">Missões</TextLink>.
                </>
              }
              enabled={v.mission.enabled}
              onToggle={(on) => form.set('mission', { ...v.mission, enabled: on })}
            >
              <Field label="Por missão" htmlFor="m-mission">
                <NumberInput integer id="m-mission" value={v.mission.amount} min={0} suffix={v.symbol} disabled={!v.mission.enabled} onValueChange={(n) => form.set('mission', { ...v.mission, amount: Math.round(n) })} />
              </Field>
            </EarnRule>

            <EarnRule
              icon={ChevronsUp}
              title="Subir de nível"
              description={
                <>
                  Pago a cada nível novo. A trilha fica em <TextLink to="/campanhas/niveis">Níveis e XP</TextLink>.
                </>
              }
              enabled={v.levelUp.enabled}
              onToggle={(on) => form.set('levelUp', { ...v.levelUp, enabled: on })}
            >
              <Field label="Por nível" htmlFor="m-level">
                <NumberInput integer id="m-level" value={v.levelUp.amount} min={0} suffix={v.symbol} disabled={!v.levelUp.enabled} onValueChange={(n) => form.set('levelUp', { ...v.levelUp, amount: Math.round(n) })} />
              </Field>
            </EarnRule>
          </SettingsSection>
        </FormFieldset>

        <Simulator cfg={v} />

{HAS_FLOW ? (
        <div className="grid gap-6 xl:grid-cols-5">
          <Card className="xl:col-span-3">
            <CardHeader title="Emissão e resgate" description="Moedas por dia, últimos 30 dias" />
            <CardBody>
              <BarsChart
                ariaLabel="Moedas emitidas e resgatadas por dia"
                data={last30.map((d) => ({ date: d.date, emitted: d.emitted, redeemed: d.redeemed }))}
                xKey="date"
                xFormat={(k) => dateShort(`${k}T12:00:00`)}
                height={260}
                series={[
                  { key: 'emitted', label: 'Emitidas', slot: 4 },
                  { key: 'redeemed', label: 'Resgatadas', slot: 1 },
                ]}
              />
            </CardBody>
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader title={`Origem e destino em ${monthLabel}`} description="De onde vieram e para onde foram as moedas" />
            <CardBody className="space-y-5">
              <DonutChart
                ariaLabel="Origem das moedas emitidas no mês"
                height={150}
                centerValue={numCompact(emitted)}
                centerLabel="emitidas"
                data={[
                  { label: 'Apostas', value: sum(cur, 'bets'), slot: 4 },
                  { label: 'Login diário', value: sum(cur, 'login'), slot: 1 },
                  { label: 'Depósitos', value: sum(cur, 'deposit'), slot: 3 },
                  { label: 'Níveis', value: sum(cur, 'levels'), slot: 7 },
                  { label: 'Missões', value: sum(cur, 'missions'), slot: 5 },
                ]}
              />
              <DestinationBar shop={sum(cur, 'shop')} wheel={sum(cur, 'wheel')} expired={sum(cur, 'expired')} />
            </CardBody>
          </Card>
        </div>
        ) : (
          <NoDataSource title="Emissão e resgate de moedas ainda sem fonte de dados">
            Moedas emitidas, resgatadas e a origem de cada uma vêm do extrato de moedas da plataforma de jogo, que ainda não está conectado a
            este painel. O saldo em circulação acima vem do servidor.
          </NoDataSource>
        )}
      </div>

      <SaveBar form={form} label="Salvar moeda" />
    </>
  )
}

function RuleIcon({ icon: Icon, on }: { icon: LucideIcon; on: boolean }) {
  return (
    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors', on ? 'bg-gold/15 text-warning dark:text-gold' : 'bg-surface-3 text-fg-3')}>
      <Icon size={16} aria-hidden />
    </span>
  )
}

function EarnRule({
  icon,
  title,
  description,
  enabled,
  onToggle,
  children,
}: {
  icon: LucideIcon
  title: string
  description: ReactNode
  enabled: boolean
  onToggle: (on: boolean) => void
  children: ReactNode
}) {
  return (
    <div className="rounded-xl border border-line p-3.5">
      <div className="flex items-start gap-3">
        <RuleIcon icon={icon} on={enabled} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{title}</p>
          <p className="text-[13px] leading-5 text-fg-3">{description}</p>
        </div>
        <Switch ariaLabel={`${title}: ${enabled ? 'ligado' : 'desligado'}`} checked={enabled} onChange={onToggle} />
      </div>
      <div className={cn('mt-3 sm:pl-11', !enabled && 'opacity-50')}>{children}</div>
    </div>
  )
}

/** Prévia do saldo de moedas como aparece no topo do site. */
function CoinPreview({ cfg }: { cfg: CoinConfig }) {
  const balance = 1250
  return (
    <PlayerPreview>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2.5 py-2">
          <span className="font-display text-sm font-extrabold tracking-tight text-fg">X2Win</span>
          <div className="flex items-center gap-1.5">
            {cfg.showInHeader ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-1 text-xs font-bold text-fg ring-1 ring-inset ring-gold/30 tnum">
                <CoinGlyph size={14} src={cfg.icon} />
                {num(balance)}
              </span>
            ) : (
              <span className="text-[11px] text-fg-3">saldo oculto</span>
            )}
            <span className="rounded-full bg-primary px-2 py-1 text-xs font-bold text-primary-fg tnum">R$ 152,40</span>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-3 shadow-card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-fg-3">Suas {cfg.name || 'moedas'}</p>
          <p className="mt-1 flex items-center gap-1.5 font-display text-xl font-bold text-fg tnum">
            <CoinGlyph size={20} src={cfg.icon} />
            {num(balance)} <span className="text-sm font-semibold text-fg-3">{cfg.symbol}</span>
          </p>
          <p className="mt-0.5 text-xs text-fg-3">≈ {brl(balance * (cfg.refValue || 0))} para trocar na loja</p>
          <p className="mt-2 flex items-center gap-1 text-[11px] text-fg-3">
            <Coins size={11} aria-hidden />
            {cfg.expires ? `Moedas expiram em ${num(cfg.expiryDays)} dias` : 'Suas moedas não expiram'}
          </p>
        </div>
      </div>
    </PlayerPreview>
  )
}

function DestinationBar({ shop, wheel, expired }: { shop: number; wheel: number; expired: number }) {
  const total = shop + wheel + expired || 1
  const parts = [
    { label: 'Loja', value: shop, slot: 1 as const },
    { label: 'Roleta', value: wheel, slot: 2 as const },
    { label: 'Expiradas', value: expired, slot: 8 as const },
  ]
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-fg-3">Destino das moedas que saíram do saldo</p>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-3" role="img" aria-label={parts.map((p) => `${p.label} ${pct(p.value / total, 0)}`).join(', ')}>
        {parts.map((p) => (
          <div key={p.label} className="h-full" style={{ width: `${(p.value / total) * 100}%`, background: slotColor(p.slot) }} />
        ))}
      </div>
      <ChartLegend className="mt-2.5" items={parts.map((p) => ({ label: p.label, slot: p.slot, value: pct(p.value / total, 0) }))} />
    </div>
  )
}

function Simulator({ cfg }: { cfg: CoinConfig }) {
  const [sim, setSim] = useState<EarnSimInput>(SIM_DEFAULT)
  const r = simulateEarnings(cfg, sim)
  const setBet = (k: EarnCategory, n: number) => setSim((s) => ({ ...s, bets: { ...s.bets, [k]: n } }))
  const simCats: EarnCategory[] = ['slots', 'ao_vivo', 'crash', 'esportes']
  return (
    <Card>
      <CardHeader
        icon={Calculator}
        title="Simular um dia do jogador"
        description="Usa as regras do rascunho, antes de salvar. Nada é creditado."
        actions={
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setSim(SIM_DEFAULT)}>
            Limpar
          </Button>
        }
      />
      <CardBody className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <FormGrid>
            {simCats.map((k) => (
              <Field key={k} label={`Apostou em ${EARN_CATEGORY_LABEL[k].toLowerCase()}`} htmlFor={`sim-${k}`}>
                <MoneyInput id={`sim-${k}`} value={sim.bets[k] ?? 0} onValueChange={(n) => setBet(k, n)} />
              </Field>
            ))}
            <Field label="Depositou" htmlFor="sim-dep">
              <MoneyInput id="sim-dep" value={sim.deposit} onValueChange={(n) => setSim((s) => ({ ...s, deposit: n }))} />
            </Field>
            <Field label="Missões concluídas" htmlFor="sim-mis">
              <NumberInput integer id="sim-mis" value={sim.missions} min={0} onValueChange={(n) => setSim((s) => ({ ...s, missions: Math.max(0, Math.round(n)) }))} />
            </Field>
            <Field label="Níveis que subiu" htmlFor="sim-lvl">
              <NumberInput integer id="sim-lvl" value={sim.levels} min={0} onValueChange={(n) => setSim((s) => ({ ...s, levels: Math.max(0, Math.round(n)) }))} />
            </Field>
          </FormGrid>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Checkbox checked={sim.login} onChange={(on) => setSim((s) => ({ ...s, login: on, streakDay: on && s.streakDay }))} label="Entrou no site hoje" />
            <Checkbox checked={sim.streakDay} disabled={!sim.login} onChange={(on) => setSim((s) => ({ ...s, streakDay: on }))} label="É o 7º dia seguido" />
          </div>
        </div>
        <div className="rounded-xl border border-line p-4" aria-live="polite">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-fg">Resultado do dia</p>
            {r.capped && (
              <Badge tone="warning" icon={Info}>
                Limitado pelo teto
              </Badge>
            )}
          </div>
          {r.lines.length ? (
            <ul className="space-y-2">
              {r.lines.map((l) => (
                <li key={l.label} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0">
                    <span className={cn('block truncate', l.coins ? 'text-fg-2' : 'text-fg-3')}>{l.label}</span>
                    <span className="block text-xs text-fg-3">{l.detail}</span>
                  </span>
                  <span className={cn('shrink-0 font-semibold tnum', l.coins ? 'text-fg' : 'text-fg-3')}>
                    +{num(l.coins)} {cfg.symbol}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-fg-3">Preencha ao lado o que o jogador fez no dia.</p>
          )}
          <div className="mt-4 flex items-end justify-between gap-3 border-t border-line pt-3">
            <div>
              <p className="text-xs text-fg-3">O jogador ganha</p>
              <p className="flex items-center gap-1.5 font-display text-2xl font-bold text-fg tnum">
                <CoinGlyph size={22} src={cfg.icon} /> {num(r.total)} <span className="text-sm font-semibold text-fg-3">{cfg.symbol}</span>
              </p>
              {r.capped && (
                <p className="text-xs text-warning">
                  Somaria {num(r.gross)}, mas o teto diário é {num(cfg.dailyCap)}.
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs text-fg-3">Custo para a casa</p>
              <p className="text-base font-bold text-fg tnum">{brl(r.brl)}</p>
              {r.costOnWagered != null && <p className="text-xs text-fg-3">{pct(r.costOnWagered, 2)} do apostado</p>}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
