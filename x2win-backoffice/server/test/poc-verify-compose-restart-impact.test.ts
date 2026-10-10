// PoC (verificação, impacto): docker-compose.yml não define política de reinício para db, api e web.
//
// Sem a chave `restart:`, o Docker usa a política "no": um contêiner que sai fica parado. Junto com o crash da API
// quando o Postgres derruba uma conexão ociosa (pool sem on('error'), veja poc-r3-runtime-resilience-pg-crash), um
// reinício do banco, um `systemctl restart docker` ou um reboot do host deixa o painel fora do ar até alguém subir os
// contêineres à mão. O HEALTHCHECK do Dockerfile.api não ajuda: o Docker/Compose não reinicia por "unhealthy", e
// /api/health responde ok mesmo sem banco.
//
// Estes testes afirmam o comportamento seguro esperado e falham enquanto o problema existir.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createTestApp } from './helpers'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Bloco de um serviço de primeiro nível em services: (indentação de 2 espaços), sem depender de um parser YAML. */
function serviceBlock(yaml: string, name: string): string {
  const lines = yaml.split('\n')
  const start = lines.findIndex((l) => l === `  ${name}:`)
  if (start < 0) throw new Error(`serviço ${name} não encontrado`)
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (/^ {2}\S/.test(l) || /^\S/.test(l)) break
    out.push(l)
  }
  return out.join('\n')
}

describe('docker-compose: serviços de longa duração voltam sozinhos', () => {
  const yaml = readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8')
  for (const svc of ['db', 'api', 'web']) {
    it(`${svc} tem restart: unless-stopped/always/on-failure`, () => {
      const m = serviceBlock(yaml, svc).match(/^\s{4}restart:\s*["']?([\w-]+)/m)
      expect(m?.[1] ?? 'no (padrão do Docker)').toMatch(/^(unless-stopped|always|on-failure)$/)
    })
  }
})

describe('/api/health reflete o banco', () => {
  it('com o banco fechado, /api/health não diz ok', async () => {
    const app = await createTestApp()
    await app.db.close()
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    // hoje: 200 {"ok":true,"db":"pglite"} mesmo sem banco
    expect(res.statusCode).not.toBe(200)
  })
})
