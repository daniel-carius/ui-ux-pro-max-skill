import { useMemo, useState } from 'react'
import { Moon, Palette, RotateCcw, Sun, Type } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Field,
  FormFieldset,
  PageHeader,
  RadioCards,
  SaveBar,
  Select,
  Switch,
  TextLink,
  confirm,
  toast,
  useSettingsForm,
} from '@/components/ui'
import { brl } from '@/lib/format'
import { usePageAccess } from '@/domain/session'
import {
  BETBY_DEFAULT,
  rgba,
  sportsbookPalette,
  type SportsbookConfig,
  type SportsbookMode,
  type SportsbookPalette,
} from '@/domain/personalizacao-p1'
import { DEFAULT_SPORTSBOOK, P1_KEYS, SAMPLE_EVENTS, SPORTSBOOK_FONTS } from '@/data/personalizacao-p1'
import { EditorLayout, EditorSection, PreviewJumpButton, PreviewPanel, useGoogleFonts, useSiteTheme } from './_shared-p1'

const FONT_VALUES = SPORTSBOOK_FONTS.map((f) => f.value)
const fontStack = (f: string) => `'${f}', 'Segoe UI', system-ui, sans-serif`
const odd = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Sportsbook() {
  const { canEdit } = usePageAccess()
  const form = useSettingsForm<SportsbookConfig>(P1_KEYS.sportsbook, DEFAULT_SPORTSBOOK, {
    entity: 'Sportsbook',
    successMessage: 'Visual do sportsbook salvo',
    validate: (v) => (FONT_VALUES.includes(v.font) ? null : 'Escolha uma fonte da lista.'),
  })
  const v = form.values
  const site = useSiteTheme()
  useGoogleFonts(FONT_VALUES)
  const palette = useMemo(() => sportsbookPalette(v, site.colors), [v, site.colors])

  const restore = async () => {
    const ok = await confirm({
      title: 'Voltar ao visual padrão da Betby?',
      description: 'Visual escuro, fonte Roboto e cores da Betby (azul). O site só muda depois de salvar.',
      confirmLabel: 'Restaurar padrão',
      tone: 'warning',
      icon: RotateCcw,
    })
    if (!ok) return
    form.setValues(DEFAULT_SPORTSBOOK)
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
            description="Lista de jogos e cupom de apostas com o visual escolhido. Clique nas odds para testar."
            actions={
              <Badge tone={palette.source === 'site' ? 'primary' : 'info'} icon={Palette}>
                {palette.source === 'site' ? 'Cores do site' : 'Padrão Betby'}
              </Badge>
            }
            footer="O sportsbook é fornecido pela Betby. A plataforma envia estas escolhas ao abrir a página de esportes."
          >
            <SportsbookPreview palette={palette} font={v.font} />
          </PreviewPanel>
        }
      >
        <FormFieldset readOnly={form.readOnly}>
          <EditorSection title="Cores" description="O sportsbook pode seguir as cores da sua marca ou manter o visual da Betby.">
            <Switch
              label="Usar as cores do site"
              description={
                v.useSiteColors
                  ? 'Ligado: botões, odds selecionadas e destaques usam as cores de Identidade e tema.'
                  : 'Desligado: o sportsbook usa o visual padrão da Betby (escuro e azul).'
              }
              checked={v.useSiteColors}
              onChange={(on) => form.set('useSiteColors', on)}
            />
            {v.useSiteColors ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
                <ColorChip label="Primária" color={site.colors.primary} />
                <ColorChip label="Destaque" color={site.colors.accent} />
                <ColorChip label="Fundo" color={site.colors.background} />
                <span className="text-xs text-fg-3">
                  Vêm de <TextLink to="/settings/theme">Identidade e tema</TextLink>.
                </span>
              </div>
            ) : (
              <Alert tone="info" title="Visual padrão da Betby">
                Fundo escuro com azul, igual em todos os sites que usam a Betby. A escolha de visual claro ou escuro só vale com as cores do site ligadas.
                <span className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                  <ColorChip label="Fundo" color={BETBY_DEFAULT.background} />
                  <ColorChip label="Cartões" color={BETBY_DEFAULT.surface} />
                  <ColorChip label="Azul" color={BETBY_DEFAULT.primary} />
                </span>
              </Alert>
            )}
          </EditorSection>

          <EditorSection
            title="Visual"
            description="Claro ou escuro. Vale para a lista de jogos, a página do evento e o cupom de apostas."
          >
            <Field label="Visual do sportsbook" hint={v.useSiteColors ? undefined : 'Ligue "Usar as cores do site" para escolher.'}>
              <RadioCards<SportsbookMode>
                name="Visual do sportsbook"
                value={v.useSiteColors ? v.mode : 'escuro'}
                onChange={(m) => form.set('mode', m)}
                disabled={!v.useSiteColors || !canEdit}
                options={(['escuro', 'claro'] as SportsbookMode[]).map((m) => ({
                  value: m,
                  label: m === 'escuro' ? 'Escuro' : 'Claro',
                  icon: m === 'escuro' ? Moon : Sun,
                  description: (
                    <>
                      <ModeThumb palette={sportsbookPalette({ ...v, mode: m, useSiteColors: true }, site.colors)} />
                      <span className="mt-1.5 block">
                        {m === 'escuro' ? 'Cansa menos a vista à noite. É o mais usado em apostas ao vivo.' : 'Fundo claro, leitura fácil de dia e no celular.'}
                      </span>
                    </>
                  ),
                }))}
              />
            </Field>
          </EditorSection>

          <EditorSection title="Fonte" description="Fonte dos nomes dos times, odds e cupom. Fontes do Google, carregadas pela Betby.">
            <Field label="Fonte" htmlFor="sb-font" hint="Prefira fontes com números largos e fáceis de comparar.">
              <Select id="sb-font" value={v.font} onChange={(f) => form.set('font', f)} options={SPORTSBOOK_FONTS} disabled={!canEdit} />
            </Field>
            <div className="rounded-xl border border-line bg-surface-2 p-4" aria-label={`Amostra da fonte ${v.font}`}>
              <p className="flex items-center gap-1.5 text-xs font-medium text-fg-3">
                <Type size={13} aria-hidden /> Amostra em {v.font}
              </p>
              <p className="mt-2 text-lg font-bold leading-snug text-fg" style={{ fontFamily: fontStack(v.font) }}>
                Flamengo 2 × 1 Palmeiras
              </p>
              <p className="mt-1 text-sm text-fg-2 tnum" style={{ fontFamily: fontStack(v.font) }}>
                Odd 2,35 · Aposte R$ 20,00 e receba R$ 47,00
              </p>
              <p className="mt-1 text-xs text-fg-3 tnum" style={{ fontFamily: fontStack(v.font) }}>
                0123456789 · Ambas marcam · Mais de 2,5 gols
              </p>
            </div>
          </EditorSection>

          <Alert tone="neutral">
            As credenciais da Betby (Platform ID e chaves) ficam em <TextLink to="/games/agregadores">Cassino › Agregadores</TextLink>.
          </Alert>
        </FormFieldset>
      </EditorLayout>

      <SaveBar form={form} />
    </>
  )
}

