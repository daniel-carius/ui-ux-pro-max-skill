// Domínios 'affiliates' (crescimento.afiliados) e 'commission-rules'
// (crescimento.comissoes). Regras do painel (src/domain/afiliados.ts) aplicadas
// pelo servidor:
//
// crescimento.afiliados — lista de afiliados, cifrada em repouso e lida com dados
// pessoais mascarados; gravada por diferença, comparando por id com o gravado:
//  - cada permissão muda só os campos dela (AFFILIATE_FIELD_POLICY):
//      comissoes.editar          → code (tela Links: trocar o código do link);
//      afiliados-gerentes.editar → cadastro e contrato (nome, e-mail, tipo, nível,
//                                  gerente, código, CPA, Rev Share, status);
//    qualquer outro campo alterado → 403 campo_nao_permitido (details.fields);
//  - incluir ou remover afiliado: só afiliados-gerentes.editar;
//  - saldo de comissão (balance) é do servidor: o valor enviado é ignorado; no
//    afiliado novo começa em 0. Só muda pelo servidor (recusa de saque devolve o
//    valor, affiliate-withdrawals.ts) e pela plataforma (apuração de comissão);
//  - data de cadastro (createdAt) é do servidor;
//  - valores validados: código único (A–Z, 0–9), CPA de 0 a R$ 2.000, Rev Share de
//    0 a 60%, e-mail válido e único, gerente existente;
//  - auditoria com antes → depois de cada campo (contrato, código, status, saldo ignorado).
//
// crescimento.comissoes — regra de comissão por tipo de afiliado (Manager,
// Influencer, Organic): validateCommissionRule do painel (valor > 0, Rev Share até
// 100%, teto vazio ou > 0, teto ≥ valor no CPA). Quem alterou e quando (updatedBy,
// updatedAt) vêm do servidor. Auditoria com antes → depois.
import { z } from 'zod'
import { canWriteKey, isPiiField } from '@shared/kv-registry'
import { brl } from '@shared/money'
import { Errors } from '../../errors'
import type { KvContext, KvHandlers, KvValue } from '../../kv/types'
import { writeAudit } from '../../services/audit'
import { auditEntity, auditSummary, genericHandler } from './generic'
import { deepEqual, hasOwn, isPlainObject, MISSING, setOwn, type JsonObject } from './json'
import { restoreMasked, writePolicy } from './redact'
import { assertVersion, encryptAtRest, loadRow, saveRow, storedValue } from './store'
import { changedFields, fieldNotAllowed, idOf, incomingList, joinParts, parseOr400, round2, show, storedList, twoDecimals } from './validate-util'

export const AFFILIATES_KEY = 'crescimento.afiliados'
export const COMMISSIONS_KEY = 'crescimento.comissoes'
export const MAX_AFFILIATES = 50_000
export const AFFILIATE_TYPES = ['Manager', 'Influencer', 'Organic'] as const
/** Teto do contrato individual (mesmo do painel: acima disso precisa da diretoria). */
export const MAX_CPA = 2000
export const MAX_REVSHARE = 0.6

const MANAGER_PERM = 'afiliados-gerentes.editar'

/** Campos que cada permissão pode mudar num afiliado já gravado. */
export const AFFILIATE_FIELD_POLICY: Record<string, readonly string[]> = {
  'comissoes.editar': ['code'],
  [MANAGER_PERM]: ['name', 'email', 'type', 'level', 'managerId', 'code', 'cpa', 'revShare', 'status'],
}

/** Campos do servidor: o valor gravado prevalece (o enviado é ignorado). */
export const AFFILIATE_SERVER_FIELDS = ['balance', 'createdAt'] as const

const MONEY_FIELDS = ['cpa', 'balance']

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const AFFILIATE_CODE_RE = /^[A-Z0-9]{3,20}$/

const FIELD_SCHEMA: Record<string, z.ZodType> = {
  name: z.string('Nome inválido.').trim().min(2, 'Informe o nome.').max(120, 'Nome com mais de 120 caracteres.'),
  email: z.string('E-mail inválido.').trim().max(254, 'E-mail inválido.').regex(EMAIL_RE, 'Informe um e-mail válido.'),
  type: z.enum(AFFILIATE_TYPES, { error: 'Tipo de afiliado inválido.' }),
  level: z.union([z.literal(1), z.literal(2)], 'Nível inválido.'),
  managerId: z.string('Gerente inválido.').max(64, 'Gerente inválido.').nullable(),
  code: z.string('Código inválido.').regex(AFFILIATE_CODE_RE, 'Código de 3 a 20 letras maiúsculas e números.'),
  cpa: z
    .number('CPA inválido.')
    .min(0, 'O CPA não pode ser negativo.')
    .max(MAX_CPA, `CPA acima de ${brl(MAX_CPA)} precisa de aprovação da diretoria.`)
    .refine(twoDecimals, 'Use no máximo duas casas decimais.'),
  revShare: z.number('Rev Share inválido.').min(0, 'Rev Share inválido.').max(MAX_REVSHARE, `Use um percentual entre 0% e ${MAX_REVSHARE * 100}%.`),
  status: z.enum(['ativo', 'pausado'], { error: 'Status de afiliado inválido.' }),
  playerId: z.string('Jogador inválido.').max(64, 'Jogador inválido.'),
  pixKey: z.string('Chave PIX inválida.').max(140, 'Chave PIX inválida.'),
}

