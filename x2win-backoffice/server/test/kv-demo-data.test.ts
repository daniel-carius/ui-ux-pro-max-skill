// Dados de demonstração (src/data/**, os mesmos que DEMO_DATA grava): uma história só por jogador.
// A ficha, o extrato, Depósitos, Saques, apostas esportivas, Rankings, giros grátis, moedas, roleta e as
// execuções de webhook precisam concordar entre si (antes: apelidos repetidos, PIX pago antes do cadastro,
// vários "1º depósito" por jogador, saldo sem lastro, ranking liderado por conta de ontem sem extrato,
// saque aprovado sem KYC, giros sem o ganho no extrato, moedas sorteadas, roleta VIP girada por quem não é VIP).
import { describe, expect, it } from 'vitest'
import { seedFsGrants } from '@/data/campanhas-freespins'
import { seedWheelSpins, seedWheels } from '@/data/campanhas2-seeds'
import { seedDeposits, seedTransactions, seedWithdrawals, type Transaction } from '@/data/finance'
import { playerStatsForPeriod } from '@/data/geral'
import { DAY, NOW, dayKey, startOfDay } from '@/data/now'
import { seedPlayers } from '@/data/players'
import { DEFAULT_COIN_CONFIG } from '@/domain/campanhas2-moeda'
import { seedBonusReceived } from '@/data/seguranca'
import { seedSportsBets } from '@/data/sports'
import { demoWebhookExecutions, seedWebhookEvents } from '@/data/webhooks'
import { DEMO_DESTINATIONS } from '../src/modules/webhooks/seed'

type DemoDestination = { id: string; event: string; url: string; active: boolean }
interface DomainWebhooks {
  seedWebhookDestinations(): DemoDestination[]
  seedWebhookExecutions(): ReturnType<typeof demoWebhookExecutions>
}
const DOMAIN_WEBHOOKS = '@/domain/webhooks'

const r2 = (v: number) => Math.round(v * 100) / 100
const ms = (iso: string) => Date.parse(iso)
const OPEN = ['criado', 'pendente', 'em_analise']

const players = seedPlayers()
const txs = seedTransactions()
const deposits = seedDeposits()
const withdrawals = seedWithdrawals()
const tickets = seedSportsBets()
const now = NOW.getTime()
/** início do período "30 dias" das telas (presetRange): o extrato começa aqui */
const periodStart = (days: number) => startOfDay(NOW).getTime() - (days - 1) * DAY
const byId = new Map(players.map((p) => [p.id, p]))
const txById = new Map(txs.map((t) => [t.id, t]))
/** apostas estornadas (a linha "Estorno" referencia a aposta): voltaram ao jogador e não contam como apostadas */
const reversed = new Set(txs.filter((t) => t.type === 'estorno' && t.reference.startsWith('EST-')).map((t) => t.reference.slice(4)))
const isBet = (t: Transaction) => t.type === 'aposta' && !reversed.has(t.id)

function group<T>(list: readonly T[], key: (x: T) => string) {
  const m = new Map<string, T[]>()
  for (const x of list) m.set(key(x), [...(m.get(key(x)) ?? []), x])
  return m
}
const txByPlayer = group(txs, (t) => t.playerId)
const depositsByPlayer = group(deposits, (d) => d.playerId)
const withdrawalsByPlayer = group(withdrawals, (w) => w.playerId)
/** linhas do jogador em ordem de tempo (os ids seguem a ordem dos lançamentos) */
const ledgerOf = (id: string) => [...(txByPlayer.get(id) ?? [])].sort((a, b) => a.at.localeCompare(b.at) || Number(a.id.slice(2)) - Number(b.id.slice(2)))

