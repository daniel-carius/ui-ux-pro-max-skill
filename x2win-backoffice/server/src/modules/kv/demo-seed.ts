// Dados de demonstração das chaves de dados (usados por src/seed.ts quando DEMO_DATA=true).
// O painel em modo API não usa mais os próprios dados de demonstração: as telas
// mostram o que está gravado no servidor. Aqui são gravadas as bases que as telas
// precisam, com os mesmos geradores do painel (src/data/**):
//  - só nas chaves ainda não gravadas (rodar de novo não muda nada);
//  - cada base passa pelas regras do servidor para dados da plataforma (esquema da
//    importação de jogadores e do extrato, regras de afiliados e de apurações de GGR;
//    valor mascarado nunca vira dado real) e é gravada por saveRow, cifrada conforme
//    a regra da chave, com uma linha na auditoria ('criar', autor "Sistema");
//  - dados pessoais ficam obviamente fictícios (demoize): e-mail no domínio reservado
//    .invalid (RFC 2606), CPF com dígito verificador errado, celular (DD) 9 0XXX-XXXX e
//    IP na faixa privada 10.x;
//  - autor de decisões (by, decidedBy, closedBy, paidBy…) vira um rótulo genérico,
//    nunca o nome de alguém da equipe.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { findKvRule } from '@shared/kv-registry'
import { seedAffiliateWithdrawals } from '@/data/afiliados'
import { DEMO_STAFF_LABEL, demoCpf, demoEmail, demoIp, demoPhone } from '@/data/demo'
import { seedAggregators, seedGames, seedProviders } from '@/data/catalog'
import { seedDeposits, seedTransactions } from '@/data/finance'
import { seedSettlements } from '@/data/ggr'
import { seedAffiliates, seedPlayers } from '@/data/players'
import { seedSportsBets } from '@/data/sports'
import { Errors } from '../../errors'
import { writeAudit } from '../../services/audit'
import { AFFILIATE_WITHDRAWALS_KEY } from './affiliate-withdrawals'
import { AFFILIATES_KEY, checkAffiliateRecords } from './affiliates'
import { DEPOSITS_KEY } from './deposits'
import { assertSize, auditEntity, auditSummary } from './generic'
import { checkSettlementRecords, GGR_SETTLEMENTS_KEY } from './ggr'
import { isPlainObject, MISSING, setOwn, type JsonObject } from './json'
import { PLAYERS_KEY } from './player-status'
import { importedPlayer } from './players'
import { restoreMasked, writePolicy } from './redact'
import { encryptAtRest, loadRow, saveRow } from './store'
import { importedTx, TRANSACTIONS_KEY } from './transactions'
import { parseOr400 } from './validate-util'

// regras dos dados fictícios: as mesmas do painel (src/data/demo.ts), que os geradores já aplicam;
// aqui valem de novo sobre toda a base (idempotentes)
export { DEMO_STAFF_LABEL, demoCpf, demoEmail, demoIp, demoPhone }

/** updated_by das linhas gravadas pela semeadura. */
const SEED_ACTOR_ID = 'sistema'
const SYSTEM = { id: null, name: 'Sistema', ip: '' }

// ---------- dados pessoais fictícios ----------

const EMAIL_FIELD = /^e-?mail$|Email$/i
const CPF_FIELD = /^(cpf|document|documento)$|(Cpf|CPF|Document|Documento)$/
const PHONE_FIELD = /^(phone|celular|telefone)$|(Phone|Celular|Telefone)$/
const IP_FIELD = /^(ip|lastIp)$|(Ip|IP)$/
const PIX_FIELD = /^pixKey$|PixKey$/
/** Autor de uma decisão ou alteração (by, decidedBy, closedBy, paidBy, createdBy…). */
const STAFF_FIELD = /^by$|By$/
const STAFF_ID_FIELD = /^byId$|ById$/

function demoPix(key: string, type: unknown): string {
  if (type === 'E-mail' || (type == null && key.includes('@'))) return demoEmail(key)
  if (type === 'CPF' || (type == null && /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(key))) return demoCpf(key)
  if (type === 'Celular') return demoPhone(key)
  return key
}

function demoLeaf(field: string, v: unknown, parent: JsonObject): unknown {
  if (STAFF_ID_FIELD.test(field)) return typeof v === 'string' ? null : v
  if (typeof v !== 'string' || !v) return v
  if (STAFF_FIELD.test(field)) return DEMO_STAFF_LABEL
  if (PIX_FIELD.test(field)) return demoPix(v, parent.pixKeyType)
  if (EMAIL_FIELD.test(field)) return demoEmail(v)
  if (CPF_FIELD.test(field)) return demoCpf(v)
  if (PHONE_FIELD.test(field)) return demoPhone(v)
  if (IP_FIELD.test(field)) return demoIp(v)
  return v
}

