import { useEffect, useRef } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Compass, Lock } from 'lucide-react'
import { PAGES, PAGE_BY_ID, pageByPath, type PageDef } from '@/nav'
import { PageIdProvider, useRoles, useSession } from '@/domain/session'
import { Button, EmptyState, toast } from '@/components/ui'
import { PAGE_COMPONENTS } from '@/routes'

/** Primeira tela que o cargo vê, na ordem do menu (null = nenhuma). */
export function useHomePage(): PageDef | null {
  const { canView } = useSession()
  return PAGES.find((p) => canView(p.id)) ?? null
}

/** "/" abre a primeira tela que o cargo pode ver (nem todo cargo vê o Dashboard). */
export function HomeRedirect() {
  const home = useHomePage()
  if (!home) return <NoPages />
  return <Navigate to={home.path} replace />
}

/**
 * Ao abrir a sessão: se o endereço na barra (deixado por outra pessoa ou outro cargo, um favorito ou um link de
 * colega) é uma tela que este cargo não vê, vai para a primeira que ele vê e diz por quê (sem o aviso, o link
 * "não abria" sem explicação). Só na abertura: depois, abrir uma tela proibida mostra o cartão "Sem acesso".
 */
export function LandingGuard() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { canView, role } = useSession()
  const home = useHomePage()
  const checked = useRef(false)
  useEffect(() => {
    if (checked.current) return
    checked.current = true
    const page = pageByPath(pathname)
    if (!page || canView(page.id)) return
    toast.warning(`Sem acesso à tela ${page.title}`, {
      description: `O cargo ${role.name} não tem permissão para ver esta tela${home ? `; abrimos ${home.title}` : ''}. Se precisar dela, peça a um administrador para ajustar o seu cargo.`,
      duration: 8000,
    })
    navigate('/', { replace: true })
  }, [pathname, canView, navigate, role.name, home])
  return null
}

function NoPages() {
  const { role } = useSession()
  return (
    <div className="card mx-auto mt-10 max-w-xl">
      <EmptyState
        icon={Lock}
        title="Nenhuma tela liberada"
        description={`O cargo ${role.name} ainda não tem permissão para ver nenhuma tela do painel. Peça a um administrador para ajustar o cargo em Cargos e permissões.`}
      />
    </div>
  )
}

/** Envolve cada tela: define o contexto de permissão e bloqueia quem não tem acesso. */
export function PageFrame({ pageId }: { pageId: string }) {
  const { canView, role, setViewAs, isSimulating } = useSession()
  const [roles] = useRoles()
  const home = useHomePage()
  const Comp = PAGE_COMPONENTS[pageId]
  const page = PAGE_BY_ID.get(pageId)
  if (!canView(pageId)) {
    const allowed = roles.filter((r) => r.permissions.includes(`${pageId}.ver`) || r.permissions.includes(`${pageId}.editar`))
    return (
      <div className="card mx-auto mt-10 max-w-xl">
        <EmptyState
          icon={Lock}
          title={page ? `Sem acesso à tela ${page.title}` : 'Sem acesso a esta tela'}
          description={`O cargo ${role.name} não tem permissão para ver esta tela. Cargos com acesso: ${allowed.map((r) => r.name).join(', ') || 'nenhum'}.`}
          action={
            isSimulating ? (
              <Button variant="primary" onClick={() => setViewAs(null)}>
                Voltar ao meu cargo
              </Button>
            ) : home ? (
              <Link to={home.path} className="link">
                Ir para {home.title}
              </Link>
            ) : undefined
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
  const home = useHomePage()
  return (
    <div className="card mx-auto mt-10 max-w-xl">
      <EmptyState
        icon={Compass}
        title="Página não encontrada"
        description="O endereço não existe ou mudou. Use a busca de páginas (Ctrl + K) para achar a tela."
        action={
          home ? (
            <Link to={home.path} className="link">
              Ir para {home.title}
            </Link>
          ) : undefined
        }
      />
    </div>
  )
}
