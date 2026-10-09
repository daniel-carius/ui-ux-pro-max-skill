// PoC r1-exposure-6: maskPii para os campos ip/lastIp só reconhece IPv4
// (`value.replace(/\.\d+\.\d+$/, '.***.***')`). IPv6, IPv4 com porta e listas
// "x-forwarded-for" (só a última entrada é mascarada) voltam por inteiro para quem
// não tem usuarios.ver-dados. Os testes afirmam o comportamento SEGURO (o IP não sai
// completo) e falham enquanto o problema existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { isMasked, maskPii } from '../src/lib/mask'
import { api, createTestApp, loginAs } from './helpers'

const IPV6 = '2804:14c:65a1:4321:abcd:1234:5678:9abc'
const IPV6_LAST = '2804:7f4:3b80:10::1f'
const FORWARDED = '189.45.12.207, 10.0.0.1'
const WITH_PORT = '189.45.12.207:51234'

describe('poc r1-exposure-6: máscara de IP só cobre IPv4', () => {
  it('unidade: maskPii não devolve IPv6 / lista / IP com porta por inteiro', () => {
    for (const field of ['ip', 'lastIp']) {
      const v6 = maskPii(field, IPV6)
      expect(v6, `${field} IPv6`).not.toBe(IPV6)
      expect(isMasked(v6), `${field} IPv6 marcado como máscara`).toBe(true)
    }
    expect(maskPii('ip', FORWARDED)).not.toContain('189.45.12.207')
    expect(maskPii('ip', WITH_PORT)).not.toContain('189.45.12.207')
  })

  describe('ponta a ponta: GET /api/kv/geral.jogadores', () => {
    let app: FastifyInstance
    let admin: string
    let suporte: string
    let marketing: string
    const players = [
      { id: 'p1', name: 'Ana IPv6', email: 'ana@exemplo.com', ip: IPV6, lastIp: IPV6_LAST, status: 'ativo', balanceReal: 10, tags: [] },
      { id: 'p2', name: 'Beto Proxy', email: 'beto@exemplo.com', ip: FORWARDED, lastIp: WITH_PORT, status: 'ativo', balanceReal: 5, tags: [] },
      { id: 'p3', name: 'Caio IPv4', email: 'caio@exemplo.com', ip: '200.150.10.20', status: 'ativo', balanceReal: 1, tags: [] },
    ]

    beforeAll(async () => {
      app = await createTestApp()
      admin = (await loginAs(app, 'superadmin')).cookie
      suporte = (await loginAs(app, 'suporte')).cookie
      marketing = (await loginAs(app, 'marketing')).cookie
      const w = await api(app, 'PUT', '/api/kv/geral.jogadores', { cookie: admin, body: { value: players } })
      expect(w.statusCode).toBe(200)
    })
    afterAll(async () => app.close())

    for (const who of ['suporte', 'marketing'] as const) {
      it(`${who} (sem usuarios.ver-dados) não recebe o IP completo`, async () => {
        const cookie = who === 'suporte' ? suporte : marketing
        const r = await api(app, 'GET', '/api/kv/geral.jogadores', { cookie })
        expect(r.statusCode).toBe(200)
        const v = r.json().value as Array<Record<string, string>>
        // controle: IPv4 simples é mascarado e email também
        expect(v[2].ip).toBe('200.150.***.***')
        expect(v[0].email).toBe('an***@exemplo.com')
        // IPv6 / lista / porta
        console.log(`[${who}] p1.ip=${v[0].ip} p1.lastIp=${v[0].lastIp} p2.ip=${v[1].ip} p2.lastIp=${v[1].lastIp}`)
        expect(v[0].ip).not.toBe(IPV6)
        expect(v[0].lastIp).not.toBe(IPV6_LAST)
        expect(v[1].ip).not.toContain('189.45.12.207')
        expect(v[1].lastIp).not.toContain('189.45.12.207')
      })
    }
  })
})
