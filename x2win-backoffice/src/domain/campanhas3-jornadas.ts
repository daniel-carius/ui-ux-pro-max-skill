// Jornadas: automações por jogador com gatilho e etapas em sequência.
// Regras: precisa de ao menos uma etapa de ação; SMS exige SendWork; esperas
// e condições não contam como ação. Métricas simuladas crescem com o tempo ativo.
import { createRng, uid } from '@/lib/random'
import { HOUR } from '@/data/now'

export type TriggerKind = 'cadastro' | 'primeiro_deposito' | 'inatividade' | 'nivel' | 'saque_pago'

export const TRIGGER_LABEL: Record<TriggerKind, string> = {
  cadastro: 'Cadastro',
  primeiro_deposito: 'Primeiro depósito',
  inatividade: 'Inatividade',
  nivel: 'Nível alcançado',
  saque_pago: 'Saque pago',
}

export interface JourneyTrigger {
  kind: TriggerKind
  /** dias sem acessar (inatividade) */
  days: number
  /** nível alcançado (1 = primeiro da trilha) */
  level: number
}

export type StepKind = 'email' | 'sms' | 'notificacao' | 'bonus' | 'esperar' | 'condicao'

export const STEP_LABEL: Record<StepKind, string> = {
  email: 'Enviar e-mail',
  sms: 'Enviar SMS',
  notificacao: 'Enviar notificação',
  bonus: 'Conceder bônus',
  esperar: 'Esperar',
  condicao: 'Condição: depositou?',
}

export const ACTION_STEPS: StepKind[] = ['email', 'sms', 'notificacao', 'bonus']

export interface JourneyStep {
  id: string
  kind: StepKind
  /** assunto do e-mail ou título da notificação */
  title: string
  /** corpo do e-mail, SMS ou notificação */
  text: string
  /** bônus em R$ */
  amount: number
  /** rollover do bônus, em vezes */
  rollover: number
  /** espera em horas (esperar) ou janela da condição */
  hours: number
  /** condição: segue quem depositou ou quem não depositou */
  continueIf: 'depositou' | 'nao_depositou'
}

export type JourneyGoal = 'deposito' | 'aposta' | 'nenhum'

export const GOAL_LABEL: Record<JourneyGoal, string> = {
  deposito: 'Fazer um depósito',
  aposta: 'Voltar a apostar',
  nenhum: 'Sem objetivo (só acompanhar)',
}

export type JourneyStatus = 'rascunho' | 'ativa' | 'pausada'

export const JOURNEY_STATUS_LABEL: Record<JourneyStatus, string> = { rascunho: 'Rascunho', ativa: 'Ativa', pausada: 'Pausada' }

export interface Journey {
  id: string
  name: string
  description: string
  trigger: JourneyTrigger
  steps: JourneyStep[]
  goal: JourneyGoal
  /** jogador sai da jornada assim que cumpre o objetivo */
  exitOnGoal: boolean
  status: JourneyStatus
  /** início do período ativo atual */
  activatedAt: string | null
  /** tempo ativo acumulado de períodos anteriores (ms) */
  activeMs: number
  createdAt: string
  updatedAt: string
  createdBy: string
}

export const JORNADAS_KEY = 'campanhas.jornadas'

export function newStep(kind: StepKind): JourneyStep {
  const base: JourneyStep = { id: uid('st'), kind, title: '', text: '', amount: 20, rollover: 10, hours: 24, continueIf: 'nao_depositou' }
  if (kind === 'email') return { ...base, title: 'Novidades para você, {{primeiro_nome}}', text: 'Olá, {{primeiro_nome}}! Temos uma oferta especial esperando por você.' }
  if (kind === 'sms') return { ...base, text: 'X2Win: {{primeiro_nome}}, tem bonus esperando por voce. Acesse x2win.bet.br' }
  if (kind === 'notificacao') return { ...base, title: 'Tem novidade para você', text: 'Abra as promoções e confira a oferta do dia.' }
  if (kind === 'condicao') return { ...base, hours: 48 }
  return base
}

export function emptyJourney(createdBy: string): Journey {
  const now = new Date().toISOString()
  return {
    id: uid('jr'),
    name: '',
    description: '',
    trigger: { kind: 'cadastro', days: 14, level: 3 },
    steps: [newStep('email')],
    goal: 'deposito',
    exitOnGoal: true,
    status: 'rascunho',
    activatedAt: null,
    activeMs: 0,
    createdAt: now,
    updatedAt: now,
    createdBy,
  }
}

export interface JourneyValidation {
  errors: string[]
  stepErrors: Record<string, string>
  warnings: string[]
}

