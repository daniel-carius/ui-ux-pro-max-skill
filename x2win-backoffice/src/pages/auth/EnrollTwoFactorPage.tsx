// Etapa "enroll": cadastrar o 2FA (QR code + código) e guardar os códigos de recuperação.
import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { ArrowRight, Copy, Download, KeyRound, QrCode, RefreshCw, ShieldCheck } from 'lucide-react'
import type { MeResponse, TwoFactorEnableResponse, TwoFactorSetupResponse } from '@shared/api'
import { ApiError, api } from '@/lib/api'
import { useAuthApi } from '@/domain/session'
import { Button, Checkbox, CopyButton, Skeleton, toast } from '@/components/ui'
import { AuthCard, AuthErrorAlert, CodeInput, SignedInAs, describeAuthError, type AuthErrorView } from './_shared'

interface Setup extends TwoFactorSetupResponse {
  qr: string
}

/** Chave em grupos de 4 para facilitar a digitação manual. */
export function secretGroups(secret: string): string[] {
  return secret.replace(/\s+/g, '').match(/.{1,4}/g) ?? [secret]
}

/**
 * Chave para digitar no aplicativo: cada grupo de 4 fica inteiro na mesma linha (a quebra só acontece entre
 * grupos). Com "break-all" a linha quebrava no meio de um grupo e a quebra parecia um separador.
 */
export function SecretKey({ secret }: { secret: string }) {
  return (
    <code className="flex min-w-0 flex-1 flex-wrap gap-x-2 font-mono text-[13px] font-medium tracking-wide text-fg" aria-label={`Chave: ${secretGroups(secret).join(' ')}`}>
      {secretGroups(secret).map((g, i) => (
        <span key={i} className="whitespace-nowrap">
          {g}
        </span>
      ))}
    </code>
  )
}

export function downloadCodes(codes: string[], email: string) {
  const lines = [
    'X2Win Backoffice - códigos de recuperação do 2FA',
    `Conta: ${email}`,
    `Gerados em: ${new Date().toLocaleString('pt-BR')}`,
    '',
    'Cada código funciona uma única vez, se você perder o acesso ao aplicativo autenticador.',
    'Guarde este arquivo em um lugar seguro (cofre de senhas) e apague-o da pasta de downloads.',
    '',
    ...codes.map((c, i) => `${String(i + 1).padStart(2, ' ')}. ${c}`),
    '',
  ]
  const blob = new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'x2win-codigos-de-recuperacao.txt'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function EnrollTwoFactorPage({ me }: { me: MeResponse }) {
  const { reload, logout, holdRecoveryCodes } = useAuthApi()
  const [setup, setSetup] = useState<Setup | null>(null)
  const [setupError, setSetupError] = useState<AuthErrorView | null>(null)
  const [alreadyOn, setAlreadyOn] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AuthErrorView | null>(null)
  const reqId = useRef(0)
  const busyRef = useRef(false)

  const generate = useCallback(async () => {
    const my = ++reqId.current
    setSetup(null)
    setSetupError(null)
    setError(null)
    setCode('')
    try {
      const res = await api<TwoFactorSetupResponse>('POST', '/api/auth/2fa/setup')
      // QR code gerado no navegador: o segredo não passa por nenhum serviço externo
      const qr = await QRCode.toDataURL(res.otpauthUrl, {
        margin: 2,
        width: 232,
        errorCorrectionLevel: 'M',
        color: { dark: '#101322', light: '#ffffff' },
      })
      if (my === reqId.current) setSetup({ ...res, qr })
    } catch (e) {
      if (my !== reqId.current) return
      if (e instanceof ApiError && e.code === 'ja_configurado') setAlreadyOn(true)
      else setSetupError(describeAuthError(e, 'code'))
    }
  }, [])

  // uma vez por tela (StrictMode monta duas vezes em desenvolvimento)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void generate()
  }, [generate])

  const enable = async (value: string) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await api<TwoFactorEnableResponse>('POST', '/api/auth/2fa/enable', { code: value })
      // o servidor já promoveu a sessão: os códigos ficam no provedor da sessão (AuthFlow os mostra),
      // para uma releitura de /me (ex.: voltar para a aba) não tirá-los da tela antes da confirmação
      holdRecoveryCodes(res.recoveryCodes)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ja_configurado') setAlreadyOn(true)
      else setError(describeAuthError(e, 'code'))
      setCode('')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const footer = <SignedInAs email={me.user.email} onLogout={() => void logout()} />

  if (alreadyOn) {
    return (
      <AuthCard icon={ShieldCheck} tone="success" title="O 2FA já está ligado" description="A verificação em duas etapas já foi configurada nesta conta." footer={footer}>
        <Button variant="primary" size="lg" block iconRight={ArrowRight} onClick={() => void reload()}>
          Continuar
        </Button>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      icon={QrCode}
      title="Ligue a verificação em duas etapas"
      description="O painel exige a verificação em duas etapas para a sua conta. Leva um minuto: depois, além da senha, o painel pede um código do celular."
      footer={footer}
    >
      <ol className="space-y-5">
        <li className="flex gap-3">
          <StepNumber n={1} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">Instale um aplicativo autenticador</p>
            <p className="mt-0.5 text-[13px] leading-5 text-fg-3">Google Authenticator, Microsoft Authenticator, 1Password ou outro de sua preferência.</p>
          </div>
        </li>
        <li className="flex gap-3">
          <StepNumber n={2} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">Leia o QR code com o aplicativo</p>
            <AuthErrorAlert error={setupError} className="mt-3" />
            {setupError ? (
              <Button variant="secondary" size="sm" icon={RefreshCw} className="mt-3" onClick={() => void generate()}>
                Tentar de novo
              </Button>
            ) : (
              <div className="mt-3 flex flex-col items-start gap-3">
                <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
                  {setup ? (
                    <img src={setup.qr} alt="QR code para configurar o 2FA no aplicativo autenticador" width={176} height={176} className="h-44 w-44 rounded-md" />
                  ) : (
                    <Skeleton className="h-44 w-44" />
                  )}
                </div>
                <div className="w-full min-w-0">
                  <p className="text-xs text-fg-3">Não consegue ler? Digite esta chave no aplicativo:</p>
                  <div className="mt-1.5 flex items-center gap-1 rounded-lg border border-line bg-surface-2 py-1 pl-3 pr-1">
                    {setup ? (
                      <SecretKey secret={setup.secret} />
                    ) : (
                      <Skeleton className="my-1.5 h-4 flex-1" />
                    )}
                    {setup && <CopyButton value={setup.secret} label="Copiar chave" />}
                  </div>
                </div>
              </div>
            )}
          </div>
        </li>
        <li className="flex gap-3">
          <StepNumber n={3} />
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-sm font-semibold text-fg">Digite o código de 6 dígitos</p>
            <AuthErrorAlert error={error} className="mb-3" />
            <CodeInput
              id="enroll-code"
              label="Código de 6 dígitos mostrado no aplicativo"
              value={code}
              onChange={(v) => {
                setCode(v)
                if (error && v) setError(null)
              }}
              onComplete={(v) => void enable(v)}
              disabled={!setup || busy}
              invalid={!!error && !code}
            />
            <Button
              variant="primary"
              size="lg"
              block
              icon={ShieldCheck}
              className="mt-4"
              loading={busy}
              disabled={!setup || code.length !== 6}
              onClick={() => void enable(code)}
            >
              {busy ? 'Confirmando…' : 'Ligar o 2FA'}
            </Button>
          </div>
        </li>
      </ol>
      {setup && (
        <div className="mt-5 text-center">
          <button type="button" className="link inline-flex items-center gap-1.5 text-[13px]" onClick={() => void generate()}>
            <RefreshCw size={13} aria-hidden /> Gerar outro QR code
          </button>
        </div>
      )}
    </AuthCard>
  )
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[13px] font-bold text-primary-text" aria-hidden>
      {n}
    </span>
  )
}