/** Campos exigidos no afiliado novo. */
const NEW_REQUIRED = ['name', 'email', 'type', 'code', 'cpa', 'revShare', 'status'] as const

/** Campos que a pessoa pode alterar, pelas permissões do cargo. */
export function editableAffiliateFields(perms: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  for (const [perm, fields] of Object.entries(AFFILIATE_FIELD_POLICY)) if (perms.has(perm)) fields.forEach((f) => out.add(f))
  return out
}

function label(f: string, v: unknown) {
  if (f === 'revShare' && typeof v === 'number') return `${round2(v * 100)}%`
  return show(v, MONEY_FIELDS.includes(f))
}

function validateField(id: string, f: string, v: unknown) {
  const schema = FIELD_SCHEMA[f]
  if (!schema) return
  const r = schema.safeParse(v)
  if (!r.success) throw Errors.invalid(`Afiliado ${id}: ${r.error.issues[0]?.message ?? 'valor inválido'}`, { id, field: f })
}

const clipIds = (ids: string[]) => ids.slice(0, 20)

async function writeAffiliates(ctx: KvContext, value: unknown, expectedVersion: number | undefined): Promise<KvValue> {
  const { app, auth, key, rule } = ctx
  if (!canWriteKey(rule, auth.perms)) throw Errors.forbidden()
  if (key !== AFFILIATES_KEY) throw Errors.forbidden('Estes dados não podem ser alterados pela tela.')
  const list = incomingList(value, 'afiliados', MAX_AFFILIATES)

  return app.db.tx(async (t) => {
    const row = await loadRow(t, key, true)
    assertVersion(row, expectedVersion)
    const stored = storedValue(row, app.cipher)
    const old = storedList(stored)
    const oldById = new Map(old.map((a) => [idOf(a), a]))
    const next = restoreMasked(list, stored === MISSING ? MISSING : old, writePolicy(rule)) as JsonObject[]
    const nextIds = new Set(next.map(idOf))
    const added = next.filter((a) => !oldById.has(idOf(a)))
    const removed = old.filter((a) => !nextIds.has(idOf(a)))
    if ((added.length || removed.length) && !auth.perms.has(MANAGER_PERM)) {
      throw fieldNotAllowed('Seu cargo não pode incluir nem remover afiliados.', { fields: [], added: clipIds(added.map(idOf)), removed: clipIds(removed.map(idOf)) })
    }

    // campos do servidor: vale o gravado; no afiliado novo, saldo 0 e data de agora
    const ignoredBalance: string[] = []
    const createdAt = new Date().toISOString()
    for (const a of next) {
      const prev = oldById.get(idOf(a))
      if (!prev) {
        if (hasOwn(a, 'balance') && a.balance !== 0) ignoredBalance.push(idOf(a))
        setOwn(a, 'balance', 0)
        setOwn(a, 'createdAt', createdAt)
        continue
      }
      for (const f of AFFILIATE_SERVER_FIELDS) {
        const before = hasOwn(prev, f) ? prev[f] : undefined
        const after = hasOwn(a, f) ? a[f] : undefined
        if (deepEqual(before, after)) continue
        if (f === 'balance') ignoredBalance.push(idOf(a))
        if (hasOwn(prev, f)) setOwn(a, f, prev[f])
        else delete a[f]
      }
    }

    const allowed = editableAffiliateFields(auth.perms)
    const denied = new Set<string>()
    const deniedIds: string[] = []
    const changes: { id: string; fields: string[]; before: JsonObject; after: JsonObject }[] = []
    for (const a of next) {
      const prev = oldById.get(idOf(a))
      if (!prev) continue
      const fields = changedFields(prev, a)
      if (!fields.length) continue
      const bad = fields.filter((f) => !allowed.has(f))
      if (bad.length) {
        bad.forEach((f) => denied.add(f))
        deniedIds.push(idOf(a))
      }
      changes.push({ id: idOf(a), fields, before: prev, after: a })
    }
    if (denied.size) {
      const fields = [...denied].sort()
      throw fieldNotAllowed(`Seu cargo não pode alterar: ${fields.join(', ')}.`, { fields, affiliates: clipIds(deniedIds) })
    }

    // valores: campos alterados e todos os campos do afiliado novo
    for (const c of changes) for (const f of c.fields) validateField(c.id, f, c.after[f])
    for (const a of added) {
      for (const f of NEW_REQUIRED) {
        if (!hasOwn(a, f)) throw Errors.invalid(`Afiliado ${idOf(a)}: informe ${f}.`, { id: idOf(a), field: f })
      }
      for (const f of Object.keys(a)) validateField(idOf(a), f, a[f])
    }
    // código e e-mail únicos (sem diferenciar maiúsculas); gerente existente
    const touched = new Set([...added.map(idOf), ...changes.map((c) => c.id)])
    const owners = (field: 'code' | 'email') => {
      const m = new Map<string, number>()
      for (const a of next) {
        const v = typeof a[field] === 'string' ? (a[field] as string).trim().toLowerCase() : ''
        if (v) m.set(v, (m.get(v) ?? 0) + 1)
      }
      return m
    }
    const codeCount = owners('code')
    const emailCount = owners('email')
    for (const a of next) {
      if (!touched.has(idOf(a))) continue
      const code = typeof a.code === 'string' ? a.code.trim().toLowerCase() : ''
      const email = typeof a.email === 'string' ? a.email.trim().toLowerCase() : ''
      if (code && (codeCount.get(code) ?? 0) > 1) throw Errors.invalid(`O código ${code.toUpperCase()} já é de outro afiliado.`, { id: idOf(a), field: 'code' })
      if (email && (emailCount.get(email) ?? 0) > 1) throw Errors.invalid('Já existe um afiliado com este e-mail.', { id: idOf(a), field: 'email' })
      const managerId = a.managerId
      if (typeof managerId === 'string' && managerId && (managerId === idOf(a) || !nextIds.has(managerId))) {
        throw Errors.invalid(`Afiliado ${idOf(a)}: o gerente não existe.`, { id: idOf(a), field: 'managerId' })
      }
    }

    const saved = await saveRow(t, app.cipher, key, next, encryptAtRest(rule), row, auth.user.id)
    const name = (a: JsonObject) => `${idOf(a)} (${show(a.name)})`
    const parts = [
      ...added.map((a) => `incluído ${name(a)}: ${show(a.type)}, código ${show(a.code)}, CPA ${label('cpa', a.cpa)}, Rev Share ${label('revShare', a.revShare)}, ${show(a.status)}`),
      // dado pessoal (e-mail) não vai para a auditoria: só que mudou
      ...changes.map(
        (c) =>
          `${name(c.after)}: ${c.fields.map((f) => (isPiiField(f, rule.piiFields) ? `${f} alterado` : `${f} ${label(f, c.before[f])} → ${label(f, c.after[f])}`)).join(', ')}`,
      ),
      ...removed.map((a) => `removido ${name(a)} (saldo de comissão ${label('balance', a.balance)})`),
    ]
    let summary = joinParts(parts)
    if (ignoredBalance.length) summary += `; saldo enviado ignorado (o saldo de comissão é do servidor): ${clipIds(ignoredBalance).join(', ')}`
    await writeAudit(t, auth, { action: 'editar', entity: auditEntity(rule.page), summary: auditSummary(key, summary, row?.version ?? 0, saved.version) })
    return { value: next, version: saved.version, updatedAt: saved.updatedAt }
  })
}

