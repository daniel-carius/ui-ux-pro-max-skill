// Dados de demonstração das telas de comunicação e cashback (Campanhas, parte 3).
// Determinísticos: mesma semente, mesmos dados. Datas relativas a NOW.
import { createRng } from '@/lib/random'
import { DAY, HOUR, MIN, NOW, iso } from './now'
import { seedPlayers } from './players'
import { seedDeposits } from './finance'
import { type Audience, type Channel, DEFAULT_AUDIENCE, describeAudience, estimateAudience, lastDepositMap } from '@/domain/campanhas3-audience'
import { DEFAULT_LEVELS_CONFIG, levelIndexForXp } from '@/domain/campanhas3-niveis'
import type { BellNotification, InboxMessage, NotifIcon, Popup, PopupFrequency, SitePage } from '@/domain/campanhas3-mensagens'
import type { Disparo } from '@/domain/campanhas3-disparos'

const A = (kind: Audience['kind'], p: Partial<Audience> = {}): Audience => ({ ...DEFAULT_AUDIENCE, kind, ...p })

const levelName = (n: number) => DEFAULT_LEVELS_CONFIG.levels[n - 1]?.name ?? String(n)

/** Tamanho do público com a base de demonstração (para os históricos baterem com a estimativa). */
function audienceSize(a: Audience, channel: Channel) {
  const players = seedPlayers()
  const ctx = {
    now: NOW.getTime(),
    lastDeposit: lastDepositMap(seedDeposits()),
    levelOf: (p: { xp: number }) => levelIndexForXp(DEFAULT_LEVELS_CONFIG.levels, p.xp) + 1,
  }
  return estimateAudience(players, a, ctx, channel).reachable
}

const at = (daysBack: number, hour: number, minute = 0) => {
  const d = new Date(NOW.getTime() - daysBack * DAY)
  d.setHours(hour, minute, 0, 0)
  return iso(d)
}

const TEAM = ['Camila Rocha', 'Daniel Carius', 'Rafael Lima', 'Beatriz Souza']

// ---------- Sino ----------

export function seedBellNotifications(): BellNotification[] {
  const rng = createRng(3301)
  const rows: [string, string, NotifIcon, { label: string; link: string } | null, Audience, number, number, BellNotification['status']][] = [
    ['Sexta de giros: 30 grátis', 'Deposite a partir de R$ 30 hoje e ganhe 30 giros no Fortune Tiger.', 'gift', { label: 'Quero meus giros', link: '/promocoes/sexta-de-giros' }, A('todos'), -1, 18, 'agendada'],
    ['Torneio Halloween começa amanhã', 'R$ 25 mil em prêmios para os 100 primeiros do ranking de slots.', 'trophy', { label: 'Ver regras', link: '/torneios/halloween' }, A('todos'), -5, 12, 'agendada'],
    ['Fim de semana em dobro começou', 'Todo XP vale 2x até domingo às 23:59. Suba de nível mais rápido.', 'zap', { label: 'Ver meu nível', link: '/perfil/nivel' }, A('todos'), 3, 9, 'enviada'],
    ['Seu cashback semanal caiu', 'O cashback da semana passada já está na sua carteira.', 'coins', { label: 'Ver carteira', link: '/carteira' }, A('depositou', { days: 7 }), 4, 10, 'enviada'],
    ['Novo jogo: Gates of Olympus 1000', 'Multiplicadores de até 1.000x. Jogue agora na aba Cassino.', 'flame', { label: 'Jogar agora', link: '/cassino/gates-of-olympus-1000' }, A('todos'), 6, 19, 'enviada'],
    ['Torneio de slots: R$ 10 mil', 'Aposte em slots selecionados e suba no ranking até domingo.', 'trophy', { label: 'Participar', link: '/torneios/slots-outubro' }, A('vip'), 8, 14, 'enviada'],
    ['Sentimos sua falta', 'Separamos 20 giros grátis para você voltar a jogar hoje.', 'gift', { label: 'Resgatar giros', link: '/promocoes/volta' }, A('inativos', { days: 14 }), 10, 11, 'enviada'],
    ['Cashback semanal creditado', 'Confira quanto voltou para a sua carteira nesta semana.', 'coins', null, A('depositou', { days: 7 }), 11, 10, 'enviada'],
    ['Bem-vindo à X2Win', 'Seu bônus de 100% no primeiro depósito está ativo por 7 dias.', 'party', { label: 'Depositar', link: '/deposito' }, A('novos'), 12, 15, 'enviada'],
    ['Teste interno de notificação', 'Mensagem de teste da equipe de marketing.', 'bell', null, A('ids', { ids: ['100231', '100238'] }), 13, 16, 'cancelada'],
    ['Manutenção programada às 04:00', 'O site fica fora do ar por até 20 minutos na madrugada de quinta.', 'megaphone', null, A('todos'), 15, 17, 'enviada'],
    ['Benefícios do seu nível', 'Do nível Platina em diante, seu saque entra na fila prioritária.', 'crown', { label: 'Ver benefícios', link: '/perfil/nivel' }, A('nivel', { level: 5 }), 18, 13, 'enviada'],
    ['Missão da semana', 'Aposte R$ 100 em slots e ganhe 50 giros grátis.', 'star', { label: 'Ver missões', link: '/missoes' }, A('todos'), 21, 9, 'enviada'],
    ['Brasileirão: odds turbinadas', 'Odds aumentadas em todos os jogos da rodada de hoje.', 'zap', { label: 'Apostar', link: '/esportes/brasileirao' }, A('todos'), 25, 16, 'enviada'],
    ['Saque prioritário liberado', 'Como VIP, seus saques passam na frente da fila.', 'crown', null, A('vip'), 30, 11, 'enviada'],
  ]
  return rows.map(([title, message, icon, cta, audience, daysBack, hour, status], i) => {
    const sendAt = at(daysBack, hour)
    const recipients = status === 'cancelada' ? audience.ids.length : audienceSize(audience, 'sino')
    const sent = status === 'enviada'
    const readRate = rng.float(0.32, 0.74, 3)
    const reads = sent ? Math.round(recipients * readRate) : 0
    return {
      id: `nt${String(i + 1).padStart(3, '0')}`,
      title,
      message,
      icon,
      cta,
      audience,
      audienceLabel: describeAudience(audience, levelName),
      recipients,
      reads,
      clicks: sent && cta ? Math.round(reads * rng.float(0.12, 0.38, 3)) : 0,
      createdAt: iso(new Date(new Date(sendAt).getTime() - rng.int(2, 72) * HOUR)),
      sendAt,
      status,
      createdBy: rng.pick(TEAM),
    }
  })
}

