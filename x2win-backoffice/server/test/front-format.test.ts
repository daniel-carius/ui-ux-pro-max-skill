// Campos de valor do painel (src/lib/format.ts): leitura pt-BR do texto digitado e o texto mostrado.
// Sem DOM: é o mesmo código que MoneyInput/NumberInput (src/components/ui/Field.tsx) usam.
import { describe, expect, it } from 'vitest'
import { DECIMAL_TEXT_MESSAGES, decimalsOf, formatDecimalInput, parseDecimalInput, readDecimalText } from '@/lib/format'

const read = (t: string, maxDecimals = 2, allowNegative = false) => readDecimalText(t, { maxDecimals, allowNegative })
const value = (t: string, maxDecimals = 2) => {
  const r = read(t, maxDecimals)
  return r.ok ? r.value : null
}

/** Digita tecla a tecla como o campo: tecla recusada não muda o texto. */
function typeKeys(keys: string, maxDecimals = 2) {
  let text = ''
  const refused: string[] = []
  for (const k of keys) {
    const r = read(text + k, maxDecimals)
    if (r.ok) text = r.text
    else refused.push(text + k)
  }
  const r = read(text, maxDecimals)
  return { text, value: r.ok ? r.value : null, pending: r.ok && r.pending, refused }
}

describe('readDecimalText (campos de valor pt-BR)', () => {
  it('lê milhar com ponto e decimais com vírgula', () => {
    expect(value('1.000.000')).toBe(1_000_000)
    expect(value('1.000.000,00')).toBe(1_000_000)
    expect(value('1.500,50')).toBe(1500.5)
    expect(value('1500,50')).toBe(1500.5)
    expect(value('1.500')).toBe(1500)
    expect(value('12,5')).toBe(12.5)
    expect(value(',5')).toBe(0.5)
    expect(value('0')).toBe(0)
  })

  it('aceita o número colado com "R$" e espaços', () => {
    const r = read('R$ 1.500,50')
    expect(r).toMatchObject({ ok: true, value: 1500.5, text: '1.500,50' })
    expect(value('R$ 1.000.000,00')).toBe(1_000_000)
    expect(value(' 2 500,75 ')).toBe(2500.75)
  })

  it('aceita ponto decimal de outro sistema só até as casas permitidas', () => {
    expect(value('12.5')).toBe(12.5)
    expect(value('1234.56')).toBe(1234.56)
    expect(value('0.005', 3)).toBe(0.005)
    expect(value('0.005')).toBeNull()
  })

  it('recusa mais casas decimais que o permitido, com mensagem', () => {
    expect(read('12,345')).toEqual({ ok: false, message: DECIMAL_TEXT_MESSAGES.decimals(2) })
    expect(read('1.500,505')).toEqual({ ok: false, message: 'Use no máximo 2 casas decimais.' })
    expect(value('0,005', 3)).toBe(0.005)
  })

  it('nunca reinterpreta em silêncio: "1.000000" e "1.0000" são recusados, não viram 1', () => {
    expect(read('1.000000')).toEqual({ ok: false, message: DECIMAL_TEXT_MESSAGES.format })
    expect(read('1.0000')).toEqual({ ok: false, message: DECIMAL_TEXT_MESSAGES.format })
    expect(read('1.5,00')).toMatchObject({ ok: true, value: 15, pending: true })
    expect(read('1,000,00').ok).toBe(false)
    expect(read('12a').ok).toBe(false)
    expect(read('-5')).toEqual({ ok: false, message: DECIMAL_TEXT_MESSAGES.negative })
    expect(read('-1.500,50', 2, true)).toMatchObject({ ok: true, value: -1500.5 })
  })

  it('digitar 1.000.000 tecla a tecla chega a 1000000', () => {
    expect(typeKeys('1.000.000')).toEqual({ text: '1.000.000', value: 1_000_000, pending: false, refused: [] })
    expect(typeKeys('1.000.000,00')).toMatchObject({ text: '1.000.000,00', value: 1_000_000, refused: [] })
    expect(typeKeys('1.500,50')).toMatchObject({ value: 1500.5, refused: [] })
  })

  it('pontos fora do lugar do milhar ficam pendentes: todo ponto é milhar', () => {
    expect(read('1.000.')).toMatchObject({ ok: true, value: 1000, pending: false })
    expect(read('1.000.0')).toMatchObject({ ok: true, value: 10_000, pending: true })
    expect(read('2.500.75')).toMatchObject({ ok: true, value: 250_075, pending: true })
    // apagar um dígito no meio de "1.500,50" não trava o campo
    expect(read('1.00,50')).toMatchObject({ ok: true, value: 100.5, pending: true })
    expect(read('1.00.000')).toMatchObject({ ok: true, value: 100_000, pending: true })
    // a quarta casa depois de um ponto só é recusada com mensagem (não vira 1,0000)
    expect(typeKeys('1.0000')).toMatchObject({ text: '1.000', value: 1000, refused: ['1.0000'] })
    expect(typeKeys('12,345')).toMatchObject({ text: '12,34', value: 12.34, refused: ['12,345'] })
    expect(read('0.500')).toEqual({ ok: false, message: DECIMAL_TEXT_MESSAGES.format })
  })

  it('vazio, "-" e "," valem 0 enquanto se digita', () => {
    expect(value('')).toBe(0)
    expect(value(',')).toBe(0)
    expect(read('-', 2, true)).toMatchObject({ ok: true, value: 0 })
  })

  it('campo de número inteiro (maxDecimals 0): "2,5" é recusado com mensagem, não vira 3', () => {
    expect(typeKeys('2,5', 0)).toEqual({ text: '2,', value: 2, pending: false, refused: ['2,5'] })
    expect(read('2,5', 0)).toEqual({ ok: false, message: DECIMAL_TEXT_MESSAGES.decimals(0) })
    expect(read('2,5', 0)).toEqual({ ok: false, message: 'Use um número inteiro.' })
    // o ponto é milhar: "2.5" fica pendente (o campo avisa ao sair), e digitar 1.000.000 não trava em "1.0"
    expect(read('2.5', 0)).toMatchObject({ ok: true, value: 25, pending: true })
    expect(read('x', 0)).toEqual({ ok: false, message: DECIMAL_TEXT_MESSAGES.charsInteger })
    expect(value('1.500', 0)).toBe(1500)
    expect(typeKeys('1.000.000', 0)).toMatchObject({ value: 1_000_000, refused: [] })
  })

  it('parseDecimalInput: null quando recusado ou incompleto', () => {
    expect(parseDecimalInput('1.000.000')).toBe(1_000_000)
    expect(parseDecimalInput('1.000.0')).toBeNull()
    expect(parseDecimalInput('1.000000')).toBeNull()
  })
})

