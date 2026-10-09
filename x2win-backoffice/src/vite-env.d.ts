/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" liga o modo API (login real e dados no servidor) */
  readonly VITE_API_MODE?: string
  /** endereço da API quando não está na mesma origem */
  readonly VITE_API_URL?: string
}
