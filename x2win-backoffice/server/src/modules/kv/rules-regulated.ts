// Regras do servidor para configurações reguladas guardadas como JSON por chave:
//  - config.jogo-responsavel: ferramentas de jogo responsável (Lei 14.790/2023),
//    mesmas regras de validateRg do painel, com esquema estrito e teto de valores;
//  - config.paises.bloqueados: código ISO de 2 letras, sem repetir e nunca o
//    Brasil (mercado da autorização); data e autor de cada bloqueio vêm do servidor;
//  - seguranca.bloqueios: bloqueio gravado não muda (desfazer = remover); data e
//    autor vêm do servidor; a remoção fica na auditoria com o contexto do bloqueio;
//  - config.dominios.verificacoes: quem só vê a tela inclui uma verificação nova no
//    início (id, data e autor do servidor), mandando depois dela o histórico gravado
//    como está; as anteriores não mudam nem somem (só as mais antigas que 12);
//  - operacao.depositos.limites: mesmas regras de validateDepositLimits do painel
//    (o prazo do PIX decide a reconsulta de depósitos).
import { z } from 'zod'
import { Errors } from '../../errors'
import { deepEqual, isPlainObject, MISSING, type JsonObject } from './json'
import { PLAYER_STATUSES } from './player-status'
import {
  clip,
  describeObjectChanges,
  diffItems,
  fieldNotAllowed,
  idOf,
  incomingList,
  joinParts,
  parseOr400,
  show,
  storedList,
  type KvValidator,
} from './validate-util'

// Jogo responsável -------------------------------------------------------------

/** Teto de qualquer limite (R$ por período). */
export const RG_MAX_LIMIT = 10_000_000
export const RG_SESSION_MIN = 15
export const RG_SESSION_MAX = 120
export const RG_MESSAGE_MAX = 140
const PERIOD_LABEL = { daily: 'diário', weekly: 'semanal', monthly: 'mensal' } as const

function limitPair(what: string) {
  const amount = z
    .number(`${what}: valor inválido.`)
    .min(0, `${what}: o valor não pode ser negativo.`)
    .max(RG_MAX_LIMIT, `${what}: no máximo R$ 10 milhões.`)
  return z
    .strictObject({ default: amount, max: amount.refine((v) => v > 0, `${what}: o máximo precisa ser maior que zero.`) }, `${what}: informe o padrão e o máximo.`)
    .refine((p) => p.default <= p.max, `${what}: o padrão não pode passar do máximo.`)
}

function limits(what: string) {
  return z
    .strictObject(
      {
        daily: limitPair(`${what} ${PERIOD_LABEL.daily}`),
        weekly: limitPair(`${what} ${PERIOD_LABEL.weekly}`),
        monthly: limitPair(`${what} ${PERIOD_LABEL.monthly}`),
      },
      `${what}: informe os limites diário, semanal e mensal.`,
    )
    .refine((l) => l.daily.max <= l.weekly.max && l.weekly.max <= l.monthly.max, `${what}: o máximo diário não pode passar do semanal, nem o semanal do mensal.`)
}

const someTrue = (o: Record<string, boolean>) => Object.values(o).some(Boolean)

