// Conversão da linha do banco (centavos, chave PIX cifrada) para o formato do
// painel (src/data/finance.ts › Withdrawal): valores em reais e PIX mascarado.
import { MASK_CHAR } from '@shared/kv-registry'
import { OPEN_WITHDRAWAL_STATUSES } from '@shared/withdrawals'
import type { Cipher } from '../../lib/crypto'
import { maskEmail, maskPixKey } from '../../lib/mask'

export interface WithdrawalRow {
  id: string
  player_id: string
  player_name: string
  player_email: string
  amount_cents: number
  fee_cents: number
  status: string
  risk_level: string
  risk_score: number
  risk_reasons: string[] | null
  pix_key_type: string
  pix_key_enc: string
  reference: string
  created_at: string
  updated_at: string
  decided_by: string | null
  decided_by_id: string | null
  decision_note: string | null
}

export const OPEN_STATUSES: readonly string[] = OPEN_WITHDRAWAL_STATUSES

/** Permissão que libera dados pessoais completos (e-mail do jogador). */
export const PII_REVEAL_PERMISSION = 'usuarios.ver-dados'

export function decryptPix(cipher: Cipher, enc: string): string | null {
  try {
    return cipher.decrypt(enc)
  } catch {
    return null
  }
}

/**
 * Saque no formato do painel. A chave PIX sai sempre mascarada (a completa só
 * pela rota reveal-pix, com auditoria); o e-mail do jogador sai mascarado para
 * quem não tem `usuarios.ver-dados`.
 */
export function toPanelWithdrawal(r: WithdrawalRow, cipher: Cipher, perms: ReadonlySet<string>) {
  const pix = decryptPix(cipher, r.pix_key_enc)
  return {
    id: r.id,
    playerId: r.player_id,
    playerName: r.player_name,
    playerEmail: perms.has(PII_REVEAL_PERMISSION) ? r.player_email : maskEmail(r.player_email),
    amount: r.amount_cents / 100,
    fee: r.fee_cents / 100,
    status: r.status,
    risk: { level: r.risk_level, score: r.risk_score, reasons: Array.isArray(r.risk_reasons) ? r.risk_reasons : [] },
    pixKeyType: r.pix_key_type,
    pixKey: pix === null ? MASK_CHAR.repeat(3) : maskPixKey(r.pix_key_type, pix),
    reference: r.reference,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    decidedBy: r.decided_by,
    decisionNote: r.decision_note,
  }
}

export type PanelWithdrawal = ReturnType<typeof toPanelWithdrawal>
