import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AtSign,
  BadgeCheck,
  CalendarDays,
  Camera,
  Check,
  Clock,
  FileCheck2,
  FileWarning,
  IdCard,
  LockKeyhole,
  MapPin,
  ScanFace,
  ShieldAlert,
  UserPlus,
  Wallet,
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
  Input,
  KpiCard,
  MoneyInput,
  PageHeader,
  RadioCards,
  SaveBar,
  confirm,
  useSettingsForm,
} from '@/components/ui'
import { BrandMark } from '@/components/layout/Brand'
import { brl, num, pct } from '@/lib/format'
import { cn } from '@/lib/cn'
import { NOW, dayKey } from '@/data/now'
import { usePlayerCounts } from '@/domain/config1-metricas'
import { audit } from '@/domain/session'
import {
  DEFAULT_SIGNUP,
  DOC_META,
  FIELD_META,
  MIN_AGE,
  SIGNUP_KEY,
  checkSignupAge,
  signupRisks,
  validateSignup,
  type KycDocument,
  type KycMoment,
  type SignupConfig,
  type SignupField,
} from '@/domain/config1-cadastro'
import { PhoneFrame } from './_shared-f'

const FIELDS: SignupField[] = ['cpf', 'birthDate', 'phone', 'address', 'emailConfirm', 'marketingOptIn']
const DOCS: { id: KycDocument; icon: LucideIcon }[] = [
  { id: 'photoId', icon: IdCard },
  { id: 'selfie', icon: ScanFace },
  { id: 'proofOfAddress', icon: MapPin },
]

const MOMENT_LABEL: Record<KycMoment, string> = {
  cadastro: 'no cadastro',
  primeiro_saque: 'antes do 1º saque',
  valor_depositado: 'ao atingir o valor depositado',
}

