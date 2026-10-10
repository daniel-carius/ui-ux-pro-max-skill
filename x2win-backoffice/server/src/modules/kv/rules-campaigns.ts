// Regras do servidor para as chaves de campanha com recompensa em dinheiro
// (mesmas regras do painel, que antes só valiam no navegador):
//  - campanhas.cupons: couponErrors (bônus % até 500%, rollover 0–100x, usos…);
//    usos e criação (data/autor) são do servidor;
//  - campanhas.bonus-deposito: validateDepositBonus (1–500%, teto obrigatório,
//    rollover 0–100x, validade 1–90 dias); contadores e autor são do servidor;
//  - campanhas.cashback: validateCashback (fixo 0,1–50%, rakeback até 5% por categoria…);
//  - campanhas.free-spins.concessoes: concessão manual montada pelo servidor
//    (valor do giro, jogo e prazo vêm da campanha; autor e data do servidor);
//    mesmas recusas do painel (canGrant): jogador autoexcluído, em pausa de jogo
//    responsável ou bloqueado, campanha encerrada (fim no passado) e acima do limite
//    por jogador (maxPerPlayer, contando as concessões não canceladas, inclusive as
//    desta gravação); concessão gravada só pode ser cancelada;
//  - campanhas.loja.compras: compras vêm da plataforma; o painel só confirma a
//    entrega ou estorna (pendente → entregue/estornada, entregue → estornada);
//  - campanhas.niveis: validateLevelsConfig (2–20 níveis, nome até 24 letras sem
//    repetir, XP crescente a partir de 0, cashback 0–30%, presente ≥ 0, giros
//    inteiros, XP por R$ 10 de 0 a 20, evento 1x–5x com dia e nome);
//  - campanhas.missoes: missionErrors (nome até 60, meta > 0 conforme o objetivo,
//    recompensa > 0, cashback até 100%, fim depois do início); contadores da
//    plataforma (started, completions) são do servidor;
//  - campanhas.torneios: tournamentErrors (jogos, duração de pelo menos 1 h, aposta
//    mínima ≥ 0, prêmios > 0 e sem posição valendo mais que a anterior); inscritos
//    (participants) são da plataforma; quem encerrou e quando vêm do servidor;
//  - campanhas.roleta: wheelErrors (2–12 prêmios, chances de 0 a 100% somando 100%,
//    1–50 giros por dia, custo inteiro ≥ 0);
//  - campanhas.loja: shopItemErrors (nome único, valor > 0, cashback até 100% com teto,
//    giros inteiros com valor e jogo, rollover 0–100x, preço ≥ 1 moeda, estoque ≥
//    vendidos); vendidos (sold) são da plataforma.
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
  round2,
  show,
  storedList,
  transitionNotAllowed,
  type KvValidator,
  type KvWriteCheck,
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

