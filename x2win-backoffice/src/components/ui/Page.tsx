import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Calculator, ChevronRight, Eye, Lock, RotateCcw, Save } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { dbSetAndWaitResult, useDb } from '@/lib/store'
import { isApiMode, type ApiError } from '@/lib/api'
import { MODULE_BY_ID, pageByPath } from '@/nav'
import { audit, usePageAccess } from '@/domain/session'
import { Delta } from './Badge'
import { Button } from './Button'
import { toast } from './Feedback'
import { Popover } from './Overlay'
import { Skeleton } from './States'

/** Cabeçalho padrão da tela: breadcrumb, ícone, título, descrição e ações. */
export function PageHeader({
  title,
  description,
  icon,
  actions,
  children,
}: {
  title?: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  actions?: ReactNode
  children?: ReactNode
}) {
  const { pathname } = useLocation()
  const page = pageByPath(pathname)
  const mod = page ? MODULE_BY_ID.get(page.module) : undefined
  const Icon = icon ?? page?.icon
  const { canEdit, pageId } = usePageAccess()
  const readOnly = !!page?.editable && !canEdit && !!pageId
  return (
    <header className="mb-6">
      {mod && (
        <nav aria-label="Você está em" className="mb-3 flex items-center gap-1 text-xs text-fg-3">
          <span>{mod.title}</span>
          <ChevronRight size={12} aria-hidden />
          <span className="text-fg-2">{page?.title}</span>
        </nav>
      )}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          {Icon && (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary-text ring-1 ring-inset ring-primary/15">
              <Icon size={22} aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-bold leading-8 text-fg">{title ?? page?.title}</h1>
              {readOnly && (
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg-3">
                  <Eye size={12} aria-hidden /> Somente leitura
                </span>
              )}
            </div>
            {(description ?? page?.description) && (
              <p className="mt-0.5 max-w-3xl text-sm leading-6 text-fg-3">{description ?? page?.description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  )
}

/** Botão "Como é calculado" com a fórmula do indicador. */
export function Formula({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Popover
      width={300}
      align="end"
      title={title}
      trigger={(p) => (
        <button
          {...p}
          type="button"
          aria-label={`Como é calculado: ${title}`}
          title="Como é calculado"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-surface-3 hover:text-fg"
        >
          <Calculator size={14} aria-hidden />
        </button>
      )}
    >
      <div className="text-[13px] leading-5 text-fg-2">{children}</div>
    </Popover>
  )
}

export interface KpiCardProps {
  label: string
  value: ReactNode
  icon?: LucideIcon
  /** variação vs período anterior, em fração (0.12 = +12%) */
  delta?: number | null
  goodWhenUp?: boolean
  hint?: ReactNode
  formula?: ReactNode
  /** pequeno gráfico abaixo do valor */
  chart?: ReactNode
  tone?: 'primary' | 'success' | 'danger' | 'warning' | 'info' | 'neutral'
  loading?: boolean
  className?: string
  onClick?: () => void
  active?: boolean
}

const KPI_TONE = {
  primary: 'bg-primary/10 text-primary-text',
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-info/10 text-info',
  neutral: 'bg-surface-3 text-fg-2',
}

/** Indicador: rótulo, valor, variação, fórmula e sparkline. */
export function KpiCard({ label, value, icon: Icon, delta, goodWhenUp = true, hint, formula, chart, tone = 'primary', loading, className, onClick, active }: KpiCardProps) {
  // Cartão clicável: um botão cobre o cartão inteiro e o botão da fórmula fica por cima,
  // evitando botão dentro de botão.
  return (
    <div
      className={cn(
        'card relative flex min-w-0 flex-col p-4 text-left',
        onClick && 'transition-[border-color,box-shadow] duration-150 hover:border-line-strong',
        active && 'border-primary shadow-ring',
        className,
      )}
    >
      {onClick && (
        <button
          type="button"
          onClick={onClick}
          aria-pressed={!!active}
          aria-label={`Filtrar por ${label}`}
          className="absolute inset-0 rounded-xl"
        />
      )}
      <div className="pointer-events-none relative flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && (
            <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', KPI_TONE[tone])}>
              <Icon size={15} aria-hidden />
            </span>
          )}
          <span className="text-[13px] font-medium leading-tight text-fg-2">{label}</span>
        </div>
        {formula && (
          <span className="pointer-events-auto">
            <Formula title={label}>{formula}</Formula>
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-32" />
      ) : (
        <div className="pointer-events-none relative mt-2.5 truncate font-display text-[26px] font-bold leading-8 tracking-tight text-fg">{value}</div>
      )}
      {(delta !== undefined || hint) && (
        <div className="pointer-events-none relative mt-1 flex min-h-[18px] flex-wrap items-center gap-x-1.5 text-xs text-fg-3">
          {delta !== undefined && <Delta value={delta} goodWhenUp={goodWhenUp} />}
          {hint && <span className="truncate">{hint}</span>}
        </div>
      )}
      {chart && <div className="relative mt-3 h-10">{chart}</div>}
    </div>
  )
}

/** Bloco de configurações: título e descrição à esquerda, campos à direita. */
export function SettingsSection({
  title,
  description,
  children,
  aside,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  aside?: ReactNode
  className?: string
}) {
  return (
    <section className={cn('card grid gap-5 p-5 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)] lg:gap-8', className)}>
      <div>
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        {description && <p className="mt-1 text-[13px] leading-5 text-fg-3">{description}</p>}
        {aside && <div className="mt-3">{aside}</div>}
      </div>
      <div className="min-w-0 space-y-5">{children}</div>
    </section>
  )
}

/** Grade de campos responsiva */
export function FormGrid({ children, columns = 2, className }: { children: ReactNode; columns?: 1 | 2 | 3; className?: string }) {
  return (
    <div
      className={cn(
        'grid gap-4',
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-2 xl:grid-cols-3',
        className,
      )}
    >
      {children}
    </div>
  )
}

function stableStringify(v: unknown) {
  return JSON.stringify(v)
}

export interface SettingsForm<T> {
  /** rascunho atual (o que está na tela) */
  values: T
  /** valor salvo */
  saved: T
  set: <K extends keyof T>(key: K, value: T[K]) => void
  patch: (p: Partial<T>) => void
  setValues: (v: T | ((prev: T) => T)) => void
  dirty: boolean
  reset: () => void
  save: () => void
  saving: boolean
  readOnly: boolean
  /**
   * Modo API: erro do servidor na última vez que salvou (limpa ao editar ou salvar de novo). A tela mostra junto
   * do campo (details.field) os erros que passou em `quiet`.
   */
  error?: ApiError | null
}

/**
 * Formulário de configuração ligado ao "back-end" (store), com rascunho,
 * detecção de alterações, auditoria e aviso de sucesso.
 *
 *   const form = useSettingsForm('saques.regras', DEFAULTS, { entity: 'Regras de saque' })
 *   <MoneyInput value={form.values.min} onValueChange={(v) => form.set('min', v)} />
 *   <SaveBar form={form} />
 */
export function useSettingsForm<T>(
  key: string,
  defaults: T | (() => T),
  opts: {
    entity: string
    validate?: (v: T) => string | null
    onSaved?: (v: T, prev: T) => void
    successMessage?: string
    /** nomes legíveis dos campos para o resumo da auditoria */
    fieldLabels?: Partial<Record<keyof T & string, string>>
    /** modo API: erros do servidor que a tela mostra no campo (form.error), sem o aviso "Alteração desfeita" */
    quiet?: (e: ApiError) => boolean
  },
): SettingsForm<T> {
  const [saved, setSaved] = useDb<T>(key, defaults)
  const [values, setDraft] = useState<T>(saved)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  // editar o rascunho tira o erro da última gravação
  const setValues = (v: T | ((prev: T) => T)) => {
    setError(null)
    setDraft(v)
  }
  const { canEdit } = usePageAccess()
  const savedStr = stableStringify(saved)
  const savedRef = useRef(saved)
  savedRef.current = saved
  // modo API: rascunho que fica na tela enquanto o servidor responde (a gravação otimista e o desfazer mudam o salvo)
  const keepDraft = useRef<T | null>(null)

  // se o valor salvo mudar por fora (outra aba, reset), atualiza o rascunho
  useEffect(() => {
    setDraft(keepDraft.current ?? saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedStr])

  const dirty = useMemo(() => stableStringify(values) !== savedStr, [values, savedStr])

  return {
    values,
    saved,
    set: (k, v) => setValues((prev) => ({ ...prev, [k]: v })),
    patch: (p) => setValues((prev) => ({ ...prev, ...p })),
    setValues,
    dirty,
    readOnly: !canEdit,
    saving,
    error,
    reset: () => setValues(saved),
    save: () => {
      if (!canEdit) {
        toast.error('Seu cargo não pode editar esta tela.')
        return
      }
      const err = opts.validate?.(values)
      if (err) {
        toast.error('Revise os campos', { description: err })
        return
      }
      setSaving(true)
      setError(null)
      const prev = saved
      const changed =
        values && typeof values === 'object' && !Array.isArray(values)
          ? Object.keys(values as object).filter(
              (k) => stableStringify((values as Record<string, unknown>)[k]) !== stableStringify((prev as Record<string, unknown>)[k]),
            )
          : []
      const finish = (ok: boolean) => {
        setSaving(false)
        if (!ok) return
        opts.onSaved?.(values, prev)
        toast.success(opts.successMessage ?? 'Alterações salvas', { description: 'A mudança já vale no site e foi registrada na auditoria.' })
      }
      if (isApiMode()) {
        // o servidor valida, grava a auditoria e confirma; erro aparece pelo adaptador (ou no campo, com quiet)
        const draft = values
        keepDraft.current = draft
        void dbSetAndWaitResult(key, draft, defaults, opts.quiet ? { quiet: opts.quiet } : undefined).then((r) => {
          keepDraft.current = null
          const onField = !r.ok && !!r.error && !!opts.quiet?.(r.error)
          // erro mostrado no campo: o rascunho continua para a pessoa corrigir. Senão, sem edição durante a
          // gravação, o rascunho passa a ser o que o servidor tem (valor gravado, ou o anterior se recusou)
          const latest = savedRef.current
          if (!onField) setDraft((cur) => (cur === draft ? latest : cur))
          if (!r.ok) setError(r.error)
          finish(r.ok)
        })
        return
      }
      // modo demonstração: pequena espera para dar retorno visual de "salvando"
      setTimeout(() => {
        setSaved(values)
        const labels = opts.fieldLabels as Record<string, string> | undefined
        const names = changed.map((k) => labels?.[k] ?? k)
        audit('editar', opts.entity, names.length ? `Campos alterados: ${names.join(', ')}` : 'Configuração salva')
        finish(true)
      }, 450)
    },
  }
}

/**
 * Barra fixa no rodapé com "Salvar alterações". Aparece quando há mudanças.
 * Em cargos sem edição, mostra o aviso de somente leitura.
 */
export function SaveBar<T>({ form, label = 'Salvar alterações' }: { form: SettingsForm<T>; label?: string }) {
  if (form.readOnly) {
    return (
      <div className="sticky bottom-4 z-30 mt-6 flex justify-center">
        <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] text-fg-3 shadow-pop">
          <Lock size={14} aria-hidden /> Seu cargo pode ver, mas não editar esta tela.
        </div>
      </div>
    )
  }
  return (
    <div
      className={cn(
        'sticky bottom-4 z-30 mt-6 transition-[opacity,transform] duration-200',
        form.dirty ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
      )}
      aria-hidden={!form.dirty}
    >
      <div className="mx-auto flex max-w-3xl flex-col items-stretch gap-3 rounded-2xl border border-line bg-surface/95 p-3 pl-4 shadow-pop backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-fg-2">
          <span className="h-2 w-2 rounded-full bg-warning" aria-hidden />
          Alterações não salvas
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={RotateCcw} onClick={form.reset} disabled={!form.dirty || form.saving} tabIndex={form.dirty ? 0 : -1}>
            Descartar
          </Button>
          <Button variant="primary" icon={Save} onClick={form.save} loading={form.saving} disabled={!form.dirty} tabIndex={form.dirty ? 0 : -1}>
            {label}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Conteúdo de um formulário de configuração: desabilita campos se for só leitura. */
export function FormFieldset({ readOnly, children, className }: { readOnly: boolean; children: ReactNode; className?: string }) {
  return (
    <fieldset disabled={readOnly} className={cn('min-w-0 space-y-5', className)}>
      {children}
    </fieldset>
  )
}

/** Link interno com estilo */
export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="link">
      {children}
    </Link>
  )
}