export default function Cadastro() {
  const form = useSettingsForm<SignupConfig>(SIGNUP_KEY, DEFAULT_SIGNUP, {
    entity: 'Cadastro e KYC',
    successMessage: 'Regras de cadastro salvas',
    validate: validateSignup,
    onSaved: (next, prev) => {
      if (prev.required.birthDate && !next.required.birthDate)
        audit('desligar', 'Cadastro · data de nascimento', `Data de nascimento passou a opcional: idade mínima de ${MIN_AGE} anos não é verificada no cadastro (achado nº 8)`)
      if (!prev.required.birthDate && next.required.birthDate) audit('ligar', 'Cadastro · data de nascimento', 'Data de nascimento voltou a ser obrigatória no cadastro')
    },
  })
  const v = form.values
  const risks = signupRisks(v)
  // modo API: contagens prontas do servidor (geral.jogadores.metricas); a tela não lê a base
  const counts = usePlayerCounts()
  const totalPlayers = counts.total
  const kyc = {
    ok: counts.kyc.verificado,
    pending: counts.kyc.pendente,
    none: counts.kyc.nao_enviado,
    failed: counts.kyc.reprovado,
  }

  const setRequired = async (f: SignupField, val: boolean) => {
    if (f === 'birthDate' && !val) {
      const ok = await confirm({
        title: 'Deixar a data de nascimento opcional?',
        description: `Sem a data de nascimento, a idade mínima de ${MIN_AGE} anos não é verificada no cadastro (Lei 14.790/2023). Um menor de idade poderia criar conta e depositar antes do KYC.`,
        confirmLabel: 'Deixar opcional mesmo assim',
        tone: 'danger',
        icon: ShieldAlert,
        typeToConfirm: 'OPCIONAL',
      })
      if (!ok) return
    }
    form.setValues((p) => ({ ...p, required: { ...p.required, [f]: val } }))
  }
  const setDoc = (d: KycDocument, val: boolean) => form.setValues((p) => ({ ...p, documents: { ...p.documents, [d]: val } }))
  const noDocs = !Object.values(v.documents).some(Boolean)

  return (
    <>
      <PageHeader />

      <section aria-label="Situação do KYC dos jogadores" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="KYC verificado" icon={BadgeCheck} tone="success" value={pct(totalPlayers ? kyc.ok / totalPlayers : 0, 0)} hint={`${num(kyc.ok)} de ${num(totalPlayers)} jogadores`} />
        <KpiCard label="Em análise" icon={Clock} tone="warning" value={num(kyc.pending)} hint="documentos aguardando revisão" />
        <KpiCard label="Sem documento" icon={FileWarning} tone="neutral" value={num(kyc.none)} hint={`KYC pedido ${MOMENT_LABEL[form.saved.kycMoment]}`} />
        <KpiCard label="Reprovados" icon={ShieldAlert} tone="danger" value={num(kyc.failed)} hint="documento ou selfie recusados" />
      </section>

      {risks.length > 0 && (
        <div className="mb-5 space-y-3">
          {risks.map((r) => (
            <Alert
              key={r.title}
              tone={r.tone}
              title={r.title}
              action={
                r.tone === 'danger' && !v.required.birthDate && !form.readOnly ? (
                  <Button size="sm" variant="danger" icon={CalendarDays} onClick={() => setRequired('birthDate', true)}>
                    Voltar a exigir
                  </Button>
                ) : undefined
              }
            >
              {r.text}
            </Alert>
          ))}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <FormFieldset readOnly={form.readOnly}>
          <Card>
            <CardHeader icon={UserPlus} title="Tipo de cadastro" description="Como o jogador se identifica no site, nos rankings e nos ganhadores ao vivo." />
            <CardBody>
              <RadioCards
                name="Tipo de cadastro"
                value={v.identity}
                onChange={(x) => form.set('identity', x)}
                options={[
                  { value: 'nome', label: 'Nome completo', icon: IdCard, description: 'Nome e sobrenome. Em rankings aparece abreviado, como “Ana S.”.' },
                  { value: 'nick', label: 'Apelido (nick)', icon: AtSign, description: 'Apelido público. O nome real fica só no KYC e nos pagamentos.' },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              icon={FileCheck2}
              title="Campos obrigatórios"
              description="Marcado: o jogador precisa preencher para criar a conta. Desmarcado: campo opcional, que ele completa depois no perfil."
            />
            <CardBody className="space-y-1">
              <div className="mb-3 flex flex-wrap gap-1.5">
                {['E-mail', 'Senha', 'Aceite dos Termos de uso'].map((l) => (
                  <Badge key={l} tone="neutral" icon={LockKeyhole}>
                    {l} · sempre obrigatório
                  </Badge>
                ))}
              </div>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {FIELDS.map((f) => {
                  const on = v.required[f]
                  const flagged = f === 'birthDate' && !on
                  return (
                    <li key={f} className={cn('flex items-start justify-between gap-3 px-3.5 py-3', flagged && 'bg-danger/5')}>
                      <Checkbox
                        checked={on}
                        onChange={(val) => setRequired(f, val)}
                        disabled={form.readOnly}
                        label={
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{FIELD_META[f].label}</span>
                            {f === 'birthDate' && <Badge tone={on ? 'success' : 'danger'}>{on ? 'Recomendado' : 'Risco regulatório'}</Badge>}
                            {f === 'marketingOptIn' && <Badge tone={on ? 'warning' : 'info'}>{on ? 'Risco LGPD' : 'LGPD: opcional'}</Badge>}
                          </span>
                        }
                        description={FIELD_META[f].description}
                      />
                      <span className={cn('shrink-0 pt-0.5 text-xs font-medium', on ? 'text-fg' : 'text-fg-3')}>{on ? 'Obrigatório' : 'Opcional'}</span>
                    </li>
                  )
                })}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon={ScanFace} title="Verificação de identidade (KYC)" description="Quando o jogador precisa enviar documentos e quais. Sem KYC aprovado, o saque fica retido." />
            <CardBody className="space-y-5">
              <Field label="Quando pedir">
                <RadioCards
                  name="Quando pedir o KYC"
                  columns={3}
                  value={v.kycMoment}
                  onChange={(x) => form.set('kycMoment', x)}
                  options={[
                    { value: 'cadastro', label: 'No cadastro', description: 'Mais seguro. Aumenta o abandono do cadastro.' },
                    { value: 'primeiro_saque', label: 'Antes do 1º saque', description: 'Equilíbrio entre conversão e segurança.', badge: <Badge tone="primary">Padrão</Badge> },
                    { value: 'valor_depositado', label: 'Ao atingir um valor', description: 'Pede quando o total depositado chega ao limite.' },
                  ]}
                />
              </Field>
              {v.kycMoment === 'valor_depositado' && (
                <Field
                  label="Pedir KYC ao atingir"
                  htmlFor="kyc-thr"
                  required
                  error={!(v.kycThreshold > 0) ? 'Informe um valor maior que zero.' : null}
                  hint={`Soma de todos os depósitos do jogador. Ex.: com ${brl(v.kycThreshold)}, o KYC é pedido no depósito que passar desse total.`}
                >
                  <div className="max-w-xs">
                    <MoneyInput id="kyc-thr" value={v.kycThreshold} onValueChange={(n) => form.set('kycThreshold', n)} invalid={!(v.kycThreshold > 0)} />
                  </div>
                </Field>
              )}
              <Field label="Documentos pedidos" error={noDocs ? 'Escolha ao menos um documento.' : null}>
                <div className="grid gap-2.5 sm:grid-cols-3">
                  {DOCS.map(({ id, icon: Icon }) => {
                    const on = v.documents[id]
                    return (
                      <button
                        key={id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        disabled={form.readOnly}
                        onClick={() => setDoc(id, !on)}
                        className={cn(
                          'flex items-start gap-3 rounded-xl border p-3 text-left transition-[border-color,background-color] duration-150 disabled:cursor-not-allowed disabled:opacity-60',
                          on ? 'border-primary bg-primary/5' : 'border-line hover:border-line-strong hover:bg-surface-2',
                        )}
                      >
                        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', on ? 'bg-primary text-primary-fg' : 'bg-surface-3 text-fg-2')}>
                          <Icon size={16} aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium text-fg">{DOC_META[id].label}</span>
                          <span className="block text-xs leading-5 text-fg-3">{DOC_META[id].description}</span>
                        </span>
                        <span
                          aria-hidden
                          className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong')}
                        >
                          {on && <Check size={11} strokeWidth={3} />}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </Field>
            </CardBody>
          </Card>
        </FormFieldset>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Prévia do cadastro" description="Como o jogador vê no celular." />
            <CardBody>
              <SignupPreview c={v} />
            </CardBody>
          </Card>
          <AgeTester c={v} />
        </div>
      </div>

      <SaveBar form={form} label="Salvar regras" />
    </>
  )
}

function MockField({ label, placeholder, required, warn }: { label: string; placeholder: string; required: boolean; warn?: boolean }) {
  return (
    <div>
      <p className="mb-0.5 text-[11px] font-medium text-fg">
        {label}
        {required ? <span className="text-danger"> *</span> : <span className="font-normal text-fg-3"> (opcional)</span>}
      </p>
      <div className={cn('flex h-7 items-center rounded-md border bg-surface px-2.5 text-[11.5px] text-fg-3', warn ? 'border-danger/50' : 'border-line-strong/80')}>{placeholder}</div>
    </div>
  )
}

function SignupPreview({ c }: { c: SignupConfig }) {
  const r = c.required
  const docs = (Object.keys(c.documents) as KycDocument[]).filter((d) => c.documents[d]).map((d) => DOC_META[d].label.toLowerCase())
  return (
    <figure aria-label="Prévia do formulário de cadastro" className="m-0">
      <PhoneFrame url="x2win.bet.br/cadastro" maxHeight="none">
        <div className="space-y-2 bg-surface px-4 pb-5 pt-2" aria-hidden>
          <div className="flex items-center gap-2">
            <BrandMark size={22} />
            <span className="font-display text-[13px] font-bold text-fg">X2Win</span>
          </div>
          <div>
            <p className="font-display text-base font-bold text-fg">Criar conta</p>
            <p className="text-[11px] text-fg-3">Leva menos de 1 minuto.</p>
          </div>
          {c.identity === 'nome' ? (
            <MockField label="Nome completo" placeholder="Ana Souza" required />
          ) : (
            <MockField label="Apelido" placeholder="ana_vence" required />
          )}
          <MockField label="E-mail" placeholder="voce@email.com" required />
          <MockField label="Senha" placeholder="••••••••" required />
          <MockField label="CPF" placeholder="000.000.000-00" required={r.cpf} />
          <MockField label="Data de nascimento" placeholder="dd/mm/aaaa" required={r.birthDate} warn={!r.birthDate} />
          <MockField label="Celular" placeholder="(11) 90000-0000" required={r.phone} />
          <MockField label="CEP" placeholder="00000-000" required={r.address} />
          <div className="space-y-1.5 pt-1 text-[11px] leading-4 text-fg-2">
            <p className="flex items-start gap-1.5">
              <span className="mt-px h-3 w-3 shrink-0 rounded-[3px] border border-line-strong" />
              <span>
                Quero receber ofertas e novidades{r.marketingOptIn ? <span className="text-danger"> *</span> : <span className="text-fg-3"> (opcional)</span>}
              </span>
            </p>
            <p className="flex items-start gap-1.5">
              <span className="mt-px h-3 w-3 shrink-0 rounded-[3px] border border-line-strong" />
              <span>
                Tenho {MIN_AGE} anos ou mais e aceito os <span className="text-primary-text underline">Termos de uso</span>
                <span className="text-danger"> *</span>
              </span>
            </p>
          </div>
          <div className="flex h-9 items-center justify-center rounded-lg bg-primary text-[12px] font-semibold text-primary-fg">Criar conta</div>
          {r.emailConfirm && <p className="text-center text-[10.5px] text-fg-3">Enviaremos um link para confirmar o e-mail antes do 1º depósito.</p>}
          <div className="flex items-start gap-2 rounded-lg bg-surface-2 p-2.5 text-[10.5px] leading-4 text-fg-2">
            <Camera size={13} className="mt-px shrink-0 text-primary-text" />
            <span>
              Verificação de identidade {MOMENT_LABEL[c.kycMoment]}
              {c.kycMoment === 'valor_depositado' ? ` (${brl(c.kycThreshold)})` : ''}: {docs.length ? docs.join(', ') : 'nenhum documento'}.
            </span>
          </div>
        </div>
      </PhoneFrame>
    </figure>
  )
}

function AgeTester({ c }: { c: SignupConfig }) {
  const [birth, setBirth] = useState(() => {
    const d = new Date(NOW)
    d.setFullYear(d.getFullYear() - 17)
    return dayKey(d)
  })
  const r = checkSignupAge(c, birth)
  return (
    <Card>
      <CardHeader icon={CalendarDays} title="Testar a idade no cadastro" description="Simule uma data de nascimento com as regras do rascunho." />
      <CardBody className="space-y-3">
        <Field label="Data de nascimento" htmlFor="age-test" hint="Deixe em branco para simular quem não informa a data.">
          <Input id="age-test" type="date" value={birth} max={dayKey(NOW)} onChange={(e) => setBirth(e.target.value)} />
        </Field>
        <div aria-live="polite">
          {r.status === 'ok' && (
            <Alert tone="success" title="Cadastro liberado">
              {r.age} anos: idade mínima conferida.
            </Alert>
          )}
          {r.status === 'minor' && (
            <Alert tone="danger" title="Cadastro bloqueado">
              {r.age} anos: o site mostra “Você precisa ter {MIN_AGE} anos ou mais para se cadastrar”.
            </Alert>
          )}
          {r.status === 'invalid' && (
            <Alert tone="warning" title="Data obrigatória">
              O jogador não consegue continuar sem informar uma data válida.
            </Alert>
          )}
          {r.status === 'not_checked' && (
            <Alert tone="danger" title="Cadastro liberado sem verificar a idade" icon={Wallet}>
              Com a data opcional, a conta é criada e pode depositar. A idade só é conferida no KYC.
            </Alert>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
