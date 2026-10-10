import { useMemo, useState } from 'react'
import { Ellipsis, ImageUp, Monitor, Plus, RotateCcw, Search, Smartphone, Trash2 } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  FormFieldset,
  IconButton,
  ImageUpload,
  Input,
  Menu,
  Modal,
  PageHeader,
  PageLink,
  SaveBar,
  Segmented,
  SortableList,
  Switch,
  TextLink,
  confirm,
  toast,
  useSettingsForm,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { num, plural } from '@/lib/format'
import { useDb } from '@/lib/store'
import { useProviders } from '@/data/hooks'
import type { Provider } from '@/data/catalog'
import { usePageAccess } from '@/domain/session'
import { PROVIDERS_STRIP_MAX, safeImageSrc, validateProvidersHome, type HomeConfig, type ProvidersHomeConfig } from '@/domain/personalizacao-p1'
import { DEFAULT_HOME, DEFAULT_PROVIDERS_HOME, P1_KEYS } from '@/data/personalizacao-p1'
import {
  BrowserFrame,
  EditorLayout,
  EditorSection,
  EmptySlot,
  GameTileMock,
  Monogram,
  PhoneFrame,
  PreviewJumpButton,
  PreviewPanel,
  ProviderStripMock,
  SafeImage,
  SiteBlockTitle,
  SiteHeaderMock,
  SiteLogo,
  useSitePalette,
  useSiteTheme,
  useSiteTitle,
} from './_shared-p1'

const AGG_LABEL: Record<Provider['aggregatorId'], string> = { metagrator: 'Metagrator', skravion: 'Skravion' }

