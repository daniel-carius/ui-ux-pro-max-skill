// Entrada no painel (modo API): e-mail e senha.
import { useRef, useState, type FormEvent } from 'react'
import { LogIn, Mail } from 'lucide-react'
import type { LoginResponse } from '@shared/api'
import { api } from '@/lib/api'
import { useAuthApi, type LoginReason } from '@/domain/session'
import { Alert, Button, Field, Input } from '@/components/ui'
import { AuthCard, AuthErrorAlert, PasswordInput, describeAuthError, useNow, type AuthErrorView } from './_shared'

const NOTICE: Record<LoginReason, { tone: 'info' | 'success' | 'danger'; title: string; text: string }> = {
  expired: {
    tone: 'info',
    title: 'Sua sessão expirou',
    text: 'Por segurança, a sessão cai depois de um tempo sem uso. Entre de novo para continuar.',
  },
  logout: { tone: 'success', title: 'Você saiu do painel', text: 'Para voltar, entre com o seu e-mail e a sua senha.' },
  ip: {
    tone: 'danger',
    title: 'Seu IP não tem acesso ao painel',
    text: 'O painel só aceita entradas dos endereços cadastrados em Segurança do painel. Conecte-se pela rede do escritório ou pela VPN, ou peça a um administrador para liberar o seu IP.',
  },
}

export function LoginPage({ reason }: { reason?: LoginReason }) {
  const { reload } = useAuthApi()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
  const [error, setError] = useState<AuthErrorView | null>(null)
  const [busy, setBusy] = useState(false)
  const [showNotice, setShowNotice] = useState(true)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const now = useNow(error?.until ? 10_000 : null)
  const locked = !!error?.until && error.until.getTime() > now

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || locked) return
    const errs: typeof fieldErrors = {}
    if (!email.trim()) errs.email = 'Informe o e-mail.'
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = 'E-mail inválido.'
    if (!password) errs.password = 'Informe a senha.'
    setFieldErrors(errs)
    if (errs.email) return emailRef.current?.focus()
    if (errs.password) return passwordRef.current?.focus()

    setBusy(true)
    setError(null)
    setShowNotice(false)
    try {
      await api<LoginResponse>('POST', '/api/auth/login', { email: email.trim(), password })
      // a sessão segue para a etapa certa (troca de senha, 2FA ou painel)
      await reload()
    } catch (err) {
      setError(describeAuthError(err, 'login'))
      setPassword('')
      setTimeout(() => passwordRef.current?.focus(), 0)
    } finally {
      setBusy(false)
    }
  }

  const notice = reason && showNotice ? NOTICE[reason] : null

  return (
    <AuthCard
      icon={LogIn}
      title="Entrar no painel"
      description="Use o e-mail e a senha da sua conta na equipe X2Win."
      footer={<p>Esqueceu a senha? Peça a um administrador do painel para gerar uma senha temporária.</p>}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {notice && (
          <Alert tone={notice.tone} title={notice.title}>
            {notice.text}
          </Alert>
        )}
        <AuthErrorAlert error={error} />
        <Field label="E-mail" htmlFor="login-email" error={fieldErrors.email} required>
          <Input
            ref={emailRef}
            id="login-email"
            type="email"
            icon={Mail}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="voce@x2win.bet"
            invalid={!!fieldErrors.email}
            autoFocus
            required
          />
        </Field>
        <Field label="Senha" htmlFor="login-password" error={fieldErrors.password} required>
          <PasswordInput
            ref={passwordRef}
            id="login-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            invalid={!!fieldErrors.password}
            required
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" block icon={LogIn} loading={busy} disabled={locked}>
          {locked && error?.until
            ? `Bloqueado até ${error.until.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
            : busy
              ? 'Entrando…'
              : 'Entrar'}
        </Button>
      </form>
    </AuthCard>
  )
}