/**
 * Afiliados vindos da plataforma (dados de demonstração): campos exigidos e valores
 * válidos como no afiliado novo, código e e-mail únicos, gerente existente. O saldo
 * de comissão e a data de cadastro vêm da plataforma (não são zerados).
 */
export function checkAffiliateRecords(list: readonly JsonObject[]) {
  const ids = new Set(list.map(idOf))
  const codes = new Set<string>()
  const emails = new Set<string>()
  for (const a of list) {
    const id = idOf(a)
    for (const f of NEW_REQUIRED) if (!hasOwn(a, f)) throw Errors.invalid(`Afiliado ${id}: informe ${f}.`, { id, field: f })
    for (const f of Object.keys(a)) validateField(id, f, a[f])
    const code = String(a.code).trim().toLowerCase()
    const email = String(a.email).trim().toLowerCase()
    if (codes.has(code)) throw Errors.invalid(`O código ${code.toUpperCase()} já é de outro afiliado.`, { id, field: 'code' })
    if (emails.has(email)) throw Errors.invalid('Já existe um afiliado com este e-mail.', { id, field: 'email' })
    codes.add(code)
    emails.add(email)
    if (typeof a.managerId === 'string' && a.managerId && (a.managerId === id || !ids.has(a.managerId))) {
      throw Errors.invalid(`Afiliado ${id}: o gerente não existe.`, { id, field: 'managerId' })
    }
  }
}

