import { forwardRef, useId, useState, type ChangeEvent, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { DECIMAL_TEXT_MESSAGES, decimalsOf, formatDecimalInput, readDecimalText } from '@/lib/format'

export interface FieldProps {
  label?: ReactNode
  hint?: ReactNode
  error?: string | null
  required?: boolean
  htmlFor?: string
  className?: string
  /** ação ao lado do rótulo (ex.: link "Como é calculado") */
  labelAside?: ReactNode
  children: ReactNode
}

/** Rótulo + controle + ajuda + erro, com acessibilidade ligada. */
export function Field({ label, hint, error, required, htmlFor, className, labelAside, children }: FieldProps) {
  return (
    <div className={cn('min-w-0', className)}>
      {(label || labelAside) && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          {label && (
            <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg">
              {label}
              {required && (
                <span className="ml-0.5 text-danger" aria-hidden>
                  *
                </span>
              )}
            </label>
          )}
          {labelAside}
        </div>
      )}
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs leading-5 text-fg-3">{hint}</p>
      ) : null}
    </div>
  )
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: LucideIcon
  prefix?: string
  suffix?: ReactNode
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { icon: Icon, prefix, suffix, invalid, className, ...rest },
  ref,
) {
  if (!Icon && !prefix && !suffix) {
    return <input ref={ref} aria-invalid={invalid || undefined} className={cn('input-base', invalid && 'border-danger', className)} {...rest} />
  }
  return (
    <div className={cn('relative flex items-center', className)}>
      {Icon && <Icon size={16} className="pointer-events-none absolute left-3 text-fg-3" aria-hidden />}
      {prefix && <span className="pointer-events-none absolute left-3 text-sm font-medium text-fg-3">{prefix}</span>}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn('input-base', (Icon || prefix) && (prefix && prefix.length > 2 ? 'pl-11' : 'pl-9'), suffix && 'pr-12', invalid && 'border-danger')}
        {...rest}
      />
      {suffix && <span className="absolute right-3 text-sm text-fg-3">{suffix}</span>}
    </div>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, rows = 4, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        aria-invalid={invalid || undefined}
        className={cn('input-base h-auto min-h-[80px] py-2 leading-6', invalid && 'border-danger', className)}
        {...rest}
      />
    )
  },
)

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  options: SelectOption[]
  onChange?: (value: string) => void
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, onChange, placeholder, className, ...rest },
  ref,
) {
  return (
    <div className={cn('relative', className)}>
      <select
        ref={ref}
        className="input-base appearance-none pr-9"
        onChange={(e) => onChange?.(e.target.value)}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
    </div>
  )
})

export interface DecimalTextConfig {
  /** 0 aparece como campo vazio (com o placeholder) */
  blankWhenZero?: boolean
  min?: number
  max?: number
  step?: number
  /** casas decimais sempre mostradas (2 em reais: "5.000,00") */
  minDecimals?: number
  /** casas decimais aceitas; padrão: 2, ou as do passo (0,001 → 3) */
  maxDecimals?: number
  /** campo vazio vale null (ex.: "sem teto") */
  nullable?: boolean
}

/**
 * Texto de um campo numérico controlado por número, no jeito brasileiro (readDecimalText): "1.000.000",
 * "1.500,50" e "R$ 1.500,50" colado funcionam; o que não forma número (ponto fora do milhar, casas decimais
 * demais) é recusado com uma mensagem embaixo do campo (`message`), nunca reinterpretado em silêncio.
 * Fora de foco, o campo mostra o número como o painel mostra ("1.500,50"). Enquanto a pessoa digita, mostra o
 * que ela digitou; o campo vazio vale 0 (ou null com `nullable`) e continua vazio. Um valor novo vindo de fora
 * (formulário limpo, valor corrigido pela tela) substitui o que foi digitado. As setas ↑/↓ somam ou tiram
 * `step`, como no campo numérico do navegador.
 */
export function useDecimalText(
  value: number | null,
  onValueChange: (v: number | null) => void,
  { blankWhenZero = false, min, max, step = 1, minDecimals = 0, maxDecimals, nullable = false }: DecimalTextConfig = {},
) {
  const [draft, setDraft] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; value: number | null } | null>(null)
  const decimals = Math.max(minDecimals, maxDecimals ?? Math.max(2, decimalsOf(step)))
  const opts = { allowNegative: min === undefined || min < 0, maxDecimals: decimals }
  const format = (n: number) => formatDecimalInput(n, { minDecimals, maxDecimals: decimals })
  const isBlank = (t: string) => t.trim() === ''
  const valueOf = (t: string): number | null | undefined => {
    if (nullable && isBlank(t)) return null
    const r = readDecimalText(t, opts)
    return r.ok ? r.value : undefined
  }
  const shown =
    draft !== null && Object.is(valueOf(draft), value)
      ? draft
      : value === null || !Number.isFinite(value) || (blankWhenZero && value === 0)
        ? ''
        : format(value)
  // a mensagem vale para o valor em que apareceu: some quando o valor muda (tecla aceita, formulário limpo)
  const message = note && Object.is(note.value, value) ? note.text : null
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const t = e.target.value
    if (nullable && isBlank(t)) {
      setNote(null)
      setDraft('')
      onValueChange(null)
      return
    }
    const r = readDecimalText(t, opts)
    if (!r.ok) {
      setNote({ text: r.message, value })
      return
    }
    setNote(null)
    setDraft(r.text)
    onValueChange(r.value)
  }
  /** Ao sair do campo (ou Enter): mostra o número formatado; grupo de milhar incompleto ganha o aviso. */
  const settle = () => {
    if (draft === null || /^[-,]?$/.test(draft.trim())) return
    const r = readDecimalText(draft, opts)
    setDraft(null)
    if (r.ok && r.pending && Object.is(r.value, value)) setNote({ text: DECIMAL_TEXT_MESSAGES.pending(format(r.value)), value })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // "1.000.0" + Enter: não envia o formulário com 1.000 sem a pessoa ver
      const r = draft !== null ? readDecimalText(draft, opts) : null
      if (r?.ok && r.pending) e.preventDefault()
      settle()
      return
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const base = value !== null && Number.isFinite(value) ? value : 0
    let next = Number((base + (e.key === 'ArrowUp' ? step : -step)).toFixed(10))
    if (min !== undefined) next = Math.max(min, next)
    if (max !== undefined) next = Math.min(max, next)
    setDraft(null)
    setNote(null)
    onValueChange(next)
  }
  return { value: shown, onChange, onBlur: settle, onKeyDown, message }
}

