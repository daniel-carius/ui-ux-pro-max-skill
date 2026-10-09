import type { ReactNode } from 'react'
import { BadgeCheck, CheckCircle2, FileText, History, Landmark, PanelBottom, ShieldCheck, TriangleAlert, XCircle } from 'lucide-react'
import {
  Alert,
  Field,
  FormFieldset,
  FormGrid,
  Input,
  KpiCard,
  PageHeader,
  Progress,
  SaveBar,
  SettingsSection,
  Textarea,
  TextLink,
  useSettingsForm,
} from '@/components/ui'
import { BrandMark } from '@/components/layout/Brand'
import { date, relative } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useDb } from '@/lib/store'
import { useAudit } from '@/domain/session'
import { COMPANY_KEY, DEFAULT_COMPANY, type CompanyState } from '@/domain/system'
import {
  DESCRIPTION_MAX,
  LICENSE_WARNING_DAYS,
  cnpjClean,
  companyErrors,
  firstCompanyError,
  formatCnpj,
  formatPhoneBr,
  licenseStatus,
  validateCnpj,
} from '@/domain/config1-empresa'
import { LEGAL_KEYS, currentVersion, type LegalDoc } from '@/domain/config1-textos'
import { seedLegalDocs } from '@/data/config1-textos'
import { SitePreview } from './_shared-f'

const ENTITY = 'Empresa e licença'
/** a autorização da SPA/MF vale por até 5 anos */
const LICENSE_TERM_DAYS = 5 * 365