describe('dados de demonstração: uma história só por jogador', () => {
  it('340 jogadores; extrato, depósitos, saques e bilhetes dos últimos 90 dias (o maior período das telas)', () => {
    expect(players).toHaveLength(340)
    expect(new Set(players.map((p) => p.id)).size).toBe(340)
    expect(txs.length).toBeGreaterThan(6000)
    expect(txs.length).toBeLessThan(12000)
    expect(deposits.length).toBeGreaterThan(450)
    expect(withdrawals.length).toBeGreaterThan(150)
    expect(withdrawals.filter((w) => OPEN.includes(w.status)).length).toBeGreaterThanOrEqual(12)
    expect(tickets.length).toBeGreaterThan(300)
    // o extrato cobre os 90 dias: o período "90 dias" das listas tem lançamentos desde o primeiro dia
    expect(Math.min(...txs.map((t) => ms(t.at)))).toBeLessThan(periodStart(89))
    // gerador com semente: os mesmos dados a cada chamada
    expect(seedPlayers()).toBe(players)
    expect(seedTransactions()).toBe(txs)
  })

  it('apelido único por jogador', () => {
    const nicks = players.map((p) => p.nickname.toLowerCase())
    expect(new Set(nicks).size).toBe(players.length)
  })

  it('nada antes do cadastro ("Desde") nem depois de agora; o jogador só age até o último acesso', () => {
    for (const p of players) {
      expect(ms(p.lastAccess), p.id).toBeGreaterThanOrEqual(ms(p.createdAt))
      expect(ms(p.lastAccess), p.id).toBeLessThanOrEqual(now)
      if (p.firstDepositAt) expect(ms(p.firstDepositAt), p.id).toBeGreaterThanOrEqual(ms(p.createdAt))
      expect(p.depositsCount > 0, p.id).toBe(!!p.firstDepositAt)
    }
    const check = (id: string, playerId: string, at: string, playerAction: boolean) => {
      const p = byId.get(playerId)
      expect(p, `${id}: jogador ${playerId}`).toBeTruthy()
      expect(ms(at), `${id} antes do cadastro`).toBeGreaterThanOrEqual(ms(p!.createdAt))
      expect(ms(at), `${id} no futuro`).toBeLessThanOrEqual(now)
      if (playerAction) expect(ms(at), `${id} depois do último acesso`).toBeLessThanOrEqual(ms(p!.lastAccess))
    }
    for (const t of txs) {
      check(t.id, t.playerId, t.at, ['aposta', 'deposito', 'saque'].includes(t.type))
      expect(ms(t.at), t.id).toBeGreaterThanOrEqual(periodStart(90))
      expect(t.playerName).toBe(byId.get(t.playerId)!.name)
      expect(t.playerEmail).toBe(byId.get(t.playerId)!.email)
    }
    for (const d of deposits) {
      check(d.id, d.playerId, d.createdAt, true)
      check(d.id, d.playerId, d.updatedAt, false)
      expect(ms(d.updatedAt), d.id).toBeGreaterThanOrEqual(ms(d.createdAt))
      expect(d.playerName).toBe(byId.get(d.playerId)!.name)
    }
    for (const w of withdrawals) {
      check(w.id, w.playerId, w.createdAt, true)
      check(w.id, w.playerId, w.updatedAt, false)
      expect(ms(w.updatedAt), w.id).toBeGreaterThanOrEqual(ms(w.createdAt))
    }
    for (const b of tickets) {
      check(b.id, b.playerId, b.at, true)
      // bilhete liquidado: todos os eventos já terminaram
      if (b.status !== 'aberta') for (const s of b.selections) expect(ms(s.startsAt), b.id).toBeLessThan(now)
    }
  })

  it('um único "1º depósito" por jogador: o primeiro PIX pago da conta, o mais antigo dele na lista', () => {
    const start = periodStart(90)
    let firsts = 0
    for (const p of players) {
      const list = [...(depositsByPlayer.get(p.id) ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      const flagged = list.filter((d) => d.isFirst)
      for (const d of flagged) expect(d.status, d.id).toBe('pago')
      if (p.firstDepositAt && ms(p.firstDepositAt) >= start) {
        expect(flagged, p.id).toHaveLength(1)
        expect(flagged[0].updatedAt).toBe(p.firstDepositAt)
        expect(list[0]).toBe(flagged[0])
        firsts++
      } else {
        expect(flagged, p.id).toHaveLength(0)
      }
    }
    expect(firsts).toBeGreaterThan(20)
  })

  it('Depósitos e Saques batem com a ficha e com o extrato (mesma referência E2E)', () => {
    for (const p of players) {
      const paid = (depositsByPlayer.get(p.id) ?? []).filter((d) => d.status === 'pago')
      const lines = (txByPlayer.get(p.id) ?? []).filter((t) => t.type === 'deposito')
      expect(paid.length, p.id).toBeLessThanOrEqual(p.depositsCount)
      expect(r2(paid.reduce((s, d) => s + d.amount, 0)), p.id).toBeLessThanOrEqual(p.totalDeposited)
      expect(lines.length, p.id).toBe(paid.length)
      for (const d of paid) expect(lines.some((l) => l.reference === d.reference && l.amount === d.amount && l.at === d.updatedAt), d.id).toBe(true)
      const approved = (withdrawalsByPlayer.get(p.id) ?? []).filter((w) => w.status === 'aprovado')
      expect(r2(approved.reduce((s, w) => s + w.amount, 0)), p.id).toBeLessThanOrEqual(p.totalWithdrawn)
    }
    const saques = new Map(txs.filter((t) => t.type === 'saque').map((t) => [t.reference, t]))
    for (const w of withdrawals) {
      // o pedido reserva o valor; recusado, cancelado ou expirado volta como estorno
      const line = saques.get(w.reference)
      expect(line, w.id).toBeTruthy()
      expect(line!.amount).toBe(-w.amount)
      expect(line!.at).toBe(w.createdAt)
      expect(line!.playerId).toBe(w.playerId)
      const refund = txs.find((t) => t.type === 'estorno' && t.reference === `EST-${line!.id}`)
      expect(!!refund, `${w.id} ${w.status}`).toBe(['recusado', 'cancelado', 'expirado'].includes(w.status))
      if (refund) {
        expect(refund.amount).toBe(w.amount)
        expect(refund.at).toBe(w.updatedAt)
      }
      // regras de saque padrão: mínimo R$ 20, máximo R$ 5.000 por pedido
      expect(w.amount).toBeGreaterThanOrEqual(20)
      expect(w.amount).toBeLessThanOrEqual(5000)
    }
  })

  it('sem KYC verificado o saque fica retido (Cadastro e KYC): nenhum aprovado, nada sacado', () => {
    let held = 0
    for (const w of withdrawals) {
      if (byId.get(w.playerId)!.kyc === 'verificado') continue
      expect(w.status, w.id).not.toBe('aprovado')
      expect(w.amount, w.id).toBeLessThanOrEqual(200)
      if (w.status === 'recusado') expect(w.decisionNote, w.id).toBe('KYC pendente')
      held++
    }
    expect(held).toBeGreaterThan(5)
    for (const p of players) if (p.kyc !== 'verificado') expect(p.totalWithdrawn, p.id).toBe(0)
  })

  it('aposta estornada não conta: sai do apostado e do nº de apostas da ficha', () => {
    const refundedBets = txs.filter((t) => t.type === 'aposta' && reversed.has(t.id))
    expect(refundedBets.length).toBeGreaterThan(5)
    for (const p of players) {
      const lines = txByPlayer.get(p.id) ?? []
      // conta com toda a história no extrato: os totais da ficha são as apostas que ficaram
      if (ms(p.createdAt) < periodStart(90)) continue
      expect(r2(lines.filter(isBet).reduce((a, t) => a - t.amount, 0)), p.id).toBe(p.totalBet)
      expect(lines.filter(isBet).length, p.id).toBe(p.betsCount)
    }
  })

  it('saldo real = depositado − sacado − saques em aberto + ganho − apostado + ajustes do extrato; nunca negativo', () => {
    for (const p of players) {
      expect(p.balanceReal, p.id).toBeGreaterThanOrEqual(0)
      expect(p.balanceBonus, p.id).toBeGreaterThanOrEqual(0)
      const lines = ledgerOf(p.id)
      const open = (withdrawalsByPlayer.get(p.id) ?? []).filter((w) => OPEN.includes(w.status)).reduce((s, w) => s + w.amount, 0)
      let adjustments = 0
      for (const l of lines) {
        if (l.wallet !== 'real') continue
        if (l.type === 'cashback' || l.type === 'credito_manual' || l.type === 'debito_manual') adjustments += l.amount
        if (l.type === 'estorno') {
          const orig = txById.get(l.reference.replace(/^EST-/, ''))
          expect(orig, `${l.id} estorna ${l.reference}`).toBeTruthy()
          expect(orig!.playerId).toBe(p.id)
          // devolução de saque recusado anula o pedido; aposta estornada já saiu do apostado; estorno de subtração é ajuste
          if (orig!.type === 'debito_manual') adjustments += l.amount
        }
      }
      const ledger = r2(p.totalDeposited - p.totalWithdrawn - open + p.totalWon - p.totalBet + adjustments)
      expect(Math.abs(ledger - p.balanceReal), `${p.id}: saldo ${p.balanceReal}, livro-razão ${ledger}`).toBeLessThan(0.011)
    }
  })

  it('o extrato encadeia o saldo de cada carteira e termina no saldo da ficha; cabe nos totais da conta', () => {
    for (const p of players) {
      const lines = ledgerOf(p.id)
      for (const wallet of ['real', 'bonus'] as const) {
        let prev: number | null = null
        for (const l of lines.filter((x) => x.wallet === wallet)) {
          expect(r2(l.balanceBefore + l.amount), l.id).toBe(l.balanceAfter)
          expect(l.balanceBefore, l.id).toBeGreaterThanOrEqual(0)
          if (prev !== null) expect(l.balanceBefore, `${p.id} ${wallet} ${l.id}`).toBe(prev)
          prev = l.balanceAfter
        }
        const balance = wallet === 'real' ? p.balanceReal : p.balanceBonus
        if (prev !== null) expect(prev, `${p.id} ${wallet}`).toBe(balance)
        else if (wallet === 'bonus') expect(balance, p.id).toBe(0)
      }
      const sum = (pred: (t: Transaction) => boolean) => r2(lines.filter(pred).reduce((s, t) => s + Math.abs(t.amount), 0))
      expect(sum(isBet), p.id).toBeLessThanOrEqual(p.totalBet)
      expect(lines.filter(isBet).length, p.id).toBeLessThanOrEqual(p.betsCount)
      expect(sum((t) => t.type === 'ganho' || t.type === 'free_spin'), p.id).toBeLessThanOrEqual(p.totalWon)
      const bonus = sum((t) => t.type === 'bonus' || t.type === 'free_spin' || t.type === 'cashback')
      expect(bonus, p.id).toBeLessThanOrEqual(seedBonusReceived()[p.id] + 0.001)
    }
  })

  it('Rankings: as somas do período são as do extrato; os primeiros do ranking são contas antigas, com apostas no extrato', () => {
    for (const period of ['7d', '30d', '90d'] as const) {
      const start = periodStart(period === '7d' ? 7 : period === '30d' ? 30 : 90)
      const stats = new Map(playerStatsForPeriod(players, period, txs).map((s) => [s.playerId, s]))
      for (const p of players) {
        const lines = (txByPlayer.get(p.id) ?? []).filter((t) => ms(t.at) >= start)
        const bets = lines.filter(isBet)
        const wins = lines.filter((t) => t.type === 'ganho' || t.type === 'free_spin')
        const s = stats.get(p.id)
        if (!bets.length) {
          expect(s, p.id).toBeUndefined()
          continue
        }
        expect(s, `${period} ${p.id}`).toEqual({
          playerId: p.id,
          wagered: r2(bets.reduce((a, t) => a - t.amount, 0)),
          bets: bets.length,
          won: r2(wins.reduce((a, t) => a + t.amount, 0)),
          biggestWin: Math.max(0, ...wins.map((t) => t.amount)),
        })
      }
    }
    const total = playerStatsForPeriod(players, 'total', txs)
    for (const s of total) {
      const p = byId.get(s.playerId)!
      expect(s).toEqual({ playerId: p.id, wagered: p.totalBet, bets: p.betsCount, won: p.totalWon, biggestWin: p.biggestWin })
    }
    const top = playerStatsForPeriod(players, '30d', txs).sort((a, b) => b.wagered - a.wagered).slice(0, 5)
    for (const s of top) {
      const p = byId.get(s.playerId)!
      expect(now - ms(p.createdAt), `${p.id} é conta antiga`).toBeGreaterThan(90 * DAY)
      expect(p.kyc).toBe('verificado')
      expect((txByPlayer.get(p.id) ?? []).some((t) => t.type === 'aposta')).toBe(true)
    }
  })

  it('giros grátis: a concessão nasce da história da conta e o ganho é a linha "Free spin" do extrato', () => {
    const grants = seedFsGrants()
    expect(grants.length).toBeGreaterThan(40)
    const fsLines = txs.filter((t) => t.type === 'free_spin')
    const grantById = new Map(grants.map((g) => [g.id, g]))
    // toda linha "Free spin" é de uma concessão do mesmo jogador, depois dela e até o vencimento
    for (const l of fsLines) {
      const g = grantById.get(l.reference)
      expect(g, `${l.id} ${l.reference}`).toBeTruthy()
      expect(g!.playerId).toBe(l.playerId)
      expect(ms(l.at)).toBeGreaterThanOrEqual(ms(g!.grantedAt))
      expect(ms(l.at)).toBeLessThanOrEqual(ms(g!.expiresAt))
    }
    const paidByPlayer = group(deposits.filter((d) => d.status === 'pago'), (d) => d.playerId)
    for (const g of grants) {
      const p = byId.get(g.playerId)!
      expect(ms(g.grantedAt), g.id).toBeGreaterThanOrEqual(ms(p.createdAt))
      expect(ms(g.grantedAt), g.id).toBeLessThanOrEqual(now)
      expect(g.used, g.id).toBeLessThanOrEqual(g.spins)
      expect(g.winnings, g.id).toBeLessThanOrEqual(p.totalWon)
      if (g.status === 'cancelada') expect(g.winnings, g.id).toBe(0)
      // concessão no período do extrato: o ganho está nele, linha a linha
      if (ms(g.grantedAt) >= periodStart(90)) expect(r2(fsLines.filter((l) => l.reference === g.id).reduce((a, l) => a + l.amount, 0)), g.id).toBe(g.winnings)
      // giro do 2º depósito: vem com o próprio depósito (PIX pago um instante antes)
      if (g.campaignId === 'fs01') {
        const dep = (paidByPlayer.get(g.playerId) ?? []).find((d) => ms(g.grantedAt) - ms(d.updatedAt) >= 0 && ms(g.grantedAt) - ms(d.updatedAt) < 60_000)
        expect(dep, g.id).toBeTruthy()
        expect(p.depositsCount, g.id).toBeGreaterThanOrEqual(2)
      }
      // boas-vindas: no cadastro
      if (g.campaignId === 'fs03') expect(ms(g.grantedAt) - ms(p.createdAt), g.id).toBeLessThanOrEqual(5 * 60_000)
      if (g.campaignId === 'fs04') expect(p.tags, g.id).toContain('VIP')
    }
  })

  it('moedas: saldo ganho pelas regras da Moeda nos últimos 90 dias, nunca acima do teto diário', () => {
    const cap = DEFAULT_COIN_CONFIG.dailyCap
    const since = now - DEFAULT_COIN_CONFIG.expiryDays * DAY
    for (const p of players) {
      expect(Number.isInteger(p.coins), p.id).toBe(true)
      expect(p.coins, p.id).toBeGreaterThanOrEqual(0)
      // dias com moeda: cadastro, último acesso e dias com aposta ou depósito (todos dentro da validade)
      const days = new Set([p.createdAt, p.lastAccess].filter((iso) => ms(iso) >= since).map((iso) => dayKey(new Date(iso))))
      for (const t of txByPlayer.get(p.id) ?? []) if ((t.type === 'aposta' || t.type === 'deposito') && ms(t.at) >= since) days.add(dayKey(new Date(t.at)))
      expect(p.coins, `${p.id}: ${p.coins} em ${days.size} dias`).toBeLessThanOrEqual(cap * days.size)
      // conta sem aposta no extrato: só login e depósito (nada de milhares de moedas)
      if (!(txByPlayer.get(p.id) ?? []).some((t) => t.type === 'aposta')) expect(p.coins, p.id).toBeLessThanOrEqual(10 * days.size + p.totalDeposited)
    }
    expect(players.filter((p) => p.coins > 0).length).toBeGreaterThan(100)
  })

  it('roleta: cada giro é de quem está no grupo da roleta, estava no site e tinha giro no dia', () => {
    const wheels = new Map(seedWheels().map((w) => [w.id, w]))
    const perDay = new Map<string, number>()
    const spins = seedWheelSpins()
    expect(spins.length).toBeGreaterThan(200)
    for (const s of spins) {
      const p = byId.get(s.playerId)!
      const w = wheels.get(s.wheelId)!
      expect(ms(s.at), s.id).toBeGreaterThanOrEqual(ms(p.createdAt))
      expect(ms(s.at), s.id).toBeLessThanOrEqual(ms(p.lastAccess))
      if (w.group === 'vip') expect(p.tags, s.id).toContain('VIP')
      if (w.group === 'novos') expect(ms(s.at) - ms(p.createdAt), s.id).toBeLessThanOrEqual(7 * DAY)
      const k = `${w.id}|${p.id}|${dayKey(new Date(s.at))}`
      perDay.set(k, (perDay.get(k) ?? 0) + 1)
      expect(perDay.get(k)!, k).toBeLessThanOrEqual(w.spinsPerDay)
    }
  })

  it('execuções de webhook apontam para saques, depósitos e jogadores que existem', () => {
    const events = seedWebhookEvents()
    expect(events.length).toBeGreaterThan(100)
    const wById = new Map(withdrawals.map((w) => [w.id, w]))
    const dById = new Map(deposits.map((d) => [d.id, d]))
    for (const e of events) {
      const data = e.data as { id: string; playerId: string; amount: number }
      const rec = e.event === 'deposito.primeiro' ? dById.get(data.id) : wById.get(data.id)
      expect(rec, `${e.event} ${data.id}`).toBeTruthy()
      expect(byId.has(data.playerId)).toBe(true)
      expect(rec!.playerId).toBe(data.playerId)
      expect(rec!.amount).toBe(data.amount)
      expect(ms(e.at)).toBeGreaterThanOrEqual(ms(byId.get(data.playerId)!.createdAt))
      expect(ms(e.at)).toBeLessThanOrEqual(now)
    }
    // as do painel (modo demonstração) usam os mesmos eventos, uma por destino ativo do evento
    const execs = demoWebhookExecutions(DEMO_DESTINATIONS)
    expect(execs).toHaveLength(events.length)
    for (const x of execs) {
      const body = JSON.parse(x.payload) as { event: string; createdAt: string; data: { id: string } }
      expect(body.event).toBe(x.event)
      expect(body.createdAt).toBe(x.at)
      expect(wById.has(body.data.id) || dById.has(body.data.id), body.data.id).toBe(true)
    }
  })

  it('Webhooks e Estatísticas (modo demonstração) mostram essas mesmas execuções', async () => {
    // especificador em variável: o domínio puxa o store do painel, cujos tipos do navegador o tsc do servidor não tem
    const { seedWebhookDestinations, seedWebhookExecutions } = (await import(DOMAIN_WEBHOOKS)) as DomainWebhooks
    expect(seedWebhookDestinations().map(({ id, event, url, active }) => ({ id, event, url, active }))).toEqual(
      DEMO_DESTINATIONS.map(({ id, event, url, active }) => ({ id, event, url, active })),
    )
    expect(seedWebhookExecutions()).toEqual(demoWebhookExecutions(DEMO_DESTINATIONS))
  })
})
