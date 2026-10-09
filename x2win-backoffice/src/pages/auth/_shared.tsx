// Peças comuns das telas de entrada (modo API): moldura com a marca, campos de
// senha e código, e tradução dos erros da API para mensagens claras.
import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Check, Circle, Eye, EyeOff, History, Lock, Moon, ShieldCheck, Sun, Users } from 'lucide-react'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useTheme } from '@/lib/theme'
import { Alert, IconButton, Input, ToastHost, type InputProps } from '@/components/ui'
import { BrandMark } from '@/components/layout/Brand'

export const PASSWORD_MIN = 10

// ---------- Moldura ----------

const BULLETS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: ShieldCheck, title: 'Acesso protegido', text: 'Senha, verificação em duas etapas e lista de IPs do painel.' },
  { icon: Users, title: 'Cada um no seu papel', text: 'Menu, telas e botões seguem as permissões do cargo.' },
  { icon: History, title: 'Tudo registrado', text: 'Quem fez, quando e de onde fica na auditoria.' },
]

function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-primary text-primary-fg lg:flex lg:flex-col lg:justify-between lg:p-10 xl:p-14">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <svg className="absolute inset-0 h-full w-full text-primary-fg/[0.07]">
          <defs>
            <pattern id="auth-grid" width="36" height="36" patternUnits="userSpaceOnUse">
              <path d="M36 0H0V36" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#auth-grid)" />
        </svg>
        <div className="absolute -right-28 -top-28 h-96 w-96 rounded-full bg-primary-fg/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-24 h-[28rem] w-[28rem] rounded-full bg-gold/25 blur-3xl" />
      </div>

      <div className="relative flex items-center gap-3">
        <span className="rounded-2xl bg-primary-fg/15 p-1.5 ring-1 ring-inset ring-primary-fg/20">
          <BrandMark size={38} />
        </span>
        <div className="leading-tight">
          <p className="font-display text-lg font-extrabold tracking-tight">X2Win</p>
          <p className="text-xs font-medium text-primary-fg/75">Backoffice · Evox</p>
        </div>
      </div>

      <div className="relative max-w-md">
        <p className="font-display text-[2rem] font-extrabold leading-[1.15] tracking-tight xl:text-[2.5rem]">
          A operação da X2Win em um só lugar.
        </p>
        <p className="mt-4 text-[15px] leading-6 text-primary-fg/80">
          Saques, campanhas, cassino e equipe, com permissões por cargo e auditoria de cada ação.
        </p>
        <ul className="mt-9 space-y-4">
          {BULLETS.map((b) => (
            <li key={b.title} className="flex items-start gap-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-fg/15 ring-1 ring-inset ring-primary-fg/20">
                <b.icon size={19} aria-hidden />
              </span>
              <span className="min-w-0 pt-0.5">
                <span className="block text-sm font-semibold">{b.title}</span>
                <span className="block text-[13px] leading-5 text-primary-fg/75">{b.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-xs text-primary-fg/70">Uso restrito à equipe autorizada. Os acessos são registrados.</p>
    </aside>
  )
}

/** Tela cheia das etapas de entrada: painel da marca (desktop) + formulário. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { resolved, toggle } = useTheme()
  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <BrandPanel />
      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-8 sm:pt-6">
          <div className="flex items-center gap-2.5 lg:invisible">
            <BrandMark size={32} />
            <div className="leading-tight">
              <p className="font-display text-[15px] font-extrabold tracking-tight text-fg">X2Win</p>
              <p className="text-[11px] font-medium text-fg-3">Backoffice · Evox</p>
            </div>
          </div>
          <IconButton icon={resolved === 'dark' ? Sun : Moon} label={resolved === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'} onClick={toggle} />
        </header>
        <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-[420px] animate-pop-in">{children}</div>
        </main>
        <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 pb-6 text-xs text-fg-3">
          <span className="inline-flex items-center gap-1.5">
            <Lock size={12} aria-hidden /> Conexão protegida
          </span>
          <span>© {new Date().getFullYear()} X2Win · Evox</span>
        </footer>
      </div>
      <ToastHost />
    </div>
  )
}

const HEADING_TONE = {
  primary: 'bg-primary/10 text-primary-text',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
}

/** Cartão do formulário com ícone, título e descrição. */
export function AuthCard({
  icon: Icon,
  tone = 'primary',
  title,
  description,
  children,
  footer,
}: {
  icon?: LucideIcon
  tone?: keyof typeof HEADING_TONE
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    document.title = `${title} · X2Win Backoffice`
  }, [title])
  return (
    <div className="card overflow-hidden">
      <div className="p-6 sm:p-8">
        {Icon && (
          <span className={cn('mb-4 flex h-11 w-11 items-center justify-center rounded-xl', HEADING_TONE[tone])}>
            <Icon size={22} aria-hidden />
          </span>
        )}
        <h1 className="text-[22px] font-extrabold leading-tight text-fg">{title}</h1>
        {description && <p className="mt-1.5 text-sm leading-6 text-fg-3">{description}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <div className="border-t border-line bg-surface-2 px-6 py-3.5 text-[13px] text-fg-3 sm:px-8">{footer}</div>}
    </div>
  )
}

// ---------- Erros ----------

export interface AuthErrorView {
  tone: 'danger' | 'warning'
  title: string
  message: string
  /** conta bloqueada até (423) */
  until?: Date
}

function timeLabel(d: Date) {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** Traduz o erro da API para o aviso mostrado no formulário. */
export function describeAuthError(e: unknown, context: 'login' | 'code' | 'password' | 'invite'): AuthErrorView {
  if (!(e instanceof ApiError)) return { tone: 'danger', title: 'Algo deu errado', message: 'Tente de novo em instantes.' }
  if (e.status === 0) return { tone: 'warning', title: 'Sem conexão com o servidor', message: e.message }
  if (e.status === 423) {
    const raw = (e.details as { until?: string } | undefined)?.until
    const until = raw ? new Date(raw) : null
    if (until && !Number.isNaN(until.getTime())) {
      const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000))
      return {
        tone: 'danger',
        title: 'Acesso bloqueado por segurança',
        message: `Foram muitas tentativas erradas seguidas. Você pode tentar de novo às ${timeLabel(until)} (em ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}).`,
        until,
      }
    }
    return { tone: 'danger', title: 'Acesso bloqueado por segurança', message: e.message }
  }
  if (e.status === 403 && e.code === 'ip_nao_autorizado') {
    return {
      tone: 'danger',
      title: 'Seu IP não tem acesso ao painel',
      message:
        'O painel só aceita entradas dos endereços cadastrados em Segurança do painel. Conecte-se pela rede do escritório ou pela VPN, ou peça a um administrador para liberar o seu IP.',
    }
  }
  if (e.status === 429) return { tone: 'warning', title: 'Muitas tentativas seguidas', message: 'Aguarde um minuto e tente de novo.' }
  if (e.status === 401 && e.code === 'credenciais_invalidas') {
    if (context === 'login')
      return {
        tone: 'danger',
        title: 'E-mail ou senha incorretos',
        message: 'Confira os dados e tente de novo. Depois de 5 tentativas erradas, o acesso fica bloqueado por 15 minutos.',
      }
    if (context === 'code')
      return { tone: 'danger', title: 'Código inválido', message: 'Confira o código no aplicativo autenticador. Ele muda a cada 30 segundos.' }
    return { tone: 'danger', title: 'Senha atual incorreta', message: 'Digite a senha que você usa hoje para entrar no painel.' }
  }
  if (e.status === 401) return { tone: 'warning', title: 'Sessão expirada', message: 'Entre de novo para continuar.' }
  const title =
    context === 'password'
      ? 'Não foi possível trocar a senha'
      : context === 'invite'
        ? 'Não foi possível aceitar o convite'
        : context === 'code'
          ? 'Não foi possível confirmar o código'
          : 'Não foi possível entrar'
  return { tone: 'danger', title, message: e.message }
}

