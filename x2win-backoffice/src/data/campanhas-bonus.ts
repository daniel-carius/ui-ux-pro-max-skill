// Campanhas de bônus de depósito de demonstração.
import { createRng } from '@/lib/random'
import type { DepositBonusCampaign } from '@/domain/campanhas-bonus'
import { DAY, NOW, iso } from './now'
import { demoRecords } from './demo'

export const DEPOSIT_BONUS_KEY = 'campanhas.bonus-deposito'

const at = (days: number) => iso(new Date(NOW.getTime() + days * DAY))

export function seedDepositBonus(): DepositBonusCampaign[] {
  return [
    {
      id: 'db01',
      name: 'Deposite 50 e ganhe o dobro',
      active: true,
      bonusPct: 100,
      minDeposit: 10,
      maxBonus: 500,
      rollover: 10,
      rolloverBase: 'bonus',
      usage: 'uma_vez',
      depositTrigger: 'qualquer',
      validityDays: 7,
      redemptions: 1284,
      bonusGranted: 78830.5,
      bonusConverted: 14190.2,
      createdAt: at(-44),
      updatedAt: at(-6),
      updatedBy: 'Marina Duarte',
    },
    {
      id: 'db02',
      name: 'Recarga de sexta 50%',
      active: false,
      bonusPct: 50,
      minDeposit: 30,
      maxBonus: 200,
      rollover: 12,
      rolloverBase: 'deposito_bonus',
      usage: 'diario',
      depositTrigger: 'qualquer',
      validityDays: 3,
      redemptions: 640,
      bonusGranted: 21400,
      bonusConverted: 3120.75,
      createdAt: at(-80),
      updatedAt: at(-22),
      updatedBy: 'Rafael Monteiro',
    },
    {
      id: 'db03',
      name: 'Boas-vindas 200%',
      active: false,
      bonusPct: 200,
      minDeposit: 30,
      maxBonus: 1000,
      rollover: 20,
      rolloverBase: 'deposito_bonus',
      usage: 'uma_vez',
      depositTrigger: 'primeiro',
      validityDays: 14,
      redemptions: 1960,
      bonusGranted: 87612.3,
      bonusConverted: 9870.4,
      createdAt: at(-130),
      updatedAt: at(-60),
      updatedBy: 'Daniel Carius',
    },
    {
      id: 'db04',
      name: 'Reativação 30%',
      active: false,
      bonusPct: 30,
      minDeposit: 20,
      maxBonus: 150,
      rollover: 8,
      rolloverBase: 'bonus',
      usage: 'uma_vez',
      depositTrigger: 'qualquer',
      validityDays: 10,
      redemptions: 0,
      bonusGranted: 0,
      bonusConverted: 0,
      createdAt: at(-9),
      updatedAt: at(-9),
      updatedBy: 'Marina Duarte',
    },
  ]
}

/** Resgates diários (30 dias) para o gráfico do topo. */
export function depositBonusDaily(): { day: string; resgates: number; bonus: number }[] {
  const rng = createRng(919)
  const out: { day: string; resgates: number; bonus: number }[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(NOW.getTime() - i * DAY)
    const weekend = d.getDay() === 5 || d.getDay() === 6 || d.getDay() === 0
    const r = Math.round(rng.int(26, 44) * (weekend ? 1.35 : 1))
    out.push({ day: iso(d), resgates: r, bonus: Math.round(r * rng.float(48, 74) * 100) / 100 })
  }
  return out
}

// modo API: registros só do servidor (sem nada gravado, lista vazia; o gerador não roda)
demoRecords(seedDepositBonus)
