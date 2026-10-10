// Campanhas (parte 2): tipos e regras compartilhadas entre Moeda, Roleta, Loja,
// Cupons, Indicação, Missões e Torneios. Funções puras: na recriação com
// servidor, estas mesmas regras devem rodar no back-end.
import { brl, num } from '@/lib/format'
import { DAY, NOW, dayKey } from '@/data/now'
import type { CampaignPlayer } from './campanhas-jogadores'

/** Chaves persistidas das telas (padrão 'campanhas.<tela>[.<coisa>]'). */
export const C2_KEYS = {
  moeda: 'campanhas.moeda',
  roleta: 'campanhas.roleta',
  roletaGiros: 'campanhas.roleta.giros',
  loja: 'campanhas.loja',
  lojaCompras: 'campanhas.loja.compras',
  cupons: 'campanhas.cupons',
  cuponsResgates: 'campanhas.cupons.resgates',
  indicacao: 'campanhas.indicacao',
  indicacaoStatus: 'campanhas.indicacao.status',
  missoes: 'campanhas.missoes',
  torneios: 'campanhas.torneios',
} as const

// ---------- Público ----------

export type Audience = 'todos' | 'novos' | 'vip' | 'depositantes' | 'inativos'

export const AUDIENCE_LABEL: Record<Audience, string> = {
  todos: 'Todos os jogadores',
  novos: 'Novos (até 7 dias)',
  vip: 'VIP',
  depositantes: 'Já depositaram',
  inativos: 'Inativos (+30 dias)',
}

export const AUDIENCE_SHORT: Record<Audience, string> = {
  todos: 'Todos',
  novos: 'Novos',
  vip: 'VIP',
  depositantes: 'Depositantes',
  inativos: 'Inativos',
}

export const AUDIENCE_OPTIONS = (Object.keys(AUDIENCE_LABEL) as Audience[]).map((a) => ({ value: a, label: AUDIENCE_LABEL[a] }))

/** O jogador faz parte do público? */
export function inAudience(p: Pick<CampaignPlayer, 'createdAt' | 'lastAccess' | 'tags' | 'depositsCount'>, a: Audience, now: Date = NOW): boolean {
  switch (a) {
    case 'todos':
      return true
    case 'novos':
      return now.getTime() - new Date(p.createdAt).getTime() <= 7 * DAY
    case 'vip':
      return p.tags.includes('VIP')
    case 'depositantes':
      return p.depositsCount > 0
    case 'inativos':
      return now.getTime() - new Date(p.lastAccess).getTime() > 30 * DAY
  }
}

// ---------- Recompensas ----------

export type RewardKind = 'bonus_brl' | 'bonus_pct' | 'free_spins' | 'moedas' | 'cashback' | 'aposta_gratis' | 'dinheiro' | 'nada'

export interface Reward {
  kind: RewardKind
  value: number
}

export const REWARD_LABEL: Record<RewardKind, string> = {
  bonus_brl: 'Bônus em R$',
  bonus_pct: 'Bônus %',
  free_spins: 'Free spins',
  moedas: 'Moedas',
  cashback: 'Cashback',
  aposta_gratis: 'Aposta grátis',
  dinheiro: 'Saldo real',
  nada: 'Nada',
}

/** Informação mínima da moeda do site para textos e custos. */
export interface CoinInfo {
  symbol: string
  name: string
  /** quanto vale 1 moeda em R$ */
  refValue: number
}

/** Valor de referência de um giro grátis (padrão das campanhas de free spins). */
export const FREE_SPIN_VALUE = 0.4

/** Texto completo: "R$ 20,00 de bônus", "50 free spins", "500 EVC". */
export function rewardText(r: Reward, coin: Pick<CoinInfo, 'symbol'>): string {
  switch (r.kind) {
    case 'bonus_brl':
      return `${brl(r.value)} de bônus`
    case 'bonus_pct':
      return `${num(r.value)}% de bônus`
    case 'free_spins':
      return `${num(r.value)} free spins`
    case 'moedas':
      return `${num(r.value)} ${coin.symbol}`
    case 'cashback':
      return `${num(r.value)}% de cashback`
    case 'aposta_gratis':
      return `Aposta grátis de ${brl(r.value)}`
    case 'dinheiro':
      return `${brl(r.value)} em saldo real`
    case 'nada':
      return 'Não foi dessa vez'
  }
}

/** Texto curto para espaços pequenos (roleta, chips): "R$ 5", "20 FS", "100 EVC". */
export function rewardShort(r: Reward, coin: Pick<CoinInfo, 'symbol'>): string {
  const money = (v: number) => `R$ ${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`
  switch (r.kind) {
    case 'bonus_brl':
    case 'dinheiro':
    case 'aposta_gratis':
      return money(r.value)
    case 'bonus_pct':
    case 'cashback':
      return `${num(r.value)}%`
    case 'free_spins':
      return `${num(r.value)} FS`
    case 'moedas':
      return `${num(r.value)} ${coin.symbol}`
    case 'nada':
      return 'Nada'
  }
}

/**
 * Custo estimado da recompensa para a casa, em R$.
 * `base` é o valor sobre o qual um percentual incide (depósito, perda).
 */
export function rewardCost(r: Reward, coin: Pick<CoinInfo, 'refValue'>, base = 0, cap?: number): number {
  let v: number
  switch (r.kind) {
    case 'bonus_brl':
    case 'dinheiro':
    case 'aposta_gratis':
      v = r.value
      break
    case 'bonus_pct':
    case 'cashback':
      v = (base * r.value) / 100
      break
    case 'free_spins':
      v = r.value * FREE_SPIN_VALUE
      break
    case 'moedas':
      v = r.value * coin.refValue
      break
    case 'nada':
      v = 0
      break
  }
  return cap != null && cap > 0 ? Math.min(v, cap) : v
}

// ---------- Utilidades ----------

/** Apelido mascarado para rankings públicos: "tig***in". */
export function maskNick(nick: string): string {
  if (nick.length <= 4) return `${nick.slice(0, 1)}***`
  return `${nick.slice(0, 3)}***${nick.slice(-2)}`
}

/** ISO → "AAAA-MM-DD" (para <input type="date">) */
export function toDateInput(isoStr: string | null | undefined): string {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return Number.isNaN(d.getTime()) ? '' : dayKey(d)
}

/** "AAAA-MM-DD" → ISO no início (ou fim) do dia local */
export function fromDateInput(v: string, endOfDay = false): string {
  const d = new Date(`${v}T${endOfDay ? '23:59:59' : '00:00:00'}`)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/** ISO → "AAAA-MM-DDTHH:mm" (para <input type="datetime-local">) */
export function toDateTimeInput(isoStr: string | null | undefined): string {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${dayKey(d)}T${hh}:${mm}`
}

export function fromDateTimeInput(v: string): string {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/** "faltam 3d 4h", "faltam 45 min" */
export function timeUntil(isoStr: string, now: Date = new Date()): string {
  const ms = new Date(isoStr).getTime() - now.getTime()
  if (ms <= 0) return 'encerrado'
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ${min % 60}min`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

/** Hash simples e estável de texto (semente de dados derivados). */
export function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
