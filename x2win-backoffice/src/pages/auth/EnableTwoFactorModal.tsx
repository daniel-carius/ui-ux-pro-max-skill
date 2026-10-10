// "Ativar 2FA" no menu da conta (modo API): cadastro voluntário do 2FA com a sessão aberta.
// Para cargos que não exigem 2FA (e para quem foi avisado em Equipe). O servidor pede a senha atual antes de
// gerar o segredo (POST /api/auth/2fa/setup) e encerra as outras sessões ao ligar (POST /api/auth/2fa/enable).
import { useRef, useState, type FormEvent } from 'react'
import QRCode from 'qrcode'
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react'
import type { TwoFactorEnableResponse, TwoFactorSetupResponse } from '@shared/api'
import { ApiError, api } from '@/lib/api'
import { useAuthApi } from '@/domain/session'
import { Button, Checkbox, CopyButton, Field, Modal, toast } from '@/components/ui'
import { AuthErrorAlert, CodeInput, PasswordInput, describeAuthError, type AuthErrorView } from './_shared'
import { RecoveryCodesList, SecretKey } from './EnrollTwoFactorPage'

type Step = { kind: 'password' } | { kind: 'scan'; secret: string; qr: string } | { kind: 'codes'; codes: string[] }

export function EnableTwoFactorModal({ open, onClose, email }: { open: boolean; onClose: () => void; email: string }) {
  const { reload } = useAuthApi()
  const [step, setStep] = useState<Step>({ kind: 'password' })
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AuthErrorView | null>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  /** Senha atual errada demais: o servidor bloqueou o acesso e encerrou a sessão; o painel vai para a entrada. */
  const handle = async (e: unknown, context: 'password' | 'code') => {
    if (e instanceof ApiError && e.status === 423) {
      await reload()
      return
    }
    if (e instanceof ApiError && e.code === 'ja_configurado') {
      toast.info('O 2FA já está ligado', { description: 'A verificação em duas etapas já foi configurada nesta conta.' })
      await reload()
      onClose()
      return
    }
    setError(describeAuthError(e, context))
  }

  const start = async (ev: FormEvent) => {
    ev.preventDefault()
    if (busy) return
    if (!password) {
      setError({ tone: 'warning', title: 'Informe a senha atual', message: 'O servidor confirma a sua senha antes de gerar o QR code.' })
      passwordRef.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api<TwoFactorSetupResponse>('POST', '/api/auth/2fa/setup', { currentPassword: password })
      // QR code gerado no navegador: o segredo não passa por nenhum serviço externo
      const qr = await QRCode.toDataURL(res.otpauthUrl, { margin: 2, width: 232, errorCorrectionLevel: 'M', color: { dark: '#101322', light: '#ffffff' } })
      setPassword('')
      setStep({ kind: 'scan', secret: res.secret, qr })
    } catch (e) {
      setPassword('')
      await handle(e, 'password')
    } finally {
      setBusy(false)
    }
  }

  const enable = async (value: string) => {
    if (busy || value.length !== 6) return
    setBusy(true)
    setError(null)
    try {
      const res = await api<TwoFactorEnableResponse>('POST', '/api/auth/2fa/enable', { code: value })
      setStep({ kind: 'codes', codes: res.recoveryCodes })
    } catch (e) {
      setCode('')
      await handle(e, 'code')
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    setBusy(true)
    try {
      // relê a sessão: o menu e Equipe passam a mostrar o 2FA ligado
      await reload()
    } finally {
      setBusy(false)
    }
    toast.success('2FA ligado', { description: 'A partir de agora, o painel pede o código do aplicativo depois da senha.' })
    onClose()
  }

  // com os códigos na tela, fechar sem confirmar perderia os códigos: só sai pelo botão
  const closeable = step.kind !== 'codes'

  return (
    <Modal
      open={open}
      onClose={closeable ? onClose : () => toast.warning('Guarde os códigos antes de fechar', { description: 'Eles não serão mostrados de novo.' })}
      icon={step.kind === 'codes' ? KeyRound : ShieldCheck}
      title={step.kind === 'codes' ? 'Guarde os códigos de recuperação' : 'Ativar o 2FA'}
      description={
        step.kind === 'password'
          ? 'Depois de ligar, o painel pede um código do celular além da senha. As outras sessões abertas com a sua conta são encerradas.'
          : step.kind === 'scan'
            ? 'Leia o QR code com o aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password...) e digite o código de 6 dígitos.'
            : 'O 2FA está ligado. Se perder o celular, entre com um destes códigos. Cada um funciona uma única vez e eles não serão mostrados de novo.'
      }
    >
      <div className="space-y-4 pb-2">
        <AuthErrorAlert error={error} />
        {step.kind === 'password' && (
          <form onSubmit={start} noValidate className="space-y-4">
            <Field label="Senha atual" htmlFor="enable2fa-password" required>
              <PasswordInput ref={passwordRef} id="enable2fa-password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" iconRight={ArrowRight} loading={busy}>
                Continuar
              </Button>
            </div>
          </form>
        )}
        {step.kind === 'scan' && (
          <>
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
                <img src={step.qr} alt="QR code para configurar o 2FA no aplicativo autenticador" width={160} height={160} className="h-40 w-40 rounded-md" />
              </div>
              <div className="w-full min-w-0">
                <p className="text-xs text-fg-3">Não consegue ler? Digite esta chave no aplicativo:</p>
                <div className="mt-1.5 flex items-center gap-1 rounded-lg border border-line bg-surface-2 py-1 pl-3 pr-1">
                  <SecretKey secret={step.secret} />
                  <CopyButton value={step.secret} label="Copiar chave" />
                </div>
              </div>
            </div>
            <CodeInput
              id="enable2fa-code"
              label="Código de 6 dígitos mostrado no aplicativo"
              value={code}
              onChange={(v) => {
                setCode(v)
                if (error && v) setError(null)
              }}
              onComplete={(v) => void enable(v)}
              disabled={busy}
              invalid={!!error && !code}
              autoFocus
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Cancelar
              </Button>
              <Button variant="primary" icon={ShieldCheck} loading={busy} disabled={code.length !== 6} onClick={() => void enable(code)}>
                Ligar o 2FA
              </Button>
            </div>
          </>
        )}
        {step.kind === 'codes' && (
          <>
            <RecoveryCodesList codes={step.codes} email={email} />
            <Checkbox
              checked={saved}
              onChange={setSaved}
              label="Guardei os códigos em um lugar seguro"
              description="Sem eles e sem o celular, só um administrador consegue liberar o seu acesso."
            />
            <div className="flex justify-end">
              <Button variant="primary" iconRight={ArrowRight} disabled={!saved} loading={busy} onClick={() => void finish()}>
                Concluir
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
