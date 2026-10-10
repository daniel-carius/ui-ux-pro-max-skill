// Cliente da API do back-end. O painel funciona em dois modos:
//  - demonstração (padrão): dados no navegador, sem servidor;
//  - API (VITE_API_MODE=1): login real, dados e regras no servidor.
import type { ApiErrorBody } from '@shared/api'

export const API_MODE = import.meta.env.VITE_API_MODE === '1'
/** Base da API. Vazio = mesma origem (o Vite encaminha /api para o servidor em desenvolvimento). */
export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export function isApiMode() {
  return API_MODE
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    /** segundos sugeridos pelo servidor antes de tentar de novo (cabeçalho Retry-After) */
    public retryAfter?: number,
  ) {
    super(message)
  }
}

/**
 * 409 versao_desatualizada: outra pessoa gravou antes (ou duas gravações se cruzaram no banco).
 * Pode vir de qualquer rota que grava, às vezes sem details.version. Mostre error.message e
 * recarregue os dados afetados antes de deixar a pessoa tentar de novo.
 */
export function isVersionConflict(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 409 && e.code === 'versao_desatualizada'
}

/** 503 servidor_ocupado: fila de senhas cheia. Nada foi gravado; vale tentar de novo depois de retryAfter. */
export function isServerBusy(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 503 && e.code === 'servidor_ocupado'
}

/**
 * 400 "O destino desta credencial mudou": o segredo mantido pela máscara não vale para o destino novo
 * (host, conta, ambiente…). details = { path, field, reason: 'destino_mudou' }; o texto fica de reserva.
 */
export function isDestinationChanged(e: unknown): e is ApiError {
  if (!(e instanceof ApiError) || e.status !== 400) return false
  const reason = (e.details as { reason?: unknown } | undefined)?.reason
  return reason === 'destino_mudou' || /destino desta credencial mudou/i.test(e.message)
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

/** Ouvintes de "sessão caiu" (401): o portão de login volta para a tela de entrada. */
const unauthorizedListeners = new Set<() => void>()
export function onUnauthorized(fn: () => void) {
  unauthorizedListeners.add(fn)
  return () => unauthorizedListeners.delete(fn)
}

/** Mensagem quando a resposta de erro não traz o corpo JSON da API (ex.: página de erro do proxy). */
function statusMessage(status: number) {
  if (status === 413) return 'Os dados enviados passam do tamanho permitido.'
  if (status === 429) return 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.'
  if (status === 502 || status === 503 || status === 504) return 'O servidor não respondeu agora. Tente de novo em instantes.'
  return `Erro ${status} no servidor. Tente de novo.`
}

/** Retry-After em segundos (número ou data HTTP); undefined se ausente ou inválido. */
function retryAfterOf(res: Response): number | undefined {
  const raw = res.headers.get('retry-after')
  if (!raw) return undefined
  const s = Number(raw)
  if (Number.isFinite(s)) return Math.max(0, s)
  const at = Date.parse(raw)
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000))
}

function parseJson(text: string): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      // dados do painel nunca vêm do cache do navegador (o servidor também responde no-store)
      cache: 'no-store',
      headers: {
        'x-requested-with': 'x2w',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'sem_conexao', 'Sem conexão com o servidor. Verifique a internet e tente de novo.')
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = parseJson(text)
  if (!res.ok) {
    const err = (data as ApiErrorBody | undefined)?.error
    // senha ou código errado também é 401, mas não significa que a sessão caiu
    if (res.status === 401 && err?.code === 'nao_autenticado') unauthorizedListeners.forEach((l) => l())
    // 413 (corpo grande demais, da API ou do proxy) e os demais: a mensagem do servidor, já em português
    throw new ApiError(res.status, err?.code ?? 'erro', err?.message ?? statusMessage(res.status), err?.details, retryAfterOf(res))
  }
  if (text && data === undefined) throw new ApiError(res.status, 'resposta_invalida', 'Resposta inesperada do servidor. Tente de novo.')
  return data as T
}

/** Baixa um arquivo da API (ex.: CSV da auditoria) respeitando a sessão. */
export async function apiDownload(path: string, filename: string) {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { credentials: 'include', cache: 'no-store', headers: { 'x-requested-with': 'x2w' } })
  } catch {
    throw new ApiError(0, 'sem_conexao', 'Sem conexão com o servidor. Verifique a internet e tente de novo.')
  }
  if (!res.ok) {
    const err = (parseJson(await res.text().catch(() => '')) as ApiErrorBody | undefined)?.error
    if (res.status === 401 && err?.code === 'nao_autenticado') unauthorizedListeners.forEach((l) => l())
    throw new ApiError(res.status, err?.code ?? 'erro', err?.message ?? statusMessage(res.status), err?.details, retryAfterOf(res))
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
