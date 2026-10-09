import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Eye, ImageOff, LayoutTemplate, Link2, Pause, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Drawer,
  EmptyState,
  Field,
  FormGrid,
  IconButton,
  Input,
  KpiCard,
  PageHeader,
  Segmented,
  Select,
  SortableList,
  Switch,
  confirm,
  toast,
  type Tone,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { dateShort, num } from '@/lib/format'
import { uid } from '@/lib/random'
import { useCollection, useDb } from '@/lib/store'
import { dayKey } from '@/data/now'
import { audit, usePageAccess } from '@/domain/session'
import {
  BANNER_STATUS_LABEL,
  bannerErrors,
  bannerStatus,
  rgba,
  type Banner,
  type BannerPosition,
  type BannerPositionId,
  type BannerStatus,
  type SitePalette,
} from '@/domain/personalizacao-p1'
import { BANNER_POSITIONS, BANNER_POSITION_BY_ID, P1_KEYS, SITE_PAGES, SITE_PAGE_LABEL, seedBanners } from '@/data/personalizacao-p1'
import {
  BrowserFrame,
  EditorLayout,
  EmptySlot,
  GameTileMock,
  PreviewJumpButton,
  PreviewPanel,
  RatioImageUpload,
  SiteBlockTitle,
  SiteHeaderMock,
  SiteLogo,
  useSitePalette,
  useSiteTheme,
  useSiteTitle,
} from './_shared-p1'

const STATUS_TONE: Record<BannerStatus, Tone> = { no_ar: 'success', agendado: 'info', encerrado: 'neutral', pausado: 'warning' }

/** largura máxima da imagem no formulário, para formatos altos não estourarem */
const UPLOAD_CLASS: Record<BannerPositionId, string> = {
  hero: '',
  login: 'mx-auto max-w-[166px]',
  cadastro: 'mx-auto max-w-[166px]',
  compacto: '',
  deposito: 'max-w-[480px]',
  promocoes: '',
  lateral: 'mx-auto max-w-[125px]',
}

/** miniatura na lista: cabe em 128×44 mantendo a proporção da posição */
function thumbSize(pos: BannerPosition) {
  const ratio = pos.width / pos.height
  const width = Math.min(128, 44 * ratio)
  return { width: Math.round(width), height: Math.round(width / ratio) }
}

const fmtDay = (d: string) => dateShort(`${d}T12:00:00`)

function periodLabel(b: Banner) {
  if (b.startsAt && b.endsAt) return `${fmtDay(b.startsAt)} a ${fmtDay(b.endsAt)}`
  if (b.startsAt) return `a partir de ${fmtDay(b.startsAt)}`
  if (b.endsAt) return `até ${fmtDay(b.endsAt)}`
  return 'sem prazo'
}

