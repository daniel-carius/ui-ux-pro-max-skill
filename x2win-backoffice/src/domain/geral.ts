// Regras do módulo Geral (Usuários, Rankings, Transações).
// Funções puras: a recriação com back-end pode reaproveitar validações e cálculos.
import type { Player, PlayerStatus } from '@/data/players'
import type { Transaction, TransactionType } from '@/data/finance'
import { cpf as fmtCpf } from '@/lib/format'

export const GERAL_KEYS = {
  /** histórico de mudanças de status feitas pela equipe */
  statusHistory: 'geral.usuarios.status',
} as const

const round2 = (n: number) => Math.round(n * 100) / 100

// ---------- Busca e filtros de jogadores ----------

export function digitsOf(s: string) {
  return s.replace(/\D/g, '')
}

/**
 * Texto pesquisável do jogador. O CPF entra só para a busca (dígitos e formatado);
 * a tela sempre mostra o CPF mascarado.
 */
export function playerSearchText(p: Player) {
  return `${p.id} ${p.email} ${p.nickname} ${p.name} ${p.cpf} ${fmtCpf(p.cpf)}`
}

export type BalanceBand = 'todos' | 'zerado' | 'ate100' | '100a1000' | 'acima1000'

export const BALANCE_BANDS: { value: BalanceBand; label: string }[] = [
  { value: 'todos', label: 'Qualquer saldo' },
  { value: 'zerado', label: 'Zerado' },
  { value: 'ate100', label: 'Até R$ 100' },
  { value: '100a1000', label: 'R$ 100 a R$ 1.000' },
  { value: 'acima1000', label: 'Acima de R$ 1.000' },
]

export function playerBalance(p: Pick<Player, 'balanceReal' | 'balanceBonus'>) {
  return round2(p.balanceReal + p.balanceBonus)
}

export function inBalanceBand(p: Player, band: BalanceBand) {
  const b = playerBalance(p)
  switch (band) {
    case 'zerado':
      return b === 0
    case 'ate100':
      return b > 0 && b <= 100
    case '100a1000':
      return b > 100 && b <= 1000
    case 'acima1000':
      return b > 1000
    default:
      return true
  }
}

/** GGR que o jogador gerou para a casa: apostado − ganho. */
export function playerGgr(p: Pick<Player, 'totalBet' | 'totalWon'>) {
  return round2(p.totalBet - p.totalWon)
}

/** RTP individual: quanto voltou ao jogador de cada real apostado. */
export function playerRtp(p: Pick<Player, 'totalBet' | 'totalWon'>) {
  return p.totalBet > 0 ? p.totalWon / p.totalBet : 0
}

export function ageFrom(birthIso: string, now: Date = new Date()) {
  const b = new Date(birthIso)
  let age = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--
  return age
}

/** Outras contas com o mesmo IP (sinal de multicontas para o anti-fraude). */
export function sameIpAccounts(players: Player[], p: Player) {
  return players.filter((x) => x.id !== p.id && x.ip === p.ip)
}

// ---------- Status da conta ----------

export type StatusAction = 'bloquear' | 'desbloquear' | 'pausar' | 'encerrar_pausa'

export interface StatusEvent {
  id: string
  playerId: string
  at: string
  action: StatusAction
  from: PlayerStatus
  to: PlayerStatus
  reason: string
  by: string
  /** fim da pausa (só para "pausar") */
  until: string | null
  /** a pausa foi pedida pelo jogador (não pode ser encerrada antes do prazo) */
  byPlayer: boolean
}

export const STATUS_ACTION_LABEL: Record<StatusAction, string> = {
  bloquear: 'Bloquear conta',
  desbloquear: 'Desbloquear conta',
  pausar: 'Pausar conta',
  encerrar_pausa: 'Encerrar pausa',
}

export const STATUS_ACTION_NEXT: Record<StatusAction, PlayerStatus> = {
  bloquear: 'bloqueado',
  desbloquear: 'ativo',
  pausar: 'pausa',
  encerrar_pausa: 'ativo',
}

