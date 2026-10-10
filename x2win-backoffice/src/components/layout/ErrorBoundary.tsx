// Erro inesperado numa tela: mostra um aviso no lugar dela, sem derrubar o painel inteiro
// (menu, topo e as outras telas continuam funcionando).
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
// import direto (e não de '@/components/ui') para não criar ciclo
import { Button } from '@/components/ui/Button'

interface Props {
  children: ReactNode
  /** muda a cada troca de tela: a tela nova começa sem o erro da anterior */
  resetKey?: string
  /** painel inteiro (fora do menu): o aviso ocupa a página */
  fullPage?: boolean
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[painel] erro ao mostrar a tela', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className={this.props.fullPage ? 'flex min-h-dvh items-center justify-center bg-bg px-4' : 'px-0'}>
        <div role="alert" className="card mx-auto mt-10 max-w-xl p-6 text-center">
          <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-danger/10 text-danger">
            <AlertTriangle size={20} aria-hidden />
          </span>
          <p className="text-base font-semibold text-fg">Esta tela encontrou um erro</p>
          <p className="mt-1.5 text-sm leading-6 text-fg-2">
            O restante do painel continua funcionando. Tente abrir a tela de novo; se continuar, recarregue a página e avise a equipe técnica com o
            que você estava fazendo.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="primary" icon={RotateCcw} onClick={() => this.setState({ error: null })}>
              Tentar de novo
            </Button>
            <Button onClick={() => window.location.reload()}>Recarregar a página</Button>
          </div>
        </div>
      </div>
    )
  }
}
