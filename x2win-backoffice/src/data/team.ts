// Equipe do painel e histórico de auditoria.
import { createRng } from '@/lib/random'
import { DAY, HOUR, MIN, NOW, iso } from './now'

export interface TeamMember {
  id: string
  name: string
  email: string
  roleId: string
  status: 'ativo' | 'desligado' | 'convidado'
  twoFactor: boolean
  lastAccess: string | null
  lastIp: string | null
  createdAt: string
  activeSessions: number
}

export function seedTeam(): TeamMember[] {
  return [
    {
      id: 'u1',
      name: 'Daniel Carius',
      email: 'daniel@x2win.bet',
      roleId: 'superadmin',
      status: 'ativo',
      twoFactor: true,
      lastAccess: iso(new Date(NOW.getTime() - 2 * MIN)),
      lastIp: '189.45.12.207',
      createdAt: iso(new Date(NOW.getTime() - 420 * DAY)),
      activeSessions: 1,
    },
    {
      id: 'u2',
      name: 'Rafael Lima',
      email: 'rafael@x2win.bet',
      roleId: 'adm',
      status: 'ativo',
      twoFactor: false,
      lastAccess: iso(new Date(NOW.getTime() - 3 * HOUR)),
      lastIp: '177.92.40.18',
      createdAt: iso(new Date(NOW.getTime() - 300 * DAY)),
      activeSessions: 2,
    },
    {
      id: 'u3',
      name: 'Beatriz Souza',
      email: 'beatriz@x2win.bet',
      roleId: 'adm',
      status: 'ativo',
      twoFactor: true,
      lastAccess: iso(new Date(NOW.getTime() - 26 * HOUR)),
      lastIp: '201.17.88.3',
      createdAt: iso(new Date(NOW.getTime() - 190 * DAY)),
      activeSessions: 1,
    },
    {
      id: 'u4',
      name: 'Camila Rocha',
      email: 'camila.mkt@x2win.bet',
      roleId: 'marketing-oficial',
      status: 'ativo',
      twoFactor: true,
      lastAccess: iso(new Date(NOW.getTime() - 5 * HOUR)),
      lastIp: '187.33.101.54',
      createdAt: iso(new Date(NOW.getTime() - 120 * DAY)),
      activeSessions: 1,
    },
    {
      id: 'u5',
      name: 'Lucas Mendes',
      email: 'lucas.mkt@x2win.bet',
      roleId: 'marketing',
      status: 'ativo',
      twoFactor: false,
      lastAccess: iso(new Date(NOW.getTime() - 3 * DAY)),
      lastIp: '191.12.77.240',
      createdAt: iso(new Date(NOW.getTime() - 60 * DAY)),
      activeSessions: 0,
    },
    {
      id: 'u6',
      name: 'Pedro Santos',
      email: 'pedro@x2win.bet',
      roleId: 'suporte',
      status: 'desligado',
      twoFactor: false,
      lastAccess: iso(new Date(NOW.getTime() - 48 * DAY)),
      lastIp: '179.104.6.91',
      createdAt: iso(new Date(NOW.getTime() - 260 * DAY)),
      activeSessions: 0,
    },
  ]
}

export { AUDIT_ACTION_LABEL, type AuditAction, type AuditEntry } from '@shared/audit'
import type { AuditAction, AuditEntry } from '@shared/audit'



export function seedAudit(): AuditEntry[] {
  const rng = createRng(7070)
  const actors = seedTeam()
  const templates: [AuditAction, string, string][] = [
    ['login', 'Sessão', 'Login com e-mail e senha'],
    ['aprovar', 'Saque', 'Saque aprovado'],
    ['recusar', 'Saque', 'Saque recusado: rollover não cumprido'],
    ['editar', 'Regras de saque', 'Limite diário alterado de 3 para 2'],
    ['editar', 'Banner Hero', 'Imagem do banner trocada'],
    ['criar', 'Promoção', 'Promoção "Sexta Turbo" criada'],
    ['editar', 'Free Spins', 'Campanha "100 giros no 2º depósito" editada'],
    ['exportar', 'Usuários', 'Exportação CSV de jogadores (filtro: VIP)'],
    ['exportar', 'Transações', 'Exportação CSV de transações (30 dias)'],
    ['editar', 'Identidade e tema', 'Cor primária alterada'],
    ['editar', 'Página inicial', 'Ordem dos blocos da home alterada'],
    ['enviar', 'Disparo', 'Disparo de e-mail para 4.210 jogadores'],
    ['editar', 'Ficha do jogador', 'Etiqueta "VIP" adicionada'],
    ['sincronizar', 'Agregador Metagrator', 'Catálogo sincronizado (1.840 jogos)'],
    ['editar', 'Comissões', 'Rev Share de Influencer alterado para 30%'],
    ['bloquear', 'IP', 'IP bloqueado no site'],
    ['criar', 'Chave MCP', 'Chave "Relatórios Claude" criada'],
  ]
  const out: AuditEntry[] = []
  let t = NOW.getTime() - 20 * MIN
  for (let i = 0; i < 160; i++) {
    t -= rng.int(10, 360) * MIN
    const actor = rng.weighted([
      [actors[0], 5],
      [actors[1], 4],
      [actors[2], 2],
      [actors[3], 3],
      [actors[4], 1],
    ] as const)
    const [action, entity, summary] = rng.pick(templates)
    const ref =
      entity === 'Saque' ? ` #SQ${73000 + rng.int(12, 95) * 17}` : entity === 'Ficha do jogador' ? ` #${100231 + rng.int(0, 300) * 7}` : ''
    out.push({
      id: `au${i}`,
      at: iso(new Date(t)),
      actorId: actor.id,
      actorName: actor.name,
      action,
      entity: entity + ref,
      summary,
      ip: actor.lastIp ?? '0.0.0.0',
    })
  }
  return out
}
