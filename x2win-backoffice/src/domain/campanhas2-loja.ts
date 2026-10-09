// Loja: itens comprados com a moeda do site.
import { brl, num } from '@/lib/format'
import { DAY } from '@/data/now'
import { FREE_SPIN_VALUE, type CoinInfo } from './campanhas2-common'

export type ShopKind = 'bonus' | 'free_spins' | 'cashback' | 'aposta_gratis'
export type ShopIcon = 'gift' | 'sparkles' | 'percent' | 'ticket' | 'crown' | 'zap' | 'star' | 'gem'
export type LimitPeriod = 'dia' | 'semana' | 'mes' | 'sempre'
export type PurchaseStatus = 'entregue' | 'pendente' | 'estornada'

export const SHOP_KIND_LABEL: Record<ShopKind, string> = {
  bonus: 'Bônus',
  free_spins: 'Free spins',
  cashback: 'Cashback',
  aposta_gratis: 'Aposta grátis',
}

export const LIMIT_PERIOD_LABEL: Record<LimitPeriod, string> = {
  dia: 'por dia',
  semana: 'por semana',
  mes: 'por mês',
  sempre: 'no total',
}

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  entregue: 'Entregue',
  pendente: 'Pendente',
  estornada: 'Estornada',
}

export interface ShopItem {
  id: string
  name: string
  description: string
  kind: ShopKind
  /** bônus/aposta grátis: R$ · free spins: quantidade · cashback: % */
  value: number
  /** cashback: teto em R$ · free spins: valor por giro */
  extra: number
  /** jogo dos free spins */
  gameId: string | null
  /** rollover do bônus (x) */
  rollover: number
  icon: ShopIcon
  image: string | null
  /** preço em moedas */
  price: number
  /** null = ilimitado */
  stock: number | null
  sold: number
  /** 0 = sem limite */
  limitPerPlayer: number
  limitPeriod: LimitPeriod
  active: boolean
  featured: boolean
  createdAt: string
  updatedAt: string
}

export interface ShopPurchase {
  id: string
  itemId: string
  itemName: string
  kind: ShopKind
  playerId: string
  playerName: string
  playerEmail: string
  price: number
  /** valor do prêmio em R$ (estimado) */
  valueBrl: number
  at: string
  status: PurchaseStatus
}

/** Texto do prêmio: "R$ 10,00 de bônus (10x)", "30 free spins em Fortune Tiger". */
export function itemRewardText(item: Pick<ShopItem, 'kind' | 'value' | 'extra' | 'rollover'>, gameName?: string): string {
  switch (item.kind) {
    case 'bonus':
      return `${brl(item.value)} de bônus${item.rollover ? ` · rollover ${num(item.rollover)}x` : ''}`
    case 'free_spins':
      return `${num(item.value)} free spins${gameName ? ` em ${gameName}` : ''}`
    case 'cashback':
      return `${num(item.value)}% de cashback${item.extra ? ` até ${brl(item.extra)}` : ''}`
    case 'aposta_gratis':
      return `Aposta grátis de ${brl(item.value)}`
  }
}

/** Valor do prêmio em R$ (para custo e comparação com o preço). */
export function itemValueBrl(item: Pick<ShopItem, 'kind' | 'value' | 'extra'>): number {
  switch (item.kind) {
    case 'bonus':
    case 'aposta_gratis':
      return item.value
    case 'free_spins':
      return item.value * (item.extra > 0 ? item.extra : FREE_SPIN_VALUE)
    case 'cashback':
      return item.extra
  }
}

export function stockLeft(item: Pick<ShopItem, 'stock' | 'sold'>): number | null {
  return item.stock == null ? null : Math.max(0, item.stock - item.sold)
}

export function isSoldOut(item: Pick<ShopItem, 'stock' | 'sold'>) {
  return item.stock != null && item.sold >= item.stock
}

export type ItemErrors = Partial<Record<'name' | 'value' | 'extra' | 'price' | 'stock' | 'limit' | 'gameId' | 'rollover', string>>

export function shopItemErrors(item: ShopItem, others: ShopItem[]): ItemErrors {
  const e: ItemErrors = {}
  const name = item.name.trim()
  if (!name) e.name = 'Informe o nome do item.'
  else if (others.some((o) => o.id !== item.id && o.name.trim().toLowerCase() === name.toLowerCase())) e.name = 'Já existe um item com este nome.'
  if (!(item.value > 0)) e.value = 'O valor precisa ser maior que zero.'
  else if (item.kind === 'cashback' && item.value > 100) e.value = 'Cashback de no máximo 100%.'
  else if (item.kind === 'free_spins' && !Number.isInteger(item.value)) e.value = 'Use um número inteiro de giros.'
  if (item.kind === 'cashback' && !(item.extra > 0)) e.extra = 'Defina o teto do cashback.'
  if (item.kind === 'free_spins' && !(item.extra > 0)) e.extra = 'Defina o valor de cada giro.'
  if (item.kind === 'free_spins' && !item.gameId) e.gameId = 'Escolha o jogo dos giros.'
  if (item.kind === 'bonus' && (item.rollover < 0 || item.rollover > 100)) e.rollover = 'Rollover entre 0x e 100x.'
  if (!Number.isInteger(item.price) || item.price < 1) e.price = 'O preço precisa ser de pelo menos 1 moeda.'
  if (item.stock != null) {
    if (!Number.isInteger(item.stock) || item.stock < 1) e.stock = 'Estoque de pelo menos 1 unidade.'
    else if (item.stock < item.sold) e.stock = `Já foram vendidas ${num(item.sold)} unidades. O estoque não pode ser menor.`
  }
  if (!Number.isInteger(item.limitPerPlayer) || item.limitPerPlayer < 0) e.limit = 'Use um número inteiro (0 = sem limite).'
  return e
}

/** Relação entre o que o jogador paga (moedas em R$) e o que recebe. < 1 = o prêmio vale mais do que as moedas. */
export function priceRatio(item: Pick<ShopItem, 'kind' | 'value' | 'extra' | 'price'>, coin: Pick<CoinInfo, 'refValue'>) {
  const v = itemValueBrl(item)
  return v > 0 ? (item.price * coin.refValue) / v : null
}

/** O jogador pode comprar? Regras de status, estoque, limite e saldo. */
export function canBuy(
  item: ShopItem,
  playerCoins: number,
  playerPurchases: Pick<ShopPurchase, 'itemId' | 'at' | 'status'>[],
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: string } {
  if (!item.active) return { ok: false, reason: 'Item pausado.' }
  if (isSoldOut(item)) return { ok: false, reason: 'Item esgotado.' }
  if (playerCoins < item.price) return { ok: false, reason: `Saldo insuficiente: faltam ${num(item.price - playerCoins)} moedas.` }
  if (item.limitPerPlayer > 0) {
    const windowMs = { dia: DAY, semana: 7 * DAY, mes: 30 * DAY, sempre: Infinity }[item.limitPeriod]
    const count = playerPurchases.filter((p) => p.itemId === item.id && p.status !== 'estornada' && now.getTime() - new Date(p.at).getTime() < windowMs).length
    if (count >= item.limitPerPlayer) return { ok: false, reason: `Limite de ${item.limitPerPlayer} ${LIMIT_PERIOD_LABEL[item.limitPeriod]} atingido.` }
  }
  return { ok: true }
}
