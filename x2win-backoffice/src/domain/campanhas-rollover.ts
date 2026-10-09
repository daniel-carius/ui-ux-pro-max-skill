// Rollover: peso de cada tipo de aposta, regra condicional do crash, exceções por jogo
// e onde a regra vale (bônus, saque, indicação). Funções puras.
import { mult } from '@/lib/format'
import type { GameCategory } from '@/data/catalog'

export type RolloverCategory = GameCategory | 'esportes'

export const ROLLOVER_CATEGORIES: RolloverCategory[] = ['slots', 'ao_vivo', 'mesa', 'instantaneo', 'crash', 'bingo', 'esportes']

export const ROLLOVER_CATEGORY_LABEL: Record<RolloverCategory, string> = {
  slots: 'Slots',
  ao_vivo: 'Cassino ao vivo',
  mesa: 'Jogos de mesa',
  instantaneo: 'Instantâneos',
  crash: 'Crash',
  bingo: 'Bingo',
  esportes: 'Apostas esportivas',
}

export const WEIGHT_PRESETS = [0, 0.1, 0.5, 1] as const

export interface RolloverOverride {
  gameId: string
  weight: number
}

export interface RolloverConfig {
  weights: Record<RolloverCategory, number>
  /** crash conta se a rodada terminar em perda total ou com ganho ≥ X vezes o apostado */
  crashMinMultiplier: number
  overrides: RolloverOverride[]
  appliesTo: { bonus: boolean; saque: boolean; indicacao: boolean }
}

export const ROLLOVER_KEY = 'campanhas.rollover'

export const DEFAULT_ROLLOVER: RolloverConfig = {
  weights: { slots: 1, ao_vivo: 0.1, mesa: 0.1, instantaneo: 0.5, crash: 1, bingo: 0, esportes: 1 },
  crashMinMultiplier: 2,
  overrides: [],
  appliesTo: { bonus: true, saque: true, indicacao: true },
}

