import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowUpFromLine,
  Calculator,
  Cherry,
  CircleCheck,
  CircleOff,
  CloudOff,
  Gift,
  Grid3x3,
  Plus,
  RefreshCw,
  RotateCcw,
  Rocket,
  Spade,
  Trash2,
  Tv,
  UsersRound,
  Volleyball,
  Zap,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  FormFieldset,
  IconButton,
  MoneyInput,
  NumberInput,
  PageHeader,
  Progress,
  SaveBar,
  Segmented,
  Select,
  SettingsSection,
  Skeleton,
  Switch,
  TextLink,
  confirm,
  toast,
  useSettingsForm,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { brl, mult, pct, plural } from '@/lib/format'
import { uid } from '@/lib/random'
import { useCollection, useDb } from '@/lib/store'
import { useGames, useProviders } from '@/data/hooks'
import { GAME_CATEGORY_LABEL, type Game } from '@/data/catalog'
import { DEPOSIT_BONUS_KEY, seedDepositBonus } from '@/data/campanhas-bonus'
import { FS_KEYS, seedFsCampaigns } from '@/data/campanhas-freespins'
import { audit, usePageAccess } from '@/domain/session'
import { DEFAULT_WITHDRAWAL_RULES, WITHDRAWAL_KEYS, type WithdrawalRules } from '@/domain/withdrawals'
import type { DepositBonusCampaign } from '@/domain/campanhas-bonus'
import { fsCampaignStatus, type FreeSpinCampaign } from '@/domain/campanhas-freespins'
import {
  DEFAULT_ROLLOVER,
  ROLLOVER_CATEGORIES,
  ROLLOVER_CATEGORY_LABEL,
  ROLLOVER_KEY,
  WEIGHT_PRESETS,
  rolloverContribution,
  rolloverStatus,
  validateRolloverConfig,
  type RolloverCategory,
  type RolloverConfig,
} from '@/domain/campanhas-rollover'
import { GamePicker, GameTile } from './_shared-c1'

const CAT_ICON: Record<RolloverCategory, LucideIcon> = {
  slots: Cherry,
  ao_vivo: Tv,
  mesa: Spade,
  instantaneo: Zap,
  crash: Rocket,
  bingo: Grid3x3,
  esportes: Volleyball,
}

type LoadState = 'loading' | 'ready' | 'error'

