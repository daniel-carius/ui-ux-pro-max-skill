// Regras de Segurança: redes de contas ligadas (anti-fraude), modo de ataque e
// manutenção. Funções puras: na recriação com servidor, a montagem das redes,
// a pontuação de risco e o desligamento automático do modo de ataque rodam no
// back-end; a tela só mostra o resultado e aciona as ações.
import type { Affiliate, Player, PlayerStatus } from '@/data/players'
import type { Block, IdentitySignal, LinkKind, SignalKind, SignalSource } from '@/data/seguranca'
import { createRng } from '@/lib/random'
import { brl, pct } from '@/lib/format'
import { dbGet, dbSet } from '@/lib/store'
import { audit } from './session'
import { DEFAULT_ATTACK_MODE, SYSTEM_KEYS, type AttackModeState } from './system'

// ---------- Anti-fraude: ligações entre contas ----------

export const LINK_LABEL: Record<LinkKind, string> = {
  ip: 'Mesmo IP',
  padrinho: 'Mesmo padrinho',
  email: 'Mesmo e-mail',
  cpf: 'Mesmo CPF',
  celular: 'Mesmo celular',
}

/** Peso de cada tipo de ligação na pontuação de risco (conta uma vez por tipo). */
export const LINK_WEIGHT: Record<LinkKind, number> = { cpf: 30, celular: 20, email: 20, ip: 10, padrinho: 10 }

export const LINK_ORDER: LinkKind[] = ['cpf', 'celular', 'email', 'ip', 'padrinho']

export type NetworkRisk = 'alto' | 'medio' | 'baixo'
export const RISK_LABEL: Record<NetworkRisk, string> = { alto: 'Alto', medio: 'Médio', baixo: 'Baixo' }

/** Pontuação mínima de cada nível */
export const RISK_THRESHOLDS = { alto: 60, medio: 35 } as const

/** Janela para "indicados em sequência" pelo mesmo padrinho */
export const REFERRAL_BURST = { accounts: 3, hours: 72 } as const

/** E-mail normalizado: minúsculo, sem +apelido e, no Gmail, sem pontos. */
export function normalizeEmail(email: string) {
  const [rawUser, rawDomain] = email.trim().toLowerCase().split('@')
  if (!rawDomain) return email.trim().toLowerCase()
  const domain = rawDomain === 'googlemail.com' ? 'gmail.com' : rawDomain
  let user = rawUser.split('+')[0]
  if (domain === 'gmail.com') user = user.replace(/\./g, '')
  return `${user}@${domain}`
}

/** Celular só com dígitos, sem o 55 do Brasil. */
export function normalizePhone(phone: string) {
  const d = phone.replace(/\D/g, '')
  return d.length >= 12 && d.startsWith('55') ? d.slice(2) : d
}

export function normalizeSignal(kind: SignalKind, value: string) {
  if (kind === 'email') return normalizeEmail(value)
  if (kind === 'celular') return normalizePhone(value)
  if (kind === 'cpf') return value.replace(/\D/g, '')
  return value.trim()
}

export interface LinkEvidence {
  kind: LinkKind
  /** valor compartilhado (normalizado). Para padrinho: id do afiliado */
  value: string
  playerIds: string[]
  sources: SignalSource[]
  /** para padrinho: o próprio afiliado está na rede */
  selfReferral?: boolean
  /** para padrinho: contas criadas em sequência */
  burst?: boolean
}

export interface NetworkTotals {
  deposited: number
  withdrawn: number
  bet: number
  bonus: number
  balance: number
}

export interface AccountNetwork {
  id: string
  playerIds: string[]
  links: LinkEvidence[]
  kinds: LinkKind[]
  /** tipos de ligação de cada conta */
  memberKinds: Record<string, LinkKind[]>
  score: number
  level: NetworkRisk
  reasons: string[]
  totals: NetworkTotals
  firstCreatedAt: string
  lastCreatedAt: string
  lastAccess: string
  bannedCount: number
  status: 'ativa' | 'parcial' | 'banida'
  sharedIps: string[]
}

class UnionFind {
  private parent = new Map<string, string>()
  find(x: string): string {
    let p = this.parent.get(x) ?? x
    if (p !== x) {
      p = this.find(p)
      this.parent.set(x, p)
    }
    return p
  }
  union(a: string, b: string) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb)
  }
}

