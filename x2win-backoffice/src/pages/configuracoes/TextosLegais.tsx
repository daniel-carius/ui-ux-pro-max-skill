import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArchiveRestore,
  Bold,
  BookOpenText,
  Eye,
  FileText,
  GitCompareArrows,
  Gift,
  Heading2,
  Heading3,
  HeartHandshake,
  History,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  PencilLine,
  Scale,
  Send,
  ShieldCheck,
  TextQuote,
  Trash2,
  UserCheck,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  IconButton,
  Modal,
  PageHeader,
  Progress,
  Segmented,
  Switch,
  Textarea,
  confirm,
  confirmWithInput,
  toast,
  useTabParam,
} from '@/components/ui'
import { date, dateTime, num, pct, relative } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useCollection, useDb } from '@/lib/store'
import { usePlayers } from '@/data/hooks'
import { audit, usePageAccess, useSession } from '@/domain/session'
import { useCompany } from '@/domain/system'
import { formatCnpj } from '@/domain/config1-empresa'
import {
  LEGAL_KEYS,
  acceptanceRate,
  applyFormat,
  currentVersion,
  diffLines,
  diffStats,
  publishVersion,
  validatePublish,
  wordCount,
  type DiffOp,
  type FormatKind,
  type LegalDoc,
  type LegalDocId,
  type LegalVersion,
} from '@/domain/config1-textos'
import { seedLegalDocs } from '@/data/config1-textos'
import { Markdown } from './_shared-f'

const DOC_IDS = ['termos', 'privacidade', 'jogo-responsavel', 'bonus'] as const
const DOC_ICON: Record<LegalDocId, LucideIcon> = { termos: Scale, privacidade: ShieldCheck, 'jogo-responsavel': HeartHandshake, bonus: Gift }

type Mode = 'editar' | 'previa' | 'comparar'

const TOOLBAR: { kind: FormatKind; icon: LucideIcon; label: string; group?: boolean }[] = [
  { kind: 'bold', icon: Bold, label: 'Negrito (Ctrl+B)' },
  { kind: 'italic', icon: Italic, label: 'Itálico (Ctrl+I)' },
  { kind: 'h2', icon: Heading2, label: 'Título de seção', group: true },
  { kind: 'h3', icon: Heading3, label: 'Subtítulo' },
  { kind: 'ul', icon: List, label: 'Lista com marcadores', group: true },
  { kind: 'ol', icon: ListOrdered, label: 'Lista numerada' },
  { kind: 'quote', icon: TextQuote, label: 'Destaque' },
  { kind: 'link', icon: Link, label: 'Link', group: true },
  { kind: 'hr', icon: Minus, label: 'Linha divisória' },
]

