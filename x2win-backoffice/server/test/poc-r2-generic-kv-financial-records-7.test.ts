// PoC (round 2, #7): as chaves de campanha (campanhas.cupons, campanhas.bonus-deposito,
// campanhas.cashback) são genéricas: o servidor grava qualquer JSON. Os limites de negócio
// (bônus de cupom <= 500%, rollover 0-100, bônus de depósito 1-500% com teto obrigatório,
// cashback fixo 0,1-50%, rakeback <= 5% por categoria) existem só no navegador
// (src/domain/campanhas2-cupons.ts couponErrors, campanhas-bonus.ts validateDepositBonus,
// campanhas3-cashback.ts validateCashback).
// Asserções do comportamento SEGURO (servidor recusa valores fora dos limites com 4xx):
// o teste FALHA enquanto o servidor aceitar (200).
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, createTestApp, loginAs } from './helpers'
import { couponErrors } from '@/domain/campanhas2-cupons'
import { validateDepositBonus } from '@/domain/campanhas-bonus'
import { validateCashback, DEFAULT_CASHBACK } from '@/domain/campanhas3-cashback'

describe('Campanhas: limites de recompensa só no navegador', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => {
    await app.close()
  })

  it("cargo semeado 'marketing' (cupons.editar) grava cupom de 100000% sem teto e sem rollover", async () => {
    const roles = await app.db.query<{ id: string; permissions: string[] }>(`select id, permissions from roles where id = 'marketing'`)
    expect(roles.length).toBe(1)
    expect(roles[0].permissions).toContain('cupons.editar')
    const mk = await loginAs(app, 'marketing')
    const coupon = {
      id: 'c-vip',
      code: 'VIP-100K',
      reward: 'bonus_pct',
      value: 100000,
      maxBonus: 0,
      rollover: 0,
      maxUses: 0,
      uses: 0,
      perPlayer: 1000000,
      minDeposit: 1,
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2099-01-01T00:00:00.000Z',
      paused: false,
      createdBy: 'Daniel Carius',
    }
    // controle: o painel recusaria este cupom
    const panelErrors = couponErrors(coupon as never, [])
    console.log('panel couponErrors:', JSON.stringify(panelErrors))
    expect(panelErrors.value).toBeTruthy()

    const res = await api(app, 'PUT', '/api/kv/campanhas.cupons', { cookie: mk.cookie, body: { value: [coupon], version: 0 } })
    console.log('PUT campanhas.cupons (marketing):', res.statusCode, res.body.slice(0, 200))
    const audit = await app.db.query<{ summary: string }>(`select summary from audit_log where summary like 'campanhas.cupons —%'`)
    console.log('audit:', JSON.stringify(audit.map((a) => a.summary)))
    // seguro: o servidor recusa o valor fora do limite
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })

  it("cargo 'marketing-oficial' grava cashback fixo de 5000% e rakeback de 400% em slots", async () => {
    const mo = await loginAs(app, 'marketing-oficial', { totp: true })
    const value = JSON.parse(JSON.stringify(DEFAULT_CASHBACK))
    value.cashback.enabled = true
    value.cashback.mode = 'fixo'
    value.cashback.pct = 5000
    value.cashback.cap = 0
    value.cashback.rollover = 0
    value.rakeback.enabled = true
    value.rakeback.pct.slots = 400
    const panelError = validateCashback(value)
    console.log('panel validateCashback:', panelError)
    expect(panelError).toBeTruthy()

    const res = await api(app, 'PUT', '/api/kv/campanhas.cashback', { cookie: mo.cookie, body: { value, version: 0 } })
    console.log('PUT campanhas.cashback (marketing-oficial):', res.statusCode, res.body.slice(0, 200))
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })

  it("cargo 'marketing-oficial' grava bônus de depósito de 100000% sem teto e sem rollover", async () => {
    const mo = await loginAs(app, 'marketing-oficial', { totp: true })
    const camp = {
      id: 'b-1',
      name: 'Boas-vindas VIP',
      active: true,
      depositTrigger: 'qualquer',
      bonusPct: 100000,
      minDeposit: 10,
      maxBonus: 0,
      rollover: 0,
      rolloverBase: 'bonus',
      validityDays: 30,
    }
    const panelErrors = validateDepositBonus(camp as never)
    console.log('panel validateDepositBonus:', JSON.stringify(panelErrors))
    expect(panelErrors.bonusPct).toBeTruthy()
    expect(panelErrors.maxBonus).toBeTruthy()

    const res = await api(app, 'PUT', '/api/kv/campanhas.bonus-deposito', { cookie: mo.cookie, body: { value: [camp], version: 0 } })
    console.log('PUT campanhas.bonus-deposito (marketing-oficial):', res.statusCode, res.body.slice(0, 200))
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
  })
})
