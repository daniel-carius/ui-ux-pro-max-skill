// Regras do servidor para as chaves de campanha com recompensa em dinheiro
// (mesmas regras do painel, que antes só valiam no navegador):
//  - campanhas.cupons: couponErrors (bônus % até 500%, rollover 0–100x, usos…);
//    usos e criação (data/autor) são do servidor;
//  - campanhas.bonus-deposito: validateDepositBonus (1–500%, teto obrigatório,
//    rollover 0–100x, validade 1–90 dias); contadores e autor são do servidor;
//  - campanhas.cashback: validateCashback (fixo 0,1–50%, rakeback até 5% por categoria…);
//  - campanhas.free-spins.concessoes: concessão manual montada pelo servidor
//    (valor do giro, jogo e prazo vêm da campanha; autor e data do servidor;
//    jogador autoexcluído não recebe); concessão gravada só pode ser cancelada;
//  - campanhas.loja.compras: compras vêm da plataforma; o painel só confirma a
//    entrega ou estorna (pendente → entregue/estornada, entregue → estornada).
// Itens já gravados que não mudaram não são revalidados (dados antigos continuam salváveis).
import { z } from 'zod'
import { brl } from '@shared/money'
import { Errors } from '../../errors'
import { hasOwn, isPlainObject, setOwn, type JsonObject } from './json'
import { PLAYERS_KEY } from './player-status'
import { loadRow, storedValue } from './store'
import {
  describeFields,
  describeObjectChanges,
  diffItems,
  fieldNotAllowed,
  idOf,
  incomingList,
  joinParts,
  parseOr400,
  show,
  storedList,
  transitionNotAllowed,
  type KvValidator,
} from './validate-util'

const finite = (msg: string) => z.number(msg)
const dateText = (msg: string) => z.string(msg).max(40, msg).refine((s) => !Number.isNaN(Date.parse(s)), msg)

/**
 * Campos dos itens que o servidor define (o enviado é ignorado): no item gravado
 * vale o gravado (inclusive a ausência); no item novo, o padrão do servidor.
 */
function keepServerFields(item: JsonObject, prev: JsonObject | undefined, defaults: JsonObject): JsonObject {
  const out: JsonObject = { ...item }
  for (const [f, def] of Object.entries(defaults)) {
    if (!prev) setOwn(out, f, def)
    else if (hasOwn(prev, f)) setOwn(out, f, prev[f])
    else delete out[f]
  }
  return out
}

// Cupons ------------------------------------------------------------------------

export const COUPON_CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,18}[A-Z0-9]$/
export const COUPON_MAX_BONUS_PCT = 500
export const MAX_ROLLOVER = 100

const coupon = z.looseObject({
  id: z.string().min(1).max(64),
  code: z.string('Código inválido.').max(40, 'Código inválido.'),
  reward: z.enum(['bonus_pct', 'bonus_brl', 'free_spins', 'moedas'], { error: 'Tipo de recompensa inválido.' }),
  value: finite('Valor inválido.'),
  maxBonus: finite('Teto inválido.'),
  rollover: finite('Rollover inválido.'),
  maxUses: finite('Usos máximos inválidos.'),
  perPlayer: finite('Usos por jogador inválidos.'),
  startsAt: dateText('Início inválido.'),
  endsAt: dateText('Fim inválido.'),
  minDeposit: finite('Depósito mínimo inválido.'),
  paused: z.boolean('Pausa inválida.'),
})

const normalizeCode = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '')

function couponError(c: z.infer<typeof coupon>, uses: number): string | null {
  const code = normalizeCode(c.code)
  if (!COUPON_CODE_RE.test(code)) return 'código de 4 a 20 caracteres: letras, números e hífen (sem começar ou terminar com hífen).'
  if (!(c.value > 0)) return 'o valor precisa ser maior que zero.'
  if (c.reward === 'bonus_pct' && c.value > COUPON_MAX_BONUS_PCT) return `bônus de no máximo ${COUPON_MAX_BONUS_PCT}%.`
  if ((c.reward === 'free_spins' || c.reward === 'moedas') && !Number.isInteger(c.value)) return 'use um número inteiro.'
  if (c.reward === 'bonus_pct' && c.maxBonus < 0) return 'teto inválido.'
  if (c.rollover < 0 || c.rollover > MAX_ROLLOVER) return `rollover entre 0x e ${MAX_ROLLOVER}x.`
  if (!Number.isInteger(c.maxUses) || c.maxUses < 0) return 'usos máximos: use um número inteiro (0 = ilimitado).'
  if (c.maxUses > 0 && c.maxUses < uses) return `o cupom já foi usado ${uses} vezes.`
  if (!Number.isInteger(c.perPlayer) || c.perPlayer < 1) return 'pelo menos 1 uso por jogador.'
  if (c.maxUses > 0 && c.perPlayer > c.maxUses) return 'usos por jogador não podem passar dos usos totais.'
  if (Date.parse(c.endsAt) <= Date.parse(c.startsAt)) return 'o fim precisa ser depois do início.'
  if (c.minDeposit < 0) return 'depósito mínimo inválido.'
  if (c.reward === 'bonus_pct' && c.minDeposit <= 0) return 'bônus % precisa de depósito: defina o mínimo.'
  return null
}