export default function Empresa() {
  const form = useSettingsForm<CompanyState>(COMPANY_KEY, DEFAULT_COMPANY, {
    entity: ENTITY,
    successMessage: 'Dados da empresa salvos',
    validate: firstCompanyError,
  })
  const v = form.values
  const errors = companyErrors(v)
  const cnpj = validateCnpj(v.cnpj)
  const savedCnpj = validateCnpj(form.saved.cnpj)
  const lic = licenseStatus(v.licenseValidUntil)
  const pending = Object.keys(errors).length
  const [audit] = useAudit()
  const last = audit.find((a) => a.entity === ENTITY)

  return (
    <>
      <PageHeader />

      <section aria-label="Situação cadastral" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="CNPJ"
          icon={cnpj.ok ? BadgeCheck : XCircle}
          tone={cnpj.ok ? 'success' : 'danger'}
          value={<span className="font-mono text-[22px]">{formatCnpj(v.cnpj) || '—'}</span>}
          hint={cnpj.ok ? (cnpj.alphanumeric ? 'Alfanumérico · dígitos conferidos' : 'Dígitos verificadores conferidos') : 'Dígitos verificadores não conferem'}
        />
        <KpiCard
          label="Autorização SPA/MF"
          icon={ShieldCheck}
          tone={lic.level === 'ok' ? 'success' : lic.level === 'warning' ? 'warning' : 'danger'}
          value={lic.level === 'ok' ? 'Válida' : lic.level === 'warning' ? `${lic.daysLeft} dias` : lic.level === 'expired' ? 'Vencida' : '—'}
          hint={v.licenseValidUntil ? `até ${date(v.licenseValidUntil)}` : 'sem data de validade'}
        />
        <KpiCard
          label="Dados no rodapé e textos legais"
          icon={PanelBottom}
          tone={pending ? 'warning' : 'primary'}
          value={pending ? `${pending} ${pending === 1 ? 'pendência' : 'pendências'}` : 'Completos'}
          hint={pending ? 'corrija os campos marcados' : 'tudo pronto para publicar'}
        />
        <KpiCard
          label="Última alteração"
          icon={History}
          tone="neutral"
          value={last ? relative(last.at) : '—'}
          hint={last ? `por ${last.actorName}` : 'nenhuma alteração pelo painel'}
        />
      </section>

      {!savedCnpj.ok && (
        <Alert tone="danger" title="O CNPJ cadastrado não passa na conferência dos dígitos" className="mb-5">
          O número {formatCnpj(form.saved.cnpj)} aparece hoje no rodapé e nos textos legais. Confira no cartão CNPJ da Receita Federal e corrija abaixo: nada é salvo
          enquanto o CNPJ estiver inválido.
        </Alert>
      )}

      <FormFieldset readOnly={form.readOnly}>
        <SettingsSection title="Identificação" description="Como a empresa aparece no rodapé do site, no cabeçalho dos textos legais e nas faturas da plataforma.">
          <FormGrid>
            <Field label="Razão social" htmlFor="e-legal" required error={errors.legalName} hint="Igual ao cartão CNPJ.">
              <Input id="e-legal" value={v.legalName} onChange={(e) => form.set('legalName', e.target.value)} invalid={!!errors.legalName} autoComplete="organization" />
            </Field>
            <Field label="Nome fantasia" htmlFor="e-trade" required error={errors.tradeName} hint="Nome da marca que o jogador vê.">
              <Input id="e-trade" value={v.tradeName} onChange={(e) => form.set('tradeName', e.target.value)} invalid={!!errors.tradeName} />
            </Field>
          </FormGrid>
          <Field
            label="CNPJ"
            htmlFor="e-cnpj"
            required
            error={errors.cnpj ? `${errors.cnpj}${!cnpj.ok && cnpj.expected ? ` Com esta raiz, os dígitos seriam ${cnpj.expected}.` : ''}` : null}
            hint="Aceita o CNPJ numérico e o alfanumérico (formato novo da Receita Federal). Os dois dígitos finais são conferidos."
          >
            <Input
              id="e-cnpj"
              value={formatCnpj(v.cnpj)}
              onChange={(e) => form.set('cnpj', cnpjClean(e.target.value))}
              invalid={!!errors.cnpj}
              inputMode="text"
              autoCapitalize="characters"
              maxLength={18}
              placeholder="00.000.000/0000-00"
              className="max-w-sm font-mono"
              suffix={
                cnpj.ok ? (
                  <CheckCircle2 size={16} className="text-success" aria-label="CNPJ válido" />
                ) : v.cnpj.length === 14 ? (
                  <XCircle size={16} className="text-danger" aria-label="CNPJ inválido" />
                ) : undefined
              }
            />
          </Field>
          <Field
            label="Descrição"
            htmlFor="e-desc"
            error={errors.description}
            hint="Texto curto que aparece no rodapé, abaixo do logotipo."
            labelAside={
              <span className={cn('text-xs tnum', v.description.length > DESCRIPTION_MAX ? 'font-semibold text-danger' : 'text-fg-3')}>
                {v.description.length}/{DESCRIPTION_MAX}
              </span>
            }
          >
            <Textarea id="e-desc" rows={3} value={v.description} onChange={(e) => form.set('description', e.target.value)} invalid={!!errors.description} />
          </Field>
        </SettingsSection>

        <SettingsSection
          title="Autorização de funcionamento"
          description="Concedida pela Secretaria de Prêmios e Apostas do Ministério da Fazenda (SPA/MF), com validade de até 5 anos. Sem autorização válida, a operação não pode funcionar."
          aside={<LicenseMeter validUntil={v.licenseValidUntil} />}
        >
          <FormGrid>
            <Field label="Número da autorização" htmlFor="e-lic" required error={errors.license} hint="Como publicado no Diário Oficial da União.">
              <Input id="e-lic" value={v.license} onChange={(e) => form.set('license', e.target.value)} invalid={!!errors.license} />
            </Field>
            <Field label="Válida até" htmlFor="e-lic-date" required error={errors.licenseValidUntil} hint={lic.label}>
              <Input
                id="e-lic-date"
                type="date"
                value={v.licenseValidUntil.slice(0, 10)}
                onChange={(e) => form.set('licenseValidUntil', e.target.value ? `${e.target.value}T12:00:00` : '')}
                invalid={!!errors.licenseValidUntil}
              />
            </Field>
          </FormGrid>
          {lic.level === 'warning' && (
            <Alert tone="warning" title={`A autorização vence em ${lic.daysLeft} ${lic.daysLeft === 1 ? 'dia' : 'dias'}`}>
              Faltam menos de {LICENSE_WARNING_DAYS} dias. Comece a renovação junto à SPA/MF agora: o pedido precisa estar aprovado antes do vencimento para o site
              continuar no ar.
            </Alert>
          )}
          {lic.level === 'expired' && (
            <Alert tone="danger" title="Autorização vencida">
              Operar sem autorização válida sujeita a empresa às sanções da Lei 14.790/2023. Confira a data ou fale com o jurídico antes de salvar.
            </Alert>
          )}
        </SettingsSection>

        <SettingsSection
          title="Sede e contato oficial"
          description="Endereço da sede e canais oficiais da empresa, usados em textos legais e comunicações com órgãos públicos."
          aside={
            <p className="text-xs leading-5 text-fg-3">
              Os canais de atendimento ao jogador ficam em <TextLink to="/settings/suporte">Suporte e contato</TextLink>.
            </p>
          }
        >
          <Field label="Endereço da sede" htmlFor="e-addr" required error={errors.address} hint="Rua, número, complemento · cidade/UF · CEP">
            <Input id="e-addr" value={v.address} onChange={(e) => form.set('address', e.target.value)} invalid={!!errors.address} autoComplete="street-address" />
          </Field>
          <FormGrid>
            <Field label="E-mail" htmlFor="e-mail" required error={errors.email}>
              <Input id="e-mail" type="email" value={v.email} onChange={(e) => form.set('email', e.target.value.trim())} invalid={!!errors.email} autoComplete="email" />
            </Field>
            <Field label="Telefone" htmlFor="e-phone" required error={errors.phone}>
              <Input
                id="e-phone"
                inputMode="tel"
                value={formatPhoneBr(v.phone)}
                onChange={(e) => form.set('phone', e.target.value.replace(/\D/g, '').slice(0, 11))}
                invalid={!!errors.phone}
                placeholder="(11) 4002-8922"
                autoComplete="tel"
              />
            </Field>
          </FormGrid>
        </SettingsSection>
      </FormFieldset>

      <h2 className="mb-1 mt-8 text-[15px] font-semibold text-fg">Onde estes dados aparecem</h2>
      <p className="mb-4 text-[13px] text-fg-3">
        Prévias com o rascunho atual. Em destaque, o que vem desta tela. O restante do rodapé é editado em{' '}
        <TextLink to="/settings/footer">Personalização › Rodapé e contato</TextLink>.
      </p>
      <div className="grid gap-5 xl:grid-cols-2">
        <SitePreview url="x2win.bet.br" title="Rodapé do site" description="Em todas as páginas, no fim da tela." icon={PanelBottom}>
          <FooterPreview c={v} />
        </SitePreview>
        <SitePreview url="x2win.bet.br/termos-de-uso" title="Cabeçalho dos textos legais" description="Termos de uso, privacidade, jogo responsável e bônus." icon={FileText}>
          <LegalHeaderPreview c={v} />
        </SitePreview>
      </div>

      <SaveBar form={form} />
    </>
  )
}

