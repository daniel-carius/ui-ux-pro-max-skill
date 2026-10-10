import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, CalendarDays, Check, Copy, GripVertical, ImageUp, KeyRound, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { svgProblem } from '@shared/svg'
import { date as fmtDate, hasMaskChars, maskSecret } from '@/lib/format'
import { DAY, NOW, dayKey, endOfDay, startOfDay } from '@/data/now'
import { Button, IconButton } from './Button'
import { Segmented } from './Controls'
import { toast } from './Feedback'
import { Field, Input } from './Field'
import { Modal, Popover } from './Overlay'

// ---------- Período ----------

export type PresetId = 'hoje' | '7d' | '30d' | '90d' | 'mes' | 'mes_passado' | 'custom'

export interface DateRange {
  from: Date
  to: Date
  preset: PresetId
}

export const PRESET_LABEL: Record<PresetId, string> = {
  hoje: 'Hoje',
  '7d': '7 dias',
  '30d': '30 dias',
  '90d': '90 dias',
  mes: 'Este mês',
  mes_passado: 'Mês passado',
  custom: 'Personalizado',
}

export function presetRange(id: PresetId, base: Date = NOW): DateRange {
  const today = startOfDay(base)
  const end = endOfDay(base)
  switch (id) {
    case 'hoje':
      return { from: today, to: end, preset: id }
    case '7d':
      return { from: new Date(today.getTime() - 6 * DAY), to: end, preset: id }
    case '30d':
      return { from: new Date(today.getTime() - 29 * DAY), to: end, preset: id }
    case '90d':
      return { from: new Date(today.getTime() - 89 * DAY), to: end, preset: id }
    case 'mes':
      return { from: new Date(base.getFullYear(), base.getMonth(), 1), to: end, preset: id }
    case 'mes_passado':
      return {
        from: new Date(base.getFullYear(), base.getMonth() - 1, 1),
        to: endOfDay(new Date(base.getFullYear(), base.getMonth(), 0)),
        preset: id,
      }
    default:
      return { from: new Date(today.getTime() - 29 * DAY), to: end, preset: '30d' }
  }
}

/** Período imediatamente anterior, de mesmo tamanho (para comparação). */
export function previousRange(r: DateRange): DateRange {
  const len = Math.round((startOfDay(r.to).getTime() - startOfDay(r.from).getTime()) / DAY) + 1
  const to = endOfDay(new Date(startOfDay(r.from).getTime() - DAY))
  const from = startOfDay(new Date(startOfDay(r.from).getTime() - len * DAY))
  return { from, to, preset: 'custom' }
}

export function inRange(isoOrKey: string, r: DateRange) {
  // aceita "AAAA-MM-DD" ou ISO completo
  if (isoOrKey.length === 10) return isoOrKey >= dayKey(r.from) && isoOrKey <= dayKey(r.to)
  const t = new Date(isoOrKey).getTime()
  return t >= r.from.getTime() && t <= r.to.getTime()
}

export function rangeLabel(r: DateRange) {
  return `${fmtDate(r.from)} – ${fmtDate(r.to)}`
}

/** Seletor de período: atalhos + datas livres. */
export function DateRangePicker({
  value,
  onChange,
  presets = ['7d', '30d', '90d'],
  className,
}: {
  value: DateRange
  onChange: (r: DateRange) => void
  presets?: PresetId[]
  className?: string
}) {
  const [from, setFrom] = useState(dayKey(value.from))
  const [to, setTo] = useState(dayKey(value.to))
  const isPreset = presets.includes(value.preset)
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Segmented
        ariaLabel="Período"
        value={isPreset ? value.preset : ('custom' as PresetId)}
        onChange={(id) => id !== 'custom' && onChange(presetRange(id))}
        options={presets.map((p) => ({ value: p, label: PRESET_LABEL[p] }))}
      />
      <Popover
        align="end"
        width={300}
        title="Datas livres"
        trigger={(p) => (
          <Button {...p} size="sm" icon={CalendarDays} className={cn('h-9', !isPreset && 'border-primary text-primary-text')}>
            <span className="tnum">{rangeLabel(value)}</span>
          </Button>
        )}
      >
        {(close) => (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              const f = startOfDay(new Date(`${from}T00:00:00`))
              const t = endOfDay(new Date(`${to}T00:00:00`))
              if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || f > t) {
                toast.error('Período inválido', { description: 'A data inicial precisa ser antes da final.' })
                return
              }
              onChange({ from: f, to: t, preset: 'custom' })
              close()
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <Field label="De" htmlFor="dr-from">
                <Input id="dr-from" type="date" value={from} max={dayKey(NOW)} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="Até" htmlFor="dr-to">
                <Input id="dr-to" type="date" value={to} max={dayKey(NOW)} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['hoje', 'mes', 'mes_passado'] as PresetId[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className="rounded-full border border-line px-2.5 py-1 text-xs text-fg-2 hover:border-line-strong hover:text-fg"
                  onClick={() => {
                    onChange(presetRange(p))
                    close()
                  }}
                >
                  {PRESET_LABEL[p]}
                </button>
              ))}
            </div>
            <Button type="submit" variant="primary" block size="sm">
              Aplicar
            </Button>
          </form>
        )}
      </Popover>
    </div>
  )
}

