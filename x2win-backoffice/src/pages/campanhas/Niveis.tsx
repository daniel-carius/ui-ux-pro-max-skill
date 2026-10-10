import { useMemo, useState, type CSSProperties } from 'react'
import {
  ArrowDownUp,
  ArrowUpRight,
  Award,
  Banknote,
  CalendarDays,
  Check,
  Coins,
  Crown,
  Gauge,
  Gift,
  Layers,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  TrendingUp,
  Trophy,
  Users,
  Zap,
} from 'lucide-react'
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
  IconButton,
  Input,
  KpiCard,
  MoneyInput,
  NumberInput,
  PageHeader,
  Popover,
  SaveBar,
  Select,
  SettingsSection,
  Switch,
  confirm,
  useSettingsForm,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { brl, mult, num, pct } from '@/lib/format'
import { usePageAccess } from '@/domain/session'
import { refreshPlayerMetrics, useCampaignPlayers } from '@/domain/campanhas-jogadores'
import {
  BET_CATEGORIES,
  BET_CATEGORY_LABEL,
  COLOR_SLOTS,
  DEFAULT_LEVELS_CONFIG,
  NIVEIS_KEY,
  WEEKDAYS,
  computeXp,
  levelErrors,
  levelIndexForXp,
  levelPerks,
  levelProgress,
  levelWarnings,
  slotColor,
  validateLevelsConfig,
  type BetCategory,
  type ColorSlot,
  type Level,
  type LevelsConfig,
} from '@/domain/campanhas3-niveis'
import { uid } from '@/lib/random'

const mix = (color: string, p: number) => `color-mix(in srgb, ${color} ${p}%, transparent)`

const ROW_GRID = 'lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.9fr)_120px_36px]'

