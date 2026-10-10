// Troca de senha: etapa "password" do login (senha temporária ou expirada) e
// modal "Trocar senha" do menu do usuário (pede a senha atual).
import { useRef, useState, type FormEvent } from 'react'
import { KeyRound, Save } from 'lucide-react'
import type { LoginResponse, MeResponse } from '@shared/api'
import { ApiError, api } from '@/lib/api'
import { useAuthApi } from '@/domain/session'
import { Button, Field, Modal, toast } from '@/components/ui'
import {
  AuthCard,
  AuthErrorAlert,
  PasswordInput,
  PasswordStrength,
  SignedInAs,
  describeAuthError,
  passwordProblem,
  withBusyRetry,
  type AuthErrorView,
} from './_shared'

export function ChangePasswordForm({
  requireCurrent,
  submitLabel,
  onDone,
  onCancel,
  idPrefix = 'pw',
}: {
  /** sessão ativa: o servidor exige a senha atual */
  requireCurrent: boolean
  submitLabel: string
  onDone: (res: LoginResponse) => void | Promise<unknown>
  onCancel?: () => void
  idPrefix?: string
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ current?: string; next?: string; confirm?: string }>({})
  const [error, setError] = useState<AuthErrorView | null>(null)
  const [busy, setBusy] = useState(false)
  const currentRef = useRef<HTMLInputElement>(null)
  const nextRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const errs: typeof fieldErrors = {}
    if (requireCurrent && !current) errs.current = 'Informe a senha atual.'
    const problem = passwordProblem(next)
    if (problem) errs.next = problem
    else if (requireCurrent && next === current) errs.next = 'A nova senha precisa ser diferente da atual.'
    if (!errs.next && confirm !== next) errs.confirm = 'As senhas não são iguais.'
    setFieldErrors(errs)
    if (errs.current) return currentRef.current?.focus()
    if (errs.next) return nextRef.current?.focus()
    if (errs.confirm) return confirmRef.current?.focus()

    setBusy(true)
    setError(null)
    try {
      const body = requireCurrent ? { currentPassword: current, newPassword: next } : { newPassword: next }
      // servidor ocupado (503): espera o tempo indicado e tenta mais uma vez sozinho
      const res = await withBusyRetry(() => api<LoginResponse>('POST', '/api/auth/password', body), setError)
      setError(null)
      await onDone(res)
    } catch (err) {
      setError(describeAuthError(err, 'password'))
      if (err instanceof ApiError && err.code === 'credenciais_invalidas') {
        setCurrent('')
        setTimeout(() => currentRef.current?.focus(), 0)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <AuthErrorAlert error={error} />
      {requireCurrent && (
        <Field label="Senha atual" htmlFor={`${idPrefix}-current`} error={fieldErrors.current} required>
          <PasswordInput
            ref={currentRef}
            id={`${idPrefix}-current`}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            invalid={!!fieldErrors.current}
            autoFocus
          />
        </Field>
      )}
      <Field label="Nova senha" htmlFor={`${idPrefix}-new`} error={fieldErrors.next} required>
        <PasswordInput
          ref={nextRef}
          id={`${idPrefix}-new`}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          invalid={!!fieldErrors.next}
          aria-describedby={`${idPrefix}-strength`}
          autoFocus={!requireCurrent}
        />
      </Field>
      <Field label="Confirme a nova senha" htmlFor={`${idPrefix}-confirm`} error={fieldErrors.confirm} required>
        <PasswordInput
          ref={confirmRef}
          id={`${idPrefix}-confirm`}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          invalid={!!fieldErrors.confirm}
        />
      </Field>
      <div id={`${idPrefix}-strength`}>
        <PasswordStrength password={next} confirm={confirm} />
      </div>
      <div className={onCancel ? 'flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end' : 'pt-1'}>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
        )}
        <Button type="submit" variant="primary" size={onCancel ? 'md' : 'lg'} block={!onCancel} icon={Save} loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

/** Etapa "password" do login. */
export function ChangePasswordPage({ me }: { me: MeResponse }) {
  const { reload, logout } = useAuthApi()
  return (
    <AuthCard
      icon={KeyRound}
      title="Crie uma nova senha"
      description={
        me.user.mustChangePassword
          ? 'Você entrou com uma senha temporária. Escolha uma senha só sua para continuar.'
          : 'Por segurança, troque a sua senha para continuar.'
      }
      footer={<SignedInAs email={me.user.email} onLogout={() => void logout()} />}
    >
      <ChangePasswordForm
        requireCurrent={false}
        submitLabel="Salvar e continuar"
        onDone={async () => {
          toast.success('Senha alterada', { description: 'Use a nova senha nas próximas entradas.' })
          await reload()
        }}
      />
    </AuthCard>
  )
}

/** "Trocar senha" no menu do usuário (sessão ativa). */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={KeyRound}
      title="Trocar senha"
      description="Ao trocar, as outras sessões abertas com a sua conta são encerradas. Esta continua aberta."
    >
      {open && (
        <div className="pb-2">
          <ChangePasswordForm
            requireCurrent
            idPrefix="pw-modal"
            submitLabel="Trocar senha"
            onCancel={onClose}
            onDone={() => {
              toast.success('Senha alterada', { description: 'As outras sessões com a sua conta foram encerradas.' })
              onClose()
            }}
          />
        </div>
      )}
    </Modal>
  )
}