function linkLabel(link: string) {
  if (!link) return 'Sem link'
  return SITE_PAGE_LABEL.get(link) ?? link.replace(/^https:\/\//, '')
}

export default function Banners() {
  const { canEdit } = usePageAccess()
  const banners = useCollection<Banner>(P1_KEYS.banners, seedBanners)
  const [showUnused, setShowUnused] = useDb<boolean>(P1_KEYS.bannersShowUnused, false)
  const [editing, setEditing] = useState<{ banner: Banner; isNew: boolean } | null>(null)
  const [previewPos, setPreviewPos] = useState<BannerPositionId>('hero')
  const today = dayKey(new Date())

  const byPos = useMemo(() => {
    const m = new Map<BannerPositionId, Banner[]>(BANNER_POSITIONS.map((p) => [p.id, []]))
    for (const b of banners.items) m.get(b.position)?.push(b)
    return m
  }, [banners.items])

  const counts = useMemo(() => {
    const c: Record<BannerStatus, number> = { no_ar: 0, agendado: 0, encerrado: 0, pausado: 0 }
    for (const b of banners.items) c[bannerStatus(b, today)]++
    return c
  }, [banners.items, today])

  const usedPositions = BANNER_POSITIONS.filter((p) => (byPos.get(p.id)?.length ?? 0) > 0)
  const hiddenCount = BANNER_POSITIONS.length - usedPositions.length
  const positions = showUnused ? BANNER_POSITIONS : usedPositions

  const startNew = (pos: BannerPosition) => {
    setEditing({
      isNew: true,
      banner: { id: uid('bn-'), position: pos.id, name: '', image: null, link: '', active: true, startsAt: null, endsAt: null, createdAt: new Date().toISOString() },
    })
    setPreviewPos(pos.id)
  }

  const save = (b: Banner, isNew: boolean) => {
    const pos = BANNER_POSITION_BY_ID.get(b.position)!
    if (isNew) {
      banners.add(b, 'end')
      audit('criar', `Banner "${b.name}"`, `${pos.label} · ${b.active ? 'ativo' : 'pausado'} · ${periodLabel(b)}`)
      toast.success('Banner criado', { description: `${pos.label} · ${BANNER_STATUS_LABEL[bannerStatus(b, today)]}` })
    } else {
      banners.update(b.id, b)
      audit('editar', `Banner "${b.name}"`, `${pos.label} · ${periodLabel(b)} · link ${linkLabel(b.link)}`)
      toast.success('Banner salvo', { description: 'A mudança já vale no site e foi registrada na auditoria.' })
    }
    setEditing(null)
    setPreviewPos(b.position)
  }

  const remove = async (b: Banner): Promise<boolean> => {
    const pos = BANNER_POSITION_BY_ID.get(b.position)!
    const ok = await confirm({
      title: `Excluir o banner "${b.name}"?`,
      description: `Ele sai da posição ${pos.label} na hora. Para só tirar do ar por um tempo, desligue o banner.`,
      confirmLabel: 'Excluir banner',
      tone: 'danger',
      icon: Trash2,
    })
    if (!ok) return false
    banners.remove(b.id)
    audit('excluir', `Banner "${b.name}"`, `Removido de ${pos.label}`)
    toast.success('Banner excluído')
    return true
  }

  const toggle = (b: Banner, active: boolean) => {
    banners.update(b.id, { active })
    audit(active ? 'ligar' : 'desligar', `Banner "${b.name}"`, `${BANNER_POSITION_BY_ID.get(b.position)!.label}`)
    toast.success(active ? 'Banner ligado' : 'Banner pausado', {
      description: active ? BANNER_STATUS_LABEL[bannerStatus({ ...b, active }, today)] : 'Saiu do site até ser ligado de novo.',
    })
  }

  const reorder = (pos: BannerPosition, list: Banner[]) => {
    const others = banners.items.filter((b) => b.position !== pos.id)
    banners.replace([...others, ...list])
    audit('editar', `Banners · ${pos.label}`, `Nova ordem: ${list.map((b) => b.name).join(', ')}`)
    toast.success('Ordem salva', { description: pos.rotation === 'carrossel' ? 'O carrossel segue esta ordem.' : 'Os banners alternam nesta ordem.' })
  }

  return (
    <>
      <PageHeader actions={<PreviewJumpButton />} />

      <EditorLayout
        preview={
          <PreviewPanel
            description="Só banners no ar aparecem, na ordem da lista."
            actions={
              <Select
                aria-label="Posição na prévia"
                value={previewPos}
                onChange={(v) => setPreviewPos(v as BannerPositionId)}
                options={BANNER_POSITIONS.map((p) => ({ value: p.id, label: p.label }))}
                className="w-[170px]"
              />
            }
            footer={
              <>
                {BANNER_POSITION_BY_ID.get(previewPos)!.where}. Tamanho fixo de {BANNER_POSITION_BY_ID.get(previewPos)!.width}×{BANNER_POSITION_BY_ID.get(previewPos)!.height} px.
              </>
            }
          >
            <PositionPreview pos={BANNER_POSITION_BY_ID.get(previewPos)!} banners={(byPos.get(previewPos) ?? []).filter((b) => bannerStatus(b, today) === 'no_ar')} />
          </PreviewPanel>
        }
      >
        <section aria-label="Resumo dos banners" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <KpiCard label="No ar" icon={CheckCircle2} tone="success" value={num(counts.no_ar)} hint="ativos no período" />
          <KpiCard label="Agendados" icon={CalendarClock} tone="info" value={num(counts.agendado)} hint="entram sozinhos" />
          <KpiCard label="Pausados" icon={Pause} tone="warning" value={num(counts.pausado)} hint={counts.encerrado === 1 ? '1 encerrado' : `${num(counts.encerrado)} encerrados`} />
          <KpiCard label="Posições usadas" icon={LayoutTemplate} tone="primary" value={`${usedPositions.length} de ${BANNER_POSITIONS.length}`} hint="com banner" />
        </section>

        <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Checkbox
            checked={showUnused}
            onChange={setShowUnused}
            label="Mostrar posições não usadas"
            description={
              showUnused
                ? 'Todas as 7 posições aparecem, inclusive as sem banner.'
                : hiddenCount
                  ? `${hiddenCount} ${hiddenCount === 1 ? 'posição sem banner está escondida' : 'posições sem banner estão escondidas'}.`
                  : 'Todas as posições têm banner.'
            }
          />
          <p className="text-xs text-fg-3">Cada posição tem tamanho fixo. Imagem fora da proporção é recusada.</p>
        </div>

        {positions.length === 0 && (
          <Card>
            <EmptyState
              icon={ImageOff}
              title="Nenhum banner cadastrado"
              description="Marque “Mostrar posições não usadas” para escolher onde criar o primeiro banner."
              action={<Button onClick={() => setShowUnused(true)}>Mostrar posições</Button>}
            />
          </Card>
        )}

        {positions.map((pos) => {
          const list = byPos.get(pos.id) ?? []
          const live = list.filter((b) => bannerStatus(b, today) === 'no_ar').length
          const full = list.length >= pos.max
          return (
            <Card key={pos.id} className={cn(previewPos === pos.id && 'border-primary/50')}>
              <div className="flex flex-wrap items-start gap-3 px-5 pb-3 pt-4">
                <PositionThumb id={pos.id} className="h-12 w-[72px] shrink-0" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[15px] font-semibold leading-6 text-fg">{pos.label}</h2>
                  <p className="text-[13px] leading-5 text-fg-3">{pos.where}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge>
                      <span className="tnum">
                        {pos.width}×{pos.height} px
                      </span>
                    </Badge>
                    <Badge>{pos.rotation === 'carrossel' ? `Carrossel, até ${pos.max}` : `Até ${pos.max}, um por visita`}</Badge>
                    <Badge tone={live ? 'success' : 'neutral'} dot>
                      {live ? `${live} no ar` : 'Nada no ar'}
                    </Badge>
                  </div>
                </div>
                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                  <Button size="sm" variant={previewPos === pos.id ? 'soft' : 'ghost'} icon={Eye} onClick={() => setPreviewPos(pos.id)} aria-pressed={previewPos === pos.id}>
                    Ver na prévia
                  </Button>
                  <Button
                    size="sm"
                    icon={Plus}
                    onClick={() => startNew(pos)}
                    disabled={!canEdit || full}
                    title={!canEdit ? 'Seu cargo não pode editar esta tela' : full ? `Limite de ${pos.max} banners nesta posição` : undefined}
                  >
                    Novo banner
                  </Button>
                </div>
              </div>
              <div className="px-5 pb-5">
                {list.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center">
                    <p className="text-sm font-medium text-fg">Posição sem banner</p>
                    <p className="mt-0.5 text-[13px] text-fg-3">Sem banner, o espaço some do site e o conteúdo ao redor se ajusta.</p>
                  </div>
                ) : (
                  <SortableList
                    items={list}
                    getKey={(b) => b.id}
                    onChange={(next) => reorder(pos, next)}
                    disabled={!canEdit}
                    render={(b) => {
                      const st = bannerStatus(b, today)
                      return (
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setEditing({ banner: b, isNew: false })}
                            className="hidden shrink-0 overflow-hidden rounded-md bg-surface-3 ring-1 ring-inset ring-line sm:block"
                            style={thumbSize(pos)}
                            aria-label={`Editar ${b.name}`}
                          >
                            {b.image ? <img src={b.image} alt="" className="h-full w-full object-cover" /> : <ImageOff size={14} className="m-auto text-fg-3" aria-hidden />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-fg">
                              <button type="button" className="truncate text-left hover:underline" onClick={() => setEditing({ banner: b, isNew: false })}>
                                {b.name}
                              </button>
                              <Badge tone={STATUS_TONE[st]} dot>
                                {BANNER_STATUS_LABEL[st]}
                              </Badge>
                            </p>
                            <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-fg-3">
                              <Link2 size={12} className="shrink-0" aria-hidden />
                              <span className="truncate">
                                {linkLabel(b.link)} · {periodLabel(b)}
                              </span>
                            </p>
                          </div>
                          <Switch size="sm" checked={b.active} onChange={(on) => toggle(b, on)} disabled={!canEdit} ariaLabel={`Banner ${b.name} ativo`} />
                          <IconButton icon={Pencil} size="sm" label={`Editar ${b.name}`} onClick={() => setEditing({ banner: b, isNew: false })} className="hidden sm:inline-flex" />
                          <IconButton icon={Trash2} size="sm" variant="danger" label={`Excluir ${b.name}`} onClick={() => remove(b)} disabled={!canEdit} className="hidden sm:inline-flex" />
                        </div>
                      )
                    }}
                  />
                )}
              </div>
            </Card>
          )
        })}
      </EditorLayout>

      {editing && (
        <BannerDrawer
          key={editing.banner.id}
          initial={editing.banner}
          isNew={editing.isNew}
          readOnly={!canEdit}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={
            editing.isNew
              ? undefined
              : async () => {
                  if (await remove(editing.banner)) setEditing(null)
                }
          }
        />
      )}
    </>
  )
}

