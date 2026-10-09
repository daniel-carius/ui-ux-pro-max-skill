// Templates de e-mail transacional (texto padrão da plataforma).
import type { EmailTemplate } from '@/domain/config2-email'
import { DAY, NOW, iso } from './now'

export const EMAIL_KEYS = {
  templates: 'config.templates-email',
  lastTest: 'config.integracoes.ultimo-teste',
} as const

type Def = Omit<EmailTemplate, 'updatedAt' | 'updatedBy' | 'enabled'> & { enabled?: boolean }

const DEFS: Def[] = [
  {
    id: 'redefinicao-senha',
    name: 'Redefinição de senha',
    category: 'conta',
    trigger: 'Quando o jogador pede para redefinir a senha',
    subject: 'Redefina sua senha da {{site}}',
    body: 'Olá, {{nome}}.\n\nRecebemos um pedido para redefinir a senha da sua conta. Clique no botão abaixo para criar uma senha nova.\n\n[Redefinir senha]({{link_redefinicao}})\n\nO link vale por {{validade}}. Se você não pediu, ignore este e-mail: sua senha continua a mesma.',
    locked: true,
    variables: ['nome', 'email', 'site', 'link_redefinicao', 'validade'],
    required: ['link_redefinicao'],
  },
  {
    id: 'boas-vindas',
    name: 'Boas-vindas',
    category: 'conta',
    trigger: 'Logo depois do cadastro concluído',
    subject: '{{nome}}, sua conta na {{site}} está pronta',
    body: 'Olá, {{nome}}! Que bom ter você com a gente.\n\nSeu primeiro depósito ganha **{{bonus}}**. É só entrar e escolher o valor.\n\n[Fazer meu primeiro depósito]({{link_site}})\n\nJogue com responsabilidade. Você pode definir limites de depósito a qualquer momento no seu perfil.',
    locked: false,
    variables: ['nome', 'email', 'site', 'link_site', 'bonus'],
    required: [],
  },
  {
    id: 'convite-equipe',
    name: 'Convite para a equipe',
    category: 'equipe',
    trigger: 'Quando alguém é convidado em Configurações › Equipe',
    subject: '{{convidado_por}} convidou você para o painel da {{site}}',
    body: 'Olá!\n\n{{convidado_por}} convidou você para acessar o painel da {{site}} com o cargo **{{cargo}}**.\n\n[Aceitar convite]({{link_convite}})\n\nO convite vale por {{validade}}. No primeiro acesso você cria a senha e ativa a verificação em duas etapas.',
    locked: true,
    variables: ['email', 'site', 'link_convite', 'cargo', 'convidado_por', 'validade'],
    required: ['link_convite'],
  },
  {
    id: 'verificacao-email',
    name: 'Verificação de e-mail',
    category: 'conta',
    trigger: 'No cadastro e quando o jogador troca o e-mail',
    subject: 'Confirme seu e-mail na {{site}}',
    body: 'Olá, {{nome}}.\n\nConfirme que {{email}} é seu para liberar depósitos e saques.\n\n[Confirmar e-mail]({{link_verificacao}})\n\nO link vale por {{validade}}.',
    locked: true,
    variables: ['nome', 'email', 'site', 'link_verificacao', 'validade'],
    required: ['link_verificacao'],
  },
  {
    id: 'codigo-2fa',
    name: 'Código 2FA',
    category: 'conta',
    trigger: 'No login e em ações sensíveis, quando o 2FA é por e-mail',
    subject: 'Seu código de acesso: {{codigo}}',
    body: 'Olá, {{nome}}. Use o código abaixo para continuar:\n\n{{codigo}}\n\nEle vale por {{validade}}. Nunca compartilhe este código: a equipe da {{site}} não pede códigos por telefone ou mensagem.',
    locked: true,
    variables: ['nome', 'site', 'codigo', 'validade'],
    required: ['codigo'],
  },
  {
    id: 'deposito-confirmado',
    name: 'Depósito confirmado',
    category: 'financeiro',
    trigger: 'Quando o gateway confirma o PIX',
    subject: 'Depósito de {{valor}} confirmado',
    body: 'Olá, {{nome}}.\n\nSeu depósito de **{{valor}}** caiu na conta. Saldo atual: {{saldo}}.\n\nTransação {{id_transacao}} · {{data}}\n\n[Ir para o site]({{link_site}})',
    locked: false,
    variables: ['nome', 'site', 'valor', 'saldo', 'id_transacao', 'data', 'link_site'],
    required: ['valor'],
  },
  {
    id: 'saque-solicitado',
    name: 'Saque solicitado',
    category: 'financeiro',
    trigger: 'Quando o jogador pede um saque',
    subject: 'Recebemos seu pedido de saque de {{valor}}',
    body: 'Olá, {{nome}}.\n\nSeu pedido de saque de **{{valor}}** está em análise. Avisamos por e-mail assim que for pago.\n\nPedido {{id_transacao}} · {{data}}',
    locked: false,
    variables: ['nome', 'site', 'valor', 'id_transacao', 'data'],
    required: ['valor'],
  },
  {
    id: 'saque-pago',
    name: 'Saque pago',
    category: 'financeiro',
    trigger: 'Quando o saque é aprovado e o PIX é enviado',
    subject: 'Seu saque de {{valor}} foi pago',
    body: 'Olá, {{nome}}.\n\nO PIX de **{{valor}}** foi enviado para a sua chave. Ele costuma cair em poucos minutos.\n\nPedido {{id_transacao}} · {{data}}',
    locked: false,
    variables: ['nome', 'site', 'valor', 'id_transacao', 'data'],
    required: ['valor'],
  },
  {
    id: 'saque-recusado',
    name: 'Saque recusado',
    category: 'financeiro',
    trigger: 'Quando o saque é recusado na fila',
    subject: 'Seu saque de {{valor}} não foi aprovado',
    body: 'Olá, {{nome}}.\n\nNão conseguimos aprovar o saque de **{{valor}}**. Motivo: {{motivo}}.\n\nO valor voltou para o seu saldo. Se tiver dúvidas, fale com o suporte.\n\nPedido {{id_transacao}} · {{data}}',
    locked: false,
    variables: ['nome', 'site', 'valor', 'motivo', 'id_transacao', 'data'],
    required: ['motivo'],
  },
  {
    id: 'kyc-aprovado',
    name: 'KYC aprovado',
    category: 'kyc',
    trigger: 'Quando os documentos do jogador são aprovados',
    subject: 'Sua conta na {{site}} foi verificada',
    body: 'Olá, {{nome}}.\n\nSeus documentos foram aprovados. Agora você pode sacar sem limite de verificação.\n\n[Ir para o site]({{link_site}})',
    locked: false,
    variables: ['nome', 'site', 'link_site'],
    required: [],
  },
  {
    id: 'kyc-reprovado',
    name: 'KYC reprovado',
    category: 'kyc',
    trigger: 'Quando os documentos do jogador são recusados',
    subject: 'Precisamos de novos documentos',
    body: 'Olá, {{nome}}.\n\nNão conseguimos validar seus documentos. Motivo: {{motivo}}.\n\nEnvie novas fotos, nítidas e sem cortes, pelo seu perfil.\n\n[Enviar documentos]({{link_site}})',
    locked: false,
    variables: ['nome', 'site', 'motivo', 'link_site'],
    required: ['motivo'],
  },
]

/** Texto padrão de um template (para "Restaurar padrão"). */
export function defaultTemplate(id: string): EmailTemplate | undefined {
  const d = DEFS.find((x) => x.id === id)
  if (!d) return undefined
  return { ...d, enabled: d.enabled ?? true, updatedAt: null, updatedBy: null }
}

export function seedEmailTemplates(): EmailTemplate[] {
  const list = DEFS.map((d) => defaultTemplate(d.id)!)
  // estado observado: KYC reprovado desligado e boas-vindas editado
  return list.map((t) => {
    if (t.id === 'kyc-reprovado') return { ...t, enabled: false }
    if (t.id === 'boas-vindas')
      return {
        ...t,
        subject: '{{nome}}, bem-vindo(a) à {{site}}!',
        updatedAt: iso(new Date(NOW.getTime() - 18 * DAY)),
        updatedBy: 'Camila Rocha',
      }
    if (t.id === 'saque-pago') return { ...t, updatedAt: iso(new Date(NOW.getTime() - 41 * DAY)), updatedBy: 'Daniel Carius' }
    return t
  })
}
