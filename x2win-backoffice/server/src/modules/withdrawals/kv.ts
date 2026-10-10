// Chaves operacao.saques (leitura) e operacao.saques.regras (gravação validada).
import { z } from 'zod'
import { canReadKey, canWriteKey } from '@shared/kv-registry'
import { brl } from '@shared/money'
import { PAGE_INFO_BY_ID } from '@shared/pages'
import {
  canDecideWithdrawals,
  checkAutoApproveCeiling,
  DEFAULT_WITHDRAWAL_RULES,
  validateWithdrawalRules,
  type WithdrawalRules,
} from '@shared/withdrawals'
import type { Db } from '../../db'
import { AppError, Errors } from '../../errors'
import type { KvContext, KvHandlers, KvValue } from '../../kv/types'
import { writeAudit } from '../../services/audit'
import { toPanelWithdrawal, type WithdrawalRow } from './format'

/** Linha da tabela settings que guarda as regras: { version, rules }. */
export const RULES_SETTINGS_KEY = 'operacao.saques.regras'

/** Quantos saques já decididos a lista devolve (os em aberto vêm sempre). */
const LIST_LIMIT = 5000

const rulesSchema = z.object({
  min: z.number(),
  maxPerRequest: z.number(),
  rolloverPct: z.number(),
  fee: z.number(),
  dailyLimit: z.number(),
  autoApproveMax: z.number(),
  rolloverMode: z.enum(['acumulado', 'por_deposito']),
  rolloverBets: z.enum(['todas', 'saldo_real', 'bonus']),
})

const RULE_LABEL: Record<keyof WithdrawalRules, string> = {
  min: 'Valor mínimo',
  maxPerRequest: 'Valor máximo por saque',
  rolloverPct: 'Rollover (%)',
  fee: 'Taxa fixa',
  dailyLimit: 'Limite diário',
  autoApproveMax: 'Aprovação automática até',
  rolloverMode: 'Contagem do rollover',
  rolloverBets: 'Apostas que contam',
}

const MONEY_FIELDS = new Set<keyof WithdrawalRules>(['min', 'maxPerRequest', 'fee', 'autoApproveMax'])

interface StoredRules {
  version: number
  rules: Partial<WithdrawalRules>
}

export function versionConflict(current: number) {
  return new AppError(409, 'versao_desatualizada', 'Outra pessoa salvou estes dados antes de você. Recarregue a tela e tente de novo.', {
    version: current,
  })
}

function assertRead(ctx: KvContext) {
  if (!canReadKey(ctx.rule, ctx.auth.perms)) throw Errors.forbidden()
}

function assertWrite(ctx: KvContext) {
  if (!canWriteKey(ctx.rule, ctx.auth.perms)) throw Errors.forbidden()
}

function dataEntity(ctx: KvContext) {
  return `Dados · ${PAGE_INFO_BY_ID.get(ctx.rule.page)?.title ?? ctx.rule.page}`
}

/** Regras em vigor (padrão quando nunca gravadas). Usado também por outras partes do servidor. */
export async function getWithdrawalRules(db: Db): Promise<{ rules: WithdrawalRules; version: number; updatedAt: string | null }> {
  const row = await db.one<{ value: StoredRules; updated_at: string }>('select value, updated_at from settings where key = $1', [RULES_SETTINGS_KEY])
  if (!row) return { rules: { ...DEFAULT_WITHDRAWAL_RULES }, version: 0, updatedAt: null }
  return { rules: { ...DEFAULT_WITHDRAWAL_RULES, ...(row.value?.rules ?? {}) }, version: Number(row.value?.version ?? 0), updatedAt: row.updated_at }
}

function fmt(field: keyof WithdrawalRules, v: unknown) {
  if (typeof v === 'number' && MONEY_FIELDS.has(field)) return brl(v)
  if (typeof v === 'number') return v.toLocaleString('pt-BR')
  return String(v)
}

function rulesDiff(before: WithdrawalRules, after: WithdrawalRules): string {
  const changes = (Object.keys(RULE_LABEL) as (keyof WithdrawalRules)[])
    .filter((k) => before[k] !== after[k])
    .map((k) => `${RULE_LABEL[k]}: ${fmt(k, before[k])} → ${fmt(k, after[k])}`)
  return changes.length ? `Regras de saque alteradas. ${changes.join('; ')}` : 'Regras de saque salvas sem alterações'
}

export const kvHandlers: KvHandlers = {
  withdrawals: {
    async read(ctx): Promise<KvValue> {
      assertRead(ctx)
      const rows = await ctx.app.db.query<WithdrawalRow>(
        `select w.*, u.email as decided_by_email
           from withdrawals w
           left join users u on u.id = w.decided_by_id
          where w.status in ('criado', 'pendente', 'em_analise')
             or w.id in (select id from withdrawals order by created_at desc limit $1)
          order by w.created_at desc, w.id desc`,
        [LIST_LIMIT],
      )
      const updatedAt = rows.reduce<string | null>((max, r) => (!max || r.updated_at > max ? r.updated_at : max), null)
      return {
        value: rows.map((r) => toPanelWithdrawal(r, ctx.app.cipher, ctx.auth.perms)),
        version: 1,
        updatedAt,
      }
    },
  },

  'withdrawal-rules': {
    async read(ctx): Promise<KvValue> {
      assertRead(ctx)
      const { rules, version, updatedAt } = await getWithdrawalRules(ctx.app.db)
      return { value: rules, version, updatedAt }
    },

    async write(ctx, value, expectedVersion): Promise<KvValue> {
      assertWrite(ctx)
      const rules: WithdrawalRules = rulesSchema.parse(value)
      const problem = validateWithdrawalRules(rules)
      if (problem) throw Errors.invalid(problem)

      return ctx.app.db.tx(async (t) => {
        // garante a linha e a trava até o fim da transação (gravações concorrentes esperam)
        const created = await t.query(
          `insert into settings (key, value) values ($1, $2::jsonb) on conflict (key) do nothing returning key`,
          [RULES_SETTINGS_KEY, JSON.stringify({ version: 0, rules: DEFAULT_WITHDRAWAL_RULES })],
        )
        const row = await t.one<{ value: StoredRules }>('select value from settings where key = $1 for update', [RULES_SETTINGS_KEY])
        const current = Number(row?.value?.version ?? 0)
        const existed = created.length === 0 && current > 0
        if (existed && expectedVersion !== current) throw versionConflict(current)

        const before: WithdrawalRules = { ...DEFAULT_WITHDRAWAL_RULES, ...(row?.value?.rules ?? {}) }
        // aprovação automática = aprovar sem análise: só até o teto de quem grava (comparado com o valor gravado)
        const auto = checkAutoApproveCeiling(ctx.auth.role, rules.autoApproveMax, before.autoApproveMax)
        if (!auto.ok) {
          throw new AppError(403, 'teto_excedido', auto.message, {
            ceiling: canDecideWithdrawals(ctx.auth.role) ? ctx.auth.role.approvalCeiling : 0,
            autoApproveMax: rules.autoApproveMax,
          })
        }
        const next = current + 1
        const saved = await t.one<{ updated_at: string }>(
          `update settings set value = $2::jsonb, updated_at = now(), updated_by = $3 where key = $1 returning updated_at`,
          [RULES_SETTINGS_KEY, JSON.stringify({ version: next, rules }), ctx.auth.user.id],
        )
        await writeAudit(t, ctx.auth, { action: 'editar', entity: dataEntity(ctx), summary: rulesDiff(before, rules) })
        return { value: rules, version: next, updatedAt: saved?.updated_at ?? null }
      })
    },
  },
}
