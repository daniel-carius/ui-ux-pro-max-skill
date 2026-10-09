// Aplica as migrações e sai (npm run migrate).
import { loadConfig } from './config'
import { migrate, openDb } from './db'

const config = loadConfig()
const db = openDb(config.DATABASE_URL)
const applied = await migrate(db)
console.log(applied.length ? `Migrações aplicadas: ${applied.join(', ')}` : 'Banco já está atualizado.')
await db.close()
