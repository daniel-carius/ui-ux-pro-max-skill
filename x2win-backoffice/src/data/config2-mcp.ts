// Dados de demonstração das chaves de IA (MCP) e do uso delas.
import { createRng } from '@/lib/random'
import type { McpKey, McpUsage } from '@/domain/config2-mcp'
import { DAY, HOUR, MIN, NOW, iso } from './now'
import { demoRecords } from './demo'

export const MCP_KEYS = {
  keys: 'config.mcp.chaves',
  usage: 'config.mcp.uso',
} as const

const ago = (ms: number) => iso(new Date(NOW.getTime() - ms))
const ahead = (ms: number) => iso(new Date(NOW.getTime() + ms))

export function seedMcpKeys(): McpKey[] {
  return [
    {
      id: 'mk1',
      name: 'Relatórios Claude',
      last4: 'q7e2',
      createdById: 'u1',
      createdByName: 'Daniel Carius',
      scope: 'leitura',
      createdAt: ago(41 * DAY),
      lastUsedAt: ago(2 * HOUR + 14 * MIN),
      expiresAt: ahead(49 * DAY),
      revokedAt: null,
      revokedBy: null,
      client: 'Claude Desktop',
    },
    {
      id: 'mk2',
      name: 'Conciliação financeira',
      last4: '81kd',
      createdById: 'u2',
      createdByName: 'Rafael Lima',
      scope: 'escrita',
      createdAt: ago(23 * DAY),
      lastUsedAt: ago(5 * HOUR),
      expiresAt: null,
      revokedAt: null,
      revokedBy: null,
      client: 'Cursor',
    },
    {
      id: 'mk3',
      name: 'Automação de campanhas',
      last4: 'zz04',
      createdById: 'u5',
      createdByName: 'Lucas Mendes',
      scope: 'escrita',
      createdAt: ago(12 * DAY),
      lastUsedAt: ago(3 * DAY + 2 * HOUR),
      expiresAt: ahead(78 * DAY),
      revokedAt: null,
      revokedBy: null,
      client: 'Claude Code',
    },
    {
      id: 'mk4',
      name: 'Painel de campanhas (agência)',
      last4: 'p3m9',
      createdById: 'u4',
      createdByName: 'Camila Rocha',
      scope: 'leitura',
      createdAt: ago(64 * DAY),
      lastUsedAt: ago(31 * DAY),
      expiresAt: ago(4 * DAY),
      revokedAt: null,
      revokedBy: null,
      client: 'Claude Desktop',
    },
    {
      id: 'mk5',
      name: 'Teste suporte',
      last4: 'a1b2',
      createdById: 'u6',
      createdByName: 'Pedro Santos',
      scope: 'leitura',
      createdAt: ago(150 * DAY),
      lastUsedAt: ago(52 * DAY),
      expiresAt: ahead(30 * DAY),
      revokedAt: null,
      revokedBy: null,
      client: 'Claude Desktop',
    },
    {
      id: 'mk6',
      name: 'Script antigo de saques',
      last4: '9x0c',
      createdById: 'u1',
      createdByName: 'Daniel Carius',
      scope: 'escrita',
      createdAt: ago(200 * DAY),
      lastUsedAt: ago(120 * DAY),
      expiresAt: null,
      revokedAt: ago(90 * DAY),
      revokedBy: 'Daniel Carius',
      client: 'Script interno',
    },
  ]
}

const TOOLS: [string, string, boolean][] = [
  ['consultar_ggr', 'ggr.ver', false],
  ['resumo_dashboard', 'dashboard.ver', false],
  ['listar_saques', 'saques.ver', false],
  ['buscar_jogador', 'usuarios.ver', false],
  ['listar_promocoes', 'promocoes.ver', false],
  ['editar_promocao', 'promocoes.editar', true],
  ['criar_cupom', 'cupons.editar', true],
  ['aprovar_saque', 'saques.aprovar', true],
  ['exportar_transacoes', 'transacoes.exportar', true],
  ['listar_depositos', 'depositos.ver', false],
]

const KEY_TOOLS: Record<string, number[]> = {
  mk1: [0, 1, 2, 9, 0, 1],
  mk2: [2, 9, 8, 7, 3, 0],
  mk3: [4, 5, 6, 4, 5, 1],
}

export function seedMcpUsage(): McpUsage[] {
  const rng = createRng(4404)
  const keys = seedMcpKeys()
  const ips: Record<string, string> = { mk1: '189.45.12.207', mk2: '177.92.40.18', mk3: '191.12.77.240' }
  const out: McpUsage[] = []
  let t = NOW.getTime() - 2 * HOUR - 14 * MIN
  for (let i = 0; i < 36; i++) {
    const keyId = rng.weighted([
      ['mk1', 5],
      ['mk2', 3],
      ['mk3', 2],
    ] as const)
    const key = keys.find((k) => k.id === keyId)!
    const [tool, permission, write] = TOOLS[rng.pick(KEY_TOOLS[keyId])]
    // somente leitura nunca escreve; aprovar saque é negado ao ADM (sem permissão)
    const denied = (key.scope === 'leitura' && write) || tool === 'aprovar_saque' || (keyId === 'mk2' && tool === 'exportar_transacoes')
    const error = !denied && rng.bool(0.06)
    out.push({
      id: `mu${i}`,
      at: iso(new Date(t)),
      keyId,
      keyName: key.name,
      tool,
      permission,
      result: denied ? 'negado' : error ? 'erro' : 'ok',
      ip: ips[keyId],
      ms: rng.int(80, error ? 9000 : 900),
    })
    t -= rng.int(15, 420) * MIN
  }
  return out
}

// modo API: registros só do servidor (sem nada gravado, lista vazia; o gerador não roda)
demoRecords(seedMcpKeys)
demoRecords(seedMcpUsage)
