// Avisos (toast) e confirmação de ações, com API imperativa:
//   toast.success('Regras salvas')
//   const ok = await confirm({ title: 'Aprovar saque?', confirmLabel: 'Aprovar' })
//   const r = await confirm({ title: 'Recusar', input: { label: 'Motivo', required: true } })
import { useEffect, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './Button'
import { Field, Input, Select, Textarea } from './Field'
import { Modal } from './Overlay'

type ToastKind = 'success' | 'error' | 'info' | 'warning'
interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

let toastId = 0
const toastListeners = new Set<(t: ToastItem[]) => void>()
let toasts: ToastItem[] = []

function pushToast(kind: ToastKind, title: string, opts?: { description?: string; action?: ToastItem['action']; duration?: number }) {
  const t: ToastItem = { id: ++toastId, kind, title, description: opts?.description, action: opts?.action }
  toasts = [...toasts, t].slice(-4)
  toastListeners.forEach((l) => l(toasts))
  setTimeout(() => dismissToast(t.id), opts?.duration ?? (opts?.action ? 6000 : 4000))
}

function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  toastListeners.forEach((l) => l(toasts))
}

type ToastOpts = { description?: string; action?: ToastItem['action']; duration?: number }
export const toast = {
  success: (title: string, opts?: ToastOpts) => pushToast('success', title, opts),
  error: (title: string, opts?: ToastOpts) => pushToast('error', title, opts),
  info: (title: string, opts?: ToastOpts) => pushToast('info', title, opts),
  warning: (title: string, opts?: ToastOpts) => pushToast('warning', title, opts),
  /** some com todos os avisos (ex.: ao sair) */
  clear: () => {
    toasts = []
    toastListeners.forEach((l) => l(toasts))
  },
}

const TOAST_STYLE: Record<ToastKind, { icon: LucideIcon; cls: string }> = {
  success: { icon: CheckCircle2, cls: 'text-success' },
  error: { icon: XCircle, cls: 'text-danger' },
  info: { icon: Info, cls: 'text-info' },
  warning: { icon: AlertTriangle, cls: 'text-warning' },
}

export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>(toasts)
  useEffect(() => {
    toastListeners.add(setList)
    return () => {
      toastListeners.delete(setList)
    }
  }, [])
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[200] flex flex-col items-center gap-2 p-4 sm:items-end"
    >
      {list.map((t) => {
        const S = TOAST_STYLE[t.kind]
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-pop"
          >
            <S.icon size={18} className={cn('mt-px shrink-0', S.cls)} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg">{t.title}</p>
              {t.description && <p className="mt-0.5 text-[13px] leading-5 text-fg-3">{t.description}</p>}
              {t.action && (
                <button
                  type="button"
                  className="mt-1.5 text-[13px] font-semibold text-primary-text hover:underline"
                  onClick={() => {
                    t.action!.onClick()
                    dismissToast(t.id)
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label="Fechar aviso"
              onClick={() => dismissToast(t.id)}
              className="-m-1 rounded-md p-1 text-fg-3 hover:bg-surface-3 hover:text-fg"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ---------- Confirmação ----------

export interface ConfirmInput {
  label: string
  placeholder?: string
  required?: boolean
  multiline?: boolean
  options?: { value: string; label: string }[]
  defaultValue?: string
}

export interface ConfirmOptions {
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'primary' | 'danger' | 'warning' | 'success'
  icon?: LucideIcon
  /** pede um texto (ex.: motivo da recusa) */
  input?: ConfirmInput
  /** exige digitar esta palavra para liberar (ações irreversíveis) */
  typeToConfirm?: string
  details?: ReactNode
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (r: { confirmed: boolean; value: string }) => void
}

let confirmSetter: ((r: ConfirmRequest | null) => void) | null = null

/** Retorna true/false. Com `input`, use confirmWithInput. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return confirmWithInput(opts).then((r) => r.confirmed)
}

export function confirmWithInput(opts: ConfirmOptions): Promise<{ confirmed: boolean; value: string }> {
  return new Promise((resolve) => {
    if (!confirmSetter) {
      resolve({ confirmed: window.confirm(opts.title), value: '' })
      return
    }
    confirmSetter({ ...opts, resolve })
  })
}

export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null)
  const [value, setValue] = useState('')
  const [typed, setTyped] = useState('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    confirmSetter = (r) => {
      setReq(r)
      setValue(r?.input?.defaultValue ?? '')
      setTyped('')
      setTouched(false)
    }
    return () => {
      confirmSetter = null
    }
  }, [])

  if (!req) return null
  const close = (confirmed: boolean) => {
    if (confirmed) {
      setTouched(true)
      if (req.input?.required && !value.trim()) return
      if (req.typeToConfirm && typed.trim().toUpperCase() !== req.typeToConfirm.toUpperCase()) return
    }
    req.resolve({ confirmed, value: value.trim() })
    setReq(null)
  }
  const tone = req.tone ?? 'primary'
  const Icon = req.icon ?? (tone === 'danger' ? AlertTriangle : tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info)
  const inputError = touched && req.input?.required && !value.trim() ? `Informe ${req.input.label.toLowerCase()}.` : null
  const typeError = touched && req.typeToConfirm && typed.trim().toUpperCase() !== req.typeToConfirm.toUpperCase() ? `Digite ${req.typeToConfirm} para confirmar.` : null

  return (
    <Modal
      open
      onClose={() => close(false)}
      title={req.title}
      description={req.description}
      icon={Icon}
      iconTone={tone}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)}>
            {req.cancelLabel ?? 'Cancelar'}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : 'primary'}
            onClick={() => close(true)}
            data-autofocus={!req.input && !req.typeToConfirm ? true : undefined}
          >
            {req.confirmLabel ?? 'Confirmar'}
          </Button>
        </>
      }
    >
      {(req.details || req.input || req.typeToConfirm) && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            close(true)
          }}
        >
          {req.details}
          {req.input && (
            <Field label={req.input.label} required={req.input.required} error={inputError} htmlFor="confirm-input">
              {req.input.options ? (
                <Select
                  id="confirm-input"
                  data-autofocus
                  value={value}
                  onChange={setValue}
                  options={req.input.options}
                  placeholder="Selecione"
                />
              ) : req.input.multiline ? (
                <Textarea
                  id="confirm-input"
                  data-autofocus
                  rows={3}
                  value={value}
                  placeholder={req.input.placeholder}
                  onChange={(e) => setValue(e.target.value)}
                />
              ) : (
                <Input
                  id="confirm-input"
                  data-autofocus
                  value={value}
                  placeholder={req.input.placeholder}
                  onChange={(e) => setValue(e.target.value)}
                />
              )}
            </Field>
          )}
          {req.typeToConfirm && (
            <Field label={`Digite ${req.typeToConfirm} para confirmar`} error={typeError} htmlFor="confirm-type">
              <Input id="confirm-type" data-autofocus={!req.input || undefined} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </Field>
          )}
        </form>
      )}
    </Modal>
  )
}