// ---------- Popups ----------

export function seedPopups(): Popup[] {
  const rng = createRng(4402)
  const rows: [string, string, [string, string], SitePage[], Audience, number, number, number | null, PopupFrequency, boolean][] = [
    ['Deposite 50 e ganhe o dobro', 'Bônus de 100% no primeiro depósito, até R$ 500. Rollover de 10x.', ['Depositar agora', '/deposito'], ['home', 'cassino', 'deposito'], A('sem_deposito'), 90, 40, null, 'por_sessao', true],
    ['Bem-vindo de volta!', 'Separamos 20 giros grátis no Fortune Tiger para você recomeçar.', ['Resgatar giros', '/promocoes/volta'], ['home'], A('inativos', { days: 14 }), 80, 20, null, 'uma_vez', true],
    ['Odds turbinadas no Brasileirão', 'Todos os jogos da rodada com odds aumentadas. Só hoje.', ['Ver jogos', '/esportes/brasileirao'], ['home', 'esportes'], A('todos'), 70, 6, -3, 'sempre', true],
    ['Torneio de Slots: R$ 10 mil', 'Aposte em slots selecionados e suba no ranking até domingo.', ['Participar', '/torneios/slots-outubro'], ['home', 'cassino'], A('todos'), 60, 5, -2, 'por_sessao', true],
    ['Cashback VIP de 12%', 'Jogadores VIP recebem até 12% da perda de volta toda segunda.', ['Saiba mais', '/vip'], ['home', 'perfil'], A('vip'), 85, 15, null, 'uma_vez', false],
    ['Black Friday X2Win', 'Bônus em dobro em todos os depósitos durante o fim de semana.', ['Ver ofertas', '/promocoes/black-friday'], ['home', 'promocoes'], A('todos'), 95, -45, -48, 'por_sessao', true],
    ['Promoção de setembro', 'Giros diários para quem depositou no mês.', ['Ver promoção', '/promocoes/setembro'], ['home', 'promocoes'], A('depositou', { days: 30 }), 50, 40, 9, 'por_sessao', true],
  ]
  // startBack/endBack: dias atrás (negativo = no futuro); endBack null = sem fim
  return rows.map(([title, text, [label, link], pages, audience, priority, startBack, endBack, frequency, active], i) => {
    const startAt = at(startBack, 0)
    const started = startBack > 0
    const views = started ? rng.int(800, 6400) : 0
    return {
      id: `pp${String(i + 1).padStart(3, '0')}`,
      title,
      image: null,
      text,
      button: { label, link },
      pages,
      audience,
      priority,
      startAt,
      endAt: endBack === null ? null : at(endBack, 23, 59),
      frequency,
      active,
      views,
      clicks: Math.round(views * rng.float(0.06, 0.16, 3)),
      createdAt: iso(new Date(new Date(startAt).getTime() - rng.int(1, 6) * DAY)),
      updatedAt: iso(new Date(NOW.getTime() - rng.int(1, 40) * DAY - rng.int(0, 600) * MIN)),
    }
  })
}

