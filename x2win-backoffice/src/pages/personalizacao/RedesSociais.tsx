import { PageHeader } from '@/components/ui'
import { EmptyState } from '@/components/ui'
import { Hammer } from 'lucide-react'

// TODO: tela em construção (Redes sociais)
export default function RedesSociais() {
  return (
    <>
      <PageHeader />
      <div className="card">
        <EmptyState icon={Hammer} title="Tela em construção" description="Redes sociais" />
      </div>
    </>
  )
}
