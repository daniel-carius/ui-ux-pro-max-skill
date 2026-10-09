// Regras de status do jogador (jogo responsável, Lei 14.790/2023), aplicadas pelo
// servidor nas gravações de geral.jogadores. Espelham statusActions do painel
// (src/domain/geral.ts):
//  - autoexclusão é decisão do jogador: o painel não tira nem põe ninguém em
//    'autoexcluido' (só a plataforma, quando o jogador pede ou o prazo acaba);
//  - pausa pedida pelo jogador só termina no prazo; pausa sem registro conta como
//    pedida pelo jogador (mesmo padrão do painel);
//  - antifraude.banir só bloqueia (ativo/pausa → bloqueado) e desfaz o bloqueio
//    (bloqueado → ativo/pausa).
//
// O início de cada pausa fica em geral.jogadores.pausas (só o servidor grava). Os
// detalhes do pedido (prazo e "pedido do jogador") vêm do histórico
// geral.usuarios.status, que é só de inclusão e tem data, autor e byPlayer
// definidos pelo servidor (status-history.ts). Contam os registros 'pausar' do
// jogador desde o início da pausa (com folga para o histórico chegar antes):
// basta um registro de pedido do jogador ainda no prazo para a pausa não poder
// ser encerrada. Registro novo só pode endurecer, nunca afrouxar.
import { AppError } from '../../errors'
import { isPlainObject, type JsonObject } from './json'

export const PLAYERS_KEY = 'geral.jogadores'
export const PAUSES_KEY = 'geral.jogadores.pausas'
export const STATUS_HISTORY_KEY = 'geral.usuarios.status'

export const PLAYER_STATUSES = ['ativo', 'bloqueado', 'autoexcluido', 'pausa'] as const
export type PlayerStatus = (typeof PLAYER_STATUSES)[number]

/** Folga para o registro do histórico chegar antes da mudança de status (gravações paralelas do painel). */
export const PAUSE_MATCH_WINDOW_MS = 10 * 60_000
/** Prazo máximo de uma pausa lançada pelo painel (opções do painel: 24 h, 7 e 30 dias). */
export const PAUSE_MAX_DAYS = 30

const BOTH = ['usuarios.editar', 'antifraude.banir'] as const
const EDIT = ['usuarios.editar'] as const

/** Transições aceitas pelo painel e as permissões que autorizam cada uma (basta uma). */
export const STATUS_TRANSITIONS: Record<PlayerStatus, Partial<Record<PlayerStatus, readonly string[]>>> = {
  ativo: { pausa: EDIT, bloqueado: BOTH },
  pausa: { ativo: EDIT, bloqueado: BOTH },
  // bloqueado → pausa: desfazer o banimento de uma rede devolve o status de antes
  bloqueado: { ativo: BOTH, pausa: BOTH },
  autoexcluido: {},
}

export const STATUS_LABEL: Record<PlayerStatus, string> = {
  ativo: 'ativo',
  bloqueado: 'bloqueado',
  autoexcluido: 'autoexcluído',
  pausa: 'em pausa',
}

export function isPlayerStatus(v: unknown): v is PlayerStatus {
  return typeof v === 'string' && (PLAYER_STATUSES as readonly string[]).includes(v)
}

/** Motivo de pausa que indica pedido do jogador (mesma regra do painel). */
export function isPlayerRequestedReason(reason: unknown): boolean {
  return typeof reason === 'string' && reason.trim().toLowerCase().startsWith('pedido do jogador')
}

/** Início da pausa em vigor de cada jogador. since null = pausa sem registro no servidor. */
export interface PauseRecord {
  since: string | null
  by?: string
  byId?: string
}
export type PauseStore = Record<string, PauseRecord>

/** Pausas gravadas (objeto sem protótipo: id de jogador "__proto__" vira só mais uma chave). */
export function toPauseStore(v: unknown): PauseStore {
  const out = Object.create(null) as PauseStore
  if (!isPlainObject(v)) return out
  for (const [id, rec] of Object.entries(v)) {
    if (!isPlainObject(rec)) continue
    const since = typeof rec.since === 'string' ? rec.since : null
    const by = typeof rec.by === 'string' ? rec.by : undefined
    const byId = typeof rec.byId === 'string' ? rec.byId : undefined
    out[id] = { since, ...(by ? { by } : {}), ...(byId ? { byId } : {}) }
  }
  return out
}

