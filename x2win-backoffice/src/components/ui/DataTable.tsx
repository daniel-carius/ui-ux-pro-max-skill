import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  Download,
  MoreHorizontal,
  Search,
  SearchX,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { exportCsv } from '@/lib/csv'
import { csvMoney } from '@/lib/csv-format'
import { num } from '@/lib/format'
import { Button, IconButton } from './Button'
import { Checkbox } from './Controls'
import { EmptyState } from './States'
import { Menu, Popover, type MenuEntry } from './Overlay'

export interface Column<T> {
  id: string
  header: ReactNode
  /** conteúdo da célula; padrão: row[id] */
  cell?: (row: T) => ReactNode
  /** valor para ordenar; sem ele a coluna não ordena */
  sortValue?: (row: T) => number | string | null | undefined
  /** valor no CSV; padrão: sortValue ou texto simples. `false`: coluna só de tela (botões), fora do CSV */
  csv?: ((row: T) => string | number | null | undefined) | false
  /** valor em reais: no CSV sai sempre com duas casas no padrão brasileiro ("200,00", "13.714,70") */
  money?: boolean
  align?: 'left' | 'right' | 'center'
  /** largura mínima em px */
  minWidth?: number
  /** começa escondida no seletor de colunas */
  defaultHidden?: boolean
  /** não pode ser escondida */
  pinned?: boolean
  className?: string
  /** texto do cabeçalho para CSV/seletor quando header não é string */
  label?: string
  /** permite quebrar linha (padrão: não quebra) */
  wrap?: boolean
  /** vai para o CSV mesmo escondida na tela (ex.: e-mail e id de quem fez, na Auditoria) */
  exportAlways?: boolean
}

export interface DataTableProps<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  /** texto pesquisável do registro; habilita a busca */
  searchText?: (row: T) => string
  searchPlaceholder?: string
  /** filtros extras ao lado da busca */
  toolbar?: ReactNode
  toolbarRight?: ReactNode
  pageSize?: number
  pageSizeOptions?: number[]
  /** nome do arquivo CSV; habilita "Exportar" */
  exportName?: string
  /** chamado ao exportar (ex.: registrar na auditoria) */
  onExport?: (count: number) => void
  canExport?: boolean
  columnPicker?: boolean
  initialSort?: { id: string; dir: 'asc' | 'desc' }
  onRowClick?: (row: T) => void
  rowActions?: (row: T) => MenuEntry[]
  empty?: { title: string; description?: string; action?: ReactNode; icon?: import('lucide-react').LucideIcon }
  /** sem cartão em volta (para usar dentro de outro Card) */
  bare?: boolean
  className?: string
  /** rótulo para leitores de tela */
  caption?: string
  /** linha de destaque */
  rowClassName?: (row: T) => string | undefined
  /** reinicia paginação quando muda (ex.: filtro externo) */
  resetKey?: unknown
}

