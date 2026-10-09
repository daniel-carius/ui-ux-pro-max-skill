import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

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

/**
 * Campo de valor em reais. Trabalha com número (value) e aceita vírgula.
 *   <MoneyInput value={rules.min} onValueChange={(v) => set('min', v)} />
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
}: {
  value: number
  onValueChange: (v: number) => void
  id?: string
  min?: number
  step?: number
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
}) {
  return (
    <Input
      id={id}
      prefix="R$"
      type="number"
      inputMode="decimal"
      min={min}
      step={step}
      disabled={disabled}
      invalid={invalid}
      placeholder={placeholder}
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) => onValueChange(e.target.value === '' ? 0 : Number(e.target.value))}
      className="tnum"
    />
  )
}

/** Número com sufixo (%, x, dias...) */
export function NumberInput({
  value,
  onValueChange,
  suffix,
  id,
  min,
  max,
  step = 1,
  disabled,
  invalid,
}: {
  value: number
  onValueChange: (v: number) => void
  suffix?: ReactNode
  id?: string
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  invalid?: boolean
}) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      invalid={invalid}
      suffix={suffix}
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) => onValueChange(e.target.value === '' ? 0 : Number(e.target.value))}
      className="tnum"
    />
  )
}

/** Hook utilitário para ids de campo */
export function useFieldId(prefix = 'f') {
  return `${prefix}-${useId().replace(/:/g, '')}`
}