export const STATUS_REASONS: Record<StatusAction, string[]> = {
  bloquear: ['Suspeita de fraude', 'Conta duplicada', 'Contestação de PIX (MED)', 'Menor de idade', 'Pedido do jogador', 'Outro motivo'],
  desbloquear: ['Análise concluída sem irregularidade', 'Documentos validados (KYC)', 'Pedido do jogador atendido', 'Outro motivo'],
  pausar: ['Pedido do jogador (jogo responsável)', 'Sinais de jogo problemático', 'Análise de conta em andamento', 'Outro motivo'],
  encerrar_pausa: ['Análise concluída', 'Pausa aplicada por engano', 'Outro motivo'],
}

export const PAUSE_OPTIONS = [
  { days: 1, label: '24 horas' },
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
] as const

/**
 * Ações de status permitidas.
 * - Autoexclusão é decisão do jogador: o painel não reverte.
 * - Pausa pedida pelo jogador só termina no prazo (pausas sem histórico contam como pedidas pelo jogador).
 */
export function statusActions(status: PlayerStatus, lastPause?: StatusEvent | null, now = Date.now()): { action: StatusAction; allowed: boolean; reason?: string }[] {
  switch (status) {
    case 'ativo':
      return [
        { action: 'pausar', allowed: true },
        { action: 'bloquear', allowed: true },
      ]
    case 'bloqueado':
      return [{ action: 'desbloquear', allowed: true }]
    case 'pausa': {
      const byPlayer = !lastPause || lastPause.byPlayer
      const ended = !!lastPause?.until && new Date(lastPause.until).getTime() <= now
      const canEnd = !byPlayer || ended
      return [
        {
          action: 'encerrar_pausa',
          allowed: canEnd,
          reason: canEnd ? undefined : 'Pausa pedida pelo jogador só termina no prazo combinado.',
        },
        { action: 'bloquear', allowed: true },
      ]
    }
    case 'autoexcluido':
    default:
      return []
  }
}

export function isPlayerRequestedPause(reason: string) {
  return reason.startsWith('Pedido do jogador')
}

// ---------- Ajuste manual de saldo ----------

/** Teto por lançamento manual. Acima disso, o ajuste precisa ser feito pelo financeiro com documento. */
export const MANUAL_ADJUST_LIMIT = 5000
/** A partir deste valor o painel pede para digitar a confirmação. */
export const MANUAL_ADJUST_STRONG_CONFIRM = 1000

export const MANUAL_REASONS = [
  'Compensação por falha em jogo',
  'Correção de depósito não creditado',
  'Bônus de relacionamento (VIP)',
  'Ajuste de saldo duplicado',
  'Correção de prêmio de torneio',
  'Outro motivo',
]

export interface ManualAdjustInput {
  kind: 'credito' | 'debito'
  wallet: 'real' | 'bonus'
  amount: number
  reason: string
  note: string
}

export function walletBalance(p: Pick<Player, 'balanceReal' | 'balanceBonus'>, wallet: 'real' | 'bonus') {
  return wallet === 'real' ? p.balanceReal : p.balanceBonus
}

/** Erros por campo (validação em linha). Vazio = pode lançar. */
export function validateManualAdjust(input: ManualAdjustInput, p: Player): Partial<Record<'amount' | 'reason' | 'note' | 'kind', string>> {
  const e: Partial<Record<'amount' | 'reason' | 'note' | 'kind', string>> = {}
  if (!(input.amount > 0)) e.amount = 'Informe um valor maior que zero.'
  else if (Math.abs(input.amount * 100 - Math.round(input.amount * 100)) > 1e-6) e.amount = 'Use no máximo duas casas decimais.'
  else if (input.amount > MANUAL_ADJUST_LIMIT) e.amount = `O teto por lançamento é R$ ${MANUAL_ADJUST_LIMIT.toLocaleString('pt-BR')},00.`
  else if (input.kind === 'debito' && input.amount > walletBalance(p, input.wallet))
    e.amount = `O saldo ${input.wallet === 'real' ? 'real' : 'bônus'} é de ${walletBalance(p, input.wallet).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`
  if (!input.reason) e.reason = 'Escolha o motivo.'
  if (input.reason === 'Outro motivo' && input.note.trim().length < 10) e.note = 'Descreva o motivo (mínimo de 10 caracteres).'
  if (input.kind === 'credito' && p.status === 'autoexcluido') e.kind = 'Jogador autoexcluído não pode receber creditações.'
  return e
}

