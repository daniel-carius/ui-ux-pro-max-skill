import { useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Blocks,
  Coins,
  Gift,
  HeartHandshake,
  LayoutGrid,
  ListOrdered,
  Monitor,
  RectangleHorizontal,
  RotateCcw,
  Smartphone,
  Star,
  Target,
  TriangleAlert,
  Trophy,
  Volleyball,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  FormFieldset,
  PageHeader,
  PageLink,
  Progress,
  SaveBar,
  Segmented,
  SortableList,
  Switch,
  confirm,
  toast,
  useSettingsForm,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { brl } from '@/lib/format'
import { useDb } from '@/lib/store'
import { dayKey } from '@/data/now'
import { useGames, useProviders } from '@/data/hooks'
import { usePageAccess } from '@/domain/session'
import {
  bannerStatus,
  displayName,
  rgba,
  validateHome,
  visibleMenuItems,
  type AvatarConfig,
  type Banner,
  type HomeBlock,
  type HomeBlockId,
  type HomeConfig,
  type MenusConfig,
  type ProvidersHomeConfig,
  type SitePalette,
} from '@/domain/personalizacao-p1'
import {
  DEFAULT_AVATARS,
  DEFAULT_HOME,
  DEFAULT_MENUS,
  DEFAULT_PROVIDERS_HOME,
  HOME_BLOCK_INFO,
  P1_KEYS,
  SAMPLE_EVENTS,
  SAMPLE_WINS,
  samplePlayers,
  seedBanners,
} from '@/data/personalizacao-p1'
import {
  BrowserFrame,
  EditorLayout,
  EditorSection,
  EmptySlot,
  GameTileMock,
  MenuIcon,
  PhoneFrame,
  PreviewJumpButton,
  PreviewPanel,
  ProviderStripMock,
  SafeImage,
  SiteBlockTitle,
  SiteHeaderMock,
  SiteLogo,
  useSitePalette,
  useSiteTheme,
  useSiteTitle,
} from './_shared-p1'

const BLOCK_ICON: Record<HomeBlockId, LucideIcon> = {
  'banner-principal': RectangleHorizontal,
  'jogos-destaque': Star,
  top10: ListOrdered,
  ganhadores: Coins,
  provedores: Blocks,
  'esportes-ao-vivo': Volleyball,
  torneios: Trophy,
  missoes: Target,
  promocoes: Gift,
  categorias: LayoutGrid,
  'jogo-responsavel': HeartHandshake,
}

type Device = 'computador' | 'celular'

export default function Home() {
  const { canEdit } = usePageAccess()
  const form = useSettingsForm<HomeConfig>(P1_KEYS.home, DEFAULT_HOME, {
    entity: 'Página inicial',
    successMessage: 'Página inicial salva',
    validate: validateHome,
  })
  const v = form.values
  const total = v.blocks.length
  const on = v.blocks.filter((b) => b.enabled).length
  const [device, setDevice] = useState<Device>('computador')

  // estado de outras telas para avisar de bloco ligado sem conteúdo
  const [banners] = useDb<Banner[]>(P1_KEYS.banners, seedBanners)
  const [stripCfg] = useDb<ProvidersHomeConfig>(P1_KEYS.provedoresHome, DEFAULT_PROVIDERS_HOME)
  const today = dayKey(new Date())
  const heroLive = banners.filter((b) => b.position === 'hero' && bannerStatus(b, today) === 'no_ar')
  const warnings: Partial<Record<HomeBlockId, string>> = {}
  if (!heroLive.length) warnings['banner-principal'] = 'Nenhum banner no ar'
  if (!stripCfg.enabled) warnings.provedores = 'Faixa desligada'

  const setEnabled = (id: HomeBlockId, enabled: boolean) => form.set('blocks', v.blocks.map((b) => (b.id === id ? { ...b, enabled } : b)))

  const restore = async () => {
    const ok = await confirm({
      title: 'Restaurar a home padrão?',
      description: 'A ordem e os blocos ligados voltam ao padrão da plataforma (5 de 11 ligados). O site só muda depois de salvar.',
      confirmLabel: 'Restaurar padrão',
      tone: 'warning',
      icon: RotateCcw,
    })
    if (!ok) return
    form.setValues(DEFAULT_HOME)
    toast.info('Padrão restaurado no rascunho', { description: 'Clique em Salvar alterações para publicar.' })
  }

  return (
    <>
      <PageHeader
        actions={
          <>
            <PreviewJumpButton />
            <Button icon={RotateCcw} onClick={restore} disabled={!canEdit} title={!canEdit ? 'Seu cargo não pode editar esta tela' : undefined}>
              Restaurar padrão
            </Button>
          </>
        }
      />

      <EditorLayout
        preview={
          <PreviewPanel
            description="Esqueleto da home na ordem atual. Só blocos ligados aparecem."
            actions={
              <Segmented<Device>
                size="sm"
                ariaLabel="Aparelho da prévia"
                value={device}
                onChange={setDevice}
                options={[
                  { value: 'computador', label: 'Computador', icon: Monitor },
                  { value: 'celular', label: 'Celular', icon: Smartphone },
                ]}
              />
            }
            footer="Os blocos mostram dados de exemplo. No site, cada bloco carrega o conteúdo real."
          >
            <HomePreview blocks={v.blocks.filter((b) => b.enabled)} device={device} heroBanners={heroLive} stripCfg={stripCfg} />
          </PreviewPanel>
        }
      >
        <FormFieldset readOnly={form.readOnly}>
          <EditorSection
            title="Blocos da home"
            description="Arraste para mudar a ordem e ligue só o que faz sentido para a sua operação. A ordem vale para computador e celular."
            aside={
              <div className="rounded-xl border border-line bg-surface-2 p-3">
                <p className="flex items-baseline justify-between gap-2 text-[13px] text-fg-2">
                  <span>
                    <strong className="font-display text-xl text-fg tnum">{on}</strong> de {total} ligados
                  </span>
                  <span className="text-xs text-fg-3">{total - on} desligados</span>
                </p>
                <Progress value={on} max={total} className="mt-2" label={`${on} de ${total} blocos ligados`} />
              </div>
            }
          >
            <Alert tone="info" title="Bloco desligado não é carregado">
              O site nem busca os dados dele, e a home abre mais rápido. Ligue de novo quando quiser: a configuração do bloco continua guardada.
            </Alert>
            {on === 0 && (
              <Alert tone="danger" title="A home está vazia">
                Ligue pelo menos um bloco para salvar.
              </Alert>
            )}
            <SortableList
              items={v.blocks}
              getKey={(b) => b.id}
              onChange={(blocks) => form.set('blocks', blocks)}
              disabled={!canEdit}
              render={(b) => <BlockRow block={b} warning={b.enabled ? warnings[b.id] : undefined} onToggle={(en) => setEnabled(b.id, en)} disabled={!canEdit} />}
            />
          </EditorSection>
        </FormFieldset>
      </EditorLayout>

      <SaveBar form={form} />
    </>
  )
}

function BlockRow({ block, warning, onToggle, disabled }: { block: HomeBlock; warning?: string; onToggle: (on: boolean) => void; disabled: boolean }) {
  const info = HOME_BLOCK_INFO[block.id]
  const Icon = BLOCK_ICON[block.id]
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          'hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:flex',
          block.enabled ? 'bg-primary/10 text-primary-text' : 'bg-surface-3 text-fg-3',
        )}
      >
        <Icon size={17} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium', block.enabled ? 'text-fg' : 'text-fg-3')}>
          {info.label}
          {!block.enabled && <Badge>Desligado</Badge>}
          {warning && (
            <Badge tone="warning" icon={TriangleAlert}>
              {warning}
            </Badge>
          )}
        </p>
        <p className="mt-0.5 text-xs leading-4 text-fg-3">
          {info.description}{' '}
          {info.configure && (
            <PageLink to={info.configure.to} className="link whitespace-nowrap">
              {info.configure.label}
            </PageLink>
          )}
        </p>
      </div>
      <Switch size="sm" checked={block.enabled} onChange={onToggle} disabled={disabled} ariaLabel={`Mostrar ${info.label} na home`} />
    </div>
  )
}

