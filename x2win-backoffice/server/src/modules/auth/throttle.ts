// Freio de senha errada no login, por (e-mail digitado, faixa de IP de origem).
//
// Por que não um bloqueio por conta: um bloqueio global da conta (users.locked_until) deixa qualquer
// pessoa anônima manter o Superadmin trancado para fora, e o 423 só aparecia para e-mails de pessoas
// ativas (revelava quem é da equipe). Aqui a contagem:
//  - vale igual para qualquer e-mail (existente, inexistente, convidado ou desligado): a resposta não
//    revela quem existe;
//  - é separada por faixa de origem (/24 no IPv4, /64 no IPv6): quem erra a senha de outra rede não
//    tranca a pessoa certa, que entra da própria rede;
//  - é decidida DEPOIS da conferência da senha (que é lenta), num trecho síncrono: entre ler e gravar
//    não há await, então tentativas simultâneas não passam todas por uma leitura velha. Depois do 5º erro
//    nenhuma resposta (nem a da senha certa) revela se a senha confere.
//
// Fica em memória do processo, como o limite por IP do @fastify/rate-limit. Com mais de uma instância
// da API, cada uma conta à parte (troque por uma tabela compartilhada antes de escalar horizontalmente).
import { isIP } from 'node:net'
import { SECURITY } from '../../config'
import type { Db } from '../../db'
import { hmacSha256 } from '../../lib/crypto'
import { normalizeIp } from '../../lib/ip'

/** Erros seguidos esquecidos depois deste tempo sem erro novo. */
const FAILURE_WINDOW_MS = 60 * 60_000
/** Teto de origens acompanhadas ao mesmo tempo (as mais antigas saem primeiro). */
const MAX_ENTRIES = 200_000
const SWEEP_EVERY_MS = 60_000

/** Expande um IPv6 em 8 grupos (aceita "::" e IPv4 no final). null se não for IPv6 válido. */
function ipv6Groups(addr: string): number[] | null {
  let a = addr.split('%')[0].toLowerCase()
  const v4 = a.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const p = v4.slice(1).map(Number)
    a = `${a.slice(0, a.length - v4[0].length)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`
  }
  const parts = a.split('::')
  if (parts.length > 2) return null
  const head = parts[0] ? parts[0].split(':') : []
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : []
  const fill = 8 - head.length - tail.length
  if (parts.length === 2 ? fill < 1 : fill !== 0) return null
  const groups = [...head, ...Array<string>(parts.length === 2 ? fill : 0).fill('0'), ...tail]
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null
  return groups.map((g) => parseInt(g, 16))
}

/** Faixa de origem usada no freio: /24 no IPv4, /64 no IPv6; outro formato vale como está. */
export function ipBucket(ip: string): string {
  const addr = normalizeIp(ip)
  if (isIP(addr) === 4) return `${addr.split('.').slice(0, 3).join('.')}.0/24`
  if (isIP(addr) === 6) {
    const g = ipv6Groups(addr)
    if (g) return `${g.slice(0, 4).map((n) => n.toString(16)).join(':')}::/64`
  }
  return addr || 'desconhecido'
}

interface Entry {
  failures: number
  lastFailureAt: number
  /** 0 = nunca bloqueou nesta rodada; > agora = bloqueado; <= agora = bloqueio vencido */
  lockedUntil: number
}

export type ThrottleOutcome =
  | { kind: 'ok' }
  | { kind: 'failed'; failures: number }
  | { kind: 'locked'; until: string; justLocked: boolean }

export class LoginThrottle {
  /** relógio trocável nos testes (simular o fim do bloqueio) */
  clock: () => number = () => Date.now()
  private readonly entries = new Map<string, Entry>()
  private lastSweep = 0

  constructor(
    private readonly secret: string,
    private readonly max: number = SECURITY.maxFailedLogins,
    private readonly lockMs: number = SECURITY.lockMinutes * 60_000,
  ) {}

  /** Chave opaca (HMAC): a memória do processo não guarda e-mails nem IPs em claro. */
  key(email: string, ip: string): string {
    return hmacSha256(this.secret, `login-throttle|${email.trim().toLowerCase()}|${ipBucket(ip)}`)
  }

  /**
   * Registra o resultado de uma tentativa cuja senha JÁ foi conferida. Síncrono de propósito.
   *  - origem bloqueada → 'locked' (mesmo com a senha certa: depois do limite nada é revelado);
   *  - senha certa → 'ok' e zera a contagem da origem;
   *  - senha errada → 'failed', ou 'locked' (justLocked) quando esta é a tentativa que atinge o limite.
   */
  settle(key: string, passwordOk: boolean): ThrottleOutcome {
    const now = this.clock()
    let e = this.entries.get(key)
    if (e && e.lockedUntil > now) return { kind: 'locked', until: new Date(e.lockedUntil).toISOString(), justLocked: false }
    if (passwordOk) {
      this.entries.delete(key)
      return { kind: 'ok' }
    }
    if (!e || e.lockedUntil !== 0 || now - e.lastFailureAt > FAILURE_WINDOW_MS) e = { failures: 0, lastFailureAt: now, lockedUntil: 0 }
    e.failures++
    e.lastFailureAt = now
    let out: ThrottleOutcome = { kind: 'failed', failures: e.failures }
    if (e.failures >= this.max) {
      e.lockedUntil = now + this.lockMs
      out = { kind: 'locked', until: new Date(e.lockedUntil).toISOString(), justLocked: true }
    }
    // reinsere no fim: a ordem do Map vira "atualizado por último"
    this.entries.delete(key)
    this.entries.set(key, e)
    this.sweep(now)
    return out
  }

  /** Estado de uma origem (diagnóstico e testes). */
  peek(key: string): { failures: number; lockedUntil: string | null } | null {
    const e = this.entries.get(key)
    if (!e) return null
    return { failures: e.failures, lockedUntil: e.lockedUntil > this.clock() ? new Date(e.lockedUntil).toISOString() : null }
  }

  get size() {
    return this.entries.size
  }

  private sweep(now: number) {
    if (this.entries.size <= MAX_ENTRIES && now - this.lastSweep < SWEEP_EVERY_MS) return
    this.lastSweep = now
    for (const [k, e] of this.entries) {
      if (e.lockedUntil <= now && now - e.lastFailureAt > FAILURE_WINDOW_MS) this.entries.delete(k)
    }
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }
}

// Um freio por aplicação (cada app de teste tem o seu). A chave é o banco da aplicação, que a
// instância raiz e a das rotas compartilham.
const throttles = new WeakMap<Db, LoginThrottle>()

export function loginThrottleFor(db: Db, secret: string): LoginThrottle {
  let t = throttles.get(db)
  if (!t) {
    t = new LoginThrottle(secret)
    throttles.set(db, t)
  }
  return t
}