const COUPON_MONEY = ['maxBonus', 'minDeposit']

const coupons: KvValidator = ({ next, stored, auth, now }) => {
  const list = incomingList(next, 'cupons', 2000)
  const old = storedList(stored)
  const oldById = new Map(old.map((c) => [idOf(c), c]))
  const at = new Date(now).toISOString()
  const value = list.map((raw) => {
    const prev = oldById.get(idOf(raw))
    return keepServerFields(raw, prev, { uses: 0, createdAt: at, createdBy: auth.user.name })
  })
  const d = diffItems(old, value)
  const codes = new Map<string, string>()
  for (const c of value) {
    const code = typeof c.code === 'string' ? normalizeCode(c.code) : ''
    if (code && codes.has(code)) throw Errors.invalid(`O código ${code} já existe. Códigos não diferenciam maiúsculas de minúsculas.`, { id: idOf(c) })
    codes.set(code, idOf(c))
  }
  for (const c of [...d.added, ...d.changed.map((x) => x.after)]) {
    const parsed = parseOr400(coupon, c, `Cupom ${idOf(c)}: `)
    const err = couponError(parsed, typeof c.uses === 'number' ? c.uses : 0)
    if (err) throw Errors.invalid(`Cupom ${normalizeCode(parsed.code) || idOf(c)}: ${err}`, { id: idOf(c) })
  }
  const label = (c: JsonObject) => `${show(c.code)} (${idOf(c)})`
  const parts = [
    ...d.added.map((c) => `incluído ${label(c)}: ${show(c.reward)} ${show(c.value)}, teto ${show(c.maxBonus, true)}, rollover ${show(c.rollover)}x, usos ${show(c.maxUses)}/${show(c.perPlayer)} por jogador`),
    ...d.changed.map((c) => `${label(c.after)}: ${describeFields(c, COUPON_MONEY)}`),
    ...d.removed.map((c) => `removido ${label(c)} (${show(c.reward)} ${show(c.value)}, ${show(c.uses)} usos)`),
  ]
  return { value, summary: joinParts(parts) }
}

// Bônus de depósito ---------------------------------------------------------------

const depositBonus = z.looseObject({
  id: z.string().min(1).max(64),
  name: z.string('Nome inválido.').max(120, 'Nome longo demais.').refine((s) => s.trim().length >= 4, 'dê um nome com pelo menos 4 letras.'),
  active: z.boolean('Situação inválida.'),
  bonusPct: finite('Percentual inválido.').refine((v) => v > 0 && v <= COUPON_MAX_BONUS_PCT, `bônus entre 1% e ${COUPON_MAX_BONUS_PCT}%.`),
  minDeposit: finite('Depósito mínimo inválido.').refine((v) => v > 0, 'o depósito mínimo precisa ser maior que zero.'),
  maxBonus: finite('Teto inválido.').refine((v) => v > 0, 'defina um teto para o bônus.'),
  rollover: finite('Rollover inválido.').refine((v) => v >= 0 && v <= MAX_ROLLOVER, `rollover entre 0x e ${MAX_ROLLOVER}x.`),
  rolloverBase: z.enum(['bonus', 'deposito_bonus'], { error: 'Base do rollover inválida.' }),
  usage: z.enum(['uma_vez', 'cada_deposito', 'diario'], { error: 'Uso inválido.' }),
  depositTrigger: z.enum(['qualquer', 'primeiro', 'segundo', 'terceiro'], { error: 'Depósito que libera inválido.' }),
  validityDays: finite('Validade inválida.').refine((v) => v >= 1 && v <= 90, 'validade entre 1 e 90 dias.'),
})

