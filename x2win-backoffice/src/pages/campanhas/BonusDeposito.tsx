import { PageHeader } from '@/components/ui'
import { EmptyState } from '@/components/ui'
import { Hammer } from 'lucide-react'

// TODO: tela em construção (Bônus de depósito)
export default function BonusDeposito() {
  return (
    <>
      <PageHeader />
      <div className="card">
        <EmptyState icon={Hammer} title="Tela em construção" description="Bônus de depósito" />
      </div>
    </>
  )
}
