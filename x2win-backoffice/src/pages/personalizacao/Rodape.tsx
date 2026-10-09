import { useState } from 'react'
import {
  BadgeCheck,
  Building2,
  Clock,
  Headset,
  Link2,
  Mail,
  MapPin,
  MessageCircle,
  MessagesSquare,
  Phone,
  RefreshCw,
  Send,
  type LucideIcon,
} from 'lucide-react'
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
  PageHeader,
  SaveBar,
  Switch,
  Textarea,
  TextLink,
  confirm,
  toast,
  useSettingsForm,
} from '@/components/ui'
import { useDb } from '@/lib/store'
import { useCompany } from '@/domain/system'
import {
  CONTACT_DEFS,
  DEFAULT_SOCIAL,
  P2_KEYS,
  contactError,
  footerDefaults,
  footerErrors,
  validateFooter,
  visibleContacts,
  type ContactKey,
  type FooterSettings,
  type SocialSettings,
} from '@/data/personalizacao2-config'
import { BrowserFrame, CharCount, DeviceToggle, initialDevice, LivePreview, SiteFooter, fmtCnpj, type Device } from './_shared-p2'

const CONTACT_ICON: Record<ContactKey, LucideIcon> = {
  phone: Phone,
  email: Mail,
  whatsapp: MessageCircle,
  telegram: Send,
  chat: MessagesSquare,
  hours: Clock,
  address: MapPin,
}