/** Sinais do cadastro de cada jogador + sinais extras (login, PIX, SMS...). */
export function allSignals(players: Player[], extra: IdentitySignal[]): IdentitySignal[] {
  const base: IdentitySignal[] = []
  for (const p of players) {
    base.push({ playerId: p.id, kind: 'ip', value: p.ip, source: 'cadastro', at: p.createdAt })
    base.push({ playerId: p.id, kind: 'email', value: p.email, source: 'cadastro', at: p.createdAt })
    base.push({ playerId: p.id, kind: 'cpf', value: p.cpf, source: 'cadastro', at: p.createdAt })
    base.push({ playerId: p.id, kind: 'celular', value: p.phone, source: 'cadastro', at: p.createdAt })
  }
  return [...base, ...extra]
}

export interface NetworkContext {
  players: Player[]
  signals: IdentitySignal[]
  affiliates: Affiliate[]
  bonus: Record<string, number>
  now: number
}

/**
 * Monta as redes de contas ligadas.
 * - Mesmo IP, e-mail (normalizado), CPF ou celular ligam as contas na hora.
 * - Mesmo padrinho sozinho não forma rede (é o normal de um afiliado). Conta como
 *   ligação quando as contas já estão ligadas por outro sinal, quando o próprio
 *   padrinho está na rede, ou quando 3+ indicados dele se cadastram em até 72 h.
 */
export function buildNetworks(ctx: NetworkContext): AccountNetwork[] {
  const { players, affiliates, bonus, now } = ctx
  const byId = new Map(players.map((p) => [p.id, p]))
  const signals = allSignals(players, ctx.signals)
  const uf = new UnionFind()

  // 1) sinais fortes e IP
  const groups = new Map<string, { kind: SignalKind; value: string; ids: Set<string>; sources: Set<SignalSource> }>()
  for (const s of signals) {
    if (!byId.has(s.playerId)) continue
    const value = normalizeSignal(s.kind, s.value)
    if (!value) continue
    const key = `${s.kind}:${value}`
    let g = groups.get(key)
    if (!g) {
      g = { kind: s.kind, value, ids: new Set(), sources: new Set() }
      groups.set(key, g)
    }
    g.ids.add(s.playerId)
    g.sources.add(s.source)
  }
  const evidence: LinkEvidence[] = []
  for (const g of groups.values()) {
    if (g.ids.size < 2) continue
    const ids = [...g.ids]
    ids.slice(1).forEach((id) => uf.union(ids[0], id))
    evidence.push({ kind: g.kind, value: g.value, playerIds: ids, sources: [...g.sources] })
  }

  // 2) indicados em sequência pelo mesmo padrinho
  const byRef = new Map<string, Player[]>()
  for (const p of players) if (p.referrerId) byRef.set(p.referrerId, [...(byRef.get(p.referrerId) ?? []), p])
  const burstIds = new Set<string>()
  for (const list of byRef.values()) {
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    for (let i = 0; i < sorted.length; i++) {
      const start = new Date(sorted[i].createdAt).getTime()
      const win = sorted.filter((p) => {
        const t = new Date(p.createdAt).getTime()
        return t >= start && t - start <= REFERRAL_BURST.hours * 3600_000
      })
      if (win.length >= REFERRAL_BURST.accounts) {
        win.slice(1).forEach((p) => uf.union(win[0].id, p.id))
        win.forEach((p) => burstIds.add(p.id))
      }
    }
  }

  // 3) componentes
  const components = new Map<string, string[]>()
  const involved = new Set<string>()
  for (const e of evidence) e.playerIds.forEach((id) => involved.add(id))
  burstIds.forEach((id) => involved.add(id))
  for (const id of involved) {
    const root = uf.find(id)
    components.set(root, [...(components.get(root) ?? []), id])
  }

  const affByPlayer = new Map(affiliates.map((a) => [a.playerId, a]))
  const out: AccountNetwork[] = []
  for (const ids of components.values()) {
    if (ids.length < 2) continue
    const set = new Set(ids)
    const members = ids.map((id) => byId.get(id)!).filter(Boolean)
    const links = evidence.filter((e) => e.playerIds.some((id) => set.has(id)))

    // padrinho em comum dentro da rede (ou o próprio padrinho na rede)
    const refs = new Map<string, string[]>()
    for (const m of members) if (m.referrerId) refs.set(m.referrerId, [...(refs.get(m.referrerId) ?? []), m.id])
    for (const [refId, refMembers] of refs) {
      const affPlayer = members.find((m) => affByPlayer.get(m.id)?.id === refId)
      const all = affPlayer ? [affPlayer.id, ...refMembers] : refMembers
      if (all.length < 2) continue
      links.push({
        kind: 'padrinho',
        value: refId,
        playerIds: all,
        sources: ['cadastro'],
        selfReferral: !!affPlayer,
        burst: refMembers.filter((id) => burstIds.has(id)).length >= REFERRAL_BURST.accounts,
      })
    }

    const memberKinds: Record<string, LinkKind[]> = {}
    for (const l of links) for (const id of l.playerIds) if (set.has(id)) memberKinds[id] = [...new Set([...(memberKinds[id] ?? []), l.kind])]
    const kinds = LINK_ORDER.filter((k) => links.some((l) => l.kind === k))
    const totals = members.reduce<NetworkTotals>(
      (t, m) => ({
        deposited: t.deposited + m.totalDeposited,
        withdrawn: t.withdrawn + m.totalWithdrawn,
        bet: t.bet + m.totalBet,
        bonus: t.bonus + (bonus[m.id] ?? 0),
        balance: t.balance + m.balanceReal,
      }),
      { deposited: 0, withdrawn: 0, bet: 0, bonus: 0, balance: 0 },
    )
    const risk = scoreNetwork({ kinds, members, links, totals, now })
    const created = members.map((m) => m.createdAt).sort()
    const banned = members.filter((m) => m.status === 'bloqueado').length
    out.push({
      id: `RD-${[...ids].sort()[0]}`,
      playerIds: [...ids].sort((a, b) => byId.get(a)!.createdAt.localeCompare(byId.get(b)!.createdAt)),
      links: links.sort((a, b) => LINK_ORDER.indexOf(a.kind) - LINK_ORDER.indexOf(b.kind)),
      kinds,
      memberKinds,
      ...risk,
      totals,
      firstCreatedAt: created[0],
      lastCreatedAt: created[created.length - 1],
      lastAccess: members.map((m) => m.lastAccess).sort().reverse()[0],
      bannedCount: banned,
      status: banned === 0 ? 'ativa' : banned === members.length ? 'banida' : 'parcial',
      sharedIps: links.filter((l) => l.kind === 'ip').map((l) => l.value),
    })
  }
  return out.sort((a, b) => b.score - a.score || b.playerIds.length - a.playerIds.length)
}