/** Mostrada pelo AuthFlow enquanto useAuthApi().recoveryCodes estiver guardado. */
export function RecoveryCodes({ codes, email, onContinue }: { codes: string[]; email: string; onContinue: () => Promise<unknown> }) {
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <AuthCard
      icon={KeyRound}
      tone="success"
      title="Guarde os códigos de recuperação"
      description="O 2FA está ligado. Se você perder o celular, entre com um destes códigos. Cada um funciona uma única vez e eles não serão mostrados de novo."
    >
      <RecoveryCodesList codes={codes} email={email} />
      <Checkbox
        className="mt-5"
        checked={saved}
        onChange={setSaved}
        label="Guardei os códigos em um lugar seguro"
        description="Sem eles e sem o celular, só um administrador consegue liberar o seu acesso."
      />
      <Button
        variant="primary"
        size="lg"
        block
        iconRight={ArrowRight}
        className="mt-5"
        disabled={!saved}
        loading={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onContinue()
          } finally {
            setBusy(false)
          }
        }}
      >
        Continuar para o painel
      </Button>
    </AuthCard>
  )
}

/** Lista dos códigos de recuperação com "Copiar" e "Baixar .txt" (cadastro no login e "Ativar 2FA" do menu). */
export function RecoveryCodesList({ codes, email }: { codes: string[]; email: string }) {
  return (
    <>
      {/* um código por linha: XXXXX-XXXXX-XXXXX-XXXXX não cabe em duas colunas */}
      <ol className="grid gap-1.5 rounded-xl border border-line bg-surface-2 p-3" aria-label="Códigos de recuperação">
        {codes.map((c, i) => (
          <li key={c} className="flex items-center gap-2.5 rounded-lg bg-surface px-3 py-2 ring-1 ring-inset ring-line">
            <span className="w-4 shrink-0 text-right text-[11px] font-medium text-fg-3 tnum">{i + 1}</span>
            <code className="min-w-0 break-all font-mono text-[13px] font-semibold tracking-wide text-fg">{c}</code>
          </li>
        ))}
      </ol>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          icon={Copy}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(codes.join('\n'))
              toast.success('Códigos copiados', { description: 'Cole em um cofre de senhas.' })
            } catch {
              toast.error('Não foi possível copiar', { description: 'Use "Baixar .txt" ou anote os códigos.' })
            }
          }}
        >
          Copiar
        </Button>
        <Button
          variant="secondary"
          icon={Download}
          onClick={() => {
            downloadCodes(codes, email)
            toast.success('Arquivo baixado', { description: 'Guarde em um lugar seguro.' })
          }}
        >
          Baixar .txt
        </Button>
      </div>
    </>
  )
}