export default function ProvedoresHome() {
  const { canEdit } = usePageAccess()
  const form = useSettingsForm<ProvidersHomeConfig>(P1_KEYS.provedoresHome, DEFAULT_PROVIDERS_HOME, {
    entity: 'Provedores na home',
    successMessage: 'Faixa de provedores salva',
    validate: validateProvidersHome,
  })
  const v = form.values
  const { items: providers } = useProviders()
  const byId = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers])
  const [homeCfg] = useDb<HomeConfig>(P1_KEYS.home, DEFAULT_HOME)
  const homeBlockOn = homeCfg.blocks.find((b) => b.id === 'provedores')?.enabled ?? false
  const [adding, setAdding] = useState(false)
  const [logoFor, setLogoFor] = useState<string | null>(null)
  const [device, setDevice] = useState<'computador' | 'celular'>('computador')

  const inStrip = new Set(v.items.map((i) => i.providerId))
  const available = providers.filter((p) => p.status === 'ativa' && !inStrip.has(p.id))
  const visibleCount = v.items.filter((i) => byId.get(i.providerId)?.status === 'ativa').length
  const full = v.items.length >= PROVIDERS_STRIP_MAX
  const titleError = v.enabled && !v.title.trim() ? 'Informe o título da faixa.' : v.title.trim().length > 40 ? 'Use até 40 caracteres.' : null

  const remove = async (providerId: string) => {
    const name = byId.get(providerId)?.name ?? providerId
    const ok = await confirm({
      title: `Remover ${name} da faixa?`,
      description: 'A provedora continua no catálogo e os jogos seguem no site. Ela só sai da faixa da home depois de salvar.',
      confirmLabel: 'Remover da faixa',
      tone: 'danger',
      icon: Trash2,
    })
    if (!ok) return
    form.set('items', v.items.filter((i) => i.providerId !== providerId))
    toast.info(`${name} removida do rascunho`, { description: 'Clique em Salvar alterações para publicar.' })
  }

  const restore = async () => {
    const ok = await confirm({
      title: 'Restaurar a faixa padrão?',
      description: 'A faixa volta a mostrar as 8 provedoras padrão da plataforma, na ordem padrão e com os monogramas. Logotipos enviados saem. O site só muda depois de salvar.',
      confirmLabel: 'Restaurar padrão',
      tone: 'warning',
      icon: RotateCcw,
    })
    if (!ok) return
    form.setValues(DEFAULT_PROVIDERS_HOME)
    toast.info('Padrão restaurado no rascunho', { description: 'Clique em Salvar alterações para publicar.' })
  }

  const logoItem = logoFor ? v.items.find((i) => i.providerId === logoFor) : undefined
  const logoProvider = logoFor ? byId.get(logoFor) : undefined

  return (
    <>
      <PageHeader
        actions={
          <>
            <PreviewJumpButton />
            <Button icon={RotateCcw} onClick={restore} disabled={!canEdit} title={!canEdit ? 'Seu cargo não pode editar esta tela' : undefined}>
              Restaurar padrão
            </Button>
          </>
        }
      />

      <EditorLayout
        preview={
          <PreviewPanel
            description="A faixa na home, entre os outros blocos."
            actions={
              <Segmented
                size="sm"
                ariaLabel="Aparelho da prévia"
                value={device}
                onChange={setDevice}
                options={[
                  { value: 'computador', label: 'Computador', icon: Monitor },
                  { value: 'celular', label: 'Celular', icon: Smartphone },
                ]}
              />
            }
            footer="Provedoras pausadas em Cassino › Provedoras não aparecem, mesmo estando na lista."
          >
            <StripPreview config={v} providers={providers} device={device} />
          </PreviewPanel>
        }
      >
        <FormFieldset readOnly={form.readOnly}>
          <EditorSection title="Faixa de provedores" description="Mostra os logotipos das provedoras na home. Clicar num logotipo abre os jogos daquela provedora.">
            <Switch
              label="Mostrar a faixa de provedores"
              description={v.enabled ? 'Ligada: aparece na home, na posição do bloco Provedores.' : 'Desligada: a faixa não aparece e não é carregada.'}
              checked={v.enabled}
              onChange={(on) => form.set('enabled', on)}
            />
            {v.enabled && !homeBlockOn && (
              <Alert
                tone="warning"
                title="O bloco Provedores está desligado na Página inicial"
                action={
                  <PageLink to="/settings/home" className="link text-[13px]">
                    Abrir Página inicial
                  </PageLink>
                }
              >
                A faixa só aparece na home quando o bloco estiver ligado.
              </Alert>
            )}
            <Field label="Título da faixa" htmlFor="pv-title" error={titleError} hint={`${v.title.length}/40 caracteres`}>
              <Input id="pv-title" value={v.title} maxLength={40} onChange={(e) => form.set('title', e.target.value)} invalid={!!titleError} placeholder="Provedores" />
            </Field>
            <Switch
              label="Mostrar a quantidade de jogos"
              description="Ex.: PG Soft · 9 jogos. Ajuda o jogador a achar provedoras com mais opções."
              checked={v.showGameCount}
              onChange={(on) => form.set('showGameCount', on)}
            />
          </EditorSection>

          <EditorSection
            title="Provedores e ordem"
            description="Arraste para mudar a ordem. Sem logotipo enviado, o site mostra um monograma com as iniciais."
            aside={
              <p className="text-xs leading-5 text-fg-3">
                Pausar ou reativar provedoras em <TextLink to="/games/provedoras">Cassino › Provedoras</TextLink>.
              </p>
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-fg-2">
                <strong className="text-fg">{plural(v.items.length, 'provedora', 'provedoras')}</strong> na lista · {num(visibleCount)} aparecem no site
              </p>
              <Button
                variant="primary"
                icon={Plus}
                onClick={() => setAdding(true)}
                disabled={!canEdit || !available.length || full}
                title={!canEdit ? 'Seu cargo não pode editar esta tela' : full ? `Limite de ${PROVIDERS_STRIP_MAX} provedoras` : !available.length ? 'Todas as provedoras ativas já estão na faixa' : undefined}
              >
                Adicionar provedor
              </Button>
            </div>

            {v.enabled && v.items.length === 0 && (
              <Alert tone="danger">Com a faixa ligada, adicione pelo menos uma provedora ou desligue a faixa para salvar.</Alert>
            )}

            {v.items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line-strong">
                <EmptyState
                  title="Nenhuma provedora na faixa"
                  description="Adicione as provedoras que mais atraem os seus jogadores."
                  action={
                    <Button icon={Plus} onClick={() => setAdding(true)} disabled={!canEdit || !available.length}>
                      Adicionar provedor
                    </Button>
                  }
                />
              </div>
            ) : (
              <SortableList
                items={v.items}
                getKey={(i) => i.providerId}
                onChange={(items) => form.set('items', items)}
                disabled={!canEdit}
                render={(it) => {
                  const prov = byId.get(it.providerId)
                  const paused = prov?.status !== 'ativa'
                  const name = prov?.name ?? it.providerId
                  return (
                    <div className="flex items-center gap-3">
                      <span className={cn('hidden h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2 sm:flex', paused && 'opacity-50')}>
                        <SafeImage
                          src={it.logo}
                          alt={`Logotipo ${name}`}
                          className="h-8 w-14 object-contain"
                          fallback={<Monogram name={name} hue={prov?.logoHue ?? 0} className="h-7 w-11 rounded-md text-xs" />}
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-fg">
                          <span className="truncate">{name}</span>
                          {paused && <Badge tone="warning">Pausada: não aparece</Badge>}
                          {!it.logo && <Badge>Monograma</Badge>}
                        </p>
                        <p className="mt-0.5 text-xs text-fg-3">
                          {prov ? `${plural(prov.games, 'jogo', 'jogos')} · ${AGG_LABEL[prov.aggregatorId]}` : 'Provedora não encontrada no catálogo'}
                        </p>
                      </div>
                      <div className="hidden shrink-0 items-center sm:flex">
                        <IconButton icon={ImageUp} size="sm" label={`Logotipo de ${name}`} onClick={() => setLogoFor(it.providerId)} disabled={!canEdit} />
                        <IconButton icon={Trash2} size="sm" variant="danger" label={`Remover ${name}`} onClick={() => remove(it.providerId)} disabled={!canEdit} />
                      </div>
                      <div className="sm:hidden">
                        <Menu
                          width={200}
                          trigger={(tp) => <IconButton {...tp} icon={Ellipsis} size="sm" label={`Ações de ${name}`} disabled={!canEdit} />}
                          items={[
                            { label: 'Trocar logotipo', icon: ImageUp, onSelect: () => setLogoFor(it.providerId) },
                            { label: 'Remover da faixa', icon: Trash2, danger: true, onSelect: () => remove(it.providerId) },
                          ]}
                        />
                      </div>
                    </div>
                  )
                }}
              />
            )}
          </EditorSection>
        </FormFieldset>
      </EditorLayout>

      <SaveBar form={form} />

      <AddProvidersModal
        open={adding}
        onClose={() => setAdding(false)}
        available={available}
        room={PROVIDERS_STRIP_MAX - v.items.length}
        onAdd={(ids) => {
          form.set('items', [...v.items, ...ids.map((providerId) => ({ providerId, logo: null }))])
          toast.success(ids.length === 1 ? `${byId.get(ids[0])?.name} adicionada` : `${ids.length} provedoras adicionadas`, {
            description: 'Entraram no fim da lista. Arraste para mudar a ordem e salve.',
          })
          setAdding(false)
        }}
      />

      <Modal
        open={!!logoItem}
        onClose={() => setLogoFor(null)}
        title={`Logotipo de ${logoProvider?.name ?? ''}`}
        description="PNG ou SVG com fundo transparente, 160×80 px. Sem logotipo, o site usa o monograma."
        icon={ImageUp}
        footer={
          <>
            {logoItem?.logo && (
              <Button
                variant="ghost"
                onClick={() => {
                  form.set('items', v.items.map((i) => (i.providerId === logoFor ? { ...i, logo: null } : i)))
                  toast.info('Monograma de volta no rascunho')
                }}
              >
                Usar monograma
              </Button>
            )}
            <Button variant="primary" onClick={() => setLogoFor(null)}>
              Concluir
            </Button>
          </>
        }
      >
        {logoItem && logoProvider && (
          <div className="space-y-4">
            <ImageUpload
              width={160}
              height={80}
              value={safeImageSrc(logoItem.logo)}
              onChange={(url) => form.set('items', v.items.map((i) => (i.providerId === logoFor ? { ...i, logo: url } : i)))}
              disabled={!canEdit}
              previewClassName="max-w-[260px]"
              hint="160×80 px"
            />
            <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
              <Monogram name={logoProvider.name} hue={logoProvider.logoHue} className="h-10 w-16 text-sm" />
              <p className="text-xs leading-5 text-fg-3">Monograma gerado para {logoProvider.name}. É o que aparece quando não há logotipo.</p>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

function AddProvidersModal({
  open,
  onClose,
  available,
  room,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  available: Provider[]
  room: number
  onAdd: (ids: string[]) => void
}) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const list = available.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()))
  const close = () => {
    setPicked([])
    setQ('')
    onClose()
  }
  const toggle = (id: string, on: boolean) => {
    if (on && picked.length >= room) {
      toast.warning(`A faixa aceita até ${PROVIDERS_STRIP_MAX} provedoras.`)
      return
    }
    setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)))
  }
  return (
    <Modal
      open={open}
      onClose={close}
      title="Adicionar provedor"
      description="Só aparecem provedoras ativas que ainda não estão na faixa."
      icon={Plus}
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button
            variant="primary"
            icon={Plus}
            disabled={!picked.length}
            onClick={() => {
              onAdd(picked)
              setPicked([])
              setQ('')
            }}
          >
            {picked.length > 1 ? `Adicionar ${picked.length}` : 'Adicionar'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Buscar provedora" htmlFor="pv-search">
          <Input id="pv-search" icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome da provedora" data-autofocus />
        </Field>
        {list.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-fg-3">{available.length ? 'Nenhuma provedora com esse nome.' : 'Todas as provedoras ativas já estão na faixa.'}</p>
        ) : (
          <ul className="max-h-[320px] divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {list.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                <Checkbox checked={picked.includes(p.id)} onChange={(on) => toggle(p.id, on)} ariaLabel={`Escolher ${p.name}`} />
                <Monogram name={p.name} hue={p.logoHue} className="h-7 w-10 shrink-0 text-[11px]" />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => toggle(p.id, !picked.includes(p.id))}>
                  <span className="block truncate text-sm font-medium text-fg">{p.name}</span>
                  <span className="block text-xs text-fg-3">{plural(p.games, 'jogo', 'jogos')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

function StripPreview({ config, providers, device }: { config: ProvidersHomeConfig; providers: Provider[]; device: 'computador' | 'celular' }) {
  const theme = useSiteTheme()
  const p = useSitePalette()
  const title = useSiteTitle()
  const mobile = device === 'celular'
  const games = [210, 250, 300, 330, 20, 160]
  const content = (
    <div className={cn('space-y-3', mobile ? 'p-2' : 'p-2.5')} style={{ background: p.background }}>
      <div style={{ opacity: 0.45 }} aria-hidden>
        <SiteBlockTitle palette={p}>Jogos em destaque</SiteBlockTitle>
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${mobile ? 3 : 6}, minmax(0,1fr))` }}>
          {games.slice(0, mobile ? 3 : 6).map((h) => (
            <GameTileMock key={h} hue={h} />
          ))}
        </div>
      </div>
      <div className="rounded-lg p-1.5" style={{ outline: `1.5px dashed ${p.primary}`, outlineOffset: 2 }}>
        {config.enabled ? (
          <ProviderStripMock palette={p} config={config} providers={providers} columns={mobile ? 3 : 4} />
        ) : (
          <EmptySlot palette={p} className="h-16">
            Faixa desligada: não aparece na home
          </EmptySlot>
        )}
      </div>
      <div className="h-6 rounded-md" style={{ background: p.surface, opacity: 0.45 }} aria-hidden />
    </div>
  )
  if (mobile) {
    return (
      <PhoneFrame background={p.background}>
        <div className="flex items-center justify-between px-3 pb-1.5 pt-6" style={{ background: p.surface, borderBottom: `1px solid ${p.line}` }}>
          <SiteLogo src={theme.logo} className="h-6 w-[50px]" style={{ color: p.text }} />
          <span className="rounded-md px-2 py-0.5 text-[9px] font-bold" style={{ background: p.primary, color: p.onPrimary }}>
            Entrar
          </span>
        </div>
        {content}
      </PhoneFrame>
    )
  }
  return (
    <BrowserFrame favicon={theme.favicon} title={title}>
      <SiteHeaderMock palette={p} logo={theme.logo} />
      {content}
    </BrowserFrame>
  )
}