export function validateJourney(j: Journey, opts: { smsAvailable: boolean; levelsCount: number }): JourneyValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const stepErrors: Record<string, string> = {}
  if (!j.name.trim()) errors.push('Dê um nome à jornada.')
  else if (j.name.length > 60) errors.push('Nome longo demais (máximo 60).')
  if (j.trigger.kind === 'inatividade' && (j.trigger.days < 1 || j.trigger.days > 365)) errors.push('Inatividade: informe de 1 a 365 dias.')
  if (j.trigger.kind === 'nivel' && (j.trigger.level < 2 || j.trigger.level > opts.levelsCount)) errors.push('Escolha um nível da trilha (a partir do 2º).')
  if (!j.steps.some((s) => ACTION_STEPS.includes(s.kind))) errors.push('Inclua ao menos uma etapa de ação (e-mail, SMS, notificação ou bônus).')
  if (j.steps.length > 12) errors.push('Use no máximo 12 etapas.')
  j.steps.forEach((s) => {
    let e = ''
    if (s.kind === 'email' && (!s.title.trim() || !s.text.trim())) e = 'Preencha assunto e texto do e-mail.'
    if (s.kind === 'notificacao' && (!s.title.trim() || !s.text.trim())) e = 'Preencha título e mensagem.'
    if (s.kind === 'notificacao' && s.text.length > 160) e = 'Mensagem com mais de 160 caracteres.'
    if (s.kind === 'sms' && !s.text.trim()) e = 'Escreva o texto do SMS.'
    if (s.kind === 'sms' && !opts.smsAvailable) e = 'SMS indisponível: conecte a SendWork em Integrações.'
    if (s.kind === 'bonus' && (s.amount <= 0 || s.amount > 5000)) e = 'Bônus de R$ 0,01 a R$ 5.000,00.'
    if (s.kind === 'bonus' && (s.rollover < 0 || s.rollover > 60)) e = 'Rollover de 0x a 60x.'
    if ((s.kind === 'esperar' || s.kind === 'condicao') && (s.hours < 1 || s.hours > 24 * 60)) e = 'Use de 1 hora a 60 dias.'
    if (e) stepErrors[s.id] = e
  })
  if (Object.keys(stepErrors).length) errors.push('Corrija as etapas marcadas.')
  const last = j.steps[j.steps.length - 1]
  if (last && (last.kind === 'esperar' || last.kind === 'condicao')) warnings.push('A jornada termina numa espera ou condição: a última etapa não faz nada.')
  j.steps.forEach((s, i) => {
    if (s.kind === 'esperar' && j.steps[i + 1]?.kind === 'esperar') warnings.push('Há duas esperas seguidas; dá para juntar numa só.')
  })
  if (j.trigger.kind === 'saque_pago' && j.steps.some((s) => s.kind === 'bonus')) warnings.push('Bônus logo após saque pago costuma ser usado para sacar de novo. Confira o rollover.')
  return { errors, stepErrors, warnings: [...new Set(warnings)] }
}

export function totalWaitHours(j: Pick<Journey, 'steps'>) {
  return j.steps.reduce((s, st) => s + (st.kind === 'esperar' || st.kind === 'condicao' ? st.hours : 0), 0)
}

/** Entradas por hora, conforme o volume típico do gatilho. */
const RATE: Record<TriggerKind, number> = { cadastro: 11, primeiro_deposito: 3.4, inatividade: 1.6, nivel: 0.9, saque_pago: 2.2 }
const CONV: Record<TriggerKind, [number, number]> = {
  cadastro: [0.18, 0.3],
  primeiro_deposito: [0.32, 0.46],
  inatividade: [0.06, 0.14],
  nivel: [0.2, 0.34],
  saque_pago: [0.24, 0.38],
}

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h
}

export interface JourneyMetrics {
  entered: number
  inProgress: number
  completed: number
  converted: number
  conversion: number | null
  hoursActive: number
}

/** Métricas simuladas: crescem com o tempo em que a jornada ficou ativa. */
export function journeyMetrics(j: Journey, now: number = Date.now()): JourneyMetrics {
  const running = j.status === 'ativa' && j.activatedAt ? Math.max(0, now - new Date(j.activatedAt).getTime()) : 0
  const hoursActive = (j.activeMs + running) / HOUR
  if (hoursActive <= 0) return { entered: 0, inProgress: 0, completed: 0, converted: 0, conversion: null, hoursActive: 0 }
  const rng = createRng(hash(j.id))
  const jitter = rng.float(0.8, 1.2, 3)
  const entered = Math.floor(hoursActive * RATE[j.trigger.kind] * jitter)
  const wait = totalWaitHours(j)
  const finished = Math.min(entered, Math.floor(Math.max(0, hoursActive - wait) * RATE[j.trigger.kind] * jitter))
  const [lo, hi] = CONV[j.trigger.kind]
  const convRate = j.goal === 'nenhum' ? 0 : rng.float(lo, hi, 3)
  const converted = Math.round(entered * convRate * Math.min(1, hoursActive / Math.max(1, wait || 6)))
  const completed = Math.max(0, finished - (j.exitOnGoal ? Math.round(converted * 0.4) : 0))
  return {
    entered,
    inProgress: Math.max(0, entered - completed - (j.exitOnGoal ? converted : 0)),
    completed,
    converted: j.goal === 'nenhum' ? 0 : converted,
    conversion: j.goal === 'nenhum' || entered === 0 ? null : converted / entered,
    hoursActive,
  }
}

export function hoursLabel(h: number) {
  if (h % 24 === 0 && h >= 24) return `${h / 24} ${h / 24 === 1 ? 'dia' : 'dias'}`
  return `${h} ${h === 1 ? 'hora' : 'horas'}`
}