// ---------- Prévia ----------

function HomePreview({
  blocks,
  device,
  heroBanners,
  stripCfg,
}: {
  blocks: HomeBlock[]
  device: Device
  heroBanners: Banner[]
  stripCfg: ProvidersHomeConfig
}) {
  const theme = useSiteTheme()
  const p = useSitePalette()
  const title = useSiteTitle()
  const [menus] = useDb<MenusConfig>(P1_KEYS.menus, DEFAULT_MENUS)
  const mobile = device === 'celular'
  const body = (
    <div className={cn('space-y-3', mobile ? 'p-2' : 'p-2.5')} style={{ background: p.background }}>
      {blocks.length === 0 ? (
        <EmptySlot palette={p} className="h-40">
          Nenhum bloco ligado
        </EmptySlot>
      ) : (
        blocks.map((b, i) => (
          <div key={b.id} className="relative pl-[18px]">
            <span
              className="absolute left-0 top-0 flex h-[13px] w-[13px] items-center justify-center rounded-full text-[7.5px] font-bold tnum"
              style={{ background: rgba(p.text, 0.14), color: p.text }}
              title={HOME_BLOCK_INFO[b.id].label}
            >
              {i + 1}
            </span>
            <BlockMock id={b.id} palette={p} mobile={mobile} heroBanners={heroBanners} stripCfg={stripCfg} />
          </div>
        ))
      )}
    </div>
  )

  if (!mobile) {
    return (
      <BrowserFrame favicon={theme.favicon} title={title}>
        <div style={{ background: p.background }}>
          <SiteHeaderMock palette={p} logo={theme.logo} />
          {body}
        </div>
      </BrowserFrame>
    )
  }
  const bar = visibleMenuItems(menus.mobile, 'visitante').slice(0, 5)
  return (
    <PhoneFrame background={p.background}>
      <div className="flex items-center justify-between px-3 pb-1.5 pt-6" style={{ background: p.surface, borderBottom: `1px solid ${p.line}` }}>
        <SiteLogo src={theme.logo} className="h-6 w-[50px]" style={{ color: p.text }} />
        <span className="rounded-md px-2 py-0.5 text-[9px] font-bold" style={{ background: p.primary, color: p.onPrimary }}>
          Entrar
        </span>
      </div>
      <div className="h-[430px] overflow-y-auto">{body}</div>
      <div className="grid px-1 pb-2 pt-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(1, bar.length)}, minmax(0,1fr))`, background: p.surface, borderTop: `1px solid ${p.line}` }}>
        {bar.map((it, i) => (
          <span key={it.id} className="flex min-w-0 flex-col items-center gap-0.5 text-[8px] font-semibold" style={{ color: i === 0 ? p.primary : p.muted }}>
            <MenuIcon name={it.icon} size={13} />
            <span className="max-w-full truncate">{it.label}</span>
          </span>
        ))}
      </div>
    </PhoneFrame>
  )
}