// ---------- Imagem ----------

/**
 * Envio de imagem com prévia. Guarda como data URL (no servidor real, seria
 * um upload para o storage). Avisa se o tamanho não bate com o recomendado.
 */
/** Prévia só de imagem embutida, do navegador, https ou da mesma origem (nada de javascript:, http: ou //host). */
const PREVIEWABLE_IMAGE = /^(data:image\/|blob:|https:\/\/|\/(?!\/))/i

export function ImageUpload({
  value,
  onChange,
  width,
  height,
  label,
  hint,
  disabled,
  rounded,
  className,
  previewClassName,
  minSquare,
}: {
  value: string | null
  onChange: (dataUrl: string | null) => void
  width?: number
  height?: number
  /** exige imagem quadrada com pelo menos este lado em px (PNG/JPG/WEBP; SVG é vetor e passa): fora disso, recusa */
  minSquare?: number
  label?: string
  hint?: ReactNode
  disabled?: boolean
  rounded?: boolean
  className?: string
  previewClassName?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  // imagem que o navegador não carregou (ex.: endereço externo barrado pela CSP img-src): volta ao estado vazio
  const [failed, setFailed] = useState<string | null>(null)
  const shown = value && failed !== value && PREVIEWABLE_IMAGE.test(value) ? value : null

  const handleFile = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Arquivo inválido', { description: 'Envie uma imagem PNG, JPG, WEBP ou SVG.' })
      return
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error('Imagem muito grande', { description: 'O limite é 3 MB.' })
      return
    }
    // SVG: a mesma regra do servidor já no envio (antes a imagem entrava e a gravação inteira era desfeita ao salvar)
    if (file.type === 'image/svg+xml') {
      void file.text().then((text) => {
        const problem = svgProblem(text)
        if (problem) {
          toast.error('Imagem SVG não aceita', {
            description: `O arquivo tem ${problem}. Exporte o SVG sem scripts nem links externos, ou envie a imagem em PNG, JPG ou WEBP.`,
            duration: 8000,
          })
          return
        }
        readImage(file)
      })
      return
    }
    readImage(file)
  }

  const readImage = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      if (minSquare && file.type !== 'image/svg+xml') {
        const img = new window.Image()
        img.onload = () => {
          const w = img.naturalWidth
          const h = img.naturalHeight
          if (w !== h || w < minSquare) {
            toast.error('Imagem fora do tamanho pedido', {
              description: `A imagem tem ${w}×${h} px. Envie uma imagem quadrada com pelo menos ${minSquare}×${minSquare} px.`,
              duration: 7000,
            })
            return
          }
          onChange(url)
        }
        img.onerror = () => toast.error('Não foi possível ler a imagem', { description: 'Envie uma imagem PNG, JPG ou WEBP.' })
        img.src = url
        return
      }
      if (width && height && file.type !== 'image/svg+xml') {
        const img = new window.Image()
        img.onload = () => {
          if (img.naturalWidth !== width || img.naturalHeight !== height) {
            toast.warning('Tamanho diferente do recomendado', {
              description: `A imagem tem ${img.naturalWidth}×${img.naturalHeight} px; o ideal é ${width}×${height} px.`,
            })
          }
          onChange(url)
        }
        img.src = url
      } else {
        onChange(url)
      }
    }
    reader.readAsDataURL(file)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (!disabled) handleFile(e.dataTransfer.files?.[0])
  }

  const ratio = width && height ? `${width} / ${height}` : undefined

  return (
    <div className={cn('min-w-0', className)}>
      {label && <p className="mb-1.5 text-[13px] font-medium text-fg">{label}</p>}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          'relative flex items-center justify-center overflow-hidden border-2 border-dashed bg-surface-2 transition-colors duration-150',
          rounded ? 'rounded-full' : 'rounded-xl',
          over ? 'border-primary bg-primary/5' : 'border-line-strong/70',
          previewClassName,
        )}
        style={{ aspectRatio: ratio, maxHeight: 260 }}
      >
        {shown ? (
          <img src={shown} alt={label ? `Prévia: ${label}` : 'Prévia da imagem'} className="h-full w-full object-contain" onError={() => setFailed(shown)} />
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="flex h-full min-h-[96px] w-full flex-col items-center justify-center gap-1.5 p-4 text-center text-fg-3 hover:text-fg-2 disabled:cursor-not-allowed"
          >
            <ImageUp size={22} aria-hidden />
            <span className="text-[13px] font-medium">{value ? 'Imagem salva sem prévia. Envie de novo' : 'Arraste ou clique para enviar'}</span>
            {width && height && <span className="text-xs tnum">{width}×{height} px</span>}
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" icon={ImageUp} disabled={disabled} onClick={() => inputRef.current?.click()}>
          {value ? 'Trocar imagem' : 'Enviar imagem'}
        </Button>
        {value && (
          <Button size="sm" variant="ghost" icon={Trash2} disabled={disabled} onClick={() => onChange(null)}>
            Remover
          </Button>
        )}
        {hint && <span className="text-xs text-fg-3">{hint}</span>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}

// ---------- Lista reordenável ----------

/**
 * Lista com arrastar e soltar + botões subir/descer (acessível por teclado).
 *   <SortableList items={blocks} getKey={(b) => b.id} onChange={setBlocks} render={(b) => ...} />
 */
export function SortableList<T>({
  items,
  getKey,
  onChange,
  render,
  disabled,
  className,
}: {
  items: T[]
  getKey: (item: T) => string
  onChange: (items: T[]) => void
  render: (item: T, index: number) => ReactNode
  disabled?: boolean
  className?: string
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return
    const next = [...items]
    const [it] = next.splice(from, 1)
    next.splice(to, 0, it)
    onChange(next)
  }

  return (
    <ol className={cn('space-y-2', className)}>
      {items.map((item, i) => (
        <li
          key={getKey(item)}
          draggable={!disabled}
          onDragStart={(e) => {
            setDragIndex(i)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setOverIndex(i)
          }}
          onDragEnd={() => {
            setDragIndex(null)
            setOverIndex(null)
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (dragIndex !== null) move(dragIndex, i)
            setDragIndex(null)
            setOverIndex(null)
          }}
          className={cn(
            'flex items-center gap-2 rounded-xl border bg-surface p-2 pr-2.5 transition-[border-color,box-shadow,opacity] duration-150',
            dragIndex === i ? 'opacity-50' : '',
            overIndex === i && dragIndex !== null && dragIndex !== i ? 'border-primary shadow-ring' : 'border-line',
          )}
        >
          <span
            className={cn('flex h-8 w-6 shrink-0 items-center justify-center text-fg-3', !disabled && 'cursor-grab active:cursor-grabbing')}
            aria-hidden
          >
            <GripVertical size={16} />
          </span>
          <span className="w-5 shrink-0 text-center text-xs font-semibold text-fg-3 tnum">{i + 1}</span>
          <div className="min-w-0 flex-1">{render(item, i)}</div>
          <div className="flex shrink-0 items-center">
            <IconButton icon={ArrowUp} label="Subir" size="sm" disabled={disabled || i === 0} onClick={() => move(i, i - 1)} />
            <IconButton icon={ArrowDown} label="Descer" size="sm" disabled={disabled || i === items.length - 1} onClick={() => move(i, i + 1)} />
          </div>
        </li>
      ))}
    </ol>
  )
}

// ---------- Copiar / segredos / cor / etiquetas ----------

export function CopyButton({ value, label = 'Copiar' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <IconButton
      icon={done ? Check : Copy}
      label={done ? 'Copiado' : label}
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
        } catch {
          /* sem permissão: ignora */
        }
        setDone(true)
        toast.success('Copiado para a área de transferência')
        setTimeout(() => setDone(false), 1500)
      }}
    />
  )
}