export function normalize(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function rawCsvValue<T>(c: Column<T>, r: T): string | number | null | undefined {
  if (c.csv) return c.csv(r)
  if (c.sortValue) return c.sortValue(r)
  const v = (r as Record<string, unknown>)[c.id]
  return typeof v === 'string' || typeof v === 'number' ? v : ''
}

/** Valor em reais do CSV: número (ou "1234.5" de toFixed) vira "1.234,50"; texto pronto fica como está. */
function moneyCell(v: string | number | null | undefined): string | number | null | undefined {
  if (typeof v === 'number') return csvMoney(v)
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return csvMoney(Number(v))
  return v
}

function headerText<T>(c: Column<T>) {
  return c.label ?? (typeof c.header === 'string' ? c.header : c.id)
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  searchPlaceholder = 'Buscar',
  toolbar,
  toolbarRight,
  pageSize: initialPageSize = 10,
  pageSizeOptions = [10, 25, 50, 100],
  exportName,
  onExport,
  canExport = true,
  columnPicker = true,
  initialSort,
  onRowClick,
  rowActions,
  empty,
  bare,
  className,
  caption,
  rowClassName,
  resetKey,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(initialSort ?? null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id)))

  const visibleCols = columns.filter((c) => !hidden.has(c.id))

  const filtered = useMemo(() => {
    if (!searchText || !query.trim()) return rows
    const q = normalize(query.trim())
    return rows.filter((r) => normalize(searchText(r)).includes(q))
  }, [rows, query, searchText])

  const sorted = useMemo(() => {
    if (!sort) return filtered
    const col = columns.find((c) => c.id === sort.id)
    if (!col?.sortValue) return filtered
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const va = col.sortValue!(a)
      const vb = col.sortValue!(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'pt-BR') * dir
    })
  }, [filtered, sort, columns])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  useEffect(() => setPage(0), [query, pageSize, resetKey])
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1)
  }, [page, pageCount])
  const pageRows = sorted.slice(page * pageSize, page * pageSize + pageSize)

  const toggleSort = (id: string) => {
    setSort((s) => (s?.id !== id ? { id, dir: 'desc' } : s.dir === 'desc' ? { id, dir: 'asc' } : null))
  }

  const doExport = () => {
    // colunas só de tela (botões de ação, sem valor para o CSV) não viram coluna vazia no arquivo
    const hasValue = (c: Column<T>) =>
      c.csv !== false && (!!c.csv || !!c.sortValue || (sorted.length > 0 && Object.prototype.hasOwnProperty.call(sorted[0] as object, c.id)))
    const exportCols = columns.filter((c) => (visibleCols.includes(c) || c.exportAlways) && hasValue(c))
    exportCsv(
      exportName!,
      sorted,
      exportCols.map((c) => ({
        header: headerText(c),
        value: (r: T) => {
          const raw = rawCsvValue(c, r)
          return c.money ? moneyCell(raw) : raw
        },
      })),
    )
    onExport?.(sorted.length)
  }

  const showToolbar = !!(searchText || toolbar || toolbarRight || exportName || columnPicker)

  const body = (
    <>
      {showToolbar && (
        <div className="flex flex-col gap-2.5 border-b border-line p-3 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
            {searchText && (
              <div className="relative w-full sm:w-72">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className="input-base h-9 pl-9 pr-8 [&::-webkit-search-cancel-button]:hidden"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Limpar busca"
                    onClick={() => setQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-3 hover:text-fg"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )}
            {toolbar}
          </div>
          {/* quebra de linha no celular: ação em lote + Colunas + Exportar não cabem em 390 px (o card corta o que sobra) */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {toolbarRight}
            {columnPicker && (
              <Popover
                align="end"
                width={240}
                title="Colunas visíveis"
                trigger={(p) => (
                  <Button {...p} size="sm" icon={Columns3}>
                    Colunas
                  </Button>
                )}
              >
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {columns.map((c) => (
                    <Checkbox
                      key={c.id}
                      checked={!hidden.has(c.id)}
                      disabled={c.pinned}
                      label={headerText(c)}
                      onChange={(on) =>
                        setHidden((h) => {
                          const n = new Set(h)
                          if (on) n.delete(c.id)
                          else n.add(c.id)
                          return n
                        })
                      }
                    />
                  ))}
                </div>
              </Popover>
            )}
            {exportName && (
              <Button size="sm" icon={Download} onClick={doExport} disabled={!canExport || sorted.length === 0} title={!canExport ? 'Seu cargo não exporta estes dados' : undefined}>
                Exportar
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-line bg-surface-2/80">
              {visibleCols.map((c) => {
                const sortable = !!c.sortValue
                const active = sort?.id === c.id
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    style={{ minWidth: c.minWidth }}
                    className={cn(
                      'h-10 whitespace-nowrap px-3 text-xs font-semibold text-fg-3 first:pl-4 last:pr-4',
                      c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.id)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded hover:text-fg',
                          c.align === 'right' && 'flex-row-reverse',
                          active && 'text-fg',
                        )}
                      >
                        {c.header}
                        {active ? (
                          sort!.dir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />
                        ) : (
                          <ArrowUpDown size={13} className="opacity-40" />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
              {rowActions && (
                <th className="h-10 w-12 pr-3" scope="col">
                  <span className="sr-only">Ações</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                          e.preventDefault()
                          onRowClick(r)
                        }
                      }
                    : undefined
                }
                className={cn(
                  'border-b border-line/70 transition-colors duration-100 last:border-0 hover:bg-surface-2',
                  onRowClick && 'cursor-pointer focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                  rowClassName?.(r),
                )}
              >
                {visibleCols.map((c) => (
                  <td
                    key={c.id}
                    className={cn(
                      'h-12 px-3 py-2 align-middle text-fg first:pl-4 last:pr-4',
                      !c.wrap && 'whitespace-nowrap',
                      c.align === 'right' ? 'text-right tnum' : c.align === 'center' ? 'text-center' : 'text-left',
                      c.className,
                    )}
                  >
                    {c.cell ? c.cell(r) : String((r as Record<string, unknown>)[c.id] ?? '—')}
                  </td>
                ))}
                {rowActions && (
                  <td className="h-12 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <Menu
                      items={rowActions(r)}
                      trigger={(p) => <IconButton {...p} icon={MoreHorizontal} label="Ações da linha" size="sm" />}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <EmptyState
            icon={query ? SearchX : empty?.icon}
            title={query ? 'Nada encontrado' : (empty?.title ?? 'Nenhum registro')}
            description={query ? `Nenhum resultado para "${query}". Tente outro termo.` : empty?.description}
            action={query ? <Button size="sm" onClick={() => setQuery('')}>Limpar busca</Button> : empty?.action}
            className="py-14"
          />
        )}
      </div>

      {sorted.length > 0 && (
        <Pagination
          page={page}
          pageCount={pageCount}
          total={sorted.length}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={setPageSize}
          pageSizeOptions={pageSizeOptions}
        />
      )}
    </>
  )

  if (bare) return <div className={className}>{body}</div>
  return <div className={cn('card overflow-hidden', className)}>{body}</div>
}

export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onPage,
  onPageSize,
  pageSizeOptions = [10, 25, 50, 100],
}: {
  page: number
  pageCount: number
  total: number
  pageSize: number
  onPage: (p: number) => void
  onPageSize?: (n: number) => void
  pageSizeOptions?: number[]
}) {
  const from = page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  return (
    <div className="flex flex-col items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[13px] text-fg-3 sm:flex-row">
      <div className="flex items-center gap-3">
        <span className="tnum">
          {num(from)}–{num(to)} de {num(total)}
        </span>
        {onPageSize && (
          <label className="flex items-center gap-1.5">
            <span className="hidden sm:inline">Linhas</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSize(Number(e.target.value))}
              className="h-8 rounded-md border border-line bg-surface px-1.5 text-[13px] text-fg"
              aria-label="Linhas por página"
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-1">
        <IconButton icon={ChevronsLeft} label="Primeira página" size="sm" disabled={page === 0} onClick={() => onPage(0)} />
        <IconButton icon={ChevronLeft} label="Página anterior" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)} />
        <span className="px-2 tnum text-fg-2">
          {page + 1} / {pageCount}
        </span>
        <IconButton icon={ChevronRight} label="Próxima página" size="sm" disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)} />
        <IconButton icon={ChevronsRight} label="Última página" size="sm" disabled={page >= pageCount - 1} onClick={() => onPage(pageCount - 1)} />
      </div>
    </div>
  )
}
