// Fila dos cálculos de senha (scrypt N=2^15: ~32 MB e ~0,1-0,2 s de CPU cada).
//
// O scrypt do node:crypto roda no pool de threads do libuv (4 threads se UV_THREADPOOL_SIZE não mudar), o mesmo
// pool do dns.lookup (host do Postgres, conferência anti-SSRF dos webhooks) e do fs. Os limites do login são por
// IP: logins vindos de muitas origens, cada uma dentro do seu limite, ocupariam todas as threads e todo o resto
// esperaria atrás deles. Por isso, no processo inteiro (não por IP):
//   - no máximo `maxActive` cálculos rodam ao mesmo tempo (metade do pool: sobra lugar para DNS e arquivos);
//   - até `maxQueued` esperam a vez, na ordem de chegada;
//   - além disso o pedido é recusado na hora, sem calcular nada: 503 `servidor_ocupado` com Retry-After.
// O login de e-mail inexistente (que calcula o hash só para gastar o mesmo tempo) passa pela mesma fila.
import type { FastifyReply } from 'fastify'
import { AppError } from '../../errors'

/** Fila cheia: o cálculo nem começou. */
export class PasswordGateFull extends Error {
  constructor() {
    super('fila de cálculo de senha cheia')
  }
}

export interface PasswordGate {
  /** Roda `work` quando houver vaga; com a fila cheia rejeita na hora com PasswordGateFull. */
  run<T>(work: () => Promise<T>): Promise<T>
  /** Cálculos rodando agora. */
  readonly active: number
  /** Cálculos esperando a vez. */
  readonly queued: number
}

export function createPasswordGate(limits: { maxActive: number; maxQueued: number }): PasswordGate {
  let active = 0
  const waiting: (() => void)[] = []

  function release() {
    const next = waiting.shift()
    // a vaga passa direto para o próximo da fila (active não muda)
    if (next) next()
    else active--
  }

  async function execute<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    } finally {
      release()
    }
  }

  return {
    run<T>(work: () => Promise<T>): Promise<T> {
      if (active < limits.maxActive) {
        active++
        return execute(work)
      }
      if (waiting.length >= limits.maxQueued) return Promise.reject(new PasswordGateFull())
      return new Promise<void>((resolve) => waiting.push(resolve)).then(() => execute(work))
    },
    get active() {
      return active
    },
    get queued() {
      return waiting.length
    },
  }
}

const THREADPOOL = Number(process.env.UV_THREADPOOL_SIZE) || 4

/** Limites do processo: metade do pool do libuv (de 1 a 4 cálculos simultâneos) e até 16 na espera. */
export const PASSWORD_GATE_LIMITS = {
  maxActive: Math.min(4, Math.max(1, Math.floor(THREADPOOL / 2))),
  maxQueued: 16,
} as const

/** Segundos sugeridos ao cliente (Retry-After) quando a fila está cheia. */
export const PASSWORD_BUSY_RETRY_AFTER_SECONDS = 2

/** A fila única do processo: todo cálculo de senha das rotas passa por ela. */
export const passwordGate = createPasswordGate(PASSWORD_GATE_LIMITS)

export const passwordBusy = () =>
  new AppError(503, 'servidor_ocupado', 'Muitas entradas no painel ao mesmo tempo. Aguarde alguns segundos e tente de novo.')

/** Cálculo de senha (verifyPassword/hashPassword) pela fila; fila cheia → 503 `servidor_ocupado` + Retry-After. */
export async function withPasswordSlot<T>(reply: FastifyReply, work: () => Promise<T>): Promise<T> {
  try {
    return await passwordGate.run(work)
  } catch (err) {
    if (err instanceof PasswordGateFull) {
      reply.header('retry-after', String(PASSWORD_BUSY_RETRY_AFTER_SECONDS))
      throw passwordBusy()
    }
    throw err
  }
}
