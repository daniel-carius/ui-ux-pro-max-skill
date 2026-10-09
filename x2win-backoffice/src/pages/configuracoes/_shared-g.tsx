// Peças compartilhadas pelas telas de Configurações (parte 2):
// cargo com descrição, selos de 2FA, bloco de código, segredo exibido uma vez
// e um ajudante para salvar mudanças imediatas sem perder o rascunho do formulário.
import { useEffect, useRef, type ReactNode } from 'react'
import { AlertTriangle, Lock, ShieldCheck, ShieldOff } from 'lucide-react'
import { Badge, CopyButton, Field, Select, type SettingsForm } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { Role } from '@/domain/roles'
import { ceilingLabel } from '@/domain/roles'
import { isAdminLevelRole, namesLookAlike, roleColorVar } from '@/domain/config2-access'

/**
 * Ações imediatas (conectar conta, adicionar IP) gravam direto no valor salvo.
 * O useSettingsForm reinicia o rascunho quando o salvo muda; este ajudante
 * reaplica o rascunho com a mesma mudança, para não perder o que não foi salvo.
 */
export function useExternalSave<T>(form: SettingsForm<T>, setSaved: (v: T) => void) {
  const pending = useRef<T | null>(null)
  const savedStr = JSON.stringify(form.saved)
  useEffect(() => {
    if (pending.current) {
      form.setValues(pending.current)
      pending.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedStr])
  return (change: (prev: T) => T) => {
    const nextSaved = change(form.saved)
    pending.current = form.dirty ? change(form.values) : null
    setSaved(nextSaved)
  }
}

export function RoleDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', className)} style={{ background: roleColorVar(color) }} />
}

export function RoleBadge({ role, className }: { role: Role | undefined; className?: string }) {
  if (!role) return <Badge tone="danger">Cargo removido</Badge>
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface-3 px-2 py-0.5 text-xs font-medium text-fg', className)}>
      <RoleDot color={role.color} className="h-2 w-2" />
      <span className="truncate">{role.name}</span>
      {role.system && <span className="text-[10.5px] font-normal text-fg-3">sistema</span>}
    </span>
  )
}

export function TwoFactorBadge({ on, required }: { on: boolean; required?: boolean }) {
  if (on) return <Badge tone="success" icon={ShieldCheck}>2FA ligado</Badge>
  return <Badge tone={required ? 'danger' : 'warning'} icon={ShieldOff}>{required ? '2FA pendente' : '2FA desligado'}</Badge>
}

/**
 * Seleção de cargo com a descrição logo abaixo (achado 9: nomes parecidos).
 * Cargos administrativos ficam travados para quem não pode concedê-los.
 */
export function RoleSelect({
  id,
  roles,
  value,
  onChange,
  canGrant,
  label = 'Cargo',
  lockedIds = [],
  error,
}: {
  id: string
  roles: Role[]
  value: string
  onChange: (id: string) => void
  canGrant: boolean
  label?: string
  lockedIds?: string[]
  error?: string | null
}) {
  const selected = roles.find((r) => r.id === value)
  const lookAlike = selected ? roles.filter((r) => r.id !== selected.id && namesLookAlike(r.name, selected.name)) : []
  return (
    <Field label={label} htmlFor={id} required error={error}>
      <Select
        id={id}
        value={value}
        onChange={onChange}
        placeholder="Escolha um cargo"
        options={roles.map((r) => {
          const locked = (isAdminLevelRole(r) && !canGrant) || lockedIds.includes(r.id)
          return { value: r.id, label: `${r.name}${r.system ? ' (sistema)' : ''}${locked ? ' · só Superadmin concede' : ''}`, disabled: locked }
        })}
      />
      {selected && (
        <div className="mt-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <RoleDot color={selected.color} />
            <span className="text-[13px] font-semibold text-fg">{selected.name}</span>
            {selected.system ? <Badge icon={Lock}>Sistema</Badge> : <Badge tone="info">Personalizado</Badge>}
            {isAdminLevelRole(selected) && <Badge tone="warning">Administrativo</Badge>}
          </div>
          <p className="mt-1 text-[13px] leading-5 text-fg-2">{selected.description || 'Sem descrição.'}</p>
          <p className="mt-1 text-xs text-fg-3">
            {selected.permissions.length} permissões · 2FA {selected.require2fa ? 'exigido' : 'opcional'} · saques: {ceilingLabel(selected).toLowerCase()}
          </p>
          {lookAlike.length > 0 && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-warning">
              <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden />
              Não confunda com {lookAlike.map((r) => `"${r.name}"`).join(', ')}: são cargos diferentes.
            </p>
          )}
        </div>
      )}
    </Field>
  )
}

/** Bloco de código com botão de copiar. */
export function CodeBlock({ code, label, className }: { code: string; label: string; className?: string }) {
  return (
    <div className={cn('relative rounded-xl border border-line bg-surface-2', className)}>
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-xs font-medium text-fg-3">{label}</span>
        <CopyButton value={code} label={`Copiar ${label.toLowerCase()}`} />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-5 text-fg-2">
        <code>{code}</code>
      </pre>
    </div>
  )
}

/** Segredo mostrado uma única vez (senha temporária, token novo). */
export function OneTimeSecret({ value, label, warning }: { value: string; label: string; warning: ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-[13px] font-medium text-fg">{label}</p>
        <div className="flex items-center gap-2 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-3">
          <code className="min-w-0 flex-1 break-all font-mono text-[14px] font-semibold text-fg" aria-label={label}>
            {value}
          </code>
          <CopyButton value={value} label={`Copiar ${label.toLowerCase()}`} />
        </div>
      </div>
      <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-[13px] leading-5 text-fg-2">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden />
        <span>{warning}</span>
      </p>
    </div>
  )
}

/** Valor pequeno com rótulo (resumos dentro de cartões). */
export function MiniStat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'success' | 'danger' | 'warning' }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 px-3 py-2.5">
      <p className="truncate text-xs text-fg-3">{label}</p>
      <p className={cn('mt-0.5 truncate text-base font-bold tnum', tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-fg')}>{value}</p>
      {sub && <p className="truncate text-xs text-fg-3">{sub}</p>}
    </div>
  )
}

/** Selo quadrado com a inicial da plataforma, na cor da paleta de gráficos. */
export function PlatformMark({ letter, slot, size = 36 }: { letter: string; slot: number; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-xl font-display font-bold text-primary-fg"
      style={{ width: size, height: size, background: `var(--chart-${slot})`, fontSize: size * 0.42 }}
    >
      {letter}
    </span>
  )
}