export function weightLabel(w: number) {
  return mult(w)
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Confere a configuração (inclusive a gravada). Retorna o problema ou null. */
export function validateRolloverConfig(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return 'Configuração ausente ou corrompida.'
  const c = raw as Partial<RolloverConfig>
  if (!c.weights || typeof c.weights !== 'object') return 'Pesos por tipo de jogo ausentes.'
  for (const cat of ROLLOVER_CATEGORIES) {
    const w = (c.weights as Record<string, unknown>)[cat]
    if (!isNum(w)) return `Peso de ${ROLLOVER_CATEGORY_LABEL[cat]} ausente ou inválido.`
    if (w < 0 || w > 1) return `O peso de ${ROLLOVER_CATEGORY_LABEL[cat]} precisa ficar entre 0x e 1x.`
  }
  if (!isNum(c.crashMinMultiplier) || c.crashMinMultiplier < 1.01 || c.crashMinMultiplier > 1000) return 'O ganho mínimo do crash precisa ficar entre 1,01x e 1.000x.'
  if (!Array.isArray(c.overrides)) return 'Lista de exceções inválida.'
  const seen = new Set<string>()
  for (const o of c.overrides) {
    if (!o || typeof o.gameId !== 'string' || !isNum(o.weight)) return 'Há uma exceção por jogo inválida.'
    if (o.weight < 0 || o.weight > 1) return 'O peso de cada exceção precisa ficar entre 0x e 1x.'
    if (seen.has(o.gameId)) return 'O mesmo jogo aparece duas vezes nas exceções.'
    seen.add(o.gameId)
  }
  const a = c.appliesTo
  if (!a || typeof a.bonus !== 'boolean' || typeof a.saque !== 'boolean' || typeof a.indicacao !== 'boolean') return 'Indicação de onde a regra vale está inválida.'
  return null
}

export interface RolloverBet {
  category: RolloverCategory
  gameId: string | null
  amount: number
  /** quanto voltou em relação à aposta: 0 = perdeu tudo, 2 = dobrou */
  multiplier: number
}

export interface Contribution {
  weight: number
  counted: number
  counts: boolean
  source: 'tipo' | 'excecao'
  reason: string
}

/** Quanto uma aposta anda no rollover. */
export function rolloverContribution(cfg: RolloverConfig, bet: RolloverBet): Contribution {
  const override = bet.gameId ? cfg.overrides.find((o) => o.gameId === bet.gameId) : undefined
  const weight = override ? override.weight : cfg.weights[bet.category]
  const source = override ? 'excecao' : 'tipo'
  const amount = Math.max(0, bet.amount || 0)
  const base = override ? `Exceção do jogo: ${mult(weight)}` : `Peso do tipo: ${mult(weight)}`
  if (weight === 0) return { weight, counted: 0, counts: false, source, reason: `${base}. Não conta.` }
  if (bet.category === 'crash') {
    const x = cfg.crashMinMultiplier
    if (bet.multiplier === 0) return { weight, counted: round2(amount * weight), counts: true, source, reason: `Perda total no crash: conta. ${base}.` }
    if (bet.multiplier < x) return { weight, counted: 0, counts: false, source, reason: `Saiu com ${mult(bet.multiplier)}, abaixo de ${mult(x)}: não conta.` }
    return { weight, counted: round2(amount * weight), counts: true, source, reason: `Ganho de ${mult(bet.multiplier)} (≥ ${mult(x)}): conta. ${base}.` }
  }
  return { weight, counted: round2(amount * weight), counts: true, source, reason: `${base}.` }
}

export interface RolloverStatusItem {
  key: 'bonus' | 'saque' | 'indicacao'
  label: string
  on: boolean
  effective: boolean
  detail: string
}

/**
 * A regra só tem efeito onde algum rollover está ligado: no bônus (campanhas com rollover),
 * no saque (rollover de saque > 0%) ou na indicação.
 */
export function rolloverStatus(cfg: RolloverConfig, ctx: { withdrawalRolloverPct: number; bonusCampaignsWithRollover: number }) {
  const items: RolloverStatusItem[] = [
    {
      key: 'bonus',
      label: 'Bônus',
      on: cfg.appliesTo.bonus,
      effective: cfg.appliesTo.bonus && ctx.bonusCampaignsWithRollover > 0,
      detail: !cfg.appliesTo.bonus
        ? 'Desligado nesta tela.'
        : ctx.bonusCampaignsWithRollover > 0
          ? `${ctx.bonusCampaignsWithRollover} ${ctx.bonusCampaignsWithRollover === 1 ? 'campanha ativa exige' : 'campanhas ativas exigem'} rollover.`
          : 'Nenhuma campanha de bônus ativa exige rollover.',
    },
    {
      key: 'saque',
      label: 'Saque',
      on: cfg.appliesTo.saque,
      effective: cfg.appliesTo.saque && ctx.withdrawalRolloverPct > 0,
      detail: !cfg.appliesTo.saque
        ? 'Desligado nesta tela.'
        : ctx.withdrawalRolloverPct > 0
          ? `O saque exige apostar ${ctx.withdrawalRolloverPct}% do depositado.`
          : 'O rollover de saque está em 0% (desligado) em Saques › Regras.',
    },
    {
      key: 'indicacao',
      label: 'Indicação',
      on: cfg.appliesTo.indicacao,
      effective: cfg.appliesTo.indicacao,
      detail: cfg.appliesTo.indicacao ? 'Vale para prêmios de indicação (baús) com rollover.' : 'Desligado nesta tela.',
    },
  ]
  const effective = items.filter((i) => i.effective)
  const state: 'desligada' | 'parcial' | 'ligada' = effective.length === 0 ? 'desligada' : effective.length === items.length ? 'ligada' : 'parcial'
  return { state, items, effective }
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}
