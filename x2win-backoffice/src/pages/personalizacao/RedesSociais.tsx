import { useState } from 'react'
import { AtSign, Check, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react'
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
  Input,
  Modal,
  PageHeader,
  SaveBar,
  SortableList,
  Switch,
  TextLink,
  confirm,
  toast,
  useSettingsForm,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { useDb } from '@/lib/store'
import { uid } from '@/lib/random'
import { useCompany } from '@/domain/system'
import { safeLinkHref } from '@/domain/personalizacao-p1'
import {
  DEFAULT_SOCIAL,
  P2_KEYS,
  SOCIAL_DEFS,
  SOCIAL_ORDER,
  footerDefaults,
  socialHandle,
  socialUrlError,
  validateSocial,
  withHttps,
  type FooterSettings,
  type SocialLink,
  type SocialNetwork,
  type SocialSettings,
} from '@/data/personalizacao2-config'
import { BrowserFrame, DeviceToggle, initialDevice, LivePreview, PREVIEW, SiteFooter, SocialGlyph, SocialRow, SocialTile, SOCIAL_COLOR, type Device } from './_shared-p2'

export default function RedesSociais() {
  const [company] = useCompany()
  const [footer] = useDb<FooterSettings>(P2_KEYS.footer, () => footerDefaults(company))
  const form = useSettingsForm<SocialSettings>(P2_KEYS.social, DEFAULT_SOCIAL, {
    entity: 'Redes sociais',
    validate: validateSocial,
    successMessage: 'Redes sociais salvas',
  })
  const [device, setDevice] = useState<Device>(initialDevice)
  const [editing, setEditing] = useState<SocialLink | 'new' | null>(null)
  const links = form.values.links
  const used = links.map((l) => l.network)
  const full = used.length >= SOCIAL_ORDER.length
  const visible = links.filter((l) => l.visible).length

  const setLinks = (next: SocialLink[]) => form.setValues((v) => ({ ...v, links: next }))

  const remove = async (l: SocialLink) => {
    const ok = await confirm({
      title: `Remover ${SOCIAL_DEFS[l.network].label}?`,
      description: 'O ícone sai do rodapé e do menu do site depois que você salvar.',
      confirmLabel: 'Remover rede',
      tone: 'danger',
      icon: Trash2,
    })
    if (!ok) return
    setLinks(links.filter((x) => x.id !== l.id))
    toast.info(`${SOCIAL_DEFS[l.network].label} removido do rascunho`, { description: 'Salve as alterações para publicar.' })
  }

  const addButton = (
    <Button
      variant="primary"
      icon={Plus}
      onClick={() => setEditing('new')}
      disabled={form.readOnly || full}
      title={form.readOnly ? 'Seu cargo não edita esta tela' : full ? 'Todas as redes já foram adicionadas' : undefined}
    >
      Adicionar Rede Social
    </Button>
  )

  const frame = (d: Device) => (
    <BrowserFrame device={d} url="x2win.bet.br" label="Prévia dos ícones no rodapé do site">
      <SiteFooter footer={footer} socials={links} company={company} mobile={d === 'mobile'} highlightSocial />
    </BrowserFrame>
  )

  return (
    <>
      <PageHeader actions={addButton} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,500px)]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader
              icon={AtSign}
              title="Redes no site"
              description="Os ícones aparecem no rodapé de todas as páginas e no menu do celular, nesta ordem."
              actions={links.length ? <Badge tone="success">{`${visible} de ${links.length} visíveis`}</Badge> : undefined}
            />
            <CardBody>
              {links.length === 0 ? (
                <EmptyState
                  icon={AtSign}
                  title="Nenhuma rede social cadastrada"
                  description="Hoje o site não mostra ícones de redes. Adicione os perfis oficiais da casa para o jogador encontrar vocês."
                  action={addButton}
                  className="rounded-xl border border-dashed border-line-strong py-10"
                />
              ) : (
                <FormFieldset readOnly={form.readOnly}>
                  <SortableList
                    items={links}
                    getKey={(l) => l.id}
                    onChange={setLinks}
                    disabled={form.readOnly}
                    render={(l) => {
                      const err = socialUrlError(l.network, l.url)
                      // só vira link o endereço que passa na regra da rede (https e domínio dela)
                      const href = err ? null : safeLinkHref(l.url)
                      return (
                        <div className="flex min-w-0 items-center gap-3">
                          <SocialTile network={l.network} />
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-2 truncate text-sm font-medium text-fg">
                              {SOCIAL_DEFS[l.network].label}
                              {!l.visible && <Badge>Oculta</Badge>}
                            </p>
                            <p className={cn('truncate text-xs', err ? 'font-medium text-danger' : 'text-fg-3')}>{err ?? `${socialHandle(l.network, l.url)} · ${l.url.replace(/^https:\/\//, '')}`}</p>
                          </div>
                          <Switch
                            size="sm"
                            checked={l.visible}
                            onChange={(on) => setLinks(links.map((x) => (x.id === l.id ? { ...x, visible: on } : x)))}
                            ariaLabel={`${l.visible ? 'Esconder' : 'Mostrar'} ${SOCIAL_DEFS[l.network].label} no site`}
                            disabled={form.readOnly}
                          />
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="hidden h-8 w-8 items-center justify-center rounded-lg text-fg-2 hover:bg-surface-3 hover:text-fg sm:inline-flex"
                              aria-label={`Abrir ${SOCIAL_DEFS[l.network].label} em nova aba`}
                              title="Abrir perfil"
                            >
                              <ExternalLink size={15} aria-hidden />
                            </a>
                          ) : (
                            <span className="hidden h-8 w-8 items-center justify-center rounded-lg text-fg-3 opacity-40 sm:inline-flex" title="Corrija o link para abrir o perfil" aria-hidden>
                              <ExternalLink size={15} />
                            </span>
                          )}
                          <IconButton icon={Pencil} label={`Editar ${SOCIAL_DEFS[l.network].label}`} size="sm" onClick={() => setEditing(l)} disabled={form.readOnly} />
                          <IconButton icon={Trash2} label={`Remover ${SOCIAL_DEFS[l.network].label}`} size="sm" variant="danger" onClick={() => remove(l)} disabled={form.readOnly} />
                        </div>
                      )
                    }}
                  />
                </FormFieldset>
              )}
            </CardBody>
          </Card>

          <Alert tone="info" title="Como o link é conferido">
            Cada rede só aceita endereços do próprio domínio, com https e o perfil no caminho. Exemplo: Instagram aceita instagram.com/perfil; Telegram aceita t.me/canal;
            WhatsApp aceita wa.me/55DDDnúmero ou o link do canal.
          </Alert>
        </div>

        <div className="min-w-0">
          <LivePreview
            dirty={form.dirty}
            description="Rodapé do site com os ícones do rascunho (área tracejada)."
            actions={<DeviceToggle value={device} onChange={setDevice} />}
            expand={frame('desktop')}
            footnote={
              <>
                Os outros blocos do rodapé são editados em <TextLink to="/settings/footer">Rodapé e contato</TextLink>.
              </>
            }
          >
            <figure aria-label="Ícones em tamanho real" className="m-0 mb-4 rounded-xl px-4 py-3.5" style={{ background: PREVIEW.bg2 }}>
              <figcaption className="mb-2.5 text-[11px] font-semibold uppercase" style={{ color: PREVIEW.muted, letterSpacing: '0.06em' }}>
                Siga a {footer.companyName || 'X2Win'} · tamanho real
              </figcaption>
              <SocialRow links={links} />
            </figure>
            {frame(device)}
          </LivePreview>
        </div>
      </div>

      <SaveBar form={form} />

      <SocialModal
        key={editing === null ? 'closed' : editing === 'new' ? 'new' : editing.id}
        editing={editing}
        used={used}
        onClose={() => setEditing(null)}
        onSave={(link) => {
          const exists = links.some((x) => x.id === link.id)
          setLinks(exists ? links.map((x) => (x.id === link.id ? link : x)) : [...links, link])
          setEditing(null)
          toast.success(exists ? 'Rede atualizada no rascunho' : `${SOCIAL_DEFS[link.network].label} adicionado`, { description: 'Salve as alterações para publicar no site.' })
        }}
      />
    </>
  )
}