// ---------- Formulário do banner ----------

type LinkMode = 'nenhum' | 'pagina' | 'url'

function BannerDrawer({
  initial,
  isNew,
  readOnly,
  onClose,
  onSave,
  onDelete,
}: {
  initial: Banner
  isNew: boolean
  readOnly: boolean
  onClose: () => void
  onSave: (b: Banner, isNew: boolean) => void
  onDelete?: () => void
}) {
  const [b, setB] = useState<Banner>(initial)
  const [touched, setTouched] = useState(false)
  const [linkMode, setLinkMode] = useState<LinkMode>(!initial.link ? 'nenhum' : initial.link.startsWith('/') ? 'pagina' : 'url')
  const pos = BANNER_POSITION_BY_ID.get(b.position)!
  const errors = bannerErrors(b)
  const show = (k: keyof typeof errors) => (touched || (k === 'period' && b.startsAt && b.endsAt) || (k === 'link' && linkMode === 'url' && b.link) ? errors[k] : undefined)
  const status = bannerStatus(b, dayKey(new Date()))
  const set = <K extends keyof Banner>(k: K, val: Banner[K]) => setB((prev) => ({ ...prev, [k]: val }))

  const submit = () => {
    setTouched(true)
    if (Object.keys(errors).length) {
      toast.error('Revise os campos', { description: Object.values(errors)[0] })
      return
    }
    onSave({ ...b, name: b.name.trim(), link: b.link.trim() }, isNew)
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={isNew ? `Novo banner · ${pos.label}` : b.name || 'Banner'}
      description={`${pos.where} · ${pos.width}×${pos.height} px`}
      headerExtra={
        <Badge tone={STATUS_TONE[status]} dot size="md">
          {BANNER_STATUS_LABEL[status]}
        </Badge>
      }
      footer={
        <>
          {onDelete && (
            <Button variant="ghost" icon={Trash2} onClick={onDelete} disabled={readOnly} className="mr-auto text-danger">
              Excluir
            </Button>
          )}
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={readOnly}>
            {isNew ? 'Criar banner' : 'Salvar banner'}
          </Button>
        </>
      }
    >
      <fieldset disabled={readOnly} className="min-w-0 space-y-5">
        <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-3">
          <PositionThumb id={pos.id} className="h-12 w-[72px] shrink-0" />
          <p className="text-[13px] leading-5 text-fg-2">
            <strong className="text-fg">{pos.label}</strong>: {pos.rotation === 'carrossel' ? `carrossel com até ${pos.max} banners, passa sozinho.` : `até ${pos.max} banners, um por visita.`}
          </p>
        </div>

        <Field label="Nome interno" htmlFor="bn-name" required hint="Só aparece no painel." error={show('name')}>
          <Input id="bn-name" value={b.name} maxLength={60} onChange={(e) => set('name', e.target.value)} invalid={!!show('name')} placeholder="Ex.: Boas-vindas outubro" data-autofocus />
        </Field>

        <div>
          <RatioImageUpload
            label="Imagem"
            width={pos.width}
            height={pos.height}
            value={b.image}
            onChange={(url) => set('image', url)}
            disabled={readOnly}
            previewClassName={UPLOAD_CLASS[pos.id]}
            hint={`${pos.width}×${pos.height} px ou maior, na mesma proporção`}
          />
          {show('image') && (
            <p className="mt-1.5 text-xs font-medium text-danger" role="alert">
              {show('image')}
            </p>
          )}
        </div>

        <Field label="Ao clicar" error={show('link')}>
          <div className="space-y-2">
            <Segmented<LinkMode>
              ariaLabel="Destino do clique"
              value={linkMode}
              onChange={(m) => {
                setLinkMode(m)
                set('link', m === 'nenhum' ? '' : m === 'pagina' ? '/promocoes' : 'https://')
              }}
              options={[
                { value: 'nenhum', label: 'Sem link' },
                { value: 'pagina', label: 'Página do site' },
                { value: 'url', label: 'Endereço externo' },
              ]}
            />
            {linkMode === 'pagina' && (
              <Select aria-label="Página do site" value={b.link} onChange={(v) => set('link', v)} options={SITE_PAGES} />
            )}
            {linkMode === 'url' && (
              <Input aria-label="Endereço externo" value={b.link} onChange={(e) => set('link', e.target.value.trim())} invalid={!!show('link')} placeholder="https://" inputMode="url" />
            )}
          </div>
        </Field>

        <FormGrid>
          <Field label="Início" htmlFor="bn-start" hint="Vazio: entra no ar ao salvar.">
            <Input id="bn-start" type="date" value={b.startsAt ?? ''} onChange={(e) => set('startsAt', e.target.value || null)} />
          </Field>
          <Field label="Fim" htmlFor="bn-end" hint="Vazio: sem data para sair." error={show('period')}>
            <Input id="bn-end" type="date" value={b.endsAt ?? ''} min={b.startsAt ?? undefined} onChange={(e) => set('endsAt', e.target.value || null)} invalid={!!show('period')} />
          </Field>
        </FormGrid>

        <Switch
          label="Ativo"
          description={b.active ? 'Aparece no site dentro do período.' : 'Pausado: não aparece, mesmo dentro do período.'}
          checked={b.active}
          onChange={(on) => set('active', on)}
        />

        {status === 'encerrado' && <Alert tone="neutral">O período já terminou. Mude a data de fim para o banner voltar ao ar.</Alert>}
      </fieldset>
    </Drawer>
  )
}

