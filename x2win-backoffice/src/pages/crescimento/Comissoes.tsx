import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calculator, CheckCircle2, Coins, Info, Percent, RotateCcw, Save, TriangleAlert } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  FormFieldset,
  FormGrid,
  Input,
  MoneyInput,
  NumberInput,
  PageHeader,
  RadioCards,
  Segmented,
  toast,
} from '@/components/ui'
import { brl, dateTime, num, relative } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useDb } from '@/lib/store'
import { useAffiliates } from '@/data/hooks'
import type { AffiliateType } from '@/data/players'
import { audit, usePageAccess, useSession } from '@/domain/session'
import {
  AFFILIATE_TYPES,
  AFILIADOS_KEYS,
  DEFAULT_COMMISSION_RULES,
  REVSHARE_WARN_PCT,
  commissionFor,
  describeRule,
  pctLabel,
  sameRule,
  validateCommissionRule,
  type CommissionModel,
  type CommissionRule,
  type CommissionRules,
} from '@/domain/afiliados'
import { MiniBar, OptionalMoneyInput, TYPE_ICON_CLASS, TYPE_META } from '@/pages/afiliados/_shared'

type SimPreset = 'pequeno' | 'medio' | 'grande' | 'livre'
const SIM_PRESETS: Record<Exclude<SimPreset, 'livre'>, { depositors: number; ggr: number }> = {
  pequeno: { depositors: 8, ggr: 3200 },
  medio: { depositors: 35, ggr: 21000 },
  grande: { depositors: 140, ggr: 96000 },
}

