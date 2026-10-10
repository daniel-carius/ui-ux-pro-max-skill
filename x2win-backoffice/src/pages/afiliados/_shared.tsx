// Peças visuais do programa de afiliados, usadas também nas telas de Crescimento
// (Indicados, Links e Comissões).
import { useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Crown, Eye, EyeOff, Gamepad2, Landmark, Lock, Megaphone, QrCode, Sprout, X } from 'lucide-react'
import type { SeriesSlot } from '@/components/charts'
import { Badge, Button, DescriptionList, Input, Mono, toast, type Tone } from '@/components/ui'
import type { Affiliate, AffiliateType } from '@/data/players'
import { PAYOUT_METHOD_LABEL, type PayoutMethod } from '@/data/afiliados'
import { maskAffiliatePixKey, revealAffiliateContact, type AffiliateContactDetails } from '@/domain/afiliados'
import { maskEmail } from '@/lib/format'
import { cn } from '@/lib/cn'

export const TYPE_META: Record<AffiliateType, { label: string; icon: LucideIcon; tone: Tone; slot: SeriesSlot; description: string }> = {
  Manager: {
    label: 'Manager',
    icon: Crown,
    tone: 'primary',
    slot: 7,
    description: 'Gerente de afiliados: recruta e acompanha uma rede de subafiliados.',
  },
  Influencer: {
    label: 'Influencer',
    icon: Megaphone,
    tone: 'gold',
    slot: 4,
    description: 'Criador de conteúdo que divulga para a própria audiência.',
  },
  Organic: {
    label: 'Organic',
    icon: Sprout,
    tone: 'success',
    slot: 3,
    description: 'Afiliado comum, que indica amigos e divulga por conta própria.',
  },
}

/** Fundo e cor do ícone de cada tipo (só tokens de tema). */
export const TYPE_ICON_CLASS: Record<AffiliateType, string> = {
  Manager: 'bg-primary/10 text-primary-text',
  Influencer: 'bg-gold/15 text-warning dark:text-gold',
  Organic: 'bg-success/10 text-success',
}

export function AffiliateTypeBadge({ type, className }: { type: AffiliateType; className?: string }) {
  const m = TYPE_META[type]
  return (
    <Badge tone={m.tone} icon={m.icon} className={className}>
      {m.label}
    </Badge>
  )
}

export function LevelBadge({ level }: { level: 1 | 2 }) {
  return (
    <Badge tone={level === 1 ? 'info' : 'neutral'} className="tnum">
      {level === 1 ? '1 · direto' : '2 · subafiliado'}
    </Badge>
  )
}

export const METHOD_ICON: Record<PayoutMethod, LucideIcon> = { pix: QrCode, ted: Landmark, saldo: Gamepad2 }

export function MethodBadge({ method }: { method: PayoutMethod }) {
  return (
    <Badge tone="neutral" icon={METHOD_ICON[method]}>
      {method === 'saldo' ? 'Saldo do jogo' : PAYOUT_METHOD_LABEL[method]}
    </Badge>
  )
}

/** Valor em reais que pode ficar vazio (ex.: teto "sem teto"). */
export function OptionalMoneyInput({
  id,
  value,
  onChange,
  emptyLabel = 'Sem teto',
  invalid,
  disabled,
}: {
  id?: string
  value: number | null
  onChange: (v: number | null) => void
  emptyLabel?: string
  invalid?: boolean
  disabled?: boolean
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        prefix="R$"
        type="number"
        inputMode="decimal"
        min={0}
        step={0.01}
        disabled={disabled}
        invalid={invalid}
        placeholder={emptyLabel}
        value={value === null || !Number.isFinite(value) ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="tnum"
      />
      {value !== null && !disabled && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={`Limpar (${emptyLabel.toLowerCase()})`}
          title={emptyLabel}
          className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-fg-3 hover:bg-surface-3 hover:text-fg"
        >
          <X size={12} aria-hidden />
          <span className="hidden sm:inline">{emptyLabel}</span>
        </button>
      )}
    </div>
  )
}

/** Barra horizontal fina com cor da paleta de gráficos. */
export function MiniBar({ value, max, slot = 1, className, label }: { value: number; max: number; slot?: SeriesSlot; className?: string; label?: string }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)} role="img" aria-label={label}>
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${w}%`, background: `var(--chart-${slot})` }} />
    </div>
  )
}

/** Número de destaque com rótulo, para resumos dentro de cartões e gavetas. */
export function StatTile({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-xl bg-surface-2 p-3', className)}>
      <p className="truncate text-xs text-fg-3">{label}</p>
      <p className="mt-0.5 truncate font-display text-lg font-bold text-fg tnum">{value}</p>
      {sub && <p className="truncate text-xs text-fg-3">{sub}</p>}
    </div>
  )
}

/**
 * E-mail e chave PIX do afiliado. A lista vem mascarada; quem tem “Ver dados do PIX completos”
 * revela um afiliado por vez (modo API: o servidor devolve o dado e registra na auditoria).
 * O dado em claro fica só no estado deste bloco: some ao ocultar ou fechar a gaveta.
 * Use com key={afiliado.id} para não levar o dado revelado de um afiliado para outro.
 */
export function AffiliateContact({ affiliate: a, canReveal }: { affiliate: Affiliate; canReveal: boolean }) {
  const [clear, setClear] = useState<AffiliateContactDetails | null>(null)
  const [busy, setBusy] = useState(false)
  const reveal = async () => {
    if (!canReveal || busy) return
    setBusy(true)
    try {
      const r = await revealAffiliateContact(a)
      if (r.ok) setClear(r.data)
      else toast.error('Não foi possível mostrar os dados', { description: r.message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">Contato e pagamento</h3>
        {clear ? (
          <Button size="xs" variant="ghost" icon={EyeOff} onClick={() => setClear(null)}>
            Ocultar
          </Button>
        ) : (
          <Button
            size="xs"
            variant="soft"
            icon={Eye}
            onClick={reveal}
            loading={busy}
            disabled={!canReveal}
            title={!canReveal ? 'Revelar exige a permissão “Ver dados do PIX completos”' : undefined}
          >
            Revelar dados
          </Button>
        )}
      </div>
      <DescriptionList
        items={[
          { label: 'E-mail', value: <span className="break-all">{clear ? clear.email || '—' : maskEmail(a.email)}</span> },
          { label: 'Chave PIX', value: <Mono className="break-all text-fg">{clear ? clear.pixKey || '—' : maskAffiliatePixKey(a.pixKey)}</Mono> },
        ]}
      />
      {!clear && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-3">
          <Lock size={12} aria-hidden />
          {canReveal ? 'Revelar fica registrado na auditoria (LGPD).' : 'Seu cargo vê os dados mascarados (LGPD).'}
        </p>
      )}
    </section>
  )
}
