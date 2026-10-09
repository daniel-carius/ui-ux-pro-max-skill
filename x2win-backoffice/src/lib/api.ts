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
  ) {
    super(message)
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

/** Ouvintes de "sessão caiu" (401): o portão de login volta para a tela de entrada. */
const unauthorizedListeners = new Set<() => void>()
export function onUnauthorized(fn: () => void) {
  unauthorizedListeners.add(fn)
  return () => unauthorizedListeners.delete(fn)
}

export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
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
  const data = text ? (JSON.parse(text) as unknown) : undefined
  if (!res.ok) {
    const err = (data as ApiErrorBody | undefined)?.error
    if (res.status === 401) unauthorizedListeners.forEach((l) => l())
    throw new ApiError(res.status, err?.code ?? 'erro', err?.message ?? `Erro ${res.status}`, err?.details)
  }
  return data as T
}

/** Baixa um arquivo da API (ex.: CSV da auditoria) respeitando a sessão. */
export async function apiDownload(path: string, filename: string) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', headers: { 'x-requested-with': 'x2w' } })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null
    throw new ApiError(res.status, body?.error.code ?? 'erro', body?.error.message ?? `Erro ${res.status}`)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