function SocialModal({
  editing,
  used,
  onClose,
  onSave,
}: {
  editing: SocialLink | 'new' | null
  used: SocialNetwork[]
  onClose: () => void
  onSave: (l: SocialLink) => void
}) {
  const current = editing && editing !== 'new' ? editing : null
  const firstFree = SOCIAL_ORDER.find((n) => !used.includes(n)) ?? 'instagram'
  const [network, setNetwork] = useState<SocialNetwork>(current?.network ?? firstFree)
  const [url, setUrl] = useState(current?.url ?? '')
  const [visibleOn, setVisibleOn] = useState(current?.visible ?? true)
  const [touched, setTouched] = useState(false)
  const err = socialUrlError(network, url)
  const def = SOCIAL_DEFS[network]

  const submit = () => {
    setTouched(true)
    const fixed = withHttps(url)
    if (fixed !== url) setUrl(fixed)
    if (socialUrlError(network, fixed)) return
    onSave({ id: current?.id ?? uid('rs-'), network, url: fixed, visible: visibleOn })
  }

  return (
    <Modal
      open={editing !== null}
      onClose={onClose}
      title={current ? `Editar ${SOCIAL_DEFS[current.network].label}` : 'Adicionar Rede Social'}
      description="Escolha a rede e cole o link do perfil oficial da casa."
      icon={AtSign}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" icon={current ? Check : Plus} onClick={submit}>
            {current ? 'Salvar rede' : 'Adicionar rede'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-fg">Rede</legend>
          <div role="radiogroup" aria-label="Rede social" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SOCIAL_ORDER.map((n) => {
              const taken = used.includes(n) && n !== current?.network
              const active = n === network
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={taken}
                  onClick={() => {
                    setNetwork(n)
                    setTouched(false)
                  }}
                  className={cn(
                    'flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-[border-color,background-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-45',
                    active ? 'border-primary bg-primary/5 shadow-ring' : 'border-line hover:border-line-strong hover:bg-surface-2',
                  )}
                >
                  <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 ring-1 ring-inset ring-line', !SOCIAL_COLOR[n] && 'text-fg')} style={{ color: SOCIAL_COLOR[n] ?? undefined }}>
                    <SocialGlyph network={n} size={17} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-fg">{SOCIAL_DEFS[n].label}</span>
                    {taken && <span className="block text-[11px] text-fg-3">Já adicionada</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </fieldset>

        <Field
          label={`Link do ${def.label}`}
          htmlFor="rs-url"
          required
          error={touched && err ? err : null}
          hint={!err && url ? `Aparece como ${socialHandle(network, url)}.` : `Exemplo: ${def.example}`}
        >
          <Input
            id="rs-url"
            data-autofocus
            value={url}
            placeholder={def.example}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => {
              if (url.trim()) {
                setUrl(withHttps(url))
                setTouched(true)
              }
            }}
            invalid={touched && !!err}
            autoComplete="off"
            inputMode="url"
          />
        </Field>

        <Switch label="Mostrar no site" description="Desligada, a rede fica salva mas o ícone não aparece." checked={visibleOn} onChange={setVisibleOn} />
      </form>
    </Modal>
  )
}