const BONUS_MONEY = ['minDeposit', 'maxBonus', 'bonusGranted', 'bonusConverted']

const depositBonuses: KvValidator = ({ next, stored, auth, now }) => {
  const list = incomingList(next, 'campanhas de bônus', 500)
  const old = storedList(stored)
  const oldById = new Map(old.map((c) => [idOf(c), c]))
  const at = new Date(now).toISOString()
  const value = list.map((raw) => keepServerFields(raw, oldById.get(idOf(raw)), { redemptions: 0, bonusGranted: 0, bonusConverted: 0, createdAt: at }))
  const d = diffItems(old, value)
  for (const c of [...d.added, ...d.changed.map((x) => x.after)]) {
    const p = parseOr400(depositBonus, c, `Bônus ${idOf(c)}: `)
    if (p.maxBonus < (p.minDeposit * p.bonusPct) / 100) throw Errors.invalid(`Bônus ${p.name.trim()}: o teto é menor que o bônus do depósito mínimo.`, { id: p.id })
  }
  // quem e quando alterou: do servidor
  const changedIds = new Set([...d.added, ...d.changed.map((x) => x.after)].map(idOf))
  const stamped = value.map((c) => (changedIds.has(idOf(c)) ? { ...c, updatedAt: at, updatedBy: auth.user.name } : c))
  const parts = [
    ...d.added.map((c) => `incluída ${show(c.name)} (${idOf(c)}): ${show(c.bonusPct)}% até ${show(c.maxBonus, true)}, mín. ${show(c.minDeposit, true)}, rollover ${show(c.rollover)}x`),
    ...d.changed.map((c) => `${show(c.after.name)} (${c.id}): ${describeFields({ ...c, fields: c.fields.filter((f) => f !== 'updatedAt' && f !== 'updatedBy') }, BONUS_MONEY)}`),
    ...d.removed.map((c) => `removida ${show(c.name)} (${idOf(c)})`),
  ]
  return { value: stamped, summary: joinParts(parts) }
}

// Cashback e rakeback ----------------------------------------------------------------

export const BET_CATEGORIES = ['slots', 'ao_vivo', 'crash', 'mesa', 'instantaneo', 'bingo', 'esportes'] as const
export const CASHBACK_MAX_PCT = 50
export const RAKEBACK_MAX_PCT = 5

const cashbackSchema = z.looseObject({
  cashback: z.looseObject({
    enabled: z.boolean('Cashback ligado inválido.'),
    mode: z.enum(['fixo', 'por_nivel'], { error: 'Modo do cashback inválido.' }),
    pct: finite('Percentual do cashback inválido.'),
    period: z.enum(['diario', 'semanal', 'mensal'], { error: 'Período do cashback inválido.' }),
    minLoss: finite('Perda mínima inválida.'),
    cap: finite('Teto inválido.'),
    categories: z.array(z.enum(BET_CATEGORIES, { error: 'Categoria inválida.' }), 'Categorias inválidas.'),
    rollover: finite('Rollover inválido.'),
    creditMonthDay: finite('Dia do crédito inválido.'),
    creditHour: z.string('Hora do crédito inválida.'),
    claim: z.enum(['automatico', 'resgate'], { error: 'Forma de crédito inválida.' }),
    claimDays: finite('Prazo de resgate inválido.'),
  }),
  rakeback: z.looseObject({
    enabled: z.boolean('Rakeback ligado inválido.'),
    pct: z.record(z.string(), finite('Percentual de rakeback inválido.'), 'Percentuais de rakeback inválidos.'),
    minPayout: finite('Pagamento mínimo inválido.'),
  }),
})