export const rgSchema = z.strictObject(
  {
    deposit: limits('Limite de depósito'),
    loss: limits('Limite de perda'),
    session: z.strictObject(
      {
        everyMinutes: z
          .number('Alerta de sessão inválido.')
          .int('O alerta de sessão é em minutos inteiros.')
          .min(RG_SESSION_MIN, `O alerta de sessão precisa ser entre ${RG_SESSION_MIN} e ${RG_SESSION_MAX} minutos.`)
          .max(RG_SESSION_MAX, `O alerta de sessão precisa ser entre ${RG_SESSION_MIN} e ${RG_SESSION_MAX} minutos.`),
        showSummary: z.boolean('Resumo da sessão inválido.'),
        requireAck: z.boolean('Confirmação do alerta inválida.'),
      },
      'Informe o alerta de sessão.',
    ),
    pause: z
      .strictObject({ '24h': z.boolean(), '7d': z.boolean(), '30d': z.boolean() }, 'Informe as durações de pausa.')
      .refine(someTrue, 'Ofereça ao menos uma duração de pausa.'),
    exclusion: z
      .strictObject({ '6m': z.boolean(), '1a': z.boolean(), '2a': z.boolean(), '5a': z.boolean(), permanente: z.boolean() }, 'Informe os prazos de autoexclusão.')
      .refine(someTrue, 'Ofereça ao menos um prazo de autoexclusão.'),
    coolingOffHours: z.union([z.literal(24), z.literal(72)], 'O prazo de espera para um aumento de limite é de 24 ou 72 horas.'),
    messages: z.strictObject(
      {
        items: z
          .array(
            z
              .string('Mensagem inválida.')
              .refine((m) => m.trim().length > 0, 'Há uma mensagem de jogo responsável em branco.')
              .refine((m) => m.length <= RG_MESSAGE_MAX, `As mensagens têm no máximo ${RG_MESSAGE_MAX} caracteres.`),
            'Mensagens inválidas.',
          )
          .min(1, 'Cadastre ao menos uma mensagem de jogo responsável.')
          .max(30, 'No máximo 30 mensagens.'),
        footer: z.boolean(),
        deposit: z.boolean(),
        session: z.boolean(),
      },
      'Informe as mensagens de jogo responsável.',
    ),
  },
  'Envie a configuração completa de jogo responsável.',
)

const responsibleGaming: KvValidator = ({ next, stored }) => {
  const value = parseOr400(rgSchema, next)
  const parts = describeObjectChanges(isPlainObject(stored) ? stored : {}, value)
  return { value, summary: parts.length ? `Alterações: ${joinParts(parts, 25)}` : 'Salvo sem alterações' }
}

// Países bloqueados ------------------------------------------------------------

/** Mercado da autorização (SPA/MF): nunca bloqueado. */
export const HOME_COUNTRY = 'BR'

const countryItem = z.object({
  id: z.string('País sem identificador.').min(1).max(64),
  code: z.string('Código de país inválido.').max(10, 'Código de país inválido.'),
  reason: z.string('Motivo inválido.').max(300, 'Motivo com mais de 300 caracteres.'),
})

const blockedCountries: KvValidator = ({ next, stored, auth, now }) => {
  const list = incomingList(next, 'países', 300)
  const old = new Map(storedList(stored).map((c) => [idOf(c), c]))
  const codes = new Set<string>()
  const at = new Date(now).toISOString()
  const value = list.map((raw) => {
    const c = parseOr400(countryItem, raw, 'País bloqueado: ')
    const code = c.code.trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(code)) throw Errors.invalid(`Código de país inválido (${clip(c.code, 10)}).`, { id: c.id })
    if (code === HOME_COUNTRY) throw Errors.invalid('O Brasil não pode ser bloqueado: é o mercado da autorização da SPA/MF.', { id: c.id })
    if (codes.has(code)) throw Errors.invalid(`O país ${code} aparece mais de uma vez.`, { id: c.id })
    codes.add(code)
    const prev = old.get(c.id)
    // data e autor: do servidor no bloqueio novo; o gravado prevalece nos demais
    return {
      id: c.id,
      code,
      reason: c.reason.trim(),
      createdAt: typeof prev?.createdAt === 'string' ? prev.createdAt : at,
      createdBy: typeof prev?.createdBy === 'string' ? prev.createdBy : auth.user.name,
    }
  })
  const d = diffItems([...old.values()], value)
  const parts = [
    ...d.added.map((c) => `bloqueado ${String(c.code)} (motivo: ${show(c.reason)})`),
    ...d.changed.map((c) => `${String(c.after.code)}: ${c.fields.map((f) => `${f} ${show(c.before[f])} → ${show(c.after[f])}`).join(', ')}`),
    ...d.removed.map((c) => `desbloqueado ${String(c.code)} (motivo era: ${show(c.reason)}; bloqueado por ${show(c.createdBy)} em ${show(c.createdAt)})`),
  ]
  return { value, summary: joinParts(parts) }
}

// Bloqueios do anti-fraude ------------------------------------------------------

