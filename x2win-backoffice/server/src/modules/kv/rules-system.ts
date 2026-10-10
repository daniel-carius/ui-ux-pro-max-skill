// Estado do site que as telas mostram a partir da auditoria do servidor (não do
// relato do painel):
//  - seguranca.modo-ataque e config.manutencao: ligar e desligar é a mudança de
//    `active`. A gravação fica na auditoria como 'ligar' ou 'desligar' na entidade
//    "Modo de ataque" / "Manutenção" (Modo de ataque mostra o histórico e Manutenção
//    o "fechado por" a partir destas linhas); as demais gravações ficam como 'editar'
//    na mesma entidade. Desde quando está ligado (since) e quem ligou (activatedBy,
//    no Modo de ataque) vêm do servidor: definidos ao ligar, limpos ao desligar e
//    mantidos como estão gravados nas demais gravações;
//  - config.manutencao: o link de testes (bypassToken) ausente, o da demonstração
//    (público no código do painel) ou fraco (menos de 20 caracteres de [A-Za-z0-9_-])
//    nunca é gravado: o servidor grava um novo, que volta na resposta;
//  - seguranca.modo-ataque: o desligamento automático (autoOffMinutes) é do
//    servidor (attack-auto-off.ts), em nome de "Sistema";
//  - config.empresa: 'editar' na entidade "Empresa e licença".
// Uma linha por gravação (a linha genérica "Dados · <tela>" não é gravada junto). O
// resumo nunca traz valor de campo de segredo (ex.: bypassToken, o link de testes da
// manutenção): só o nome do campo alterado.
import { z } from 'zod'
import type { AuditAction } from '@shared/audit'
import { randomToken } from '../../lib/crypto'
import { hasOwn, isPlainObject, setOwn, summarizeChange, type JsonObject } from './json'
import { parseOr400, type KvValidator } from './validate-util'

export const ATTACK_MODE_KEY = 'seguranca.modo-ataque'
export const MAINTENANCE_KEY = 'config.manutencao'
export const COMPANY_KEY = 'config.empresa'

export const ATTACK_MODE_ENTITY = 'Modo de ataque'
export const MAINTENANCE_ENTITY = 'Manutenção'
export const COMPANY_ENTITY = 'Empresa e licença'

const toggleState = z.looseObject({ active: z.boolean('Informe se está ligado (active).') }, 'Envie o estado completo da tela.')

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

/** "45 min", "2 h 5 min", "3 dias e 4 h". */
export function durationText(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d} ${d === 1 ? 'dia' : 'dias'} e ${h % 24} h` : `${d} ${d === 1 ? 'dia' : 'dias'}`
}

interface ToggleSpec {
  entity: string
  /** campo com o nome de quem ligou (definido pelo servidor) */
  byField?: string
  /** resumo ao ligar */
  on: (v: JsonObject) => string
  /** resumo ao desligar ("Desligado"/"Site reaberto") */
  off: string
}

function elapsed(prev: JsonObject, now: number): string {
  const since = typeof prev.since === 'string' ? Date.parse(prev.since) : Number.NaN
  return Number.isNaN(since) ? '' : ` após ${durationText(now - since)}`
}

function toggleValidator(spec: ToggleSpec): KvValidator {
  const serverFields = ['since', ...(spec.byField ? [spec.byField] : [])]
  return ({ next, stored, auth, now }) => {
    const v = parseOr400(toggleState, next) as JsonObject
    const prev: JsonObject = isPlainObject(stored) ? stored : {}
    const wasOn = prev.active === true
    const out: JsonObject = { ...v }
    let action: AuditAction = 'editar'
    let summary: string
    if (v.active && !wasOn) {
      action = 'ligar'
      setOwn(out, 'since', new Date(now).toISOString())
      if (spec.byField) setOwn(out, spec.byField, auth.user.name)
      summary = spec.on(out)
    } else if (!v.active && wasOn) {
      action = 'desligar'
      for (const f of serverFields) setOwn(out, f, null)
      const by = spec.byField && typeof prev[spec.byField] === 'string' ? ` (ligado por ${prev[spec.byField] as string})` : ''
      summary = `${spec.off}${elapsed(prev, now)}${by}`
    } else {
      // não ligou nem desligou: desde quando e quem ligou ficam como estão gravados
      for (const f of serverFields) setOwn(out, f, hasOwn(prev, f) ? prev[f] : null)
      summary = summarizeChange(stored, out)
    }
    return { value: out, summary, audit: { action, entity: spec.entity } }
  }
}

const DEFENSE_LABEL: Record<string, string> = {
  lowerLimits: 'limites de acesso menores',
  closeSignups: 'cadastro fechado',
  captcha: 'verificação anti-robô',
}

const attackMode = toggleValidator({
  entity: ATTACK_MODE_ENTITY,
  byField: 'activatedBy',
  on: (v) => {
    const defenses = Object.keys(DEFENSE_LABEL).filter((k) => v[k] === true)
    const minutes = typeof v.autoOffMinutes === 'number' && v.autoOffMinutes > 0 ? v.autoOffMinutes : 0
    return `Ligado com ${defenses.length ? defenses.map((k) => DEFENSE_LABEL[k]).join(', ') : 'nenhuma defesa extra'}; ${
      minutes ? `desliga sozinho após ${durationText(minutes * 60_000)}` : 'desligamento manual'
    }`
  },
  off: 'Desligado',
})

const maintenanceToggle = toggleValidator({
  entity: MAINTENANCE_ENTITY,
  on: (v) => {
    const back = typeof v.returnAt === 'string' ? Date.parse(v.returnAt) : Number.NaN
    return `Site fechado para manutenção. Previsão de volta: ${Number.isNaN(back) ? 'sem previsão' : dateTime.format(back)}`
  },
  off: 'Site reaberto',
})

/** Link de testes da demonstração (src/domain/system.ts): está no código do painel, nunca vale aqui. */
export const DEMO_BYPASS_TOKEN = 'teste-9f3a1c'
const BYPASS_TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/

/** Link de testes ausente, o da demonstração ou fraco: troca por um novo, gerado aqui. */
export function withStrongBypassToken(next: unknown): unknown {
  if (!isPlainObject(next)) return next
  const token = next.bypassToken
  if (typeof token === 'string' && token !== DEMO_BYPASS_TOKEN && BYPASS_TOKEN_RE.test(token)) return next
  const out: JsonObject = { ...next }
  setOwn(out, 'bypassToken', `teste-${randomToken(18)}`)
  return out
}

const maintenance: KvValidator = (input) => maintenanceToggle({ ...input, next: withStrongBypassToken(input.next) })

const company: KvValidator = ({ next }) => ({ value: next, audit: { action: 'editar', entity: COMPANY_ENTITY } })

export const SYSTEM_VALIDATORS: Record<string, KvValidator> = {
  [ATTACK_MODE_KEY]: attackMode,
  [MAINTENANCE_KEY]: maintenance,
  [COMPANY_KEY]: company,
}