const SECRET_REQUIRE_NEW = 'O destino desta credencial mudou: digite o segredo de novo.'
const SECRET_MASK_DRAFT = 'Digite o segredo completo, sem os caracteres de máscara.'
const SECRET_MIN = 8

/**
 * Erro de um segredo para a validação do formulário (o mesmo texto que o SecretField mostra).
 * Use no `validate` da tela para não salvar com o segredo pendente:
 *   validate: (v) => secretFieldError(v.apiSecret, { requireNew: destinoMudou, saved: salvo.apiSecret })
 *  - requireNew: o destino da credencial mudou (host, conta, ambiente…); o segredo salvo (a máscara)
 *    não vale mais e um segredo novo precisa ser digitado;
 *  - valor com • ou *** que não é a máscara salva: nunca é enviado (o servidor recusaria).
 */
export function secretFieldError(value: string, opts: { requireNew?: boolean; saved?: string } = {}): string | null {
  if (opts.requireNew && (!value || hasMaskChars(value) || (opts.saved !== undefined && value === opts.saved))) return SECRET_REQUIRE_NEW
  if (value && hasMaskChars(value) && opts.saved !== undefined && value !== opts.saved) return SECRET_MASK_DRAFT
  return null
}

/**
 * Segredo mascarado (só pontos; com 16+ caracteres, também os 4 últimos). Nunca exibe o
 * valor salvo; permite apenas substituir. Segredos são cifrados no servidor.
 *  - requireNew: o destino mudou e o segredo salvo não vale mais; o campo fica vazio, com o
 *    aviso, até um segredo novo ser digitado (a tela bloqueia o salvar com secretFieldError).
 *  - saved: valor salvo (a máscara no modo API), para saber se o segredo já foi trocado.
 *  - error: erro vindo do servidor para este campo (ex.: details.field 'secret').
 */
