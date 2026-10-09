import { PageHeader } from '@/components/ui'
import { EmptyState } from '@/components/ui'
import { Hammer } from 'lucide-react'

// TODO: tela em construção (Domínios)
export default function Dominios() {
  return (
    <>
      <PageHeader />
      <div className="card">
        <EmptyState icon={Hammer} title="Tela em construção" description="Domínios" />
      </div>
    </>
  )
}
