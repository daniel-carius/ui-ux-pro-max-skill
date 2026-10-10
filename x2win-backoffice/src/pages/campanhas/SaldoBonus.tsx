import { useMemo, useState } from 'react'
import { ArrowRight, Calculator, Globe, Info, ListChecks, ListX, RotateCcw, Wallet, X } from 'lucide-react'
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
  MoneyInput,
  NumberInput,
  PageHeader,
  PageLink,
  RadioCards,
  SaveBar,
  SettingsSection,
  useSettingsForm,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { brl, num } from '@/lib/format'
import { useGames, useProviders } from '@/data/hooks'
import {
  BONUS_WALLET_KEY,
  DEFAULT_BONUS_WALLET,
  bonusAppliesToGame,
  splitBet,
  validateBonusWallet,
  type BonusScope,
  type BonusWalletConfig,
  type RolloverCount,
  type SpendOrder,
} from '@/domain/campanhas-bonus'
import { CalcLine, GameMultiPicker, GamePicker } from './_shared-c1'

const SCOPE_TEXT: Record<BonusScope, string> = {
  todos: 'em todos os jogos',
  selecionados: 'só nos jogos selecionados',
  exceto: 'em todos os jogos, menos os selecionados',
}

function ruleSentence(v: BonusWalletConfig, count: number) {
  const where = v.scope === 'todos' ? SCOPE_TEXT.todos : `${SCOPE_TEXT[v.scope]} (${num(count)})`
  const order = v.order === 'bonus_primeiro' ? 'é gasto antes do saldo real' : 'só é gasto depois do saldo real'
  const roll = v.rolloverCount === 'aposta_inteira' ? 'a aposta inteira conta para o rollover' : 'só a parte paga com bônus conta para o rollover'
  return `O bônus vale ${where}, ${order} e ${roll}.`
}

const EXAMPLES = [
  { label: 'R$ 10 com R$ 6 bônus + R$ 4 real', bet: 10, bonus: 6, real: 4 },
  { label: 'Aposta alta com bônus', bet: 40, bonus: 120, real: 30 },
  { label: 'Bônus acabando', bet: 5, bonus: 1.5, real: 50 },
]

