// Campanhas de free spins e concessões de demonstração (determinísticas).
// As concessões saem do livro-razão dos jogadores (./ledger): o giro do 2º depósito vem com o próprio depósito, o
// de boas-vindas com o cadastro, o cupom numa sexta em que o jogador jogou e o de aniversário VIP no aniversário
// de quem já era VIP. O ganho dos giros é a linha "Free spin" do extrato (referência = id da concessão) e conta
// no "Ganho" da ficha.
import type { FreeSpinGrant } from '@/domain/campanhas-freespins'
import { DEMO_STAFF_LABEL, demoRecords } from './demo'
import { FS_KEYS, seedFsCampaigns } from './freespins-campaigns'
import { NOW, iso } from './now'
import { demoLedger, seedPlayers } from './players'

export { FS_KEYS, seedFsCampaigns }

let _grants: FreeSpinGrant[] | null = null

export function seedFsGrants(): FreeSpinGrant[] {
  if (_grants) return _grants
  const campaigns = new Map(seedFsCampaigns().map((c) => [c.id, c]))
  const players = new Map(seedPlayers().map((p) => [p.id, p]))
  const now = NOW.getTime()
  const out: FreeSpinGrant[] = []
  for (const g of demoLedger().freeSpinGrants) {
    const c = campaigns.get(g.campaignId)
    const p = players.get(g.playerId)
    if (!c || !p) continue
    out.push({
      id: g.id,
      campaignId: c.id,
      campaignName: c.name,
      playerId: p.id,
      playerName: p.name,
      playerEmail: p.email,
      gameId: g.gameId,
      spins: g.spins,
      spinValue: g.spinValue,
      used: g.used,
      winnings: g.winnings,
      grantedAt: iso(new Date(g.grantedAt)),
      expiresAt: iso(new Date(g.expiresAt)),
      status: g.cancelled ? 'cancelada' : g.used >= g.spins ? 'concluida' : g.expiresAt < now ? 'expirada' : 'ativa',
      origin: g.manual ? 'manual' : 'automatica',
      grantedBy: g.manual ? DEMO_STAFF_LABEL : null,
      note: g.note,
    })
  }
  _grants = out.sort((a, b) => b.grantedAt.localeCompare(a.grantedAt))
  return _grants
}

// modo API: registros só do servidor (sem nada gravado, lista vazia; o gerador não roda)
demoRecords(seedFsCampaigns)
demoRecords(seedFsGrants)