function transitionError(id: string, from: string, to: string, message: string, extra: Record<string, unknown> = {}) {
  return new AppError(403, 'transicao_nao_permitida', message, { id, from, to, ...extra })
}

/** Confere se a pessoa pode levar o jogador de `from` para `to` (403 transicao_nao_permitida). */
export function checkTransition(id: string, fromRaw: unknown, to: PlayerStatus, perms: ReadonlySet<string>) {
  // status gravado fora da lista (base antiga) conta como ativo
  const from: PlayerStatus = isPlayerStatus(fromRaw) ? fromRaw : 'ativo'
  if (from === to) return
  if (from === 'autoexcluido') {
    throw transitionError(id, from, to, `Jogador ${id}: autoexclusão é decisão do jogador e não pode ser desfeita pelo painel.`)
  }
  if (to === 'autoexcluido') {
    throw transitionError(id, from, to, `Jogador ${id}: só o próprio jogador pede autoexclusão (pela plataforma), não o painel.`)
  }
  const allowed = STATUS_TRANSITIONS[from][to]
  if (!allowed) {
    throw transitionError(id, from, to, `Jogador ${id}: não é possível passar de ${STATUS_LABEL[from]} para ${STATUS_LABEL[to]}.`)
  }
  if (!allowed.some((p) => perms.has(p))) {
    throw transitionError(id, from, to, `Jogador ${id}: seu cargo não pode passar o status de ${STATUS_LABEL[from]} para ${STATUS_LABEL[to]}.`)
  }
}

const dateOf = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : Number.NaN)

/**
 * Pausa em vigor que impede voltar a 'ativo': pausa sem registro (conta como pedida
 * pelo jogador) ou algum registro 'pausar' de pedido do jogador desde o início da
 * pausa ainda no prazo. Devolve a mensagem de recusa ou null.
 */
export function pauseBlocksEnd(id: string, rec: PauseRecord | undefined, history: readonly JsonObject[], now: number): string | null {
  if (!rec) return null
  const noRecord = `Jogador ${id}: pausa sem registro do pedido conta como pedida pelo jogador e só termina pela plataforma.`
  const start = rec.since ? Date.parse(rec.since) : Number.NaN
  if (Number.isNaN(start)) return noRecord
  const entries = history.filter(
    (e) => e.playerId === id && e.action === 'pausar' && !Number.isNaN(dateOf(e.at)) && dateOf(e.at) >= start - PAUSE_MATCH_WINDOW_MS,
  )
  if (!entries.length) return noRecord
  let until = Number.NEGATIVE_INFINITY
  for (const e of entries) {
    if (e.byPlayer !== true) continue
    const u = e.until == null ? Number.POSITIVE_INFINITY : dateOf(e.until)
    until = Math.max(until, Number.isNaN(u) ? Number.POSITIVE_INFINITY : u)
  }
  if (until <= now) return null
  const when = Number.isFinite(until) ? ` (termina em ${new Date(until).toISOString()})` : ''
  return `Jogador ${id}: pausa pedida pelo jogador só termina no prazo combinado${when}.`
}

/**
 * Aplica a mudança de status às pausas em vigor (muta `pauses`; devolve true se mudou).
 * Recusa (403) voltar a 'ativo' com pausa do jogador em vigor.
 */
export function applyPauseRules(
  id: string,
  fromRaw: unknown,
  to: PlayerStatus,
  pauses: PauseStore,
  history: readonly JsonObject[],
  actor: { id: string; name: string },
  now: number,
): boolean {
  const from: PlayerStatus = isPlayerStatus(fromRaw) ? fromRaw : 'ativo'
  // pausa gravada antes do servidor registrar o início: sem registro (conta como do jogador)
  const rec = pauses[id] ?? (from === 'pausa' ? { since: null } : undefined)
  if (to === 'ativo') {
    const blocked = pauseBlocksEnd(id, rec, history, now)
    if (blocked) throw transitionError(id, from, to, blocked)
    if (pauses[id]) {
      delete pauses[id]
      return true
    }
    return false
  }
  if (to === 'pausa') {
    // bloqueado → pausa devolve a pausa que já existia; senão começa uma nova
    if (from === 'bloqueado' && pauses[id]) return false
    pauses[id] = { since: new Date(now).toISOString(), by: actor.name, byId: actor.id }
    return true
  }
  if (to === 'bloqueado' && from === 'pausa' && !pauses[id]) {
    // bloquear quem está em pausa não encerra a pausa: ela volta ao desbloquear
    pauses[id] = { since: null }
    return true
  }
  return false
}
