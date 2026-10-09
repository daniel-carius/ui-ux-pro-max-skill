import { useState } from 'react'
import { Globe, Link2, LogIn, Monitor, Pencil, Plus, RotateCcw, Smartphone, Trash2, UserRound } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Field,
  FormFieldset,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Progress,
  RadioCards,
  SaveBar,
  Segmented,
  Select,
  SortableList,
  confirm,
  toast,
  useSettingsForm,
  type Tone,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { uid } from '@/lib/random'
import { usePageAccess } from '@/domain/session'
import {
  MENU_AUDIENCE_LABEL,
  MENU_LIMITS,
  MENU_LIST_LABEL,
  menuItemErrors,
  validateMenus,
  visibleMenuItems,
  type MenuAudience,
  type MenuListId,
  type MenusConfig,
  type SiteMenuItem,
  type SitePalette,
} from '@/domain/personalizacao-p1'
import { DEFAULT_MENUS, MENU_ICON_OPTIONS, P1_KEYS, SITE_PAGES, SITE_PAGE_LABEL } from '@/data/personalizacao-p1'
import {
  BrowserFrame,
  EditorLayout,
  EditorSection,
  GameTileMock,
  MenuIcon,
  PhoneFrame,
  PreviewJumpButton,
  PreviewPanel,
  SiteLogo,
  useSitePalette,
  useSiteTheme,
  useSiteTitle,
} from './_shared-p1'

type Viewer = 'visitante' | 'logado'

const AUDIENCE_TONE: Record<MenuAudience, Tone> = { todos: 'neutral', logados: 'primary', visitantes: 'info' }

const LIST_INFO: Record<MenuListId, { description: string; icon: typeof Monitor }> = {
  header: {
    description: 'Menu no topo do site em telas largas. A ordem da lista é a ordem da esquerda para a direita.',
    icon: Monitor,
  },
  mobile: {
    description: 'Barra fixa no rodapé do celular, com ícone e rótulo curto. Cabem no máximo 5 itens.',
    icon: Smartphone,
  },
}

function linkSummary(it: SiteMenuItem) {
  if (it.linkType === 'pagina') return it.page ? `${SITE_PAGE_LABEL.get(it.page) ?? it.page} · ${it.page}` : 'Página não escolhida'
  return it.url || 'Endereço não informado'
}

