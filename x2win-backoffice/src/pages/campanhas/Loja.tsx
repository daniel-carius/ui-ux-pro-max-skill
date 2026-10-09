import { useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  BadgePercent,
  CheckCircle2,
  Coins,
  Copy,
  Crown,
  Gem,
  Gift,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Percent,
  Plus,
  Receipt,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  Store,
  Ticket,
  Trash2,
  Undo2,
  Users,
  Zap,
} from 'lucide-react'
import { BarsChart } from '@/components/charts'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ChipFilter,
  DataTable,
  Drawer,
  EmptyState,
  Field,
  FormGrid,
  IconButton,
  ImageUpload,
  Input,
  KpiCard,
  Menu,
  MoneyInput,
  NumberInput,
  PageHeader,
  PersonCell,
  Progress,
  RadioCards,
  Select,
  Switch,
  Tabs,
  Textarea,
  confirm,
  confirmWithInput,
  toast,
  useTabParam,
  type Column,
  type Tone,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { brl, dateShort, dateTime, maskEmail, num } from '@/lib/format'
import { useCollection, type Collection } from '@/lib/store'
import { uid } from '@/lib/random'
import { DAY, NOW, dayKey, daysAgo } from '@/data/now'
import { useGames, usePlayers } from '@/data/hooks'
import { seedShopItems, seedShopPurchases } from '@/data/campanhas2-seeds'
import { audit, usePageAccess } from '@/domain/session'
import { C2_KEYS, FREE_SPIN_VALUE, type CoinInfo } from '@/domain/campanhas2-common'
import {
  LIMIT_PERIOD_LABEL,
  PURCHASE_STATUS_LABEL,
  SHOP_KIND_LABEL,
  isSoldOut,
  itemRewardText,
  itemValueBrl,
  priceRatio,
  shopItemErrors,
  stockLeft,
  type LimitPeriod,
  type PurchaseStatus,
  type ShopIcon,
  type ShopItem,
  type ShopKind,
  type ShopPurchase,
} from '@/domain/campanhas2-loja'
import { CoinAmount, CoinGlyph, DrawerSection, type CoinCtx, PlayerPreview, READ_ONLY_TITLE, confirmDiscard, useCoin, useGameName } from './_shared-c2'

const ICONS: Record<ShopIcon, LucideIcon> = { gift: Gift, sparkles: Sparkles, percent: Percent, ticket: Ticket, crown: Crown, zap: Zap, star: Star, gem: Gem }
const ICON_LABEL: Record<ShopIcon, string> = { gift: 'Presente', sparkles: 'Brilho', percent: 'Percentual', ticket: 'Bilhete', crown: 'Coroa', zap: 'Raio', star: 'Estrela', gem: 'Joia' }
const KIND_ICON: Record<ShopKind, LucideIcon> = { bonus: Gift, free_spins: Sparkles, cashback: BadgePercent, aposta_gratis: Ticket }
const KIND_TONE: Record<ShopKind, Tone> = { bonus: 'primary', free_spins: 'info', cashback: 'success', aposta_gratis: 'warning' }
const KIND_HINT: Record<ShopKind, string> = {
  bonus: 'Crédito no saldo bônus, com rollover.',
  free_spins: 'Giros grátis num slot escolhido.',
  cashback: 'Devolve parte das perdas por 24 horas.',
  aposta_gratis: 'Crédito para apostas esportivas.',
}
const KIND_CHIP: Record<ShopKind, string> = {
  bonus: 'bg-primary/10 text-primary-text',
  free_spins: 'bg-info/10 text-info',
  cashback: 'bg-success/10 text-success',
  aposta_gratis: 'bg-warning/10 text-warning',
}

function KindIcon({ kind }: { kind: ShopKind }) {
  const I = KIND_ICON[kind]
  return (
    <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', KIND_CHIP[kind])}>
      <I size={14} aria-hidden />
    </span>
  )
}

const STATUS_TONE: Record<PurchaseStatus, Tone> = { entregue: 'success', pendente: 'warning', estornada: 'neutral' }

type ItemFilter = 'todos' | 'ativos' | 'pausados' | 'esgotados'
type SortKey = 'vendidos' | 'preco_asc' | 'preco_desc' | 'recentes'

function blankItem(): ShopItem {
  const now = new Date().toISOString()
  return {
    id: uid('lj'),
    name: '',
    description: '',
    kind: 'bonus',
    value: 10,
    extra: 0,
    gameId: null,
    rollover: 10,
    icon: 'gift',
    image: null,
    price: 1000,
    stock: null,
    sold: 0,
    limitPerPlayer: 1,
    limitPeriod: 'dia',
    active: true,
    featured: false,
    createdAt: now,
    updatedAt: now,
  }
}

