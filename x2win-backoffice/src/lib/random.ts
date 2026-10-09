// Gerador pseudoaleatório com semente: os dados de demonstração são sempre iguais.

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Rng = ReturnType<typeof createRng>

export function createRng(seed: number) {
  const next = mulberry32(seed)
  const rng = {
    next,
    /** inteiro entre min e max (inclusivo) */
    int(min: number, max: number) {
      return Math.floor(next() * (max - min + 1)) + min
    },
    /** decimal entre min e max */
    float(min: number, max: number, digits = 2) {
      const v = next() * (max - min) + min
      const f = 10 ** digits
      return Math.round(v * f) / f
    },
    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(next() * arr.length)]
    },
    /** escolhe com pesos: weighted([['a', 3], ['b', 1]]) */
    weighted<T>(items: readonly (readonly [T, number])[]): T {
      const total = items.reduce((s, [, w]) => s + w, 0)
      let r = next() * total
      for (const [item, w] of items) {
        r -= w
        if (r <= 0) return item
      }
      return items[items.length - 1][0]
    },
    bool(probability = 0.5) {
      return next() < probability
    },
    shuffle<T>(arr: readonly T[]): T[] {
      const a = [...arr]
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[a[i], a[j]] = [a[j], a[i]]
      }
      return a
    },
    sample<T>(arr: readonly T[], n: number): T[] {
      return rng.shuffle(arr).slice(0, n)
    },
    /** distribuição com cauda longa, boa para valores de aposta/depósito */
    money(min: number, max: number) {
      const v = min + (max - min) * Math.pow(next(), 3)
      return Math.round(v * 100) / 100
    },
    id(prefix = '', len = 8) {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
      let s = ''
      for (let i = 0; i < len; i++) s += chars[Math.floor(next() * chars.length)]
      return prefix + s
    },
    digits(len: number) {
      let s = ''
      for (let i = 0; i < len; i++) s += Math.floor(next() * 10)
      return s
    },
  }
  return rng
}

/** id único para registros criados na sessão */
export function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}
