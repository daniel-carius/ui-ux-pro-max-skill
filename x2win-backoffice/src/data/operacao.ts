// Dados de demonstração do módulo Operação: campanhas exibidas na tela de depósito.
import type { DepositCampaignsConfig } from '@/domain/operacao'
import { daysAgo, iso, DAY, NOW } from './now'

export function seedDepositCampaigns(): DepositCampaignsConfig {
  return {
    maxVisible: 3,
    preselectFirst: false,
    items: [
      {
        id: 'dc-dobro50',
        name: 'Deposite 50 e ganhe o dobro',
        bonusPct: 100,
        minDeposit: 10,
        maxBonus: 500,
        rollover: 10,
        status: 'ativa',
        visible: true,
        endsAt: null,
        audience: 'Todos os jogadores',
      },
      {
        id: 'dc-sexta50',
        name: 'Recarga de sexta: 50% extra',
        bonusPct: 50,
        minDeposit: 30,
        maxBonus: 300,
        rollover: 8,
        status: 'ativa',
        visible: true,
        endsAt: iso(new Date(NOW.getTime() + 20 * DAY)),
        audience: 'Quem já depositou',
      },
      {
        id: 'dc-vip25',
        name: 'Bônus VIP 25% até R$ 2.000',
        bonusPct: 25,
        minDeposit: 500,
        maxBonus: 2000,
        rollover: 5,
        status: 'ativa',
        visible: false,
        endsAt: null,
        audience: 'Etiqueta VIP',
      },
      {
        id: 'dc-domingo',
        name: 'Domingo em dobro',
        bonusPct: 100,
        minDeposit: 20,
        maxBonus: 100,
        rollover: 12,
        status: 'pausada',
        visible: false,
        endsAt: null,
        audience: 'Todos os jogadores',
      },
      {
        id: 'dc-blackfriday',
        name: 'Black Friday 200%',
        bonusPct: 200,
        minDeposit: 50,
        maxBonus: 1000,
        rollover: 20,
        status: 'encerrada',
        visible: false,
        endsAt: iso(daysAgo(315)),
        audience: 'Todos os jogadores',
      },
    ],
  }
}