export default function Niveis() {
  const { canEdit } = usePageAccess()
  const form = useSettingsForm<LevelsConfig>(NIVEIS_KEY, DEFAULT_LEVELS_CONFIG, {
    entity: 'Níveis e XP',
    successMessage: 'Trilha de níveis salva',
    validate: validateLevelsConfig,
    // modo API: a projeção do cashback por nível (geral.jogadores.metricas) usa os níveis salvos
    onSaved: refreshPlayerMetrics,
  })
  const v = form.values
  const levels = v.levels
  // demonstração: a base inteira; modo API: os jogadores ativos (público do servidor, só o XP) e o tamanho da base
  const { players, total: baseTotal, reachableOnly } = useCampaignPlayers()
  const errors = useMemo(() => levelErrors(levels), [levels])
  const warnings = useMemo(() => levelWarnings(levels), [levels])
  const sorted = levels.every((l, i) => i === 0 || l.xp > levels[i - 1].xp)

  const distribution = useMemo(() => {
    const counts = levels.map(() => 0)
    for (const p of players) counts[levelIndexForXp(levels, p.xp)]++
    return counts
  }, [players, levels])
  const aboveFirst = distribution.slice(1).reduce((s, n) => s + n, 0)
  const priority = distribution.reduce((s, n, i) => s + (levels[i]?.priorityWithdrawal ? n : 0), 0)
  const top = levels[levels.length - 1]
  const slotsReais = v.xp.perTen.slots > 0 ? (top.xp / v.xp.perTen.slots) * 10 : null

  const setLevel = (id: string, patch: Partial<Level>) => form.set('levels', levels.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  const setXp = (patch: Partial<LevelsConfig['xp']>) => form.set('xp', { ...v.xp, ...patch })
  const setEvent = (patch: Partial<LevelsConfig['xp']['event']>) => setXp({ event: { ...v.xp.event, ...patch } })

  const addLevel = () => {
    const last = levels[levels.length - 1]
    const nextXp = Math.ceil((last.xp * 1.6 || 100) / 500) * 500
    const slot = ((last.slot % 8) + 1) as ColorSlot
    form.set('levels', [
      ...levels,
      { ...last, id: uid('lv'), name: `Nível ${levels.length + 1}`, xp: Math.max(nextXp, last.xp + 100), slot, levelUpGift: Math.round(last.levelUpGift * 1.5), freeSpins: last.freeSpins + 50 },
    ])
  }

  const removeLevel = async (l: Level, i: number) => {
    const n = distribution[i] ?? 0
    const prev = levels[i - 1]
    const ok = await confirm({
      title: `Remover o nível ${l.name || 'sem nome'}?`,
      description:
        n > 0
          ? `${num(n)} ${n === 1 ? 'jogador está' : 'jogadores estão'} neste nível hoje e ${n === 1 ? 'passa' : 'passam'} para ${prev?.name ?? 'o nível anterior'} quando você salvar.`
          : 'Nenhum jogador está neste nível hoje. A remoção só vale depois de salvar.',
      confirmLabel: 'Remover nível',
      tone: 'danger',
      icon: Trash2,
    })
    if (ok) form.set('levels', levels.filter((x) => x.id !== l.id))
  }

  const restore = async () => {
    const ok = await confirm({
      title: 'Restaurar a trilha padrão?',
      description: 'O rascunho volta para os 10 níveis e as regras de XP padrão. Nada muda no site até você salvar.',
      confirmLabel: 'Restaurar padrão',
      tone: 'warning',
      icon: RotateCcw,
    })
    if (ok) form.setValues(DEFAULT_LEVELS_CONFIG)
  }

  return (
    <>
      <PageHeader
        actions={
          <Button icon={RotateCcw} onClick={restore} disabled={!canEdit} title={!canEdit ? 'Seu cargo não edita esta tela' : undefined}>
            Restaurar padrão
          </Button>
        }
      />

      <div className="space-y-5">
        <section aria-label="Resumo da trilha" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Níveis na trilha" icon={Layers} value={num(levels.length)} hint={`de ${levels[0]?.name || '—'} a ${top?.name || '—'}`} />
          <KpiCard
            label="Acima do 1º nível"
            icon={Users}
            tone="info"
            value={num(aboveFirst)}
            hint={`${pct(baseTotal ? aboveFirst / baseTotal : 0, 0)} da base`}
            formula={`${reachableOnly ? 'Jogadores ativos' : 'Jogadores'} cujo XP atual alcança o 2º nível ou mais, com as faixas do rascunho.`}
          />
          <KpiCard
            label="XP para o topo"
            icon={Trophy}
            tone="warning"
            value={`${num(top?.xp ?? 0)} XP`}
            hint={slotsReais !== null ? `≈ ${brl(slotsReais)} apostados em slots` : 'slots não geram XP'}
            formula={`XP necessário para chegar a ${top?.name}. O valor em reais usa a regra de slots (${v.xp.perTen.slots.toLocaleString('pt-BR')} XP a cada R$ 10).`}
          />
          <KpiCard label="Com saque prioritário" icon={Zap} tone="success" value={num(priority)} hint={reachableOnly ? 'jogadores ativos com o benefício hoje' : 'jogadores com o benefício hoje'} />
        </section>

        {!v.enabled && (
          <Alert tone="warning" title="Programa de níveis desligado">
            O jogador não vê a barra de nível e não ganha XP nem benefícios. O cashback por nível também para de valer.
          </Alert>
        )}

        <FormFieldset readOnly={form.readOnly}>
          <SettingsSection title="Programa" description="Liga a trilha no site e define se o nível conquistado pode cair.">
            <Switch
              label="Programa de níveis ligado"
              description={v.enabled ? 'O jogador vê o nível no perfil e ganha XP ao apostar e depositar.' : 'Desligado: XP e benefícios ficam congelados.'}
              checked={v.enabled}
              onChange={(on) => form.set('enabled', on)}
            />
            <Switch
              label="Manter o nível conquistado"
              description={v.keepLevel ? 'O jogador nunca desce de nível, mesmo se ficar parado.' : 'O XP cai 10% por mês sem apostar e o nível pode descer.'}
              checked={v.keepLevel}
              onChange={(on) => form.set('keepLevel', on)}
            />
          </SettingsSection>

          <Card>
            <CardHeader
              icon={Award}
              title="Trilha de níveis"
              description="O jogador sobe quando o XP total alcança o valor da linha. O 1º nível começa em 0 XP e cada nível pede mais XP que o anterior. A coluna Cashback vale quando o cashback é por nível."
            />
            <CardBody className="space-y-3">
              <div className={cn('hidden gap-3 px-3 text-xs font-semibold text-fg-3 lg:grid', ROW_GRID)} aria-hidden>
                <span className="pl-12">Nível</span>
                <span>XP necessário</span>
                <span>Cashback</span>
                <span>Presente ao subir</span>
                <span>Giros grátis</span>
                <span>Saque prioritário</span>
                <span />
              </div>
              <ol className="space-y-2">
                {levels.map((l, i) => (
                  <LevelRow
                    key={l.id}
                    level={l}
                    index={i}
                    count={distribution[i] ?? 0}
                    errors={errors[l.id]}
                    warning={warnings[l.id]}
                    onChange={(patch) => setLevel(l.id, patch)}
                    onRemove={() => removeLevel(l, i)}
                    canRemove={i > 0 && levels.length > 2}
                  />
                ))}
              </ol>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button icon={Plus} onClick={addLevel} disabled={levels.length >= 20}>
                  Adicionar nível
                </Button>
                {!sorted && (
                  <Button variant="soft" icon={ArrowDownUp} onClick={() => form.set('levels', [...levels].sort((a, b) => a.xp - b.xp))}>
                    Ordenar por XP
                  </Button>
                )}
                <span className="text-xs text-fg-3">{levels.length}/20 níveis</span>
              </div>
            </CardBody>
          </Card>
        </FormFieldset>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader icon={TrendingUp} title="Curva de XP" description="XP acumulado para alcançar cada nível (rascunho)" />
            <CardBody>
              <BarsChart
                ariaLabel="XP necessário por nível"
                data={levels.map((l) => ({ name: l.name || '—', xp: l.xp }))}
                xKey="name"
                height={250}
                series={[{ key: 'xp', label: 'XP necessário', slot: 7 }]}
              />
              <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
                Do 1º ao último nível, o salto médio é de{' '}
                <strong className="text-fg">{mult(averageGrowth(levels))}</strong> por nível. Curvas entre 1,5x e 2,5x costumam manter o jogador motivado.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              icon={Users}
              title="Jogadores por nível"
              description={reachableOnly ? 'Jogadores ativos, com o XP atual e as faixas do rascunho' : 'Com o XP atual de cada jogador e as faixas do rascunho'}
            />
            <CardBody>
              <DistributionBars levels={levels} counts={distribution} total={players.length} />
            </CardBody>
          </Card>
        </div>

        <FormFieldset readOnly={form.readOnly}>
          <SettingsSection
            title="Como se ganha XP"
            description="XP a cada R$ 10 apostados, por categoria. Categorias com 0 não geram XP. Depósitos pagos também somam."
          >
            <FormGrid columns={3}>
              {BET_CATEGORIES.map((cat) => (
                <Field key={cat} label={BET_CATEGORY_LABEL[cat]} htmlFor={`xp-${cat}`} error={v.xp.perTen[cat] < 0 || v.xp.perTen[cat] > 20 ? 'De 0 a 20.' : null}>
                  <NumberInput
                    id={`xp-${cat}`}
                    value={v.xp.perTen[cat]}
                    step={0.1}
                    min={0}
                    max={20}
                    suffix="XP"
                    onValueChange={(n) => setXp({ perTen: { ...v.xp.perTen, [cat]: n } })}
                  />
                </Field>
              ))}
            </FormGrid>
            <FormGrid>
              <Field label="XP por depósito" htmlFor="xp-dep" hint="Somado a cada depósito pago.">
                <NumberInput id="xp-dep" value={v.xp.depositXp} min={0} suffix="XP" onValueChange={(n) => setXp({ depositXp: Math.round(n) })} />
              </Field>
              <Field label="Depósito mínimo para ganhar XP" htmlFor="xp-dep-min" hint="Evita depósitos pequenos só para subir de nível.">
                <MoneyInput id="xp-dep-min" value={v.xp.depositMin} onValueChange={(n) => setXp({ depositMin: n })} />
              </Field>
            </FormGrid>
            <Switch
              label="Apostas com saldo bônus geram XP"
              description={v.xp.bonusBetsCount ? 'Toda aposta conta, inclusive a parte paga com bônus.' : 'Só a parte paga com saldo real gera XP (recomendado).'}
              checked={v.xp.bonusBetsCount}
              onChange={(on) => setXp({ bonusBetsCount: on })}
            />
          </SettingsSection>

          <SettingsSection title="Multiplicador em eventos" description="Multiplica todo o XP ganho nos dias escolhidos. Bom para movimentar dias fracos.">
            <Switch
              label="Evento de XP ligado"
              description={v.xp.event.enabled ? `${v.xp.event.name || 'Evento'}: XP vale ${mult(v.xp.event.multiplier)} nos dias marcados.` : 'Desligado: o XP é sempre o normal.'}
              checked={v.xp.event.enabled}
              onChange={(on) => setEvent({ enabled: on })}
            />
            {v.xp.event.enabled && (
              <>
                <FormGrid>
                  <Field label="Nome do evento" htmlFor="ev-name" hint="Aparece para o jogador na barra de nível." error={!v.xp.event.name.trim() ? 'Dê um nome ao evento.' : null}>
                    <Input id="ev-name" value={v.xp.event.name} maxLength={40} onChange={(e) => setEvent({ name: e.target.value })} invalid={!v.xp.event.name.trim()} />
                  </Field>
                  <Field label="Multiplicador" htmlFor="ev-mult" error={v.xp.event.multiplier < 1 || v.xp.event.multiplier > 5 ? 'De 1x a 5x.' : null}>
                    <NumberInput id="ev-mult" value={v.xp.event.multiplier} step={0.5} min={1} max={5} suffix="x" onValueChange={(n) => setEvent({ multiplier: n })} />
                  </Field>
                </FormGrid>
                <Field label="Dias do evento" error={!v.xp.event.weekdays.length ? 'Escolha ao menos um dia.' : null}>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias do evento">
                    {WEEKDAYS.map((d) => {
                      const on = v.xp.event.weekdays.includes(d.value)
                      return (
                        <button
                          key={d.value}
                          type="button"
                          aria-pressed={on}
                          title={d.label}
                          onClick={() => setEvent({ weekdays: on ? v.xp.event.weekdays.filter((x) => x !== d.value) : [...v.xp.event.weekdays, d.value] })}
                          className={cn(
                            'inline-flex h-9 min-w-[52px] items-center justify-center gap-1 rounded-lg border px-2.5 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60',
                            on ? 'border-primary bg-primary/10 text-primary-text' : 'border-line bg-surface text-fg-2 hover:border-line-strong',
                          )}
                        >
                          {on && <Check size={13} aria-hidden />}
                          {d.short}
                        </button>
                      )
                    })}
                  </div>
                </Field>
              </>
            )}
          </SettingsSection>
        </FormFieldset>

        <PlayerPreview config={v} />
      </div>

      <SaveBar form={form} label="Salvar trilha" />
    </>
  )
}

function averageGrowth(levels: Level[]) {
  const ratios: number[] = []
  for (let i = 2; i < levels.length; i++) if (levels[i - 1].xp > 0) ratios.push(levels[i].xp / levels[i - 1].xp)
  if (!ratios.length) return 1
  return Math.round((ratios.reduce((s, r) => s + r, 0) / ratios.length) * 100) / 100
}

function LevelRow({
  level: l,
  index,
  count,
  errors,
  warning,
  onChange,
  onRemove,
  canRemove,
}: {
  level: Level
  index: number
  count: number
  errors?: { name?: string; xp?: string; cashbackPct?: string; levelUpGift?: string; freeSpins?: string }
  warning?: string
  onChange: (patch: Partial<Level>) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const color = slotColor(l.slot)
  const id = `lv-${l.id}`
  const label = 'mb-1 block text-xs font-medium text-fg-3 lg:sr-only'
  const err = errors ? Object.values(errors)[0] : undefined
  return (
    <li
      className={cn('rounded-xl border bg-surface p-3 transition-colors', err ? 'border-danger/50 bg-danger/[0.03]' : 'border-line')}
      style={{ boxShadow: `inset 3px 0 0 ${color}` }}
    >
      <div className={cn('grid grid-cols-2 items-center gap-3', ROW_GRID)}>
        <div className="col-span-2 flex min-w-0 items-center gap-2 lg:col-span-1">
          <Popover
            width={232}
            title="Cor do nível"
            trigger={(p) => (
              <button
                {...p}
                type="button"
                aria-label={`Cor do nível ${l.name}: cor ${l.slot}`}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold tnum transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:hover:scale-100"
                style={{ background: mix(color, 18), color, boxShadow: `inset 0 0 0 1px ${mix(color, 45)}` } as CSSProperties}
              >
                {index + 1}
              </button>
            )}
          >
            {(close) => (
              <div className="grid grid-cols-4 gap-2">
                {COLOR_SLOTS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-label={`Cor ${s}`}
                    aria-pressed={s === l.slot}
                    onClick={() => {
                      onChange({ slot: s })
                      close()
                    }}
                    className={cn('flex h-10 items-center justify-center rounded-lg ring-offset-2 ring-offset-surface transition-transform hover:scale-105', s === l.slot && 'ring-2 ring-fg')}
                    style={{ background: slotColor(s) }}
                  >
                    {s === l.slot && <Check size={16} style={{ color: 'rgb(var(--surface))' }} aria-hidden />}
                  </button>
                ))}
              </div>
            )}
          </Popover>
          <div className="min-w-0 flex-1">
            <label htmlFor={`${id}-name`} className="sr-only">
              Nome do nível {index + 1}
            </label>
            <Input id={`${id}-name`} value={l.name} maxLength={24} onChange={(e) => onChange({ name: e.target.value })} invalid={!!errors?.name} placeholder="Nome do nível" />
          </div>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-xp`} className={label}>
            XP necessário
          </label>
          <NumberInput id={`${id}-xp`} value={l.xp} min={0} step={50} suffix="XP" invalid={!!errors?.xp} onValueChange={(n) => onChange({ xp: Math.round(n) })} />
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-cb`} className={label}>
            Cashback
          </label>
          <NumberInput id={`${id}-cb`} value={l.cashbackPct} min={0} max={30} step={0.5} suffix="%" invalid={!!errors?.cashbackPct} onValueChange={(n) => onChange({ cashbackPct: n })} />
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-gift`} className={label}>
            Presente ao subir
          </label>
          <MoneyInput id={`${id}-gift`} value={l.levelUpGift} invalid={!!errors?.levelUpGift} onValueChange={(n) => onChange({ levelUpGift: n })} />
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-spins`} className={label}>
            Giros grátis
          </label>
          <NumberInput id={`${id}-spins`} value={l.freeSpins} min={0} step={10} suffix="giros" invalid={!!errors?.freeSpins} onValueChange={(n) => onChange({ freeSpins: Math.round(n) })} />
        </div>
        <div className="flex items-center justify-between gap-2 lg:justify-start">
          <span className="whitespace-nowrap text-xs font-medium text-fg-3 lg:sr-only">Saque prioritário</span>
          <Switch ariaLabel={`Saque prioritário no nível ${l.name}`} checked={l.priorityWithdrawal} onChange={(on) => onChange({ priorityWithdrawal: on })} />
        </div>
        <div className="flex justify-end">
          <IconButton
            icon={Trash2}
            label={canRemove ? `Remover nível ${l.name}` : index === 0 ? 'O primeiro nível não pode ser removido' : 'A trilha precisa de 2 níveis'}
            variant="danger"
            size="sm"
            disabled={!canRemove}
            onClick={onRemove}
          />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-3">
        <span className="inline-flex items-center gap-1">
          <Users size={12} aria-hidden /> {num(count)} {count === 1 ? 'jogador' : 'jogadores'}
        </span>
        {err ? (
          <span className="font-medium text-danger" role="alert">
            {err}
          </span>
        ) : warning ? (
          <span className="text-warning">{warning}</span>
        ) : null}
      </div>
    </li>
  )
}

