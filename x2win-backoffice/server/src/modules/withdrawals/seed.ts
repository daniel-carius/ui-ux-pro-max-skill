// Dados de demonstração deste módulo (usados por src/seed.ts quando DEMO_DATA=true).
import type { FastifyInstance } from 'fastify'
import { seedWithdrawals } from '@/data/finance'
import { demoize } from '../kv/demo-seed'

const toCents = (v: number) => Math.round(v * 100)

/**
 * Insere os saques de demonstração do painel (valores em centavos, PIX cifrado). Não faz nada se já houver saques.
 * Dados pessoais ficam obviamente fictícios e quem decidiu vira o rótulo genérico (demoize), nunca alguém da equipe.
 */
export async function seedDemo(app: FastifyInstance): Promise<string> {
  const count = await app.db.one<{ n: number }>('select count(*)::int as n from withdrawals')
  if ((count?.n ?? 0) > 0) return `já existem ${count?.n} saques; nada a semear`
  const list = demoize(seedWithdrawals())
  await app.db.tx(async (t) => {
    for (const w of list) {
      await t.query(
        `insert into withdrawals (id, player_id, player_name, player_email, amount_cents, fee_cents, status, risk_level, risk_score,
                                  risk_reasons, pix_key_type, pix_key_enc, reference, created_at, updated_at, decided_by, decision_note)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16, $17)
         on conflict (id) do nothing`,
        [
          w.id,
          w.playerId,
          w.playerName,
          w.playerEmail,
          toCents(w.amount),
          toCents(w.fee),
          w.status,
          w.risk.level,
          w.risk.score,
          JSON.stringify(w.risk.reasons),
          w.pixKeyType,
          app.cipher.encrypt(w.pixKey),
          w.reference,
          w.createdAt,
          w.updatedAt,
          w.decidedBy,
          w.decisionNote,
        ],
      )
    }
  })
  const open = list.filter((w) => ['criado', 'pendente', 'em_analise'].includes(w.status)).length
  return `${list.length} saques de demonstração (${open} aguardando decisão)`
}
