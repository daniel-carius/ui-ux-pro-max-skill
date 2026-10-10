// Peças visuais do módulo Cassino: capa gerada do jogo, logotipo em monograma
// das provedoras e dos agregadores, ícone por categoria e barra de "salvar ordem".
import { useState, type CSSProperties, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Clapperboard, Cherry, EyeOff, Flame, Gem, Grid3x3, RotateCcw, Rocket, Save, Spade, Sparkles, Star, Zap } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { Game, GameCategory } from '@/data/catalog'
import type { GameBadge } from '@/domain/cassino'
import { safeImageSrc } from '@/domain/personalizacao-p1'

export const CATEGORY_ICON: Record<GameCategory, LucideIcon> = {
  slots: Cherry,
  ao_vivo: Clapperboard,
  crash: Rocket,
  mesa: Spade,
  instantaneo: Zap,
  bingo: Grid3x3,
}

export const BADGE_ICON: Record<GameBadge | 'novo', LucideIcon> = {
  novo: Sparkles,
  em_alta: Flame,
  exclusivo: Star,
  jackpot: Gem,
}

/** Iniciais para monograma: "Pragmatic Play" → PP, "Spribe" → SP. */
export function monogram(name: string) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (words[0] ?? '?').slice(0, 2).toUpperCase()
}

// Arte gerada: as cores vêm do "hue" do jogo e independem do tema (é uma imagem).
const ink = (h: number, a = 1) => `hsl(${h} 100% 97% / ${a})`
const shade = (h: number, a: number) => `hsl(${(h + 25) % 360} 70% 10% / ${a})`

function coverBackground(h: number): CSSProperties {
  return {
    backgroundColor: `hsl(${h} 70% 40%)`,
    backgroundImage: [
      `radial-gradient(120% 75% at 88% 6%, hsl(${(h + 40) % 360} 95% 70% / 0.65), transparent 55%)`,
      `radial-gradient(90% 60% at 0% 100%, hsl(${(h + 330) % 360} 85% 22% / 0.95), transparent 65%)`,
      `repeating-linear-gradient(135deg, hsl(${h} 100% 98% / 0.05) 0 2px, transparent 2px 14px)`,
      `linear-gradient(160deg, hsl(${h} 82% 54%), hsl(${(h + 28) % 360} 76% 30%))`,
    ].join(','),
  }
}

export type CoverSize = 'thumb' | 'xs' | 'sm' | 'md'

/**
 * Capa do jogo. Usa a imagem enviada (só endereço seguro, ver safeImageSrc); sem imagem,
 * ou se ela não carregar (em produção a CSP bloqueia imagem externa), gera uma arte com a
 * cor do jogo, o nome, a provedora e o ícone da categoria (como um tile de cassino).
 */
