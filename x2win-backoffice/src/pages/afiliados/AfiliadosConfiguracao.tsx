import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { ArrowDownUp, CalendarClock, Check, CalendarDays, Gamepad2, HandCoins, Landmark, QrCode, Repeat, Smartphone, TriangleAlert, Wallet } from 'lucide-react'
import {
  Alert,
  Badge,
  Field,
  FormFieldset,
  FormGrid,
  MoneyInput,
  NumberInput,
  PageHeader,
  RadioCards,
  SaveBar,
  Select,
  SettingsSection,
  Switch,
  useSettingsForm,
} from '@/components/ui'
import { brl, date } from '@/lib/format'
import { cn } from '@/lib/cn'
import { NOW } from '@/data/now'
import { PAYOUT_METHOD_LABEL, type PayoutMethod } from '@/data/afiliados'
import {
  AFILIADOS_KEYS,
  DEFAULT_PROGRAM_CONFIG,
  MONTHS,
  addBusinessDays,
  firstError,
  nextClosing,
  useAffiliateWithdrawals,
  validateProgramConfig,
  type CommissionWallet,
  type ProgramConfig,
} from '@/domain/afiliados'
import { METHOD_ICON } from './_shared'

const METHOD_DESC: Record<PayoutMethod, string> = {
  pix: 'Na hora, para a chave cadastrada no portal.',
  ted: 'Para conta bancária do titular. Cai em até 1 dia útil.',
  saldo: 'Vira saldo no jogo do afiliado, sem sair da casa.',
}

const METHODS: PayoutMethod[] = ['pix', 'ted', 'saldo']