const CATEGORIES = ['Slots', 'Ao vivo', 'Crash', 'Mesa', 'Bingo', 'Instantâneos']
const PROMOS = [
  { t: 'Bônus de 100%', s: 'no 1º depósito', h: 265 },
  { t: 'Cashback 10%', s: 'todo domingo', h: 160 },
  { t: 'Giros grátis', s: 'em slots novos', h: 25 },
]

function BlockMock({
  id,
  palette: p,
  mobile,
  heroBanners,
  stripCfg,
}: {
  id: HomeBlockId
  palette: SitePalette
  mobile: boolean
  heroBanners: Banner[]
  stripCfg: ProvidersHomeConfig
}) {
  const { items: games } = useGames()
  const { items: providers } = useProviders()
  const top = useMemo(() => [...games].filter((g) => g.active).sort((a, b) => b.highlight - a.highlight), [games])
  const players = useMemo(() => samplePlayers(), [])
  const [avatarCfg] = useDb<AvatarConfig>(P1_KEYS.avatares, DEFAULT_AVATARS)
  const cols = mobile ? 3 : 6
  const card = { background: p.surface, border: `1px solid ${p.line}` }

  switch (id) {
    case 'banner-principal': {
      const hero = heroBanners[0]
      return hero?.image ? (
        <div className="relative overflow-hidden rounded-lg">
          <SafeImage src={hero.image} className="aspect-[1372/476] w-full object-cover" />
          <span className="absolute inset-x-0 bottom-1 flex justify-center gap-1" aria-hidden>
            {heroBanners.map((b, i) => (
              <span key={b.id} className="h-1 rounded-full" style={{ width: i === 0 ? 12 : 4, background: i === 0 ? '#FFFFFF' : 'rgba(255,255,255,.5)' }} />
            ))}
          </span>
        </div>
      ) : (
        <EmptySlot palette={p} className="aspect-[1372/476]">
          Banner principal sem banner no ar
        </EmptySlot>
      )
    }
    case 'categorias':
      return (
        <div className="flex gap-1 overflow-hidden">
          {CATEGORIES.slice(0, mobile ? 4 : 6).map((c, i) => (
            <span
              key={c}
              className="shrink-0 rounded-full px-2 py-1 text-[8.5px] font-semibold"
              style={i === 0 ? { background: p.primary, color: p.onPrimary } : { ...card, color: p.text }}
            >
              {c}
            </span>
          ))}
        </div>
      )
    case 'jogos-destaque':
      return (
        <div>
          <SiteBlockTitle palette={p}>Jogos em destaque</SiteBlockTitle>
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
            {top.slice(0, cols).map((g) => (
              <GameTileMock key={g.id} hue={g.hue} label={g.name} />
            ))}
          </div>
        </div>
      )
    case 'top10':
      return (
        <div>
          <SiteBlockTitle palette={p}>Top 10 da semana</SiteBlockTitle>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${mobile ? 3 : 5}, minmax(0,1fr))` }}>
            {top.slice(6, 6 + (mobile ? 3 : 5)).map((g, i) => (
              <div key={g.id} className="relative pl-3">
                <span
                  className="absolute bottom-0 left-0 z-10 font-display text-[30px] font-extrabold leading-none"
                  style={{ color: p.background, WebkitTextStroke: `1.5px ${p.accent}` }}
                >
                  {i + 1}
                </span>
                <GameTileMock hue={g.hue} />
              </div>
            ))}
          </div>
        </div>
      )
    case 'ganhadores':
      return (
        <div>
          <SiteBlockTitle palette={p} action={null}>
            Ganhadores ao vivo
          </SiteBlockTitle>
          <div className="flex gap-1.5 overflow-hidden">
            {SAMPLE_WINS.slice(0, mobile ? 2 : 3).map((w) => {
              const pl = players[w.player]
              return (
                <div key={w.player} className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1" style={card}>
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[7px] font-bold" style={{ background: rgba(p.primary, 0.25), color: p.text }}>
                    {pl.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[8px] font-semibold" style={{ color: p.text }}>
                      {displayName(pl, avatarCfg.nameDisplay)}
                    </span>
                    <span className="block text-[8px] font-bold tnum" style={{ color: p.accent }}>
                      {brl(w.amount)}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )
    case 'provedores':
      return stripCfg.enabled ? (
        <ProviderStripMock palette={p} config={stripCfg} providers={providers} columns={mobile ? 3 : 6} limit={mobile ? 6 : 6} />
      ) : (
        <EmptySlot palette={p} className="h-10">
          Faixa de provedores desligada em Provedores na home
        </EmptySlot>
      )
    case 'esportes-ao-vivo':
      return (
        <div>
          <SiteBlockTitle palette={p}>Esportes ao vivo</SiteBlockTitle>
          <div className="space-y-1">
            {SAMPLE_EVENTS.slice(0, 2).map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-md px-2 py-1" style={card}>
                <span className="min-w-0 flex-1 truncate text-[8.5px] font-semibold" style={{ color: p.text }}>
                  {e.home} × {e.away}
                </span>
                {e.odds.map((o, i) => (
                  <span key={i} className="rounded px-1.5 py-0.5 text-[8px] font-bold tnum" style={{ background: p.surface2, color: p.text }}>
                    {o.toFixed(2).replace('.', ',')}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )
    case 'torneios':
      return (
        <div className="flex items-center gap-2 rounded-lg p-2" style={{ background: `linear-gradient(110deg, ${rgba(p.accent, 0.25)}, ${p.surface})`, border: `1px solid ${p.line}` }}>
          <Trophy size={20} style={{ color: p.accent }} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[9.5px] font-bold" style={{ color: p.text }}>
              Torneio Fortune Tiger
            </p>
            <p className="text-[8.5px]" style={{ color: p.muted }}>
              {brl(50000)} em prêmios · termina domingo
            </p>
          </div>
          <span className="rounded-md px-2 py-1 text-[8.5px] font-bold" style={{ background: p.primary, color: p.onPrimary }}>
            Participar
          </span>
        </div>
      )
    case 'missoes':
      return (
        <div>
          <SiteBlockTitle palette={p}>Missões</SiteBlockTitle>
          <div className="grid gap-1" style={{ gridTemplateColumns: mobile ? '1fr' : '1fr 1fr' }}>
            {[
              ['Aposte R$ 100 em slots', 0.64],
              ['Jogue 3 jogos novos', 0.33],
            ].map(([t, pct]) => (
              <div key={t as string} className="rounded-md px-2 py-1.5" style={card}>
                <p className="truncate text-[8.5px] font-semibold" style={{ color: p.text }}>
                  {t}
                </p>
                <span className="mt-1 block h-1 overflow-hidden rounded-full" style={{ background: p.surface2 }}>
                  <span className="block h-full rounded-full" style={{ width: `${(pct as number) * 100}%`, background: p.primary }} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )
    case 'promocoes':
      return (
        <div>
          <SiteBlockTitle palette={p}>Promoções</SiteBlockTitle>
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${mobile ? 2 : 3}, minmax(0,1fr))` }}>
            {PROMOS.slice(0, mobile ? 2 : 3).map((x) => (
              <div key={x.t} className="rounded-md p-1.5" style={{ background: `linear-gradient(140deg, hsl(${x.h} 65% 45%), hsl(${x.h + 30} 60% 22%))` }}>
                <p className="truncate text-[9px] font-extrabold" style={{ color: '#FFFFFF' }}>
                  {x.t}
                </p>
                <p className="truncate text-[7.5px]" style={{ color: 'rgba(255,255,255,.8)' }}>
                  {x.s}
                </p>
              </div>
            ))}
          </div>
        </div>
      )
    case 'jogo-responsavel':
      return (
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5" style={card}>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[7px] font-extrabold" style={{ border: `1.5px solid ${p.muted}`, color: p.text }}>
            18+
          </span>
          <span className="min-w-0 flex-1 text-[8.5px]" style={{ color: p.muted }}>
            Jogue com responsabilidade. <span style={{ color: p.primary, fontWeight: 700 }}>Defina seus limites</span>
          </span>
        </div>
      )
    default:
      return null
  }
}
