import { useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  Building2,
  ChevronRight,
  Clapperboard,
  Copy,
  Eye,
  EyeOff,
  Hand,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Smartphone,
  Sparkles,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Drawer,
  EmptyState,
  Field,
  FormFieldset,
  FormGrid,
  IconButton,
  Input,
  KpiCard,
  Menu,
  NumberInput,
  PageHeader,
  RadioCards,
  Select,
  SortableList,
  Switch,
  confirm,
  toast,
} from '@/components/ui'
import { num, relative } from '@/lib/format'
import { cn } from '@/lib/cn'
import { uid } from '@/lib/random'
import { useCollection, useDb } from '@/lib/store'
import { useGames, useProviders } from '@/data/hooks'
import { GAME_CATEGORY_LABEL, type Game, type Provider } from '@/data/catalog'
import { CASSINO_KEYS, seedGameBadges, seedShowcases } from '@/data/cassino'
import { audit, usePageAccess, useSession } from '@/domain/session'
import {
  SHOWCASE_LIMITS,
  SHOWCASE_TYPE_HINT,
  SHOWCASE_TYPE_LABEL,
  gameHiddenReason,
  resolveShowcase,
  validateShowcase,
  weeklyGgrByGame,
  type GameBadge,
  type ResolvedShowcase,
  type Showcase,
  type ShowcaseDraft,
  type ShowcaseType,
} from '@/domain/cassino'
import { CoverStrip, GameCover, OrderBar } from './_shared'

const TYPE_ICON: Record<ShowcaseType, LucideIcon> = {
  manual: Hand,
  mais_jogados: TrendingUp,
  ao_vivo: Clapperboard,
  novos: Sparkles,
  por_provedora: Building2,
}

const NO_EDIT = 'Seu cargo pode ver, mas não editar vitrines'

