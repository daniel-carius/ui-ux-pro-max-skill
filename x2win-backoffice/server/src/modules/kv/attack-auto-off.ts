// Desligamento automático do modo de ataque (seguranca.modo-ataque › autoOffMinutes).
// O servidor confere a cada 30 s: ligado há mais tempo que o escolhido → grava
// active:false (since e activatedBy limpos) e a linha 'desligar' na auditoria em nome
// de "Sistema" ("Desligado automaticamente após 2 h (ligado por <nome>)"). Não depende
// de alguém com o painel aberto; o painel só relê a chave quando o prazo passa. Com
// mais de uma instância da API, a gravação trava a linha e confere de novo: só uma
// desliga.
import type { FastifyInstance } from 'fastify'
import { findKvRule } from '@shared/kv-registry'
import { writeAudit } from '../../services/audit'
import { auditSummary } from './generic'
import { isPlainObject, setOwn, type JsonObject } from './json'
import { ATTACK_MODE_ENTITY, ATTACK_MODE_KEY, durationText } from './rules-system'
import { decodeRow, encryptAtRest, loadRow, saveRow } from './store'

export const ATTACK_AUTO_OFF_INTERVAL_MS = 30_000

const RULE = findKvRule(ATTACK_MODE_KEY)!
const SYSTEM = { id: null, name: 'Sistema', ip: '' }

function autoOffMinutes(v: JsonObject): number {
  const m = v.autoOffMinutes
  return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : 0
}

/** Hora (ms) em que o modo ligado desliga sozinho; null se desligado, só manual ou sem "desde". */
export function attackAutoOffAt(v: unknown): number | null {
  if (!isPlainObject(v) || v.active !== true) return null
  const minutes = autoOffMinutes(v)
  const since = typeof v.since === 'string' ? Date.parse(v.since) : Number.NaN
  if (!minutes || Number.isNaN(since)) return null
  return since + minutes * 60_000
}

/** Desliga o modo de ataque cujo prazo passou. true quando desligou agora. */
export async function runAttackAutoOffOnce(app: FastifyInstance, now = Date.now()): Promise<boolean> {
  // leitura sem trava primeiro: quase sempre não há nada a fazer
  const peek = await loadRow(app.db, ATTACK_MODE_KEY)
  const due = peek ? attackAutoOffAt(decodeRow(peek, app.cipher)) : null
  if (due === null || now < due) return false
  return app.db.tx(async (t) => {
    const row = await loadRow(t, ATTACK_MODE_KEY, true)
    if (!row) return false
    const cur = decodeRow(row, app.cipher)
    const at = attackAutoOffAt(cur)
    if (at === null || now < at || !isPlainObject(cur)) return false
    const next: JsonObject = { ...cur }
    setOwn(next, 'active', false)
    setOwn(next, 'since', null)
    setOwn(next, 'activatedBy', null)
    const saved = await saveRow(t, app.cipher, ATTACK_MODE_KEY, next, encryptAtRest(RULE), row, 'sistema')
    const by = typeof cur.activatedBy === 'string' && cur.activatedBy ? ` (ligado por ${cur.activatedBy})` : ''
    await writeAudit(t, SYSTEM, {
      action: 'desligar',
      entity: ATTACK_MODE_ENTITY,
      summary: auditSummary(ATTACK_MODE_KEY, `Desligado automaticamente após ${durationText(autoOffMinutes(cur) * 60_000)}${by}`, row.version, saved.version),
    })
    return true
  })
}

/** Inicia a conferência em segundo plano (sem sobreposição). Retorna a função que para. */
export function startAttackAutoOff(app: FastifyInstance): () => void {
  let running = false
  let stopped = false
  const tick = async () => {
    if (running || stopped) return
    running = true
    try {
      if (await runAttackAutoOffOnce(app)) app.log.info('modo de ataque: desligado automaticamente')
    } catch (err) {
      if (!stopped) app.log.error({ err }, 'modo de ataque: falha no desligamento automático')
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), ATTACK_AUTO_OFF_INTERVAL_MS)
  timer.unref?.()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
