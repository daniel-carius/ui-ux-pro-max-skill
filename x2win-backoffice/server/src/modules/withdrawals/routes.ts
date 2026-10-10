// Saques: aprovar, recusar, revelar PIX. Prefixo /api/withdrawals.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { brl } from '@shared/money'
import { canDecideWithdrawals, checkApprovalCeiling } from '@shared/withdrawals'
import type { Db } from '../../db'
import { AppError, Errors } from '../../errors'
import { requireActive, requirePerm } from '../../http'
import type { Cipher } from '../../lib/crypto'
import { writeAudit } from '../../services/audit'
import type { AuthContext } from '../../types'
import { manualCreditors, payoutHold } from '../kv/payout-guards'
import { enqueueWebhook } from '../webhooks/dispatcher'
import { decryptPix, OPEN_STATUSES, toPanelWithdrawal, type WithdrawalRow } from './format'
import { getWithdrawalRules } from './kv'

const OPEN_SQL = `('criado', 'pendente', 'em_analise')`

/** Segregação de funções: quem lançou crédito manual ou estorno para o jogador nesta janela não aprova o saque dele. */
export const SEGREGATION_WINDOW_MS = 30 * 86_400_000

/** Classe das travas consultivas (pg_advisory_xact_lock) das decisões de pagamento por jogador. */
const PAYOUT_LOCK_CLASS = 7101

const idParams = z.object({ id: z.string().trim().min(1).max(64) })

const rejectBody = z.object({
  reason: z
    .string({ error: 'Informe o motivo da recusa.' })
    .trim()
    .min(3, 'O motivo precisa ter pelo menos 3 caracteres.')
    .max(300, 'O motivo pode ter no máximo 300 caracteres.'),
})

const alreadyDecided = () => new AppError(409, 'ja_decidido', 'Este saque já foi decidido.')

/** Carrega o saque travando a linha até o fim da transação. */
async function lockWithdrawal(t: Db, id: string): Promise<WithdrawalRow> {
  const row = await t.one<WithdrawalRow>('select * from withdrawals where id = $1 for update', [id])
  if (!row) throw Errors.notFound('Saque')
  if (!OPEN_STATUSES.includes(row.status)) throw alreadyDecided()
  return row
}

/**
 * Trava as aprovações do mesmo jogador até o fim da transação (antes da linha do saque, sempre nesta ordem): duas
 * aprovações simultâneas de saques diferentes do jogador não passam juntas pelo limite diário.
 */
async function lockPlayerPayouts(t: Db, id: string) {
  const w = await t.one<{ player_id: string }>('select player_id from withdrawals where id = $1', [id])
  if (!w) throw Errors.notFound('Saque')
  await t.query('select pg_advisory_xact_lock($1::int, hashtext($2::text))', [PAYOUT_LOCK_CLASS, w.player_id])
}

/**
 * Conferências do pagamento na hora da aprovação (dentro da transação, com o saque travado):
 *  - jogador banido pelo anti-fraude (status bloqueado ou rede banida) não recebe: 409 jogador_bloqueado;
 *  - regras de saque em vigor: valor acima do máximo por saque ou limite diário de saques aprovados nas últimas
 *    24 h já atingido: 409 fora_das_regras;
 *  - segregação de funções: quem lançou crédito manual ou estorno para o jogador nos últimos 30 dias não aprova
 *    o saque dele: 403 segregacao_funcoes (outra pessoa aprova).
 * As linhas de kv_store são lidas (for share) na ordem em que o lançamento no extrato as trava (kv/transactions.ts:
 * geral.transacoes e depois geral.jogadores): na ordem inversa, aprovação e lançamento para outro jogador se
 * travavam (impasse no PostgreSQL). A ordem dos erros acima não muda.
 */
async function assertPayable(t: Db, cipher: Cipher, auth: AuthContext, row: WithdrawalRow) {
  const amount = row.amount_cents / 100
  const creditors = await manualCreditors(t, cipher, row.player_id, Date.now() - SEGREGATION_WINDOW_MS)
  const hold = await payoutHold(t, cipher, row.player_id)
  if (hold) throw new AppError(409, 'jogador_bloqueado', `Pagamento bloqueado: ${hold}`, { reason: hold })

  const { rules } = await getWithdrawalRules(t)
  if (amount > rules.maxPerRequest) {
    throw new AppError(409, 'fora_das_regras', `Valor acima do máximo por saque das regras em vigor (${brl(rules.maxPerRequest)}).`, {
      rule: 'maxPerRequest',
      limit: rules.maxPerRequest,
      amount,
    })
  }
  const today = await t.one<{ n: number }>(
    `select count(*)::int as n from withdrawals
      where player_id = $1 and status = 'aprovado' and updated_at > now() - interval '24 hours'`,
    [row.player_id],
  )
  const approved = Number(today?.n ?? 0)
  if (approved >= rules.dailyLimit) {
    throw new AppError(
      409,
      'fora_das_regras',
      `O jogador já tem ${approved} ${approved === 1 ? 'saque aprovado' : 'saques aprovados'} nas últimas 24 horas (limite diário: ${rules.dailyLimit}).`,
      { rule: 'dailyLimit', limit: rules.dailyLimit, count: approved },
    )
  }

  if (creditors.has(auth.user.id)) {
    throw new AppError(403, 'segregacao_funcoes', 'Você lançou crédito manual para este jogador nos últimos 30 dias; outra pessoa precisa aprovar.')
  }
}

