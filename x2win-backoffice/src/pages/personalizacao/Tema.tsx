import { PageHeader } from '@/components/ui'
import { EmptyState } from '@/components/ui'
import { Hammer } from 'lucide-react'

// TODO: tela em construção (Identidade e tema)
export default function Tema() {
  return (
    <>
      <PageHeader />
      <div className="card">
        <EmptyState icon={Hammer} title="Tela em construção" description="Identidade e tema" />
      </div>
    </>
  )
}
