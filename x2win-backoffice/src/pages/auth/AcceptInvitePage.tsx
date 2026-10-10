// Rota pública #/convite?token=... : a pessoa convidada cria a senha de acesso.
// O nome na equipe é o que quem convidou cadastrou (o servidor não aceita outro).
import { useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CircleCheck, LogIn, Unlink, UserPlus } from 'lucide-react'
import type { AcceptInviteRequest } from '@shared/api'
import { api } from '@/lib/api'
import { Button, Field } from '@/components/ui'
import {
  AuthCard,
  AuthErrorAlert,
  AuthLayout,
  PasswordInput,
  PasswordStrength,
  describeAuthError,
  passwordProblem,
  withBusyRetry,
  type AuthErrorView,
} from './_shared'

export default function AcceptInvitePage() {
  const [params] = useSearchParams()
  const token = (params.get('token') ?? '').trim()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({})
  const [error, setError] = useState<AuthErrorView | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  const goToLogin = () => navigate('/', { replace: true })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const errs: typeof fieldErrors = {}
    const problem = passwordProblem(password)
    if (problem) errs.password = problem
    else if (confirm !== password) errs.confirm = 'As senhas não são iguais.'
    setFieldErrors(errs)
    if (errs.password) return passwordRef.current?.focus()
    if (errs.confirm) return confirmRef.current?.focus()

    setBusy(true)
    setError(null)
    try {
      const body: AcceptInviteRequest = { token, password }
      // servidor ocupado (503): nada foi gravado e o convite continua valendo; espera e tenta de novo sozinho
      await withBusyRetry(() => api<{ ok: true }>('POST', '/api/team/invites/accept', body), setError)
      setError(null)
      setDone(true)
    } catch (err) {
      setError(describeAuthError(err, 'invite'))
    } finally {
      setBusy(false)
    }
  }

  let content
  if (!token) {
    content = (
      <AuthCard
        icon={Unlink}
        tone="warning"
        title="Link de convite incompleto"
        description="O endereço não tem o código do convite. Abra o link exatamente como chegou ou peça a quem convidou você para enviar de novo."
      >
        <Button variant="primary" size="lg" block icon={LogIn} onClick={goToLogin}>
          Ir para a entrada
        </Button>
      </AuthCard>
    )
  } else if (done) {
    content = (
      <AuthCard
        icon={CircleCheck}
        tone="success"
        title="Acesso criado"
        description="Tudo certo. Agora entre com o seu e-mail e a senha que você acabou de criar."
      >
        <Button variant="primary" size="lg" block icon={LogIn} onClick={goToLogin}>
          Ir para a entrada
        </Button>
      </AuthCard>
    )
  } else {
    content = (
      <AuthCard
        icon={UserPlus}
        title="Aceitar convite"
        description="Você foi convidado para a equipe do painel X2Win. Crie uma senha para entrar."
        footer={
          <p>
            Já tem acesso?{' '}
            <button type="button" className="link" onClick={goToLogin}>
              Entrar no painel
            </button>
          </p>
        }
      >
        <form onSubmit={submit} noValidate className="space-y-4">
          <AuthErrorAlert error={error} />
          <Field label="Senha" htmlFor="invite-password" error={fieldErrors.password} required>
            <PasswordInput
              ref={passwordRef}
              id="invite-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              invalid={!!fieldErrors.password}
              aria-describedby="invite-strength"
              autoFocus
            />
          </Field>
          <Field label="Confirme a senha" htmlFor="invite-confirm" error={fieldErrors.confirm} required>
            <PasswordInput
              ref={confirmRef}
              id="invite-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              invalid={!!fieldErrors.confirm}
            />
          </Field>
          <div id="invite-strength">
            <PasswordStrength password={password} confirm={confirm} />
          </div>
          <Button type="submit" variant="primary" size="lg" block icon={UserPlus} loading={busy}>
            {busy ? 'Criando acesso…' : 'Criar meu acesso'}
          </Button>
        </form>
      </AuthCard>
    )
  }

  return <AuthLayout>{content}</AuthLayout>
}
