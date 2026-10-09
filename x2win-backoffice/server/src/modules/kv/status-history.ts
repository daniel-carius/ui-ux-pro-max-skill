// Domínio 'player-status' (geral.usuarios.status): histórico de mudanças de status
// dos jogadores (bloquear, desbloquear, pausar, encerrar pausa). Só inclusão:
//  - todo registro gravado precisa voltar igual (por id); alterar ou remover → 403
//    campo_nao_permitido;
//  - registro novo: o servidor define data (at), autor (by/byId) e se a pausa foi
//    pedida pelo jogador (byPlayer: o que o painel mandar como true, ou motivo
//    "Pedido do jogador…"; o painel nunca consegue mandar false por cima);
//  - pausa precisa de prazo (until) no futuro e de no máximo PAUSE_MAX_DAYS;
//  - a lista gravada é: registros novos (na ordem enviada) + gravados (na ordem gravada).
// O servidor lê este histórico para decidir se uma pausa pode ser encerrada
// (player-status.ts); por isso o painel não pode reescrevê-lo.
import { z } from 'zod'
import { canWriteKey } from '@shared/kv-registry'
import { AppError, Errors } from '../../errors'
import type { KvContext, KvHandlers, KvValue } from '../../kv/types'
import { writeAudit } from '../../services/audit'
import { auditEntity, genericHandler } from './generic'
import { deepEqual, isPlainObject, MISSING, type JsonObject } from './json'
import { isPlayerRequestedReason, PAUSE_MAX_DAYS, PLAYER_STATUSES, STATUS_HISTORY_KEY } from './player-status'
import { assertVersion, loadRow, saveRow, storedValue } from './store'

export const MAX_STATUS_HISTORY = 200_000
export const MAX_NEW_STATUS_EVENTS = 50
export const STATUS_ACTIONS = ['bloquear', 'desbloquear', 'pausar', 'encerrar_pausa'] as const

/** Folga para o relógio do navegador no prazo da pausa. */
const UNTIL_SLACK_MS = 60 * 60_000

const id = z.string('Registro sem identificador.').min(1, 'Registro sem identificador.').max(64, 'Identificador de registro inválido.')
const historyList = z.array(z.looseObject({ id }), 'Envie a lista do histórico.').max(MAX_STATUS_HISTORY, `No máximo ${MAX_STATUS_HISTORY} registros.`)

const newEvent = z.looseObject({
  id,
  playerId: z.string('Jogador inválido.').min(1, 'Jogador inválido.').max(64, 'Jogador inválido.'),
  action: z.enum(STATUS_ACTIONS, { error: 'Ação de status inválida.' }),
  from: z.enum(PLAYER_STATUSES, { error: 'Status anterior inválido.' }).nullish(),
  to: z.enum(PLAYER_STATUSES, { error: 'Status novo inválido.' }).nullish(),
  reason: z.string('Motivo inválido.').trim().min(1, 'Informe o motivo.').max(300, 'Motivo com mais de 300 caracteres.'),
  until: z.string('Prazo inválido.').max(40, 'Prazo inválido.').nullish(),
  byPlayer: z.boolean('Indicação de pedido do jogador inválida.').optional(),
})

function notAllowed(message: string, details: unknown) {
  return new AppError(403, 'campo_nao_permitido', message, details)
}

const clipIds = (ids: string[]) => ids.slice(0, 20)

