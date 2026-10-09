// Formatação mínima de dinheiro, sem dependências de navegador.
const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function brl(value: number): string {
  return fmt.format(value).replace(/ /g, ' ')
}

/** Arredonda para centavos evitando erro de ponto flutuante. */
export function cents(value: number): number {
  return Math.round(value * 100) / 100
}