const playerId = z.string('Conta inválida.').min(1, 'Conta inválida.').max(64, 'Conta inválida.')
const blockItem = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(['ip', 'rede'], { error: 'Tipo de bloqueio inválido.' }),
  value: z.string('Valor do bloqueio inválido.').trim().min(1, 'Informe o IP ou a rede.').max(100, 'Valor do bloqueio longo demais.'),
  reason: z.string('Motivo inválido.').trim().min(1, 'Informe o motivo do bloqueio.').max(300, 'Motivo com mais de 300 caracteres.'),
  accounts: z.array(playerId, 'Contas inválidas.').max(10_000, 'No máximo 10.000 contas por bloqueio.'),
  previousStatuses: z.record(playerId, z.enum(PLAYER_STATUSES, { error: 'Status anterior inválido.' }), 'Status anteriores inválidos.'),
})

function describeBlock(b: JsonObject) {
  const accounts = Array.isArray(b.accounts) ? b.accounts.length : 0
  return `${b.kind === 'rede' ? 'rede' : 'IP'} ${show(b.value)}, ${accounts} ${accounts === 1 ? 'conta' : 'contas'}, motivo: ${show(b.reason)}`
}

const fraudBlocks: KvValidator = ({ next, stored, auth, now }) => {
  const list = incomingList(next, 'bloqueios', 5000)
  const old = storedList(stored)
  const oldById = new Map(old.map((b) => [idOf(b), b]))
  const at = new Date(now).toISOString()
  const changed: string[] = []
  const value = list.map((raw) => {
    const prev = oldById.get(idOf(raw))
    if (prev) {
      // bloqueio gravado não muda: motivo, contas, status de antes, autor e data ficam como estão
      if (!deepEqual(prev, raw)) changed.push(idOf(raw))
      return prev
    }
    const b = parseOr400(blockItem, raw, 'Bloqueio: ')
    const outside = Object.keys(b.previousStatuses).filter((id) => !b.accounts.includes(id))
    if (outside.length) throw Errors.invalid('Bloqueio: status anterior de conta que não está no bloqueio.', { id: b.id, accounts: outside.slice(0, 20) })
    return { ...b, createdAt: at, createdBy: auth.user.name, createdById: auth.user.id }
  })
  if (changed.length) {
    throw fieldNotAllowed('Bloqueios gravados não podem ser alterados. Para mudar, desfaça o bloqueio e crie outro.', { fields: [], changed: changed.slice(0, 20) })
  }
  const d = diffItems(old, value)
  const parts = [
    ...d.added.map((b) => `incluído ${idOf(b)} (${describeBlock(b)})`),
    ...d.removed.map((b) => `removido ${idOf(b)} (${describeBlock(b)}; criado por ${show(b.createdBy)} em ${show(b.createdAt)})`),
  ]
  return { value, summary: joinParts(parts) }
}

// Verificações de domínio --------------------------------------------------------

export const MAX_DOMAIN_CHECKS = 12

const hostResult = z.object({
  host: z.string('Endereço inválido.').min(1, 'Endereço inválido.').max(253, 'Endereço inválido.'),
  dnsOk: z.boolean('Resultado de DNS inválido.'),
  httpStatus: z.number('Status HTTP inválido.').int('Status HTTP inválido.').min(0, 'Status HTTP inválido.').max(599, 'Status HTTP inválido.'),
  latencyMs: z.number('Latência inválida.').min(0, 'Latência inválida.').max(120_000, 'Latência inválida.'),
})
const newCheck = z.object({ results: z.array(hostResult, 'Resultados inválidos.').min(1, 'Verificação sem resultados.').max(20, 'Resultados demais.') })