export default function Comissoes() {
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  const { items: affiliates } = useAffiliates()
  const [stored, setStored] = useDb<CommissionRules>(AFILIADOS_KEYS.commissions, DEFAULT_COMMISSION_RULES)
  // garante as três chaves mesmo se o valor salvo for de uma versão antiga
  const saved = useMemo<CommissionRules>(() => ({ ...DEFAULT_COMMISSION_RULES, ...stored }), [stored])
  const [drafts, setDrafts] = useState<CommissionRules>(saved)
  const [saving, setSaving] = useState<AffiliateType | null>(null)
  const [sim, setSim] = useState({ depositors: SIM_PRESETS.medio.depositors, ggr: SIM_PRESETS.medio.ggr })
  const [preset, setPreset] = useState<SimPreset>('medio')

  // quando um bloco é salvo (aqui ou em outra aba), só ele volta ao valor salvo
  const prevSaved = useRef(saved)
  useEffect(() => {
    const prev = prevSaved.current
    prevSaved.current = saved
    setDrafts((d) => {
      const next = { ...d }
      for (const t of AFFILIATE_TYPES) if (!sameRule(prev[t], saved[t]) || prev[t].updatedAt !== saved[t].updatedAt) next[t] = saved[t]
      return next
    })
  }, [saved])

  const counts = useMemo(() => {
    const c = Object.fromEntries(AFFILIATE_TYPES.map((t) => [t, { total: 0, active: 0 }])) as Record<AffiliateType, { total: number; active: number }>
    for (const a of affiliates) {
      c[a.type].total++
      if (a.status === 'ativo') c[a.type].active++
    }
    return c
  }, [affiliates])

  const setDraft = (t: AffiliateType, patch: Partial<CommissionRule>) => setDrafts((d) => ({ ...d, [t]: { ...d[t], ...patch } }))

  const save = (t: AffiliateType) => {
    if (!canEdit) {
      toast.error('Seu cargo não pode editar comissões.')
      return
    }
    const draft = drafts[t]
    const errors = validateCommissionRule(draft)
    if (errors.value || errors.cap) {
      toast.error(`Revise a comissão de ${TYPE_META[t].label}`, { description: errors.value ?? errors.cap })
      return
    }
    setSaving(t)
    setTimeout(() => {
      const before = saved[t]
      const next: CommissionRule = { model: draft.model, value: draft.value, cap: draft.cap, updatedAt: new Date().toISOString(), updatedBy: user.name }
      setStored((prev) => ({ ...DEFAULT_COMMISSION_RULES, ...prev, [t]: next }))
      audit('editar', `Comissão ${TYPE_META[t].label}`, `${describeRule(before)} → ${describeRule(next)}`)
      setSaving(null)
      toast.success(`Comissão de ${TYPE_META[t].label} salva`, { description: `${describeRule(next)}. Vale a partir do próximo fechamento.` })
    }, 400)
  }

  const results = AFFILIATE_TYPES.map((t) => ({ type: t, rule: drafts[t], ...commissionFor(drafts[t], sim) }))
  const maxResult = Math.max(1, ...results.map((r) => r.final))

  return (
    <>
      <PageHeader />

      <div className="space-y-5">
        <Alert tone="info" title="Regra padrão por tipo de afiliado">
          Cada bloco tem o próprio botão “Salvar” e vale para os afiliados daquele tipo sem contrato próprio. Contratos individuais de gerentes ficam em{' '}
          <Link to="/system/programa-afiliados/gerentes" className="link">
            Programa de afiliados › Gerentes
          </Link>
          . A mudança vale a partir do próximo fechamento; o que já foi apurado não muda.
        </Alert>

        <FormFieldset readOnly={!canEdit}>
          {AFFILIATE_TYPES.map((t) => (
            <CommissionBlock
              key={t}
              type={t}
              draft={drafts[t]}
              saved={saved[t]}
              count={counts[t]}
              canEdit={canEdit}
              saving={saving === t}
              onChange={(p) => setDraft(t, p)}
              onReset={() => setDrafts((d) => ({ ...d, [t]: saved[t] }))}
              onSave={() => save(t)}
            />
          ))}
        </FormFieldset>

        <Card>
          <CardHeader
            icon={Calculator}
            title="Simulador de comissão"
            description="Quanto um afiliado de cada tipo receberia num fechamento. Usa os valores da tela, inclusive os ainda não salvos."
            actions={
              <Button
                size="sm"
                variant="ghost"
                icon={RotateCcw}
                onClick={() => {
                  setSim(SIM_PRESETS.medio)
                  setPreset('medio')
                }}
              >
                Limpar
              </Button>
            }
          />
          <CardBody className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <div className="space-y-4">
              <Field label="Cenário">
                <Segmented<SimPreset>
                  ariaLabel="Cenário do simulador"
                  value={preset}
                  onChange={(p) => {
                    setPreset(p)
                    if (p !== 'livre') setSim(SIM_PRESETS[p])
                  }}
                  options={[
                    { value: 'pequeno', label: 'Pequeno' },
                    { value: 'medio', label: 'Médio' },
                    { value: 'grande', label: 'Grande' },
                    { value: 'livre', label: 'Livre' },
                  ]}
                  className="flex w-full [&>button]:flex-1 [&>button]:justify-center"
                />
              </Field>
              <FormGrid columns={1}>
                <Field label="Depositantes no mês (FTD)" htmlFor="sim-dep" hint="Indicados que fizeram o primeiro depósito. Base do CPA.">
                  <NumberInput
                    id="sim-dep"
                    value={sim.depositors}
                    min={0}
                    suffix="jogadores"
                    onValueChange={(n) => {
                      setSim((s) => ({ ...s, depositors: Math.max(0, Math.round(n)) }))
                      setPreset('livre')
                    }}
                  />
                </Field>
                <Field
                  label="GGR dos indicados no mês"
                  htmlFor="sim-ggr"
                  hint="Apostado − pago aos indicados. Pode ser negativo: aí o Rev Share não paga nada."
                >
                  <Input
                    id="sim-ggr"
                    prefix="R$"
                    type="number"
                    inputMode="decimal"
                    step={100}
                    value={Number.isFinite(sim.ggr) ? sim.ggr : ''}
                    onChange={(e) => {
                      setSim((s) => ({ ...s, ggr: e.target.value === '' ? 0 : Number(e.target.value) }))
                      setPreset('livre')
                    }}
                    className="tnum"
                  />
                </Field>
              </FormGrid>
            </div>

            <div aria-live="polite" className="min-w-0">
              <ul className="space-y-3">
                {results.map((r) => {
                  const meta = TYPE_META[r.type]
                  const house = sim.ggr - r.final
                  return (
                    <li key={r.type} className="rounded-xl border border-line p-3.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TYPE_ICON_CLASS[r.type])}>
                            <meta.icon size={16} aria-hidden />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-fg">{meta.label}</p>
                            <p className="truncate text-xs text-fg-3">
                              {r.formula}
                              {r.capped && <> = {brl(r.gross)}, limitado pelo teto</>}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-display text-xl font-bold text-fg tnum">{brl(r.final)}</p>
                          <p className={cn('text-xs tnum', house >= 0 ? 'text-fg-3' : 'font-semibold text-danger')}>casa fica com {brl(house)}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <MiniBar value={r.final} max={maxResult} slot={meta.slot} label={`Comissão de ${meta.label}: ${brl(r.final)}`} />
                        {r.capped && (
                          <Badge tone="warning" icon={TriangleAlert} className="shrink-0">
                            teto aplicado
                          </Badge>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-fg-3">
                <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
                GGR negativo não vira dívida do afiliado: o Rev Share do mês fica zerado e o mês seguinte começa do zero.
              </p>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  )
}

function CommissionBlock({
  type,
  draft,
  saved,
  count,
  canEdit,
  saving,
  onChange,
  onReset,
  onSave,
}: {
  type: AffiliateType
  draft: CommissionRule
  saved: CommissionRule
  count: { total: number; active: number }
  canEdit: boolean
  saving: boolean
  onChange: (p: Partial<CommissionRule>) => void
  onReset: () => void
  onSave: () => void
}) {
  const meta = TYPE_META[type]
  const dirty = !sameRule(draft, saved)
  const errors = validateCommissionRule(draft)
  const invalid = !!(errors.value || errors.cap)
  const id = `com-${type.toLowerCase()}`
  const example = draft.model === 'cpa' ? commissionFor(draft, { depositors: 10, ggr: 0 }) : commissionFor(draft, { depositors: 0, ggr: 10000 })

  const setModel = (m: CommissionModel) => {
    if (m === draft.model) return
    onChange({ model: m, value: m === saved.model ? saved.value : m === 'cpa' ? 50 : 20 })
  }

  return (
    <Card className={cn('transition-[border-color,box-shadow] duration-150', dirty && 'border-warning/50')}>
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)] lg:gap-8">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', TYPE_ICON_CLASS[type])}>
              <meta.icon size={20} aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-fg">{meta.label}</h2>
              <p className="text-xs text-fg-3 tnum">
                {num(count.total)} {count.total === 1 ? 'afiliado' : 'afiliados'} · {num(count.active)} {count.active === 1 ? 'ativo' : 'ativos'}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[13px] leading-5 text-fg-3">{meta.description}</p>
          <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">Em vigor</p>
            <p className="mt-0.5 text-[13px] font-medium text-fg">{describeRule(saved)}</p>
            {saved.updatedAt && (
              <p className="mt-0.5 text-xs text-fg-3" title={dateTime(saved.updatedAt)}>
                por {saved.updatedBy} · {relative(saved.updatedAt)}
              </p>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          <Field label="Modelo de comissão">
            <RadioCards<CommissionModel>
              name={`Modelo de comissão ${meta.label}`}
              value={draft.model}
              onChange={setModel}
              disabled={!canEdit}
              options={[
                { value: 'cpa', label: 'Fixo (CPA)', icon: Coins, description: 'Valor fixo por indicado que faz o primeiro depósito.' },
                { value: 'revshare', label: 'Percentual (Rev Share)', icon: Percent, description: 'Parte do GGR que os indicados geram para a casa.' },
              ]}
            />
          </Field>
          <FormGrid>
            <Field
              label={draft.model === 'cpa' ? 'Valor por depositante' : 'Percentual do GGR'}
              htmlFor={`${id}-value`}
              required
              error={errors.value ?? null}
              hint={draft.model === 'cpa' ? 'Pago uma vez por jogador, no primeiro depósito.' : 'Calculado sobre o GGR do mês dos indicados.'}
            >
              {draft.model === 'cpa' ? (
                <MoneyInput id={`${id}-value`} value={draft.value} onValueChange={(n) => onChange({ value: n })} invalid={!!errors.value} />
              ) : (
                <NumberInput
                  id={`${id}-value`}
                  value={draft.value}
                  onValueChange={(n) => onChange({ value: n })}
                  min={0}
                  max={100}
                  step={0.5}
                  suffix="%"
                  invalid={!!errors.value}
                />
              )}
            </Field>
            <Field
              label="Teto por mês"
              htmlFor={`${id}-cap`}
              error={errors.cap ?? null}
              hint="Vazio = sem teto. Limita a comissão de cada afiliado por fechamento."
            >
              <OptionalMoneyInput id={`${id}-cap`} value={draft.cap} onChange={(v) => onChange({ cap: v })} invalid={!!errors.cap} disabled={!canEdit} />
            </Field>
          </FormGrid>

          {!errors.value && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed border-line-strong px-3 py-2 text-[13px] text-fg-2">
              <span className="text-fg-3">Exemplo:</span>
              {draft.model === 'cpa' ? <>10 depositantes</> : <>{brl(10000)} de GGR</>}
              <span className="text-fg-3" aria-hidden>
                →
              </span>
              <strong className="text-fg tnum">{brl(example.final)}</strong>
              {example.capped && <Badge tone="warning">limitado a {brl(draft.cap ?? 0)}</Badge>}
              {draft.cap === null && <span className="text-xs text-fg-3">(sem teto)</span>}
            </div>
          )}
          {draft.model === 'revshare' && draft.value > REVSHARE_WARN_PCT && draft.value <= 100 && (
            <Alert tone="warning">
              Rev Share acima de {pctLabel(REVSHARE_WARN_PCT)} costuma deixar a casa no prejuízo depois de bônus, free spins e taxas de pagamento.
            </Alert>
          )}
        </div>
      </div>
      <CardFooter className="justify-between">
        <p className="flex items-center gap-1.5 text-[13px] text-fg-3" aria-live="polite">
          {dirty ? (
            <>
              <span className="h-2 w-2 rounded-full bg-warning" aria-hidden /> Alterações não salvas em {meta.label}
            </>
          ) : (
            <>
              <CheckCircle2 size={14} className="text-success" aria-hidden /> Tudo salvo
            </>
          )}
        </p>
        <div className="flex gap-2">
          {dirty && (
            <Button variant="ghost" icon={RotateCcw} onClick={onReset} disabled={saving}>
              Descartar
            </Button>
          )}
          <Button
            variant="primary"
            icon={Save}
            onClick={onSave}
            loading={saving}
            disabled={!canEdit || !dirty || invalid}
            title={
              !canEdit
                ? 'Seu cargo pode ver, mas não editar comissões'
                : !dirty
                  ? 'Nada mudou neste bloco'
                  : invalid
                    ? 'Corrija os campos destacados'
                    : undefined
            }
          >
            Salvar
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
