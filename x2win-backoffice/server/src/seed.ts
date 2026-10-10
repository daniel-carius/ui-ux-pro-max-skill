// Prepara o banco: cargos, Superadmin e, com DEMO_DATA=true, dados de demonstração.
// As bases das telas (jogadores, extrato, afiliados, depósitos, apurações…) vêm de
// modules/kv/demo-seed.ts: só nas chaves ainda não gravadas, uma linha por chave.
import { buildApp } from './app'
import { bootstrap } from './bootstrap'
import { loadConfig } from './config'
import { seedDemo as seedKv } from './modules/kv/demo-seed'
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
  for (const line of await seedKv(app)) console.log(line)
}
await app.close()
console.log('Pronto.')