export function AuthErrorAlert({ error, className }: { error: AuthErrorView | null; className?: string }) {
  if (!error) return null
  return (
    <div aria-live="assertive" className={className}>
      <Alert tone={error.tone} title={error.title}>
        {error.message}
      </Alert>
    </div>
  )
}

/** Relógio que atualiza a cada `ms` (null = parado). */
export function useNow(ms: number | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (ms === null) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

// ---------- Senha ----------

/** Campo de senha com botão de mostrar/ocultar. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type' | 'suffix'>>(function PasswordInput(props, ref) {
  const [show, setShow] = useState(false)
  return (
    <Input
      ref={ref}
      {...props}
      type={show ? 'text' : 'password'}
      icon={Lock}
      suffix={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={show}
          title={show ? 'Ocultar senha' : 'Mostrar senha'}
          className="-mr-1.5 flex h-8 w-8 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-surface-3 hover:text-fg"
        >
          {show ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      }
    />
  )
})

/** Mesma regra do servidor (passwordProblem): tamanho mínimo, letras e números. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `A senha precisa de pelo menos ${PASSWORD_MIN} caracteres.`
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return 'Use letras e números na senha.'
  return null
}

function passwordScore(pw: string) {
  if (!pw) return 0
  let s = 1
  if (pw.length >= PASSWORD_MIN) s++
  if (pw.length >= 14) s++
  if ((/[a-z]/.test(pw) && /[A-Z]/.test(pw)) || /[^a-zA-Z0-9]/.test(pw)) s++
  // fora da regra mínima nunca passa de "fraca"
  if (passwordProblem(pw)) s = Math.min(s, 1)
  return Math.min(s, 4)
}

const STRENGTH = [
  { label: '', bar: '', text: 'text-fg-3' },
  { label: 'Fraca', bar: 'bg-danger', text: 'text-danger' },
  { label: 'Razoável', bar: 'bg-warning', text: 'text-warning' },
  { label: 'Boa', bar: 'bg-success', text: 'text-success' },
  { label: 'Forte', bar: 'bg-success', text: 'text-success' },
]

/** Força da senha + lista das regras (atualiza enquanto a pessoa digita). */
export function PasswordStrength({ password, confirm }: { password: string; confirm?: string }) {
  const score = passwordScore(password)
  const s = STRENGTH[score]
  const rules = [
    { ok: password.length >= PASSWORD_MIN, label: `Pelo menos ${PASSWORD_MIN} caracteres` },
    { ok: /[a-zA-Z]/.test(password) && /\d/.test(password), label: 'Letras e números' },
    ...(confirm !== undefined ? [{ ok: password.length > 0 && password === confirm, label: 'As duas senhas iguais' }] : []),
  ]
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-fg-2">Força da senha</span>
        <span className={cn('font-semibold', s.text)} aria-live="polite">
          {s.label || 'Digite uma senha'}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn('h-1.5 rounded-full transition-colors duration-200', i <= score ? s.bar : 'bg-surface-3')} />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {rules.map((r) => (
          <li key={r.label} className={cn('flex items-center gap-2 text-xs', r.ok ? 'text-success' : 'text-fg-3')}>
            {r.ok ? <Check size={14} strokeWidth={2.5} aria-hidden /> : <Circle size={14} aria-hidden />}
            <span>
              {r.label}
              <span className="sr-only">{r.ok ? ' (ok)' : ' (pendente)'}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-xs leading-5 text-fg-3">Dica: uma frase curta com números fica forte e fácil de lembrar.</p>
    </div>
  )
}

// ---------- Código de 6 dígitos ----------

/**
 * Código do aplicativo autenticador: seis caixas, um único campo (colar funciona).
 * Chama onComplete ao chegar no 6º dígito.
 */
export function CodeInput({
  id,
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  autoFocus,
  label,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  onComplete?: (v: string) => void
  disabled?: boolean
  invalid?: boolean
  autoFocus?: boolean
  label: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (autoFocus && !disabled) ref.current?.focus()
  }, [autoFocus, disabled])

  const active = Math.min(value.length, 5)
  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 sm:gap-2" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => {
          const isActive = focused && !disabled && i === active
          const ch = value[i]
          return (
            <div key={i} className="contents">
              {i === 3 && <span className="h-0.5 w-2 shrink-0 rounded-full bg-line-strong" />}
              <div
                className={cn(
                  'flex h-12 min-w-0 flex-1 items-center justify-center rounded-lg border bg-surface font-mono text-xl font-semibold text-fg transition-[border-color,box-shadow] duration-150 sm:h-14 sm:text-2xl',
                  invalid ? 'border-danger' : isActive ? 'border-primary shadow-ring' : ch ? 'border-line-strong' : 'border-line-strong/80',
                  disabled && 'bg-surface-3/50 text-fg-3',
                )}
              >
                {ch ?? (isActive ? <span className="h-6 w-px animate-pulse bg-fg" /> : null)}
              </div>
            </div>
          )
        })}
      </div>
      <input
        ref={ref}
        id={id}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-invalid={invalid || undefined}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 6)
          onChange(v)
          if (v.length === 6 && v !== value) onComplete?.(v)
        }}
        className="absolute inset-0 h-full w-full cursor-text rounded-lg bg-transparent text-base text-transparent caret-transparent outline-none selection:bg-transparent focus-visible:outline-none disabled:cursor-not-allowed"
      />
    </div>
  )
}

/** Código de recuperação no formato XXXXX-XXXXX. */
export function formatRecoveryCode(raw: string) {
  const clean = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10)
  return clean.length > 5 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : clean
}

/** Rodapé das etapas: com qual conta está entrando + sair. */
export function SignedInAs({ email, onLogout }: { email: string; onLogout: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span className="min-w-0 truncate">
        Entrando como <span className="font-medium text-fg-2">{email}</span>
      </span>
      <button type="button" onClick={onLogout} className="link shrink-0">
        Usar outra conta
      </button>
    </div>
  )
}