/**
 * Aviso de um campo numérico (tecla recusada, número incompleto), logo abaixo do campo. Fica no mesmo bloco do
 * campo (NumericFieldBox): solto ao lado dele, viraria mais uma célula da linha em grades e linhas flex.
 */
export function DecimalTextNote({ id, message }: { id: string; message: string | null }) {
  if (!message) return null
  return (
    <p id={id} className="mt-1.5 text-xs font-medium text-danger" role="alert">
      {message}
    </p>
  )
}

/**
 * Bloco do campo numérico com o aviso embaixo: um só item para a linha em volta (célula de grade, item flex,
 * célula de tabela), com a largura que o campo sozinho teria.
 */
export function NumericFieldBox({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('w-full min-w-0', className)}>{children}</div>
}

/**
 * Campo de valor em reais. Trabalha com número (value) e lê o jeito brasileiro ("1.000.000", "1.500,50",
 * "R$ 1.500,50" colado); fora de foco mostra "1.500,50".
 *   <MoneyInput value={rules.min} onValueChange={(v) => set('min', v)} />
 * `blankWhenZero`: 0 aparece como campo vazio (com o placeholder), para valores que a pessoa ainda vai digitar.
 */
export function MoneyInput({
  value,
  onValueChange,
  id,
  min = 0,
  step = 0.01,
  disabled,
  invalid,
  placeholder,
  className,
  ariaLabel,
  blankWhenZero,
}: {
  value: number
  onValueChange: (v: number) => void
  id?: string
  min?: number
  step?: number
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
  className?: string
  ariaLabel?: string
  blankWhenZero?: boolean
}) {
  const noteId = useFieldId('nota')
  const text = useDecimalText(value, (v) => onValueChange(v ?? 0), { blankWhenZero, min, step, minDecimals: 2 })
  return (
    <NumericFieldBox>
      <Input
        id={id}
        aria-label={ariaLabel}
        aria-describedby={text.message ? noteId : undefined}
        prefix="R$"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        disabled={disabled}
        invalid={invalid}
        placeholder={placeholder}
        value={text.value}
        onChange={text.onChange}
        onBlur={text.onBlur}
        onKeyDown={text.onKeyDown}
        className={cn('tnum', className)}
      />
      <DecimalTextNote id={noteId} message={text.message} />
    </NumericFieldBox>
  )
}

/**
 * Número com sufixo (%, x, dias...). `integer` para contagens (dias, giros, usos, moedas): "2,5" é recusado com
 * "Use um número inteiro." em vez de virar 3 sem aviso. Sem ele, aceita as casas do passo (mínimo 2).
 */
export function NumberInput({
  value,
  onValueChange,
  suffix,
  id,
  min,
  max,
  step = 1,
  integer = false,
  disabled,
  invalid,
  className,
  ariaLabel,
}: {
  value: number
  onValueChange: (v: number) => void
  suffix?: ReactNode
  id?: string
  min?: number
  max?: number
  step?: number
  /** só números inteiros */
  integer?: boolean
  disabled?: boolean
  invalid?: boolean
  className?: string
  ariaLabel?: string
}) {
  const noteId = useFieldId('nota')
  const text = useDecimalText(value, (v) => onValueChange(v ?? 0), { min, max, step, maxDecimals: integer ? 0 : undefined })
  return (
    <NumericFieldBox>
      <Input
        id={id}
        aria-label={ariaLabel}
        aria-describedby={text.message ? noteId : undefined}
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        autoComplete="off"
        disabled={disabled}
        invalid={invalid}
        suffix={suffix}
        value={text.value}
        onChange={text.onChange}
        onBlur={text.onBlur}
        onKeyDown={text.onKeyDown}
        className={cn('tnum', className)}
      />
      <DecimalTextNote id={noteId} message={text.message} />
    </NumericFieldBox>
  )
}

/** Hook utilitário para ids de campo */
export function useFieldId(prefix = 'f') {
  return `${prefix}-${useId().replace(/:/g, '')}`
}