export function manualAdjustPreview(input: ManualAdjustInput, p: Player) {
  const before = walletBalance(p, input.wallet)
  const signed = input.kind === 'credito' ? input.amount : -input.amount
  const after = round2(Math.max(0, before + signed))
  return { before, after, signed: round2(signed) }
}

export function newTxId(now = Date.now()) {
  return `TX9${String(now).slice(-6)}`
}

/** Transação com anotação da equipe (motivo e autor), gravada junto com o extrato. */
export type AnnotatedTransaction = Transaction & { note?: string; by?: string }

export function buildManualTx(input: ManualAdjustInput, p: Player, by: string, now = new Date()): AnnotatedTransaction {
  const { before, after, signed } = manualAdjustPreview(input, p)
  const reason = input.reason === 'Outro motivo' ? input.note.trim() : input.note.trim() ? `${input.reason}: ${input.note.trim()}` : input.reason
  return {
    id: newTxId(now.getTime()),
    at: now.toISOString(),
    playerId: p.id,
    playerName: p.name,
    playerEmail: p.email,
    type: input.kind === 'credito' ? 'credito_manual' : 'debito_manual',
    amount: signed,
    wallet: input.wallet,
    balanceBefore: before,
    balanceAfter: after,
    gameId: null,
    gameName: null,
    providerName: null,
    reference: `MAN-${String(now.getTime()).slice(-8)}`,
    note: reason,
    by,
  }
}

export function walletPatch(wallet: 'real' | 'bonus', value: number): Partial<Player> {
  return wallet === 'real' ? { balanceReal: value } : { balanceBonus: value }
}

// ---------- Estorno ----------

/** Só apostas e subtrações manuais podem ser estornadas pelo painel. */
export const REVERSIBLE_TYPES: TransactionType[] = ['aposta', 'debito_manual']
/** Janela para estorno: depois disso, a correção vira ajuste manual com aprovação. */
export const REVERSAL_WINDOW_DAYS = 15

export const REVERSAL_REASONS = [
  'Rodada não concluída pelo provedor',
  'Falha de conexão durante a aposta',
  'Subtração lançada por engano',
  'Valor cobrado em duplicidade',
  'Outro motivo',
].map((r) => ({ value: r, label: r }))

export function reversalRef(txId: string) {
  return `EST-${txId}`
}

/** Ids das transações que já têm estorno lançado. */
export function reversedIds(txs: Transaction[]) {
  const s = new Set<string>()
  for (const t of txs) if (t.type === 'estorno' && t.reference.startsWith('EST-')) s.add(t.reference.slice(4))
  return s
}

export function canReverse(tx: Transaction, reversed: Set<string>, now = Date.now()): { ok: boolean; reason?: string } {
  if (!REVERSIBLE_TYPES.includes(tx.type)) return { ok: false, reason: 'Só apostas e subtrações manuais podem ser estornadas.' }
  if (tx.amount >= 0) return { ok: false, reason: 'A transação não tirou saldo do jogador.' }
  if (reversed.has(tx.id)) return { ok: false, reason: 'Esta transação já foi estornada.' }
  const ageDays = (now - new Date(tx.at).getTime()) / 86_400_000
  if (ageDays > REVERSAL_WINDOW_DAYS) return { ok: false, reason: `Passou o prazo de ${REVERSAL_WINDOW_DAYS} dias. Use um ajuste manual na ficha do jogador.` }
  return { ok: true }
}

export function buildReversalTx(tx: Transaction, p: Player | undefined, reason: string, by: string, now = new Date()): AnnotatedTransaction {
  const amount = round2(Math.abs(tx.amount))
  const before = p ? walletBalance(p, tx.wallet) : tx.balanceAfter
  return {
    id: newTxId(now.getTime()),
    at: now.toISOString(),
    playerId: tx.playerId,
    playerName: tx.playerName,
    playerEmail: tx.playerEmail,
    type: 'estorno',
    amount,
    wallet: tx.wallet,
    balanceBefore: before,
    balanceAfter: round2(before + amount),
    gameId: tx.gameId,
    gameName: tx.gameName,
    providerName: tx.providerName,
    reference: reversalRef(tx.id),
    note: reason,
    by,
  }
}

