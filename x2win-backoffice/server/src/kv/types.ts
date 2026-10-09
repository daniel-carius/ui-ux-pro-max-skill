// Contrato dos manipuladores de dados por chave (rota /api/kv/:key).
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { KvDomain, KvRule } from '@shared/kv-registry'
import type { AuthContext } from '../types'

export interface KvValue {
  value: unknown
  /** versão para controle de concorrência (o painel manda de volta ao gravar) */
  version: number
  updatedAt: string | null
}

export interface KvContext {
  app: FastifyInstance
  req: FastifyRequest
  auth: AuthContext
  key: string
  rule: KvRule
}

export interface KvHandler {
  /** null = nunca gravado (o painel usa o valor padrão dele) */
  read(ctx: KvContext): Promise<KvValue | null>
  /**
   * Grava validando as regras do domínio. expectedVersion vem do painel;
   * se não bater com a atual, responda 409 (versao_desatualizada).
   * Sem write = só leitura pelo painel.
   */
  write?(ctx: KvContext, value: unknown, expectedVersion: number | undefined): Promise<KvValue>
}

export type KvHandlers = Partial<Record<KvDomain, KvHandler>>