export default function SaldoBonus() {
  const form = useSettingsForm<BonusWalletConfig>(BONUS_WALLET_KEY, DEFAULT_BONUS_WALLET, {
    entity: 'Saldo bônus',
    validate: validateBonusWallet,
    successMessage: 'Regras do saldo bônus salvas',
  })
  const v = form.values
  const { items: games } = useGames()
  const { items: providers } = useProviders()
  const activeGames = useMemo(() => games.filter((g) => g.active), [games])
  const pickError = v.scope !== 'todos' && v.gameIds.length === 0 ? (v.scope === 'selecionados' ? 'Escolha pelo menos um jogo.' : 'Escolha pelo menos um jogo para excluir.') : null
  const validCount = activeGames.filter((g) => bonusAppliesToGame(v, g.id)).length

  const [ex, setEx] = useState<{ bet: number; bonus: number; real: number; gameId: string | null }>({ bet: 10, bonus: 6, real: 4, gameId: null })
  const split = splitBet(v, { bet: ex.bet, bonusBalance: ex.bonus, realBalance: ex.real, gameId: ex.gameId })
  const other = splitBet({ ...v, order: v.order === 'bonus_primeiro' ? 'real_primeiro' : 'bonus_primeiro' }, { bet: ex.bet, bonusBalance: ex.bonus, realBalance: ex.real, gameId: ex.gameId })
  const exGame = games.find((g) => g.id === ex.gameId)
  const excludedSample = v.scope === 'todos' ? undefined : activeGames.find((g) => !bonusAppliesToGame(v, g.id))

  return (
    <>
      <PageHeader />

      <Alert tone="info" icon={Wallet} className="mb-5" title="Regra em vigor">
        {ruleSentence(form.saved, form.saved.gameIds.length)}
        {form.saved.maxBetWithBonus > 0 && ` Com bônus em uso, cada aposta vai até ${brl(form.saved.maxBetWithBonus)}.`} O bônus expira em {form.saved.validityDays} dias.
      </Alert>

      <FormFieldset readOnly={form.readOnly}>
        <SettingsSection title="Onde o saldo bônus vale" description="Fora desses jogos o jogador só aposta com saldo real, e a aposta não conta para o rollover do bônus.">
          <RadioCards<BonusScope>
            name="Onde o saldo bônus vale"
            columns={3}
            value={v.scope}
            onChange={(s) => form.set('scope', s)}
            options={[
              { value: 'todos', label: 'Todos os jogos', description: 'Vale em qualquer jogo do cassino.', icon: Globe, badge: <Badge tone="primary">Padrão</Badge> },
              { value: 'selecionados', label: 'Só nos selecionados', description: 'Você escolhe onde o bônus vale.', icon: ListChecks },
              { value: 'exceto', label: 'Todos menos os selecionados', description: 'Você escolhe onde o bônus não vale.', icon: ListX },
            ]}
          />
          {v.scope !== 'todos' && (
            <Field
              label={v.scope === 'selecionados' ? 'Jogos onde o bônus vale' : 'Jogos onde o bônus não vale'}
              error={pickError}
              hint={`O bônus vale em ${num(validCount)} de ${num(activeGames.length)} jogos ativos.`}
            >
              <GameMultiPicker value={v.gameIds} onChange={(ids) => form.set('gameIds', ids)} games={games} providers={providers} disabled={form.readOnly} invalid={!!pickError} />
            </Field>
          )}
          {v.scope === 'todos' && v.gameIds.length > 0 && <p className="text-xs text-fg-3">A lista de {num(v.gameIds.length)} jogos fica guardada, mas não vale enquanto a opção for “Todos os jogos”.</p>}
        </SettingsSection>

        <SettingsSection title="Ordem de uso" description="Quando o jogador tem saldo real e bônus ao mesmo tempo, qual sai primeiro em cada aposta.">
          <RadioCards<SpendOrder>
            name="Ordem de uso"
            value={v.order}
            onChange={(o) => form.set('order', o)}
            options={[
              { value: 'bonus_primeiro', label: 'Bônus primeiro', description: 'Gasta o bônus e só depois o saldo real. O real fica disponível para saque por mais tempo.', badge: <Badge tone="primary">Padrão</Badge> },
              { value: 'real_primeiro', label: 'Saldo real primeiro', description: 'Gasta o real e só depois o bônus. O bônus dura mais, mas o jogador perde o real antes.' },
            ]}
          />
        </SettingsSection>

        <SettingsSection title="O que conta para o rollover" description="Quanto de cada aposta entra na meta do bônus. O peso do tipo de jogo é aplicado depois, em Campanhas › Rollover.">
          <RadioCards<RolloverCount>
            name="O que conta para o rollover"
            value={v.rolloverCount}
            onChange={(r) => form.set('rolloverCount', r)}
            options={[
              { value: 'aposta_inteira', label: 'A aposta inteira', description: 'Toda a aposta conta, mesmo a parte paga com saldo real.', badge: <Badge tone="primary">Padrão</Badge> },
              { value: 'parte_bonus', label: 'Só a parte paga com bônus', description: 'Só conta o que saiu do saldo bônus. O rollover anda mais devagar.' },
            ]}
          />
          <p className="text-xs text-fg-3">
            Pesos por tipo de jogo:{' '}
            <PageLink to="/campanhas/rollover" className="link">
              Campanhas › Rollover
            </PageLink>
          </p>
        </SettingsSection>

        <SettingsSection title="Limites" description="Protegem a casa contra quem tenta cumprir o rollover com poucas apostas altas.">
          <FormGrid>
            <Field label="Aposta máxima com bônus" htmlFor="sb-maxbet" hint={v.maxBetWithBonus > 0 ? `Com bônus em uso, apostas acima de ${brl(v.maxBetWithBonus)} são recusadas.` : 'R$ 0,00 = sem limite (não recomendado).'}>
              <MoneyInput id="sb-maxbet" value={v.maxBetWithBonus} onValueChange={(n) => form.set('maxBetWithBonus', n)} invalid={v.maxBetWithBonus < 0} />
            </Field>
            <Field label="Validade do bônus" htmlFor="sb-valid" error={v.validityDays < 1 || v.validityDays > 365 ? 'Entre 1 e 365 dias.' : null} hint="Bônus não convertido expira depois desse prazo.">
              <NumberInput integer id="sb-valid" value={v.validityDays} min={1} max={365} suffix="dias" onValueChange={(n) => form.set('validityDays', Math.round(n))} invalid={v.validityDays < 1 || v.validityDays > 365} />
            </Field>
          </FormGrid>
          {v.maxBetWithBonus === 0 && (
            <Alert tone="warning">Sem aposta máxima, um jogador pode apostar todo o bônus numa rodada de alto risco e cumprir o rollover em poucas jogadas.</Alert>
          )}
        </SettingsSection>
      </FormFieldset>

      <Card className="mt-5">
        <CardHeader
          icon={Calculator}
          title="Exemplo: como uma aposta é paga"
          description="Usa as regras da tela (mesmo antes de salvar). Nada é debitado."
          actions={
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setEx({ bet: 10, bonus: 6, real: 4, gameId: null })}>
              Limpar
            </Button>
          }
        />
        <CardBody className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Exemplos prontos">
              {EXAMPLES.map((e) => (
                <button
                  key={e.label}
                  type="button"
                  onClick={() => setEx((s) => ({ ...s, bet: e.bet, bonus: e.bonus, real: e.real }))}
                  className={cn(
                    'h-7 rounded-full border px-2.5 text-xs font-medium transition-colors',
                    ex.bet === e.bet && ex.bonus === e.bonus && ex.real === e.real ? 'border-primary bg-primary/10 text-primary-text' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg',
                  )}
                >
                  {e.label}
                </button>
              ))}
              {excludedSample && (
                <button type="button" onClick={() => setEx((s) => ({ ...s, gameId: excludedSample.id }))} className="h-7 rounded-full border border-line px-2.5 text-xs font-medium text-fg-2 hover:border-line-strong hover:text-fg">
                  Jogo fora da regra
                </button>
              )}
            </div>
            <FormGrid columns={3}>
              <Field label="Aposta" htmlFor="ex-bet">
                <MoneyInput id="ex-bet" value={ex.bet} onValueChange={(n) => setEx((s) => ({ ...s, bet: n }))} />
              </Field>
              <Field label="Saldo bônus" htmlFor="ex-bonus">
                <MoneyInput id="ex-bonus" value={ex.bonus} onValueChange={(n) => setEx((s) => ({ ...s, bonus: n }))} />
              </Field>
              <Field label="Saldo real" htmlFor="ex-real">
                <MoneyInput id="ex-real" value={ex.real} onValueChange={(n) => setEx((s) => ({ ...s, real: n }))} />
              </Field>
            </FormGrid>
            <Field
              label="Jogo"
              htmlFor="ex-game"
              hint={exGame ? (bonusAppliesToGame(v, exGame.id) ? 'O bônus vale neste jogo.' : 'O bônus não vale neste jogo.') : 'Opcional. Sem jogo, considera um jogo onde o bônus vale.'}
              labelAside={
                ex.gameId ? (
                  <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-fg-2 hover:text-fg" onClick={() => setEx((s) => ({ ...s, gameId: null }))}>
                    <X size={12} aria-hidden /> Limpar
                  </button>
                ) : undefined
              }
            >
              <GamePicker id="ex-game" value={ex.gameId} onChange={(g) => setEx((s) => ({ ...s, gameId: g }))} games={activeGames} providers={providers} placeholder="Qualquer jogo onde o bônus vale" />
            </Field>
          </div>

          <div className="rounded-xl border border-line p-4" aria-live="polite">
            <p className="text-[13px] leading-5 text-fg-2">
              Aposta de <strong className="text-fg">{brl(ex.bet)}</strong> com saldo <strong className="text-fg">{brl(ex.bonus)}</strong> bônus + <strong className="text-fg">{brl(ex.real)}</strong> real
              {exGame ? ` em ${exGame.name}` : ''}
              <ArrowRight size={13} className="mx-1 inline text-fg-3" aria-hidden />
              {split.ok ? (
                <>
                  sai <strong className="text-fg">{brl(split.fromBonus)}</strong> do bônus e <strong className="text-fg">{brl(split.fromReal)}</strong> do real.
                </>
              ) : (
                <strong className="text-danger">aposta recusada.</strong>
              )}
            </p>

            {split.ok ? (
              <>
                <div className="mt-4 flex h-9 w-full overflow-hidden rounded-lg bg-surface-3 text-xs font-semibold" role="img" aria-label={`${brl(split.fromBonus)} do bônus e ${brl(split.fromReal)} do saldo real`}>
                  {split.fromBonus > 0 && (
                    <div className="flex items-center justify-center overflow-hidden whitespace-nowrap px-2 text-fg" style={{ width: `${(split.fromBonus / ex.bet) * 100}%`, background: 'color-mix(in srgb, var(--chart-4) 45%, transparent)' }}>
                      Bônus {brl(split.fromBonus)}
                    </div>
                  )}
                  {split.fromReal > 0 && (
                    <div className="flex items-center justify-center overflow-hidden whitespace-nowrap px-2 text-fg" style={{ width: `${(split.fromReal / ex.bet) * 100}%`, background: 'color-mix(in srgb, var(--chart-1) 40%, transparent)' }}>
                      Real {brl(split.fromReal)}
                    </div>
                  )}
                </div>
                <div className="mt-4">
                  <CalcLine label="Saldo bônus depois" value={brl(split.bonusAfter)} />
                  <CalcLine label="Saldo real depois" value={brl(split.realAfter)} />
                  <CalcLine
                    label="Conta para o rollover do bônus"
                    value={brl(split.countsForRollover)}
                    strong
                    tone={split.countsForRollover > 0 ? 'success' : undefined}
                  />
                </div>
                <p className="mt-2 text-xs text-fg-3">
                  {!split.bonusAllowed
                    ? 'O bônus não vale neste jogo: a aposta usa só saldo real e não anda o rollover.'
                    : ex.bonus <= 0
                      ? 'Sem saldo bônus, não há rollover de bônus para andar.'
                      : v.rolloverCount === 'aposta_inteira'
                        ? 'A aposta inteira conta (regra padrão). O peso do tipo de jogo ainda se aplica.'
                        : 'Só a parte paga com bônus conta. O peso do tipo de jogo ainda se aplica.'}
                </p>
                {other.ok && split.bonusAllowed && (other.fromBonus !== split.fromBonus || other.fromReal !== split.fromReal) && (
                  <p className="mt-3 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg-2">
                    <Info size={13} className="mt-0.5 shrink-0 text-fg-3" aria-hidden />
                    Com “{v.order === 'bonus_primeiro' ? 'saldo real primeiro' : 'bônus primeiro'}”, sairia {brl(other.fromBonus)} do bônus e {brl(other.fromReal)} do real.
                  </p>
                )}
              </>
            ) : (
              <Alert tone="danger" className="mt-4">
                {split.reason}
              </Alert>
            )}
          </div>
        </CardBody>
      </Card>

      <SaveBar form={form} label="Salvar regras" />
    </>
  )
}
