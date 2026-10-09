import { useId } from 'react'

export function BrandMark({ size = 34 }: { size?: number }) {
  // id único por cópia: se uma cópia estiver oculta, as outras continuam com o degradê
  const gid = `brand-g-${useId().replace(/:/g, '')}`
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#5B21B6" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gid})`} />
      <path d="M18 20l10 12-10 12h7l6.5-8 6.5 8h7L35 32l10-12h-7l-6.5 8-6.5-8z" fill="#fff" />
      <circle cx="49" cy="15" r="4" fill="#FACC15" />
    </svg>
  )
}