/** Simula a leitura da configuração no servidor, com estado de carregamento e de falha. */
export default function Rollover() {
  const [raw, setRaw] = useDb<RolloverConfig>(ROLLOVER_KEY, DEFAULT_ROLLOVER)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<LoadState>('loading')
  const [problem, setProblem] = useState<string | null>(null)
  const { canEdit } = usePageAccess()

  useEffect(() => {
    setState('loading')
    const t = setTimeout(() => {
      const err = validateRolloverConfig(raw)
      setProblem(err)
      setState(err ? 'error' : 'ready')
    }, 380)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  const restore = async () => {
    const ok = await confirm({
      title: 'Restaurar a configuração padrão?',
      description: 'Os pesos voltam ao padrão da plataforma (slots 1x, ao vivo 0,1x, mesa 0,1x, instantâneos 0,5x, crash 1x condicional, bingo 0x, esportes 1x) e as exceções por jogo são apagadas.',
      confirmLabel: 'Restaurar padrão',
      tone: 'warning',
      icon: RotateCcw,
    })
    if (!ok) return
    setRaw(DEFAULT_ROLLOVER)
    audit('editar', 'Rollover', 'Configuração restaurada para o padrão após falha de leitura')
    toast.success('Configuração restaurada')
    setAttempt((a) => a + 1)
  }

  return (
    <>
      <PageHeader
        actions={
          <Button icon={RefreshCw} onClick={() => setAttempt((a) => a + 1)} loading={state === 'loading'} aria-label="Recarregar configuração">
            <span className="hidden sm:inline">Recarregar</span>
          </Button>
        }
      />
      {state === 'loading' ? (
        <div className="space-y-5" aria-busy="true" aria-label="Carregando regras de rollover">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      ) : state === 'error' ? (
        <Card>
          <EmptyState
            icon={CloudOff}
            title="Não foi possível carregar as regras de rollover"
            description={`${problem ?? 'Erro desconhecido.'} Tente de novo. Se o erro continuar, restaure o padrão: os saques e bônus seguem com a última regra válida do servidor enquanto isso.`}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button icon={RefreshCw} onClick={() => setAttempt((a) => a + 1)}>
                  Tentar novamente
                </Button>
                <Button variant="primary" icon={RotateCcw} onClick={restore} disabled={!canEdit} title={!canEdit ? 'Seu cargo não edita o rollover' : undefined}>
                  Restaurar padrão
                </Button>
              </div>
            }
            className="py-20"
          />
        </Card>
      ) : (
        <RolloverForm />
      )}
    </>
  )
}

function RolloverForm() {
  const form = useSettingsForm<RolloverConfig>(ROLLOVER_KEY, DEFAULT_ROLLOVER, {
    entity: 'Rollover',
    validate: validateRolloverConfig,
    successMessage: 'Regras de rollover salvas',
  })
  const v = form.values
  const { items: games } = useGames()
  const { items: providers } = useProviders()
  const [wRules] = useDb<WithdrawalRules>(WITHDRAWAL_KEYS.rules, DEFAULT_WITHDRAWAL_RULES)
  const { items: bonusCampaigns } = useCollection<DepositBonusCampaign>(DEPOSIT_BONUS_KEY, seedDepositBonus)
  const { items: fsCampaigns } = useCollection<FreeSpinCampaign>(FS_KEYS.campaigns, seedFsCampaigns)
  const bonusWithRollover = bonusCampaigns.filter((c) => c.active && c.rollover > 0).length + fsCampaigns.filter((c) => fsCampaignStatus(c) === 'ativa' && c.winRollover > 0).length
  const status = rolloverStatus(v, { withdrawalRolloverPct: wRules.rolloverPct, bonusCampaignsWithRollover: bonusWithRollover })

  const setWeight = (cat: RolloverCategory, w: number) => form.set('weights', { ...v.weights, [cat]: w })
  const setApplies = (k: keyof RolloverConfig['appliesTo'], on: boolean) => form.set('appliesTo', { ...v.appliesTo, [k]: on })
  const countBy = (cat: RolloverCategory) => games.filter((g) => g.category === cat && g.active)

  const overriddenIds = new Set(v.overrides.map((o) => o.gameId))

  return (
    <div className="space-y-5">
      <StatusBanner status={status} withdrawalPct={wRules.rolloverPct} />

      <FormFieldset readOnly={form.readOnly}>
        <SettingsSection
          title="Onde a regra vale"
          description="Os pesos abaixo valem para os rollovers ligados aqui. A regra fica sem efeito até um desses rollovers estar ligado de fato."
        >
          <Switch
            label="Bônus"
            description={`Rollover de bônus de depósito, free spins, cupons e cashback. ${status.items[0].detail}`}
            checked={v.appliesTo.bonus}
            onChange={(on) => setApplies('bonus', on)}
          />
          <Switch
            label="Saque"
            description={
              <>
                {status.items[1].detail}{' '}
                <TextLink to="/system/saques?aba=regras">{wRules.rolloverPct > 0 ? 'Ver regras de saque' : 'Ligar em Saques › Regras'}</TextLink>
              </>
            }
            checked={v.appliesTo.saque}
            onChange={(on) => setApplies('saque', on)}
          />
          <Switch label="Indicação" description="Rollover dos prêmios do programa de indicação (baús)." checked={v.appliesTo.indicacao} onChange={(on) => setApplies('indicacao', on)} />
        </SettingsSection>

        <SettingsSection
          title="Peso por tipo de jogo"
          description="Quanto de cada aposta conta. 1x = o valor inteiro; 0,1x = 10%; 0x = não conta. Jogos de baixo risco (mesa, ao vivo) costumam pesar menos."
        >
          <div className="space-y-2.5">
            {ROLLOVER_CATEGORIES.map((cat) => {
              const Icon = CAT_ICON[cat]
              const list = cat === 'esportes' ? [] : countBy(cat)
              const w = v.weights[cat]
              return (
                <div key={cat} className="rounded-xl border border-line">
                  <div className="flex flex-col gap-3 p-3.5 md:flex-row md:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', w === 0 ? 'bg-surface-3 text-fg-3' : 'bg-primary/10 text-primary-text')}>
                        <Icon size={18} aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-medium text-fg">
                          {ROLLOVER_CATEGORY_LABEL[cat]}
                          {cat === 'crash' && <Badge tone="warning">Condicional</Badge>}
                        </p>
                        <p className="truncate text-xs text-fg-3">
                          {cat === 'esportes'
                            ? 'Bilhetes do sportsbook, conta na liquidação'
                            : `${plural(list.length, 'jogo', 'jogos')} · ${list
                                .slice(0, 2)
                                .map((g) => g.name)
                                .join(', ')}${list.length > 2 ? '…' : ''}`}
                        </p>
                      </div>
                    </div>
                    <WeightControl id={`w-${cat}`} label={ROLLOVER_CATEGORY_LABEL[cat]} value={w} onChange={(n) => setWeight(cat, n)} disabled={form.readOnly} />
                  </div>
                  {cat === 'crash' && (
                    <div className="space-y-3 border-t border-line bg-surface-2/60 p-3.5">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px] md:items-end">
                        <p className="text-[13px] leading-5 text-fg-2">
                          No crash, a aposta só conta se a rodada terminar em <strong className="text-fg">perda total</strong> ou com ganho de <strong className="text-fg">pelo menos {mult(v.crashMinMultiplier)}</strong> o
                          apostado. Isso evita cumprir rollover saindo cedo com risco quase zero.
                        </p>
                        <Field label="Ganho mínimo para contar" htmlFor="crash-x" error={v.crashMinMultiplier < 1.01 ? 'Mínimo de 1,01x.' : null}>
                          <NumberInput id="crash-x" value={v.crashMinMultiplier} min={1.01} step={0.1} suffix="x" onValueChange={(n) => form.set('crashMinMultiplier', n)} invalid={v.crashMinMultiplier < 1.01} />
                        </Field>
                      </div>
                      <CrashScale x={v.crashMinMultiplier} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </SettingsSection>

        <SettingsSection
          title="Exceções por jogo"
          description="Um jogo pode ter peso próprio, diferente do tipo. Útil para jogos com RTP muito alto ou estratégias de baixo risco."
          aside={<p className="text-xs text-fg-3">{v.overrides.length ? `${v.overrides.length} ${v.overrides.length === 1 ? 'exceção' : 'exceções'}` : 'Nenhuma exceção'}</p>}
        >
          {v.overrides.length > 0 ? (
            <ul className="space-y-2">
              {v.overrides.map((o) => {
                const g = games.find((x) => x.id === o.gameId)
                const typeWeight = g ? v.weights[g.category] : 0
                return (
                  <li key={o.gameId} className="flex flex-col gap-3 rounded-xl border border-line p-3 md:flex-row md:items-center">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <GameTile game={g} size={34} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg">{g?.name ?? 'Jogo removido do catálogo'}</p>
                        <p className="truncate text-xs text-fg-3">
                          {g ? `${GAME_CATEGORY_LABEL[g.category]} · padrão do tipo ${mult(typeWeight)}` : o.gameId}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <WeightControl
                        id={`ov-${o.gameId}`}
                        label={g?.name ?? o.gameId}
                        value={o.weight}
                        onChange={(n) => form.set('overrides', v.overrides.map((x) => (x.gameId === o.gameId ? { ...x, weight: n } : x)))}
                        disabled={form.readOnly}
                      />
                      <IconButton icon={Trash2} label={`Remover exceção de ${g?.name ?? 'jogo'}`} variant="danger" size="sm" disabled={form.readOnly} onClick={() => form.set('overrides', v.overrides.filter((x) => x.gameId !== o.gameId))} />
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-center text-[13px] text-fg-3">Todos os jogos seguem o peso do seu tipo.</p>
          )}
          <Field label="Adicionar exceção" htmlFor="ov-add" hint="Escolha o jogo. Ele começa com o peso do tipo; ajuste depois.">
            <GamePicker
              id="ov-add"
              value={null}
              placeholder="Escolha um jogo para ter peso próprio"
              games={games}
              providers={providers}
              filter={(g: Game) => !overriddenIds.has(g.id)}
              onChange={(id) => {
                const g = games.find((x) => x.id === id)
                if (!g) return
                form.set('overrides', [...v.overrides, { gameId: id, weight: v.weights[g.category] }])
              }}
              disabled={form.readOnly}
            />
          </Field>
        </SettingsSection>
      </FormFieldset>

      <Simulator cfg={v} games={games} />

      <SaveBar form={form} label="Salvar regras" />
    </div>
  )
}

function StatusBanner({ status, withdrawalPct }: { status: ReturnType<typeof rolloverStatus>; withdrawalPct: number }) {
  const tone = status.state === 'desligada' ? 'warning' : status.state === 'ligada' ? 'success' : 'info'
  const title =
    status.state === 'desligada'
      ? 'Regra desligada: nenhum rollover está ligado'
      : `Regra valendo para ${status.effective.map((i) => i.label.toLowerCase()).join(' e ')}`
  const icons = { bonus: Gift, saque: ArrowUpFromLine, indicacao: UsersRound }
  const navigate = useNavigate()
  return (
    <Alert
      tone={tone}
      title={title}
      action={
        status.items[1].on && withdrawalPct === 0 ? (
          <Button size="sm" onClick={() => navigate('/system/saques?aba=regras')}>
            Regras de saque
          </Button>
        ) : undefined
      }
    >
      <p>
        {status.state === 'desligada'
          ? 'Os pesos ficam salvos e passam a valer quando o rollover de bônus, de saque ou de indicação for ligado.'
          : 'Os pesos abaixo já mudam quanto cada aposta anda no rollover.'}{' '}
        A prévia usa o que está na tela, mesmo antes de salvar.
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {status.items.map((i) => {
          const I = icons[i.key]
          return (
            <li key={i.key} title={i.detail}>
              <Badge tone={i.effective ? 'success' : i.on ? 'warning' : 'neutral'} icon={I}>
                {i.label}: {i.effective ? 'valendo' : i.on ? 'sem efeito' : 'desligado'}
              </Badge>
            </li>
          )
        })}
      </ul>
    </Alert>
  )
}

/** Peso: atalhos 0x / 0,1x / 0,5x / 1x e campo livre. */
function WeightControl({ id, label, value, onChange, disabled }: { id: string; label: string; value: number; onChange: (n: number) => void; disabled?: boolean }) {
  const preset = WEIGHT_PRESETS.find((p) => p === value)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented<string>
        ariaLabel={`Peso de ${label}`}
        size="sm"
        value={preset !== undefined ? String(preset) : 'outro'}
        onChange={(s) => !disabled && onChange(Number(s))}
        options={WEIGHT_PRESETS.map((p) => ({ value: String(p), label: mult(p) }))}
      />
      <div className="w-[104px]">
        <label htmlFor={id} className="sr-only">
          Peso de {label} (valor livre)
        </label>
        <NumberInput id={id} value={value} min={0} max={1} step={0.05} suffix="x" disabled={disabled} invalid={value < 0 || value > 1} onValueChange={(n) => onChange(Math.round(n * 100) / 100)} />
      </div>
      <span className={cn('w-[112px] whitespace-nowrap text-right text-xs tnum', value === 0 ? 'text-fg-3' : 'text-fg-2')} title={`A cada R$ 100 apostados, contam ${brl(100 * value)}`}>
        R$ 100 → {brl(100 * value).replace(',00', '')}
      </span>
    </div>
  )
}

function CrashScale({ x }: { x: number }) {
  return (
    <div aria-label={`Escala do crash: perda total conta, saída abaixo de ${mult(x)} não conta, a partir de ${mult(x)} conta`} role="img">
      <div className="flex h-8 overflow-hidden rounded-lg text-[11px] font-semibold">
        <div className="flex w-[22%] items-center justify-center gap-1 bg-success/15 text-success">
          <CircleCheck size={12} aria-hidden /> 0x
        </div>
        <div className="flex flex-1 items-center justify-center gap-1 bg-danger/10 text-danger">
          <CircleOff size={12} aria-hidden /> de 1x até {mult(Math.max(1, x - 0.01))}
        </div>
        <div className="flex w-[30%] items-center justify-center gap-1 bg-success/15 text-success">
          <CircleCheck size={12} aria-hidden /> {mult(x)} ou mais
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-fg-3">
        <span>perda total: conta</span>
        <span>saída cedo: não conta</span>
        <span>ganho alto: conta</span>
      </div>
    </div>
  )
}

// ---------- Simulador ----------

interface SimRow {
  id: string
  category: RolloverCategory
  gameId: string | null
  amount: number
  multiplier: number
}

function sampleRows(games: Game[]): SimRow[] {
  const g = (name: string) => games.find((x) => x.name === name)?.id ?? null
  return [
    { id: 's1', category: 'slots', gameId: g('Fortune Tiger'), amount: 10, multiplier: 0 },
    { id: 's2', category: 'ao_vivo', gameId: g('Roleta Brasileira'), amount: 50, multiplier: 2 },
    { id: 's3', category: 'crash', gameId: g('Aviator'), amount: 20, multiplier: 1.3 },
    { id: 's4', category: 'crash', gameId: g('Aviator'), amount: 20, multiplier: 0 },
    { id: 's5', category: 'instantaneo', gameId: g('Mines'), amount: 10, multiplier: 1.5 },
    { id: 's6', category: 'esportes', gameId: null, amount: 30, multiplier: 1.85 },
  ]
}

function Simulator({ cfg, games }: { cfg: RolloverConfig; games: Game[] }) {
  const [rows, setRows] = useState<SimRow[]>(() => sampleRows(games))
  const [target, setTarget] = useState(500)
  const results = useMemo(() => rows.map((r) => ({ r, c: rolloverContribution(cfg, r) })), [rows, cfg])
  const totalBet = rows.reduce((s, r) => s + (r.amount || 0), 0)
  const totalCounted = results.reduce((s, x) => s + x.c.counted, 0)
  const patch = (id: string, p: Partial<SimRow>) => setRows((list) => list.map((r) => (r.id === id ? { ...r, ...p } : r)))
  const catOptions = ROLLOVER_CATEGORIES.map((c) => ({ value: c, label: ROLLOVER_CATEGORY_LABEL[c] }))

  return (
    <Card>
      <CardHeader
        icon={Calculator}
        title="Simulador de apostas"
        description="Monte uma sequência de apostas e veja quanto cada uma anda no rollover com as regras da tela."
        actions={
          <>
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setRows(sampleRows(games))}>
              Exemplos
            </Button>
            <Button size="sm" icon={Plus} onClick={() => setRows((l) => [...l, { id: uid('s'), category: 'slots', gameId: null, amount: 10, multiplier: 0 }])} disabled={rows.length >= 15}>
              Adicionar aposta
            </Button>
          </>
        }
      />
      <CardBody className="space-y-4">
        <div className="relative overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[900px] text-sm">
            <caption className="sr-only">Apostas simuladas e quanto contam para o rollover</caption>
            <thead>
              <tr className="border-b border-line bg-surface-2/80 text-left text-xs text-fg-3">
                <th scope="col" className="px-3 py-2 font-semibold">Tipo</th>
                <th scope="col" className="px-3 py-2 font-semibold">Jogo</th>
                <th scope="col" className="px-3 py-2 font-semibold">Valor</th>
                <th scope="col" className="px-3 py-2 font-semibold">Resultado</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Peso</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Conta</th>
                <th scope="col" className="px-3 py-2 font-semibold">Por quê</th>
                <th scope="col" className="w-10 px-2 py-2">
                  <span className="sr-only">Remover</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map(({ r, c }, i) => {
                const options = r.category === 'esportes' ? [] : games.filter((g) => g.category === r.category)
                return (
                  <tr key={r.id} className="border-b border-line/70 align-top last:border-0">
                    <td className="w-48 px-3 py-2">
                      <Select aria-label={`Tipo da aposta ${i + 1}`} value={r.category} onChange={(val) => patch(r.id, { category: val as RolloverCategory, gameId: null })} options={catOptions} />
                    </td>
                    <td className="w-48 px-3 py-2">
                      <Select
                        aria-label={`Jogo da aposta ${i + 1}`}
                        value={r.gameId ?? ''}
                        disabled={r.category === 'esportes'}
                        onChange={(val) => patch(r.id, { gameId: val || null })}
                        placeholder={r.category === 'esportes' ? 'Sportsbook' : 'Qualquer jogo do tipo'}
                        options={options.map((g) => ({ value: g.id, label: `${g.name}${cfg.overrides.some((o) => o.gameId === g.id) ? ' · exceção' : ''}` }))}
                      />
                    </td>
                    <td className="w-36 px-3 py-2">
                      <MoneyInput value={r.amount} ariaLabel="Valor apostado na simulação" onValueChange={(n) => patch(r.id, { amount: n })} />
                    </td>
                    <td className="w-32 px-3 py-2">
                      <NumberInput value={r.multiplier} min={0} step={0.1} suffix="x" ariaLabel="Multiplicador do resultado na simulação" onValueChange={(n) => patch(r.id, { multiplier: Math.max(0, n) })} />
                      <p className="mt-1 text-[11px] text-fg-3">{r.multiplier === 0 ? 'perdeu tudo' : r.category === 'esportes' ? 'odd do bilhete' : `voltou ${brl(r.amount * r.multiplier)}`}</p>
                    </td>
                    <td className="px-3 py-2 pt-4 text-right tnum">
                      {mult(c.weight)}
                      {c.source === 'excecao' && <p className="text-[11px] text-info">exceção</p>}
                    </td>
                    <td className={cn('px-3 py-2 pt-4 text-right font-semibold tnum', c.counts ? 'text-fg' : 'text-fg-3')}>{brl(c.counted)}</td>
                    <td className="max-w-[240px] px-3 py-2 pt-3.5 text-xs leading-5 text-fg-2">
                      <span className="inline-flex items-start gap-1.5">
                        {c.counts ? <CircleCheck size={13} className="mt-0.5 shrink-0 text-success" aria-label="Conta" /> : <CircleOff size={13} className="mt-0.5 shrink-0 text-danger" aria-label="Não conta" />}
                        {c.reason}
                      </span>
                    </td>
                    <td className="px-2 py-2 pt-3">
                      <IconButton icon={Trash2} label={`Remover aposta ${i + 1}`} size="sm" variant="danger" onClick={() => setRows((l) => l.filter((x) => x.id !== r.id))} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!rows.length && <EmptyState title="Nenhuma aposta" description="Adicione apostas para simular." className="py-8" />}
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,220px)] md:items-end">
          <div className="rounded-xl bg-surface-2 px-4 py-3">
            <p className="text-xs text-fg-3">Total apostado</p>
            <p className="font-display text-xl font-bold text-fg tnum">{brl(totalBet)}</p>
          </div>
          <div className="rounded-xl bg-primary/5 px-4 py-3 ring-1 ring-inset ring-primary/20">
            <p className="text-xs text-primary-text">Conta para o rollover</p>
            <p className="font-display text-xl font-bold text-fg tnum">
              {brl(totalCounted)} <span className="text-sm font-medium text-fg-3">({pct(totalBet ? totalCounted / totalBet : 0, 0)} do apostado)</span>
            </p>
          </div>
          <Field label="Meta de exemplo" htmlFor="sim-target" hint="Ex.: bônus de R$ 50 × 10x.">
            <MoneyInput id="sim-target" value={target} onValueChange={setTarget} />
          </Field>
        </div>
        {target > 0 && (
          <div>
            <div className="mb-1 flex justify-between text-xs text-fg-3">
              <span>Progresso na meta</span>
              <span className="tnum">
                {brl(totalCounted)} de {brl(target)} · falta {brl(Math.max(0, target - totalCounted))}
              </span>
            </div>
            <Progress value={totalCounted} max={target} tone={totalCounted >= target ? 'success' : 'primary'} label="Progresso do rollover simulado" />
          </div>
        )}
      </CardBody>
    </Card>
  )
}