// ---------- Indicadores do extrato ----------

export interface StatementTotals {
  deposits: number
  depositsCount: number
  withdrawals: number
  withdrawalsCount: number
  bets: number
  betsCount: number
  winnings: number
  winningsCount: number
}

export function statementTotals(txs: Transaction[]): StatementTotals {
  const t: StatementTotals = { deposits: 0, depositsCount: 0, withdrawals: 0, withdrawalsCount: 0, bets: 0, betsCount: 0, winnings: 0, winningsCount: 0 }
  for (const x of txs) {
    if (x.type === 'deposito') {
      t.deposits += x.amount
      t.depositsCount++
    } else if (x.type === 'saque') {
      t.withdrawals += Math.abs(x.amount)
      t.withdrawalsCount++
    } else if (x.type === 'aposta') {
      t.bets += Math.abs(x.amount)
      t.betsCount++
    } else if (x.type === 'ganho' || x.type === 'free_spin') {
      t.winnings += x.amount
      t.winningsCount++
    }
  }
  return t
}

// ---------- Rankings ----------

export type RankCriterion = 'apostou' | 'apostas' | 'ganhou' | 'maior_ganho' | 'resultado' | 'ggr'

export interface PlayerPeriodStats {
  playerId: string
  wagered: number
  bets: number
  won: number
  biggestWin: number
}

export const RANK_CRITERIA: Record<RankCriterion, { label: string; metric: string; format: 'brl' | 'num'; signed?: boolean; formula: string }> = {
  apostou: { label: 'Mais apostou', metric: 'Valor apostado', format: 'brl', formula: 'Soma do valor de todas as apostas do jogador no período (cassino e esportes).' },
  apostas: { label: 'Mais apostas', metric: 'Apostas feitas', format: 'num', formula: 'Quantidade de apostas (rodadas e bilhetes) do jogador no período.' },
  ganhou: { label: 'Mais ganhou', metric: 'Valor ganho', format: 'brl', formula: 'Soma de todos os prêmios pagos ao jogador no período, sem descontar o que ele apostou.' },
  maior_ganho: { label: 'Maior ganho único', metric: 'Maior prêmio', format: 'brl', formula: 'O maior prêmio pago em uma única rodada ou bilhete no período.' },
  resultado: { label: 'Melhor resultado', metric: 'Resultado do jogador', format: 'brl', signed: true, formula: 'Resultado = ganho − apostado. Positivo quer dizer que o jogador saiu no lucro.' },
  ggr: { label: 'Maior GGR para a casa', metric: 'GGR gerado', format: 'brl', signed: true, formula: 'GGR = apostado − ganho. É o resultado bruto que o jogador deixou para a casa.' },
}

export function rankValue(s: PlayerPeriodStats, c: RankCriterion) {
  switch (c) {
    case 'apostou':
      return s.wagered
    case 'apostas':
      return s.bets
    case 'ganhou':
      return s.won
    case 'maior_ganho':
      return s.biggestWin
    case 'resultado':
      return round2(s.won - s.wagered)
    case 'ggr':
      return round2(s.wagered - s.won)
  }
}

/** Ordena do maior para o menor; empate decide quem apostou mais. Só entra quem apostou no período. */
export function rankPlayers(stats: PlayerPeriodStats[], c: RankCriterion) {
  return stats
    .filter((s) => s.bets > 0)
    .map((s) => ({ ...s, value: rankValue(s, c) }))
    .sort((a, b) => b.value - a.value || b.wagered - a.wagered)
    .map((s, i) => ({ ...s, position: i + 1 }))
}

/** Participação do top N no total (concentração). */
export function topShare(values: number[], n: number) {
  const pos = values.filter((v) => v > 0)
  const total = pos.reduce((s, v) => s + v, 0)
  if (!total) return 0
  return pos.slice(0, n).reduce((s, v) => s + v, 0) / total
}