export default function Loja() {
  const { canEdit } = usePageAccess()
  const [tab, setTab] = useTabParam('itens', ['itens', 'compras'] as const)
  const items = useCollection<ShopItem>(C2_KEYS.loja, seedShopItems)
  const purchases = useCollection<ShopPurchase>(C2_KEYS.lojaCompras, seedShopPurchases)
  const coin = useCoin()
  const [editing, setEditing] = useState<{ item: ShopItem; isNew: boolean } | null>(null)

  const recent = useMemo(() => purchases.items.filter((p) => p.status !== 'estornada' && NOW.getTime() - new Date(p.at).getTime() <= 30 * DAY), [purchases.items])
  const coinsSpent = recent.reduce((s, p) => s + p.price, 0)
  const buyers = new Set(recent.map((p) => p.playerId)).size
  const activeCount = items.items.filter((i) => i.active && !isSoldOut(i)).length
  const soldOut = items.items.filter(isSoldOut).length

  const save = (item: ShopItem, isNew: boolean) => {
    const next = { ...item, name: item.name.trim(), description: item.description.trim(), updatedAt: new Date().toISOString() }
    if (isNew) items.add(next)
    else items.update(item.id, next)
    audit(isNew ? 'criar' : 'editar', `Loja · ${next.name}`, `${SHOP_KIND_LABEL[next.kind]} por ${num(next.price)} ${coin.symbol} · estoque ${next.stock == null ? 'ilimitado' : num(next.stock)}${next.active ? '' : ' · pausado'}`)
    toast.success(isNew ? 'Item criado' : 'Item salvo', { description: next.active ? 'Já aparece na loja do site.' : 'Está pausado e não aparece na loja.' })
    setEditing(null)
  }

  return (
    <>
      <PageHeader
        actions={
          <Button variant="primary" icon={Plus} disabled={!canEdit} title={!canEdit ? READ_ONLY_TITLE : undefined} onClick={() => setEditing({ item: blankItem(), isNew: true })}>
            Novo item
          </Button>
        }
      >
        <Tabs
          className="mt-5"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'itens', label: 'Itens', icon: Store, count: items.items.length },
            { value: 'compras', label: 'Compras', icon: Receipt, count: purchases.items.length },
          ]}
        />
      </PageHeader>

      <div className="space-y-6">
        <section aria-label="Resumo da loja" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Itens à venda" icon={Store} value={`${activeCount} de ${items.items.length}`} hint={soldOut ? `${soldOut} esgotado${soldOut > 1 ? 's' : ''}` : 'nenhum esgotado'} />
          <KpiCard label="Itens vendidos" icon={ShoppingBag} tone="info" value={num(recent.length)} hint="últimos 30 dias, sem estornos" />
          <KpiCard
            label="Moedas gastas"
            icon={Coins}
            tone="warning"
            value={`${num(coinsSpent)} ${coin.symbol}`}
            hint={`≈ ${brl(coinsSpent * coin.refValue)} em 30 dias`}
            formula={<>Soma do preço dos itens comprados nos últimos 30 dias, sem as compras estornadas. Valor em R$ pela referência da moeda.</>}
          />
          <KpiCard label="Compradores" icon={Users} tone="success" value={num(buyers)} hint={`média de ${num(buyers ? Math.round(coinsSpent / buyers) : 0)} ${coin.symbol} por jogador`} />
        </section>

        {tab === 'itens' ? (
          <ItemsGrid
            items={items.items}
            coin={coin}
            canEdit={canEdit}
            onNew={() => setEditing({ item: blankItem(), isNew: true })}
            onEdit={(it) => setEditing({ item: structuredClone(it), isNew: false })}
            onToggle={(it, on) => {
              items.update(it.id, { active: on, updatedAt: new Date().toISOString() })
              audit(on ? 'ligar' : 'desligar', `Loja · ${it.name}`, on ? 'Item voltou para a loja' : 'Item pausado')
              toast.success(on ? 'Item ativado' : 'Item pausado', {
                description: on ? 'Voltou a aparecer na loja.' : 'Saiu da loja. Quem já comprou mantém o prêmio.',
                action: { label: 'Desfazer', onClick: () => items.update(it.id, { active: !on }) },
              })
            }}
            onDuplicate={(it) => {
              const now = new Date().toISOString()
              const copy: ShopItem = { ...it, id: uid('lj'), name: `${it.name} (cópia)`, sold: 0, active: false, featured: false, createdAt: now, updatedAt: now }
              items.add(copy)
              audit('criar', `Loja · ${copy.name}`, `Cópia de ${it.name}, criada pausada`)
              toast.success('Item duplicado', { description: 'A cópia começa pausada.' })
            }}
            onRestock={async (it) => {
              const r = await confirmWithInput({
                title: `Repor estoque de ${it.name}`,
                description: `Hoje: ${num(it.sold)} vendidos de ${num(it.stock ?? 0)}.`,
                confirmLabel: 'Repor',
                icon: PackagePlus,
                input: { label: 'Unidades a adicionar', defaultValue: '50', required: true },
              })
              if (!r.confirmed) return
              const n = Math.round(Number(r.value.replace(',', '.')))
              if (!Number.isFinite(n) || n < 1) {
                toast.error('Quantidade inválida', { description: 'Informe um número inteiro maior que zero.' })
                return
              }
              items.update(it.id, { stock: (it.stock ?? 0) + n, updatedAt: new Date().toISOString() })
              audit('editar', `Loja · ${it.name}`, `Estoque reposto: +${n} (total ${num((it.stock ?? 0) + n)})`)
              toast.success('Estoque reposto', { description: `+${num(n)} unidades.` })
            }}
            onDelete={async (it) => {
              const ok = await confirm({
                title: `Excluir ${it.name}?`,
                description: it.sold ? `O item sai da loja. As ${num(it.sold)} compras continuam no histórico.` : 'O item sai da loja. Não dá para desfazer.',
                confirmLabel: 'Excluir item',
                tone: 'danger',
                icon: Trash2,
              })
              if (!ok) return
              items.remove(it.id)
              audit('excluir', `Loja · ${it.name}`, `Item excluído (${num(it.sold)} vendidos)`)
              toast.success('Item excluído')
            }}
          />
        ) : (
          <Purchases purchases={purchases} items={items} coin={coin} canEdit={canEdit} />
        )}
      </div>

      {editing && (
        <ItemDrawer key={editing.item.id} initial={editing.item} isNew={editing.isNew} all={items.items} coin={coin} onClose={() => setEditing(null)} onSave={(it) => save(it, editing.isNew)} />
      )}
    </>
  )
}