function cashbackError(c: z.infer<typeof cashbackSchema>): string | null {
  const cb = c.cashback
  if (cb.enabled) {
    if (cb.mode === 'fixo' && (cb.pct <= 0 || cb.pct > CASHBACK_MAX_PCT)) return `O cashback fixo precisa estar entre 0,1% e ${CASHBACK_MAX_PCT}%.`
    if (cb.minLoss < 0) return 'A perda mínima não pode ser negativa.'
    if (cb.cap < 0) return 'O teto não pode ser negativo.'
    if (cb.cap > 0 && cb.cap < 1) return 'Teto muito baixo: use pelo menos R$ 1,00 ou 0 para sem teto.'
    if (!cb.categories.length) return 'Escolha ao menos uma categoria que conta para o cashback.'
    if (cb.rollover < 0 || cb.rollover > 50) return 'O rollover do cashback vai de 0x a 50x.'
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(cb.creditHour)) return 'Hora do crédito inválida (use HH:MM).'
    if (cb.period === 'mensal' && (cb.creditMonthDay < 1 || cb.creditMonthDay > 28)) return 'O dia do crédito mensal vai de 1 a 28.'
    if (cb.claim === 'resgate' && (cb.claimDays < 1 || cb.claimDays > 30)) return 'O prazo de resgate vai de 1 a 30 dias.'
  }
  const rb = c.rakeback
  if (rb.enabled) {
    for (const cat of BET_CATEGORIES) {
      const v = rb.pct[cat]
      if (typeof v !== 'number' || v < 0 || v > RAKEBACK_MAX_PCT) return `Rakeback de ${cat} precisa estar entre 0% e ${RAKEBACK_MAX_PCT}%.`
    }
    if (!BET_CATEGORIES.some((cat) => (rb.pct[cat] ?? 0) > 0)) return 'Rakeback ligado sem nenhuma categoria acima de 0%.'
    if (rb.minPayout < 0) return 'O pagamento mínimo do rakeback não pode ser negativo.'
  }
  return null
}

const cashback: KvValidator = ({ next, stored }) => {
  const parsed = parseOr400(cashbackSchema, next)
  const err = cashbackError(parsed)
  if (err) throw Errors.invalid(err)
  const parts = describeObjectChanges(isPlainObject(stored) ? stored : {}, next)
  return { value: next, summary: parts.length ? `Alterações: ${joinParts(parts, 25)}` : 'Salvo sem alterações' }
}

// Concessões de free spins ------------------------------------------------------------

export const FS_GRANTS_KEY = 'campanhas.free-spins.concessoes'
export const FS_CAMPAIGNS_KEY = 'campanhas.free-spins'
export const MAX_GRANT_SPINS = 1000
export const MAX_NEW_GRANTS_PER_WRITE = 50

const newGrant = z.looseObject({
  id: z.string().min(1).max(64),
  campaignId: z.string('Campanha inválida.').min(1, 'Campanha inválida.').max(64, 'Campanha inválida.'),
  playerId: z.string('Jogador inválido.').min(1, 'Jogador inválido.').max(64, 'Jogador inválido.'),
  spins: z
    .number('Quantidade de giros inválida.')
    .int('Use um número inteiro de giros.')
    .min(1, 'Conceda pelo menos 1 giro.')
    .max(MAX_GRANT_SPINS, `No máximo ${MAX_GRANT_SPINS} giros por concessão.`),
  note: z.string('Motivo inválido.').trim().min(3, 'Informe o motivo da concessão.').max(300, 'Motivo com mais de 300 caracteres.'),
})