// ---------- Miniatura da posição na página ----------

function PositionThumb({ id, className }: { id: BannerPositionId; className?: string }) {
  const hl = 'fill-primary'
  const blk = 'fill-line-strong/70'
  const page = (
    <>
      <rect x="0.5" y="0.5" width="71" height="47" rx="4" className="fill-surface-2 stroke-line-strong" />
      <rect x="0.5" y="0.5" width="71" height="7" rx="4" className="fill-surface-3" />
      <rect x="4" y="3" width="10" height="2" rx="1" className={blk} />
    </>
  )
  const tiles = (y: number, w = 64, x = 4, n = 5) =>
    Array.from({ length: n }, (_, i) => <rect key={`${y}-${i}`} x={x + (i * w) / n} y={y} width={w / n - 1.5} height="8" rx="1.5" className={blk} />)
  const modal = (lines: number) => (
    <>
      {page}
      <rect x="0.5" y="0.5" width="71" height="47" rx="4" className="fill-fg/10" />
      <rect x="16" y="8" width="40" height="34" rx="3" className="fill-surface stroke-line-strong" />
      <rect x="18" y="10" width="15" height="30" rx="2" className={hl} />
      {Array.from({ length: lines }, (_, i) => (
        <rect key={i} x="36" y={13 + i * 5} width="17" height="2.5" rx="1" className={blk} />
      ))}
    </>
  )
  let body
  switch (id) {
    case 'hero':
      body = (
        <>
          {page}
          <rect x="4" y="10" width="64" height="18" rx="2" className={hl} />
          {tiles(32)}
        </>
      )
      break
    case 'compacto':
      body = (
        <>
          {page}
          {tiles(10)}
          <rect x="4" y="21" width="40" height="8" rx="2" className={hl} />
          {tiles(32)}
        </>
      )
      break
    case 'lateral':
      body = (
        <>
          {page}
          <rect x="4" y="10" width="46" height="13" rx="2" className={blk} />
          {tiles(26, 46, 4, 4)}
          {tiles(36, 46, 4, 4)}
          <rect x="53" y="10" width="15" height="34" rx="2" className={hl} />
        </>
      )
      break
    case 'login':
      body = modal(4)
      break
    case 'cadastro':
      body = modal(5)
      break
    case 'deposito':
      body = (
        <>
          {page}
          <rect x="0.5" y="0.5" width="71" height="47" rx="4" className="fill-fg/10" />
          <rect x="20" y="7" width="32" height="37" rx="3" className="fill-surface stroke-line-strong" />
          <rect x="22" y="9" width="28" height="13" rx="2" className={hl} />
          {[0, 1, 2].map((i) => (
            <rect key={i} x={22 + i * 9.6} y="25" width="8" height="5" rx="1.5" className={blk} />
          ))}
          <rect x="22" y="34" width="28" height="6" rx="1.5" className={blk} />
        </>
      )
      break
    case 'promocoes':
      body = (
        <>
          {page}
          <rect x="4" y="10" width="64" height="16" rx="2" className={hl} />
          <rect x="4" y="30" width="31" height="13" rx="2" className={blk} />
          <rect x="37" y="30" width="31" height="13" rx="2" className={blk} />
        </>
      )
      break
  }
  return (
    <svg viewBox="0 0 72 48" className={className} role="img" aria-label={`Onde fica: ${BANNER_POSITION_BY_ID.get(id)!.where}`}>
      {body}
    </svg>
  )
}