export default function Menus() {
  const { canEdit } = usePageAccess()
  const form = useSettingsForm<MenusConfig>(P1_KEYS.menus, DEFAULT_MENUS, {
    entity: 'Menus do site',
    successMessage: 'Menus salvos',
    validate: validateMenus,
  })
  const v = form.values
  const [editing, setEditing] = useState<{ list: MenuListId; item: SiteMenuItem; isNew: boolean } | null>(null)
  const [viewer, setViewer] = useState<Viewer>('visitante')

  const add = (list: MenuListId) => {
    const { max } = MENU_LIMITS[list]
    if (v[list].length >= max) {
      toast.error(`${MENU_LIST_LABEL[list]}: no máximo ${max} itens`, { description: 'Remova um item para adicionar outro.' })
      return
    }
    setEditing({ list, isNew: true, item: { id: uid('mi-'), label: '', icon: 'star', linkType: 'pagina', page: '', url: '', audience: 'todos' } })
  }

  const apply = (list: MenuListId, item: SiteMenuItem, isNew: boolean) => {
    form.set(list, isNew ? [...v[list], item] : v[list].map((it) => (it.id === item.id ? item : it)))
    setEditing(null)
    toast.info(isNew ? `"${item.label}" adicionado` : `"${item.label}" atualizado`, { description: 'Clique em Salvar alterações para publicar.' })
  }

  const remove = async (list: MenuListId, item: SiteMenuItem) => {
    const ok = await confirm({
      title: `Remover "${item.label || 'item sem rótulo'}"?`,
      description: `Sai do ${list === 'header' ? 'cabeçalho do computador' : 'menu do celular'}. A página continua existindo. O site só muda depois de salvar.`,
      confirmLabel: 'Remover item',
      tone: 'danger',
      icon: Trash2,
    })
    if (ok) form.set(list, v[list].filter((it) => it.id !== item.id))
  }

  const restore = async () => {
    const ok = await confirm({
      title: 'Restaurar os menus padrão da plataforma?',
      description: 'Os dois menus voltam aos itens e à ordem padrão. Itens criados por você saem. O site só muda depois de salvar.',
      confirmLabel: 'Restaurar padrão',
      tone: 'warning',
      icon: RotateCcw,
    })
    if (!ok) return
    form.setValues(DEFAULT_MENUS)
    toast.info('Padrão restaurado no rascunho', { description: 'Clique em Salvar alterações para publicar.' })
  }

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
            description="Cabeçalho do computador e barra do celular."
            actions={
              <Segmented<Viewer>
                size="sm"
                ariaLabel="Ver como"
                value={viewer}
                onChange={setViewer}
                options={[
                  { value: 'visitante', label: 'Visitante', icon: LogIn },
                  { value: 'logado', label: 'Logado', icon: UserRound },
                ]}
              />
            }
            footer={viewer === 'visitante' ? 'Vendo como visitante: itens "Só logados" ficam escondidos.' : 'Vendo como jogador logado: itens "Só visitantes" ficam escondidos.'}
          >
            <MenusPreview config={v} viewer={viewer} />
          </PreviewPanel>
        }
      >
        <FormFieldset readOnly={form.readOnly}>
          {(['header', 'mobile'] as MenuListId[]).map((list) => (
            <MenuListSection
              key={list}
              list={list}
              items={v[list]}
              canEdit={canEdit}
              onReorder={(items) => form.set(list, items)}
              onAdd={() => add(list)}
              onEdit={(item) => setEditing({ list, item, isNew: false })}
              onRemove={(item) => remove(list, item)}
            />
          ))}
        </FormFieldset>
      </EditorLayout>

      <SaveBar form={form} />

      {editing && (
        <MenuItemModal
          key={editing.item.id}
          list={editing.list}
          initial={editing.item}
          isNew={editing.isNew}
          readOnly={!canEdit}
          onClose={() => setEditing(null)}
          onApply={(item) => apply(editing.list, item, editing.isNew)}
        />
      )}
    </>
  )
}

