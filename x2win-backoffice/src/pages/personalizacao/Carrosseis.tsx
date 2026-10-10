import { useMemo, useState, type CSSProperties } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Heart,
  LayoutGrid,
  ListOrdered,
  Menu as MenuIcon,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Star,
  Trash2,
  TrendingUp,
  Trophy,
  Layers,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  FormFieldset,
  FormGrid,
  IconButton,
  Input,
  Modal,
  MoneyInput,
  NumberInput,
  PageHeader,
  RadioCards,
  SaveBar,
  Segmented,
  Select,
  SortableList,
  Switch,
  confirm,
  toast,
  useSettingsForm,
} from '@/components/ui'
import { brl, num, relative } from '@/lib/format'
import { uid } from '@/lib/random'
import { usePageAccess } from '@/domain/session'
import { useGames, useProviders } from '@/data/hooks'
import { GAME_CATEGORY_LABEL, type Game, type GameCategory } from '@/data/catalog'
import {
  CAROUSEL_LIMITS,
  CRITERION_LABEL,
  DEFAULT_CAROUSELS,
  P2_KEYS,
  SOURCE_LABEL,
  WINS_PERIOD_LABEL,
  WINS_PERIOD_MS,
  carouselError,
  maskNickname,
  newCarousel,
  resolveCarouselGames,
  validateCarousels,
  type CarouselConfig,
  type CarouselKind,
  type CarouselSettings,
  type CustomSource,
  type WinsPeriod,
} from '@/data/personalizacao2-config'
import { topWins, winsForGame } from '@/data/personalizacao2-wins'
import { BrowserFrame, DeviceToggle, initialDevice, GameCover, LivePreview, PREVIEW, SiteLogo, type Device } from './_shared-p2'

const KIND_META: Record<CarouselKind, { label: string; icon: typeof Trophy; tone: 'gold' | 'info' | 'primary' }> = {
  maiores_vitorias: { label: 'Maiores vitórias', icon: Trophy, tone: 'gold' },
  relacionados: { label: 'Relacionados', icon: Layers, tone: 'info' },
  personalizado: { label: 'Personalizado', icon: Sparkles, tone: 'primary' },
}

const CATEGORY_OPTIONS = (Object.keys(GAME_CATEGORY_LABEL) as GameCategory[]).map((c) => ({ value: c, label: GAME_CATEGORY_LABEL[c] }))

function summary(c: CarouselConfig) {
  if (c.kind === 'maiores_vitorias') return `${c.count} vitórias · ${WINS_PERIOD_LABEL[c.period].toLowerCase()} · a partir de ${brl(c.minWin)}`
  if (c.kind === 'relacionados') return `${c.count} jogos · ${CRITERION_LABEL[c.criterion].toLowerCase()}${c.criterion === 'manual' ? ` (${c.gameIds.length})` : ''}`
  return `${c.count} jogos · ${SOURCE_LABEL[c.source].toLowerCase()}${c.source === 'categoria' ? `: ${GAME_CATEGORY_LABEL[c.category]}` : c.source === 'manual' ? ` (${c.gameIds.length})` : ''}`
}