export default function AfiliadosConfiguracao() {
  const form = useSettingsForm<ProgramConfig>(AFILIADOS_KEYS.config, DEFAULT_PROGRAM_CONFIG, {
    entity: 'Programa de afiliados',
    successMessage: 'Regras do programa salvas',
    validate: (v) => firstError(validateProgramConfig(v)),
  })
  const v: ProgramConfig = { ...DEFAULT_PROGRAM_CONFIG, ...form.values }
  const e = validateProgramConfig(v)
  const { items: withdrawals } = useAffiliateWithdrawals()
  const pending = withdrawals.filter((w) => w.status === 'pendente')
  const outOfLimits = pending.filter((w) => w.amount < v.minWithdrawal || w.amount > v.maxWithdrawal)
  const methodOff = pending.filter((w) => !v.methods.includes(w.method))

  const toggleMethod = (m: PayoutMethod, on: boolean) =>
    form.set('methods', on ? METHODS.filter((x) => x === m || v.methods.includes(x)) : v.methods.filter((x) => x !== m))

  const closing = nextClosing(v.closingDay)
  const closingMonth = MONTHS[(closing.getMonth() + 11) % 12]
  const payBy = addBusinessDays(NOW, v.payoutDays)

  return (
    <>
      <PageHeader />
      <div className="space-y-5">
        <FormFieldset readOnly={form.readOnly}>
          <SettingsSection
            title="Programa"
            description="Limites de saque, onde a comissão é creditada e se ela exige rollover. Vale para todos os afiliados, de qualquer tipo."
          >
            <FormGrid>
              <Field label="Saque mínimo" htmlFor="cfg-min" required error={e.minWithdrawal ?? null} hint="Abaixo disso o afiliado não consegue pedir saque.">
                <MoneyInput id="cfg-min" value={v.minWithdrawal} onValueChange={(n) => form.set('minWithdrawal', n)} invalid={!!e.minWithdrawal} />
              </Field>
              <Field
                label="Saque máximo por pedido"
                htmlFor="cfg-max"
                required
                error={e.maxWithdrawal ?? null}
                hint="Valores maiores precisam ser divididos em mais pedidos."
              >
                <MoneyInput id="cfg-max" value={v.maxWithdrawal} onValueChange={(n) => form.set('maxWithdrawal', n)} invalid={!!e.maxWithdrawal} />
              </Field>
            </FormGrid>
            {outOfLimits.length > 0 && !e.maxWithdrawal && !e.minWithdrawal && (
              <Alert tone="warning" icon={TriangleAlert}>
                Com estes limites,{' '}
                {outOfLimits.length === 1
                  ? '1 pedido pendente fica fora das regras e aparece'
                  : `${outOfLimits.length} pedidos pendentes ficam fora das regras e aparecem`}{' '}
                com aviso em{' '}
                <Link to="/system/programa-afiliados/saques" className="link">
                  Saques de afiliados
                </Link>
                .
              </Alert>
            )}

            <Field label="Carteira da comissão">
              <RadioCards<CommissionWallet>
                name="Carteira da comissão"
                value={v.wallet}
                onChange={(w) => form.set('wallet', w)}
                options={[
                  {
                    value: 'afiliado',
                    label: 'Carteira de afiliado separada',
                    icon: Wallet,
                    description: 'A comissão fica fora do saldo de jogo. O afiliado pede saque pelas formas abaixo.',
                  },
                  {
                    value: 'jogo',
                    label: 'Carteira do jogo',
                    icon: Gamepad2,
                    description: 'A comissão cai direto no saldo do jogo do afiliado, junto com o que ele deposita.',
                  },
                ]}
              />
            </Field>

            <Switch
              label="Bônus com rollover"
              description="A comissão creditada no jogo entra como saldo bônus e só vira saldo sacável depois de apostada o número de vezes abaixo."
              checked={v.bonusWithRollover}
              onChange={(on) => form.patch({ bonusWithRollover: on, bonusRollover: on && v.bonusRollover < 1 ? 1 : v.bonusRollover })}
            />
            <Field
              label="Rollover do bônus"
              htmlFor="cfg-roll"
              error={e.bonusRollover ?? null}
              hint={
                v.bonusWithRollover
                  ? `Com ${v.bonusRollover.toLocaleString('pt-BR')}x, ${brl(100)} de comissão exigem ${brl(100 * v.bonusRollover)} em apostas antes do saque.`
                  : 'Desligado: ligue “Bônus com rollover” para exigir apostas.'
              }
              className="sm:max-w-xs"
            >
              <NumberInput
                id="cfg-roll"
                value={v.bonusRollover}
                onValueChange={(n) => form.set('bonusRollover', n)}
                min={0}
                max={100}
                step={0.5}
                suffix="x"
                disabled={!v.bonusWithRollover || form.readOnly}
                invalid={!!e.bonusRollover}
              />
            </Field>
            {v.wallet === 'jogo' && !v.bonusWithRollover && (
              <Alert tone="warning" title="Comissão no jogo sem rollover">
                O afiliado pode sacar a comissão na hora como saldo real, pelas regras de saque de jogador, sem passar pelos limites e pela fila deste programa.
              </Alert>
            )}
          </SettingsSection>

          <SettingsSection
            title="Saques das comissões"
            description="Como e quando a comissão é paga. O fechamento apura a comissão do mês anterior e libera para saque."
          >
            <Field label="Formas de pagamento" error={e.methods ?? null} required>
              <div className="grid gap-2.5 sm:grid-cols-3" role="group" aria-label="Formas de pagamento">
                {METHODS.map((m) => {
                  const on = v.methods.includes(m)
                  const Icon = METHOD_ICON[m]
                  return (
                    <button
                      key={m}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggleMethod(m, !on)}
                      className={cn(
                        'flex items-start gap-3 rounded-xl border p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-150',
                        'disabled:cursor-not-allowed disabled:opacity-60',
                        on ? 'border-primary bg-primary/5 shadow-ring' : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2',
                        e.methods && 'border-danger',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                          on ? 'bg-primary text-primary-fg' : 'bg-surface-3 text-fg-2',
                        )}
                      >
                        <Icon size={16} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-fg">{PAYOUT_METHOD_LABEL[m]}</span>
                        <span className="mt-0.5 block text-[13px] leading-5 text-fg-3">{METHOD_DESC[m]}</span>
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border',
                          on ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong',
                        )}
                      >
                        {on && <Check size={12} strokeWidth={3} />}
                      </span>
                    </button>
                  )
                })}
              </div>
            </Field>
            {methodOff.length > 0 && !e.methods && (
              <Alert tone="info">
                {methodOff.length} {methodOff.length === 1 ? 'pedido pendente usa' : 'pedidos pendentes usam'} uma forma desligada. Eles continuam na fila e
                podem ser pagos ou recusados.
              </Alert>
            )}
            <FormGrid>
              <Field
                label="Prazo de pagamento"
                htmlFor="cfg-days"
                required
                error={e.payoutDays ?? null}
                hint={`Pedido feito hoje é pago até ${date(payBy)}. Não considera feriados.`}
              >
                <NumberInput
                  id="cfg-days"
                  value={v.payoutDays}
                  onValueChange={(n) => form.set('payoutDays', Math.round(n))}
                  min={1}
                  max={30}
                  suffix="dias úteis"
                  invalid={!!e.payoutDays}
                />
              </Field>
              <Field
                label="Dia de fechamento"
                htmlFor="cfg-close"
                required
                error={e.closingDay ?? null}
                hint={`Próximo: ${date(closing)}, com a comissão de ${closingMonth}.`}
              >
                <Select
                  id="cfg-close"
                  value={String(v.closingDay)}
                  onChange={(x) => form.set('closingDay', Number(x))}
                  options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `Todo dia ${i + 1}` }))}
                />
              </Field>
            </FormGrid>
          </SettingsSection>
        </FormFieldset>

        <SettingsSection
          title="Como o afiliado vê"
          description="Resumo das regras exibido no portal do afiliado, montado com os valores da tela (inclusive os ainda não salvos)."
          aside={form.dirty ? <Badge tone="warning">Rascunho não salvo</Badge> : <Badge tone="success">Igual ao que está no ar</Badge>}
        >
          <div className="overflow-hidden rounded-2xl border border-line bg-bg">
            <div className="flex items-center gap-2.5 border-b border-line bg-surface px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-fg">
                <HandCoins size={16} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">Portal do afiliado X2Win</p>
                <p className="text-xs text-fg-3">Regras de comissão e saque</p>
              </div>
              <Smartphone size={16} className="ml-auto text-fg-3" aria-hidden />
            </div>
            <ul className="space-y-3 p-4">
              <Rule icon={v.wallet === 'jogo' ? Gamepad2 : Wallet}>
                {v.wallet === 'jogo' ? (
                  <>
                    Sua comissão cai no <strong>saldo do seu jogo</strong>.
                  </>
                ) : (
                  <>
                    Sua comissão fica na <strong>carteira de afiliado</strong>, separada do saldo de jogo.
                  </>
                )}
              </Rule>
              {v.bonusWithRollover && (
                <Rule icon={Repeat}>
                  Comissão creditada no jogo entra como bônus: aposte <strong>{v.bonusRollover.toLocaleString('pt-BR')}x</strong> o valor para liberar o saque.
                </Rule>
              )}
              <Rule icon={ArrowDownUp}>
                Saque a partir de <strong>{brl(v.minWithdrawal)}</strong> e até <strong>{brl(v.maxWithdrawal)}</strong> por pedido.
              </Rule>
              <Rule icon={v.methods.includes('pix') ? QrCode : v.methods.includes('ted') ? Landmark : Gamepad2}>
                {v.methods.length ? (
                  <>
                    Receba por <strong>{listPt(v.methods.map((m) => (m === 'saldo' ? 'crédito no saldo do jogo' : PAYOUT_METHOD_LABEL[m])))}</strong>.
                  </>
                ) : (
                  <span className="text-danger">Nenhuma forma de pagamento ligada: o afiliado não consegue sacar.</span>
                )}
              </Rule>
              <Rule icon={CalendarClock}>
                Pagamento em até{' '}
                <strong>
                  {v.payoutDays} {v.payoutDays === 1 ? 'dia útil' : 'dias úteis'}
                </strong>{' '}
                depois do pedido.
              </Rule>
              <Rule icon={CalendarDays}>
                Fechamento todo dia <strong>{v.closingDay}</strong>: a comissão do mês anterior é liberada para saque. Próximo em{' '}
                <strong>{date(closing)}</strong>.
              </Rule>
            </ul>
          </div>
        </SettingsSection>
      </div>
      <SaveBar form={form} label="Salvar alterações" />
    </>
  )
}

function Rule({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-text">
        <Icon size={14} aria-hidden />
      </span>
      <p className="pt-1 text-[13px] leading-5 text-fg-2 [&_strong]:font-semibold [&_strong]:text-fg">{children}</p>
    </li>
  )
}

function listPt(items: string[]) {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} ou ${items[items.length - 1]}`
}
