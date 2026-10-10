// Validadores das chaves genéricas com regra de negócio (dados financeiros e
// regulados que não têm módulo de domínio próprio). O manipulador genérico chama
// o validador da chave dentro da transação da gravação, depois de restaurar os
// dados mascarados e antes de gravar: o validador recusa (4xx) ou devolve o valor
// a gravar, com os campos que o servidor define (autor, data, contadores).
//
// Conteúdo do site público (Personalização, popups/inbox, notificações, disparos e
// textos legais): rules-content.ts. Contas de e-mail/SMS: rules-integrations.ts.
import { CAMPAIGN_VALIDATORS } from './rules-campaigns'
import { CONTENT_VALIDATORS } from './rules-content'
import { INTEGRATION_VALIDATORS } from './rules-integrations'
import { REGULATED_VALIDATORS } from './rules-regulated'
import type { KvValidator } from './validate-util'

export type { KvCheckResult, KvValidator, KvWriteCheck } from './validate-util'

const VALIDATORS: Record<string, KvValidator> = { ...REGULATED_VALIDATORS, ...CAMPAIGN_VALIDATORS, ...CONTENT_VALIDATORS, ...INTEGRATION_VALIDATORS }

/** Validador da chave (chave exata), ou undefined. */
export function validatorFor(key: string): KvValidator | undefined {
  return Object.prototype.hasOwnProperty.call(VALIDATORS, key) ? VALIDATORS[key] : undefined
}
