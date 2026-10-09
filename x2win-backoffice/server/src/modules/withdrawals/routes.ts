// Saques: aprovar, recusar, revelar PIX. Prefixo /api/withdrawals.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { brl } from '@shared/money'
import { canDecideWithdrawals, checkApprovalCeiling } from '@shared/withdrawals'
import type { Db } from '../../db'
import { AppError, Errors } from '../../errors'
import { requireActive, requirePerm } from '../../http'
import { writeAudit } from '../../services/audit'
import { enqueueWebhook } from '../webhooks/dispatcher'
import { decryptPix, OPEN_STATUSES, toPanelWithdrawal, type WithdrawalRow } from './format'

const OPEN_SQL = `('criado', 'pendente', 'em_analise')`

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
      const row = await lockWithdrawal(t, id)
      const amount = row.amount_cents / 100
      const check = checkApprovalCeiling(auth.role, amount)
      if (!check.ok) throw new AppError(403, 'teto_excedido', check.message, { ceiling: auth.role.approvalCeiling, amount })
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
      withdrawal: toPanelWithdrawal(updated, app.cipher, auth.perms),
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
      withdrawal: toPanelWithdrawal(updated, app.cipher, auth.perms),
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
