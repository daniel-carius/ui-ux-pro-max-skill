// Nome exibido de uma pessoa da equipe: regra única do servidor (server/src/modules/team/service.ts, que grava)
// e do painel (Configurações › Equipe, que avisa antes de enviar).
// O nome aparece como "quem fez" na auditoria, nos saques e nos CSVs: precisa identificar uma pessoa só.
// Por isso ele é normalizado (NFKC, espaços colapsados), não aceita caracteres invisíveis/de controle nem
// letras de outros alfabetos que imitam as latinas (ex.: "а" cirílico), e é único na equipe comparando sem
// maiúsculas, acentos, pontuação, espaços e com as trocas visuais mais comuns (I/l/1, 0/O, rn/m, vv/w).

/** Controle (Cc), formatação (Cf: zero-width, bidi, BOM, soft hyphen), uso privado, não atribuídos e separadores de linha. */
export const NAME_FORBIDDEN_RE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}]/u
/** Letras latinas que não se decompõem em letra + acento. */
const NAME_LETTER_FOLD: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i', ĸ: 'k' }
const NAME_BASE_RE = /^[a-z0-9 .'’-]$/

/** Texto-base (sem acentos, minúsculo, só a-z 0-9 espaço . ' ’ -) ou null se tiver caractere fora disso. */
export function nameBase(name: string, keepCase = false): string | null {
  const stripped = name.normalize('NFD').replace(/\p{M}/gu, '')
  let out = ''
  for (const ch of stripped) {
    const lower = ch.toLowerCase()
    const folded = NAME_BASE_RE.test(lower) ? lower : NAME_LETTER_FOLD[lower]
    if (folded === undefined) return null
    out += keepCase && ch !== lower && folded === lower ? ch : folded
  }
  return out
}

/** Normaliza e confere o nome. Devolve o nome pronto para gravar ou o problema (mensagem para a pessoa). */
export function checkMemberName(raw: string): { name: string } | { problem: string } {
  if (raw.length > 400) return { problem: 'Use no máximo 100 caracteres no nome.' }
  const nfkc = raw.normalize('NFKC')
  if (NAME_FORBIDDEN_RE.test(nfkc)) return { problem: 'O nome tem caracteres invisíveis ou de controle. Digite o nome de novo, sem colar de outro lugar.' }
  const name = nfkc.replace(/\s+/g, ' ').trim()
  if (name.length < 2) return { problem: 'O nome precisa de pelo menos 2 letras.' }
  if (name.length > 100) return { problem: 'Use no máximo 100 caracteres no nome.' }
  if (/\p{M}{3,}/u.test(name.normalize('NFD'))) return { problem: 'O nome tem acentos demais numa mesma letra.' }
  const base = nameBase(name)
  if (base === null) return { problem: 'Use no nome só letras do alfabeto latino (com ou sem acento), números, espaços, ponto, hífen e apóstrofo.' }
  if (!/^[a-z]/.test(base)) return { problem: 'O nome precisa começar com uma letra.' }
  return { name }
}

/** Nome provisório a partir do e-mail ("ana.paula@x" → "Ana Paula"); só letras e números de cada parte. */
export function nameFromEmail(email: string) {
  const local = email.split('@')[0] ?? email
  return local
    .split(/[._+-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 100)
}

/** Mensagem do servidor quando o convite vem sem nome e o e-mail não dá um nome válido. */
export const INVITE_NAME_FROM_EMAIL_PROBLEM = 'Não deu para montar o nome a partir do e-mail. Informe o nome da pessoa convidada.'

/**
 * Nome que o convite sem nome vai usar: o montado a partir do e-mail, se passar em checkMemberName; null quando
 * o e-mail não dá um nome válido ("___@x", "a@x", "12345@x") e o nome precisa ser digitado.
 */
export function inviteNameFromEmail(email: string): string | null {
  const r = checkMemberName(nameFromEmail(email))
  return 'problem' in r ? null : r.name
}