function MenuListSection({
  list,
  items,
  canEdit,
  onReorder,
  onAdd,
  onEdit,
  onRemove,
}: {
  list: MenuListId
  items: SiteMenuItem[]
  canEdit: boolean
  onReorder: (items: SiteMenuItem[]) => void
  onAdd: () => void
  onEdit: (item: SiteMenuItem) => void
  onRemove: (item: SiteMenuItem) => void
}) {
  const { max, labelMax } = MENU_LIMITS[list]
  const full = items.length >= max
  const over = items.length > max
  const Icon = LIST_INFO[list].icon
  return (
    <EditorSection
      title={
        <span className="inline-flex items-center gap-2">
          <Icon size={16} className="text-fg-3" aria-hidden /> {MENU_LIST_LABEL[list]}
        </span>
      }
      description={LIST_INFO[list].description}
      aside={<p className="text-xs text-fg-3">Rótulo com até {labelMax} caracteres.</p>}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[160px] flex-1">
          <p className="text-[13px] text-fg-2">
            <strong className={cn('tnum', over ? 'text-danger' : 'text-fg')}>
              {items.length} de {max}
            </strong>{' '}
            itens
          </p>
          <Progress value={items.length} max={max} tone={over ? 'danger' : full ? 'warning' : 'primary'} className="mt-1.5 max-w-[240px]" label={`${items.length} de ${max} itens`} />
        </div>
        <Button
          icon={Plus}
          onClick={onAdd}
          disabled={!canEdit || full}
          title={!canEdit ? 'Seu cargo não pode editar esta tela' : full ? `Limite de ${max} itens` : undefined}
        >
          Adicionar item
        </Button>
      </div>

      {list === 'mobile' && full && !over && (
        <Alert tone="warning">A barra do celular está cheia. Para incluir outro item, remova um ou troque o rótulo e o link de um existente.</Alert>
      )}
      {over && (
        <Alert tone="danger" title={`${items.length - max} ${items.length - max === 1 ? 'item a mais' : 'itens a mais'}`}>
          {list === 'mobile' ? 'A barra do celular aceita no máximo 5 itens.' : `O cabeçalho aceita no máximo ${max} itens.`} Remova para salvar.
        </Alert>
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center">
          <p className="text-sm font-medium text-fg">Menu vazio</p>
          <p className="mt-0.5 text-[13px] text-fg-3">Adicione pelo menos um item para salvar.</p>
        </div>
      ) : (
        <SortableList
          items={items}
          getKey={(it) => it.id}
          onChange={onReorder}
          disabled={!canEdit}
          render={(it) => {
            const errs = menuItemErrors(it, list)
            const err = errs.label ?? errs.link
            return (
              <div className="flex items-center gap-3">
                <span className={cn('hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:flex', err ? 'bg-danger/10 text-danger' : 'bg-primary/10 text-primary-text')}>
                  <MenuIcon name={it.icon} size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-fg">
                    <button type="button" className="truncate text-left hover:underline" onClick={() => onEdit(it)}>
                      {it.label || <span className="text-danger">Sem rótulo</span>}
                    </button>
                    {it.audience !== 'todos' && <Badge tone={AUDIENCE_TONE[it.audience]}>{MENU_AUDIENCE_LABEL[it.audience]}</Badge>}
                  </p>
                  {err ? (
                    <p className="mt-0.5 truncate text-xs font-medium text-danger">{err}</p>
                  ) : (
                    <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-fg-3">
                      {it.linkType === 'url' ? <Globe size={12} className="shrink-0" aria-hidden /> : <Link2 size={12} className="shrink-0" aria-hidden />}
                      <span className="truncate">{linkSummary(it)}</span>
                    </p>
                  )}
                </div>
                <IconButton icon={Pencil} size="sm" label={`Editar ${it.label || 'item'}`} onClick={() => onEdit(it)} className="hidden sm:inline-flex" />
                <IconButton icon={Trash2} size="sm" variant="danger" label={`Remover ${it.label || 'item'}`} onClick={() => onRemove(it)} disabled={!canEdit} />
              </div>
            )
          }}
        />
      )}
    </EditorSection>
  )
}