export function SecretField({
  label,
  value,
  onChange,
  disabled,
  hint,
  requireNew,
  saved,
  error,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  hint?: ReactNode
  requireNew?: boolean
  saved?: string
  error?: string | null
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const problem = secretFieldError(value, { requireNew, saved })
  // destino mudou: o segredo guardado não conta mais; o campo fica vazio até digitar um novo
  const pending = problem === SECRET_REQUIRE_NEW
  const shown = pending ? '' : value
  const fieldError = problem ?? error ?? null
  const draftValue = draft.trim()
  // com • ou ***, só passa a máscara salva exata, intocada (e nunca depois que o destino mudou)
  const draftError = draftValue && hasMaskChars(draftValue) && (pending || draftValue !== (saved ?? value)) ? SECRET_MASK_DRAFT : null
  const canSave = draftValue.length >= SECRET_MIN && !draftError
  const save = () => {
    if (!canSave) return
    onChange(draftValue)
    setOpen(false)
  }
  return (
    <Field label={label} required={requireNew} error={fieldError} hint={hint ?? 'Cifrado no servidor. Nunca aparece por inteiro.'}>
      <div className="flex gap-2">
        <div className={cn('input-base flex min-w-0 items-center gap-2 bg-surface-2 font-mono text-[13px] text-fg-2', fieldError && 'border-danger')}>
          <KeyRound size={14} className="shrink-0 text-fg-3" aria-hidden />
          <span className={cn('truncate', !shown && 'font-sans text-fg-3')}>{shown ? maskSecret(shown) : pending ? 'Digite o segredo de novo' : 'Não configurado'}</span>
        </div>
        <Button
          disabled={disabled}
          onClick={() => {
            setDraft('')
            setOpen(true)
          }}
        >
          {shown ? 'Substituir' : 'Definir'}
        </Button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${shown ? 'Substituir' : 'Definir'} ${label}`}
        description={pending ? SECRET_REQUIRE_NEW : 'O valor novo substitui o atual e não poderá ser visto de novo.'}
        icon={KeyRound}
        size="sm"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancelar</Button>
            <Button variant="primary" disabled={!canSave} onClick={save}>
              Salvar segredo
            </Button>
          </>
        }
      >
        <Field label="Novo valor" hint={`Mínimo de ${SECRET_MIN} caracteres.`} error={draftError} htmlFor="secret-new">
          <Input
            id="secret-new"
            data-autofocus
            type="password"
            autoComplete="off"
            value={draft}
            invalid={!!draftError}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                save()
              }
            }}
          />
        </Field>
      </Modal>
    </Field>
  )
}

export function ColorInput({
  value,
  onChange,
  id,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  id?: string
  disabled?: boolean
}) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value)
  return (
    <div className="flex items-center gap-2">
      <label
        className={cn('relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-line-strong', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}
        style={{ background: valid ? value : 'transparent' }}
      >
        <span className="sr-only">Escolher cor</span>
        <input
          type="color"
          disabled={disabled}
          value={valid ? value : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        invalid={!valid}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono uppercase"
        maxLength={7}
      />
    </div>
  )
}

export function TagInput({
  value,
  onChange,
  placeholder = 'Digite e tecle Enter',
  disabled,
  id,
}: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  disabled?: boolean
  id?: string
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim().replace(/,$/, '')
    if (v && !value.includes(v)) onChange([...value, v])
    setDraft('')
  }
  return (
    <div className={cn('input-base flex h-auto min-h-[40px] flex-wrap items-center gap-1.5 py-1.5', disabled && 'bg-surface-2')}>
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-0.5 text-[13px] text-fg">
          {t}
          {!disabled && (
            <button type="button" aria-label={`Remover ${t}`} onClick={() => onChange(value.filter((x) => x !== t))} className="text-fg-3 hover:text-fg">
              <X size={12} />
            </button>
          )}
        </span>
      ))}
      <input
        id={id}
        disabled={disabled}
        value={draft}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={add}
        className="min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-fg-3"
      />
    </div>
  )
}