const domainChecks: KvValidator = ({ next, stored, auth, now }) => {
  if (!Array.isArray(next) || !next.length) throw Errors.invalid('Envie a lista de verificações com a verificação nova no início.')
  const old = storedList(stored)
  if (stored !== MISSING && deepEqual(next, old)) return { value: old, summary: 'Salvo sem alterações' }
  const first = next[0]
  const rewrite = () => fieldNotAllowed('O histórico de verificações só aceita incluir uma verificação nova no início; as anteriores não mudam nem saem.', { fields: [] })
  if (!isPlainObject(first) || (typeof first.id === 'string' && old.some((c) => c.id === first.id))) throw rewrite()
  // depois da nova vem o histórico gravado, como está (o painel corta em 12). Nada gravado ainda:
  // o resto da lista (valores de demonstração do painel) não vira registro.
  if (stored !== MISSING && !deepEqual(next.slice(1), old.slice(0, MAX_DOMAIN_CHECKS - 1))) throw rewrite()
  const { results } = parseOr400(newCheck, first, 'Verificação: ')
  const check = { id: `chk-${now}`, at: new Date(now).toISOString(), by: auth.user.name, byId: auth.user.id, results }
  const value = [check, ...old].slice(0, MAX_DOMAIN_CHECKS)
  const up = results.filter((r) => r.dnsOk && r.httpStatus > 0 && r.httpStatus < 500).length
  return { value, summary: `Verificação incluída: ${up} de ${results.length} endereços no ar (${results.map((r) => `${r.host} ${r.httpStatus}`).join(', ')})` }
}

// Limites de depósito -----------------------------------------------------------

export const PIX_EXPIRATION_MIN = 5
export const PIX_EXPIRATION_MAX = 1440
export const DEFAULT_PIX_EXPIRATION_MIN = 30

const depositLimitsSchema = z
  .looseObject({
    min: z.number('Mínimo inválido.').min(1, 'O mínimo precisa ser de pelo menos R$ 1,00.'),
    max: z.number('Máximo inválido.'),
    dailyLimit: z.number('Limite diário inválido.'),
    quickAmounts: z.array(z.number('Valor rápido inválido.'), 'Valores rápidos inválidos.').min(1, 'Cadastre pelo menos um valor rápido.').max(6, 'Use até 6 valores rápidos.'),
    defaultAmount: z.number('Valor padrão inválido.'),
    pixExpirationMin: z
      .number('Prazo do PIX inválido.')
      .int('O prazo do PIX é em minutos inteiros.')
      .min(PIX_EXPIRATION_MIN, `Use entre ${PIX_EXPIRATION_MIN} e ${PIX_EXPIRATION_MAX} minutos.`)
      .max(PIX_EXPIRATION_MAX, `Use entre ${PIX_EXPIRATION_MIN} e ${PIX_EXPIRATION_MAX} minutos.`),
    mainGateway: z.string('Gateway principal inválido.').max(80),
    fallbackGateway: z.string('Gateway reserva inválido.').max(80),
  })
  .refine((v) => v.max > v.min, 'O máximo precisa ser maior que o mínimo.')
  .refine((v) => v.dailyLimit >= v.max, 'O limite diário não pode ser menor que o depósito máximo.')
  .refine((v) => v.quickAmounts.every((a) => a >= v.min && a <= v.max), 'Há valor rápido fora da faixa entre mínimo e máximo.')
  .refine((v) => v.defaultAmount === 0 || v.quickAmounts.includes(v.defaultAmount), 'O valor padrão precisa ser um dos valores rápidos.')
  .refine((v) => !v.fallbackGateway || v.fallbackGateway !== v.mainGateway, 'O gateway reserva precisa ser diferente do principal.')

const depositLimits: KvValidator = ({ next, stored }) => {
  const value = parseOr400(depositLimitsSchema, next)
  const parts = describeObjectChanges(isPlainObject(stored) ? stored : {}, value)
  return { value, summary: parts.length ? `Alterações: ${joinParts(parts, 25)}` : 'Salvo sem alterações' }
}

/** Prazo do PIX gravado (minutos), dentro da faixa aceita. */
export function pixExpirationOf(limits: unknown): number {
  const v = isPlainObject(limits) ? limits.pixExpirationMin : undefined
  return typeof v === 'number' && Number.isInteger(v) && v >= PIX_EXPIRATION_MIN && v <= PIX_EXPIRATION_MAX ? v : DEFAULT_PIX_EXPIRATION_MIN
}

export const REGULATED_VALIDATORS: Record<string, KvValidator> = {
  'config.jogo-responsavel': responsibleGaming,
  'config.paises.bloqueados': blockedCountries,
  'seguranca.bloqueios': fraudBlocks,
  'config.dominios.verificacoes': domainChecks,
  'operacao.depositos.limites': depositLimits,
}