/**
 * Pontuação de risco (0–100) da rede:
 * tipos de ligação (CPF 30, celular 20, e-mail 20, IP 10, padrinho 10) + tamanho
 * (+5 por conta além de 2, até +20) + comportamento (bônus alto, saque rápido,
 * contas novas, KYC reprovado, padrinho indicando a si mesmo).
 */
export function scoreNetwork(n: { kinds: LinkKind[]; members: Player[]; links: LinkEvidence[]; totals: NetworkTotals; now: number }) {
  const reasons: string[] = []
  let score = 0
  for (const k of n.kinds) {
    score += LINK_WEIGHT[k]
    const l = n.links.find((x) => x.kind === k)
    if (l) reasons.push(`${LINK_LABEL[k]} em ${l.playerIds.length} contas`)
  }
  const size = n.members.length
  if (size > 2) {
    score += Math.min(20, (size - 2) * 5)
    reasons.push(`${size} contas ligadas`)
  }
  if (n.totals.bonus > 0 && n.totals.bonus >= n.totals.deposited * 0.5) {
    score += 15
    reasons.push(`Bônus recebido é ${pct(n.totals.deposited ? n.totals.bonus / n.totals.deposited : 1, 0)} do depositado (${brl(n.totals.bonus)})`)
  }
  const fastOut = n.members.filter((m) => m.totalDeposited > 0 && m.totalWithdrawn >= m.totalDeposited * 0.8).length
  if (fastOut >= 2) {
    score += 10
    reasons.push(`${fastOut} contas sacaram 80% ou mais do que depositaram`)
  }
  const fresh = n.members.filter((m) => n.now - new Date(m.createdAt).getTime() < 30 * 86_400_000).length
  if (fresh >= Math.ceil(size / 2)) {
    score += 10
    reasons.push(`${fresh} de ${size} contas criadas nos últimos 30 dias`)
  }
  if (n.members.some((m) => m.kyc === 'reprovado')) {
    score += 5
    reasons.push('Conta com KYC reprovado na rede')
  }
  if (n.links.some((l) => l.kind === 'padrinho' && l.selfReferral)) {
    score += 10
    reasons.push('O padrinho está ligado às contas que indicou')
  }
  score = Math.min(100, score)
  const level: NetworkRisk = score >= RISK_THRESHOLDS.alto ? 'alto' : score >= RISK_THRESHOLDS.medio ? 'medio' : 'baixo'
  return { score, level, reasons }
}

