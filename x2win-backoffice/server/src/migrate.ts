// Aplica as migrações e sai (npm run migrate). Falha: só a mensagem (diz o que fazer) e código de saída 1.
import { loadConfig } from './config'
import { migrate, openDb, type Db } from './db'

let db: Db | undefined
try {
  const config = loadConfig()
  db = openDb(config.DATABASE_URL)
  const applied = await migrate(db)
  console.log(applied.length ? `Migrações aplicadas: ${applied.join(', ')}` : 'Banco já está atualizado.')
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
} finally {
  // fecha o pool: com a conexão aberta o processo não terminaria
  await db?.close().catch(() => undefined)
}