// ---------- Prévia da posição ----------

function RotatingBanner({ pos, banners, palette: p, className }: { pos: BannerPosition; banners: Banner[]; palette: SitePalette; className?: string }) {
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const n = banners.length
  const idx = n ? i % n : 0
  useEffect(() => {
    if (pos.rotation !== 'carrossel' || n < 2 || paused) return
    const t = setInterval(() => setI((x) => x + 1), 3500)
    return () => clearInterval(t)
  }, [pos.rotation, n, paused])
  if (!n) {
    return (
      <EmptySlot palette={p} className={className} style={{ aspectRatio: `${pos.width} / ${pos.height}` }}>
        Nenhum banner no ar nesta posição
      </EmptySlot>
    )
  }
  const cur = banners[idx]
  return (
    <div className={cn('relative overflow-hidden rounded-md', className)} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {cur.image ? (
        <img src={cur.image} alt={cur.name} className="block w-full object-cover" style={{ aspectRatio: `${pos.width} / ${pos.height}` }} />
      ) : (
        <EmptySlot palette={p} style={{ aspectRatio: `${pos.width} / ${pos.height}` }}>
          Sem imagem
        </EmptySlot>
      )}
      {n > 1 && (
        <>
          <button
            type="button"
            onClick={() => setI(idx - 1 + n)}
            aria-label="Banner anterior"
            className="absolute left-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full"
            style={{ background: 'rgba(0,0,0,.45)', color: '#FFFFFF' }}
          >
            <ChevronLeft size={12} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setI(idx + 1)}
            aria-label="Próximo banner"
            className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full"
            style={{ background: 'rgba(0,0,0,.45)', color: '#FFFFFF' }}
          >
            <ChevronRight size={12} aria-hidden />
          </button>
          <span className="absolute inset-x-0 bottom-1 flex justify-center gap-1">
            {banners.map((b, k) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setI(k)}
                aria-label={`Ver ${b.name}`}
                aria-pressed={k === idx}
                className="h-1.5 rounded-full transition-all"
                style={{ width: k === idx ? 14 : 6, background: k === idx ? '#FFFFFF' : 'rgba(255,255,255,.5)' }}
              />
            ))}
          </span>
        </>
      )}
      {pos.rotation === 'alterna' && n > 1 && (
        <span className="absolute left-1 top-1 rounded px-1 py-0.5 text-[8px] font-semibold" style={{ background: 'rgba(0,0,0,.55)', color: '#FFFFFF' }}>
          Visita {idx + 1} de {n}
        </span>
      )}
    </div>
  )
}

