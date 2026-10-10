import { useMemo, useState } from 'react'
import { Camera, Coins, ImageUp, Plus, RotateCcw, ShieldCheck, Sparkles, Trash2, Trophy, UserRound } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Field,
  FormFieldset,
  IconButton,
  ImageUpload,
  Input,
  Modal,
  NumberInput,
  PageHeader,
  RadioCards,
  SaveBar,
  Segmented,
  Switch,
  confirm,
  toast,
  useSettingsForm,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import { brl, initials, num } from '@/lib/format'
import { uid } from '@/lib/random'
import { usePageAccess } from '@/domain/session'
import {
  LIBRARY_MAX,
  TIERS_MAX_PER_KIND,
  achievedTier,
  displayName,
  maskName,
  rgba,
  safeImageSrc,
  tierErrors,
  validateAvatarConfig,
  type AchievementKind,
  type AchievementTier,
  type AvatarConfig,
  type AvatarMode,
  type GeneratedStyle,
  type NameDisplay,
  type PhotoModeration,
  type SitePalette,
} from '@/domain/personalizacao-p1'
import { DEFAULT_AVATARS, P1_KEYS, SAMPLE_RANKING, SAMPLE_WINS, avatarArt, medalArt, samplePlayers, type SamplePlayer } from '@/data/personalizacao-p1'
import { EditorLayout, EditorSection, PreviewJumpButton, PreviewPanel, SafeImage, SiteBlockTitle, useSitePalette } from './_shared-p1'

const KIND_LABEL: Record<AchievementKind, { title: string; unit: string; hint: string }> = {
  apostas: { title: 'Por apostas', unit: 'apostas', hint: 'Conta todas as apostas feitas no site, no cassino e nos esportes.' },
  vitorias: { title: 'Por vitórias', unit: 'vitórias', hint: 'Conta rodadas e apostas que pagaram prêmio.' },
}

const PLAYERS = samplePlayers()
const ILLUSTRATIONS = PLAYERS.map((_, i) => avatarArt(20 + i))

