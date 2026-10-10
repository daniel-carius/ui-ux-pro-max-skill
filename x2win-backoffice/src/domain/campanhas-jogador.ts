// Tipo do jogador como as campanhas o enxergam. Fica à parte de ./campanhas-jogadores (que usa o React e o store)
// para as regras puras das campanhas e os dados de demonstração (usados também pelo servidor) não puxarem o React.
import type { Player } from '@/data/players'

/**
 * Jogador como as campanhas o enxergam: os campos do público de marketing. O jogador
 * completo da demonstração (Player) também serve; nome, e-mail, saldo e moedas só
 * existem nele.
 */
export interface CampaignPlayer {
  id: string
  nickname: string
  status: Player['status']
  level: number
  xp: number
  tags: string[]
  createdAt: string
  lastAccess: string
  depositsCount: number
  /** último depósito pago (modo API; na demonstração vem de operacao.depositos) */
  lastDepositAt?: string | null
  name?: string
  email?: string
  balanceReal?: number
  coins?: number
}