export default function TextosLegais() {
  const docs = useCollection<LegalDoc>(LEGAL_KEYS.docs, seedLegalDocs)
  const [drafts, setDrafts] = useDb<Record<string, string>>(LEGAL_KEYS.drafts, {})
  const [docId, setDocId] = useTabParam<LegalDocId>('termos', DOC_IDS, 'doc')
  const [viewing, setViewing] = useState<number | null>(null)
  const { items: players } = usePlayers()
  const activePlayers = players.filter((p) => p.status === 'ativo').length

  const { canEdit } = usePageAccess()
  const doc = docs.get(docId) ?? docs.items[0]
  const cur = currentVersion(doc)
  const draft = drafts[doc.id] ?? cur.content
  const setDraft = (text: string) =>
    setDrafts((prev) => {
      const next = { ...prev }
      if (text === cur.content) delete next[doc.id]
      else next[doc.id] = text
      return next
    })

  return (
    <>
      <PageHeader />

      {!canEdit && (
        <Alert tone="neutral" className="mb-5">
          Seu cargo pode ler os textos e o histórico, mas não editar nem publicar versões.
        </Alert>
      )}

      <section aria-label="Documentos" className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {DOC_IDS.map((id) => {
          const d = docs.get(id)
          if (!d) return null
          const v = currentVersion(d)
          const rate = acceptanceRate(v)
          const Icon = DOC_ICON[id]
          const hasDraft = drafts[id] != null && drafts[id] !== v.content
          const active = id === doc.id
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => setDocId(id)}
              className={cn(
                'card flex min-w-0 flex-col gap-3 p-3 text-left sm:p-4 transition-[border-color,box-shadow] duration-150 hover:border-line-strong',
                active && 'border-primary shadow-ring',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', active ? 'bg-primary text-primary-fg' : 'bg-primary/10 text-primary-text')}>
                  <Icon size={18} aria-hidden />
                </span>
                <div className="flex flex-wrap justify-end gap-1">
                  {hasDraft && (
                    <Badge tone="warning" icon={PencilLine}>
                      Rascunho
                    </Badge>
                  )}
                  <Badge tone="primary">v{v.version}</Badge>
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-5 text-fg">{d.title}</p>
                <p className="mt-0.5 hidden truncate text-xs text-fg-3 sm:block">Atualizado {relative(v.publishedAt)} · {v.author}</p>
              </div>
              {rate != null ? (
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-fg-3">Novo aceite da v{v.version}</span>
                    <span className="font-semibold text-fg tnum">{pct(rate, 0)}</span>
                  </div>
                  <Progress value={rate * 100} tone={rate > 0.9 ? 'success' : 'warning'} label={`Aceite da versão ${v.version}`} />
                </div>
              ) : (
                <p className="text-xs text-fg-3">Sem novo aceite exigido</p>
              )}
            </button>
          )
        })}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Editor key={doc.id} doc={doc} draft={draft} setDraft={setDraft} onPublished={() => setDrafts((p) => { const n = { ...p }; delete n[doc.id]; return n })} />
        <div className="min-w-0 space-y-5">
          <AcceptanceCard v={cur} activePlayers={activePlayers} />
          <HistoryCard doc={doc} onView={setViewing} draftDirty={draft !== cur.content} onRestore={(v) => setDraft(v.content)} />
        </div>
      </div>

      <VersionModal
        doc={doc}
        version={viewing}
        onClose={() => setViewing(null)}
        onRestore={(v) => {
          setDraft(v.content)
          setViewing(null)
        }}
        draftDirty={draft !== cur.content}
      />
    </>
  )
}

// ---------- Editor ----------