export default function Carrosseis() {
  const { canEdit } = usePageAccess()
  const form = useSettingsForm<CarouselSettings>(P2_KEYS.carousels, DEFAULT_CAROUSELS, {
    entity: 'Carrosséis do jogo',
    validate: validateCarousels,
    successMessage: 'Carrosséis salvos',
  })
  const { items: games } = useGames()
  const { items: providers } = useProviders()
  const providerName = useMemo(() => new Map(providers.map((p) => [p.id, p.name])), [providers])
  const activeGames = useMemo(() => games.filter((g) => g.active).sort((a, b) => b.highlight - a.highlight), [games])
  const [previewId, setPreviewId] = useState(() => activeGames[0]?.id ?? '')
  const [device, setDevice] = useState<Device>(initialDevice)
  const [creating, setCreating] = useState(false)

  const list = form.values.carousels
  const setList = (next: CarouselConfig[]) => form.setValues((v) => ({ ...v, carousels: next }))
  const patch = (id: string, p: Partial<CarouselConfig>) => form.setValues((v) => ({ ...v, carousels: v.carousels.map((c) => (c.id === id ? { ...c, ...p } : c)) }))
  const previewGame = games.find((g) => g.id === previewId) ?? activeGames[0]
  const enabledCount = list.filter((c) => c.enabled).length
  const frame = (d: Device) =>
    previewGame ? (
      <BrowserFrame device={d} url={`x2win.bet.br/jogos/${previewGame.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} label={`Prévia da página de ${previewGame.name}`}>
        <GamePagePreview game={previewGame} carousels={list} games={games} providerName={providerName} mobile={d === 'mobile'} />
      </BrowserFrame>
    ) : (
      <EmptyState title="Nenhum jogo ativo" description="Ative jogos em Cassino › Jogos para ver a prévia." />
    )

  const remove = async (c: CarouselConfig) => {
    const ok = await confirm({
      title: `Remover "${c.title}"?`,
      description: 'O carrossel sai do rascunho. Ele só some do site depois de salvar.',
      confirmLabel: 'Remover carrossel',
      tone: 'danger',
      icon: Trash2,
    })
    if (!ok) return
    setList(list.filter((x) => x.id !== c.id))
    toast.info('Carrossel removido do rascunho', { description: 'Salve as alterações para publicar.' })
  }

  const restore = async () => {
    const ok = await confirm({
      title: 'Restaurar o padrão da plataforma?',
      description: 'Volta para "Maiores vitórias neste jogo" e "Jogos relacionados", com os valores iniciais. Carrosséis personalizados saem do rascunho.',
      confirmLabel: 'Restaurar padrão',
      tone: 'warning',
      icon: RotateCcw,
    })
    if (ok) form.setValues(DEFAULT_CAROUSELS)
  }

  return (
    <>
      <PageHeader
        actions={
          <>
            <Button icon={RotateCcw} onClick={restore} disabled={!canEdit} title={!canEdit ? 'Seu cargo não edita esta tela' : undefined}>
              Restaurar padrão
            </Button>
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => setCreating(true)}
              disabled={!canEdit || list.length >= CAROUSEL_LIMITS.maxCarousels}
              title={!canEdit ? 'Seu cargo não edita esta tela' : list.length >= CAROUSEL_LIMITS.maxCarousels ? `Máximo de ${CAROUSEL_LIMITS.maxCarousels} carrosséis` : undefined}
            >
              Novo carrossel
            </Button>
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
        <FormFieldset readOnly={form.readOnly}>
          <Card>
            <CardHeader
              icon={ListOrdered}
              title="Ordem na página do jogo"
              description="Os carrosséis aparecem abaixo do jogo nesta ordem. Arraste ou use as setas. Carrossel desligado não é carregado."
              actions={<Badge tone={enabledCount ? 'success' : 'neutral'}>{`${enabledCount} de ${list.length} ligados`}</Badge>}
            />
            <CardBody>
              {list.length === 0 ? (
                <EmptyState
                  icon={Layers}
                  title="Nenhum carrossel"
                  description="A página do jogo vai mostrar só o jogo. Adicione um carrossel ou restaure o padrão."
                  action={
                    <Button variant="primary" icon={Plus} onClick={() => setCreating(true)} disabled={!canEdit}>
                      Novo carrossel
                    </Button>
                  }
                />
              ) : (
                <SortableList
                  items={list}
                  getKey={(c) => c.id}
                  onChange={setList}
                  disabled={form.readOnly}
                  render={(c) => {
                    const meta = KIND_META[c.kind]
                    const err = carouselError(c)
                    return (
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg-2">
                          <meta.icon size={17} aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-fg">{c.title || 'Sem título'}</p>
                          <p className="truncate text-xs text-fg-3">{err ? <span className="font-medium text-danger">{err}</span> : summary(c)}</p>
                        </div>
                        <Badge tone={c.enabled ? 'success' : 'neutral'} dot className="hidden sm:inline-flex">
                          {c.enabled ? 'Ligado' : 'Desligado'}
                        </Badge>
                      </div>
                    )
                  }}
                />
              )}
            </CardBody>
          </Card>

          {list.map((c) => (
            <CarouselCard
              key={c.id}
              c={c}
              games={activeGames}
              providerName={providerName}
              onPatch={(p) => patch(c.id, p)}
              onRemove={() => remove(c)}
              readOnly={form.readOnly}
            />
          ))}
        </FormFieldset>

        <div className="min-w-0">
          <LivePreview
            dirty={form.dirty}
            expand={frame('desktop')}
            description="A página de um jogo no site, com os carrosséis do rascunho."
            footnote={
              list.some((c) => !c.enabled) ? (
                <>Desligados (não carregam): {list.filter((c) => !c.enabled).map((c) => c.title).join(', ')}.</>
              ) : (
                'Troque o jogo para ver como cada regra se comporta em páginas diferentes.'
              )
            }
          >
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <Field label="Página do jogo" htmlFor="pv-game" className="min-w-[180px] flex-1">
                <Select
                  id="pv-game"
                  value={previewGame?.id ?? ''}
                  onChange={setPreviewId}
                  options={activeGames.map((g) => ({ value: g.id, label: `${g.name} · ${providerName.get(g.providerId) ?? ''}` }))}
                />
              </Field>
              <DeviceToggle value={device} onChange={setDevice} />
            </div>
            {frame(device)}
          </LivePreview>
        </div>
      </div>

      <SaveBar form={form} />

      <NewCarouselModal
        open={creating}
        onClose={() => setCreating(false)}
        taken={list.map((c) => c.title.trim().toLowerCase())}
        onCreate={(c) => {
          setList([...list, c])
          setCreating(false)
          toast.success('Carrossel adicionado', { description: 'Ajuste as regras e salve para publicar no site.' })
        }}
      />
    </>
  )
}

// ---------- Configuração de cada carrossel ----------

function CarouselCard({
  c,
  games,
  providerName,
  onPatch,
  onRemove,
  readOnly,
}: {
  c: CarouselConfig
  games: Game[]
  providerName: Map<string, string>
  onPatch: (p: Partial<CarouselConfig>) => void
  onRemove: () => void
  readOnly: boolean
}) {
  const meta = KIND_META[c.kind]
  const id = `car-${c.id}`
  const titleErr = !c.title.trim() ? 'Dê um título ao carrossel.' : c.title.length > CAROUSEL_LIMITS.titleMax ? `Use até ${CAROUSEL_LIMITS.titleMax} caracteres.` : null
  const countErr = c.count < CAROUSEL_LIMITS.minCount || c.count > CAROUSEL_LIMITS.maxCount ? `Entre ${CAROUSEL_LIMITS.minCount} e ${CAROUSEL_LIMITS.maxCount}.` : null
  const manual = (c.kind === 'relacionados' && c.criterion === 'manual') || (c.kind === 'personalizado' && c.source === 'manual')

  return (
    <Card className={c.enabled ? undefined : 'opacity-[0.85]'}>
      <CardHeader
        icon={meta.icon}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.title || 'Sem título'}
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </span>
        }
        description={c.enabled ? summary(c) : 'Desligado: não aparece nem é carregado na página do jogo.'}
        actions={
          <>
            <Switch checked={c.enabled} onChange={(v) => onPatch({ enabled: v })} ariaLabel={`${c.enabled ? 'Desligar' : 'Ligar'} ${c.title}`} disabled={readOnly} />
            {c.kind === 'personalizado' && <IconButton icon={Trash2} label={`Remover ${c.title}`} variant="danger" size="sm" onClick={onRemove} disabled={readOnly} />}
          </>
        }
      />
      <CardBody className="space-y-5 border-t border-line pt-4">
        <FormGrid>
          <Field label="Título no site" htmlFor={`${id}-title`} error={titleErr} hint={`${c.title.length}/${CAROUSEL_LIMITS.titleMax} caracteres`}>
            <Input id={`${id}-title`} value={c.title} maxLength={CAROUSEL_LIMITS.titleMax + 10} invalid={!!titleErr} onChange={(e) => onPatch({ title: e.target.value })} />
          </Field>
          <Field label="Quantidade" htmlFor={`${id}-count`} error={countErr} hint={c.kind === 'maiores_vitorias' ? 'Vitórias mostradas, da maior para a menor.' : 'Jogos mostrados no carrossel.'}>
            <NumberInput
              integer
              id={`${id}-count`}
              value={c.count}
              min={CAROUSEL_LIMITS.minCount}
              max={CAROUSEL_LIMITS.maxCount}
              suffix={c.kind === 'maiores_vitorias' ? 'vitórias' : 'jogos'}
              invalid={!!countErr}
              onValueChange={(n) => onPatch({ count: Math.round(n) })}
            />
          </Field>
        </FormGrid>

        {c.kind === 'maiores_vitorias' && (
          <>
            <Field label="Período">
              <Segmented<WinsPeriod>
                ariaLabel="Período das vitórias"
                value={c.period}
                onChange={(p) => onPatch({ period: p })}
                options={(Object.keys(WINS_PERIOD_LABEL) as WinsPeriod[]).map((p) => ({ value: p, label: p === 'sempre' ? 'Sempre' : p === '24h' ? '24 horas' : p === '7d' ? '7 dias' : '30 dias' }))}
                className="max-w-full overflow-x-auto"
              />
            </Field>
            <FormGrid>
              <Field
                label="Valor mínimo da vitória"
                htmlFor={`${id}-min`}
                error={c.minWin < 0 ? 'Não pode ser negativo.' : null}
                hint="Vitórias menores não entram. Evita mostrar ganhos pequenos."
              >
                <MoneyInput id={`${id}-min`} value={c.minWin} onValueChange={(n) => onPatch({ minWin: n })} invalid={c.minWin < 0} />
              </Field>
            </FormGrid>
            <Switch
              label="Mostrar apelido mascarado"
              description={c.maskNickname ? 'Aparece "lu***x" em vez do apelido completo. Recomendado pela LGPD.' : 'O apelido completo do jogador aparece no carrossel.'}
              checked={c.maskNickname}
              onChange={(v) => onPatch({ maskNickname: v })}
            />
            {!c.maskNickname && (
              <Alert tone="warning" title="Apelido completo exposto">
                Jogadores podem ser identificados por quem vê a página. Confirme que os termos de uso autorizam a exibição.
              </Alert>
            )}
          </>
        )}

        {c.kind === 'relacionados' && (
          <Field label="Quais jogos entram">
            <RadioCards
              name="Critério dos jogos relacionados"
              columns={3}
              value={c.criterion}
              onChange={(v) => onPatch({ criterion: v })}
              options={[
                { value: 'provedora', label: 'Mesma provedora', description: 'Da provedora do jogo aberto.' },
                { value: 'categoria', label: 'Mesma categoria', description: 'Slots com slots, crash com crash.' },
                { value: 'manual', label: 'Lista manual', description: 'Os mesmos jogos em toda página.' },
              ]}
            />
          </Field>
        )}

        {c.kind === 'personalizado' && (
          <>
            <Field label="De onde vêm os jogos">
              <RadioCards<CustomSource>
                name="Fonte do carrossel"
                columns={2}
                value={c.source}
                onChange={(v) => onPatch({ source: v })}
                options={[
                  { value: 'manual', label: 'Lista manual', description: 'Você escolhe e ordena os jogos.', icon: ListOrdered },
                  { value: 'novos', label: 'Lançamentos', description: 'Jogos novos primeiro.', icon: Sparkles },
                  { value: 'populares', label: 'Mais jogados', description: 'Pela pontuação de destaque.', icon: TrendingUp },
                  { value: 'categoria', label: 'Uma categoria', description: 'Os destaques de uma categoria.', icon: LayoutGrid },
                ]}
              />
            </Field>
            {c.source === 'categoria' && (
              <FormGrid>
                <Field label="Categoria" htmlFor={`${id}-cat`}>
                  <Select id={`${id}-cat`} value={c.category} onChange={(v) => onPatch({ category: v as GameCategory })} options={CATEGORY_OPTIONS} />
                </Field>
              </FormGrid>
            )}
          </>
        )}

        {manual && <GamePicker id={`${id}-add`} ids={c.gameIds} games={games} providerName={providerName} onChange={(gameIds) => onPatch({ gameIds })} max={c.count} readOnly={readOnly} />}
      </CardBody>
    </Card>
  )
}

function GamePicker({
  id,
  ids,
  games,
  providerName,
  onChange,
  max,
  readOnly,
}: {
  id: string
  ids: string[]
  games: Game[]
  providerName: Map<string, string>
  onChange: (ids: string[]) => void
  max: number
  readOnly: boolean
}) {
  const chosen = ids.map((id) => games.find((g) => g.id === id)).filter((g): g is Game => !!g)
  const available = games.filter((g) => !ids.includes(g.id))
  const full = ids.length >= CAROUSEL_LIMITS.maxCount
  return (
    <div className="space-y-3">
      <Field
        label="Jogos da lista"
        htmlFor={id}
        error={ids.length === 0 ? 'Escolha pelo menos um jogo.' : null}
        hint={ids.length > max ? `Só os ${max} primeiros aparecem (quantidade do carrossel).` : 'O jogo aberto nunca aparece no próprio carrossel.'}
      >
        <Select
          id={id}
          value=""
          placeholder={full ? 'Lista cheia' : 'Adicionar jogo…'}
          disabled={full || readOnly}
          onChange={(v) => v && onChange([...ids, v])}
          options={available.map((g) => ({ value: g.id, label: `${g.name} · ${providerName.get(g.providerId) ?? ''}` }))}
        />
      </Field>
      {chosen.length > 0 && (
        <SortableList
          items={chosen}
          getKey={(g) => g.id}
          disabled={readOnly}
          onChange={(next) => onChange(next.map((g) => g.id))}
          render={(g, i) => (
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="h-9 w-7 shrink-0 overflow-hidden rounded-md">
                <GameCover game={g} compact style={{ padding: 0 }} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-fg">{g.name}</p>
                <p className="truncate text-xs text-fg-3">
                  {providerName.get(g.providerId)} · {GAME_CATEGORY_LABEL[g.category]}
                  {i >= max && <span className="text-warning"> · fora da quantidade</span>}
                </p>
              </div>
              <IconButton icon={Trash2} label={`Tirar ${g.name} da lista`} size="sm" variant="danger" disabled={readOnly} onClick={() => onChange(ids.filter((x) => x !== g.id))} />
            </div>
          )}
        />
      )}
    </div>
  )
}

function NewCarouselModal({ open, onClose, onCreate, taken }: { open: boolean; onClose: () => void; onCreate: (c: CarouselConfig) => void; taken: string[] }) {
  const [title, setTitle] = useState('')
  const [source, setSource] = useState<CustomSource>('populares')
  const [category, setCategory] = useState<GameCategory>('crash')
  const [count, setCount] = useState(10)
  const [touched, setTouched] = useState(false)
  const titleErr = !title.trim() ? 'Dê um título ao carrossel.' : title.length > CAROUSEL_LIMITS.titleMax ? `Use até ${CAROUSEL_LIMITS.titleMax} caracteres.` : taken.includes(title.trim().toLowerCase()) ? 'Já existe um carrossel com esse título.' : null
  const countErr = count < CAROUSEL_LIMITS.minCount || count > CAROUSEL_LIMITS.maxCount ? `Entre ${CAROUSEL_LIMITS.minCount} e ${CAROUSEL_LIMITS.maxCount}.` : null
  const reset = () => {
    setTitle('')
    setSource('populares')
    setCategory('crash')
    setCount(10)
    setTouched(false)
  }
  const submit = () => {
    setTouched(true)
    if (titleErr || countErr) return
    onCreate(newCarousel(uid('car-'), 'personalizado', title.trim(), { source, category, count }))
    reset()
  }
  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Novo carrossel"
      description="Aparece na página de todos os jogos, depois dos carrosséis que já existem."
      icon={Sparkles}
      size="lg"
      footer={
        <>
          <Button
            onClick={() => {
              reset()
              onClose()
            }}
          >
            Cancelar
          </Button>
          <Button variant="primary" icon={Plus} onClick={submit}>
            Adicionar carrossel
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <FormGrid>
          <Field label="Título no site" htmlFor="nc-title" required error={touched ? titleErr : null}>
            <Input id="nc-title" data-autofocus value={title} placeholder="Ex.: Crash para jogar agora" onChange={(e) => setTitle(e.target.value)} invalid={touched && !!titleErr} />
          </Field>
          <Field label="Quantidade" htmlFor="nc-count" error={countErr}>
            <NumberInput integer id="nc-count" value={count} min={CAROUSEL_LIMITS.minCount} max={CAROUSEL_LIMITS.maxCount} suffix="jogos" onValueChange={(n) => setCount(Math.round(n))} invalid={!!countErr} />
          </Field>
        </FormGrid>
        <Field label="De onde vêm os jogos">
          <RadioCards<CustomSource>
            name="Fonte do novo carrossel"
            value={source}
            onChange={setSource}
            options={[
              { value: 'populares', label: 'Mais jogados', description: 'Pela pontuação de destaque.', icon: TrendingUp },
              { value: 'novos', label: 'Lançamentos', description: 'Jogos novos primeiro.', icon: Sparkles },
              { value: 'categoria', label: 'Uma categoria', description: 'Destaques de uma categoria.', icon: LayoutGrid },
              { value: 'manual', label: 'Lista manual', description: 'Você escolhe os jogos depois.', icon: ListOrdered },
            ]}
          />
        </Field>
        {source === 'categoria' && (
          <Field label="Categoria" htmlFor="nc-cat">
            <Select id="nc-cat" value={category} onChange={(v) => setCategory(v as GameCategory)} options={CATEGORY_OPTIONS} />
          </Field>
        )}
        {source === 'manual' && <Alert tone="info">Depois de adicionar, escolha os jogos no cartão do carrossel.</Alert>}
      </form>
    </Modal>
  )
}

// ---------- Prévia da página do jogo (site do jogador) ----------

function GamePagePreview({
  game,
  carousels,
  games,
  providerName,
  mobile,
}: {
  game: Game
  carousels: CarouselConfig[]
  games: Game[]
  providerName: Map<string, string>
  mobile: boolean
}) {
  const pad = mobile ? 16 : 40
  const provider = providerName.get(game.providerId) ?? ''
  const wins = useMemo(() => winsForGame(game), [game])
  const muted: CSSProperties = { color: PREVIEW.muted }
  return (
    <div style={{ background: PREVIEW.bg, color: PREVIEW.text, fontFamily: 'Inter, system-ui, sans-serif', minHeight: 400 }}>
      {/* cabeçalho do site */}
      <div className="flex items-center" style={{ gap: 24, padding: `14px ${pad}px`, background: PREVIEW.bg2, borderBottom: `1px solid ${PREVIEW.line}` }}>
        {mobile && <MenuIcon size={20} aria-hidden />}
        <SiteLogo size={mobile ? 26 : 30} />
        {!mobile && (
          <nav className="flex" style={{ gap: 22, fontSize: 14, fontWeight: 600 }}>
            <span style={{ color: PREVIEW.text }}>Cassino</span>
            <span style={muted}>Ao vivo</span>
            <span style={muted}>Esportes</span>
            <span style={muted}>Promoções</span>
          </nav>
        )}
        <div className="ml-auto flex items-center" style={{ gap: 10 }}>
          <span style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${PREVIEW.line}`, fontSize: 13, fontWeight: 600 }}>Entrar</span>
          {!mobile && <span style={{ padding: '8px 16px', borderRadius: 10, background: PREVIEW.accent, color: '#fff', fontSize: 13, fontWeight: 700 }}>Cadastrar</span>}
        </div>
      </div>

      <div style={{ padding: `${mobile ? 14 : 22}px ${pad}px 8px` }}>
        <p style={{ ...muted, fontSize: 12, marginBottom: 12 }}>
          Cassino › {provider} › <span style={{ color: PREVIEW.text }}>{game.name}</span>
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'minmax(0,1fr) 300px', gap: 20 }}>
          {/* área do jogo */}
          <div className="relative overflow-hidden" style={{ borderRadius: 16, aspectRatio: '16 / 9', border: `1px solid ${PREVIEW.line}` }}>
            <div className="absolute inset-0" style={{ filter: 'blur(14px) brightness(0.55)', transform: 'scale(1.15)' }}>
              <GameCover game={game} />
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ gap: 12 }}>
              <span className="overflow-hidden" style={{ width: mobile ? 84 : 120, height: mobile ? 112 : 160, borderRadius: 14, boxShadow: '0 12px 30px rgba(0,0,0,0.45)' }}>
                <GameCover game={game} provider={provider} compact={mobile} />
              </span>
              <div className="flex" style={{ gap: 10 }}>
                <span className="inline-flex items-center" style={{ gap: 6, padding: mobile ? '8px 14px' : '10px 22px', borderRadius: 999, background: PREVIEW.green, color: '#04140d', fontWeight: 800, fontSize: mobile ? 12 : 14 }}>
                  <Play size={mobile ? 13 : 15} aria-hidden fill="currentColor" /> Jogar
                </span>
                <span style={{ padding: mobile ? '8px 12px' : '10px 18px', borderRadius: 999, background: 'rgba(255,255,255,0.12)', fontWeight: 600, fontSize: mobile ? 12 : 13 }}>Modo demo</span>
              </div>
            </div>
          </div>
          {/* informações */}
          {!mobile && (
            <div style={{ background: PREVIEW.surface, borderRadius: 16, padding: 20, border: `1px solid ${PREVIEW.line}` }}>
              <div className="flex items-start justify-between" style={{ gap: 10 }}>
                <div>
                  <p style={{ fontSize: 20, fontWeight: 800 }}>{game.name}</p>
                  <p style={{ ...muted, fontSize: 13, marginTop: 2 }}>{provider}</p>
                </div>
                <Heart size={18} aria-hidden style={{ color: PREVIEW.muted }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 18 }}>
                {[
                  ['RTP', `${game.rtp.toLocaleString('pt-BR')}%`],
                  ['Categoria', GAME_CATEGORY_LABEL[game.category]],
                  ['Aposta mínima', brl(game.minBet)],
                  ['Aposta máxima', brl(game.maxBet)],
                ].map(([k, v]) => (
                  <div key={k} style={{ background: PREVIEW.surface2, borderRadius: 10, padding: '10px 12px' }}>
                    <p style={{ ...muted, fontSize: 11 }}>{k}</p>
                    <p style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{v}</p>
                  </div>
                ))}
              </div>
              <p className="flex items-center" style={{ ...muted, gap: 6, fontSize: 12, marginTop: 16 }}>
                <Star size={13} aria-hidden style={{ color: PREVIEW.gold }} fill={PREVIEW.gold} /> {num(game.highlight * 37)} jogando agora
              </p>
            </div>
          )}
        </div>
      </div>

      {/* carrosséis */}
      <div style={{ padding: `12px ${pad}px 28px`, display: 'flex', flexDirection: 'column', gap: 26 }}>
        {carousels.filter((c) => c.enabled).length === 0 && (
          <p style={{ ...muted, fontSize: 13, textAlign: 'center', padding: '24px 0', border: `1px dashed ${PREVIEW.line}`, borderRadius: 12 }}>
            Nenhum carrossel ligado: a página termina no jogo.
          </p>
        )}
        {carousels
          .filter((c) => c.enabled)
          .map((c) => (
            <section key={c.id}>
              <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
                <p className="flex items-center" style={{ gap: 8, fontSize: mobile ? 15 : 17, fontWeight: 800 }}>
                  {c.kind === 'maiores_vitorias' && <Trophy size={mobile ? 16 : 18} aria-hidden style={{ color: PREVIEW.gold }} />}
                  {c.title || 'Sem título'}
                </p>
                <span className="flex items-center" style={{ gap: 6 }}>
                  {!mobile && <span style={{ ...muted, fontSize: 12, fontWeight: 600, marginRight: 6 }}>Ver todos</span>}
                  {[ChevronLeft, ChevronRight].map((I, i) => (
                    <span key={i} className="inline-flex items-center justify-center" style={{ width: 28, height: 28, borderRadius: 8, background: PREVIEW.surface, border: `1px solid ${PREVIEW.line}` }}>
                      <I size={15} aria-hidden />
                    </span>
                  ))}
                </span>
              </div>
              {c.kind === 'maiores_vitorias' ? (
                <WinsRow c={c} wins={wins} mobile={mobile} />
              ) : (
                <GamesRow list={resolveCarouselGames(c, game, games)} providerName={providerName} mobile={mobile} />
              )}
            </section>
          ))}
      </div>
    </div>
  )
}

