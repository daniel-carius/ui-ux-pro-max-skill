// 30 eventos com template de webhook (um por tipo de evento) e dados de exemplo.
import { createRng } from '@/lib/random'
import { defaultTemplateBody, type TemplateEventDef, type TemplateField, type WebhookTemplate } from '@/domain/campanhas-templates'
import { DAY, HOUR, NOW, iso } from './now'
import { demoRecords } from './demo'

export const TEMPLATE_KEY = 'campanhas.templates'

const f = (key: string, label: string, sample: TemplateField['sample'], type: TemplateField['type'] = 'texto'): TemplateField => ({ key, label, sample, type })

const EVENT = [f('event.id', 'ID do evento', 'evt_8f2k1x9d'), f('event.at', 'Data e hora do evento', '2026-10-09T14:32:00-03:00', 'data')]
const PLAYER = [f('player.id', 'ID do jogador', '100231'), f('player.name', 'Nome do jogador', 'Ana Souza'), f('player.email', 'E-mail do jogador', 'ana.souza@exemplo.com')]
const DEPOSIT = [f('deposit.id', 'ID do depósito', 'DP88213'), f('deposit.amount', 'Valor do depósito', 50, 'numero'), f('deposit.method', 'Forma de pagamento', 'PIX')]
const WITHDRAWAL = [f('withdrawal.id', 'ID do saque', 'SQ73001'), f('withdrawal.amount', 'Valor do saque', 150, 'numero')]
const BONUS = [f('bonus.id', 'ID do bônus', 'BN55102'), f('bonus.amount', 'Valor do bônus', 50, 'numero'), f('bonus.campaign', 'Campanha', 'Deposite 50 e ganhe o dobro')]

const base = (...extra: TemplateField[]) => [...EVENT, ...PLAYER, ...extra]