// ---------- Inbox ----------

export function seedInbox(): InboxMessage[] {
  const rng = createRng(5503)
  const rows: [string, string, Audience, number, number, InboxMessage['status'], number | null][] = [
    [
      'Torneio Halloween: regras e prêmios',
      'O Torneio Halloween vai de 28/10 a 02/11. Cada R$ 1 apostado nos slots participantes vale 1 ponto. Os 100 primeiros do ranking dividem R$ 25 mil em prêmios, pagos em saldo real sem rollover.',
      A('todos'),
      -6,
      10,
      'agendada',
      20,
    ],
    [
      'Seu extrato de cashback da semana',
      'Olá! O cashback da semana passada foi creditado na sua carteira. Ele tem rollover de 1x: aposte o valor uma vez para liberar o saque.',
      A('depositou', { days: 7 }),
      4,
      10,
      'enviada',
      30,
    ],
    [
      'Termos de uso atualizados',
      'Atualizamos os Termos de uso e a Política de privacidade. As mudanças valem a partir de hoje. Leia a versão completa em Textos legais, no rodapé do site.',
      A('todos'),
      9,
      14,
      'enviada',
      null,
    ],
    [
      'Convite VIP: gerente de conta exclusivo',
      'Você agora tem um gerente de conta dedicado, saque prioritário e cashback de até 12%. Responda esta mensagem para falar com a equipe VIP.',
      A('vip'),
      12,
      11,
      'enviada',
      null,
    ],
    [
      'Bem-vindo à X2Win',
      'Que bom ter você aqui! Seu bônus de 100% no primeiro depósito vale por 7 dias. Configure seus limites de depósito em Perfil › Jogo responsável.',
      A('novos'),
      2,
      9,
      'enviada',
      7,
    ],
    [
      'Reative sua conta e ganhe 20 giros',
      'Faz tempo que você não aparece. Entre hoje e ganhe 20 giros grátis no Fortune Tiger, sem precisar depositar.',
      A('inativos', { days: 14 }),
      10,
      12,
      'enviada',
      14,
    ],
    [
      'Resultado do Torneio de Setembro',
      'O Torneio de Setembro terminou! Os prêmios já foram creditados aos 50 primeiros. Confira o ranking completo na página de torneios.',
      A('todos'),
      16,
      18,
      'enviada',
      null,
    ],
    [
      'Jogo responsável: conheça seus limites',
      'Você pode definir limites diários, semanais e mensais de depósito, ou pausar sua conta a qualquer momento, em Perfil › Jogo responsável (Lei 14.790/2023).',
      A('todos'),
      28,
      10,
      'enviada',
      null,
    ],
  ]
  return rows.map(([subject, body, audience, daysBack, hour, status, expires], i) => {
    const sendAt = at(daysBack, hour)
    const recipients = audienceSize(audience, 'inbox')
    return {
      id: `ib${String(i + 1).padStart(3, '0')}`,
      subject,
      body,
      audience,
      audienceLabel: describeAudience(audience, levelName),
      recipients,
      reads: status === 'enviada' ? Math.round(recipients * rng.float(0.28, 0.66, 3)) : 0,
      sendAt,
      status,
      createdAt: iso(new Date(new Date(sendAt).getTime() - rng.int(2, 48) * HOUR)),
      createdBy: rng.pick(TEAM),
      expiresAt: expires === null ? null : iso(new Date(new Date(sendAt).getTime() + expires * DAY)),
    }
  })
}

// ---------- Disparos ----------