function Editor({ doc, draft, setDraft, onPublished }: { doc: LegalDoc; draft: string; setDraft: (t: string) => void; onPublished: () => void }) {
  const { canEdit } = usePageAccess()
  const { user } = useSession()
  const docs = useCollection<LegalDoc>(LEGAL_KEYS.docs, seedLegalDocs)
  const [mode, setMode] = useState<Mode>('editar')
  const ref = useRef<HTMLTextAreaElement>(null)
  const cur = currentVersion(doc)
  const dirty = draft !== cur.content
  const stats = useMemo(() => diffStats(cur.content, draft), [cur.content, draft])
  const lines = draft.split('\n').length

  const format = (kind: FormatKind) => {
    const el = ref.current
    if (!el || !canEdit) return
    const r = applyFormat(draft, el.selectionStart, el.selectionEnd, kind)
    setDraft(r.text)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(r.start, r.end)
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return
    const k = e.key.toLowerCase()
    if (k === 'b' || k === 'i') {
      e.preventDefault()
      format(k === 'b' ? 'bold' : 'italic')
    }
  }

  const discard = async () => {
    const ok = await confirm({
      title: 'Descartar o rascunho?',
      description: `As mudanças feitas desde a versão ${cur.version} serão perdidas. O texto publicado não muda.`,
      confirmLabel: 'Descartar rascunho',
      tone: 'danger',
      icon: Trash2,
    })
    if (!ok) return
    setDraft(cur.content)
    toast.info('Rascunho descartado')
  }

  const publish = async () => {
    const pre = validatePublish(doc, draft, 'resumo-provisorio')
    if (pre) {
      toast.error('Não dá para publicar', { description: pre })
      return
    }
    const reaccept = { value: false }
    const r = await confirmWithInput({
      title: `Publicar a versão ${cur.version + 1} de ${doc.title}?`,
      description: `O texto novo entra no ar na hora em x2win.bet.br${doc.slug}. Versões publicadas não podem ser apagadas: para voltar atrás, publique outra versão.`,
      confirmLabel: `Publicar v${cur.version + 1}`,
      tone: 'primary',
      icon: Send,
      details: (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
            <Badge tone="neutral">v{cur.version}</Badge>
            <span aria-hidden>→</span>
            <Badge tone="primary">v{cur.version + 1}</Badge>
            <span className="ml-auto font-medium tnum">
              <span className="text-success">+{stats.added}</span> <span className="text-danger">−{stats.removed}</span> linhas
            </span>
          </div>
          <ReacceptToggle onChange={(v) => (reaccept.value = v)} />
        </div>
      ),
      input: { label: 'Resumo da mudança', required: true, multiline: true, placeholder: 'Ex.: Saque mínimo sobe de R$ 10,00 para R$ 20,00.' },
    })
    if (!r.confirmed) return
    const err = validatePublish(doc, draft, r.value)
    if (err) {
      toast.error('Versão não publicada', { description: err })
      return
    }
    const next = publishVersion(doc, draft, { summary: r.value, author: user.name, requireReaccept: reaccept.value })
    docs.update(doc.id, next)
    onPublished()
    const nv = currentVersion(next)
    audit('criar', `${doc.title} v${nv.version}`, `Nova versão publicada (+${nv.added} −${nv.removed} linhas): ${nv.summary}${nv.requireReaccept ? ' · novo aceite exigido' : ''}`)
    toast.success(`Versão ${nv.version} publicada`, {
      description: nv.requireReaccept ? 'Os jogadores precisarão aceitar o texto novo no próximo acesso.' : 'O texto novo já está no site.',
    })
    setMode('editar')
  }

  const readOnlyTitle = !canEdit ? 'Seu cargo pode ver, mas não editar os textos legais.' : undefined

  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader
        icon={DOC_ICON[doc.id]}
        title={doc.title}
        description={
          <>
            {doc.description} Publicado em <span className="whitespace-nowrap font-mono text-[12px]">x2win.bet.br{doc.slug}</span>
          </>
        }
        actions={
          <Segmented
            size="sm"
            ariaLabel="Modo do editor"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'editar', label: 'Editar', icon: PencilLine },
              { value: 'previa', label: 'Prévia', icon: Eye },
              { value: 'comparar', label: 'Comparar', icon: GitCompareArrows },
            ]}
          />
        }
      />
      <CardBody className="flex-1">
        {mode === 'editar' && (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-1" role="toolbar" aria-label="Formatação">
              {TOOLBAR.map((t) => (
                <span key={t.kind} className={cn('flex', t.group && 'ml-1 border-l border-line pl-1')}>
                  <IconButton icon={t.icon} label={t.label} size="sm" disabled={!canEdit} onMouseDown={(e) => e.preventDefault()} onClick={() => format(t.kind)} />
                </span>
              ))}
              <span className="ml-auto hidden px-2 text-[11.5px] text-fg-3 sm:inline">Markdown simples · ## título, - lista, **negrito**</span>
            </div>
            <label htmlFor="legal-editor" className="sr-only">
              Texto de {doc.title}
            </label>
            <Textarea
              id="legal-editor"
              ref={ref}
              rows={24}
              value={draft}
              readOnly={!canEdit}
              title={readOnlyTitle}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              spellCheck
              className="resize-y font-mono text-[12.5px] leading-6"
            />
          </>
        )}
        {mode === 'previa' && <LegalPreview doc={doc} text={draft} version={dirty ? `rascunho da v${cur.version + 1}` : `versão ${cur.version}`} />}
        {mode === 'comparar' &&
          (dirty ? (
            <DiffView before={cur.content} after={draft} />
          ) : (
            <EmptyState icon={GitCompareArrows} title="Sem alterações no rascunho" description={`O texto está igual à versão ${cur.version} publicada. Edite para ver as diferenças aqui.`} />
          ))}
      </CardBody>
      <div className="flex flex-col gap-3 border-t border-line px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-3" aria-live="polite">
          <span className="tnum">{num(wordCount(draft))} palavras</span>
          <span className="tnum">{num(lines)} linhas</span>
          {dirty ? (
            <span className="font-medium text-fg-2">
              Rascunho salvo · <span className="text-success">+{stats.added}</span> <span className="text-danger">−{stats.removed}</span> linhas desde a v{cur.version}
            </span>
          ) : (
            <span>Igual à versão publicada</span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {dirty && (
            <Button variant="ghost" icon={Trash2} onClick={discard} disabled={!canEdit}>
              Descartar
            </Button>
          )}
          <Button variant="primary" icon={Send} onClick={publish} disabled={!canEdit || !dirty} title={readOnlyTitle ?? (!dirty ? 'Edite o texto para publicar uma nova versão.' : undefined)}>
            Publicar nova versão
          </Button>
        </div>
      </div>
    </Card>
  )
}