function ColorChip({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-2">
      <span className="h-4 w-4 rounded ring-1 ring-inset ring-line-strong" style={{ background: color }} aria-hidden />
      {label}
      <span className="font-mono text-[11px] text-fg-3">{color}</span>
    </span>
  )
}

/** Miniatura do sportsbook para o cartão de escolha (usa spans: fica dentro de um botão). */
function ModeThumb({ palette: p }: { palette: SportsbookPalette }) {
  return (
    <span className="mt-2 block overflow-hidden rounded-lg ring-1 ring-inset ring-line" style={{ background: p.background }} aria-hidden>
      <span className="flex gap-1 px-2 pt-2">
        <span className="h-1.5 w-8 rounded-full" style={{ background: p.primary }} />
        <span className="h-1.5 w-6 rounded-full" style={{ background: p.muted, opacity: 0.6 }} />
        <span className="h-1.5 w-6 rounded-full" style={{ background: p.muted, opacity: 0.6 }} />
      </span>
      {[0, 1].map((r) => (
        <span key={r} className="m-2 flex items-center gap-1.5 rounded-md p-1.5" style={{ background: p.surface }}>
          <span className="flex-1 space-y-1">
            <span className="block h-1 w-12 rounded-full" style={{ background: p.text, opacity: 0.85 }} />
            <span className="block h-1 w-9 rounded-full" style={{ background: p.text, opacity: 0.5 }} />
          </span>
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-3.5 w-6 rounded" style={{ background: r === 0 && i === 0 ? p.primary : p.odd }} />
          ))}
        </span>
      ))}
    </span>
  )
}

const SPORTS = ['Futebol', 'Basquete', 'Tênis', 'E-sports', 'Vôlei']

