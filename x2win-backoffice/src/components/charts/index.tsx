// Gráficos do painel (Recharts) com a paleta categórica validada.
// Regras: linhas de 2px, barras de no máximo 24px com ponta arredondada,
// grade discreta, legenda sempre que houver 2+ séries, tooltip ao passar o mouse.
import type { ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '@/lib/cn'
import { brlCompact, num, numCompact, pct } from '@/lib/format'

export type SeriesSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export const seriesColor = (slot: SeriesSlot) => `var(--chart-${slot})`

export interface SeriesDef {
  key: string
  label: string
  slot: SeriesSlot
}

export type ValueFormat = 'brl' | 'num' | 'pct' | ((v: number) => string)

export function formatValue(v: number, f: ValueFormat = 'num'): string {
  if (typeof f === 'function') return f(v)
  if (f === 'brl') return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  if (f === 'pct') return pct(v)
  return num(Math.round(v))
}

function axisFormat(v: number, f: ValueFormat = 'num'): string {
  if (typeof f === 'function') return f(v)
  if (f === 'brl') return brlCompact(v).replace(',00', '')
  if (f === 'pct') return pct(v, 0)
  return numCompact(v)
}

const AXIS = { stroke: 'var(--chart-axis)', fontSize: 11, tickLine: false, axisLine: false } as const

interface TooltipPayloadItem {
  dataKey?: string | number
  name?: string
  value?: number
  color?: string
  payload?: Record<string, unknown>
}

function TooltipBox({
  active,
  payload,
  label,
  format,
  labelFormat,
  series,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string | number
  format: ValueFormat
  labelFormat?: (l: string) => string
  series?: SeriesDef[]
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="min-w-[160px] rounded-xl border border-line bg-surface px-3 py-2.5 shadow-pop">
      {label !== undefined && <p className="mb-1.5 text-xs font-medium text-fg-3">{labelFormat ? labelFormat(String(label)) : label}</p>}
      <div className="space-y-1">
        {payload.map((p) => {
          const s = series?.find((x) => x.key === p.dataKey)
          return (
            <div key={String(p.dataKey)} className="flex items-center justify-between gap-4 text-[13px]">
              <span className="flex items-center gap-1.5 text-fg-2">
                <span className="h-2 w-2 rounded-full" style={{ background: s ? seriesColor(s.slot) : p.color }} aria-hidden />
                {s?.label ?? p.name}
              </span>
              <span className="font-semibold text-fg tnum">{formatValue(Number(p.value ?? 0), format)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ChartLegend({ items, className }: { items: { label: string; slot: SeriesSlot; value?: ReactNode }[]; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5 text-xs text-fg-2">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: seriesColor(it.slot) }} aria-hidden />
          {it.label}
          {it.value !== undefined && <span className="font-semibold text-fg tnum">{it.value}</span>}
        </li>
      ))}
    </ul>
  )
}

/** Série temporal em área ou linha. */
export function TrendChart({
  data,
  xKey,
  series,
  format = 'num',
  height = 260,
  type = 'area',
  xFormat,
  tooltipLabelFormat,
  showLegend,
  ariaLabel,
}: {
  data: readonly object[]
  xKey: string
  series: SeriesDef[]
  format?: ValueFormat
  height?: number
  type?: 'area' | 'line'
  xFormat?: (v: string) => string
  tooltipLabelFormat?: (v: string) => string
  showLegend?: boolean
  ariaLabel: string
}) {
  const legend = showLegend ?? series.length > 1
  const Chart = type === 'area' ? AreaChart : LineChart
  return (
    <figure aria-label={ariaLabel} className="m-0">
      {legend && <ChartLegend className="mb-3" items={series.map((s) => ({ label: s.label, slot: s.slot }))} />}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <Chart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={seriesColor(s.slot)} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={seriesColor(s.slot)} stopOpacity={0.01} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey={xKey} {...AXIS} tickFormatter={xFormat} minTickGap={24} dy={6} />
            <YAxis {...AXIS} width={64} tickFormatter={(v: number) => axisFormat(v, format)} />
            <Tooltip
              cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1, strokeOpacity: 0.5 }}
              content={(p: unknown) => (
                <TooltipBox {...(p as object)} format={format} series={series} labelFormat={tooltipLabelFormat ?? xFormat} />
              )}
            />
            {series.map((s) =>
              type === 'area' ? (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={seriesColor(s.slot)}
                  strokeWidth={2}
                  fill={`url(#grad-${s.key})`}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'rgb(var(--surface))' }}
                  dot={false}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={seriesColor(s.slot)}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'rgb(var(--surface))' }}
                  isAnimationActive={false}
                />
              ),
            )}
          </Chart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

/** Barras verticais ou horizontais (comparação entre categorias). */
export function BarsChart({
  data,
  xKey,
  series,
  format = 'num',
  height = 260,
  layout = 'vertical',
  stacked,
  xFormat,
  ariaLabel,
  showLegend,
  categoryWidth = 120,
}: {
  data: readonly object[]
  xKey: string
  series: SeriesDef[]
  format?: ValueFormat
  height?: number
  /** vertical = colunas; horizontal = barras deitadas (bom para nomes longos) */
  layout?: 'vertical' | 'horizontal'
  stacked?: boolean
  xFormat?: (v: string) => string
  ariaLabel: string
  showLegend?: boolean
  categoryWidth?: number
}) {
  const legend = showLegend ?? series.length > 1
  const horizontal = layout === 'horizontal'
  return (
    <figure aria-label={ariaLabel} className="m-0">
      {legend && <ChartLegend className="mb-3" items={series.map((s) => ({ label: s.label, slot: s.slot }))} />}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout={horizontal ? 'vertical' : 'horizontal'}
            margin={{ top: 6, right: 12, left: 0, bottom: 0 }}
            barCategoryGap="28%"
            barGap={2}
          >
            <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke="var(--chart-grid)" />
            {horizontal ? (
              <>
                <XAxis type="number" {...AXIS} tickFormatter={(v: number) => axisFormat(v, format)} />
                <YAxis type="category" dataKey={xKey} {...AXIS} width={categoryWidth} tickFormatter={xFormat} />
              </>
            ) : (
              <>
                <XAxis dataKey={xKey} {...AXIS} tickFormatter={xFormat} minTickGap={8} dy={6} />
                <YAxis {...AXIS} width={64} tickFormatter={(v: number) => axisFormat(v, format)} />
              </>
            )}
            <Tooltip
              cursor={{ fill: 'var(--chart-cursor)' }}
              content={(p: unknown) => <TooltipBox {...(p as object)} format={format} series={series} labelFormat={xFormat} />}
            />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={seriesColor(s.slot)}
                maxBarSize={24}
                stackId={stacked ? 'stack' : undefined}
                stroke={stacked ? 'rgb(var(--surface))' : undefined}
                strokeWidth={stacked ? 1 : 0}
                radius={
                  stacked && i < series.length - 1 ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]
                }
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

/** Mini gráfico de tendência para cartões de KPI (sem eixos). */
export function Sparkline({ data, slot = 1, ariaLabel }: { data: number[]; slot?: SeriesSlot; ariaLabel?: string }) {
  const rows = data.map((v, i) => ({ i, v }))
  const id = `spark-${slot}-${data.length}-${Math.round(data[0] ?? 0)}`
  return (
    <div className="h-full w-full" role="img" aria-label={ariaLabel ?? 'Tendência no período'}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={seriesColor(slot)} stopOpacity={0.22} />
              <stop offset="100%" stopColor={seriesColor(slot)} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={seriesColor(slot)} strokeWidth={1.75} fill={`url(#${id})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Rosca para proporções (até 5 categorias). */
export function DonutChart({
  data,
  format = 'num',
  height = 200,
  centerLabel,
  centerValue,
  ariaLabel,
}: {
  data: { label: string; value: number; slot: SeriesSlot }[]
  format?: ValueFormat
  height?: number
  centerLabel?: string
  centerValue?: ReactNode
  ariaLabel: string
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <figure aria-label={ariaLabel} className="m-0 flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative shrink-0" style={{ height, width: height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="64%"
              outerRadius="100%"
              paddingAngle={1.5}
              stroke="rgb(var(--surface))"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell key={d.label} fill={seriesColor(d.slot)} />
              ))}
            </Pie>
            <Tooltip
              content={(p: unknown) => {
                const pp = p as { active?: boolean; payload?: { name?: string; value?: number; payload?: { slot: SeriesSlot } }[] }
                if (!pp.active || !pp.payload?.length) return null
                const it = pp.payload[0]
                return (
                  <div className="rounded-xl border border-line bg-surface px-3 py-2 text-[13px] shadow-pop">
                    <span className="text-fg-2">{it.name}: </span>
                    <span className="font-semibold text-fg tnum">{formatValue(Number(it.value), format)}</span>
                    <span className="ml-1 text-fg-3">({pct(total ? Number(it.value) / total : 0)})</span>
                  </div>
                )
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        {(centerLabel || centerValue) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            {centerValue && <span className="font-display text-lg font-bold text-fg">{centerValue}</span>}
            {centerLabel && <span className="text-[11px] text-fg-3">{centerLabel}</span>}
          </div>
        )}
      </div>
      <ul className="w-full min-w-0 space-y-2">
        {data.map((d) => (
          <li key={d.label} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 items-center gap-2 text-fg-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: seriesColor(d.slot) }} aria-hidden />
              <span className="truncate">{d.label}</span>
            </span>
            <span className="shrink-0 text-fg tnum">
              <span className="font-semibold">{formatValue(d.value, format)}</span>
              <span className="ml-1.5 text-xs text-fg-3">{pct(total ? d.value / total : 0, 0)}</span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

/** Funil em barras horizontais com conversão entre etapas. */
export function FunnelChart({
  steps,
  format = 'num',
  ariaLabel,
}: {
  steps: { label: string; value: number; hint?: string }[]
  format?: ValueFormat
  ariaLabel: string
}) {
  const max = Math.max(1, ...steps.map((s) => s.value))
  return (
    <figure aria-label={ariaLabel} className="m-0 space-y-3">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null
        const conv = prev ? s.value / prev : null
        return (
          <div key={s.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
              <span className="truncate text-fg-2">
                {s.label}
                {s.hint && <span className="ml-1 text-xs text-fg-3">· {s.hint}</span>}
              </span>
              <span className="shrink-0 tnum">
                <span className="font-semibold text-fg">{formatValue(s.value, format)}</span>
                {conv !== null && <span className="ml-2 text-xs text-fg-3">{pct(conv, 0)} da etapa anterior</span>}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full"
                style={{ width: `${(s.value / max) * 100}%`, background: seriesColor(1), opacity: 1 - i * 0.14 }}
              />
            </div>
          </div>
        )
      })}
    </figure>
  )
}