/** Mapa jogador → rede */
export function networkIndex(networks: AccountNetwork[]) {
  const m = new Map<string, AccountNetwork>()
  for (const n of networks) for (const id of n.playerIds) m.set(id, n)
  return m
}

// ---------- IPs ----------

export interface IpRow {
  ip: string
  playerIds: string[]
  sources: SignalSource[]
  lastSeen: string
  city: string
  blocked: boolean
  networkId: string | null
}

export function buildIpRows(players: Player[], extra: IdentitySignal[], blocks: Block[], netIndex: Map<string, AccountNetwork>): IpRow[] {
  const byId = new Map(players.map((p) => [p.id, p]))
  const map = new Map<string, { ids: Set<string>; sources: Set<SignalSource>; last: string }>()
  for (const s of allSignals(players, extra)) {
    if (s.kind !== 'ip') continue
    const p = byId.get(s.playerId)
    if (!p) continue
    const row = map.get(s.value) ?? { ids: new Set<string>(), sources: new Set<SignalSource>(), last: '' }
    row.ids.add(s.playerId)
    row.sources.add(s.source)
    const seen = s.source === 'cadastro' ? p.lastAccess : s.at
    if (seen > row.last) row.last = seen
    map.set(s.value, row)
  }
  const blocked = new Set(blocks.filter((b) => b.kind === 'ip').map((b) => b.value))
  const rows: IpRow[] = [...map.entries()].map(([ip, r]) => {
    const ids = [...r.ids]
    const first = byId.get(ids[0])
    return {
      ip,
      playerIds: ids,
      sources: [...r.sources],
      lastSeen: r.last,
      city: first ? `${first.city}/${first.uf}` : '—',
      blocked: blocked.has(ip),
      networkId: ids.map((id) => netIndex.get(id)?.id).find(Boolean) ?? null,
    }
  })
  // IPs bloqueados à mão que não estão em nenhuma conta
  for (const b of blocks) {
    if (b.kind === 'ip' && !map.has(b.value)) rows.push({ ip: b.value, playerIds: [], sources: [], lastSeen: b.createdAt, city: '—', blocked: true, networkId: null })
  }
  return rows
}

/** IPv4 (com faixa CIDR opcional) */
export function isValidIp(value: string) {
  const m = value.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/(\d{1,2}))?$/)
  if (!m) return false
  if ([m[1], m[2], m[3], m[4]].some((o) => Number(o) > 255)) return false
  if (m[6] !== undefined && (Number(m[6]) < 8 || Number(m[6]) > 32)) return false
  return true
}

// ---------- Contas novas ----------

export interface AccountFlag {
  label: string
  tone: 'danger' | 'warning' | 'info' | 'neutral'
}

export function accountFlags(
  p: Player,
  ctx: { network?: AccountNetwork; ipShared: boolean; ipBlocked: boolean; bonus: number },
): AccountFlag[] {
  const f: AccountFlag[] = []
  if (p.status === 'bloqueado') f.push({ label: 'Bloqueada', tone: 'danger' })
  if (ctx.network) f.push({ label: `Rede de risco ${RISK_LABEL[ctx.network.level].toLowerCase()}`, tone: ctx.network.level === 'alto' ? 'danger' : ctx.network.level === 'medio' ? 'warning' : 'neutral' })
  if (ctx.ipBlocked) f.push({ label: 'IP bloqueado', tone: 'danger' })
  else if (ctx.ipShared) f.push({ label: 'IP compartilhado', tone: 'warning' })
  if (ctx.bonus > 0 && ctx.bonus >= Math.max(50, p.totalDeposited)) f.push({ label: 'Bônus maior que depósitos', tone: 'warning' })
  if (p.totalDeposited > 0 && p.totalWithdrawn >= p.totalDeposited * 0.8) f.push({ label: 'Sacou quase tudo', tone: 'warning' })
  if (p.kyc === 'reprovado') f.push({ label: 'KYC reprovado', tone: 'danger' })
  else if (p.kyc !== 'verificado') f.push({ label: 'KYC pendente', tone: 'neutral' })
  return f
}

/** Contas que vão ser bloqueadas ao banir a rede (as que ainda não estão). */
export function banPlan(members: Player[]) {
  const toBan = members.filter((m) => m.status !== 'bloqueado')
  const previous: Record<string, PlayerStatus> = {}
  for (const m of toBan) previous[m.id] = m.status
  return { toBan, previous }
}