function SportsbookPreview({ palette: p, font }: { palette: SportsbookPalette; font: string }) {
  const [picks, setPicks] = useState<Record<string, number>>({ e1: 0 })
  const [stake, setStake] = useState(20)
  const selections = SAMPLE_EVENTS.filter((e) => picks[e.id] !== undefined).map((e) => ({ e, i: picks[e.id], odd: e.odds[picks[e.id]] }))
  const total = selections.reduce((acc, s) => acc * s.odd, 1)
  const leagues = [...new Set(SAMPLE_EVENTS.map((e) => e.league))]
  const toggle = (id: string, i: number) =>
    setPicks((prev) => {
      const next = { ...prev }
      if (next[id] === i) delete next[id]
      else next[id] = i
      return next
    })
  const pickLabel = (home: string, away: string, i: number) => (i === 0 ? home : i === 1 ? 'Empate' : away)

  return (
    <div className="overflow-hidden rounded-xl" style={{ background: p.background, color: p.text, fontFamily: fontStack(font), border: `1px solid ${p.line}` }}>
      {/* esportes */}
      <div className="flex items-center gap-3 overflow-hidden px-3 pt-2.5 text-[10.5px] font-semibold" style={{ borderBottom: `1px solid ${p.line}` }}>
        {SPORTS.map((s, i) => (
          <span key={s} className="relative shrink-0 pb-2" style={{ color: i === 0 ? p.text : p.muted }}>
            {s}
            {i === 0 && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full" style={{ background: p.primary }} aria-hidden />}
          </span>
        ))}
      </div>

      <div className="space-y-2.5 p-2.5">
        {leagues.map((league) => (
          <div key={league} className="overflow-hidden rounded-lg" style={{ background: p.surface }}>
            <div className="flex items-center justify-between px-2.5 py-1.5 text-[9.5px] font-bold uppercase tracking-wide" style={{ color: p.muted, borderBottom: `1px solid ${p.line}` }}>
              <span>{league}</span>
              <span className="grid w-[132px] grid-cols-3 text-center">
                <span>1</span>
                <span>X</span>
                <span>2</span>
              </span>
            </div>
            {SAMPLE_EVENTS.filter((e) => e.league === league).map((e, idx) => (
              <div key={e.id} className="flex items-center gap-2 px-2.5 py-2" style={idx > 0 ? { borderTop: `1px solid ${p.line}` } : undefined}>
                <div className="min-w-0 flex-1">
                  <p className="mb-0.5 flex items-center gap-1 text-[8.5px] font-bold" style={{ color: e.live ? p.live : p.muted }}>
                    {e.live && <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: p.live }} aria-hidden />}
                    {e.live ? `AO VIVO ${e.when}` : e.when}
                  </p>
                  {[e.home, e.away].map((team, ti) => (
                    <p key={team} className="flex items-center justify-between gap-1 text-[11px] font-semibold leading-[15px]">
                      <span className="truncate">{team}</span>
                      {e.score && <span className="tnum" style={{ color: p.text }}>{e.score[ti]}</span>}
                    </p>
                  ))}
                </div>
                <div className="grid w-[132px] shrink-0 grid-cols-3 gap-1">
                  {e.odds.map((o, i) => {
                    const sel = picks[e.id] === i
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggle(e.id, i)}
                        aria-pressed={sel}
                        aria-label={`${pickLabel(e.home, e.away, i)}, odd ${odd(o)}`}
                        className="rounded-md py-1.5 text-center text-[11px] font-bold tnum transition-transform active:scale-95"
                        style={sel ? { background: p.primary, color: p.onPrimary } : { background: p.odd, color: p.oddText }}
                      >
                        {odd(o)}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}

        {/* cupom */}
        <div className="overflow-hidden rounded-lg" style={{ background: p.surface, border: `1px solid ${rgba(p.primary, 0.35)}` }}>
          <div className="flex items-center justify-between px-2.5 py-2" style={{ borderBottom: `1px solid ${p.line}` }}>
            <span className="flex items-center gap-1.5 text-[11px] font-bold">
              Cupom de apostas
              <span className="rounded-full px-1.5 text-[9px] font-bold" style={{ background: p.primary, color: p.onPrimary }}>
                {selections.length}
              </span>
            </span>
            <span className="text-[9.5px] font-semibold" style={{ color: p.muted }}>
              {selections.length > 1 ? 'Múltipla' : 'Simples'}
            </span>
          </div>
          {selections.length === 0 ? (
            <p className="px-2.5 py-4 text-center text-[10px]" style={{ color: p.muted }}>
              Escolha uma odd para montar a aposta.
            </p>
          ) : (
            <div className="space-y-2 p-2.5">
              {selections.map(({ e, i, odd: o }) => (
                <div key={e.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[10.5px] font-bold">{pickLabel(e.home, e.away, i)}</p>
                    <p className="truncate text-[9px]" style={{ color: p.muted }}>
                      Resultado final · {e.home} × {e.away}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] font-bold tnum" style={{ color: p.accentText }}>
                    {odd(o)}
                  </span>
                </div>
              ))}
              <div className="flex gap-1">
                {[10, 20, 50, 100].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStake(s)}
                    aria-pressed={stake === s}
                    className="flex-1 rounded-md py-1 text-[9.5px] font-semibold tnum"
                    style={stake === s ? { background: rgba(p.primary, 0.18), color: p.text, border: `1px solid ${p.primary}` } : { background: p.odd, color: p.muted, border: `1px solid transparent` }}
                  >
                    R$ {s}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span style={{ color: p.muted }}>Odd total {odd(total)}</span>
                <span>
                  Retorno possível <strong className="tnum" style={{ color: p.accentText }}>{brl(stake * total)}</strong>
                </span>
              </div>
              <div className="rounded-md py-2 text-center text-[11px] font-bold" style={{ background: p.primary, color: p.onPrimary }}>
                Fazer aposta de {brl(stake)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