/** Interruptor com estado próprio, usado dentro da confirmação de publicação. */
function ReacceptToggle({ onChange }: { onChange: (v: boolean) => void }) {
  const [on, setOn] = useState(false)
  return (
    <div className="rounded-lg border border-line p-3">
      <Switch
        label="Exigir novo aceite dos jogadores"
        description={
          on
            ? 'No próximo acesso, o jogador vê o texto novo e só continua depois de aceitar.'
            : 'Use para mudanças importantes (limites, prazos, regras de saque).'
        }
        checked={on}
        onChange={(v) => {
          setOn(v)
          onChange(v)
        }}
      />
    </div>
  )
}

function LegalPreview({ doc, text, version }: { doc: LegalDoc; text: string; version: string }) {
  const [company] = useCompany()
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-bg">
      <div className="border-b border-line bg-surface-2 px-5 py-3 text-[11.5px] leading-5 text-fg-3">
        <p className="font-semibold uppercase tracking-wide">
          {doc.title} · {version}
        </p>
        <p>
          {company.legalName} · CNPJ {formatCnpj(company.cnpj)} · {company.license}
        </p>
      </div>
      <div className="max-h-[640px] overflow-y-auto bg-surface px-5 py-5 sm:px-8">
        <Markdown text={text} />
      </div>
    </div>
  )
}