export function describeTrigger(t: JourneyTrigger, levelName?: (n: number) => string) {
  switch (t.kind) {
    case 'cadastro':
      return 'Quando o jogador se cadastra'
    case 'primeiro_deposito':
      return 'Quando faz o primeiro depósito'
    case 'inatividade':
      return `Quando fica ${t.days} ${t.days === 1 ? 'dia' : 'dias'} sem acessar`
    case 'nivel':
      return `Quando alcança o nível ${levelName ? levelName(t.level) : t.level}`
    case 'saque_pago':
      return 'Quando um saque é pago'
  }
}

export function describeStep(s: JourneyStep) {
  switch (s.kind) {
    case 'email':
      return s.title || 'E-mail sem assunto'
    case 'sms':
      return s.text || 'SMS sem texto'
    case 'notificacao':
      return s.title || 'Notificação sem título'
    case 'bonus':
      return `R$ ${s.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} com rollover ${s.rollover}x`
    case 'esperar':
      return hoursLabel(s.hours)
    case 'condicao':
      return s.continueIf === 'depositou' ? `Segue quem depositou em ${hoursLabel(s.hours)}` : `Segue quem não depositou em ${hoursLabel(s.hours)}`
  }
}

// ---------- Templates ----------

export type TemplateId = 'boas-vindas' | 'reativacao' | 'pos-ftd'

export interface JourneyTemplate {
  id: TemplateId
  name: string
  description: string
  trigger: JourneyTrigger
  goal: JourneyGoal
  build: (smsAvailable: boolean) => JourneyStep[]
}

const S = (kind: StepKind, p: Partial<JourneyStep> = {}): JourneyStep => ({ ...newStep(kind), ...p })

export const JOURNEY_TEMPLATES: JourneyTemplate[] = [
  {
    id: 'boas-vindas',
    name: 'Boas-vindas',
    description: 'Recebe quem acabou de se cadastrar e leva ao primeiro depósito.',
    trigger: { kind: 'cadastro', days: 14, level: 3 },
    goal: 'deposito',
    build: () => [
      S('email', { title: 'Bem-vindo à X2Win, {{primeiro_nome}}!', text: 'Sua conta está pronta. Faça o primeiro depósito e ganhe o dobro para jogar.' }),
      S('esperar', { hours: 24 }),
      S('condicao', { hours: 24, continueIf: 'nao_depositou' }),
      S('notificacao', { title: 'Seu bônus está esperando', text: 'Deposite a partir de R$ 50 e ganhe 100% de bônus. Válido por 48 horas.' }),
      S('esperar', { hours: 48 }),
      S('email', { title: 'Últimas horas do seu bônus de boas-vindas', text: 'O bônus de 100% no primeiro depósito termina hoje, {{primeiro_nome}}.' }),
    ],
  },
  {
    id: 'reativacao',
    name: 'Reativação de inativos',
    description: 'Chama de volta quem está há 14 dias sem acessar, com bônus se não voltar.',
    trigger: { kind: 'inatividade', days: 14, level: 3 },
    goal: 'aposta',
    build: (sms) => [
      S('notificacao', { title: 'Sentimos sua falta', text: 'Tem rodada grátis esperando por você no Fortune Tiger.' }),
      S('email', { title: '{{primeiro_nome}}, separamos 50 giros para você', text: 'Volte hoje e ganhe 50 giros grátis no Fortune Tiger.' }),
      S('esperar', { hours: 48 }),
      S('condicao', { hours: 48, continueIf: 'nao_depositou' }),
      S('bonus', { amount: 20, rollover: 10 }),
      sms
        ? S('sms', { text: 'X2Win: {{primeiro_nome}}, voce ganhou R$ 20 de bonus. Valido por 3 dias.' })
        : S('notificacao', { title: 'Você ganhou R$ 20 de bônus', text: 'O bônus já está na sua conta e vale por 3 dias.' }),
    ],
  },
  {
    id: 'pos-ftd',
    name: 'Pós-primeiro-depósito',
    description: 'Parabeniza o primeiro depósito e incentiva o segundo.',
    trigger: { kind: 'primeiro_deposito', days: 14, level: 3 },
    goal: 'deposito',
    build: () => [
      S('email', { title: 'Parabéns pelo primeiro depósito!', text: 'Agora você joga com saldo turbinado. Confira os jogos mais quentes da semana.' }),
      S('esperar', { hours: 72 }),
      S('condicao', { hours: 72, continueIf: 'nao_depositou' }),
      S('notificacao', { title: 'Ganhe 100 giros no 2º depósito', text: 'Deposite de novo nas próximas 48 horas e leve 100 giros no Fortune Tiger.' }),
    ],
  },
]

export function journeyFromTemplate(t: JourneyTemplate, createdBy: string, smsAvailable: boolean): Journey {
  return {
    ...emptyJourney(createdBy),
    name: t.name,
    description: t.description,
    trigger: { ...t.trigger },
    goal: t.goal,
    steps: t.build(smsAvailable),
  }
}