export default function Vitrines() {
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  const showcases = useCollection<Showcase>(CASSINO_KEYS.showcases, seedShowcases)
  const { items: games } = useGames()
  const { items: providers } = useProviders()
  const [badgesMap] = useDb<Record<string, GameBadge[]>>(CASSINO_KEYS.gameBadges, seedGameBadges)
  const weekly = useMemo(() => weeklyGgrByGame(), [])
  const [order, setOrder] = useState<string[] | null>(null)
  const [editing, setEditing] = useState<Showcase | 'new' | null>(null)

  const pmap = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers])
  const providerName = (g: Game) => pmap.get(g.providerId)?.name
  const badgesOf = (g: Game) => badgesMap[g.id] ?? []

  // ordem exibida: rascunho (se houver) + vitrines novas no fim
  const ordered = useMemo(() => {
    if (!order) return showcases.items
    const byId = new Map(showcases.items.map((s) => [s.id, s]))
    const list = order.map((id) => byId.get(id)).filter((s): s is Showcase => !!s)
    return [...list, ...showcases.items.filter((s) => !order.includes(s.id))]
  }, [order, showcases.items])
  const orderDirty = !!order && ordered.map((s) => s.id).join() !== showcases.items.map((s) => s.id).join()

  const resolved = useMemo(() => {
    const m = new Map<string, ResolvedShowcase>()
    for (const s of showcases.items) m.set(s.id, resolveShowcase(s, games, providers, weekly))
    return m
  }, [showcases.items, games, providers, weekly])

  const visible = ordered.filter((s) => s.visible)
  const gamesOnHome = new Set(visible.flatMap((s) => resolved.get(s.id)?.games.map((g) => g.id) ?? []))
  const withIssues = showcases.items.filter((s) => {
    const r = resolved.get(s.id)
    return r && (r.hiddenPicked.length > 0 || r.games.length < Math.min(s.limit, SHOWCASE_LIMITS.min))
  })
  const automatic = showcases.items.filter((s) => s.type !== 'manual').length

  const saveOrder = () => {
    if (!canEdit) return
    showcases.replace(ordered)
    audit('editar', 'Vitrines de jogos', `Nova ordem na home: ${ordered.map((s, i) => `${i + 1}. ${s.name}`).join(', ')}`)
    setOrder(null)
    toast.success('Ordem salva', { description: 'A home já mostra as vitrines na nova ordem.' })
  }

  const toggleVisible = async (s: Showcase, next: boolean) => {
    if (!canEdit) {
      toast.error(NO_EDIT)
      return
    }
    if (!next && showcases.items.filter((x) => x.visible && x.id !== s.id).length === 0) {
      const ok = await confirm({
        title: 'Ocultar a última vitrine?',
        description: 'A home fica sem nenhuma vitrine de jogos. Os jogadores só acham jogos pela busca e pelo menu.',
        confirmLabel: 'Ocultar mesmo assim',
        tone: 'warning',
        icon: EyeOff,
      })
      if (!ok) return
    }
    showcases.update(s.id, { visible: next, updatedAt: new Date().toISOString() })
    audit(next ? 'ligar' : 'desligar', `Vitrine ${s.name}`, next ? 'Vitrine exibida na home' : 'Vitrine ocultada da home')
    toast.success(next ? 'Vitrine exibida na home' : 'Vitrine ocultada', { description: s.name })
  }

  const remove = async (s: Showcase) => {
    const ok = await confirm({
      title: `Excluir a vitrine "${s.name}"?`,
      description: 'Ela sai da home na hora. Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir vitrine',
      tone: 'danger',
      icon: Trash2,
    })
    if (!ok) return
    showcases.remove(s.id)
    setOrder((o) => (o ? o.filter((id) => id !== s.id) : o))
    audit('excluir', `Vitrine ${s.name}`, `Vitrine ${SHOWCASE_TYPE_LABEL[s.type].toLowerCase()} excluída`)
    toast.success('Vitrine excluída', { description: s.name })
  }

  const duplicate = (s: Showcase, author: string) => {
    let name = `${s.name} (cópia)`.slice(0, 40)
    let n = 2
    while (showcases.items.some((x) => x.name === name)) name = `${s.name} (cópia ${n++})`.slice(0, 40)
    const copy: Showcase = { ...s, id: uid('vt-'), name, visible: false, updatedAt: new Date().toISOString(), updatedBy: author }
    showcases.add(copy, 'end')
    audit('criar', `Vitrine ${name}`, `Cópia de "${s.name}" criada oculta`)
    toast.success('Vitrine duplicada', { description: `"${name}" foi criada oculta, no fim da lista.` })
  }

  return (
    <>
      <PageHeader
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')} disabled={!canEdit} title={!canEdit ? NO_EDIT : undefined}>
            Nova vitrine
          </Button>
        }
      />

      <section aria-label="Resumo das vitrines" className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Vitrines" icon={LayoutGrid} value={num(showcases.items.length)} hint={`${visible.length} visíveis na home`} />
        <KpiCard label="Jogos na home" icon={Eye} tone="success" value={num(gamesOnHome.size)} hint="sem contar repetidos" formula={<>Jogos únicos somando todas as vitrines visíveis. Jogos desativados ou de provedoras pausadas nunca entram.</>} />
        <KpiCard label="Automáticas" icon={TrendingUp} tone="info" value={num(automatic)} hint={showcases.items.length - automatic === 1 ? '1 manual' : `${showcases.items.length - automatic} manuais`} />
        <KpiCard
          label="Precisam de atenção"
          icon={AlertTriangle}
          tone={withIssues.length ? 'warning' : 'neutral'}
          value={num(withIssues.length)}
          hint={withIssues.length ? withIssues.map((s) => s.name).join(', ') : 'Tudo certo'}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader
            title="Ordem de exibição"
            description="Arraste ou use as setas. A primeira vitrine aparece logo abaixo do banner da home."
            icon={LayoutGrid}
          />
          <CardBody>
            {ordered.length === 0 ? (
              <EmptyState
                icon={LayoutGrid}
                title="Nenhuma vitrine criada"
                description="Crie uma vitrine para mostrar jogos em destaque na home."
                action={
                  <Button variant="primary" icon={Plus} onClick={() => setEditing('new')} disabled={!canEdit}>
                    Nova vitrine
                  </Button>
                }
              />
            ) : (
              <SortableList
                items={ordered}
                getKey={(s) => s.id}
                disabled={!canEdit}
                onChange={(list) => setOrder(list.map((s) => s.id))}
                render={(s) => {
                  const r = resolved.get(s.id)
                  const Icon = TYPE_ICON[s.type]
                  const short = r && r.games.length < s.limit
                  return (
                    <div className={cn('min-w-0 py-1', !s.visible && 'opacity-60')}>
                      {/* no celular os botões descem para a linha de baixo: o nome e o resumo ficavam numa coluna de 40 px */}
                      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 sm:flex-nowrap">
                        <span className="mt-0.5 hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-text sm:flex">
                          <Icon size={17} aria-hidden />
                        </span>
                        <div className="min-w-[11rem] flex-1">
                          <p className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-semibold text-fg">{s.name}</span>
                            {!s.visible && (
                              <Badge icon={EyeOff} size="sm">
                                Oculta
                              </Badge>
                            )}
                            {r && r.hiddenPicked.length > 0 && (
                              <Badge tone="warning" icon={AlertTriangle}>
                                {`${r.hiddenPicked.length} fora do site`}
                              </Badge>
                            )}
                          </p>
                          <p className="mt-0.5 text-xs text-fg-3">
                            {SHOWCASE_TYPE_LABEL[s.type]}
                            {s.type === 'por_provedora' && s.providerId ? ` · ${pmap.get(s.providerId)?.name ?? s.providerId}` : ''} ·{' '}
                            <span className={cn(short && 'font-medium text-warning')}>
                              {r?.games.length ?? 0} de {s.limit} jogos
                            </span>
                          </p>
                        </div>
                        <div className="ml-auto flex shrink-0 items-center gap-1">
                          <span title={!canEdit ? NO_EDIT : s.visible ? 'Ocultar da home' : 'Exibir na home'} className="mr-1 inline-flex">
                            <Switch size="sm" checked={s.visible} onChange={(v) => toggleVisible(s, v)} disabled={!canEdit} ariaLabel={`${s.visible ? 'Ocultar' : 'Exibir'} ${s.name} na home`} />
                          </span>
                          <IconButton icon={Pencil} label={`Editar ${s.name}`} size="sm" onClick={() => setEditing(s)} />
                          <Menu
                            items={[
                              { label: 'Editar', icon: Pencil, onSelect: () => setEditing(s) },
                              { label: 'Duplicar', icon: Copy, onSelect: () => duplicate(s, user.name), disabled: !canEdit },
                              { divider: true },
                              { label: 'Excluir', icon: Trash2, danger: true, onSelect: () => remove(s), disabled: !canEdit },
                            ]}
                            trigger={(tp) => <IconButton {...tp} icon={MoreHorizontal} label={`Mais ações de ${s.name}`} size="sm" />}
                          />
                        </div>
                      </div>
                      <CoverStrip
                        className="mt-2.5 sm:pl-12"
                        games={r?.games ?? []}
                        providerName={providerName}
                        badgesOf={badgesOf}
                        max={7}
                        empty={<p className="mt-2 text-xs text-fg-3 sm:pl-12">Nenhum jogo atende ao critério agora.</p>}
                      />
                      <p className="mt-2 text-[11.5px] text-fg-3 sm:pl-12">
                        Editada {relative(s.updatedAt)} por {s.updatedBy}
                      </p>
                    </div>
                  )
                }}
              />
            )}
          </CardBody>
        </Card>

        <HomePreview showcases={visible} resolved={resolved} providerName={providerName} badgesOf={badgesOf} />
      </div>

      <OrderBar
        dirty={orderDirty}
        onSave={saveOrder}
        onReset={() => setOrder(null)}
        message="Ordem das vitrines alterada, ainda não salva"
      />

      {editing && (
        <ShowcaseDrawer
          key={editing === 'new' ? 'new' : editing.id}
          showcase={editing === 'new' ? null : editing}
          all={showcases.items}
          games={games}
          providers={providers}
          weekly={weekly}
          badgesOf={badgesOf}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
          onSave={(draft) => {
            const now = new Date().toISOString()
            if (editing === 'new') {
              const s: Showcase = { ...draft, name: draft.name.trim(), id: uid('vt-'), updatedAt: now, updatedBy: user.name }
              showcases.add(s, 'end')
              audit('criar', `Vitrine ${s.name}`, `Vitrine ${SHOWCASE_TYPE_LABEL[s.type].toLowerCase()} criada, limite de ${s.limit} jogos, ${s.visible ? 'visível' : 'oculta'}`)
              toast.success('Vitrine criada', { description: `"${s.name}" entrou no fim da lista. Ajuste a ordem se precisar.` })
            } else {
              const before = editing
              const changes: string[] = []
              if (before.name !== draft.name.trim()) changes.push(`nome "${before.name}" → "${draft.name.trim()}"`)
              if (before.type !== draft.type) changes.push(`tipo ${SHOWCASE_TYPE_LABEL[before.type]} → ${SHOWCASE_TYPE_LABEL[draft.type]}`)
              if (before.limit !== draft.limit) changes.push(`limite ${before.limit} → ${draft.limit}`)
              if (before.visible !== draft.visible) changes.push(draft.visible ? 'exibida' : 'ocultada')
              if (before.providerId !== draft.providerId) changes.push('provedora alterada')
              if (before.gameIds.join() !== draft.gameIds.join()) changes.push(`jogos escolhidos: ${draft.gameIds.length}`)
              showcases.update(before.id, { ...draft, name: draft.name.trim(), updatedAt: now, updatedBy: user.name })
              audit('editar', `Vitrine ${draft.name.trim()}`, changes.length ? `Alterado: ${changes.join('; ')}` : 'Salva sem mudanças')
              toast.success('Vitrine salva', { description: 'A home já mostra a versão nova.' })
            }
            setEditing(null)
          }}
        />
      )}
    </>
  )
}