export const TEMPLATE_EVENTS: TemplateEventDef[] = [
  { key: 'cadastro.concluido', label: 'Cadastro concluído', category: 'Conta', description: 'Jogador terminou o cadastro e confirmou os dados.', fields: base(f('player.origin', 'Origem', 'Afiliado'), f('affiliate.code', 'Código do afiliado', 'PARCEIRO10')) },
  { key: 'deposito.primeiro', label: 'Primeiro depósito', category: 'Depósito', description: 'Primeiro PIX pago do jogador (FTD).', fields: base(...DEPOSIT, f('affiliate.code', 'Código do afiliado', 'PARCEIRO10')) },
  { key: 'deposito.confirmado', label: 'Depósito confirmado', category: 'Depósito', description: 'Qualquer PIX de depósito pago.', fields: base(...DEPOSIT, f('deposit.count', 'Nº do depósito do jogador', 3, 'numero')) },
  { key: 'deposito.expirado', label: 'Depósito expirado', category: 'Depósito', description: 'PIX gerado e não pago no prazo.', fields: base(...DEPOSIT, f('deposit.expired_after_min', 'Expirou após (min)', 30, 'numero')) },
  { key: 'saque.solicitado', label: 'Saque solicitado', category: 'Saque', description: 'Jogador pediu um saque.', fields: base(...WITHDRAWAL, f('withdrawal.pix_key_type', 'Tipo de chave PIX', 'CPF')) },
  { key: 'saque.pago', label: 'Saque pago', category: 'Saque', description: 'Saque aprovado (aviso para o sistema que paga).', fields: base(...WITHDRAWAL, f('withdrawal.fee', 'Taxa', 0, 'numero'), f('withdrawal.approved_by', 'Aprovado por', 'Equipe financeira')) },
  { key: 'saque.rejeitado', label: 'Saque rejeitado', category: 'Saque', description: 'Saque recusado pela equipe.', fields: base(...WITHDRAWAL, f('withdrawal.reason', 'Motivo', 'Rollover não cumprido')) },
  { key: 'saque.expirado', label: 'Saque expirado', category: 'Saque', description: 'Saque não decidido dentro do prazo.', fields: base(...WITHDRAWAL, f('withdrawal.expired_after_h', 'Expirou após (h)', 72, 'numero')) },
  { key: 'saque.cancelado', label: 'Saque cancelado', category: 'Saque', description: 'Jogador cancelou o pedido de saque.', fields: base(...WITHDRAWAL) },
  { key: 'aposta.ganho_alto', label: 'Aposta com ganho alto', category: 'Apostas', description: 'Ganho acima do limite de alerta numa rodada.', fields: base(f('bet.id', 'ID da aposta', 'BT9910022'), f('bet.game', 'Jogo', 'Fortune Tiger'), f('bet.amount', 'Valor apostado', 2, 'numero'), f('bet.payout', 'Valor ganho', 1250, 'numero'), f('bet.multiplier', 'Multiplicador', 625, 'numero')) },
  { key: 'bonus.concedido', label: 'Bônus concedido', category: 'Bônus', description: 'Bônus creditado no saldo bônus.', fields: base(...BONUS, f('bonus.rollover_x', 'Rollover (x)', 10, 'numero'), f('bonus.expires_at', 'Expira em', '2026-10-16T23:59:59-03:00', 'data')) },
  { key: 'bonus.convertido', label: 'Bônus convertido', category: 'Bônus', description: 'Bônus cumpriu o rollover e virou saldo real.', fields: base(...BONUS, f('bonus.converted_amount', 'Valor convertido', 50, 'numero')) },
  { key: 'bonus.expirado', label: 'Bônus expirado', category: 'Bônus', description: 'Bônus venceu antes de cumprir o rollover.', fields: base(...BONUS, f('bonus.wagered', 'Apostado até expirar', 240, 'numero')) },
  { key: 'freespins.concedidos', label: 'Free spins concedidos', category: 'Bônus', description: 'Giros grátis creditados ao jogador.', fields: base(f('freespins.campaign', 'Campanha', '100 giros no 2º depósito'), f('freespins.game', 'Jogo', 'Fortune Tiger'), f('freespins.count', 'Giros', 100, 'numero'), f('freespins.value', 'Valor por giro', 0.4, 'numero'), f('freespins.expires_at', 'Expira em', '2026-10-16T23:59:59-03:00', 'data')) },
  { key: 'nivel.alcancado', label: 'Nível alcançado', category: 'Engajamento', description: 'Jogador subiu de nível.', fields: base(f('level.number', 'Nível', 12, 'numero'), f('level.name', 'Nome do nível', 'Ouro II'), f('level.xp', 'XP total', 18400, 'numero')) },
  { key: 'missao.concluida', label: 'Missão concluída', category: 'Engajamento', description: 'Jogador cumpriu uma missão.', fields: base(f('mission.id', 'ID da missão', 'MS204'), f('mission.name', 'Missão', 'Aposte R$ 200 em slots'), f('mission.reward', 'Recompensa', 15, 'numero')) },
  { key: 'torneio.iniciado', label: 'Torneio iniciado', category: 'Engajamento', description: 'Um torneio começou (um envio por inscrito).', fields: base(f('tournament.id', 'ID do torneio', 'TN31'), f('tournament.name', 'Torneio', 'Fortune Week'), f('tournament.prize_pool', 'Premiação', 25000, 'numero'), f('tournament.ends_at', 'Termina em', '2026-10-21T23:59:59-03:00', 'data')) },
  { key: 'torneio.encerrado', label: 'Torneio encerrado', category: 'Engajamento', description: 'Torneio terminou com a posição do jogador.', fields: base(f('tournament.id', 'ID do torneio', 'TN31'), f('tournament.name', 'Torneio', 'Fortune Week'), f('tournament.position', 'Posição', 3, 'numero'), f('tournament.prize', 'Prêmio', 2500, 'numero')) },
  { key: 'cupom.resgatado', label: 'Cupom resgatado', category: 'Bônus', description: 'Jogador usou um cupom.', fields: base(f('coupon.code', 'Código', 'SEXTOU30'), f('coupon.value', 'Valor', 30, 'numero')) },
  { key: 'kyc.aprovado', label: 'KYC aprovado', category: 'Conta', description: 'Documentos do jogador aprovados.', fields: base(f('kyc.level', 'Nível de verificação', 'Completo'), f('kyc.reviewed_by', 'Revisado por', 'Equipe de risco')) },
  { key: 'kyc.reprovado', label: 'KYC reprovado', category: 'Conta', description: 'Documentos recusados, com o motivo.', fields: base(f('kyc.reason', 'Motivo', 'Documento ilegível')) },
  { key: 'jogador.autoexclusao', label: 'Autoexclusão', category: 'Jogo responsável', description: 'Jogador pediu autoexclusão. Pare toda comunicação de marketing.', fields: base(f('rg.period_days', 'Período (dias)', 90, 'numero'), f('rg.until', 'Até', '2027-01-07T23:59:59-03:00', 'data')) },
  { key: 'limite.deposito_atingido', label: 'Limite de depósito atingido', category: 'Jogo responsável', description: 'Jogador chegou ao limite de depósito que definiu.', fields: base(f('rg.limit_amount', 'Limite', 500, 'numero'), f('rg.limit_period', 'Período do limite', 'semanal'), f('rg.deposited', 'Depositado no período', 500, 'numero')) },
  { key: 'login.novo_dispositivo', label: 'Login em novo dispositivo', category: 'Segurança', description: 'Acesso de um aparelho nunca usado pelo jogador.', fields: base(f('device.name', 'Aparelho', 'iPhone 15 · Safari'), f('device.city', 'Cidade aproximada', 'São Paulo'), f('device.ip_masked', 'IP (mascarado)', '189.45.***.***')) },
  { key: 'senha.alterada', label: 'Senha alterada', category: 'Segurança', description: 'Senha trocada pelo jogador ou por redefinição.', fields: base(f('security.channel', 'Canal', 'E-mail de redefinição')) },
  { key: 'indicacao.valida', label: 'Indicação válida', category: 'Engajamento', description: 'Indicado cumpriu a regra e contou para o padrinho.', fields: base(f('referral.referred_id', 'ID do indicado', '100987'), f('referral.valid_count', 'Indicações válidas', 5, 'numero')) },
  { key: 'bau.aberto', label: 'Baú aberto', category: 'Engajamento', description: 'Jogador abriu um baú de indicação.', fields: base(f('chest.level', 'Baú', 2, 'numero'), f('chest.prize', 'Prêmio', 'R$ 20,00 em bônus'), f('chest.value', 'Valor', 20, 'numero')) },
  { key: 'cashback.creditado', label: 'Cashback creditado', category: 'Bônus', description: 'Cashback do período creditado.', fields: base(f('cashback.amount', 'Valor', 42.5, 'numero'), f('cashback.pct', 'Percentual', 10, 'numero'), f('cashback.period', 'Período', 'semanal')) },
  { key: 'rakeback.creditado', label: 'Rakeback creditado', category: 'Bônus', description: 'Rakeback sobre apostas creditado.', fields: base(f('rakeback.amount', 'Valor', 12.8, 'numero'), f('rakeback.pct', 'Percentual', 0.5, 'numero')) },
  { key: 'jogador.inativo_7d', label: 'Jogador inativo há 7 dias', category: 'Engajamento', description: 'Sem acessar há 7 dias. Bom gatilho para reativação.', fields: base(f('player.last_access', 'Último acesso', '2026-10-02T21:10:00-03:00', 'data'), f('player.balance_real', 'Saldo real', 35.2, 'numero'), f('player.balance_bonus', 'Saldo bônus', 0, 'numero')) },
]