/**
 * Cópia dos dados de demonstração com dados pessoais obviamente fictícios e o autor das
 * decisões trocado pelo rótulo genérico. Determinística: o mesmo e-mail/CPF vira o mesmo
 * valor em todas as bases (jogador, extrato, depósitos e afiliados continuam ligados).
 */
export function demoize<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (!isPlainObject(v)) return v
    const out: JsonObject = {}
    for (const [k, child] of Object.entries(v)) setOwn(out, k, isPlainObject(child) || Array.isArray(child) ? walk(child) : demoLeaf(k, child, v))
    return out
  }
  return walk(value) as T
}

// ---------- bases semeadas ----------

export interface DemoKey {
  key: string
  /** gerador do painel */
  build: () => readonly object[]
}

/** Ordem: jogadores e afiliados antes dos registros que apontam para eles. */
export const DEMO_KEYS: readonly DemoKey[] = [
  { key: PLAYERS_KEY, build: seedPlayers },
  { key: AFFILIATES_KEY, build: seedAffiliates },
  { key: TRANSACTIONS_KEY, build: seedTransactions },
  { key: DEPOSITS_KEY, build: seedDeposits },
  { key: AFFILIATE_WITHDRAWALS_KEY, build: seedAffiliateWithdrawals },
  { key: GGR_SETTLEMENTS_KEY, build: seedSettlements },
  { key: 'esportes.apostas', build: seedSportsBets },
  { key: 'cassino.jogos', build: seedGames },
  { key: 'cassino.provedoras', build: seedProviders },
  { key: 'cassino.agregadores', build: seedAggregators },
]

/** Ajustes do gerador antes das regras, por chave. */
const PREPARE: Record<string, (list: JsonObject[], now: number) => JsonObject[]> = {
  // o gerador do extrato chega a alguns minutos depois de "agora"; o extrato não aceita lançamento no futuro
  [TRANSACTIONS_KEY]: (list, now) => list.map((tx) => (typeof tx.at === 'string' && Date.parse(tx.at) > now ? { ...tx, at: new Date(now).toISOString() } : tx)),
}

/** Regras do servidor para registros vindos da plataforma, por chave (4xx se não passar). */
const CHECKS: Record<string, (list: JsonObject[], now: number) => void> = {
  [PLAYERS_KEY]: (list) => void parseOr400(z.array(importedPlayer), list, 'Jogadores: '),
  [AFFILIATES_KEY]: (list) => checkAffiliateRecords(list),
  [TRANSACTIONS_KEY]: (list) => void parseOr400(z.array(importedTx), list, 'Transações: '),
  [GGR_SETTLEMENTS_KEY]: (list, now) => checkSettlementRecords(list, now),
}

/** Toda base é uma lista de registros com id (texto, sem repetir). */
function checkIds(list: readonly JsonObject[]) {
  const seen = new Set<string>()
  for (const x of list) {
    if (typeof x.id !== 'string' || !x.id || x.id.length > 64) throw Errors.invalid('Registro sem identificador.')
    if (seen.has(x.id)) throw Errors.invalid(`Registro repetido (${x.id}).`, { id: x.id })
    seen.add(x.id)
  }
}

/** Uma linha por chave ("<chave>: <resultado>"), como os demais módulos. */
export async function seedDemo(app: FastifyInstance, keys: readonly DemoKey[] = DEMO_KEYS): Promise<string[]> {
  const lines: string[] = []
  for (const k of keys) {
    const rule = findKvRule(k.key)!
    const now = Date.now()
    try {
      const out = await app.db.tx(async (t) => {
        const row = await loadRow(t, k.key, true)
        if (row) return `já gravado (v${row.version}); nada a semear`
        let list = demoize(k.build().map((x) => ({ ...x }) as JsonObject))
        list = PREPARE[k.key]?.(list, now) ?? list
        checkIds(list)
        CHECKS[k.key]?.(list, now)
        // valor mascarado nunca vira dado real
        const value = restoreMasked(list, MISSING, writePolicy(rule)) as JsonObject[]
        if (!rule.domain) assertSize(value, rule)
        const saved = await saveRow(t, app.cipher, k.key, value, encryptAtRest(rule), null, SEED_ACTOR_ID)
        const n = `${value.length} ${value.length === 1 ? 'registro' : 'registros'}`
        await writeAudit(t, SYSTEM, {
          action: 'criar',
          entity: auditEntity(rule.page),
          summary: auditSummary(k.key, `Dados de demonstração (DEMO_DATA): ${n}`, 0, saved.version),
        })
        return `${n} de demonstração${encryptAtRest(rule) ? ' (cifrados)' : ''}`
      })
      lines.push(`${k.key}: ${out}`)
    } catch (err) {
      lines.push(`${k.key}: não semeado (${err instanceof Error ? err.message : String(err)})`)
    }
  }
  return lines
}