const freeSpinGrants: KvValidator = async ({ t, app, next, stored, auth, now }) => {
  const list = incomingList(next, 'concessões', 200_000)
  const old = storedList(stored)
  const d = diffItems(old, list)
  if (d.removed.length) throw fieldNotAllowed('Concessões gravadas não podem ser removidas (cancele a concessão).', { fields: [], removed: d.removed.slice(0, 20).map(idOf) })
  for (const c of d.changed) {
    const bad = c.fields.filter((f) => f !== 'status' && f !== 'note')
    if (bad.length) throw fieldNotAllowed(`Concessão ${c.id}: só é possível cancelar.`, { fields: bad, id: c.id })
    if (c.fields.includes('status') && !(c.before.status === 'ativa' && c.after.status === 'cancelada')) {
      throw transitionNotAllowed(`Concessão ${c.id}: só uma concessão em uso pode ser cancelada.`, { id: c.id })
    }
    if (typeof c.after.note !== 'string' || c.after.note.length > 300) throw Errors.invalid(`Concessão ${c.id}: motivo inválido.`, { id: c.id })
  }
  if (d.added.length > MAX_NEW_GRANTS_PER_WRITE) throw Errors.invalid(`No máximo ${MAX_NEW_GRANTS_PER_WRITE} concessões novas por vez.`)

  const built = new Map<string, JsonObject>()
  if (d.added.length) {
    const campaigns = storedList(storedValue(await loadRow(t, FS_CAMPAIGNS_KEY), app.cipher))
    const playersRow = await loadRow(t, PLAYERS_KEY)
    const players = new Map(storedList(playersRow ? storedValue(playersRow, app.cipher) : []).map((p) => [idOf(p), p]))
    const grantedAt = new Date(now).toISOString()
    for (const raw of d.added) {
      const g = parseOr400(newGrant, raw, `Concessão ${idOf(raw)}: `)
      const camp = campaigns.find((c) => c.id === g.campaignId)
      if (!camp) throw Errors.invalid(`Concessão ${g.id}: a campanha de free spins não existe.`, { id: g.id })
      const player = players.get(g.playerId)
      if (!player) throw Errors.invalid(`Concessão ${g.id}: o jogador ${g.playerId} não existe na base de jogadores.`, { id: g.id })
      if (player.status === 'autoexcluido') throw Errors.invalid(`Concessão ${g.id}: jogador autoexcluído não recebe free spins.`, { id: g.id })
      const spinValue = typeof camp.spinValue === 'number' && camp.spinValue > 0 ? camp.spinValue : 0
      const days = typeof camp.validityDays === 'number' && camp.validityDays >= 1 ? Math.min(365, Math.floor(camp.validityDays)) : 7
      built.set(g.id, {
        id: g.id,
        campaignId: g.campaignId,
        campaignName: typeof camp.name === 'string' ? camp.name : '',
        playerId: g.playerId,
        playerName: typeof player.name === 'string' ? player.name : '',
        playerEmail: typeof player.email === 'string' ? player.email : '',
        gameId: typeof camp.gameId === 'string' ? camp.gameId : '',
        spins: g.spins,
        spinValue,
        used: 0,
        winnings: 0,
        grantedAt,
        expiresAt: new Date(now + days * 86_400_000).toISOString(),
        status: 'ativa',
        origin: 'manual',
        grantedBy: auth.user.name,
        grantedById: auth.user.id,
        note: g.note,
      })
    }
  }
  const value = list.map((g) => built.get(idOf(g)) ?? g)
  const parts = [
    ...[...built.values()].map(
      (g) => `concessão manual ${idOf(g)}: ${String(g.spins)} giros de ${brl(Number(g.spinValue))} (${show(g.campaignName)}) para o jogador ${String(g.playerId)} — ${show(g.note)}`,
    ),
    ...d.changed.map((c) => `concessão ${c.id} (${show(c.before.spins)} giros, jogador ${show(c.before.playerId)}): ${describeFields(c)}`),
  ]
  return { value, summary: joinParts(parts) }
}

// Compras da loja -----------------------------------------------------------------------

const PURCHASE_TRANSITIONS: Record<string, readonly string[]> = {
  pendente: ['entregue', 'estornada'],
  entregue: ['estornada'],
  estornada: [],
}

const shopPurchases: KvValidator = ({ next, stored }) => {
  const list = incomingList(next, 'compras', 200_000)
  const old = storedList(stored)
  const d = diffItems(old, list)
  if (d.added.length || d.removed.length) {
    throw fieldNotAllowed('Compras vêm da plataforma: não é possível incluir nem remover compras pelo painel.', {
      fields: [],
      added: d.added.slice(0, 20).map(idOf),
      removed: d.removed.slice(0, 20).map(idOf),
    })
  }
  for (const c of d.changed) {
    const bad = c.fields.filter((f) => f !== 'status')
    if (bad.length) throw fieldNotAllowed(`Compra ${c.id}: só o status muda pelo painel.`, { fields: bad, id: c.id })
    const allowed = PURCHASE_TRANSITIONS[String(c.before.status)] ?? []
    if (!allowed.includes(String(c.after.status))) {
      throw transitionNotAllowed(`Compra ${c.id}: não é possível passar de ${show(c.before.status)} para ${show(c.after.status)}.`, { id: c.id })
    }
  }
  const parts = d.changed.map(
    (c) => `compra ${c.id} (${show(c.before.itemName)}, ${show(c.before.price)} moedas, ${show(c.before.valueBrl, true)}, jogador ${show(c.before.playerId)}): ${show(c.before.status)} → ${show(c.after.status)}`,
  )
  return { value: list, summary: joinParts(parts) }
}

export const CAMPAIGN_VALIDATORS: Record<string, KvValidator> = {
  'campanhas.cupons': coupons,
  'campanhas.bonus-deposito': depositBonuses,
  'campanhas.cashback': cashback,
  [FS_GRANTS_KEY]: freeSpinGrants,
  'campanhas.loja.compras': shopPurchases,
}
