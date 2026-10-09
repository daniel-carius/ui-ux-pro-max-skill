// Regras de Configurações › Países bloqueados.
// Um país bloqueado barra cadastro, login, depósito, jogo e saque, e o visitante
// vê "não disponível no seu país". A lista da operação soma-se à regra da plataforma.

export const BLOCKED_COUNTRIES_KEY = 'config.paises.bloqueados'

/** Mercado da licença: não pode ser bloqueado. */
export const HOME_COUNTRY = 'BR'

export const BLOCK_EFFECTS = [
  { id: 'cadastro', label: 'Cadastro', detail: 'O formulário de criar conta não abre.' },
  { id: 'login', label: 'Login', detail: 'Quem já tem conta não consegue entrar.' },
  { id: 'deposito', label: 'Depósito', detail: 'Nenhum PIX é gerado.' },
  { id: 'jogo', label: 'Jogo', detail: 'Cassino e apostas esportivas ficam fechados.' },
  { id: 'saque', label: 'Saque', detail: 'O saldo fica guardado até o acesso voltar a ser permitido.' },
] as const

export type BlockCheck = { ok: true } | { ok: false; message: string }

export function canBlockCountry(code: string, platformCodes: string[], customCodes: string[]): BlockCheck {
  const c = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return { ok: false, message: 'Código de país inválido.' }
  if (c === HOME_COUNTRY) return { ok: false, message: 'O Brasil não pode ser bloqueado: é o mercado da autorização da SPA/MF.' }
  if (platformCodes.includes(c)) return { ok: false, message: 'Este país já é bloqueado pela regra da plataforma.' }
  if (customCodes.includes(c)) return { ok: false, message: 'Este país já está na lista de bloqueados.' }
  return { ok: true }
}

export type BlockSource = 'plataforma' | 'operacao' | null

export function blockSource(code: string, platformCodes: string[], customCodes: string[]): BlockSource {
  if (platformCodes.includes(code)) return 'plataforma'
  if (customCodes.includes(code)) return 'operacao'
  return null
}