function DistributionBars({ levels, counts, total }: { levels: Level[]; counts: number[]; total: number }) {
  const max = Math.max(1, ...counts)
  return (
    <ol className="space-y-2.5" aria-label="Jogadores por nível">
      {levels.map((l, i) => {
        const n = counts[i] ?? 0
        return (
          <li key={l.id} className="grid grid-cols-[minmax(0,104px)_minmax(0,1fr)_64px] items-center gap-3">
            <span className="flex min-w-0 items-center gap-2 text-[13px] text-fg-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: slotColor(l.slot) }} aria-hidden />
              <span className="truncate">{l.name || '—'}</span>
            </span>
            <span className="h-2.5 overflow-hidden rounded-full bg-surface-3">
              <span className="block h-full rounded-full" style={{ width: `${(n / max) * 100}%`, background: slotColor(l.slot) }} />
            </span>
            <span className="text-right text-[13px] tnum">
              <span className="font-semibold text-fg">{num(n)}</span>
              <span className="ml-1 text-[11px] text-fg-3">{pct(total ? n / total : 0, 0)}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

const PERK_ICON = { cashback: Coins, saque: Zap, presente: Gift, giros: Sparkles } as const

/** Cartão de nível como o jogador vê no perfil. */
function LevelCard({ levels, xp, eventName, compact }: { levels: Level[]; xp: number; eventName?: string | null; compact?: boolean }) {
  const { index, level, next, pct: p, remaining } = levelProgress(levels, xp)
  const color = slotColor(level.slot)
  const perks = levelPerks(level, { brl })
  return (
    <div
      className="relative overflow-hidden rounded-2xl border p-4 shadow-card"
      style={{ borderColor: mix(color, 40), background: `linear-gradient(140deg, ${mix(color, 20)} 0%, rgb(var(--surface)) 62%)` }}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 rotate-45 items-center justify-center rounded-xl shadow-sm" style={{ background: color }} aria-hidden>
          <Crown size={20} className="-rotate-45" style={{ color: 'rgb(var(--surface))' }} />
        </span>
        <div className="ml-1 min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">Seu nível</p>
          <p className="truncate font-display text-xl font-bold leading-7 text-fg">{level.name || '—'}</p>
        </div>
        <Badge tone="neutral">{`${index + 1} de ${levels.length}`}</Badge>
      </div>
      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-semibold text-fg tnum">{num(xp)} XP</span>
          <span className="text-fg-3 tnum">{next ? `${num(next.xp)} XP` : 'nível máximo'}</span>
        </div>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(p * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso até o próximo nível">
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${p * 100}%`, background: color }} />
        </div>
        <p className="mt-1.5 text-xs text-fg-3">{next ? `Faltam ${num(remaining)} XP para ${next.name}` : 'Você chegou ao topo da trilha.'}</p>
      </div>
      {eventName && (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2.5 py-1 text-[11.5px] font-semibold text-warning">
          <Zap size={12} aria-hidden /> {eventName} ativo
        </p>
      )}
      {!compact && (
        <>
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-fg-3">Seus benefícios</p>
          {perks.length ? (
            <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {perks.map((pk) => {
                const Icon = PERK_ICON[pk.key as keyof typeof PERK_ICON] ?? Award
                return (
                  <li key={pk.key} className="flex items-center gap-2 text-[13px] text-fg-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: mix(color, 16), color }}>
                      <Icon size={13} aria-hidden />
                    </span>
                    {pk.label}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-fg-3">Ainda sem benefícios. Suba de nível para desbloquear.</p>
          )}
          {next && (
            <div className="mt-4 rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-xs text-fg-3">
              <span className="font-semibold text-fg-2">No {next.name}:</span> {levelPerks(next, { brl }).map((x) => x.label).join(' · ') || 'mesmos benefícios'}
            </div>
          )}
        </>
      )}
    </div>
  )
}

type SimCat = Extract<BetCategory, 'slots' | 'ao_vivo' | 'crash' | 'esportes'>
const SIM_CATS: SimCat[] = ['slots', 'ao_vivo', 'crash', 'esportes']

function PlayerPreview({ config }: { config: LevelsConfig }) {
  const levels = config.levels
  const [startXp, setStartXp] = useState(320)
  const [bets, setBets] = useState<Record<SimCat, number>>({ slots: 1200, ao_vivo: 300, crash: 0, esportes: 200 })
  const [deposits, setDeposits] = useState(2)
  const [depositAmount, setDepositAmount] = useState(100)
  const [eventDay, setEventDay] = useState(false)
  const gained = computeXp(config.xp, { bets, deposits, depositAmount, eventDay })
  const before = levelIndexForXp(levels, startXp)
  const finalXp = startXp + (config.enabled ? gained.total : 0)
  const after = levelIndexForXp(levels, finalXp)
  const ups = levels.slice(before + 1, after + 1)
  const gifts = ups.reduce((s, l) => s + l.levelUpGift, 0)
  const spins = ups.reduce((s, l) => s + l.freeSpins, 0)

  return (
    <Card>
      <CardHeader
        icon={Gauge}
        title="Prévia do jogador"
        description="Simule uma semana de jogo e veja o cartão de nível que o jogador vê no perfil. Usa o rascunho."
        actions={
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => {
            setStartXp(320)
            setBets({ slots: 1200, ao_vivo: 300, crash: 0, esportes: 200 })
            setDeposits(2)
            setDepositAmount(100)
            setEventDay(false)
          }}>
            Limpar
          </Button>
        }
      />
      <CardBody className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-4">
          <FormGrid>
            <Field label="XP atual do jogador" htmlFor="sim-xp" hint={`Hoje no nível ${levels[before]?.name ?? '—'}.`}>
              <NumberInput id="sim-xp" value={startXp} min={0} step={50} suffix="XP" onValueChange={(n) => setStartXp(Math.max(0, Math.round(n)))} />
            </Field>
            <Field label="Começar de um nível" htmlFor="sim-lvl">
              <Select
                id="sim-lvl"
                value={String(before)}
                onChange={(i) => setStartXp(levels[Number(i)]?.xp ?? 0)}
                options={levels.map((l, i) => ({ value: String(i), label: `${l.name || '—'} (${num(l.xp)} XP)` }))}
              />
            </Field>
            {SIM_CATS.map((cat) => (
              <Field key={cat} label={`Apostado em ${BET_CATEGORY_LABEL[cat]}`} htmlFor={`sim-${cat}`}>
                <MoneyInput id={`sim-${cat}`} value={bets[cat]} onValueChange={(n) => setBets((b) => ({ ...b, [cat]: n }))} />
              </Field>
            ))}
            <Field label="Depósitos pagos" htmlFor="sim-dep">
              <NumberInput id="sim-dep" value={deposits} min={0} onValueChange={(n) => setDeposits(Math.max(0, Math.round(n)))} />
            </Field>
            <Field label="Valor de cada depósito" htmlFor="sim-dep-v">
              <MoneyInput id="sim-dep-v" value={depositAmount} onValueChange={setDepositAmount} />
            </Field>
          </FormGrid>
          <Switch
            label="Jogou em dia de evento"
            description={config.xp.event.enabled ? `${config.xp.event.name}: XP vale ${mult(config.xp.event.multiplier)}.` : 'Sem evento de XP ligado.'}
            checked={eventDay}
            onChange={setEventDay}
            disabled={!config.xp.event.enabled}
          />
          <div className="rounded-xl border border-line p-4" aria-live="polite">
            <p className="mb-2 text-sm font-semibold text-fg">XP ganho</p>
            {gained.lines.length ? (
              <ul className="space-y-1.5">
                {gained.lines.map((ln) => (
                  <li key={ln.label} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="text-fg-2">
                      {ln.label} <span className="text-xs text-fg-3">· {ln.detail}</span>
                    </span>
                    <span className="font-medium text-fg tnum">+{num(Math.floor(ln.xp))}</span>
                  </li>
                ))}
                {gained.multiplier > 1 && (
                  <li className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="text-warning">{config.xp.event.name}</span>
                    <span className="font-medium text-warning tnum">{mult(gained.multiplier)}</span>
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-[13px] text-fg-3">Preencha apostas ou depósitos.</p>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
              <span className="text-[13px] text-fg-2">Total</span>
              <span className="font-display text-lg font-bold text-fg tnum">{config.enabled ? `+${num(gained.total)} XP` : 'programa desligado'}</span>
            </div>
          </div>
        </div>
        <div className="space-y-3">
          <LevelCard levels={levels} xp={finalXp} eventName={eventDay && config.xp.event.enabled ? config.xp.event.name : null} />
          {ups.length > 0 ? (
            <Alert tone="success" icon={ArrowUpRight} title={`Sobe ${ups.length === 1 ? 'para' : `${ups.length} níveis, até`} ${ups[ups.length - 1].name}`}>
              Recebe {gifts > 0 ? brl(gifts) : 'nenhum presente'}
              {spins > 0 ? ` e ${num(spins)} giros grátis` : ''} ao subir. O presente cai como saldo bônus.
            </Alert>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-fg-3">
              <Banknote size={13} aria-hidden /> Continua no nível {levels[after]?.name}. {levels[after + 1] ? `Faltam ${num(levels[after + 1].xp - finalXp)} XP para subir.` : ''}
            </p>
          )}
          <p className="flex items-center gap-1.5 text-xs text-fg-3">
            <CalendarDays size={13} aria-hidden /> {config.keepLevel ? 'O nível conquistado não cai.' : 'O XP cai 10% por mês sem apostar.'}
          </p>
        </div>
      </CardBody>
    </Card>
  )
}