// ---------- Itens ----------

function ItemsGrid({
  items,
  coin,
  canEdit,
  onNew,
  onEdit,
  onToggle,
  onDuplicate,
  onRestock,
  onDelete,
}: {
  items: ShopItem[]
  coin: CoinInfo
  canEdit: boolean
  onNew: () => void
  onEdit: (it: ShopItem) => void
  onToggle: (it: ShopItem, on: boolean) => void
  onDuplicate: (it: ShopItem) => void
  onRestock: (it: ShopItem) => void
  onDelete: (it: ShopItem) => void
}) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<ItemFilter>('todos')
  const [sort, setSort] = useState<SortKey>('vendidos')
  const gameName = useGameName()
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const match = (it: ShopItem) =>
    filter === 'todos' || (filter === 'ativos' && it.active && !isSoldOut(it)) || (filter === 'pausados' && !it.active) || (filter === 'esgotados' && isSoldOut(it))
  const rows = items
    .filter((it) => match(it) && (!q.trim() || norm(`${it.name} ${it.description} ${SHOP_KIND_LABEL[it.kind]}`).includes(norm(q.trim()))))
    .sort((a, b) =>
      sort === 'vendidos' ? b.sold - a.sold : sort === 'preco_asc' ? a.price - b.price : sort === 'preco_desc' ? b.price - a.price : b.createdAt.localeCompare(a.createdAt),
    )
  const count = (f: ItemFilter) => items.filter((it) => f === 'todos' || (f === 'ativos' && it.active && !isSoldOut(it)) || (f === 'pausados' && !it.active) || (f === 'esgotados' && isSoldOut(it))).length

  return (
    <section aria-label="Itens da loja" className="space-y-4">
      <div className="card flex flex-col gap-2.5 p-3 lg:flex-row lg:items-center">
        <div className="relative w-full lg:w-72">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar item" aria-label="Buscar item" className="input-base h-9 pl-9" />
        </div>
        <ChipFilter<ItemFilter>
          value={filter}
          onChange={setFilter}
          className="min-w-0 flex-1"
          options={[
            { value: 'todos', label: 'Todos', count: count('todos') },
            { value: 'ativos', label: 'À venda', count: count('ativos') },
            { value: 'pausados', label: 'Pausados', count: count('pausados') },
            { value: 'esgotados', label: 'Esgotados', count: count('esgotados'), tone: 'danger' },
          ]}
        />
        <Select
          aria-label="Ordenar itens"
          className="lg:w-48"
          value={sort}
          onChange={(v) => setSort(v as SortKey)}
          options={[
            { value: 'vendidos', label: 'Mais vendidos' },
            { value: 'preco_asc', label: 'Menor preço' },
            { value: 'preco_desc', label: 'Maior preço' },
            { value: 'recentes', label: 'Mais recentes' },
          ]}
        />
      </div>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={Store}
            title="A loja está vazia"
            description={`Cadastre itens que os jogadores compram com ${coin.name}: bônus, free spins, cashback ou aposta grátis.`}
            action={
              <Button variant="primary" icon={Plus} disabled={!canEdit} onClick={onNew}>
                Criar primeiro item
              </Button>
            }
            className="py-16"
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Search}
            title="Nenhum item neste filtro"
            description="Troque o filtro ou a busca para ver outros itens."
            action={
              <Button
                size="sm"
                onClick={() => {
                  setQ('')
                  setFilter('todos')
                }}
              >
                Limpar filtros
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rows.map((it) => (
            <ItemCard
              key={it.id}
              item={it}
              coin={coin}
              gameName={gameName(it.gameId)}
              canEdit={canEdit}
              onEdit={() => onEdit(it)}
              onToggle={(on) => onToggle(it, on)}
              onDuplicate={() => onDuplicate(it)}
              onRestock={() => onRestock(it)}
              onDelete={() => onDelete(it)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ItemVisual({ item, className, iconSize = 30 }: { item: Pick<ShopItem, 'icon' | 'image' | 'name'>; className?: string; iconSize?: number }) {
  const Icon = ICONS[item.icon]
  return (
    <div className={cn('relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-primary/15 via-primary/5 to-gold/15', className)}>
      {item.image ? (
        <img src={item.image} alt={`Imagem de ${item.name || 'item'}`} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface text-primary-text shadow-card ring-1 ring-line">
          <Icon size={iconSize} aria-hidden />
        </span>
      )}
    </div>
  )
}

function ItemCard({
  item: it,
  coin,
  gameName,
  canEdit,
  onEdit,
  onToggle,
  onDuplicate,
  onRestock,
  onDelete,
}: {
  item: ShopItem
  coin: CoinInfo
  gameName?: string
  canEdit: boolean
  onEdit: () => void
  onToggle: (on: boolean) => void
  onDuplicate: () => void
  onRestock: () => void
  onDelete: () => void
}) {
  const left = stockLeft(it)
  const soldOut = isSoldOut(it)
  const ratio = priceRatio(it, coin)
  return (
    <article className="card flex flex-col overflow-hidden">
      <div className="relative">
        <ItemVisual item={it} className={cn('h-32', (!it.active || soldOut) && 'opacity-60 grayscale-[40%]')} />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <Badge tone={KIND_TONE[it.kind]} icon={KIND_ICON[it.kind]} className="bg-surface/90 backdrop-blur">
            {SHOP_KIND_LABEL[it.kind]}
          </Badge>
        </div>
        <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
          {soldOut ? (
            <Badge tone="danger" dot className="bg-surface/90">
              Esgotado
            </Badge>
          ) : !it.active ? (
            <Badge tone="neutral" dot className="bg-surface/90">
              Pausado
            </Badge>
          ) : null}
          {it.featured && (
            <Badge tone="gold" icon={Star} className="bg-surface/90">
              Destaque
            </Badge>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-fg" title={it.name}>
            {it.name}
          </h3>
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-fg-3">{itemRewardText(it, gameName)}</p>
        </div>
        <div className="flex items-end justify-between gap-2">
          <div>
            <CoinAmount value={it.price} size={18} className="text-lg" />
            <p className="text-xs text-fg-3">≈ {brl(it.price * coin.refValue)}</p>
          </div>
          {ratio != null && (
            <span className={cn('text-right text-[11px] leading-4', ratio < 1 ? 'text-warning' : 'text-fg-3')} title="Valor das moedas pagas ÷ valor do prêmio">
              prêmio vale
              <br />
              <strong className="text-[13px] text-fg tnum">{brl(itemValueBrl(it))}</strong>
            </span>
          )}
        </div>
        <div className="mt-auto space-y-1.5">
          {it.stock != null ? (
            <>
              <div className="flex justify-between text-xs text-fg-3 tnum">
                <span>
                  {num(it.sold)} de {num(it.stock)} vendidos
                </span>
                <span className={cn(left === 0 ? 'font-semibold text-danger' : left != null && left <= it.stock * 0.1 ? 'font-semibold text-warning' : '')}>
                  {left === 0 ? 'esgotado' : `restam ${num(left ?? 0)}`}
                </span>
              </div>
              <Progress value={it.sold} max={it.stock} tone={soldOut ? 'danger' : left != null && left <= it.stock * 0.1 ? 'warning' : 'primary'} label={`Estoque de ${it.name}`} />
            </>
          ) : (
            <p className="text-xs text-fg-3 tnum">Estoque ilimitado · {num(it.sold)} vendidos</p>
          )}
          <p className="text-xs text-fg-3">{it.limitPerPlayer ? `Limite: ${it.limitPerPlayer} ${LIMIT_PERIOD_LABEL[it.limitPeriod]} por jogador` : 'Sem limite por jogador'}</p>
        </div>
      </div>
      <footer className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
        <label className="flex items-center gap-2 text-[13px] text-fg-2">
          <Switch size="sm" ariaLabel={`${it.name} à venda`} checked={it.active} disabled={!canEdit} onChange={onToggle} />
          {it.active ? 'À venda' : 'Pausado'}
        </label>
        <div className="flex items-center gap-1">
          <Button size="xs" variant="ghost" icon={Pencil} onClick={onEdit} disabled={!canEdit} title={!canEdit ? READ_ONLY_TITLE : undefined}>
            Editar
          </Button>
          <Menu
            items={[
              { label: 'Duplicar', icon: Copy, onSelect: onDuplicate, disabled: !canEdit },
              { label: 'Repor estoque', icon: PackagePlus, onSelect: onRestock, disabled: !canEdit || it.stock == null, hint: it.stock == null ? 'ilimitado' : undefined },
              { divider: true },
              { label: 'Excluir', icon: Trash2, danger: true, onSelect: onDelete, disabled: !canEdit },
            ]}
            trigger={(p) => <IconButton {...p} icon={MoreHorizontal} label={`Mais ações de ${it.name}`} size="sm" />}
          />
        </div>
      </footer>
    </article>
  )
}

// ---------- Compras ----------

function Purchases({
  purchases,
  items,
  coin,
  canEdit,
}: {
  purchases: Collection<ShopPurchase>
  items: Collection<ShopItem>
  coin: CoinInfo
  canEdit: boolean
}) {
  const [filter, setFilter] = useState<'todas' | PurchaseStatus>('todas')
  const players = usePlayers()

  const daily = useMemo(() => {
    const map = new Map<string, { vendas: number; moedas: number }>()
    for (let i = 29; i >= 0; i--) map.set(dayKey(daysAgo(i)), { vendas: 0, moedas: 0 })
    for (const p of purchases.items) {
      if (p.status === 'estornada') continue
      const k = dayKey(new Date(p.at))
      const cur = map.get(k)
      if (cur) {
        cur.vendas++
        cur.moedas += p.price
      }
    }
    return [...map.entries()].map(([date, v]) => ({ date, ...v }))
  }, [purchases.items])

  const top = useMemo(() => {
    const m = new Map<string, { name: string; n: number; coins: number }>()
    for (const p of purchases.items) {
      if (p.status === 'estornada' || NOW.getTime() - new Date(p.at).getTime() > 30 * DAY) continue
      const cur = m.get(p.itemId) ?? { name: p.itemName, n: 0, coins: 0 }
      cur.n++
      cur.coins += p.price
      m.set(p.itemId, cur)
    }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 5)
  }, [purchases.items])
  const maxTop = Math.max(1, ...top.map((t) => t.n))

  const refund = async (p: ShopPurchase) => {
    const ok = await confirm({
      title: `Estornar compra de ${p.playerName}?`,
      description: `Devolve ${num(p.price)} ${coin.symbol} ao jogador e cancela o prêmio "${p.itemName}". O item volta ao estoque.`,
      confirmLabel: 'Estornar compra',
      tone: 'danger',
      icon: Undo2,
    })
    if (!ok) return
    purchases.update(p.id, { status: 'estornada' })
    players.update(p.playerId, (pl) => ({ ...pl, coins: pl.coins + p.price }))
    items.update(p.itemId, (it) => ({ ...it, sold: Math.max(0, it.sold - 1) }))
    audit('editar', `Loja · compra ${p.id}`, `Compra estornada: ${num(p.price)} ${coin.symbol} devolvidas a ${p.playerName} (#${p.playerId})`)
    toast.success('Compra estornada', { description: `${num(p.price)} ${coin.symbol} voltaram para o saldo do jogador.` })
  }

  const deliver = (p: ShopPurchase) => {
    purchases.update(p.id, { status: 'entregue' })
    audit('aprovar', `Loja · compra ${p.id}`, `Entrega do prêmio "${p.itemName}" confirmada para ${p.playerName}`)
    toast.success('Entrega confirmada', { description: 'O prêmio foi creditado ao jogador.' })
  }

  const columns: Column<ShopPurchase>[] = [
    { id: 'at', header: 'Data', sortValue: (p) => p.at, csv: (p) => dateTime(p.at), cell: (p) => <span className="whitespace-nowrap text-[13px] text-fg-2">{dateTime(p.at)}</span> },
    { id: 'player', header: 'Jogador', minWidth: 200, sortValue: (p) => p.playerName, csv: (p) => `${p.playerName} (${p.playerId})`, cell: (p) => <PersonCell name={p.playerName} sub={maskEmail(p.playerEmail)} /> },
    {
      id: 'item',
      header: 'Item',
      minWidth: 220,
      sortValue: (p) => p.itemName,
      cell: (p) => (
        <span className="flex min-w-0 items-center gap-2">
          <KindIcon kind={p.kind} />
          <span className="truncate text-[13px] text-fg">{p.itemName}</span>
        </span>
      ),
    },
    { id: 'price', header: 'Preço', align: 'right', sortValue: (p) => p.price, csv: (p) => p.price, cell: (p) => <CoinAmount value={p.price} size={13} /> },
    { id: 'value', header: 'Valor do prêmio', align: 'right', sortValue: (p) => p.valueBrl, csv: (p) => p.valueBrl.toFixed(2), cell: (p) => <span className="tnum">{brl(p.valueBrl)}</span> },
    {
      id: 'status',
      header: 'Status',
      sortValue: (p) => p.status,
      csv: (p) => PURCHASE_STATUS_LABEL[p.status],
      cell: (p) => (
        <Badge tone={STATUS_TONE[p.status]} dot>
          {PURCHASE_STATUS_LABEL[p.status]}
        </Badge>
      ),
    },
  ]

  const rows = filter === 'todas' ? purchases.items : purchases.items.filter((p) => p.status === filter)
  const count = (s: PurchaseStatus) => purchases.items.filter((p) => p.status === s).length

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="Vendas por dia" description="Itens vendidos nos últimos 30 dias, sem estornos" />
          <CardBody>
            <BarsChart ariaLabel="Itens vendidos por dia" data={daily} xKey="date" xFormat={(k) => dateShort(`${k}T12:00:00`)} height={220} series={[{ key: 'vendas', label: 'Itens vendidos', slot: 1 }]} />
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Mais vendidos" description="Últimos 30 dias" />
          <CardBody>
            {top.length ? (
              <ol className="space-y-3.5">
                {top.map((t, i) => (
                  <li key={t.name} className="flex items-center gap-3">
                    <span className="w-4 shrink-0 text-center text-xs font-bold text-fg-3 tnum">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-[13px] font-medium text-fg">{t.name}</p>
                        <p className="shrink-0 text-[13px] font-semibold text-fg tnum">{num(t.n)}</p>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
                        <div className="h-full rounded-full" style={{ width: `${(t.n / maxTop) * 100}%`, background: 'var(--chart-4)' }} />
                      </div>
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-fg-3 tnum">
                        <CoinGlyph size={11} src={null} /> {num(t.coins)} {coin.symbol}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[13px] text-fg-3">Nenhuma venda nos últimos 30 dias.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <DataTable
        caption="Compras na loja"
        rows={rows}
        columns={columns}
        rowKey={(p) => p.id}
        searchText={(p) => `${p.id} ${p.playerName} ${p.playerEmail} ${p.playerId} ${p.itemName}`}
        searchPlaceholder="Buscar jogador, e-mail ou item"
        initialSort={{ id: 'at', dir: 'desc' }}
        exportName="loja-compras"
        onExport={(n) => audit('exportar', 'Loja · compras', `Exportação CSV de ${n} compras`)}
        resetKey={filter}
        toolbar={
          <ChipFilter
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'todas', label: 'Todas', count: purchases.items.length },
              { value: 'entregue', label: 'Entregues', count: count('entregue') },
              { value: 'pendente', label: 'Pendentes', count: count('pendente'), tone: 'warning' },
              { value: 'estornada', label: 'Estornadas', count: count('estornada') },
            ]}
            className="max-w-full"
          />
        }
        rowActions={(p) => [
          { label: 'Confirmar entrega', icon: CheckCircle2, onSelect: () => deliver(p), disabled: !canEdit || p.status !== 'pendente' },
          { divider: true },
          { label: 'Estornar compra', icon: Undo2, danger: true, onSelect: () => refund(p), disabled: !canEdit || p.status === 'estornada' },
        ]}
        empty={{ title: 'Nenhuma compra neste filtro', description: 'As compras aparecem aqui assim que os jogadores trocarem moedas na loja.' }}
      />
    </div>
  )
}

// ---------- Formulário ----------

function ItemDrawer({
  initial,
  isNew,
  all,
  coin,
  onClose,
  onSave,
}: {
  initial: ShopItem
  isNew: boolean
  all: ShopItem[]
  coin: CoinCtx
  onClose: () => void
  onSave: (it: ShopItem) => void
}) {
  const [it, setIt] = useState<ShopItem>(initial)
  const [touched, setTouched] = useState(!isNew)
  const { items: games } = useGames()
  const slots = games.filter((g) => g.category === 'slots' && g.active)
  const gameName = games.find((g) => g.id === it.gameId)?.name
  const errs = touched ? shopItemErrors(it, all) : {}
  const dirty = JSON.stringify(it) !== JSON.stringify(initial)
  const set = <K extends keyof ShopItem>(k: K, v: ShopItem[K]) => setIt((x) => ({ ...x, [k]: v }))
  const ratio = priceRatio(it, coin)
  const valueBrl = itemValueBrl(it)

  const setKind = (kind: ShopKind) =>
    setIt((x) => ({
      ...x,
      kind,
      value: kind === 'free_spins' ? 20 : kind === 'cashback' ? 10 : x.kind === 'free_spins' || x.kind === 'cashback' ? 10 : x.value,
      extra: kind === 'free_spins' ? FREE_SPIN_VALUE : kind === 'cashback' ? 50 : 0,
      gameId: kind === 'free_spins' ? (x.gameId ?? 'g001') : null,
      rollover: kind === 'bonus' ? x.rollover || 10 : 0,
      icon: kind === 'free_spins' ? 'sparkles' : kind === 'cashback' ? 'percent' : kind === 'aposta_gratis' ? 'ticket' : 'gift',
    }))

  const close = async () => {
    if (await confirmDiscard(dirty)) onClose()
  }
  const submit = () => {
    setTouched(true)
    const e = shopItemErrors(it, all)
    const first = Object.values(e)[0]
    if (first) {
      toast.error('Revise o item', { description: first })
      return
    }
    onSave(it)
  }

  const left = stockLeft(it)

  return (
    <Drawer
      open
      onClose={close}
      width="xl"
      title={isNew ? 'Novo item' : `Editar ${initial.name}`}
      description="O que o jogador compra com moedas, por quanto e com que limite."
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" onClick={submit}>
            {isNew ? 'Criar item' : 'Salvar item'}
          </Button>
        </>
      }
    >
      <div className="space-y-8">
        <PlayerPreview title="Prévia na loja do site">
          <div className="mx-auto flex max-w-[280px] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card">
            <div className="relative">
              <ItemVisual item={it} className="h-28" iconSize={28} />
              {it.featured && (
                <span className="absolute left-2 top-2">
                  <Badge tone="gold" icon={Star} className="bg-surface/90">
                    Destaque
                  </Badge>
                </span>
              )}
            </div>
            <div className="space-y-2 p-3">
              <p className="truncate text-sm font-bold text-fg">{it.name || 'Nome do item'}</p>
              <p className="text-xs text-fg-3">{itemRewardText(it, gameName)}</p>
              <button type="button" tabIndex={-1} aria-hidden className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-[13px] font-bold text-primary-fg">
                Comprar por <CoinGlyph size={14} src={coin.icon} /> {num(it.price)}
              </button>
              <p className="text-center text-[11px] text-fg-3">
                {left != null ? `Restam ${num(left)}` : 'Disponível'}
                {it.limitPerPlayer ? ` · ${it.limitPerPlayer} ${LIMIT_PERIOD_LABEL[it.limitPeriod]}` : ''}
              </p>
            </div>
          </div>
        </PlayerPreview>

        <DrawerSection title="Item" icon={Store}>
          <Field label="Nome" htmlFor="it-name" required error={errs.name}>
            <Input id="it-name" value={it.name} maxLength={48} invalid={!!errs.name} placeholder="Ex.: 20 giros no Fortune Tiger" onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Descrição" htmlFor="it-desc" hint="Uma linha que aparece no detalhe do item.">
            <Textarea id="it-desc" rows={2} maxLength={140} value={it.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label="Tipo de prêmio">
            <RadioCards
              name="Tipo de prêmio"
              value={it.kind}
              onChange={setKind}
              options={(Object.keys(SHOP_KIND_LABEL) as ShopKind[]).map((k) => ({ value: k, label: SHOP_KIND_LABEL[k], description: KIND_HINT[k], icon: KIND_ICON[k] }))}
            />
          </Field>
        </DrawerSection>

        <DrawerSection title="Prêmio" icon={Gift} description={`O jogador recebe: ${itemRewardText(it, gameName)}.`}>
          <FormGrid>
            {it.kind === 'bonus' && (
              <>
                <Field label="Valor do bônus" htmlFor="it-val" required error={errs.value}>
                  <MoneyInput id="it-val" value={it.value} invalid={!!errs.value} onValueChange={(n) => set('value', n)} />
                </Field>
                <Field label="Rollover" htmlFor="it-roll" error={errs.rollover} hint={it.rollover ? `Apostar ${brl(it.value * it.rollover)} para sacar.` : 'Sem rollover: vira saldo sacável.'}>
                  <NumberInput id="it-roll" value={it.rollover} min={0} suffix="x" invalid={!!errs.rollover} onValueChange={(n) => set('rollover', n)} />
                </Field>
              </>
            )}
            {it.kind === 'free_spins' && (
              <>
                <Field label="Quantidade de giros" htmlFor="it-val" required error={errs.value}>
                  <NumberInput id="it-val" value={it.value} min={1} suffix="giros" invalid={!!errs.value} onValueChange={(n) => set('value', Math.round(n))} />
                </Field>
                <Field label="Valor de cada giro" htmlFor="it-extra" error={errs.extra} hint={`Total em giros: ${brl(it.value * it.extra)}.`}>
                  <MoneyInput id="it-extra" value={it.extra} invalid={!!errs.extra} onValueChange={(n) => set('extra', n)} />
                </Field>
                <Field label="Jogo" htmlFor="it-game" required error={errs.gameId} className="sm:col-span-2">
                  <Select id="it-game" value={it.gameId ?? ''} placeholder="Escolha um slot" onChange={(v) => set('gameId', v || null)} options={slots.map((g) => ({ value: g.id, label: g.name }))} />
                </Field>
              </>
            )}
            {it.kind === 'cashback' && (
              <>
                <Field label="Percentual" htmlFor="it-val" required error={errs.value} hint="Sobre as perdas líquidas das 24 horas seguintes.">
                  <NumberInput id="it-val" value={it.value} min={1} max={100} suffix="%" invalid={!!errs.value} onValueChange={(n) => set('value', n)} />
                </Field>
                <Field label="Teto do cashback" htmlFor="it-extra" required error={errs.extra}>
                  <MoneyInput id="it-extra" value={it.extra} invalid={!!errs.extra} onValueChange={(n) => set('extra', n)} />
                </Field>
              </>
            )}
            {it.kind === 'aposta_gratis' && (
              <Field label="Valor da aposta grátis" htmlFor="it-val" required error={errs.value} hint="O jogador recebe só o lucro se a aposta ganhar.">
                <MoneyInput id="it-val" value={it.value} invalid={!!errs.value} onValueChange={(n) => set('value', n)} />
              </Field>
            )}
          </FormGrid>
        </DrawerSection>

        <DrawerSection title="Preço e estoque" icon={Coins}>
          <FormGrid>
            <Field label="Preço" htmlFor="it-price" required error={errs.price} hint={`≈ ${brl(it.price * coin.refValue)} em moedas.`}>
              <NumberInput id="it-price" value={it.price} min={1} suffix={coin.symbol} invalid={!!errs.price} onValueChange={(n) => set('price', Math.round(n))} />
            </Field>
            <div className="flex items-end">
              <div className={cn('w-full rounded-xl border p-3 text-[13px]', ratio != null && ratio < 1 ? 'border-warning/30 bg-warning/5' : 'border-line bg-surface-2')}>
                <p className="text-fg-2">
                  Paga <strong className="text-fg">{brl(it.price * coin.refValue)}</strong> em moedas por um prêmio de <strong className="text-fg">{brl(valueBrl)}</strong>.
                </p>
                {ratio != null && ratio < 1 && <p className="mt-0.5 text-xs font-medium text-warning">O prêmio vale mais que as moedas: a casa subsidia a diferença.</p>}
              </div>
            </div>
          </FormGrid>
          <Switch
            label="Estoque ilimitado"
            description={it.stock == null ? 'O item nunca esgota.' : 'O item sai da loja quando as unidades acabarem.'}
            checked={it.stock == null}
            onChange={(on) => set('stock', on ? null : Math.max(it.sold + 50, 100))}
          />
          <FormGrid>
            {it.stock != null && (
              <Field label="Unidades no estoque" htmlFor="it-stock" error={errs.stock} hint={`${num(it.sold)} já vendidas.`}>
                <NumberInput id="it-stock" value={it.stock} min={1} suffix="un." invalid={!!errs.stock} onValueChange={(n) => set('stock', Math.round(n))} />
              </Field>
            )}
            <Field label="Limite por jogador" htmlFor="it-limit" error={errs.limit} hint="0 = sem limite.">
              <div className="flex gap-2">
                <NumberInput id="it-limit" value={it.limitPerPlayer} min={0} invalid={!!errs.limit} onValueChange={(n) => set('limitPerPlayer', Math.round(n))} />
                <Select
                  aria-label="Período do limite"
                  className="w-36 shrink-0"
                  value={it.limitPeriod}
                  disabled={!it.limitPerPlayer}
                  onChange={(v) => set('limitPeriod', v as LimitPeriod)}
                  options={(Object.keys(LIMIT_PERIOD_LABEL) as LimitPeriod[]).map((p) => ({ value: p, label: LIMIT_PERIOD_LABEL[p] }))}
                />
              </div>
            </Field>
          </FormGrid>
        </DrawerSection>

        <DrawerSection title="Visual e publicação" icon={Sparkles}>
          <Field label="Ícone" hint="Usado quando o item não tem imagem.">
            <div role="radiogroup" aria-label="Ícone do item" className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {(Object.keys(ICONS) as ShopIcon[]).map((k) => {
                const I = ICONS[k]
                const on = it.icon === k
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={ICON_LABEL[k]}
                    title={ICON_LABEL[k]}
                    onClick={() => set('icon', k)}
                    className={cn(
                      'flex h-11 items-center justify-center rounded-lg border transition-colors',
                      on ? 'border-primary bg-primary/10 text-primary-text shadow-ring' : 'border-line bg-surface text-fg-2 hover:border-line-strong',
                    )}
                  >
                    <I size={18} aria-hidden />
                  </button>
                )
              })}
            </div>
          </Field>
          <ImageUpload label="Imagem (opcional)" value={it.image} onChange={(url) => set('image', url)} width={560} height={320} hint="Substitui o ícone no cartão." previewClassName="max-w-[280px]" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Switch className="rounded-xl border border-line p-3" label="À venda" description={it.active ? 'Aparece na loja.' : 'Fica pausado.'} checked={it.active} onChange={(on) => set('active', on)} />
            <Switch className="rounded-xl border border-line p-3" label="Destaque" description="Primeiro da loja, com selo." checked={it.featured} onChange={(on) => set('featured', on)} />
          </div>
          {isSoldOut(it) && it.active && (
            <Alert tone="warning" title="Item esgotado">
              Mesmo à venda, ele não aparece até você aumentar o estoque.
            </Alert>
          )}
        </DrawerSection>
      </div>
    </Drawer>
  )
}