/** Status do jogador que não recebe giros (mesmas mensagens do painel, canGrant). */
const GRANT_REFUSED_STATUS = new Map<unknown, string>([
  ['autoexcluido', 'jogador autoexcluído não recebe free spins (Lei 14.790/2023).'],
  ['pausa', 'jogador em pausa de jogo responsável não pode receber giros.'],
  ['bloqueado', 'jogador bloqueado não pode receber giros.'],
])

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
    const addedIds = new Set(d.added.map(idOf))
    for (const raw of d.added) {
      const g = parseOr400(newGrant, raw, `Concessão ${idOf(raw)}: `)
      const camp = campaigns.find((c) => c.id === g.campaignId)
      if (!camp) throw Errors.invalid(`Concessão ${g.id}: a campanha de free spins não existe.`, { id: g.id })
      const player = players.get(g.playerId)
      if (!player) throw Errors.invalid(`Concessão ${g.id}: o jogador ${g.playerId} não existe na base de jogadores.`, { id: g.id })
      const refuse = GRANT_REFUSED_STATUS.get(player.status)
      if (refuse) throw Errors.invalid(`Concessão ${g.id}: ${refuse}`, { id: g.id })
      const endAt = typeof camp.endAt === 'string' ? Date.parse(camp.endAt) : Number.NaN
      if (!Number.isNaN(endAt) && endAt < now) throw Errors.invalid(`Concessão ${g.id}: esta campanha está encerrada.`, { id: g.id })
      const max = typeof camp.maxPerPlayer === 'number' && Number.isFinite(camp.maxPerPlayer) && camp.maxPerPlayer >= 1 ? Math.floor(camp.maxPerPlayer) : null
      if (max !== null) {
        // concessões não canceladas deste jogador nesta campanha, já na lista nova (gravadas e desta gravação até aqui)
        const already = list.filter((x) => {
          const item = addedIds.has(idOf(x)) ? built.get(idOf(x)) : x
          return !!item && item.campaignId === g.campaignId && item.playerId === g.playerId && item.status !== 'cancelada'
        }).length
        if (already >= max) {
          throw Errors.invalid(`Concessão ${g.id}: o jogador já recebeu esta campanha ${already} ${already === 1 ? 'vez' : 'vezes'} (limite: ${max}).`, { id: g.id })
        }
      }
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

// Níveis e XP --------------------------------------------------------------------------

/** Nomes das categorias nas mensagens (os mesmos do painel). */
const BET_CATEGORY_LABEL: Record<(typeof BET_CATEGORIES)[number], string> = {
  slots: 'Slots',
  ao_vivo: 'Ao vivo',
  crash: 'Crash',
  mesa: 'Mesa',
  instantaneo: 'Instantâneo',
  bingo: 'Bingo',
  esportes: 'Esportes',
}

export const LEVELS_MIN = 2
export const LEVELS_MAX = 20
export const LEVEL_NAME_MAX = 24
export const LEVEL_CASHBACK_MAX_PCT = 30
export const XP_PER_TEN_MAX = 20
export const XP_EVENT_MAX_MULTIPLIER = 5

const colorSlot = (msg: string) => z.number(msg).int(msg).min(1, msg).max(8, msg)

const levelItem = z.looseObject({
  id: z.string('Nível sem identificador.').min(1, 'Nível sem identificador.').max(64, 'Nível sem identificador.'),
  name: z.string('Nome do nível inválido.'),
  xp: finite('XP do nível inválido.'),
  slot: colorSlot('Cor do nível inválida.'),
  cashbackPct: finite('Cashback do nível inválido.'),
  priorityWithdrawal: z.boolean('Saque prioritário inválido.'),
  levelUpGift: finite('Presente do nível inválido.'),
  freeSpins: finite('Giros do nível inválidos.'),
})

const levelsSchema = z.looseObject(
  {
    enabled: z.boolean('Trilha ligada inválida.'),
    keepLevel: z.boolean('Manter nível inválido.'),
    levels: z.array(levelItem, 'Envie os níveis.').min(LEVELS_MIN, `A trilha precisa de pelo menos ${LEVELS_MIN} níveis.`).max(LEVELS_MAX, `Use no máximo ${LEVELS_MAX} níveis.`),
    xp: z.looseObject({
      perTen: z.record(z.string(), finite('XP por aposta inválido.'), 'XP por aposta inválido.'),
      depositXp: finite('XP por depósito inválido.'),
      depositMin: finite('Depósito mínimo para XP inválido.'),
      bonusBetsCount: z.boolean('Apostas com bônus inválido.'),
      event: z.looseObject({
        enabled: z.boolean('Evento de XP inválido.'),
        name: z.string('Nome do evento inválido.').max(120, 'Nome do evento longo demais.'),
        multiplier: finite('Multiplicador do evento inválido.'),
        weekdays: z.array(z.number('Dia do evento inválido.').int('Dia do evento inválido.').min(0, 'Dia do evento inválido.').max(6, 'Dia do evento inválido.'), 'Dias do evento inválidos.'),
      }),
    }),
  },
  'Envie a configuração completa de níveis e XP.',
)

/** Mesmas regras de levelErrors/validateLevelsConfig do painel. */
function levelsError(c: z.infer<typeof levelsSchema>): string | null {
  const names = new Map<string, number>()
  for (const l of c.levels) {
    const k = l.name.trim().toLowerCase()
    if (k) names.set(k, (names.get(k) ?? 0) + 1)
  }
  for (const [i, l] of c.levels.entries()) {
    const name = l.name.trim()
    const err = (() => {
      if (!name) return 'Dê um nome ao nível.'
      if (name.length > LEVEL_NAME_MAX) return `Use até ${LEVEL_NAME_MAX} caracteres.`
      if ((names.get(name.toLowerCase()) ?? 0) > 1) return 'Nome repetido.'
      if (l.xp < 0) return 'XP inválido.'
      if (i === 0 && l.xp !== 0) return 'O primeiro nível começa em 0 XP.'
      if (i > 0 && l.xp <= c.levels[i - 1].xp) return `Precisa ser maior que ${c.levels[i - 1].xp.toLocaleString('pt-BR')} XP.`
      if (l.cashbackPct < 0 || l.cashbackPct > LEVEL_CASHBACK_MAX_PCT) return `De 0% a ${LEVEL_CASHBACK_MAX_PCT}%.`
      if (l.levelUpGift < 0) return 'Valor inválido.'
      if (l.freeSpins < 0 || !Number.isInteger(l.freeSpins)) return 'Número inteiro.'
      return null
    })()
    if (err) return `${name || 'Nível sem nome'}: ${err}`
  }
  for (const cat of BET_CATEGORIES) {
    const v = c.xp.perTen[cat]
    if (typeof v !== 'number' || v < 0 || v > XP_PER_TEN_MAX) return `XP de ${BET_CATEGORY_LABEL[cat]} precisa estar entre 0 e ${XP_PER_TEN_MAX}.`
  }
  if (c.xp.depositXp < 0) return 'XP por depósito não pode ser negativo.'
  const ev = c.xp.event
  if (ev.enabled) {
    if (ev.multiplier < 1 || ev.multiplier > XP_EVENT_MAX_MULTIPLIER) return `O multiplicador do evento vai de 1x a ${XP_EVENT_MAX_MULTIPLIER}x.`
    if (!ev.weekdays.length) return 'Escolha ao menos um dia para o evento de XP.'
    if (!ev.name.trim()) return 'Dê um nome ao evento de XP.'
  }
  return null
}

const levels: KvValidator = ({ next, stored }) => {
  const parsed = parseOr400(levelsSchema, next)
  const err = levelsError(parsed)
  if (err) throw Errors.invalid(err)
  const parts = describeObjectChanges(isPlainObject(stored) ? stored : {}, next)
  return { value: next, summary: parts.length ? `Alterações: ${joinParts(parts, 25)}` : 'Salvo sem alterações' }
}

// Missões --------------------------------------------------------------------------------

export const GAME_CATEGORIES = ['slots', 'ao_vivo', 'crash', 'mesa', 'instantaneo', 'bingo'] as const
const AUDIENCES = ['todos', 'novos', 'vip', 'depositantes', 'inativos'] as const
export const MISSION_NAME_MAX = 60
const MAX_CAMPAIGN_ITEMS = 1000

const mission = z.looseObject({
  id: z.string().min(1).max(64),
  name: z.string('Nome inválido.'),
  objective: z.looseObject({
    kind: z.enum(['apostar', 'depositar', 'rodadas', 'multiplicador', 'login'], { error: 'Objetivo inválido.' }),
    target: finite('Meta inválida.'),
    scope: z.enum(['qualquer', 'categoria', 'jogo'], { error: 'Escopo do objetivo inválido.' }),
    category: z.enum(GAME_CATEGORIES, { error: 'Categoria do objetivo inválida.' }),
    gameId: z.string('Jogo inválido.').max(64, 'Jogo inválido.').nullable(),
  }),
  reward: z.looseObject({
    kind: z.enum(['bonus_brl', 'free_spins', 'moedas', 'cashback'], { error: 'Tipo de recompensa inválido.' }),
    value: finite('Valor da recompensa inválido.'),
  }),
  recurrence: z.enum(['diaria', 'semanal', 'unica'], { error: 'Recorrência inválida.' }),
  audience: z.enum(AUDIENCES, { error: 'Público inválido.' }),
  status: z.enum(['ativa', 'pausada', 'rascunho', 'encerrada'], { error: 'Situação inválida.' }),
  startsAt: z.string('Início inválido.').max(40, 'Início inválido.'),
  endsAt: z.string('Fim inválido.').max(40, 'Fim inválido.').nullable(),
})

/** Mesmas regras de missionErrors do painel. */
function missionError(m: z.infer<typeof mission>): string | null {
  const name = m.name.trim()
  if (!name) return 'Dê um nome para a missão.'
  if (name.length > MISSION_NAME_MAX) return `Use até ${MISSION_NAME_MAX} caracteres.`
  const o = m.objective
  if (!(o.target > 0)) return 'A meta precisa ser maior que zero.'
  if (o.kind === 'multiplicador' && o.target < 1.01) return 'Multiplicador a partir de 1,01x.'
  if ((o.kind === 'rodadas' || o.kind === 'login') && !Number.isInteger(o.target)) return 'Use um número inteiro.'
  if (o.kind === 'login' && m.recurrence === 'diaria') return 'Login em dias seguidos não combina com missão diária.'
  if (o.kind === 'login' && m.recurrence === 'semanal' && o.target > 7) return 'Em missão semanal, no máximo 7 dias.'
  if ((o.kind === 'apostar' || o.kind === 'rodadas' || o.kind === 'multiplicador') && o.scope === 'jogo' && !o.gameId) return 'Escolha o jogo.'
  if (!(m.reward.value > 0)) return 'A recompensa precisa ser maior que zero.'
  if (m.reward.kind === 'cashback' && m.reward.value > 100) return 'Cashback de no máximo 100%.'
  if (!m.startsAt) return 'Informe o início.'
  if (Number.isNaN(Date.parse(m.startsAt))) return 'Início inválido.'
  if (m.endsAt) {
    if (Number.isNaN(Date.parse(m.endsAt))) return 'Fim inválido.'
    if (Date.parse(m.endsAt) <= Date.parse(m.startsAt)) return 'O fim precisa ser depois do início.'
  }
  return null
}

const missions: KvValidator = ({ next, stored, now }) => {
  const list = incomingList(next, 'missões', MAX_CAMPAIGN_ITEMS)
  const old = storedList(stored)
  const oldById = new Map(old.map((m) => [idOf(m), m]))
  const at = new Date(now).toISOString()
  // contadores da plataforma (quem começou e concluiu): do servidor
  const value = list.map((raw) => keepServerFields(raw, oldById.get(idOf(raw)), { started: 0, completions: 0, createdAt: at }))
  const d = diffItems(old, value)
  for (const m of [...d.added, ...d.changed.map((x) => x.after)]) {
    const p = parseOr400(mission, m, `Missão ${idOf(m)}: `)
    const err = missionError(p)
    if (err) throw Errors.invalid(`Missão ${p.name.trim() || idOf(m)}: ${err}`, { id: idOf(m) })
  }
  const label = (m: JsonObject) => `${show(m.name)} (${idOf(m)})`
  const reward = (m: JsonObject) => (isPlainObject(m.reward) ? `${show(m.reward.kind)} ${show(m.reward.value)}` : '—')
  const parts = [
    ...d.added.map((m) => `incluída ${label(m)}: recompensa ${reward(m)}, ${show(m.recurrence)}, ${show(m.status)}`),
    ...d.changed.map((c) => `${label(c.after)}: ${describeFields(c)}`),
    ...d.removed.map((m) => `removida ${label(m)} (recompensa ${reward(m)})`),
  ]
  return { value, summary: joinParts(parts) }
}

// Torneios ---------------------------------------------------------------------------------

/** Valor de referência de um giro grátis (mesmo do painel: FREE_SPIN_VALUE). */
export const FREE_SPIN_REF_VALUE = 0.4
/** Valor de 1 moeda quando a moeda do site não foi configurada (DEFAULT_COIN_CONFIG.refValue do painel). */
export const DEFAULT_COIN_REF_VALUE = 0.01
export const TOURNAMENT_MIN_DURATION_MS = 3_600_000
export const COIN_KEY = 'campanhas.moeda'

/** Valor de 1 moeda em R$ (campanhas.moeda), como coinInfo do painel. */
async function coinRefValue(c: Pick<KvWriteCheck, 't' | 'app'>): Promise<number> {
  const cfg = storedValue(await loadRow(c.t, COIN_KEY), c.app.cipher)
  const v = isPlainObject(cfg) ? cfg.refValue : undefined
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : DEFAULT_COIN_REF_VALUE
}

/** Valor do prêmio em R$ (rewardCost do painel). */
function prizeBrl(p: { kind: string; value: number }, coinValue: number): number {
  if (p.kind === 'free_spins') return p.value * FREE_SPIN_REF_VALUE
  if (p.kind === 'moedas') return p.value * coinValue
  return p.value
}

const tournament = z.looseObject({
  id: z.string().min(1).max(64),
  name: z.string('Nome inválido.').max(120, 'Nome longo demais.'),
  gameIds: z.array(z.string('Jogo inválido.').min(1, 'Jogo inválido.').max(64, 'Jogo inválido.'), 'Jogos inválidos.'),
  startsAt: z.string('Início inválido.').max(40, 'Início inválido.'),
  endsAt: z.string('Fim inválido.').max(40, 'Fim inválido.'),
  scoring: z.enum(['maior_multiplicador', 'maior_ganho', 'volume_apostado'], { error: 'Pontuação inválida.' }),
  minBet: finite('Aposta mínima inválida.'),
  prizes: z.array(
    z.looseObject({
      id: z.string('Prêmio sem identificador.').min(1, 'Prêmio sem identificador.').max(64, 'Prêmio sem identificador.'),
      kind: z.enum(['dinheiro', 'bonus_brl', 'free_spins', 'moedas'], { error: 'Tipo de prêmio inválido.' }),
      value: finite('Valor do prêmio inválido.'),
    }),
    'Prêmios inválidos.',
  ),
  audience: z.enum(AUDIENCES, { error: 'Público inválido.' }),
})

/** Mesmas regras de tournamentErrors do painel. */
function tournamentError(t: z.infer<typeof tournament>, coinValue: number): string | null {
  if (!t.name.trim()) return 'Dê um nome para o torneio.'
  if (!t.gameIds.length) return 'Escolha pelo menos um jogo.'
  const start = Date.parse(t.startsAt)
  const end = Date.parse(t.endsAt)
  if (!t.startsAt || !t.endsAt || Number.isNaN(start) || Number.isNaN(end)) return 'Informe início e fim.'
  if (end <= start) return 'O fim precisa ser depois do início.'
  if (end - start < TOURNAMENT_MIN_DURATION_MS) return 'O torneio precisa durar pelo menos 1 hora.'
  if (t.minBet < 0) return 'Aposta mínima inválida.'
  if (!t.prizes.length) return 'Defina o prêmio de pelo menos uma posição.'
  for (const [i, p] of t.prizes.entries()) {
    if (!(p.value > 0)) return `Prêmio do ${i + 1}º lugar: valor maior que zero.`
    if ((p.kind === 'free_spins' || p.kind === 'moedas') && !Number.isInteger(p.value)) return `Prêmio do ${i + 1}º lugar: use um número inteiro.`
    if (i > 0 && prizeBrl(p, coinValue) > prizeBrl(t.prizes[i - 1], coinValue)) return `Prêmio do ${i + 1}º lugar vale mais que o prêmio do ${i}º lugar.`
  }
  return null
}

/** Campos que mudam sem revalidar o torneio (encerrar um torneio antigo nunca é recusado). */
const TOURNAMENT_CLOSE_FIELDS = ['closedAt', 'closedBy', 'updatedAt']

const tournaments: KvValidator = async (c) => {
  const { next, stored, auth, now } = c
  const list = incomingList(next, 'torneios', MAX_CAMPAIGN_ITEMS)
  const old = storedList(stored)
  const oldById = new Map(old.map((x) => [idOf(x), x]))
  const at = new Date(now).toISOString()
  const value = list.map((raw) => {
    const prev = oldById.get(idOf(raw))
    // inscritos vêm da plataforma; data de criação do servidor
    const out = keepServerFields(raw, prev, { participants: 0, createdAt: at })
    // encerramento: quem e quando vêm do servidor; encerrado não reabre nem muda de autor
    if (prev && typeof prev.closedAt === 'string') {
      setOwn(out, 'closedAt', prev.closedAt)
      setOwn(out, 'closedBy', hasOwn(prev, 'closedBy') ? prev.closedBy : null)
    } else if (out.closedAt != null) {
      setOwn(out, 'closedAt', at)
      setOwn(out, 'closedBy', auth.user.name)
    } else {
      setOwn(out, 'closedAt', null)
      setOwn(out, 'closedBy', null)
    }
    return out
  })
  const d = diffItems(old, value)
  const toCheck = [...d.added, ...d.changed.filter((x) => x.fields.some((f) => !TOURNAMENT_CLOSE_FIELDS.includes(f))).map((x) => x.after)]
  if (toCheck.length) {
    const coinValue = await coinRefValue(c)
    for (const t of toCheck) {
      const p = parseOr400(tournament, t, `Torneio ${idOf(t)}: `)
      const err = tournamentError(p, coinValue)
      if (err) throw Errors.invalid(`Torneio ${p.name.trim() || idOf(t)}: ${err}`, { id: idOf(t) })
    }
  }
  const label = (t: JsonObject) => `${show(t.name)} (${idOf(t)})`
  const prizes = (t: JsonObject) => (Array.isArray(t.prizes) ? t.prizes.length : 0)
  const parts = [
    ...d.added.map((t) => `incluído ${label(t)}: ${show(t.startsAt)} a ${show(t.endsAt)}, ${prizes(t)} ${prizes(t) === 1 ? 'prêmio' : 'prêmios'}`),
    ...d.changed.map((x) => (x.before.closedAt == null && x.after.closedAt != null ? `${label(x.after)}: encerrado antes do fim previsto (${show(x.after.endsAt)})` : `${label(x.after)}: ${describeFields(x)}`)),
    ...d.removed.map((t) => `removido ${label(t)} (${show(t.participants)} inscritos)`),
  ]
  return { value, summary: joinParts(parts) }
}

// Roletas ------------------------------------------------------------------------------------

export const WHEEL_MIN_PRIZES = 2
export const WHEEL_MAX_PRIZES = 12
export const WHEEL_MAX_SPINS_PER_DAY = 50

const wheel = z.looseObject({
  id: z.string().min(1).max(64),
  name: z.string('Nome inválido.').max(120, 'Nome longo demais.'),
  group: z.enum(['todos', 'novos', 'vip'], { error: 'Grupo inválido.' }),
  prizes: z.array(
    z.looseObject({
      id: z.string('Prêmio sem identificador.').min(1, 'Prêmio sem identificador.').max(64, 'Prêmio sem identificador.'),
      label: z.string('Rótulo inválido.').max(120, 'Rótulo longo demais.'),
      kind: z.enum(['bonus_brl', 'free_spins', 'moedas', 'nada'], { error: 'Tipo de prêmio inválido.' }),
      value: finite('Valor do prêmio inválido.'),
      probability: finite('Chance inválida.'),
      slot: colorSlot('Cor do prêmio inválida.'),
    }),
    'Prêmios inválidos.',
  ),
  spinsPerDay: finite('Giros por dia inválidos.'),
  costCoins: finite('Custo inválido.'),
  active: z.boolean('Situação inválida.'),
})

/** Mesmas regras de wheelErrors do painel. */
function wheelError(w: z.infer<typeof wheel>): string | null {
  if (!w.name.trim()) return 'Dê um nome para a roleta.'
  if (!Number.isInteger(w.spinsPerDay) || w.spinsPerDay < 1 || w.spinsPerDay > WHEEL_MAX_SPINS_PER_DAY) return `Entre 1 e ${WHEEL_MAX_SPINS_PER_DAY} giros por dia.`
  if (!Number.isInteger(w.costCoins) || w.costCoins < 0) return 'Custo: use um número inteiro (0 = grátis).'
  if (w.prizes.length < WHEEL_MIN_PRIZES) return `A roleta precisa de pelo menos ${WHEEL_MIN_PRIZES} prêmios.`
  if (w.prizes.length > WHEEL_MAX_PRIZES) return `No máximo ${WHEEL_MAX_PRIZES} prêmios.`
  for (const p of w.prizes) {
    const label = p.label.trim()
    if (!label) return 'Informe o rótulo de cada prêmio.'
    if (p.kind !== 'nada' && !(p.value > 0)) return `${label}: o valor precisa ser maior que zero.`
    if (!(p.probability >= 0) || p.probability > 100) return `${label}: chance entre 0% e 100%.`
  }
  const sum = round2(w.prizes.reduce((s, p) => s + p.probability, 0))
  if (Math.abs(sum - 100) > 0.001) return `As chances somam ${sum.toLocaleString('pt-BR')}%. Ajuste para 100%.`
  return null
}

const wheels: KvValidator = ({ next, stored, now }) => {
  const list = incomingList(next, 'roletas', MAX_CAMPAIGN_ITEMS)
  const old = storedList(stored)
  const oldById = new Map(old.map((w) => [idOf(w), w]))
  const at = new Date(now).toISOString()
  const value = list.map((raw) => keepServerFields(raw, oldById.get(idOf(raw)), { createdAt: at }))
  const d = diffItems(old, value)
  for (const w of [...d.added, ...d.changed.map((x) => x.after)]) {
    const p = parseOr400(wheel, w, `Roleta ${idOf(w)}: `)
    const err = wheelError(p)
    if (err) throw Errors.invalid(`Roleta ${p.name.trim() || idOf(w)}: ${err}`, { id: idOf(w) })
  }
  const label = (w: JsonObject) => `${show(w.name)} (${idOf(w)})`
  const prizes = (w: JsonObject) =>
    Array.isArray(w.prizes) ? w.prizes.filter(isPlainObject).map((p) => `${show(p.label)} ${show(p.probability)}%`).join(', ') : '—'
  const parts = [
    ...d.added.map((w) => `incluída ${label(w)}: ${show(w.spinsPerDay)} giros/dia, custo ${show(w.costCoins)} moedas, prêmios ${prizes(w)}`),
    ...d.changed.map((c) => `${label(c.after)}: ${c.fields.includes('prizes') ? `prêmios ${prizes(c.before)} → ${prizes(c.after)}` : describeFields(c)}`),
    ...d.removed.map((w) => `removida ${label(w)}`),
  ]
  return { value, summary: joinParts(parts) }
}

// Itens da loja ----------------------------------------------------------------------------------

export const SHOP_MAX_ROLLOVER = 100

const shopItem = z.looseObject({
  id: z.string().min(1).max(64),
  name: z.string('Nome inválido.').max(120, 'Nome longo demais.'),
  kind: z.enum(['bonus', 'free_spins', 'cashback', 'aposta_gratis'], { error: 'Tipo de item inválido.' }),
  value: finite('Valor inválido.'),
  extra: finite('Valor complementar inválido.'),
  gameId: z.string('Jogo inválido.').max(64, 'Jogo inválido.').nullable(),
  rollover: finite('Rollover inválido.'),
  price: finite('Preço inválido.'),
  stock: finite('Estoque inválido.').nullable(),
  limitPerPlayer: finite('Limite por jogador inválido.'),
  limitPeriod: z.enum(['dia', 'semana', 'mes', 'sempre'], { error: 'Período do limite inválido.' }),
  active: z.boolean('Situação inválida.'),
})

/** Mesmas regras de shopItemErrors do painel (nome único na lista). */
function shopItemError(item: z.infer<typeof shopItem>, sold: number, names: Map<string, number>): string | null {
  const name = item.name.trim()
  if (!name) return 'Informe o nome do item.'
  if ((names.get(name.toLowerCase()) ?? 0) > 1) return 'Já existe um item com este nome.'
  if (!(item.value > 0)) return 'O valor precisa ser maior que zero.'
  if (item.kind === 'cashback' && item.value > 100) return 'Cashback de no máximo 100%.'
  if (item.kind === 'free_spins' && !Number.isInteger(item.value)) return 'Use um número inteiro de giros.'
  if (item.kind === 'cashback' && !(item.extra > 0)) return 'Defina o teto do cashback.'
  if (item.kind === 'free_spins' && !(item.extra > 0)) return 'Defina o valor de cada giro.'
  if (item.kind === 'free_spins' && !item.gameId) return 'Escolha o jogo dos giros.'
  if (item.kind === 'bonus' && (item.rollover < 0 || item.rollover > SHOP_MAX_ROLLOVER)) return `Rollover entre 0x e ${SHOP_MAX_ROLLOVER}x.`
  if (!Number.isInteger(item.price) || item.price < 1) return 'O preço precisa ser de pelo menos 1 moeda.'
  if (item.stock != null) {
    if (!Number.isInteger(item.stock) || item.stock < 1) return 'Estoque de pelo menos 1 unidade.'
    if (item.stock < sold) return `Já foram vendidas ${sold} unidades. O estoque não pode ser menor.`
  }
  if (!Number.isInteger(item.limitPerPlayer) || item.limitPerPlayer < 0) return 'Limite por jogador: use um número inteiro (0 = sem limite).'
  return null
}

const shopItems: KvValidator = ({ next, stored, now }) => {
  const list = incomingList(next, 'itens da loja', MAX_CAMPAIGN_ITEMS)
  const old = storedList(stored)
  const oldById = new Map(old.map((i) => [idOf(i), i]))
  const at = new Date(now).toISOString()
  // vendidos vêm da plataforma (o estoque não fica abaixo do que já foi vendido)
  const value = list.map((raw) => keepServerFields(raw, oldById.get(idOf(raw)), { sold: 0, createdAt: at }))
  const names = new Map<string, number>()
  for (const i of value) {
    const k = typeof i.name === 'string' ? i.name.trim().toLowerCase() : ''
    if (k) names.set(k, (names.get(k) ?? 0) + 1)
  }
  const d = diffItems(old, value)
  for (const i of [...d.added, ...d.changed.map((x) => x.after)]) {
    const p = parseOr400(shopItem, i, `Item ${idOf(i)}: `)
    const err = shopItemError(p, typeof i.sold === 'number' ? i.sold : 0, names)
    if (err) throw Errors.invalid(`Item ${p.name.trim() || idOf(i)}: ${err}`, { id: idOf(i) })
  }
  const label = (i: JsonObject) => `${show(i.name)} (${idOf(i)})`
  const parts = [
    ...d.added.map((i) => `incluído ${label(i)}: ${show(i.kind)} ${show(i.value)}, preço ${show(i.price)} moedas, estoque ${i.stock == null ? 'ilimitado' : show(i.stock)}`),
    ...d.changed.map((c) => `${label(c.after)}: ${describeFields(c)}`),
    ...d.removed.map((i) => `removido ${label(i)} (${show(i.sold)} vendidos)`),
  ]
  return { value, summary: joinParts(parts) }
}

export const CAMPAIGN_VALIDATORS: Record<string, KvValidator> = {
  'campanhas.cupons': coupons,
  'campanhas.bonus-deposito': depositBonuses,
  'campanhas.cashback': cashback,
  [FS_GRANTS_KEY]: freeSpinGrants,
  'campanhas.loja.compras': shopPurchases,
  'campanhas.niveis': levels,
  'campanhas.missoes': missions,
  'campanhas.torneios': tournaments,
  'campanhas.roleta': wheels,
  'campanhas.loja': shopItems,
}
