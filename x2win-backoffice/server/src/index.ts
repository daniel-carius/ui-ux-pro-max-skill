// Sobe a API.
import { buildApp } from './app'
import { loadConfig } from './config'
import { bootstrap } from './bootstrap'

const config = loadConfig()
const app = await buildApp({ config, logger: true })
await bootstrap(app)
await app.listen({ port: config.PORT, host: config.HOST })

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close()
    process.exit(0)
  })
}