export const TEMPLATE_EVENT_BY_KEY = new Map(TEMPLATE_EVENTS.map((e) => [e.key, e]))

const INACTIVE = new Set(['senha.alterada', 'rakeback.creditado', 'torneio.iniciado', 'login.novo_dispositivo', 'jogador.inativo_7d', 'deposito.expirado'])
const EDITORS = ['Daniel Carius', 'Marina Duarte', 'Rafael Monteiro']

export function seedTemplates(): WebhookTemplate[] {
  const rng = createRng(3030)
  return TEMPLATE_EVENTS.map((e, i) => {
    const tested = rng.bool(0.55)
    return {
      id: `tp${String(i + 1).padStart(2, '0')}`,
      event: e.key,
      active: !INACTIVE.has(e.key),
      body: defaultTemplateBody(e),
      updatedAt: iso(new Date(NOW.getTime() - rng.int(3, 180) * DAY)),
      updatedBy: rng.pick(EDITORS),
      lastTest: tested
        ? { at: iso(new Date(NOW.getTime() - rng.int(1, 600) * HOUR)), ok: rng.bool(0.9), httpStatus: 200, durationMs: rng.int(90, 520), destinations: 0 }
        : null,
    }
  }).map((t) => (t.lastTest && !t.lastTest.ok ? { ...t, lastTest: { ...t.lastTest, httpStatus: 502 } } : t))
}

// modo API: registros só do servidor (sem nada gravado, lista vazia; o gerador não roda)
demoRecords(seedTemplates)