function LicenseMeter({ validUntil }: { validUntil: string }) {
  const lic = licenseStatus(validUntil)
  if (lic.daysLeft == null) return null
  const left = Math.max(0, lic.daysLeft)
  const tone = lic.level === 'ok' ? 'success' : lic.level === 'warning' ? 'warning' : 'danger'
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-fg-2">Prazo restante</span>
        <span className={cn('font-semibold tnum', tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-danger')}>
          {lic.level === 'expired' ? 'vencida' : `${left.toLocaleString('pt-BR')} dias`}
        </span>
      </div>
      <Progress className="mt-2" value={Math.min(left, LICENSE_TERM_DAYS)} max={LICENSE_TERM_DAYS} tone={tone} label="Prazo restante da autorização" />
      <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-fg-3">
        {lic.level === 'ok' ? <CheckCircle2 size={12} className="text-success" aria-hidden /> : <TriangleAlert size={12} className="text-warning" aria-hidden />}
        Aviso automático a {LICENSE_WARNING_DAYS} dias do vencimento.
      </p>
    </div>
  )
}

/** destaca o que vem desta tela */
function Hl({ children, missing }: { children: ReactNode; missing?: boolean }) {
  return (
    <span className={cn('rounded px-0.5 ring-1 ring-inset', missing ? 'bg-danger/10 text-danger ring-danger/25' : 'bg-primary/10 text-fg ring-primary/20')}>
      {children}
    </span>
  )
}

function FooterPreview({ c }: { c: CompanyState }) {
  const cnpjOk = validateCnpj(c.cnpj).ok
  return (
    <div className="bg-surface px-5 py-5 text-fg-2">
      <div className="flex items-start gap-3">
        <BrandMark size={30} />
        <div className="min-w-0">
          <p className="font-display text-sm font-bold text-fg">
            <Hl missing={!c.tradeName.trim()}>{c.tradeName || 'Nome fantasia'}</Hl>
          </p>
          <p className="mt-1 text-[12px] leading-5">
            <Hl>{c.description || 'Descrição da empresa'}</Hl>
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11.5px] sm:grid-cols-4" aria-hidden>
        {['Termos de uso', 'Privacidade', 'Jogo responsável', 'Política de bônus'].map((l) => (
          <span key={l} className="truncate text-fg-3 underline decoration-line-strong underline-offset-2">
            {l}
          </span>
        ))}
      </div>
      <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-[11.5px] leading-5 text-fg-3">
        <p>
          <Hl>{c.legalName || 'Razão social'}</Hl> · CNPJ <Hl missing={!cnpjOk}>{formatCnpj(c.cnpj) || '—'}</Hl> · <Hl>{c.address || 'Endereço'}</Hl>
        </p>
        <p>
          <Landmark size={11} className="mr-1 inline align-[-1px]" aria-hidden />
          Autorizada pela SPA/MF · <Hl>{c.license || 'Nº da autorização'}</Hl> · válida até <Hl>{c.licenseValidUntil ? date(c.licenseValidUntil) : '—'}</Hl>
        </p>
        <p className="flex items-center gap-2 pt-1">
          <span className="inline-flex h-5 items-center rounded border border-danger/40 px-1 text-[10px] font-bold text-danger">18+</span>
          Proibido para menores de 18 anos. Jogue com responsabilidade.
        </p>
      </div>
    </div>
  )
}

