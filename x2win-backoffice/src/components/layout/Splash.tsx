// Telas de tela cheia do modo API, mostradas antes do painel: abrindo a sessão
// e sem conexão com o servidor. Ficam fora do AppShell (sem menu lateral).
import { useState } from 'react'
import { RefreshCw, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { BrandMark } from './Brand'

export function SplashScreen({ label = 'Abrindo o painel' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-bg px-4" role="status" aria-live="polite">
      <div className="relative">
        <span className="absolute inset-0 animate-ping rounded-2xl bg-primary/20" aria-hidden />
        <BrandMark size={52} />
      </div>
      <div className="text-center">
        <p className="font-display text-base font-bold tracking-tight text-fg">X2Win Backoffice</p>
        <p className="mt-1 flex items-center justify-center gap-2 text-[13px] text-fg-3">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-hidden />
          {label}…
        </p>
      </div>
    </div>
  )
}

export function OfflineScreen({ message, onRetry }: { message: string; onRetry: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="card w-full max-w-md p-6 text-center sm:p-8">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-warning/10 text-warning">
          <WifiOff size={22} aria-hidden />
        </span>
        <h1 className="text-lg font-bold text-fg">Não foi possível abrir o painel</h1>
        <p className="mt-2 text-[13px] leading-5 text-fg-3">{message}</p>
        <p className="mt-1 text-[13px] leading-5 text-fg-3">Confira a sua conexão. Se o problema continuar, o servidor pode estar em manutenção.</p>
        <Button
          variant="primary"
          icon={RefreshCw}
          className="mt-6"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onRetry()
            } finally {
              setBusy(false)
            }
          }}
        >
          Tentar de novo
        </Button>
      </div>
    </div>
  )
}
