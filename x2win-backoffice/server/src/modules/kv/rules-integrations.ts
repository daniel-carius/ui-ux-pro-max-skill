// Regras do servidor para config.integracoes (contas de e-mail, SMS e RCS):
// formato fechado (campo desconhecido → 400), tipos conferidos (porta inteira de
// 1 a 65535, booleanos), textos sem quebra de linha nem caractere de controle (o
// remetente vai para o cabeçalho do e-mail) e segredos em texto com pelo menos
// 8 caracteres (ou vazio = conta sem chave), o mesmo mínimo do campo de segredo
// do painel. Senha numérica ou curta demais não é gravada, nem segredo de
// demonstração ("DEMO-…", público no código do painel).
import { z } from 'zod'
import { parseOr400, type KvValidator } from './validate-util'

export const SECRET_MIN_LENGTH = 8
/** Segredos dos dados de demonstração do painel (ex.: DEMO-smtp-password). */
const DEMO_SECRET = /^DEMO-/i
const SECRET_MAX_LENGTH = 512

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/

const text = (what: string, max: number) =>
  z
    .string(`${what}: use texto.`)
    .max(max, `${what}: no máximo ${max} caracteres.`)
    .refine((s) => !CONTROL.test(s), `${what}: sem quebras de linha nem caracteres de controle.`)

const secret = (what: string) =>
  z
    .string(`${what}: o segredo precisa ser texto.`)
    .max(SECRET_MAX_LENGTH, `${what}: no máximo ${SECRET_MAX_LENGTH} caracteres.`)
    .refine((s) => s === '' || s.length >= SECRET_MIN_LENGTH, `${what}: o segredo precisa de pelo menos ${SECRET_MIN_LENGTH} caracteres.`)
    .refine((s) => !DEMO_SECRET.test(s), `${what}: este é um segredo de demonstração. Digite o segredo real da conta.`)
    .refine((s) => !CONTROL.test(s), `${what}: sem quebras de linha nem caracteres de controle.`)

const integrations = z.strictObject(
  {
    emailProvider: z.enum(['smtp', 'mailgun', 'sendwork'], { error: 'Provedor de e-mail inválido.' }),
    smtp: z.strictObject(
      {
        host: text('Servidor SMTP', 253),
        port: z.number('Porta SMTP inválida.').int('A porta SMTP vai de 1 a 65535.').min(1, 'A porta SMTP vai de 1 a 65535.').max(65535, 'A porta SMTP vai de 1 a 65535.'),
        user: text('Usuário SMTP', 254),
        password: secret('Senha SMTP'),
        fromName: text('Nome do remetente', 120),
        fromEmail: text('E-mail do remetente', 254),
        secure: z.boolean('Conexão segura (TLS) inválida.'),
      },
      { error: 'SMTP: campos inválidos ou desconhecidos.' },
    ),
    mailgun: z.strictObject(
      {
        connected: z.boolean('Mailgun: status inválido.'),
        domain: text('Domínio do Mailgun', 253),
        apiKey: secret('Chave do Mailgun'),
        region: z.enum(['us', 'eu'], { error: 'Região do Mailgun inválida.' }),
      },
      { error: 'Mailgun: campos inválidos ou desconhecidos.' },
    ),
    sendwork: z.strictObject(
      {
        connected: z.boolean('SendWork: status inválido.'),
        accountId: text('Conta SendWork', 120),
        apiKey: secret('Chave da SendWork'),
        smsSender: text('Remetente do SMS', 40),
        rcsAgent: text('Agente RCS', 120),
      },
      { error: 'SendWork: campos inválidos ou desconhecidos.' },
    ),
  },
  { error: 'Integrações: campos inválidos ou desconhecidos.' },
)

const integrationsCheck: KvValidator = ({ next }) => ({ value: parseOr400(integrations, next) })

export const INTEGRATION_VALIDATORS: Record<string, KvValidator> = {
  'config.integracoes': integrationsCheck,
}
