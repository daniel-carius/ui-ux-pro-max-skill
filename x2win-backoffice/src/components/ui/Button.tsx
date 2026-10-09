import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success' | 'soft'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-fg shadow-sm hover:bg-primary/90 active:bg-primary/85 disabled:bg-primary/50',
  secondary:
    'bg-surface text-fg border border-line-strong/80 shadow-sm hover:bg-surface-3/70 hover:border-line-strong active:bg-surface-3',
  outline: 'border border-primary/40 text-primary-text hover:bg-primary/10 hover:border-primary/60',
  ghost: 'text-fg-2 hover:bg-surface-3/80 hover:text-fg active:bg-surface-3',
  danger: 'bg-danger text-white shadow-sm hover:bg-danger/90 active:bg-danger/85 dark:text-[#1a0606]',
  success: 'bg-success text-white shadow-sm hover:bg-success/90 active:bg-success/85 dark:text-[#04140d]',
  soft: 'bg-primary/10 text-primary-text hover:bg-primary/15 active:bg-primary/20',
}

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 px-2 text-xs gap-1 rounded-md',
  sm: 'h-8 px-2.5 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-sm gap-2 rounded-xl',
}

const ICON_SIZES: Record<ButtonSize, number> = { xs: 14, sm: 15, md: 16, lg: 18 }

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  iconRight?: LucideIcon
  loading?: boolean
  block?: boolean
  children?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, loading, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const iconSize = ICON_SIZES[size]
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium',
        'transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={iconSize} className="animate-spin" aria-hidden /> : Icon ? <Icon size={iconSize} aria-hidden /> : null}
      {children}
      {IconRight && !loading ? <IconRight size={iconSize} aria-hidden /> : null}
    </button>
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon
  /** obrigatório: rótulo para leitores de tela e dica ao passar o mouse */
  label: string
  variant?: 'ghost' | 'secondary' | 'danger' | 'primary'
  size?: 'sm' | 'md'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, variant = 'ghost', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 w-8' : 'h-10 w-10',
        variant === 'ghost' && 'text-fg-2 hover:bg-surface-3 hover:text-fg',
        variant === 'secondary' && 'border border-line-strong/80 bg-surface text-fg-2 shadow-sm hover:bg-surface-3/70 hover:text-fg',
        variant === 'danger' && 'text-danger hover:bg-danger/10',
        variant === 'primary' && 'bg-primary text-primary-fg hover:bg-primary/90',
        className,
      )}
      {...rest}
    >
      <Icon size={size === 'sm' ? 16 : 18} aria-hidden />
    </button>
  )
})
