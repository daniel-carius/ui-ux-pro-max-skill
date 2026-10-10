// Segurança: sinais de identidade vistos fora do cadastro (login, PIX, recuperação
// de conta, verificação por SMS) e bloqueios feitos pelo anti-fraude.
// Os dados do cadastro (IP, e-mail, CPF, celular, padrinho) vêm de seedPlayers();
// aqui ficam só os sinais extras que ligam contas entre si (IP e celular fictícios, ver ./demo).
import { createRng } from '@/lib/random'
import { demoIp, demoPhone, demoRecords } from './demo'
import { DAY, HOUR, NOW, iso } from './now'
import { demoLedger, seedAffiliates, seedPlayers, type Player, type PlayerStatus } from './players'

export const SEGURANCA_KEYS = {
  /** bloqueios ativos (IPs e redes banidas) */
  blocks: 'seguranca.bloqueios',
} as const

/** Como duas contas se ligam */
export type LinkKind = 'ip' | 'padrinho' | 'email' | 'cpf' | 'celular'
/** Sinais que vêm de dados (o padrinho vem do campo referrerId) */
export type SignalKind = Exclude<LinkKind, 'padrinho'>
export type SignalSource = 'cadastro' | 'login' | 'pix' | 'recuperacao' | 'verificacao'

export const SIGNAL_SOURCE_LABEL: Record<SignalSource, string> = {
  cadastro: 'cadastro',
  login: 'login',
  pix: 'PIX',
  recuperacao: 'e-mail de recuperação',
  verificacao: 'verificação por SMS',
}

export interface IdentitySignal {
  playerId: string
  kind: SignalKind
  value: string
  source: SignalSource
  at: string
}

export type BlockKind = 'ip' | 'rede'

export interface Block {
  id: string
  kind: BlockKind
  /** IP bloqueado ou id da rede banida */
  value: string
  reason: string
  /** contas atingidas pelo bloqueio */
  accounts: string[]
  /** status das contas antes do banimento (para desfazer) */
  previousStatuses: Record<string, PlayerStatus>
  createdAt: string
  createdBy: string
}

function randomIp(rng: ReturnType<typeof createRng>) {
  return demoIp(`${rng.pick([138, 143, 152, 168, 177, 186, 187, 189, 191, 200, 201])}.${rng.int(1, 254)}.${rng.int(1, 254)}.${rng.int(1, 254)}`)
}

/** variações de um e-mail do Gmail que chegam na mesma caixa (pontos e +apelido) */
function gmailAlias(email: string, n: number) {
  const [user, domain] = email.split('@')
  const plain = user.replace(/\./g, '')
  if (n % 2 === 0) return `${plain}+${['bonus', 'vip', 'promo', 'x2'][n % 4]}@${domain}`
  return `${plain.slice(0, 2)}.${plain.slice(2)}@${domain}`
}

interface Built {
  signals: IdentitySignal[]
  bonus: Record<string, number>
  rings: string[][]
}

let _built: Built | null = null

