import { PageHeader } from '@/components/ui'
import { EmptyState } from '@/components/ui'
import { Hammer } from 'lucide-react'

// TODO: tela em construção (Modo de ataque)
export default function ModoAtaque() {
  return (
    <>
      <PageHeader />
      <div className="card">
        <EmptyState icon={Hammer} title="Tela em construção" description="Modo de ataque" />
      </div>
    </>
  )
}