function MenuItemModal({
  list,
  initial,
  isNew,
  readOnly,
  onClose,
  onApply,
}: {
  list: MenuListId
  initial: SiteMenuItem
  isNew: boolean
  readOnly: boolean
  onClose: () => void
  onApply: (item: SiteMenuItem) => void
}) {
  const [it, setIt] = useState<SiteMenuItem>(initial)
  const [touched, setTouched] = useState(false)
  const { labelMax } = MENU_LIMITS[list]
  const errors = menuItemErrors(it, list)
  const set = <K extends keyof SiteMenuItem>(k: K, val: SiteMenuItem[K]) => setIt((p) => ({ ...p, [k]: val }))
  const labelErr = touched || it.label.trim().length > labelMax ? errors.label : undefined
  const linkErr = touched || (it.linkType === 'url' && it.url.length > 8) ? errors.link : undefined

  const submit = () => {
    setTouched(true)
    if (Object.keys(errors).length) {
      toast.error('Revise o item', { description: errors.label ?? errors.link })
      return
    }
    onApply({ ...it, label: it.label.trim(), url: it.url.trim() })
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isNew ? `Novo item · ${MENU_LIST_LABEL[list]}` : `Editar "${initial.label || 'item'}"`}
      description="O item entra no rascunho. Clique em Salvar alterações para publicar."
      icon={list === 'header' ? Monitor : Smartphone}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={readOnly}>
            {isNew ? 'Adicionar item' : 'Aplicar'}
          </Button>
        </>
      }
    >
      <fieldset disabled={readOnly} className="min-w-0 space-y-5">
        <Field label="Rótulo" htmlFor="mi-label" required error={labelErr} hint={`${it.label.trim().length}/${labelMax} caracteres`}>
          <Input id="mi-label" value={it.label} onChange={(e) => set('label', e.target.value)} invalid={!!labelErr} placeholder={list === 'mobile' ? 'Ex.: Cassino' : 'Ex.: Promoções'} data-autofocus />
        </Field>

        <Field label="Ícone">
          <div role="radiogroup" aria-label="Ícone" className="grid grid-cols-7 gap-1.5 sm:grid-cols-11">
            {MENU_ICON_OPTIONS.map((o) => {
              const active = it.icon === o.key
              return (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={o.label}
                  title={o.label}
                  onClick={() => set('icon', o.key)}
                  className={cn(
                    'flex aspect-square items-center justify-center rounded-lg border transition-colors duration-150',
                    active ? 'border-primary bg-primary/10 text-primary-text shadow-ring' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg',
                  )}
                >
                  <MenuIcon name={o.key} size={17} />
                </button>
              )
            })}
          </div>
        </Field>

        <Field label="Link" error={linkErr}>
          <div className="space-y-2">
            <Segmented<SiteMenuItem['linkType']>
              ariaLabel="Tipo de link"
              value={it.linkType}
              onChange={(t) => set('linkType', t)}
              options={[
                { value: 'pagina', label: 'Página do site', icon: Link2 },
                { value: 'url', label: 'Endereço externo', icon: Globe },
              ]}
            />
            {it.linkType === 'pagina' ? (
              <Select aria-label="Página do site" value={it.page} onChange={(p) => set('page', p)} options={SITE_PAGES} placeholder="Escolha a página" />
            ) : (
              <Input aria-label="Endereço externo" value={it.url} onChange={(e) => set('url', e.target.value.trim())} invalid={!!linkErr} placeholder="https://" inputMode="url" />
            )}
            {it.linkType === 'url' && <p className="text-xs text-fg-3">Links externos abrem em outra aba. Use só endereços seguros (https).</p>}
          </div>
        </Field>

        <Field label="Visível para">
          <RadioCards<MenuAudience>
            name="Visível para"
            columns={3}
            value={it.audience}
            onChange={(a) => set('audience', a)}
            options={[
              { value: 'todos', label: 'Todos', description: 'Visitantes e logados.' },
              { value: 'logados', label: 'Só logados', description: 'Ex.: VIP, Carteira.' },
              { value: 'visitantes', label: 'Só visitantes', description: 'Ex.: Cadastre-se.' },
            ]}
          />
        </Field>
      </fieldset>
    </Modal>
  )
}

// ---------- Prévia ----------

function DesktopHeader({ items, viewer, palette: p, logo }: { items: SiteMenuItem[]; viewer: Viewer; palette: SitePalette; logo: string | null }) {
  return (
    <div style={{ background: p.surface, borderBottom: `1px solid ${p.line}` }}>
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5" style={{ borderBottom: `1px solid ${p.line}` }}>
        <SiteLogo src={logo} className="h-7 w-[58px]" style={{ color: p.text }} />
        {viewer === 'visitante' ? (
          <div className="flex items-center gap-1">
            <span className="rounded-md px-2 py-1 text-[9.5px] font-semibold" style={{ color: p.text, border: `1px solid ${p.line}` }}>
              Entrar
            </span>
            <span className="rounded-md px-2 py-1 text-[9.5px] font-bold" style={{ background: p.primary, color: p.onPrimary }}>
              Cadastrar
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <span className="rounded-md px-1.5 py-1 text-[9.5px] font-semibold tnum" style={{ background: p.surface2, color: p.text }}>
              R$ 250,00
            </span>
            <span className="rounded-md px-2 py-1 text-[9.5px] font-bold" style={{ background: p.primary, color: p.onPrimary }}>
              Depositar
            </span>
            <span className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold" style={{ background: p.surface2, color: p.text }}>
              JS
            </span>
          </div>
        )}
      </div>
      <nav aria-label="Cabeçalho do computador (prévia)" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5">
        {items.length === 0 ? (
          <span className="text-[9.5px]" style={{ color: p.muted }}>
            Nenhum item visível
          </span>
        ) : (
          items.map((it, i) => (
            <span key={it.id} className="relative flex items-center gap-1 py-0.5 text-[10px] font-semibold" style={{ color: i === 0 ? p.text : p.muted }}>
              <MenuIcon name={it.icon} size={11} />
              {it.label || '—'}
              {it.linkType === 'url' && <Globe size={8} aria-label="link externo" />}
              {i === 0 && <span className="absolute inset-x-0 -bottom-1 h-0.5 rounded-full" style={{ background: p.primary }} aria-hidden />}
            </span>
          ))
        )}
      </nav>
    </div>
  )
}