// ---------- Tráfego simulado ----------

/** Sessões com IP distinto no site agora (simulado, varia com o horário). */
export function simulateActiveIps(now: number) {
  const d = new Date(now)
  const hour = d.getHours() + d.getMinutes() / 60
  // pico à noite (21 h), vale de madrugada (5 h)
  const daily = 0.55 + 0.45 * Math.cos(((hour - 21) / 24) * 2 * Math.PI)
  const rng = createRng(Math.floor(now / 15_000))
  return Math.round(420 + 1180 * daily + rng.int(-35, 35))
}

export interface TrafficPoint {
  at: number
  label: string
  total: number
  suspeito: number
  barrado: number
}

/**
 * Requisições por minuto na última hora. Tem um pico de robôs nos últimos
 * minutos (simulação); com o modo de ataque ligado, a maior parte do tráfego
 * suspeito é barrada pelo anti-robô a partir do horário em que foi ligado.
 */
export function simulateTraffic(opts: { now: number; seed: number; attack: AttackModeState }): TrafficPoint[] {
  const rng = createRng(1000 + opts.seed)
  const end = Math.floor(opts.now / 60_000) * 60_000
  const spikeStart = 60 - rng.int(9, 20)
  const spikePeak = rng.float(4.2, 7.5, 2)
  const since = opts.attack.active && opts.attack.since ? new Date(opts.attack.since).getTime() : null
  const out: TrafficPoint[] = []
  for (let i = 0; i < 60; i++) {
    const at = end - (59 - i) * 60_000
    const base = 1080 + 140 * Math.sin(i / 9 + opts.seed) + rng.int(-70, 70)
    let excess = 0
    if (i >= spikeStart) {
      const k = Math.min(1, (i - spikeStart + 1) / 4)
      excess = base * (spikePeak - 1) * k * (0.85 + rng.next() * 0.3)
    } else if (rng.bool(0.06)) {
      excess = base * rng.float(0.2, 0.6)
    }
    const suspeito = Math.round(excess + base * 0.04)
    // o minuto em que o modo foi ligado já conta (at + 1 min > since)
    const barrado = since !== null && at + 60_000 > since ? Math.round(suspeito * (0.86 + rng.next() * 0.1)) : 0
    const d = new Date(at)
    out.push({
      at,
      label: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      total: Math.round(base + excess),
      suspeito,
      barrado,
    })
  }
  return out
}

export function trafficSummary(points: TrafficPoint[]) {
  const current = points[points.length - 1]
  const firstHalf = points.slice(0, 30).map((p) => p.total).sort((a, b) => a - b)
  const baseline = firstHalf[Math.floor(firstHalf.length / 2)] || 1
  const peak = points.reduce((m, p) => (p.total > m.total ? p : m), points[0])
  const last10 = points.slice(-10)
  const avg10 = last10.reduce((s, p) => s + p.total, 0) / last10.length
  const suspicious = last10.reduce((s, p) => s + p.suspeito, 0) / Math.max(1, last10.reduce((s, p) => s + p.total, 0))
  const blocked = points.reduce((s, p) => s + p.barrado, 0)
  return { current: current.total, baseline, peak, ratio: avg10 / baseline, suspicious, blocked, spiking: avg10 / baseline >= 2.5 }
}

// ---------- Modo de ataque ----------

export const NORMAL_LIMITS = { requestsPerMinute: 300, loginAttempts: 10, signupsPerIp: 3 } as const
export const ATTACK_LIMITS = { requestsPerMinute: 60, loginAttempts: 3, signupsPerIp: 1 } as const

export const AUTO_OFF_OPTIONS = [30, 60, 120, 240, 0] as const

export function autoOffLabel(min: number) {
  if (!min) return 'Só manual'
  if (min < 60) return `${min} min`
  return `${min / 60} h`
}

/** Hora em que o modo desliga sozinho (null = manual ou desligado) */
export function attackAutoOffAt(s: AttackModeState): number | null {
  if (!s.active || !s.since || !s.autoOffMinutes) return null
  return new Date(s.since).getTime() + s.autoOffMinutes * 60_000
}

export function shouldAutoOff(s: AttackModeState, now: number) {
  const at = attackAutoOffAt(s)
  return at !== null && now >= at
}

