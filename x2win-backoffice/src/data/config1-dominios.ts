// Domínio principal e endereços de acesso (somente leitura no painel).
// IPs usam a faixa reservada para documentação (203.0.113.0/24).
import { createRng } from '@/lib/random'
import { DAY, HOUR, MIN, NOW, iso } from './now'

export const DOMAIN_CHECKS_KEY = 'config.dominios.verificacoes'

export interface AccessHost {
  host: string
  label: string
  purpose: string
  record: { type: 'A' | 'CNAME'; value: string }
}

export const MAIN_DOMAIN = {
  name: 'x2win.bet.br',
  registrar: 'Registro.br (NIC.br)',
  registeredAt: iso(new Date(NOW.getTime() - 431 * DAY)),
  expiresAt: iso(new Date(NOW.getTime() + 299 * DAY)),
  nameservers: ['ns1.plataforma-evox.com', 'ns2.plataforma-evox.com'],
  ssl: {
    issuer: "Let's Encrypt (R11)",
    kind: 'Certificado curinga *.x2win.bet.br',
    validFrom: iso(new Date(NOW.getTime() - 29 * DAY)),
    validUntil: iso(new Date(NOW.getTime() + 61 * DAY)),
    autoRenewDaysBefore: 30,
  },
}

export const ACCESS_HOSTS: AccessHost[] = [
  { host: 'x2win.bet.br', label: 'Domínio principal', purpose: 'Redireciona para www', record: { type: 'A', value: '203.0.113.10' } },
  { host: 'www.x2win.bet.br', label: 'Site', purpose: 'Site do jogador no computador', record: { type: 'CNAME', value: 'edge.plataforma-evox.com' } },
  { host: 'm.x2win.bet.br', label: 'Site no celular', purpose: 'Versão leve para celular', record: { type: 'CNAME', value: 'edge.plataforma-evox.com' } },
  { host: 'api.x2win.bet.br', label: 'API', purpose: 'Usada pelo site, pelo app e pelos webhooks', record: { type: 'CNAME', value: 'api-edge.plataforma-evox.com' } },
  { host: 'painel.x2win.bet.br', label: 'Painel', purpose: 'Este backoffice (acesso da equipe)', record: { type: 'CNAME', value: 'painel.plataforma-evox.com' } },
]

export interface HostResult {
  host: string
  dnsOk: boolean
  httpStatus: number
  latencyMs: number
}

export interface DomainCheck {
  id: string
  at: string
  by: string
  results: HostResult[]
}

/** Verificação simulada (determinística pela semente). */
export function simulateCheck(seed: number, at: Date, by: string): DomainCheck {
  const rng = createRng(seed)
  return {
    id: `chk-${at.getTime()}`,
    at: at.toISOString(),
    by,
    results: ACCESS_HOSTS.map((h) => ({
      host: h.host,
      dnsOk: true,
      httpStatus: h.record.type === 'A' ? 301 : 200,
      latencyMs: h.host.startsWith('api.') ? rng.int(90, 240) : h.host.startsWith('m.') ? rng.int(60, 380) : rng.int(45, 190),
    })),
  }
}

export function seedDomainChecks(): DomainCheck[] {
  const offsets = [14 * MIN, 6 * HOUR + 14 * MIN, 12 * HOUR + 14 * MIN, 18 * HOUR + 14 * MIN, 24 * HOUR + 14 * MIN]
  return offsets.map((o, i) => simulateCheck(7100 + i, new Date(NOW.getTime() - o), 'Verificação automática'))
}