function MenusPreview({ config, viewer }: { config: MenusConfig; viewer: Viewer }) {
  const theme = useSiteTheme()
  const p = useSitePalette()
  const title = useSiteTitle()
  const header = visibleMenuItems(config.header, viewer)
  const bar = visibleMenuItems(config.mobile, viewer)
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-2">
          <Monitor size={13} aria-hidden /> Computador · {header.length} {header.length === 1 ? 'item visível' : 'itens visíveis'}
        </p>
        <BrowserFrame favicon={theme.favicon} title={title}>
          <div style={{ background: p.background }}>
            <DesktopHeader items={header} viewer={viewer} palette={p} logo={theme.logo} />
            <div className="grid grid-cols-6 gap-1 p-2.5" style={{ opacity: 0.5 }} aria-hidden>
              {[210, 250, 300, 330, 20, 160].map((h) => (
                <GameTileMock key={h} hue={h} />
              ))}
            </div>
          </div>
        </BrowserFrame>
      </div>
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-2">
          <Smartphone size={13} aria-hidden /> Celular · {bar.length} de 5 na barra
        </p>
        <PhoneFrame background={p.background}>
          <div className="flex items-center justify-between px-3 pb-1.5 pt-6" style={{ background: p.surface, borderBottom: `1px solid ${p.line}` }}>
            <SiteLogo src={theme.logo} className="h-6 w-[50px]" style={{ color: p.text }} />
            <span className="rounded-md px-2 py-0.5 text-[9px] font-bold" style={{ background: p.primary, color: p.onPrimary }}>
              {viewer === 'visitante' ? 'Entrar' : 'Depositar'}
            </span>
          </div>
          <div className="space-y-2 p-2" aria-hidden>
            <div className="aspect-[1372/476] rounded-md" style={{ background: `linear-gradient(120deg, ${p.primary}, ${p.surface})`, opacity: 0.7 }} />
            <div className="grid grid-cols-3 gap-1" style={{ opacity: 0.5 }}>
              {[40, 120, 200].map((h) => (
                <GameTileMock key={h} hue={h} />
              ))}
            </div>
          </div>
          <nav
            aria-label="Barra do celular (prévia)"
            className="grid px-1 pb-2.5 pt-1.5"
            style={{ gridTemplateColumns: `repeat(${Math.max(1, bar.length)}, minmax(0,1fr))`, background: p.surface, borderTop: `1px solid ${p.line}` }}
          >
            {bar.length === 0 ? (
              <span className="py-1 text-center text-[9px]" style={{ color: p.muted }}>
                Nenhum item visível
              </span>
            ) : (
              bar.map((it, i) => (
                <span key={it.id} className="flex min-w-0 flex-col items-center gap-0.5 text-[8.5px] font-semibold" style={{ color: i === 0 ? p.primary : p.muted }}>
                  <MenuIcon name={it.icon} size={15} />
                  <span className="max-w-full truncate">{it.label || '—'}</span>
                </span>
              ))
            )}
          </nav>
        </PhoneFrame>
      </div>
    </div>
  )
}
