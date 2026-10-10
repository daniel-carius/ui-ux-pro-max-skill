// Regras comuns dos dados de demonstração (src/data/**).
//
// 1) Dados pessoais obviamente fictícios, iguais aos que o servidor grava com DEMO_DATA
//    (server/src/modules/kv/demo-seed.ts › demoize): e-mail no domínio reservado .invalid
//    (RFC 2606), CPF com dígito verificador errado, celular (DD) 9 0XXX-XXXX e IP na faixa
//    privada 10.x. Autor de decisões vira um rótulo genérico, nunca o nome de alguém.
//    As funções são idempotentes: o servidor aplica de novo e o resultado não muda.
//
// 2) Valor de cada dado de demonstração no modo API (VITE_API_MODE=1) quando o servidor não
//    tem nada gravado na chave (GET com stored:false), a leitura falhou ou o cargo não lê a
//    chave. A regra geral fica no store (src/lib/store.ts): lista de registros → [] e objeto de
//    configuração → o próprio padrão. Aqui o gerador diz quando é diferente (apiValue).
//
// Sem dependências: o servidor importa src/data/** na semeadura (DEMO_DATA).

/** Autor genérico das decisões nos registros de demonstração. */
export const DEMO_STAFF_LABEL = 'Equipe (demonstração)'

/** E-mail no domínio reservado .invalid: nunca entrega para ninguém. */
export function demoEmail(value: string): string {
  const at = value.lastIndexOf('@')
  if (at < 1 || value.endsWith('.invalid')) return value
  return `${value}.invalid`
}

/** CPF com o 1º dígito verificador errado (nunca é um CPF válido); mantém a pontuação. */
export function demoCpf(value: string): string {
  const d = value.replace(/\D/g, '')
  if (d.length !== 11) return value
  const dv = (base: string, w: number) => {
    const sum = [...base].reduce((s, c, i) => s + Number(c) * (w - i), 0)
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  const base = d.slice(0, 9)
  const wrong = (dv(base, 10) + 1) % 10
  const out = `${base}${wrong}${d[10]}`
  let i = 0
  return value.replace(/\d/g, () => out[i++])
}

/**
 * Celular (DD) 9 0XXX-XXXX: faixa que não existe na numeração móvel (fixo: (DD) 0XXX-XXXX); mantém a
 * pontuação e 7 dígitos do número (contas diferentes não passam a dividir o mesmo celular).
 */
export function demoPhone(value: string): string {
  const d = value.replace(/\D/g, '')
  if (d.length < 10) return value
  // depois do DDD (e do 9 do celular), o primeiro dígito vira 0
  const at = d.length >= 11 ? 3 : 2
  let i = 0
  return value.replace(/\d/g, (c) => (i++ === at ? '0' : c))
}

/** IPv4 na faixa privada 10.x (mantém os 3 últimos números: contas que dividem IP continuam dividindo). */
export function demoIp(value: string): string {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value)
  return m ? `10.${m[2]}.${m[3]}.${m[4]}` : value
}

// ---------- valor no modo API ----------

const API_VALUES = new WeakMap<object, unknown>()

/**
 * Registra o valor que o modo API mostra no lugar do dado de demonstração `seed` (gerador ou
 * valor) enquanto o servidor não tem a chave gravada. Use para:
 *  - registros (listas ou mapas por id): vazio, sem rodar o gerador;
 *  - configuração com dado de demonstração (segredo DEMO, autor, histórico): o padrão limpo.
 * `value` pode ser um gerador (rodado a cada uso).
 */
export function apiValue<S extends object>(seed: S, value: unknown): S {
  API_VALUES.set(seed, value)
  return seed
}

/** Lista de registros de demonstração: no modo API, sem nada gravado, a tela fica vazia. */
export function demoRecords<S extends object>(seed: S): S {
  return apiValue(seed, () => [])
}

/** Valor registrado para o modo API (found=false: vale a regra geral do store). */
export function apiValueOf(seed: unknown): { found: true; value: unknown } | { found: false } {
  if (seed === null || (typeof seed !== 'object' && typeof seed !== 'function')) return { found: false }
  return API_VALUES.has(seed) ? { found: true, value: API_VALUES.get(seed) } : { found: false }
}