function LegalHeaderPreview({ c }: { c: CompanyState }) {
  const [docs] = useDb<LegalDoc[]>(LEGAL_KEYS.docs, seedLegalDocs)
  const termos = docs.find((d) => d.id === 'termos')
  const ver = termos ? currentVersion(termos) : null
  return (
    <div className="bg-surface px-5 py-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">
        Termos de uso{ver ? ` · versão ${ver.version} · atualizada em ${date(ver.publishedAt)}` : ''}
      </p>
      <h3 className="mt-1 font-display text-lg font-bold text-fg">Termos de uso</h3>
      <p className="mt-2 text-[12.5px] leading-6 text-fg-2">
        Este documento é celebrado entre o apostador e <Hl>{c.legalName || 'Razão social'}</Hl> (“<Hl>{c.tradeName || 'Nome fantasia'}</Hl>”), inscrita no CNPJ sob o nº{' '}
        <Hl missing={!validateCnpj(c.cnpj).ok}>{formatCnpj(c.cnpj) || '—'}</Hl>, com sede em <Hl>{c.address || 'endereço'}</Hl>, autorizada a explorar apostas de quota fixa
        pela Secretaria de Prêmios e Apostas do Ministério da Fazenda (<Hl>{c.license || 'nº da autorização'}</Hl>).
      </p>
      <p className="mt-2 text-[12.5px] leading-6 text-fg-2">
        Contato oficial: <Hl>{c.email || 'e-mail'}</Hl> · <Hl>{formatPhoneBr(c.phone) || 'telefone'}</Hl>
      </p>
      <div className="mt-4 space-y-2" aria-hidden>
        <div className="h-2 w-11/12 rounded bg-surface-3" />
        <div className="h-2 w-full rounded bg-surface-3" />
        <div className="h-2 w-4/5 rounded bg-surface-3" />
      </div>
    </div>
  )
}