/** Registro novo no formato gravado, com os campos que o servidor define. */
function buildEvent(raw: JsonObject, actor: { id: string; name: string }, now: number): JsonObject {
  const e = newEvent.parse(raw)
  const fail = (msg: string) => Errors.invalid(`Registro ${e.id}: ${msg}`, { id: e.id, field: 'until' })
  let until: string | null = null
  if (e.action === 'pausar') {
    const t = e.until ? Date.parse(e.until) : Number.NaN
    if (Number.isNaN(t)) throw fail('a pausa precisa de prazo (until).')
    if (t <= now) throw fail('o prazo da pausa precisa estar no futuro.')
    if (t > now + PAUSE_MAX_DAYS * 86_400_000 + UNTIL_SLACK_MS) throw fail(`a pausa pode ter no máximo ${PAUSE_MAX_DAYS} dias.`)
    until = new Date(t).toISOString()
  }
  return {
    id: e.id,
    playerId: e.playerId,
    at: new Date(now).toISOString(),
    action: e.action,
    ...(e.from ? { from: e.from } : {}),
    ...(e.to ? { to: e.to } : {}),
    reason: e.reason,
    by: actor.name,
    byId: actor.id,
    until,
    // pedido do jogador: o painel pode marcar, nunca desmarcar o que o motivo indica
    byPlayer: e.action === 'pausar' && (e.byPlayer === true || isPlayerRequestedReason(e.reason)),
  }
}

function describe(e: JsonObject): string {
  const until = typeof e.until === 'string' ? ` até ${e.until}` : ''
  const who = e.byPlayer ? ' (pedido do jogador)' : ''
  return `${String(e.action)} ${String(e.playerId)}${until}${who}`
}

export const kvHandlers: KvHandlers = {
  'player-status': {
    read: (ctx) => genericHandler.read(ctx),

    async write(ctx: KvContext, value: unknown, expectedVersion: number | undefined): Promise<KvValue> {
      const { app, auth, key, rule } = ctx
      if (!canWriteKey(rule, auth.perms)) throw Errors.forbidden()
      if (key !== STATUS_HISTORY_KEY) throw Errors.forbidden('Estes dados não podem ser alterados pela tela.')
      const list = historyList.parse(value) as JsonObject[]
      const ids = new Set<string>()
      for (const e of list) {
        const eid = e.id as string
        if (ids.has(eid)) throw Errors.invalid(`Registro repetido na lista (${eid}).`, { id: eid })
        ids.add(eid)
      }

      return app.db.tx(async (t) => {
        const row = await loadRow(t, key, true)
        assertVersion(row, expectedVersion)
        const stored = storedValue(row, app.cipher)
        const storedList = stored === MISSING ? [] : (Array.isArray(stored) ? stored : []).filter(isPlainObject)
        const storedById = new Map<string, JsonObject>()
        for (const e of storedList) if (typeof e.id === 'string') storedById.set(e.id, e)
        const incomingById = new Map(list.map((e) => [e.id as string, e]))

        // só inclusão: o que já está gravado volta igual
        const removed: string[] = []
        const changed: string[] = []
        for (const [eid, old] of storedById) {
          const now = incomingById.get(eid)
          if (!now) removed.push(eid)
          else if (!deepEqual(old, now)) changed.push(eid)
        }
        if (removed.length || changed.length) {
          throw notAllowed('O histórico de status só aceita inclusão: registros gravados não podem ser alterados nem removidos.', {
            fields: [],
            changed: clipIds(changed),
            removed: clipIds(removed),
          })
        }

        const fresh = list.filter((e) => !storedById.has(e.id as string))
        if (fresh.length > MAX_NEW_STATUS_EVENTS) throw Errors.invalid(`No máximo ${MAX_NEW_STATUS_EVENTS} registros novos por vez.`)
        const now = Date.now()
        const actor = { id: auth.user.id, name: auth.user.name }
        const built = fresh.map((e) => buildEvent(e, actor, now))
        const next = [...built, ...storedList]
        const saved = await saveRow(t, app.cipher, key, next, false, row, auth.user.id)
        const summary = built.length
          ? `Registros incluídos (${built.length}): ${built.slice(0, 10).map(describe).join('; ')}${built.length > 10 ? ` e mais ${built.length - 10}` : ''}`
          : 'Salvo sem alterações'
        await writeAudit(t, auth, { action: 'editar', entity: auditEntity(rule.page), summary: `${key} — ${summary}` })
        return { value: next, version: saved.version, updatedAt: saved.updatedAt }
      })
    },
  },
}