export default async function routes(app: FastifyInstance) {
  // respostas com dados sensíveis (e-mails, IPs, chave PIX, resultado de envio): nunca no cache do navegador/proxy
  app.addHook('onSend', async (_req, reply, payload) => {
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store')
    return payload
  })

  app.post('/:id/approve', async (req) => {
    const auth = requirePerm(req, 'saques.aprovar')
    if (!canDecideWithdrawals(auth.role)) throw Errors.forbidden(`O cargo ${auth.role.name} não aprova saques.`)
    const { id } = idParams.parse(req.params)

    const updated = await app.db.tx(async (t) => {
      await lockPlayerPayouts(t, id)
      const row = await lockWithdrawal(t, id)
      const amount = row.amount_cents / 100
      const check = checkApprovalCeiling(auth.role, amount)
      if (!check.ok) throw new AppError(403, 'teto_excedido', check.message, { ceiling: auth.role.approvalCeiling, amount })
      await assertPayable(t, app.cipher, auth, row)
      const w = await t.one<WithdrawalRow>(
        `update withdrawals
            set status = 'aprovado', decided_by = $2, decided_by_id = $3, decision_note = null, updated_at = now()
          where id = $1 and status in ${OPEN_SQL}
          returning *`,
        [id, auth.user.name, auth.user.id],
      )
      if (!w) throw alreadyDecided()
      await writeAudit(t, auth, {
        action: 'aprovar',
        entity: `Saque #${w.id}`,
        summary: `Saque de ${brl(amount)} de ${w.player_name} aprovado`,
      })
      await enqueueWebhook(t, 'saque.pago', { id: w.id, amount, playerId: w.player_id })
      return w
    })

    const amount = updated.amount_cents / 100
    return {
      ok: true as const,
      message: `Saque de ${brl(amount)} aprovado. O PIX foi enviado.`,
      withdrawal: toPanelWithdrawal({ ...updated, decided_by_email: auth.user.email }, app.cipher, auth.perms),
    }
  })

  app.post('/:id/reject', async (req) => {
    const auth = requirePerm(req, 'saques.aprovar')
    if (!canDecideWithdrawals(auth.role)) throw Errors.forbidden(`O cargo ${auth.role.name} não decide saques.`)
    const { id } = idParams.parse(req.params)
    const { reason } = rejectBody.parse(req.body ?? {})

    const updated = await app.db.tx(async (t) => {
      await lockWithdrawal(t, id)
      const w = await t.one<WithdrawalRow>(
        `update withdrawals
            set status = 'recusado', decided_by = $2, decided_by_id = $3, decision_note = $4, updated_at = now()
          where id = $1 and status in ${OPEN_SQL}
          returning *`,
        [id, auth.user.name, auth.user.id, reason],
      )
      if (!w) throw alreadyDecided()
      const amount = w.amount_cents / 100
      await writeAudit(t, auth, {
        action: 'recusar',
        entity: `Saque #${w.id}`,
        summary: `Saque de ${brl(amount)} recusado: ${reason}`,
      })
      await enqueueWebhook(t, 'saque.rejeitado', { id: w.id, amount, playerId: w.player_id, reason })
      return w
    })

    const amount = updated.amount_cents / 100
    return {
      ok: true as const,
      message: `Saque recusado. ${brl(amount)} voltou para o saldo do jogador.`,
      withdrawal: toPanelWithdrawal({ ...updated, decided_by_email: auth.user.email }, app.cipher, auth.perms),
    }
  })

  app.post('/:id/reveal-pix', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const auth = requireActive(req)
    if (!auth.perms.has('saques.ver') || !auth.perms.has('usuarios.ver-dados')) {
      throw Errors.forbidden('Seu cargo não pode ver dados completos do PIX.')
    }
    const { id } = idParams.parse(req.params)
    const row = await app.db.one<Pick<WithdrawalRow, 'id' | 'pix_key_enc'>>('select id, pix_key_enc from withdrawals where id = $1', [id])
    if (!row) throw Errors.notFound('Saque')
    const pixKey = decryptPix(app.cipher, row.pix_key_enc)
    if (pixKey === null) throw new AppError(500, 'erro_interno', 'Não foi possível ler a chave PIX deste saque.')
    await writeAudit(app.db, auth, {
      action: 'revelar',
      entity: `Saque #${row.id}`,
      summary: 'Chave PIX completa exibida para conferência',
    })
    return { pixKey }
  })
}
