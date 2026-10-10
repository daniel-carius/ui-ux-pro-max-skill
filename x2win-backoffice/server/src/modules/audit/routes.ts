// Auditoria: eventos relatados pelo painel, consulta paginada e exportação CSV. Prefixo /api/audit.
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { isAuditAction, panelAuditDecision, type AuditAction } from '@shared/audit'
import type { AuditListResponse } from '@shared/api'
import { AppError, Errors } from '../../errors'
import { requireActive, requirePerm } from '../../http'
import { writeAudit } from '../../services/audit'
import { auditCsv, auditFilterSchema, auditListSchema, buildAuditWhere, describeFilter, toAuditEntry, toAuditExportEntry, type AuditRow } from './format'

/** Teto de linhas por exportação (as mais recentes que casam com os filtros). */
export const EXPORT_MAX_ROWS = 50_000

/**
 * Eventos relatados pelo painel: por pessoa (não por sessão: abrir sessões novas pelo login não dá cota nova)
 * e, além disso, por IP (várias contas atrás do mesmo IP não somam cota sem limite).
 */
export const EVENTS_PER_USER_PER_MINUTE = 30
export const EVENTS_PER_IP_PER_MINUTE = 120

const REJECTED_MESSAGE = {
  acao_do_servidor: 'Esta ação é registrada só pelo servidor, quando ela é executada.',
  entidade_do_servidor: 'Este registro é gravado só pelo servidor.',
  evento_desconhecido: 'Este evento não pode ser relatado pelo painel.',
} as const

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

  // segundo limite (o da rota substitui o global por IP do @fastify/rate-limit): conta só o que seria gravado
  const perIpLimit = app.createRateLimit({
    max: EVENTS_PER_IP_PER_MINUTE,
    timeWindow: '1 minute',
    keyGenerator: (req) => `audit-events-ip:${req.clientIp || req.ip}`,
  })

  app.post(
    '/events',
    {
      config: {
        rateLimit: {
          max: EVENTS_PER_USER_PER_MINUTE,
          timeWindow: '1 minute',
          // por pessoa (o plugin de sessão roda antes): sessões novas da mesma pessoa dividem a mesma cota
          keyGenerator: (req) => (req.auth ? `audit-user:${req.auth.user.id}` : `audit-ip:${req.clientIp || req.ip}`),
        },
      },
    },
    async (req, reply) => {
      const auth = requireActive(req)
      const body = eventBody.parse(req.body ?? {})
      // só eventos que a tela realmente relata, e só por quem pode fazer a ação naquela tela;
      // o que o servidor já registra (aprovar, revelar, banir, login, dados por chave...) nunca vem do painel
      const decision = panelAuditDecision(body.action as AuditAction, body.entity)
      if (!decision.ok) throw new AppError(403, 'evento_nao_relatavel', REJECTED_MESSAGE[decision.reason], { reason: decision.reason })
      if (!decision.perms.some((p) => auth.perms.has(p))) throw Errors.forbidden()
      const limit = await perIpLimit(req)
      if (!limit.isAllowed && limit.isExceeded) {
        reply.header('retry-after', String(limit.ttlInSeconds))
        throw new AppError(429, 'muitas_tentativas', 'Muitas tentativas. Aguarde um minuto e tente de novo.')
      }
      // quem, quando e IP vêm sempre do servidor; source = 'painel' (relatado, não verificado)
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
    // e-mail atual de quem fez, juntado na hora da exportação (a auditoria guarda id e nome)
    const rows = await app.db.query<AuditRow>(
      `select a.*, u.email as actor_email
         from (select * from audit_log ${where} order by at desc, id desc limit $${params.length + 1}) a
         left join users u on u.id = a.actor_id
        order by a.at desc, a.id desc`,
      [...params, EXPORT_MAX_ROWS],
    )
    const csv = auditCsv(rows.map(toAuditExportEntry))
    // pessoa filtrada pelo nome e e-mail (não o id interno)
    const who = f.actorId ? await app.db.one<{ name: string; email: string }>('select name, email from users where id = $1', [f.actorId]) : null
    const filters = describeFilter(f, who ? `${who.name} (${who.email})` : null)
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
