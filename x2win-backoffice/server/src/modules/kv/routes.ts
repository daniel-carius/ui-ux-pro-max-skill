// Rota genérica de dados por chave: /api/kv/:key (GET e PUT), aplicando o
// registro shared/kv-registry.ts, mascaramento de segredos/dados pessoais e
// controle de versão. Chaves de domínio são delegadas aos módulos.
import type { FastifyInstance } from 'fastify'
import type { KvHandlers } from '../../kv/types'

export default async function routes(_app: FastifyInstance, _opts: { handlers: KvHandlers }) {
  // TODO: implementar (ver docs/API.md)
}
