// Maiores vitórias por jogo (dados de demonstração com semente), usadas na prévia
// do carrossel "Maiores vitórias neste jogo". No site real, vêm das rodadas pagas.
import { createRng } from '@/lib/random'
import type { Game } from './catalog'
import { DAY, HOUR, NOW } from './now'
import { seedPlayers } from './players'

export interface GameWin {
  id: string
  gameId: string
  nickname: string
  bet: number
  amount: number
  multiplier: number
  at: string
}

const cache = new Map<string, GameWin[]>()

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export function winsForGame(game: Game): GameWin[] {
  const hit = cache.get(game.id)
  if (hit) return hit
  const rng = createRng(hash(game.id))
  const nicks = seedPlayers()
    .filter((p) => p.depositsCount > 0)
    .map((p) => p.nickname)
  const crashy = game.category === 'crash' || game.category === 'instantaneo'
  const list: GameWin[] = []
  for (let i = 0; i < 60; i++) {
    const bet = rng.pick([0.4, 0.8, 1, 2, 2.5, 4, 5, 10, 20, 25, 50, 100])
    const multiplier = crashy ? rng.float(2, 120 * Math.pow(rng.next(), 3) + 2, 2) : Math.round((5 + 2500 * Math.pow(rng.next(), 4)) * 10) / 10
    const amount = Math.min(250_000, Math.max(bet, Math.round(bet * multiplier * 100) / 100))
    const ago = Math.pow(rng.next(), 1.4) * 90 * DAY + rng.int(0, 59) * 60_000
    list.push({
      id: `${game.id}-w${i}`,
      gameId: game.id,
      nickname: rng.pick(nicks),
      bet,
      amount,
      multiplier,
      at: new Date(NOW.getTime() - ago - rng.int(0, 3) * HOUR).toISOString(),
    })
  }
  list.sort((a, b) => b.amount - a.amount)
  cache.set(game.id, list)
  return list
}

/** Vitórias que entram no carrossel: período, valor mínimo e quantidade. */
export function topWins(wins: GameWin[], opts: { periodMs: number; minWin: number; count: number; now?: number }) {
  const now = opts.now ?? Date.now()
  return wins
    .filter((w) => now - new Date(w.at).getTime() <= opts.periodMs && w.amount >= opts.minWin)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, opts.count)
}
