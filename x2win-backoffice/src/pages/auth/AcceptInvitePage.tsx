// Rota pública #/convite?token=... : a pessoa convidada cria o acesso (nome e senha).
import { useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CircleCheck, LogIn, Unlink, UserPlus, UserRound } from 'lucide-react'
import type { AcceptInviteRequest } from '@shared/api'
import { api } from '@/lib/api'
import { Button, Field, Input } from '@/components/ui'
import {
  AuthCard,
  AuthErrorAlert,
  AuthLayout,
  PasswordInput,
  PasswordStrength,
  describeAuthError,
  passwordProblem,
  type AuthErrorView,
} from './_shared'

export default function AcceptInvitePage() {
  const [params] = useSearchParams()
  const token = (params.get('token') ?? '').trim()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; password?: string; confirm?: string }>({})
  const [error, setError] = useState<AuthErrorView | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  const goToLogin = () => navigate('/', { replace: true })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const errs: typeof fieldErrors = {}
    const cleanName = name.trim().replace(/\s+/g, ' ')
    if (cleanName.length < 3) errs.name = 'Informe o seu nome completo.'
    const problem = passwordProblem(password)
    if (problem) errs.password = problem
    else if (confirm !== password) errs.confirm = 'As senhas não são iguais.'
    setFieldErrors(errs)
    if (errs.name) return nameRef.current?.focus()
    if (errs.password) return passwordRef.current?.focus()
    if (errs.confirm) return confirmRef.current?.focus()

    setBusy(true)
    setError(null)
    try {
      const body: AcceptInviteRequest = { token, name: cleanName, password }
      await api<{ ok: true }>('POST', '/api/team/invites/accept', body)
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
        description="Você foi convidado para a equipe do painel X2Win. Informe o seu nome e crie uma senha para entrar."
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
          <Field label="Nome completo" htmlFor="invite-name" error={fieldErrors.name} required>
            <Input
              ref={nameRef}
              id="invite-name"
              icon={UserRound}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              maxLength={80}
              placeholder="Como você quer aparecer na equipe"
              invalid={!!fieldErrors.name}
              autoFocus
            />
          </Field>
          <Field label="Senha" htmlFor="invite-password" error={fieldErrors.password} required>
            <PasswordInput
              ref={passwordRef}
              id="invite-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              invalid={!!fieldErrors.password}
              aria-describedby="invite-strength"
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