describe('formatDecimalInput (texto mostrado no campo)', () => {
  it('reais com milhar e duas casas', () => {
    expect(formatDecimalInput(1500.5, { minDecimals: 2 })).toBe('1.500,50')
    expect(formatDecimalInput(5000, { minDecimals: 2 })).toBe('5.000,00')
    expect(formatDecimalInput(1_000_000, { minDecimals: 2 })).toBe('1.000.000,00')
    expect(formatDecimalInput(0.005, { minDecimals: 2, maxDecimals: 3 })).toBe('0,005')
    expect(formatDecimalInput(-12.5, { minDecimals: 2 })).toBe('-12,50')
  })
  it('números sem casas fixas', () => {
    expect(formatDecimalInput(12.5)).toBe('12,5')
    expect(formatDecimalInput(1000)).toBe('1.000')
    expect(formatDecimalInput(Number.NaN)).toBe('')
  })
  it('o texto mostrado volta ao mesmo número', () => {
    for (const n of [0, 0.5, 12.5, 1500.5, 5000, 99_999.99, 1_000_000, 12_345_678.9]) {
      expect(value(formatDecimalInput(n, { minDecimals: 2 }))).toBe(n)
      expect(value(formatDecimalInput(n))).toBe(n)
    }
    expect(value(formatDecimalInput(0.005, { minDecimals: 2, maxDecimals: 3 }), 3)).toBe(0.005)
  })
  it('decimalsOf lê as casas do passo', () => {
    expect(decimalsOf(1)).toBe(0)
    expect(decimalsOf(0.01)).toBe(2)
    expect(decimalsOf(0.001)).toBe(3)
    expect(decimalsOf(0.5)).toBe(1)
    expect(decimalsOf(1e-7)).toBe(7)
  })
})
