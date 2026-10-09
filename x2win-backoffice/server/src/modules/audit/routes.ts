// Auditoria: eventos relatados pelo painel, consulta paginada e exportação CSV. Prefixo /api/audit.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { isAuditAction } from '@shared/audit'
import type { AuditListResponse } from '@shared/api'
import { requireActive, requirePerm } from '../../http'
import { writeAudit } from '../../services/audit'
import { auditCsv, auditFilterSchema, auditListSchema, buildAuditWhere, describeFilter, toAuditEntry, type AuditRow } from './format'

/** Teto de linhas por exportação (as mais recentes que casam com os filtros). */
export const EXPORT_MAX_ROWS = 50_000

const eventBody = z.object({
  action: z
    .string({ error: 'Informe a ação.' })
    .refine((v) => isAuditAction(v), 'Ação desconhecida.')
    .refine((v) => v !== 'login', 'O login é registrado só pelo servidor.'),
  entity: z
    .string({ error: 'Informe a entidade.' })
    .trim()
    .min(1, 'Informe a entidade.')
    .max(200, 'A entidade pode ter no máximo 200 caracteres.'),
  summary: z
    .string({ error: 'Informe o resumo.' })
    .trim()
    .min(1, 'Informe o resumo.')
    .max(1000, 'O resumo pode ter no máximo 1000 caracteres.'),
})

export default async function routes(app: FastifyInstance) {
  // respostas com dados sensíveis (e-mails, IPs, chave PIX, resultado de envio): nunca no cache do navegador/proxy
  app.addHook('onSend', async (_req, reply, payload) => {
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store')
    return payload
  })

  app.post(
    '/events',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
          // por sessão (o plugin de sessão roda antes): cada pessoa tem a sua cota
          keyGenerator: (req) => (req.auth ? `audit:${req.auth.sessionId}` : `audit-ip:${req.clientIp || req.ip}`),
        },
      },
    },
    async (req, reply) => {
      const auth = requireActive(req)
      const body = eventBody.parse(req.body ?? {})
      // quem, quando e IP vêm sempre do servidor
      const row = await app.db.one<{ id: number }>(
        `insert into audit_log (actor_id, actor_name, action, entity, summary, ip, source)
         values ($1, $2, $3, $4, $5, $6, 'painel') returning id`,
        [auth.user.id, auth.user.name, body.action, body.entity, body.summary, auth.ip],
      )
      return reply.status(201).send({ id: String(row?.id) })
    },
  )

  app.get('/', async (req): Promise<AuditListResponse> => {
    requirePerm(req, 'auditoria.ver')
    const q = auditListSchema.parse(req.query ?? {})
    const { where, params } = buildAuditWhere(q)
    const total = await app.db.one<{ n: number }>(`select count(*)::int as n from audit_log ${where}`, params)
    const rows = await app.db.query<AuditRow>(
      `select * from audit_log ${where} order by at desc, id desc limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    )
    return { items: rows.map(toAuditEntry), total: total?.n ?? 0, page: q.page, pageSize: q.pageSize }
  })

  app.get('/export.csv', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const auth = requirePerm(req, 'auditoria.exportar')
    const f = auditFilterSchema.parse(req.query ?? {})
    const { where, params } = buildAuditWhere(f)
    const rows = await app.db.query<AuditRow>(`select * from audit_log ${where} order by at desc, id desc limit $${params.length + 1}`, [
      ...params,
      EXPORT_MAX_ROWS,
    ])
    const csv = auditCsv(rows.map(toAuditEntry))
    const filters = describeFilter(f)
    await writeAudit(app.db, auth, {
      action: 'exportar',
      entity: 'Auditoria',
      summary: `Exportação CSV de ${rows.length.toLocaleString('pt-BR')} registros${filters ? ` (${filters})` : ''}${
        rows.length >= EXPORT_MAX_ROWS ? ' — limite de exportação atingido' : ''
      }`,
    })
    const filename = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .header('cache-control', 'no-store')
      .send(csv)
  })
}