export default function Avatares() {
  const { canEdit } = usePageAccess()
  const form = useSettingsForm<AvatarConfig>(P1_KEYS.avatares, DEFAULT_AVATARS, {
    entity: 'Perfil e avatares',
    successMessage: 'Avatares salvos',
    validate: validateAvatarConfig,
  })
  const v = form.values
  const errors = useMemo(() => tierErrors(v.tiers), [v.tiers])
  const [imageFor, setImageFor] = useState<string | null>(null)
  const example = PLAYERS[0]

  const setTier = (id: string, patch: Partial<AchievementTier>) => form.set('tiers', v.tiers.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  const addTier = (kind: AchievementKind) => {
    const list = v.tiers.filter((t) => t.kind === kind)
    if (list.length >= TIERS_MAX_PER_KIND) return
    const last = list[list.length - 1]
    const tier: AchievementTier = {
      id: uid('tier-'),
      kind,
      name: `Nível ${list.length + 1}`,
      threshold: last ? last.threshold * 10 : kind === 'apostas' ? 100 : 10,
      image: medalArt(kind, list.length),
    }
    // mantém os níveis de cada tipo juntos
    const idx = v.tiers.map((t) => t.kind).lastIndexOf(kind)
    const next = [...v.tiers]
    next.splice(idx === -1 ? next.length : idx + 1, 0, tier)
    form.set('tiers', next)
  }

  const removeTier = async (t: AchievementTier) => {
    const ok = await confirm({
      title: `Remover o nível "${t.name}"?`,
      description: 'Quem já tinha esse avatar volta para o avatar anterior. O site só muda depois de salvar.',
      confirmLabel: 'Remover nível',
      tone: 'danger',
      icon: Trash2,
    })
    if (ok) form.set('tiers', v.tiers.filter((x) => x.id !== t.id))
  }

  const removeLibrary = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Remover o avatar "${name}" da biblioteca?`,
      description: 'Jogadores que usam esse avatar passam a ver o avatar gerado. O site só muda depois de salvar.',
      confirmLabel: 'Remover avatar',
      tone: 'danger',
      icon: Trash2,
    })
    if (ok) form.set('library', v.library.filter((a) => a.id !== id))
  }

  const addLibrary = (image: string | null) => {
    if (!image) return
    if (v.library.length >= LIBRARY_MAX) {
      toast.error(`A biblioteca aceita até ${LIBRARY_MAX} avatares.`)
      return
    }
    form.set('library', [...v.library, { id: uid('av-'), name: `Avatar ${v.library.length + 1}`, image }])
    toast.success('Avatar adicionado ao rascunho', { description: 'Salve para liberar no site.' })
  }

  const restore = async () => {
    const ok = await confirm({
      title: 'Restaurar os avatares padrão?',
      description: 'Modo, biblioteca, níveis de conquista e privacidade voltam ao padrão da plataforma. Avatares enviados saem da biblioteca. O site só muda depois de salvar.',
      confirmLabel: 'Restaurar padrão',
      tone: 'warning',
      icon: RotateCcw,
    })
    if (!ok) return
    form.setValues(DEFAULT_AVATARS)
    toast.info('Padrão restaurado no rascunho', { description: 'Clique em Salvar alterações para publicar.' })
  }

  const tierImage = imageFor ? v.tiers.find((t) => t.id === imageFor) : undefined

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
          <PreviewPanel description="Ganhadores ao vivo, ranking de torneio e perfil, com jogadores de exemplo." footer="Nome completo, CPF e e-mail nunca aparecem no site.">
            <AvatarPreview cfg={v} />
          </PreviewPanel>
        }
      >
        <FormFieldset readOnly={form.readOnly}>
          <EditorSection title="Avatar do jogador" description="Aparece nos rankings de torneio, nos ganhadores ao vivo, no chat e no perfil.">
            <RadioCards<AvatarMode>
              name="Tipo de avatar"
              value={v.mode}
              onChange={(m) => form.set('mode', m)}
              options={[
                { value: 'gerado', label: 'Gerado automaticamente', icon: Sparkles, description: 'O site cria o avatar a partir do apelido. Nenhuma foto é enviada.' },
                { value: 'proprio', label: 'Próprio', icon: Camera, description: 'O jogador envia uma foto. Quem não enviou usa o avatar gerado.' },
              ]}
            />
            <Field label={v.mode === 'gerado' ? 'Estilo do avatar gerado' : 'Estilo para quem não enviou foto'}>
              <RadioCards<GeneratedStyle>
                name="Estilo do avatar gerado"
                value={v.generatedStyle}
                onChange={(s) => form.set('generatedStyle', s)}
                options={[
                  {
                    value: 'iniciais',
                    label: 'Iniciais',
                    description: (
                      <>
                        <span className="mt-2 flex gap-1.5" aria-hidden>
                          {PLAYERS.slice(0, 4).map((p, i) => (
                            <InitialsAvatar key={p.id} text={p.nick.slice(0, 2).toUpperCase()} hue={i * 70 + 250} size={30} />
                          ))}
                        </span>
                        <span className="mt-1.5 block">Duas letras com cor própria. Leve e neutro.</span>
                      </>
                    ),
                  },
                  {
                    value: 'ilustracao',
                    label: 'Ilustração',
                    description: (
                      <>
                        <span className="mt-2 flex gap-1.5" aria-hidden>
                          {ILLUSTRATIONS.slice(0, 4).map((src, i) => (
                            <img key={i} src={src} alt="" className="h-[30px] w-[30px] rounded-full" />
                          ))}
                        </span>
                        <span className="mt-1.5 block">Personagem sorteado para cada jogador, sempre o mesmo.</span>
                      </>
                    ),
                  },
                ]}
              />
            </Field>
            {v.mode === 'proprio' && (
              <>
                <Field label="Moderação das fotos">
                  <RadioCards<PhotoModeration>
                    name="Moderação das fotos"
                    value={v.moderation}
                    onChange={(m) => form.set('moderation', m)}
                    options={[
                      {
                        value: 'antes',
                        label: 'Aprovar antes de aparecer',
                        badge: <Badge tone="success">Recomendado</Badge>,
                        description: 'A foto fica pendente até a equipe aprovar. Enquanto isso, o jogador usa o avatar gerado.',
                      },
                      { value: 'depois', label: 'Aparece na hora', description: 'A equipe remove depois, se precisar. Uma foto imprópria pode aparecer no ranking até ser removida.' },
                    ]}
                  />
                </Field>
                <Alert tone="neutral" icon={ShieldCheck}>
                  Fotos com nudez, violência, menores de idade, documentos ou dados pessoais são recusadas, e o jogador recebe o motivo. Limite de 2 MB, PNG ou JPG.
                </Alert>
              </>
            )}
          </EditorSection>

          <EditorSection
            title="Biblioteca de avatares"
            description="Avatares prontos que o jogador pode escolher no perfil, no lugar do gerado ou da foto."
            aside={
              <p className="text-xs text-fg-3">
                {num(v.library.length)} de {LIBRARY_MAX} avatares
              </p>
            }
          >
            <Switch
              label="O jogador pode escolher da biblioteca"
              description={v.allowLibrary ? 'Ligado: aparece "Escolher avatar" no perfil do jogador.' : 'Desligado: a biblioteca fica guardada, mas não aparece no site.'}
              checked={v.allowLibrary}
              onChange={(on) => form.set('allowLibrary', on)}
            />
            {v.allowLibrary && v.library.length === 0 && <Alert tone="danger">Envie pelo menos um avatar ou desligue a biblioteca para salvar.</Alert>}
            <ul className={cn('grid grid-cols-3 gap-2 sm:grid-cols-4 2xl:grid-cols-6', !v.allowLibrary && 'opacity-60')} aria-label="Avatares da biblioteca">
              {v.library.map((a) => (
                <li key={a.id} className="group relative flex flex-col items-center gap-1.5 rounded-xl border border-line bg-surface-2 p-2.5">
                  <SafeImage src={a.image} alt={`Avatar ${a.name}`} className="h-14 w-14 rounded-full object-cover ring-2 ring-surface" />
                  <span className="w-full truncate text-center text-xs text-fg-2">{a.name}</span>
                  <IconButton
                    icon={Trash2}
                    size="sm"
                    variant="danger"
                    label={`Remover ${a.name}`}
                    onClick={() => removeLibrary(a.id, a.name)}
                    disabled={!canEdit}
                    className="absolute right-0.5 top-0.5 h-7 w-7 bg-surface/80"
                  />
                </li>
              ))}
            </ul>
            <ImageUpload
              label="Adicionar avatar"
              width={256}
              height={256}
              value={null}
              onChange={addLibrary}
              disabled={!canEdit || v.library.length >= LIBRARY_MAX}
              previewClassName="max-w-[120px]"
              hint="256×256 px, PNG ou JPG. Pode enviar vários, um de cada vez."
            />
          </EditorSection>

          <EditorSection
            title="Avatar por conquista"
            description="Ao bater a meta, o jogador desbloqueia o avatar do nível e ganha o selo dele no ranking. Metas crescentes dentro de cada tipo."
          >
            <Switch
              label="Dar avatar por conquista"
              description={v.achievementsEnabled ? 'Ligado: o selo do maior nível aparece ao lado do avatar.' : 'Desligado: nenhum avatar ou selo de conquista aparece.'}
              checked={v.achievementsEnabled}
              onChange={(on) => form.set('achievementsEnabled', on)}
            />
            <div className={cn('grid gap-4 2xl:grid-cols-2', !v.achievementsEnabled && 'opacity-60')}>
              {(['apostas', 'vitorias'] as AchievementKind[]).map((kind) => {
                const list = v.tiers.filter((t) => t.kind === kind)
                const Icon = kind === 'apostas' ? Coins : Trophy
                return (
                  <div key={kind} className="rounded-xl border border-line">
                    <div className="flex items-start justify-between gap-3 border-b border-line bg-surface-2 px-3.5 py-2.5">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-[13px] font-semibold text-fg">
                          <Icon size={15} className="text-fg-3" aria-hidden /> {KIND_LABEL[kind].title}
                        </p>
                        <p className="mt-0.5 text-xs text-fg-3">{KIND_LABEL[kind].hint}</p>
                      </div>
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={Plus}
                        onClick={() => addTier(kind)}
                        disabled={!canEdit || list.length >= TIERS_MAX_PER_KIND}
                        title={list.length >= TIERS_MAX_PER_KIND ? `Até ${TIERS_MAX_PER_KIND} níveis por tipo` : undefined}
                      >
                        Nível
                      </Button>
                    </div>
                    {list.length === 0 ? (
                      <p className="px-3.5 py-5 text-center text-[13px] text-fg-3">Nenhum nível. Adicione o primeiro.</p>
                    ) : (
                      <ol className="divide-y divide-line">
                        {list.map((t, ti) => (
                          <li key={t.id} className="px-3.5 py-3">
                            <div className="flex items-start gap-2.5">
                              <button
                                type="button"
                                onClick={() => setImageFor(t.id)}
                                className={cn('group relative h-10 w-10 shrink-0 overflow-hidden rounded-full ring-1 ring-line disabled:cursor-not-allowed', ti === 0 && 'mt-[26px]')}
                                aria-label={`Trocar imagem do nível ${t.name}`}
                                title="Trocar imagem"
                              >
                                <SafeImage src={t.image} className="h-full w-full object-cover" fallback={<UserRound size={18} className="m-auto text-fg-3" aria-hidden />} />
                                <span className="absolute inset-0 hidden items-center justify-center bg-fg/50 text-surface group-hover:flex">
                                  <ImageUp size={14} aria-hidden />
                                </span>
                              </button>
                              <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
                                <Field label={ti === 0 ? 'Nome' : undefined} htmlFor={`tn-${t.id}`}>
                                  <Input id={`tn-${t.id}`} aria-label={`Nome do nível ${ti + 1}`} value={t.name} maxLength={20} onChange={(e) => setTier(t.id, { name: e.target.value })} invalid={!t.name.trim()} />
                                </Field>
                                <Field label={ti === 0 ? 'Meta' : undefined} htmlFor={`tm-${t.id}`}>
                                  {ti > 0 && (
                                    <label htmlFor={`tm-${t.id}`} className="sr-only">
                                      Meta do nível {t.name}
                                    </label>
                                  )}
                                  <NumberInput
                                    id={`tm-${t.id}`}
                                    value={t.threshold}
                                    min={1}
                                    onValueChange={(n) => setTier(t.id, { threshold: Math.round(n) })}
                                    suffix={<span className="text-xs">{KIND_LABEL[kind].unit}</span>}
                                    invalid={!!errors[t.id] && !!t.name.trim()}
                                  />
                                </Field>
                              </div>
                              <IconButton icon={Trash2} size="sm" variant="danger" label={`Remover nível ${t.name}`} onClick={() => removeTier(t)} disabled={!canEdit} className={ti === 0 ? 'mt-[27px]' : 'mt-1'} />
                            </div>
                            {errors[t.id] && (
                              <p className="mt-1.5 pl-[50px] text-xs font-medium text-danger" role="alert">
                                {errors[t.id]}
                              </p>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )
              })}
            </div>
          </EditorSection>

          <EditorSection title="Privacidade" description="Como o nome do jogador aparece para os outros no site.">
            <RadioCards<NameDisplay>
              name="Nome exibido"
              value={v.nameDisplay}
              onChange={(m) => form.set('nameDisplay', m)}
              options={[
                { value: 'apelido', label: 'Apelido', description: `Ex.: ${example.nick}. O jogador escolhe no cadastro e pode trocar no perfil.` },
                { value: 'nome-mascarado', label: 'Nome mascarado', description: `Ex.: ${maskName(example.name)} Mostra duas letras do nome e a inicial do sobrenome.` },
              ]}
            />
            <Alert tone="info">Nome completo, CPF e e-mail nunca aparecem no site, em nenhuma das opções (LGPD).</Alert>
          </EditorSection>
        </FormFieldset>
      </EditorLayout>

      <SaveBar form={form} />

      <Modal
        open={!!tierImage}
        onClose={() => setImageFor(null)}
        title={`Imagem do nível ${tierImage?.name ?? ''}`}
        description="Quadrada, 96×96 px ou maior. Vira o avatar desbloqueado e o selo no ranking."
        icon={ImageUp}
        size="sm"
        footer={
          <>
            {tierImage && (
              <Button
                variant="ghost"
                onClick={() => {
                  const idx = v.tiers.filter((t) => t.kind === tierImage.kind).findIndex((t) => t.id === tierImage.id)
                  setTier(tierImage.id, { image: medalArt(tierImage.kind, idx) })
                  toast.info('Medalha padrão de volta')
                }}
              >
                Usar medalha padrão
              </Button>
            )}
            <Button variant="primary" onClick={() => setImageFor(null)}>
              Concluir
            </Button>
          </>
        }
      >
        {tierImage && (
          <ImageUpload
            width={96}
            height={96}
            value={safeImageSrc(tierImage.image)}
            onChange={(url) => setTier(tierImage.id, { image: url })}
            disabled={!canEdit}
            previewClassName="mx-auto w-40"
            hint="96×96 px"
          />
        )}
      </Modal>
    </>
  )
}

// ---------- Avatares na prévia ----------

function InitialsAvatar({ text, hue, size }: { text: string; hue: number; size: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold"
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.36), background: `hsl(${hue % 360} 65% 52%)`, color: '#FFFFFF' }}
    >
      {text}
    </span>
  )
}

function topTier(p: SamplePlayer, cfg: AvatarConfig): AchievementTier | null {
  if (!cfg.achievementsEnabled) return null
  const w = achievedTier('vitorias', p.wins, cfg.tiers)
  const b = achievedTier('apostas', p.bets, cfg.tiers)
  return w ?? b
}

function PlayerAvatar({ player, index, cfg, size, palette: pal }: { player: SamplePlayer; index: number; cfg: AvatarConfig; size: number; palette: SitePalette }) {
  const tier = topTier(player, cfg)
  const name = displayName(player, cfg.nameDisplay)
  let face
  if (cfg.mode === 'proprio' && player.photo) {
    face = <img src={player.photo} alt="" className="rounded-full object-cover" style={{ width: size, height: size }} />
  } else if (cfg.generatedStyle === 'ilustracao') {
    face = <img src={ILLUSTRATIONS[index % ILLUSTRATIONS.length]} alt="" className="rounded-full" style={{ width: size, height: size }} />
  } else {
    const text = cfg.nameDisplay === 'apelido' ? player.nick.slice(0, 2).toUpperCase() : initials(player.name)
    face = <InitialsAvatar text={text} hue={index * 70 + 250} size={size} />
  }
  return (
    <span className="relative inline-flex shrink-0" title={tier ? `${name} · nível ${tier.name}` : name}>
      <span className="rounded-full" style={{ boxShadow: `0 0 0 2px ${pal.surface}` }}>
        {face}
      </span>
      {tier?.image && (
        <SafeImage
          src={tier.image}
          alt={`Selo ${tier.name}`}
          className="absolute -bottom-1 -right-1 rounded-full"
          style={{ width: size * 0.48, height: size * 0.48, boxShadow: `0 0 0 1.5px ${pal.surface}` }}
          fallback={null}
        />
      )}
    </span>
  )
}

const MEDAL = ['#FACC15', '#D9DEE5', '#CD7F32']

function AvatarPreview({ cfg }: { cfg: AvatarConfig }) {
  const p = useSitePalette()
  const [tab, setTab] = useState<'site' | 'perfil'>('site')
  const me = PLAYERS[3]
  const meTier = topTier(me, cfg)
  return (
    <div className="space-y-3">
      <Segmented
        size="sm"
        ariaLabel="Parte do site"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'site', label: 'Home e torneio' },
          { value: 'perfil', label: 'Perfil do jogador' },
        ]}
      />
      <div className="space-y-3 rounded-xl p-3" style={{ background: p.background, border: `1px solid ${p.line}` }}>
        {tab === 'site' ? (
          <>
            <div>
              <SiteBlockTitle palette={p} action={null}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: '#22C55E' }} aria-hidden />
                  Ganhadores ao vivo
                </span>
              </SiteBlockTitle>
              <div className="grid grid-cols-2 gap-1.5">
                {SAMPLE_WINS.slice(0, 4).map((w) => {
                  const pl = PLAYERS[w.player]
                  return (
                    <div key={w.player} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: p.surface, border: `1px solid ${p.line}` }}>
                      <PlayerAvatar player={pl} index={w.player} cfg={cfg} size={28} palette={p} />
                      <div className="min-w-0">
                        <p className="truncate text-[10px] font-semibold" style={{ color: p.text }}>
                          {displayName(pl, cfg.nameDisplay)}
                        </p>
                        <p className="truncate text-[8.5px]" style={{ color: p.muted }}>
                          {w.game}
                        </p>
                        <p className="text-[10px] font-bold tnum" style={{ color: p.accent }}>
                          {brl(w.amount)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="overflow-hidden rounded-lg" style={{ background: p.surface, border: `1px solid ${p.line}` }}>
              <div className="flex items-center justify-between px-2.5 py-2" style={{ borderBottom: `1px solid ${p.line}` }}>
                <span className="flex items-center gap-1.5 text-[10.5px] font-bold" style={{ color: p.text }}>
                  <Trophy size={12} style={{ color: p.accent }} aria-hidden /> Torneio Fortune Tiger
                </span>
                <span className="text-[9px]" style={{ color: p.muted }}>
                  Ranking
                </span>
              </div>
              {SAMPLE_RANKING.map((r, i) => {
                const pl = PLAYERS[r.player]
                return (
                  <div key={r.player} className="flex items-center gap-2 px-2.5 py-1.5" style={i > 0 ? { borderTop: `1px solid ${p.line}` } : undefined}>
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-extrabold"
                      style={i < 3 ? { background: MEDAL[i], color: '#1A1405' } : { background: p.surface2, color: p.muted }}
                    >
                      {i + 1}
                    </span>
                    <PlayerAvatar player={pl} index={r.player} cfg={cfg} size={26} palette={p} />
                    <span className="min-w-0 flex-1 truncate text-[10px] font-semibold" style={{ color: p.text }}>
                      {displayName(pl, cfg.nameDisplay)}
                    </span>
                    <span className="text-[9px] tnum" style={{ color: p.muted }}>
                      {num(r.points)} pts
                    </span>
                    <span className="w-[62px] text-right text-[10px] font-bold tnum" style={{ color: p.accent }}>
                      {brl(r.prize).replace(',00', '')}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <div className="rounded-lg p-3" style={{ background: p.surface, border: `1px solid ${p.line}` }}>
            <div className="flex items-center gap-3">
              <PlayerAvatar player={me} index={3} cfg={cfg} size={52} palette={p} />
              <div className="min-w-0">
                <p className="truncate text-[12px] font-bold" style={{ color: p.text }}>
                  {displayName(me, cfg.nameDisplay)}
                </p>
                <p className="text-[9.5px]" style={{ color: p.muted }}>
                  {num(me.bets)} apostas · {num(me.wins)} vitórias
                </p>
                {meTier && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8.5px] font-bold" style={{ background: rgba(p.accent, 0.18), color: p.text }}>
                    Nível {meTier.name}
                  </span>
                )}
              </div>
            </div>
            {cfg.mode === 'proprio' && (
              <div className="mt-3 rounded-md px-2 py-1.5 text-center text-[9.5px] font-semibold" style={{ border: `1px dashed ${rgba(p.text, 0.3)}`, color: p.text }}>
                Enviar foto {cfg.moderation === 'antes' ? '· aprovada pela equipe antes de aparecer' : ''}
              </div>
            )}
            {cfg.allowLibrary && cfg.library.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[10px] font-bold" style={{ color: p.text }}>
                  Escolher avatar
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {cfg.library.slice(0, 10).map((a, i) => (
                    <SafeImage
                      key={a.id}
                      src={a.image}
                      alt={a.name}
                      className="h-8 w-8 rounded-full object-cover"
                      style={i === 0 ? { boxShadow: `0 0 0 2px ${p.primary}` } : undefined}
                    />
                  ))}
                </div>
              </div>
            )}
            {cfg.achievementsEnabled && (
              <div className="mt-3">
                <p className="mb-1.5 text-[10px] font-bold" style={{ color: p.text }}>
                  Conquistas
                </p>
                <div className="flex flex-wrap gap-2">
                  {cfg.tiers.map((t) => {
                    const done = (t.kind === 'apostas' ? me.bets : me.wins) >= t.threshold
                    return (
                      <span key={t.id} className="flex w-[52px] flex-col items-center gap-0.5" title={`${t.name}: ${num(t.threshold)} ${KIND_LABEL[t.kind].unit}`}>
                        <SafeImage
                          src={t.image}
                          className="h-8 w-8 rounded-full"
                          style={done ? undefined : { filter: 'grayscale(1)', opacity: 0.35 }}
                          fallback={<span className="h-8 w-8 rounded-full" style={{ background: p.surface2 }} />}
                        />
                        <span className="w-full truncate text-center text-[8px]" style={{ color: done ? p.text : p.muted }}>
                          {t.name}
                        </span>
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