function build(): Built {
  const rng = createRng(9090)
  const players = seedPlayers()
  const affiliates = seedAffiliates()
  const now = NOW.getTime()
  const used = new Set<string>()
  const signals: IdentitySignal[] = []
  const rings: string[][] = []

  const at = (p: Player, maxDays = 20) => {
    const created = new Date(p.createdAt).getTime()
    const span = Math.max(HOUR, Math.min(maxDays * DAY, now - created))
    return iso(new Date(created + rng.int(1, Math.max(1, Math.floor(span / HOUR))) * HOUR))
  }
  const add = (p: Player, kind: SignalKind, value: string, source: SignalSource) =>
    signals.push({ playerId: p.id, kind, value, source, at: at(p) })

  const pool = (filter: (p: Player) => boolean) => players.filter((p, i) => i >= 34 && !used.has(p.id) && filter(p))
  const take = (list: Player[], n: number) => {
    const chosen = rng.sample(list, Math.min(n, list.length))
    chosen.forEach((p) => used.add(p.id))
    return chosen
  }
  const isRecent = (p: Player, days = 30) => now - new Date(p.createdAt).getTime() < days * DAY

  // Rede A: "fazenda de bônus" — contas novas, de bônus maior que o depositado, sacando para o CPF de uma só pessoa
  const received = demoLedger().bonusReceived
  const farm = (p: Player) => isRecent(p) && p.status === 'ativo' && p.depositsCount > 0 && p.depositsCount <= 4
  const bonusFarm = pool((p) => farm(p) && (received[p.id] ?? 0) >= Math.max(50, p.totalDeposited))
  const ringA = take(bonusFarm.length >= 3 ? bonusFarm : pool(farm), 5)
  if (ringA.length >= 3) {
    const [lead, ...rest] = ringA
    const ip = randomIp(rng)
    ringA.forEach((p) => add(p, 'ip', ip, 'login'))
    rest.forEach((p) => add(p, 'cpf', lead.cpf, 'pix'))
    rest.slice(0, 2).forEach((p) => add(p, 'celular', lead.phone, 'verificacao'))
    rings.push(ringA.map((p) => p.id))
  }

  // Rede B: o mesmo Gmail com pontos e +apelido em várias contas
  const gmailLead = take(pool((p) => /@gmail\.com(\.invalid)?$/.test(p.email) && p.status === 'ativo'), 1)[0]
  if (gmailLead) {
    const others = take(pool((p) => p.status === 'ativo' && isRecent(p, 120)), 3)
    const phone = demoPhone(`${rng.pick([11, 21, 31, 71, 81])}9${rng.digits(8)}`)
    others.forEach((p, i) => add(p, 'email', gmailAlias(gmailLead.email, i), 'recuperacao'))
    ;[gmailLead, ...others.slice(0, 2)].forEach((p) => add(p, 'celular', phone, 'verificacao'))
    rings.push([gmailLead.id, ...others.map((p) => p.id)])
  }

  // Rede C: afiliado indicando a si mesmo (contas do padrinho no mesmo IP)
  const byRef = new Map<string, Player[]>()
  for (const p of players) {
    if (p.referrerId && !used.has(p.id)) byRef.set(p.referrerId, [...(byRef.get(p.referrerId) ?? []), p])
  }
  const refGroup = [...byRef.entries()].filter(([, list]) => list.length >= 3).sort((a, b) => b[1].length - a[1].length)[0]
  if (refGroup) {
    const [affId, list] = refGroup
    const aff = affiliates.find((a) => a.id === affId)
    const affPlayer = aff ? players.find((p) => p.id === aff.playerId) : undefined
    const members = take(list, 3)
    const ip = randomIp(rng)
    members.forEach((p) => add(p, 'ip', ip, 'login'))
    if (affPlayer) {
      add(affPlayer, 'ip', ip, 'login')
      used.add(affPlayer.id)
    }
    rings.push([...(affPlayer ? [affPlayer.id] : []), ...members.map((p) => p.id)])
  }

  // Rede D: dois cadastros pagando PIX com o mesmo CPF
  const ringD = take(pool((p) => p.depositsCount > 0 && p.status === 'ativo'), 2)
  if (ringD.length === 2) {
    add(ringD[1], 'cpf', ringD[0].cpf, 'pix')
    rings.push(ringD.map((p) => p.id))
  }

  // Rede E: mesmo celular verificado em três contas, criadas perto uma da outra
  const ringE = take(pool((p) => isRecent(p, 60)), 3)
  if (ringE.length === 3) {
    const phone = ringE[0].phone
    ringE.slice(1).forEach((p) => add(p, 'celular', phone, 'verificacao'))
    const ip = randomIp(rng)
    ringE.slice(0, 2).forEach((p) => add(p, 'ip', ip, 'login'))
    rings.push(ringE.map((p) => p.id))
  }

  // Rede F: mesmo IP de login em duas contas (casa/família — risco baixo)
  const ringF = take(pool((p) => p.status === 'ativo'), 2)
  if (ringF.length === 2) {
    const ip = randomIp(rng)
    ringF.forEach((p) => add(p, 'ip', ip, 'login'))
    rings.push(ringF.map((p) => p.id))
  }

  // Bônus recebido (boas-vindas e outros bônus, giros grátis e cashback): o do livro-razão de cada conta
  const bonus = { ...demoLedger().bonusReceived }

  return { signals, bonus, rings }
}

/** Sinais extras (login, PIX, recuperação, SMS) que ligam contas. */
export function seedSignals(): IdentitySignal[] {
  if (!_built) _built = build()
  return _built.signals
}

/** Total de bônus recebido por jogador desde o cadastro. */
export function seedBonusReceived(): Record<string, number> {
  if (!_built) _built = build()
  return _built.bonus
}

/** Bloqueios que já existiam antes desta sessão. */
export function seedBlocks(): Block[] {
  const players = seedPlayers()
  // primeiro IP compartilhado do cadastro (a mesma conta de casa/lan house)
  const counts = new Map<string, string[]>()
  for (const p of players) counts.set(p.ip, [...(counts.get(p.ip) ?? []), p.id])
  const shared = [...counts.entries()].filter(([, ids]) => ids.length >= 2).sort((a, b) => b[1].length - a[1].length)
  const out: Block[] = [
    {
      id: 'bl-001',
      kind: 'ip',
      value: '45.160.12.34',
      reason: 'Tráfego de robô: 12 mil tentativas de login em 10 minutos',
      accounts: [],
      previousStatuses: {},
      createdAt: iso(new Date(NOW.getTime() - 9 * DAY - 3 * HOUR)),
      createdBy: 'Daniel Carius',
    },
    {
      id: 'bl-002',
      kind: 'ip',
      value: '185.220.101.7',
      reason: 'Saída de rede Tor usada para criar contas em série',
      accounts: [],
      previousStatuses: {},
      createdAt: iso(new Date(NOW.getTime() - 4 * DAY - 7 * HOUR)),
      createdBy: 'Rafael Lima',
    },
  ]
  if (shared[0]) {
    out.push({
      id: 'bl-003',
      kind: 'ip',
      value: shared[0][0],
      reason: 'Várias contas com bônus de boas-vindas no mesmo IP',
      accounts: shared[0][1],
      previousStatuses: {},
      createdAt: iso(new Date(NOW.getTime() - 2 * DAY - 5 * HOUR)),
      createdBy: 'Beatriz Souza',
    })
  }
  return out
}

// modo API: bloqueios vêm do servidor; sem nada gravado, lista vazia
demoRecords(seedBlocks)