/** O que muda e o que continua com o modo ligado. */
export function operationStatus(s: AttackModeState) {
  const on = s.active
  return [
    { id: 'depositos', label: 'Depósitos', on: 'Funcionando', off: 'Funcionando', changed: false, detail: 'PIX gerado e confirmado normalmente.' },
    { id: 'saques', label: 'Saques', on: 'Funcionando', off: 'Funcionando', changed: false, detail: 'Fila e regras de saque não mudam.' },
    { id: 'jogos', label: 'Jogos e apostas', on: 'Funcionando', off: 'Funcionando', changed: false, detail: 'Cassino e sportsbook seguem abertos.' },
    {
      id: 'cadastro',
      label: 'Cadastro',
      on: s.closeSignups ? 'Fechado' : 'Aberto',
      off: 'Aberto',
      changed: on && s.closeSignups,
      detail: on && s.closeSignups ? 'Novas contas ficam bloqueadas. Quem já tem conta entra normalmente.' : 'Novas contas podem se cadastrar.',
    },
    {
      id: 'limites',
      label: 'Limites de acesso',
      on: s.lowerLimits ? 'Reduzidos' : 'Normais',
      off: 'Normais',
      changed: on && s.lowerLimits,
      detail:
        on && s.lowerLimits
          ? `${ATTACK_LIMITS.requestsPerMinute} requisições/min e ${ATTACK_LIMITS.loginAttempts} tentativas de login por IP.`
          : `${NORMAL_LIMITS.requestsPerMinute} requisições/min e ${NORMAL_LIMITS.loginAttempts} tentativas de login por IP.`,
    },
    {
      id: 'antirobo',
      label: 'Verificação anti-robô',
      on: s.captcha ? 'Ligada' : 'Desligada',
      off: 'Desligada',
      changed: on && s.captcha,
      detail: on && s.captcha ? 'Desafio no login, cadastro e depósito para tráfego suspeito.' : 'Sem desafio extra para os jogadores.',
    },
  ].map((c) => ({ ...c, status: on ? c.on : c.off }))
}

/** Lista curta das defesas escolhidas (para confirmação e auditoria). */
export function attackDefenses(s: Pick<AttackModeState, 'lowerLimits' | 'closeSignups' | 'captcha'>) {
  const list: string[] = []
  if (s.lowerLimits) list.push('limites mais baixos')
  if (s.closeSignups) list.push('cadastro fechado')
  if (s.captcha) list.push('verificação anti-robô')
  return list
}

// ---------- Manutenção ----------

export const SITE_URL = 'https://x2win.bet.br'
export const MAINTENANCE_MESSAGE_MAX = 280

export function bypassUrl(token: string) {
  return `${SITE_URL}/?acesso=${encodeURIComponent(token)}`
}

/** Token novo do link de testes (não reaproveita o anterior). */
export function newBypassToken(random: () => number = Math.random) {
  let s = ''
  for (let i = 0; i < 10; i++) s += '0123456789abcdef'[Math.floor(random() * 16)]
  return `teste-${s}`
}

export function validateMaintenance(v: { message: string; returnAt: string | null }, now: number) {
  const errors: { message?: string; returnAt?: string } = {}
  if (!v.message.trim()) errors.message = 'Escreva o aviso que os jogadores vão ver.'
  else if (v.message.length > MAINTENANCE_MESSAGE_MAX) errors.message = `Use até ${MAINTENANCE_MESSAGE_MAX} caracteres.`
  if (v.returnAt) {
    const t = new Date(v.returnAt).getTime()
    if (Number.isNaN(t)) errors.returnAt = 'Data inválida.'
    else if (t <= now) errors.returnAt = 'A previsão de volta precisa ser no futuro.'
  }
  return errors
}

/**
 * Desliga o modo de ataque quando o tempo escolhido acabou. Roda no painel inteiro
 * (não só na tela de Modo de ataque). Retorna os minutos configurados quando
 * desligou agora, ou null. No servidor real, isto seria um job agendado.
 */
export function runAttackAutoOff(now: number = Date.now()): number | null {
  const cur = dbGet<AttackModeState>(SYSTEM_KEYS.attackMode, DEFAULT_ATTACK_MODE)
  if (!shouldAutoOff(cur, now)) return null
  const minutes = cur.autoOffMinutes
  dbSet<AttackModeState>(SYSTEM_KEYS.attackMode, (prev) => ({ ...prev, active: false, since: null, activatedBy: null }), DEFAULT_ATTACK_MODE)
  audit('desligar', 'Modo de ataque', `Desligado automaticamente após ${autoOffLabel(minutes)}`)
  return minutes
}