// Regras de comissão ---------------------------------------------------------------

const commissionRule = z.object({
  model: z.enum(['cpa', 'revshare'], { error: 'Modelo de comissão inválido.' }),
  value: z.number('Valor inválido.'),
  cap: z.number('Teto inválido.').nullable(),
})

/** Mesmas regras de validateCommissionRule do painel. */
export function commissionRuleError(r: z.infer<typeof commissionRule>): string | null {
  if (!(r.value > 0)) return 'informe um valor maior que zero.'
  if (r.model === 'revshare' && r.value > 100) return 'o percentual vai até 100%.'
  if (r.cap !== null) {
    if (!(r.cap > 0)) return 'o teto precisa ser maior que zero (vazio = sem teto).'
    if (r.model === 'cpa' && r.cap < r.value) return 'o teto é menor que a comissão de um único depositante.'
  }
  return null
}

function describeRule(r: JsonObject | undefined) {
  if (!r) return '—'
  const base = r.model === 'cpa' ? `CPA ${show(r.value, true)}` : `Rev Share ${show(r.value)}%`
  return `${base}, teto ${r.cap === null || r.cap === undefined ? 'sem teto' : show(r.cap, true)}`
}

async function writeCommissionRules(ctx: KvContext, value: unknown, expectedVersion: number | undefined): Promise<KvValue> {
  const { app, auth, key, rule } = ctx
  if (!canWriteKey(rule, auth.perms)) throw Errors.forbidden()
  if (key !== COMMISSIONS_KEY) throw Errors.forbidden('Estes dados não podem ser alterados pela tela.')
  if (!isPlainObject(value)) throw Errors.invalid('Envie as regras de comissão por tipo de afiliado.')
  const unknown = Object.keys(value).filter((k) => !(AFFILIATE_TYPES as readonly string[]).includes(k))
  if (unknown.length) throw Errors.invalid(`Tipo de afiliado inválido: ${unknown.slice(0, 5).join(', ')}.`, { fields: unknown.slice(0, 20) })

  return app.db.tx(async (t) => {
    const row = await loadRow(t, key, true)
    assertVersion(row, expectedVersion)
    const stored = storedValue(row, app.cipher)
    const old = isPlainObject(stored) ? stored : {}
    const now = new Date().toISOString()
    const next: JsonObject = {}
    const parts: string[] = []
    for (const type of AFFILIATE_TYPES) {
      if (!hasOwn(value, type)) {
        if (hasOwn(old, type)) parts.push(`${type}: removida (era ${describeRule(old[type] as JsonObject)})`)
        continue
      }
      const r = parseOr400(commissionRule, value[type], `${type}: `)
      const err = commissionRuleError(r)
      if (err) throw Errors.invalid(`${type}: ${err}`, { field: type })
      const prev = isPlainObject(old[type]) ? (old[type] as JsonObject) : undefined
      const same = !!prev && prev.model === r.model && prev.value === r.value && (prev.cap ?? null) === r.cap
      // quem alterou e quando: do servidor (na regra que não mudou, vale o gravado)
      next[type] = same
        ? { ...r, updatedAt: prev.updatedAt ?? null, updatedBy: prev.updatedBy ?? null }
        : { ...r, updatedAt: now, updatedBy: auth.user.name }
      if (!same) parts.push(`${type}: ${describeRule(prev)} → ${describeRule(next[type] as JsonObject)}`)
    }
    const saved = await saveRow(t, app.cipher, key, next, encryptAtRest(rule), row, auth.user.id)
    await writeAudit(t, auth, {
      action: 'editar',
      entity: auditEntity(rule.page),
      summary: auditSummary(key, parts.length ? `Regras: ${joinParts(parts)}` : 'Salvo sem alterações', row?.version ?? 0, saved.version),
    })
    return { value: next, version: saved.version, updatedAt: saved.updatedAt }
  })
}

export const kvHandlers: KvHandlers = {
  affiliates: { read: (ctx) => genericHandler.read(ctx), write: writeAffiliates },
  'commission-rules': { read: (ctx) => genericHandler.read(ctx), write: writeCommissionRules },
}

/** Saldo de comissão gravado de um afiliado (para os testes e a recusa de saque). */
export function affiliateBalance(a: JsonObject | undefined): number {
  return a && typeof a.balance === 'number' && Number.isFinite(a.balance) ? round2(a.balance) : 0
}

