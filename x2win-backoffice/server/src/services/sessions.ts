// Sessões: o cookie leva um token aleatório; o banco guarda só o hash dele.
import type { FastifyReply } from 'fastify'
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

export async function revokeSession(db: Db, sessionId: string) {
  await db.query('update sessions set revoked_at = now() where id = $1 and revoked_at is null', [sessionId])
}

/** Encerra todas as sessões da pessoa (ex.: ao desativar o acesso). Retorna quantas. */
export async function revokeUserSessions(db: Db, userId: string, exceptSessionId?: string): Promise<number> {
  const rows = await db.query<{ id: string }>(
    `update sessions set revoked_at = now()
     where user_id = $1 and revoked_at is null and ($2::text is null or id <> $2)
     returning id`,
    [userId, exceptSessionId ?? null],
  )
  return rows.length
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