/** Diferenças por linha, com contexto curto e trechos iguais recolhidos. */
function DiffView({ before, after, className }: { before: string; after: string; className?: string }) {
  const ops = useMemo(() => diffLines(before, after), [before, after])
  const rows: (DiffOp | { type: 'skip'; count: number })[] = []
  const CONTEXT = 2
  const changedIdx = ops.map((o, i) => (o.type !== 'eq' ? i : -1)).filter((i) => i >= 0)
  const near = (i: number) => changedIdx.some((c) => Math.abs(c - i) <= CONTEXT)
  let skip = 0
  ops.forEach((o, i) => {
    if (o.type === 'eq' && !near(i)) {
      skip++
      return
    }
    if (skip) rows.push({ type: 'skip', count: skip })
    skip = 0
    rows.push(o)
  })
  if (skip) rows.push({ type: 'skip', count: skip })
  const stats = diffStats(before, after)
  return (
    <div className={cn('overflow-hidden rounded-xl border border-line', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-2 text-xs">
        <span className="text-fg-3">Linhas alteradas (linhas em branco não contam)</span>
        <span className="font-semibold tnum">
          <span className="text-success">+{stats.added}</span> <span className="text-danger">−{stats.removed}</span>
        </span>
      </div>
      <div className="max-h-[560px] overflow-auto font-mono text-[12px] leading-5">
        {rows.map((r, i) =>
          r.type === 'skip' ? (
            <div key={i} className="border-y border-line bg-surface-2/60 px-3 py-1 text-[11px] text-fg-3">
              ··· {r.count} {r.count === 1 ? 'linha igual' : 'linhas iguais'}
            </div>
          ) : (
            <div
              key={i}
              className={cn(
                'flex gap-2 whitespace-pre-wrap break-words px-3 py-0.5',
                r.type === 'add' && 'bg-success/10 text-fg',
                r.type === 'del' && 'bg-danger/10 text-fg-2 line-through decoration-danger/40',
                r.type === 'eq' && 'text-fg-3',
              )}
            >
              <span className={cn('w-3 shrink-0 select-none text-center font-bold', r.type === 'add' ? 'text-success' : r.type === 'del' ? 'text-danger' : 'text-fg-3')} aria-hidden>
                {r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}
              </span>
              <span className="sr-only">{r.type === 'add' ? 'Adicionada: ' : r.type === 'del' ? 'Removida: ' : ''}</span>
              <span className="min-w-0">{r.text || ' '}</span>
            </div>
          ),
        )}
      </div>
    </div>
  )
}

// ---------- Lateral ----------

function AcceptanceCard({ v, activePlayers }: { v: LegalVersion; activePlayers: number }) {
  const rate = acceptanceRate(v)
  return (
    <Card>
      <CardHeader icon={UserCheck} title="Aceite dos jogadores" description={`Versão ${v.version} · publicada em ${date(v.publishedAt)}`} />
      <CardBody>
        {rate != null ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-2xl font-bold text-fg tnum">{pct(rate, 0)}</span>
              <span className="text-xs text-fg-3 tnum">
                {num(Math.round(rate * activePlayers))} de {num(activePlayers)} ativos
              </span>
            </div>
            <Progress className="mt-2" value={rate * 100} tone={rate > 0.9 ? 'success' : 'warning'} label="Jogadores que aceitaram a versão atual" />
            <p className="mt-3 text-xs leading-5 text-fg-3">Quem ainda não aceitou vê o texto novo no próximo acesso e só volta a jogar depois de aceitar.</p>
          </>
        ) : (
          <Alert tone="neutral">Esta versão não exigiu novo aceite. Os jogadores seguem com o aceite feito no cadastro ou na última versão que o exigiu.</Alert>
        )}
      </CardBody>
    </Card>
  )
}

function HistoryCard({ doc, onView, onRestore, draftDirty }: { doc: LegalDoc; onView: (v: number) => void; onRestore: (v: LegalVersion) => void; draftDirty: boolean }) {
  const { canEdit } = usePageAccess()
  const list = [...doc.versions].reverse()
  const cur = currentVersion(doc)
  const restore = async (v: LegalVersion) => {
    if (draftDirty) {
      const ok = await confirm({
        title: `Trocar o rascunho pela versão ${v.version}?`,
        description: 'O rascunho atual será substituído pelo texto desta versão. Nada é publicado até você clicar em "Publicar nova versão".',
        confirmLabel: 'Trocar rascunho',
        tone: 'warning',
        icon: ArchiveRestore,
      })
      if (!ok) return
    }
    onRestore(v)
    toast.info(`Versão ${v.version} copiada para o rascunho`, { description: 'Revise e publique como uma nova versão.' })
  }
  return (
    <Card>
      <CardHeader icon={History} title="Histórico de versões" description={`${doc.versions.length} versões publicadas`} />
      <CardBody>
        <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-line">
          {list.map((v) => {
            const isCur = v.version === cur.version
            return (
              <li key={v.version} className="relative flex gap-3">
                <span
                  className={cn(
                    'relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ring-4 ring-surface',
                    isCur ? 'bg-primary text-primary-fg' : 'bg-surface-3 text-fg-2',
                  )}
                >
                  v{v.version}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-semibold text-fg">{date(v.publishedAt)}</span>
                    {isCur && <Badge tone="success">Atual</Badge>}
                    {v.requireReaccept && (
                      <Badge tone="info" icon={UserCheck}>
                        Novo aceite
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-[13px] leading-5 text-fg-2">{v.summary}</p>
                  <p className="mt-1 text-xs text-fg-3">
                    {v.author} · <span className="text-success tnum">+{v.added}</span> <span className="text-danger tnum">−{v.removed}</span> linhas
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Button size="xs" variant="ghost" icon={BookOpenText} onClick={() => onView(v.version)}>
                      Ver
                    </Button>
                    {!isCur && (
                      <Button size="xs" variant="ghost" icon={ArchiveRestore} onClick={() => restore(v)} disabled={!canEdit} title={!canEdit ? 'Seu cargo não edita textos legais.' : undefined}>
                        Usar no rascunho
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </CardBody>
    </Card>
  )
}

function VersionModal({
  doc,
  version,
  onClose,
  onRestore,
  draftDirty,
}: {
  doc: LegalDoc
  version: number | null
  onClose: () => void
  onRestore: (v: LegalVersion) => void
  draftDirty: boolean
}) {
  const { canEdit } = usePageAccess()
  const [tab, setTab] = useState<'texto' | 'mudancas'>('texto')
  const v = doc.versions.find((x) => x.version === version)
  if (!v) return null
  const prev = doc.versions.find((x) => x.version === v.version - 1)
  const isCur = v.version === currentVersion(doc).version
  const restore = async () => {
    if (draftDirty) {
      const ok = await confirm({
        title: `Trocar o rascunho pela versão ${v.version}?`,
        description: 'O rascunho atual será substituído. Nada é publicado agora.',
        confirmLabel: 'Trocar rascunho',
        tone: 'warning',
        icon: ArchiveRestore,
      })
      if (!ok) return
    }
    onRestore(v)
    toast.info(`Versão ${v.version} copiada para o rascunho`, { description: 'Revise e publique como uma nova versão.' })
  }
  return (
    <Modal
      open
      onClose={() => {
        setTab('texto')
        onClose()
      }}
      size="xl"
      icon={FileText}
      title={`${doc.title} · versão ${v.version}${isCur ? ' (atual)' : ''}`}
      description={`Publicada em ${dateTime(v.publishedAt)} por ${v.author}. Somente leitura.`}
      footer={
        <>
          <Button onClick={onClose}>Fechar</Button>
          {!isCur && (
            <Button variant="soft" icon={ArchiveRestore} onClick={restore} disabled={!canEdit}>
              Usar no rascunho
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-xl bg-surface-2 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-[13px] text-fg-2">
            <span className="font-medium text-fg">Resumo: </span>
            {v.summary}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {v.requireReaccept && (
              <Badge tone="info" icon={UserCheck}>
                Exigiu novo aceite
              </Badge>
            )}
            <Badge tone="neutral">
              <span className="text-success">+{v.added}</span>&nbsp;<span className="text-danger">−{v.removed}</span>&nbsp;linhas
            </Badge>
          </div>
        </div>
        <Segmented
          ariaLabel="O que mostrar"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'texto', label: 'Texto completo', icon: BookOpenText },
            { value: 'mudancas', label: prev ? `Mudanças desde a v${prev.version}` : 'Mudanças', icon: GitCompareArrows },
          ]}
        />
        {tab === 'texto' ? (
          <div className="rounded-xl border border-line bg-surface px-5 py-5">
            <Markdown text={v.content} />
          </div>
        ) : prev ? (
          <DiffView before={prev.content} after={v.content} />
        ) : (
          <EmptyState icon={FileText} title="Primeira versão" description="Esta foi a versão inicial. Não há versão anterior para comparar." />
        )}
      </div>
    </Modal>
  )
}

