import { Link } from 'react-router-dom'
import { Compass, Lock } from 'lucide-react'
import { PAGE_BY_ID } from '@/nav'
import { PageIdProvider, useRoles, useSession } from '@/domain/session'
import { Button, EmptyState } from '@/components/ui'
import { PAGE_COMPONENTS } from '@/routes'

/** Envolve cada tela: define o contexto de permissão e bloqueia quem não tem acesso. */
export function PageFrame({ pageId }: { pageId: string }) {
  const { canView, role, setViewAs, isSimulating } = useSession()
  const [roles] = useRoles()
  const Comp = PAGE_COMPONENTS[pageId]
  const page = PAGE_BY_ID.get(pageId)
  if (!canView(pageId)) {
    const allowed = roles.filter((r) => r.permissions.includes(`${pageId}.ver`) || r.permissions.includes(`${pageId}.editar`))
    return (
      <div className="card mx-auto mt-10 max-w-xl">
        <EmptyState
          icon={Lock}
          title={`Sem acesso a ${page?.title ?? 'esta tela'}`}
          description={`O cargo ${role.name} não tem permissão para ver esta tela. Cargos com acesso: ${allowed.map((r) => r.name).join(', ') || 'nenhum'}.`}
          action={
            isSimulating ? (
              <Button variant="primary" onClick={() => setViewAs(null)}>
                Voltar ao meu cargo
              </Button>
            ) : (
              <Link to="/dashboard" className="link">
                Ir para o Dashboard
              </Link>
            )
          }
        />
      </div>
    )
  }
  return (
    <PageIdProvider value={pageId}>
      <Comp />
    </PageIdProvider>
  )
}

export function NotFound() {
  return (
    <div className="card mx-auto mt-10 max-w-xl">
      <EmptyState
        icon={Compass}
        title="Página não encontrada"
        description="O endereço não existe ou mudou. Use a busca de páginas (Ctrl + K) para achar a tela."
        action={
          <Link to="/dashboard" className="link">
            Ir para o Dashboard
          </Link>
        }
      />
    </div>
  )
}
