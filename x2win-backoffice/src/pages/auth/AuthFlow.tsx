// Portão de entrada do modo API: escolhe a tela pela situação da sessão.
// Carregado sob demanda por SessionProvider (src/domain/session.tsx).
import { useAuthApi } from '@/domain/session'
import { AuthLayout } from './_shared'
import { ChangePasswordPage } from './ChangePasswordPage'
import { EnrollTwoFactorPage, RecoveryCodes } from './EnrollTwoFactorPage'
import { LoginPage } from './LoginPage'
import { TwoFactorPage } from './TwoFactorPage'

export default function AuthFlow() {
  const { status, recoveryCodes, releaseRecoveryCodes } = useAuthApi()
  let page
  // códigos de recuperação recém-gerados: ficam até a pessoa confirmar, mesmo que /me já diga 'active'
  if (recoveryCodes) page = <RecoveryCodes key="recovery" codes={recoveryCodes.codes} email={recoveryCodes.email} onContinue={releaseRecoveryCodes} />
  else if (status.kind === 'step' && status.me.stage === 'password') page = <ChangePasswordPage key="password" me={status.me} />
  else if (status.kind === 'step' && status.me.stage === 'enroll') page = <EnrollTwoFactorPage key="enroll" me={status.me} />
  else if (status.kind === 'step' && status.me.stage === '2fa') page = <TwoFactorPage key="2fa" me={status.me} />
  else page = <LoginPage key="login" reason={status.kind === 'login' ? status.reason : undefined} />
  return <AuthLayout>{page}</AuthLayout>
}