function PositionPreview({ pos, banners }: { pos: BannerPosition; banners: Banner[] }) {
  const theme = useSiteTheme()
  const p = useSitePalette()
  const title = useSiteTitle()
  const tiles = (n: number, base = 200) => (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0,1fr))`, opacity: 0.5 }} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <GameTileMock key={i} hue={(base + i * 37) % 360} />
      ))}
    </div>
  )
  const banner = <RotatingBanner key={pos.id} pos={pos} banners={banners} palette={p} />
  const path = pos.id === 'promocoes' ? '/promocoes' : pos.id === 'login' ? '/entrar' : pos.id === 'cadastro' ? '/cadastro' : pos.id === 'deposito' ? '/carteira/deposito' : ''

  let content
  if (pos.id === 'hero' || pos.id === 'compacto') {
    content = (
      <div className="space-y-2.5 p-2.5">
        {pos.id === 'hero' ? (
          banner
        ) : (
          <>
            <div className="h-16 rounded-md" style={{ background: p.surface, opacity: 0.5 }} aria-hidden />
            {tiles(6)}
            <div className="mx-auto max-w-[260px]">{banner}</div>
          </>
        )}
        <div style={{ opacity: 0.6 }}>
          <SiteBlockTitle palette={p}>Jogos em destaque</SiteBlockTitle>
        </div>
        {tiles(6, 20)}
      </div>
    )
  } else if (pos.id === 'lateral') {
    content = (
      <div className="flex gap-2 p-2.5">
        <div className="min-w-0 flex-1 space-y-2" aria-hidden>
          <div className="aspect-[1372/476] rounded-md" style={{ background: p.surface, opacity: 0.5 }} />
          {tiles(4)}
          {tiles(4, 90)}
          {tiles(4, 300)}
        </div>
        <div className="w-[34%] shrink-0">{banner}</div>
      </div>
    )
  } else if (pos.id === 'promocoes') {
    content = (
      <div className="space-y-2.5 p-2.5">
        <p className="text-[13px] font-extrabold" style={{ color: p.text }}>
          Promoções
        </p>
        {banner}
        <div className="grid grid-cols-2 gap-1.5" style={{ opacity: 0.55 }} aria-hidden>
          {[265, 160].map((h) => (
            <div key={h} className="rounded-md p-2" style={{ background: p.surface, border: `1px solid ${p.line}` }}>
              <span className="block h-8 rounded" style={{ background: `linear-gradient(140deg, hsl(${h} 60% 45%), hsl(${h + 30} 55% 25%))` }} />
              <span className="mt-1.5 block h-1.5 w-3/4 rounded-full" style={{ background: p.text, opacity: 0.6 }} />
            </div>
          ))}
        </div>
      </div>
    )
  } else {
    // janelas: login, cadastro e depósito
    const fields = pos.id === 'login' ? ['E-mail ou CPF', 'Senha'] : pos.id === 'cadastro' ? ['CPF', 'E-mail', 'Celular', 'Senha'] : []
    content = (
      <div className="relative p-3" style={{ background: rgba('#000000', 0.55) }}>
        {pos.id === 'deposito' ? (
          <div className="mx-auto max-w-[250px] space-y-2 rounded-xl p-3" style={{ background: p.surface, border: `1px solid ${p.line}` }}>
            <p className="text-[11.5px] font-bold" style={{ color: p.text }}>
              Depositar
            </p>
            {banner}
            <div className="grid grid-cols-4 gap-1">
              {['R$ 20', 'R$ 50', 'R$ 100', 'R$ 200'].map((v, i) => (
                <span
                  key={v}
                  className="rounded-md py-1 text-center text-[9px] font-bold"
                  style={i === 1 ? { background: rgba(p.primary, 0.2), color: p.text, border: `1px solid ${p.primary}` } : { background: p.surface2, color: p.text, border: `1px solid ${p.line}` }}
                >
                  {v}
                </span>
              ))}
            </div>
            <div className="rounded-md py-1.5 text-center text-[10px] font-bold" style={{ background: p.primary, color: p.onPrimary }}>
              Gerar PIX de R$ 50,00
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-[330px] overflow-hidden rounded-xl" style={{ background: p.surface, border: `1px solid ${p.line}` }}>
            <div className="w-[42%] shrink-0">
              <RotatingBanner key={pos.id} pos={pos} banners={banners} palette={p} className="rounded-none" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5 p-2.5">
              <SiteLogo src={theme.logo} className="h-7 w-[60px]" style={{ color: p.text }} />
              <p className="text-[11px] font-bold" style={{ color: p.text }}>
                {pos.id === 'login' ? 'Entrar' : 'Criar conta'}
              </p>
              {fields.map((f) => (
                <div key={f} className="rounded px-1.5 py-1 text-[8.5px]" style={{ background: p.surface2, border: `1px solid ${p.line}`, color: p.muted }}>
                  {f}
                </div>
              ))}
              <div className="rounded py-1 text-center text-[9.5px] font-bold" style={{ background: p.primary, color: p.onPrimary }}>
                {pos.id === 'login' ? 'Entrar' : 'Cadastrar'}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <BrowserFrame favicon={theme.favicon} title={title} path={path}>
      <div style={{ background: p.background }}>
        <SiteHeaderMock palette={p} logo={theme.logo} active={pos.id === 'promocoes' ? 4 : 0} />
        {content}
      </div>
    </BrowserFrame>
  )
}
