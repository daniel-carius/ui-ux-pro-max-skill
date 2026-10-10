// Sobe a API.
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'
import { loadConfig } from './config'
import { bootstrap } from './bootstrap'

let app: FastifyInstance
try {
  const config = loadConfig()
  app = await buildApp({ config, logger: true })
  await bootstrap(app)
  await app.listen({ port: config.PORT, host: config.HOST })
} catch (err) {
  // configuração inválida, banco fora do ar, migração pendente, porta ocupada: uma mensagem clara e saída com erro
  // (o contêiner reinicia pela política do compose), sem a pilha de chamadas no lugar do motivo
  console.error(`[x2win] A API não subiu: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close()
    process.exit(0)
  })
}
