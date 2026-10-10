// Regras de status do jogador (jogo responsável, Lei 14.790/2023). Compartilhado
// entre painel e servidor: o servidor aplica nas gravações de geral.jogadores
// (server/src/modules/kv/player-status.ts) e o painel pode usar a mesma tabela
// para mostrar só as ações que a pessoa pode fazer.
//  - autoexclusão é decisão do jogador: o painel não tira nem põe ninguém em
//    'autoexcluido' (só a plataforma, quando o jogador pede ou o prazo acaba);
//  - antifraude.banir só bloqueia (ativo/pausa → bloqueado) e desfaz o bloqueio
//    (bloqueado → ativo/pausa);
//  - pausa pedida pelo jogador só termina no prazo (conferido pelo servidor com o
//    histórico de status; aqui fica só a regra do motivo).

export const PLAYER_STATUSES = ['ativo', 'bloqueado', 'autoexcluido', 'pausa'] as const
export type PlayerStatus = (typeof PLAYER_STATUSES)[number]

export const STATUS_LABEL: Record<PlayerStatus, string> = {
  ativo: 'ativo',
  bloqueado: 'bloqueado',
  autoexcluido: 'autoexcluído',
  pausa: 'em pausa',
}

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

export function isPlayerStatus(v: unknown): v is PlayerStatus {
  return typeof v === 'string' && (PLAYER_STATUSES as readonly string[]).includes(v)
}

/** Motivo de pausa que indica pedido do jogador. */
export function isPlayerRequestedReason(reason: unknown): boolean {
  return typeof reason === 'string' && reason.trim().toLowerCase().startsWith('pedido do jogador')
}

/**
 * A pessoa pode levar o jogador de `from` para `to`? Status gravado fora da lista
 * (base antiga) conta como ativo. Mesmo status = nada muda (true). Não confere a
 * pausa pedida pelo jogador (depende do histórico, conferido pelo servidor).
 */
export function canChangeStatus(fromRaw: unknown, to: PlayerStatus, perms: ReadonlySet<string>): boolean {
  const from: PlayerStatus = isPlayerStatus(fromRaw) ? fromRaw : 'ativo'
  if (from === to) return true
  const allowed = STATUS_TRANSITIONS[from][to]
  return !!allowed && allowed.some((p) => perms.has(p))
}
