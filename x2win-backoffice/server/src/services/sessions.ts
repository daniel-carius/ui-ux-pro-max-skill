// Sessões: o cookie leva um token aleatório; o banco guarda só o hash dele.
import type { FastifyReply } from 'fastify'
import type { SessionEndReason } from '@shared/api'
import { SECURITY, type Config } from '../config'
import type { Db } from '../db'
import { randomToken, sha256 } from '../lib/crypto'
import type { SessionStage } from '../types'

export async function createSession(
  db: Db,
  userId: string,
  stage: SessionStage,
  meta: { ip: string; userAgent?: string },
): Promise<{ token: string; id: string }> {
  const token = randomToken(32)
  const id = sha256(token)
  const minutes = stage === 'active' ? SECURITY.sessionAbsoluteHours * 60 : SECURITY.pendingStageMinutes
  await db.query(
    `insert into sessions (id, user_id, stage, expires_at, ip, user_agent)
     values ($1, $2, $3, now() + ($4 || ' minutes')::interval, $5, $6)`,
    [id, userId, stage, String(minutes), meta.ip, (meta.userAgent ?? '').slice(0, 300)],
  )
  return { token, id }
}

/** Avança a etapa da sessão (ex.: '2fa' -> 'active') renovando a validade. */
export async function promoteSession(db: Db, sessionId: string, stage: SessionStage) {
  const minutes = stage === 'active' ? SECURITY.sessionAbsoluteHours * 60 : SECURITY.pendingStageMinutes
  await db.query(
    `update sessions set stage = $2, last_seen_at = now(), expires_at = now() + ($3 || ' minutes')::interval
     where id = $1 and revoked_at is null`,
    [sessionId, stage, String(minutes)],
  )
}

/** Encerra uma sessão guardando o motivo (o painel mostra à pessoa por que saiu). */
export async function revokeSession(db: Db, sessionId: string, reason: SessionEndReason) {
  await db.query('update sessions set revoked_at = now(), revoked_reason = $2 where id = $1 and revoked_at is null', [sessionId, reason])
}

/** Encerra todas as sessões da pessoa (ex.: ao desativar o acesso), com o motivo. Retorna quantas. */
export async function revokeUserSessions(db: Db, userId: string, reason: SessionEndReason, exceptSessionId?: string): Promise<number> {
  const rows = await db.query<{ id: string }>(
    `update sessions set revoked_at = now(), revoked_reason = $3
     where user_id = $1 and revoked_at is null and ($2::text is null or id <> $2)
     returning id`,
    [userId, exceptSessionId ?? null, reason],
  )
  return rows.length
}

/**
 * Por que a sessão deste cookie não vale mais (só para quem tem o cookie dela): motivo gravado ao encerrar,
 * validade vencida ou acesso desativado. null = cookie desconhecido.
 */
export async function sessionEndReason(db: Db, sessionId: string): Promise<SessionEndReason | null> {
  const row = await db.one<{ revoked_reason: string | null; revoked: boolean; expired: boolean; status: string }>(
    `select s.revoked_reason, s.revoked_at is not null as revoked, s.expires_at <= now() as expired, u.status
       from sessions s join users u on u.id = s.user_id
      where s.id = $1`,
    [sessionId],
  )
  if (!row) return null
  if (row.revoked && row.revoked_reason) return row.revoked_reason as SessionEndReason
  if (row.status !== 'ativo') return 'desativado'
  if (row.expired) return 'expirada'
  return null
}

export function setSessionCookie(reply: FastifyReply, token: string, config: Config) {
  reply.setCookie(SECURITY.sessionCookie, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: config.COOKIE_SECURE,
    maxAge: SECURITY.sessionAbsoluteHours * 3600,
  })
}

export function clearSessionCookie(reply: FastifyReply, config: Config) {
  reply.clearCookie(SECURITY.sessionCookie, { path: '/', httpOnly: true, sameSite: 'strict', secure: config.COOKIE_SECURE })
}