// ---------- Prévia da home ----------

function HomePreview({
  showcases,
  resolved,
  providerName,
  badgesOf,
}: {
  showcases: Showcase[]
  resolved: Map<string, ResolvedShowcase>
  providerName: (g: Game) => string | undefined
  badgesOf: (g: Game) => GameBadge[]
}) {
  return (
    <Card className="h-fit xl:sticky xl:top-20">
      <CardHeader title="Prévia da home" description="Só as vitrines visíveis, na ordem da lista." icon={Smartphone} />
      <CardBody>
        <div className="mx-auto max-w-[340px] rounded-[28px] border border-line-strong bg-surface-2 p-2.5 shadow-card">
          <div className="overflow-hidden rounded-[20px] border border-line bg-bg">
            <div className="flex items-center justify-between border-b border-line bg-surface px-3 py-2">
              <span className="font-display text-[13px] font-extrabold tracking-tight text-fg">
                X2<span className="text-primary-text">Win</span>
              </span>
              <span className="h-5 w-14 rounded-full bg-primary/15" aria-hidden />
            </div>
            <div className="m-2.5 h-16 rounded-xl bg-gradient-to-br from-primary/30 via-primary/10 to-info/20" aria-hidden />
            <div className="max-h-[520px] space-y-3 overflow-y-auto px-2.5 pb-3">
              {showcases.length === 0 && <p className="py-10 text-center text-xs text-fg-3">Nenhuma vitrine visível. A home mostra só o banner.</p>}
              {showcases.map((s) => {
                const r = resolved.get(s.id)
                return (
                  <section key={s.id} aria-label={`Prévia: ${s.name}`}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <p className="truncate text-[12px] font-bold text-fg">{s.name}</p>
                      <span className="flex shrink-0 items-center text-[10px] font-semibold text-primary-text">
                        Ver todos <ChevronRight size={11} aria-hidden />
                      </span>
                    </div>
                    <div className="-mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 pb-1 scrollbar-none">
                      {(r?.games ?? []).slice(0, 10).map((g) => (
                        <div key={g.id} className="w-[64px] shrink-0">
                          <GameCover game={g} size="xs" providerName={providerName(g)} badges={badgesOf(g)} />
                        </div>
                      ))}
                      {(r?.games.length ?? 0) === 0 && <p className="text-[11px] text-fg-3">Sem jogos no momento.</p>}
                    </div>
                  </section>
                )
              })}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

// ---------- Criar / editar ----------

function ShowcaseDrawer({
  showcase,
  all,
  games,
  providers,
  weekly,
  badgesOf,
  canEdit,
  onClose,
  onSave,
}: {
  showcase: Showcase | null
  all: Showcase[]
  games: Game[]
  providers: Provider[]
  weekly: Map<string, number>
  badgesOf: (g: Game) => GameBadge[]
  canEdit: boolean
  onClose: () => void
  onSave: (d: ShowcaseDraft) => void
}) {
  const [draft, setDraft] = useState<ShowcaseDraft>(() =>
    showcase
      ? { name: showcase.name, type: showcase.type, gameIds: showcase.gameIds, providerId: showcase.providerId, limit: showcase.limit, visible: showcase.visible }
      : { name: '', type: 'manual', gameIds: [], providerId: null, limit: 12, visible: true },
  )
  const [touched, setTouched] = useState(false)
  const [query, setQuery] = useState('')
  const set = <K extends keyof ShowcaseDraft>(k: K, v: ShowcaseDraft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  const pmap = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers])
  const gmap = useMemo(() => new Map(games.map((g) => [g.id, g])), [games])
  const errors = validateShowcase(draft, all.filter((s) => s.id !== showcase?.id))
  const hasErrors = Object.keys(errors).length > 0
  const show = (k: keyof typeof errors) => (touched ? errors[k] ?? null : null)
  const r = resolveShowcase(draft, games, providers, weekly)

  const candidates = useMemo(() => {
    const q = query
      .trim()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
    return games
      .filter((g) => {
        if (!q) return true
        const hay = `${g.name} ${pmap.get(g.providerId)?.name ?? ''} ${GAME_CATEGORY_LABEL[g.category]}`
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase()
        return hay.includes(q)
      })
      .sort((a, b) => b.highlight - a.highlight)
  }, [games, query, pmap])

  const toggleGame = (id: string, on: boolean) =>
    setDraft((d) => ({ ...d, gameIds: on ? (d.gameIds.includes(id) ? d.gameIds : [...d.gameIds, id]) : d.gameIds.filter((x) => x !== id) }))

  const submit = () => {
    setTouched(true)
    if (hasErrors) {
      toast.error('Revise os campos da vitrine', { description: Object.values(errors)[0] })
      return
    }
    onSave(draft)
  }

  const picked = draft.gameIds.map((id) => gmap.get(id)).filter((g): g is Game => !!g)

  return (
    <Drawer
      open
      onClose={onClose}
      width="xl"
      title={showcase ? `Editar vitrine` : 'Nova vitrine'}
      description={showcase ? showcase.name : 'Defina o critério dos jogos e o limite de itens.'}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={!canEdit} title={!canEdit ? NO_EDIT : undefined}>
            {showcase ? 'Salvar vitrine' : 'Criar vitrine'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {/* Prévia ao vivo */}
        <section aria-label="Prévia da vitrine" className="rounded-xl border border-line bg-surface-2 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="truncate text-[13px] font-bold text-fg">{draft.name.trim() || 'Nome da vitrine'}</p>
            <span className="shrink-0 text-xs text-fg-3 tnum">
              {r.games.length} de {draft.limit} jogos
            </span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {r.games.map((g) => (
              <div key={g.id} className="w-[84px] shrink-0">
                <GameCover game={g} size="sm" providerName={pmap.get(g.providerId)?.name} badges={badgesOf(g)} />
              </div>
            ))}
            {r.games.length === 0 && (
              <p className="flex h-[105px] w-full items-center justify-center rounded-lg border border-dashed border-line-strong text-xs text-fg-3">
                {draft.type === 'manual' ? 'Escolha jogos abaixo para ver a prévia.' : 'Nenhum jogo atende ao critério.'}
              </p>
            )}
          </div>
        </section>

        {r.hiddenPicked.length > 0 && (
          <Alert tone="warning" title={`${r.hiddenPicked.length} jogo(s) escolhido(s) não aparecem no site`}>
            {r.hiddenPicked.map((g) => `${g.name} (${gameHiddenReason(g, pmap.get(g.providerId))?.toLowerCase()})`).join(', ')}. Eles ficam guardados na vitrine e voltam sozinhos quando forem reativados.
          </Alert>
        )}
        {draft.type !== 'manual' && r.available < draft.limit && (
          <Alert tone="info">
            Só {r.available} jogo(s) atendem a este critério agora. A vitrine mostra {r.available} até o catálogo crescer.
          </Alert>
        )}

        <FormFieldset readOnly={!canEdit}>
          <FormGrid>
            <Field label="Nome" htmlFor="vt-name" required error={show('name')} hint="Aparece como título da vitrine na home.">
              <Input id="vt-name" value={draft.name} maxLength={40} onChange={(e) => set('name', e.target.value)} invalid={!!show('name')} placeholder="Ex.: Top 10 da semana" />
            </Field>
            <Field label="Limite de itens" htmlFor="vt-limit" error={show('limit')} hint={`De ${SHOWCASE_LIMITS.min} a ${SHOWCASE_LIMITS.max} jogos.`}>
              <NumberInput integer id="vt-limit" value={draft.limit} onValueChange={(n) => set('limit', Math.round(n))} min={SHOWCASE_LIMITS.min} max={SHOWCASE_LIMITS.max} suffix="jogos" invalid={!!show('limit')} />
            </Field>
          </FormGrid>

          <Field label="Tipo">
            <RadioCards<ShowcaseType>
              name="Tipo da vitrine"
              value={draft.type}
              onChange={(t) => set('type', t)}
              options={(Object.keys(SHOWCASE_TYPE_LABEL) as ShowcaseType[]).map((t) => ({
                value: t,
                label: t === 'manual' ? 'Manual' : `Automática: ${SHOWCASE_TYPE_LABEL[t].toLowerCase()}`,
                description: SHOWCASE_TYPE_HINT[t],
                icon: TYPE_ICON[t],
              }))}
            />
          </Field>

          {draft.type === 'por_provedora' && (
            <Field label="Provedora" htmlFor="vt-provider" required error={show('providerId')}>
              <Select
                id="vt-provider"
                value={draft.providerId ?? ''}
                onChange={(v) => set('providerId', v || null)}
                placeholder="Escolha a provedora"
                options={[...providers].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: `${p.name}${p.status === 'pausada' ? ' (pausada)' : ''}` }))}
              />
            </Field>
          )}

          <Switch label="Visível na home" description={draft.visible ? 'Aparece para os jogadores na ordem da lista.' : 'Fica salva, mas não aparece no site.'} checked={draft.visible} onChange={(v) => set('visible', v)} />

          {draft.type === 'manual' && (
            <Field label={`Jogos escolhidos (${draft.gameIds.length} de ${draft.limit})`} error={show('gameIds')}>
              {picked.length > 0 ? (
                <SortableList
                  items={picked}
                  getKey={(g) => g.id}
                  disabled={!canEdit}
                  onChange={(list) => set('gameIds', list.map((g) => g.id))}
                  className="mb-4"
                  render={(g) => {
                    const reason = gameHiddenReason(g, pmap.get(g.providerId))
                    return (
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 shrink-0">
                          <GameCover game={g} size="thumb" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-fg">{g.name}</p>
                          <p className="truncate text-xs text-fg-3">{reason ? <span className="text-warning">{reason}</span> : pmap.get(g.providerId)?.name}</p>
                        </div>
                        <IconButton icon={X} label={`Tirar ${g.name} da vitrine`} size="sm" onClick={() => toggleGame(g.id, false)} disabled={!canEdit} />
                      </div>
                    )
                  }}
                />
              ) : (
                <p className="mb-4 rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-[13px] text-fg-3">Nenhum jogo escolhido. Marque os jogos na lista abaixo.</p>
              )}
              <div className="rounded-xl border border-line">
                <div className="border-b border-line p-2.5">
                  <Input icon={Search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar jogo, provedora ou categoria" aria-label="Buscar jogos para a vitrine" />
                </div>
                <ul className="max-h-72 divide-y divide-line overflow-y-auto">
                  {candidates.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-fg-3">Nenhum jogo encontrado.</li>}
                  {candidates.map((g) => {
                    const on = draft.gameIds.includes(g.id)
                    const reason = gameHiddenReason(g, pmap.get(g.providerId))
                    const full = !on && draft.gameIds.length >= draft.limit
                    return (
                      <li key={g.id} className={cn('flex items-center gap-3 px-3 py-2', on && 'bg-primary/5')}>
                        <Checkbox checked={on} onChange={(v) => toggleGame(g.id, v)} disabled={!canEdit || full} ariaLabel={`${on ? 'Tirar' : 'Incluir'} ${g.name}`} />
                        <div className="w-7 shrink-0">
                          <GameCover game={g} size="thumb" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-fg">{g.name}</p>
                          <p className="truncate text-xs text-fg-3">
                            {pmap.get(g.providerId)?.name} · {GAME_CATEGORY_LABEL[g.category]}
                          </p>
                        </div>
                        {reason ? (
                          <Badge tone="warning">Fora do site</Badge>
                        ) : full ? (
                          <span className="text-[11px] text-fg-3">limite atingido</span>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </div>
            </Field>
          )}
        </FormFieldset>
      </div>
    </Drawer>
  )
}