export default function Rodape() {
  const [company] = useCompany()
  const [social] = useDb<SocialSettings>(P2_KEYS.social, DEFAULT_SOCIAL)
  const form = useSettingsForm<FooterSettings>(P2_KEYS.footer, () => footerDefaults(company), {
    entity: 'Rodapé e contato',
    validate: validateFooter,
    successMessage: 'Rodapé salvo',
  })
  const [device, setDevice] = useState<Device>(initialDevice)
  const v = form.values
  const errors = footerErrors(v)
  const shown = visibleContacts(v)
  const missingSeal = !v.seal18 || !v.sealResponsible

  const syncCompany = async () => {
    const ok = await confirm({
      title: 'Usar os dados de Empresa e licença?',
      description: 'Nome, descrição, telefone, e-mail, endereço e texto da licença voltam a ser os do cadastro da empresa. Os outros canais não mudam.',
      confirmLabel: 'Usar dados da empresa',
      icon: RefreshCw,
    })
    if (!ok) return
    const d = footerDefaults(company)
    form.patch({ companyName: d.companyName, description: d.description, phone: d.phone, email: d.email, address: d.address, licenseText: d.licenseText })
    toast.info('Dados copiados para o rascunho', { description: 'Confira a prévia e salve para publicar.' })
  }

  const frame = (d: Device) => (
    <BrowserFrame device={d} url="x2win.bet.br" label="Prévia do rodapé do site">
      <SiteFooter footer={v} socials={social.links} company={company} mobile={d === 'mobile'} />
    </BrowserFrame>
  )

  return (
    <>
      <PageHeader
        actions={
          <Button icon={RefreshCw} onClick={syncCompany} disabled={form.readOnly} title={form.readOnly ? 'Seu cargo não edita esta tela' : undefined}>
            Usar dados da empresa
          </Button>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,500px)]">
        <FormFieldset readOnly={form.readOnly}>
          <Card>
            <CardHeader icon={Building2} title="Empresa no rodapé" description="Nome, descrição e links legais que aparecem no rodapé de todas as páginas." />
            <CardBody className="space-y-4">
              <FormGrid>
                <Field label="Nome exibido" htmlFor="ft-name" required error={errors.companyName}>
                  <Input id="ft-name" value={v.companyName} onChange={(e) => form.set('companyName', e.target.value)} invalid={!!errors.companyName} />
                </Field>
                <Field label="Link dos termos de uso" htmlFor="ft-terms" required error={errors.termsUrl}>
                  <Input id="ft-terms" icon={Link2} value={v.termsUrl} placeholder="https://x2win.bet.br/termos" onChange={(e) => form.set('termsUrl', e.target.value)} invalid={!!errors.termsUrl} />
                </Field>
              </FormGrid>
              <Field
                label="Descrição"
                htmlFor="ft-desc"
                error={errors.description}
                labelAside={<CharCount count={v.description.length} max={300} />}
                hint="Uma ou duas frases sobre a casa. Em branco, o rodapé mostra só o logotipo."
              >
                <Textarea id="ft-desc" rows={3} value={v.description} onChange={(e) => form.set('description', e.target.value)} invalid={!!errors.description} />
              </Field>
              <Field label="Link da política de privacidade" htmlFor="ft-priv" error={errors.privacyUrl} hint="Opcional. Em branco, o item não aparece.">
                <Input id="ft-priv" icon={Link2} value={v.privacyUrl} placeholder="https://x2win.bet.br/privacidade" onChange={(e) => form.set('privacyUrl', e.target.value)} invalid={!!errors.privacyUrl} />
              </Field>
              <Switch
                label="Mostrar razão social e CNPJ"
                description={`${company.legalName} · CNPJ ${fmtCnpj(company.cnpj)}`}
                checked={v.showLegalLine}
                onChange={(on) => form.set('showLegalLine', on)}
              />
              <p className="text-xs text-fg-3">
                Razão social, CNPJ e licença vêm de <TextLink to="/settings/empresa">Configurações › Empresa e licença</TextLink>.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              icon={Headset}
              title="Canais de contato"
              description="Canal em branco não aparece no site. Preencha só os que a equipe atende."
              actions={<Badge tone={shown.length ? 'success' : 'danger'}>{`${shown.length} de ${CONTACT_DEFS.length} no rodapé`}</Badge>}
            />
            <CardBody>
              <FormGrid>
                {CONTACT_DEFS.map((def) => {
                  const value = v[def.key]
                  const err = contactError(def.key, value)
                  const blank = !value.trim()
                  return (
                    <Field
                      key={def.key}
                      label={def.label}
                      htmlFor={`ft-${def.key}`}
                      error={err}
                      hint={def.hint}
                      className={def.key === 'address' ? 'sm:col-span-2' : undefined}
                      labelAside={
                        <Badge tone={err ? 'danger' : blank ? 'neutral' : 'success'} dot>
                          {err ? 'Com erro' : blank ? 'Não aparece' : 'No rodapé'}
                        </Badge>
                      }
                    >
                      <Input
                        id={`ft-${def.key}`}
                        icon={CONTACT_ICON[def.key]}
                        value={value}
                        placeholder={def.placeholder}
                        inputMode={def.key === 'phone' || def.key === 'whatsapp' ? 'tel' : def.key === 'email' ? 'email' : undefined}
                        onChange={(e) => form.set(def.key, e.target.value)}
                        invalid={!!err}
                      />
                    </Field>
                  )
                })}
              </FormGrid>
              {shown.length === 0 && (
                <Alert tone="danger" className="mt-4" title="Nenhum canal visível">
                  O jogador fica sem como falar com a casa. Preencha pelo menos um canal para salvar.
                </Alert>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon={BadgeCheck} title="Selos e licença" description="Avisos legais na faixa de baixo do rodapé." />
            <CardBody className="space-y-4">
              <Switch label="Selo 18+" description="Proibido para menores de 18 anos." checked={v.seal18} onChange={(on) => form.set('seal18', on)} />
              <Switch
                label="Selo Jogo responsável"
                description={
                  <>
                    Leva à página de jogo responsável, configurada em <TextLink to="/settings/jogo-responsavel">Jogo responsável</TextLink>.
                  </>
                }
                checked={v.sealResponsible}
                onChange={(on) => form.set('sealResponsible', on)}
              />
              <Switch label="Selo de licença SPA/MF" description="Mostra a autorização de funcionamento da casa." checked={v.sealLicense} onChange={(on) => form.set('sealLicense', on)} />
              {v.sealLicense && (
                <Field label="Texto da licença" htmlFor="ft-lic" required error={errors.licenseText} labelAside={<CharCount count={v.licenseText.length} max={200} />}>
                  <Textarea id="ft-lic" rows={2} value={v.licenseText} onChange={(e) => form.set('licenseText', e.target.value)} invalid={!!errors.licenseText} />
                </Field>
              )}
              {missingSeal && (
                <Alert tone="warning" title="Selo obrigatório desligado">
                  A Lei 14.790/2023 e as portarias da SPA/MF pedem aviso de 18+ e de jogo responsável no site. Desligue só se o aviso aparecer em outro lugar da página.
                </Alert>
              )}
            </CardBody>
          </Card>
        </FormFieldset>

        <div className="min-w-0">
          <LivePreview
            dirty={form.dirty}
            description="O rodapé que aparece em todas as páginas do site."
            actions={<DeviceToggle value={device} onChange={setDevice} />}
            expand={frame('desktop')}
            footnote={
              <>
                Ícones das redes vêm de <TextLink to="/settings/social">Redes sociais</TextLink>
                {social.links.length ? ` (${social.links.filter((l) => l.visible).length} visíveis)` : ' (nenhuma cadastrada)'}.
              </>
            }
          >
            {frame(device)}
          </LivePreview>
        </div>
      </div>

      <SaveBar form={form} />
    </>
  )
}
