// Prepara o banco: cargos, Superadmin e, com DEMO_DATA=true, dados de demonstração.
import { buildApp } from './app'
import { bootstrap } from './bootstrap'
import { loadConfig } from './config'
import { seedDemo as seedTeam } from './modules/team/seed'
import { seedDemo as seedWithdrawals } from './modules/withdrawals/seed'
import { seedDemo as seedWebhooks } from './modules/webhooks/seed'

const config = loadConfig({ ...process.env, WEBHOOK_DISPATCHER: 'off' })
const app = await buildApp({ config })
await bootstrap(app)
if (config.DEMO_DATA) {
  for (const [name, fn] of [
    ['equipe', seedTeam],
    ['saques', seedWithdrawals],
    ['webhooks', seedWebhooks],
  ] as const) {
    console.log(`${name}: ${await fn(app)}`)
  }
}
await app.close()
console.log('Pronto.')
