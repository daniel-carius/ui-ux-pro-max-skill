// Etapa "2fa": código do aplicativo autenticador ou código de recuperação.
import { useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, LifeBuoy, ShieldCheck, Smartphone } from 'lucide-react'
import type { LoginResponse, MeResponse } from '@shared/api'
import { api } from '@/lib/api'
import { useAuthApi } from '@/domain/session'
import { Button, Field, Input } from '@/components/ui'
import {
  AuthCard,
  AuthErrorAlert,
  CodeInput,
  SignedInAs,
  describeAuthError,
  formatRecoveryCode,
  useNow,
  type AuthErrorView,
} from './_shared'

export function TwoFactorPage({ me }: { me: MeResponse }) {
  const { reload, logout } = useAuthApi()
  const [mode, setMode] = useState<'app' | 'recovery'>('app')
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AuthErrorView | null>(null)
  const recoveryRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)

  const now = useNow(error?.until ? 10_000 : null)
  const locked = !!error?.until && error.until.getTime() > now

  const verify = async (value: string) => {
    if (busyRef.current || locked) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await api<LoginResponse>('POST', '/api/auth/2fa/verify', { code: value })
      await reload()
    } catch (e) {
      setError(describeAuthError(e, 'code'))
      if (mode === 'app') setCode('')
      else setTimeout(() => recoveryRef.current?.focus(), 0)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (mode === 'app') {
      if (code.length === 6) void verify(code)
      else setError({ tone: 'warning', title: 'Código incompleto', message: 'Digite os 6 dígitos que aparecem no aplicativo.' })
    } else {
      if (/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(recovery)) void verify(recovery)
      else setError({ tone: 'warning', title: 'Código incompleto', message: 'O código de recuperação tem 10 letras e números, no formato XXXXX-XXXXX.' })
    }
  }

  const switchMode = (next: 'app' | 'recovery') => {
    setMode(next)
    setError(null)
    setCode('')
    setRecovery('')
    if (next === 'recovery') setTimeout(() => recoveryRef.current?.focus(), 0)
  }

  return (
    <AuthCard
      icon={mode === 'app' ? Smartphone : LifeBuoy}
      title={mode === 'app' ? 'Verificação em duas etapas' : 'Código de recuperação'}
      description={
        mode === 'app'
          ? 'Abra o aplicativo autenticador no celular e digite o código de 6 dígitos da X2Win.'
          : 'Sem o celular? Use um dos códigos que você guardou ao ligar o 2FA. Cada código funciona uma única vez.'
      }
      footer={<SignedInAs email={me.user.email} onLogout={() => void logout()} />}
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        <AuthErrorAlert error={error} />
        {mode === 'app' ? (
          <div>
            <p className="mb-2 text-[13px] font-medium text-fg">Código do aplicativo</p>
            <CodeInput
              id="tfa-code"
              label="Código de 6 dígitos do aplicativo autenticador"
              value={code}
              onChange={(v) => {
                setCode(v)
                if (error && v) setError(null)
              }}
              onComplete={(v) => void verify(v)}
              disabled={busy || locked}
              invalid={!!error && error.tone === 'danger' && !code}
              autoFocus
            />
            <p className="mt-2 text-xs leading-5 text-fg-3">O código muda a cada 30 segundos. Ao completar os 6 dígitos, a verificação é automática.</p>
          </div>
        ) : (
          <Field label="Código de recuperação" htmlFor="tfa-recovery" hint="Letras e números, no formato XXXXX-XXXXX.">
            <Input
              ref={recoveryRef}
              id="tfa-recovery"
              value={recovery}
              onChange={(e) => setRecovery(formatRecoveryCode(e.target.value))}
              placeholder="XXXXX-XXXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="font-mono uppercase tracking-[0.12em]"
              disabled={busy || locked}
            />
          </Field>
        )}

        <Button type="submit" variant="primary" size="lg" block icon={ShieldCheck} loading={busy} disabled={locked}>
          {busy ? 'Verificando…' : 'Verificar e entrar'}
        </Button>

        <div className="text-center">
          {mode === 'app' ? (
            <button type="button" className="link text-[13px]" onClick={() => switchMode('recovery')}>
              Usar código de recuperação
            </button>
          ) : (
            <button type="button" className="link inline-flex items-center gap-1.5 text-[13px]" onClick={() => switchMode('app')}>
              <ArrowLeft size={14} aria-hidden /> Voltar para o código do aplicativo
            </button>
          )}
        </div>
      </form>
    </AuthCard>
  )
}
