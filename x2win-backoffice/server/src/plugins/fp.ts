// Marca o plugin para não isolar escopo (hooks valem para a app inteira),
// sem depender do pacote fastify-plugin.
import type { FastifyPluginAsync } from 'fastify'

export default function fp<T extends FastifyPluginAsync>(fn: T): T {
  ;(fn as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true
  return fn
}