export function seedDisparos(): Disparo[] {
  const rng = createRng(6604)
  const rows: [string, string, string, Audience, number, number, Disparo['status']][] = [
    ['Halloween · convite', 'Torneio Halloween: R$ 25 mil em prêmios', 'Os 100 primeiros do ranking levam prêmio.', A('todos'), -4, 18, 'agendado'],
    ['Newsletter semanal · out/1', '{{primeiro_nome}}, os jogos mais quentes da semana', 'Gates of Olympus 1000, Aviator e mais.', A('todos'), 2, 10, 'enviado'],
    ['Reativação 14 dias', 'Sentimos sua falta: 20 giros grátis esperando', 'Volte hoje e ganhe giros sem depositar.', A('inativos', { days: 14 }), 5, 11, 'enviado'],
    ['Cashback semanal · aviso', 'Seu cashback da semana já está na carteira', 'Confira quanto voltou para você.', A('depositou', { days: 7 }), 4, 10, 'enviado'],
    ['VIP · cashback 12%', 'Novo benefício VIP: cashback de até 12%', 'Toda segunda, parte da perda volta para você.', A('vip'), 9, 15, 'enviado'],
    ['Sem depósito · bônus 100%', 'Seu bônus de 100% ainda está disponível', 'Deposite a partir de R$ 10 e ganhe o dobro.', A('sem_deposito'), 7, 19, 'enviado'],
    ['Newsletter semanal · set/4', '{{primeiro_nome}}, o que rolou na X2Win esta semana', 'Ganhadores, lançamentos e torneios.', A('todos'), 9, 10, 'enviado'],
    ['Teste de layout', 'Teste interno — não enviar', 'Rascunho de layout.', A('ids', { ids: ['100231'] }), 11, 14, 'cancelado'],
    ['Nível Platina+ · saque prioritário', 'Seu saque agora entra na fila prioritária', 'Benefício para Platina em diante.', A('nivel', { level: 5 }), 14, 16, 'enviado'],
    ['Newsletter semanal · set/3', 'Torneio de setembro: últimos dias', 'Corra para o topo do ranking.', A('todos'), 16, 10, 'enviado'],
    ['Reativação 30 dias', '{{primeiro_nome}}, tem R$ 20 de bônus para você', 'Bônus com rollover de 10x, válido por 3 dias.', A('inativos', { days: 30 }), 20, 11, 'enviado'],
    ['Newsletter semanal · set/2', 'Lançamento: Fortune Rabbit chegou', 'Jogue com 30 giros grátis no lançamento.', A('todos'), 23, 10, 'enviado'],
  ]
  return rows.map(([name, subject, preheader, audience, daysBack, hour, status], i) => {
    const sendAt = at(daysBack, hour)
    return {
      id: `dp${String(i + 1).padStart(3, '0')}`,
      name,
      channel: 'email',
      audience,
      audienceLabel: describeAudience(audience, levelName),
      recipients: status === 'cancelado' ? audience.ids.length || 0 : audienceSize(audience, 'email'),
      headline: subject,
      email: {
        subject,
        preheader,
        body: `Olá, {{primeiro_nome}}!\n\n${preheader}\n\nNos vemos na X2Win.`,
        ctaLabel: 'Acessar a X2Win',
        ctaLink: '/promocoes',
      },
      sendAt,
      createdAt: iso(new Date(new Date(sendAt).getTime() - rng.int(3, 96) * HOUR)),
      createdBy: rng.pick(TEAM),
      status,
    }
  })
}

// ---------- Cashback ----------

export interface CashbackCycle {
  id: string
  /** data do crédito */
  paidAt: string
  label: string
  players: number
  cashback: number
  rakeback: number
}

/** Últimos 8 ciclos semanais pagos (crédito às segundas). */
export function cashbackCycles(): CashbackCycle[] {
  const rng = createRng(7705)
  const out: CashbackCycle[] = []
  const lastMonday = new Date(NOW)
  lastMonday.setHours(10, 0, 0, 0)
  while (lastMonday.getDay() !== 1 || lastMonday.getTime() > NOW.getTime()) lastMonday.setTime(lastMonday.getTime() - DAY)
  for (let i = 7; i >= 0; i--) {
    const paid = new Date(lastMonday.getTime() - i * 7 * DAY)
    const players = rng.int(28, 46)
    out.push({
      id: `cy${i}`,
      paidAt: iso(paid),
      label: paid.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      players,
      cashback: Math.round(players * rng.float(48, 82) * 100) / 100,
      rakeback: Math.round(players * rng.float(16, 30) * 100) / 100,
    })
  }
  return out
}