function WinsRow({ c, wins, mobile }: { c: CarouselConfig; wins: ReturnType<typeof winsForGame>; mobile: boolean }) {
  const list = topWins(wins, { periodMs: WINS_PERIOD_MS[c.period], minWin: c.minWin, count: c.count })
  if (!list.length) {
    return (
      <p style={{ color: PREVIEW.muted, fontSize: 12, padding: '18px 14px', border: `1px dashed ${PREVIEW.line}`, borderRadius: 12 }}>
        Nenhuma vitória de {brl(c.minWin)} ou mais {c.period === 'sempre' ? 'neste jogo' : `nos ${WINS_PERIOD_LABEL[c.period].toLowerCase().replace('últimos ', '').replace('últimas ', '')}`}. O carrossel fica escondido nesta página.
      </p>
    )
  }
  return (
    <div className="flex overflow-hidden" style={{ gap: 12 }}>
      {list.map((w, i) => (
        <div
          key={w.id}
          className="shrink-0"
          style={{
            width: mobile ? 150 : 196,
            padding: 12,
            borderRadius: 14,
            background: i === 0 ? 'linear-gradient(150deg, rgba(250,204,21,0.22), rgba(124,77,255,0.18))' : PREVIEW.surface,
            border: `1px solid ${i === 0 ? 'rgba(250,204,21,0.35)' : PREVIEW.line}`,
          }}
        >
          <div className="flex items-center" style={{ gap: 8 }}>
            <span
              className="inline-flex items-center justify-center"
              style={{ width: 28, height: 28, borderRadius: 999, background: PREVIEW.accentSoft, color: PREVIEW.accentText, fontSize: 11, fontWeight: 800 }}
            >
              {i + 1}
            </span>
            <span className="truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>
              {c.maskNickname ? maskNickname(w.nickname) : w.nickname}
            </span>
          </div>
          <p style={{ marginTop: 10, fontSize: mobile ? 15 : 17, fontWeight: 800, color: PREVIEW.gold }}>{brl(w.amount)}</p>
          <p className="flex items-center" style={{ marginTop: 4, gap: 4, fontSize: 11, color: PREVIEW.muted }}>
            <span style={{ color: PREVIEW.green, fontWeight: 700 }}>{w.multiplier.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x</span> · aposta {brl(w.bet)}
          </p>
          <p className="flex items-center" style={{ marginTop: 2, gap: 4, fontSize: 11, color: PREVIEW.faint }}>
            <Clock size={11} aria-hidden /> {relative(w.at)}
          </p>
        </div>
      ))}
    </div>
  )
}

function GamesRow({ list, providerName, mobile }: { list: Game[]; providerName: Map<string, string>; mobile: boolean }) {
  if (!list.length) {
    return (
      <p style={{ color: PREVIEW.muted, fontSize: 12, padding: '18px 14px', border: `1px dashed ${PREVIEW.line}`, borderRadius: 12 }}>
        Nenhum jogo para esta regra nesta página. O carrossel fica escondido.
      </p>
    )
  }
  return (
    <div className="flex overflow-hidden" style={{ gap: 12 }}>
      {list.map((g) => (
        <div key={g.id} className="shrink-0" style={{ width: mobile ? 104 : 148 }}>
          <div className="overflow-hidden" style={{ aspectRatio: '3 / 4', borderRadius: 12, border: `1px solid ${PREVIEW.line}` }}>
            <GameCover game={g} provider={providerName.get(g.providerId)} compact={mobile} />
          </div>
          <p className="truncate" style={{ fontSize: 12, fontWeight: 600, marginTop: 6 }}>
            {g.name}
          </p>
          <p className="truncate" style={{ fontSize: 11, color: PREVIEW.faint }}>
            {providerName.get(g.providerId)}
          </p>
        </div>
      ))}
    </div>
  )
}
