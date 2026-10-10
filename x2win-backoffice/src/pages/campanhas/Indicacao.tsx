import { useMemo, useState } from 'react'
import {
  BadgeCheck,
  CircleDollarSign,
  Copy,
  Link2,
  Package,
  PackageOpen,
  Plus,
  Power,
  Trash2,
  UserCheck,
  UsersRound,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Field,
  FormFieldset,
  FormGrid,
  IconButton,
  KpiCard,
  MoneyInput,
  NumberInput,
  PageHeader,
  PersonCell,
  Progress,
  SaveBar,
  Select,
  SettingsSection,
  Switch,
  confirm,
  toast,
  useSettingsForm,
  type Column,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { brl, dateTime, maskEmail, num, pct } from '@/lib/format'
import { isApiMode } from '@/lib/api'
import { useDb } from '@/lib/store'
import { uid } from '@/lib/random'
import { seedReferrals } from '@/data/campanhas2-seeds'
import { audit, usePageAccess, useSession } from '@/domain/session'
import { C2_KEYS, rewardShort, rewardText } from '@/domain/campanhas2-common'
import {
  CHEST_REWARD_LABEL,
  DEFAULT_REFERRAL_CONFIG,
  DEFAULT_REFERRAL_STATUS,
  MAX_CHESTS,
  chestCost,
  chestErrors,
  nextChest,
  referralStats,
  validateReferralConfig,
  type Chest,
  type ChestRewardKind,
  type ReferralConfig,
  type ReferralStatus,
  type ReferrerSummary,
} from '@/domain/campanhas2-indicacao'
import { PlayerPreview, useCoin, type CoinCtx } from './_shared-c2'

export default function Indicacao() {
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  const coin = useCoin()
  const [status, setStatus] = useDb<ReferralStatus>(C2_KEYS.indicacaoStatus, DEFAULT_REFERRAL_STATUS)
  const form = useSettingsForm<ReferralConfig>(C2_KEYS.indicacao, DEFAULT_REFERRAL_CONFIG, {
    entity: 'Programa de indicação',
    validate: validateReferralConfig,
    successMessage: 'Regras de indicação salvas',
  })
  const v = form.values
  // indicados de demonstração (gerados da base local). Modo API: ainda não há registro de indicados
  // no servidor; a tela não mostra os de demonstração (nomes e e-mails) como se fossem reais
  const records = useMemo(() => (isApiMode() ? [] : seedReferrals()), [])
  const saved = useMemo(() => referralStats(records, form.saved, status.enabled, coin), [records, form.saved, status.enabled, coin])
  const draft = useMemo(() => referralStats(records, v, status.enabled, coin), [records, v, status.enabled, coin])
  const chestErr = chestErrors(v.chests)
  const on = status.enabled

  const toggleProgram = async (next: boolean) => {
    if (!canEdit) return
    const ok = await confirm(
      next
        ? {
            title: 'Ligar o programa de indicação?',
            description: 'A área "Indique e ganhe" volta a aparecer no site e os baús voltam a abrir conforme as regras salvas.',
            confirmLabel: 'Ligar programa',
            tone: 'success',
            icon: Power,
          }
        : {
            title: 'Desligar o programa de indicação?',
            description: 'O programa some do site e nenhum baú é aberto até você religar. As regras ficam salvas.',
            confirmLabel: 'Desligar programa',
            tone: 'danger',
            icon: Power,
          },
    )
    if (!ok) return
    setStatus({ enabled: next, changedAt: new Date().toISOString(), changedBy: user.name })
    audit(next ? 'ligar' : 'desligar', 'Programa de indicação', next ? 'Programa ligado: aparece no site e os baús voltam a abrir' : 'Programa desligado: some do site e nenhum baú é aberto')
    toast.success(next ? 'Programa ligado' : 'Programa desligado', { description: next ? 'Já aparece no site.' : 'Saiu do site. Nenhum baú será aberto.' })
  }

  const setChest = (id: string, patch: Partial<Chest>) => form.set('chests', v.chests.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const addChest = () => {
    const last = v.chests[v.chests.length - 1]
    form.set('chests', [...v.chests, { id: uid('ch'), referrals: last ? last.referrals * 2 : 1, kind: 'bonus_brl', value: last ? Math.max(10, last.kind === 'bonus_brl' || last.kind === 'dinheiro' ? last.value * 2 : 50) : 10 }])
  }
  const allChestsCost = v.chests.reduce((s, c) => s + chestCost(c, coin), 0)

  return (
    <>
      <PageHeader />

      <div className="space-y-6">
        <section aria-label="Situação do programa" className={cn('card flex flex-col gap-4 p-5 sm:flex-row sm:items-center', on ? 'border-success/30' : 'border-warning/40')}>
          <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', on ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
            <UsersRound size={22} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-fg">Indique e ganhe</h2>
              <Badge tone={on ? 'success' : 'warning'} dot size="md">
                {on ? 'Ligado' : 'Desligado'}
              </Badge>
            </div>
            <p className="mt-0.5 text-[13px] leading-5 text-fg-3">
              {on ? 'Aparece no site e abre baús conforme os indicados válidos de cada jogador.' : 'Não aparece no site e nenhum baú é aberto.'}
              {status.changedAt && (
                <>
                  {' '}
                  {on ? 'Ligado' : 'Desligado'} por {status.changedBy} em {dateTime(status.changedAt)}.
                </>
              )}
            </p>
          </div>
          <Switch
            label={<span className="sr-only sm:not-sr-only">Programa ligado</span>}
            ariaLabel="Programa de indicação ligado"
            checked={on}
            disabled={!canEdit}
            onChange={toggleProgram}
            className="shrink-0 items-center"
          />
        </section>

        {!on && (
          <Alert tone="warning" title="Programa desligado: some do site e nenhum baú é aberto">
            Jogadores não veem o link nem o progresso de indicação. As regras abaixo continuam salvas e voltam a valer quando você religar.
          </Alert>
        )}

        <section aria-label="Resumo do programa" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Indicações válidas"
            icon={UserCheck}
            tone="success"
            value={`${num(saved.valid)} de ${num(saved.referred)}`}
            hint={`${pct(saved.referred ? saved.valid / saved.referred : 0, 0)} cumprem as regras`}
            formula={<>Indicados que cumprem depósito mínimo, aposta mínima, KYC (se exigido), IP diferente de quem indicou (se ligado) e o prazo após o cadastro.</>}
          />
          <KpiCard
            label="Baús abertos"
            icon={PackageOpen}
            tone="warning"
            value={num(saved.chestsOpened)}
            hint={on ? `${num(saved.activeReferrers)} jogadores com indicados válidos` : 'programa desligado'}
          />
          <KpiCard
            label="Custo dos baús"
            icon={CircleDollarSign}
            tone="danger"
            value={brl(saved.cost)}
            hint={on && saved.chestsOpened ? `média de ${brl(saved.cost / saved.chestsOpened)} por baú` : 'nenhum baú aberto'}
            formula={<>Soma das recompensas dos baús abertos: bônus e saldo real pelo valor, free spins a R$ 0,40 e moedas pelo valor de referência.</>}
          />
          <KpiCard label="Custo por indicado válido" icon={BadgeCheck} tone="info" value={brl(saved.valid ? saved.cost / saved.valid : 0)} hint="pago por indicado que converteu" />
        </section>

        <FormFieldset readOnly={form.readOnly}>
          <div className={cn('space-y-5 transition-opacity duration-200', !on && 'opacity-60 hover:opacity-90 focus-within:opacity-100')}>
            <SettingsSection
              title="Baús"
              description="O jogador abre um baú ao atingir o número de indicados válidos. Cada baú abre uma vez por jogador."
              aside={
                <div className="rounded-xl bg-surface-2 p-3 text-[13px]">
                  <p className="text-fg-3">Quem abrir todos recebe</p>
                  <p className="text-base font-bold text-fg tnum">{brl(allChestsCost)}</p>
                  <p className="text-xs text-fg-3">em valor de prêmios</p>
                </div>
              }
            >
              {chestErr.list && <Alert tone="danger">{chestErr.list}</Alert>}
              <div className="hidden grid-cols-[36px_150px_150px_minmax(0,1fr)_32px] gap-2 px-3 text-xs font-semibold text-fg-3 md:grid">
                <span aria-hidden />
                <span>Indicados válidos</span>
                <span>Recompensa</span>
                <span>Valor</span>
                <span className="sr-only">Remover</span>
              </div>
              <ol className="space-y-2">
                {v.chests.map((c, i) => {
                  const err = chestErr.byId[c.id]
                  return (
                    <li key={c.id} className={cn('rounded-xl border p-2.5', err ? 'border-danger/50 bg-danger/[0.03]' : 'border-line')}>
                      <div className="grid grid-cols-[36px_minmax(0,1fr)_32px] items-center gap-2 md:grid-cols-[36px_150px_150px_minmax(0,1fr)_32px]">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold/15 text-warning dark:text-gold" title={`Baú ${i + 1}`}>
                          <Package size={17} aria-hidden />
                          <span className="sr-only">Baú {i + 1}</span>
                        </span>
                        <NumberInput value={c.referrals} min={1} suffix="indic." ariaLabel={`Indicações para abrir o baú ${i + 1}`} invalid={!!err && err.includes('anterior')} onValueChange={(n) => setChest(c.id, { referrals: Math.round(n) })} />
                        <IconButton
                          icon={Trash2}
                          label={`Remover baú ${i + 1}`}
                          size="sm"
                          variant="danger"
                          className="md:order-last"
                          disabled={v.chests.length <= 1}
                          onClick={() => form.set('chests', v.chests.filter((x) => x.id !== c.id))}
                        />
                        <div className="col-span-3 grid grid-cols-2 gap-2 md:contents">
                          <Select
                            aria-label={`Recompensa do baú ${i + 1}`}
                            value={c.kind}
                            onChange={(k) => setChest(c.id, { kind: k as ChestRewardKind, value: k === 'moedas' ? 1000 : k === 'free_spins' ? 20 : c.kind === 'moedas' || c.kind === 'free_spins' ? 10 : c.value })}
                            options={(Object.keys(CHEST_REWARD_LABEL) as ChestRewardKind[]).map((k) => ({ value: k, label: CHEST_REWARD_LABEL[k] }))}
                          />
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              {c.kind === 'bonus_brl' || c.kind === 'dinheiro' ? (
                                <MoneyInput value={c.value} ariaLabel={`Prêmio do baú ${i + 1}`} onValueChange={(n) => setChest(c.id, { value: n })} invalid={!!err && !(c.value > 0)} />
                              ) : (
                                <NumberInput value={c.value} min={1} suffix={c.kind === 'moedas' ? coin.symbol : 'giros'} ariaLabel={`Prêmio do baú ${i + 1}`} onValueChange={(n) => setChest(c.id, { value: Math.round(n) })} invalid={!!err && !(c.value > 0)} />
                              )}
                            </div>
                            <span className="hidden w-20 shrink-0 text-right text-xs text-fg-3 tnum lg:block">≈ {brl(chestCost(c, coin))}</span>
                          </div>
                        </div>
                      </div>
                      {err && (
                        <p className="mt-1.5 text-xs font-medium text-danger" role="alert">
                          {err}
                        </p>
                      )}
                    </li>
                  )
                })}
              </ol>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button size="sm" icon={Plus} onClick={addChest} disabled={v.chests.length >= MAX_CHESTS}>
                  Adicionar baú
                </Button>
                <span className="text-xs text-fg-3">
                  {v.chests.length} de {MAX_CHESTS} baús · em ordem crescente de indicados
                </span>
              </div>
            </SettingsSection>

            <ReferralPreview chests={v.chests} coin={coin} on={on} hasErrors={Object.keys(chestErr.byId).length > 0} />

            <SettingsSection
              title="Indicado válido"
              description="Só conta para os baús o indicado que cumprir todas as condições."
              aside={
                <div className="rounded-xl border border-line p-3 text-[13px]" aria-live="polite">
                  <p className="text-fg-3">Com estas regras</p>
                  <p className="text-base font-bold text-fg tnum">
                    {num(draft.valid)} de {num(draft.referred)} válidos
                  </p>
                  <Progress className="mt-2" value={draft.valid} max={Math.max(1, draft.referred)} tone="success" label="Indicados válidos com as regras do rascunho" />
                  {draft.valid !== saved.valid && (
                    <p className={cn('mt-2 text-xs font-medium', draft.valid > saved.valid ? 'text-success' : 'text-warning')}>
                      {draft.valid > saved.valid ? '+' : ''}
                      {num(draft.valid - saved.valid)} em relação ao salvo ({num(saved.valid)})
                    </p>
                  )}
                </div>
              }
            >
              <FormGrid>
                <Field label="Depósito mínimo do indicado" htmlFor="ind-dep" hint="Soma dos depósitos pagos.">
                  <MoneyInput id="ind-dep" value={v.rules.minDeposit} onValueChange={(n) => form.set('rules', { ...v.rules, minDeposit: n })} />
                </Field>
                <Field label="Apostou pelo menos" htmlFor="ind-wag" hint="Total apostado pelo indicado.">
                  <MoneyInput id="ind-wag" value={v.rules.minWager} onValueChange={(n) => form.set('rules', { ...v.rules, minWager: n })} />
                </Field>
                <Field label="Prazo para cumprir" htmlFor="ind-win" hint="Dias após o cadastro do indicado.">
                  <NumberInput id="ind-win" value={v.rules.windowDays} min={1} max={365} suffix="dias" onValueChange={(n) => form.set('rules', { ...v.rules, windowDays: Math.round(n) })} />
                </Field>
              </FormGrid>
              <div className="grid gap-3 sm:grid-cols-2">
                <Switch
                  className="rounded-xl border border-line p-3"
                  label="KYC verificado"
                  description="O indicado precisa ter a identidade aprovada."
                  checked={v.rules.requireKyc}
                  onChange={(x) => form.set('rules', { ...v.rules, requireKyc: x })}
                />
                <Switch
                  className="rounded-xl border border-line p-3"
                  label="Bloquear mesmo IP"
                  description="Indicado no mesmo IP de quem indicou não conta."
                  checked={v.rules.blockSameIp}
                  onChange={(x) => form.set('rules', { ...v.rules, blockSameIp: x })}
                />
              </div>
              {!v.rules.requireKyc && !v.rules.blockSameIp && (
                <Alert tone="warning" title="Regras abertas a fraude">
                  Sem KYC e sem bloqueio de IP, a mesma pessoa pode criar contas para abrir baús. Veja Segurança › Anti-fraude.
                </Alert>
              )}
            </SettingsSection>

            <SettingsSection title="Recompensa e limites" description="Como o prêmio dos baús pode ser sacado.">
              <FormGrid>
                <Field
                  label="Rollover da recompensa"
                  htmlFor="ind-roll"
                  hint={v.rollover ? `Baú de R$ 50 de bônus exige apostar ${brl(50 * v.rollover)} para sacar. Não vale para saldo real, giros e moedas.` : 'Sem rollover: o bônus vira saldo sacável.'}
                >
                  <NumberInput id="ind-roll" value={v.rollover} min={0} max={100} suffix="x" onValueChange={(n) => form.set('rollover', n)} />
                </Field>
                <Field label="Máximo de indicados por jogador" htmlFor="ind-max" hint="0 = sem limite. Indicados acima do limite não contam.">
                  <NumberInput id="ind-max" value={v.maxReferrals} min={0} suffix="indic." onValueChange={(n) => form.set('maxReferrals', Math.round(n))} />
                </Field>
              </FormGrid>
            </SettingsSection>
          </div>
        </FormFieldset>

        <ReferrersTable referrers={saved.referrers} cfg={form.saved} coin={coin} on={on} />
      </div>

      <SaveBar form={form} label="Salvar regras" />
    </>
  )
}

// ---------- Prévia do progresso ----------

function ReferralPreview({ chests, coin, on, hasErrors }: { chests: Chest[]; coin: CoinCtx; on: boolean; hasErrors: boolean }) {
  const max = chests.length ? chests[chests.length - 1].referrals : 1
  const [count, setCount] = useState(4)
  const n = chests.length
  // trilha em degraus iguais por baú; o preenchimento é proporcional dentro de cada degrau
  let fill = 0
  for (let i = 0; i < n; i++) {
    const prev = i === 0 ? 0 : chests[i - 1].referrals
    const cur = chests[i].referrals
    if (count >= cur) fill = i + 1
    else {
      fill = i + Math.max(0, Math.min(1, (count - prev) / Math.max(1, cur - prev)))
      break
    }
  }
  const next = nextChest(count, chests)
  return (
    <Card>
      <CardHeader title="Prévia do progresso" description="Arraste para ver como fica a área de indicação com outro número de indicados." />
      <CardBody>
        <PlayerPreview
          aside={
            <label className="flex items-center gap-2 text-xs text-fg-2">
              <span className="whitespace-nowrap">Indicados válidos: <strong className="text-fg tnum">{count}</strong></span>
              <input
                type="range"
                min={0}
                max={max + 2}
                value={Math.min(count, max + 2)}
                onChange={(e) => setCount(Number(e.target.value))}
                aria-label="Simular indicados válidos do jogador"
                className="w-28 accent-[rgb(var(--primary))] sm:w-44"
              />
            </label>
          }
        >
          <div className={cn('relative', !on && 'opacity-50')}>
            {!on && (
              <div className="absolute inset-0 z-10 flex items-center justify-center">
                <span className="rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-fg shadow-pop ring-1 ring-line">Desligado: o jogador não vê esta área</span>
              </div>
            )}
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="font-display text-lg font-bold text-fg">Indique e ganhe</p>
                <p className="text-[13px] text-fg-2">
                  Você tem <strong className="text-fg">{count}</strong> {count === 1 ? 'indicado válido' : 'indicados válidos'}.{' '}
                  {next ? (
                    <>
                      Faltam <strong className="text-fg">{next.referrals - count}</strong> para o próximo baú: <strong className="text-fg">{rewardText(next, coin)}</strong>.
                    </>
                  ) : (
                    'Você abriu todos os baús.'
                  )}
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 self-start rounded-lg border border-line bg-surface px-2.5 py-1.5 font-mono text-xs text-fg-2 sm:self-auto">
                <Link2 size={13} aria-hidden /> x2win.bet.br/?ref=ana27
                <Copy size={12} className="text-fg-3" aria-hidden />
              </span>
            </div>

            {hasErrors ? (
              <p className="mt-6 text-[13px] text-danger">Corrija os baús para ver a prévia.</p>
            ) : (
              <div className="relative mt-9 px-5 pb-16">
                <div className="h-2.5 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-gradient-to-r from-primary to-gold transition-[width] duration-300" style={{ width: `${(fill / Math.max(1, n)) * 100}%` }} />
                </div>
                {chests.map((c, i) => {
                  const open = count >= c.referrals
                  const left = ((i + 1) / n) * 100
                  return (
                    <div key={c.id} className="absolute -top-[15px] flex -translate-x-1/2 flex-col items-center" style={{ left: `calc(1.25rem + (100% - 2.5rem) * ${left / 100})` }}>
                      <span
                        className={cn(
                          'flex h-10 w-10 items-center justify-center rounded-xl border-2 shadow-card transition-colors',
                          open ? 'border-gold bg-gold/20 text-warning dark:text-gold' : 'border-line-strong bg-surface text-fg-3',
                        )}
                        title={`${c.referrals} indicados: ${rewardText(c, coin)}`}
                      >
                        {open ? <PackageOpen size={18} aria-hidden /> : <Package size={18} aria-hidden />}
                      </span>
                      <span className={cn('mt-1 text-[11px] font-bold tnum', open ? 'text-fg' : 'text-fg-3')}>{c.referrals}</span>
                      <span className="hidden max-w-[84px] truncate text-center text-[11px] text-fg-3 sm:block">{rewardShort(c, coin)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </PlayerPreview>
      </CardBody>
    </Card>
  )
}

// ---------- Indicadores ----------

function ReferrersTable({ referrers, cfg, coin, on }: { referrers: ReferrerSummary[]; cfg: ReferralConfig; coin: CoinCtx; on: boolean }) {
  const columns: Column<ReferrerSummary>[] = [
    { id: 'name', header: 'Jogador', minWidth: 220, pinned: true, sortValue: (r) => r.name, csv: (r) => `${r.name} (${r.referrerId})`, cell: (r) => <PersonCell name={r.name} sub={r.email ? maskEmail(r.email) : `ID ${r.referrerId}`} /> },
    { id: 'referred', header: 'Indicados', align: 'right', sortValue: (r) => r.referred, cell: (r) => <span className="tnum">{num(r.referred)}</span> },
    { id: 'valid', header: 'Válidos', align: 'right', sortValue: (r) => r.valid, cell: (r) => <span className="font-semibold tnum">{num(r.valid)}</span> },
    {
      id: 'opened',
      header: 'Baús abertos',
      sortValue: (r) => r.opened,
      csv: (r) => r.opened,
      cell: (r) => (
        <span className="flex items-center gap-1" aria-label={`${r.opened} de ${cfg.chests.length} baús`}>
          {cfg.chests.map((c, i) => (
            <span key={c.id} className={cn('flex h-5 w-5 items-center justify-center rounded', i < r.opened ? 'bg-gold/20 text-warning dark:text-gold' : 'bg-surface-3 text-fg-3')} aria-hidden>
              {i < r.opened ? <PackageOpen size={12} /> : <Package size={12} />}
            </span>
          ))}
        </span>
      ),
    },
    {
      id: 'next',
      header: 'Próximo baú',
      minWidth: 180,
      sortValue: (r) => (r.next ? r.next.referrals - r.valid : -1),
      csv: (r) => (r.next ? `faltam ${r.next.referrals - Math.min(r.valid, cfg.maxReferrals || Infinity)}` : 'todos abertos'),
      cell: (r) => {
        if (!r.next) return <Badge tone="success">Todos abertos</Badge>
        const prev = [...cfg.chests].reverse().find((c) => c.referrals <= r.valid)?.referrals ?? 0
        return (
          <div className="w-40">
            <p className="mb-1 text-xs text-fg-3">
              faltam <strong className="text-fg">{r.next.referrals - r.valid}</strong> · {rewardShort(r.next, coin)}
            </p>
            <Progress value={r.valid - prev} max={Math.max(1, r.next.referrals - prev)} label={`Progresso de ${r.name}`} />
          </div>
        )
      },
    },
    { id: 'cost', money: true, header: 'Custo', align: 'right', sortValue: (r) => r.cost, csv: (r) => r.cost.toFixed(2), cell: (r) => <span className="tnum">{brl(r.cost)}</span> },
  ]
  return (
    <section aria-label="Quem mais indica" className="space-y-3">
      <div>
        <h2 className="text-[15px] font-semibold text-fg">Quem mais indica</h2>
        <p className="text-[13px] text-fg-3">Com as regras salvas{on ? '' : '. Programa desligado: nenhum baú é aberto'}.</p>
      </div>
      <DataTable
        caption="Jogadores que indicaram"
        rows={referrers}
        columns={columns}
        rowKey={(r) => r.referrerId}
        searchText={(r) => `${r.name} ${r.email} ${r.referrerId}`}
        searchPlaceholder="Buscar jogador"
        initialSort={{ id: 'valid', dir: 'desc' }}
        exportName="indicacao-indicadores"
        onExport={(n) => audit('exportar', 'Indicação · indicadores', `Exportação CSV de ${n} jogadores`)}
        empty={{ title: 'Ninguém indicou ainda', description: 'Os jogadores aparecem aqui quando um indicado se cadastrar pelo link.' }}
      />
    </section>
  )
}