export function GameCover({
  game,
  providerName,
  badges = [],
  size = 'md',
  hidden,
  className,
}: {
  game: Pick<Game, 'name' | 'hue' | 'category' | 'cover' | 'isNew'>
  providerName?: string
  badges?: GameBadge[]
  size?: CoverSize
  /** escurece a capa (jogo fora do site) */
  hidden?: boolean
  className?: string
}) {
  const Icon = CATEGORY_ICON[game.category]
  const h = game.hue
  const cover = safeImageSrc(game.cover)
  const [failed, setFailed] = useState<string | null>(null)
  const showCover = !!cover && failed !== cover
  const tags: (GameBadge | 'novo')[] = [...(game.isNew ? (['novo'] as const) : []), ...badges]
  const showText = size !== 'thumb'
  const big = size === 'md'
  return (
    <div
      className={cn(
        'relative isolate aspect-[4/5] w-full select-none overflow-hidden',
        size === 'thumb' ? 'rounded-md' : size === 'xs' ? 'rounded-lg' : 'rounded-xl',
        className,
      )}
      style={showCover ? undefined : coverBackground(h)}
      role="img"
      aria-label={`Capa de ${game.name}${providerName ? `, ${providerName}` : ''}`}
    >
      {showCover && cover ? (
        <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" onError={() => setFailed(cover)} />
      ) : (
        <>
          {/* ícone grande da categoria, ao fundo */}
          <Icon
            aria-hidden
            className="absolute -right-[12%] top-[8%] h-[78%] w-[78%] -rotate-12"
            style={{ color: ink(h, size === 'thumb' ? 0.35 : 0.2) }}
            strokeWidth={1.4}
          />
          {/* brilho e moldura interna */}
          <span aria-hidden className="absolute inset-0 rounded-[inherit]" style={{ boxShadow: `inset 0 0 0 1px ${ink(h, 0.18)}` }} />
          <span
            aria-hidden
            className="absolute -left-1/4 -top-1/3 h-2/3 w-[150%] rotate-[-18deg]"
            style={{ background: `linear-gradient(180deg, ${ink(h, 0.16)}, transparent)` }}
          />
          {showText && (
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-3/5"
              style={{ background: `linear-gradient(to top, ${shade(h, 0.85)}, ${shade(h, 0.35)} 55%, transparent)` }}
            />
          )}
          {showText && (
            <div className={cn('absolute inset-x-0 bottom-0', big ? 'p-3' : size === 'sm' ? 'p-2' : 'p-1')}>
              <p
                className={cn(
                  'line-clamp-2 font-display font-extrabold uppercase leading-[1.05] tracking-tight',
                  big ? 'break-words text-[17px]' : size === 'sm' ? 'break-words text-[13px]' : 'text-[8px] tracking-normal',
                )}
                style={{ color: ink(h), textShadow: `0 2px 10px ${shade(h, 0.6)}` }}
              >
                {game.name}
              </p>
              {providerName && size !== 'xs' && (
                <p className={cn('mt-1 truncate font-semibold uppercase tracking-[0.08em]', big ? 'text-[10px]' : 'text-[9px]')} style={{ color: ink(h, 0.75) }}>
                  {providerName}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* selos */}
      {size !== 'thumb' && tags.length > 0 && (
        <div className={cn('absolute left-0 right-0 top-0 flex flex-wrap gap-1', big ? 'p-2' : 'p-1.5')}>
          {tags.slice(0, size === 'xs' ? 1 : 3).map((t) => {
            const BIcon = BADGE_ICON[t]
            return (
              <span
                key={t}
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-full font-bold uppercase tracking-wide shadow-sm',
                  size === 'xs' ? 'px-1 py-px text-[7px]' : 'px-1.5 py-0.5 text-[9px]',
                )}
                style={
                  t === 'novo'
                    ? { background: 'hsl(45 100% 55%)', color: 'hsl(30 80% 12%)' }
                    : t === 'em_alta'
                      ? { background: 'hsl(8 90% 55%)', color: 'hsl(0 0% 100%)' }
                      : t === 'jackpot'
                        ? { background: 'hsl(280 70% 45%)', color: 'hsl(280 100% 97%)' }
                        : { background: 'hsl(200 15% 12% / 0.7)', color: 'hsl(45 100% 70%)' }
                }
              >
                {size !== 'xs' && <BIcon size={9} aria-hidden strokeWidth={2.6} />}
                {t === 'novo' ? 'Novo' : t === 'em_alta' ? 'Em alta' : t === 'jackpot' ? 'Jackpot' : 'Exclusivo'}
              </span>
            )
          })}
        </div>
      )}

      {hidden && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg/60 backdrop-grayscale">
          <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-fg-2 shadow-sm">
            <EyeOff size={12} aria-hidden /> Fora do site
          </span>
        </div>
      )}
    </div>
  )
}

/** Logotipo em monograma (provedora ou agregador), com a cor da marca. */
export function BrandMark({ name, hue, size = 36, className }: { name: string; hue: number; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-[10px] font-display font-extrabold tracking-tight shadow-sm', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.36),
        color: ink(hue),
        backgroundImage: `radial-gradient(80% 80% at 80% 10%, hsl(${(hue + 40) % 360} 90% 70% / 0.55), transparent 60%), linear-gradient(140deg, hsl(${hue} 72% 52%), hsl(${(hue + 30) % 360} 70% 32%))`,
        boxShadow: `inset 0 0 0 1px ${ink(hue, 0.18)}`,
      }}
    >
      {monogram(name)}
    </span>
  )
}

export const AGGREGATOR_HUE: Record<string, number> = { metagrator: 262, skravion: 188, betby: 214 }

/** Faixa de capas pequenas (prévia de vitrine). */
export function CoverStrip({
  games,
  providerName,
  badgesOf,
  max = 8,
  size = 'xs',
  className,
  empty,
}: {
  games: Game[]
  providerName?: (g: Game) => string | undefined
  badgesOf?: (g: Game) => GameBadge[]
  max?: number
  size?: 'xs' | 'sm'
  className?: string
  empty?: ReactNode
}) {
  if (!games.length) return <>{empty ?? null}</>
  const shown = games.slice(0, max)
  const rest = games.length - shown.length
  return (
    <ul className={cn('flex gap-1.5 overflow-hidden', className)} aria-label="Prévia dos jogos">
      {shown.map((g) => (
        <li key={g.id} className={cn('shrink-0', size === 'xs' ? 'w-[52px]' : 'w-[88px]')} title={g.name}>
          <GameCover game={g} size={size} providerName={providerName?.(g)} badges={badgesOf?.(g)} />
        </li>
      ))}
      {rest > 0 && (
        <li
          className={cn(
            'flex shrink-0 items-center justify-center rounded-lg border border-dashed border-line-strong text-xs font-semibold text-fg-3',
            size === 'xs' ? 'w-[52px]' : 'w-[88px]',
          )}
        >
          +{rest}
        </li>
      )}
    </ul>
  )
}

/** Barra fixa para confirmar uma mudança de ordem (mesmo visual da SaveBar). */
export function OrderBar({ dirty, onSave, onReset, label = 'Salvar ordem', message = 'Ordem alterada, ainda não salva' }: { dirty: boolean; onSave: () => void; onReset: () => void; label?: string; message?: string }) {
  return (
    <div
      className={cn(
        'sticky bottom-4 z-30 mt-6 transition-[opacity,transform] duration-200',
        dirty ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
      )}
      aria-hidden={!dirty}
    >
      <div className="mx-auto flex max-w-3xl flex-col items-stretch gap-3 rounded-2xl border border-line bg-surface/95 p-3 pl-4 shadow-pop backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-fg-2">
          <span className="h-2 w-2 rounded-full bg-warning" aria-hidden />
          {message}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" icon={RotateCcw} onClick={onReset} disabled={!dirty} tabIndex={dirty ? 0 : -1}>
            Descartar
          </Button>
          <Button variant="primary" icon={Save} onClick={onSave} disabled={!dirty} tabIndex={dirty ? 0 : -1}>
            {label}
          </Button>
        </div>
      </div>
    </div>
  )
}
